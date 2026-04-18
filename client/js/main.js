// Main application entry point

import { VIEWS, SHORTCUTS } from './modules/config.js';
import { state } from './modules/state.js';
import * as api from './modules/api.js';
import * as auth from './modules/auth.js';

const {
    loadDataFromServer,
    saveDataToServer,
    createProjectOnServer,
    deleteProjectFromServer,
    reorderProjectsOnServer,
    shareProjectOnServer,
    updateCollaboratorRoleOnServer,
    removeCollaboratorFromServer
} = api;

const loadNotificationsFromServer = api.loadNotificationsFromServer || (async () => ({ notifications: [], unreadCount: 0 }));
const markNotificationReadOnServer = api.markNotificationReadOnServer || (async () => ({ success: true }));
const markAllNotificationsReadOnServer = api.markAllNotificationsReadOnServer || (async () => ({ success: true }));
const loadAccountProfileFromServer = api.loadAccountProfileFromServer || (async () => ({ user: auth.getCurrentUser?.() || null, stats: {} }));
const updateAccountProfileOnServer = api.updateAccountProfileOnServer || (async (payload = {}) => ({ user: { ...(auth.getCurrentUser?.() || {}), ...payload } }));
const archiveProjectOnServer = api.archiveProjectOnServer || (async () => ({ success: false }));
const restoreProjectOnServer = api.restoreProjectOnServer || (async () => ({ success: false }));

const isLoggedIn = auth.isLoggedIn;
const getCurrentUser = auth.getCurrentUser;
const login = auth.login;
const register = auth.register;
const logout = auth.logout;

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

// Capitalize first letter of first word
function capitalizeFirstLetter(text) {
    if (!text) return text;
    return text.charAt(0).toUpperCase() + text.slice(1);
}

// Capitalize first letter of each word (Title Case)
function toTitleCase(text) {
    if (!text) return text;
    return text.split(' ')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
        .join(' ');
}

// Sort tasks: incomplete first (newest first), then completed last (oldest first)
function sortTasks(tasks) {
    const incomplete = tasks.filter(t => !t.completed).sort((a, b) => b.id - a.id);
    const completed = tasks.filter(t => t.completed).sort((a, b) => a.id - b.id);
    return [...incomplete, ...completed];
}


const DEFAULT_PROFILE_ICON_SVG = `
<svg viewBox="0 0 32 32" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" fill="none">
    <g>
        <circle cx="16" cy="16" r="15" stroke="currentColor" stroke-linejoin="round" stroke-miterlimit="10" stroke-width="2"/>
        <path d="M26,27L26,27 c0-5.523-4.477-10-10-10h0c-5.523,0-10,4.477-10,10v0" stroke="currentColor" stroke-linejoin="round" stroke-miterlimit="10" stroke-width="2"/>
        <circle cx="16" cy="11" r="6" stroke="currentColor" stroke-linejoin="round" stroke-miterlimit="10" stroke-width="2"/>
    </g>
</svg>`;

const LIGHT_MODE_LOGO_URL = 'https://images.squarespace-cdn.com/content/v1/681ea18dd168a935c26295bd/a539e2d3-74e3-48f8-915e-46d97f2f1f0a/image.png?format=1000w';
const DARK_MODE_LOGO_URL = 'https://images.squarespace-cdn.com/content/v1/681ea18dd168a935c26295bd/f173dc58-2856-4e84-b647-8cf46ca113ad/phonto-Photoroom.png?format=1000w';

const THEME_OPTIONS = {
    'industrial-light': { label: 'Industrial Light', family: 'industrial', mode: 'light' },
    'industrial-dark': { label: 'Industrial Dark', family: 'industrial', mode: 'dark' },
    'glass-light': { label: 'Glassmorphic Light', family: 'glass', mode: 'light' },
    'glass-dark': { label: 'Glassmorphic Dark', family: 'glass', mode: 'dark' },
    'blueprint-light': { label: 'Blueprint Light', family: 'blueprint', mode: 'light' },
    'blueprint-dark': { label: 'Blueprint Dark', family: 'blueprint', mode: 'dark' }
};

const LEGACY_THEME_MAP = {
    default: 'industrial-light',
    glass: 'glass-light',
    midnight: 'industrial-dark',
    blueprint: 'blueprint-light'
};

const notificationState = {
    items: [],
    unreadCount: 0,
    hasLoadedOnce: false,
    pollHandle: null
};

const accountState = {
    user: null,
    stats: {
        completedTasks: 0,
        completedProjects: 0,
        ownedProjects: 0,
        sharedProjects: 0,
        activeProjects: 0
    },
    pendingProfilePic: null
};

const uiState = {
    projectSearch: '',
    ownerFilter: 'all',
    sortMode: 'manual',
    savedViews: [],
    activeSavedViewId: '',
    theme: 'industrial-light',
    saveStatus: 'idle',
    saveMessage: 'All changes saved',
    commandPaletteOpen: false,
    commandQuery: '',
    commandActiveIndex: 0
};

const LOCAL_STORAGE_KEYS = {
    SAVED_VIEWS: 'tracker_saved_views_v1',
    THEME: 'tracker_ui_theme_v1'
};

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function normalizeThemeName(themeName) {
    const resolved = LEGACY_THEME_MAP[themeName] || themeName;
    return THEME_OPTIONS[resolved] ? resolved : 'industrial-light';
}

function getThemeMeta(themeName) {
    return THEME_OPTIONS[normalizeThemeName(themeName)];
}

function getThemeLabel(themeName) {
    return getThemeMeta(themeName).label;
}

function syncThemeBranding() {
    const meta = getThemeMeta(uiState.theme);
    document.body.setAttribute('data-theme', uiState.theme);
    document.body.setAttribute('data-theme-family', meta.family);
    document.body.setAttribute('data-color-mode', meta.mode);

    const panelLogo = document.querySelector('.panel-logo-img-inline');
    if (panelLogo) {
        panelLogo.src = meta.mode === 'dark' ? DARK_MODE_LOGO_URL : LIGHT_MODE_LOGO_URL;
    }
}

function loadSavedViewsFromStorage() {
    try {
        const raw = localStorage.getItem(LOCAL_STORAGE_KEYS.SAVED_VIEWS);
        uiState.savedViews = raw ? JSON.parse(raw) : [];
    } catch {
        uiState.savedViews = [];
    }
}

function persistSavedViews() {
    localStorage.setItem(LOCAL_STORAGE_KEYS.SAVED_VIEWS, JSON.stringify(uiState.savedViews));
}

function loadThemePreference() {
    uiState.theme = normalizeThemeName(localStorage.getItem(LOCAL_STORAGE_KEYS.THEME) || 'industrial-light');
    applyTheme(uiState.theme, false);
}

function applyTheme(themeName, persist = true) {
    uiState.theme = normalizeThemeName(themeName);
    syncThemeBranding();
    if (persist) localStorage.setItem(LOCAL_STORAGE_KEYS.THEME, uiState.theme);
    const status = document.getElementById('uiOptionsStatus');
    if (status) status.textContent = `Current theme: ${getThemeLabel(uiState.theme)}`;
    renderThemeOptions();
}


function renderThemeOptions() {
    document.querySelectorAll('[data-theme-option]').forEach(card => {
        const isActive = card.getAttribute('data-theme-option') === uiState.theme;
        card.classList.toggle('is-active', isActive);
    });
}

function openUiOptionsModal() {
    renderThemeOptions();
    document.getElementById('uiOptionsStatus').textContent = `Current theme: ${getThemeLabel(uiState.theme)}`;
    document.getElementById('uiOptionsModal')?.classList.add('active');
}

function closeUiOptionsModal() {
    document.getElementById('uiOptionsModal')?.classList.remove('active');
}

function setSaveStatus(status, message) {
    uiState.saveStatus = status;
    uiState.saveMessage = message;
    const pill = document.getElementById('saveStatusPill');
    if (!pill) return;
    pill.className = `save-status save-status--${status}`;
    pill.textContent = message;
}

function projectUpdate(updates = {}, options = {}) {
    const payload = { ...updates };
    if (!options.skipTouch && !Object.prototype.hasOwnProperty.call(payload, 'lastModified')) {
        payload.lastModified = new Date().toISOString();
    }
    return payload;
}

function normalizeProject(project) {
    if (!project || typeof project !== 'object') return null;
    return {
        ...project,
        id: project.id || project._id || String(Date.now()),
        _id: project._id || project.id,
        title: project.title || 'Untitled Project',
        notes: typeof project.notes === 'string' ? project.notes : '',
        tasks: Array.isArray(project.tasks) ? project.tasks : [],
        collaborators: Array.isArray(project.collaborators) ? project.collaborators : [],
        activities: Array.isArray(project.activities) ? project.activities : [],
        archived: Boolean(project.archived),
        completed: Boolean(project.completed),
        dateCreated: project.dateCreated || new Date().toISOString(),
        lastModified: project.lastModified || project.dateCreated || new Date().toISOString(),
        __syncedLastModified: project.__syncedLastModified || project.lastModified || project.dateCreated || null
    };
}

function runRenderStep(stepName, fn) {
    try {
        fn();
    } catch (err) {
        console.error(`Render step failed: ${stepName}`, err);
    }
}

function getVisibleBaseProjects() {
    return state.getCurrentViewProjects().filter(project => !project.archived);
}

function getArchivedProjects() {
    return state.getProjects().filter(project => project.archived);
}

function matchesProjectSearch(project, query) {
    if (!query) return true;
    const haystack = [
        project.title,
        project.notes,
        ...(project.tasks || []).map(task => task.text)
    ].join(' ').toLowerCase();
    return haystack.includes(query.toLowerCase());
}

function getFilteredProjects() {
    let projects = [...getVisibleBaseProjects()].map(normalizeProject).filter(Boolean);

    if (uiState.ownerFilter === 'owned') projects = projects.filter(project => project.userRole === 'owner');
    if (uiState.ownerFilter === 'shared') projects = projects.filter(project => project.userRole !== 'owner');
    if (uiState.ownerFilter === 'collab') projects = projects.filter(project => (project.collaborators || []).length > 0);

    if (uiState.projectSearch.trim()) {
        const query = uiState.projectSearch.trim();
        projects = projects.filter(project => matchesProjectSearch(project, query));
    }

    if (uiState.sortMode === 'recent') {
        projects.sort((a, b) => new Date(b.lastModified || b.dateCreated) - new Date(a.lastModified || a.dateCreated));
    } else if (uiState.sortMode === 'alpha') {
        projects.sort((a, b) => a.title.localeCompare(b.title));
    } else if (uiState.sortMode === 'remaining') {
        projects.sort((a, b) => {
            const aRemaining = (a.tasks || []).filter(task => !task.completed).length;
            const bRemaining = (b.tasks || []).filter(task => !task.completed).length;
            return bRemaining - aRemaining;
        });
    } else if (uiState.sortMode === 'progress') {
        projects.sort((a, b) => {
            const aTotal = a.tasks?.length || 0;
            const bTotal = b.tasks?.length || 0;
            const aDone = a.tasks?.filter(task => task.completed).length || 0;
            const bDone = b.tasks?.filter(task => task.completed).length || 0;
            const aProgress = aTotal ? aDone / aTotal : 0;
            const bProgress = bTotal ? bDone / bTotal : 0;
            return bProgress - aProgress;
        });
    }

    return projects;
}

function renderActiveFilterChips() {
    const container = document.getElementById('activeFilterChips');
    if (!container) return;
    const chips = [];
    if (uiState.projectSearch.trim()) chips.push(`Search: ${uiState.projectSearch.trim()}`);
    if (uiState.ownerFilter !== 'all') chips.push(`Filter: ${uiState.ownerFilter}`);
    if (uiState.sortMode !== 'manual') chips.push(`Sort: ${uiState.sortMode}`);
    if (uiState.activeSavedViewId) {
        const view = uiState.savedViews.find(item => item.id === uiState.activeSavedViewId);
        if (view) chips.push(`Saved View: ${view.name}`);
    }
    container.innerHTML = chips.map(chip => `<span class="filter-chip">${escapeHtml(chip)}</span>`).join('');
}

function saveCurrentView() {
    const name = window.prompt('Name this saved view:');
    if (!name) return;
    const trimmed = name.trim();
    if (!trimmed) return;
    const view = {
        id: `view_${Date.now()}`,
        name: trimmed,
        projectSearch: uiState.projectSearch,
        ownerFilter: uiState.ownerFilter,
        sortMode: uiState.sortMode,
        savedAt: new Date().toISOString()
    };
    uiState.savedViews.unshift(view);
    uiState.activeSavedViewId = view.id;
    persistSavedViews();
    renderSavedViewsPanel();
    renderActiveFilterChips();
}

function applySavedView(viewId) {
    const view = uiState.savedViews.find(item => item.id === viewId);
    if (!view) return;
    uiState.projectSearch = view.projectSearch || '';
    uiState.ownerFilter = view.ownerFilter || 'all';
    uiState.sortMode = view.sortMode || 'manual';
    uiState.activeSavedViewId = view.id;
    const search = document.getElementById('projectSearchInput');
    const filter = document.getElementById('projectOwnerFilter');
    const sort = document.getElementById('projectSortSelect');
    if (search) search.value = uiState.projectSearch;
    if (filter) filter.value = uiState.ownerFilter;
    if (sort) sort.value = uiState.sortMode;
    render();
}

function deleteSavedView(viewId) {
    uiState.savedViews = uiState.savedViews.filter(item => item.id !== viewId);
    if (uiState.activeSavedViewId === viewId) uiState.activeSavedViewId = '';
    persistSavedViews();
    renderSavedViewsPanel();
    renderActiveFilterChips();
}

function clearSavedViews() {
    uiState.savedViews = [];
    uiState.activeSavedViewId = '';
    persistSavedViews();
    renderSavedViewsPanel();
    renderActiveFilterChips();
}

function renderSavedViewsPanel() {
    const list = document.getElementById('savedViewsList');
    const count = document.getElementById('savedViewsCount');
    if (!list || !count) return;
    count.textContent = String(uiState.savedViews.length);
    if (!uiState.savedViews.length) {
        list.innerHTML = '<div class="side-panel-empty">No saved views yet</div>';
        return;
    }
    list.innerHTML = uiState.savedViews.map(view => `
        <div class="saved-view-card">
            <button class="saved-view-main" type="button" onclick="applySavedView('${view.id}')">
                <div class="saved-view-name">${escapeHtml(view.name)}</div>
                <div class="saved-view-meta">${escapeHtml((view.projectSearch && `search “${view.projectSearch}”`) || 'no search')} • ${escapeHtml(view.ownerFilter)} • ${escapeHtml(view.sortMode)}</div>
            </button>
            <div class="saved-view-actions">
                <button class="icon-button-small" type="button" onclick="applySavedView('${view.id}')">Open</button>
                <button class="icon-button-small" type="button" onclick="deleteSavedView('${view.id}')">Delete</button>
            </div>
        </div>
    `).join('');
}

