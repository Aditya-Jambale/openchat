// ═══════════════════════════════════════════════
// Storage — Supabase database + storage
// ═══════════════════════════════════════════════

import { supabase } from './supabase.js';

// ── API Key (still in localStorage — user-specific) ──
export function getApiKey() {
    return localStorage.getItem('kimi_api_key') || '';
}

export function setApiKey(key) {
    localStorage.setItem('kimi_api_key', key);
}

export function clearApiKey() {
    localStorage.removeItem('kimi_api_key');
}

export function getSelectedModelId() {
    return localStorage.getItem('kimi_selected_model') || '';
}

export function setSelectedModelId(modelId) {
    localStorage.setItem('kimi_selected_model', modelId);
}

export function getCurrentChatId() {
    return localStorage.getItem('openchat_current_chat_id') || '';
}

export function setCurrentChatId(chatId) {
    localStorage.setItem('openchat_current_chat_id', chatId);
}

export function clearCurrentChatId() {
    localStorage.removeItem('openchat_current_chat_id');
}

export function getAwsRegion() {
    return localStorage.getItem('openchat_aws_region') || 'us-east-1';
}

export function setAwsRegion(region) {
    localStorage.setItem('openchat_aws_region', region);
}

// ── Chat CRUD (Supabase) ──

/**
 * Fetch all chats, ordered by most recent first.
 */
export async function getChats() {
    const { data, error } = await supabase
        .from('chats')
        .select('*')
        .order('updated_at', { ascending: false });

    if (error) {
        console.error('Error fetching chats:', error);
        return [];
    }
    return data || [];
}

/**
 * Create a new chat row.
 */
export async function createChat(chat) {
    const { data, error } = await supabase
        .from('chats')
        .insert({ id: chat.id, title: chat.title })
        .select()
        .single();

    if (error) {
        console.error('Error creating chat:', error);
        return null;
    }
    return data;
}

/**
 * Update a chat's title.
 */
export async function updateChatTitle(chatId, title) {
    const { error } = await supabase
        .from('chats')
        .update({ title, updated_at: new Date().toISOString() })
        .eq('id', chatId);

    if (error) console.error('Error updating chat title:', error);
}

/**
 * Delete a chat by ID (cascade deletes messages).
 */
export async function deleteChat(id) {
    const { error } = await supabase
        .from('chats')
        .delete()
        .eq('id', id);

    if (error) console.error('Error deleting chat:', error);
}

/**
 * Get a single chat by ID.
 */
export async function getChatById(id) {
    const { data, error } = await supabase
        .from('chats')
        .select('*')
        .eq('id', id)
        .single();

    if (error) {
        console.error('Error fetching chat:', error);
        return null;
    }
    return data;
}

// ── Message CRUD (Supabase) ──

/**
 * Get all messages for a chat, ordered chronologically.
 */
export async function getMessagesByChatId(chatId) {
    const { data, error } = await supabase
        .from('messages')
        .select('*')
        .eq('chat_id', chatId)
        .order('created_at', { ascending: true });

    if (error) {
        console.error('Error fetching messages:', error);
        return [];
    }
    return data || [];
}

/**
 * Insert a message into the messages table.
 */
export async function saveMessage(message) {
    const { data, error } = await supabase
        .from('messages')
        .insert({
            chat_id: message.chat_id,
            role: message.role,
            content: message.content,
            reasoning: message.reasoning || null,
            image_url: message.image_url || null,
        })
        .select()
        .single();

    if (error) {
        console.error('Error saving message:', error);
        return null;
    }
    return data;
}

// ── Summary Persistence (Supabase) ──

/**
 * Save a conversation summary (role: "summary") for a chat.
 * Removes any previous summary for this chat first to keep only the latest.
 */
export async function saveSummary(chatId, summaryText) {
    // Delete old summaries for this chat.
    await supabase.from('messages').delete().eq('chat_id', chatId).eq('role', 'summary');

    // Insert new summary.
    const { data, error } = await supabase
        .from('messages')
        .insert({
            chat_id: chatId,
            role: 'summary',
            content: summaryText,
        })
        .select()
        .single();

    if (error) {
        console.error('Error saving summary:', error);
        return null;
    }
    return data;
}

/**
 * Get the latest summary message for a chat (if any).
 */
