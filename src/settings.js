// ═══════════════════════════════════════════════
// Settings — Model parameters & system prompts
// ═══════════════════════════════════════════════

// ── Parameter Presets ──

export const PARAM_PRESETS = {
    'Precise Coding': {
        temperature: 0.3,
        top_p: 0.9,
        max_tokens: 8192,
        frequency_penalty: 0.2,
        presence_penalty: 0.0,
    },
    'Creative Writing': {
        temperature: 1.2,
        top_p: 0.95,
        max_tokens: 4096,
        frequency_penalty: 0.5,
        presence_penalty: 0.6,
    },
    Balanced: {
        temperature: 0.7,
        top_p: 0.95,
        max_tokens: 4096,
        frequency_penalty: 0.0,
        presence_penalty: 0.0,
    },
    Fast: {
        temperature: 0.4,
        top_p: 0.85,
        max_tokens: 1024,
        frequency_penalty: 0.0,
        presence_penalty: 0.0,
    },
};

export const DEFAULT_PARAMS = { ...PARAM_PRESETS.Balanced };

// ── System Prompt Presets ──

export const SYSTEM_PROMPT_PRESETS = {
    'Expert Coding Assistant':
        'You are an expert software engineer. Write clean, efficient, well-documented code. Explain your reasoning step by step. Follow best practices and modern conventions. If something is ambiguous, ask for clarification before proceeding.',
    'Creative Writing Partner':
        "You are a creative writing partner. Help craft vivid, engaging prose with strong narrative voice. Focus on showing rather than telling. Suggest improvements to pacing, dialogue, and character development. Match the user's tone and style.",
    'Research & Analysis':
        'You are a thorough research analyst. Provide well-structured, evidence-based responses. Cite specific details and consider multiple perspectives. Distinguish between established facts and informed speculation. Use clear headings and bullet points.',
    'Concise & Fast':
        'Be concise. Give direct answers without unnecessary preamble. Use bullet points for lists. Skip disclaimers unless safety-critical. Prioritize speed and clarity.',
    Custom: '',
};

// ── Storage Helpers ──

function paramsKey(modelKey) {
    return `openchat_params_${modelKey}`;
}

function promptKey(modelKey) {
    return `openchat_sysprompt_${modelKey}`;
}

/**
 * Get saved model parameters, or return defaults.
 */
export function getModelParams(modelKey) {
    try {
        const raw = localStorage.getItem(paramsKey(modelKey));
        if (raw) {
            const parsed = JSON.parse(raw);
            return { ...DEFAULT_PARAMS, ...parsed };
        }
    } catch {
        // Corrupted data, fall through to defaults.
    }
    return { ...DEFAULT_PARAMS };
}

/**
 * Save model parameters to localStorage.
 */
export function setModelParams(modelKey, params) {
    localStorage.setItem(paramsKey(modelKey), JSON.stringify(params));
}

/**
 * Get saved system prompt + preset name for a model.
 */
export function getSystemPrompt(modelKey) {
    try {
        const raw = localStorage.getItem(promptKey(modelKey));
        if (raw) {
            const parsed = JSON.parse(raw);
            return {
                presetName: parsed.presetName || 'Custom',
                prompt: parsed.prompt || '',
            };
        }
    } catch {
        // Fall through.
    }
    return { presetName: 'Custom', prompt: '' };
}

/**
 * Save system prompt + preset name.
 */
export function setSystemPrompt(modelKey, prompt, presetName = 'Custom') {
    localStorage.setItem(promptKey(modelKey), JSON.stringify({ prompt, presetName }));
}

// ── Max Token Presets ──

export const MAX_TOKEN_PRESETS = [
    { label: 'Short', value: 1024 },
    { label: 'Normal', value: 4096 },
    { label: 'Long', value: 8192 },
    { label: 'Maximum', value: 16384 },
];
