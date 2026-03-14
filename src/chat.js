import { streamChat } from './api.js';
import { getCurrentUser } from './auth.js';
import { getModelParams, getSystemPrompt } from './settings.js';
import { renderMarkdown, attachCopyHandlers } from './markdown.js';
import {
    getApiKey,
    getAwsRegion,
    getChats,
    searchChats,
    getCurrentChatId,
    setCurrentChatId,
    clearCurrentChatId,
    createChat,
    updateChatTitle,
    deleteChat as deleteChatFromDb,
    getMessagesByChatId,
    saveMessage,
    saveSummary,
    getLatestSummary,
    uploadImage,
    generateId,
    generateTitle,
} from './storage.js';
import {
    renderUserMessage,
    createAssistantMessage,
    renderChatList,
    showToast,
    setWelcomeVisible,
    scrollToBottom,
    setGenerating,
} from './ui.js';
import { NVIDIA_KIMI_MODEL } from './models.js';
import {
    buildApiMessages,
    getCachedSummary,
    runBackgroundSummarization,
    clearChatCache,
} from './context.js';

// State
let currentChat = null;
let abortController = null;
let isStreaming = false;
let selectedModel = { ...NVIDIA_KIMI_MODEL };
let sidebarSearchQuery = '';
let sidebarSearchDebounce = null;
let chatSearchInitialized = false;

// Accessors
export function getCurrentChat() {
    return currentChat;
}

export function getIsStreaming() {
    return isStreaming;
}

export function getSelectedModel() {
    return selectedModel;
}

export function setSelectedModel(model) {
    if (!model?.id || !model?.provider) return;
    selectedModel = { ...model };
}

export function selectedModelSupportsVision() {
    return !!selectedModel?.supportsVision;
}

// New Chat
export async function newChat() {
    stopGeneration();

    const id = generateId();
    currentChat = { id, title: 'New chat', messages: [] };
    setCurrentChatId(id);

    // Insert into Supabase with user_id for RLS
    const user = await getCurrentUser();
    await createChat({ id, title: 'New chat', user_id: user?.id });

    // Clear context cache for previous chat.
    clearChatCache(id);

    // Clear messages area
    document.getElementById('messages-container').innerHTML = '';
    setWelcomeVisible(true);

    await refreshSidebar();
}

// Load Chat
export async function loadChat(id) {
    stopGeneration();

    // Fetch messages from Supabase
    const messages = await getMessagesByChatId(id);
    const chats = await getChats();
    const chatData = chats.find((c) => c.id === id);
    if (!chatData) return;

    currentChat = {
        id: chatData.id,
        title: chatData.title,
        messages,
    };
    setCurrentChatId(chatData.id);

    const container = document.getElementById('messages-container');
    container.innerHTML = '';

    setWelcomeVisible(messages.length === 0);

    // Render all messages
    messages.forEach((msg) => {
        if (msg.role === 'user') {
            container.appendChild(renderUserMessage(msg.content, msg.image_url));
        } else if (msg.role === 'assistant') {
            const {
                container: msgEl,
                thinkingBody,
                contentEl,
                copyBtn,
                thinkingBlock,
                thinkingSpinner,
                thinkingCheck,
                thinkingLabel,
            } =
                createAssistantMessage();

            if (msg.reasoning) {
                thinkingBody.textContent = msg.reasoning;
                thinkingBlock.classList.add('thinking-done', 'collapsed');
                thinkingSpinner.classList.add('hidden');
                thinkingCheck.classList.remove('hidden');
                thinkingLabel.textContent = 'Thought process';
            } else {
                thinkingBlock.classList.add('hidden');
            }

            contentEl.innerHTML = renderMarkdown(msg.content || '');
            copyBtn.dataset.copyText = msg.content || '';
            attachCopyHandlers(contentEl);
            container.appendChild(msgEl);
        }
    });

    scrollToBottom(false);
    await refreshSidebar();
}

// Delete Chat
export async function removeChatById(id) {
    await deleteChatFromDb(id);
    if (currentChat?.id === id) {
        clearCurrentChatId();
        await newChat();
    }
    await refreshSidebar();
}

// Send Message
/**
 * @param {string} text - message text
 * @param {File|null} imageFile - optional image attachment
 */
