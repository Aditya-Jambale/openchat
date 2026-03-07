/**
 * Netlify Function v2 — streaming chat endpoint.
 *
 * serverless-http buffers the entire Express response before sending it to the
 * client, so SSE events (thinking tokens, content tokens) arrive all at once.
 * This dedicated function uses the native Web Streams API (ReadableStream)
 * which Netlify streams to the browser chunk-by-chunk, giving real-time
 * thinking & content display.
 */

import {
    BedrockRuntimeClient,
    ConverseStreamCommand,
} from '@aws-sdk/client-bedrock-runtime';

// ── Config ──────────────────────────────────────
const NVIDIA_URL = 'https://integrate.api.nvidia.com/v1/chat/completions';
const NVIDIA_MODEL_ID = 'moonshotai/kimi-k2.5';
const CEREBRAS_URL = 'https://api.cerebras.ai/v1/chat/completions';
const GOOGLE_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const OPENROUTER_CHAT_URL = 'https://openrouter.ai/api/v1/chat/completions';

const THINKING_MODELS = new Set([
    'us.anthropic.claude-3-7-sonnet-20250219-v1:0',
]);

// ── Bedrock client cache ────────────────────────
const bedrockClients = {};

function getBedrockClient(region) {
    const r = region || process.env.BEDROCK_AWS_REGION || 'us-east-1';
    if (!bedrockClients[r]) {
        const cfg = { region: r };
        const ak = process.env.BEDROCK_AWS_ACCESS_KEY_ID?.trim();
        const sk = process.env.BEDROCK_AWS_SECRET_ACCESS_KEY?.trim();
        const st = process.env.BEDROCK_AWS_SESSION_TOKEN?.trim();
        if (ak && sk) {
            cfg.credentials = { accessKeyId: ak, secretAccessKey: sk };
            if (st) cfg.credentials.sessionToken = st;
        }
        bedrockClients[r] = new BedrockRuntimeClient(cfg);
    }
    return bedrockClients[r];
}

// ── SSE helpers ─────────────────────────────────
function sseEvent(obj) {
    return `data: ${JSON.stringify(obj)}\n\n`;
}
function sseDone() {
    return 'data: [DONE]\n\n';
}
function sseError(code, text) {
    return sseEvent({ type: 'error', code, text });
}

// ── Upstream fetchers ───────────────────────────

async function* streamNvidia(messages, params, clientKey, signal) {
    const apiKey = process.env.NVIDIA_API_KEY || clientKey;
    if (!apiKey || !apiKey.startsWith('nvapi-')) {
        yield sseError(401, 'Invalid API key. Key must start with "nvapi-".');
        return;
    }

    const payload = {
        model: NVIDIA_MODEL_ID,
        messages,
        max_tokens: params.max_tokens ?? 16384,
        temperature: params.temperature ?? 1.0,
        top_p: params.top_p ?? 0.95,
        stream: true,
        chat_template_kwargs: { thinking: true },
    };

    let res;
    try {
        res = await fetch(NVIDIA_URL, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
                Accept: 'text/event-stream',
            },
            body: JSON.stringify(payload),
            signal,
        });
    } catch (err) {
        yield sseError(500, err.message || 'Connection to NVIDIA failed.');
        return;
    }

    if (!res.ok) {
        const status = res.status;
        if (status === 401) yield sseError(401, 'Invalid API key. Check your key at build.nvidia.com.');
        else if (status === 429) yield sseError(429, 'Rate limit exceeded. Please wait a moment and try again.');
        else yield sseError(status, `NVIDIA API error (HTTP ${status})`);
        return;
    }

    yield* parseUpstreamSSE(res, (parsed) => {
        const events = [];
        const reasoning = parsed.choices?.[0]?.delta?.reasoning;
        const content = parsed.choices?.[0]?.delta?.content;
        if (reasoning) events.push(sseEvent({ type: 'reasoning', text: reasoning }));
        if (content) events.push(sseEvent({ type: 'content', text: content }));
        return events;
    });
}

