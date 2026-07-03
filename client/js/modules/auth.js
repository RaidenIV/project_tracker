// Authentication module
// Handles JWT-based login, registration, and logout.

import { API_ENDPOINTS, TOKEN_KEY } from './config.js';


const COOKIE_EXPIRY = 'Thu, 01 Jan 1970 00:00:00 GMT';
const SAFE_AUTH_TOKEN_MAX_CHARS = 4096;
const RESET_PAGE_PATH = '/reset-session.html';
const LEGACY_AUTH_STORAGE_KEYS = [
    TOKEN_KEY,
    'authToken',
    'token',
    'jwt',
    'session',
    'tracker_auth',
    'tracker_session',
    'project_tracker_token'
];

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

function getStorageItem(storage, key) {
    try { return storage?.getItem?.(key) || ''; }
    catch { return ''; }
}

function removeStorageItem(storage, key) {
    try { storage?.removeItem?.(key); }
    catch {}
}

function getStoredToken() {
    return getStorageItem(localStorage, TOKEN_KEY) || getStorageItem(sessionStorage, TOKEN_KEY);
}

function isJwtShaped(token) {
    return typeof token === 'string'
        && /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token);
}

export function isSafeAuthToken(token) {
    if (!token || typeof token !== 'string') return false;
    if (token.length > SAFE_AUTH_TOKEN_MAX_CHARS) return false;
    return isJwtShaped(token);
}

export function clearToken() {
    removeStorageItem(localStorage, TOKEN_KEY);
    removeStorageItem(sessionStorage, TOKEN_KEY);
}

export function clearLegacyAuthStorage() {
    let cleared = false;
    [localStorage, sessionStorage].forEach(storage => {
        LEGACY_AUTH_STORAGE_KEYS.forEach(key => {
            const value = getStorageItem(storage, key);
            if (value) {
                removeStorageItem(storage, key);
                cleared = true;
            }
        });
    });
    return cleared;
}

export function clearOversizedAuthStorage() {
    let cleared = false;
    [localStorage, sessionStorage].forEach(storage => {
        LEGACY_AUTH_STORAGE_KEYS.forEach(key => {
            const value = getStorageItem(storage, key);
            if (!value) return;
            const isTrackerToken = key === TOKEN_KEY;
            const isOversized = value.length > SAFE_AUTH_TOKEN_MAX_CHARS;
            const isMalformedTrackerToken = isTrackerToken && !isJwtShaped(value);
            if (isOversized || isMalformedTrackerToken) {
                removeStorageItem(storage, key);
                cleared = true;
            }
        });
    });
    return cleared;
}

export function clearClientSessionData() {
    clearLegacyAuthStorage();
    clearAppCookies();
    try { sessionStorage.removeItem('tracker_431_cookie_cleanup_reload_v1'); } catch {}
    try { sessionStorage.removeItem('tracker_session_reset_redirecting_v1'); } catch {}
}

export function redirectToSessionReset(reason = 'session-reset') {
    clearClientSessionData();
    if (typeof window === 'undefined') return;

    try {
        const resetUrl = new URL(RESET_PAGE_PATH, window.location.origin);
        resetUrl.searchParams.set('reason', reason);
        resetUrl.searchParams.set('return', '/');
        window.location.replace(resetUrl.toString());
    } catch {
        window.location.href = RESET_PAGE_PATH;
    }
}

function decodeJwtPayload(token) {
    const payload = token.split('.')[1];
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    return JSON.parse(atob(padded));
}

async function readJson(response) {
    try { return await response.json(); }
    catch { return {}; }
}

async function handleAuthResponse(response, fallbackMessage) {
    if (response.status === 431) {
        redirectToSessionReset('http-431-auth');
        return new Promise(() => {});
    }

    const data = await readJson(response);

    if (!response.ok) {
        throw new Error(data.error || fallbackMessage);
    }

    if (!isSafeAuthToken(data.token)) {
        throw new Error('The server returned an invalid login token. Please try again.');
    }

    setToken(data.token);
    return data.user;
}

clearAppCookies();
clearOversizedAuthStorage();

// ─── Token Helpers ────────────────────────────────────────────────────────────

export function getToken() {
    const token = getStoredToken();
    if (!token) return null;
    if (!isSafeAuthToken(token)) {
        clearToken();
        return null;
    }
    return token;
}

function setToken(token) {
    clearOversizedAuthStorage();
    localStorage.setItem(TOKEN_KEY, token);
}

export function isLoggedIn() {
    const token = getToken();
    if (!token) return false;
    try {
        // Decode payload (not a security check — server validates the signature)
        const payload = decodeJwtPayload(token);
        return payload.exp * 1000 > Date.now();
    } catch {
        clearToken();
        return false;
    }
}

export function getCurrentUser() {
    const token = getToken();
    if (!token) return null;
    try {
        const payload = decodeJwtPayload(token);
        return { id: payload.id, email: payload.email, username: payload.username, role: payload.role || 'user' };
    } catch {
        clearToken();
        return null;
    }
}

// ─── API Calls ────────────────────────────────────────────────────────────────

export async function register(email, username, password) {
    clearAppCookies();
    clearOversizedAuthStorage();
    const response = await fetch(API_ENDPOINTS.AUTH_REGISTER, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'omit',
        cache: 'no-store',
        body: JSON.stringify({ email, username, password })
    });

    return handleAuthResponse(response, 'Registration failed');
}

export async function login(email, password) {
    clearAppCookies();
    clearOversizedAuthStorage();
    const response = await fetch(API_ENDPOINTS.AUTH_LOGIN, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'omit',
        cache: 'no-store',
        body: JSON.stringify({ email, password })
    });

    return handleAuthResponse(response, 'Login failed');
}

export function logout() {
    clearToken();
    clearAppCookies();
    // Reload so the auth screen is shown cleanly
    window.location.reload();
}

// ─── Legacy stubs (kept so projects.js imports still resolve) ─────────────────

export function checkPassword() { return true; }
export function requireAdmin() { return true; }
export function initializePasswordPrompt() {}
