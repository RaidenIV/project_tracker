// Project CRUD operations

import { state } from './state.js';
import { requireAdmin } from './auth.js';
import { createProjectOnServer, saveDataToServer } from './api.js';

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

export async function addProject() {
    if (!requireAdmin()) return;

    const tempId = String(Date.now());
    const newProject = {
        id: tempId,
        title: 'New Project',
        tasks: [],
        dateCreated: new Date().toISOString(),
        priority: state.getProjects().length,
        completed: false,
        notes: '',
        userRole: 'owner',
        collaborators: []
    };

    state.addProject(newProject);

    // Persist on the server and swap the temp id for the real MongoDB _id.
    const created = await createProjectOnServer(newProject);
    if (created) {
        state.updateProject(tempId, {
            _id: created._id || created.id,
            id:  created.id  || created._id,
            userRole: 'owner'
        });
    }

    return state.findProject(created?.id || tempId) || newProject;
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
    
    const titleCased = toTitleCase(newTitle);
    state.updateProject(projectId, { title: titleCased });
    saveData();
}

async function saveData() {
    await saveDataToServer(state.getProjects(), state.getStats());
}
