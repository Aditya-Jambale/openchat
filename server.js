import express from 'express';
import cors from 'cors';
import axios from 'axios';
import https from 'https';
import dotenv from 'dotenv';
import {
    BedrockRuntimeClient,
    ConverseStreamCommand,
} from '@aws-sdk/client-bedrock-runtime';

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT) || 3001;

app.use(cors());
app.use(express.json({ limit: '50mb' }));

const NVIDIA_URL = 'https://integrate.api.nvidia.com/v1/chat/completions';
const NVIDIA_MODEL_ID = 'moonshotai/kimi-k2.5';
const GOOGLE_MODELS_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
const GOOGLE_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const GOOGLE_PROMPT_SUGGESTION_MODEL = 'gemini-2.5-flash-lite';
const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models';
const OPENROUTER_CHAT_URL = 'https://openrouter.ai/api/v1/chat/completions';

// Reusable HTTPS agent — eliminates TCP+TLS handshake overhead on repeat requests.
const keepAliveAgent = new https.Agent({
    keepAlive: true,
    maxSockets: 10,
    keepAliveMsecs: 30000,
});

// ── Bedrock Client ──
// Created lazily per region so we support the region selector.
const bedrockClients = {};

class AwsCredentialConfigError extends Error {
    constructor(message) {
        super(message);
        this.name = 'AwsCredentialConfigError';
    }
}

function getAwsCredentialConfig() {
    const accessKeyId = process.env.BEDROCK_AWS_ACCESS_KEY_ID?.trim();
    const secretAccessKey = process.env.BEDROCK_AWS_SECRET_ACCESS_KEY?.trim();
    const sessionToken = process.env.BEDROCK_AWS_SESSION_TOKEN?.trim();

    if (!accessKeyId && !secretAccessKey && !sessionToken) {
        return { credentials: null, source: 'default-provider', hasSessionToken: false };
    }

    if (!accessKeyId || !secretAccessKey) {
        throw new AwsCredentialConfigError(
            'Incomplete AWS credentials in .env. Set both BEDROCK_AWS_ACCESS_KEY_ID and BEDROCK_AWS_SECRET_ACCESS_KEY, or remove both to use the default AWS credential chain.',
        );
    }

    if (accessKeyId === secretAccessKey) {
        throw new AwsCredentialConfigError(
            'Invalid AWS credentials in .env. BEDROCK_AWS_SECRET_ACCESS_KEY is currently set to the access key ID. Replace it with the real secret access key.',
        );
    }

    if (accessKeyId.startsWith('ASIA') && !sessionToken) {
        throw new AwsCredentialConfigError(
            'Temporary AWS credentials require BEDROCK_AWS_SESSION_TOKEN. Add BEDROCK_AWS_SESSION_TOKEN to .env or use long-lived IAM user credentials.',
        );
    }

    const credentials = { accessKeyId, secretAccessKey };
    if (sessionToken) {
        credentials.sessionToken = sessionToken;
    }

    return {
        credentials,
        source: 'env',
        hasSessionToken: Boolean(sessionToken),
    };
}

function getAwsSigningErrorMessage() {
    const accessKeyId = process.env.BEDROCK_AWS_ACCESS_KEY_ID?.trim();
    const secretAccessKey = process.env.BEDROCK_AWS_SECRET_ACCESS_KEY?.trim();
    const sessionToken = process.env.BEDROCK_AWS_SESSION_TOKEN?.trim();

    if (accessKeyId && secretAccessKey && accessKeyId === secretAccessKey) {
        return 'AWS signature mismatch: BEDROCK_AWS_SECRET_ACCESS_KEY in .env is set to the access key ID. Replace it with the real secret access key.';
    }

    if (accessKeyId?.startsWith('ASIA') && !sessionToken) {
        return 'AWS signature mismatch: temporary AWS credentials require BEDROCK_AWS_SESSION_TOKEN.';
    }

    return 'AWS request signing failed. Check BEDROCK_AWS_SECRET_ACCESS_KEY and BEDROCK_AWS_SESSION_TOKEN in .env.';
}
function getBedrockClient(region) {
    const r = region || process.env.BEDROCK_AWS_REGION || 'us-east-1';
    if (!bedrockClients[r]) {
        const { credentials } = getAwsCredentialConfig();
        const clientConfig = { region: r };
        if (credentials) {
            clientConfig.credentials = credentials;
        }
        bedrockClients[r] = new BedrockRuntimeClient(clientConfig);
    }
    return bedrockClients[r];
}

