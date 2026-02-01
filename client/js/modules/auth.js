// Authentication and password handling

import { ADMIN_PASSWORD } from './config.js';
import { state } from './state.js';

export function checkPassword() {
    const input = document.getElementById('passwordInput');
    const error = document.getElementById('passwordError');
    const overlay = document.getElementById('passwordOverlay');
    const indicator = document.getElementById('adminIndicator');
    
    if (input.value === ADMIN_PASSWORD) {
        state.setAdminMode(true);
        overlay.classList.add('hidden');
        indicator.classList.add('active');
        error.classList.remove('show');
        input.value = '';
        
        // Import and call loadData after successful auth
        import('../main.js').then(module => {
            if (module.loadData) {
                module.loadData();
            }
        });
    } else {
        error.classList.add('show');
        input.value = '';
        input.focus();
    }
}

export function requireAdmin(action) {
    if (!state.isAdmin()) {
        alert('Admin mode required to make changes');
        return false;
    }
    return true;
}

export function initializePasswordPrompt() {
    const passwordInput = document.getElementById('passwordInput');
    if (passwordInput) {
        passwordInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                checkPassword();
            }
        });
        // Auto-focus password input
        setTimeout(() => passwordInput.focus(), 100);
    }
    
    // Make checkPassword available globally for HTML onclick
    window.checkPassword = checkPassword;
}
