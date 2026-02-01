// Main application entry point

import { ADMIN_PASSWORD, VIEWS, SHORTCUTS } from './modules/config.js';
import { state } from './modules/state.js';
import { loadDataFromServer, saveDataToServer } from './modules/api.js';
import { initializePasswordPrompt, requireAdmin } from './modules/auth.js';

// ============================================================================
// DATA MANAGEMENT
// ============================================================================

export async function loadData() {
    const data = await loadDataFromServer();
    state.setProjects(data.projects);
    state.setStats(data.stats);
    render();
}

// Save queue: prevents overlapping saves and reduces race conditions / partial writes.
let __saveInFlight = false;
let __saveQueued = false;

async function saveData() {
    // If a save is already running, just mark that we need another pass.
    if (__saveInFlight) {
        __saveQueued = true;
        return;
    }

    __saveInFlight = true;
    try {
        do {
            __saveQueued = false;

            const ok = await saveDataToServer(state.getProjects(), state.getStats());
            if (!ok) {
                console.warn('Save failed (server returned error). Data is still in memory for this session.');
                // If save fails, do not spin endlessly; exit queue.
                break;
            }

            // If changes happened while saving, loop once more to persist the latest state.
        } while (__saveQueued);
    } finally {
        __saveInFlight = false;
    }
}

// ============================================================================
// PROJECT OPERATIONS
// ============================================================================

function addProject() {
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
    render();
    
    // Auto-open modal for new project
    setTimeout(() => {
        openProjectModal(newProject.id);
        setTimeout(() => editModalTitle(newProject.id), 100);
    }, 100);
}

function deleteProject(projectId) {
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
    render();
}

function completeProject(projectId) {
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
    render();
}

function updateProjectTitle(projectId, newTitle) {
    if (!requireAdmin()) return;
    state.updateProject(projectId, { title: newTitle });
    saveData();
    render();
}

function copyProjectToClipboard(projectId) {
    const project = state.findProject(projectId);
    if (!project) return;
    
    const completedTasks = project.tasks.filter(t => t.completed).length;
    const totalTasks = project.tasks.length;
    
    let text = `${project.title}\n`;
    text += `Created: ${new Date(project.dateCreated).toLocaleDateString()}\n`;
    text += `Progress: ${completedTasks}/${totalTasks} tasks completed\n\n`;
    text += `Tasks:\n`;
    
    project.tasks.forEach((task, index) => {
        const status = task.completed ? '✓' : '○';
        text += `${status} ${task.text}\n`;
    });
    
    navigator.clipboard.writeText(text).then(() => {
        // Show brief feedback
        const button = event?.target?.closest('button');
        if (button) {
            const originalHTML = button.innerHTML;
            button.innerHTML = `
                <svg class="icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path>
                </svg>
            `;
            setTimeout(() => {
                button.innerHTML = originalHTML;
            }, 1000);
        }
    }).catch(err => {
        console.error('Failed to copy:', err);
    });
}

// ============================================================================
// TASK OPERATIONS
// ============================================================================

function toggleTask(projectId, taskId) {
    if (!requireAdmin()) return;
    
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
    
    state.updateProject(projectId, { tasks: updatedTasks });
    saveData();
    
    // Update DOM directly without full re-render
    const checkbox = document.querySelector(`[data-task-checkbox="${taskId}"]`);
    const taskText = document.querySelector(`[data-task-text="${taskId}"]`);
    const task = updatedTasks.find(t => t.id === taskId);
    
    if (checkbox && task) {
        if (task.completed) {
            checkbox.classList.add('checked');
            checkbox.innerHTML = `
                <svg class="icon" fill="none" stroke="#f0f4f8" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path>
                </svg>
            `;
            if (taskText) taskText.classList.add('completed');
        } else {
            checkbox.classList.remove('checked');
            checkbox.innerHTML = '';
            if (taskText) taskText.classList.remove('completed');
        }
    }
    
    // Update stats display
    document.getElementById('completedTasksCount').textContent = state.getStats().completedTasks;
    
    // Update progress bar
    updateProjectProgress(projectId);
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
    if (!requireAdmin()) return;
    
    const project = state.findProject(projectId);
    if (!project) return;
    
    const taskToDelete = project.tasks.find(t => t.id === taskId);
    if (taskToDelete?.completed) {
        state.decrementCompletedTasks();
    }
    
    const updatedTasks = project.tasks.filter(t => t.id !== taskId);
    state.updateProject(projectId, { tasks: updatedTasks });
    saveData();
    render();
}