export async function sendMessage(text, imageFile = null) {
    if ((!text.trim() && !imageFile) || isStreaming) return;

    if (imageFile && !selectedModelSupportsVision()) {
        showToast('Selected model does not support image input.', 'warning');
        return;
    }

    const apiKey = getApiKey();
    // Allow empty API key since we're deployed and the server has the keys
    // if (!apiKey) {
    //     showToast('Please set your API key first.', 'warning');
    //     return;
    // }

    // Initialize chat if it has no messages yet
    if (!currentChat) {
        await newChat();
    }

    // Auto-generate title from first user message
    if (currentChat.messages.length === 0 && text.trim()) {
        const title = generateTitle(text);
        currentChat.title = title;
        await updateChatTitle(currentChat.id, title);
    }

    // Upload image if present
    let imageUrl = null;
    let imageBase64 = null;
    if (imageFile) {
        // Read base64 for API call
        imageBase64 = await fileToBase64(imageFile);

        // Upload to Supabase storage for persistence
        imageUrl = await uploadImage(imageFile);
        if (!imageUrl) {
            showToast('Failed to upload image.', 'error');
            return;
        }
    }

    // Save user message to Supabase
    const userMsg = {
        chat_id: currentChat.id,
        role: 'user',
        content: text,
        image_url: imageUrl,
    };
    const savedUserMsg = await saveMessage(userMsg);
    if (savedUserMsg) {
        currentChat.messages.push(savedUserMsg);
    }

    // Show messages area
    setWelcomeVisible(false);
    const container = document.getElementById('messages-container');
    container.appendChild(renderUserMessage(text, imageUrl));
    scrollToBottom();

    // Create assistant message placeholder
    const {
        container: assistantEl,
        thinkingBody,
        contentEl,
        copyBtn,
        thinkingBlock,
        thinkingSpinner,
        thinkingCheck,
        thinkingLabel,
        thinkingTimer,
    } = createAssistantMessage();

    container.appendChild(assistantEl);
    scrollToBottom();

    // Build messages for API with context summarization.
    // Check for a cached summary or load from Supabase.
    const lastMsg = currentChat.messages[currentChat.messages.length - 1];
    let summary = getCachedSummary(currentChat.id, lastMsg?.id);
    if (!summary) {
        summary = await getLatestSummary(currentChat.id);
    }

    const rawApiMessages = currentChat.messages.map((m) => {
        if (m.role === 'user' && m.id === savedUserMsg?.id && imageBase64) {
            // Multimodal message with image
            return {
                role: 'user',
                content: [
                    ...(text.trim() ? [{ type: 'text', text }] : []),
                    {
                        type: 'image_url',
                        image_url: { url: imageBase64 },
                    },
                ],
            };
        }
        // Standard text message
        return { role: m.role, content: m.content };
    });

    // If context is too long, use the summary + recent messages.
    const apiMessages = buildApiMessages(rawApiMessages, summary);

    // Stream
    let reasoningText = '';
    let contentText = '';
    let thinkingStartTime = null;
    let thinkingTimerRAF = null;
    isStreaming = true;
    setGenerating(true);

    // Live timer — updates the label every ~100ms while reasoning is streaming.
    function startThinkingTimer() {
        function tick() {
            if (!thinkingStartTime) { thinkingTimerRAF = requestAnimationFrame(tick); return; }
            const elapsed = ((performance.now() - thinkingStartTime) / 1000).toFixed(1);
            thinkingLabel.textContent = `Thinking for ${elapsed}s`;
            thinkingTimerRAF = requestAnimationFrame(tick);
        }
        thinkingTimerRAF = requestAnimationFrame(tick);
    }

    function stopThinkingTimer() {
        if (thinkingTimerRAF != null) {
            cancelAnimationFrame(thinkingTimerRAF);
            thinkingTimerRAF = null;
        }
    }

    // Get current model settings.
    const modelParams = getModelParams(selectedModel.key);
    const { prompt: systemPrompt } = getSystemPrompt(selectedModel.key);

    abortController = streamChat(
        {
            messages: apiMessages,
            apiKey,
            modelId: selectedModel.id,
            provider: selectedModel.provider,
            temperature: modelParams.temperature,
            top_p: modelParams.top_p,
            max_tokens: modelParams.max_tokens,
            frequency_penalty: modelParams.frequency_penalty,
            presence_penalty: modelParams.presence_penalty,
            system_prompt: systemPrompt || undefined,
            region: selectedModel.provider === 'bedrock' ? getAwsRegion() : undefined,
        },
        {
            onReasoning(token) {
                if (!thinkingStartTime) {
                    thinkingStartTime = performance.now();
                    startThinkingTimer();
                }
                reasoningText += token;
                thinkingBody.textContent = reasoningText;
                // Auto-scroll after the DOM updates
                requestAnimationFrame(() => {
                    thinkingBody.scrollTop = thinkingBody.scrollHeight;
                    scrollToBottom();
                });
            },

            onContent(token) {
                if (reasoningText && !thinkingBlock.classList.contains('thinking-done')) {
                    // Transition: spinner → checkmark + final timer
                    stopThinkingTimer();
                    thinkingBlock.classList.add('thinking-done');
                    thinkingSpinner.classList.add('hidden');
                    thinkingCheck.classList.remove('hidden');
                    const elapsed = thinkingStartTime
                        ? ((performance.now() - thinkingStartTime) / 1000).toFixed(1)
                        : '0.0';
                    thinkingLabel.textContent = `Thought for ${elapsed}s`;
                }

                contentText += token;
                contentEl.innerHTML = renderMarkdown(contentText);
                copyBtn.dataset.copyText = contentText;
                attachCopyHandlers(contentEl);
                scrollToBottom();
            },

            async onDone() {
                isStreaming = false;
                setGenerating(false);
                stopThinkingTimer();

                // Finalize thinking UI
                if (reasoningText) {
                    thinkingBlock.classList.add('thinking-done');
                    thinkingSpinner.classList.add('hidden');
                    thinkingCheck.classList.remove('hidden');
                    if (!thinkingLabel.textContent.startsWith('Thought for')) {
                        const elapsed = thinkingStartTime
                            ? ((performance.now() - thinkingStartTime) / 1000).toFixed(1)
                            : '0.0';
                        thinkingLabel.textContent = `Thought for ${elapsed}s`;
                    }
                    thinkingBlock.classList.add('collapsed');
                } else {
                    thinkingBlock.classList.add('hidden');
                }

                if (contentText) {
                    contentEl.innerHTML = renderMarkdown(contentText);
                    copyBtn.dataset.copyText = contentText;
                    attachCopyHandlers(contentEl);
                }

                // Save assistant message to Supabase
                const assistantMsg = {
                    chat_id: currentChat.id,
                    role: 'assistant',
                    content: contentText,
                    reasoning: reasoningText || null,
                };
                const savedAssistant = await saveMessage(assistantMsg);
                if (savedAssistant) {
                    currentChat.messages.push(savedAssistant);
                }

                await refreshSidebar();
                scrollToBottom();

                // Trigger background summarization (non-blocking).
                const contextWindow = selectedModel.contextWindow || 32768;
                runBackgroundSummarization(
                    currentChat.id,
                    currentChat.messages,
                    contextWindow,
                    saveSummary,
                ).catch((err) => console.warn('[context] Background summarization failed:', err));
            },

            async onError(error) {
                isStreaming = false;
                setGenerating(false);
                stopThinkingTimer();

                if (error.code === 401) {
                    showToast('Invalid API key. Please check your key in settings.', 'error');
                } else if (error.code === 429) {
                    showToast('Rate limit hit. Please wait a moment before trying again.', 'warning');
                } else {
                    showToast(error.text || 'An error occurred.', 'error');
                }

                if (!reasoningText && !contentText) {
                    assistantEl.remove();
                } else {
                    thinkingSpinner.classList.add('hidden');
                    thinkingCheck.classList.remove('hidden');
                    thinkingBlock.classList.add('thinking-done');
                    thinkingLabel.textContent = 'Thought process';
                    if (!reasoningText) thinkingBlock.classList.add('hidden');
                    copyBtn.dataset.copyText = contentText || '(Error during generation)';

                    const assistantMsg = {
                        chat_id: currentChat.id,
                        role: 'assistant',
                        content: contentText || '(Error during generation)',
                        reasoning: reasoningText || null,
                    };
                    await saveMessage(assistantMsg);
                }

                await refreshSidebar();
            },
        },
    );
}