// ── AWS Startup Validation ──
function validateAwsCredentials() {
    const hasAccessKey = !!process.env.BEDROCK_AWS_ACCESS_KEY_ID;
    const hasSecretKey = !!process.env.BEDROCK_AWS_SECRET_ACCESS_KEY;
    const region = process.env.BEDROCK_AWS_REGION || 'us-east-1';

    if (hasAccessKey && hasSecretKey) {
        console.log('✅ AWS Credentials loaded. Bedrock API is ready.');
        console.log(`   Region: ${region}`);
        // Test client initialization
        try {
            const client = getBedrockClient(region);
            console.log('✅ BedrockRuntimeClient initialized successfully');
        } catch (err) {
            console.error('❌ Failed to initialize BedrockRuntimeClient:', err.message);
        }
    } else {
        console.warn('⚠️ WARNING: Missing AWS credentials in .env');
        if (!hasAccessKey) console.warn('   - BEDROCK_AWS_ACCESS_KEY_ID is missing');
        if (!hasSecretKey) console.warn('   - BEDROCK_AWS_SECRET_ACCESS_KEY is missing');
    }
}

function validateAwsCredentialConfig() {
    const region = process.env.BEDROCK_AWS_REGION || 'us-east-1';

    try {
        const { source, hasSessionToken } = getAwsCredentialConfig();

        if (source === 'env') {
            console.log('AWS credentials loaded. Bedrock API is ready.');
            console.log(`   Region: ${region}`);
            if (hasSessionToken) {
                console.log('   Using temporary session credentials');
            }
        } else {
            console.log('No AWS credentials in .env. Bedrock will use the default AWS credential chain.');
            console.log(`   Region: ${region}`);
        }

        getBedrockClient(region);
        console.log('BedrockRuntimeClient initialized successfully');
    } catch (err) {
        console.error('AWS credential configuration error:', err.message);
    }
}

validateAwsCredentialConfig();

// ── Models that support extended thinking ──
const THINKING_MODELS = new Set([
    'us.anthropic.claude-3-7-sonnet-20250219-v1:0',
]);

// ═══════════════════════════════════════════════
// OpenRouter Free Models Endpoint
// ═══════════════════════════════════════════════

app.get('/api/models/free', async (_req, res) => {
    const openRouterApiKey = process.env.OPENROUTER_API_KEY;

    if (!openRouterApiKey) {
        return res.status(500).json({
            error: {
                code: 'MISSING_OPENROUTER_KEY',
                message: 'OPENROUTER_API_KEY is not configured on the server.',
            },
        });
    }

    try {
        const response = await axios.get(OPENROUTER_MODELS_URL, {
            headers: {
                Authorization: `Bearer ${openRouterApiKey}`,
            },
            timeout: 15000,
        });

        const models = Array.isArray(response.data?.data) ? response.data.data : [];
        const freeModels = models
            .filter(isFreeModel)
            .map((model) => ({
                id: model.id,
                name: (model.name || model.id).replace(/\s*\(free\)\s*/gi, '').trim(),
                description: model.description || null,
                supportsVision: supportsVisionInput(model),
                provider: 'openrouter',
                context_length: model.context_length || null,
            }))
            .sort((a, b) => a.name.localeCompare(b.name));

        return res.json({ models: freeModels });
    } catch (error) {
        const status = error.response?.status || 500;
        const message =
            error.response?.data?.error?.message ||
            error.response?.data?.message ||
            error.message ||
            'Failed to fetch OpenRouter models.';

        return res.status(status).json({
            error: {
                code: 'OPENROUTER_MODELS_FETCH_FAILED',
                message,
            },
        });
    }
});

app.get('/api/models/google', async (_req, res) => {
    const googleApiKey = process.env.GOOGLE_API_KEY;

    if (!googleApiKey) {
        return res.status(500).json({
            error: {
                code: 'MISSING_GOOGLE_KEY',
                message: 'GOOGLE_API_KEY is not configured on the server.',
            },
        });
    }

    try {
        const response = await axios.get(`${GOOGLE_MODELS_URL}?key=${googleApiKey}`, {
            timeout: 15000,
        });

        const models = Array.isArray(response.data?.models) ? response.data.models : [];
        const googleModels = models
            .filter(isSupportedGoogleModel)
            .map((model) => ({
                id: stripGoogleModelPrefix(model.name),
                name: model.displayName || stripGoogleModelPrefix(model.name),
                description: model.description || null,
                supportsVision: supportsGoogleVision(model),
                provider: 'google',
                context_length: model.inputTokenLimit || null,
                group: getGoogleModelGroup(model),
            }))
            .sort((a, b) => a.name.localeCompare(b.name));

        return res.json({ models: googleModels });
    } catch (error) {
        const status = error.response?.status || 500;
        const message =
            error.response?.data?.error?.message ||
            error.response?.data?.message ||
            error.message ||
            'Failed to fetch Google models.';

        return res.status(status).json({
            error: {
                code: 'GOOGLE_MODELS_FETCH_FAILED',
                message,
            },
        });
    }
});