async function* streamGoogle(messages, params, systemPrompt, modelId, signal) {
    const googleApiKey = process.env.GOOGLE_API_KEY;
    if (!googleApiKey) {
        yield sseError(500, 'GOOGLE_API_KEY is not configured on the server.');
        return;
    }

    const payload = buildGooglePayload(messages, params, systemPrompt);

    let res;
    try {
        res = await fetch(
            `${GOOGLE_API_BASE}/models/${modelId}:streamGenerateContent?alt=sse&key=${googleApiKey}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
                body: JSON.stringify(payload),
                signal,
            },
        );
    } catch (err) {
        yield sseError(500, err.message || 'Connection to Google failed.');
        return;
    }

    if (!res.ok) {
        const status = res.status;
        if (status === 401 || status === 403) yield sseError(status, 'Google API key is invalid or lacks access to the requested model.');
        else if (status === 429) yield sseError(429, 'Google API rate limit exceeded. Please wait and try again.');
        else yield sseError(status, `Google API error (HTTP ${status})`);
        return;
    }

    yield* parseUpstreamSSE(res, (parsed) => {
        const events = [];
        const parts = parsed.candidates?.[0]?.content?.parts || [];
        for (const part of parts) {
            if (typeof part?.text === 'string' && part.text) {
                events.push(sseEvent({ type: 'content', text: part.text }));
            }
        }
        return events;
    });
}

async function* streamCerebras(messages, params, modelId, clientKey, signal) {
    const cerebrasApiKey = process.env.CEREBRAS_API_KEY || clientKey;
    if (!cerebrasApiKey || !cerebrasApiKey.startsWith('csk-')) {
        yield sseError(401, 'Invalid Cerebras API key. Key must start with "csk-".');
        return;
    }

    const payload = {
        model: modelId,
        messages,
        stream: true,
    };
    if (params.temperature != null) payload.temperature = params.temperature;
    if (params.top_p != null) payload.top_p = params.top_p;
    if (params.max_tokens != null) payload.max_tokens = params.max_tokens;
    if (params.frequency_penalty != null) payload.frequency_penalty = params.frequency_penalty;
    if (params.presence_penalty != null) payload.presence_penalty = params.presence_penalty;

    let res;
    try {
        res = await fetch(CEREBRAS_URL, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${cerebrasApiKey}`,
                'Content-Type': 'application/json',
                Accept: 'text/event-stream',
            },
            body: JSON.stringify(payload),
            signal,
        });
    } catch (err) {
        yield sseError(500, err.message || 'Connection to Cerebras failed.');
        return;
    }

    if (!res.ok) {
        const status = res.status;
        const errorData = await readJsonSafe(res);
        const message =
            errorData?.error?.message ||
            errorData?.message ||
            errorData?.detail ||
            `Cerebras API error (HTTP ${status})`;

        if (status === 401 || status === 403) yield sseError(status, 'Cerebras API key is invalid or lacks access to the requested model.');
        else if (status === 404) yield sseError(404, message);
        else if (status === 429) yield sseError(429, 'Cerebras rate limit exceeded. Please wait and try again.');
        else yield sseError(status, message);
        return;
    }

    yield* parseUpstreamSSE(res, (parsed) => {
        const events = [];

        if (parsed.error?.message) {
            events.push(sseError(parsed.error?.code || 500, parsed.error.message));
            return events;
        }

        const delta = parsed.choices?.[0]?.delta || {};
        const reasoning = getReasoningText(delta);
        const content = getContentText(delta.content);
        if (reasoning) events.push(sseEvent({ type: 'reasoning', text: reasoning }));
        if (content) events.push(sseEvent({ type: 'content', text: content }));
        return events;
    });
}

