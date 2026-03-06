// ═══════════════════════════════════════════════
// Context Manager — Auto-summarization for long chats
// ═══════════════════════════════════════════════

const CHARS_PER_TOKEN = 3; // conservative for code-heavy conversations
const THRESHOLD_RATIO = 0.6; // summarize when context exceeds 60% of window
const KEEP_RECENT = 10; // always send last N messages in full
const DEFAULT_CONTEXT_WINDOW = 32768; // fallback if model has no contextWindow

// ── Token Estimation ──

/**
 * Estimate token count for a single message's content.
 */
function estimateContentTokens(content) {
    if (typeof content === 'string') {
        return Math.ceil(content.length / CHARS_PER_TOKEN);
    }
    if (Array.isArray(content)) {
        return content.reduce((sum, part) => {
            if (typeof part === 'string') return sum + Math.ceil(part.length / CHARS_PER_TOKEN);
            if (part?.type === 'text' && typeof part.text === 'string') {
                return sum + Math.ceil(part.text.length / CHARS_PER_TOKEN);
            }
            if (part?.type === 'image_url') return sum + 85; // ~85 tokens per image (OpenAI estimate)
            return sum;
        }, 0);
    }
    return 0;
}

/**
 * Estimate total tokens for an array of messages.
 */
export function estimateTokens(messages) {
    return messages.reduce((total, msg) => {
        // ~4 tokens overhead per message (role, separators, etc.)
        return total + 4 + estimateContentTokens(msg.content);
    }, 0);
}

// ── Threshold Check ──

/**
 * Check whether the conversation needs summarization.
 */
export function needsSummarization(messages, contextWindow = DEFAULT_CONTEXT_WINDOW) {
    const threshold = Math.floor(contextWindow * THRESHOLD_RATIO);
    return estimateTokens(messages) > threshold;
}

// ── Message Splitting ──

/**
 * Split messages into [olderMessages, recentMessages].
 * If there's already a summary message, it goes into the older bucket.
 */
export function splitMessages(messages, keepRecent = KEEP_RECENT) {
    if (messages.length <= keepRecent) {
        return { older: [], recent: messages };
    }
    return {
        older: messages.slice(0, messages.length - keepRecent),
        recent: messages.slice(messages.length - keepRecent),
    };
}

// ── Summary Cache ──

// In-memory cache: Map<cacheKey, summaryText>
const summaryCache = new Map();

function makeCacheKey(chatId, lastMessageId) {
    return `${chatId}::${lastMessageId}`;
}

/**
 * Get cached summary for this chat state.
 */
export function getCachedSummary(chatId, lastMessageId) {
    return summaryCache.get(makeCacheKey(chatId, lastMessageId)) || null;
}

/**
 * Store summary in cache.
 */
export function setCachedSummary(chatId, lastMessageId, summary) {
    summaryCache.set(makeCacheKey(chatId, lastMessageId), summary);
}

/**
 * Clear all cache entries for a chat.
 */
export function clearChatCache(chatId) {
    for (const key of summaryCache.keys()) {
        if (key.startsWith(`${chatId}::`)) {
            summaryCache.delete(key);
        }
    }
}

// ── Background Summarization ──

/**
 * Call the backend /api/summarize endpoint.
 * Returns the summary string on success, null on failure.
 */
async function callSummarize(messages) {
    try {
        const res = await fetch('/api/summarize', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ messages }),
        });
        if (!res.ok) {
            console.warn('[context] Summarization failed:', res.status);
            return null;
        }
        const data = await res.json();
        return data.summary || null;
    } catch (err) {
        console.warn('[context] Summarization error:', err.message);
        return null;
    }
}

/**
 * Run summarization in the background after a message is sent.
 * Caches the result and persists to Supabase via the provided saveSummary callback.
 *
 * @param {string} chatId
 * @param {Array} allMessages - full message history for this chat
 * @param {number} contextWindow - model's context window in tokens
 * @param {Function} saveSummary - async (chatId, summaryText) => void
 */
export async function runBackgroundSummarization(chatId, allMessages, contextWindow, saveSummary) {
    // Only summarize if actually needed.
    if (!needsSummarization(allMessages, contextWindow)) return;

    // Filter out any existing summary messages for the summarization input.
    const nonSummaryMessages = allMessages.filter((m) => m.role !== 'summary');

    const { older } = splitMessages(nonSummaryMessages);
    if (older.length < 4) return; // not enough messages to summarize

    const lastMsg = allMessages[allMessages.length - 1];
    const cacheKey = lastMsg?.id;
    if (!cacheKey) return;

    // Already cached for this state?
    if (getCachedSummary(chatId, cacheKey)) return;

    // Build messages for the summarizer (only text content).
    const summarizerMessages = older.map((m) => ({
        role: m.role === 'summary' ? 'system' : m.role,
        content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
    }));

    const summary = await callSummarize(summarizerMessages);
    if (!summary) return;

    // Cache it.
    setCachedSummary(chatId, cacheKey, summary);

    // Persist to Supabase.
    try {
        await saveSummary(chatId, summary);
    } catch (err) {
        console.warn('[context] Failed to persist summary:', err.message);
    }
}

/**
 * Build the final API messages array, using a summary if available.
 * If a summary exists (from cache or DB), it replaces older messages:
 *   [{ role: "system", content: summary }, ...recentMessages]
 *
 * @param {Array} allMessages - full message history
 * @param {string|null} summary - cached or DB-loaded summary text
 * @returns {Array} messages ready for the API
 */
export function buildApiMessages(allMessages, summary) {
    // Filter out summary placeholder messages from the array.
    const chatMessages = allMessages.filter((m) => m.role !== 'summary');

    if (!summary || chatMessages.length <= KEEP_RECENT) {
        // No summarization needed — send everything.
        return chatMessages.map((m) => ({ role: m.role, content: m.content }));
    }

    const { recent } = splitMessages(chatMessages);

    return [
        { role: 'system', content: `[Conversation summary so far]\n${summary}` },
        ...recent.map((m) => ({ role: m.role, content: m.content })),
    ];
}