function renderArchivedProjectsPanel() {
    const list = document.getElementById('archivedProjectsList');
    const count = document.getElementById('archivedProjectsCount');
    if (!list || !count) return;
    const archivedProjects = getArchivedProjects();
    count.textContent = String(archivedProjects.length);
    if (!archivedProjects.length) {
        list.innerHTML = '<div class="side-panel-empty">No archived projects</div>';
        return;
    }
    list.innerHTML = archivedProjects.map(project => `
        <div class="archived-project-card">
            <div>
                <div class="archived-project-title">${escapeHtml(project.title)}</div>
                <div class="archived-project-meta">Updated ${escapeHtml(formatCompactDateTime(project.lastModified || project.dateCreated))}</div>
            </div>
            <div class="archived-project-actions">
                <button class="icon-button-small" type="button" onclick="restoreArchivedProject('${project.id}')">Restore</button>
                <button class="icon-button-small" type="button" onclick="openProjectModal('${project.id}')">Open</button>
            </div>
        </div>
    `).join('');
}

function getProjectActivities(project) {
    return Array.isArray(project?.activities) ? project.activities : [];
}

function getUserInitials(name) {
    const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return 'U';
    return parts.slice(0, 2).map(part => part.charAt(0).toUpperCase()).join('');
}

function setAvatarUI(imageEl, fallbackEl, profilePic, name) {
    if (!imageEl || !fallbackEl) return;
    const hasImage = Boolean(profilePic);
    imageEl.src = hasImage ? profilePic : '';
    imageEl.classList.toggle('hidden', !hasImage);
    fallbackEl.classList.toggle('hidden', hasImage);
    fallbackEl.innerHTML = hasImage ? '' : DEFAULT_PROFILE_ICON_SVG;
    fallbackEl.setAttribute('aria-label', hasImage ? '' : `${name || 'User'} default profile icon`);
}

function applyAccountUI(user) {
    if (!user) return;
    accountState.user = { ...(accountState.user || {}), ...user };
    state.setCurrentUser(accountState.user);

    const panelUsername = document.getElementById('panelUsername');
    if (panelUsername) panelUsername.textContent = accountState.user.username || 'User';

    const panelUserInfo = document.getElementById('panelUserInfo');
    if (panelUserInfo) panelUserInfo.classList.remove('hidden');

    setAvatarUI(
        document.getElementById('panelAvatarImg'),
        document.getElementById('panelAvatarFallback'),
        accountState.user.profilePic,
        accountState.user.username
    );

    setAvatarUI(
        document.getElementById('accountAvatarImg'),
        document.getElementById('accountAvatarFallback'),
        accountState.pendingProfilePic !== null ? accountState.pendingProfilePic : accountState.user.profilePic,
        accountState.user.username
    );

    setAvatarUI(
        document.getElementById('menuAccountAvatarImg'),
        document.getElementById('menuAccountAvatarFallback'),
        accountState.user.profilePic,
        accountState.user.username
    );

    const accountDisplayName = document.getElementById('accountDisplayName');
    if (accountDisplayName) accountDisplayName.textContent = accountState.user.username || 'User';

    const accountEmailText = document.getElementById('accountEmailText');
    if (accountEmailText) accountEmailText.textContent = accountState.user.email || '';

    const accountUsernameInput = document.getElementById('accountUsernameInput');
    if (accountUsernameInput && document.activeElement !== accountUsernameInput) {
        accountUsernameInput.value = accountState.user.username || '';
    }

    const accountEmailInput = document.getElementById('accountEmailInput');
    if (accountEmailInput) accountEmailInput.value = accountState.user.email || '';
}

function syncAccountStatsToModal() {
    const derivedSharedProjects = state.getProjects().filter(project => project.userRole !== 'owner' && !project.archived).length;
    const derivedActiveProjects = state.getProjects().filter(project => !project.completed && !project.archived).length;
    const stats = {
        completedTasks: state.getStats().completedTasks || accountState.stats.completedTasks || 0,
        completedProjects: state.getStats().completedProjects || accountState.stats.completedProjects || 0,
        activeProjects: accountState.stats.activeProjects || derivedActiveProjects,
        sharedProjects: accountState.stats.sharedProjects || derivedSharedProjects
    };

    const map = {
        accountStatCompletedTasks: stats.completedTasks,
        accountStatCompletedProjects: stats.completedProjects,
        accountStatActiveProjects: stats.activeProjects || derivedActiveProjects,
        accountStatSharedProjects: stats.sharedProjects || derivedSharedProjects
    };

    Object.entries(map).forEach(([id, value]) => {
        const el = document.getElementById(id);
        if (el) el.textContent = String(value ?? 0);
    });
}

function setAccountStatus(message = '', type = '') {
    const el = document.getElementById('accountSettingsStatus');
    if (!el) return;
    el.textContent = message;
    el.classList.toggle('is-error', type === 'error');
    el.classList.toggle('is-success', type === 'success');
}


function formatCompactDateTime(value) {
    if (!value) return 'Unknown';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'Unknown';
    return date.toLocaleString([], {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit'
    });
}

async function imageFileToOptimizedDataUrl(file) {
    const readUrl = () => new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('Unable to read the image file.'));
        reader.readAsDataURL(file);
    });

    const rawDataUrl = await readUrl();
    const sourceImage = await new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('Unable to process the selected image.'));
        img.src = rawDataUrl;
    });

    const avatarSize = 512;
    const sourceWidth = Math.max(1, sourceImage.naturalWidth || sourceImage.width || 1);
    const sourceHeight = Math.max(1, sourceImage.naturalHeight || sourceImage.height || 1);

    const cropSize = Math.min(sourceWidth, sourceHeight);
    const cropX = Math.max(0, Math.round((sourceWidth - cropSize) / 2));
    const cropY = Math.max(0, Math.round((sourceHeight - cropSize) / 2));

    const canvas = document.createElement('canvas');
    canvas.width = avatarSize;
    canvas.height = avatarSize;

    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return rawDataUrl;

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.fillStyle = '#e1e3e5';
    ctx.fillRect(0, 0, avatarSize, avatarSize);
    ctx.drawImage(
        sourceImage,
        cropX,
        cropY,
        cropSize,
        cropSize,
        0,
        0,
        avatarSize,
        avatarSize
    );

    let optimized = canvas.toDataURL('image/webp', 0.9);
    if (!optimized || optimized === 'data:,') optimized = canvas.toDataURL('image/jpeg', 0.9);
    return optimized || rawDataUrl;
}


async function refreshAccountProfile() {
    try {
        const response = await loadAccountProfileFromServer();
        const fallbackUser = getCurrentUser?.() || accountState.user;
        if (!response?.user && !fallbackUser) return;
        accountState.user = response?.user || fallbackUser;
        accountState.stats = response?.stats || accountState.stats;
        accountState.pendingProfilePic = null;
        applyAccountUI(accountState.user);
        syncAccountStatsToModal();
    } catch (err) {
        console.error('Failed to load account profile:', err);
        const fallbackUser = getCurrentUser?.() || accountState.user;
        if (fallbackUser) {
            accountState.user = fallbackUser;
            applyAccountUI(accountState.user);
            syncAccountStatsToModal();
        }
    }
}

function openAccountSettingsModal() {
    applyAccountUI(accountState.user || getCurrentUser() || { username: 'User', email: '' });
    syncAccountStatsToModal();
    setAccountStatus('');
    document.getElementById('accountSettingsModal')?.classList.add('active');
}

function closeAccountSettingsModal() {
    accountState.pendingProfilePic = null;
    setAccountStatus('');
    document.getElementById('accountSettingsModal')?.classList.remove('active');
}

function triggerProfilePicUpload() {
    document.getElementById('accountProfilePicInput')?.click();
}

function removeProfilePicture() {
    accountState.pendingProfilePic = '';
    applyAccountUI(accountState.user || getCurrentUser() || { username: 'User', email: '' });
}

async function handleProfilePicSelected(event) {
    const input = event?.target;
    const file = input?.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
        setAccountStatus('Please choose an image file.', 'error');
        if (input) input.value = '';
        return;
    }

    try {
        const dataUrl = await imageFileToOptimizedDataUrl(file);
        if (!dataUrl) return;
        if (dataUrl.length > 1_500_000) {
            setAccountStatus('Image is still too large. Please use a smaller photo.', 'error');
            if (input) input.value = '';
            return;
        }
        accountState.pendingProfilePic = dataUrl;
        applyAccountUI(accountState.user || getCurrentUser() || { username: 'User', email: '' });
        setAccountStatus('Profile picture ready to save.', 'success');
    } catch (err) {
        setAccountStatus(err.message || 'Unable to process the selected image.', 'error');
    } finally {
        if (input) input.value = '';
    }
}

async function saveAccountSettingsFromModal() {
    const usernameInput = document.getElementById('accountUsernameInput');
    if (!usernameInput) return;

    const username = usernameInput.value.trim();
    if (!username) {
        setAccountStatus('User name is required.', 'error');
        return;
    }

    const saveButton = document.getElementById('accountSettingsSaveBtn');
    if (saveButton) saveButton.disabled = true;
    setAccountStatus('Saving…');

    try {
        const payload = { username };
        if (accountState.pendingProfilePic !== null) payload.profilePic = accountState.pendingProfilePic;
        const response = await updateAccountProfileOnServer(payload);
        if (response?.user) {
            accountState.user = response.user;
            accountState.pendingProfilePic = null;
            applyAccountUI(response.user);
            await loadData();
            await refreshNotifications();
            setAccountStatus('Changes saved.', 'success');
            setTimeout(() => closeAccountSettingsModal(), 700);
        }
    } catch (err) {
        console.error('Failed to save account settings:', err);
        setAccountStatus(err.message || 'Unable to save account settings.', 'error');
    } finally {
        if (saveButton) saveButton.disabled = false;
    }
}

function captureProjectModalState(projectId) {
    const modal = document.getElementById('projectModal');
    if (!modal?.classList.contains('active')) return null;
    const scrollEl = document.querySelector('#modalContent .modal-scroll-inner');
    const activeTab = document.querySelector(`#modalContent .modal-tab.active`);
    if (!scrollEl) return null;
    return {
        projectId: String(projectId),
        scrollTop: scrollEl.scrollTop,
        activeTab: activeTab ? activeTab.id.replace(/-(.+)$/, '').split('-')[0] : 'tasks'
    };
}

function restoreProjectModalState(projectId, modalState) {
    if (!modalState || String(modalState.projectId) !== String(projectId)) return;
    const tab = ['tasks', 'notes', 'members', 'history'].includes(modalState.activeTab) ? modalState.activeTab : 'tasks';
    switchModalTab(projectId, tab);
    const scrollEl = document.querySelector('#modalContent .modal-scroll-inner');
    if (!scrollEl) return;
    requestAnimationFrame(() => {
        scrollEl.scrollTop = modalState.scrollTop || 0;
    });
}

// ============================================================================
// DATA MANAGEMENT
// ============================================================================

export async function loadData() {
    try {
        if (typeof loadDataFromServer !== 'function') {
            throw new Error('API module does not expose loadDataFromServer');
        }
        const data = await loadDataFromServer();
        const projects = (Array.isArray(data?.projects) ? data.projects : [])
            .map(normalizeProject)
            .filter(Boolean);
        state.setProjects(projects);
        state.setStats(data?.stats || { completedTasks: 0, completedProjects: 0 });
        render();
        try {
            await refreshNotifications();
        } catch (err) {
            console.error('Failed to refresh notifications after load:', err);
        }
    } catch (err) {
        console.error('Failed to load project data:', err);
        state.setProjects([]);
        state.setStats({ completedTasks: 0, completedProjects: 0 });
        render();
        setSaveStatus('error', 'Could not load projects');
    }
}

// Save queue: prevents overlapping saves and reduces race conditions.
let __saveInFlight = false;
let __saveQueued = false;

async function saveData() {
    if (__saveInFlight) { __saveQueued = true; return; }
    __saveInFlight = true;
    setSaveStatus('saving', 'Saving changes…');
    try {
        let finalResult = null;
        do {
            __saveQueued = false;
            finalResult = await saveDataToServer(state.getProjects(), state.getStats());
            if (!finalResult?.ok) {
                if (finalResult?.conflicts?.length) {
                    setSaveStatus('conflict', 'Conflict detected — refresh to sync');
                } else {
                    setSaveStatus('error', 'Save failed — retrying on next change');
                }
                break;
            }
            if (finalResult?.savedProjects?.length) {
                finalResult.savedProjects.forEach(savedProject => {
                    const projectId = savedProject.id || savedProject._id;
                    if (!projectId) return;
                    state.updateProject(projectId, projectUpdate({
                        _id: savedProject._id || savedProject.id,
                        id: savedProject.id || savedProject._id,
                        lastModified: savedProject.lastModified,
                        __syncedLastModified: savedProject.lastModified || state.findProject(projectId)?.__syncedLastModified || null,
                        activities: savedProject.activities || state.findProject(projectId)?.activities || []
                    }, { skipTouch: true }));
                });
            }
            setSaveStatus('saved', __saveQueued ? 'Saving queued changes…' : 'All changes saved');
        } while (__saveQueued);
    } finally {
        __saveInFlight = false;
    }
}

// Save only stats (used after delete, since project deletion is handled separately)
async function saveStatsOnly() {
    const { saveStatsToServer } = await import('./modules/api.js');
    await saveStatsToServer(state.getStats());
}

// ============================================================================
// PROJECT OPERATIONS
// ============================================================================

async function addProject() {
    const tempId = Date.now();
    const createdAt = new Date().toISOString();
    const newProject = {
        id: tempId,
        title: 'New Project',
        tasks: [],
        dateCreated: createdAt,
        lastModified: createdAt,
        priority: state.getProjects().length,
        completed: false,
        notes: '',
        userRole: 'owner',
        collaborators: []
    };

    state.addProject(newProject);
    render();

    // Create on server and get the MongoDB _id back
    const created = await createProjectOnServer(newProject);
    if (created) {
        state.updateProject(tempId, projectUpdate({
            _id: created._id || created.id,
            id:  created.id  || created._id,
            lastModified: created.lastModified || createdAt,
            __syncedLastModified: created.lastModified || createdAt,
            userRole: 'owner',
            ownerName: state.getCurrentUser()?.username || '',
            ownerEmail: state.getCurrentUser()?.email || '',
            collaborators: []
        }, { skipTouch: true }));
    }

    // Auto-open modal for new project (use the real id now)
    const finalProject = state.findProject(created?.id || tempId);
    const finalId = finalProject?.id || tempId;
    setTimeout(() => {
        openProjectModal(finalId);
        setTimeout(() => editModalTitle(finalId), 100);
    }, 150);
}

