import { fetchFreeOpenRouterModels, fetchGitHubModels, fetchGoogleModels } from './api.js';
import { COMPANY_ORDER, getAllModels, withModelKey } from './models.js';
import { getApiKey, setApiKey, getSelectedModelId, setSelectedModelId, getAwsRegion, setAwsRegion } from './storage.js';
import {
    showApiKeyModal,
    hideApiKeyModal,
    autoResizeTextarea,
    initSidebarToggle,
    showImagePreview,
    clearImagePreview,
    getSelectedImageFile,
    renderModelPicker,
    setImageUploadEnabled,
    showToast,
} from './ui.js';
import {
    initChat,
    sendMessage,
    newChat,
    stopGeneration,
    getIsStreaming,
    setSelectedModel,
} from './chat.js';
import {
    PARAM_PRESETS,
    SYSTEM_PROMPT_PRESETS,
    MAX_TOKEN_PRESETS,
    DEFAULT_PARAMS,
    getModelParams,
    setModelParams,
    getSystemPrompt,
    setSystemPrompt,
} from './settings.js';

const WELCOME_HINT_POOL = [
    'Explain a difficult topic using a real-world analogy',
    'Write a utility script for a repetitive task',
    'Compare two options and recommend one for my needs',
    'Turn a rough idea into a startup concept with risks',
    'Design a 7-day plan to learn a new skill fast',
    'Rewrite a boring paragraph into something cinematic',
    'Debug a stubborn coding issue step by step',
    'Create a high-protein meal plan on a budget',
    'Brainstorm unusual business ideas in a niche market',
    'Summarize a complex article in plain English',
    'Generate a mind-bending sci-fi story premise',
    'Plan a deep-work routine for maximum focus',
    'Challenge my opinion with the strongest counterargument',
    'Turn a vague goal into an execution roadmap',
    'Invent a product nobody asked for but everyone wants',
    'Explain a concept as if teaching a 10-year-old',
    'Create a travel itinerary with hidden local gems',
    'Break down a tough decision with pros and tradeoffs',
    'Write a bold opening for a YouTube video script',
    'Generate three surprising plot twists for a story',
    'Help me prepare for an interview in one evening',
    'Turn messy notes into clean action items',
];
const PROMPT_SIGNATURE_KEY = 'openchat_last_prompt_signature';
const WELCOME_HINT_COUNT = 3;

function getPromptSignature(hints) {
    return JSON.stringify([...hints].map((hint) => String(hint).trim()));
}

function renderWelcomeHints(hints) {
    const hintsContainer = document.getElementById('welcome-hints');
    if (!hintsContainer) return;

    hintsContainer.innerHTML = '';

    hints.forEach((hint) => {
        const button = document.createElement('button');
        button.className = 'hint-chip';
        button.type = 'button';
        button.dataset.hint = hint;
        button.textContent = hint;
        hintsContainer.appendChild(button);
    });
}

async function refreshWelcomeHints() {
    const previousSignature = localStorage.getItem(PROMPT_SIGNATURE_KEY) || '';

    for (let attempt = 0; attempt < 5; attempt += 1) {
        const nextHints = [...WELCOME_HINT_POOL]
            .sort(() => Math.random() - 0.5)
            .slice(0, WELCOME_HINT_COUNT);
        const nextSignature = getPromptSignature(nextHints);

        if (!previousSignature || nextSignature !== previousSignature || attempt === 4) {
            renderWelcomeHints(nextHints);
            localStorage.setItem(PROMPT_SIGNATURE_KEY, nextSignature);
            return;
        }
    }
}

