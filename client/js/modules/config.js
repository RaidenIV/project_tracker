// Configuration settings for the application

export const API_BASE_URL = window.location.origin;

export const API_ENDPOINTS = {
    PROJECTS:     '/api/projects',
    PROJECT:      (id)         => `/api/projects/${id}`,
    PRIORITIES:   '/api/projects/priorities',
    SHARE:        (id)         => `/api/projects/${id}/share`,
    COLLABORATOR: (id, userId) => `/api/projects/${id}/collaborators/${userId}`,
    STATS:        '/api/stats',
    LEADERBOARD:  '/api/leaderboard',
    AUTH_REGISTER: '/api/auth/register',
    AUTH_LOGIN:    '/api/auth/login',
    AUTH_ME:       '/api/auth/me',
    ANALYTICS_EVENTS: '/api/analytics/events',
    ADMIN_ANALYTICS: {
        OVERVIEW:    '/api/admin/analytics/overview',
        USERS:       '/api/admin/analytics/users',
        PROJECTS:    '/api/admin/analytics/projects',
        TASKS:       '/api/admin/analytics/tasks',
        FEATURES:    '/api/admin/analytics/features',
        DEVICES:     '/api/admin/analytics/devices',
        PERFORMANCE: '/api/admin/analytics/performance',
        ERRORS:      '/api/admin/analytics/errors',
        BACKFILL:    '/api/admin/analytics/backfill',
        BACKFILL_STATUS: '/api/admin/analytics/backfill/status'
    },
    HEALTH:        '/api/health'
};

export const TOKEN_KEY = 'tracker_token';

export const VIEWS = {
    ACTIVE:    'active',
    COMPLETED: 'completed',
    ARCHIVED:  'archived'
};

export const SHORTCUTS = {
    NEW_PROJECT:    'n',
    TOGGLE_PANEL:   'c',
    TOGGLE_MENU:    'm',
    VIEW_ACTIVE:    'a',
    VIEW_COMPLETED: 'd',
    HELP:           '?'
};

export const ROLES = { OWNER: 'owner', EDITOR: 'editor', VIEWER: 'viewer' };