app.get('/api/prompt-suggestions', async (req, res) => {
    const googleApiKey = process.env.GOOGLE_API_KEY;
    const nonce = String(req.query?.nonce || '').trim();

    res.set({
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
        Pragma: 'no-cache',
        Expires: '0',
        'Surrogate-Control': 'no-store',
    });

    if (!googleApiKey) {
        return res.json({ suggestions: getFallbackPromptSuggestions() });
    }

    try {
        const suggestions = await generatePromptSuggestions(googleApiKey, nonce);

        return res.json({
            suggestions: suggestions.length === 3 ? suggestions : getFallbackPromptSuggestions(),
        });
    } catch (error) {
        console.error('Prompt suggestion generation failed:', error.response?.data || error.message);
        return res.json({ suggestions: getFallbackPromptSuggestions() });
    }
});

// ═══════════════════════════════════════════════
// Main Chat Endpoint — Routes to NVIDIA, Bedrock, or OpenRouter
// ═══════════════════════════════════════════════

app.post('/api/chat', async (req, res) => {
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
    } = req.body;

    console.log('[DEBUG] /api/chat called with provider:', provider, 'modelId:', modelId);
    console.log('[DEBUG] Request body provider type:', typeof provider, 'value:', JSON.stringify(provider));

    if (!rawMessages || !Array.isArray(rawMessages) || rawMessages.length === 0) {
        return res.status(400).json({
            error: { code: 'BAD_REQUEST', message: 'Messages array is required.' },
        });
    }

    if (provider !== 'nvidia' && provider !== 'bedrock' && provider !== 'openrouter' && provider !== 'google') {
        console.error(`[ERROR] Invalid provider received: "${provider}" (type: ${typeof provider})`);
        return res.status(400).json({
            error: {
                code: 'BAD_REQUEST',
                message: `Invalid provider: "${provider}". Use "nvidia", "bedrock", "google", or "openrouter".`,
            },
        });
    }

    console.log('[DEBUG] Provider validated successfully:', provider);

    if (provider === 'nvidia') {
        const apiKey = process.env.NVIDIA_API_KEY || clientKey;
        if (!apiKey || !apiKey.startsWith('nvapi-')) {
            return res.status(401).json({
                error: {
                    code: 'INVALID_KEY',
                    message: 'Invalid API key. Key must start with "nvapi-".',
                },
            });
        }
    }

    // Inject system prompt as the first message if provided.
    const messages = [...rawMessages];
    if (system_prompt && typeof system_prompt === 'string' && system_prompt.trim()) {
        messages.unshift({ role: 'system', content: system_prompt.trim() });
    }

    // Collect model parameters (only include if explicitly provided).
    const params = {};
    if (temperature != null) params.temperature = Number(temperature);
    if (top_p != null) params.top_p = Number(top_p);
    if (max_tokens != null) params.max_tokens = Number(max_tokens);
    if (frequency_penalty != null) params.frequency_penalty = Number(frequency_penalty);
    if (presence_penalty != null) params.presence_penalty = Number(presence_penalty);

    // SSE headers — flush immediately so client gets them before first token.
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    if (provider === 'bedrock') {
        return streamBedrock({ req, res, messages, modelId, params, region });
    }

    if (provider === 'google') {
        return streamGoogle({ req, res, messages, modelId, params, systemPrompt: system_prompt });
    }

    if (provider === 'openrouter') {
        return streamOpenRouter({ req, res, messages, modelId, params });
    }

    return streamNvidia({ req, res, messages, clientKey, params });
});

// ═══════════════════════════════════════════════
// NVIDIA Stream — Kimi K2.5 only
// ═══════════════════════════════════════════════

