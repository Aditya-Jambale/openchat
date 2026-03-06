import { streamBedrock, streamGoogle, streamNvidia, streamOpenRouter } from '../../server.js';

export default async (req, context) => {
    if (req.method !== 'POST') {
        return new Response('Method Not Allowed', { status: 405 });
    }

    let body;
    try {
        body = await req.json();
    } catch (e) {
        return new Response(JSON.stringify({ error: { code: 'BAD_REQUEST', message: 'Invalid JSON' } }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
        });
    }

    const {
        messages: rawMessages,
        apiKey: clientKey,
        provider = 'nvidia',
        modelId = 'moonshotai/kimi-k2.5',
        temperature,
        top_p,
        max_tokens,
        frequency_penalty,
        presence_penalty,
        system_prompt,
        region,
    } = body;

    if (!rawMessages || !Array.isArray(rawMessages) || rawMessages.length === 0) {
        return new Response(JSON.stringify({ error: { code: 'BAD_REQUEST', message: 'Messages array is required.' } }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
        });
    }

    if (provider !== 'nvidia' && provider !== 'bedrock' && provider !== 'openrouter' && provider !== 'google') {
        return new Response(JSON.stringify({
            error: {
                code: 'BAD_REQUEST',
                message: `Invalid provider: "${provider}". Use "nvidia", "bedrock", "google", or "openrouter".`,
            },
        }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    if (provider === 'nvidia') {
        const apiKey = process.env.NVIDIA_API_KEY || clientKey;
        if (!apiKey || !apiKey.startsWith('nvapi-')) {
            return new Response(JSON.stringify({
                error: {
                    code: 'INVALID_KEY',
                    message: 'Invalid API key. Key must start with "nvapi-".',
                },
            }), { status: 401, headers: { 'Content-Type': 'application/json' } });
        }
    }

    const messages = [...rawMessages];
    if (system_prompt && typeof system_prompt === 'string' && system_prompt.trim()) {
        messages.unshift({ role: 'system', content: system_prompt.trim() });
    }

    const params = {};
    if (temperature != null) params.temperature = Number(temperature);
    if (top_p != null) params.top_p = Number(top_p);
    if (max_tokens != null) params.max_tokens = Number(max_tokens);
    if (frequency_penalty != null) params.frequency_penalty = Number(frequency_penalty);
    if (presence_penalty != null) params.presence_penalty = Number(presence_penalty);

    const encoder = new TextEncoder();

    // Create a ReadableStream
    const stream = new ReadableStream({
        async start(controller) {
            const onChunk = (data) => {
                controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
            };
            const onEnd = () => {
                controller.enqueue(encoder.encode('data: [DONE]\n\n'));
                controller.close();
            };
            const onError = (data) => {
                controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
                controller.close();
            };

            const abortSignal = req.signal;

            try {
                if (provider === 'bedrock') {
                    await streamBedrock({ messages, modelId, params, region, onChunk, onEnd, onError, abortSignal });
                } else if (provider === 'google') {
                    await streamGoogle({ messages, modelId, params, systemPrompt: system_prompt, onChunk, onEnd, onError, abortSignal });
                } else if (provider === 'openrouter') {
                    await streamOpenRouter({ messages, modelId, params, onChunk, onEnd, onError, abortSignal });
                } else {
                    await streamNvidia({ messages, clientKey, params, onChunk, onEnd, onError, abortSignal });
                }
            } catch (e) {
                if (e.name === 'AbortError' || abortSignal?.aborted) {
                    controller.close();
                    return;
                }
                onError({ type: 'error', code: 500, text: e.message || 'Stream failed.' });
            }
        }
    });

    return new Response(stream, {
        headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'X-Accel-Buffering': 'no',
        },
    });
};

export const config = {
    path: '/api/chat'
};