function deleteProject(projectId) {
    if (!state.isOwner(projectId)) {
        alert('Only the project owner can delete it.');
        return;
    }
    const project = state.findProject(projectId);
    const mongoId = project?._id;

    if (project?.completed) state.decrementCompletedProjects();
    const completedTasks = project?.tasks.filter(t => t.completed).length || 0;
    for (let i = 0; i < completedTasks; i++) state.decrementCompletedTasks();

    state.deleteProject(projectId);
    if (mongoId) deleteProjectFromServer(mongoId);
    saveStatsOnly();
    render();
    updateUndoButton();
}

function completeProject(projectId) {
    if (!state.canEdit(projectId)) return;
    const project = state.findProject(projectId);
    if (!project) return;
    
    const newCompleted = !project.completed;
    if (newCompleted) {
        state.incrementCompletedProjects();
    } else {
        state.decrementCompletedProjects();
    }
    
    state.updateProject(projectId, projectUpdate({
        completed: newCompleted,
        completedDate: newCompleted ? new Date().toISOString() : null
    }));
    
    saveData();
    render();
}

function updateProjectTitle(projectId, newTitle) {
    if (!state.canEdit(projectId)) return;
    const trimmedTitle = (newTitle || '').trim();
    const titleCased = toTitleCase(trimmedTitle || 'New Project');
    state.updateProject(projectId, projectUpdate({ title: titleCased }));
    saveData();
    render();
}

function updateProjectNotes(projectId, notes) {
    if (!state.canEdit(projectId)) return;
    state.updateProject(projectId, projectUpdate({ notes }));
    saveData();
}

function copyProjectToClipboard(projectId, evt) {
    const project = state.findProject(projectId);
    if (!project) return;
    
    // Only copy incomplete task text
    const incompleteTasks = project.tasks.filter(t => !t.completed);
    
    let text = incompleteTasks.map(task => task.text).join('\n');
    
    navigator.clipboard.writeText(text).then(() => {
        // Show brief feedback with checkmark
        const button = evt?.target?.closest('button');
        if (button) {
            const originalHTML = button.innerHTML;
            
            // Swap icon to checkmark, keep the existing accent-blue colour
            button.innerHTML = `
                <svg class="icon-lg" fill="none" stroke="currentColor" viewBox="0 0 24 24" style="width: 20px; height: 20px;">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7"></path>
                </svg>
            `;
            
            setTimeout(() => {
                button.innerHTML = originalHTML;
            }, 1500);
        }
    }).catch(err => {
        console.error('Failed to copy:', err);
    });
}

// ============================================================================
// TASK OPERATIONS
// ============================================================================

function toggleTask(projectId, taskId) {
    if (!state.canEdit(projectId)) return; // viewers cannot toggle tasks
    const project = state.findProject(projectId);
    if (!project) return;
    
    const task = project.tasks.find(t => t.id === taskId);
    if (!task) return;
    
    const willBeCompleted = !task.completed;
    
    // If marking as complete, show a confirmed check animation before fading out
    if (willBeCompleted) {
        const taskElement = document.querySelector(`[data-task-id="${taskId}"]`);
        if (taskElement) {
            const checkbox = taskElement.querySelector(`[data-task-checkbox="${taskId}"]`);
            if (checkbox) {
                checkbox.classList.add('checked', 'checkmark-pop');
                checkbox.innerHTML = `
                    <svg class="icon" fill="none" stroke="#f0f4f8" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.4" d="M5 13l4 4L19 7"></path>
                    </svg>
                `;
            }

            const taskText = taskElement.querySelector(`[data-task-text="${taskId}"]`);
            if (taskText) taskText.classList.add('completed');

            taskElement.classList.add('completing');

            setTimeout(() => {
                taskElement.classList.add('fading-out');
            }, 360);
            
            setTimeout(() => {
                performTaskToggle(projectId, taskId);
            }, 700);
            return;
        }
    }
    
    // If unmarking as complete, update immediately (no fade needed)
    performTaskToggle(projectId, taskId);
}

function performTaskToggle(projectId, taskId) {
    const project = state.findProject(projectId);
    if (!project) return;
    
    const updatedTasks = project.tasks.map(t => {
        if (t.id === taskId) {
            const newCompleted = !t.completed;
            if (newCompleted) {
                state.incrementCompletedTasks();
            } else {
                state.decrementCompletedTasks();
            }
            return { ...t, completed: newCompleted, completedDate: newCompleted ? new Date().toISOString() : null };
        }
        return t;
    });
    
    // Sort tasks after toggling
    const sortedTasks = sortTasks(updatedTasks);
    state.updateProject(projectId, projectUpdate({ tasks: sortedTasks }));
    saveData();
    
    // Re-render to show new order
    const modalOpen = document.getElementById('projectModal').classList.contains('active');
    const modalState = modalOpen ? captureProjectModalState(projectId) : null;
    if (modalOpen) {
        openProjectModal(projectId, { restoreState: modalState });
    } else {
        render();
    }
    
    // Update stats display
    document.getElementById('completedTasksCount').textContent = state.getStats().completedTasks;
    updateTotalCompletion();
}

function updateProjectProgress(projectId) {
    const project = state.findProject(projectId);
    if (!project) return;
    
    const completedTasks = project.tasks.filter(t => t.completed).length;
    const totalTasks = project.tasks.length;
    const percentage = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;
    
    const progressBar = document.querySelector(`[data-progress-bar="${projectId}"]`);
    const progressText = document.querySelector(`[data-progress-text="${projectId}"]`);
    
    if (progressBar) progressBar.style.width = percentage + '%';
    if (progressText) progressText.textContent = percentage + '%';
}

function deleteTask(projectId, taskId) {
    if (!state.canEdit(projectId)) return;
    const project = state.findProject(projectId);
    if (!project) return;
    
    const taskToDelete = project.tasks.find(t => t.id === taskId);
    if (taskToDelete?.completed) {
        state.decrementCompletedTasks();
    }
    
    // Save undo state for task deletion
    state.saveUndoState('deleteTask', { projectId, task: { ...taskToDelete } });
    
    const updatedTasks = project.tasks.filter(t => t.id !== taskId);
    state.updateProject(projectId, projectUpdate({ tasks: updatedTasks }));
    saveData();
    render();
    updateUndoButton();
    updateTotalCompletion();
}

function updateTaskText(projectId, taskId, newText) {
    if (!state.canEdit(projectId)) return;
    const project = state.findProject(projectId);
    if (!project) return;
    
    const capitalized = capitalizeFirstLetter(newText);
    const updatedTasks = project.tasks.map(t => 
        t.id === taskId ? { ...t, text: capitalized } : t
    );
    
    state.updateProject(projectId, projectUpdate({ tasks: updatedTasks }));
    saveData();
    render();
}

function addTaskToProject(projectId) {
    if (!state.canEdit(projectId)) return;
    const project = state.findProject(projectId);
    if (!project) return;
    
    const newTask = { id: Date.now(), text: '', completed: false };
    // Add new tasks at the beginning (they'll appear first after sorting)
    const updatedTasks = sortTasks([newTask, ...project.tasks]);
    
    state.updateProject(projectId, projectUpdate({ tasks: updatedTasks }));
    saveData();
    
    return newTask.id;
}

function reorderTasks(projectId, oldIndex, newIndex) {
    
    
    const project = state.findProject(projectId);
    if (!project) return;
    
    const tasks = [...project.tasks];
    const [movedTask] = tasks.splice(oldIndex, 1);
    tasks.splice(newIndex, 0, movedTask);
    
    state.updateProject(projectId, projectUpdate({ tasks }));
    saveData();
    openProjectModal(projectId);
}

function reorderProjects(oldIndex, newIndex) {
    
    
    const currentViewProjects = state.getCurrentViewProjects();
    const allProjects = state.getProjects();
    
    // Get the project being moved
    const movedProject = currentViewProjects[oldIndex];
    
    // Find the indices in the full project list
    const oldFullIndex = allProjects.findIndex(p => p.id === movedProject.id);
    
    // Remove from current position
    const newProjects = [...allProjects];
    newProjects.splice(oldFullIndex, 1);
    
    // Calculate new position in full list
    let newFullIndex;
    if (newIndex <= 0) {
        newFullIndex = 0;
    } else if (newIndex >= currentViewProjects.length) {
        // Dropping past the last tile in the current view
        newFullIndex = newProjects.length;
    } else {
        const targetProject = currentViewProjects[newIndex];
        newFullIndex = newProjects.findIndex(p => p.id === targetProject.id);
        if (newFullIndex === -1) newFullIndex = newProjects.length;
    }
    
    // Insert at new position
    newProjects.splice(newFullIndex, 0, movedProject);
    
    // Update priorities
    newProjects.forEach((p, i) => p.priority = i);
    
    state.setProjects(newProjects);
    reorderProjectsOnServer(newProjects);
    render();
}

// ============================================================================
// UNDO FUNCTIONALITY
// ============================================================================

function performUndo() {
    
    if (!state.hasUndo()) return;
    
    const undoEntry = state.getLastUndo();
    if (!undoEntry) return;
    
    if (undoEntry.action === 'deleteProject') {
        // Restore deleted project
        const project = undoEntry.data.project;
        state.addProject(project);
        
        // Restore stats
        if (project.completed) {
            state.incrementCompletedProjects();
        }
        const completedTasks = project.tasks.filter(t => t.completed).length;
        for (let i = 0; i < completedTasks; i++) {
            state.incrementCompletedTasks();
        }
        
        saveData();
        render();
    } else if (undoEntry.action === 'deleteTask') {
        // Restore deleted task
        const { projectId, task } = undoEntry.data;
        const project = state.findProject(projectId);
        if (project) {
            const updatedTasks = sortTasks([...project.tasks, task]);
            state.updateProject(projectId, projectUpdate({ tasks: updatedTasks }));
            
            if (task.completed) {
                state.incrementCompletedTasks();
            }
            
            saveData();
            render();
        }
    }
    
    updateUndoButton();
    updateTotalCompletion();
}

function updateUndoButton() {
    const undoButton = document.getElementById('undoButton');
    if (state.hasUndo()) {
        undoButton.classList.remove('hidden');
    } else {
        undoButton.classList.add('hidden');
    }
}

// ============================================================================
// TASK SELECTION (SHIFT-CLICK)
// ============================================================================

function handleTaskClick(projectId, taskId, event) {
    
    
    if (event.shiftKey) {
        const lastSelected = state.lastSelectedTask.get(projectId);
        if (lastSelected) {
            state.selectTaskRange(projectId, lastSelected, taskId);
        } else {
            state.selectTask(projectId, taskId, false);
        }
        openProjectModal(projectId);
    } else if (event.ctrlKey || event.metaKey) {
        state.toggleTaskSelection(projectId, taskId);
        openProjectModal(projectId);
    } else {
        state.selectTask(projectId, taskId, false);
    }
}

// ============================================================================
// TOTAL COMPLETION CALCULATION
// ============================================================================

function calculateTotalCompletion() {
    const allProjects = state.getProjects();
    let totalTasks = 0;
    let completedTasks = 0;
    
    allProjects.forEach(project => {
        totalTasks += project.tasks.length;
        completedTasks += project.tasks.filter(t => t.completed).length;
    });
    
    if (totalTasks === 0) return 0;
    return Math.round((completedTasks / totalTasks) * 100);
}

function updateTotalCompletion() {
    const percentage = calculateTotalCompletion();
    const totalPercentageElement = document.getElementById('totalPercentage');
    if (totalPercentageElement) {
        totalPercentageElement.textContent = `${percentage}%`;
    }
}

function setViewTitle(title) {
    const viewportTitle = document.querySelector('.viewport-header h1');
    if (viewportTitle) viewportTitle.textContent = title;
    const appBarTitle = document.getElementById('topAppBarTitle');
    if (appBarTitle) appBarTitle.textContent = title;
}

function syncViewTitle() {
    setViewTitle(state.getView() === VIEWS.COMPLETED ? 'Completed Projects' : 'Active Projects');
}

// ============================================================================
// VIEW MANAGEMENT
// ============================================================================

function switchToActiveView() {
    state.setView(VIEWS.ACTIVE);
    document.getElementById('activeProjectsCard').classList.add('active');
    document.getElementById('completedProjectsCard').classList.remove('active');
    setViewTitle('Active Projects');
    render();
}

function switchToCompletedView() {
    state.setView(VIEWS.COMPLETED);
    document.getElementById('completedProjectsCard').classList.add('active');
    document.getElementById('activeProjectsCard').classList.remove('active');
    setViewTitle('Completed Projects');
    render();
}

// ============================================================================
// DRAG AND DROP
// ============================================================================

// Project drag-to-reorder (iOS-style: long-press to enter edit mode + pointer-based slide)
let __projectDrag = null;
let __suppressNextProjectGridClick = false;
let __projectEditMode = false;
let __projectLongPressTimer = null;
let __projectPendingPress = null;
let __projectEditListenersBound = false;


function setupProjectDragAndDrop() {
    const projectGrid = document.getElementById('projectGrid');
    if (!projectGrid) return;

    bindProjectEditModeExitHandlers();

    projectGrid.addEventListener('click', (e) => {
        if (__suppressNextProjectGridClick) {
            e.preventDefault();
            e.stopImmediatePropagation();
            __suppressNextProjectGridClick = false;
            return;
        }
        if (__projectEditMode) {
            e.preventDefault();
            e.stopImmediatePropagation();
        }
    }, true);

    const cards = Array.from(projectGrid.querySelectorAll('.project-card'));
    cards.forEach((card) => {
        card.setAttribute('draggable', 'false');

        card.addEventListener('pointerdown', (e) => {
            if (e.button !== 0) return;

            const t = e.target;
            const handle = t && t.closest ? t.closest('.drag-handle') : null;
            if (t && t.closest && t.closest('button, input, textarea, select, a') && !handle) return;
            if (!handle && !__projectEditMode) return;

            const projectId = card.getAttribute('data-project-id');
            if (!projectId) return;

            const viewProjects = state.getCurrentViewProjects();
            const startIndex = viewProjects.findIndex(p => String(p.id) === String(projectId));
            if (startIndex === -1) return;

            e.preventDefault();
            e.stopPropagation();
            __suppressNextProjectGridClick = true;
            clearProjectLongPress();

            __projectDrag = {
                pointerId:  e.pointerId,
                startIndex,
                startX:     e.clientX,
                startY:     e.clientY,
                grid:       projectGrid,
                sourceCard: card,
                active:     false,
                snapshots:  null,
                targetIndex:     startIndex,
                lastTargetIndex: startIndex
            };

            try { card.setPointerCapture(e.pointerId); } catch { /* noop */ }

            window.addEventListener('pointermove',  onProjectPointerMove,   { passive: false });
            window.addEventListener('pointerup',    onProjectPointerUp,     { passive: false, once: true });
            window.addEventListener('pointercancel', onProjectPointerCancel, { passive: false, once: true });
        });
    });
}

