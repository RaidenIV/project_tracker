// Application state management

import { VIEWS } from './config.js';

class AppState {
    constructor() {
        this.projects = [];
        this.stats = { completedTasks: 0, completedProjects: 0 };
        this.currentView = VIEWS.ACTIVE;
        this.controlPanelOpen = true;
        this.currentUser = null;
        this.undoStack = [];
        this.maxUndoSteps = 20;
        this.selectedTasks = new Map();
        this.lastSelectedTask = new Map();
        this.hideCompletedTasks = true;
    }

    // ─── Current User ─────────────────────────────────────────────────────────

    setCurrentUser(user) { this.currentUser = user; }
    getCurrentUser()     { return this.currentUser; }

    // ─── Undo ─────────────────────────────────────────────────────────────────

    saveUndoState(action, data) {
        this.undoStack.push({ action, data, timestamp: Date.now() });
        if (this.undoStack.length > this.maxUndoSteps) this.undoStack.shift();
    }
    getLastUndo() { return this.undoStack.pop(); }
    hasUndo()     { return this.undoStack.length > 0; }

    // ─── Task Selection ───────────────────────────────────────────────────────

    selectTask(projectId, taskId, multiSelect = false) {
        if (!this.selectedTasks.has(projectId)) this.selectedTasks.set(projectId, new Set());
        if (!multiSelect) this.selectedTasks.get(projectId).clear();
        this.selectedTasks.get(projectId).add(taskId);
        this.lastSelectedTask.set(projectId, taskId);
    }

    toggleTaskSelection(projectId, taskId) {
        if (!this.selectedTasks.has(projectId)) this.selectedTasks.set(projectId, new Set());
        const s = this.selectedTasks.get(projectId);
        if (s.has(taskId)) s.delete(taskId); else s.add(taskId);
    }

    selectTaskRange(projectId, fromTaskId, toTaskId) {
        const project = this.findProject(projectId);
        if (!project) return;
        const fromIndex = project.tasks.findIndex(t => t.id === fromTaskId);
        const toIndex   = project.tasks.findIndex(t => t.id === toTaskId);
        if (fromIndex === -1 || toIndex === -1) return;
        const start = Math.min(fromIndex, toIndex);
        const end   = Math.max(fromIndex, toIndex);
        if (!this.selectedTasks.has(projectId)) this.selectedTasks.set(projectId, new Set());
        for (let i = start; i <= end; i++) {
            this.selectedTasks.get(projectId).add(project.tasks[i].id);
        }
    }

    getSelectedTasks(projectId) { return this.selectedTasks.get(projectId) || new Set(); }
    clearTaskSelection(projectId) { this.selectedTasks.get(projectId)?.clear(); }
    clearAllTaskSelections() { this.selectedTasks.clear(); this.lastSelectedTask.clear(); }

    // ─── Hide Completed ───────────────────────────────────────────────────────

    setHideCompletedTasks(h) { this.hideCompletedTasks = h; }
    shouldHideCompletedTasks() { return this.hideCompletedTasks; }

    // ─── Projects ─────────────────────────────────────────────────────────────

    setProjects(projects) { this.projects = projects; }
    getProjects()         { return this.projects; }
    getActiveProjects()   { return this.projects.filter(p => !p.completed); }
    getCompletedProjects(){ return this.projects.filter(p => p.completed); }

    getCurrentViewProjects() {
        return this.currentView === VIEWS.ACTIVE
            ? this.getActiveProjects()
            : this.getCompletedProjects();
    }

    addProject(project)           { this.projects.push(project); }
    findProject(projectId)        { return this.projects.find(p => p.id === projectId); }

    updateProject(projectId, updates) {
        this.projects = this.projects.map(p => {
            if (p.id !== projectId) return p;
            const next = { ...p, ...updates };
            if (updates && typeof updates === 'object' && !Object.prototype.hasOwnProperty.call(updates, 'lastModified') && Object.keys(updates).length > 0) {
                next.lastModified = new Date().toISOString();
            }
            return next;
        });
    }

    deleteProject(projectId) {
        const deleted = this.findProject(projectId);
        if (deleted) this.saveUndoState('deleteProject', { project: { ...deleted } });
        this.projects = this.projects.filter(p => p.id !== projectId);
    }

    // Role helpers
    canEdit(projectId) {
        const p = this.findProject(projectId);
        return p && (p.userRole === 'owner' || p.userRole === 'editor');
    }

    isOwner(projectId) {
        const p = this.findProject(projectId);
        return p && p.userRole === 'owner';
    }

    // ─── Stats ────────────────────────────────────────────────────────────────

    setStats(stats) { this.stats = stats; }
    getStats()      { return this.stats; }
    incrementCompletedTasks()    { this.stats.completedTasks++; }
    decrementCompletedTasks()    { this.stats.completedTasks = Math.max(0, this.stats.completedTasks - 1); }
    incrementCompletedProjects() { this.stats.completedProjects++; }
    decrementCompletedProjects() { this.stats.completedProjects = Math.max(0, this.stats.completedProjects - 1); }

    // ─── View ─────────────────────────────────────────────────────────────────

    setView(view) { this.currentView = view; }
    getView()     { return this.currentView; }

    // ─── Control Panel ────────────────────────────────────────────────────────

    setControlPanelOpen(v) { this.controlPanelOpen = v; }
    isControlPanelOpen()   { return this.controlPanelOpen; }
}

export const state = new AppState();
