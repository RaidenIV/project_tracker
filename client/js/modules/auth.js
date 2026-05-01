// Authentication module
// Handles JWT-based login, registration, and logout.

import { API_ENDPOINTS, TOKEN_KEY } from './config.js';


const COOKIE_EXPIRY = 'Thu, 01 Jan 1970 00:00:00 GMT';

function getCookieClearDomains() {
    if (typeof window === 'undefined') return [null];
    const host = window.location.hostname;
    if (!host || host === 'localhost' || /^\d+\.\d+\.\d+\.\d+$/.test(host)) return [null];
    const domains = [null, host, `.${host}`];
    const parts = host.split('.').filter(Boolean);
    if (parts.length > 2) {
        const rootDomain = parts.slice(-2).join('.');
        domains.push(rootDomain, `.${rootDomain}`);
    }
    return [...new Set(domains)];
}

export function clearAppCookies() {
    if (typeof document === 'undefined' || !document.cookie) return false;
    const names = document.cookie
        .split(';')
        .map(part => part.split('=')[0]?.trim())
        .filter(Boolean)
        .filter((name, index, names) => names.indexOf(name) === index);

    if (!names.length) return false;

    const domains = getCookieClearDomains();
    names.forEach(name => {
        document.cookie = `${name}=; expires=${COOKIE_EXPIRY}; max-age=0; path=/; SameSite=Lax`;
        domains.forEach(domain => {
            if (domain) {
                document.cookie = `${name}=; expires=${COOKIE_EXPIRY}; max-age=0; path=/; domain=${domain}; SameSite=Lax`;
            }
        });
    });
    return true;
}

clearAppCookies();

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
    clearAppCookies();
    const response = await fetch(API_ENDPOINTS.AUTH_REGISTER, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'omit',
        cache: 'no-store',
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
    clearAppCookies();
    const response = await fetch(API_ENDPOINTS.AUTH_LOGIN, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'omit',
        cache: 'no-store',
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