function clearProjectLongPress() {
    if (__projectLongPressTimer) {
        clearTimeout(__projectLongPressTimer);
        __projectLongPressTimer = null;
    }
    if (__projectPendingPress) {
        __projectPendingPress.active = false;
        __projectPendingPress = null;
    }
}

function setProjectEditMode(enabled) {
    __projectEditMode = !!enabled;
    const grid = document.getElementById('projectGrid');
    if (grid) grid.classList.toggle('is-editing', __projectEditMode);
    if (!__projectEditMode) clearProjectLongPress();
}

function bindProjectEditModeExitHandlers() {
    if (__projectEditListenersBound) return;
    __projectEditListenersBound = true;

    // Escape exits edit mode
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && __projectEditMode) setProjectEditMode(false);
    });

    // Click outside the grid (or on the modal) exits edit mode — iOS "Done" equivalent
    document.addEventListener('pointerdown', (e) => {
        if (!__projectEditMode) return;
        if (__projectDrag && __projectDrag.active) return;

        const grid  = document.getElementById('projectGrid');
        const modal = document.getElementById('projectModal');
        if (grid  && grid.contains(e.target))  return;
        if (modal && modal.contains(e.target)) return;

        setProjectEditMode(false);
    }, true);
}


// ──────────────────────────────────────────────────────────────────────────────
// Auto-scroll while dragging (important on mobile / small viewports)
// ──────────────────────────────────────────────────────────────────────────────

let __projectDragScrollEl = null;

function getScrollParent(el) {
    let node = el;
    while (node && node !== document.body) {
        const s = window.getComputedStyle(node);
        const oy = s.overflowY;
        if ((oy === 'auto' || oy === 'scroll') && node.scrollHeight > node.clientHeight) return node;
        node = node.parentElement;
    }
    return document.scrollingElement || document.documentElement;
}

function autoScrollProjectDrag(clientY) {
    if (!__projectDrag || !__projectDrag.active) return;

    // Cache the scroll container for this gesture
    if (!__projectDragScrollEl) __projectDragScrollEl = getScrollParent(__projectDrag.grid);

    const el = __projectDragScrollEl;
    if (!el) return;

    const rect = (el === document.scrollingElement || el === document.documentElement)
        ? { top: 0, bottom: window.innerHeight }
        : el.getBoundingClientRect();

    const EDGE = 90;          // px from edge where scrolling starts
    const MAX_STEP = 22;      // px per pointermove near the edge

    const distTop = clientY - rect.top;
    const distBot = rect.bottom - clientY;

    let step = 0;
    if (distTop < EDGE) {
        const t = Math.max(0, Math.min(1, (EDGE - distTop) / EDGE));
        step = -Math.round(6 + t * (MAX_STEP - 6));
    } else if (distBot < EDGE) {
        const t = Math.max(0, Math.min(1, (EDGE - distBot) / EDGE));
        step = Math.round(6 + t * (MAX_STEP - 6));
    }

    if (!step) return;

    if (el === document.scrollingElement || el === document.documentElement) {
        window.scrollBy(0, step);
    } else {
        el.scrollTop += step;
    }
}
// ──────────────────────────────────────────────────────────────────────────────
// Pointer handlers
// ──────────────────────────────────────────────────────────────────────────────

function onProjectPointerMove(e) {
    if (!__projectDrag || e.pointerId !== __projectDrag.pointerId) return;
    e.preventDefault();

    // Small movement threshold before the slide actually begins
    if (!__projectDrag.active) {
        const THRESHOLD = __projectEditMode ? 2 : 8;
        if (Math.hypot(e.clientX - __projectDrag.startX,
                       e.clientY - __projectDrag.startY) < THRESHOLD) return;
        startProjectSlide(e);
    }

    // 1. Dragged card follows the pointer (zero-lag, no easing).
    //    translate3d is relative to layout position, so we only need the delta
    //    from where the pointer was when the press started.
    const dx = e.clientX - __projectDrag.startX;
    const dy = e.clientY - __projectDrag.startY;
    __projectDrag.sourceCard.style.transform = `translate3d(${dx}px, ${dy}px, 0)`;

    // 2. Slide idle cards to make room / fill the gap
    updateProjectSlideItems(e.clientX, e.clientY);
    autoScrollProjectDrag(e.clientY);
}


function onProjectPointerUp(e) {
    if (!__projectDrag) return;

    // Pointer released before the threshold was crossed — nothing to commit
    if (!__projectDrag.active) {
        cleanupProjectDrag();
        return;
    }

    e.preventDefault();
    __suppressNextProjectGridClick = true;

    const { startIndex, targetIndex } = __projectDrag;

    // targetIndex was computed in "idle" space (dragged card excluded).
    // reorderProjects uses the original full array, so shift forward-drags
    // by +1 to land in the correct slot.
    const fullTargetIndex = targetIndex > startIndex ? targetIndex + 1 : targetIndex;

    // Wipe visuals before the state-driven re-render
    resetProjectSlideVisuals();
    cleanupProjectDrag();

    if (startIndex !== fullTargetIndex) {
        reorderProjects(startIndex, fullTargetIndex);
    }
}

function onProjectPointerCancel() {
    if (!__projectDrag) return;
    if (__projectDrag.active) resetProjectSlideVisuals();
    cleanupProjectDrag();
}

// ──────────────────────────────────────────────────────────────────────────────
// Slide engine  (CodePen pattern adapted for CSS grid)
// ──────────────────────────────────────────────────────────────────────────────

/*
 * startProjectSlide  – called once when the drag threshold is crossed.
 *   • Snapshots every card's bounding-rect in current DOM (= reading) order.
 *   • Marks the dragged card so CSS can kill its transition / float it up.
 *   • Positions it immediately under the pointer.
 */
function startProjectSlide(e) {
    const { sourceCard, grid } = __projectDrag;
    __projectDrag.active = true;
    grid.classList.add('is-reordering');

    // Snapshot ALL cards (including dragged) in DOM order
    const allCards = Array.from(grid.querySelectorAll('.project-card'));
    __projectDrag.snapshots = allCards.map(card => ({
        card,
        rect: card.getBoundingClientRect()
    }));

    // Float the dragged card; its transform is now driven by inline style only.
    // Use the same delta logic as onProjectPointerMove so there is no jump.
    sourceCard.classList.add('dragging');

    const dx = e.clientX - __projectDrag.startX;
    const dy = e.clientY - __projectDrag.startY;
    sourceCard.style.transform = `translate3d(${dx}px, ${dy}px, 0)`;
}

/*
 * updateProjectSlideItems  – called on every pointermove while active.
 *   1. Computes an insertion index by comparing the dragged card's live centre
 *      to every idle card's *snapshot* centre in grid reading order.
 *   2. For each idle card, derives the slot it would occupy after the reorder
 *      (adjustedI → finalI mapping, same algebra as the CodePen pattern).
 *   3. Applies the slide offset as CSS custom-property values (--slide-x /
 *      --slide-y) which feed into the card's transform via calc().
 */
function updateProjectSlideItems(clientX, clientY) {
    const { snapshots, startIndex, sourceCard } = __projectDrag;
    if (!snapshots) return;

    // Live centre of the dragged card (it has moved since snapshot)
    const dRect = sourceCard.getBoundingClientRect();
    const dCX   = dRect.left  + dRect.width  / 2;
    const dCY   = dRect.top   + dRect.height / 2;

    // Idle cards in reading order (DOM order is already row-major for auto-flow grid)
    const idleSnaps = snapshots.filter(s => s.card !== sourceCard);

    // ── find insertion index among idle cards ──
    // Improved heuristic:
    //   1) Find the snapshot tile whose center is *closest* to the dragged tile center.
    //   2) Insert before/after that tile based on which side of its center we are on.
    // This is far less "jumpy" than a row-band scan on responsive grids.
    let insertionIndex = idleSnaps.length; // default: end
    if (idleSnaps.length) {
        const rowBand = (idleSnaps[0]?.rect.height || 100) * 0.55;

        let closestI = 0;
        let bestD2 = Infinity;

        for (let i = 0; i < idleSnaps.length; i++) {
            const r = idleSnaps[i].rect;
            const cx = r.left + r.width / 2;
            const cy = r.top  + r.height / 2;
            const dx = dCX - cx;
            const dy = dCY - cy;

            // weight Y a bit more to reduce accidental lateral swaps when scrolling
            const d2 = (dx * dx) + (dy * dy * 1.35);
            if (d2 < bestD2) {
                bestD2 = d2;
                closestI = i;
            }
        }

        const r = idleSnaps[closestI].rect;
        const cx = r.left + r.width / 2;
        const cy = r.top  + r.height / 2;
        const sameRow = Math.abs(dCY - cy) <= rowBand;

        // Decide before vs after the closest tile
        if (sameRow) insertionIndex = (dCX < cx) ? closestI : (closestI + 1);
        else        insertionIndex = (dCY < cy) ? closestI : (closestI + 1);

        insertionIndex = Math.max(0, Math.min(idleSnaps.length, insertionIndex));
    }

    // targetIndex in the full array == insertionIndex in the idle (reduced) array.
    __projectDrag.targetIndex = insertionIndex;

    // Nothing moved since the last update — let the current transition finish.
    if (insertionIndex === __projectDrag.lastTargetIndex) return;
    __projectDrag.lastTargetIndex = insertionIndex;

    // ── slide every idle card to its destination slot ──
    snapshots.forEach((snap, origI) => {
        if (snap.card === sourceCard) return;

        // Where does this card end up after we remove the dragged card and reinsert it?
        const adjustedI = origI > startIndex ? origI - 1 : origI;   // index after removal
        const finalI    = adjustedI >= insertionIndex ? adjustedI + 1 : adjustedI; // after reinsertion

        // Slide vector: difference between the destination slot's original rect
        // and this card's original rect (both from the snapshot — layout hasn't changed)
        const fromRect = snapshots[origI].rect;
        const toRect   = snapshots[finalI].rect;

        snap.card.style.setProperty('--slide-x', `${toRect.left - fromRect.left}px`);
        snap.card.style.setProperty('--slide-y', `${toRect.top  - fromRect.top}px`);
    });
}

// ── tear-down helpers ──

function resetProjectSlideVisuals() {
    const { snapshots, sourceCard, grid } = __projectDrag || {};
    if (grid)        grid.classList.remove('is-reordering');
    if (sourceCard)  { sourceCard.classList.remove('dragging'); sourceCard.style.transform = ''; }
    if (snapshots)   snapshots.forEach(s => {
        s.card.style.setProperty('--slide-x', '0px');
        s.card.style.setProperty('--slide-y', '0px');
    });
}

function cleanupProjectDrag() {
    window.removeEventListener('pointermove',  onProjectPointerMove);
    window.removeEventListener('pointerup',    onProjectPointerUp);
    window.removeEventListener('pointercancel', onProjectPointerCancel);
    __projectDrag = null;
    __projectDragScrollEl = null;
}



function setupTaskDragAndDrop(projectId) {
    const taskList = document.getElementById(`modal-task-list-${projectId}`);
    if (!taskList) return;

    // ── per-gesture state (reset each drag) ──
    let draggableItem = null;
    let pointerStartX = 0;
    let pointerStartY = 0;
    let itemsGap = 0;
    let cachedItems = [];          // lazily populated, cleared on release

    // ── helpers ──
    function getAllItems() {
        if (!cachedItems.length)
            cachedItems = Array.from(taskList.querySelectorAll('[data-task-item]'));
        return cachedItems;
    }
    function getIdleItems() {
        return getAllItems().filter(el => !el.classList.contains('dragging'));
    }
    function isAbove(el)   { return el.hasAttribute('data-is-above'); }
    function isToggled(el) { return el.hasAttribute('data-is-toggled'); }

    // ── drag start ──
    function onStart(e) {
        const handle = e.target.closest('.task-drag-handle');
        if (!handle) return;
        draggableItem = handle.closest('[data-task-item]');
        if (!draggableItem) return;

        e.preventDefault();

        pointerStartX = e.clientX ?? e.touches?.[0]?.clientX;
        pointerStartY = e.clientY ?? e.touches?.[0]?.clientY;

        // measure the gap between the first two idle items (used to size the slide)
        const idle = getIdleItems();
        if (idle.length > 1) {
            const r1 = idle[0].getBoundingClientRect();
            const r2 = idle[1].getBoundingClientRect();
            itemsGap = Math.abs(r1.bottom - r2.top);
        } else {
            itemsGap = 0;
        }

        // stamp every item that is currently above the dragged item
        const dragIdx = getAllItems().indexOf(draggableItem);
        getIdleItems().forEach(item => {
            if (getAllItems().indexOf(item) < dragIdx) item.dataset.isAbove = '';
        });

        draggableItem.classList.add('dragging');

        // lock page scroll while a finger/pointer is down
        document.body.style.overflow  = 'hidden';
        document.body.style.userSelect = 'none';
        document.body.style.touchAction = 'none';

        document.addEventListener('mousemove', onMove);
        document.addEventListener('touchmove', onMove, { passive: false });
        document.addEventListener('mouseup',   onEnd);
        document.addEventListener('touchend',  onEnd);
    }

    // ── drag move ──
    function onMove(e) {
        if (!draggableItem) return;
        e.preventDefault();

        const cx = e.clientX ?? e.touches[0].clientX;
        const cy = e.clientY ?? e.touches[0].clientY;

        // 1. follow the pointer
        draggableItem.style.transform =
            `translate(${cx - pointerStartX}px, ${cy - pointerStartY}px)`;

        // 2. decide which idle items should slide out of the way
        const dRect   = draggableItem.getBoundingClientRect();
        const dCenter = dRect.top + dRect.height / 2;

        getIdleItems().forEach(item => {
            const iCenter = item.getBoundingClientRect().top +
                            item.getBoundingClientRect().height / 2;

            if (isAbove(item)) {
                // item started above → it "toggles" (slides down) when the
                // dragged item's centre passes above its centre
                if (dCenter <= iCenter) item.dataset.isToggled = '';
                else                    delete item.dataset.isToggled;
            } else {
                // item started below → slides up when dragged centre passes below
                if (dCenter >= iCenter) item.dataset.isToggled = '';
                else                    delete item.dataset.isToggled;
            }
        });

        // 3. apply (or clear) the slide transform on every idle item
        getIdleItems().forEach(item => {
            if (isToggled(item)) {
                const dir = isAbove(item) ? 1 : -1;   // above→slide down (+), below→slide up (-)
                item.style.transform =
                    `translateY(${dir * (dRect.height + itemsGap)}px)`;
            } else {
                item.style.transform = '';
            }
        });
    }

    // ── drag end ──
    function onEnd(e) {
        if (!draggableItem) return;

        const all           = getAllItems();
        const originalIndex = all.indexOf(draggableItem);

        // Reconstruct the final order using the same sparse-array trick as the
        // CodePen: each toggled item shifts its index by ±1; the dragged item
        // fills the one slot that is left empty.
        const reordered = [];
        all.forEach((item, i) => {
            if (item === draggableItem) return;                          // skip; placed below
            if (!isToggled(item))       { reordered[i] = item; return; } // unmoved
            reordered[isAbove(item) ? i + 1 : i - 1] = item;            // shifted
        });

        let newIndex = originalIndex;
        for (let i = 0; i < all.length; i++) {
            if (reordered[i] === undefined) { newIndex = i; break; }
        }

        // wipe all visual state before committing (reorderTasks re-renders the modal)
        draggableItem.classList.remove('dragging');
        draggableItem.style.transform = '';
        all.forEach(item => {
            delete item.dataset.isAbove;
            delete item.dataset.isToggled;
            item.style.transform = '';
        });

        reset();

        // persist the new order (updates state → saves to MongoDB → re-renders modal)
        if (originalIndex !== newIndex) {
            reorderTasks(projectId, originalIndex, newIndex);
        }
    }

    // ── cleanup ──
    function reset() {
        cachedItems     = [];
        draggableItem   = null;
        document.body.style.overflow    = '';
        document.body.style.userSelect  = '';
        document.body.style.touchAction = '';
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('touchmove', onMove);
        document.removeEventListener('mouseup',   onEnd);
        document.removeEventListener('touchend',  onEnd);
    }

    // ── attach ──
    taskList.addEventListener('mousedown',  onStart);
    taskList.addEventListener('touchstart', onStart, { passive: false });
}