// Stop Generation
export function stopGeneration() {
    if (abortController) {
        abortController.abort();
        abortController = null;
    }
    isStreaming = false;
    setGenerating(false);
}

// Sidebar Refresh
async function refreshSidebar() {
    const chats = sidebarSearchQuery ? await searchChats(sidebarSearchQuery) : await getChats();
    renderChatList(chats, currentChat?.id, {
        onSelect: loadChat,
        onDelete: removeChatById,
        searchTerm: sidebarSearchQuery,
    });
}

// Helpers
function fileToBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

// Initial render
export async function initChat() {
    if (!chatSearchInitialized) {
        const chatSearchInput = document.getElementById('chat-search-input');
        if (chatSearchInput) {
            chatSearchInput.addEventListener('input', () => {
                window.clearTimeout(sidebarSearchDebounce);
                sidebarSearchDebounce = window.setTimeout(async () => {
                    sidebarSearchQuery = chatSearchInput.value.trim();
                    await refreshSidebar();
                }, 180);
            });

            chatSearchInput.addEventListener('keydown', async (event) => {
                if (event.key === 'Escape') {
                    chatSearchInput.value = '';
                    sidebarSearchQuery = '';
                    await refreshSidebar();
                }
            });
        }
        chatSearchInitialized = true;
    }

    const chats = await getChats();
    const storedChatId = getCurrentChatId();
    const nextChatId = chats.some((chat) => chat.id === storedChatId) ? storedChatId : chats[0]?.id;

    if (nextChatId) {
        await loadChat(nextChatId);
        return;
    }

    await newChat();
}
