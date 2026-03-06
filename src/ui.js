import { COMPANY_ORDER, getCompanyMeta } from './models.js';
import { siGoogle, siMeta, siMinimax, siMistralai, siNvidia, siOpenrouter } from 'simple-icons';

const SVG_NS = 'http://www.w3.org/2000/svg';
const SVG_TAGS = new Set(['svg', 'path', 'circle', 'rect', 'line', 'polyline', 'polygon', 'ellipse', 'g', 'defs', 'use', 'text', 'tspan', 'clipPath', 'mask', 'filter', 'linearGradient', 'radialGradient', 'stop', 'foreignObject']);

/**
 * Create a DOM element with optional attributes and children.
 */
export function el(tag, attrs = {}, ...children) {
    const element = SVG_TAGS.has(tag)
        ? document.createElementNS(SVG_NS, tag)
        : document.createElement(tag);
    for (const [key, val] of Object.entries(attrs)) {
        if (key === 'className') {
            if (SVG_TAGS.has(tag)) element.setAttribute('class', val);
            else element.className = val;
        }
        else if (key === 'innerHTML') element.innerHTML = val;
        else if (key === 'textContent') element.textContent = val;
        else if (key.startsWith('on')) element.addEventListener(key.slice(2).toLowerCase(), val);
        else element.setAttribute(key, val);
    }
    for (const child of children) {
        if (typeof child === 'string') element.appendChild(document.createTextNode(child));
        else if (child) element.appendChild(child);
    }
    return element;
}

async function copyText(text, button) {
    if (!text) return;

    try {
        await navigator.clipboard.writeText(text);
        const previousLabel = button.getAttribute('aria-label') || 'Copy message';
        button.classList.add('copied');
        button.setAttribute('aria-label', 'Copied');
        button.title = 'Copied';
        button.innerHTML =
            '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
        setTimeout(() => {
            button.classList.remove('copied');
            button.setAttribute('aria-label', previousLabel);
            button.title = previousLabel;
            button.innerHTML =
                '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
        }, 1200);
    } catch {
        showToast('Failed to copy message.', 'warning', 2500);
    }
}

function createMessageCopyButton(label = 'Copy message') {
    const button = el('button', {
        className: 'message-copy-btn',
        type: 'button',
        title: label,
        'aria-label': label,
    });
    button.innerHTML =
        '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
    return button;
}

// Message Rendering

/**
 * Render a user message bubble with optional image.
 */
export function renderUserMessage(text, imageUrl = null) {
    const wrapper = el('div', { className: 'message message-user' });
    const bubble = el('div', { className: 'message-user-bubble' });
    const copyBtn = createMessageCopyButton('Copy prompt');

    if (imageUrl) {
        const img = el('img', {
            className: 'message-image',
            src: imageUrl,
            alt: 'Uploaded image',
        });
        img.addEventListener('click', () => {
            window.open(imageUrl, '_blank');
        });
        bubble.appendChild(img);
    }

    if (text && text.trim()) {
        const textEl = el('span', { textContent: text });
        bubble.appendChild(textEl);
        copyBtn.addEventListener('click', () => {
            copyText(text, copyBtn);
        });
        wrapper.appendChild(copyBtn);
    }

    wrapper.appendChild(bubble);
    return wrapper;
}

/**
 * Create an assistant message container with Grok-inspired thinking block.
 */
export function createAssistantMessage() {
    const container = el('div', { className: 'message message-assistant' });
    const copyBtn = createMessageCopyButton('Copy response');

    const thinkingBlock = el('div', { className: 'thinking-block' });

    const thinkingHeader = el('div', { className: 'thinking-header' });

    // Spinner icon (shown while thinking)
    const spinnerIcon = el('span', { className: 'thinking-icon thinking-spinner' });
    spinnerIcon.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg>`;

    // Checkmark icon (shown when done)
    const checkIcon = el('span', { className: 'thinking-icon thinking-check hidden' });
    checkIcon.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;

    const label = el('span', { className: 'thinking-label' }, 'Thinking');

    // Timer element (shows elapsed time when done)
    const timer = el('span', { className: 'thinking-timer' });

    const chevron = el('span', { className: 'thinking-chevron' });
    chevron.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>`;

    thinkingHeader.append(spinnerIcon, checkIcon, label, timer, chevron);
    thinkingHeader.addEventListener('click', () => {
        thinkingBlock.classList.toggle('collapsed');
    });

    const thinkingBody = el('div', { className: 'thinking-body' });
    thinkingBlock.append(thinkingHeader, thinkingBody);

    const contentEl = el('div', { className: 'assistant-content' });

    copyBtn.addEventListener('click', () => {
        copyText(copyBtn.dataset.copyText || '', copyBtn);
    });

    container.append(copyBtn, thinkingBlock, contentEl);

    return {
        container,
        thinkingBody,
        contentEl,
        copyBtn,
        thinkingBlock,
        thinkingSpinner: spinnerIcon,
        thinkingCheck: checkIcon,
        thinkingLabel: label,
        thinkingTimer: timer,
    };
}