async function streamNvidia({ req, res, messages, clientKey, params = {} }) {
    const apiKey = process.env.NVIDIA_API_KEY || clientKey;

    // NVIDIA Kimi K2.5 defaults (from official docs: thinking mode).
    // Strip frequency_penalty and presence_penalty — NVIDIA NIM may 400 on unsupported params.
    const payload = {
        model: NVIDIA_MODEL_ID,
        messages,
        max_tokens: params.max_tokens ?? 16384,
        temperature: params.temperature ?? 1.0,
        top_p: params.top_p ?? 0.95,
        stream: true,
        chat_template_kwargs: { thinking: true },
    };

    try {
        const response = await axios.post(NVIDIA_URL, payload, {
            headers: {
                Authorization: `Bearer ${apiKey}`,
                Accept: 'text/event-stream',
            },
            responseType: 'stream',
            httpsAgent: keepAliveAgent,
            maxContentLength: Infinity,
            maxBodyLength: Infinity,
        });

        // Handle client disconnect.
        req.on('close', () => {
            response.data.destroy();
        });

        response.data.on('data', (chunk) => {
            const lines = chunk.toString().split('\n');
            for (const line of lines) {
                if (line.startsWith('data: ') && line !== 'data: [DONE]') {
                    try {
                        const parsed = JSON.parse(line.slice(6));
                        const reasoning = parsed.choices?.[0]?.delta?.reasoning;
                        const content = parsed.choices?.[0]?.delta?.content;

                        // Handle both reasoning and content arriving in the same chunk.
                        if (reasoning) {
                            res.write(`data: ${JSON.stringify({ type: 'reasoning', text: reasoning })}\n\n`);
                        }
                        if (content) {
                            res.write(`data: ${JSON.stringify({ type: 'content', text: content })}\n\n`);
                        }
                    } catch {
                        // Skip malformed JSON chunks.
                    }
                } else if (line.trim() === 'data: [DONE]') {
                    res.write('data: [DONE]\n\n');
                }
            }
        });

        response.data.on('end', () => {
            res.write('data: [DONE]\n\n');
            res.end();
        });

        response.data.on('error', (err) => {
            console.error('Stream error:', err.message);
            res.write(`data: ${JSON.stringify({ type: 'error', text: 'Stream interrupted.' })}\n\n`);
            res.end();
        });
    } catch (error) {
        const status = error.response?.status;
        if (status === 401) {
            res.write(
                `data: ${JSON.stringify({ type: 'error', code: 401, text: 'Invalid API key. Check your key at build.nvidia.com.' })}\n\n`,
            );
        } else if (status === 429) {
            res.write(
                `data: ${JSON.stringify({ type: 'error', code: 429, text: 'Rate limit exceeded. Please wait a moment and try again.' })}\n\n`,
            );
        } else {
            const msg = error.response?.data?.message || error.message || 'Unknown error';
            res.write(`data: ${JSON.stringify({ type: 'error', code: status || 500, text: msg })}\n\n`);
        }
        res.end();
    }
}

async function streamGoogle({ req, res, messages, modelId, params = {}, systemPrompt }) {
    const googleApiKey = process.env.GOOGLE_API_KEY;

    if (!googleApiKey) {
        res.write(
            `data: ${JSON.stringify({
                type: 'error',
                code: 500,
                text: 'GOOGLE_API_KEY is not configured on the server.',
            })}\n\n`,
        );
        res.end();
        return;
    }

    try {
        const payload = buildGoogleGenerateContentPayload(messages, params, systemPrompt);
        const response = await axios.post(
            `${GOOGLE_API_BASE}/models/${modelId}:streamGenerateContent?alt=sse&key=${googleApiKey}`,
            payload,
            {
                headers: {
                    'Content-Type': 'application/json',
                    Accept: 'text/event-stream',
                },
                responseType: 'stream',
                httpsAgent: keepAliveAgent,
                maxContentLength: Infinity,
                maxBodyLength: Infinity,
                timeout: 60000,
            },
        );

        req.on('close', () => {
            response.data.destroy();
        });

        response.data.on('data', (chunk) => {
            const lines = chunk.toString().split('\n');

            for (const line of lines) {
                if (!line.startsWith('data: ')) continue;

                try {
                    const parsed = JSON.parse(line.slice(6));
                    const parts = parsed.candidates?.[0]?.content?.parts || [];

                    for (const part of parts) {
                        if (typeof part?.text === 'string' && part.text) {
                            res.write(`data: ${JSON.stringify({ type: 'content', text: part.text })}\n\n`);
                        }
                    }
                } catch {
                    // Skip malformed SSE chunks.
                }
            }
        });

        response.data.on('end', () => {
            res.write('data: [DONE]\n\n');
            res.end();
        });

        response.data.on('error', (err) => {
            console.error('Google stream error:', err.message);
            res.write(`data: ${JSON.stringify({ type: 'error', text: 'Stream interrupted.' })}\n\n`);
            res.end();
        });
    } catch (error) {
        const status = error.response?.status || 500;
        const message =
            error.response?.data?.error?.message ||
            error.response?.data?.message ||
            error.message ||
            'Unknown Google API error';

        if (status === 401 || status === 403) {
            res.write(
                `data: ${JSON.stringify({
                    type: 'error',
                    code: status,
                    text: 'Google API key is invalid or lacks access to the requested model.',
                })}\n\n`,
            );
        } else if (status === 429) {
            res.write(
                `data: ${JSON.stringify({
                    type: 'error',
                    code: 429,
                    text: 'Google API rate limit exceeded. Please wait and try again.',
                })}\n\n`,
            );
        } else {
            res.write(
                `data: ${JSON.stringify({
                    type: 'error',
                    code: status,
                    text: message,
                })}\n\n`,
            );
        }
        res.end();
    }
}

// ═══════════════════════════════════════════════
// Bedrock Stream — All models via ConverseStreamCommand
// ═══════════════════════════════════════════════