function updateTaskText(projectId, taskId, newText) {
    if (!requireAdmin()) return;
    
    const project = state.findProject(projectId);
    if (!project) return;
    
    const updatedTasks = project.tasks.map(t => 
        t.id === taskId ? { ...t, text: newText } : t
    );
    
    state.updateProject(projectId, { tasks: updatedTasks });
    saveData();
    render();
}

function addTaskToProject(projectId) {
    if (!requireAdmin()) return;
    
    const project = state.findProject(projectId);
    if (!project) return;
    
    const newTask = { id: Date.now(), text: 'New task', completed: false };
    const updatedTasks = [...project.tasks, newTask];
    
    state.updateProject(projectId, { tasks: updatedTasks });
    saveData();
    
    return newTask.id;
}

function reorderTasks(projectId, oldIndex, newIndex) {
    if (!requireAdmin()) return;
    
    const project = state.findProject(projectId);
    if (!project) return;
    
    const tasks = [...project.tasks];
    const [movedTask] = tasks.splice(oldIndex, 1);
    tasks.splice(newIndex, 0, movedTask);
    
    state.updateProject(projectId, { tasks });
    saveData();
    openProjectModal(projectId);
}

function reorderProjects(oldIndex, newIndex) {
    if (!requireAdmin()) return;
    
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
    if (newIndex === 0) {
        newFullIndex = 0;
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
    saveData();
    render();
}

// ============================================================================
// VIEW MANAGEMENT
// ============================================================================

function switchToActiveView() {
    state.setView(VIEWS.ACTIVE);
    document.getElementById('activeProjectsCard').classList.add('active');
    document.getElementById('completedProjectsCard').classList.remove('active');
    document.querySelector('.viewport-header h1').textContent = 'Active Projects';
    render();
}

function switchToCompletedView() {
    state.setView(VIEWS.COMPLETED);
    document.getElementById('completedProjectsCard').classList.add('active');
    document.getElementById('activeProjectsCard').classList.remove('active');
    document.querySelector('.viewport-header h1').textContent = 'Completed Projects';
    render();
}

// ============================================================================
// DRAG AND DROP
// ============================================================================

let draggedTaskElement = null;
let draggedTaskProjectId = null;
let draggedTaskIndex = null;

let draggedProjectElement = null;
let draggedProjectIndex = null;

function setupProjectDragAndDrop() {
    const projectCards = document.querySelectorAll('.project-card');
    
    projectCards.forEach((card, index) => {
        const dragHandle = card.querySelector('.drag-handle');
        
        if (dragHandle) {
            dragHandle.addEventListener('mousedown', (e) => {
                e.stopPropagation();
                card.setAttribute('draggable', 'true');
            });
        }
        
        card.addEventListener('dragstart', (e) => {
            if (!state.isAdmin()) {
                e.preventDefault();
                return;
            }
            draggedProjectElement = card;
            draggedProjectIndex = index;
            card.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'move';
        });
        
        card.addEventListener('dragend', (e) => {
            card.classList.remove('dragging');
            card.setAttribute('draggable', 'false');
            draggedProjectElement = null;
            draggedProjectIndex = null;
        });
        
        card.addEventListener('dragover', (e) => {
            if (draggedProjectElement && draggedProjectElement !== card) {
                e.preventDefault();
                const cardRect = card.getBoundingClientRect();
                const midPoint = cardRect.top + cardRect.height / 2;
                
                if (e.clientY < midPoint) {
                    card.style.borderTop = '3px solid #5a6c7d';
                    card.style.borderBottom = 'none';
                } else {
                    card.style.borderBottom = '3px solid #5a6c7d';
                    card.style.borderTop = 'none';
                }
            }
        });
        
        card.addEventListener('dragleave', (e) => {
            card.style.borderTop = 'none';
            card.style.borderBottom = 'none';
        });
        
        card.addEventListener('drop', (e) => {
            e.preventDefault();
            e.stopPropagation();
            card.style.borderTop = 'none';
            card.style.borderBottom = 'none';
            
            if (draggedProjectElement && draggedProjectElement !== card) {
                const targetIndex = Array.from(projectCards).indexOf(card);
                const cardRect = card.getBoundingClientRect();
                const midPoint = cardRect.top + cardRect.height / 2;
                
                let newIndex = targetIndex;
                if (e.clientY > midPoint && draggedProjectIndex < targetIndex) {
                    newIndex = targetIndex;
                } else if (e.clientY < midPoint && draggedProjectIndex > targetIndex) {
                    newIndex = targetIndex;
                } else if (e.clientY > midPoint) {
                    newIndex = targetIndex + 1;
                }
                
                reorderProjects(draggedProjectIndex, newIndex);
            }
        });
    });
}

function setupTaskDragAndDrop(projectId) {
    const taskItems = document.querySelectorAll(`[data-task-item]`);
    
    taskItems.forEach((item, index) => {
        item.setAttribute('draggable', 'true');
        
        item.addEventListener('dragstart', (e) => {
            if (!state.isAdmin()) {
                e.preventDefault();
                return;
            }
            draggedTaskElement = item;
            draggedTaskProjectId = projectId;
            draggedTaskIndex = index;
            item.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'move';
        });
        
        item.addEventListener('dragend', (e) => {
            item.classList.remove('dragging');
            draggedTaskElement = null;
            draggedTaskProjectId = null;
            draggedTaskIndex = null;
        });
        
        item.addEventListener('dragover', (e) => {
            if (draggedTaskElement && draggedTaskElement !== item && draggedTaskProjectId === projectId) {
                e.preventDefault();
                const itemRect = item.getBoundingClientRect();
                const midPoint = itemRect.top + itemRect.height / 2;
                
                if (e.clientY < midPoint) {
                    item.style.borderTop = '2px solid #5a6c7d';
                    item.style.borderBottom = 'none';
                } else {
                    item.style.borderBottom = '2px solid #5a6c7d';
                    item.style.borderTop = 'none';
                }
            }
        });
        
        item.addEventListener('dragleave', (e) => {
            item.style.borderTop = 'none';
            item.style.borderBottom = 'none';
        });
        
        item.addEventListener('drop', (e) => {
            e.preventDefault();
            item.style.borderTop = 'none';
            item.style.borderBottom = 'none';
            
            if (draggedTaskElement && draggedTaskElement !== item && draggedTaskProjectId === projectId) {
                const allTaskItems = Array.from(document.querySelectorAll(`[data-task-item]`));
                const targetIndex = allTaskItems.indexOf(item);
                const itemRect = item.getBoundingClientRect();
                const midPoint = itemRect.top + itemRect.height / 2;
                
                let newIndex = targetIndex;
                if (e.clientY > midPoint && draggedTaskIndex < targetIndex) {
                    newIndex = targetIndex;
                } else if (e.clientY < midPoint && draggedTaskIndex > targetIndex) {
                    newIndex = targetIndex;
                } else if (e.clientY > midPoint) {
                    newIndex = targetIndex + 1;
                }
                
                reorderTasks(projectId, draggedTaskIndex, newIndex);
            }
        });
    });
}

// ============================================================================
// MODAL MANAGEMENT
// ============================================================================

function openProjectModal(projectId) {
    const project = state.findProject(projectId);
    if (!project) return;
    
    const completedTasks = project.tasks.filter(t => t.completed).length;
    const totalTasks = project.tasks.length;
    const percentage = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;
    
    const modal = document.getElementById('projectModal');
    const content = document.getElementById('modalContent');
    
    content.innerHTML = `
        <div class="modal-header">
            <div class="modal-title-container">
                <div class="modal-title" id="modal-title-${project.id}" onclick="editModalTitle(${project.id})" style="cursor: pointer;">${project.title}</div>
                <input type="text" 
                       class="modal-title-input" 
                       id="modal-title-input-${project.id}"
                       value="${project.title}"
                       style="display: none;"
                       onblur="finishEditModalTitle(${project.id})"
                       onkeydown="if(event.key==='Enter') finishEditModalTitle(${project.id})">
                <div class="modal-stats">
                    <span>${new Date(project.dateCreated).toLocaleDateString()}</span>
                    <span>•</span>
                    <span>${totalTasks} tasks</span>
                    <span>•</span>
                    <span>${completedTasks} done</span>
                </div>
            </div>
            <div style="display: flex; gap: 4px;">
                <button class="modal-copy-button" onclick="copyProjectToClipboard(${project.id})">
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
            <div class="progress-text" data-progress-text="${project.id}">${percentage}%</div>
        </div>
        
        <div class="modal-tasks">
            <h3>Tasks</h3>
            <div class="task-list" id="modal-task-list-${project.id}">
                ${project.tasks.map(task => `
                    <div class="task-item" data-task-item data-task-id="${task.id}">
                        <svg class="task-drag-handle" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 8h16M4 16h16"></path>
                        </svg>
                        <div class="task-checkbox ${task.completed ? 'checked' : ''}" 
                             data-task-checkbox="${task.id}"
                             onclick="toggleTask(${project.id}, ${task.id})">
                            ${task.completed ? `
                                <svg class="icon" fill="none" stroke="#f0f4f8" viewBox="0 0 24 24">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path>
                                </svg>
                            ` : ''}
                        </div>
                        <span class="task-text ${task.completed ? 'completed' : ''}" 
                              data-task-text="${task.id}"
                              id="modal-task-text-${task.id}"
                              onclick="editModalTask(${task.id})">${task.text}</span>
                        <input type="text" 
                               class="task-input"
                               id="modal-task-input-${task.id}"
                               value="${task.text}"
                               style="display: none;"
                               onblur="finishEditModalTask(${project.id}, ${task.id})"
                               onkeydown="if(event.key==='Enter') finishEditModalTask(${project.id}, ${task.id})">
                        <button class="delete-button" onclick="deleteTaskFromModal(${project.id}, ${task.id})" style="opacity: 1;">
                            <svg class="icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path>
                            </svg>
                        </button>
                    </div>
                `).join('')}
            </div>
            <button class="modal-add-task" onclick="addTaskToModal(${project.id})">
                <svg class="icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"></path>
                </svg>
                Add Task
            </button>
            
            <!-- Paste Tasks Section in Modal -->
            <div style="margin-top: 24px; padding-top: 24px; border-top: 1px solid rgba(47, 39, 206, 0.1);">
                <h4 style="font-size: 14px; font-weight: bold; color: #2d3748; margin-bottom: 12px;">Paste Multiple Tasks</h4>
                <textarea 
                    id="modal-paste-box-${project.id}"
                    placeholder="Paste tasks here (one per line)"
                    style="width: 100%; min-height: 80px; background: #e8ecf1; border: 1px solid rgba(47, 39, 206, 0.2); border-radius: 8px; padding: 12px; color: #2d3748; font-size: 12px; font-family: inherit; resize: vertical; box-shadow: inset 4px 4px 8px rgba(174, 174, 192, 0.4), inset -4px -4px 8px rgba(255, 255, 255, 0.9); outline: none;"></textarea>
                <button 
                    onclick="pasteTasksInModal(${project.id})"
                    style="width: 100%; margin-top: 8px; padding: 8px; background: rgba(47, 39, 206, 0.2); border: none; border-radius: 8px; color: #2f27ce; font-size: 12px; cursor: pointer; font-family: inherit;">
                    Add Pasted Tasks
                </button>
            </div>
        </div>
        
        <div class="modal-actions">
            <button class="modal-delete-btn" onclick="confirmDeleteProject(${project.id})">
                Delete Project
            </button>
            <button class="modal-done-btn" onclick="completeProjectFromModal(${project.id})">
                Mark as Complete
            </button>
        </div>
    `;
    
    modal.classList.add('active');
    
    // Setup drag and drop for tasks
    setTimeout(() => setupTaskDragAndDrop(project.id), 100);
}

function closeProjectModal() {
    const modal = document.getElementById('projectModal');
    modal.classList.remove('active');
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
        titleDiv.textContent = titleInput.value;
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
        updateTaskText(projectId, taskId, taskInput.value);
        taskText.textContent = taskInput.value;
        taskText.style.display = 'block';
        taskInput.style.display = 'none';
    }
}

