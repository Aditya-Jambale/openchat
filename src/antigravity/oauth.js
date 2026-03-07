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
 * Start the OAuth 2.0 PKCE flow and return tokens + email + project_id.
 * Opens the user's browser for Google login, waits for the callback.
 */
export async function startOAuthFlow() {
    const { code_verifier, code_challenge } = await pkceChallenge();
    const state = generateState();

    const params = new URLSearchParams({
        client_id: OAUTH_CLIENT_ID,
        redirect_uri: OAUTH_REDIRECT_URI,
        response_type: 'code',
        scope: OAUTH_SCOPES.join(' '),
        code_challenge,
        code_challenge_method: 'S256',
        state,
        access_type: 'offline',
        prompt: 'consent',
    });

    const authUrl = `${OAUTH_AUTH_URL}?${params.toString()}`;

    // Start temporary callback server and wait for the auth code
    const { code: authCode, state: returnedState } = await startCallbackServer(state);

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

    // Last resort: generate a local placeholder
    return `openchat-${Date.now()}`;
}

// ── Helpers ──

function generateState() {
    const arr = new Uint8Array(16);
    crypto.getRandomValues(arr);
    return Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join('');
}

function startCallbackServer(expectedState) {
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
            // Open browser after server is ready
            const params = new URLSearchParams({
                client_id: OAUTH_CLIENT_ID,
                redirect_uri: OAUTH_REDIRECT_URI,
                response_type: 'code',
                scope: OAUTH_SCOPES.join(' '),
                state: expectedState,
                access_type: 'offline',
                prompt: 'consent',
            });
            open(`${OAUTH_AUTH_URL}?${params.toString()}`).catch(() => {});
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
