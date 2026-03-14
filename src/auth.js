// ═══════════════════════════════════════════════
// Auth — Supabase Authentication
// ═══════════════════════════════════════════════

import { supabase } from './supabase.js';

/**
 * Check for an existing session on app load.
 * @returns {import('@supabase/supabase-js').User | null}
 */
export async function initAuth() {
    const { data: { session }, error } = await supabase.auth.getSession();
    if (error) {
        console.error('Error checking session:', error.message);
        return null;
    }
    return session?.user ?? null;
}

/**
 * Sign in with email + password.
 * @returns {{ user: object|null, error: string|null }}
 */
export async function signIn(email, password) {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return { user: null, error: error.message };
    return { user: data.user, error: null };
}

/**
 * Register a new account with email + password.
 * @returns {{ user: object|null, error: string|null, needsVerification: boolean }}
 */
export async function signUp(email, password) {
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) return { user: null, error: error.message, needsVerification: false };

    // If email confirmation is required, user will have identities but no confirmed_at
    const needsVerification = data.user && !data.user.confirmed_at;
    return { user: data.user, error: null, needsVerification };
}

/**
 * Sign out the current user.
 */
export async function signOut() {
    const { error } = await supabase.auth.signOut();
    if (error) console.error('Error signing out:', error.message);
}

/**
 * Get the currently authenticated user (synchronous from cached session).
 * @returns {import('@supabase/supabase-js').User | null}
 */
export async function getCurrentUser() {
    const { data: { user } } = await supabase.auth.getUser();
    return user;
}

/**
 * Subscribe to auth state changes.
 * @param {(user: object|null) => void} callback
 * @returns {{ data: { subscription: object } }}
 */
export function onAuthStateChange(callback) {
    return supabase.auth.onAuthStateChange((_event, session) => {
        callback(session?.user ?? null);
    });
}
