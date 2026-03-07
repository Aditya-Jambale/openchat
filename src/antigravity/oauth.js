import express from 'express';
import axios from 'axios';
import { createServer } from 'http';
import open from 'open';
import pkceChallenge from 'pkce-challenge';
import {
    OAUTH_CLIENT_ID,
    OAUTH_SCOPES,
    OAUTH_REDIRECT_PORT,
    OAUTH_REDIRECT_URI,
    OAUTH_AUTH_URL,
    OAUTH_TOKEN_URL,
    ANTIGRAVITY_ENDPOINTS,
    ANTIGRAVITY_STREAM_PATH,
} from './constants.js';

/**
 * Build the authorization URL params for the Google OAuth flow.
 */
function buildAuthParams({ clientId, redirectUri, scopes, state, codeChallenge }) {
    const params = {
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: scopes.join(' '),
        state,
        access_type: 'offline',
        prompt: 'consent',
    };
    if (codeChallenge) {
        params.code_challenge = codeChallenge;
        params.code_challenge_method = 'S256';
    }
    return new URLSearchParams(params);
}

/**
 * Start the OAuth 2.0 PKCE flow and return tokens + email + project_id.
 * Opens the user's browser for Google login, waits for the callback.
 */
export async function startOAuthFlow() {
    const { code_verifier, code_challenge } = await pkceChallenge();
    const state = generateState();

    const authUrl = `${OAUTH_AUTH_URL}?${buildAuthParams({
        clientId: OAUTH_CLIENT_ID,
        redirectUri: OAUTH_REDIRECT_URI,
        scopes: OAUTH_SCOPES,
        state,
        codeChallenge: code_challenge,
    }).toString()}`;

    // Start temporary callback server and wait for the auth code.
    // Pass the full authUrl so the callback server opens it in the browser.
    const { code: authCode, state: returnedState } = await startCallbackServer(state, authUrl);

    if (returnedState !== state) {
        throw new Error('OAuth state mismatch — possible CSRF attack');
    }

    // Exchange code for tokens
    const tokenRes = await axios.post(
        OAUTH_TOKEN_URL,
        new URLSearchParams({
            client_id: OAUTH_CLIENT_ID,
            code: authCode,
            redirect_uri: OAUTH_REDIRECT_URI,
            grant_type: 'authorization_code',
            code_verifier,
        }).toString(),
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
    );

    const { access_token, refresh_token, expires_in } = tokenRes.data;
    const expiryDate = Date.now() + (expires_in - 60) * 1000;

    // Get user email
    const userInfoRes = await axios.get('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: { Authorization: `Bearer ${access_token}` },
    });
    const email = userInfoRes.data.email;

    // Get project ID
    const projectId = await getProjectId(access_token);

    return { access_token, refresh_token, expiryDate, email, projectId };
}

/**
 * Refresh an access token using a refresh token.
 * Throws with name 'InvalidGrant' if the refresh token is expired/revoked.
 */
export async function refreshAccessToken(refreshToken) {
    try {
        const res = await axios.post(
            OAUTH_TOKEN_URL,
            new URLSearchParams({
                client_id: OAUTH_CLIENT_ID,
                refresh_token: refreshToken,
                grant_type: 'refresh_token',
            }).toString(),
            { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
        );

        const { access_token, expires_in } = res.data;
        const expiryDate = Date.now() + (expires_in - 60) * 1000;
        return { access_token, expiryDate };
    } catch (err) {
        const errorCode = err.response?.data?.error;
        if (errorCode === 'invalid_grant') {
            const e = new Error('Refresh token is invalid or revoked');
            e.name = 'InvalidGrant';
            throw e;
        }
        throw err;
    }
}

/**
 * Retrieve the first Google Cloud project for the authenticated user,
 * or create a managed one via Antigravity if none exists.
 */
export async function getProjectId(accessToken) {
    try {
        const res = await axios.get(
            'https://cloudresourcemanager.googleapis.com/v1/projects',
            {
                headers: { Authorization: `Bearer ${accessToken}` },
                params: { pageSize: 1 },
            },
        );

        const projects = res.data.projects || [];
        if (projects.length > 0) {
            return projects[0].projectId;
        }
    } catch {
        // Fall through to managed project creation
    }

    // Create a managed project via Antigravity endpoint
    for (const endpoint of ANTIGRAVITY_ENDPOINTS) {
        try {
            const res = await axios.post(
                `${endpoint}/v1internal/projects`,
                {},
                {
                    headers: {
                        Authorization: `Bearer ${accessToken}`,
                        'Content-Type': 'application/json',
                    },
                },
            );
            if (res.data?.projectId) {
                return res.data.projectId;
            }
        } catch {
            // Try next endpoint
        }
    }

    throw new Error(
        'Could not find or create a Google Cloud project for this account. ' +
        'Ensure the account has access to Google Cloud or create a project at console.cloud.google.com.',
    );
}

// ── Helpers ──

function generateState() {
    const arr = new Uint8Array(16);
    crypto.getRandomValues(arr);
    return Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join('');
}

function startCallbackServer(expectedState, authUrl) {
    return new Promise((resolve, reject) => {
        const app = express();
        const server = createServer(app);
        let settled = false;

        const timeout = setTimeout(() => {
            if (!settled) {
                settled = true;
                server.close();
                reject(new Error('OAuth login timed out after 5 minutes'));
            }
        }, 5 * 60 * 1000);

        app.get('/oauth-callback', (req, res) => {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);

            const { code, state, error } = req.query;

            res.send(
                '<html><body style="font-family:sans-serif;text-align:center;padding:2rem">' +
                    (error
                        ? `<h2>❌ Login failed: ${error}</h2>`
                        : '<h2>✅ Login successful! You can close this tab.</h2>') +
                    '</body></html>',
            );

            setTimeout(() => {
                server.close();
                if (error) {
                    reject(new Error(`OAuth error: ${error}`));
                } else {
                    resolve({ code, state });
                }
            }, 300);
        });

        server.listen(OAUTH_REDIRECT_PORT, () => {
            // Open the pre-built auth URL in the user's browser
            open(authUrl).catch(() => {});
        });

        server.on('error', (err) => {
            if (!settled) {
                settled = true;
                clearTimeout(timeout);
                reject(err);
            }
        });
    });
}
