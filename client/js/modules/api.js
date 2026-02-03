// API calls to server
// Enhanced error reporting: surfaces HTTP status + server response payload for faster debugging.

import { API_ENDPOINTS } from './config.js';

const ADMIN_TOKEN_KEY = 'adminToken';

export function getAdminToken() {
    try {
        return localStorage.getItem(ADMIN_TOKEN_KEY) || '';
    } catch {
        return '';
    }
}

export function setAdminToken(token) {
    try {
        localStorage.setItem(ADMIN_TOKEN_KEY, token);
    } catch {
        // ignore
    }
}

export function clearAdminToken() {
    try {
        localStorage.removeItem(ADMIN_TOKEN_KEY);
    } catch {
        // ignore
    }
}

function withAuthHeaders(headers = {}) {
    const token = getAdminToken();
    if (token) {
        return { ...headers, Authorization: `Bearer ${token}` };
    }
    return headers;
}

async function readJsonSafe(response) {
    const text = await response.text();
    if (!text) return { text: '', json: null };
    try {
        return { text, json: JSON.parse(text) };
    } catch {
        return { text, json: null };
    }
}

function buildHttpError(prefix, url, response, payload) {
    let msg = `${prefix} (${response.status} ${response.statusText}) @ ${url}`;

    // Prefer structured server fields when present
    const j = payload?.json;
    if (j && typeof j === 'object') {
        const serverErr = j.error || j.err || j.details || j.message;
        if (serverErr) msg += `\nServer: ${serverErr}`;
    } else if (payload?.text) {
        // Fall back to raw body (trimmed)
        const body = payload.text.trim();
        if (body) msg += `\nResponse: ${body.slice(0, 800)}`;
    }

    return new Error(msg);
}

// --- Auth ---

export async function loginAdmin(password) {
    const url = API_ENDPOINTS.AUTH_LOGIN;

    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password })
    });

    const payload = await readJsonSafe(response);
    if (!response.ok) {
        throw buildHttpError('Login failed', url, response, payload);
    }

    const token = payload.json?.token;
    if (!token || typeof token !== 'string') {
        throw new Error('Login failed: server did not return a token');
    }

    setAdminToken(token);
    return token;
}

export async function verifyAdminToken() {
    const url = API_ENDPOINTS.AUTH_ME;

    const response = await fetch(url, {
        method: 'GET',
        headers: withAuthHeaders()
    });

    const payload = await readJsonSafe(response);
    if (!response.ok) return false;

    return payload.json?.admin === true;
}

// --- Data ---

export async function loadDataFromServer() {
    const url = API_ENDPOINTS.DATA;
    try {
        const response = await fetch(url);
        const payload = await readJsonSafe(response);

        if (!response.ok) {
            throw buildHttpError('Failed to fetch data', url, response, payload);
        }

        const data = payload.json || {};
        return {
            projects: data.projects || [],
            stats: data.stats || { completedTasks: 0, completedProjects: 0 }
        };
    } catch (error) {
        console.error('Error loading data:', error);
        // Return empty data as fallback
        return {
            projects: [],
            stats: { completedTasks: 0, completedProjects: 0 }
        };
    }
}

export async function saveDataToServer(projects, stats) {
    const url = API_ENDPOINTS.DATA;
    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: withAuthHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({ projects, stats })
        });

        const payload = await readJsonSafe(response);

        if (!response.ok) {
            throw buildHttpError('Failed to save data', url, response, payload);
        }

        console.log('✅ Data saved to MongoDB:', payload.json?.message ?? 'ok');
        return true;
    } catch (error) {
        console.error('❌ Error saving data:', error);
        alert(error?.message || 'Failed to save data. Please check your connection.');
        return false;
    }
}

export async function checkServerHealth() {
    const url = API_ENDPOINTS.HEALTH;
    try {
        const response = await fetch(url);
        const payload = await readJsonSafe(response);

        if (!response.ok) {
            throw buildHttpError('Health check failed', url, response, payload);
        }

        console.log('Server health:', payload.json);
        return payload.json;
    } catch (error) {
        console.error('Error checking server health:', error);
        return null;
    }
}
