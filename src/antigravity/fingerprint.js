import { ANTIGRAVITY_HEADERS } from './constants.js';

/**
 * Generate a unique device fingerprint for an Antigravity account.
 * Each account needs its own fingerprint so each session looks like
 * a separate IDE installation.
 */
export function generateFingerprint() {
    const minorVersion = Math.floor(Math.random() * 12) + 1;

    return {
        deviceId: crypto.randomUUID(),
        sessionToken: generateHex(32),
        userAgent: `antigravity/1.15.${minorVersion} (windows; amd64)`,
        clientMetadata: {
            ideType: 'ANTIGRAVITY',
            platform: 'WINDOWS',
            pluginType: 'GEMINI',
        },
    };
}

/**
 * Build the headers that incorporate the account-specific fingerprint.
 * Only the User-Agent changes per account; deviceId and sessionToken
 * are NOT sent in headers.
 */
export function buildFingerprintHeaders(fingerprint) {
    return {
        ...ANTIGRAVITY_HEADERS,
        'User-Agent': fingerprint.userAgent,
        'Client-Metadata': JSON.stringify(fingerprint.clientMetadata),
    };
}

// ── Helpers ──

function generateHex(bytes) {
    const arr = new Uint8Array(bytes);
    crypto.getRandomValues(arr);
    return Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join('');
}
