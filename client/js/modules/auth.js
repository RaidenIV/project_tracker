// Authentication and password handling

import { state } from './state.js';
import { loginAdmin, verifyAdminToken, clearAdminToken } from './api.js';

export async function checkPassword() {
    const input = document.getElementById('passwordInput');
    const error = document.getElementById('passwordError');
    const overlay = document.getElementById('passwordOverlay');
    const indicator = document.getElementById('adminIndicator');

    const password = (input?.value || '').trim();

    try {
        await loginAdmin(password);

        state.setAdminMode(true);
        overlay?.classList.remove('active');
        indicator?.classList.add('active');
        error?.classList.remove('show');

        if (input) input.value = '';

        // Import and call loadData after successful auth
        const module = await import('../main.js');
        if (module.loadData) {
            module.loadData();
        }
    } catch (e) {
        console.error(e);
        error?.classList.add('show');
        if (input) {
            input.value = '';
            input.focus();
        }
    }
}

export function requireAdmin(action) {
    if (!state.isAdmin()) {
        alert('Admin mode required to make changes');
        return false;
    }
    return true;
}

export async function initializePasswordPrompt() {
    const passwordInput = document.getElementById('passwordInput');
    const overlay = document.getElementById('passwordOverlay');
    const indicator = document.getElementById('adminIndicator');

    // If a token exists, verify it with the server; if valid, skip the overlay.
    const tokenValid = await verifyAdminToken();
    if (tokenValid) {
        state.setAdminMode(true);
        overlay?.classList.remove('active');
        indicator?.classList.add('active');

        // Load data immediately (matches your prior behavior after auth)
        const module = await import('../main.js');
        if (module.loadData) {
            module.loadData();
        }
    } else {
        // Invalid/expired token: clear + force prompt
        clearAdminToken();
        state.setAdminMode(false);

        if (overlay) overlay.classList.add('active');
        if (indicator) indicator.classList.remove('active');

        if (passwordInput) {
            setTimeout(() => passwordInput.focus(), 100);
        }
    }

    if (passwordInput) {
        passwordInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                checkPassword();
            }
        });
    }

    // Make checkPassword available globally for HTML onclick
    window.checkPassword = checkPassword;
}
