export async function fetchFreeOpenRouterModels() {
    const res = await fetch('/api/models/free');

    if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData?.error?.message || `Failed to load models (${res.status})`);
    }

    const data = await res.json();
    return Array.isArray(data.models) ? data.models : [];
}

export async function fetchGoogleModels() {
    const res = await fetch('/api/models/google');

    if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData?.error?.message || `Failed to load Google models (${res.status})`);
    }

    const data = await res.json();
    return Array.isArray(data.models) ? data.models : [];
}

/**
 * Stream a chat completion for the selected model/provider.
 *
 * @param {object} requestData
 * @param {Array} requestData.messages - conversation messages [{role, content}]
 * @param {string} requestData.apiKey - NVIDIA API key (used for NVIDIA only)
 * @param {string} requestData.modelId
 * @param {string} requestData.provider - 'nvidia' | 'bedrock' | 'google' | 'cerebras' | 'openrouter'
 * @param {string} [requestData.region] - AWS region (for bedrock only)
 * @param {object} callbacks
 *   .onReasoning(text) - called for each reasoning token
 *   .onContent(text) - called for each content token
 *   .onDone() - called when stream completes
 *   .onError(error) - called on error {code, text}
 * @returns {AbortController} - call .abort() to stop generation
 */
export function streamChat(
    { messages, apiKey, modelId, provider, temperature, top_p, max_tokens, frequency_penalty, presence_penalty, system_prompt, region },
    { onReasoning, onContent, onDone, onError },
) {
    const controller = new AbortController();

    (async () => {
        try {
            const body = { messages, apiKey, modelId, provider };
            if (temperature != null) body.temperature = temperature;
            if (top_p != null) body.top_p = top_p;
            if (max_tokens != null) body.max_tokens = max_tokens;
            if (frequency_penalty != null) body.frequency_penalty = frequency_penalty;
            if (presence_penalty != null) body.presence_penalty = presence_penalty;
            if (system_prompt) body.system_prompt = system_prompt;
            if (region) body.region = region;

            const res = await fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
                signal: controller.signal,
            });

            if (!res.ok) {
                const errData = await res.json().catch(() => ({}));
                onError?.({ code: res.status, text: errData?.error?.message || `HTTP ${res.status}` });
                return;
            }

            const reader = res.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                // Keep the last potentially incomplete line in buffer
                buffer = lines.pop() || '';

                for (const line of lines) {
                    const trimmed = line.trim();
                    if (!trimmed || !trimmed.startsWith('data: ')) continue;

                    const payload = trimmed.slice(6);
                    if (payload === '[DONE]') {
                        onDone?.();
                        return;
                    }

                    try {
                        const parsed = JSON.parse(payload);

                        // Handle both reasoning and content arriving simultaneously
                        if (parsed.type === 'reasoning' && parsed.text) {
                            onReasoning?.(parsed.text);
                        }
                        if (parsed.type === 'content' && parsed.text) {
                            onContent?.(parsed.text);
                        }
                        if (parsed.type === 'error') {
                            onError?.({ code: parsed.code, text: parsed.text });
                            return;
                        }
                    } catch {
                        // Skip malformed chunks
                    }
                }
            }

            // If stream ends without [DONE], still call onDone
            onDone?.();
        } catch (err) {
            if (err.name === 'AbortError') {
                onDone?.();
                return;
            }
            onError?.({ code: 0, text: err.message || 'Connection failed.' });
        }
    })();

    return controller;
}