// Sidebar

export function renderChatList(chats, activeChatId, { onSelect, onDelete, searchTerm = '' }) {
    const listEl = document.getElementById('chat-list');
    listEl.innerHTML = '';

    if (!chats.length) {
        const emptyText = searchTerm ? `No chats matched "${searchTerm}".` : 'No chats yet.';
        listEl.appendChild(el('div', { className: 'chat-search-empty', textContent: emptyText }));
        return;
    }

    chats.forEach((chat) => {
        const item = el('div', {
            className: `chat-item ${chat.id === activeChatId ? 'active' : ''}`,
        });
        item.addEventListener('click', () => onSelect(chat.id));

        const content = el('div', { className: 'chat-item-content' });
        const title = el('span', { className: 'chat-item-title', textContent: chat.title || 'New chat' });
        const snippetText = chat.searchSnippet || '';
        const snippet = snippetText ? el('span', { className: 'chat-item-snippet', textContent: snippetText }) : null;
        const meta = searchTerm && chat.searchMatchCount
            ? el('span', {
                className: 'chat-item-meta',
                textContent: `${chat.searchMatchCount} hit${chat.searchMatchCount === 1 ? '' : 's'}`,
            })
            : null;

        content.append(title);
        if (snippet) content.append(snippet);
        if (meta) content.append(meta);

        const delBtn = el('button', { className: 'chat-item-delete', title: 'Delete chat' });
        delBtn.innerHTML =
            '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>';
        delBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            onDelete(chat.id);
        });

        item.append(content, delBtn);
        listEl.appendChild(item);
    });
}

// Model Selector

function companySort(a, b) {
    const aIndex = COMPANY_ORDER.indexOf(a);
    const bIndex = COMPANY_ORDER.indexOf(b);
    const safeA = aIndex === -1 ? Number.MAX_SAFE_INTEGER : aIndex;
    const safeB = bIndex === -1 ? Number.MAX_SAFE_INTEGER : bIndex;
    return safeA - safeB;
}

function createCompanyLogo(companyKey, size = 'md') {
    const company = getCompanyMeta(companyKey);
    const simpleIcons = {
        openrouter: siOpenrouter,
        google: siGoogle,
        meta: siMeta,
        nvidia: siNvidia,
        mistral: siMistralai,
        minimax: siMinimax,
    };
    const logo = el('span', {
        className: `company-logo company-logo-${size}`,
        style: `--company-tone: ${company.tone}`,
        title: company.name,
        'aria-hidden': 'true',
    });
    const simpleIcon = simpleIcons[companyKey];

    if (simpleIcon?.path) {
        const svg = el('svg', {
            className: 'company-logo-svg',
            viewBox: '0 0 24 24',
            fill: 'currentColor',
            role: 'presentation',
        });
        const path = el('path', { d: simpleIcon.path });
        svg.appendChild(path);
        logo.classList.add('has-svg');
        logo.appendChild(svg);
        return logo;
    }

    const fallback = el('span', {
        className: 'company-logo-fallback',
        textContent: company.monogram,
    });

    if (company.logoDomain) {
        const img = el('img', {
            className: 'company-logo-img',
            src: `https://www.google.com/s2/favicons?sz=64&domain_url=https://${company.logoDomain}`,
            alt: '',
            loading: 'lazy',
            referrerpolicy: 'no-referrer',
        });
        img.addEventListener('error', () => {
            img.remove();
            logo.classList.remove('has-image');
        });
        logo.classList.add('has-image');
        logo.append(img, fallback);
        return logo;
    }

    logo.appendChild(fallback);
    return logo;
}

