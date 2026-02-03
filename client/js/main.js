// Main application entry point

import { ADMIN_PASSWORD, VIEWS, SHORTCUTS } from './modules/config.js';
import { state } from './modules/state.js';
import { loadDataFromServer, saveDataToServer } from './modules/api.js';
import { initializePasswordPrompt, requireAdmin } from './modules/auth.js';

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
        completed: false,
        notes: ''
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
    updateUndoButton();
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
    const titleCased = toTitleCase(newTitle);
    state.updateProject(projectId, { title: titleCased });
    saveData();
    render();
}

function updateProjectNotes(projectId, notes) {
    if (!requireAdmin()) return;
    state.updateProject(projectId, { notes });
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
    if (!requireAdmin()) return;
    
    const project = state.findProject(projectId);
    if (!project) return;
    
    const task = project.tasks.find(t => t.id === taskId);
    if (!task) return;
    
    const willBeCompleted = !task.completed;
    
    // If marking as complete, show checkmark first, then fade
    if (willBeCompleted) {
        const taskElement = document.querySelector(`[data-task-id="${taskId}"]`);
        if (taskElement) {
            // Immediately stamp the checkmark and strikethrough onto the live element
            const checkbox = taskElement.querySelector(`[data-task-checkbox="${taskId}"]`);
            if (checkbox) {
                checkbox.classList.add('checked');
                checkbox.innerHTML = `
                    <svg class="icon" fill="none" stroke="#f0f4f8" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path>
                    </svg>
                `;
            }
            const taskText = taskElement.querySelector(`[data-task-text="${taskId}"]`);
            if (taskText) {
                taskText.classList.add('completed');
            }

            // Let the browser paint the checkmark, then fade out
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    taskElement.classList.add('fading-out');
                });
            });
            
            // Wait for fade animation, then update state
            setTimeout(() => {
                performTaskToggle(projectId, taskId);
            }, 500); // Match the CSS transition duration
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
    state.updateProject(projectId, { tasks: sortedTasks });
    saveData();
    
    // Re-render to show new order
    const modalOpen = document.getElementById('projectModal').classList.contains('active');
    if (modalOpen) {
        openProjectModal(projectId);
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
    if (!requireAdmin()) return;
    
    const project = state.findProject(projectId);
    if (!project) return;
    
    const taskToDelete = project.tasks.find(t => t.id === taskId);
    if (taskToDelete?.completed) {
        state.decrementCompletedTasks();
    }
    
    // Save undo state for task deletion
    state.saveUndoState('deleteTask', { projectId, task: { ...taskToDelete } });
    
    const updatedTasks = project.tasks.filter(t => t.id !== taskId);
    state.updateProject(projectId, { tasks: updatedTasks });
    saveData();
    render();
    updateUndoButton();
    updateTotalCompletion();
}