function addTaskToModal(projectId) {
    if (!requireAdmin()) return;
    
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
    if (!requireAdmin()) return;
    
    const projectSelect = document.getElementById('pasteProjectSelect');
    const pasteBox = document.getElementById('pasteBox');
    const projectId = parseInt(projectSelect.value);
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
        text: text,
        completed: false
    }));
    
    state.updateProject(projectId, {
        tasks: [...project.tasks, ...newTasks]
    });
    
    pasteBox.value = '';
    projectSelect.value = '';
    document.getElementById('pasteButton').disabled = true;
    
    saveData();
    render();
}

function pasteTasksInModal(projectId) {
    if (!requireAdmin()) return;
    
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
        text: text,
        completed: false
    }));
    
    state.updateProject(projectId, {
        tasks: [...project.tasks, ...newTasks]
    });
    
    saveData();
    openProjectModal(projectId);
}

// ============================================================================
// UI RENDERING
// ============================================================================

function render() {
    const displayProjects = state.getCurrentViewProjects();
    const projectGrid = document.getElementById('projectGrid');
    const emptyState = document.getElementById('emptyState');
    
    // Update stats
    const stats = state.getStats();
    document.getElementById('activeProjectsCount').textContent = state.getActiveProjects().length;
    document.getElementById('completedTasksCount').textContent = stats.completedTasks;
    document.getElementById('completedProjectsCount').textContent = stats.completedProjects;
    
    // Render projects
    if (displayProjects.length === 0) {
        emptyState.style.display = 'flex';
        projectGrid.style.display = 'none';
        const emptyTitle = emptyState.querySelector('.title');
        emptyTitle.textContent = state.getView() === VIEWS.ACTIVE ? 'No active projects' : 'No completed projects';
    } else {
        emptyState.style.display = 'none';
        projectGrid.style.display = 'grid';
        projectGrid.innerHTML = displayProjects.map(renderProjectCard).join('');
        
        // Setup drag and drop after rendering
        setTimeout(setupProjectDragAndDrop, 100);
    }
    
    renderQuickActions();
    updateProjectSelect();
}

