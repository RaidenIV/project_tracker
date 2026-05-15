// API layer — per-project CRUD + sharing + stats
// All requests include the JWT Authorization header.
// A 401 response forces a logout.

import { API_ENDPOINTS } from './config.js';
import { clearAppCookies, clearOversizedAuthStorage, getToken, logout, redirectToSessionReset } from './auth.js';

// ─── Internals ────────────────────────────────────────────────────────────────

function authHeaders(extra) {
    clearOversizedAuthStorage();
    const token = getToken();
    const headers = {
        'Content-Type': 'application/json',
        ...extra
    };
    if (token) headers.Authorization = `Bearer ${token}`;
    return headers;
}

async function request(method, url, body) {
    const opts = {
        method,
        headers: authHeaders(),
        credentials: 'omit',
        cache: 'no-store'
    };
    if (body !== undefined) opts.body = JSON.stringify(body);

    let res;
    try { res = await fetch(url, opts); }
    catch (err) { throw new Error(`Network error: ${err.message}`); }

    if (res.status === 401) { logout(); return null; }

    // 431 means the browser is sending headers that are too large. At this
    // point cookies have already been omitted from fetch requests, so reset
    // local/session auth storage before any more API calls can repeat the error.
    if (res.status === 431) {
        clearAppCookies();
        redirectToSessionReset('http-431-api');
        return new Promise(() => {});
    }

    try {
        sessionStorage.removeItem('tracker_431_cookie_cleanup_reload_v1');
    } catch {}

    let data;
    try { data = await res.json(); }
    catch { data = {}; }

    if (!res.ok) {
        const baseMsg = data.error || data.message || `HTTP ${res.status}`;
        const details = data.details ? ` (${data.details})` : '';
        const error = new Error(`${baseMsg}${details}`);
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

async function getLatestServerProjectForRetry(project) {
    const projectId = String(project?.id || project?._id || '');
    const projectMongoId = String(project?._id || '');
    if (!projectId && !projectMongoId) return null;

    try {
        const latestProjects = await loadProjectsFromServer();
        return latestProjects.find(candidate => {
            const candidateId = String(candidate?.id || '');
            const candidateMongoId = String(candidate?._id || '');
            return (projectId && (candidateId === projectId || candidateMongoId === projectId)) ||
                (projectMongoId && (candidateId === projectMongoId || candidateMongoId === projectMongoId));
        }) || null;
    } catch (err) {
        console.warn('Could not reload latest project before conflict retry:', err);
        return null;
    }
}

function hasTextContent(value) {
    return String(value ?? '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/gi, "'")
        .replace(/\s+/g, ' ')
        .trim().length > 0;
}

function normalizeProjectNotesCandidate(value = '') {
    if (typeof value === 'string') {
        const raw = value.trim();
        if ((raw.startsWith('{') && raw.endsWith('}')) || (raw.startsWith('[') && raw.endsWith(']'))) {
            try {
                const parsed = JSON.parse(raw);
                if (parsed && typeof parsed === 'object') {
                    if (parsed.__projectNotesTabs === true || Array.isArray(parsed.tabs)) return value;
                    return normalizeProjectNotesCandidate(parsed);
                }
            } catch {
                // Keep plain text that happens to contain braces/brackets.
            }
        }
        return value;
    }
    if (Array.isArray(value)) {
        try {
            return JSON.stringify({
                __projectNotesTabs: true,
                activeTabId: value[0]?.id || 'notes-general',
                tabs: value
            });
        } catch {
            return '';
        }
    }
    if (!value || typeof value !== 'object') return '';
    if (value.__projectNotesTabs === true || Array.isArray(value.tabs)) {
        try {
            return JSON.stringify({
                __projectNotesTabs: true,
                activeTabId: value.activeTabId || '',
                tabs: Array.isArray(value.tabs) ? value.tabs : []
            });
        } catch {
            return '';
        }
    }
    const legacyText = value.body ?? value.text ?? value.note ?? value.notes ?? value.content ?? value.html ?? value.value ?? '';
    if (typeof legacyText === 'string') return legacyText;
    if (legacyText && typeof legacyText === 'object') return normalizeProjectNotesCandidate(legacyText);
    return '';
}

function projectNotesHaveContent(notes) {
    const raw = normalizeProjectNotesCandidate(notes);
    if (!String(raw ?? '').trim()) return false;
    try {
        const parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.tabs)) {
            return parsed.tabs.some(tab => hasTextContent(tab?.body) || (Array.isArray(tab?.links) && tab.links.length > 0));
        }
    } catch {
        // Plain-text legacy notes are handled below.
    }
    return hasTextContent(raw);
}

function getBestProjectNotesValue(projectOrValue = {}, ...extraValues) {
    const values = projectOrValue && typeof projectOrValue === 'object' && !Array.isArray(projectOrValue)
        ? [
            projectOrValue.notes,
            projectOrValue.projectNotes,
            projectOrValue.projectNote,
            projectOrValue.notesData,
            projectOrValue.noteTabs,
            projectOrValue.noteTabsData,
            projectOrValue.note,
            ...extraValues
        ]
        : [projectOrValue, ...extraValues];
    const normalizedValues = values
        .map(normalizeProjectNotesCandidate)
        .filter(value => String(value ?? '').trim().length > 0);
    return normalizedValues.find(projectNotesHaveContent) || normalizedValues[0] || '';
}

function mergeLatestNotesForConflictRetry(localProject = {}, latestProject = {}) {
    const localNotes = getBestProjectNotesValue(localProject);
    const latestNotes = getBestProjectNotesValue(latestProject);
    const localHasNotes = projectNotesHaveContent(localNotes);
    const latestHasNotes = projectNotesHaveContent(latestNotes);
    return !localHasNotes && latestHasNotes ? latestNotes : localNotes;
}

function taskHasNoteField(task = {}) {
    return !!task && typeof task === 'object' && (
        Object.prototype.hasOwnProperty.call(task, 'note') ||
        Object.prototype.hasOwnProperty.call(task, 'notes')
    );
}

function mergeLatestTaskNotesForConflictRetry(localTasks = [], latestTasks = []) {
    if (!Array.isArray(localTasks) || !Array.isArray(latestTasks) || !latestTasks.length) {
        return Array.isArray(localTasks) ? localTasks : [];
    }

    const latestById = new Map(latestTasks.map(task => [String(task?.id ?? ''), task]));
    return localTasks.map(task => {
        const latestTask = latestById.get(String(task?.id ?? ''));
        const localNote = task?.note ?? task?.notes ?? '';
        const latestNote = latestTask?.note ?? latestTask?.notes ?? '';
        if (!hasTextContent(localNote) && hasTextContent(latestNote)) {
            return { ...task, note: latestNote };
        }
        return task;
    });
}


export async function saveProjectToServer(project) {
    if (!project._id) {
        return { ok: false, skipped: true };
    }

    const projectEndpointId = project._id;
    const buildPayload = (knownLastModified) => ({
        ...project,
        __clientKnownLastModified: knownLastModified || project.__syncedLastModified || project.lastModified || null
    });

    try {
        const savedProject = await request('PUT', API_ENDPOINTS.PROJECT(projectEndpointId), buildPayload(project.__syncedLastModified || project.lastModified || null));
        return { ok: true, project: savedProject };
    } catch (err) {
        const isConflict = err.code === 'PROJECT_CONFLICT' || err.status === 409;
        if (isConflict) {
            const latestProject = await getLatestServerProjectForRetry(project);
            const latestModified = latestProject?.lastModified || latestProject?.updatedAt || null;
            if (latestModified) {
                try {
                    const retryEndpointId = latestProject?._id || projectEndpointId;
                    const retryPayload = {
                        ...buildPayload(latestModified),
                        notes: mergeLatestNotesForConflictRetry(project, latestProject),
                        tasks: mergeLatestTaskNotesForConflictRetry(project.tasks, latestProject?.tasks),
                        _id: latestProject?._id || project._id,
                        id: project.id || latestProject?.id || latestProject?._id
                    };
                    const savedProject = await request('PUT', API_ENDPOINTS.PROJECT(retryEndpointId), retryPayload);
                    return { ok: true, project: savedProject, retriedConflict: true };
                } catch (retryErr) {
                    console.error('Conflict retry failed while saving project:', retryErr);
                    return {
                        ok: false,
                        conflict: retryErr.code === 'PROJECT_CONFLICT' || retryErr.status === 409,
                        message: retryErr.message,
                        projectId: project.id || project._id
                    };
                }
            }
        }

        console.error('Error saving project:', err);
        return {
            ok: false,
            conflict: isConflict,
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

export async function loadLeaderboardFromServer() {
    try {
        return await request('GET', API_ENDPOINTS.LEADERBOARD) || { currentUser: null, leaders: [] };
    } catch (err) {
        console.error('Error loading leaderboard:', err);
        return { currentUser: null, leaders: [] };
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
