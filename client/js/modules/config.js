// Configuration settings for the application

// API Configuration
export const API_BASE_URL = window.location.origin;

export const API_ENDPOINTS = {
    DATA: '/api/data',
    PROJECTS: '/api/projects',
    STATS: '/api/stats',
    HEALTH: '/api/health',
    // Auth endpoints
    AUTH_REGISTER: '/api/auth/register',
    AUTH_LOGIN: '/api/auth/login',
    AUTH_ME: '/api/auth/me'
};

// LocalStorage key for the JWT token
export const TOKEN_KEY = 'tracker_token';

// UI Configuration
export const VIEWS = {
    ACTIVE: 'active',
    COMPLETED: 'completed'
};

// Keyboard shortcuts configuration
export const SHORTCUTS = {
    NEW_PROJECT: 'n',
    TOGGLE_PANEL: 'c',
    TOGGLE_MENU: 'm',
    VIEW_ACTIVE: 'a',
    VIEW_COMPLETED: 'd',
    HELP: '?'
};
