// Lightweight analytics client for TaskCom.
// Sends authenticated, non-blocking analytics events to MongoDB via the app API.

import { API_ENDPOINTS } from './config.js';
import { getToken } from './auth.js';

const ALLOWED_EVENTS = new Set([
    'session_started',
    'project_created',
    'project_completed',
    'project_archived',
    'task_created',
    'task_completed',
    'task_deleted',
    'task_reordered',
    'task_pasted',
    'note_created',
    'member_added',
    'calendar_task_dragged',
    'notification_opened',
    'achievement_unlocked',
    'settings_changed',
    'search_used',
    'sort_changed',
    'layout_changed',
    'api_request',
    'api_error',
    'client_error'
]);

const EVENT_ENDPOINT = API_ENDPOINTS.ANALYTICS_EVENTS || '/api/analytics/events';
const SESSION_STORAGE_KEY = 'taskcom_session_started_analytics_v1';
const safeJsonHeaders = { 'Content-Type': 'application/json' };
let errorListenersInstalled = false;

function safeNumber(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}

function getBrowserName() {
    const ua = navigator.userAgent || '';
    if (/Edg\//.test(ua)) return 'Edge';
    if (/Chrome\//.test(ua) && !/Chromium\//.test(ua)) return 'Chrome';
    if (/Safari\//.test(ua) && !/Chrome\//.test(ua)) return 'Safari';
    if (/Firefox\//.test(ua)) return 'Firefox';
    return 'Unknown';
}

function getOsName() {
    const ua = navigator.userAgent || '';
    if (/Windows NT/.test(ua)) return 'Windows';
    if (/iPhone|iPad|iPod/.test(ua)) return 'iOS';
    if (/Android/.test(ua)) return 'Android';
    if (/Mac OS X/.test(ua)) return 'macOS';
    if (/Linux/.test(ua)) return 'Linux';
    return 'Unknown';
}

function getDeviceType() {
    const width = safeNumber(window.innerWidth, 0);
    const ua = navigator.userAgent || '';
    if (/iPad|Tablet/.test(ua)) return 'tablet';
    if (/Mobi|Android|iPhone|iPod/.test(ua) || width <= 767) return 'mobile';
    if (width <= 1024) return 'tablet';
    return 'desktop';
}

export function getAnalyticsDevice() {
    return {
        viewportWidth: safeNumber(window.innerWidth),
        viewportHeight: safeNumber(window.innerHeight),
        screenWidth: safeNumber(window.screen?.width),
        screenHeight: safeNumber(window.screen?.height),
        browser: getBrowserName(),
        os: getOsName(),
        deviceType: getDeviceType()
    };
}

function sanitizeMetadata(metadata = {}) {
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return {};
    return Object.fromEntries(Object.entries(metadata).slice(0, 40));
}

export function trackEvent(event, metadata = {}) {
    if (!ALLOWED_EVENTS.has(event)) return;
    const token = getToken?.();
    if (!token) return;

    const payload = JSON.stringify({
        event,
        metadata: sanitizeMetadata(metadata),
        device: getAnalyticsDevice()
    });

    try {
        fetch(EVENT_ENDPOINT, {
            method: 'POST',
            headers: { ...safeJsonHeaders, Authorization: `Bearer ${token}` },
            credentials: 'omit',
            cache: 'no-store',
            keepalive: true,
            body: payload
        }).catch(() => {});
    } catch {
        // Analytics must never block app usage.
    }
}

export function trackSessionStarted(user = {}) {
    try {
        const currentSession = sessionStorage.getItem(SESSION_STORAGE_KEY);
        if (currentSession) return;
        sessionStorage.setItem(SESSION_STORAGE_KEY, String(Date.now()));
    } catch {}

    trackEvent('session_started', {
        userId: user?.id || '',
        emailDomain: String(user?.email || '').split('@')[1] || '',
        path: window.location.pathname
    });
}

export function trackApiRequest({ method = 'GET', url = '', status = 0, durationMs = 0, ok = false, error = '' } = {}) {
    trackEvent('api_request', {
        method,
        url: String(url || '').replace(window.location.origin, '').slice(0, 180),
        status: safeNumber(status),
        durationMs: Math.round(safeNumber(durationMs)),
        ok: !!ok
    });

    if (!ok || safeNumber(status) >= 400 || error) {
        trackEvent('api_error', {
            method,
            url: String(url || '').replace(window.location.origin, '').slice(0, 180),
            status: safeNumber(status),
            durationMs: Math.round(safeNumber(durationMs)),
            error: String(error || `HTTP ${status}`).slice(0, 500)
        });
    }
}

export function installClientErrorTracking() {
    if (errorListenersInstalled) return;
    errorListenersInstalled = true;

    window.addEventListener('error', event => {
        trackEvent('client_error', {
            message: String(event.message || '').slice(0, 500),
            source: String(event.filename || '').slice(0, 180),
            line: safeNumber(event.lineno),
            column: safeNumber(event.colno),
            stack: String(event.error?.stack || '').slice(0, 1200),
            path: window.location.pathname
        });
    });

    window.addEventListener('unhandledrejection', event => {
        trackEvent('client_error', {
            message: String(event.reason?.message || event.reason || 'Unhandled promise rejection').slice(0, 500),
            stack: String(event.reason?.stack || '').slice(0, 1200),
            path: window.location.pathname
        });
    });
}
