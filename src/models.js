// Model catalog: OpenRouter + NVIDIA + AWS Bedrock

export const COMPANY_ORDER = Object.freeze([
    'openrouter',
    'openai',
    'deepseek',
    'kimi',
    'mistral',
    'nvidia',
    'minimax',
    'qwen',
    'glm',
    'google',
    'amazon',
    'meta',
    'stepfun',
    'liquid',
    'arcee',
    'nousresearch',
    'cognitive',
    'stealth',
]);

export const COMPANY_META = Object.freeze({
    openrouter: { name: 'OpenRouter', monogram: 'OR', tone: '#f97316', logoDomain: 'openrouter.ai' },
    openai: { name: 'OpenAI', monogram: 'OA', tone: '#10b981', logoDomain: 'openai.com' },
    deepseek: { name: 'DeepSeek', monogram: 'DS', tone: '#38bdf8', logoDomain: 'deepseek.com' },
    kimi: { name: 'Kimi', monogram: 'K', tone: '#facc15', logoDomain: 'kimi.com' },
    mistral: { name: 'Mistral', monogram: 'MS', tone: '#fb923c', logoDomain: 'mistral.ai' },
    nvidia: { name: 'NVIDIA', monogram: 'NV', tone: '#84cc16', logoDomain: 'nvidia.com' },
    minimax: { name: 'MiniMax', monogram: 'MM', tone: '#f472b6', logoDomain: 'minimax.io' },
    qwen: { name: 'Qwen', monogram: 'QW', tone: '#8b5cf6', logoDomain: 'qwen.ai' },
    glm: { name: 'GLM', monogram: 'GL', tone: '#22d3ee', logoDomain: 'z.ai' },
    google: { name: 'Google', monogram: 'G', tone: '#60a5fa', logoDomain: 'google.com' },
    amazon: { name: 'Amazon Nova', monogram: 'AN', tone: '#f59e0b', logoDomain: 'amazon.com' },
    meta: { name: 'Meta', monogram: 'M', tone: '#3b82f6', logoDomain: 'meta.com' },
    stepfun: { name: 'StepFun', monogram: 'SF', tone: '#ef4444', logoDomain: 'stepfun.com' },
    liquid: { name: 'Liquid', monogram: 'LQ', tone: '#14b8a6', logoDomain: 'liquid.ai' },
    arcee: { name: 'Arcee', monogram: 'AR', tone: '#ec4899', logoDomain: 'arcee.ai' },
    nousresearch: { name: 'Nous Research', monogram: 'NR', tone: '#c084fc', logoDomain: 'nousresearch.com' },
    cognitive: { name: 'Cognitive', monogram: 'CG', tone: '#f87171', logoDomain: 'cognitivecomputations.com' },
    stealth: { name: 'Stealth / Other', monogram: '??', tone: '#a1a1aa' },
});

const PROVIDER_LABELS = Object.freeze({
    bedrock: 'Bedrock',
    nvidia: 'NVIDIA NIM',
    google: 'Google API',
    openrouter: 'OpenRouter',
});

export const OPENROUTER_AUTO_MODEL = Object.freeze({
    key: 'openrouter::openrouter/free',
    id: 'openrouter/free',
    provider: 'openrouter',
    companyKey: 'openrouter',
    name: 'Auto (Smart & Efficient)',
    description: 'OpenRouter free router that picks the best available community model for the request.',
    contextWindow: 262144,
    supportsVision: false,
    supportsThinking: false,
    featured: true,
});

export const NVIDIA_KIMI_MODEL = Object.freeze({
    key: 'nvidia::moonshotai/kimi-k2.5',
    id: 'moonshotai/kimi-k2.5',
    provider: 'nvidia',
    companyKey: 'kimi',
    name: 'Kimi K2.5',
    description: 'Moonshot AI flagship with long context and native multimodal support via NVIDIA NIM.',
    contextWindow: 262144,
    supportsVision: true,
    supportsThinking: true,
    featured: true,
});

