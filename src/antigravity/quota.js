import axios from 'axios';
import { loadAccounts, saveAccounts, listAccounts } from './accounts.js';

const QUOTA_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Fetch and cache quota data for an account.
 * Returns { antigravity: {used, limit, resetAt}, geminiCli: {used, limit, resetAt} }
 */
export async function refreshQuota(account) {
    try {
        const res = await axios.get(
            'https://cloudcode-pa.googleapis.com/v1internal/quota',
            {
                headers: { Authorization: `Bearer ${account.accessToken}` },
                timeout: 10000,
            },
        );

        const data = res.data || {};
        const quotaData = {
            antigravity: {
                used: data.antigravityUsed ?? 0,
                limit: data.antigravityLimit ?? 100,
                resetAt: data.antigravityResetAt ?? null,
            },
            geminiCli: {
                used: data.geminiCliUsed ?? 0,
                limit: data.geminiCliLimit ?? 100,
                resetAt: data.geminiCliResetAt ?? null,
            },
            lastRefreshed: Date.now(),
        };

        // Persist in accounts file
        const store = loadAccounts();
        const idx = store.accounts.findIndex((a) => a.email === account.email);
        if (idx >= 0) {
            store.accounts[idx].quotaCache = quotaData;
            saveAccounts(store);
        }

        return quotaData;
    } catch {
        // Return cached data if available, else null
        return account.quotaCache || null;
    }
}

/**
 * Check if quota cache is stale and should be refreshed.
 */
export function shouldRefreshQuota(account, intervalMinutes = 5) {
    const cache = account.quotaCache;
    if (!cache?.lastRefreshed) return true;
    return Date.now() - cache.lastRefreshed > intervalMinutes * 60 * 1000;
}

/**
 * Check if an account's quota is exhausted above the given threshold.
 * Fails open (returns false) if cache is stale.
 */
export function isQuotaExhausted(account, threshold = 85) {
    const cache = account.quotaCache;
    if (!cache) return false;

    // Fail open if stale
    if (Date.now() - (cache.lastRefreshed || 0) > QUOTA_CACHE_TTL_MS) {
        return false;
    }

    const agPct = ((cache.antigravity?.used ?? 0) / (cache.antigravity?.limit ?? 100)) * 100;
    const gcPct = ((cache.geminiCli?.used ?? 0) / (cache.geminiCli?.limit ?? 100)) * 100;

    return agPct >= threshold || gcPct >= threshold;
}

/**
 * Get a summary of quota usage for all accounts.
 * Returns an array of { email, antigravityPct, geminiCliPct, resetAt }
 */
export function getQuotaSummary() {
    const accounts = listAccounts();
    return accounts.map((acct) => {
        const cache = acct.quotaCache;
        return {
            email: acct.email,
            enabled: acct.enabled,
            antigravityPct: cache
                ? Math.round(((cache.antigravity?.used ?? 0) / (cache.antigravity?.limit ?? 100)) * 100)
                : null,
            geminiCliPct: cache
                ? Math.round(((cache.geminiCli?.used ?? 0) / (cache.geminiCli?.limit ?? 100)) * 100)
                : null,
            resetAt: cache?.antigravity?.resetAt ?? null,
        };
    });
}