function createAutoLogo(size = 'md') {
    const logo = el('span', {
        className: `company-logo company-logo-${size} auto-logo has-svg`,
        // Inline color wins over any stylesheet rule including the two-class
        // .company-logo.has-svg selector that sets color: #f5f7fb (white).
        style: '--company-tone: #f59e0b; color: #ffd98a',
        title: 'Auto (Smart & Efficient)',
        'aria-hidden': 'true',
    });
    logo.innerHTML =
        '<svg class="company-logo-svg" viewBox="0 0 24 24" fill="none" role="presentation"><path d="M12 2.8l1.95 5.21 5.55.49-4.24 3.61 1.32 5.39L12 14.61 7.42 17.5l1.32-5.39L4.5 8.5l5.55-.49L12 2.8Z" fill="currentColor"/><path d="M19.2 4.4l.62 1.67 1.78.16-1.36 1.15.42 1.72-1.46-.92-1.47.92.43-1.72-1.36-1.15 1.78-.16.62-1.67Z" fill="currentColor" opacity=".7"/></svg>';
    return logo;
}

function createModelIdentityLogo(model, size = 'md') {
    if (model?.id === 'openrouter/free') {
        return createAutoLogo(size);
    }
    return createCompanyLogo(model.companyKey, size);
}

function createModelChip(text, extraClass = '') {
    return el('span', {
        className: `model-chip ${extraClass}`.trim(),
        textContent: text,
    });
}

function formatContextLabel(contextWindow) {
    if (!contextWindow) return '';
    if (contextWindow >= 1000000) {
        return `${(contextWindow / 1000000).toFixed(contextWindow % 1000000 === 0 ? 0 : 1)}M context`;
    }
    return `${Math.round(contextWindow / 1000)}K context`;
}

