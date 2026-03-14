// ═══════════════════════════════════════════════
// Auth UI — Full-screen Login / Register
// ═══════════════════════════════════════════════

import { signIn, signUp, signOut as authSignOut } from './auth.js';

/**
 * Render the auth screen into #auth-screen.
 * Returns { show(), hide(), updateUser(user) } controls.
 */
export function initAuthUI() {
    const container = document.getElementById('auth-screen');
    if (!container) return null;

    let mode = 'signin'; // 'signin' | 'register'

    container.innerHTML = `
        <div class="auth-backdrop"></div>
        <div class="auth-card">
            <div class="auth-logo">O</div>
            <h1 class="auth-title">Open<span class="auth-title-accent">Chat</span></h1>
            <p class="auth-subtitle">Your private AI chat workspace</p>

            <div class="auth-tabs">
                <button class="auth-tab active" data-tab="signin">Sign In</button>
                <button class="auth-tab" data-tab="register">Register</button>
            </div>

            <form class="auth-form" id="auth-form" autocomplete="off">
                <div class="auth-field">
                    <label for="auth-email">Email</label>
                    <input type="email" id="auth-email" placeholder="you@example.com"
                           required autocomplete="email" spellcheck="false" />
                </div>
                <div class="auth-field">
                    <label for="auth-password">Password</label>
                    <input type="password" id="auth-password" placeholder="••••••••"
                           required autocomplete="current-password" minlength="6" />
                </div>
                <div class="auth-field auth-confirm-field hidden" id="auth-confirm-field">
                    <label for="auth-confirm-password">Confirm Password</label>
                    <input type="password" id="auth-confirm-password" placeholder="••••••••"
                           autocomplete="new-password" minlength="6" />
                </div>
                <button type="submit" class="auth-submit" id="auth-submit">
                    <span class="auth-submit-text">Sign In</span>
                    <span class="auth-submit-spinner hidden"></span>
                </button>
            </form>

            <div class="auth-message hidden" id="auth-message"></div>
        </div>
    `;

    // Elements
    const form = container.querySelector('#auth-form');
    const emailInput = container.querySelector('#auth-email');
    const passwordInput = container.querySelector('#auth-password');
    const confirmField = container.querySelector('#auth-confirm-field');
    const confirmInput = container.querySelector('#auth-confirm-password');
    const submitBtn = container.querySelector('#auth-submit');
    const submitText = container.querySelector('.auth-submit-text');
    const submitSpinner = container.querySelector('.auth-submit-spinner');
    const messageEl = container.querySelector('#auth-message');
    const tabs = container.querySelectorAll('.auth-tab');

    // Tab switching
    tabs.forEach((tab) => {
        tab.addEventListener('click', () => {
            mode = tab.dataset.tab;
            tabs.forEach((t) => t.classList.toggle('active', t.dataset.tab === mode));
            submitText.textContent = mode === 'signin' ? 'Sign In' : 'Create Account';
            passwordInput.autocomplete = mode === 'signin' ? 'current-password' : 'new-password';
            confirmField.classList.toggle('hidden', mode === 'signin');
            confirmInput.required = mode === 'register';
            if (mode === 'signin') confirmInput.value = '';
            hideMessage();
        });
    });

    function showMessage(html, type = 'error') {
        messageEl.innerHTML = html;
        messageEl.className = `auth-message auth-message--${type}`;
        messageEl.classList.remove('hidden');
    }

    function hideMessage() {
        messageEl.classList.add('hidden');
    }

    function setLoading(loading) {
        submitBtn.disabled = loading;
        submitText.classList.toggle('hidden', loading);
        submitSpinner.classList.toggle('hidden', !loading);
        emailInput.disabled = loading;
        passwordInput.disabled = loading;
    }

    // Form submit
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        hideMessage();

        const email = emailInput.value.trim();
        const password = passwordInput.value;

        if (!email || !password) {
            showMessage('Please fill in all fields.');
            return;
        }

        if (password.length < 6) {
            showMessage('Password must be at least 6 characters.');
            return;
        }

        if (mode === 'register' && password !== confirmInput.value) {
            showMessage('Passwords do not match.');
            return;
        }

        setLoading(true);

        try {
            if (mode === 'signin') {
                const { error } = await signIn(email, password);
                if (error) {
                    if (error.toLowerCase().includes('email not confirmed')) {
                        showMessage(
                            `<strong>📧 Email not verified yet</strong><br>` +
                            `We sent a verification link to <strong>${email}</strong>. ` +
                            `Please check your inbox (and spam folder) and click the link to activate your account.`,
                            'info'
                        );
                    } else {
                        showMessage(error);
                    }
                }
                // Success is handled by onAuthStateChange — it will hide this screen
            } else {
                const { error } = await signUp(email, password);
                if (error) {
                    showMessage(error);
                }
                // If no verification needed, onAuthStateChange handles it
            }
        } catch (err) {
            showMessage('Something went wrong. Please try again.');
            console.error('Auth error:', err);
        } finally {
            setLoading(false);
        }
    });

    // Public controls
    return {
        show() {
            container.classList.remove('hidden');
            emailInput.focus();
        },
        hide() {
            container.classList.add('hidden');
            form.reset();
            hideMessage();
        },
    };
}

/**
 * Render user info + sign-out into the sidebar footer.
 */
export function renderUserInfo(user) {
    const footer = document.getElementById('sidebar-user');
    if (!footer) return;

    if (!user) {
        footer.innerHTML = '';
        footer.classList.add('hidden');
        return;
    }

    const email = user.email || 'User';
    const initial = email.charAt(0).toUpperCase();

    footer.innerHTML = `
        <div class="user-info">
            <div class="user-avatar">${initial}</div>
            <span class="user-email" title="${email}">${email}</span>
        </div>
        <button class="btn-sign-out" id="btn-sign-out" title="Sign out">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
                <polyline points="16 17 21 12 16 7"/>
                <line x1="21" y1="12" x2="9" y2="12"/>
            </svg>
        </button>
    `;
    footer.classList.remove('hidden');

    footer.querySelector('#btn-sign-out')?.addEventListener('click', async () => {
        await authSignOut();
    });
}