function renderProjectCard(project) {
    const completedTasksCount = project.tasks.filter(t => t.completed).length;
    const totalTasks = project.tasks.length;
    const progressPercentage = totalTasks > 0 ? Math.round((completedTasksCount / totalTasks) * 100) : 0;
    
    return `
        <div class="project-card" 
             data-project-id="${project.id}"
             onclick="openProjectModal(${project.id})">
            <div class="project-header">
                <div class="project-title-container">
                    <svg class="drag-handle" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 8h16M4 16h16"></path>
                    </svg>
                    <div class="project-title">${project.title}</div>
                </div>
                <div class="project-actions">
                    <button class="copy-button" onclick="event.stopPropagation(); copyProjectToClipboard(${project.id})">
                        <svg class="icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"></path>
                        </svg>
                    </button>
                    <button class="card-delete-button" onclick="event.stopPropagation(); confirmDeleteProjectCard(${project.id})">
                        <svg class="icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path>
                        </svg>
                    </button>
                </div>
            </div>
            
            <div class="project-stats">
                <span>${new Date(project.dateCreated).toLocaleDateString()}</span>
                <span>•</span>
                <span>${project.tasks.length} tasks</span>
                <span>•</span>
                <span>${completedTasksCount} done</span>
            </div>
            
            <div class="progress-bar-container">
                <div class="progress-bar" data-progress-bar="${project.id}" style="width: ${progressPercentage}%"></div>
            </div>
            <div class="progress-text" data-progress-text="${project.id}">${progressPercentage}%</div>
        </div>
    `;
}