async function init() {
    const models = await loadAvailableModels();
    const modelsByKey = new Map(models.map((model) => [model.key, model]));

    const storedModelId = getSelectedModelId();
    const initialModel = modelsByKey.get(storedModelId) || models[0];
    let modelPicker = null;
    modelPicker = renderModelPicker(models, initialModel.key, {
        onSelect: (model) => {
            applySelectedModel(model, { showRegionNotice: true });
            loadSettingsForModel(model.key);
        },
    });
    applySelectedModel(initialModel);

    // Init chat
    await initChat();
    await refreshWelcomeHints();

    // Sidebar toggle (mobile)
    const { closeSidebar } = initSidebarToggle();

    // API Key Modal
    const apiKeyInput = document.getElementById('api-key-input');
    const btnSaveKey = document.getElementById('btn-save-key');
    const modalError = document.getElementById('modal-error');
    const btnSettings = document.getElementById('btn-settings');

    function saveApiKeyFromModal() {
        const key = apiKeyInput.value.trim();
        if (!key.startsWith('nvapi-')) {
            modalError.classList.remove('hidden');
            return;
        }
        modalError.classList.add('hidden');
        setApiKey(key);
        hideApiKeyModal();
    }

    btnSaveKey.addEventListener('click', saveApiKeyFromModal);
    apiKeyInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            saveApiKeyFromModal();
        }
    });

    btnSettings.addEventListener('click', () => {
        apiKeyInput.value = getApiKey();
        showApiKeyModal();
    });

    // New Chat
    document.getElementById('btn-new-chat').addEventListener('click', async () => {
        await newChat();
        await refreshWelcomeHints();
        closeSidebar();
    });

    // Message Input
    const input = document.getElementById('message-input');
    const btnSend = document.getElementById('btn-send');
    const btnStop = document.getElementById('btn-stop');

    input.addEventListener('input', () => autoResizeTextarea(input));

    async function handleSend() {
        const text = input.value.trim();
        const imageFile = getSelectedImageFile();
        if ((text || imageFile) && !getIsStreaming()) {
            await sendMessage(text, imageFile);
            input.value = '';
            autoResizeTextarea(input);
            clearImagePreview();
        }
    }

    btnSend.addEventListener('click', handleSend);

    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    });

    btnStop.addEventListener('click', stopGeneration);

    // Image Upload
    const btnAttach = document.getElementById('btn-attach');
    const fileInput = document.getElementById('image-file-input');

    btnAttach.addEventListener('click', () => {
        if (btnAttach.disabled) return;
        fileInput.click();
    });

    fileInput.addEventListener('change', () => {
        const file = fileInput.files?.[0];
        if (file) {
            // Validate file type
            const validTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif'];
            if (!validTypes.includes(file.type)) {
                alert('Please select a JPG, PNG, or GIF image.');
                fileInput.value = '';
                return;
            }
            showImagePreview(file);
        }
    });

    // Clipboard paste — support Ctrl+V image paste like ChatGPT
    input.addEventListener('paste', (e) => {
        const items = e.clipboardData?.items;
        if (!items) return;

        for (const item of items) {
            if (item.type.startsWith('image/')) {
                e.preventDefault();
                const file = item.getAsFile();
                if (!file) return;

                const validTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif'];
                if (!validTypes.includes(file.type)) return;

                // Put the pasted file into the hidden file input so getSelectedImageFile() works
                const dt = new DataTransfer();
                dt.items.add(file);
                fileInput.files = dt.files;

                showImagePreview(file);
                return;
            }
        }
    });

    // Hint chips
    const welcomeHints = document.getElementById('welcome-hints');
    welcomeHints?.addEventListener('click', async (event) => {
        const chip = event.target.closest('.hint-chip');
        if (!chip) return;
        const hint = chip.getAttribute('data-hint');
        if (hint && !getIsStreaming()) {
            await sendMessage(hint);
        }
    });

    function ensureCompatibleAwsRegion(model, { showNotice = false } = {}) {
        if (model.provider !== 'bedrock' || !Array.isArray(model.regions) || model.regions.length === 0) {
            return;
        }

        const currentRegion = getAwsRegion();
        if (model.regions.includes(currentRegion)) {
            return;
        }

        const nextRegion = model.regions[0];
        setAwsRegion(nextRegion);

        const awsRegionSelect = document.getElementById('aws-region-select');
        if (awsRegionSelect) {
            awsRegionSelect.value = nextRegion;
        }

        if (showNotice) {
            showToast(`${model.name} is only available in ${model.regions.join(', ')}. Switched AWS region to ${nextRegion}.`);
        }
    }

    function applySelectedModel(model, { showRegionNotice = false } = {}) {
        ensureCompatibleAwsRegion(model, { showNotice: showRegionNotice });
        setSelectedModel(model);
        setSelectedModelId(model.key);
        setImageUploadEnabled(model.supportsVision);
        modelPicker?.setSelectedModel(model);

        const messageInput = document.getElementById('message-input');
        const disclaimer = document.getElementById('model-disclaimer');

        if (messageInput) {
            messageInput.placeholder = `Message ${model.name}...`;
        }

        if (disclaimer) {
            const regionNote =
                model.provider === 'bedrock' && Array.isArray(model.regions) && model.regions.length > 0
                    ? ` Available in ${model.regions.join(', ')}.`
                    : '';
            disclaimer.textContent = `${model.name} can make mistakes. Verify important information.${regionNote}`;
        }

        if (!model.supportsVision) {
            clearImagePreview();
        }

        // Show/hide API key button only for NVIDIA models.
        const btnSettings = document.getElementById('btn-settings');
        if (btnSettings) {
            btnSettings.style.display = model.provider === 'nvidia' ? '' : 'none';
        }

        if (model.provider === 'nvidia') {
            if (!getApiKey()) {
                showApiKeyModal();
            }
        } else {
            hideApiKeyModal();
        }

        // Show/hide region selector for Bedrock models.
        const regionSection = document.getElementById('region-section');
        if (regionSection) {
            regionSection.style.display = model.provider === 'bedrock' ? '' : 'none';
        }

    }

    // ── Settings Drawer ──

    let currentModelKey = initialModel.key;

    const settingsDrawer = document.getElementById('settings-drawer');
    const settingsBackdrop = document.getElementById('settings-backdrop');
    const btnGear = document.getElementById('btn-settings-gear');
    const btnCloseSettings = document.getElementById('btn-close-settings');

    function openSettingsDrawer() {
        settingsDrawer.classList.add('open');
        settingsBackdrop.classList.add('visible');
    }

    function closeSettingsDrawer() {
        settingsDrawer.classList.remove('open');
        settingsBackdrop.classList.remove('visible');
    }

    btnGear.addEventListener('click', openSettingsDrawer);
    btnCloseSettings.addEventListener('click', closeSettingsDrawer);
    settingsBackdrop.addEventListener('click', closeSettingsDrawer);

    // Close on Escape
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && settingsDrawer.classList.contains('open')) {
            closeSettingsDrawer();
        }
    });

    // ── AWS Region Selector ──
    const awsRegionSelect = document.getElementById('aws-region-select');
    if (awsRegionSelect) {
        awsRegionSelect.value = getAwsRegion();
        awsRegionSelect.addEventListener('change', () => {
            const selectedModel = modelsByKey.get(currentModelKey);
            if (
                selectedModel?.provider === 'bedrock' &&
                Array.isArray(selectedModel.regions) &&
                selectedModel.regions.length > 0 &&
                !selectedModel.regions.includes(awsRegionSelect.value)
            ) {
                const fallbackRegion = selectedModel.regions[0];
                awsRegionSelect.value = fallbackRegion;
                setAwsRegion(fallbackRegion);
                showToast(`${selectedModel.name} is only available in ${selectedModel.regions.join(', ')}.`);
                return;
            }

            setAwsRegion(awsRegionSelect.value);
        });
    }

    // ── Sliders ──

    const tempSlider = document.getElementById('temp-slider');
    const tempValue = document.getElementById('temp-value');
    const topPSlider = document.getElementById('top-p-slider');
    const topPValue = document.getElementById('top-p-value');
    const freqPenSlider = document.getElementById('freq-pen-slider');
    const freqPenValue = document.getElementById('freq-pen-value');
    const presPenSlider = document.getElementById('pres-pen-slider');
    const presPenValue = document.getElementById('pres-pen-value');
    const maxTokensValue = document.getElementById('max-tokens-value');
    const maxTokensGroup = document.getElementById('max-tokens-group');

    function getCurrentParams() {
        return {
            temperature: parseFloat(tempSlider.value),
            top_p: parseFloat(topPSlider.value),
            max_tokens: parseInt(maxTokensValue.textContent, 10),
            frequency_penalty: parseFloat(freqPenSlider.value),
            presence_penalty: parseFloat(presPenSlider.value),
        };
    }

    function saveCurrentParams() {
        setModelParams(currentModelKey, getCurrentParams());
    }

    function setSliderUI(params) {
        tempSlider.value = params.temperature;
        tempValue.textContent = params.temperature.toFixed(1);
        topPSlider.value = params.top_p;
        topPValue.textContent = params.top_p.toFixed(2);
        freqPenSlider.value = params.frequency_penalty;
        freqPenValue.textContent = params.frequency_penalty.toFixed(1);
        presPenSlider.value = params.presence_penalty;
        presPenValue.textContent = params.presence_penalty.toFixed(1);
        maxTokensValue.textContent = params.max_tokens;

        // Update max token button states
        maxTokensGroup.querySelectorAll('.max-token-btn').forEach((btn) => {
            btn.classList.toggle('active', parseInt(btn.dataset.value, 10) === params.max_tokens);
        });
    }

    // Wire slider input events
    tempSlider.addEventListener('input', () => {
        tempValue.textContent = parseFloat(tempSlider.value).toFixed(1);
        saveCurrentParams();
    });

    topPSlider.addEventListener('input', () => {
        topPValue.textContent = parseFloat(topPSlider.value).toFixed(2);
        saveCurrentParams();
    });

    freqPenSlider.addEventListener('input', () => {
        freqPenValue.textContent = parseFloat(freqPenSlider.value).toFixed(1);
        saveCurrentParams();
    });

    presPenSlider.addEventListener('input', () => {
        presPenValue.textContent = parseFloat(presPenSlider.value).toFixed(1);
        saveCurrentParams();
    });

    // ── Max Tokens Preset Buttons ──

    MAX_TOKEN_PRESETS.forEach(({ label, value }) => {
        const btn = document.createElement('button');
        btn.className = 'max-token-btn';
        btn.textContent = label;
        btn.dataset.value = value;
        btn.addEventListener('click', () => {
            maxTokensValue.textContent = value;
            maxTokensGroup.querySelectorAll('.max-token-btn').forEach((b) => b.classList.remove('active'));
            btn.classList.add('active');
            saveCurrentParams();
        });
        maxTokensGroup.appendChild(btn);
    });

    // ── Parameter Presets ──

    const paramPresetsRow = document.getElementById('param-presets');

    // Mapping: parameter preset → system prompt preset
    const presetToPrompt = {
        'Precise Coding': 'Expert Coding Assistant',
        'Creative Writing': 'Creative Writing Partner',
        Balanced: 'Research & Analysis',
        Fast: 'Concise & Fast',
    };

    Object.entries(PARAM_PRESETS).forEach(([name, values]) => {
        const btn = document.createElement('button');
        btn.className = 'preset-btn';
        btn.textContent = name;
        btn.addEventListener('click', () => {
            setSliderUI(values);
            saveCurrentParams();
            // Highlight active preset
            paramPresetsRow.querySelectorAll('.preset-btn').forEach((b) => b.classList.remove('active'));
            btn.classList.add('active');

            // Auto-select matching system prompt
            const matchingPrompt = presetToPrompt[name];
            if (matchingPrompt && SYSTEM_PROMPT_PRESETS[matchingPrompt] != null) {
                promptPresetSelect.value = matchingPrompt;
                systemPromptTextarea.value = SYSTEM_PROMPT_PRESETS[matchingPrompt];
                setSystemPrompt(currentModelKey, SYSTEM_PROMPT_PRESETS[matchingPrompt], matchingPrompt);
            }
        });
        paramPresetsRow.appendChild(btn);
    });

    // ── Advanced Toggle ──

    const advancedToggle = document.getElementById('advanced-toggle');
    const advancedChevron = document.getElementById('advanced-chevron');
    const advancedContent = document.getElementById('advanced-content');

    advancedToggle.addEventListener('click', () => {
        const isExpanded = advancedContent.classList.toggle('visible');
        advancedChevron.classList.toggle('expanded', isExpanded);
    });

    // ── System Prompt ──

    const promptPresetSelect = document.getElementById('prompt-preset-select');
    const systemPromptTextarea = document.getElementById('system-prompt-textarea');

    // Populate preset options
    Object.keys(SYSTEM_PROMPT_PRESETS).forEach((name) => {
        const opt = document.createElement('option');
        opt.value = name;
        opt.textContent = name;
        promptPresetSelect.appendChild(opt);
    });

    promptPresetSelect.addEventListener('change', () => {
        const selected = promptPresetSelect.value;
        if (selected === 'none') {
            systemPromptTextarea.value = '';
            setSystemPrompt(currentModelKey, '', 'none');
        } else if (selected === 'Custom') {
            // Keep current textarea content
            setSystemPrompt(currentModelKey, systemPromptTextarea.value, 'Custom');
        } else {
            const promptText = SYSTEM_PROMPT_PRESETS[selected] || '';
            systemPromptTextarea.value = promptText;
            setSystemPrompt(currentModelKey, promptText, selected);
        }
    });

    systemPromptTextarea.addEventListener('input', () => {
        // When user manually edits, switch to Custom
        promptPresetSelect.value = 'Custom';
        setSystemPrompt(currentModelKey, systemPromptTextarea.value, 'Custom');
    });

    // ── Load Settings for Model ──

    function loadSettingsForModel(modelKey) {
        currentModelKey = modelKey;

        // Load params
        const params = getModelParams(modelKey);
        setSliderUI(params);

        // Determine which preset matches (if any)
        paramPresetsRow.querySelectorAll('.preset-btn').forEach((btn) => {
            const preset = PARAM_PRESETS[btn.textContent];
            if (!preset) return;
            const matches =
                preset.temperature === params.temperature &&
                preset.top_p === params.top_p &&
                preset.max_tokens === params.max_tokens &&
                preset.frequency_penalty === params.frequency_penalty &&
                preset.presence_penalty === params.presence_penalty;
            btn.classList.toggle('active', matches);
        });

        // Load system prompt
        const { presetName, prompt } = getSystemPrompt(modelKey);
        promptPresetSelect.value = presetName || 'none';
        systemPromptTextarea.value = prompt || '';
    }

    // Initialize settings for the current model
    loadSettingsForModel(initialModel.key);

}