const DEEPSEEK_MODELS = [
    {
        id: 'us.deepseek.r1-v1:0',
        companyKey: 'deepseek',
        name: 'DeepSeek R1',
        description: 'Reasoning-first DeepSeek model with long context.',
        contextWindow: 163840,
        supportsVision: false,
        supportsThinking: true,
    },
    {
        id: 'deepseek.v3-v1:0',
        companyKey: 'deepseek',
        name: 'DeepSeek V3',
        description: 'General-purpose DeepSeek model with strong coding and analysis.',
        contextWindow: 163840,
        supportsVision: false,
        supportsThinking: false,
        regions: ['us-east-2', 'us-west-2'],
    },
];

const NOVA_MODELS = [
    {
        id: 'us.amazon.nova-premier-v1:0',
        companyKey: 'amazon',
        name: 'Nova Premier',
        description: 'Top-end Amazon Nova model for high-quality generation.',
        contextWindow: 1000000,
        supportsVision: false,
        supportsThinking: false,
    },
    {
        id: 'us.amazon.nova-pro-v1:0',
        companyKey: 'amazon',
        name: 'Nova Pro',
        description: 'Balanced Amazon Nova model with multimodal support.',
        contextWindow: 300000,
        supportsVision: true,
        supportsThinking: false,
    },
    {
        id: 'us.amazon.nova-lite-v1:0',
        companyKey: 'amazon',
        name: 'Nova Lite',
        description: 'Fast multimodal Nova tier for lightweight chat workloads.',
        contextWindow: 300000,
        supportsVision: true,
        supportsThinking: false,
    },
    {
        id: 'us.amazon.nova-micro-v1:0',
        companyKey: 'amazon',
        name: 'Nova Micro',
        description: 'Lowest-cost Amazon Nova option for quick responses.',
        contextWindow: 128000,
        supportsVision: false,
        supportsThinking: false,
    },
];

const LLAMA_MODELS = [
    {
        id: 'us.meta.llama3-3-70b-instruct-v1:0',
        companyKey: 'meta',
        name: 'Llama 3.3 70B',
        description: 'Large Meta instruction model for general chat and reasoning.',
        contextWindow: 128000,
        supportsVision: false,
        supportsThinking: false,
    },
    {
        id: 'us.meta.llama3-2-90b-instruct-v1:0',
        companyKey: 'meta',
        name: 'Llama 3.2 90B Vision',
        description: 'Meta multimodal model with image input support.',
        contextWindow: 128000,
        supportsVision: true,
        supportsThinking: false,
    },
];

const GOOGLE_MODELS = [
    {
        id: 'google.gemma-3-27b-it',
        companyKey: 'google',
        name: 'Gemma 3 27B IT',
        description: 'Largest Bedrock-hosted Gemma 3 instruction model.',
        contextWindow: 128000,
        supportsVision: false,
        supportsThinking: false,
    },
    {
        id: 'google.gemma-3-12b-it',
        companyKey: 'google',
        name: 'Gemma 3 12B IT',
        description: 'Mid-sized Gemma 3 instruction model.',
        contextWindow: 128000,
        supportsVision: false,
        supportsThinking: false,
    },
    {
        id: 'google.gemma-3-4b-it',
        companyKey: 'google',
        name: 'Gemma 3 4B IT',
        description: 'Small Bedrock-hosted Gemma 3 model for quick responses.',
        contextWindow: 128000,
        supportsVision: false,
        supportsThinking: false,
    },
];

const QWEN_MODELS = [
    {
        id: 'qwen.qwen3-next-80b-a3b',
        companyKey: 'qwen',
        name: 'Qwen3 Next 80B A3B',
        description: 'Large Qwen model optimized for general reasoning.',
        contextWindow: 262144,
        supportsVision: false,
        supportsThinking: false,
    },
    {
        id: 'qwen.qwen3-vl-235b-a22b',
        companyKey: 'qwen',
        name: 'Qwen3 VL 235B A22B',
        description: 'High-capacity Qwen vision-language model.',
        contextWindow: 262144,
        supportsVision: true,
        supportsThinking: false,
    },
    {
        id: 'qwen.qwen3-coder-next',
        companyKey: 'qwen',
        name: 'Qwen3 Coder Next',
        description: 'Qwen coding model tuned for programming and debugging.',
        contextWindow: 262144,
        supportsVision: false,
        supportsThinking: false,
        regions: ['us-east-1', 'eu-west-2', 'ap-southeast-2'],
    },
    {
        id: 'qwen.qwen3-coder-30b-a3b-v1:0',
        companyKey: 'qwen',
        name: 'Qwen3 Coder 30B A3B',
        description: 'Smaller Qwen coding model for faster completions.',
        contextWindow: 262144,
        supportsVision: false,
        supportsThinking: false,
    },
];