// ============================================================================
// MODAL MANAGEMENT
// ============================================================================

function openProjectModal(projectId, options = {}) {
    const project = state.findProject(projectId);
    if (!project) return;

    const tasks = Array.isArray(project.tasks) ? project.tasks : [];
    const collaborators = Array.isArray(project.collaborators) ? project.collaborators : [];
    const hideCompleted = state.shouldHideCompletedTasks();
    const displayTasks = hideCompleted ? tasks.filter(t => !t.completed) : tasks;

    const completedTasks = tasks.filter(t => t.completed).length;
    const totalTasks = tasks.length;
    const percentage = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;
    
    const modal = document.getElementById('projectModal');
    const content = document.getElementById('modalContent');
    
    const selectedTasks = state.getSelectedTasks(projectId);
    
    content.innerHTML = `<div class="modal-scroll-inner">
        <div class="modal-header-centered">
            <div class="modal-title-container">
                <div class="modal-title" id="modal-title-${project.id}" onclick="editModalTitle('${project.id}')" style="cursor: pointer;">${project.title}</div>
                <input type="text" 
                       class="modal-title-input" 
                       id="modal-title-input-${project.id}"
                       value="${project.title}"
                       style="display: none;"
                       onblur="finishEditModalTitle('${project.id}')"
                       onkeydown="if(event.key==='Enter') finishEditModalTitle('${project.id}')" >
                <div class="modal-stats">
                    <span>Created ${new Date(project.dateCreated).toLocaleDateString()}</span>
                    <span>•</span>
                    <span>Updated ${formatCompactDateTime(project.lastModified || project.dateCreated)}</span>
                    <span>•</span>
                    <span>${totalTasks} tasks</span>
                    <span>•</span>
                    <span>${completedTasks} done</span>
                </div>
            </div>
            <div style="display: flex; gap: 4px;">
                <button class="modal-copy-button" onclick="copyProjectToClipboard('${project.id}', event)">
                    <svg class="icon-lg" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"></path>
                    </svg>
                </button>
                <button class="modal-close" onclick="closeProjectModal()">
                    <svg class="icon-lg" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
                    </svg>
                </button>
            </div>
        </div>
        
        <div class="modal-progress">
            <div class="progress-bar-container">
                <div class="progress-bar" data-progress-bar="${project.id}" style="width: ${percentage}%"></div>
            </div>
            <div class="progress-text-large" data-progress-text="${project.id}">${percentage}%</div>
        </div>
        
        <!-- Tabs for Tasks, Notes and Members -->
        <div class="modal-tabs">
            <button class="modal-tab active" id="tasks-tab-${project.id}" onclick="switchModalTab('${project.id}', 'tasks')">Tasks</button>
            <button class="modal-tab" id="notes-tab-${project.id}" onclick="switchModalTab('${project.id}', 'notes')">Notes</button>
            <button class="modal-tab" id="members-tab-${project.id}" onclick="switchModalTab('${project.id}', 'members')">
                Members ${collaborators.length > 0 ? `<span class="members-count">${collaborators.length}</span>` : ''}
            </button>
            <button class="modal-tab" id="history-tab-${project.id}" onclick="switchModalTab('${project.id}', 'history')">History</button>
        </div>
        
        <!-- Tasks Section -->
        <div class="modal-section" id="tasks-section-${project.id}">
            <!-- Add Task Button at Top -->
            <button class="modal-add-task-top" onclick="addTaskToModal('${project.id}')">
                <svg class="icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"></path>
                </svg>
                Add Task
            </button>
            
            <!-- Hide Completed Toggle with Block Slider -->
            <div class="hide-completed-toggle">
                <div class="toggle-label">Hide completed tasks</div>
                <label class="toggle-switch">
                    <input type="checkbox" id="hide-completed-checkbox" ${hideCompleted ? 'checked' : ''} 
                           onchange="toggleHideCompleted()">
                    <span class="toggle-slider"></span>
                </label>
            </div>
            
            <div class="modal-tasks">
                <div class="task-list" id="modal-task-list-${project.id}">
                    ${displayTasks.map(task => `
                        <div class="task-item ${selectedTasks.has(task.id) ? 'selected' : ''}" 
                             data-task-item 
                             data-task-id="${task.id}"
                             onclick="handleTaskClick('${project.id}', ${task.id}, event)">
                            <svg class="task-drag-handle" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 8h16M4 16h16"></path>
                            </svg>
                            <div class="task-checkbox ${task.completed ? 'checked' : ''}" 
                                 data-task-checkbox="${task.id}"
                                 onclick="event.stopPropagation(); toggleTask('${project.id}', ${task.id})">
                                ${task.completed ? `
                                    <svg class="icon" fill="none" stroke="#f0f4f8" viewBox="0 0 24 24">
                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path>
                                    </svg>
                                ` : ''}
                            </div>
                            <span class="task-text ${task.completed ? 'completed' : ''}" 
                                  data-task-text="${task.id}"
                                  id="modal-task-text-${task.id}"
                                  onclick="event.stopPropagation(); editModalTask(${task.id})">${task.text}</span>
                            <input type="text" 
                                   class="task-input"
                                   id="modal-task-input-${task.id}"
                                   value="${task.text}"
                                   placeholder="New task"
                                   style="display: none;"
                                   onblur="finishEditModalTask('${project.id}', ${task.id})"
                                   onkeydown="if(event.key==='Enter') finishEditModalTask('${project.id}', ${task.id})">
                            <button class="delete-button" onclick="event.stopPropagation(); deleteTaskFromModal('${project.id}', ${task.id})" style="opacity: 1;">
                                <svg class="icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path>
                                </svg>
                            </button>
                        </div>
                    `).join('')}
                </div>
                
                <!-- Paste Tasks Section in Modal -->
                <div style="margin-top: 24px; padding-top: 24px; border-top: 1px solid rgba(47, 39, 206, 0.1);">
                    <h4 style="font-size: 14px; font-weight: bold; color: #2d3748; margin-bottom: 12px;">Tasks List</h4>
                    <textarea 
                        id="modal-paste-box-${project.id}"
                        placeholder="Enter tasks here"
                        style="width: 100%; min-height: 80px; background: #e8ecf1; border: 1px solid rgba(47, 39, 206, 0.2); border-radius: 8px; padding: 12px; color: #2d3748; font-size: 12px; font-family: inherit; resize: vertical; box-shadow: inset 4px 4px 8px rgba(174, 174, 192, 0.4), inset -4px -4px 8px rgba(255, 255, 255, 0.9); outline: none;"></textarea>
                    <button 
                        onclick="pasteTasksInModal('${project.id}')"
                        style="width: 100%; margin-top: 8px; padding: 8px; background: rgba(47, 39, 206, 0.2); border: none; border-radius: 8px; color: #2f27ce; font-size: 12px; cursor: pointer; font-family: inherit;">
                        Add Pasted Tasks
                    </button>
                </div>
            </div>
            
            <!-- Modal Actions - Only in Tasks Tab -->
            ${project.userRole === 'viewer' ? `
            <div class="viewer-banner">
                <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0zM2.458 12C3.732 7.943 7.523 5 12 5c4.477 0 8.268 2.943 9.542 7-1.274 4.057-5.065 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/>
                </svg>
                You have viewer access ${project.ownerName ? '— shared by ' + project.ownerName : ''}
            </div>` : `
            <div class="modal-actions">
                ${project.archived ? `<button class="modal-delete-btn" onclick="restoreArchivedProject('${project.id}')">Restore Project</button>` : `<button class="modal-delete-btn" onclick="archiveProject('${project.id}')">Archive Project</button>`}
                ${project.userRole === 'owner' ? `<button class="modal-delete-btn" onclick="confirmDeleteProject('${project.id}')">Delete Project</button>` : ''}
                <button class="modal-done-btn" onclick="completeProjectFromModal('${project.id}')">
                    ${project.completed ? 'Mark as Active' : 'Mark as Complete'}
                </button>
            </div>`}
        </div>
        
        <!-- Members Section -->
        <div class="modal-section hidden" id="members-section-${project.id}">
            <div class="members-panel">
                <!-- Owner -->
                <div class="members-list">
                    <div class="member-row member-row--owner">
                        <div class="member-info">
                            <span class="member-avatar">${(project.ownerName || 'O')[0].toUpperCase()}</span>
                            <div>
                                <div class="member-name">${project.ownerName || 'Owner'}</div>
                                <div class="member-email">${project.ownerEmail || ''}</div>
                            </div>
                        </div>
                        <span class="member-role-badge member-role-badge--owner">owner</span>
                    </div>
                    ${(project.collaborators || []).map(c => `
                    <div class="member-row">
                        <div class="member-info">
                            <span class="member-avatar">${c.username[0].toUpperCase()}</span>
                            <div>
                                <div class="member-name">${c.username}</div>
                                <div class="member-email">${c.email}</div>
                            </div>
                        </div>
                        <div class="member-actions">
                            ${project.userRole === 'owner' ? `
                            <select class="member-role-select" onchange="changeCollaboratorRole('${project.id}', '${c.userId}', this.value)">
                                <option value="viewer" ${c.role === 'viewer' ? 'selected' : ''}>viewer</option>
                                <option value="editor" ${c.role === 'editor' ? 'selected' : ''}>editor</option>
                            </select>
                            <button class="member-remove-btn" onclick="removeCollaborator('${project.id}', '${c.userId}')" title="Remove">
                                <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
                                </svg>
                            </button>
                            ` : `<span class="member-role-badge member-role-badge--${c.role}">${c.role}</span>`}
                        </div>
                    </div>
                    `).join('')}
                </div>

                ${project.userRole === 'owner' ? `
                <!-- Invite form (owner only) -->
                <div class="invite-form">
                    <h4 class="invite-title">Invite someone</h4>
                    <div class="invite-row">
                        <input class="invite-email-input" id="invite-email-${project.id}"
                               type="email" placeholder="their@email.com">
                        <select class="invite-role-select" id="invite-role-${project.id}">
                            <option value="editor">editor</option>
                            <option value="viewer">viewer</option>
                        </select>
                    </div>
                    <p class="invite-role-hint" id="invite-role-hint-${project.id}">
                        <strong>Editor</strong> — can add, edit and complete tasks<br>
                        <strong>Viewer</strong> — read-only access
                    </p>
                    <p class="invite-error hidden" id="invite-error-${project.id}"></p>
                    <button class="invite-submit-btn" onclick="inviteCollaborator('${project.id}')">Send Invite</button>
                </div>
                ` : '<p class="viewer-note">Contact the project owner to change member settings.</p>'}
            </div>
        </div>

        <!-- Notes Section -->
        <div class="modal-section hidden" id="notes-section-${project.id}">
            <div class="modal-notes">
                <textarea 
                    class="notes-textarea"
                    id="notes-textarea-${project.id}"
                    placeholder="Add notes about this project..."
                    onblur="saveProjectNotes('${project.id}')">${project.notes || ''}</textarea>
            </div>
        </div>

        <div class="modal-section hidden" id="history-section-${project.id}">
            <div class="project-activity-list">
                ${getProjectActivities(project).length ? getProjectActivities(project).map(activity => `
                    <div class="project-activity-item">
                        <div class="project-activity-meta">
                            <span>${escapeHtml(activity.actorName || 'System')}</span>
                            <span>${escapeHtml(formatCompactDateTime(activity.createdAt))}</span>
                        </div>
                        <div class="project-activity-message">${escapeHtml(activity.message || 'Updated the project')}</div>
                    </div>
                `).join('') : '<div class="side-panel-empty">No activity yet</div>'}
            </div>
        </div>
    </div>`;
    
    modal.classList.add('active');

    if (options.restoreState) {
        restoreProjectModalState(project.id, options.restoreState);
    }
    
    // Setup drag and drop for tasks
    setTimeout(() => setupTaskDragAndDrop(project.id), 100);
}


function switchModalTab(projectId, tab) {
    ['tasks', 'notes', 'members', 'history'].forEach(s => {
        const sec = document.getElementById(`${s}-section-${projectId}`);
        const btn = document.getElementById(`${s}-tab-${projectId}`);
        if (!sec || !btn) return;
        if (s === tab) { sec.classList.remove('hidden'); btn.classList.add('active'); }
        else           { sec.classList.add('hidden');    btn.classList.remove('active'); }
    });
}

function saveProjectNotes(projectId) {
    const textarea = document.getElementById(`notes-textarea-${projectId}`);
    if (textarea) {
        updateProjectNotes(projectId, textarea.value);
    }
}