async function streamBedrock({ req, res, messages, modelId, params = {}, region }) {
    // Convert OpenAI-style messages to Bedrock Converse format.
    let systemPrompts = [];
    const converseMessages = [];

    for (const msg of messages) {
        if (msg.role === 'system') {
            // Bedrock takes system prompts separately.
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
                if (typeof part === 'string') {
                    content.push({ text: part });
                } else if (part?.type === 'text') {
                    content.push({ text: part.text });
                } else if (part?.type === 'image_url' && part.image_url?.url) {
                    // Convert base64 data URL to Bedrock image format.
                    const dataUrl = part.image_url.url;
                    const match = dataUrl.match(/^data:image\/(\w+);base64,(.+)$/);
                    if (match) {
                        content.push({
                            image: {
                                format: match[1] === 'jpg' ? 'jpeg' : match[1],
                                source: { bytes: Buffer.from(match[2], 'base64') },
                            },
                        });
                    }
                }
            }
        }

        if (content.length > 0) {
            converseMessages.push({ role, content });
        }
    }

    // Build the ConverseStream input.
    const input = {
        modelId,
        messages: converseMessages,
        inferenceConfig: {},
    };

    if (systemPrompts.length > 0) {
        input.system = systemPrompts;
    }

    // Apply inference parameters.
    if (params.temperature != null) input.inferenceConfig.temperature = params.temperature;
    if (params.top_p != null) input.inferenceConfig.topP = params.top_p;
    if (params.max_tokens != null) {
        input.inferenceConfig.maxTokens = params.max_tokens;
    } else {
        input.inferenceConfig.maxTokens = 8192; // reasonable default
    }

    // Enable extended thinking for supported Claude models.
    if (THINKING_MODELS.has(modelId)) {
        input.additionalModelRequestFields = {
            thinking: { type: 'enabled', budget_tokens: 8000 },
        };
        // When thinking is enabled, temperature must not be set (or set to 1).
        delete input.inferenceConfig.temperature;
    }

    try {
        const client = getBedrockClient(region);
        const command = new ConverseStreamCommand(input);
        const response = await client.send(command);

        // Handle client disconnect.
        let aborted = false;
        req.on('close', () => {
            aborted = true;
        });

        const stream = response.stream;

        for await (const event of stream) {
            if (aborted) break;

            if (event.contentBlockDelta) {
                const delta = event.contentBlockDelta.delta;

                // Reasoning/thinking content (Claude extended thinking).
                if (delta?.reasoningContent?.text) {
                    res.write(`data: ${JSON.stringify({ type: 'reasoning', text: delta.reasoningContent.text })}\n\n`);
                }
                // Regular text content.
                if (delta?.text) {
                    res.write(`data: ${JSON.stringify({ type: 'content', text: delta.text })}\n\n`);
                }
            }

            if (event.messageStop) {
                res.write('data: [DONE]\n\n');
            }

            if (event.metadata) {
                // Stream complete — metadata event comes last.
            }
        }

        res.end();
    } catch (error) {
        console.error('[bedrock] Error:', error.name, error.message);

        // Handle specific Bedrock errors with helpful messages.
        let errorMsg;
        let code = 500;

        if (error.name === 'AccessDeniedException') {
            code = 403;
            if (error.message?.includes('INVALID_PAYMENT_INSTRUMENT')) {
                errorMsg =
                    'AWS Marketplace access for this model is blocked by an invalid payment instrument on your AWS account. Update billing details, then retry model access.';
            } else {
                errorMsg = `Model "${modelId}" is not enabled in your AWS Bedrock console. Go to AWS Console → Bedrock → Model Access to request access.`;
            }
        } else if (error.name === 'ResourceNotFoundException') {
            code = 404;
            errorMsg = `Model "${modelId}" was not found. Ensure the model ID is correct and includes the "us." prefix for cross-region inference.`;
        } else if (error.name === 'ThrottlingException') {
            code = 429;
            errorMsg = 'AWS Bedrock rate limit exceeded. Please wait a moment and try again.';
        } else if (error.name === 'ValidationException') {
            code = 400;
            if (error.message?.includes('on-demand throughput')) {
                errorMsg =
                    'This model must be invoked through an inference profile. Use the "us." prefixed Bedrock profile ID for cross-region models, or switch to a supported AWS region for regional-only models.';
            } else if (error.message?.includes('provided model identifier is invalid')) {
                errorMsg = `Model "${modelId}" is not a valid Bedrock model ID in region ${region || process.env.BEDROCK_AWS_REGION || 'us-east-1'}.`;
            } else {
                errorMsg = error.message || 'Invalid model ID or parameters.';
            }
        } else if (error.name === 'ModelTimeoutException') {
            code = 504;
            errorMsg = 'Model took too long to respond. Try a smaller prompt or a faster model.';
        } else if (error.name === 'UnrecognizedClientException') {
            code = 401;
            errorMsg = 'AWS credentials are invalid. Check your BEDROCK_AWS_ACCESS_KEY_ID and BEDROCK_AWS_SECRET_ACCESS_KEY.';
        } else if (error.name === 'ExpiredTokenException') {
            code = 401;
            errorMsg = 'AWS credentials have expired. Please refresh your credentials.';
        } else if (error.name === 'CredentialsProviderError') {
            code = 401;
            errorMsg = 'AWS credentials could not be resolved. Set BEDROCK_AWS_ACCESS_KEY_ID/BEDROCK_AWS_SECRET_ACCESS_KEY in .env or configure the default AWS credential chain.';
        } else if (error.name === 'AwsCredentialConfigError') {
            code = 500;
            errorMsg = error.message;
        } else if (error.name === 'InvalidSignatureException' || error.name === 'IncompleteSignatureException') {
            code = 401;
            errorMsg = getAwsSigningErrorMessage();
        } else {
            errorMsg = error.message || 'Unknown Bedrock error.';
        }

        res.write(`data: ${JSON.stringify({ type: 'error', code, text: errorMsg })}\n\n`);
        res.end();
    }
}