const MINIMAX_MODELS = [
    {
        id: 'minimax.minimax-m2',
        companyKey: 'minimax',
        name: 'MiniMax M2',
        description: 'Frontier MiniMax model with very large context.',
        contextWindow: 1000000,
        supportsVision: false,
        supportsThinking: false,
    },
];

const MOONSHOT_MODELS = [
    {
        id: 'moonshot.kimi-k2-thinking',
        companyKey: 'kimi',
        name: 'Kimi K2 Thinking',
        description: 'Reasoning-focused Kimi variant hosted on Bedrock.',
        contextWindow: 262144,
        supportsVision: false,
        supportsThinking: true,
    },
];

const MISTRAL_MODELS = [
    {
        id: 'mistral.mistral-large-3-675b-instruct',
        companyKey: 'mistral',
        name: 'Mistral Large 3',
        description: 'Largest Mistral model in the Bedrock catalog.',
        contextWindow: 128000,
        supportsVision: false,
        supportsThinking: false,
    },
    {
        id: 'mistral.magistral-small-2509',
        companyKey: 'mistral',
        name: 'Magistral Small 2509',
        description: 'Reasoning-tuned Mistral model.',
        contextWindow: 128000,
        supportsVision: false,
        supportsThinking: true,
    },
    {
        id: 'mistral.ministral-3-14b-instruct',
        companyKey: 'mistral',
        name: 'Ministral 3 14B',
        description: 'Balanced Mistral model for fast chat.',
        contextWindow: 128000,
        supportsVision: false,
        supportsThinking: false,
    },
    {
        id: 'mistral.ministral-3-8b-instruct',
        companyKey: 'mistral',
        name: 'Ministral 3 8B',
        description: 'Efficient Mistral model for lightweight tasks.',
        contextWindow: 128000,
        supportsVision: false,
        supportsThinking: false,
    },
    {
        id: 'mistral.ministral-3-3b-instruct',
        companyKey: 'mistral',
        name: 'Ministral 3 3B',
        description: 'Smallest Mistral chat model in the catalog.',
        contextWindow: 128000,
        supportsVision: false,
        supportsThinking: false,
    },
    {
        id: 'mistral.devstral-2-123b',
        companyKey: 'mistral',
        name: 'Devstral 2 123B',
        description: 'Developer-focused Mistral model for code-heavy work.',
        contextWindow: 128000,
        supportsVision: false,
        supportsThinking: false,
    },
];

const OPENAI_OSS_MODELS = [
    {
        id: 'openai.gpt-oss-120b-1:0',
        companyKey: 'openai',
        name: 'GPT-OSS 120B',
        description: 'Largest OpenAI OSS Bedrock model.',
        contextWindow: 128000,
        supportsVision: false,
        supportsThinking: false,
    },
    {
        id: 'openai.gpt-oss-20b-1:0',
        companyKey: 'openai',
        name: 'GPT-OSS 20B',
        description: 'Smaller OpenAI OSS model for faster, cheaper chat.',
        contextWindow: 128000,
        supportsVision: false,
        supportsThinking: false,
    },
];

function bedrockModel(model) {
    return decorateModel({
        ...model,
        provider: 'bedrock',
        key: `bedrock::${model.id}`,
    });
}

export function getProviderLabel(provider) {
    return PROVIDER_LABELS[provider] || provider;
}

export function getCompanyMeta(companyKey) {
    return COMPANY_META[companyKey] || COMPANY_META.stealth;
}