export function renderModelPicker(models, selectedModelId, { onSelect } = {}) {
    const shell = document.getElementById('model-picker-shell');
    const trigger = document.getElementById('model-picker-trigger');
    const popover = document.getElementById('model-picker-popover');
    const companyNav = document.getElementById('model-company-nav');
    const listEl = document.getElementById('model-picker-list');
    const searchInput = document.getElementById('model-search-input');

    if (!shell || !trigger || !popover || !companyNav || !listEl || !searchInput) {
        return {
            setSelectedModel() { },
            close() { },
        };
    }

    const modelsByKey = new Map(models.map((model) => [model.key, model]));
    let selectedKey = modelsByKey.has(selectedModelId) ? selectedModelId : models[0]?.key || '';
    let searchQuery = '';
    let activeCompany = modelsByKey.get(selectedKey)?.companyKey || models[0]?.companyKey || 'openrouter';

    function getVisibleModels() {
        const query = searchQuery.trim().toLowerCase();
        if (!query) return models;
        return models.filter((model) => {
            const haystack = [model.name, model.description, model.company, model.providerLabel, model.id]
                .filter(Boolean)
                .join(' ')
                .toLowerCase();
            return haystack.includes(query);
        });
    }

    function getVisibleCompanies(visibleModels) {
        return [...new Set(visibleModels.map((model) => model.companyKey))].sort(companySort);
    }

    function openPopover() {
        popover.classList.remove('hidden');
        trigger.setAttribute('aria-expanded', 'true');
    }

    function closePopover() {
        popover.classList.add('hidden');
        trigger.setAttribute('aria-expanded', 'false');
    }

    function renderTrigger() {
        const selected = modelsByKey.get(selectedKey) || models[0];
        if (!selected) return;

        const company = getCompanyMeta(selected.companyKey);
        trigger.innerHTML = '';

        const summary = el('div', { className: 'model-trigger-summary' });
        const textWrap = el('div', { className: 'model-trigger-text' });
        const eyebrow = el('span', { className: 'model-trigger-company', textContent: company.name });
        const nameRow = el('div', { className: 'model-trigger-name-row' });
        const modelName = el('span', { className: 'model-trigger-name', textContent: selected.name });
        const provider = el('span', { className: 'model-trigger-provider', textContent: selected.providerLabel });
        const chevron = el('span', { className: 'model-trigger-chevron', 'aria-hidden': 'true' });

        chevron.innerHTML =
            '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>';

        nameRow.append(modelName, provider);
        textWrap.append(eyebrow, nameRow);
        summary.append(createModelIdentityLogo(selected, 'lg'), textWrap);
        trigger.append(summary, chevron);
    }

    function renderCompanies(visibleCompanies) {
        companyNav.innerHTML = '';

        visibleCompanies.forEach((companyKey) => {
            const meta = getCompanyMeta(companyKey);
            const button = el(
                'button',
                {
                    className: `company-nav-btn ${companyKey === activeCompany ? 'active' : ''}`,
                    type: 'button',
                    title: meta.name,
                    'aria-label': meta.name,
                },
                createCompanyLogo(companyKey, 'sm'),
            );

            button.addEventListener('click', (e) => {
                // Stop propagation immediately — before any DOM mutation — so the
                // event never reaches the document outside-click listener, regardless
                // of whether the browser continues bubbling through detached nodes.
                e.stopPropagation();

                // Update the active class in-place on existing buttons.
                // Do NOT call renderPanel() here: it calls renderCompanies() which
                // does `companyNav.innerHTML = ''`, removing this button from the
                // DOM while the click event is still bubbling.  Chromium stops
                // propagation when an intermediate node is detached mid-bubble, so
                // the popover's own stopPropagation listener would never fire and
                // the document listener would close the picker.
                companyNav.querySelectorAll('.company-nav-btn').forEach((b) =>
                    b.classList.remove('active'),
                );
                button.classList.add('active');
                activeCompany = companyKey;
                renderList(getVisibleModels());
            });

            companyNav.appendChild(button);
        });
    }

    function renderList(visibleModels) {
        listEl.innerHTML = '';

        const companyModels = visibleModels
            .filter((model) => model.companyKey === activeCompany)
            .sort((a, b) => {
                if (a.featured && !b.featured) return -1;
                if (!a.featured && b.featured) return 1;
                if (a.companyKey !== b.companyKey) return companySort(a.companyKey, b.companyKey);
                return a.name.localeCompare(b.name);
            });

        if (companyModels.length === 0) {
            listEl.appendChild(
                el('div', { className: 'model-picker-empty' }, 'No models match that search in this company.'),
            );
            return;
        }

        companyModels.forEach((model) => {
            const card = el('button', {
                className: `model-card ${model.key === selectedKey ? 'selected' : ''}`,
                type: 'button',
            });

            const header = el('div', { className: 'model-card-header' });
            const titleWrap = el('div', { className: 'model-card-title-wrap' });
            const title = el('div', { className: 'model-card-title', textContent: model.name });
            const desc = el('div', { className: 'model-card-description', textContent: model.description });
            const badges = el('div', { className: 'model-card-badges' });

            badges.appendChild(createModelChip(model.providerLabel, 'is-provider'));
            if (model.supportsThinking) badges.appendChild(createModelChip('Thinking', 'is-thinking'));
            if (model.supportsVision) badges.appendChild(createModelChip('Vision', 'is-vision'));
            if (model.id === 'openrouter/free') badges.appendChild(createModelChip('Router', 'is-featured'));

            titleWrap.append(title, desc);
            header.append(createModelIdentityLogo(model, 'md'), titleWrap, badges);

            const footer = el('div', { className: 'model-card-footer' });
            const contextLabel = formatContextLabel(model.contextWindow);
            if (contextLabel) footer.appendChild(createModelChip(contextLabel));
            footer.appendChild(createModelChip(model.id, 'is-id'));

            card.append(header, footer);

            card.addEventListener('click', () => {
                selectedKey = model.key;
                activeCompany = model.companyKey;
                renderTrigger();
                renderPanel();
                closePopover();
                onSelect?.(model);
            });

            listEl.appendChild(card);
        });
    }

    function renderPanel() {
        const visibleModels = getVisibleModels();
        const visibleCompanies = getVisibleCompanies(visibleModels);

        if (!visibleCompanies.includes(activeCompany)) {
            activeCompany = visibleCompanies[0] || activeCompany;
        }

        renderCompanies(visibleCompanies);
        renderList(visibleModels);
    }

    trigger.addEventListener('click', (event) => {
        event.stopPropagation();
        if (popover.classList.contains('hidden')) {
            openPopover();
            searchInput.focus();
        } else {
            closePopover();
        }
    });

    searchInput.addEventListener('input', () => {
        searchQuery = searchInput.value;
        renderPanel();
    });

    // Use pointerdown for outside-close detection. Company nav buttons destroy
    // and recreate themselves during their click handler (via renderPanel),
    // which detaches the event target from the DOM before a click would reach
    // the document. pointerdown fires before click, so the target is still
    // attached and the simple contains() check works reliably.
    document.addEventListener('pointerdown', (event) => {
        if (!popover.classList.contains('hidden') && !shell.contains(event.target)) {
            closePopover();
        }
    });

    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            closePopover();
        }
    });

    renderTrigger();
    renderPanel();

    return {
        setSelectedModel(modelOrKey) {
            const nextKey = typeof modelOrKey === 'string' ? modelOrKey : modelOrKey?.key;
            const model = modelsByKey.get(nextKey);
            if (!model) return;
            selectedKey = model.key;
            activeCompany = model.companyKey;
            renderTrigger();
            renderPanel();
        },
        close: closePopover,
    };
}