// ═══════════════════════════════════════════════
// OpenRouter Stream — Free models
// ═══════════════════════════════════════════════

async function streamOpenRouter({ req, res, messages, modelId, params = {} }) {
    const openRouterApiKey = process.env.OPENROUTER_API_KEY;

    if (!openRouterApiKey) {
        res.write(
            `data: ${JSON.stringify({
                type: 'error',
                code: 500,
                text: 'OPENROUTER_API_KEY is not configured on the server.',
            })}\n\n`,
        );
        res.end();
        return;
    }

    try {
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

        const response = await axios.post(OPENROUTER_CHAT_URL, payload, {
            headers: {
                Authorization: `Bearer ${openRouterApiKey}`,
                Accept: 'text/event-stream',
                'HTTP-Referer': 'http://localhost:5173',
                'X-Title': 'OpenChat',
            },
            responseType: 'stream',
            httpsAgent: keepAliveAgent,
            maxContentLength: Infinity,
            maxBodyLength: Infinity,
        });

        req.on('close', () => {
            response.data.destroy();
        });

        response.data.on('data', (chunk) => {
            const lines = chunk.toString().split('\n');
            for (const line of lines) {
                if (line.startsWith('data: ') && line !== 'data: [DONE]') {
                    try {
                        const parsed = JSON.parse(line.slice(6));

                        if (parsed.error?.message) {
                            res.write(
                                `data: ${JSON.stringify({
                                    type: 'error',
                                    code: parsed.error?.code || 500,
                                    text: parsed.error.message,
                                })}\n\n`,
                            );
                            continue;
                        }

                        const delta = parsed.choices?.[0]?.delta || {};
                        const reasoning = getReasoningText(delta);
                        const content = getContentText(delta.content);

                        if (reasoning) {
                            res.write(`data: ${JSON.stringify({ type: 'reasoning', text: reasoning })}\n\n`);
                        }
                        if (content) {
                            res.write(`data: ${JSON.stringify({ type: 'content', text: content })}\n\n`);
                        }
                    } catch {
                        // Skip malformed JSON chunks.
                    }
                } else if (line.trim() === 'data: [DONE]') {
                    res.write('data: [DONE]\n\n');
                }
            }
        });

        response.data.on('end', () => {
            res.write('data: [DONE]\n\n');
            res.end();
        });

        response.data.on('error', (err) => {
            console.error('OpenRouter stream error:', err.message);
            res.write(`data: ${JSON.stringify({ type: 'error', text: 'Stream interrupted.' })}\n\n`);
            res.end();
        });
    } catch (error) {
        const status = error.response?.status;
        const message =
            error.response?.data?.error?.message ||
            error.response?.data?.message ||
            error.message ||
            'Unknown error';

        if (status === 401) {
            res.write(
                `data: ${JSON.stringify({ type: 'error', code: 401, text: 'Invalid OpenRouter server key.' })}\n\n`,
            );
        } else if (status === 429) {
            res.write(
                `data: ${JSON.stringify({
                    type: 'error',
                    code: 429,
                    text: 'OpenRouter rate limit exceeded. Please wait and try again.',
                })}\n\n`,
            );
        } else {
            res.write(
                `data: ${JSON.stringify({
                    type: 'error',
                    code: status || 500,
                    text: message,
                })}\n\n`,
            );
        }
        res.end();
    }
}

// ── Helper Functions ──

function isFreeModel(model) {
    const pricing = model?.pricing;
    if (!pricing || typeof pricing !== 'object') return false;
    const values = Object.values(pricing);
    if (values.length === 0) return false;
    return values.every((value) => {
        const parsed = Number(value);
        return Number.isFinite(parsed) && parsed === 0;
    });
}

