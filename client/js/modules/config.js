// Configuration settings for the application

// PASSWORD CONFIGURATION - CHANGE THE PASSWORD HERE
export const ADMIN_PASSWORD = "admin123";  // ← CHANGE PASSWORD HERE

// API Configuration
export const API_BASE_URL = window.location.origin;

export const API_ENDPOINTS = {
    DATA: '/api/data',
    PROJECTS: '/api/projects',
    STATS: '/api/stats',
    HEALTH: '/api/health'
};

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