function toggleHideCompleted() {
    const checkbox = document.getElementById('hide-completed-checkbox');
    state.setHideCompletedTasks(checkbox.checked);
    
    // Find the currently open modal project
    const modalContent = document.getElementById('modalContent');
    const progressBar = modalContent.querySelector('[data-progress-bar]');
    const projectId = progressBar?.getAttribute('data-progress-bar');
    if (projectId) {
        const project = state.findProject(projectId);
        if (!project) return;

        const hideCompleted = checkbox.checked;
        const displayTasks = hideCompleted ? project.tasks.filter(t => !t.completed) : project.tasks;
        const selectedTasks = state.getSelectedTasks(projectId);

        const taskList = document.getElementById(`modal-task-list-${projectId}`);
        if (taskList) {
            taskList.innerHTML = displayTasks.map(task => `
                <div class="task-item ${selectedTasks.has(task.id) ? 'selected' : ''}" 
                     data-task-item 
                     data-task-id="${task.id}"
                     onclick="handleTaskClick('${projectId}', ${task.id}, event)">
                    <svg class="task-drag-handle" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 8h16M4 16h16"></path>
                    </svg>
                    <div class="task-checkbox ${task.completed ? 'checked' : ''}" 
                         data-task-checkbox="${task.id}"
                         onclick="event.stopPropagation(); toggleTask('${projectId}', ${task.id})">
                        ${task.completed ? `
                            <svg class="icon" fill="none" stroke="#f0f4f8" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path>
                            </svg>
                        ` : ''}
                    </div>
                    <span class="task-text ${task.completed ? 'completed' : ''}" 
                          data-task-text="${task.id}"
                          id="modal-task-text-${task.id}"
                          onclick="event.stopPropagation(); editModalTask(${task.id})">${task.text}</span>
                    <input type="text" 
                           class="task-input"
                           id="modal-task-input-${task.id}"
                           value="${task.text}"
                           placeholder="New task"
                           style="display: none;"
                           onblur="finishEditModalTask('${projectId}', ${task.id})"
                           onkeydown="if(event.key==='Enter') finishEditModalTask('${projectId}', ${task.id})">
                    <button class="delete-button" onclick="event.stopPropagation(); deleteTaskFromModal('${projectId}', ${task.id})" style="opacity: 1;">
                        <svg class="icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path>
                        </svg>
                    </button>
                </div>
            `).join('');
            // Re-attach drag-and-drop to the new task elements
            setTimeout(() => setupTaskDragAndDrop(projectId), 100);
        }
    }
}

function closeProjectModal() {
    const modal = document.getElementById('projectModal');
    modal.classList.remove('active');
    state.clearAllTaskSelections();
    render();
}

function editModalTitle(projectId) {
    const titleDiv = document.getElementById(`modal-title-${projectId}`);
    const titleInput = document.getElementById(`modal-title-input-${projectId}`);
    if (titleDiv && titleInput) {
        titleDiv.style.display = 'none';
        titleInput.style.display = 'block';
        titleInput.focus();
        titleInput.select();
    }
}

function finishEditModalTitle(projectId) {
    const titleDiv = document.getElementById(`modal-title-${projectId}`);
    const titleInput = document.getElementById(`modal-title-input-${projectId}`);
    if (titleDiv && titleInput) {
        updateProjectTitle(projectId, titleInput.value);
        titleDiv.textContent = toTitleCase(titleInput.value);
        titleDiv.style.display = 'block';
        titleInput.style.display = 'none';
    }
}

function editModalTask(taskId) {
    const taskText = document.getElementById(`modal-task-text-${taskId}`);
    const taskInput = document.getElementById(`modal-task-input-${taskId}`);
    if (taskText && taskInput) {
        taskText.style.display = 'none';
        taskInput.style.display = 'block';
        taskInput.focus();
        taskInput.select();
    }
}

function finishEditModalTask(projectId, taskId) {
    const taskText = document.getElementById(`modal-task-text-${taskId}`);
    const taskInput = document.getElementById(`modal-task-input-${taskId}`);
    if (taskText && taskInput) {
        const trimmed = taskInput.value.trim();
        if (trimmed.length === 0) {
            // Empty text — remove the task entirely, don't persist it
            deleteTask(projectId, taskId);
            openProjectModal(projectId);
            return;
        }
        updateTaskText(projectId, taskId, trimmed);
        taskText.textContent = capitalizeFirstLetter(trimmed);
        taskText.style.display = 'block';
        taskInput.style.display = 'none';
    }
}

function addTaskToModal(projectId) {
    
    
    const newTaskId = addTaskToProject(projectId);
    render();
    
    // Re-open modal to show new task
    openProjectModal(projectId);
    
    // Auto-focus
    setTimeout(() => editModalTask(newTaskId), 50);
}

function deleteTaskFromModal(projectId, taskId) {
    deleteTask(projectId, taskId);
    openProjectModal(projectId);
}

function completeProjectFromModal(projectId) {
    completeProject(projectId);
    closeProjectModal();
}

// ============================================================================
// CONFIRMATION DIALOGS
// ============================================================================

function confirmDeleteProject(projectId) {
    const confirmDialog = document.getElementById('confirmDialog');
    const confirmBtn = document.getElementById('confirmDeleteBtn');
    
    confirmBtn.onclick = () => {
        deleteProject(projectId);
        closeConfirmDialog();
        closeProjectModal();
    };
    
    confirmDialog.classList.add('active');
}

function confirmDeleteProjectCard(projectId) {
    const confirmDialog = document.getElementById('confirmDialog');
    const confirmBtn = document.getElementById('confirmDeleteBtn');
    
    confirmBtn.onclick = () => {
        deleteProject(projectId);
        closeConfirmDialog();
    };
    
    confirmDialog.classList.add('active');
}

function closeConfirmDialog() {
    const confirmDialog = document.getElementById('confirmDialog');
    confirmDialog.classList.remove('active');
}

// ============================================================================
// PASTE FUNCTIONALITY
// ============================================================================

function pasteTasks() {
    
    
    const projectSelect = document.getElementById('pasteProjectSelect');
    const pasteBox = document.getElementById('pasteBox');
    const projectId = projectSelect.value;
    const taskText = pasteBox.value.trim();
    
    if (!projectId || !taskText) return;
    
    const taskLines = taskText.split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0);
    
    if (taskLines.length === 0) return;
    
    const project = state.findProject(projectId);
    if (!project) return;
    
    const newTasks = taskLines.map(text => ({
        id: Date.now() + Math.random(),
        text: capitalizeFirstLetter(text),
        completed: false
    }));
    
    const updatedTasks = sortTasks([...project.tasks, ...newTasks]);
    state.updateProject(projectId, projectUpdate({ tasks: updatedTasks }));
    
    pasteBox.value = '';
    projectSelect.value = '';
    document.getElementById('pasteButton').disabled = true;
    
    saveData();
    render();
}

function pasteTasksInModal(projectId) {
    
    
    const pasteBox = document.getElementById(`modal-paste-box-${projectId}`);
    const taskText = pasteBox.value.trim();
    
    if (!taskText) return;
    
    const taskLines = taskText.split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0);
    
    if (taskLines.length === 0) return;
    
    const project = state.findProject(projectId);
    if (!project) return;
    
    const newTasks = taskLines.map(text => ({
        id: Date.now() + Math.random(),
        text: capitalizeFirstLetter(text),
        completed: false
    }));
    
    const updatedTasks = sortTasks([...project.tasks, ...newTasks]);
    state.updateProject(projectId, projectUpdate({ tasks: updatedTasks }));
    
    saveData();
    openProjectModal(projectId);
}

async function archiveProject(projectId) {
    const project = state.findProject(projectId);
    if (!project || !project._id) return;
    state.updateProject(projectId, projectUpdate({ archived: true }));
    await saveData();
    closeProjectModal();
    render();
}

async function restoreArchivedProject(projectId) {
    const project = state.findProject(projectId);
    if (!project || !project._id) return;
    state.updateProject(projectId, projectUpdate({ archived: false }));
    await saveData();
    render();
}

function getCommandPaletteActions() {
    const currentVisible = getFilteredProjects();
    return [
        { id: 'new-project', title: 'Create new project', copy: 'Add a project and open it immediately.', run: () => addProject() },
        { id: 'view-active', title: 'Switch to Active Projects', copy: 'Show active projects.', run: () => switchToActiveView() },
        { id: 'view-completed', title: 'Switch to Completed Projects', copy: 'Show completed projects.', run: () => switchToCompletedView() },
        { id: 'toggle-panel', title: 'Toggle control panel', copy: 'Collapse or expand the side panel.', run: () => {
            const controlPanel = document.getElementById('controlPanel');
            if (state.isControlPanelOpen()) document.getElementById('collapseButton')?.click();
            else document.getElementById('expandButton')?.click();
        } },
        { id: 'open-account', title: 'Open account settings', copy: 'Edit your profile and stats.', run: () => openAccountSettingsModal() },
        { id: 'open-ui', title: 'Open UI options', copy: 'Change the current theme.', run: () => openUiOptionsModal() },
        { id: 'mark-notifications', title: 'Mark all notifications as read', copy: 'Clear unread notification badges.', run: () => markAllNotificationsRead() },
        ...currentVisible.slice(0, 10).map(project => ({
            id: `open-${project.id}`,
            title: `Open ${project.title}`,
            copy: `Open project details. Updated ${formatCompactDateTime(project.lastModified || project.dateCreated)}.`,
            run: () => openProjectModal(project.id)
        })),
        ...getArchivedProjects().slice(0, 10).map(project => ({
            id: `restore-${project.id}`,
            title: `Restore ${project.title}`,
            copy: 'Restore this archived project.',
            run: () => restoreArchivedProject(project.id)
        }))
    ];
}

function renderCommandPalette() {
    const list = document.getElementById('commandPaletteList');
    const input = document.getElementById('commandPaletteInput');
    if (!list || !input) return;
    const query = uiState.commandQuery.trim().toLowerCase();
    const actions = getCommandPaletteActions().filter(action => {
        if (!query) return true;
        return `${action.title} ${action.copy}`.toLowerCase().includes(query);
    });
    if (uiState.commandActiveIndex >= actions.length) uiState.commandActiveIndex = 0;
    list.innerHTML = actions.length ? actions.map((action, index) => `
        <button class="command-palette-item ${index === uiState.commandActiveIndex ? 'is-active' : ''}" type="button" data-command-id="${action.id}">
            <span class="command-palette-title">${escapeHtml(action.title)}</span>
            <span class="command-palette-copy">${escapeHtml(action.copy)}</span>
        </button>
    `).join('') : '<div class="side-panel-empty">No commands found</div>';

    list.querySelectorAll('[data-command-id]').forEach((button, index) => {
        button.addEventListener('click', () => {
            actions[index]?.run();
            closeCommandPalette();
        });
    });
}

function openCommandPalette() {
    uiState.commandPaletteOpen = true;
    uiState.commandQuery = '';
    uiState.commandActiveIndex = 0;
    const modal = document.getElementById('commandPaletteModal');
    const input = document.getElementById('commandPaletteInput');
    if (modal) modal.classList.add('active');
    if (input) input.value = '';
    renderCommandPalette();
    setTimeout(() => input?.focus(), 20);
}

function closeCommandPalette() {
    uiState.commandPaletteOpen = false;
    document.getElementById('commandPaletteModal')?.classList.remove('active');
}

// ============================================================================
// UI RENDERING
// ============================================================================

function render() {
    const displayProjects = getFilteredProjects();
    const projectGrid = document.getElementById('projectGrid');
    const emptyState = document.getElementById('emptyState');
    if (!projectGrid || !emptyState) return;

    const stats = state.getStats() || { completedTasks: 0, completedProjects: 0 };
    const activeProjectsCountEl = document.getElementById('activeProjectsCount');
    const completedTasksCountEl = document.getElementById('completedTasksCount');
    const completedProjectsCountEl = document.getElementById('completedProjectsCount');

    if (activeProjectsCountEl) activeProjectsCountEl.textContent = state.getProjects().filter(project => !project.completed && !project.archived).length;
    if (completedTasksCountEl) completedTasksCountEl.textContent = stats.completedTasks || 0;
    if (completedProjectsCountEl) completedProjectsCountEl.textContent = stats.completedProjects || 0;

    const incompleteTasks = state.getProjects().filter(project => !project.completed && !project.archived)
        .reduce((sum, p) => sum + (Array.isArray(p.tasks) ? p.tasks.filter(t => !t.completed).length : 0), 0);
    const incompleteEl = document.getElementById('incompleteTasksCount');
    if (incompleteEl) incompleteEl.textContent = incompleteTasks;

    runRenderStep('total completion', updateTotalCompletion);
    runRenderStep('view title', syncViewTitle);
    runRenderStep('shared projects panel', renderSharedProjectsPanel);
    runRenderStep('archived projects panel', renderArchivedProjectsPanel);
    runRenderStep('notifications panel', renderNotificationsPanel);
    runRenderStep('saved views panel', renderSavedViewsPanel);
    runRenderStep('active filter chips', renderActiveFilterChips);
    runRenderStep('account stats', syncAccountStatsToModal);
    runRenderStep('undo button', updateUndoButton);

    if (displayProjects.length === 0) {
        emptyState.style.display = 'flex';
        projectGrid.style.display = 'none';
        const emptyTitle = emptyState.querySelector('.title');
        const emptySubtitle = emptyState.querySelector('.subtitle');
        if (emptyTitle) emptyTitle.textContent = uiState.projectSearch.trim() ? 'No matching projects' : (state.getView() === VIEWS.ACTIVE ? 'No active projects' : 'No completed projects');
        if (emptySubtitle) emptySubtitle.textContent = uiState.projectSearch.trim() ? 'Try a broader search or different filters' : 'Click "Add Project" to get started';
    } else {
        emptyState.style.display = 'none';
        projectGrid.style.display = 'grid';
        projectGrid.innerHTML = displayProjects.map(renderProjectCard).join('');

        if (!uiState.projectSearch.trim() && uiState.ownerFilter === 'all' && uiState.sortMode === 'manual') {
            setTimeout(setupProjectDragAndDrop, 100);
        }
    }

    runRenderStep('project select', updateProjectSelect);
}