function supportsVisionInput(model) {
    const inputModalities = model?.architecture?.input_modalities;
    if (Array.isArray(inputModalities)) {
        return inputModalities.some((modality) => String(modality).toLowerCase() === 'image');
    }
    const modality = model?.architecture?.modality;
    return typeof modality === 'string' && modality.toLowerCase().includes('image');
}

function getFallbackPromptSuggestions() {
    const sets = [
        [
            'Explain a difficult topic using a real-world analogy',
            'Design a clean study plan for the next 7 days',
            'Review this idea and point out hidden risks',
        ],
        [
            'Write a small utility script for a repetitive task',
            'Compare two tools and recommend one for my use case',
            'Brainstorm 10 startup ideas in an unusual niche',
        ],
        [
            'Turn my rough notes into a polished summary',
            'Help me debug a stubborn coding issue step by step',
            'Create a meal plan that is cheap and high protein',
        ],
    ];

    return sets[Math.floor(Math.random() * sets.length)];
}

function getPromptSuggestionLens() {
    const moods = ['playful', 'provocative', 'futuristic', 'clever', 'contrarian', 'cinematic'];
    const domains = ['science', 'productivity', 'philosophy', 'coding', 'daily life', 'creativity'];
    const framings = ['what-if scenario', 'bold comparison', 'unexpected constraint', 'reverse perspective', 'mini challenge', 'thought experiment'];

    return {
        mood: moods[Math.floor(Math.random() * moods.length)],
        domain: domains[Math.floor(Math.random() * domains.length)],
        framing: framings[Math.floor(Math.random() * framings.length)],
    };
}

async function generatePromptSuggestions(googleApiKey, nonce = '') {
    const promptVariants = [
        {
            system:
                'Return exactly 3 short curiosity prompts. Final answer only. One prompt per line. No reasoning. No commentary.',
            user: (lens) => `Create 3 mind-tingling prompt ideas for a new chat. Keep them safe, surprising, and diverse.
Mood: ${lens.mood}
Domain: ${lens.domain}
Angle: ${lens.framing}
Seed: ${nonce || Math.random().toString(36).slice(2, 10)}`,
        },
        {
            system:
                'Return exactly 3 concise prompts a curious person would type into a blank assistant. One line per prompt. No numbering, no quotes, no explanation.',
            user: (lens) => `Write 3 unusual prompt starters.
Vibe: ${lens.mood}
Topic: ${lens.domain}
Style: ${lens.framing}
Seed: ${nonce || Math.random().toString(36).slice(2, 10)}`,
        },
    ];

    for (const variant of promptVariants) {
        const creativeLens = getPromptSuggestionLens();
        const payload = buildGoogleGenerateContentPayload(
            [{ role: 'user', content: variant.user(creativeLens) }],
            {
                temperature: 1.35,
                top_p: 0.95,
                max_tokens: 160,
            },
            `${variant.system} Keep each prompt under 12 words. Make them inventive and immediately usable.`,
        );
        const response = await axios.post(
            `${GOOGLE_API_BASE}/models/${GOOGLE_PROMPT_SUGGESTION_MODEL}:generateContent?key=${googleApiKey}`,
            payload,
            {
                headers: {
                    'Content-Type': 'application/json',
                },
                timeout: 30000,
                httpsAgent: keepAliveAgent,
            },
        );

        const rawContent = (response.data?.candidates || [])
            .flatMap((candidate) => candidate?.content?.parts || [])
            .map((part) => (typeof part?.text === 'string' ? part.text : ''))
            .join('\n');
        const suggestions = parsePromptSuggestions(rawContent);
        if (isValidPromptSuggestionSet(suggestions)) {
            return suggestions;
        }
    }

    return [];
}

function parsePromptSuggestions(text) {
    return String(text || '')
        .split('\n')
        .map((line) => line.replace(/^[-*0-9.)\s]+/, '').trim())
        .filter(Boolean)
        .filter((line, index, arr) => arr.indexOf(line) === index)
        .slice(0, 3);
}

function isValidPromptSuggestionSet(suggestions) {
    if (!Array.isArray(suggestions) || suggestions.length !== 3) {
        return false;
    }

    return suggestions.every((line) => {
        const normalized = String(line).trim();
        const lowered = normalized.toLowerCase();

        if (!normalized || normalized.length > 90) return false;
        if (/(i apologize|i'm unable|i cannot|guidelines|as an ai|i'd be happy to help)/.test(lowered)) return false;

        const wordCount = normalized.split(/\s+/).length;
        return wordCount >= 4 && wordCount <= 16;
    });
}