function renderQuickActions() {
    const activeProjects = state.getActiveProjects();
    const quickActionsList = document.getElementById('quickActionsList');
    
    if (activeProjects.length === 0) {
        quickActionsList.innerHTML = '<p style="color: #666; font-size: 12px; text-align: center;">No active projects</p>';
        return;
    }
    
    quickActionsList.innerHTML = activeProjects.map(project => {
        const completedTasks = project.tasks.filter(t => t.completed).length;
        return `
            <div class="quick-action-item">
                <div class="quick-action-title">${project.title}</div>
                <div class="quick-action-buttons">
                    <button class="done-button" onclick="completeProject(${project.id})">Done</button>
                    <button class="quick-delete-button" onclick="deleteProject(${project.id})">
                        <svg class="icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path>
                        </svg>
                    </button>
                </div>
                <div class="quick-action-stats">${completedTasks}/${project.tasks.length} tasks</div>
            </div>
        `;
    }).join('');
}

function updateProjectSelect() {
    const activeProjects = state.getActiveProjects();
    const projectSelect = document.getElementById('pasteProjectSelect');
    const pasteButton = document.getElementById('pasteButton');
    
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

    menuButton.addEventListener('click', (e) => {
        e.stopPropagation();
        menuOpen = !menuOpen;
        if (menuOpen) {
            menuDropdown.classList.remove('hidden');
            menuButton.classList.add('active');
        } else {
            menuDropdown.classList.add('hidden');
            menuButton.classList.remove('active');
        }
    });

    document.addEventListener('click', (e) => {
        if (menuOpen && !menuContainer.contains(e.target)) {
            menuOpen = false;
            menuDropdown.classList.add('hidden');
            menuButton.classList.remove('active');
        }
    });

    // Control panel toggle
    const collapseButton = document.getElementById('collapseButton');
    const expandButton = document.getElementById('expandButton');
    const controlPanel = document.getElementById('controlPanel');
    const viewport = document.getElementById('viewport');

    collapseButton.addEventListener('click', () => {
        state.setControlPanelOpen(false);
        controlPanel.classList.add('collapsed');
        viewport.classList.add('full');
        expandButton.classList.remove('hidden');
    });

    expandButton.addEventListener('click', () => {
        state.setControlPanelOpen(true);
        controlPanel.classList.remove('collapsed');
        viewport.classList.remove('full');
        expandButton.classList.add('hidden');
    });

    // Add project button
    document.getElementById('addProjectButton').addEventListener('click', addProject);

    // Paste button
    document.getElementById('pasteButton').addEventListener('click', pasteTasks);

    // Click outside modal to close
    const projectModal = document.getElementById('projectModal');
    projectModal.addEventListener('click', (e) => {
        if (e.target === projectModal) {
            closeProjectModal();
        }
    });

    const confirmDialog = document.getElementById('confirmDialog');
    confirmDialog.addEventListener('click', (e) => {
        if (e.target === confirmDialog) {
            closeConfirmDialog();
        }
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
            return;
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
            case SHORTCUTS.HELP:
                alert(`Keyboard Shortcuts:

N - New Project
C - Toggle Control Panel
M - Toggle Menu
A - View Active Projects
D - View Completed Projects
? - Show this help

Admin Features:
- Click on project cards to view/edit details
- Drag tasks or projects to reorder them
- Use copy button to copy project details
- Click outside expanded cards to close them
- Use the paste box in modals for bulk task import
- Stats are clickable to switch views

Current Mode: ${state.isAdmin() ? 'ADMIN' : 'READ-ONLY'}`);
                break;
        }
    });
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

// ============================================================================
// INITIALIZATION
// ============================================================================

document.addEventListener('DOMContentLoaded', () => {
    initializePasswordPrompt();
    initializeEventHandlers();
});