export function inferCompanyKeyFromModelId(id = '', provider = '') {
    const lower = String(id).toLowerCase();

    if (lower.startsWith('openrouter/')) return 'openrouter';
    if (lower.startsWith('moonshotai/') || lower.startsWith('moonshot.')) return 'kimi';
    if (lower.startsWith('us.deepseek.') || lower.startsWith('deepseek.') || lower.startsWith('deepseek/')) return 'deepseek';
    if (lower.startsWith('mistral.') || lower.startsWith('mistralai/') || lower.startsWith('cognitivecomputations/dolphin-mistral')) return 'mistral';
    if (lower.startsWith('nvidia/') || lower.startsWith('nemotron')) return 'nvidia';
    if (lower.startsWith('minimax.') || lower.startsWith('minimax/')) return 'minimax';
    if (lower.startsWith('qwen.') || lower.startsWith('qwen/')) return 'qwen';
    if (lower.startsWith('z-ai/') || lower.startsWith('glm') || lower.includes('/glm-')) return 'glm';
    if (lower.startsWith('google.') || lower.startsWith('google/') || lower.startsWith('gemini-')) return 'google';
    if (lower.startsWith('us.amazon.nova') || lower.startsWith('amazon.')) return 'amazon';
    if (lower.startsWith('us.meta.') || lower.startsWith('meta-llama/') || lower.startsWith('meta/')) return 'meta';
    if (lower.startsWith('openai.') || lower.startsWith('openai/')) return 'openai';
    if (lower.startsWith('stepfun/')) return 'stepfun';
    if (lower.startsWith('liquid/')) return 'liquid';
    if (lower.startsWith('arcee-ai/')) return 'arcee';
    if (lower.startsWith('nousresearch/')) return 'nousresearch';
    if (lower.startsWith('cognitivecomputations/')) return 'cognitive';
    if (provider === 'google') return 'google';
    return 'stealth';
}

function formatContextWindow(contextWindow) {
    if (!contextWindow) return '';
    if (contextWindow >= 1000000) {
        return `${(contextWindow / 1000000).toFixed(contextWindow % 1000000 === 0 ? 0 : 1)}M context`;
    }
    return `${Math.round(contextWindow / 1000)}K context`;
}

function buildDefaultDescription(model) {
    if (model.id === 'openrouter/free') {
        return 'OpenRouter free router that picks the best available community model for the request.';
    }

    const profile = model.supportsThinking ? 'Reasoning-focused' : model.supportsVision ? 'Vision-enabled' : 'General-purpose';
    const context = formatContextWindow(model.contextWindow);
    const providerLabel = getProviderLabel(model.provider);
    return [profile, context, `via ${providerLabel}`].filter(Boolean).join(' - ');
}

export function decorateModel(model) {
    const companyKey = model.companyKey || inferCompanyKeyFromModelId(model.id, model.provider);
    const companyMeta = getCompanyMeta(companyKey);

    return {
        ...model,
        key: model.key || `${model.provider}::${model.id}`,
        companyKey,
        company: companyMeta.name,
        companyTone: companyMeta.tone,
        companyMonogram: companyMeta.monogram,
        providerLabel: getProviderLabel(model.provider),
        description: model.description || buildDefaultDescription(model),
    };
}

export function getAllModels() {
    return [
        decorateModel(OPENROUTER_AUTO_MODEL),
        decorateModel(NVIDIA_KIMI_MODEL),
        ...DEEPSEEK_MODELS.map(bedrockModel),
        ...NOVA_MODELS.map(bedrockModel),
        ...LLAMA_MODELS.map(bedrockModel),
        ...GOOGLE_MODELS.map(bedrockModel),
        ...QWEN_MODELS.map(bedrockModel),
        ...MINIMAX_MODELS.map(bedrockModel),
        ...MOONSHOT_MODELS.map(bedrockModel),
        ...MISTRAL_MODELS.map(bedrockModel),
        ...OPENAI_OSS_MODELS.map(bedrockModel),
    ];
}

export function withModelKey(model) {
    return decorateModel({
        ...model,
        key: model.key || `${model.provider}::${model.id}`,
    });
}