// ── Bedrock model family prefixes used for deduplication ──
function compareCompanyOrder(a, b) {
    const aIndex = COMPANY_ORDER.indexOf(a.companyKey);
    const bIndex = COMPANY_ORDER.indexOf(b.companyKey);
    const safeA = aIndex === -1 ? Number.MAX_SAFE_INTEGER : aIndex;
    const safeB = bIndex === -1 ? Number.MAX_SAFE_INTEGER : bIndex;
    return safeA - safeB;
}

function sortModels(models) {
    return [...models].sort((a, b) => {
        if (a.id === 'openrouter/free') return -1;
        if (b.id === 'openrouter/free') return 1;
        if (a.featured && !b.featured) return -1;
        if (!a.featured && b.featured) return 1;
        const companyOrder = compareCompanyOrder(a, b);
        if (companyOrder !== 0) return companyOrder;
        return a.name.localeCompare(b.name);
    });
}

function uniqueModels(models) {
    return [...new Map(models.map((model) => [model.key, model])).values()];
}

async function loadAvailableModels() {
    const staticModels = getAllModels();

    const [googleResult, githubResult, openRouterResult] = await Promise.allSettled([
        fetchGoogleModels(),
        fetchGitHubModels(),
        fetchFreeOpenRouterModels(),
    ]);

    const dynamicModels = [];

    if (googleResult.status === 'fulfilled') {
        const googleModels = googleResult.value
            .filter((model) => model?.id)
            .map((model) =>
                withModelKey({
                    id: model.id,
                    provider: 'google',
                    name: model.name || model.id,
                    description: model.description,
                    supportsVision: !!model.supportsVision,
                    supportsThinking: false,
                    contextWindow: model.context_length || 32768,
                    group: model.group || '🟢 Google',
                }),
            )
            .sort((a, b) => a.name.localeCompare(b.name));

        dynamicModels.push(...googleModels);
    } else {
        showToast(`Failed to load Google models: ${googleResult.reason.message}`, 'warning', 7000);
    }

    if (githubResult.status === 'fulfilled') {
        const githubModels = githubResult.value
            .filter((model) => model?.id)
            .map((model) =>
                withModelKey({
                    id: model.id,
                    provider: 'github',
                    name: model.name || model.id,
                    description: model.description,
                    supportsVision: !!model.supportsVision,
                    supportsThinking: false,
                    contextWindow: model.context_length || 32768,
                    group: 'GitHub Models',
                }),
            )
            .sort((a, b) => a.name.localeCompare(b.name));

        dynamicModels.push(...githubModels);
    } else {
        showToast(`Failed to load GitHub models: ${githubResult.reason.message}`, 'warning', 7000);
    }

    if (openRouterResult.status === 'fulfilled') {
        const openRouterModels = openRouterResult.value;

        // Keep community models and skip the router entry because it is already pinned in the static catalog.
        const uniqueFreeModels = openRouterModels
            .filter((model) => model?.id && model.id !== 'openrouter/free')
            .map((model) =>
                withModelKey({
                    id: model.id,
                    provider: 'openrouter',
                    name: model.name || model.id,
                    description: model.description,
                    supportsVision: !!model.supportsVision,
                    supportsThinking: false,
                    contextWindow: model.context_length || 32768,
                    group: '🆓 Free Models (OpenRouter)',
                }),
            )
            .sort((a, b) => a.name.localeCompare(b.name));

        dynamicModels.push(...uniqueFreeModels);
    } else {
        showToast(`Failed to load OpenRouter models: ${openRouterResult.reason.message}`, 'warning', 7000);
    }

    return sortModels(uniqueModels([...staticModels, ...dynamicModels]));
}

document.addEventListener('DOMContentLoaded', init);
