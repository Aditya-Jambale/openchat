import crypto from 'crypto';
import {
    ANTIGRAVITY_MODEL_MAP,
    THINKING_MODELS,
} from './constants.js';

/**
 * Transform our standard OpenAI-style message array into the Antigravity request body.
 */
export function transformRequest(messages, modelKey, settings, account) {
    const resolvedModelId = ANTIGRAVITY_MODEL_MAP[modelKey] || modelKey;
    const isThinking = THINKING_MODELS.includes(modelKey);
    const isClaudeThinking = modelKey.endsWith('-thinking') && modelKey.startsWith('claude-');
    const isGeminiThinking = modelKey === 'gemini-3-pro';

    // Clean the message history: remove internal 'summary' roles,
    // ensure alternating user/assistant turns.
    const cleaned = cleanMessageHistory(messages);

    // Separate system instruction from conversation turns
    let systemInstruction = null;
    const conversationMessages = [];

    for (const msg of cleaned) {
        if (msg.role === 'system') {
            systemInstruction = { parts: [{ text: extractText(msg.content) }] };
        } else {
            conversationMessages.push({
                role: msg.role === 'assistant' ? 'model' : 'user',
                parts: buildParts(msg.content),
            });
        }
    }

    // generationConfig
    const generationConfig = {};
    if (settings.temperature != null) generationConfig.temperature = settings.temperature;
    if (settings.topP != null) generationConfig.topP = settings.topP;
    if (settings.maxTokens != null) generationConfig.maxOutputTokens = settings.maxTokens;
    generationConfig.candidateCount = 1;

    if (isGeminiThinking) {
        generationConfig.thinkingConfig = { thinkingLevel: 'high' };
    }

    const body = {
        project: account.projectId,
        model: resolvedModelId,
        request: {
            contents: conversationMessages,
            generationConfig,
            ...(systemInstruction ? { systemInstruction } : {}),
        },
        userAgent: 'antigravity',
        requestId: `openchat-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`,
    };

    // Claude thinking: add additionalModelRequestFields
    if (isClaudeThinking) {
        body.request.additionalModelRequestFields = {
            thinking: { type: 'enabled', budget_tokens: 8000 },
        };
    }

    return body;
}

/**
 * Build extra headers needed for thinking Claude models.
 */
export function buildThinkingHeaders(modelKey) {
    if (modelKey.endsWith('-thinking') && modelKey.startsWith('claude-')) {
        return { 'anthropic-beta': 'interleaved-thinking-2025-05-14' };
    }
    return {};
}

/**
 * Strip x-goog-user-project from a headers object to prevent license conflicts.
 */
export function stripXGoogUserProject(headers) {
    const out = { ...headers };
    delete out['x-goog-user-project'];
    delete out['X-Goog-User-Project'];
    return out;
}

/**
 * Clean conversation history for Antigravity:
 * - Remove 'summary' role messages (internal to OpenChat)
 * - Ensure strictly alternating user/assistant turns (merge consecutive same-role messages)
 */
export function cleanMessageHistory(messages) {
    // Filter out summary messages
    const filtered = messages.filter((m) => m.role !== 'summary');

    if (filtered.length === 0) return [];

    // Merge consecutive same-role messages
    const merged = [];
    for (const msg of filtered) {
        const last = merged[merged.length - 1];
        if (last && last.role === msg.role) {
            // Merge content
            const lastText = extractText(last.content);
            const thisText = extractText(msg.content);
            last.content = `${lastText}\n${thisText}`;
        } else {
            merged.push({ ...msg });
        }
    }

    return merged;
}

// ── Helpers ──

function extractText(content) {
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
        return content
            .filter((p) => p.type === 'text')
            .map((p) => p.text)
            .join('\n');
    }
    return String(content ?? '');
}

function buildParts(content) {
    if (typeof content === 'string') {
        return [{ text: content }];
    }

    if (Array.isArray(content)) {
        return content.map((part) => {
            if (part.type === 'text') {
                return { text: part.text };
            }
            if (part.type === 'image_url') {
                const url = part.image_url?.url || '';
                // Handle base64 data URLs
                const match = url.match(/^data:([^;]+);base64,(.+)$/);
                if (match) {
                    return {
                        inlineData: {
                            mimeType: match[1],
                            data: match[2],
                        },
                    };
                }
                // Fallback: just include as text
                return { text: `[image: ${url}]` };
            }
            return { text: String(part) };
        });
    }

    return [{ text: String(content ?? '') }];
}
