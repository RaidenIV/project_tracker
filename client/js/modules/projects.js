// Project CRUD operations

import { state } from './state.js';
import { requireAdmin } from './auth.js';
import { createProjectOnServer, saveDataToServer } from './api.js';

function normalizeProjectDescription(value) {
    return String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, 280);
}

function promptForRequiredProjectDescription() {
    while (true) {
        const value = window.prompt('Project description is required to create a project.');
        if (value === null) return null;

        const description = normalizeProjectDescription(value);
        if (description) return description;

        window.alert('Please enter a project description before creating the project.');
    }
}

export async function addProject() {
    if (!requireAdmin()) return;

    const requiredDescription = promptForRequiredProjectDescription();
    if (requiredDescription === null) return;

    const tempId = String(Date.now());
    const newProject = {
        id: tempId,
        title: 'New Project',
        tasks: [],
        dateCreated: new Date().toISOString(),
        priority: state.getProjects().length,
        completed: false,
        notes: '',
        calendarNotes: {},
        description: requiredDescription,
        tags: [],
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
    
    const cleanTitle = String(newTitle ?? '').trim() || 'New Project';
    state.updateProject(projectId, { title: cleanTitle });
    saveData();
}

async function saveData() {
    await saveDataToServer(state.getProjects(), state.getStats());
}
