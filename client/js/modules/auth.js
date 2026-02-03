// Authentication (disabled)
// All password / admin gating has been removed.

import { state } from './state.js';

// Keep a compatible API so the rest of the app doesn't need big refactors.
export function checkPassword() {
    // No-op (password system removed)
    return true;
}

export function requireAdmin() {
    // Always allow edits (password system removed)
    if (!state.isAdmin()) state.setAdminMode(true);
    return true;
}

export function initializePasswordPrompt() {
    // No-op (password system removed)
    // Ensure we start in admin mode.
    state.setAdminMode(true);
}