function renderProjectCard(project) {
    const tasks = Array.isArray(project.tasks) ? project.tasks : [];
    const collaborators = Array.isArray(project.collaborators) ? project.collaborators : [];
    const completedTasksCount = tasks.filter(t => t.completed).length;
    const totalTasks = tasks.length;
    const progressPercentage = totalTasks > 0 ? Math.round((completedTasksCount / totalTasks) * 100) : 0;
    const isShared = collaborators.length > 0;
    const isViewer = project.userRole === 'viewer';
    const isEditor = project.userRole === 'editor';
    const canEditProject = state.canEdit(project.id);
    const canOwnerDelete = project.userRole === 'owner';
    const canReorderProject = canEditProject && !uiState.projectSearch.trim() && uiState.ownerFilter === 'all' && uiState.sortMode === 'manual';

    return `
        <div class="project-card ${isViewer ? 'project-card--viewer' : ''}"
             data-project-id="${project.id}"
             onclick="openProjectModal('${project.id}')">
            <div class="project-header">
                <div class="project-title-container">
                    ${canReorderProject ? `<button class="drag-handle" type="button" title="Drag to reorder" onclick="event.stopPropagation();">
                        <svg class="task-drag-handle" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 8h16M4 16h16"></path>
                        </svg>
                    </button>` : ''}
                    <div class="project-title" id="project-title-${project.id}" ${canEditProject ? `ondblclick="event.stopPropagation(); editProjectTitleOnCard('${project.id}')"` : ''}>${project.title}</div>
                    <input type="text"
                           class="project-title-input project-title-input--card"
                           id="project-title-input-${project.id}"
                           value="${project.title}"
                           style="display: none;"
                           onclick="event.stopPropagation();"
                           onblur="finishEditProjectTitleOnCard('${project.id}')"
                           onkeydown="if(event.key==='Enter'){ finishEditProjectTitleOnCard('${project.id}'); } if(event.key==='Escape'){ cancelEditProjectTitleOnCard('${project.id}'); }">
                </div>
                <div class="project-actions">
                    ${(isViewer || isEditor) ? `<span class="role-badge role-badge--${project.userRole}">${project.userRole}</span>` : ''}
                    ${isShared && !isViewer && !isEditor ? `<span class="shared-badge" title="${collaborators.length} collaborator(s)">
                        <svg width="12" height="12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0"/>
                        </svg>
                        ${collaborators.length}
                    </span>` : ''}
                    ${canEditProject ? `<button class="edit-button" type="button" title="Edit project name" onclick="event.stopPropagation(); editProjectTitleOnCard('${project.id}')">
                        <svg class="icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path>
                        </svg>
                    </button>` : ''}
                    <button class="copy-button" type="button" onclick="event.stopPropagation(); copyProjectToClipboard('${project.id}', event)">
                        <svg class="icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"></path>
                        </svg>
                    </button>
                    ${canOwnerDelete ? `<button class="card-delete-button" type="button" onclick="event.stopPropagation(); confirmDeleteProjectCard('${project.id}')">
                        <svg class="icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path>
                        </svg>
                    </button>` : ''}
                </div>
            </div>

            <div class="project-stats">
                <span>${tasks.length} tasks</span>
                <span>•</span>
                <span>${completedTasksCount} done</span>
                ${(isShared || isViewer || isEditor) ? `<span>•</span><span class="card-owner-name">${isViewer || isEditor ? 'by ' + (project.ownerName || 'Unknown') : 'shared'}</span>` : ''}
            </div>

            <div class="progress-bar-container">
                <div class="progress-bar" data-progress-bar="${project.id}" style="width: ${progressPercentage}%"></div>
            </div>
            <div class="progress-text-large" data-progress-text="${project.id}">${progressPercentage}%</div>
            <div class="project-card-footer">
                <span class="project-last-updated" title="Created ${formatCompactDateTime(project.dateCreated)}">Updated ${formatCompactDateTime(project.lastModified || project.dateCreated)}</span>
                ${project.completed ? `
                <button class="activate-button" onclick="event.stopPropagation(); completeProject('${project.id}')">
                    Activate
                </button>
                ` : ''}
            </div>
        </div>
    `;
}



function renderSharedProjectsPanel() {
    const sharedProjectsList = document.getElementById('sharedProjectsList');
    const sharedProjectsCount = document.getElementById('sharedProjectsCount');
    if (!sharedProjectsList || !sharedProjectsCount) return;

    const sharedActiveProjects = state.getProjects().filter(project => !project.completed && !project.archived).filter(project =>
        project.userRole !== 'owner' || ((project.collaborators || []).length > 0)
    );

    sharedProjectsCount.textContent = String(sharedActiveProjects.length);

    if (!sharedActiveProjects.length) {
        sharedProjectsList.innerHTML = '<div class="side-panel-empty">No shared active projects</div>';
        return;
    }

    sharedProjectsList.innerHTML = sharedActiveProjects.map(project => {
        const tasks = Array.isArray(project.tasks) ? project.tasks : [];
        const collaborators = Array.isArray(project.collaborators) ? project.collaborators : [];
        const completedTasksCount = tasks.filter(task => task.completed).length;
        const totalTasks = tasks.length;
        const progressPercentage = totalTasks > 0 ? Math.round((completedTasksCount / totalTasks) * 100) : 0;
        const accessLabel = project.userRole === 'owner'
            ? `${collaborators.length} collaborator${collaborators.length === 1 ? '' : 's'}`
            : `${project.userRole} access`;
        const ownerLabel = project.userRole === 'owner'
            ? 'Owned by you'
            : `Shared by ${project.ownerName || 'Unknown'}`;

        return `
            <button class="side-project-card" type="button" onclick="openProjectModal('${project.id}')">
                <div class="side-project-card-header">
                    <span class="side-project-card-title">${project.title}</span>
                    <span class="side-project-role">${accessLabel}</span>
                </div>
                <div class="side-project-meta">${ownerLabel}</div>
                <div class="mini-progress-track"><span style="width: ${progressPercentage}%"></span></div>
            </button>
        `;
    }).join('');
}

function timeAgo(isoString) {
    if (!isoString) return 'just now';
    const diffMs = Date.now() - new Date(isoString).getTime();
    const seconds = Math.max(1, Math.floor(diffMs / 1000));
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `${days}d ago`;
    const months = Math.floor(days / 30);
    if (months < 12) return `${months}mo ago`;
    return `${Math.floor(months / 12)}y ago`;
}

function renderNotificationsPanel() {
    const notificationsList = document.getElementById('notificationsList');
    const notificationsUnreadCount = document.getElementById('notificationsUnreadCount');
    if (!notificationsList || !notificationsUnreadCount) return;

    notificationsUnreadCount.textContent = String(notificationState.unreadCount || 0);

    if (!notificationState.items.length) {
        notificationsList.innerHTML = '<div class="side-panel-empty">No notifications yet</div>';
        return;
    }

    notificationsList.innerHTML = notificationState.items.map(notification => `
        <button class="notification-card ${notification.read ? '' : 'notification-card--unread'}"
                type="button"
                onclick="openNotificationProject('${notification._id}', '${notification.projectId}')">
            <div class="notification-card-header">
                <span class="notification-project">${notification.projectTitle || 'Project'}</span>
                <span class="notification-time">${timeAgo(notification.createdAt)}</span>
            </div>
            <div class="notification-message"><strong>${notification.actorName || 'Someone'}</strong> ${notification.message}</div>
        </button>
    `).join('');
}

async function refreshNotifications() {
    try {
        const response = await loadNotificationsFromServer(30);
        notificationState.items = response?.notifications || [];
        notificationState.unreadCount = response?.unreadCount || 0;
    } catch (err) {
        console.error('Failed to refresh notifications:', err);
        notificationState.items = [];
        notificationState.unreadCount = 0;
    }
    notificationState.hasLoadedOnce = true;
    renderNotificationsPanel();
}

function startNotificationPolling() {
    if (notificationState.pollHandle) clearInterval(notificationState.pollHandle);
    notificationState.pollHandle = setInterval(() => {
        if (document.hidden) return;
        refreshNotifications();
    }, 15000);
}

async function markNotificationRead(notificationId, suppressRefresh = false) {
    if (!notificationId) return;
    const targetNotification = notificationState.items.find(item => item._id === notificationId);
    if (targetNotification && targetNotification.read) return;
    try {
        await markNotificationReadOnServer(notificationId);
        if (!suppressRefresh) await refreshNotifications();
    } catch (err) {
        console.error('Failed to mark notification read:', err);
    }
}

async function openNotificationProject(notificationId, projectId) {
    await markNotificationRead(notificationId, true);
    const targetNotification = notificationState.items.find(item => item._id === notificationId);
    if (targetNotification) targetNotification.read = true;
    notificationState.unreadCount = notificationState.items.filter(item => !item.read).length;
    renderNotificationsPanel();

    const project = state.findProject(projectId);
    if (project) {
        if (project.completed) {
            switchToCompletedView();
        } else {
            switchToActiveView();
        }
        openProjectModal(projectId);
    }
}

async function markAllNotificationsRead() {
    try {
        await markAllNotificationsReadOnServer();
        notificationState.items = notificationState.items.map(item => ({ ...item, read: true }));
        notificationState.unreadCount = 0;
        renderNotificationsPanel();
    } catch (err) {
        console.error('Failed to mark all notifications read:', err);
    }
}

function editProjectTitleOnCard(projectId) {
    const titleDiv = document.getElementById(`project-title-${projectId}`);
    const titleInput = document.getElementById(`project-title-input-${projectId}`);
    if (!titleDiv || !titleInput) return;
    titleDiv.style.display = 'none';
    titleInput.style.display = 'block';
    titleInput.focus();
    titleInput.select();
}

function finishEditProjectTitleOnCard(projectId) {
    const titleDiv = document.getElementById(`project-title-${projectId}`);
    const titleInput = document.getElementById(`project-title-input-${projectId}`);
    if (!titleDiv || !titleInput) return;
    updateProjectTitle(projectId, titleInput.value);
    titleDiv.textContent = toTitleCase((titleInput.value || '').trim() || 'New Project');
    titleDiv.style.display = 'block';
    titleInput.style.display = 'none';
}

function cancelEditProjectTitleOnCard(projectId) {
    const project = state.findProject(projectId);
    const titleDiv = document.getElementById(`project-title-${projectId}`);
    const titleInput = document.getElementById(`project-title-input-${projectId}`);
    if (!titleDiv || !titleInput || !project) return;
    titleInput.value = project.title;
    titleDiv.style.display = 'block';
    titleInput.style.display = 'none';
}

function updateProjectSelect() {
    const activeProjects = state.getActiveProjects();
    const projectSelect = document.getElementById('pasteProjectSelect');
    const pasteButton = document.getElementById('pasteButton');
    if (!projectSelect || !pasteButton) return;

    projectSelect.innerHTML = '<option value="">Select a project...</option>' +
        activeProjects.map(p => `<option value="${p.id}">${p.title}</option>`).join('');

    projectSelect.addEventListener('change', () => {
        pasteButton.disabled = !projectSelect.value;
    });
}

// ============================================================================
// EVENT HANDLERS
// ============================================================================

function initializeEventHandlers() {
    // Menu button
    const menuButton = document.getElementById('menuButton');
    const menuDropdown = document.getElementById('menuDropdown');
    const menuContainer = document.getElementById('menuContainer');
    let menuOpen = false;

    if (menuButton && menuDropdown && menuContainer) menuButton.addEventListener('click', (e) => {
        e.stopPropagation();
        if (menuOpen) {
            closeMenuDropdown();
            return;
        }
        menuOpen = true;
        menuDropdown.classList.remove('hidden');
        menuButton.classList.add('active');
    });

    document.addEventListener('click', (e) => {
        if (menuOpen && menuContainer && !menuContainer.contains(e.target)) {
            closeMenuDropdown();
        }
    });

    function closeMenuDropdown() {
        menuOpen = false;
        menuDropdown?.classList.add('hidden');
        menuButton?.classList.remove('active');
        document.getElementById('shortcutsPanel')?.classList.add('hidden');
        document.getElementById('shortcutsWrapper')?.classList.remove('menu-shortcuts-wrapper--open');
        document.getElementById('shortcutsToggle')?.setAttribute('aria-expanded', 'false');
    }

    document.getElementById('menuSignOutBtn')?.addEventListener('click', () => {
        closeMenuDropdown();
        logout();
    });

    document.getElementById('menuAccountSettingsBtn')?.addEventListener('click', () => {
        closeMenuDropdown();
        openAccountSettingsModal();
    });

    document.getElementById('menuUiOptionsBtn')?.addEventListener('click', () => {
        closeMenuDropdown();
        openUiOptionsModal();
    });

    document.getElementById('panelUserPill')?.addEventListener('click', () => {
        openAccountSettingsModal();
    });

    // Control panel toggle
    const collapseButton = document.getElementById('collapseButton');
    const expandButton = document.getElementById('expandButton');
    const controlPanel = document.getElementById('controlPanel');
    const viewport = document.getElementById('viewport');

    const syncControlPanelState = () => {
        const isCollapsed = !!controlPanel?.classList.contains('collapsed');
        document.body.classList.toggle('control-panel-is-collapsed', isCollapsed);
        collapseButton?.classList.toggle('hidden', isCollapsed);
        expandButton?.classList.toggle('hidden', !isCollapsed);
        collapseButton?.setAttribute('aria-expanded', String(!isCollapsed));
        expandButton?.setAttribute('aria-expanded', String(isCollapsed));
    };

    const collapseControlPanel = () => {
        if (!controlPanel || !expandButton) return;
        state.setControlPanelOpen(false);
        controlPanel.classList.add('collapsed');
        viewport?.classList.remove('full');
        syncControlPanelState();
    };

    const expandControlPanel = () => {
        if (!controlPanel || !expandButton) return;
        state.setControlPanelOpen(true);
        controlPanel.classList.remove('collapsed');
        viewport?.classList.remove('full');
        syncControlPanelState();
    };

    collapseButton?.addEventListener('click', collapseControlPanel);
    expandButton?.addEventListener('click', expandControlPanel);
    syncControlPanelState();

    // Add project button
    document.getElementById('addProjectButton')?.addEventListener('click', addProject);

    // Undo button
    document.getElementById('undoButton')?.addEventListener('click', performUndo);

    // Paste button
    document.getElementById('pasteButton')?.addEventListener('click', pasteTasks);

    document.getElementById('markAllNotificationsReadBtn')?.addEventListener('click', markAllNotificationsRead);

    // Click outside modal to close
    const projectModal = document.getElementById('projectModal');
    projectModal?.addEventListener('click', (e) => {
        if (e.target === projectModal) {
            closeProjectModal();
        }
    });

    const confirmDialog = document.getElementById('confirmDialog');
    confirmDialog?.addEventListener('click', (e) => {
        if (e.target === confirmDialog) {
            closeConfirmDialog();
        }
    });

    const accountSettingsModal = document.getElementById('accountSettingsModal');
    accountSettingsModal?.addEventListener('click', (e) => {
        if (e.target === accountSettingsModal) {
            closeAccountSettingsModal();
        }
    });

    document.getElementById('uiOptionsModal')?.addEventListener('click', (e) => {
        if (e.target.id === 'uiOptionsModal') closeUiOptionsModal();
    });

    document.getElementById('commandPaletteModal')?.addEventListener('click', (e) => {
        if (e.target.id === 'commandPaletteModal') closeCommandPalette();
    });

    document.getElementById('projectSearchInput')?.addEventListener('input', (e) => {
        uiState.projectSearch = e.target.value || '';
        uiState.activeSavedViewId = '';
        render();
    });
    document.getElementById('projectOwnerFilter')?.addEventListener('change', (e) => {
        uiState.ownerFilter = e.target.value || 'all';
        uiState.activeSavedViewId = '';
        render();
    });
    document.getElementById('projectSortSelect')?.addEventListener('change', (e) => {
        uiState.sortMode = e.target.value || 'manual';
        uiState.activeSavedViewId = '';
        render();
    });
    document.getElementById('saveCurrentViewBtn')?.addEventListener('click', saveCurrentView);
    document.getElementById('clearSavedViewsBtn')?.addEventListener('click', clearSavedViews);
    document.querySelectorAll('[data-theme-option]').forEach(button => {
        button.addEventListener('click', () => applyTheme(button.getAttribute('data-theme-option')));
    });
    document.getElementById('commandPaletteInput')?.addEventListener('input', (e) => {
        uiState.commandQuery = e.target.value || '';
        uiState.commandActiveIndex = 0;
        renderCommandPalette();
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        const tagName = e.target.tagName;
        if ((tagName === 'INPUT' || tagName === 'TEXTAREA') && !(uiState.commandPaletteOpen && e.target.id === 'commandPaletteInput')) {
            return;
        }

        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
            e.preventDefault();
            if (uiState.commandPaletteOpen) closeCommandPalette();
            else openCommandPalette();
            return;
        }

        if (uiState.commandPaletteOpen) {
            const actions = getCommandPaletteActions().filter(action => {
                const query = uiState.commandQuery.trim().toLowerCase();
                return !query || `${action.title} ${action.copy}`.toLowerCase().includes(query);
            });
            if (e.key === 'Escape') { closeCommandPalette(); return; }
            if (e.key === 'ArrowDown') { e.preventDefault(); uiState.commandActiveIndex = Math.min(actions.length - 1, uiState.commandActiveIndex + 1); renderCommandPalette(); return; }
            if (e.key === 'ArrowUp') { e.preventDefault(); uiState.commandActiveIndex = Math.max(0, uiState.commandActiveIndex - 1); renderCommandPalette(); return; }
            if (e.key === 'Enter') { e.preventDefault(); actions[uiState.commandActiveIndex]?.run(); closeCommandPalette(); return; }
        }
        
        switch(e.key.toLowerCase()) {
            case SHORTCUTS.NEW_PROJECT:
                addProject();
                break;
            case SHORTCUTS.TOGGLE_PANEL:
                if (state.isControlPanelOpen()) {
                    collapseButton.click();
                } else {
                    expandButton.click();
                }
                break;
            case SHORTCUTS.TOGGLE_MENU:
                menuButton.click();
                break;
            case SHORTCUTS.VIEW_ACTIVE:
                switchToActiveView();
                break;
            case SHORTCUTS.VIEW_COMPLETED:
                switchToCompletedView();
                break;
            case 'z':
                if (e.ctrlKey || e.metaKey) {
                    e.preventDefault();
                    performUndo();
                } else {
                    performUndo();
                }
                break;
            case SHORTCUTS.HELP:
                alert(`Keyboard Shortcuts:

N - New Project
C - Toggle Control Panel
M - Toggle Menu
A - View Active Projects
D - View Completed Projects
Z - Undo (last deletion)
? - Show this help

Task Features:
- Shift+Click - Select multiple tasks
- Newest tasks appear first
- Completed tasks move to bottom
- Hide completed tasks toggle in modal

Features:
- Click on project cards to view/edit details
- Use the card drag handle to reorder projects
- Drag tasks to reorder them faster
- Use copy button (copies only incomplete tasks)
- Click outside expanded cards to close them
- Use the paste box in modals for bulk task import
- Stats are clickable to switch views
- Use tabs in modal for Tasks, Notes, Members, and History
- Ctrl/Cmd+K opens the command palette`);
                break;
        }
    });
}