async function* streamBedrock(messages, params, modelId, region, signal) {
    // Convert to Bedrock Converse format.
    const systemPrompts = [];
    const converseMessages = [];

    for (const msg of messages) {
        if (msg.role === 'system') {
            const text = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
            systemPrompts.push({ text });
            continue;
        }

        const role = msg.role === 'assistant' ? 'assistant' : 'user';
        const content = [];

        if (typeof msg.content === 'string') {
            content.push({ text: msg.content });
        } else if (Array.isArray(msg.content)) {
            for (const part of msg.content) {
                if (typeof part === 'string') content.push({ text: part });
                else if (part?.type === 'text') content.push({ text: part.text });
                else if (part?.type === 'image_url' && part.image_url?.url) {
                    const match = part.image_url.url.match(/^data:image\/(\w+);base64,(.+)$/);
                    if (match) {
                        content.push({
                            image: {
                                format: match[1] === 'jpg' ? 'jpeg' : match[1],
                                source: {
                                    bytes: Uint8Array.from(atob(match[2]), (c) => c.charCodeAt(0)),
                                },
                            },
                        });
                    }
                }
            }
        }
        if (content.length > 0) converseMessages.push({ role, content });
    }

    const input = {
        modelId,
        messages: converseMessages,
        inferenceConfig: {},
    };
    if (systemPrompts.length > 0) input.system = systemPrompts;
    if (params.temperature != null) input.inferenceConfig.temperature = params.temperature;
    if (params.top_p != null) input.inferenceConfig.topP = params.top_p;
    input.inferenceConfig.maxTokens = params.max_tokens ?? 8192;

    if (THINKING_MODELS.has(modelId)) {
        input.additionalModelRequestFields = {
            thinking: { type: 'enabled', budget_tokens: 8000 },
        };
        delete input.inferenceConfig.temperature;
    }

    let response;
    try {
        const client = getBedrockClient(region);
        response = await client.send(new ConverseStreamCommand(input), {
            abortSignal: signal,
        });
    } catch (error) {
        yield sseError(500, bedrockErrorMessage(error, modelId, region));
        return;
    }

    try {
        for await (const event of response.stream) {
            if (signal?.aborted) break;
            if (event.contentBlockDelta) {
                const delta = event.contentBlockDelta.delta;
                if (delta?.reasoningContent?.text) {
                    yield sseEvent({ type: 'reasoning', text: delta.reasoningContent.text });
                }
                if (delta?.text) {
                    yield sseEvent({ type: 'content', text: delta.text });
                }
            }
            if (event.messageStop) {
                yield sseDone();
            }
        }
    } catch (error) {
        yield sseError(500, error.message || 'Bedrock stream interrupted.');
    }
}

