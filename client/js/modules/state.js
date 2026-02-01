// Application state management

import { VIEWS } from './config.js';

class AppState {
    constructor() {
        this.projects = [];
        this.stats = { completedTasks: 0, completedProjects: 0 };
        this.isAdminMode = false;
        this.currentView = VIEWS.ACTIVE;
        this.controlPanelOpen = true;
    }

    // Projects
    setProjects(projects) {
        this.projects = projects;
    }

    getProjects() {
        return this.projects;
    }

    getActiveProjects() {
        return this.projects.filter(p => !p.completed);
    }

    getCompletedProjects() {
        return this.projects.filter(p => p.completed);
    }

    getCurrentViewProjects() {
        return this.currentView === VIEWS.ACTIVE 
            ? this.getActiveProjects() 
            : this.getCompletedProjects();
    }

    addProject(project) {
        this.projects.push(project);
    }

    updateProject(projectId, updates) {
        this.projects = this.projects.map(p => 
            p.id === projectId ? { ...p, ...updates } : p
        );
    }

    deleteProject(projectId) {
        this.projects = this.projects.filter(p => p.id !== projectId);
    }

    findProject(projectId) {
        return this.projects.find(p => p.id === projectId);
    }

    // Stats
    setStats(stats) {
        this.stats = stats;
    }

    getStats() {
        return this.stats;
    }

    incrementCompletedTasks() {
        this.stats.completedTasks++;
    }

    decrementCompletedTasks() {
        this.stats.completedTasks = Math.max(0, this.stats.completedTasks - 1);
    }

    incrementCompletedProjects() {
        this.stats.completedProjects++;
    }

    decrementCompletedProjects() {
        this.stats.completedProjects = Math.max(0, this.stats.completedProjects - 1);
    }

    // View
    setView(view) {
        this.currentView = view;
    }

    getView() {
        return this.currentView;
    }

    // Admin mode
    setAdminMode(isAdmin) {
        this.isAdminMode = isAdmin;
    }

    isAdmin() {
        return this.isAdminMode;
    }

    // Control panel
    setControlPanelOpen(isOpen) {
        this.controlPanelOpen = isOpen;
    }

    isControlPanelOpen() {
        return this.controlPanelOpen;
    }
}

// Export singleton instance
export const state = new AppState();
