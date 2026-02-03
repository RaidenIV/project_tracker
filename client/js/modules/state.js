// Application state management

import { VIEWS } from './config.js';

class AppState {
    constructor() {
        this.projects = [];
        this.stats = { completedTasks: 0, completedProjects: 0 };
        this.currentView = VIEWS.ACTIVE;
        this.controlPanelOpen = true;
        
        // Undo functionality
        this.undoStack = [];
        this.maxUndoSteps = 20;
        
        // Task selection (for shift-click)
        this.selectedTasks = new Map(); // projectId -> Set of taskIds
        this.lastSelectedTask = new Map(); // projectId -> taskId
        
        // Hide completed tasks toggle
        this.hideCompletedTasks = true;
    }

    // Undo functionality
    saveUndoState(action, data) {
        const undoEntry = {
            action,
            data,
            timestamp: Date.now()
        };
        
        this.undoStack.push(undoEntry);
        
        // Keep stack size under control
        if (this.undoStack.length > this.maxUndoSteps) {
            this.undoStack.shift();
        }
    }
    
    getLastUndo() {
        return this.undoStack.pop();
    }
    
    hasUndo() {
        return this.undoStack.length > 0;
    }

    // Task selection
    selectTask(projectId, taskId, multiSelect = false) {
        if (!this.selectedTasks.has(projectId)) {
            this.selectedTasks.set(projectId, new Set());
        }
        
        if (!multiSelect) {
            this.selectedTasks.get(projectId).clear();
        }
        
        this.selectedTasks.get(projectId).add(taskId);
        this.lastSelectedTask.set(projectId, taskId);
    }
    
    toggleTaskSelection(projectId, taskId) {
        if (!this.selectedTasks.has(projectId)) {
            this.selectedTasks.set(projectId, new Set());
        }
        
        const selected = this.selectedTasks.get(projectId);
        if (selected.has(taskId)) {
            selected.delete(taskId);
        } else {
            selected.add(taskId);
        }
    }
    
    selectTaskRange(projectId, fromTaskId, toTaskId) {
        const project = this.findProject(projectId);
        if (!project) return;
        
        const fromIndex = project.tasks.findIndex(t => t.id === fromTaskId);
        const toIndex = project.tasks.findIndex(t => t.id === toTaskId);
        
        if (fromIndex === -1 || toIndex === -1) return;
        
        const start = Math.min(fromIndex, toIndex);
        const end = Math.max(fromIndex, toIndex);
        
        if (!this.selectedTasks.has(projectId)) {
            this.selectedTasks.set(projectId, new Set());
        }
        
        for (let i = start; i <= end; i++) {
            this.selectedTasks.get(projectId).add(project.tasks[i].id);
        }
    }
    
    getSelectedTasks(projectId) {
        return this.selectedTasks.get(projectId) || new Set();
    }
    
    clearTaskSelection(projectId) {
        if (this.selectedTasks.has(projectId)) {
            this.selectedTasks.get(projectId).clear();
        }
    }
    
    clearAllTaskSelections() {
        this.selectedTasks.clear();
        this.lastSelectedTask.clear();
    }

    // Hide completed tasks
    setHideCompletedTasks(hide) {
        this.hideCompletedTasks = hide;
    }
    
    shouldHideCompletedTasks() {
        return this.hideCompletedTasks;
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
        const deletedProject = this.findProject(projectId);
        if (deletedProject) {
            this.saveUndoState('deleteProject', { project: { ...deletedProject } });
        }
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