async function* streamOpenRouter(messages, params, modelId, signal) {
    const openRouterApiKey = process.env.OPENROUTER_API_KEY;
    if (!openRouterApiKey) {
        yield sseError(500, 'OPENROUTER_API_KEY is not configured on the server.');
        return;
    }

    const payload = {
        model: modelId,
        messages,
        stream: true,
    };
    if (params.temperature != null) payload.temperature = params.temperature;
    if (params.top_p != null) payload.top_p = params.top_p;
    if (params.max_tokens != null) payload.max_tokens = params.max_tokens;
    if (params.frequency_penalty != null) payload.frequency_penalty = params.frequency_penalty;
    if (params.presence_penalty != null) payload.presence_penalty = params.presence_penalty;

    let res;
    try {
        res = await fetch(OPENROUTER_CHAT_URL, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${openRouterApiKey}`,
                'Content-Type': 'application/json',
                Accept: 'text/event-stream',
                'HTTP-Referer': 'https://openchat.app',
                'X-Title': 'OpenChat',
            },
            body: JSON.stringify(payload),
            signal,
        });
    } catch (err) {
        yield sseError(500, err.message || 'Connection to OpenRouter failed.');
        return;
    }

    if (!res.ok) {
        const status = res.status;
        if (status === 401) yield sseError(401, 'Invalid OpenRouter server key.');
        else if (status === 429) yield sseError(429, 'OpenRouter rate limit exceeded. Please wait and try again.');
        else yield sseError(status, `OpenRouter API error (HTTP ${status})`);
        return;
    }

    yield* parseUpstreamSSE(res, (parsed) => {
        const events = [];

        if (parsed.error?.message) {
            events.push(sseError(parsed.error?.code || 500, parsed.error.message));
            return events;
        }

        const delta = parsed.choices?.[0]?.delta || {};
        const reasoning = getReasoningText(delta);
        const content = getContentText(delta.content);
        if (reasoning) events.push(sseEvent({ type: 'reasoning', text: reasoning }));
        if (content) events.push(sseEvent({ type: 'content', text: content }));
        return events;
    });
}

// ── Generic upstream SSE line parser ────────────
// Takes a fetch Response whose body is an SSE stream, reads it line-by-line,
// and yields our normalised SSE strings via `extract(parsedJSON)`.
async function* parseUpstreamSSE(res, extract) {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed.startsWith('data: ')) continue;
                const payload = trimmed.slice(6);
                if (payload === '[DONE]') {
                    yield sseDone();
                    return;
                }
                try {
                    const parsed = JSON.parse(payload);
                    const events = extract(parsed);
                    for (const evt of events) yield evt;
                } catch {
                    // skip malformed chunks
                }
            }
        }
    } finally {
        reader.releaseLock();
    }
    yield sseDone();
}

async function readJsonSafe(res) {
    try {
        return await res.json();
    } catch {
        return null;
    }
}

// ── Helpers ─────────────────────────────────────

function getContentText(content) {
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
        return content
            .map((part) => {
                if (typeof part === 'string') return part;
                if (part?.type === 'text' && typeof part.text === 'string') return part.text;
                return '';
            })
            .join('');
    }
    return '';
}

function getReasoningText(delta) {
    if (typeof delta?.reasoning === 'string') return delta.reasoning;
    if (typeof delta?.reasoning_content === 'string') return delta.reasoning_content;
    return '';
}

function buildGooglePayload(messages, params = {}, systemPrompt) {
    const contents = [];
    for (const msg of messages) {
        if (msg.role === 'system') continue;
        const role = msg.role === 'assistant' ? 'model' : 'user';
        const parts = [];
        if (typeof msg.content === 'string') {
            if (msg.content) parts.push({ text: msg.content });
        } else if (Array.isArray(msg.content)) {
            for (const part of msg.content) {
                if (typeof part === 'string') { if (part) parts.push({ text: part }); }
                else if (part?.type === 'text' && typeof part.text === 'string') parts.push({ text: part.text });
                else if (part?.type === 'image_url' && part.image_url?.url) {
                    const match = String(part.image_url.url).match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
                    if (match) parts.push({ inline_data: { mime_type: match[1], data: match[2] } });
                }
            }
        }
        if (parts.length > 0) contents.push({ role, parts });
    }

    const generationConfig = {};
    if (params.temperature != null) generationConfig.temperature = params.temperature;
    if (params.top_p != null) generationConfig.topP = params.top_p;
    if (params.max_tokens != null) generationConfig.maxOutputTokens = params.max_tokens;

    const payload = { contents };
    if (Object.keys(generationConfig).length > 0) payload.generationConfig = generationConfig;
    if (systemPrompt) payload.systemInstruction = { parts: [{ text: systemPrompt }] };
    return payload;
}

function bedrockErrorMessage(error, modelId, region) {
    const r = region || process.env.BEDROCK_AWS_REGION || 'us-east-1';
    switch (error.name) {
        case 'AccessDeniedException':
            if (error.message?.includes('INVALID_PAYMENT_INSTRUMENT'))
                return 'AWS Marketplace access for this model is blocked by an invalid payment instrument.';
            return `Model "${modelId}" is not enabled in your AWS Bedrock console.`;
        case 'ResourceNotFoundException':
            return `Model "${modelId}" was not found.`;
        case 'ThrottlingException':
            return 'AWS Bedrock rate limit exceeded. Please wait a moment and try again.';
        case 'ValidationException':
            if (error.message?.includes('on-demand throughput'))
                return 'This model must be invoked through an inference profile.';
            if (error.message?.includes('provided model identifier is invalid'))
                return `Model "${modelId}" is not a valid Bedrock model ID in region ${r}.`;
            return error.message || 'Invalid model ID or parameters.';
        case 'ModelTimeoutException':
            return 'Model took too long to respond.';
        case 'UnrecognizedClientException':
            return 'AWS credentials are invalid.';
        case 'ExpiredTokenException':
            return 'AWS credentials have expired.';
        case 'CredentialsProviderError':
            return 'AWS credentials could not be resolved.';
        default:
            return error.message || 'Unknown Bedrock error.';
    }
}

// ═══════════════════════════════════════════════
// Netlify handler (Functions v2 format)
// ═══════════════════════════════════════════════

export default async (req) => {
    // Only accept POST.
    if (req.method !== 'POST') {
        return new Response(JSON.stringify({ error: { message: 'Method not allowed' } }), {
            status: 405,
            headers: { 'Content-Type': 'application/json' },
        });
    }

    let body;
    try {
        body = await req.json();
    } catch {
        return new Response(JSON.stringify({ error: { message: 'Invalid JSON body' } }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
        });
    }

    const {
        messages: rawMessages,
        apiKey: clientKey,
        provider = 'nvidia',
        modelId = NVIDIA_MODEL_ID,
        temperature,
        top_p,
        max_tokens,
        frequency_penalty,
        presence_penalty,
        system_prompt,
        region,
    } = body;

    if (!rawMessages || !Array.isArray(rawMessages) || rawMessages.length === 0) {
        return new Response(
            JSON.stringify({ error: { code: 'BAD_REQUEST', message: 'Messages array is required.' } }),
            { status: 400, headers: { 'Content-Type': 'application/json' } },
        );
    }

    const validProviders = ['nvidia', 'bedrock', 'openrouter', 'google', 'cerebras'];
    if (!validProviders.includes(provider)) {
        return new Response(
            JSON.stringify({ error: { code: 'BAD_REQUEST', message: `Invalid provider: "${provider}".` } }),
            { status: 400, headers: { 'Content-Type': 'application/json' } },
        );
    }

    // Inject system prompt.
    const messages = [...rawMessages];
    if (system_prompt && typeof system_prompt === 'string' && system_prompt.trim()) {
        messages.unshift({ role: 'system', content: system_prompt.trim() });
    }

    // Collect explicit params.
    const params = {};
    if (temperature != null) params.temperature = Number(temperature);
    if (top_p != null) params.top_p = Number(top_p);
    if (max_tokens != null) params.max_tokens = Number(max_tokens);
    if (frequency_penalty != null) params.frequency_penalty = Number(frequency_penalty);
    if (presence_penalty != null) params.presence_penalty = Number(presence_penalty);

    const abortController = new AbortController();

    // Build a ReadableStream that yields SSE events as they arrive from upstream.
    const stream = new ReadableStream({
        async start(controller) {
            const encoder = new TextEncoder();

            function enqueue(str) {
                try { controller.enqueue(encoder.encode(str)); } catch { /* stream closed */ }
            }

            try {
                let gen;
                switch (provider) {
                    case 'nvidia':
                        gen = streamNvidia(messages, params, clientKey, abortController.signal);
                        break;
                    case 'google':
                        gen = streamGoogle(messages, params, system_prompt, modelId, abortController.signal);
                        break;
                    case 'cerebras':
                        gen = streamCerebras(messages, params, modelId, clientKey, abortController.signal);
                        break;
                    case 'bedrock':
                        gen = streamBedrock(messages, params, modelId, region, abortController.signal);
                        break;
                    case 'openrouter':
                        gen = streamOpenRouter(messages, params, modelId, abortController.signal);
                        break;
                }

                for await (const chunk of gen) {
                    enqueue(chunk);
                }
            } catch (err) {
                enqueue(sseError(500, err.message || 'Internal error'));
                enqueue(sseDone());
            } finally {
                try { controller.close(); } catch { /* already closed */ }
            }
        },
        cancel() {
            abortController.abort();
        },
    });

    return new Response(stream, {
        status: 200,
        headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
            'X-Accel-Buffering': 'no',
        },
    });
};

