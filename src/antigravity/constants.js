import os from 'os';
import path from 'path';

// OAuth constants — Antigravity IDE client credentials (reverse engineered, publicly available)
export const OAUTH_CLIENT_ID =
    '681255809395-ht9p6d0f9plq9ouiaj13b4g1o2qfhf5p.apps.googleusercontent.com';
export const OAUTH_SCOPES = [
    'openid',
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/userinfo.profile',
    'https://www.googleapis.com/auth/cloud-platform',
    'https://www.googleapis.com/auth/cclog',
];
export const OAUTH_REDIRECT_PORT = 36742;
export const OAUTH_REDIRECT_URI = `http://localhost:${OAUTH_REDIRECT_PORT}/oauth-callback`;
export const OAUTH_AUTH_URL = 'https://accounts.google.com/o/oauth2/auth';
export const OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token';

// Antigravity API endpoints — try in order, fall back on failure
export const ANTIGRAVITY_ENDPOINTS = [
    'https://daily-cloudcode-pa.sandbox.googleapis.com',
    'https://autopush-cloudcode-pa.sandbox.googleapis.com',
    'https://cloudcode-pa.googleapis.com',
];
export const ANTIGRAVITY_STREAM_PATH =
    '/v1internal/projects/{projectId}/locations/us-central1/endpoints/openapi/chat/completions';

// Gemini CLI endpoint (dual quota — Gemini models route here first)
export const GEMINI_CLI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';

// Impersonation headers — makes requests look like real Antigravity IDE
export const ANTIGRAVITY_HEADERS = {
    'User-Agent': 'antigravity/1.15.8 (windows; amd64)',
    'X-Goog-Api-Client': 'google-cloud-sdk vscode_cloudshelleditor/0.1',
    'Client-Metadata': JSON.stringify({
        ideType: 'ANTIGRAVITY',
        platform: 'WINDOWS',
        pluginType: 'GEMINI',
    }),
};

// Model ID mappings: our internal key → Antigravity API model name
export const ANTIGRAVITY_MODEL_MAP = {
    'gemini-3-pro': 'gemini-3.1-pro-exp',
    'gemini-3-flash': 'gemini-3.0-flash',
    'claude-opus-4-6': 'gemini-claude-opus-4-6',
    'claude-opus-4-6-thinking': 'gemini-claude-opus-4-6-thinking',
    'claude-sonnet-4-6': 'gemini-claude-sonnet-4-6',
    'claude-sonnet-4-6-thinking': 'gemini-claude-sonnet-4-6-thinking',
};

// Models that route to Gemini CLI endpoint instead of Antigravity (dual quota)
export const GEMINI_CLI_MODELS = ['gemini-3-pro', 'gemini-3-flash'];

// Models that support extended thinking
export const THINKING_MODELS = [
    'claude-opus-4-6-thinking',
    'claude-sonnet-4-6-thinking',
    'gemini-3-pro',
];

// Storage file path for accounts
export const ACCOUNTS_FILE = path.join(
    process.env.APPDATA || os.homedir(),
    '.openchat',
    'antigravity-accounts.json',
);