function stripGoogleModelPrefix(name = '') {
    return String(name).replace(/^models\//, '');
}

function isSupportedGoogleModel(model) {
    const id = stripGoogleModelPrefix(model?.name || '').toLowerCase();
    const methods = model?.supportedGenerationMethods || [];

    if (!id || !Array.isArray(methods) || !methods.includes('generateContent')) {
        return false;
    }

    if (!id.startsWith('gemini-')) {
        return false;
    }

    if (!/^gemini-(2\.5|3(?:\.1)?)(-|$)/.test(id)) {
        return false;
    }

    return !/(image|tts|robotics|computer-use|deep-research|customtools)/.test(id);
}

function supportsGoogleVision(model) {
    const id = stripGoogleModelPrefix(model?.name || '').toLowerCase();
    if (/(image|tts)/.test(id)) return false;
    return id.startsWith('gemini');
}

function getGoogleModelGroup(model) {
    const id = stripGoogleModelPrefix(model?.name || '').toLowerCase();
    return '🟢 Google Gemini';
}

function buildGoogleGenerateContentPayload(messages, params = {}, systemPrompt) {
    const contents = [];

    for (const msg of messages) {
        if (msg.role === 'system') continue;

        const role = msg.role === 'assistant' ? 'model' : 'user';
        const parts = [];

        if (typeof msg.content === 'string') {
            if (msg.content) parts.push({ text: msg.content });
        } else if (Array.isArray(msg.content)) {
            for (const part of msg.content) {
                if (typeof part === 'string') {
                    if (part) parts.push({ text: part });
                } else if (part?.type === 'text' && typeof part.text === 'string') {
                    parts.push({ text: part.text });
                } else if (part?.type === 'image_url' && part.image_url?.url) {
                    const match = String(part.image_url.url).match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
                    if (match) {
                        parts.push({
                            inline_data: {
                                mime_type: match[1],
                                data: match[2],
                            },
                        });
                    }
                }
            }
        }

        if (parts.length > 0) {
            contents.push({ role, parts });
        }
    }

    const generationConfig = {};
    if (params.temperature != null) generationConfig.temperature = params.temperature;
    if (params.top_p != null) generationConfig.topP = params.top_p;
    if (params.max_tokens != null) generationConfig.maxOutputTokens = params.max_tokens;

    const payload = { contents };
    if (Object.keys(generationConfig).length > 0) {
        payload.generationConfig = generationConfig;
    }
    if (systemPrompt) {
        payload.systemInstruction = {
            parts: [{ text: systemPrompt }],
        };
    }

    return payload;
}

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

// ═══════════════════════════════════════════════
// Summarization Endpoint — uses Bedrock Nova Micro
// ═══════════════════════════════════════════════

const SUMMARIZE_SYSTEM_PROMPT = `You are a conversation summarizer. Given a conversation between a user and an assistant, produce a concise third-person summary that captures:
- Key topics discussed
- Important decisions, conclusions, or code created
- Any unresolved questions or pending tasks
- Technical details that would be needed to continue the conversation

Be concise but thorough. Write in plain prose paragraphs, not bullet points. Use under 500 words.`;

const SUMMARIZE_MODEL = 'us.amazon.nova-micro-v1:0';

app.post('/api/summarize', async (req, res) => {
    const { messages } = req.body;

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
        return res.status(400).json({
            error: { code: 'BAD_REQUEST', message: 'Messages array is required.' },
        });
    }

    // Build the summarization prompt.
    const conversationText = messages
        .map((m) => `${m.role.toUpperCase()}: ${typeof m.content === 'string' ? m.content : JSON.stringify(m.content)}`)
        .join('\n\n');

    try {
        const client = getBedrockClient();
        const command = new ConverseStreamCommand({
            modelId: SUMMARIZE_MODEL,
            system: [{ text: SUMMARIZE_SYSTEM_PROMPT }],
            messages: [
                {
                    role: 'user',
                    content: [{ text: `Please summarize this conversation:\n\n${conversationText}` }],
                },
            ],
            inferenceConfig: {
                maxTokens: 1024,
                temperature: 0.3,
            },
        });

        const response = await client.send(command);
        let summary = '';

        for await (const event of response.stream) {
            if (event.contentBlockDelta?.delta?.text) {
                summary += event.contentBlockDelta.delta.text;
            }
        }

        console.log(`[summarize] Got summary (${summary.length} chars) via Bedrock Nova Micro`);
        return res.json({ summary: summary.trim() });
    } catch (error) {
        const message = error.message || 'Summarization failed.';
        console.error('[summarize] Error:', error.name, message);
        return res.status(500).json({
            error: { code: 'SUMMARIZATION_FAILED', message },
        });
    }
});

if (process.env.NODE_ENV !== 'production' && !process.env.NETLIFY) {
    app.listen(PORT, () => {
        console.log(`\n  OpenChat proxy server running at http://localhost:${PORT}\n`);
    });
}

export { app, streamNvidia, streamGoogle, streamBedrock, streamOpenRouter };
