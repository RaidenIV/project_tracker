// Authentication module - simplified (no password required)
// This file is kept for backward compatibility but has no functional code

// No-op functions for any remaining references
export function checkPassword() {
    // No password check needed
    return true;
}

export function requireAdmin() {
    // Always return true - no admin mode
    return true;
}

export function initializePasswordPrompt() {
    // No password prompt needed
}