// ============================================================================
// SHARING FUNCTIONS
// ============================================================================

async function inviteCollaborator(projectId) {
    const emailEl = document.getElementById(`invite-email-${projectId}`);
    const roleEl  = document.getElementById(`invite-role-${projectId}`);
    const errEl   = document.getElementById(`invite-error-${projectId}`);
    if (!emailEl || !roleEl) return;

    const email = emailEl.value.trim();
    const role  = roleEl.value;
    if (errEl) { errEl.textContent = ''; errEl.classList.add('hidden'); }

    if (!email) {
        if (errEl) { errEl.textContent = 'Please enter an email address.'; errEl.classList.remove('hidden'); }
        return;
    }

    const project = state.findProject(projectId);
    if (!project?._id) return;

    try {
        const updated = await shareProjectOnServer(project._id, email, role);
        if (updated) {
            state.updateProject(projectId, projectUpdate({
                collaborators: updated.collaborators || [],
                lastModified: updated.lastModified || new Date().toISOString(),
                __syncedLastModified: updated.lastModified || new Date().toISOString()
            }, { skipTouch: true }));
            emailEl.value = '';
            openProjectModal(projectId);
            // Re-open on Members tab
            setTimeout(() => switchModalTab(projectId, 'members'), 50);
        }
    } catch (err) {
        if (errEl) { errEl.textContent = err.message; errEl.classList.remove('hidden'); }
    }
}

async function changeCollaboratorRole(projectId, userId, newRole) {
    const project = state.findProject(projectId);
    if (!project?._id) return;
    try {
        const updated = await updateCollaboratorRoleOnServer(project._id, userId, newRole);
        if (updated) {
            state.updateProject(projectId, projectUpdate({ collaborators: updated.collaborators || [], lastModified: updated.lastModified || new Date().toISOString(), __syncedLastModified: updated.lastModified || new Date().toISOString() }, { skipTouch: true }));
        }
    } catch (err) {
        alert(`Failed to update role: ${err.message}`);
        openProjectModal(projectId);
        setTimeout(() => switchModalTab(projectId, 'members'), 50);
    }
}

async function removeCollaborator(projectId, userId) {
    const project = state.findProject(projectId);
    if (!project?._id) return;
    try {
        const updated = await removeCollaboratorFromServer(project._id, userId);
        if (updated) {
            state.updateProject(projectId, projectUpdate({ collaborators: updated.collaborators || [], lastModified: updated.lastModified || new Date().toISOString(), __syncedLastModified: updated.lastModified || new Date().toISOString() }, { skipTouch: true }));
            openProjectModal(projectId);
            setTimeout(() => switchModalTab(projectId, 'members'), 50);
        }
    } catch (err) {
        alert(`Failed to remove collaborator: ${err.message}`);
    }
}

// ============================================================================
// GLOBAL FUNCTIONS (for HTML onclick handlers)
// ============================================================================

window.addProject = addProject;
window.deleteProject = deleteProject;
window.completeProject = completeProject;
window.toggleTask = toggleTask;
window.copyProjectToClipboard = copyProjectToClipboard;
window.switchToActiveView = switchToActiveView;
window.switchToCompletedView = switchToCompletedView;
window.openProjectModal = openProjectModal;
window.openAccountSettingsModal = openAccountSettingsModal;
window.closeAccountSettingsModal = closeAccountSettingsModal;
window.triggerProfilePicUpload = triggerProfilePicUpload;
window.removeProfilePicture = removeProfilePicture;
window.saveAccountSettingsFromModal = saveAccountSettingsFromModal;
window.closeProjectModal = closeProjectModal;
window.editModalTitle = editModalTitle;
window.finishEditModalTitle = finishEditModalTitle;
window.editModalTask = editModalTask;
window.finishEditModalTask = finishEditModalTask;
window.addTaskToModal = addTaskToModal;
window.deleteTaskFromModal = deleteTaskFromModal;
window.completeProjectFromModal = completeProjectFromModal;
window.confirmDeleteProject = confirmDeleteProject;
window.confirmDeleteProjectCard = confirmDeleteProjectCard;
window.closeConfirmDialog = closeConfirmDialog;
window.pasteTasks = pasteTasks;
window.pasteTasksInModal = pasteTasksInModal;
window.handleTaskClick = handleTaskClick;
window.switchModalTab = switchModalTab;
window.saveProjectNotes = saveProjectNotes;
window.toggleHideCompleted = toggleHideCompleted;
window.performUndo = performUndo;
window.inviteCollaborator = inviteCollaborator;
window.changeCollaboratorRole = changeCollaboratorRole;
window.removeCollaborator = removeCollaborator;
window.editProjectTitleOnCard = editProjectTitleOnCard;
window.finishEditProjectTitleOnCard = finishEditProjectTitleOnCard;
window.cancelEditProjectTitleOnCard = cancelEditProjectTitleOnCard;
window.openNotificationProject = openNotificationProject;
window.markAllNotificationsRead = markAllNotificationsRead;
window.applySavedView = applySavedView;
window.deleteSavedView = deleteSavedView;
window.restoreArchivedProject = restoreArchivedProject;
window.archiveProject = archiveProject;
window.closeUiOptionsModal = closeUiOptionsModal;
window.openUiOptionsModal = openUiOptionsModal;

// ============================================================================
// INITIALIZATION
// ============================================================================

// ============================================================================
// AUTH SCREEN
// ============================================================================

function showAuthError(formId, message) {
    const el = document.getElementById(formId + 'Error');
    if (el) { el.textContent = message; el.classList.remove('hidden'); }
}

function hideAuthError(formId) {
    const el = document.getElementById(formId + 'Error');
    if (el) el.classList.add('hidden');
}

function setAuthLoading(btnId, loading) {
    const btn = document.getElementById(btnId);
    if (!btn) return;
    btn.disabled = loading;
    btn.textContent = loading ? 'Please wait…' : btn.dataset.label;
}

function switchAuthTab(tab) {
    const loginTab  = document.getElementById('loginTab');
    const registerTab = document.getElementById('registerTab');
    const loginForm = document.getElementById('loginForm');
    const registerForm = document.getElementById('registerForm');

    if (tab === 'login') {
        loginTab.classList.add('auth-tab-active');
        registerTab.classList.remove('auth-tab-active');
        loginForm.classList.remove('hidden');
        registerForm.classList.add('hidden');
    } else {
        registerTab.classList.add('auth-tab-active');
        loginTab.classList.remove('auth-tab-active');
        registerForm.classList.remove('hidden');
        loginForm.classList.add('hidden');
    }
    hideAuthError('login');
    hideAuthError('register');
}
window.switchAuthTab = switchAuthTab;

function initAuthScreen() {
    // Tab switching
    document.getElementById('loginTab')?.addEventListener('click', () => switchAuthTab('login'));
    document.getElementById('registerTab')?.addEventListener('click', () => switchAuthTab('register'));

    // Show / hide password toggles
    document.querySelectorAll('.show-pw-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const input = document.getElementById(btn.dataset.target);
            if (!input) return;
            const isHidden = input.type === 'password';
            input.type = isHidden ? 'text' : 'password';
            btn.querySelector('.eye-show').classList.toggle('hidden', isHidden);
            btn.querySelector('.eye-hide').classList.toggle('hidden', !isHidden);
        });
    });

    // Login form
    document.getElementById('loginSubmitBtn')?.addEventListener('click', async () => {
        hideAuthError('login');
        const email    = document.getElementById('loginEmail')?.value.trim();
        const password = document.getElementById('loginPassword')?.value;
        if (!email || !password) { showAuthError('login', 'Please fill in all fields.'); return; }

        setAuthLoading('loginSubmitBtn', true);
        try {
            const user = await login(email, password);
            // Save email for Remember Me
            const rememberMe = document.getElementById('rememberMe')?.checked;
            if (rememberMe) {
                localStorage.setItem('tracker_remember_email', email);
            } else {
                localStorage.removeItem('tracker_remember_email');
            }
            onAuthSuccess(user);
        } catch (err) {
            showAuthError('login', err.message);
        } finally {
            setAuthLoading('loginSubmitBtn', false);
        }
    });

    // Enter key on login fields
    ['loginEmail', 'loginPassword'].forEach(id => {
        document.getElementById(id)?.addEventListener('keydown', e => {
            if (e.key === 'Enter') document.getElementById('loginSubmitBtn')?.click();
        });
    });

    // Register form
    document.getElementById('registerSubmitBtn')?.addEventListener('click', async () => {
        hideAuthError('register');
        const email    = document.getElementById('registerEmail')?.value.trim();
        const username = document.getElementById('registerUsername')?.value.trim();
        const password = document.getElementById('registerPassword')?.value;
        const confirm  = document.getElementById('registerConfirm')?.value;

        if (!email || !username || !password || !confirm) {
            showAuthError('register', 'Please fill in all fields.'); return;
        }
        if (password !== confirm) {
            showAuthError('register', 'Passwords do not match.'); return;
        }
        if (password.length < 6) {
            showAuthError('register', 'Password must be at least 6 characters.'); return;
        }

        setAuthLoading('registerSubmitBtn', true);
        try {
            const user = await register(email, username, password);
            onAuthSuccess(user);
        } catch (err) {
            showAuthError('register', err.message);
        } finally {
            setAuthLoading('registerSubmitBtn', false);
        }
    });

    // Enter key on register fields
    ['registerEmail', 'registerUsername', 'registerPassword', 'registerConfirm'].forEach(id => {
        document.getElementById(id)?.addEventListener('keydown', e => {
            if (e.key === 'Enter') document.getElementById('registerSubmitBtn')?.click();
        });
    });

    // Logout buttons (panel)
    document.getElementById('accountProfilePicInput')?.addEventListener('change', handleProfilePicSelected);

    // Remember Me — restore saved email if present
    const savedEmail = localStorage.getItem('tracker_remember_email');
    if (savedEmail) {
        const emailEl = document.getElementById('loginEmail');
        if (emailEl) emailEl.value = savedEmail;
        const rememberEl = document.getElementById('rememberMe');
        if (rememberEl) rememberEl.checked = true;
    }

    // Shortcuts toggle
    document.getElementById('shortcutsToggle')?.addEventListener('click', (e) => {
        e.stopPropagation();
        const panel = document.getElementById('shortcutsPanel');
        const wrapper = document.getElementById('shortcutsWrapper');
        const toggle = document.getElementById('shortcutsToggle');
        if (!panel || !wrapper || !toggle) return;
        const isHidden = panel.classList.contains('hidden');
        panel.classList.toggle('hidden', !isHidden);
        wrapper.classList.toggle('menu-shortcuts-wrapper--open', isHidden);
        toggle.setAttribute('aria-expanded', String(isHidden));
    });
}

function onAuthSuccess(user) {
    state.setCurrentUser(user);

    const overlay = document.getElementById('authOverlay');
    if (overlay) overlay.classList.add('hidden');

    try {
        applyAccountUI(user || getCurrentUser?.() || { username: 'User', email: '' });
    } catch (err) {
        console.error('Failed to apply account UI during auth success:', err);
    }
    setSaveStatus('saved', 'All changes saved');

    try {
        initializeEventHandlers();
    } catch (err) {
        console.error('Failed to initialize event handlers:', err);
    }

    Promise.resolve()
        .then(() => loadData())
        .catch(err => {
            console.error('Initial data load failed:', err);
            setSaveStatus('error', 'Could not load user data');
        });

    Promise.resolve()
        .then(() => refreshAccountProfile())
        .catch(err => console.error('Initial account profile load failed:', err));

    try {
        startNotificationPolling();
    } catch (err) {
        console.error('Failed to start notification polling:', err);
    }
}

// ============================================================================
// INITIALIZATION
// ============================================================================

document.addEventListener('DOMContentLoaded', () => {
    loadSavedViewsFromStorage();
    loadThemePreference();
    initAuthScreen();

    if (isLoggedIn()) {
        const user = getCurrentUser();
        onAuthSuccess(user);
    } else {
        // Show the auth overlay; don't init the app yet
        const overlay = document.getElementById('authOverlay');
        if (overlay) overlay.classList.remove('hidden');
    }
});