function updateTaskText(projectId, taskId, newText) {
    if (!requireAdmin()) return;
    
    const project = state.findProject(projectId);
    if (!project) return;
    
    const capitalized = capitalizeFirstLetter(newText);
    const updatedTasks = project.tasks.map(t => 
        t.id === taskId ? { ...t, text: capitalized } : t
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
    // Add new tasks at the beginning (they'll appear first after sorting)
    const updatedTasks = sortTasks([newTask, ...project.tasks]);
    
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
    saveData();
    render();
}

// ============================================================================
// UNDO FUNCTIONALITY
// ============================================================================

function performUndo() {
    if (!requireAdmin()) return;
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
            state.updateProject(projectId, { tasks: updatedTasks });
            
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
    if (!state.isAdmin()) return;
    
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

    // Prevent "click to open modal" firing right after a drag-reorder
    projectGrid.addEventListener('click', (e) => {
        if (__suppressNextProjectGridClick) {
            e.preventDefault();
            e.stopImmediatePropagation();
            __suppressNextProjectGridClick = false;
            return;
        }
        // In edit mode, clicks on tiles should not open the project modal
        if (__projectEditMode) {
            e.preventDefault();
            e.stopImmediatePropagation();
        }
    }, true);

    const cards = Array.from(projectGrid.querySelectorAll('.project-card'));
    cards.forEach((card) => {
        card.setAttribute('draggable', 'false');

        card.addEventListener('pointerdown', (e) => {
            if (!state.isAdmin()) return;
            if (e.button !== 0) return;

            // Don't start a drag when the user is tapping a button / input inside the card
            const t = e.target;
            if (t && t.closest && t.closest('button, input, textarea, select, a')) return;

            const projectId = Number(card.getAttribute('data-project-id'));
            if (!projectId) return;

            const viewProjects = state.getCurrentViewProjects();
            const startIndex = viewProjects.findIndex(p => p.id === projectId);
            if (startIndex === -1) return;

            const rect = card.getBoundingClientRect();
            const offsetX = e.clientX - rect.left;
            const offsetY = e.clientY - rect.top;

            // ── NOT in edit mode: require a long-press to enter edit mode first ──
            if (!__projectEditMode) {
                clearProjectLongPress();

                __projectPendingPress = {
                    pointerId: e.pointerId,
                    startX: e.clientX,
                    startY: e.clientY,
                    lastX: e.clientX,
                    lastY: e.clientY,
                    offsetX, offsetY,
                    grid: projectGrid,
                    sourceCard: card,
                    startIndex,
                    active: true
                };

                try { card.setPointerCapture(e.pointerId); } catch { /* noop */ }

                const CANCEL_MOVE = 8;
                const LONG_PRESS_MS = 260;

                const onPreMove = (ev) => {
                    if (!__projectPendingPress || ev.pointerId !== __projectPendingPress.pointerId) return;
                    __projectPendingPress.lastX = ev.clientX;
                    __projectPendingPress.lastY = ev.clientY;
                    if (Math.hypot(ev.clientX - __projectPendingPress.startX,
                                   ev.clientY - __projectPendingPress.startY) > CANCEL_MOVE) {
                        clearProjectLongPress();
                        window.removeEventListener('pointermove', onPreMove);
                    }
                };

                const onPreUp = (ev) => {
                    if (__projectPendingPress && ev.pointerId === __projectPendingPress.pointerId) {
                        clearProjectLongPress();
                    }
                    window.removeEventListener('pointermove', onPreMove);
                };

                window.addEventListener('pointermove', onPreMove, { passive: false });
                window.addEventListener('pointerup',   onPreUp,   { passive: false, once: true });

                __projectLongPressTimer = setTimeout(() => {
                    if (!__projectPendingPress || !__projectPendingPress.active) return;

                    // Long-press fired — enter edit mode and begin dragging immediately
                    setProjectEditMode(true);
                    __suppressNextProjectGridClick = true;

                    __projectDrag = {
                        pointerId:  __projectPendingPress.pointerId,
                        startIndex,
                        startX:     __projectPendingPress.startX,
                        startY:     __projectPendingPress.startY,
                        offsetX:    __projectPendingPress.offsetX,
                        offsetY:    __projectPendingPress.offsetY,
                        grid:       projectGrid,
                        sourceCard: card,
                        active:     false,
                        snapshots:  null,
                        targetIndex: startIndex
                    };

                    startProjectSlide({ clientX: __projectPendingPress.lastX,
                                        clientY: __projectPendingPress.lastY });

                    window.addEventListener('pointermove',  onProjectPointerMove,   { passive: false });
                    window.addEventListener('pointerup',    onProjectPointerUp,     { passive: false, once: true });
                    window.addEventListener('pointercancel', onProjectPointerCancel, { passive: false, once: true });

                    window.removeEventListener('pointermove', onPreMove);
                    clearProjectLongPress();
                }, LONG_PRESS_MS);

                return;
            }

            // ── Already in edit mode: drag starts with a tiny movement threshold ──
            clearProjectLongPress();

            __projectDrag = {
                pointerId:  e.pointerId,
                startIndex,
                startX:     e.clientX,
                startY:     e.clientY,
                offsetX,
                offsetY,
                grid:       projectGrid,
                sourceCard: card,
                active:     false,
                snapshots:  null,
                targetIndex: startIndex
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

    // 1. Dragged card follows the pointer (zero-lag, no easing)
    const x = e.clientX - __projectDrag.offsetX;
    const y = e.clientY - __projectDrag.offsetY;
    __projectDrag.sourceCard.style.transform = `translate3d(${x}px, ${y}px, 0)`;

    // 2. Slide idle cards to make room / fill the gap
    updateProjectSlideItems(e.clientX, e.clientY);
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

    // Wipe visuals before the state-driven re-render
    resetProjectSlideVisuals();
    cleanupProjectDrag();

    if (startIndex !== targetIndex) {
        reorderProjects(startIndex, targetIndex);
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

    // Float the dragged card; its transform is now set via inline style only
    sourceCard.classList.add('dragging');

    const x = e.clientX - __projectDrag.offsetX;
    const y = e.clientY - __projectDrag.offsetY;
    sourceCard.style.transform = `translate3d(${x}px, ${y}px, 0)`;
}

/*
 * updateProjectSlideItems  – called on every pointermove while active.
 *   1. Computes an insertion index by comparing the dragged card's live centre
 *      to every idle card's *snapshot* centre in grid reading order.
 *   2. For each idle card, derives the slot it would occupy after the reorder
 *      (adjustedI → finalI mapping, same algebra as the CodePen pattern).
 *   3. Applies the slide offset as CSS custom-property values (--slide-x /
 *      --slide-y) so the offset composes cleanly with the wiggle animation.
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
    // Walk in reading order; the first card whose snapshot centre is "after" the
    // drag centre (lower row, or same row but to the right) is the insert-before
    // target.  "Same row" = centres within 40 % of a card height vertically.
    let insertionIndex = idleSnaps.length;                          // default: end
    const rowBand = (idleSnaps[0]?.rect.height || 100) * 0.4;

    for (let i = 0; i < idleSnaps.length; i++) {
        const r  = idleSnaps[i].rect;
        const cx = r.left + r.width  / 2;
        const cy = r.top  + r.height / 2;

        if (dCY < cy - rowBand)                            { insertionIndex = i; break; }
        if (Math.abs(dCY - cy) <= rowBand && dCX < cx)     { insertionIndex = i; break; }
    }

    // targetIndex in the full array == insertionIndex in the idle (reduced) array.
    // Proof: removing the dragged card and reinserting at position T produces the
    // same mapping whether T is measured in the full or reduced list.
    __projectDrag.targetIndex = insertionIndex;

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
}



function setupTaskDragAndDrop(projectId) {
    const taskList = document.getElementById(`modal-task-list-${projectId}`);
    if (!taskList || !state.isAdmin()) return;

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

function openProjectModal(projectId) {
    const project = state.findProject(projectId);
    if (!project) return;
    
    const hideCompleted = state.shouldHideCompletedTasks();
    const displayTasks = hideCompleted ? project.tasks.filter(t => !t.completed) : project.tasks;
    
    const completedTasks = project.tasks.filter(t => t.completed).length;
    const totalTasks = project.tasks.length;
    const percentage = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;
    
    const modal = document.getElementById('projectModal');
    const content = document.getElementById('modalContent');
    
    const selectedTasks = state.getSelectedTasks(projectId);
    
    content.innerHTML = `
        <div class="modal-header-centered">
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
                <button class="modal-copy-button" onclick="copyProjectToClipboard(${project.id}, event)">
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
        
        <!-- Tabs for Tasks and Notes -->
        <div class="modal-tabs">
            <button class="modal-tab active" id="tasks-tab-${project.id}" onclick="switchModalTab(${project.id}, 'tasks')">
                Tasks
            </button>
            <button class="modal-tab" id="notes-tab-${project.id}" onclick="switchModalTab(${project.id}, 'notes')">
                Notes
            </button>
        </div>
        
        <!-- Tasks Section -->
        <div class="modal-section" id="tasks-section-${project.id}">
            <!-- Add Task Button at Top -->
            <button class="modal-add-task-top" onclick="addTaskToModal(${project.id})">
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
                             onclick="handleTaskClick(${project.id}, ${task.id}, event)">
                            <svg class="task-drag-handle" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 8h16M4 16h16"></path>
                            </svg>
                            <div class="task-checkbox ${task.completed ? 'checked' : ''}" 
                                 data-task-checkbox="${task.id}"
                                 onclick="event.stopPropagation(); toggleTask(${project.id}, ${task.id})">
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
                                   style="display: none;"
                                   onblur="finishEditModalTask(${project.id}, ${task.id})"
                                   onkeydown="if(event.key==='Enter') finishEditModalTask(${project.id}, ${task.id})">
                            <button class="delete-button" onclick="event.stopPropagation(); deleteTaskFromModal(${project.id}, ${task.id})" style="opacity: 1;">
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
                        onclick="pasteTasksInModal(${project.id})"
                        style="width: 100%; margin-top: 8px; padding: 8px; background: rgba(47, 39, 206, 0.2); border: none; border-radius: 8px; color: #2f27ce; font-size: 12px; cursor: pointer; font-family: inherit;">
                        Add Pasted Tasks
                    </button>
                </div>
            </div>
            
            <!-- Modal Actions - Only in Tasks Tab -->
            <div class="modal-actions">
                <button class="modal-delete-btn" onclick="confirmDeleteProject(${project.id})">
                    Delete Project
                </button>
                <button class="modal-done-btn" onclick="completeProjectFromModal(${project.id})">
                    Mark as Complete
                </button>
            </div>
        </div>
        
        <!-- Notes Section -->
        <div class="modal-section hidden" id="notes-section-${project.id}">
            <div class="modal-notes">
                <textarea 
                    class="notes-textarea"
                    id="notes-textarea-${project.id}"
                    placeholder="Add notes about this project..."
                    onblur="saveProjectNotes(${project.id})">${project.notes || ''}</textarea>
            </div>
        </div>
    `;
    
    modal.classList.add('active');
    
    // Setup drag and drop for tasks
    setTimeout(() => setupTaskDragAndDrop(project.id), 100);
}

function switchModalTab(projectId, tab) {
    const tasksTab = document.getElementById(`tasks-tab-${projectId}`);
    const notesTab = document.getElementById(`notes-tab-${projectId}`);
    const tasksSection = document.getElementById(`tasks-section-${projectId}`);
    const notesSection = document.getElementById(`notes-section-${projectId}`);
    
    if (tab === 'tasks') {
        tasksTab.classList.add('active');
        notesTab.classList.remove('active');
        tasksSection.classList.remove('hidden');
        notesSection.classList.add('hidden');
    } else {
        notesTab.classList.add('active');
        tasksTab.classList.remove('active');
        notesSection.classList.remove('hidden');
        tasksSection.classList.add('hidden');
    }
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
    const projectIdMatch = modalContent.innerHTML.match(/data-progress-bar="(\d+)"/);
    if (projectIdMatch) {
        const projectId = parseInt(projectIdMatch[1]);
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
                     onclick="handleTaskClick(${projectId}, ${task.id}, event)">
                    <svg class="task-drag-handle" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 8h16M4 16h16"></path>
                    </svg>
                    <div class="task-checkbox ${task.completed ? 'checked' : ''}" 
                         data-task-checkbox="${task.id}"
                         onclick="event.stopPropagation(); toggleTask(${projectId}, ${task.id})">
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
                           style="display: none;"
                           onblur="finishEditModalTask(${projectId}, ${task.id})"
                           onkeydown="if(event.key==='Enter') finishEditModalTask(${projectId}, ${task.id})">
                    <button class="delete-button" onclick="event.stopPropagation(); deleteTaskFromModal(${projectId}, ${task.id})" style="opacity: 1;">
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
        text: capitalizeFirstLetter(text),
        completed: false
    }));
    
    const updatedTasks = sortTasks([...project.tasks, ...newTasks]);
    state.updateProject(projectId, { tasks: updatedTasks });
    
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
        text: capitalizeFirstLetter(text),
        completed: false
    }));
    
    const updatedTasks = sortTasks([...project.tasks, ...newTasks]);
    state.updateProject(projectId, { tasks: updatedTasks });
    
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
    
    // Update total completion
    updateTotalCompletion();
    
    // Update undo button
    updateUndoButton();
    
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
                <div class="project-title-container-centered">
                    <div class="project-title">${project.title}</div>
                </div>
                <div class="project-actions">
                    <button class="copy-button" onclick="event.stopPropagation(); copyProjectToClipboard(${project.id}, event)">
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
            <div class="progress-text-large" data-progress-text="${project.id}">${progressPercentage}%</div>
            ${project.completed ? `
            <button class="activate-button" onclick="event.stopPropagation(); completeProject(${project.id})">
                Activate
            </button>
            ` : ''}
        </div>
    `;
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

    // Undo button
    document.getElementById('undoButton').addEventListener('click', performUndo);

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

Admin Features:
- Click on project cards to view/edit details
- Drag projects from anywhere on the card
- Drag tasks to reorder them
- Use copy button (copies only incomplete tasks)
- Click outside expanded cards to close them
- Use the paste box in modals for bulk task import
- Stats are clickable to switch views
- Use tabs in modal for Tasks and Notes

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
window.handleTaskClick = handleTaskClick;
window.switchModalTab = switchModalTab;
window.saveProjectNotes = saveProjectNotes;
window.toggleHideCompleted = toggleHideCompleted;
window.performUndo = performUndo;

// ============================================================================
// INITIALIZATION
// ============================================================================

document.addEventListener('DOMContentLoaded', () => {
    initializePasswordPrompt();
    initializeEventHandlers();
});
