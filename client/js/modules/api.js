// API layer — per-project CRUD + sharing + stats
// All requests include the JWT Authorization header.
// A 401 response forces a logout.

import { API_ENDPOINTS } from './config.js';
import { getToken, logout } from './auth.js';

// ─── Internals ────────────────────────────────────────────────────────────────

function authHeaders(extra) {
    const token = getToken();
    return {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        ...extra
    };
}

async function request(method, url, body) {
    const opts = { method, headers: authHeaders() };
    if (body !== undefined) opts.body = JSON.stringify(body);

    let res;
    try { res = await fetch(url, opts); }
    catch (err) { throw new Error(`Network error: ${err.message}`); }

    if (res.status === 401) { logout(); return null; }

    let data;
    try { data = await res.json(); }
    catch { data = {}; }

    if (!res.ok) {
        const msg = data.error || data.message || `HTTP ${res.status}`;
        throw new Error(msg);
    }
    return data;
}

// ─── Projects ─────────────────────────────────────────────────────────────────

export async function loadProjectsFromServer() {
    try {
        return await request('GET', API_ENDPOINTS.PROJECTS) || [];
    } catch (err) {
        console.error('Error loading projects:', err);
        return [];
    }
}

export async function createProjectOnServer(project) {
    try {
        return await request('POST', API_ENDPOINTS.PROJECTS, project);
    } catch (err) {
        console.error('Error creating project:', err);
        alert(`Failed to create project: ${err.message}`);
        return null;
    }
}

export async function saveProjectToServer(project) {
    if (!project._id) {
        console.warn('saveProjectToServer called without _id — skipping');
        return false;
    }
    try {
        await request('PUT', API_ENDPOINTS.PROJECT(project._id), project);
        return true;
    } catch (err) {
        console.error('Error saving project:', err);
        alert(`Failed to save project: ${err.message}`);
        return false;
    }
}

export async function deleteProjectFromServer(_id) {
    if (!_id) return false;
    try {
        await request('DELETE', API_ENDPOINTS.PROJECT(_id));
        return true;
    } catch (err) {
        console.error('Error deleting project:', err);
        alert(`Failed to delete project: ${err.message}`);
        return false;
    }
}

export async function reorderProjectsOnServer(projects) {
    try {
        const priorities = projects
            .filter(p => p._id)
            .map(p => ({ _id: p._id, priority: p.priority }));
        await request('PATCH', API_ENDPOINTS.PRIORITIES, { priorities });
        return true;
    } catch (err) {
        console.error('Error reordering projects:', err);
        return false;
    }
}

// ─── Sharing ──────────────────────────────────────────────────────────────────

export async function shareProjectOnServer(_id, email, role) {
    return request('POST', API_ENDPOINTS.SHARE(_id), { email, role });
}

export async function updateCollaboratorRoleOnServer(_id, userId, role) {
    return request('PUT', API_ENDPOINTS.COLLABORATOR(_id, userId), { role });
}

export async function removeCollaboratorFromServer(_id, userId) {
    return request('DELETE', API_ENDPOINTS.COLLABORATOR(_id, userId));
}

const NOTIFICATIONS_BASE = '/api/notifications';

export async function loadNotificationsFromServer(limit = 25) {
    try {
        return await request('GET', `${NOTIFICATIONS_BASE}?limit=${limit}`) || { notifications: [], unreadCount: 0 };
    } catch (err) {
        console.error('Error loading notifications:', err);
        return { notifications: [], unreadCount: 0 };
    }
}

export async function markNotificationReadOnServer(notificationId) {
    return request('POST', `${NOTIFICATIONS_BASE}/${notificationId}/read`);
}

export async function markAllNotificationsReadOnServer() {
    return request('POST', `${NOTIFICATIONS_BASE}/read-all`);
}

// ─── Stats ────────────────────────────────────────────────────────────────────

export async function loadStatsFromServer() {
    try {
        return await request('GET', API_ENDPOINTS.STATS) || { completedTasks: 0, completedProjects: 0 };
    } catch (err) {
        console.error('Error loading stats:', err);
        return { completedTasks: 0, completedProjects: 0 };
    }
}

export async function saveStatsToServer(stats) {
    try {
        await request('PUT', API_ENDPOINTS.STATS, stats);
        return true;
    } catch (err) {
        console.error('Error saving stats:', err);
        return false;
    }
}

// ─── Health ───────────────────────────────────────────────────────────────────

export async function checkServerHealth() {
    try {
        return await request('GET', API_ENDPOINTS.HEALTH);
    } catch (err) {
        console.error('Health check failed:', err);
        return null;
    }
}

// ─── Legacy compat shim ───────────────────────────────────────────────────────
// main.js's saveData() calls saveDataToServer(projects, stats).
// We translate that into individual saves + stats save here.

export async function loadDataFromServer() {
    const [projects, stats] = await Promise.all([
        loadProjectsFromServer(),
        loadStatsFromServer()
    ]);
    return { projects, stats };
}

export async function saveDataToServer(projects, stats) {
    const saves = projects
        .filter(p => p._id && p.userRole !== 'viewer')
        .map(p => saveProjectToServer(p));
    const statsSave = saveStatsToServer(stats);
    const results = await Promise.all([...saves, statsSave]);
    return results.every(Boolean);
}
