// Project CRUD operations

import { state } from './state.js';
import { requireAdmin } from './auth.js';
import { saveDataToServer } from './api.js';

export function addProject() {
    if (!requireAdmin()) return;
    
    const newProject = {
        id: Date.now(),
        title: 'New Project',
        tasks: [],
        dateCreated: new Date().toISOString(),
        priority: state.getProjects().length,
        completed: false
    };
    
    state.addProject(newProject);
    saveData();
    
    // Will be implemented in ui.js
    return newProject;
}

export function deleteProject(projectId) {
    if (!requireAdmin()) return;
    
    const project = state.findProject(projectId);
    if (project?.completed) {
        state.decrementCompletedProjects();
    }
    const completedTasks = project?.tasks.filter(t => t.completed).length || 0;
    for (let i = 0; i < completedTasks; i++) {
        state.decrementCompletedTasks();
    }
    
    state.deleteProject(projectId);
    saveData();
}

export function completeProject(projectId) {
    if (!requireAdmin()) return;
    
    const project = state.findProject(projectId);
    if (!project) return;
    
    const newCompleted = !project.completed;
    if (newCompleted) {
        state.incrementCompletedProjects();
    } else {
        state.decrementCompletedProjects();
    }
    
    state.updateProject(projectId, {
        completed: newCompleted,
        completedDate: newCompleted ? new Date().toISOString() : null
    });
    
    saveData();
}

export function updateProjectTitle(projectId, newTitle) {
    if (!requireAdmin()) return;
    
    state.updateProject(projectId, { title: newTitle });
    saveData();
}

async function saveData() {
    await saveDataToServer(state.getProjects(), state.getStats());
}