// Image Preview

/**
 * Show image preview above input area.
 */
export function showImagePreview(file) {
    const previewContainer = document.getElementById('image-preview');
    previewContainer.innerHTML = '';
    previewContainer.classList.remove('hidden');

    const url = URL.createObjectURL(file);
    const img = el('img', { className: 'preview-thumb', src: url, alt: 'Preview' });
    const removeBtn = el('button', { className: 'preview-remove', title: 'Remove image' });
    removeBtn.innerHTML =
        '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';

    removeBtn.addEventListener('click', () => {
        clearImagePreview();
    });

    const fileName = el('span', { className: 'preview-name', textContent: file.name });

    previewContainer.append(img, fileName, removeBtn);
}

/**
 * Clear image preview and reset file input.
 */
export function clearImagePreview() {
    const previewContainer = document.getElementById('image-preview');
    previewContainer.innerHTML = '';
    previewContainer.classList.add('hidden');
    const fileInput = document.getElementById('image-file-input');
    if (fileInput) fileInput.value = '';
}

/**
 * Get the currently selected image file, if any.
 */
export function getSelectedImageFile() {
    const fileInput = document.getElementById('image-file-input');
    return fileInput?.files?.[0] || null;
}

export function setImageUploadEnabled(enabled) {
    const attachBtn = document.getElementById('btn-attach');
    const fileInput = document.getElementById('image-file-input');

    if (!attachBtn || !fileInput) return;

    attachBtn.disabled = !enabled;
    fileInput.disabled = !enabled;
    attachBtn.classList.toggle('disabled', !enabled);

    if (enabled) {
        attachBtn.title = 'Attach image';
        attachBtn.setAttribute('aria-label', 'Attach image');
    } else {
        attachBtn.title = 'Selected model does not support image input';
        attachBtn.setAttribute('aria-label', 'Image upload unavailable for this model');
    }
}

// Toast

export function showToast(message, type = 'error', duration = 5000) {
    const container = document.getElementById('toast-container');
    const toast = el('div', { className: `toast toast-${type}`, textContent: message });
    container.appendChild(toast);

    setTimeout(() => {
        toast.classList.add('toast-exit');
        setTimeout(() => toast.remove(), 300);
    }, duration);
}

// Modal

export function showApiKeyModal() {
    document.getElementById('api-key-modal').classList.remove('hidden');
}

export function hideApiKeyModal() {
    document.getElementById('api-key-modal').classList.add('hidden');
}

// Helpers

export function autoResizeTextarea(textarea) {
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, 200) + 'px';
}

export function scrollToBottom(smooth = true) {
    const container = document.getElementById('messages-container');
    container.scrollTo({
        top: container.scrollHeight,
        behavior: smooth ? 'smooth' : 'instant',
    });
}

export function setWelcomeVisible(visible) {
    const welcome = document.getElementById('welcome-screen');
    const messages = document.getElementById('messages-container');
    if (visible) {
        welcome.classList.remove('hidden');
        messages.classList.add('hidden');
    } else {
        welcome.classList.add('hidden');
        messages.classList.remove('hidden');
    }
}

export function setGenerating(isGenerating) {
    const sendBtn = document.getElementById('btn-send');
    const stopBtn = document.getElementById('btn-stop');
    if (isGenerating) {
        sendBtn.classList.add('hidden');
        stopBtn.classList.remove('hidden');
    } else {
        sendBtn.classList.remove('hidden');
        stopBtn.classList.add('hidden');
    }
}

// Sidebar toggle (mobile)

export function initSidebarToggle() {
    const toggle = document.getElementById('sidebar-toggle');
    const sidebar = document.getElementById('sidebar');

    const backdrop = el('div', { className: 'sidebar-backdrop' });
    document.body.appendChild(backdrop);

    function openSidebar() {
        sidebar.classList.add('open');
        backdrop.classList.add('visible');
    }

    function closeSidebar() {
        sidebar.classList.remove('open');
        backdrop.classList.remove('visible');
    }

    toggle.addEventListener('click', () => {
        sidebar.classList.contains('open') ? closeSidebar() : openSidebar();
    });

    backdrop.addEventListener('click', closeSidebar);

    return { openSidebar, closeSidebar };
}
