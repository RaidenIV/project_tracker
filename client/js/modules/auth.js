// Authentication module
// Handles JWT-based login, registration, and logout.

import { API_ENDPOINTS, TOKEN_KEY } from './config.js';

// ─── Token Helpers ────────────────────────────────────────────────────────────

export function getToken() {
    return localStorage.getItem(TOKEN_KEY);
}

function setToken(token) {
    localStorage.setItem(TOKEN_KEY, token);
}

function clearToken() {
    localStorage.removeItem(TOKEN_KEY);
}

export function isLoggedIn() {
    const token = getToken();
    if (!token) return false;
    try {
        // Decode payload (not a security check — server validates the signature)
        const payload = JSON.parse(atob(token.split('.')[1]));
        return payload.exp * 1000 > Date.now();
    } catch {
        return false;
    }
}

export function getCurrentUser() {
    const token = getToken();
    if (!token) return null;
    try {
        const payload = JSON.parse(atob(token.split('.')[1]));
        return { id: payload.id, email: payload.email, username: payload.username };
    } catch {
        return null;
    }
}

// ─── API Calls ────────────────────────────────────────────────────────────────

export async function register(email, username, password) {
    const response = await fetch(API_ENDPOINTS.AUTH_REGISTER, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, username, password })
    });

    const data = await response.json();

    if (!response.ok) {
        throw new Error(data.error || 'Registration failed');
    }

    setToken(data.token);
    return data.user;
}

export async function login(email, password) {
    const response = await fetch(API_ENDPOINTS.AUTH_LOGIN, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
    });

    const data = await response.json();

    if (!response.ok) {
        throw new Error(data.error || 'Login failed');
    }

    setToken(data.token);
    return data.user;
}

export function logout() {
    clearToken();
    // Reload so the auth screen is shown cleanly
    window.location.reload();
}

// ─── Legacy stubs (kept so projects.js imports still resolve) ─────────────────

export function checkPassword() { return true; }
export function requireAdmin() { return true; }
export function initializePasswordPrompt() {}
