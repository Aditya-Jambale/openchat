import fs from 'fs';
import path from 'path';
import { ACCOUNTS_FILE } from './constants.js';
import { generateFingerprint, buildFingerprintHeaders } from './fingerprint.js';
import { refreshAccessToken } from './oauth.js';

const DEFAULT_CONFIG = {
    softQuotaThreshold: 85,
    accountSelectionStrategy: 'least-used',
    quotaRefreshIntervalMinutes: 5,
};

const EMPTY_STORE = { accounts: [], config: { ...DEFAULT_CONFIG } };

// ── Storage ──

export function loadAccounts() {
    try {
        const raw = fs.readFileSync(ACCOUNTS_FILE, 'utf8');
        const parsed = JSON.parse(raw);
        if (!parsed.accounts) parsed.accounts = [];
        if (!parsed.config) parsed.config = { ...DEFAULT_CONFIG };
        return parsed;
    } catch {
        return { ...EMPTY_STORE, config: { ...DEFAULT_CONFIG } };
    }
}

export function saveAccounts(store) {
    const dir = path.dirname(ACCOUNTS_FILE);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    }

    const tmp = `${ACCOUNTS_FILE}.tmp.${process.pid}`;
    try {
        fs.writeFileSync(tmp, JSON.stringify(store, null, 2), { mode: 0o600 });
        fs.renameSync(tmp, ACCOUNTS_FILE);
    } catch (err) {
        try { fs.unlinkSync(tmp); } catch { /* ignore */ }
        throw err;
    }
}

// ── Account CRUD ──

export function addAccount(accountData) {
    const store = loadAccounts();
    const fingerprint = generateFingerprint();

    const existing = store.accounts.findIndex((a) => a.email === accountData.email);
    const account = {
        email: accountData.email,
        refreshToken: accountData.refresh_token,
        accessToken: accountData.access_token,
        expiryDate: accountData.expiryDate,
        projectId: accountData.projectId,
        enabled: true,
        fingerprint,
        quotaCache: null,
    };

    if (existing >= 0) {
        store.accounts[existing] = account;
    } else {
        store.accounts.push(account);
    }

    saveAccounts(store);
    return account;
}

export function removeAccount(email) {
    const store = loadAccounts();
    store.accounts = store.accounts.filter((a) => a.email !== email);
    saveAccounts(store);
}

export function enableAccount(email) {
    const store = loadAccounts();
    const account = store.accounts.find((a) => a.email === email);
    if (account) {
        account.enabled = true;
        saveAccounts(store);
    }
}

export function disableAccount(email) {
    const store = loadAccounts();
    const account = store.accounts.find((a) => a.email === email);
    if (account) {
        account.enabled = false;
        saveAccounts(store);
    }
}

export function listAccounts() {
    const { accounts } = loadAccounts();
    return accounts.map(({ email, enabled, quotaCache }) => ({ email, enabled, quotaCache }));
}

export function regenerateFingerprint(email) {
    const store = loadAccounts();
    const account = store.accounts.find((a) => a.email === email);
    if (account) {
        account.fingerprint = generateFingerprint();
        saveAccounts(store);
    }
}

// ── Account Selection ──

/**
 * Select the best available account for a request.
 * Refreshes access token if near expiry.
 * Returns { account, headers } ready for use.
 */
export async function selectBestAccount(excludeEmails = []) {
    const store = loadAccounts();
    const { config } = store;
    const threshold = config.softQuotaThreshold ?? 85;

    let candidates = store.accounts.filter(
        (a) => a.enabled && !excludeEmails.includes(a.email),
    );

    if (candidates.length === 0) {
        return null;
    }

    // Soft-quota filter: prefer accounts below threshold
    const belowThreshold = candidates.filter(
        (a) => !isAccountOverThreshold(a, threshold),
    );

    if (belowThreshold.length > 0) {
        candidates = belowThreshold;
    }

    // Sort by least used (lowest quota usage)
    if (config.accountSelectionStrategy === 'least-used') {
        candidates.sort((a, b) => getQuotaUsage(a) - getQuotaUsage(b));
    }

    const account = candidates[0];

    // Refresh token if expiring within 60 seconds
    if (account.expiryDate < Date.now() + 60000) {
        try {
            const { access_token, expiryDate } = await refreshAccessToken(account.refreshToken);
            account.accessToken = access_token;
            account.expiryDate = expiryDate;

            // Persist updated token
            const freshStore = loadAccounts();
            const idx = freshStore.accounts.findIndex((a) => a.email === account.email);
            if (idx >= 0) {
                freshStore.accounts[idx].accessToken = access_token;
                freshStore.accounts[idx].expiryDate = expiryDate;
                saveAccounts(freshStore);
            }
        } catch (err) {
            if (err.name === 'InvalidGrant') {
                // Remove dead account
                removeAccount(account.email);
                return selectBestAccount(excludeEmails);
            }
            throw err;
        }
    }

    const headers = buildFingerprintHeaders(account.fingerprint || {
        userAgent: 'antigravity/1.15.8 (windows; amd64)',
        clientMetadata: { ideType: 'ANTIGRAVITY', platform: 'WINDOWS', pluginType: 'GEMINI' },
    });

    return { account, headers };
}

/**
 * Mark an account as rate-limited until a future time.
 */
export function markRateLimited(email, retryAfterSeconds = 60) {
    const store = loadAccounts();
    const account = store.accounts.find((a) => a.email === email);
    if (account) {
        account.rateLimitedUntil = Date.now() + retryAfterSeconds * 1000;
        saveAccounts(store);
    }
}

// ── Helpers ──

function isAccountOverThreshold(account, threshold) {
    const quota = account.quotaCache;
    if (!quota) return false;

    const agUsed = quota.antigravity?.used ?? 0;
    const agLimit = quota.antigravity?.limit ?? 100;
    const gcUsed = quota.geminiCli?.used ?? 0;
    const gcLimit = quota.geminiCli?.limit ?? 100;

    return (agUsed / agLimit) * 100 >= threshold || (gcUsed / gcLimit) * 100 >= threshold;
}

function getQuotaUsage(account) {
    const quota = account.quotaCache;
    if (!quota) return 0;

    const agUsed = quota.antigravity?.used ?? 0;
    const agLimit = quota.antigravity?.limit ?? 100;
    return (agUsed / agLimit) * 100;
}