export async function getLatestSummary(chatId) {
    const { data, error } = await supabase
        .from('messages')
        .select('content')
        .eq('chat_id', chatId)
        .eq('role', 'summary')
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

    if (error || !data) return null;
    return data.content;
}

// ── Image Upload (Supabase Storage) ──

/**
 * Upload an image file to the chat-images bucket.
 * Returns the public URL.
 */
function compactText(text) {
    return String(text || '').replace(/\s+/g, ' ').trim();
}

function buildSearchSnippet(text, query) {
    const compact = compactText(text);
    if (!compact) return '';

    const normalizedQuery = String(query || '').trim().toLowerCase();
    if (!normalizedQuery) {
        return compact.length > 120 ? `${compact.slice(0, 117)}...` : compact;
    }

    const matchIndex = compact.toLowerCase().indexOf(normalizedQuery);
    if (matchIndex === -1) {
        return compact.length > 120 ? `${compact.slice(0, 117)}...` : compact;
    }

    const start = Math.max(0, matchIndex - 40);
    const end = Math.min(compact.length, matchIndex + normalizedQuery.length + 70);
    const prefix = start > 0 ? '... ' : '';
    const suffix = end < compact.length ? ' ...' : '';
    return `${prefix}${compact.slice(start, end)}${suffix}`;
}

export async function searchChats(query) {
    const normalizedQuery = String(query || '').trim();
    const chats = await getChats();

    if (!normalizedQuery) {
        return chats.map((chat) => ({
            ...chat,
            searchSnippet: '',
            searchMatchCount: 0,
            searchMatchedTitle: false,
        }));
    }

    const lowercaseQuery = normalizedQuery.toLowerCase();
    const decoratedChats = new Map(
        chats.map((chat) => [
            chat.id,
            {
                ...chat,
                searchSnippet: '',
                searchMatchCount: 0,
                searchMatchedTitle: compactText(chat.title).toLowerCase().includes(lowercaseQuery),
            },
        ]),
    );

    const pattern = `%${normalizedQuery}%`;
    const { data: messageMatches, error } = await supabase
        .from('messages')
        .select('chat_id, content, reasoning')
        .or(`content.ilike.${pattern},reasoning.ilike.${pattern}`);

    if (error) {
        console.error('Error searching messages:', error);
    }

    for (const match of messageMatches || []) {
        const chat = decoratedChats.get(match.chat_id);
        if (!chat) continue;

        chat.searchMatchCount += 1;

        if (!chat.searchSnippet) {
            const snippetSource = compactText(match.content) || compactText(match.reasoning);
            chat.searchSnippet = buildSearchSnippet(snippetSource, normalizedQuery);
        }
    }

    for (const chat of decoratedChats.values()) {
        if (chat.searchMatchedTitle && !chat.searchSnippet) {
            chat.searchSnippet = `Title match: ${compactText(chat.title)}`;
        }
    }

    return [...decoratedChats.values()]
        .filter((chat) => chat.searchMatchedTitle || chat.searchMatchCount > 0)
        .sort((a, b) => {
            if (a.searchMatchedTitle && !b.searchMatchedTitle) return -1;
            if (!a.searchMatchedTitle && b.searchMatchedTitle) return 1;
            if (a.searchMatchCount !== b.searchMatchCount) return b.searchMatchCount - a.searchMatchCount;
            return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
        });
}

export async function uploadImage(file) {
    const ext = file.name.split('.').pop();
    const fileName = `${crypto.randomUUID()}.${ext}`;
    const filePath = `uploads/${fileName}`;

    const { error } = await supabase.storage
        .from('chat-images')
        .upload(filePath, file, {
            cacheControl: '3600',
            upsert: false,
        });

    if (error) {
        console.error('Error uploading image:', error);
        return null;
    }

    const { data: urlData } = supabase.storage
        .from('chat-images')
        .getPublicUrl(filePath);

    return urlData?.publicUrl || null;
}

// ── Utilities ──

export function generateId() {
    return crypto.randomUUID();
}

/**
 * Auto-generate a chat title from the first user message.
 * Takes the first 40 characters, trims at last word boundary.
 */
export function generateTitle(text) {
    const clean = text.replace(/\n/g, ' ').trim();
    if (clean.length <= 40) return clean;
    const truncated = clean.slice(0, 40);
    const lastSpace = truncated.lastIndexOf(' ');
    return (lastSpace > 20 ? truncated.slice(0, lastSpace) : truncated) + '…';
}
