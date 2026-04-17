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

    // 431 means the browser is sending headers that are too large (usually
    // accumulated cookies). Surface a clear message instead of a cryptic code.
    if (res.status === 431) {
        throw new Error(
            'Request headers too large (HTTP 431). ' +
            'Try clearing your cookies for this site, then reload.'
        );
    }

    let data;
    try { data = await res.json(); }
    catch { data = {}; }

    if (!res.ok) {
        const msg = data.error || data.message || `HTTP ${res.status}`;
        const error = new Error(msg);
        error.status = res.status;
        error.code = data.code || '';
        error.payload = data;
        throw error;
    }
    return data;
}

// ─── Projects ─────────────────────────────────────────────────────────────────

export async function loadProjectsFromServer() {
    // Let errors propagate to loadDataFromServer / loadData so the UI
    // can surface a meaningful error instead of silently returning [].
    return await request('GET', API_ENDPOINTS.PROJECTS) || [];
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
        return { ok: false, skipped: true };
    }
    try {
        const payload = { ...project, __clientKnownLastModified: project.lastModified || null };
        const savedProject = await request('PUT', API_ENDPOINTS.PROJECT(project._id), payload);
        return { ok: true, project: savedProject };
    } catch (err) {
        console.error('Error saving project:', err);
        return {
            ok: false,
            conflict: err.code === 'PROJECT_CONFLICT' || err.status === 409,
            message: err.message,
            projectId: project.id || project._id
        };
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


export async function archiveProjectOnServer(_id) {
    return request('PUT', API_ENDPOINTS.PROJECT(_id), { archived: true });
}

export async function restoreProjectOnServer(_id) {
    return request('PUT', API_ENDPOINTS.PROJECT(_id), { archived: false });
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
    // Let errors propagate so loadData can catch and surface them.
    return await request('GET', API_ENDPOINTS.STATS) || { completedTasks: 0, completedProjects: 0 };
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


function isProjectDirty(project) {
    if (!project?._id || project.userRole === 'viewer') return false;
    const current = project.lastModified || project.dateCreated || null;
    const synced = project.__syncedLastModified || null;
    return !synced || current !== synced;
}


// Loads projects and stats in parallel. Errors are intentionally not caught
// here — they propagate to loadData() in main.js, which handles UI feedback.
export async function loadDataFromServer() {
    const [projects, stats] = await Promise.all([
        loadProjectsFromServer(),
        loadStatsFromServer()
    ]);
    return { projects, stats };
}

export async function saveDataToServer(projects, stats) {
    const saves = projects
        .filter(isProjectDirty)
        .map(p => saveProjectToServer(p));

    const [saveResults, statsOk] = await Promise.all([
        Promise.all(saves),
        saveStatsToServer(stats)
    ]);

    const conflicts = saveResults.filter(result => result && !result.ok && result.conflict);
    const failures = saveResults.filter(result => result && !result.ok && !result.skipped);
    const savedProjects = saveResults.filter(result => result?.ok).map(result => result.project);

    return {
        ok: failures.length === 0 && conflicts.length === 0 && statsOk,
        conflicts,
        failures,
        savedProjects
    };
}


const ACCOUNT_BASE = '/api/account';

export async function loadAccountProfileFromServer() {
    return request('GET', ACCOUNT_BASE);
}

export async function updateAccountProfileOnServer(payload) {
    return request('PUT', ACCOUNT_BASE, payload);
}
