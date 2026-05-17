// Main application entry point

import { VIEWS, SHORTCUTS } from './modules/config.js';
import { state } from './modules/state.js';
import * as api from './modules/api.js';
import * as auth from './modules/auth.js';
import { connectRealtime } from './modules/realtime.js';

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

const loadAccountProfileFromServer = api.loadAccountProfileFromServer || (async () => ({ user: auth.getCurrentUser?.() || null, stats: {} }));
const updateAccountProfileOnServer = api.updateAccountProfileOnServer || (async (payload = {}) => ({ user: { ...(auth.getCurrentUser?.() || {}), ...payload } }));
const archiveProjectOnServer = api.archiveProjectOnServer || (async () => ({ success: false }));
const restoreProjectOnServer = api.restoreProjectOnServer || (async () => ({ success: false }));

const CHROME_EXTENSION_ASYNC_RESPONSE_NOISE = 'A listener indicated an asynchronous response by returning true, but the message channel closed before a response was received';

function isChromeExtensionAsyncResponseNoise(value) {
    const message = String(value?.message || value || '');
    return message.includes(CHROME_EXTENSION_ASYNC_RESPONSE_NOISE);
}

if (typeof window !== 'undefined') {
    window.addEventListener('unhandledrejection', (event) => {
        if (isChromeExtensionAsyncResponseNoise(event.reason)) {
            event.preventDefault();
        }
    });
}

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


const TASK_TAG_OPTIONS = [
    { value: 'none', label: 'No priority' },
    { value: 'high', label: 'High' },
    { value: 'medium', label: 'Medium' },
    { value: 'low', label: 'Low' }
];

const DEFAULT_TASK_TAG = 'none';
const DEFAULT_TASK_CATEGORY = 'General';
const DEFAULT_TASK_CATEGORY_FILTER = 'all';
const TASK_CATEGORY_DROP_ALL = '__all__';
const DEFAULT_TASK_SORT_MODE = 'default';
const COMPLETED_TASK_BATCH_DEFAULT = 50;
const PROJECT_TAG_ALL_FILTER = 'all';
const PROJECT_TAG_MAX_LENGTH = 24;
const PROJECT_TAG_MAX_COUNT = 5;
const PROJECT_TITLE_MAX_LENGTH = 24;
const PROJECT_CALENDAR_NOTE_MAX_LENGTH = 1000;
const PROJECT_NOTES_TAB_DATA_FLAG = '__projectNotesTabs';
const PROJECT_NOTES_DEFAULT_TAB_ID = 'notes-general';
const TASK_TAG_PRIORITY = {
    high: 0,
    medium: 1,
    low: 2,
    none: 3
};

const PERSONAL_PROGRESSION_PROJECT_TASK_POINT = 25;
const PERSONAL_PROGRESSION_PROJECT_MIN_POINTS = 75;
const PERSONAL_PROGRESSION_PROJECT_POINT_CAP = 300;
const PERSONAL_PROGRESSION_BASE_LEVEL_POINTS = 500;
const PERSONAL_PROGRESSION_LEVEL_STEP_POINTS = 150;
const PERSONAL_ACHIEVEMENTS = [
    { id: 'first-strike', name: 'First Strike', description: 'Create your first project.', points: 50, condition: metrics => metrics.totalProjects >= 1 },
    { id: 'task-initiated', name: 'Task Initiated', description: 'Create your first task.', points: 50, condition: metrics => metrics.totalTasks >= 1 },
    { id: 'objective-complete', name: 'Objective Complete', description: 'Complete your first task.', points: 75, condition: metrics => metrics.completedTasks.length >= 1 },
    { id: 'mission-complete', name: 'Mission Complete', description: 'Complete your first project.', points: 100, condition: metrics => metrics.completedProjects.length >= 1 },
    { id: 'clean-sweep', name: 'Clean Sweep', description: 'Complete every task inside a project.', points: 125, condition: metrics => metrics.hasCleanSweep },
    { id: 'deadline-operator', name: 'Deadline Operator', description: 'Add your first due date to a task.', points: 50, condition: metrics => metrics.hasTaskDueDate },
    { id: 'priority-locked', name: 'Priority Locked', description: 'Assign a priority level to a project or task.', points: 50, condition: metrics => metrics.hasPriority },
    { id: 'tag-operator', name: 'Tag Operator', description: 'Add tags to a project or task.', points: 50, condition: metrics => metrics.hasTag },
    { id: 'intel-operator', name: 'Intel Operator', description: 'Add your first project note or task note.', points: 50, condition: metrics => metrics.hasNote },
    { id: 'archiver', name: 'Archiver', description: 'Archive your first completed project.', points: 75, condition: metrics => metrics.hasArchivedCompletedProject },
    { id: 'daily-operator', name: 'Daily Operator', description: 'Complete at least one task every day for a week.', points: 150, condition: metrics => metrics.taskCompletionStreak >= 7 },
    { id: 'project-closer', name: 'Project Closer', description: 'Complete 3 or more projects in a week.', points: 175, condition: metrics => metrics.maxProjectsInWeek >= 3 },
    { id: 'command-output', name: 'Command Output', description: 'Complete 10 or more tasks in a week.', points: 125, condition: metrics => metrics.maxTasksInWeek >= 10 },
    { id: 'productivity-spike', name: 'Productivity Spike', description: 'Complete 15 or more tasks in one week.', points: 150, condition: metrics => metrics.maxTasksInWeek >= 15 },
    { id: 'high-tempo', name: 'High Tempo', description: 'Complete 20 or more tasks in one week.', points: 175, condition: metrics => metrics.maxTasksInWeek >= 20 },
    { id: 'full-send', name: 'Full Send', description: 'Complete 25 or more tasks in one week.', points: 225, condition: metrics => metrics.maxTasksInWeek >= 25 },
    { id: 'mission-streak', name: 'Mission Streak', description: 'Complete tasks 3 days in a row.', points: 100, condition: metrics => metrics.taskCompletionStreak >= 3 },
    { id: 'locked-in-streak', name: 'Locked In', description: 'Complete tasks 5 days in a row.', points: 125, condition: metrics => metrics.taskCompletionStreak >= 5 },
    { id: 'unbroken-chain', name: 'Unbroken Chain', description: 'Complete tasks 14 days in a row.', points: 250, condition: metrics => metrics.taskCompletionStreak >= 14 },
    { id: 'rapid-execution', name: 'Rapid Execution', description: 'Complete 10 tasks in one day.', points: 150, condition: metrics => metrics.maxTasksInDay >= 10 },
    { id: 'sprint-mode', name: 'Sprint Mode', description: 'Complete 15 tasks in one day.', points: 200, condition: metrics => metrics.maxTasksInDay >= 15 },
    { id: 'deadline-crusher', name: 'Deadline Crusher', description: 'Complete 5 overdue tasks in one week.', points: 175, condition: metrics => metrics.maxOverdueTasksInWeek >= 5 },
    { id: 'zero-overdue', name: 'Zero Overdue', description: 'End the week with no overdue tasks.', points: 125, condition: metrics => metrics.hasWeeklyTaskActivity && metrics.currentOverdueTasks === 0 },
    { id: 'prioritized', name: 'Prioritized', description: 'Complete 5 high-priority tasks in one week.', points: 150, condition: metrics => metrics.maxHighPriorityTasksInWeek >= 5 },
    { id: 'mission-critical', name: 'Mission Critical', description: 'Complete 10 high-priority tasks total.', points: 175, condition: metrics => metrics.highPriorityCompletedTasks >= 10 },
    { id: 'encore', name: 'Encore', description: 'Complete 2 projects in one day.', points: 175, condition: metrics => metrics.maxProjectsInDay >= 2 },
    { id: 'sprinter', name: 'Sprinter', description: 'Complete 25 tasks in 24 hours.', points: 250, condition: metrics => metrics.maxTasksInTwentyFourHours >= 25 },
    { id: 'no-misses', name: 'No Misses', description: 'Finish a week with zero overdue tasks.', points: 125, condition: metrics => metrics.hasWeeklyTaskActivity && metrics.currentOverdueTasks === 0 },
    { id: 'locked-in-total', name: 'Locked In', description: 'Complete 50 tasks total.', points: 175, condition: metrics => metrics.completedTasks.length >= 50 },
    { id: 'high-output', name: 'High Output', description: 'Complete 100 tasks total.', points: 250, condition: metrics => metrics.completedTasks.length >= 100 },
    { id: 'elite-output', name: 'Elite Output', description: 'Complete 500 tasks total.', points: 500, condition: metrics => metrics.completedTasks.length >= 500 }
];

const COMPETITIVE_ACHIEVEMENT_FALLBACKS = {
    'efficiency-lead': { name: 'Efficiency Lead', description: 'Have the highest completion percentage among users with 3+ projects.' },
    'closer': { name: 'Closer', description: 'Complete the final task in 5 different shared projects.' },
    'team-carry': { name: 'Team Carry', description: 'Complete 50%+ of tasks in a shared project.' },
    'domination': { name: 'Domination', description: 'Hold #1 on the leaderboard for 7 consecutive days.' },
    'task-hunter': { name: 'Task Hunter', description: 'Complete the most tasks in a single day among all users.' },
    'project-hunter': { name: 'Project Hunter', description: 'Complete the most projects in a single day among all users.' },
    'triumvirate': { name: 'Triumvirate', description: 'Finish a week in the top 3.' },
    'rising-star': { name: 'Rising Star', description: 'Move up 5 leaderboard positions or more in one week.' },
    'weekly-task-champion': { name: 'Weekly Task Champion', description: 'Complete the most tasks in a week.' },
    'weekly-project-champion': { name: 'Weekly Project Champion', description: 'Complete the most projects in a week.' },
    'monthly-task-champion': { name: 'Monthly Task Champion', description: 'Complete the most tasks in a month.' },
    'monthly-project-champion': { name: 'Monthly Project Champion', description: 'Complete the most projects in a month.' }
};

const COMPETITIVE_CHAMPION_ACHIEVEMENT_IDS = new Set([
    'weekly-task-champion',
    'weekly-project-champion',
    'monthly-task-champion',
    'monthly-project-champion'
]);

function getCompetitiveAchievementIconClass(id) {
    return COMPETITIVE_CHAMPION_ACHIEVEMENT_IDS.has(String(id || ''))
        ? 'is-competitive-champion'
        : 'is-competitive-trophy';
}

let personalProgressionModalQueue = [];
let personalProgressionModalActive = false;

function normalizePersonalProgressionStats(stats = {}) {
    const source = stats && typeof stats === 'object' ? stats : {};
    const progressionSource = source.progression && typeof source.progression === 'object' ? source.progression : {};
    const unlockedAchievementIds = Array.isArray(progressionSource.unlockedAchievementIds)
        ? progressionSource.unlockedAchievementIds.map(id => String(id || '')).filter(Boolean)
        : [];
    const lastLevel = Math.max(1, Number(progressionSource.lastLevel || 1) || 1);
    const competitiveSource = progressionSource.competitive && typeof progressionSource.competitive === 'object'
        ? progressionSource.competitive
        : {};

    return {
        ...source,
        completedTasks: Math.max(0, Number(source.completedTasks || 0) || 0),
        completedProjects: Math.max(0, Number(source.completedProjects || 0) || 0),
        progression: {
            ...progressionSource,
            unlockedAchievementIds: [...new Set(unlockedAchievementIds)],
            lastLevel,
            competitive: competitiveSource,
            initialized: Boolean(progressionSource.initialized)
        }
    };
}

function getLocalDayKey(value) {
    if (!value) return '';
    if (typeof value === 'string') {
        const dateOnly = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (dateOnly) return `${dateOnly[1]}-${dateOnly[2]}-${dateOnly[3]}`;
    }
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return '';
    const year = parsed.getFullYear();
    const month = String(parsed.getMonth() + 1).padStart(2, '0');
    const day = String(parsed.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function dayKeyToTime(dayKey) {
    const normalized = normalizeTaskDueDate(dayKey);
    if (!normalized) return NaN;
    const [year, month, day] = normalized.split('-').map(Number);
    return new Date(year, month - 1, day, 12).getTime();
}

function getCompletionTimestamp(value) {
    const parsed = new Date(value || '');
    return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
}

function getStartOfLocalDay(date = new Date()) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function getStartOfLocalWeek(date = new Date()) {
    const start = getStartOfLocalDay(date);
    const daysSinceSunday = start.getDay();
    start.setDate(start.getDate() - daysSinceSunday);
    return start;
}

function getStartOfLocalMonth(date = new Date()) {
    return new Date(date.getFullYear(), date.getMonth(), 1);
}

function isTimestampWithinRange(timestamp, startDate, endDate) {
    return Number.isFinite(timestamp) && timestamp >= startDate.getTime() && timestamp < endDate.getTime();
}

function getCurrentUserIdentity() {
    const user = accountState.user || getCurrentUser?.() || {};
    return {
        id: String(user.id || user._id || ''),
        name: String(user.username || user.email || 'User')
    };
}

function applyTaskCompletionAttribution(task, completedDate = new Date().toISOString()) {
    const identity = getCurrentUserIdentity();
    return {
        ...task,
        completed: true,
        completedDate,
        completedBy: identity.id,
        completedByName: identity.name
    };
}

function clearTaskCompletionAttribution(task) {
    return {
        ...task,
        completed: false,
        completedDate: null,
        completedBy: '',
        completedByName: ''
    };
}

function hasProjectNoteContent(project) {
    const notes = String(project?.notes || '').trim();
    if (!notes) return false;
    try {
        return projectHasNotes(notes);
    } catch {
        return Boolean(getRichTextPlainText(notes));
    }
}

function getMaxRecordsInRollingWindow(records = [], windowMs = 7 * 24 * 60 * 60 * 1000) {
    const sorted = records
        .map(record => ({ ...record, timestamp: Number(record.timestamp || 0) }))
        .filter(record => record.timestamp > 0)
        .sort((a, b) => a.timestamp - b.timestamp);
    let max = 0;
    let start = 0;
    for (let end = 0; end < sorted.length; end += 1) {
        while (sorted[end].timestamp - sorted[start].timestamp >= windowMs) start += 1;
        max = Math.max(max, end - start + 1);
    }
    return max;
}

function getMaxRecordsPerDay(records = []) {
    const counts = new Map();
    records.forEach(record => {
        const dayKey = record.dayKey || getLocalDayKey(record.completedDate);
        if (!dayKey) return;
        counts.set(dayKey, (counts.get(dayKey) || 0) + 1);
    });
    return Math.max(0, ...Array.from(counts.values()), 0);
}

function getCompletionDayStreak(records = []) {
    const dayTimes = [...new Set(records.map(record => record.dayKey).filter(Boolean))]
        .map(dayKey => dayKeyToTime(dayKey))
        .filter(time => Number.isFinite(time))
        .sort((a, b) => a - b);
    if (!dayTimes.length) return 0;
    let maxStreak = 1;
    let currentStreak = 1;
    for (let index = 1; index < dayTimes.length; index += 1) {
        const diffDays = Math.round((dayTimes[index] - dayTimes[index - 1]) / (24 * 60 * 60 * 1000));
        if (diffDays === 1) {
            currentStreak += 1;
        } else if (diffDays > 1) {
            currentStreak = 1;
        }
        maxStreak = Math.max(maxStreak, currentStreak);
    }
    return maxStreak;
}

function calculateProjectProgressionPoints(projects = []) {
    return projects.reduce((total, project) => {
        if (!isProjectCompleted(project)) return total;
        const tasks = Array.isArray(project.tasks) ? project.tasks : [];
        const completedTaskCount = tasks.filter(task => normalizeTask(task).completed).length;
        const rawPoints = completedTaskCount * PERSONAL_PROGRESSION_PROJECT_TASK_POINT;
        const projectPoints = Math.min(
            PERSONAL_PROGRESSION_PROJECT_POINT_CAP,
            Math.max(PERSONAL_PROGRESSION_PROJECT_MIN_POINTS, rawPoints || PERSONAL_PROGRESSION_PROJECT_MIN_POINTS)
        );
        return total + projectPoints;
    }, 0);
}

function calculateLevelProgress(totalPoints = 0) {
    let level = 1;
    let remaining = Math.max(0, Math.floor(Number(totalPoints || 0)));
    let needed = PERSONAL_PROGRESSION_BASE_LEVEL_POINTS;
    while (remaining >= needed) {
        remaining -= needed;
        level += 1;
        needed += PERSONAL_PROGRESSION_LEVEL_STEP_POINTS;
    }
    const percent = needed > 0 ? Math.max(0, Math.min(100, Math.round((remaining / needed) * 100))) : 0;
    return { level, currentLevelPoints: remaining, nextLevelPoints: needed, percent };
}

function buildPersonalProgressionMetrics() {
    const projects = state.getProjects().map(normalizeProject).filter(Boolean);
    const completedTasks = [];
    const completedProjects = [];
    let totalTasks = 0;
    let hasTaskDueDate = false;
    let hasPriority = false;
    let hasTag = false;
    let hasNote = false;
    let hasCleanSweep = false;
    let hasArchivedCompletedProject = false;
    let currentOverdueTasks = 0;
    const todayKey = getTodayDateKey();

    projects.forEach(project => {
        const tasks = Array.isArray(project.tasks) ? project.tasks.map((task, index) => normalizeTask(task, index)) : [];
        totalTasks += tasks.length;
        const projectCompleted = isProjectCompleted(project);
        const projectCompletedDay = getLocalDayKey(project.completedDate);
        const projectCompletedTimestamp = getCompletionTimestamp(project.completedDate);

        if (projectCompleted) {
            completedProjects.push({ project, dayKey: projectCompletedDay, timestamp: projectCompletedTimestamp });
        }
        if (projectCompleted && tasks.length > 0 && tasks.every(task => isTaskCompleted(task))) hasCleanSweep = true;
        if (isProjectArchived(project) && projectCompleted) hasArchivedCompletedProject = true;
        if (normalizePriorityTagValue(project.projectPriorityTag) !== DEFAULT_TASK_TAG) hasPriority = true;
        if (Array.isArray(project.tags) && project.tags.length > 0) hasTag = true;
        if (hasProjectNoteContent(project)) hasNote = true;

        tasks.forEach(task => {
            const dueDate = normalizeTaskDueDate(task.dueDate);
            const tag = normalizePriorityTagValue(task.tag);
            if (dueDate) hasTaskDueDate = true;
            if (tag !== DEFAULT_TASK_TAG) hasPriority = true;
            if (task.category && task.category !== DEFAULT_TASK_CATEGORY) hasTag = true;
            if (getRichTextPlainText(task.note || '')) hasNote = true;
            if (isTaskOverdue(task)) currentOverdueTasks += 1;
            if (!isTaskCompleted(task)) return;

            const completedDate = task.completedDate || '';
            const dayKey = getLocalDayKey(completedDate);
            const timestamp = getCompletionTimestamp(completedDate);
            const record = {
                task,
                project,
                dayKey,
                timestamp,
                completedDate,
                dueDate,
                highPriority: tag === 'high',
                overdueAtCompletion: Boolean(dueDate && dayKey && dueDate < dayKey)
            };
            completedTasks.push(record);
        });
    });

    const highPriorityCompleted = completedTasks.filter(record => record.highPriority);
    const overdueCompleted = completedTasks.filter(record => record.overdueAtCompletion);
    const sevenDaysAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);

    return {
        projects,
        totalProjects: projects.length,
        totalTasks,
        completedTasks,
        completedProjects,
        hasTaskDueDate,
        hasPriority,
        hasTag,
        hasNote,
        hasCleanSweep,
        hasArchivedCompletedProject,
        currentOverdueTasks,
        hasWeeklyTaskActivity: completedTasks.some(record => record.timestamp >= sevenDaysAgo),
        taskCompletionStreak: getCompletionDayStreak(completedTasks),
        maxTasksInWeek: getMaxRecordsInRollingWindow(completedTasks),
        maxProjectsInWeek: getMaxRecordsInRollingWindow(completedProjects),
        maxOverdueTasksInWeek: getMaxRecordsInRollingWindow(overdueCompleted),
        maxHighPriorityTasksInWeek: getMaxRecordsInRollingWindow(highPriorityCompleted),
        highPriorityCompletedTasks: highPriorityCompleted.length,
        maxTasksInDay: getMaxRecordsPerDay(completedTasks),
        maxProjectsInDay: getMaxRecordsPerDay(completedProjects),
        maxTasksInTwentyFourHours: getMaxRecordsInRollingWindow(completedTasks, 24 * 60 * 60 * 1000)
    };
}

function getCurrentPersonalLevelProgress() {
    const stats = normalizePersonalProgressionStats(state.getStats());
    const progression = stats.progression;
    const unlockedSet = new Set(progression.unlockedAchievementIds || []);
    const achievementPoints = PERSONAL_ACHIEVEMENTS
        .filter(achievement => unlockedSet.has(achievement.id))
        .reduce((total, achievement) => total + achievement.points, 0);
    const projectPoints = calculateProjectProgressionPoints(state.getProjects());
    const totalPoints = projectPoints + achievementPoints;
    return { ...calculateLevelProgress(totalPoints), totalPoints, unlockedSet };
}

function syncPanelUserLevelBadge(level) {
    const badge = document.getElementById('panelUserLevelBadge');
    if (badge) badge.textContent = `LEVEL ${Math.max(1, Number(level) || 1)}`;
}

function renderAccountProgression() {
    const levelProgress = getCurrentPersonalLevelProgress();
    const unlockedSet = levelProgress.unlockedSet;

    const levelEl = document.getElementById('accountProgressionLevel');
    const barEl = document.getElementById('accountProgressionBar');
    const pointsEl = document.getElementById('accountProgressionPoints');
    const nextEl = document.getElementById('accountProgressionNext');
    const summaryEl = document.getElementById('accountAchievementsSummary');
    const listEl = document.getElementById('accountAchievementsList');

    if (levelEl) levelEl.textContent = String(levelProgress.level);
    syncPanelUserLevelBadge(levelProgress.level);
    if (barEl) barEl.style.width = `${levelProgress.percent}%`;
    if (pointsEl) pointsEl.textContent = `${levelProgress.totalPoints} XP`;
    if (nextEl) nextEl.textContent = `${levelProgress.currentLevelPoints} / ${levelProgress.nextLevelPoints} XP to Level ${levelProgress.level + 1}`;
    if (summaryEl) summaryEl.textContent = `${unlockedSet.size} / ${PERSONAL_ACHIEVEMENTS.length} unlocked`;
    if (listEl) {
        listEl.innerHTML = PERSONAL_ACHIEVEMENTS.map(achievement => {
            const unlocked = unlockedSet.has(achievement.id);
            return `
                <div class="account-achievement-card ${unlocked ? 'is-unlocked' : 'is-locked'}">
                    <span class="account-achievement-star" aria-hidden="true"></span>
                    <div class="account-achievement-copy">
                        <div class="account-achievement-name">${escapeHtml(achievement.name)}</div>
                        <div class="account-achievement-description">${escapeHtml(achievement.description)}</div>
                    </div>
                    <div class="account-achievement-points">${achievement.points} XP</div>
                </div>
            `;
        }).join('');
    }
}

function queuePersonalProgressionModal(payload) {
    personalProgressionModalQueue.push(payload);
    showNextPersonalProgressionModal();
}

function ensurePersonalProgressionModal() {
    let modal = document.getElementById('personalProgressionModal');
    if (modal) return modal;

    document.body.insertAdjacentHTML('beforeend', `
        <div class="modal-overlay personal-progression-modal-overlay" id="personalProgressionModal" aria-hidden="true">
            <div class="modal-content personal-progression-modal-content" role="dialog" aria-modal="true" aria-labelledby="personalProgressionModalTitle">
                <span class="personal-progression-modal-star" aria-hidden="true"></span>
                <div class="personal-progression-modal-kicker" id="personalProgressionModalKicker">Achievement Unlocked</div>
                <h3 class="personal-progression-modal-title" id="personalProgressionModalTitle"></h3>
                <p class="personal-progression-modal-description" id="personalProgressionModalDescription"></p>
                <button class="modal-done-btn personal-progression-modal-button" type="button" onclick="closePersonalProgressionModal()">Continue</button>
            </div>
        </div>
    `);

    modal = document.getElementById('personalProgressionModal');
    modal?.addEventListener('click', event => {
        if (event.target === modal) closePersonalProgressionModal();
    });
    return modal;
}

function showNextPersonalProgressionModal() {
    if (personalProgressionModalActive || personalProgressionModalQueue.length === 0) return;
    const payload = personalProgressionModalQueue.shift();
    const modal = ensurePersonalProgressionModal();
    if (!modal) return;

    const kickerEl = document.getElementById('personalProgressionModalKicker');
    const titleEl = document.getElementById('personalProgressionModalTitle');
    const descriptionEl = document.getElementById('personalProgressionModalDescription');
    const iconEl = modal.querySelector('.personal-progression-modal-star');
    if (kickerEl) kickerEl.textContent = payload.kicker || 'Achievement Unlocked';
    if (titleEl) titleEl.textContent = payload.title || '';
    if (descriptionEl) descriptionEl.textContent = payload.description || '';
    if (iconEl) {
        iconEl.classList.remove('is-personal-star', 'is-competitive-champion', 'is-competitive-trophy');
        iconEl.classList.add(payload.iconClass || 'is-personal-star');
    }

    modal.classList.add('active');
    modal.setAttribute('aria-hidden', 'false');
    personalProgressionModalActive = true;
}

function closePersonalProgressionModal() {
    const modal = document.getElementById('personalProgressionModal');
    modal?.classList.remove('active');
    modal?.setAttribute('aria-hidden', 'true');
    personalProgressionModalActive = false;
    setTimeout(showNextPersonalProgressionModal, 120);
}

function evaluatePersonalProgression({ showModals = true, persistStatsOnly = false } = {}) {
    const stats = normalizePersonalProgressionStats(state.getStats());
    const progression = stats.progression;
    const metrics = buildPersonalProgressionMetrics();
    const unlockedSet = new Set(progression.unlockedAchievementIds || []);
    const newlyUnlocked = [];

    PERSONAL_ACHIEVEMENTS.forEach(achievement => {
        if (unlockedSet.has(achievement.id)) return;
        if (achievement.condition(metrics)) {
            unlockedSet.add(achievement.id);
            newlyUnlocked.push(achievement);
        }
    });

    const projectPoints = calculateProjectProgressionPoints(metrics.projects);
    const achievementPoints = PERSONAL_ACHIEVEMENTS
        .filter(achievement => unlockedSet.has(achievement.id))
        .reduce((total, achievement) => total + achievement.points, 0);
    const totalPoints = projectPoints + achievementPoints;
    const levelProgress = calculateLevelProgress(totalPoints);
    const previousLevel = Math.max(1, Number(progression.lastLevel || levelProgress.level) || 1);
    const shouldShowModals = showModals && Boolean(progression.initialized);

    const nextProgression = {
        ...progression,
        unlockedAchievementIds: Array.from(unlockedSet),
        achievementPoints,
        projectPoints,
        totalPoints,
        lastLevel: levelProgress.level,
        initialized: true
    };

    const changed = JSON.stringify(progression) !== JSON.stringify(nextProgression);
    if (changed) {
        state.setStats({ ...stats, progression: nextProgression });
        accountState.stats = { ...accountState.stats, ...state.getStats() };
    }

    if (shouldShowModals) {
        newlyUnlocked.forEach(achievement => {
            queuePersonalProgressionModal({
                kicker: 'Achievement Unlocked',
                title: achievement.name,
                description: `${achievement.description} +${achievement.points} XP`
            });
        });
        if (levelProgress.level > previousLevel) {
            queuePersonalProgressionModal({
                kicker: 'Level Up',
                title: `Level ${levelProgress.level}`,
                description: `You reached Level ${levelProgress.level}. Project points and achievement bonuses increased your rank.`
            });
        }
    }

    renderAccountProgression();
    if (changed && persistStatsOnly) {
        saveStatsOnly().catch(err => console.error('Failed to save progression stats:', err));
    }
    return { changed, level: levelProgress.level, newlyUnlocked };
}

function normalizePriorityTagValue(value) {
    const rawValue = String(value ?? DEFAULT_TASK_TAG).trim().toLowerCase();
    const tagValue = rawValue === 'critical' ? 'high' : rawValue;
    return Object.prototype.hasOwnProperty.call(TASK_TAG_PRIORITY, tagValue) ? tagValue : DEFAULT_TASK_TAG;
}

function getPriorityTagLabel(value) {
    const tag = normalizePriorityTagValue(value);
    return TASK_TAG_OPTIONS.find(option => option.value === tag)?.label || 'No priority';
}

function getNextPriorityTagValue(value) {
    const priorityCycle = ['none', 'high', 'medium', 'low'];
    const currentIndex = priorityCycle.indexOf(normalizePriorityTagValue(value));
    return priorityCycle[(currentIndex + 1) % priorityCycle.length] || DEFAULT_TASK_TAG;
}

function normalizeTaskDueDate(value) {
    const raw = String(value ?? '').trim();
    if (!raw) return '';
    const dateOnlyMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (dateOnlyMatch) return `${dateOnlyMatch[1]}-${dateOnlyMatch[2]}-${dateOnlyMatch[3]}`;
    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) return '';
    const year = parsed.getFullYear();
    const month = String(parsed.getMonth() + 1).padStart(2, '0');
    const day = String(parsed.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function formatTaskDueDate(value) {
    const dueDate = normalizeTaskDueDate(value);
    if (!dueDate) return 'No due date';
    const [year, month, day] = dueDate.split('-').map(Number);
    const parsed = new Date(year, month - 1, day, 12);
    if (Number.isNaN(parsed.getTime())) return dueDate;
    return parsed.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}

function getProjectDueDate(project = {}) {
    return normalizeTaskDueDate(project?.dueDate || project?.projectDueDate || project?.deadline || '');
}

function formatProjectDueDate(value) {
    const dueDate = normalizeTaskDueDate(value);
    return dueDate ? formatTaskDueDate(dueDate) : 'No project due date';
}

function parseDateKey(value) {
    const dateKey = normalizeTaskDueDate(value);
    if (!dateKey) return null;
    const [year, month, day] = dateKey.split('-').map(Number);
    const parsed = new Date(year, month - 1, day, 12);
    if (Number.isNaN(parsed.getTime())) return null;
    if (parsed.getFullYear() !== year || parsed.getMonth() !== month - 1 || parsed.getDate() !== day) return null;
    return parsed;
}

function isValidDateKey(value) {
    return Boolean(parseDateKey(value));
}

function formatDateKey(date) {
    const parsed = date instanceof Date ? date : parseDateKey(date);
    if (!parsed || Number.isNaN(parsed.getTime())) return '';
    const year = parsed.getFullYear();
    const month = String(parsed.getMonth() + 1).padStart(2, '0');
    const day = String(parsed.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function getMonthKeyFromDate(value = new Date()) {
    const parsed = value instanceof Date ? value : parseDateKey(value);
    const safeDate = parsed && !Number.isNaN(parsed.getTime()) ? parsed : new Date();
    const year = safeDate.getFullYear();
    const month = String(safeDate.getMonth() + 1).padStart(2, '0');
    return `${year}-${month}`;
}

function normalizeProjectCalendarNotes(value = {}) {
    const source = value instanceof Map ? Object.fromEntries(value.entries()) : value;
    if (!source || typeof source !== 'object' || Array.isArray(source)) return {};

    return Object.entries(source).reduce((notes, [rawDate, rawNote]) => {
        const dateKey = normalizeTaskDueDate(rawDate);
        if (!isValidDateKey(dateKey)) return notes;
        const noteText = String(rawNote ?? '').trim().slice(0, PROJECT_CALENDAR_NOTE_MAX_LENGTH);
        if (!noteText) return notes;
        notes[dateKey] = noteText;
        return notes;
    }, {});
}

function getProjectCalendarNotes(project) {
    return normalizeProjectCalendarNotes(project?.calendarNotes || project?.projectCalendarNotes || {});
}

function getCalendarMonthLabel(monthKey) {
    const [year, month] = String(monthKey || '').split('-').map(Number);
    const parsed = new Date(year, month - 1, 1, 12);
    if (Number.isNaN(parsed.getTime())) return '';
    return parsed.toLocaleDateString([], { month: 'long', year: 'numeric' });
}

function getProjectCalendarMonthKey(projectId) {
    const stored = uiState.projectCalendarMonths?.[projectId];
    if (/^\d{4}-\d{2}$/.test(String(stored || ''))) return stored;
    return getMonthKeyFromDate(new Date());
}

function setProjectCalendarMonthKey(projectId, monthKey) {
    if (!uiState.projectCalendarMonths) uiState.projectCalendarMonths = {};
    uiState.projectCalendarMonths[projectId] = /^\d{4}-\d{2}$/.test(String(monthKey || '')) ? monthKey : getMonthKeyFromDate(new Date());
}

function getProjectCalendarSelectedDate(projectId) {
    const stored = uiState.projectCalendarSelections?.[projectId];
    if (isValidDateKey(stored)) return normalizeTaskDueDate(stored);
    return getTodayDateKey();
}

function setProjectCalendarSelectedDate(projectId, dateKey) {
    if (!uiState.projectCalendarSelections) uiState.projectCalendarSelections = {};
    const safeDateKey = normalizeTaskDueDate(dateKey) || getTodayDateKey();
    uiState.projectCalendarSelections[projectId] = safeDateKey;
    setProjectCalendarMonthKey(projectId, getMonthKeyFromDate(safeDateKey));
}

function getTasksDueOnDate(project, dateKey) {
    const targetDate = normalizeTaskDueDate(dateKey);
    return (Array.isArray(project?.tasks) ? project.tasks : [])
        .map((task, index) => normalizeTask(task, index))
        .filter(task => normalizeTaskDueDate(task.dueDate) === targetDate)
        .sort((a, b) => getTaskPlainText(a.text).localeCompare(getTaskPlainText(b.text), undefined, { sensitivity: 'base' }));
}

function getTasksByDueDate(project) {
    return (Array.isArray(project?.tasks) ? project.tasks : [])
        .map((task, index) => normalizeTask(task, index))
        .filter(task => normalizeTaskDueDate(task.dueDate))
        .reduce((byDate, task) => {
            const dueDate = normalizeTaskDueDate(task.dueDate);
            if (!byDate[dueDate]) byDate[dueDate] = [];
            byDate[dueDate].push(task);
            return byDate;
        }, {});
}

function getHighestPriorityTagForTasks(tasks = []) {
    return (Array.isArray(tasks) ? tasks : [])
        .map(task => normalizePriorityTagValue(task?.tag))
        .sort((a, b) => (TASK_TAG_PRIORITY[a] ?? TASK_TAG_PRIORITY[DEFAULT_TASK_TAG]) - (TASK_TAG_PRIORITY[b] ?? TASK_TAG_PRIORITY[DEFAULT_TASK_TAG]))[0] || DEFAULT_TASK_TAG;
}

function getProjectCalendarDayPriorityClass(tasks = []) {
    return `project-calendar-day-priority--${getHighestPriorityTagForTasks(tasks)}`;
}

function getProjectCalendarTaskPriorityClass(task = {}) {
    return `project-calendar-task-priority--${normalizePriorityTagValue(task?.tag)}`;
}

function getProjectCalendarDayClass({ dateKey, selectedDate, todayKey, tasks = [], note = '', projectDueDate = '' }) {
    const classes = ['project-calendar-day'];
    if (dateKey === selectedDate) classes.push('is-selected');
    if (dateKey === todayKey) classes.push('is-today');
    if (tasks.length) {
        classes.push('has-tasks');
        classes.push(getProjectCalendarDayPriorityClass(tasks));
    }
    if (note) classes.push('has-note');
    if (projectDueDate && dateKey === projectDueDate) classes.push('has-project-due');
    return classes.join(' ');
}

function getCalendarMonthGridDays(monthKey) {
    const [year, month] = String(monthKey || '').split('-').map(Number);
    const firstDay = new Date(year, month - 1, 1, 12);
    if (Number.isNaN(firstDay.getTime())) return [];
    const leadingBlankDays = firstDay.getDay();
    const daysInMonth = new Date(year, month, 0).getDate();
    const days = [];
    for (let i = 0; i < leadingBlankDays; i++) days.push(null);
    for (let day = 1; day <= daysInMonth; day++) {
        days.push(formatDateKey(new Date(year, month - 1, day, 12)));
    }
    while (days.length % 7 !== 0) days.push(null);
    return days;
}

function buildProjectCalendarGridMarkup(project, monthKey, selectedDate) {
    const projectIdLiteral = serializeInlineJsString(project?.id || '');
    const todayKey = getTodayDateKey();
    const notes = getProjectCalendarNotes(project);
    const tasksByDate = getTasksByDueDate(project);
    const projectDueDate = getProjectDueDate(project);
    const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const days = getCalendarMonthGridDays(monthKey);

    return `
        <div class="project-calendar-weekdays" aria-hidden="true">
            ${weekdays.map(day => `<span>${escapeHtml(day)}</span>`).join('')}
        </div>
        <div class="project-calendar-month-grid" role="grid" aria-label="${escapeHtml(getCalendarMonthLabel(monthKey))}">
            ${days.map(dateKey => {
                if (!dateKey) return '<div class="project-calendar-day-spacer" aria-hidden="true"></div>';
                const dayNumber = Number(dateKey.slice(-2));
                const tasks = tasksByDate[dateKey] || [];
                const note = notes[dateKey] || '';
                const taskLabel = tasks.length === 1 ? '1 task due' : `${tasks.length} tasks due`;
                const priorityTag = getHighestPriorityTagForTasks(tasks);
                const ariaParts = [formatTaskDueDate(dateKey)];
                if (tasks.length) ariaParts.push(`${taskLabel}, highest priority ${getPriorityTagLabel(priorityTag)}`);
                if (note) ariaParts.push('has note');
                if (projectDueDate === dateKey) ariaParts.push('project due date');
                return `
                    <button class="${getProjectCalendarDayClass({ dateKey, selectedDate, todayKey, tasks, note, projectDueDate })}"
                            type="button"
                            role="gridcell"
                            data-calendar-date="${dateKey}"
                            aria-pressed="${dateKey === selectedDate ? 'true' : 'false'}"
                            aria-label="${escapeHtml(ariaParts.join(', '))}"
                            onclick="selectProjectCalendarDay(${projectIdLiteral}, '${dateKey}', event)"
                            ondragover="handleProjectCalendarDayDragOver(${projectIdLiteral}, '${dateKey}', event)"
                            ondragenter="handleProjectCalendarDayDragOver(${projectIdLiteral}, '${dateKey}', event)"
                            ondragleave="handleProjectCalendarDayDragLeave(event)"
                            ondrop="handleProjectCalendarTaskDrop(${projectIdLiteral}, '${dateKey}', event)">
                        <span class="project-calendar-day-number">${dayNumber}</span>
                        <span class="project-calendar-day-markers" aria-hidden="true">
                            ${projectDueDate === dateKey ? '<span class="project-calendar-marker project-calendar-marker--project"></span>' : ''}
                            ${tasks.length ? `<span class="project-calendar-marker project-calendar-marker--tasks project-calendar-marker--priority-${priorityTag}"></span>` : ''}
                            ${note ? '<span class="project-calendar-marker project-calendar-marker--note"></span>' : ''}
                        </span>
                    </button>
                `;
            }).join('')}
        </div>
    `;
}

function buildProjectCalendarTaskPriorityControl(projectId, task) {
    const normalizedTask = normalizeTask(task);
    const canEditCalendar = state.canEdit(projectId);
    const taskIdLiteral = serializeInlineJsString(normalizedTask.id);
    const projectIdLiteral = serializeInlineJsString(projectId);
    const tag = normalizePriorityTagValue(normalizedTask.tag);

    if (!canEditCalendar) {
        return `<span class="project-calendar-selected-task-priority ${getProjectCalendarTaskPriorityClass(normalizedTask)}">${escapeHtml(getPriorityTagLabel(tag))}</span>`;
    }

    return `
        <label class="project-calendar-task-priority-control project-calendar-task-priority-control--${tag}"
               title="Task priority"
               onclick="event.stopPropagation();"
               onpointerdown="event.stopPropagation();"
               ondragstart="event.preventDefault(); event.stopPropagation();">
            <span class="task-tag-flag task-tag-flag--${tag}" aria-hidden="true"></span>
            <select class="project-calendar-task-priority-select"
                    aria-label="Task priority"
                    onchange="updateProjectCalendarTaskPriority(${projectIdLiteral}, ${taskIdLiteral}, this.value, event)"
                    onclick="event.stopPropagation();"
                    onpointerdown="event.stopPropagation();"
                    ondragstart="event.preventDefault(); event.stopPropagation();">
                ${TASK_TAG_OPTIONS.map(option => `
                    <option value="${option.value}" ${tag === option.value ? 'selected' : ''}>${escapeHtml(option.label)}</option>
                `).join('')}
            </select>
        </label>
    `;
}

function buildProjectCalendarTaskCompletionControl(projectId, task) {
    const normalizedTask = normalizeTask(task);
    const canEditCalendar = state.canEdit(projectId);
    const projectIdLiteral = serializeInlineJsString(projectId);
    const completedClass = normalizedTask.completed ? 'checked' : '';
    const completedIcon = normalizedTask.completed ? `
        <svg class="icon" fill="none" stroke="#f0f4f8" viewBox="0 0 24 24" aria-hidden="true">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.4" d="M5 13l4 4L19 7"></path>
        </svg>
    ` : '';

    if (!canEditCalendar) {
        return `<span class="project-calendar-selected-task-status" aria-hidden="true">${normalizedTask.completed ? '✓' : '•'}</span>`;
    }

    return `
        <div class="task-checkbox ${completedClass}"
             data-task-checkbox="${normalizedTask.id}"
             role="button"
             tabindex="0"
             aria-label="${normalizedTask.completed ? 'Mark task incomplete' : 'Mark task complete'}"
             aria-pressed="${normalizedTask.completed ? 'true' : 'false'}"
             onclick="event.stopPropagation(); toggleTask(${projectIdLiteral}, ${normalizedTask.id})"
             onkeydown="if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); toggleTask(${projectIdLiteral}, ${normalizedTask.id}); }"
             onpointerdown="event.stopPropagation();"
             ondragstart="event.preventDefault(); event.stopPropagation();">
            ${completedIcon}
        </div>
    `;
}

function buildProjectCalendarSelectedDayMarkup(project, selectedDate) {
    const projectIdLiteral = serializeInlineJsString(project?.id || '');
    const notes = getProjectCalendarNotes(project);
    const selectedNote = notes[selectedDate] || '';
    const selectedTasks = getTasksDueOnDate(project, selectedDate);
    const canEditCalendar = state.canEdit(project?.id);
    const projectDueDate = getProjectDueDate(project);
    const selectedDateLiteral = serializeInlineJsString(selectedDate);
    const noteStateClass = selectedNote ? 'has-day-note' : 'is-day-note-empty';
    const createTaskInputId = `project-calendar-create-task-${String(project?.id || '')}`;

    return `
        <div class="project-calendar-selected-card ${noteStateClass}">
            <div class="project-calendar-selected-header">
                <div>
                    <div class="project-calendar-selected-label">Selected Day</div>
                    <h4 class="project-calendar-selected-title">${escapeHtml(formatTaskDueDate(selectedDate))}</h4>
                </div>
                ${projectDueDate === selectedDate ? '<span class="project-calendar-project-due-pill">Project Due</span>' : ''}
            </div>
            <div class="project-calendar-selected-block">
                <div class="project-calendar-selected-block-title">Tasks Due</div>
                ${selectedTasks.length ? `
                    <div class="project-calendar-selected-tasks">
                        ${selectedTasks.map(task => {
                        const taskIdLiteral = serializeInlineJsString(task.id);
                        return `
                            <div class="project-calendar-selected-task ${isTaskCompleted(task) ? 'is-completed' : ''} ${getProjectCalendarTaskPriorityClass(task)}">
                                ${buildProjectCalendarTaskCompletionControl(project?.id || '', task)}
                                <div class="project-calendar-selected-task-body">
                                    <span class="project-calendar-selected-task-text ${isTaskCompleted(task) ? 'completed' : ''}">${getTaskDisplayHtml(task.text || '', 'Untitled task')}</span>
                                    <div class="project-calendar-selected-task-actions">
                                        ${buildProjectCalendarTaskPriorityControl(project?.id || '', task)}
                                        ${canEditCalendar ? `
                                            <button class="project-calendar-remove-task-button"
                                                    type="button"
                                                    title="Remove this task from ${escapeHtml(formatTaskDueDate(selectedDate))}"
                                                    aria-label="Remove task from selected day"
                                                    onclick="removeProjectCalendarTaskFromDay(${projectIdLiteral}, ${taskIdLiteral}, ${selectedDateLiteral}, event)">
                                                Remove
                                            </button>
                                        ` : ''}
                                    </div>
                                </div>
                            </div>
                        `;
                    }).join('')}
                    </div>
                ` : '<div class="project-calendar-empty">No tasks due on this day</div>'}
                ${canEditCalendar ? `
                    <form class="project-calendar-create-task"
                          onsubmit="createProjectCalendarTask(${projectIdLiteral}, ${selectedDateLiteral}, event)">
                        <input class="project-calendar-create-task-input"
                               id="${escapeHtml(createTaskInputId)}"
                               type="text"
                               maxlength="180"
                               placeholder="New task for this day"
                               autocomplete="off">
                        <button class="project-calendar-create-task-button" type="submit">Create Task</button>
                    </form>
                ` : ''}
            </div>
            <div class="project-calendar-selected-block project-calendar-note-block ${noteStateClass}">
                <label class="project-calendar-selected-block-title" for="project-calendar-note-${escapeHtml(String(project?.id || ''))}">Day Note</label>
                <textarea class="project-calendar-note-input ${selectedNote ? '' : 'is-minimized'}"
                          id="project-calendar-note-${escapeHtml(String(project?.id || ''))}"
                          maxlength="${PROJECT_CALENDAR_NOTE_MAX_LENGTH}"
                          rows="${selectedNote ? '5' : '1'}"
                          placeholder="Add a note for this day"
                          ${canEditCalendar ? '' : 'readonly'}>${escapeHtml(selectedNote)}</textarea>
                <div class="project-calendar-note-actions">
                    <span class="project-calendar-note-limit">${selectedNote.length}/${PROJECT_CALENDAR_NOTE_MAX_LENGTH}</span>
                    ${canEditCalendar ? `
                        <button class="project-calendar-note-button" type="button" onclick="saveProjectCalendarNote(${projectIdLiteral}, ${selectedDateLiteral}, event)">Save Note</button>
                        <button class="project-calendar-note-button project-calendar-note-button--secondary" type="button" onclick="deleteProjectCalendarNote(${projectIdLiteral}, ${selectedDateLiteral}, event)" ${selectedNote ? '' : 'disabled'}>Delete Note</button>
                    ` : '<span class="project-calendar-readonly-note">Read-only</span>'}
                </div>
            </div>
        </div>
    `;
}

function getProjectCalendarDraggableTasks(project) {
    if (!project) return [];
    const projectId = project?.id;
    const sortMode = getProjectTaskSortPreference(projectId);
    let activeCategory = getProjectTaskCategoryFilter(projectId);
    const categories = getProjectTaskCategories(project);
    if (activeCategory !== DEFAULT_TASK_CATEGORY_FILTER && !categories.includes(activeCategory)) {
        activeCategory = DEFAULT_TASK_CATEGORY_FILTER;
    }

    return getDisplayTasksForProject(project, { hideCompleted: true, sortMode, activeCategory })
        .map((task, index) => normalizeTask(task, index))
        .filter(task => !isTaskCompleted(task));
}

function buildProjectCalendarTaskDockMarkup(project) {
    const projectIdLiteral = serializeInlineJsString(project?.id || '');
    const canEditCalendar = state.canEdit(project?.id);
    const tasks = getProjectCalendarDraggableTasks(project);
    const taskSortMode = getProjectTaskSortPreference(project?.id);
    const canManualReorder = taskSortMode === DEFAULT_TASK_SORT_MODE && canEditCalendar;

    return `
        <div class="project-calendar-task-dock" aria-label="Calendar task drag list">
            <div class="project-calendar-task-dock-header">
                <div class="project-calendar-task-dock-heading">
                    <div class="project-calendar-selected-label">Incomplete Tasks</div>
                    <h4 class="project-calendar-task-dock-title">Drag tasks to dates</h4>
                </div>
                <div class="project-calendar-task-dock-controls">
                    <select class="task-sort-select project-calendar-task-sort-select"
                            id="calendar-task-sort-select-${escapeHtml(String(project?.id || ''))}"
                            aria-label="Sort calendar tasks"
                            onchange="setProjectTaskSortMode(${projectIdLiteral}, this.value)">
                        <option value="default" ${taskSortMode === 'default' ? 'selected' : ''}>MANUAL</option>
                        <option value="ascending" ${taskSortMode === 'ascending' ? 'selected' : ''}>A-Z ↑</option>
                        <option value="descending" ${taskSortMode === 'descending' ? 'selected' : ''}>A-Z ↓</option>
                        <option value="due-date" ${taskSortMode === 'due-date' ? 'selected' : ''}>DUE DATE</option>
                        <option value="tag-priority" ${taskSortMode === 'tag-priority' ? 'selected' : ''}>TAG PRIORITY</option>
                    </select>
                    <span class="project-calendar-task-dock-count">${tasks.length}</span>
                </div>
            </div>
            ${tasks.length ? `
                <div class="project-calendar-task-dock-list" data-calendar-task-list="${escapeHtml(String(project?.id || ''))}">
                    ${tasks.map(task => {
                        const taskIdLiteral = serializeInlineJsString(task.id);
                        const dueDate = normalizeTaskDueDate(task.dueDate);
                        return `
                            <div class="project-calendar-draggable-task ${getProjectCalendarTaskPriorityClass(task)} ${canManualReorder ? 'has-manual-reorder' : ''}"
                                 data-calendar-task-item
                                 data-task-id="${escapeHtml(String(task.id))}"
                                 draggable="false"
                                 role="listitem"
                                 title="${canEditCalendar ? 'Drag onto a calendar date to assign a due date' : 'Read-only task'}">
                                ${canManualReorder ? `
                                    <svg class="task-drag-handle project-calendar-task-drag-handle" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true" ondragstart="event.preventDefault(); event.stopPropagation();">
                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 8h16M4 16h16"></path>
                                    </svg>
                                ` : ''}
                                ${buildProjectCalendarTaskCompletionControl(project?.id || '', task)}
                                <span class="project-calendar-draggable-task-text">${getTaskDisplayHtml(task.text || '', 'Untitled task')}</span>
                                <span class="project-calendar-draggable-task-date ${dueDate ? 'has-date' : ''}">${dueDate ? escapeHtml(formatTaskDueDate(dueDate)) : 'No due date'}</span>
                                ${buildProjectCalendarTaskPriorityControl(project?.id || '', task)}
                            </div>
                        `;
                    }).join('')}
                </div>
            ` : '<div class="project-calendar-empty">No incomplete tasks available to schedule</div>'}
        </div>
    `;
}

function handleProjectCalendarTaskDragStart(projectId, taskId, event) {
    if (event?.target?.closest?.('.project-calendar-task-priority-control')) {
        event?.preventDefault?.();
        event?.stopPropagation?.();
        return;
    }
    if (!state.canEdit(projectId)) {
        event?.preventDefault?.();
        return;
    }
    event?.stopPropagation?.();
    event?.currentTarget?.classList?.add('is-calendar-task-scheduling');
    const payload = JSON.stringify({ projectId: String(projectId ?? ''), taskId: String(taskId ?? '') });
    event?.dataTransfer?.setData?.('application/x-project-calendar-task', payload);
    event?.dataTransfer?.setData?.('text/plain', payload);
    if (event?.dataTransfer) event.dataTransfer.effectAllowed = 'move';
}

function clearProjectCalendarDropTargets() {
    document.querySelectorAll('.project-calendar-day.is-drop-target').forEach(day => {
        day.classList.remove('is-drop-target');
    });
}

function handleProjectCalendarTaskDragEnd(event) {
    clearProjectCalendarDropTargets();
    event?.currentTarget?.classList?.remove('is-calendar-task-scheduling');
}

function handleProjectCalendarDayDragLeave(event) {
    event?.currentTarget?.classList?.remove('is-drop-target');
}

function handleProjectCalendarDayDragOver(projectId, dateKey, event) {
    if (!state.canEdit(projectId) || !isValidDateKey(dateKey)) return;
    event?.preventDefault?.();
    event?.stopPropagation?.();
    if (event?.dataTransfer) event.dataTransfer.dropEffect = 'move';
    event?.currentTarget?.classList?.add('is-drop-target');
}

function scheduleProjectCalendarTask(projectId, taskId, dateKey, options = {}) {
    if (!state.canEdit(projectId)) return false;

    const safeDateKey = normalizeTaskDueDate(dateKey);
    if (!isValidDateKey(safeDateKey)) return false;

    const draggedTaskId = String(taskId ?? '');
    if (!draggedTaskId) return false;

    const project = state.findProject(projectId);
    if (!project || !Array.isArray(project.tasks)) return false;

    let changed = false;
    const updatedTasks = project.tasks.map((task, index) => {
        const normalized = normalizeTask(task, index);
        if (String(normalized.id) !== draggedTaskId) return normalized;
        if (normalizeTaskDueDate(normalized.dueDate) === safeDateKey) return normalized;
        changed = true;
        return { ...normalized, dueDate: safeDateKey };
    });

    setProjectCalendarSelectedDate(projectId, safeDateKey);

    if (!changed) {
        renderProjectCalendarSection(projectId, { preserveScroll: options.preserveScroll !== false });
        saveOpenProjectModalState(projectId, 'calendar');
        return true;
    }

    rememberRecentLocalTaskSnapshot(project, updatedTasks);
    state.updateProject(projectId, projectUpdate({ tasks: updatedTasks }));
    saveData();
    renderModalTaskList(projectId);
    updateProjectProgress(projectId);
    renderProjectCalendarSection(projectId, { preserveScroll: options.preserveScroll !== false });
    render();
    saveOpenProjectModalState(projectId, 'calendar');
    return true;
}

function handleProjectCalendarTaskDrop(projectId, dateKey, event) {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    clearProjectCalendarDropTargets();

    let payload = null;
    const rawPayload = event?.dataTransfer?.getData?.('application/x-project-calendar-task')
        || event?.dataTransfer?.getData?.('text/plain')
        || '';
    try {
        payload = JSON.parse(rawPayload);
    } catch (error) {
        payload = null;
    }

    const draggedProjectId = String(payload?.projectId ?? '');
    const draggedTaskId = String(payload?.taskId ?? '');
    if (!draggedTaskId || draggedProjectId !== String(projectId ?? '')) return;

    scheduleProjectCalendarTask(projectId, draggedTaskId, dateKey, { preserveScroll: true });
}

function removeProjectCalendarTaskFromDay(projectId, taskId, dateKey, event) {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    if (!state.canEdit(projectId)) return;

    const project = state.findProject(projectId);
    if (!project || !Array.isArray(project.tasks)) return;

    const safeDateKey = normalizeTaskDueDate(dateKey);
    const safeTaskId = String(taskId ?? '');
    if (!safeTaskId || !isValidDateKey(safeDateKey)) return;

    let changed = false;
    const updatedTasks = project.tasks.map((task, index) => {
        const normalizedTask = normalizeTask(task, index);
        if (String(normalizedTask.id) !== safeTaskId) return normalizedTask;
        if (normalizeTaskDueDate(normalizedTask.dueDate) !== safeDateKey) return normalizedTask;
        changed = true;
        return { ...normalizedTask, dueDate: '' };
    });

    if (!changed) return;

    rememberRecentLocalTaskSnapshot(project, updatedTasks);
    state.updateProject(projectId, projectUpdate({ tasks: updatedTasks }));
    saveData();
    setProjectCalendarSelectedDate(projectId, safeDateKey);
    renderModalTaskList(projectId);
    updateProjectProgress(projectId);
    renderProjectCalendarSection(projectId, { preserveScroll: true });
    render();
    saveOpenProjectModalState(projectId, 'calendar');
}

function createProjectCalendarTask(projectId, dateKey, event) {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    if (!state.canEdit(projectId)) return;

    const safeDateKey = normalizeTaskDueDate(dateKey);
    if (!isValidDateKey(safeDateKey)) return;

    const project = state.findProject(projectId);
    if (!project) return;

    const input = document.getElementById(`project-calendar-create-task-${String(projectId || '')}`);
    const text = String(input?.value || '').trim();
    if (!text) {
        input?.focus?.({ preventScroll: true });
        return;
    }

    const activeCategory = getProjectTaskCategoryFilter(projectId);
    const category = activeCategory === DEFAULT_TASK_CATEGORY_FILTER ? DEFAULT_TASK_CATEGORY : sanitizeTaskCategoryName(activeCategory);
    const newTask = normalizeTask({
        id: Date.now(),
        text,
        completed: false,
        tag: DEFAULT_TASK_TAG,
        category,
        dueDate: safeDateKey
    });
    const nextCategories = getTaskCategoryListWith([...getProjectTaskCategories(project), category]);
    const updatedTasks = sortTasks([newTask, ...(Array.isArray(project.tasks) ? project.tasks : [])]);

    rememberRecentLocalTaskSnapshot(project, updatedTasks);
    state.updateProject(projectId, projectUpdate({ tasks: updatedTasks, taskCategories: nextCategories }));
    saveData();
    setProjectCalendarSelectedDate(projectId, safeDateKey);
    renderModalTaskList(projectId);
    updateProjectProgress(projectId);
    renderProjectCalendarSection(projectId, { preserveScroll: true });
    render();
    saveOpenProjectModalState(projectId, 'calendar');
}

function updateProjectCalendarTaskPriority(projectId, taskId, tagValue, event) {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    if (!state.canEdit(projectId)) return;

    const project = state.findProject(projectId);
    if (!project || !Array.isArray(project.tasks)) return;

    const normalizedTagValue = String(tagValue ?? '').trim().toLowerCase();
    const nextTag = Object.prototype.hasOwnProperty.call(TASK_TAG_PRIORITY, normalizedTagValue) ? normalizedTagValue : DEFAULT_TASK_TAG;
    const safeTaskId = String(taskId ?? '');
    let changed = false;

    const updatedTasks = project.tasks.map((task, index) => {
        const normalizedTask = normalizeTask(task, index);
        if (String(normalizedTask.id) !== safeTaskId) return normalizedTask;
        if (normalizePriorityTagValue(normalizedTask.tag) === nextTag) return normalizedTask;
        changed = true;
        return { ...normalizedTask, tag: nextTag };
    });

    if (!changed) return;

    rememberRecentLocalTaskSnapshot(project, updatedTasks);
    state.updateProject(projectId, projectUpdate({ tasks: updatedTasks }));
    saveData();
    renderModalTaskList(projectId);
    renderProjectCalendarSection(projectId, { preserveScroll: true });
    saveOpenProjectModalState(projectId, 'calendar');
}

function getTodayDateKey() {
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function isTaskOverdue(task) {
    const normalizedTask = normalizeTask(task);
    const dueDate = normalizeTaskDueDate(normalizedTask.dueDate);
    return Boolean(dueDate && !normalizedTask.completed && dueDate < getTodayDateKey());
}

function isProjectDueDateOverdue(project) {
    const dueDate = getProjectDueDate(project);
    return Boolean(dueDate && !isProjectCompleted(project) && dueDate < getTodayDateKey());
}

function projectHasOverdueTasks(project) {
    return (Array.isArray(project?.tasks) ? project.tasks : []).some((task, index) => isTaskOverdue(normalizeTask(task, index)));
}

function renderWarningTriangleIcon(className = '') {
    const safeClass = className ? ` ${className}` : '';
    return `<svg class="warning-triangle-icon${safeClass}" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.2" d="M12 3.25 22 20.5H2L12 3.25z"></path><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.2" d="M12 9v5"></path><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.8" d="M12 17.4h.01"></path></svg>`;
}

function sanitizeTaskCategoryName(value) {
    const raw = String(value ?? '').trim();
    if (!raw) return DEFAULT_TASK_CATEGORY;
    return raw
        .replace(/\s+/g, ' ')
        .slice(0, 32)
        .split(' ')
        .map(part => part ? part.charAt(0).toUpperCase() + part.slice(1) : '')
        .join(' ');
}

function isDefaultTaskCategoryName(value) {
    return String(value ?? '').trim().toLowerCase() === DEFAULT_TASK_CATEGORY.toLowerCase();
}

function getTaskCategoryListWith(valueList = []) {
    return [...new Set((Array.isArray(valueList) ? valueList : [])
        .map(sanitizeTaskCategoryName)
        .filter(category => category && !isDefaultTaskCategoryName(category)))];
}

function parseTaskCompletedValue(value) {
    if (value === true || value === 1) return true;
    if (value === false || value === 0 || value === null || value === undefined) return false;
    if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        if (!normalized) return false;
        if (['true', '1', 'yes', 'y', 'completed', 'complete', 'done'].includes(normalized)) return true;
        if (['false', '0', 'no', 'n', 'active', 'incomplete', 'open', 'pending'].includes(normalized)) return false;
    }
    return Boolean(value);
}

function isTaskCompleted(task = {}) {
    return parseTaskCompletedValue(task?.completed);
}

function normalizeTask(task = {}, index = 0) {
    const numericId = Number(task?.id);
    const fallbackId = Date.now() + index + Math.random();
    const tag = normalizePriorityTagValue(task?.tag || task?.priorityTag || DEFAULT_TASK_TAG);
    const category = sanitizeTaskCategoryName(task?.category || task?.taskCategory || DEFAULT_TASK_CATEGORY);

    return {
        ...task,
        id: Number.isFinite(numericId) ? numericId : fallbackId,
        text: typeof task?.text === 'string' ? decodeHtmlEntities(task.text) : '',
        note: typeof task?.note === 'string' ? decodeHtmlEntities(task.note) : (typeof task?.notes === 'string' ? decodeHtmlEntities(task.notes) : ''),
        completed: parseTaskCompletedValue(task?.completed),
        completedDate: task?.completedDate ? String(task.completedDate) : null,
        completedBy: task?.completedBy ? String(task.completedBy) : '',
        completedByName: task?.completedByName ? decodeHtmlEntities(task.completedByName) : '',
        dueDate: normalizeTaskDueDate(task?.dueDate || task?.due_date || task?.deadline || ''),
        tag,
        category
    };
}

function getTaskTagLabel(task) {
    const normalized = normalizeTask(task);
    return getPriorityTagLabel(normalized.tag);
}

function getTaskTagPriority(task) {
    const normalized = normalizeTask(task);
    return TASK_TAG_PRIORITY[normalized.tag] ?? TASK_TAG_PRIORITY[DEFAULT_TASK_TAG];
}

function getNextTaskPriorityValue(task) {
    return getNextPriorityTagValue(normalizeTask(task).tag);
}

function isTypingTarget(target) {
    if (!target) return false;
    const element = target.closest?.('input, textarea, select, [contenteditable="true"], [contenteditable="plaintext-only"], [role="textbox"]');
    return !!element;
}

function isAnyModalActive() {
    if (typeof document === 'undefined') return false;
    return !!document.querySelector('.modal-overlay.active, .auth-overlay:not(.hidden), .command-palette-overlay.active');
}

function getRichTextShortcutCommand(event) {
    if (!event || !(event.ctrlKey || event.metaKey) || event.altKey) return '';
    const key = String(event.key || '').toLowerCase();
    return { b: 'bold', i: 'italic', u: 'underline' }[key] || '';
}

function handleRichTextShortcutKeydown(event, editorId = '') {
    const command = getRichTextShortcutCommand(event);
    if (!command) return false;

    const target = event.target;
    const editor = editorId
        ? document.getElementById(editorId)
        : target?.closest?.('.rich-text-editor[contenteditable="true"], [contenteditable="true"].rich-text-editor');

    if (!editor || editor.getAttribute('contenteditable') !== 'true') return false;

    event.preventDefault();
    event.stopPropagation();
    applyRichTextCommand(editor.id, command);
    return true;
}

function initializeRichTextInputShortcuts() {
    if (typeof document === 'undefined' || document.__richTextInputShortcutsBound) return;
    document.__richTextInputShortcutsBound = true;
    document.addEventListener('keydown', event => {
        handleRichTextShortcutKeydown(event);
        if (event.target?.closest?.('.rich-text-editor[contenteditable="true"]')) {
            scheduleRichTextToolbarStateSync(event.target.closest('.rich-text-editor[contenteditable="true"]'));
        }
    }, true);

    ['keyup', 'mouseup', 'input', 'focusin'].forEach(eventName => {
        document.addEventListener(eventName, event => {
            const editor = event.target?.closest?.('.rich-text-editor[contenteditable="true"]');
            if (editor) scheduleRichTextToolbarStateSync(editor);
        }, true);
    });

    document.addEventListener('selectionchange', () => {
        scheduleRichTextToolbarStateSync();
    });
}

function getTaskCategoryTabPositionClass(index, total) {
    if (index <= 0) return 'task-category-tab-shell--left';
    if (index >= total - 1) return 'task-category-tab-shell--right';
    return 'task-category-tab-shell--center';
}

function getProjectTaskCategories(project) {
    const explicit = Array.isArray(project?.taskCategories) ? project.taskCategories : [];
    const fromTasks = Array.isArray(project?.tasks) ? project.tasks.map(task => normalizeTask(task).category) : [];
    // General is the internal fallback category for uncategorized tasks. It should
    // not create a visible custom tab by default; only user-created categories
    // should appear next to All.
    return getTaskCategoryListWith([...explicit, ...fromTasks]);
}

function getUniqueTaskCategoryName(project, baseName = 'New Tab') {
    const existing = new Set(getProjectTaskCategories(project).map(category => category.toLowerCase()));
    const base = sanitizeTaskCategoryName(baseName) || 'New Tab';
    if (!existing.has(base.toLowerCase())) return base;

    let index = 2;
    let candidate = `${base} ${index}`;
    while (existing.has(candidate.toLowerCase())) {
        index += 1;
        candidate = `${base} ${index}`;
    }
    return candidate;
}

function getProjectPriorityTag(project = {}) {
    return normalizePriorityTagValue(project?.projectPriorityTag || project?.projectPriority || (typeof project?.priorityTag === 'string' ? project.priorityTag : DEFAULT_TASK_TAG));
}

function getProjectPriorityLabel(project = {}) {
    return getPriorityTagLabel(getProjectPriorityTag(project));
}

function getNextProjectPriorityValue(project = {}) {
    return getNextPriorityTagValue(getProjectPriorityTag(project));
}

function renderPriorityFlagMarkup(tag) {
    return `<span class="task-tag-flag task-tag-flag--${normalizePriorityTagValue(tag)}" aria-hidden="true"></span>`;
}


function normalizeProjectTagName(value) {
    const raw = String(value ?? '').trim();
    if (!raw) return '';
    const normalized = raw
        .replace(/\s+/g, ' ')
        .slice(0, PROJECT_TAG_MAX_LENGTH);
    if (normalized.toLowerCase() === PROJECT_TAG_ALL_FILTER) return '';
    return toTitleCase(normalized);
}

function normalizeProjectTags(valueList = []) {
    return [...new Set((Array.isArray(valueList) ? valueList : [])
        .map(normalizeProjectTagName)
        .filter(Boolean))].slice(0, PROJECT_TAG_MAX_COUNT);
}

function getProjectTags(project) {
    return normalizeProjectTags(project?.tags || project?.projectTags || []);
}

function getAllVisibleProjectTags() {
    return [...new Set(getVisibleBaseProjects()
        .flatMap(project => getProjectTags(project))
        .filter(Boolean))]
        .sort((a, b) => a.localeCompare(b));
}

function projectHasTag(project, tagName) {
    const normalizedTag = normalizeProjectTagName(tagName);
    if (!normalizedTag) return true;
    return getProjectTags(project).includes(normalizedTag);
}

function serializeInlineJsString(value) {
    return JSON.stringify(String(value ?? '')).replace(/"/g, '&quot;');
}

function isTaskPriorityMenuOpen(projectId, taskId) {
    return uiState.openTaskPriorityMenu?.projectId === projectId && uiState.openTaskPriorityMenu?.taskId === taskId;
}

function isProjectPriorityMenuOpen(projectId, surface = 'modal') {
    return uiState.openProjectPriorityMenu?.projectId === projectId && uiState.openProjectPriorityMenu?.surface === surface;
}

function isTaskCategoryMenuOpen(projectId, category) {
    return uiState.openTaskCategoryMenu?.projectId === projectId && uiState.openTaskCategoryMenu?.category === category;
}

function closeOpenTaskMenus({ rerender = true } = {}) {
    const priorityMenu = uiState.openTaskPriorityMenu;
    const projectPriorityMenu = uiState.openProjectPriorityMenu;
    const categoryMenu = uiState.openTaskCategoryMenu;
    uiState.openTaskPriorityMenu = null;
    uiState.openProjectPriorityMenu = null;
    uiState.openTaskCategoryMenu = null;

    if (!rerender) return;

    const rerenderedProjects = new Set();
    if (priorityMenu?.projectId) {
        renderModalTaskList(priorityMenu.projectId);
        rerenderedProjects.add(priorityMenu.projectId);
    }
    if (categoryMenu?.projectId && !rerenderedProjects.has(categoryMenu.projectId)) {
        renderTaskCategoryControls(categoryMenu.projectId);
        rerenderedProjects.add(categoryMenu.projectId);
    }
    if (projectPriorityMenu?.projectId && !rerenderedProjects.has(projectPriorityMenu.projectId)) {
        renderProjectPrioritySurface(projectPriorityMenu.projectId);
    }
}

function handleTaskFloatingMenuDocumentClick(event) {
    if (
        event.target.closest('.task-priority-control') ||
        event.target.closest('.project-priority-control') ||
        event.target.closest('.task-category-menu-button') ||
        event.target.closest('.task-category-tab-wrap') ||
        event.target.closest('.task-category-menu-popover')
    ) return;
    if (!uiState.openTaskPriorityMenu && !uiState.openProjectPriorityMenu && !uiState.openTaskCategoryMenu) return;
    closeOpenTaskMenus();
}

function sortTasks(tasks) {
    // Preserve natural creation/manual order: first task stays first; new tasks append below it.
    return (Array.isArray(tasks) ? tasks : []).map((task, index) => normalizeTask(task, index));
}

function sortTasksForDisplay(tasks, mode = DEFAULT_TASK_SORT_MODE) {
    const baseOrder = (Array.isArray(tasks) ? tasks : []).map((task, index) => normalizeTask(task, index));
    if (mode === 'ascending' || mode === 'descending') {
        return [...baseOrder].sort((a, b) => {
            const textDiff = getTaskPlainText(a.text).localeCompare(getTaskPlainText(b.text), undefined, {
                numeric: true,
                sensitivity: 'base'
            });
            const nextDiff = mode === 'descending' ? -textDiff : textDiff;
            if (nextDiff !== 0) return nextDiff;
            const idDiff = Number(a.id) - Number(b.id);
            return mode === 'descending' ? -idDiff : idDiff;
        });
    }

    if (mode === 'tag-priority') {
        return [...baseOrder].sort((a, b) => {
            const priorityDiff = getTaskTagPriority(a) - getTaskTagPriority(b);
            if (priorityDiff !== 0) return priorityDiff;
            if (isTaskCompleted(a) !== isTaskCompleted(b)) return isTaskCompleted(a) ? 1 : -1;
            return isTaskCompleted(a) ? Number(a.id) - Number(b.id) : Number(b.id) - Number(a.id);
        });
    }

    if (mode === 'due-date') {
        return [...baseOrder].sort((a, b) => {
            if (isTaskCompleted(a) !== isTaskCompleted(b)) return isTaskCompleted(a) ? 1 : -1;
            const aDue = normalizeTaskDueDate(a.dueDate);
            const bDue = normalizeTaskDueDate(b.dueDate);
            if (aDue && bDue && aDue !== bDue) return aDue.localeCompare(bDue);
            if (aDue && !bDue) return -1;
            if (!aDue && bDue) return 1;
            return Number(a.id) - Number(b.id);
        });
    }

    return baseOrder;
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
    'console-dark': { label: 'Console Dark', family: 'console', mode: 'dark' },
    'console-light': { label: 'Console Light', family: 'console', mode: 'light' },
    'blueprint-dark': { label: 'Neumorphism Dark', family: 'blueprint', mode: 'dark' },
    'blueprint-light': { label: 'Neumorphism Light', family: 'blueprint', mode: 'light' }
};

const THEME_FAMILY_OPTIONS = {
    console: { label: 'Console', themePrefix: 'console' },
    blueprint: { label: 'Neumorphism', themePrefix: 'blueprint' }
};

const DEFAULT_ACCENT_COLOR = '#ff8a00';
const LIGHT_MODE_ACCENT_COLOR_OPTIONS = [
    '#2400ff',
    '#8a00ff',
    '#df00ff',
    '#ff00b5',
    '#ff5fd2',
    '#ff004a'
];
const DARK_MODE_ACCENT_COLOR_OPTIONS = [
    '#ff5fd2',
    '#ff00b5',
    '#ff2000',
    '#ff8a00',
    '#fff400',
    '#9fff00',
    '#35ff00',
    '#00ff35',
    '#00ff8a',
    '#0075ff'
];
const ACCENT_COLOR_OPTIONS = [
    ...DARK_MODE_ACCENT_COLOR_OPTIONS,
    ...LIGHT_MODE_ACCENT_COLOR_OPTIONS
];

const LEGACY_THEME_MAP = {
    default: 'console-dark',
    midnight: 'console-dark',
    industrial: 'console-dark',
    'industrial-light': 'console-light',
    'industrial-dark': 'console-dark',
    console: 'console-dark',
    'console-light': 'console-light',
    'console-dark': 'console-dark',
    glass: 'console-dark',
    nebula: 'console-dark',
    'glass-light': 'console-light',
    'glass-dark': 'console-dark',
    'nebula-light': 'console-light',
    'nebula-dark': 'console-dark',
    blueprint: 'blueprint-dark',
    duplex: 'blueprint-dark',
    'blueprint-light': 'blueprint-light',
    'blueprint-dark': 'blueprint-dark',
    'duplex-light': 'blueprint-light',
    'duplex-dark': 'blueprint-dark'
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
    leaderboard: [],
    renderedLeaderboardEntries: [],
    currentLeaderboardRank: null,
    currentLeaderboardEntry: null,
    pendingProfilePic: null
};

const uiState = {
    projectSearch: '',
    ownerFilter: 'all',
    sortMode: 'recent',
    activeProjectTag: PROJECT_TAG_ALL_FILTER,
    savedViews: [],
    activeSavedViewId: '',
    theme: 'blueprint-dark',
    projectCardTaskPreview: true,
    saveStatus: 'idle',
    saveMessage: 'All changes saved',
    commandPaletteOpen: false,
    commandQuery: '',
    commandActiveIndex: 0,
    sidebarSections: {
        workspace: true,
        leaderboard: true,
        settings: true
    },
    openTaskPriorityMenu: null,
    openProjectPriorityMenu: null,
    openTaskCategoryMenu: null,
    newTaskDraft: null,
    creatingTaskCategoryProjectId: null,
    editingTaskCategory: null,
    creatingProjectTagProjectId: null,
    editingProjectTag: null,
    editingProjectNoteTab: null,
    projectCalendarMonths: {},
    projectCalendarSelections: {},
    completedTaskDisplayLimits: {}
};

const LOCAL_STORAGE_KEYS = {
    SAVED_VIEWS: 'tracker_saved_views_v1',
    THEME: 'tracker_ui_theme_v1',
    ACCENT_COLOR: 'tracker_accent_color_v1',
    PROJECT_SORT: 'tracker_project_sort_mode_v1',
    PROJECT_HIDE_COMPLETED: 'tracker_project_hide_completed_v1',
    PROJECT_TASK_SORT: 'tracker_project_task_sort_v1',
    PROJECT_TASK_CATEGORY_FILTER: 'tracker_project_task_category_filter_v1',
    PROJECT_GRID_LAYOUT: 'tracker_project_grid_layout_v1',
    PROJECT_CARD_TASK_PREVIEW: 'tracker_project_card_preview_v1',
    COMPETITIVE_NOTIFICATIONS: 'tracker_competitive_notifications_v1',
    NOTIFICATIONS_READ: 'tracker_notifications_read_v1',
    MODAL_TAB_ORDER: 'tracker_modal_tab_order_v1'
};

const SESSION_STORAGE_KEYS = {
    OPEN_PROJECT_MODAL: 'tracker_open_project_modal_v1'
};

function decodeHtmlEntities(value) {
    let text = String(value ?? '');
    if (!/[&](?:amp|lt|gt|quot|apos|#39|#x27|nbsp);/i.test(text)) return text;

    const decodeOnce = source => {
        if (typeof document !== 'undefined') {
            const textarea = document.createElement('textarea');
            textarea.innerHTML = source;
            return textarea.value;
        }
        return source
            .replace(/&nbsp;/gi, ' ')
            .replace(/&quot;/gi, '"')
            .replace(/&#39;|&#x27;|&apos;/gi, "'")
            .replace(/&lt;/gi, '<')
            .replace(/&gt;/gi, '>')
            .replace(/&amp;/gi, '&');
    };

    for (let i = 0; i < 4; i += 1) {
        const decoded = decodeOnce(text);
        if (decoded === text) break;
        text = decoded;
        if (!/[&](?:amp|lt|gt|quot|apos|#39|#x27|nbsp);/i.test(text)) break;
    }

    return text;
}

function escapeHtml(value) {
    return decodeHtmlEntities(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}


function hasRichTextMarkup(value) {
    return /<\/?(?:strong|b|em|i|u|br|div|p|a)\b/i.test(String(value ?? ''));
}

function plainTextToRichTextHtml(value = '') {
    return escapeHtml(decodeHtmlEntities(value)).replace(/\r\n|\r|\n/g, '<br>');
}

function sanitizeRichTextHtml(value = '') {
    const raw = String(value ?? '');
    if (!raw.trim()) return '';
    if (!hasRichTextMarkup(raw)) return plainTextToRichTextHtml(raw);

    if (typeof document === 'undefined') {
        return raw
            .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '')
            .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
            .replace(/<(?!\/?(?:strong|b|em|i|u|br|div|p)\b)[^>]*>/gi, '');
    }

    const template = document.createElement('template');
    template.innerHTML = raw;

    const sanitizeNode = node => {
        if (node.nodeType === Node.TEXT_NODE) return escapeHtml(node.textContent || '');
        if (node.nodeType !== Node.ELEMENT_NODE) return '';

        const sourceTag = node.tagName.toLowerCase();
        const tag = sourceTag === 'b' ? 'strong' : (sourceTag === 'i' ? 'em' : sourceTag);
        const childHtml = Array.from(node.childNodes).map(sanitizeNode).join('');

        if (tag === 'br') return '<br>';
        if (tag === 'strong' || tag === 'em' || tag === 'u') return `<${tag}>${childHtml}</${tag}>`;
        if (tag === 'div' || tag === 'p') return `<div>${childHtml || '<br>'}</div>`;
        return childHtml;
    };

    return Array.from(template.content.childNodes).map(sanitizeNode).join('').trim();
}

function getRichTextDisplayHtml(value = '') {
    return sanitizeRichTextHtml(value);
}

function getRichTextPlainText(value = '') {
    const raw = String(value ?? '');
    if (!raw) return '';

    if (typeof document === 'undefined') {
        return raw
            .replace(/<br\s*\/?\s*>/gi, ' ')
            .replace(/<\/(?:div|p)>/gi, ' ')
            .replace(/<[^>]+>/g, '')
            .replace(/&nbsp;/g, ' ')
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'")
            .replace(/\s+/g, ' ')
            .trim();
    }

    const container = document.createElement('div');
    container.innerHTML = hasRichTextMarkup(raw) ? sanitizeRichTextHtml(raw) : plainTextToRichTextHtml(raw);
    return (container.innerText || container.textContent || '')
        .replace(/\u00a0/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function getRichTextEditorValue(editorOrId) {
    const editor = typeof editorOrId === 'string' ? document.getElementById(editorOrId) : editorOrId;
    if (!editor) return '';
    const html = sanitizeRichTextHtml(editor.innerHTML || '');
    return getRichTextPlainText(html) ? html : '';
}

function selectRichTextEditorContents(editor) {
    if (!editor || typeof window === 'undefined') return;
    const selection = window.getSelection?.();
    const range = document.createRange?.();
    if (!selection || !range) return;
    range.selectNodeContents(editor);
    selection.removeAllRanges();
    selection.addRange(range);
}

function getRichTextToolbarCommands() {
    return ['bold', 'italic', 'underline'];
}

function getRichTextToolbarButtonLabel(command) {
    return ({ bold: 'Bold', italic: 'Italic', underline: 'Underline' })[command] || 'Format';
}

function getRichTextToolbarButtonInnerMarkup(command) {
    if (command === 'bold') return '<strong>B</strong>';
    if (command === 'italic') return '<em>I</em>';
    if (command === 'underline') return '<span>U</span>';
    return '';
}

function isSelectionInsideRichTextEditor(editor) {
    if (!editor || typeof window === 'undefined') return false;
    const selection = window.getSelection?.();
    if (!selection || selection.rangeCount === 0) {
        const activeElement = document.activeElement;
        return activeElement === editor || !!editor.contains(activeElement);
    }

    const anchor = selection.anchorNode;
    const focus = selection.focusNode;
    const containsNode = node => {
        if (!node) return false;
        const element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
        return element === editor || !!editor.contains(element);
    };

    return containsNode(anchor) || containsNode(focus);
}

function queryRichTextCommandState(command) {
    try {
        return !!document.queryCommandState(command);
    } catch {
        return false;
    }
}

function syncRichTextToolbarState(editorOrId) {
    const editor = typeof editorOrId === 'string' ? document.getElementById(editorOrId) : editorOrId;
    if (!editor || !editor.id) return;

    const isEditorActive = editor.getAttribute('contenteditable') === 'true' && isSelectionInsideRichTextEditor(editor);
    const buttons = document.querySelectorAll(`.rich-text-toolbar-button[data-rich-text-editor="${editor.id}"]`);

    buttons.forEach(button => {
        const command = button.getAttribute('data-rich-text-command');
        const isActive = !!(isEditorActive && command && queryRichTextCommandState(command));
        button.classList.toggle('is-active', isActive);
        button.setAttribute('aria-pressed', String(isActive));
        const label = getRichTextToolbarButtonLabel(command);
        button.setAttribute('aria-label', isActive ? `${label} active` : label);
    });
}

function syncAllRichTextToolbarStates() {
    document.querySelectorAll('.rich-text-editor[contenteditable="true"][id]').forEach(editor => {
        syncRichTextToolbarState(editor);
    });
}

function scheduleRichTextToolbarStateSync(editorOrId = null) {
    if (typeof window === 'undefined') return;
    window.requestAnimationFrame(() => {
        if (editorOrId) syncRichTextToolbarState(editorOrId);
        else syncAllRichTextToolbarStates();
    });
}

function applyRichTextCommand(editorId, command) {
    const editor = document.getElementById(editorId);
    if (!editor || editor.getAttribute('contenteditable') !== 'true') return;
    const safeCommand = { bold: 'bold', italic: 'italic', underline: 'underline' }[command];
    if (!safeCommand) return;
    editor.focus({ preventScroll: true });
    try {
        document.execCommand('styleWithCSS', false, false);
    } catch {
        // Some browsers no-op or reject styleWithCSS. The formatting command still runs below.
    }
    document.execCommand(safeCommand, false, null);
    syncRichTextToolbarState(editor);
    scheduleRichTextToolbarStateSync(editor);
}

function buildRichTextToolbarMarkup(editorId, disabled = false) {
    if (disabled) return '';
    const safeEditorId = String(editorId || '').replace(/[^a-zA-Z0-9_-]/g, '');
    const buttons = getRichTextToolbarCommands().map(command => {
        const label = getRichTextToolbarButtonLabel(command);
        const modifierClass = `rich-text-toolbar-button--${command}`;
        return `<button class="rich-text-toolbar-button ${modifierClass}" type="button" onmousedown="event.preventDefault()" onclick="applyRichTextCommand('${safeEditorId}', '${command}')" aria-label="${label}" aria-pressed="false" title="${label}" data-rich-text-editor="${safeEditorId}" data-rich-text-command="${command}">${getRichTextToolbarButtonInnerMarkup(command)}</button>`;
    }).join('');
    return `
        <div class="rich-text-toolbar" role="toolbar" aria-label="Text formatting tools" data-rich-text-editor="${safeEditorId}">
            ${buttons}
        </div>`;
}

function getTaskPlainText(value = '', fallback = '') {
    const plainText = getRichTextPlainText(value);
    return plainText || String(fallback || '');
}

function getTaskDisplayHtml(value = '', fallback = 'Untitled task') {
    const displayHtml = getRichTextDisplayHtml(value);
    return getRichTextPlainText(displayHtml) ? displayHtml : escapeHtml(fallback);
}

function isRichTextTaskEntryElement(element) {
    return !!element && element.getAttribute?.('contenteditable') === 'true';
}

function getTaskEntryPlainText(element) {
    if (!element) return '';
    return isRichTextTaskEntryElement(element)
        ? getRichTextPlainText(element.innerHTML || '')
        : String(element.value || '');
}

function clearTaskEntryElement(element) {
    if (!element) return;
    if (isRichTextTaskEntryElement(element)) {
        element.innerHTML = '';
    } else {
        element.value = '';
    }
}

function getRichTextTaskLineEntries(value = '') {
    const sanitized = sanitizeRichTextHtml(value);
    if (!getRichTextPlainText(sanitized)) return [];
    const normalized = sanitized
        .replace(/<\/div>\s*<div>/gi, '<br>')
        .replace(/<\/p>\s*<p>/gi, '<br>')
        .replace(/<div><br><\/div>/gi, '<br>')
        .replace(/<p><br><\/p>/gi, '<br>')
        .replace(/<\/?(?:div|p)>/gi, '');

    return normalized
        .split(/<br\s*\/?\s*>/i)
        .map(part => sanitizeRichTextHtml(part).trim())
        .filter(part => getRichTextPlainText(part).length > 0);
}

function getModalPasteTaskEntries(pasteBox) {
    if (!pasteBox) return [];
    if (isRichTextTaskEntryElement(pasteBox)) {
        return getRichTextTaskLineEntries(pasteBox.innerHTML || '').map(html => ({
            text: html,
            plainText: getTaskPlainText(html)
        }));
    }
    return String(pasteBox.value || '')
        .split('\n')
        .map(line => line.trim())
        .filter(Boolean)
        .map(line => ({ text: line, plainText: line }));
}

const DEFAULT_MODAL_TAB_ORDER = ['tasks', 'notes', 'members', 'history', 'calendar'];
const MOVABLE_TAB_LONG_PRESS_MS = 360;

function moveArrayItem(list = [], fromIndex = -1, toIndex = -1) {
    const nextList = Array.isArray(list) ? [...list] : [];
    if (fromIndex < 0 || toIndex < 0 || fromIndex >= nextList.length || toIndex >= nextList.length || fromIndex === toIndex) {
        return nextList;
    }
    const [item] = nextList.splice(fromIndex, 1);
    nextList.splice(toIndex, 0, item);
    return nextList;
}

function normalizeOrderedList(candidateOrder = [], allowedOrder = []) {
    const allowed = Array.isArray(allowedOrder) ? allowedOrder.map(String) : [];
    const seen = new Set();
    const ordered = (Array.isArray(candidateOrder) ? candidateOrder : [])
        .map(String)
        .filter(item => allowed.includes(item) && !seen.has(item) && seen.add(item));
    return [...ordered, ...allowed.filter(item => !seen.has(item))];
}

function safeCssIdentifier(value = '') {
    const raw = String(value ?? '');
    if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(raw);
    return raw.replace(/[^a-zA-Z0-9_-]/g, '\\$&');
}

function getProjectModalTabOrder() {
    try {
        const parsed = JSON.parse(localStorage.getItem(LOCAL_STORAGE_KEYS.MODAL_TAB_ORDER) || '[]');
        return normalizeOrderedList(parsed, DEFAULT_MODAL_TAB_ORDER);
    } catch {
        return [...DEFAULT_MODAL_TAB_ORDER];
    }
}

function saveProjectModalTabOrder(order = DEFAULT_MODAL_TAB_ORDER) {
    try {
        localStorage.setItem(LOCAL_STORAGE_KEYS.MODAL_TAB_ORDER, JSON.stringify(normalizeOrderedList(order, DEFAULT_MODAL_TAB_ORDER)));
    } catch (err) {
        console.warn('Failed to save modal tab order:', err);
    }
}

let __movableTabClickSuppressTimer = null;
let __movableTabReleaseClickCleanup = null;
let __movableTabDragEndX = 0;
let __movableTabDragEndY = 0;
let __movableTabSuppressKey = '';

function getMovableTabOrderKey(item) {
    if (!item) return '';
    return String(
        item.dataset?.movableTabId ||
        item.dataset?.taskCategoryReorder ||
        item.dataset?.projectNoteTabReorder ||
        ''
    );
}

function getMovableTabElementFromEventTarget(target) {
    return target?.closest?.('[data-movable-tab-id], [data-task-category-reorder], [data-project-note-tab-reorder]') || null;
}

function clearMovableTabClickSuppression() {
    document.removeEventListener('click', suppressClickAfterMovableTabDrag, true);
    if (__movableTabReleaseClickCleanup) {
        __movableTabReleaseClickCleanup();
        __movableTabReleaseClickCleanup = null;
    }
    if (__movableTabClickSuppressTimer) {
        clearTimeout(__movableTabClickSuppressTimer);
        __movableTabClickSuppressTimer = null;
    }
    __movableTabSuppressKey = '';
}

function suppressClickAfterMovableTabDrag(event) {
    const targetTab = getMovableTabElementFromEventTarget(event.target);
    const targetKey = getMovableTabOrderKey(targetTab);
    const dx = Math.abs((event.clientX ?? 0) - __movableTabDragEndX);
    const dy = Math.abs((event.clientY ?? 0) - __movableTabDragEndY);

    if (!__movableTabSuppressKey || targetKey !== __movableTabSuppressKey || dx > 14 || dy > 14) {
        clearMovableTabClickSuppression();
        return;
    }

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation?.();
    clearMovableTabClickSuppression();
}

function suppressNextMovableTabClickBriefly(endX = 0, endY = 0, releasedItem = null) {
    const releasedKey = getMovableTabOrderKey(releasedItem);
    clearMovableTabClickSuppression();
    if (!releasedKey || !releasedItem?.addEventListener) return;

    __movableTabDragEndX = endX;
    __movableTabDragEndY = endY;
    __movableTabSuppressKey = releasedKey;

    // Scope suppression to the tab that was just released. This prevents the
    // synthetic release-click from selecting the dragged tab while allowing
    // every other tab to be selected immediately after a reorder.
    const suppressReleasedTabClick = event => {
        suppressClickAfterMovableTabDrag(event);
    };

    releasedItem.addEventListener('click', suppressReleasedTabClick, { capture: true, once: true });
    __movableTabReleaseClickCleanup = () => {
        releasedItem.removeEventListener('click', suppressReleasedTabClick, true);
    };
    __movableTabClickSuppressTimer = window.setTimeout(clearMovableTabClickSuppression, 160);
}

function setupLongPressMovableTabs(container, itemSelector, getOrderValue, onCommitOrder) {
    if (!container || !itemSelector || typeof onCommitOrder !== 'function') return;
    if (typeof container.__movableTabCleanup === 'function') {
        container.__movableTabCleanup();
    }

    let pressTimer = null;
    let pointerStartX = 0;
    let pointerStartY = 0;
    let latestPointerX = 0;
    let latestPointerY = 0;
    let activePointerId = null;
    let draggingItem = null;
    let dragPlaceholder = null;
    let dragGhost = null;
    let dragOffsetX = 0;
    let dragOffsetY = 0;
    let initialOrder = [];
    let isDragging = false;
    let tabAnimationFrame = null;

    function getPoint(event) {
        return {
            x: event.clientX ?? 0,
            y: event.clientY ?? 0
        };
    }

    function getItems() {
        return Array.from(container.querySelectorAll(itemSelector));
    }

    function getOrder() {
        return getItems().map(item => String(getOrderValue(item) || '')).filter(Boolean);
    }

    function animateMovableTabLayout(mutator) {
        const itemsBefore = getItems();
        const firstRects = new Map(itemsBefore.map(item => [item, item.getBoundingClientRect()]));
        mutator();

        const itemsAfter = getItems();
        if (tabAnimationFrame) cancelAnimationFrame(tabAnimationFrame);
        itemsAfter.forEach(item => {
            if (!item || item === draggingItem) return;
            const firstRect = firstRects.get(item);
            if (!firstRect) return;
            const lastRect = item.getBoundingClientRect();
            const deltaX = firstRect.left - lastRect.left;
            const deltaY = firstRect.top - lastRect.top;
            if (Math.abs(deltaX) < 0.5 && Math.abs(deltaY) < 0.5) return;

            if (item.__tabReorderTimer) {
                clearTimeout(item.__tabReorderTimer);
                item.__tabReorderTimer = null;
            }
            item.classList.add('is-tab-settling');
            item.style.setProperty('transition', 'none', 'important');
            item.style.setProperty('transform', `translate3d(${deltaX}px, ${deltaY}px, 0)`, 'important');
        });

        tabAnimationFrame = requestAnimationFrame(() => {
            itemsAfter.forEach(item => {
                if (!item || item === draggingItem) return;
                if (!item.classList.contains('is-tab-settling')) return;
                item.style.setProperty('transition', 'transform 180ms cubic-bezier(0.22, 1, 0.36, 1)', 'important');
                item.style.removeProperty('transform');
                item.__tabReorderTimer = window.setTimeout(() => {
                    item.classList.remove('is-tab-settling');
                    item.style.removeProperty('transition');
                    item.style.removeProperty('transform');
                    item.__tabReorderTimer = null;
                }, 205);
            });
            tabAnimationFrame = null;
        });
    }

    function clearTimer() {
        if (!pressTimer) return;
        clearTimeout(pressTimer);
        pressTimer = null;
    }

    function clearDraggingItemStyles(item) {
        if (!item) return;
        ['position', 'left', 'top', 'width', 'height', 'margin', 'display', 'visibility', 'opacity', 'transform', 'z-index', 'pointer-events', 'transition', 'will-change'].forEach(prop => {
            item.style.removeProperty(prop);
        });
    }

    function removePlaceholder() {
        if (dragPlaceholder?.parentNode) {
            dragPlaceholder.remove();
        }
        dragPlaceholder = null;
    }

    function returnDraggingItemToFlow() {
        if (!draggingItem) return;
        clearDraggingItemStyles(draggingItem);
        if (dragPlaceholder?.parentNode) {
            dragPlaceholder.replaceWith(draggingItem);
            dragPlaceholder = null;
        } else if (!container.contains(draggingItem)) {
            container.appendChild(draggingItem);
        }
        removeDragGhost();
    }

    function updateFloatingTabPosition(x = latestPointerX, y = latestPointerY) {
        if (!dragGhost || !isDragging) return;
        dragGhost.style.setProperty('transform', `translate3d(${x - dragOffsetX}px, ${y - dragOffsetY}px, 0)`, 'important');
    }

    function removeDragGhost() {
        if (dragGhost?.parentNode) {
            dragGhost.remove();
        }
        dragGhost = null;
    }

    function createPlaceholderForDraggingItem() {
        if (!draggingItem || dragPlaceholder || dragGhost) return;
        const rect = draggingItem.getBoundingClientRect();
        const computed = window.getComputedStyle(draggingItem);
        dragOffsetX = Math.max(0, Math.min(rect.width, latestPointerX - rect.left));
        dragOffsetY = Math.max(0, Math.min(rect.height, latestPointerY - rect.top));

        dragPlaceholder = document.createElement('span');
        dragPlaceholder.className = 'movable-tab-placeholder';
        dragPlaceholder.setAttribute('aria-hidden', 'true');
        dragPlaceholder.style.setProperty('width', `${rect.width}px`, 'important');
        dragPlaceholder.style.setProperty('height', `${rect.height}px`, 'important');
        dragPlaceholder.style.setProperty('min-width', `${rect.width}px`, 'important');
        dragPlaceholder.style.setProperty('flex', `0 0 ${rect.width}px`, 'important');
        dragPlaceholder.style.setProperty('border-radius', computed.borderRadius || '999px');
        draggingItem.before(dragPlaceholder);

        dragGhost = draggingItem.cloneNode(true);
        dragGhost.removeAttribute('id');
        dragGhost.querySelectorAll?.('[id]').forEach(node => node.removeAttribute('id'));
        dragGhost.setAttribute('aria-hidden', 'true');
        dragGhost.classList.add('is-tab-dragging');
        dragGhost.style.setProperty('position', 'fixed', 'important');
        dragGhost.style.setProperty('left', '0', 'important');
        dragGhost.style.setProperty('top', '0', 'important');
        dragGhost.style.setProperty('width', `${rect.width}px`, 'important');
        dragGhost.style.setProperty('height', `${rect.height}px`, 'important');
        dragGhost.style.setProperty('margin', '0', 'important');
        dragGhost.style.setProperty('z-index', '2147483646', 'important');
        dragGhost.style.setProperty('pointer-events', 'none', 'important');
        dragGhost.style.setProperty('transition', 'none', 'important');
        dragGhost.style.setProperty('will-change', 'transform', 'important');
        document.body.appendChild(dragGhost);

        draggingItem.style.setProperty('display', 'none', 'important');
        updateFloatingTabPosition();
    }

    function reset({ restoreFlow = true } = {}) {
        clearTimer();
        if (restoreFlow) {
            returnDraggingItemToFlow();
        } else {
            removePlaceholder();
        }
        if (draggingItem) {
            draggingItem.classList.remove('is-tab-dragging');
            clearDraggingItemStyles(draggingItem);
            try {
                if (activePointerId !== null && draggingItem.hasPointerCapture?.(activePointerId)) {
                    draggingItem.releasePointerCapture(activePointerId);
                }
            } catch { /* noop */ }
        }
        removeDragGhost();
        container.classList.remove('is-tab-reordering');
        document.body.classList.remove('is-tab-reordering');
        document.querySelectorAll('.modal-menu-bar.is-tab-reordering, .task-category-tabs.is-tab-reordering, .project-notes-tabs.is-tab-reordering').forEach(tabContainer => {
            tabContainer.classList.remove('is-tab-reordering');
        });
        document.body.style.userSelect = '';
        if (tabAnimationFrame) {
            cancelAnimationFrame(tabAnimationFrame);
            tabAnimationFrame = null;
        }
        getItems().forEach(item => {
            if (item.__tabReorderTimer) {
                clearTimeout(item.__tabReorderTimer);
                item.__tabReorderTimer = null;
            }
            item.classList.remove('is-tab-settling');
            if (item !== draggingItem) {
                item.style.removeProperty('transition');
                item.style.removeProperty('transform');
            }
        });
        removePlaceholder();
        draggingItem = null;
        activePointerId = null;
        initialOrder = [];
        isDragging = false;
        dragOffsetX = 0;
        dragOffsetY = 0;
        document.removeEventListener('pointermove', onPointerMove);
        document.removeEventListener('pointerup', onPointerEnd);
        document.removeEventListener('pointercancel', onPointerEnd);
    }

    function shouldIgnoreTarget(target) {
        return !!target.closest?.('input, textarea, select, a, [contenteditable="true"], [role="textbox"], .task-category-menu-button, .task-category-menu-popover, .project-notes-add-tab, .project-notes-delete-tab, .modal-close, .project-card-menu-button, .project-actions-menu, .rich-text-toolbar-button');
    }

    function getDropTargetAtPoint(x, y) {
        const hits = typeof document.elementsFromPoint === 'function'
            ? document.elementsFromPoint(x, y)
            : [document.elementFromPoint(x, y)].filter(Boolean);
        for (const hit of hits) {
            const target = hit?.closest?.(itemSelector);
            if (!target || target === draggingItem || !container.contains(target)) continue;
            return target;
        }
        return null;
    }

    function beginDrag() {
        if (!draggingItem || isDragging) return;
        clearTimer();
        isDragging = true;
        container.classList.add('is-tab-reordering');
        document.body.classList.add('is-tab-reordering');
        document.body.style.userSelect = 'none';
        createPlaceholderForDraggingItem();
    }

    function onPointerDown(event) {
        if (event.button !== undefined && event.button !== 0) return;
        const item = event.target.closest?.(itemSelector);
        if (!item || !container.contains(item) || shouldIgnoreTarget(event.target)) return;

        const point = getPoint(event);
        draggingItem = item;
        initialOrder = getOrder();
        pointerStartX = point.x;
        pointerStartY = point.y;
        latestPointerX = point.x;
        latestPointerY = point.y;
        activePointerId = event.pointerId ?? null;
        clearTimer();
        pressTimer = setTimeout(beginDrag, MOVABLE_TAB_LONG_PRESS_MS);
        document.addEventListener('pointermove', onPointerMove, { passive: false });
        document.addEventListener('pointerup', onPointerEnd);
        document.addEventListener('pointercancel', onPointerEnd);
    }

    function onPointerMove(event) {
        if (!draggingItem) return;
        const point = getPoint(event);
        latestPointerX = point.x;
        latestPointerY = point.y;
        const distance = Math.hypot(point.x - pointerStartX, point.y - pointerStartY);

        if (!isDragging && distance > 22) {
            reset();
            return;
        }
        if (!isDragging) return;

        event.preventDefault();
        updateFloatingTabPosition(point.x, point.y);
        const target = getDropTargetAtPoint(point.x, point.y);
        if (!target || !dragPlaceholder) return;

        const rect = target.getBoundingClientRect();
        const insertAfter = rect.width >= rect.height
            ? point.x > rect.left + rect.width / 2
            : point.y > rect.top + rect.height / 2;
        if (insertAfter) {
            if (target.nextElementSibling === dragPlaceholder) return;
            animateMovableTabLayout(() => target.after(dragPlaceholder));
        } else {
            if (target.previousElementSibling === dragPlaceholder) return;
            animateMovableTabLayout(() => target.before(dragPlaceholder));
        }
    }

    function onPointerEnd(event) {
        if (!draggingItem) return;
        const wasDragging = isDragging;
        const releasedItem = draggingItem;
        let nextOrder = initialOrder;
        if (wasDragging) {
            event.preventDefault?.();
            event.stopPropagation?.();
            returnDraggingItemToFlow();
            nextOrder = getOrder();
        }
        reset({ restoreFlow: false });

        if (!wasDragging) return;
        suppressNextMovableTabClickBriefly(latestPointerX, latestPointerY, releasedItem);
        if (initialOrder.join('|') !== nextOrder.join('|')) {
            onCommitOrder(nextOrder, event);
        }
    }

    container.addEventListener('pointerdown', onPointerDown);
    container.__movableTabCleanup = () => {
        container.removeEventListener('pointerdown', onPointerDown);
        reset();
    };
}

function setupProjectModalTabReorder(projectId) {
    const menu = document.querySelector('#projectModal .modal-menu-bar');
    if (!menu) return;
    setupLongPressMovableTabs(
        menu,
        '.modal-tab[data-movable-tab-id]',
        item => item.dataset.movableTabId,
        nextOrder => saveProjectModalTabOrder(nextOrder)
    );
}

function setupTaskCategoryTabReorder(projectId) {
    const container = document.querySelector(`#task-category-controls-${safeCssIdentifier(projectId)} .task-category-tabs`);
    if (!container || !state.canEdit(projectId)) return;
    setupLongPressMovableTabs(
        container,
        '.task-category-tab-wrap[data-task-category-reorder]',
        item => item.dataset.taskCategoryReorder,
        nextOrder => reorderTaskCategories(projectId, nextOrder)
    );
}

function captureActiveProjectNoteEdits(projectId, surface = 'modal', data = null) {
    const notesData = data || getProjectNotesDataForProject(projectId);
    const activeTab = notesData.tabs.find(item => item.id === notesData.activeTabId) || notesData.tabs[0];
    if (!activeTab) return notesData;

    const titleInput = document.getElementById(`project-notes-title-${surface}`);
    const bodyEditor = document.getElementById(`project-notes-body-${surface}`);
    const tab = notesData.tabs.find(item => item.id === activeTab.id);
    if (!tab) return notesData;

    if (titleInput) tab.title = String(titleInput.value || tab.title || 'Note').trim().replace(/\s+/g, ' ').slice(0, 40) || 'Note';
    if (bodyEditor) tab.body = getRichTextEditorValue(bodyEditor);
    tab.links = normalizeProjectNoteLinks([
        ...normalizeProjectNoteLinks(tab.links || []),
        ...collectProjectNoteLinksFromSurface(activeTab.id, surface)
    ]);
    return notesData;
}

function setupProjectNotesTabReorder(projectId, surface = 'modal') {
    const safeSurface = String(surface || 'modal');
    const editor = document.querySelector(`[data-project-notes-editor="${safeCssIdentifier(safeSurface)}"][data-project-id="${safeCssIdentifier(projectId)}"]`);
    const container = editor?.querySelector?.('.project-notes-tabs');
    if (!container || !state.canEdit(projectId)) return;
    setupLongPressMovableTabs(
        container,
        '.project-notes-tab[data-project-note-tab-reorder]',
        item => item.dataset.projectNoteTabReorder,
        nextOrder => reorderProjectNoteTabs(projectId, safeSurface, nextOrder)
    );
}


function loadProjectHideCompletedPreferences() {
    try {
        const raw = localStorage.getItem(LOCAL_STORAGE_KEYS.PROJECT_HIDE_COMPLETED);
        if (!raw) return {};
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (err) {
        console.warn('Failed to load project hide-completed preferences:', err);
        return {};
    }
}

function saveProjectHideCompletedPreferences(preferences) {
    try {
        localStorage.setItem(LOCAL_STORAGE_KEYS.PROJECT_HIDE_COMPLETED, JSON.stringify(preferences || {}));
    } catch (err) {
        console.warn('Failed to save project hide-completed preferences:', err);
    }
}

function getProjectHideCompletedPreference(projectId) {
    const preferences = loadProjectHideCompletedPreferences();
    const key = String(projectId || '');
    if (!key) return true;
    if (Object.prototype.hasOwnProperty.call(preferences, key)) {
        return preferences[key] !== false;
    }
    return true;
}

function setProjectHideCompletedPreference(projectId, hideCompleted) {
    const key = String(projectId || '');
    if (!key) return;
    const preferences = loadProjectHideCompletedPreferences();
    preferences[key] = !!hideCompleted;
    saveProjectHideCompletedPreferences(preferences);
}



function getProjectCompletedTaskLimitPreference(projectId) {
    const key = String(projectId || '');
    if (!key) return COMPLETED_TASK_BATCH_DEFAULT;
    const value = uiState.completedTaskDisplayLimits?.[key];
    if (value === 'all') return 'all';
    const numericValue = Number(value);
    return Number.isFinite(numericValue) && numericValue > 0
        ? Math.max(COMPLETED_TASK_BATCH_DEFAULT, Math.floor(numericValue))
        : COMPLETED_TASK_BATCH_DEFAULT;
}

function setProjectCompletedTaskLimitPreference(projectId, limit) {
    const key = String(projectId || '');
    if (!key) return;
    if (!uiState.completedTaskDisplayLimits) uiState.completedTaskDisplayLimits = {};
    if (limit === 'all') {
        uiState.completedTaskDisplayLimits[key] = 'all';
        return;
    }
    const numericLimit = Number(limit);
    uiState.completedTaskDisplayLimits[key] = Number.isFinite(numericLimit) && numericLimit > 0
        ? Math.max(COMPLETED_TASK_BATCH_DEFAULT, Math.floor(numericLimit))
        : COMPLETED_TASK_BATCH_DEFAULT;
}

function resetProjectCompletedTaskLimitPreference(projectId) {
    const key = String(projectId || '');
    if (!key || !uiState.completedTaskDisplayLimits) return;
    delete uiState.completedTaskDisplayLimits[key];
}

function getCompletedTaskDisplayState(project, options = {}) {
    const tasks = Array.isArray(project?.tasks) ? project.tasks : [];
    const sortMode = options.sortMode || getProjectTaskSortPreference(project?.id);
    const activeCategory = options.activeCategory !== undefined
        ? options.activeCategory
        : getProjectTaskCategoryFilter(project?.id);
    const completedLimit = options.completedLimit !== undefined
        ? options.completedLimit
        : getProjectCompletedTaskLimitPreference(project?.id);
    const orderedTasks = sortTasksForDisplay(tasks, sortMode);
    const categoryFilteredTasks = activeCategory && activeCategory !== DEFAULT_TASK_CATEGORY_FILTER
        ? orderedTasks.filter(task => normalizeTask(task).category === activeCategory)
        : orderedTasks;
    const completedTasks = categoryFilteredTasks.filter(task => isTaskCompleted(task));
    const completedVisibleLimit = completedLimit === 'all'
        ? completedTasks.length
        : Math.max(COMPLETED_TASK_BATCH_DEFAULT, Number(completedLimit) || COMPLETED_TASK_BATCH_DEFAULT);
    const visibleCompletedIds = new Set(completedTasks
        .slice(0, completedVisibleLimit)
        .map(task => String(task.id)));
    const visibleTasks = categoryFilteredTasks.filter(task => !isTaskCompleted(task) || visibleCompletedIds.has(String(task.id)));

    return {
        visibleTasks,
        totalCompleted: completedTasks.length,
        visibleCompleted: completedLimit === 'all'
            ? completedTasks.length
            : Math.min(completedVisibleLimit, completedTasks.length),
        hiddenCompleted: completedLimit === 'all'
            ? 0
            : Math.max(0, completedTasks.length - completedVisibleLimit),
        completedLimit
    };
}


function loadProjectTaskSortPreferences() {
    try {
        const raw = localStorage.getItem(LOCAL_STORAGE_KEYS.PROJECT_TASK_SORT);
        if (!raw) return {};
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (err) {
        console.warn('Failed to load project task sort preferences:', err);
        return {};
    }
}

function saveProjectTaskSortPreferences(preferences) {
    try {
        localStorage.setItem(LOCAL_STORAGE_KEYS.PROJECT_TASK_SORT, JSON.stringify(preferences || {}));
    } catch (err) {
        console.warn('Failed to save project task sort preferences:', err);
    }
}

function getProjectTaskSortPreference(projectId) {
    const preferences = loadProjectTaskSortPreferences();
    const key = String(projectId || '');
    if (!key) return DEFAULT_TASK_SORT_MODE;
    const value = preferences[key];
    return ['tag-priority', 'due-date', 'ascending', 'descending'].includes(value) ? value : DEFAULT_TASK_SORT_MODE;
}

function setProjectTaskSortPreference(projectId, sortMode) {
    const key = String(projectId || '');
    if (!key) return;
    const preferences = loadProjectTaskSortPreferences();
    preferences[key] = ['tag-priority', 'due-date', 'ascending', 'descending'].includes(sortMode) ? sortMode : DEFAULT_TASK_SORT_MODE;
    saveProjectTaskSortPreferences(preferences);
}


function loadProjectTaskCategoryFilterPreferences() {
    try {
        const raw = localStorage.getItem(LOCAL_STORAGE_KEYS.PROJECT_TASK_CATEGORY_FILTER);
        if (!raw) return {};
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (err) {
        console.warn('Failed to load project task category filter preferences:', err);
        return {};
    }
}

function saveProjectTaskCategoryFilterPreferences(preferences) {
    try {
        localStorage.setItem(LOCAL_STORAGE_KEYS.PROJECT_TASK_CATEGORY_FILTER, JSON.stringify(preferences || {}));
    } catch (err) {
        console.warn('Failed to save project task category filter preferences:', err);
    }
}

function getProjectTaskCategoryFilter(projectId) {
    const key = String(projectId || '');
    if (!key) return DEFAULT_TASK_CATEGORY_FILTER;
    const preferences = loadProjectTaskCategoryFilterPreferences();
    const value = preferences[key];
    return typeof value === 'string' && value.trim() ? value : DEFAULT_TASK_CATEGORY_FILTER;
}

function setStoredProjectTaskCategoryFilter(projectId, categoryValue) {
    const key = String(projectId || '');
    if (!key) return;
    const preferences = loadProjectTaskCategoryFilterPreferences();
    preferences[key] = categoryValue || DEFAULT_TASK_CATEGORY_FILTER;
    saveProjectTaskCategoryFilterPreferences(preferences);
}

function normalizeDisplayName(value, fallback = 'User') {
    const rawName = String(value || fallback || 'User').trim();
    if (!rawName) return fallback || 'User';
    return rawName.includes('@') ? rawName.split('@')[0] : rawName;
}

function getCurrentAvatarDisplayName() {
    return normalizeDisplayName(accountState.user?.username || getCurrentUser?.()?.username || 'User');
}

function getLeaderboardUsername(entry) {
    return normalizeDisplayName(entry?.username || entry?.name || entry?.displayName || 'User');
}

function getLeaderboardDisplayName(entry, isCurrent = false) {
    return isCurrent ? getCurrentAvatarDisplayName() : getLeaderboardUsername(entry);
}

function toLeaderboardNumber(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}

function getLeaderboardScoreValue(entry) {
    const score = toLeaderboardNumber(entry?.weeklyCompletedTasks ?? entry?.leaderboardScore ?? entry?.score, NaN);
    if (Number.isFinite(score)) return Math.max(0, Math.round(score));
    return 0;
}

function getLeaderboardCompletionValue(entry) {
    return Math.max(0, Math.round(toLeaderboardNumber(entry?.totalCompletionPercentage, 0)));
}

function calculateLocalLeaderboardScore(row) {
    return Math.max(0, Math.round(Number(row?.weeklyCompletedTasks || 0) || 0));
}

function countLocalCompletedRecords(records = [], rangeStart, rangeEnd) {
    return records.filter(record => isTimestampWithinRange(Number(record.timestamp || 0), rangeStart, rangeEnd)).length;
}

function buildLocalCurrentLeaderboardEntry(currentUserId) {
    const userId = String(currentUserId || '');
    if (!userId || !state?.getProjects) return null;

    const row = {
        userId,
        username: accountState.user?.username || 'User',
        profilePic: accountState.user?.profilePic || '',
        totalProjects: 0,
        activeProjects: 0,
        completedProjects: 0,
        completedTasks: 0,
        remainingTasks: 0,
        totalTasks: 0,
        sharedProjects: 0,
        sharedTasks: 0,
        sharedCompletedTasks: 0,
        sharedRemainingTasks: 0,
        activeProgressRaw: 0,
        dailyCompletedTasks: 0,
        weeklyCompletedTasks: 0,
        monthlyCompletedTasks: 0,
        dailyCompletedProjects: 0,
        weeklyCompletedProjects: 0,
        monthlyCompletedProjects: 0,
        playerLevel: getCurrentPersonalLevelProgress().level,
        competitiveAchievements: [],
        totalCompletionPercentage: 0,
        projectCompletionPercentage: 0,
        activeProjectCompletionPercentage: 0,
        sharedCompletionPercentage: 0,
        leaderboardScore: 0
    };

    const now = new Date();
    const dayStart = getStartOfLocalDay(now);
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);
    const weekStart = getStartOfLocalWeek(now);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 7);
    const monthStart = getStartOfLocalMonth(now);
    const monthEnd = new Date(monthStart);
    monthEnd.setMonth(monthEnd.getMonth() + 1);

    state.getProjects().forEach(project => {
        if (isProjectArchived(project)) return;
        const tasks = Array.isArray(project.tasks) ? project.tasks.map((task, index) => normalizeTask(task, index)) : [];
        const completedProject = isProjectCompleted(project);
        const completedTaskCount = tasks.filter(task => isTaskCompleted(task)).length;
        const creditedCompletedTasks = tasks.filter(task => isTaskCompleted(task) && (!task.completedBy || task.completedBy === userId));
        const completedRecords = creditedCompletedTasks.map(task => ({ timestamp: getCompletionTimestamp(task.completedDate) }));
        row.dailyCompletedTasks += countLocalCompletedRecords(completedRecords, dayStart, dayEnd);
        row.weeklyCompletedTasks += countLocalCompletedRecords(completedRecords, weekStart, weekEnd);
        row.monthlyCompletedTasks += countLocalCompletedRecords(completedRecords, monthStart, monthEnd);
        const projectCompletedTimestamp = getCompletionTimestamp(project.completedDate);
        const projectCreditedToUser = completedProject && (!project.completedBy || project.completedBy === userId);
        if (projectCreditedToUser && isTimestampWithinRange(projectCompletedTimestamp, dayStart, dayEnd)) row.dailyCompletedProjects += 1;
        if (projectCreditedToUser && isTimestampWithinRange(projectCompletedTimestamp, weekStart, weekEnd)) row.weeklyCompletedProjects += 1;
        if (projectCreditedToUser && isTimestampWithinRange(projectCompletedTimestamp, monthStart, monthEnd)) row.monthlyCompletedProjects += 1;
        const remainingTaskCount = Math.max(0, tasks.length - completedTaskCount);
        const taskCompletionRate = tasks.length > 0 ? completedTaskCount / tasks.length : 0;
        const isSharedProject = project.userRole !== 'owner' || (Array.isArray(project.collaborators) && project.collaborators.length > 0);

        row.totalProjects += 1;
        row.totalTasks += tasks.length;
        row.completedTasks += completedTaskCount;
        row.remainingTasks += remainingTaskCount;

        if (completedProject) {
            row.completedProjects += 1;
        } else {
            row.activeProjects += 1;
            row.activeProgressRaw += taskCompletionRate;
        }

        if (isSharedProject) {
            row.sharedProjects += 1;
            row.sharedTasks += tasks.length;
            row.sharedCompletedTasks += completedTaskCount;
            row.sharedRemainingTasks += remainingTaskCount;
        }
    });

    row.totalCompletionPercentage = row.totalTasks > 0 ? Math.round((row.completedTasks / row.totalTasks) * 100) : 0;
    row.projectCompletionPercentage = row.totalProjects > 0 ? Math.round((row.completedProjects / row.totalProjects) * 100) : 0;
    row.activeProjectCompletionPercentage = row.activeProjects > 0 ? Math.round((row.activeProgressRaw / row.activeProjects) * 100) : 0;
    row.sharedCompletionPercentage = row.sharedTasks > 0 ? Math.round((row.sharedCompletedTasks / row.sharedTasks) * 100) : 0;
    row.leaderboardScore = calculateLocalLeaderboardScore(row);
    return row;
}

function normalizeThemeName(themeName) {
    const normalized = String(themeName || '').trim();
    if (THEME_OPTIONS[normalized]) return normalized;
    return LEGACY_THEME_MAP[normalized] || 'blueprint-dark';
}

function getCurrentColorMode() {
    try {
        return getThemeMeta(uiState.theme).mode === 'light' ? 'light' : 'dark';
    } catch {
        return 'dark';
    }
}

function getAccentColorOptionsForMode(colorMode = getCurrentColorMode()) {
    return colorMode === 'light' ? LIGHT_MODE_ACCENT_COLOR_OPTIONS : DARK_MODE_ACCENT_COLOR_OPTIONS;
}

function getDefaultAccentColorForMode(colorMode = getCurrentColorMode()) {
    return colorMode === 'light' ? LIGHT_MODE_ACCENT_COLOR_OPTIONS[0] : DEFAULT_ACCENT_COLOR;
}

function normalizeAccentColor(color, colorMode = getCurrentColorMode()) {
    const normalized = String(color || '').trim().toLowerCase();
    const options = getAccentColorOptionsForMode(colorMode);
    return options.includes(normalized) ? normalized : getDefaultAccentColorForMode(colorMode);
}

function hexToRgb(hex) {
    const normalized = normalizeAccentColor(hex).replace('#', '');
    const numeric = Number.parseInt(normalized, 16);
    return {
        r: (numeric >> 16) & 255,
        g: (numeric >> 8) & 255,
        b: numeric & 255
    };
}

function applyAccentColor(color, persist = true) {
    const accent = normalizeAccentColor(color);
    const { r, g, b } = hexToRgb(accent);
    const accentGlow = `rgba(${r}, ${g}, ${b}, 0.14)`;
    const accentGlowStrong = `rgba(${r}, ${g}, ${b}, 0.24)`;
    const accentVariables = {
        '--accent': accent,
        '--accent-color': accent,
        '--accent-rgb': `${r}, ${g}, ${b}`,
        '--accent-glow': accentGlow,
        '--accent-glow-strong': accentGlowStrong,
        '--accent-2': accent,
        '--accent-3': accent,
        '--accent-ring': `rgba(${r}, ${g}, ${b}, 0.38)`,
        '--selection-bg': `rgba(${r}, ${g}, ${b}, 0.28)`,
        '--progress': accent,
        '--focus-ring': `0 0 0 3px rgba(${r}, ${g}, ${b}, 0.24)`,
        '--primary': accent,
        '--primary-color': accent,
        '--primary-light': accent,
        '--primary-dark': accent,
        '--primary-rgb': `${r}, ${g}, ${b}`,
        '--primary-glow': accentGlow,
        '--brand-accent': accent,
        '--focus-color': accent
    };
    [document.documentElement, document.body].forEach(target => {
        if (!target?.style) return;
        Object.entries(accentVariables).forEach(([property, value]) => {
            target.style.setProperty(property, value);
        });
    });
    if (persist) {
        try {
            localStorage.setItem(LOCAL_STORAGE_KEYS.ACCENT_COLOR, accent);
        } catch (err) {
            console.warn('Failed to save accent color preference:', err);
        }
    }
    renderAccentColorOptions();
}

function ensureAccentColorAllowedForCurrentMode(persist = true) {
    let storedColor = getDefaultAccentColorForMode();
    try {
        storedColor = localStorage.getItem(LOCAL_STORAGE_KEYS.ACCENT_COLOR) || getDefaultAccentColorForMode();
    } catch (err) {
        console.warn('Failed to load accent color preference:', err);
    }
    applyAccentColor(storedColor, persist);
}

function loadAccentColorPreference() {
    ensureAccentColorAllowedForCurrentMode(false);
}

function getThemeMeta(themeName) {
    return THEME_OPTIONS[normalizeThemeName(themeName)];
}

function getThemeLabel(themeName) {
    return getThemeMeta(themeName).label;
}

function buildThemeName(themeFamily, colorMode) {
    const mode = colorMode === 'light' ? 'light' : 'dark';
    const family = THEME_FAMILY_OPTIONS[themeFamily] ? themeFamily : 'console';
    const prefix = THEME_FAMILY_OPTIONS[family].themePrefix || 'console';
    const themeName = `${prefix}-${mode}`;
    return THEME_OPTIONS[themeName] ? themeName : `console-${mode}`;
}

function getColorModeLabel(colorMode) {
    return colorMode === 'dark' ? 'Dark Mode' : 'Light Mode';
}

function getThemeFamilyLabel(themeFamily) {
    return THEME_FAMILY_OPTIONS[themeFamily]?.label || 'Console';
}


function moveColorModeToggleToSidebarHeader() {
    const toggle = document.getElementById('colorModeToggleBtn');
    const header = document.querySelector('.control-panel .control-panel-header');
    const panelMain = header?.querySelector('.panel-header-main');
    if (!toggle || !header || !panelMain) return;

    let wrapper = header.querySelector('.sidebar-header-theme-toggle');
    if (!wrapper) {
        wrapper = document.createElement('div');
        wrapper.className = 'sidebar-header-theme-toggle';
        header.appendChild(wrapper);
    }

    if (toggle.parentElement !== wrapper) {
        wrapper.appendChild(toggle);
    }

    let label = wrapper.querySelector('.sidebar-theme-toggle-label');
    if (!label) {
        label = document.createElement('span');
        label.className = 'sidebar-theme-toggle-label';
        wrapper.appendChild(label);
    }

    const oldRow = document.querySelector('.ui-options-mode-toggle-row');
    if (oldRow && oldRow !== wrapper) {
        oldRow.classList.add('ui-options-mode-toggle-row--relocated');
    }
}

function syncColorModeToggle() {
    const meta = getThemeMeta(uiState.theme);
    const isDark = meta.mode === 'dark';
    const nextModeLabel = isDark ? 'light' : 'dark';
    document.querySelectorAll('#colorModeToggleBtn, #uiColorModeToggleBtn').forEach(toggle => {
        toggle.classList.toggle('is-dark', isDark);
        toggle.hidden = false;
        toggle.setAttribute('aria-hidden', 'false');
        toggle.setAttribute('aria-pressed', String(isDark));
        toggle.setAttribute('title', `Switch to ${nextModeLabel} mode`);
        toggle.setAttribute('aria-label', `Current mode: ${getColorModeLabel(meta.mode)}. Switch to ${nextModeLabel} mode.`);
    });
    const label = document.querySelector('.sidebar-theme-toggle-label');
    if (label) label.textContent = isDark ? 'Dark' : 'Light';
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

    const topAppLogo = document.getElementById('topAppLogo');
    if (topAppLogo) {
        topAppLogo.src = meta.mode === 'dark' ? DARK_MODE_LOGO_URL : LIGHT_MODE_LOGO_URL;
    }

    const sidebarBottomLogo = document.getElementById('sidebarBottomLogo');
    if (sidebarBottomLogo) {
        sidebarBottomLogo.src = meta.mode === 'dark' ? DARK_MODE_LOGO_URL : LIGHT_MODE_LOGO_URL;
    }

    const collapsedSidebarRailLogo = document.getElementById('collapsedSidebarRailLogo');
    if (collapsedSidebarRailLogo) {
        collapsedSidebarRailLogo.src = meta.mode === 'dark' ? DARK_MODE_LOGO_URL : LIGHT_MODE_LOGO_URL;
    }

    const authLogo = document.querySelector('.auth-logo-img');
    if (authLogo) {
        authLogo.src = DARK_MODE_LOGO_URL;
    }
}

function loadSavedViewsFromStorage() {
    uiState.savedViews = [];
    uiState.activeSavedViewId = '';
    try {
        localStorage.removeItem(LOCAL_STORAGE_KEYS.SAVED_VIEWS);
    } catch {}
}

function persistSavedViews() {
    localStorage.setItem(LOCAL_STORAGE_KEYS.SAVED_VIEWS, JSON.stringify(uiState.savedViews));
}

const PROJECT_SORT_MODES = new Set(['recent', 'manual', 'alpha', 'remaining', 'progress', 'priority']);

function normalizeProjectSortMode(sortMode) {
    const normalized = String(sortMode || '').trim();
    return PROJECT_SORT_MODES.has(normalized) ? normalized : 'recent';
}

function syncProjectSortSelect() {
    const sortSelect = document.getElementById('projectSortSelect');
    if (sortSelect) sortSelect.value = uiState.sortMode;
}

function loadProjectSortPreference() {
    try {
        uiState.sortMode = normalizeProjectSortMode(localStorage.getItem(LOCAL_STORAGE_KEYS.PROJECT_SORT));
    } catch (err) {
        console.warn('Failed to load project sort preference:', err);
        uiState.sortMode = 'recent';
    }
    syncProjectSortSelect();
}

function persistProjectSortPreference(sortMode) {
    try {
        localStorage.setItem(LOCAL_STORAGE_KEYS.PROJECT_SORT, normalizeProjectSortMode(sortMode));
    } catch (err) {
        console.warn('Failed to save project sort preference:', err);
    }
}

function loadThemePreference() {
    try {
        uiState.theme = normalizeThemeName(localStorage.getItem(LOCAL_STORAGE_KEYS.THEME) || 'blueprint-dark');
    } catch (err) {
        console.warn('Failed to load UI preference:', err);
        uiState.theme = 'blueprint-dark';
    }
    applyTheme(uiState.theme, false);
}

function isProjectCardTaskPreviewEnabled() {
    return uiState.projectCardTaskPreview !== false;
}

function syncProjectCardTaskPreviewToggle() {
    const enabled = isProjectCardTaskPreviewEnabled();
    const toggle = document.getElementById('projectTaskPreviewToggleBtn');
    if (!toggle) return;
    toggle.classList.toggle('is-active', enabled);
    toggle.setAttribute('aria-pressed', String(enabled));
    toggle.setAttribute('aria-label', enabled ? 'Tasks preview is on. Turn tasks preview off.' : 'Tasks preview is off. Turn tasks preview on.');
    toggle.title = enabled ? 'Turn tasks preview off' : 'Turn tasks preview on';
}

function applyProjectCardTaskPreviewPreference(persist = true, shouldRender = true) {
    const enabled = isProjectCardTaskPreviewEnabled();
    document.body.classList.toggle('project-card-task-preview-disabled', !enabled);
    syncProjectCardTaskPreviewToggle();
    if (persist) {
        try {
            localStorage.setItem(LOCAL_STORAGE_KEYS.PROJECT_CARD_TASK_PREVIEW, enabled ? 'true' : 'false');
        } catch (err) {
            console.warn('Failed to save project card task preview preference:', err);
        }
    }
    if (shouldRender && typeof render === 'function') {
        render();
    }
}

function setProjectCardTaskPreviewEnabled(enabled) {
    uiState.projectCardTaskPreview = enabled !== false;
    applyProjectCardTaskPreviewPreference(true, true);
}

function loadProjectCardTaskPreviewPreference() {
    try {
        const stored = localStorage.getItem(LOCAL_STORAGE_KEYS.PROJECT_CARD_TASK_PREVIEW);
        uiState.projectCardTaskPreview = stored === null ? true : stored !== 'false';
    } catch (err) {
        console.warn('Failed to load project card task preview preference:', err);
        uiState.projectCardTaskPreview = true;
    }
    applyProjectCardTaskPreviewPreference(false, false);
}

function applyTheme(themeName, persist = true) {
    uiState.theme = normalizeThemeName(themeName);
    syncThemeBranding();
    syncColorModeToggle();
    if (persist) {
        try {
            localStorage.setItem(LOCAL_STORAGE_KEYS.THEME, uiState.theme);
        } catch (err) {
            console.warn('Failed to save UI preference:', err);
        }
    }
    ensureAccentColorAllowedForCurrentMode(persist);
    const status = document.getElementById('uiOptionsStatus');
    if (status) {
        const meta = getThemeMeta(uiState.theme);
        status.textContent = `Current theme: ${getThemeFamilyLabel(meta.family)} • ${getColorModeLabel(meta.mode)}`;
    }
    renderThemeOptions();
}

function applyThemeFamily(themeFamily, persist = true, preferredMode = null) {
    const currentMode = getThemeMeta(uiState.theme).mode || 'dark';
    applyTheme(buildThemeName(themeFamily, preferredMode || currentMode), persist);
}

function renderThemeOptions() {
    const activeFamily = getThemeMeta(uiState.theme).family;
    document.querySelectorAll('[data-theme-family-option]').forEach(card => {
        const isActive = card.getAttribute('data-theme-family-option') === activeFamily;
        card.classList.toggle('is-active', isActive);
    });
}

function renderAccentColorOptions() {
    const grid = document.getElementById('accentColorGrid');
    if (!grid) return;
    let activeAccent = DEFAULT_ACCENT_COLOR;
    try {
        activeAccent = normalizeAccentColor(localStorage.getItem(LOCAL_STORAGE_KEYS.ACCENT_COLOR) || DEFAULT_ACCENT_COLOR);
    } catch {}
    const colorOptions = getAccentColorOptionsForMode();
    grid.innerHTML = colorOptions.map(color => {
        const isActive = normalizeAccentColor(color) === activeAccent;
        return `
            <button class="accent-color-swatch ${isActive ? 'is-active' : ''}"
                    type="button"
                    style="--swatch-color: ${color};"
                    title="Use accent color ${color}"
                    aria-label="Use accent color ${color}"
                    aria-pressed="${isActive}"
                    onclick="applyAccentColor('${color}')">
                <span aria-hidden="true"></span>
            </button>
        `;
    }).join('');
}

function openUiOptionsModal() {
    closeMobileWebSidebarForModal();
    renderThemeOptions();
    renderAccentColorOptions();
    const meta = getThemeMeta(uiState.theme);
    document.getElementById('uiOptionsStatus').textContent = `Current theme: ${getThemeFamilyLabel(meta.family)} • ${getColorModeLabel(meta.mode)}`;
    syncColorModeToggle();
    syncProjectCardTaskPreviewToggle();
    document.getElementById('uiOptionsModal')?.classList.add('active');
}

function closeUiOptionsModal() {
    document.getElementById('uiOptionsModal')?.classList.remove('active');
    handleSidebarSettingsChildClosed('uiOptionsModal');
}

function setSaveStatus(status, message) {
    const normalizedMessage = String(message ?? '');
    uiState.saveStatus = status;
    uiState.saveMessage = normalizedMessage;
    const pill = document.getElementById('saveStatusPill');
    if (!pill) return;
    const visualStatus = status === 'idle' ? 'saved' : status;
    const lengthClass = normalizedMessage.length > 86
        ? ' save-status--extra-long'
        : (normalizedMessage.length > 44 ? ' save-status--long' : '');
    pill.className = `save-status save-status--inline save-status--${visualStatus}${lengthClass}`;
    pill.textContent = normalizedMessage;
    pill.title = normalizedMessage;
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
    const normalizedTasks = Array.isArray(project.tasks) ? project.tasks.map((task, index) => normalizeTask(task, index)) : [];
    const normalizedProject = {
        ...project,
        id: project.id || project._id || String(Date.now()),
        _id: project._id || project.id,
        title: decodeHtmlEntities(project.title || 'Untitled Project'),
        notes: getProjectNotesValueFromProject(project),
        description: typeof project.description === 'string' ? decodeHtmlEntities(project.description) : (typeof project.summary === 'string' ? decodeHtmlEntities(project.summary) : ''),
        projectPriorityTag: getProjectPriorityTag(project),
        dueDate: getProjectDueDate(project),
        calendarNotes: normalizeProjectCalendarNotes(project.calendarNotes || project.projectCalendarNotes || {}),
        tags: normalizeProjectTags(project.tags || project.projectTags || []),
        tasks: normalizedTasks,
        taskCategories: getProjectTaskCategories({ ...project, tasks: normalizedTasks }),
        collaborators: Array.isArray(project.collaborators) ? project.collaborators : [],
        activities: Array.isArray(project.activities) ? project.activities : [],
        archived: isProjectArchived(project),
        completed: isProjectCompleted(project),
        completedBy: project.completedBy ? String(project.completedBy) : '',
        completedByName: project.completedByName ? decodeHtmlEntities(project.completedByName) : '',
        dateCreated: project.dateCreated || new Date().toISOString(),
        lastModified: project.lastModified || project.dateCreated || new Date().toISOString(),
        __syncedLastModified: project.__syncedLastModified || project.lastModified || project.dateCreated || null
    };
    return normalizedProject;
}

function runRenderStep(stepName, fn) {
    try {
        fn();
    } catch (err) {
        console.error(`Render step failed: ${stepName}`, err);
    }
}

function parseProjectBoolean(value) {
    if (value === true || value === 1) return true;
    if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        return ['true', '1', 'yes', 'completed'].includes(normalized);
    }
    return false;
}

function isProjectCompleted(project) {
    return parseProjectBoolean(project?.completed);
}

function isProjectArchived(project) {
    return parseProjectBoolean(project?.archived);
}

function getDerivedCompletedProjectsCount() {
    return state.getProjects().filter(project => isProjectCompleted(project) && !isProjectArchived(project)).length;
}

function syncDerivedCompletedProjectStats() {
    const stats = state.getStats() || {};
    const completedProjects = getDerivedCompletedProjectsCount();
    if (Number(stats.completedProjects || 0) !== completedProjects) {
        state.setStats({ ...stats, completedProjects });
    }
    return { ...state.getStats(), completedProjects };
}

function getVisibleBaseProjects() {
    return state.getProjects().filter(project => {
        if (state.getView() === VIEWS.ARCHIVED) return isProjectArchived(project);
        if (isProjectArchived(project)) return false;
        return state.getView() === VIEWS.COMPLETED
            ? isProjectCompleted(project)
            : !isProjectCompleted(project);
    });
}

function getArchivedProjects() {
    return state.getProjects().filter(project => project.archived);
}

function matchesProjectSearch(project, query) {
    if (!query) return true;
    const haystack = [
        project.title,
        project.description,
        getProjectNotesValueFromProject(project),
        ...getProjectTags(project),
        ...(project.tasks || []).map(task => task.text)
    ].join(' ').toLowerCase();
    return haystack.includes(query.toLowerCase());
}

function getFilteredProjects() {
    let projects = [...getVisibleBaseProjects()].map(normalizeProject).filter(Boolean);

    if (uiState.ownerFilter === 'owned') projects = projects.filter(project => project.userRole === 'owner');
    if (uiState.ownerFilter === 'shared') projects = projects.filter(project =>
        project.userRole !== 'owner' || ((project.collaborators || []).length > 0)
    );
    if (uiState.ownerFilter === 'collab') projects = projects.filter(project => (project.collaborators || []).length > 0);

    if (uiState.projectSearch.trim()) {
        const query = uiState.projectSearch.trim();
        projects = projects.filter(project => matchesProjectSearch(project, query));
    }

    if (uiState.activeProjectTag && uiState.activeProjectTag !== PROJECT_TAG_ALL_FILTER) {
        projects = projects.filter(project => projectHasTag(project, uiState.activeProjectTag));
    }

    if (uiState.sortMode === 'recent') {
        projects.sort((a, b) => new Date(b.lastModified || b.dateCreated) - new Date(a.lastModified || a.dateCreated));
    } else if (uiState.sortMode === 'alpha') {
        projects.sort((a, b) => a.title.localeCompare(b.title));
    } else if (uiState.sortMode === 'remaining') {
        projects.sort((a, b) => {
            const aRemaining = (a.tasks || []).filter(task => !isTaskCompleted(task)).length;
            const bRemaining = (b.tasks || []).filter(task => !isTaskCompleted(task)).length;
            return bRemaining - aRemaining;
        });
    } else if (uiState.sortMode === 'progress') {
        projects.sort((a, b) => {
            const aTotal = a.tasks?.length || 0;
            const bTotal = b.tasks?.length || 0;
            const aDone = a.tasks?.filter(task => isTaskCompleted(task)).length || 0;
            const bDone = b.tasks?.filter(task => isTaskCompleted(task)).length || 0;
            const aProgress = aTotal ? aDone / aTotal : 0;
            const bProgress = bTotal ? bDone / bTotal : 0;
            return bProgress - aProgress;
        });
    } else if (uiState.sortMode === 'priority') {
        projects.sort((a, b) => {
            const priorityDiff = getTaskTagPriority({ tag: getProjectPriorityTag(a) }) - getTaskTagPriority({ tag: getProjectPriorityTag(b) });
            if (priorityDiff !== 0) return priorityDiff;
            return new Date(b.lastModified || b.dateCreated) - new Date(a.lastModified || a.dateCreated);
        });
    }

    return projects;
}

function renderActiveFilterChips() {
    const container = document.getElementById('activeFilterChips');
    if (!container) return;

    const tags = [PROJECT_TAG_ALL_FILTER, ...getAllVisibleProjectTags()];
    const activeTag = uiState.activeProjectTag || PROJECT_TAG_ALL_FILTER;

    container.innerHTML = tags.map(tag => {
        const label = tag === PROJECT_TAG_ALL_FILTER ? 'All' : tag;
        const isActive = tag === activeTag;
        return `<button class="filter-chip ${isActive ? 'is-active' : ''}" type="button" onclick="setProjectTagFilter(${serializeInlineJsString(tag)})">${escapeHtml(label)}</button>`;
    }).join('');
}


function saveCurrentView() {
    uiState.savedViews = [];
    uiState.activeSavedViewId = '';
    try {
        localStorage.removeItem(LOCAL_STORAGE_KEYS.SAVED_VIEWS);
    } catch {}
}

function applySavedView(viewId) {
    uiState.activeSavedViewId = '';
}

function deleteSavedView(viewId) {
    uiState.savedViews = [];
    uiState.activeSavedViewId = '';
    try {
        localStorage.removeItem(LOCAL_STORAGE_KEYS.SAVED_VIEWS);
    } catch {}
}

function clearSavedViews() {
    uiState.savedViews = [];
    uiState.activeSavedViewId = '';
    try {
        localStorage.removeItem(LOCAL_STORAGE_KEYS.SAVED_VIEWS);
    } catch {}
}

function renderSavedViewsPanel() {
    uiState.savedViews = Array.isArray(uiState.savedViews) ? uiState.savedViews : [];
}

function renderArchivedProjectsPanel() {
    const list = document.getElementById('archivedProjectsList');
    const count = document.getElementById('archivedProjectsCount');
    const archivedProjects = getArchivedProjects();
    if (count) count.textContent = String(archivedProjects.length);
    if (!list) return;
    if (!archivedProjects.length) {
        list.innerHTML = '<div class="side-panel-empty">No archived projects</div>';
        return;
    }
    list.innerHTML = archivedProjects.map(project => `
        <div class="archived-project-card" data-project-id="${escapeHtml(project.id)}">
            <div>
                <div class="archived-project-title">${escapeHtml(project.title)}</div>
                <div class="archived-project-meta">Updated ${escapeHtml(formatCompactDateTime(project.lastModified || project.dateCreated))}</div>
            </div>
            <div class="archived-project-actions">
                <button class="icon-button-small" type="button" onclick="restoreArchivedProject('${project.id}', event)">Restore</button>
                <button class="icon-button-small" type="button" onclick="openProjectModal('${project.id}')">Open</button>
            </div>
        </div>
    `).join('');
}

function getProjectActivities(project) {
    return Array.isArray(project?.activities) ? project.activities : [];
}

function buildProjectHistoryMarkup(project) {
    const activities = getProjectActivities(project);
    return `
        <div class="project-activity-list">
            ${activities.length ? activities.map(activity => `
                <div class="project-activity-item">
                    <div class="project-activity-meta">
                        <span>${escapeHtml(activity.actorName || 'System')}</span>
                        <span>${escapeHtml(formatCompactDateTime(activity.createdAt))}</span>
                    </div>
                    <div class="project-activity-message">${escapeHtml(activity.message || 'Updated the project')}</div>
                </div>
            `).join('') : '<div class="side-panel-empty">No activity yet</div>'}
        </div>
    `;
}

function renderProjectHistorySection(projectId) {
    const project = state.findProject(projectId);
    const section = document.getElementById(`history-section-${projectId}`);
    if (!project || !section) return;
    section.innerHTML = buildProjectHistoryMarkup(project);
}

function refreshProjectHistoryIfPresent(projectId) {
    if (!document.getElementById(`history-section-${projectId}`)) return;
    renderProjectHistorySection(projectId);
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

function syncCollapsedAvatarUI(profilePic, name) {
    setAvatarUI(
        document.getElementById('collapsedPanelAvatarImg'),
        document.getElementById('collapsedPanelAvatarFallback'),
        profilePic,
        name
    );
}

function applyAccountUI(user) {
    if (!user) return;
    accountState.user = { ...(accountState.user || {}), ...user };
    state.setCurrentUser(accountState.user);

    const panelUsername = document.getElementById('panelUsername');
    if (panelUsername) panelUsername.textContent = accountState.user.username || 'User';
    syncPanelUserLevelBadge(getCurrentPersonalLevelProgress().level);

    const panelUserInfo = document.getElementById('panelUserInfo');
    if (panelUserInfo) panelUserInfo.classList.remove('hidden');

    setAvatarUI(
        document.getElementById('panelAvatarImg'),
        document.getElementById('panelAvatarFallback'),
        accountState.user.profilePic,
        accountState.user.username
    );

    syncCollapsedAvatarUI(accountState.user.profilePic, accountState.user.username);

    const effectiveAccountProfilePic = accountState.pendingProfilePic !== null
        ? accountState.pendingProfilePic
        : accountState.user.profilePic;

    setAvatarUI(
        document.getElementById('accountAvatarImg'),
        document.getElementById('accountAvatarFallback'),
        effectiveAccountProfilePic,
        accountState.user.username
    );

    const accountProfilePicButton = document.getElementById('accountProfilePicButton');
    if (accountProfilePicButton) {
        accountProfilePicButton.textContent = effectiveAccountProfilePic ? 'Update Profile Picture' : 'Upload Profile Picture';
    }

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

    ensureProjectLayoutControls();
    applyProjectGridLayoutPreference();
}

function syncAccountStatsToModal() {
    const derivedSharedProjects = state.getProjects().filter(project => project.userRole !== 'owner' && !project.archived).length;
    const derivedActiveProjects = state.getProjects().filter(project => !project.completed && !project.archived).length;
    const syncedStats = normalizePersonalProgressionStats(syncDerivedCompletedProjectStats());
    const stats = {
        completedTasks: syncedStats.completedTasks || accountState.stats.completedTasks || 0,
        completedProjects: syncedStats.completedProjects || 0,
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
    renderAccountProgression();
}

function setAccountStatus(message = '', type = '') {
    const el = document.getElementById('accountSettingsStatus');
    if (!el) return;
    el.textContent = message;
    el.classList.toggle('is-error', type === 'error');
    el.classList.toggle('is-success', type === 'success');
}

function loadNotifiedCompetitiveAchievementKeys() {
    try {
        const raw = localStorage.getItem(LOCAL_STORAGE_KEYS.COMPETITIVE_NOTIFICATIONS);
        const parsed = raw ? JSON.parse(raw) : [];
        return new Set(Array.isArray(parsed) ? parsed.map(String) : []);
    } catch {
        return new Set();
    }
}

function saveNotifiedCompetitiveAchievementKeys(keys) {
    try {
        localStorage.setItem(LOCAL_STORAGE_KEYS.COMPETITIVE_NOTIFICATIONS, JSON.stringify(Array.from(keys).slice(-400)));
    } catch {}
}

function queueCompetitiveAchievementNotifications(entries = []) {
    const notifiedKeys = loadNotifiedCompetitiveAchievementKeys();
    const currentUserId = String(accountState.user?.id || getCurrentUser?.()?.id || '');
    const currentUsername = String(accountState.user?.username || getCurrentUser?.()?.username || '').trim().toLowerCase();
    let changed = false;
    entries.forEach(entry => {
        const entryUserId = String(entry?.userId || '');
        const entryUsername = String(getLeaderboardUsername(entry) || '').trim().toLowerCase();
        const isCurrentUserWinner = currentUserId
            ? entryUserId === currentUserId
            : (currentUsername && entryUsername === currentUsername);
        if (!isCurrentUserWinner) return;

        const username = getLeaderboardUsername(entry);
        (Array.isArray(entry?.competitiveAchievements) ? entry.competitiveAchievements : []).forEach(achievement => {
            const fallback = getCompetitiveAchievementFallback(achievement.id);
            const key = String(achievement.notificationKey || `${entry.userId || username}:${achievement.id || fallback.name}`);
            if (!key || notifiedKeys.has(key)) return;
            notifiedKeys.add(key);
            changed = true;
            queuePersonalProgressionModal({
                kicker: 'Competitive Achievement',
                title: achievement.name || fallback.name,
                description: achievement.description || fallback.description,
                iconClass: getCompetitiveAchievementIconClass(achievement.id)
            });
        });
    });
    if (changed) {
        saveNotifiedCompetitiveAchievementKeys(notifiedKeys);
        updateNotificationUnreadIndicator();
        refreshNotificationsModalIfOpen();
    }
}

function renderLeaderboardPanel() {
    const list = document.getElementById('leaderboardList');
    if (!list) return;

    const leaderboardCard = list.closest('.leaderboard-panel-card') || list.parentElement;
    if (leaderboardCard && !leaderboardCard.querySelector('.leaderboard-card-caption')) {
        const caption = document.createElement('div');
        caption.className = 'leaderboard-card-caption';
        caption.textContent = 'Tasks completed over 7 days';
        leaderboardCard.insertBefore(caption, list);
    }

    const currentUserId = String(accountState.user?.id || getCurrentUser?.()?.id || '');
    const rankedEntries = Array.isArray(accountState.leaderboard) ? [...accountState.leaderboard] : [];
    const liveCurrentEntry = currentUserId ? buildLocalCurrentLeaderboardEntry(currentUserId) : null;
    let currentEntry = accountState.currentLeaderboardEntry || rankedEntries.find(entry => String(entry.userId) === currentUserId) || null;

    if (!currentEntry && liveCurrentEntry) {
        currentEntry = {
            ...liveCurrentEntry,
            rank: accountState.currentLeaderboardRank || null
        };
    }

    if (currentEntry && currentUserId) {
        const serverScore = Number(currentEntry.leaderboardScore ?? currentEntry.score);
        const serverRank = Number(currentEntry.rank || accountState.currentLeaderboardRank || 0);
        currentEntry = {
            ...(liveCurrentEntry || {}),
            ...currentEntry,
            username: accountState.user?.username || currentEntry.username || 'User',
            profilePic: currentEntry.profilePic || accountState.user?.profilePic || '',
            totalCompletionPercentage: liveCurrentEntry?.totalCompletionPercentage ?? getLeaderboardCompletionValue(currentEntry),
            playerLevel: currentEntry.playerLevel || liveCurrentEntry?.playerLevel || getCurrentPersonalLevelProgress().level,
            competitiveAchievements: Array.isArray(currentEntry.competitiveAchievements) ? currentEntry.competitiveAchievements : (liveCurrentEntry?.competitiveAchievements || []),
            leaderboardScore: Number.isFinite(serverScore) ? Math.round(serverScore) : (liveCurrentEntry?.leaderboardScore ?? getLeaderboardScoreValue(currentEntry)),
            rank: serverRank || currentEntry.rank || accountState.currentLeaderboardRank || null
        };
    }

    const entriesByUserId = new Map();
    rankedEntries.forEach(entry => {
        const userId = String(entry?.userId || '');
        if (!userId) return;
        entriesByUserId.set(userId, entry);
    });
    if (currentEntry && currentUserId) entriesByUserId.set(currentUserId, currentEntry);

    const rankedByScore = Array.from(entriesByUserId.values()).sort((a, b) => {
        return (getLeaderboardScoreValue(b) - getLeaderboardScoreValue(a))
            || (toLeaderboardNumber(b?.completedTasks) - toLeaderboardNumber(a?.completedTasks))
            || (toLeaderboardNumber(b?.completedProjects) - toLeaderboardNumber(a?.completedProjects))
            || (toLeaderboardNumber(b?.sharedCompletedTasks) - toLeaderboardNumber(a?.sharedCompletedTasks))
            || (toLeaderboardNumber(a?.remainingTasks) - toLeaderboardNumber(b?.remainingTasks))
            || getLeaderboardUsername(a).localeCompare(getLeaderboardUsername(b));
    }).map((entry, index) => ({
        ...entry,
        rank: index + 1
    }));

    const visibleEntries = rankedByScore.slice(0, 5);

    accountState.renderedLeaderboardEntries = visibleEntries;

    if (!visibleEntries.length) {
        list.innerHTML = '<div class="side-panel-empty">No rankings yet</div>';
        return;
    }

    list.innerHTML = visibleEntries.map(entry => {
        const isCurrent = currentUserId && String(entry.userId) === currentUserId;
        const username = getLeaderboardDisplayName(entry, isCurrent);
        const completionPercentage = getLeaderboardCompletionValue(entry);
        const leaderboardScore = getLeaderboardScoreValue(entry);
        const completedProjects = Number(entry.completedProjects || 0);
        const completedTasks = Number(entry.completedTasks || 0);
        const rank = String(entry.rank || '—').padStart(2, '0');
        const meta = `${leaderboardScore} task${leaderboardScore === 1 ? '' : 's'} this week • ${completionPercentage}% complete • ${completedProjects} project${completedProjects === 1 ? '' : 's'} • ${completedTasks} total tasks`;
        const rankClass = rank === '01' ? ' leaderboard-rank--top' : '';
        const profilePic = entry.profilePic || (isCurrent ? accountState.user?.profilePic : '') || '';
        const avatarMarkup = profilePic
            ? `<img class="leaderboard-row-avatar-img" src="${escapeHtml(profilePic)}" alt="">`
            : `<span class="leaderboard-row-avatar-fallback" aria-hidden="true"></span>`;
        const userIdLiteral = serializeInlineJsString(String(entry.userId || ''));
        return `
            <button class="leaderboard-row ${isCurrent ? 'is-current' : ''}" type="button" onclick="openLeaderboardProfileModal(${userIdLiteral})" aria-label="Open ${escapeHtml(username)} stats">
                <span class="leaderboard-rank${rankClass}">${rank}</span>
                <span class="leaderboard-row-avatar" aria-hidden="true">${avatarMarkup}</span>
                <span class="leaderboard-row-main">
                    <span class="leaderboard-user ${isCurrent ? 'is-current' : ''}" title="${escapeHtml(username)}">${escapeHtml(username)}</span>
                    <span class="leaderboard-meta">${completionPercentage}% complete</span>
                </span>
                <span class="leaderboard-row-score" title="${escapeHtml(meta)}">${formatLeaderboardScore(entry, isCurrent)}</span>
            </button>
        `;
    }).join('');
}

function getCompetitiveAchievementFallback(id) {
    return COMPETITIVE_ACHIEVEMENT_FALLBACKS[String(id || '')] || { name: 'Competitive Achievement', description: '' };
}

function getLeaderboardModalEntry(userId) {
    const normalizedUserId = String(userId || '');
    if (!normalizedUserId) return null;
    const visibleEntry = (accountState.renderedLeaderboardEntries || [])
        .find(entry => String(entry?.userId || '') === normalizedUserId);
    if (visibleEntry) return visibleEntry;
    if (String(accountState.currentLeaderboardEntry?.userId || '') === normalizedUserId) {
        return accountState.currentLeaderboardEntry;
    }
    return (accountState.leaderboard || [])
        .find(entry => String(entry?.userId || '') === normalizedUserId) || null;
}

function buildLeaderboardProfileModalMarkup(entry) {
    const currentUserId = String(accountState.user?.id || getCurrentUser?.()?.id || '');
    const isCurrent = currentUserId && String(entry.userId || '') === currentUserId;
    const username = getLeaderboardDisplayName(entry, isCurrent);
    const profilePic = entry.profilePic || (isCurrent ? accountState.user?.profilePic : '') || '';
    const rank = Number(entry.rank || entry.leaderboardRank || 0);
    const completion = getLeaderboardCompletionValue(entry);
    const leaderboardScore = getLeaderboardScoreValue(entry);
    const playerLevel = Math.max(1, Number(entry.playerLevel || 1) || 1);
    const competitiveAchievements = Array.isArray(entry.competitiveAchievements) ? entry.competitiveAchievements : [];
    const stats = [
        ['Rank', rank > 0 ? `#${rank}` : '—'],
        ['Level', String(playerLevel)],
        ['Weekly Score', `${leaderboardScore} task${leaderboardScore === 1 ? '' : 's'}`],
        ['Total Completion', `${completion}%`],
        ['Completed Tasks', Number(entry.completedTasks || 0)],
        ['Remaining Tasks', Number(entry.remainingTasks || 0)],
        ['Completed Projects', Number(entry.completedProjects || 0)],
        ['Active Projects', Number(entry.activeProjects || 0)],
        ['Shared Projects', Number(entry.sharedProjects || 0)],
        ['Shared Tasks', Number(entry.sharedTasks || 0)],
        ['Shared Completed', Number(entry.sharedCompletedTasks || 0)]
    ];
    const avatarMarkup = profilePic
        ? `<img class="leaderboard-profile-avatar-img" src="${escapeHtml(profilePic)}" alt="">`
        : `<span class="leaderboard-profile-avatar-fallback" aria-hidden="true">${escapeHtml(String(username || 'U').charAt(0).toUpperCase() || 'U')}</span>`;

    return `
        <div class="modal-content leaderboard-profile-modal-content" role="dialog" aria-modal="true" aria-labelledby="leaderboardProfileTitle">
            <div class="account-modal-scroll">
                <div class="leaderboard-profile-modal-header">
                    <h2 class="leaderboard-profile-heading" id="leaderboardProfileTitle">Leaderboard Stats</h2>
                    <button class="modal-close leaderboard-profile-close" type="button" onclick="closeLeaderboardProfileModal()" aria-label="Close leaderboard stats">
                        <svg class="icon-lg" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
                        </svg>
                    </button>
                </div>
                <div class="leaderboard-profile-info-card">
                    <div class="leaderboard-profile-top">
                        <div class="leaderboard-profile-avatar">${avatarMarkup}</div>
                        <div class="leaderboard-profile-summary">
                            <div class="leaderboard-profile-name">${escapeHtml(username)}</div>
                            <div class="leaderboard-profile-meta">${rank > 0 ? `Rank #${rank}` : 'Unranked'} • Level ${playerLevel} • ${leaderboardScore} tasks this week</div>
                        </div>
                    </div>
                    <div class="leaderboard-profile-stats-list">
                        ${stats.map(([label, value]) => `
                            <div class="leaderboard-profile-stat-row">
                                <span class="leaderboard-profile-stat-label">${escapeHtml(label)}</span>
                                <span class="leaderboard-profile-stat-value">${escapeHtml(value)}</span>
                            </div>
                        `).join('')}
                    </div>
                </div>
                <div class="leaderboard-competitive-section">
                    <div class="leaderboard-competitive-title">Achievements</div>
                    ${competitiveAchievements.length ? competitiveAchievements.map(achievement => {
                        const achievementDate = getCompetitiveAchievementDateLabel(achievement);
                        return `
                            <div class="leaderboard-competitive-row">
                                <span class="leaderboard-competitive-icon ${getCompetitiveAchievementIconClass(achievement.id)}" aria-hidden="true"></span>
                                <span>
                                    <strong>${escapeHtml(achievement.name || getCompetitiveAchievementFallback(achievement.id).name)}</strong>
                                    <small>${escapeHtml(achievement.description || getCompetitiveAchievementFallback(achievement.id).description)}</small>
                                    ${achievementDate ? `<small class="leaderboard-competitive-date">Achieved ${escapeHtml(achievementDate)}</small>` : ''}
                                </span>
                            </div>
                        `;
                    }).join('') : '<div class="leaderboard-competitive-empty">No achievements yet.</div>'}
                </div>
            </div>
        </div>
    `;
}

function openLeaderboardProfileModal(userId) {
    const entry = getLeaderboardModalEntry(userId);
    if (!entry) return;

    let modal = document.getElementById('leaderboardProfileModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.className = 'modal-overlay leaderboard-profile-modal';
        modal.id = 'leaderboardProfileModal';
        modal.addEventListener('click', (event) => {
            if (event.target === modal) closeLeaderboardProfileModal();
        });
        document.body.appendChild(modal);
    }

    modal.innerHTML = buildLeaderboardProfileModalMarkup(entry);
    modal.classList.add('active');
}

function closeLeaderboardProfileModal() {
    const modal = document.getElementById('leaderboardProfileModal');
    if (!modal) return;
    modal.classList.remove('active');
}


let sidebarRailSettingsChildModalId = null;

function clearSidebarRailSettingsBackButtons() {
    document.querySelectorAll('.sidebar-rail-back-button').forEach(button => button.remove());
}

function openSidebarSettingsRootFromChild(closeFn) {
    if (typeof closeFn === 'function') closeFn();
    sidebarRailSettingsChildModalId = null;
    clearSidebarRailSettingsBackButtons();
    openSidebarSettingsModal();
}

function ensureSidebarRailSettingsBackButton(modalId, closeFn) {
    clearSidebarRailSettingsBackButtons();
    if (sidebarRailSettingsChildModalId !== modalId) return;
    const modal = document.getElementById(modalId);
    const header = modal?.querySelector?.('.account-modal-header');
    if (!modal || !header) return;

    const button = document.createElement('button');
    button.className = 'sidebar-rail-back-button';
    button.type = 'button';
    button.setAttribute('aria-label', 'Back to minimized sidebar settings');
    button.innerHTML = `
        <svg class="icon-sm" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"></path>
        </svg>
        <span>Back</span>
    `;
    button.addEventListener('click', () => {
        openSidebarSettingsRootFromChild(typeof closeFn === 'function' ? closeFn : null);
    });
    header.insertBefore(button, header.firstElementChild || null);
}

function openSidebarSettingsChildModal(modalId, openFn, closeFn) {
    closeSidebarSettingsModal();
    sidebarRailSettingsChildModalId = modalId;
    if (typeof openFn === 'function') openFn();
    ensureSidebarRailSettingsBackButton(modalId, closeFn);
}

function handleSidebarSettingsChildClosed(modalId) {
    if (sidebarRailSettingsChildModalId !== modalId) return;
    sidebarRailSettingsChildModalId = null;
    clearSidebarRailSettingsBackButtons();
}

function openSidebarLeaderboardModal() {
    renderLeaderboardPanel();
    let modal = document.getElementById('sidebarLeaderboardModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.className = 'modal-overlay sidebar-rail-modal sidebar-leaderboard-modal';
        modal.id = 'sidebarLeaderboardModal';
        modal.addEventListener('click', (event) => {
            if (event.target === modal) closeSidebarLeaderboardModal();
        });
        document.body.appendChild(modal);
    }

    const list = document.getElementById('leaderboardList');
    const listMarkup = list ? list.innerHTML : '<div class="side-panel-empty">No rankings yet</div>';
    modal.innerHTML = `
        <div class="modal-content sidebar-rail-modal-content sidebar-leaderboard-modal-content" role="dialog" aria-modal="true" aria-labelledby="sidebarLeaderboardModalTitle">
            <div class="sidebar-rail-modal-header">
                <div>
                    <h2 id="sidebarLeaderboardModalTitle">Leaderboard</h2>
                    <p>Current team ranking and completion activity.</p>
                </div>
                <button class="modal-close sidebar-rail-modal-close" type="button" onclick="closeSidebarLeaderboardModal()" aria-label="Close leaderboard">
                    <svg class="icon-sm" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
                    </svg>
                </button>
            </div>
            <div class="sidebar-rail-modal-body">
                <div class="leaderboard-panel-card sidebar-rail-leaderboard-card">
                    <div class="leaderboard-list sidebar-rail-leaderboard-list">${listMarkup}</div>
                </div>
            </div>
        </div>
    `;
    modal.classList.add('active');
}

function closeSidebarLeaderboardModal() {
    const modal = document.getElementById('sidebarLeaderboardModal');
    if (!modal) return;
    modal.classList.remove('active');
}

function openSidebarSettingsModal() {
    let modal = document.getElementById('sidebarSettingsModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.className = 'modal-overlay sidebar-rail-modal sidebar-settings-modal';
        modal.id = 'sidebarSettingsModal';
        modal.addEventListener('click', (event) => {
            if (event.target === modal) closeSidebarSettingsModal();
        });
        document.body.appendChild(modal);
    }

    modal.innerHTML = `
        <div class="modal-content sidebar-rail-modal-content sidebar-settings-modal-content" role="dialog" aria-modal="true" aria-labelledby="sidebarSettingsModalTitle">
            <div class="sidebar-rail-modal-header">
                <div>
                    <h2 id="sidebarSettingsModalTitle">Settings</h2>
                    <p>Open account, interface, keyboard, guide, and session actions.</p>
                </div>
                <button class="modal-close sidebar-rail-modal-close" type="button" onclick="closeSidebarSettingsModal()" aria-label="Close settings">
                    <svg class="icon-sm" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
                    </svg>
                </button>
            </div>
            <div class="sidebar-rail-modal-body sidebar-rail-settings-actions">
                <button class="sidebar-rail-settings-action" type="button" data-rail-settings-action="account">Account Settings</button>
                <button class="sidebar-rail-settings-action" type="button" data-rail-settings-action="ui">UI Options</button>
                <button class="sidebar-rail-settings-action" type="button" data-rail-settings-action="shortcuts">Keyboard Shortcuts</button>
                <button class="sidebar-rail-settings-action" type="button" data-rail-settings-action="guide">How To Guide</button>
                <button class="sidebar-rail-settings-action sidebar-rail-settings-action--danger" type="button" data-rail-settings-action="signout">Sign Out</button>
            </div>
        </div>
    `;

    modal.querySelector('[data-rail-settings-action="account"]')?.addEventListener('click', () => {
        openSidebarSettingsChildModal('accountSettingsModal', openAccountSettingsModal, closeAccountSettingsModal);
    });
    modal.querySelector('[data-rail-settings-action="ui"]')?.addEventListener('click', () => {
        openSidebarSettingsChildModal('uiOptionsModal', openUiOptionsModal, closeUiOptionsModal);
    });
    modal.querySelector('[data-rail-settings-action="shortcuts"]')?.addEventListener('click', () => {
        openSidebarSettingsChildModal('shortcutsModal', openShortcutsModal, closeShortcutsModal);
    });
    modal.querySelector('[data-rail-settings-action="guide"]')?.addEventListener('click', () => {
        openSidebarSettingsChildModal('howToGuideModal', openHowToGuideModal, closeHowToGuideModal);
    });
    modal.querySelector('[data-rail-settings-action="signout"]')?.addEventListener('click', () => {
        closeSidebarSettingsModal();
        logout();
    });

    modal.classList.add('active');
}

function closeSidebarSettingsModal() {
    const modal = document.getElementById('sidebarSettingsModal');
    if (!modal) return;
    modal.classList.remove('active');
}

function setSidebarSectionExpanded(sectionKey, expanded) {
    const normalizedKey = String(sectionKey || '');
    if (!normalizedKey) return;
    uiState.sidebarSections[normalizedKey] = !!expanded;
    const section = document.querySelector(`[data-sidebar-section="${normalizedKey}"]`);
    if (!section) return;
    section.classList.toggle('is-expanded', !!expanded);
    const body = section.querySelector('.sidebar-section-body');
    if (body) body.hidden = !expanded;
    const toggle = section.querySelector('.sidebar-section-toggle');
    if (toggle) toggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
}

function toggleSidebarSection(sectionKey) {
    setSidebarSectionExpanded(sectionKey, !uiState.sidebarSections[sectionKey]);
}


function buildSidebarSectionToggle(sectionKey, label) {
    const button = document.createElement('button');
    button.className = 'sidebar-section-toggle';
    button.type = 'button';
    button.dataset.sidebarToggle = sectionKey;
    button.setAttribute('aria-expanded', 'false');
    button.setAttribute('title', label);
    button.setAttribute('aria-label', label);

    const iconMarkup = sectionKey === 'settings'
        ? `<svg class="sidebar-section-toggle-icon sidebar-section-toggle-icon--settings" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.35 4.32c.42-1.76 2.88-1.76 3.3 0l.08.33a1.7 1.7 0 0 0 2.47 1.05l.3-.17c1.54-.9 3.28.85 2.38 2.38l-.17.3a1.7 1.7 0 0 0 1.05 2.47l.33.08c1.76.42 1.76 2.88 0 3.3l-.33.08a1.7 1.7 0 0 0-1.05 2.47l.17.3c.9 1.54-.85 3.28-2.38 2.38l-.3-.17a1.7 1.7 0 0 0-2.47 1.05l-.08.33c-.42 1.76-2.88 1.76-3.3 0l-.08-.33a1.7 1.7 0 0 0-2.47-1.05l-.3.17c-1.54.9-3.28-.85-2.38-2.38l.17-.3a1.7 1.7 0 0 0-1.05-2.47l-.33-.08c-1.76-.42-1.76-2.88 0-3.3l.33-.08A1.7 1.7 0 0 0 5.3 8.2l-.17-.3c-.9-1.54.85-3.28 2.38-2.38l.3.17a1.7 1.7 0 0 0 2.47-1.05l.08-.33Z"></path><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"></path></svg>`
        : sectionKey === 'leaderboard'
            ? `<span class="sidebar-section-toggle-icon sidebar-section-toggle-icon--leaderboard" aria-hidden="true"></span>`
            : '';

    button.innerHTML = `<span class="sidebar-section-toggle-main">${iconMarkup}<span class="sidebar-section-toggle-label">${escapeHtml(label)}</span></span><span class="sidebar-section-chevron" aria-hidden="true">⌄</span>`;
    return button;
}

function ensureSidebarSettingsDropdown() {
    const controlPanel = document.getElementById('controlPanel');
    if (!controlPanel) return;

    let settingsSection = controlPanel.querySelector('[data-sidebar-section="settings"]');
    if (!settingsSection) {
        settingsSection = document.createElement('section');
        settingsSection.className = 'sidebar-collapsible sidebar-collapsible--settings';
        settingsSection.dataset.sidebarSection = 'settings';
        const leaderboardSection = controlPanel.querySelector('[data-sidebar-section="leaderboard"]');
        const insertAfter = leaderboardSection || controlPanel.querySelector('.total-completion-section') || controlPanel.querySelector('.sidebar-nav-list');
        if (insertAfter?.parentNode) {
            insertAfter.parentNode.insertBefore(settingsSection, insertAfter.nextSibling);
        } else {
            controlPanel.appendChild(settingsSection);
        }
    }

    let settingsToggle = settingsSection.querySelector('[data-sidebar-toggle="settings"]');
    if (!settingsToggle) {
        settingsToggle = buildSidebarSectionToggle('settings', 'Settings');
        settingsSection.prepend(settingsToggle);
    }

    let settingsBody = settingsSection.querySelector('#settingsSectionBody, .sidebar-section-body');
    if (!settingsBody) {
        settingsBody = document.createElement('div');
        settingsBody.id = 'settingsSectionBody';
        settingsBody.className = 'sidebar-section-body';
        settingsSection.appendChild(settingsBody);
    }
    settingsBody.id = 'settingsSectionBody';
    settingsBody.classList.add('sidebar-section-body');

    let settingsCard = settingsBody.querySelector('.settings-panel-card');
    if (!settingsCard) {
        settingsCard = document.createElement('div');
        settingsCard.className = 'settings-panel-card';
        settingsBody.appendChild(settingsCard);
    }

    let settingsActions = settingsCard.querySelector('.settings-actions');
    if (!settingsActions) {
        settingsActions = document.createElement('div');
        settingsActions.className = 'settings-actions';
        settingsCard.appendChild(settingsActions);
    }

    const actionSpecs = [
        ['sidebarAccountSettingsBtn', 'Account Settings', 'sidebar-action-button', 'M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.5 20.25a7.5 7.5 0 0 1 15 0'],
        ['sidebarUiOptionsBtn', 'UI Options', 'sidebar-action-button', 'M10.35 4.32c.42-1.76 2.88-1.76 3.3 0l.08.33a1.7 1.7 0 0 0 2.47 1.05l.3-.17c1.54-.9 3.28.85 2.38 2.38l-.17.3a1.7 1.7 0 0 0 1.05 2.47l.33.08c1.76.42 1.76 2.88 0 3.3l-.33.08a1.7 1.7 0 0 0-1.05 2.47l.17.3c.9 1.54-.85 3.28-2.38 2.38l-.3-.17a1.7 1.7 0 0 0-2.47 1.05l-.08.33c-.42 1.76-2.88 1.76-3.3 0l-.08-.33a1.7 1.7 0 0 0-2.47-1.05l-.3.17c-1.54.9-3.28-.85-2.38-2.38l.17-.3a1.7 1.7 0 0 0-1.05-2.47l-.33-.08c-1.76-.42-1.76-2.88 0-3.3l.33-.08A1.7 1.7 0 0 0 5.3 8.2l-.17-.3c-.9-1.54.85-3.28 2.38-2.38l.3.17a1.7 1.7 0 0 0 2.47-1.05l.08-.33Z M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z'],
        ['sidebarShortcutsBtn', 'Keyboard Shortcuts', 'sidebar-action-button', 'M4.5 6.75h15v10.5h-15V6.75Zm3 7.5h.01m3 0h.01m3 0h.01m3 0h.01M7.5 9.75h.01m3 0h.01m3 0h.01m3 0h.01'],
        ['sidebarHowToGuideBtn', 'How To Guide', 'sidebar-action-button', 'M12 6.75v12M6.75 5.25h8.25A2.25 2.25 0 0 1 17.25 7.5v12H9A2.25 2.25 0 0 0 6.75 21.75V5.25Zm0 0H5.25A2.25 2.25 0 0 0 3 7.5v12a2.25 2.25 0 0 1 2.25-2.25h1.5'],
        ['sidebarSignOutBtn', 'Sign Out', 'sidebar-action-button sidebar-action-button--danger', 'M15.75 9V5.25A2.25 2.25 0 0 0 13.5 3h-6A2.25 2.25 0 0 0 5.25 5.25v13.5A2.25 2.25 0 0 0 7.5 21h6a2.25 2.25 0 0 0 2.25-2.25V15M12 12h8.25m0 0-2.25-2.25M20.25 12 18 14.25']
    ];

    actionSpecs.forEach(([id, label, className, iconPath]) => {
        let button = document.getElementById(id);
        if (!button) {
            button = document.createElement('button');
            button.type = 'button';
            button.id = id;
        }
        button.innerHTML = `
            <svg class="sidebar-action-button-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="${iconPath}"></path>
            </svg>
            <span class="sidebar-action-button-label">${label}</span>
        `;
        button.setAttribute('aria-label', label);
        button.setAttribute('title', label);
        button.className = `${className} settings-action-button`.trim();
        button.type = 'button';
        settingsActions.appendChild(button);
    });

    const legacyMoreGroup = document.getElementById('sidebarMoreToggleBtn')?.closest('.sidebar-more-group');
    if (legacyMoreGroup) {
        legacyMoreGroup.remove();
    }
}

function initializeSidebarSections() {
    ensureSidebarSettingsDropdown();
    const defaultExpandedSections = {
        workspace: true,
        leaderboard: false,
        settings: false
    };
    Object.entries(defaultExpandedSections).forEach(([sectionKey, expanded]) => {
        setSidebarSectionExpanded(sectionKey, expanded);
    });
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
        minute: '2-digit',
        hour12: true
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
        accountState.stats = normalizePersonalProgressionStats(response?.stats || accountState.stats);
        if (response?.stats) {
            state.setStats(normalizePersonalProgressionStats({ ...state.getStats(), ...accountState.stats }));
        }
        accountState.leaderboard = Array.isArray(response?.leaderboard) ? response.leaderboard : [];
        accountState.currentLeaderboardRank = response?.currentLeaderboardRank ?? null;
        accountState.currentLeaderboardEntry = response?.currentLeaderboardEntry || null;
        accountState.pendingProfilePic = null;
        applyAccountUI(accountState.user);
        syncAccountStatsToModal();
        renderLeaderboardPanel();
        queueCompetitiveAchievementNotifications([...(accountState.leaderboard || []), accountState.currentLeaderboardEntry].filter(Boolean));
        updateNotificationUnreadIndicator();
        refreshNotificationsModalIfOpen();
    } catch (err) {
        console.error('Failed to load account profile:', err);
        const fallbackUser = getCurrentUser?.() || accountState.user;
        if (fallbackUser) {
            accountState.user = fallbackUser;
            applyAccountUI(accountState.user);
            syncAccountStatsToModal();
            renderLeaderboardPanel();
            updateNotificationUnreadIndicator();
            refreshNotificationsModalIfOpen();
        }
    }
}


function loadReadNotificationKeys() {
    try {
        const raw = localStorage.getItem(LOCAL_STORAGE_KEYS.NOTIFICATIONS_READ);
        const parsed = raw ? JSON.parse(raw) : [];
        return new Set(Array.isArray(parsed) ? parsed.map(String) : []);
    } catch {
        return new Set();
    }
}

function saveReadNotificationKeys(keys) {
    try {
        localStorage.setItem(LOCAL_STORAGE_KEYS.NOTIFICATIONS_READ, JSON.stringify(Array.from(keys).slice(-500)));
    } catch {}
}

function getNotificationItemKey(item) {
    return String(item?.key || `${item?.title || 'notification'}:${item?.detail || ''}:${item?.time || ''}`);
}

function markNotificationItemsRead(items = []) {
    const readKeys = loadReadNotificationKeys();
    let changed = false;
    items.forEach(item => {
        const key = getNotificationItemKey(item);
        if (!key || readKeys.has(key)) return;
        readKeys.add(key);
        changed = true;
    });
    if (changed) saveReadNotificationKeys(readKeys);
}

function formatNotificationTime(value) {
    if (!value) return '';
    return formatCompactDateTime(value);
}

function getCompetitiveAchievementDateLabel(achievement = {}) {
    const dateValue = achievement.achievedAt || achievement.awardedAt || achievement.date || achievement.createdAt || '';
    return dateValue ? formatCompactDateTime(dateValue) : '';
}

function updateNotificationUnreadIndicator() {
    const badge = document.getElementById('notificationUnreadBadge');
    const button = document.getElementById('panelNotificationButton');
    const collapsedBadge = document.getElementById('collapsedNotificationUnreadBadge');
    const collapsedButton = document.getElementById('collapsedPanelNotificationButton');
    if (!badge || !button) return;
    const items = buildNotificationItems();
    const readKeys = loadReadNotificationKeys();
    const unreadCount = items.reduce((count, item) => count + (readKeys.has(getNotificationItemKey(item)) ? 0 : 1), 0);
    const unreadLabel = unreadCount > 99 ? '99+' : String(unreadCount);
    const buttonLabel = unreadCount > 0 ? `Open notifications, ${unreadCount} unread` : 'Open notifications';
    const buttonTitle = unreadCount > 0 ? `Notifications (${unreadCount} unread)` : 'Notifications';

    badge.textContent = unreadLabel;
    badge.classList.toggle('hidden', unreadCount <= 0);
    button.classList.toggle('has-unread', unreadCount > 0);
    button.setAttribute('aria-label', buttonLabel);
    button.setAttribute('title', buttonTitle);

    if (collapsedBadge) {
        collapsedBadge.textContent = unreadLabel;
        collapsedBadge.classList.toggle('hidden', unreadCount <= 0);
    }
    if (collapsedButton) {
        collapsedButton.classList.toggle('has-unread', unreadCount > 0);
        collapsedButton.setAttribute('aria-label', buttonLabel);
        collapsedButton.setAttribute('title', buttonTitle);
    }
}

function refreshNotificationsModalIfOpen() {
    const modal = document.getElementById('notificationsModal');
    if (!modal?.classList.contains('active')) return;
    renderNotificationsModalContent(modal, { markRead: true });
}

function buildNotificationItems() {
    const metrics = buildPersonalProgressionMetrics();
    const now = new Date();
    const dayStart = getStartOfLocalDay(now);
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);
    const weekStart = getStartOfLocalWeek(now);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 7);
    const unlockedSet = getCurrentPersonalLevelProgress().unlockedSet;
    const currentEntry = accountState.currentLeaderboardEntry || accountState.renderedLeaderboardEntries.find(entry => String(entry?.userId || '') === String(accountState.user?.id || '')) || {};
    const dailyTasks = countLocalCompletedRecords(metrics.completedTasks, dayStart, dayEnd);
    const weeklyTasks = countLocalCompletedRecords(metrics.completedTasks, weekStart, weekEnd);
    const recentProjects = state.getProjects()
        .map(normalizeProject)
        .filter(Boolean)
        .sort((a, b) => new Date(b.lastModified || 0) - new Date(a.lastModified || 0))
        .slice(0, 4);
    const recentCompletedTasks = metrics.completedTasks
        .filter(record => record.timestamp > 0)
        .sort((a, b) => b.timestamp - a.timestamp)
        .slice(0, 5);
    const items = [
        { key: `daily-tasks:${formatDateKey(dayStart) || dayStart.toISOString()}:${dailyTasks}`, title: 'Tasks completed today', detail: `${dailyTasks} task${dailyTasks === 1 ? '' : 's'} completed since midnight.`, time: now.toISOString() },
        { key: `weekly-score:${formatDateKey(weekStart) || weekStart.toISOString()}:${weeklyTasks}`, title: 'Leaderboard score', detail: `${weeklyTasks} task${weeklyTasks === 1 ? '' : 's'} completed since Sunday at 12:00 AM.`, time: now.toISOString() },
        { key: `personal-achievements:${unlockedSet.size}`, title: 'Personal achievements', detail: `${unlockedSet.size} of ${PERSONAL_ACHIEVEMENTS.length} unlocked.`, time: now.toISOString() }
    ];
    if (Array.isArray(currentEntry.competitiveAchievements) && currentEntry.competitiveAchievements.length) {
        const latestCompetitiveDate = currentEntry.competitiveAchievements
            .map(achievement => achievement.achievedAt || achievement.awardedAt || achievement.date || '')
            .filter(Boolean)
            .sort((a, b) => new Date(b || 0) - new Date(a || 0))[0] || now.toISOString();
        items.push({
            key: `competitive-achievements:${currentEntry.competitiveAchievements.map(achievement => achievement.notificationKey || achievement.id || achievement.name).join('|')}`,
            title: 'Competitive achievements',
            detail: currentEntry.competitiveAchievements.map(achievement => {
                const name = achievement.name || getCompetitiveAchievementFallback(achievement.id).name;
                const dateLabel = getCompetitiveAchievementDateLabel(achievement);
                return dateLabel ? `${name} (${dateLabel})` : name;
            }).join(', '),
            time: latestCompetitiveDate
        });
    }
    recentCompletedTasks.forEach(record => {
        items.push({
            key: `task:${record.project?.id || ''}:${record.task?.id || ''}:${record.timestamp || ''}`,
            title: 'Task completed',
            detail: `${record.task?.text || 'Untitled task'}${record.project?.title ? ` • ${record.project.title}` : ''}`,
            time: record.timestamp ? new Date(record.timestamp).toISOString() : ''
        });
    });
    recentProjects.forEach(project => {
        const projectTime = project.lastModified || project.dateCreated || '';
        items.push({
            key: `project:${project.id || project._id || project.title}:${projectTime}`,
            title: 'Project updated',
            detail: `${project.title} • ${timeAgo(projectTime)}`,
            time: projectTime
        });
    });
    return items;
}

function ensureNotificationsModal() {
    let modal = document.getElementById('notificationsModal');
    if (modal) return modal;
    modal = document.createElement('div');
    modal.className = 'modal-overlay notifications-modal';
    modal.id = 'notificationsModal';
    modal.addEventListener('click', event => {
        if (event.target === modal) closeNotificationsModal();
    });
    document.body.appendChild(modal);
    return modal;
}

function renderNotificationsModalContent(modal, options = {}) {
    if (!modal) return;
    const items = buildNotificationItems();
    if (options.markRead) markNotificationItemsRead(items);
    const readKeys = loadReadNotificationKeys();
    modal.innerHTML = `
        <div class="modal-content notifications-modal-content" role="dialog" aria-modal="true" aria-labelledby="notificationsModalTitle">
            <div class="account-modal-scroll">
                <div class="leaderboard-profile-modal-header">
                    <div>
                        <h2 class="leaderboard-profile-heading" id="notificationsModalTitle">Notifications</h2>
                        <p class="account-modal-subtitle">Tasks, projects, achievements, and leaderboard updates</p>
                    </div>
                    <button class="modal-close leaderboard-profile-close" type="button" onclick="closeNotificationsModal()" aria-label="Close notifications">
                        <svg class="icon-lg" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
                        </svg>
                    </button>
                </div>
                <div class="notifications-modal-list">
                    ${items.length ? items.map(item => {
                        const itemKey = getNotificationItemKey(item);
                        const unreadClass = readKeys.has(itemKey) ? '' : ' notification-card--unread';
                        const timeLabel = formatNotificationTime(item.time);
                        return `
                            <div class="notification-card${unreadClass}">
                                <div class="notification-card-header">
                                    <span class="notification-project">${escapeHtml(item.title)}</span>
                                    ${timeLabel ? `<span class="notification-time">${escapeHtml(timeLabel)}</span>` : ''}
                                </div>
                                <div class="notification-message">${escapeHtml(item.detail)}</div>
                            </div>
                        `;
                    }).join('') : '<div class="side-panel-empty">No notifications yet</div>'}
                </div>
            </div>
        </div>
    `;
    if (options.markRead) updateNotificationUnreadIndicator();
}

function openNotificationsModal() {
    closeMobileWebSidebarForModal();
    const modal = ensureNotificationsModal();
    renderNotificationsModalContent(modal, { markRead: true });
    modal.classList.add('active');
}

function closeNotificationsModal() {
    document.getElementById('notificationsModal')?.classList.remove('active');
}

function openAccountSettingsModal() {
    closeMobileWebSidebarForModal();
    applyAccountUI(accountState.user || getCurrentUser() || { username: 'User', email: '' });
    syncAccountStatsToModal();
    setAccountStatus('');
    document.getElementById('accountSettingsModal')?.classList.add('active');
}

function closeAccountSettingsModal() {
    accountState.pendingProfilePic = null;
    setAccountStatus('');
    document.getElementById('accountSettingsModal')?.classList.remove('active');
    handleSidebarSettingsChildClosed('accountSettingsModal');
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
    const tab = ['tasks', 'notes', 'members', 'history', 'calendar'].includes(modalState.activeTab) ? modalState.activeTab : 'tasks';
    switchModalTab(projectId, tab);
    restoreProjectModalScrollPosition(projectId, modalState);
}

function restoreProjectModalScrollPosition(projectId, modalState) {
    if (!modalState || String(modalState.projectId) !== String(projectId)) return;
    const scrollEl = document.querySelector('#modalContent .modal-scroll-inner');
    if (!scrollEl) return;
    const scrollTop = modalState.scrollTop || 0;
    scrollEl.scrollTop = scrollTop;
    requestAnimationFrame(() => {
        scrollEl.scrollTop = scrollTop;
    });
}

function getProjectModalActiveTab(projectId) {
    const activeTab = document.querySelector(`#modalContent .modal-tab.active`);
    if (!activeTab) return 'tasks';
    const suffix = `-tab-${projectId}`;
    if (activeTab.id.endsWith(suffix)) {
        const tabName = activeTab.id.slice(0, -suffix.length);
        return ['tasks', 'notes', 'members', 'history', 'calendar'].includes(tabName) ? tabName : 'tasks';
    }
    return activeTab.id.replace(/-(.+)$/, '').split('-')[0] || 'tasks';
}

function saveOpenProjectModalState(projectId, activeTab = null) {
    const normalizedProjectId = String(projectId || '');
    if (!normalizedProjectId) return;
    try {
        const scrollEl = document.querySelector('#modalContent .modal-scroll-inner');
        sessionStorage.setItem(SESSION_STORAGE_KEYS.OPEN_PROJECT_MODAL, JSON.stringify({
            projectId: normalizedProjectId,
            activeTab: activeTab || getProjectModalActiveTab(normalizedProjectId),
            scrollTop: scrollEl?.scrollTop || 0
        }));
    } catch (err) {
        console.warn('Failed to save open project modal state:', err);
    }
}

function clearOpenProjectModalState() {
    try {
        sessionStorage.removeItem(SESSION_STORAGE_KEYS.OPEN_PROJECT_MODAL);
    } catch (err) {
        console.warn('Failed to clear open project modal state:', err);
    }
}

function getSavedOpenProjectModalState() {
    try {
        const raw = sessionStorage.getItem(SESSION_STORAGE_KEYS.OPEN_PROJECT_MODAL);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        const projectId = String(parsed?.projectId || '');
        if (!projectId) return null;
        const activeTab = ['tasks', 'notes', 'members', 'history', 'calendar'].includes(parsed?.activeTab) ? parsed.activeTab : 'tasks';
        return {
            projectId,
            activeTab,
            scrollTop: Number(parsed?.scrollTop || 0) || 0
        };
    } catch (err) {
        console.warn('Failed to load open project modal state:', err);
        return null;
    }
}

function restoreOpenProjectModalFromSession() {
    const modalState = getSavedOpenProjectModalState();
    if (!modalState) return;
    const project = state.findProject(modalState.projectId);
    if (!project) {
        clearOpenProjectModalState();
        return;
    }
    openProjectModal(project.id, { restoreState: modalState });
}

function persistOpenProjectModalBeforeUnload() {
    const projectId = getOpenProjectModalId();
    if (projectId) saveOpenProjectModalState(projectId);
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
        state.setStats(normalizePersonalProgressionStats(data?.stats || { completedTasks: 0, completedProjects: 0 }));
        syncDerivedCompletedProjectStats();
        evaluatePersonalProgression({ showModals: false, persistStatsOnly: true });
        render();
        restoreOpenProjectModalFromSession();
    } catch (err) {
        console.error('Failed to load project data:', err);
        state.setProjects([]);
        state.setStats(normalizePersonalProgressionStats({ completedTasks: 0, completedProjects: 0 }));
        render();
        setSaveStatus('error', 'Could not load projects');
    }
}

function getOpenProjectModalId() {
    const modal = document.getElementById('projectModal');
    if (!modal?.classList.contains('active')) return null;
    const progressBar = document.querySelector('#modalContent [data-progress-bar]');
    return progressBar?.getAttribute('data-progress-bar') || null;
}

function upsertRealtimeProject(projectPayload) {
    const normalizedIncoming = normalizeProject(projectPayload);
    if (!normalizedIncoming) return;

    const existing = state.getProjects().find(project =>
        String(project.id) === String(normalizedIncoming.id) ||
        String(project._id || '') === String(normalizedIncoming._id || '')
    );
    if (existing && isIncomingRealtimeProjectStale(existing, normalizedIncoming)) return;

    const incoming = mergeRealtimeProjectWithExisting(existing, normalizedIncoming, projectPayload);
    const openProjectId = getOpenProjectModalId();
    const shouldRestoreModal = openProjectId && existing && String(existing.id) === String(openProjectId);
    const modalState = shouldRestoreModal ? captureProjectModalState(existing.id) : null;

    if (existing) {
        state.updateProject(existing.id, projectUpdate({
            ...incoming,
            __syncedLastModified: incoming.lastModified || incoming.__syncedLastModified || null
        }, { skipTouch: true }));
    } else {
        state.addProject({
            ...incoming,
            __syncedLastModified: incoming.lastModified || incoming.__syncedLastModified || null
        });
    }

    render();
    updateTotalCompletion();

    if (modalState) {
        openProjectModal(incoming.id, { restoreState: modalState });
    }
}

function removeRealtimeProject(projectId) {
    const id = String(projectId || '');
    if (!id) return;

    const existing = state.getProjects().find(project =>
        String(project.id) === id || String(project._id || '') === id
    );
    if (!existing) return;

    const openProjectId = getOpenProjectModalId();
    state.setProjects(state.getProjects().filter(project => project !== existing));

    if (openProjectId && String(openProjectId) === String(existing.id)) {
        closeProjectModal();
    } else {
        render();
    }
    updateTotalCompletion();
}


const RECENT_LOCAL_TASK_SYNC_GUARD_MS = 60000;
const RECENT_LOCAL_PROJECT_NOTES_SYNC_GUARD_MS = 60000;
const recentLocalTaskSnapshots = new Map();
const recentLocalProjectNotesSnapshots = new Map();

function getProjectIdentityKeys(projectOrId) {
    const keys = new Set();
    if (projectOrId && typeof projectOrId === 'object') {
        if (projectOrId.id !== undefined && projectOrId.id !== null) keys.add(String(projectOrId.id));
        if (projectOrId._id !== undefined && projectOrId._id !== null) keys.add(String(projectOrId._id));
    } else if (projectOrId !== undefined && projectOrId !== null) {
        keys.add(String(projectOrId));
        const project = state.findProject?.(projectOrId);
        if (project?.id !== undefined && project.id !== null) keys.add(String(project.id));
        if (project?._id !== undefined && project._id !== null) keys.add(String(project._id));
    }
    return [...keys].filter(Boolean);
}

function rememberRecentLocalTaskSnapshot(projectOrId, tasks = []) {
    const normalizedTasks = Array.isArray(tasks) ? tasks.map((task, index) => normalizeTask(task, index)) : [];
    if (!normalizedTasks.length) return;
    const snapshot = {
        tasks: normalizedTasks,
        expiresAt: Date.now() + RECENT_LOCAL_TASK_SYNC_GUARD_MS
    };
    getProjectIdentityKeys(projectOrId).forEach(key => {
        recentLocalTaskSnapshots.set(key, snapshot);
    });
}

function getRecentLocalTaskSnapshot(projectOrId) {
    const now = Date.now();
    for (const key of getProjectIdentityKeys(projectOrId)) {
        const snapshot = recentLocalTaskSnapshots.get(key);
        if (!snapshot) continue;
        if (snapshot.expiresAt <= now) {
            recentLocalTaskSnapshots.delete(key);
            continue;
        }
        return snapshot.tasks.map((task, index) => normalizeTask(task, index));
    }
    return null;
}

function rememberRecentLocalProjectNotesSnapshot(projectOrId, notes = '') {
    const normalizedNotes = normalizeProjectNotesValue(notes);
    const snapshot = {
        notes: normalizedNotes,
        expiresAt: Date.now() + RECENT_LOCAL_PROJECT_NOTES_SYNC_GUARD_MS
    };
    getProjectIdentityKeys(projectOrId).forEach(key => {
        recentLocalProjectNotesSnapshots.set(key, snapshot);
    });
}

function getRecentLocalProjectNotesSnapshot(projectOrId) {
    const now = Date.now();
    for (const key of getProjectIdentityKeys(projectOrId)) {
        const snapshot = recentLocalProjectNotesSnapshots.get(key);
        if (!snapshot) continue;
        if (snapshot.expiresAt <= now) {
            recentLocalProjectNotesSnapshots.delete(key);
            continue;
        }
        return normalizeProjectNotesValue(snapshot.notes);
    }
    return null;
}

function taskPayloadHasNoteField(task = {}) {
    return !!task && typeof task === 'object' && (
        Object.prototype.hasOwnProperty.call(task, 'note') ||
        Object.prototype.hasOwnProperty.call(task, 'notes')
    );
}

function mergeTaskNotesFromExisting(incomingTasks = [], existingTasks = [], rawTasks = null) {
    if (!Array.isArray(incomingTasks) || !Array.isArray(existingTasks) || !existingTasks.length) {
        return Array.isArray(incomingTasks) ? incomingTasks : [];
    }

    const existingById = new Map(existingTasks.map((task, index) => {
        const normalizedTask = normalizeTask(task, index);
        return [String(normalizedTask.id), normalizedTask];
    }));

    return incomingTasks.map((task, index) => {
        const normalizedTask = normalizeTask(task, index);
        const rawTask = Array.isArray(rawTasks) ? rawTasks[index] : task;
        const existingTask = existingById.get(String(normalizedTask.id));
        const existingNote = sanitizeRichTextHtml(existingTask?.note || '').trim();
        const incomingNote = sanitizeRichTextHtml(normalizedTask.note || '').trim();
        const rawHasNote = taskPayloadHasNoteField(rawTask);

        if (!rawHasNote && !incomingNote && existingNote) {
            return { ...normalizedTask, note: existingNote };
        }
        return normalizedTask;
    });
}


function isRealtimeFromCurrentUser(payload = {}) {
    const sourceUserId = payload?.sourceUserId ? String(payload.sourceUserId) : '';
    const currentUserId = String(state.getCurrentUser?.()?.id || getCurrentUser?.()?.id || '');
    return !!sourceUserId && !!currentUserId && sourceUserId === currentUserId;
}

function getProjectTimestampValue(value) {
    const timestamp = Date.parse(String(value || ''));
    return Number.isFinite(timestamp) ? timestamp : 0;
}

function isIncomingRealtimeProjectStale(existingProject, incomingProject) {
    if (!existingProject || !incomingProject) return false;
    const existingModified = getProjectTimestampValue(existingProject.lastModified || existingProject.__syncedLastModified || existingProject.updatedAt);
    const incomingModified = getProjectTimestampValue(incomingProject.lastModified || incomingProject.__syncedLastModified || incomingProject.updatedAt);
    return Boolean(existingModified && incomingModified && incomingModified < existingModified);
}

function realtimePayloadHasField(payload, ...fieldNames) {
    if (!payload || typeof payload !== 'object') return false;
    return fieldNames.some(fieldName => Object.prototype.hasOwnProperty.call(payload, fieldName));
}

function mergeRealtimeProjectWithExisting(existingProject, incomingProject, rawPayload = {}) {
    if (!existingProject || !incomingProject) return incomingProject;
    const mergedProject = { ...incomingProject };

    // If the local project has been modified after its last server sync
    // (lastModified > __syncedLastModified), those edits are still in-flight
    // or queued. Overwriting tasks/categories/notes from a realtime snapshot
    // that pre-dates those changes would briefly remove locally-added data
    // until the queued save completes. Preserve the local copy in that window.
    const localModified = getProjectTimestampValue(existingProject.lastModified);
    const localSynced   = getProjectTimestampValue(existingProject.__syncedLastModified);
    const hasLocalUnsynced = localModified > 0 && localSynced > 0 && localModified > localSynced;

    const recentTaskSnapshot = getRecentLocalTaskSnapshot(existingProject);
    const existingTasks = Array.isArray(existingProject.tasks) ? existingProject.tasks : [];
    const rawTasks = rawPayload?.tasks;
    const incomingTasks = Array.isArray(rawTasks) ? rawTasks : (Array.isArray(incomingProject.tasks) ? incomingProject.tasks : null);
    const incomingTasksLookLikeTransientEmpty = realtimePayloadHasField(rawPayload, 'tasks')
        && Array.isArray(incomingTasks)
        && incomingTasks.length === 0
        && existingTasks.length > 0
        && Array.isArray(recentTaskSnapshot)
        && recentTaskSnapshot.length > 0;

    if (!realtimePayloadHasField(rawPayload, 'tasks') || hasLocalUnsynced || incomingTasksLookLikeTransientEmpty) {
        mergedProject.tasks = Array.isArray(recentTaskSnapshot) && recentTaskSnapshot.length ? recentTaskSnapshot : existingTasks;
    } else if (Array.isArray(mergedProject.tasks)) {
        mergedProject.tasks = mergeTaskNotesFromExisting(mergedProject.tasks, existingTasks, rawTasks);
    }
    if (!realtimePayloadHasField(rawPayload, 'taskCategories') || hasLocalUnsynced) {
        mergedProject.taskCategories = Array.isArray(existingProject.taskCategories) ? existingProject.taskCategories : [];
    }
    const recentNotesSnapshot = getRecentLocalProjectNotesSnapshot(existingProject);
    const existingNotesValue = getProjectNotesValueFromProject(existingProject);
    if (!realtimePayloadHasField(rawPayload, 'notes', 'projectNotes', 'notesData', 'noteTabs', 'noteTabsData', 'note', 'projectNote') || hasLocalUnsynced || recentNotesSnapshot !== null) {
        mergedProject.notes = recentNotesSnapshot !== null
            ? recentNotesSnapshot
            : existingNotesValue;
    } else {
        const incomingNotesValue = getProjectNotesValueFromProject({
            ...incomingProject,
            notes: mergedProject.notes ?? rawPayload.notes ?? incomingProject.notes,
            projectNotes: rawPayload.projectNotes ?? incomingProject.projectNotes,
            notesData: rawPayload.notesData ?? incomingProject.notesData,
            noteTabs: rawPayload.noteTabs ?? incomingProject.noteTabs,
            noteTabsData: rawPayload.noteTabsData ?? incomingProject.noteTabsData,
            note: rawPayload.note ?? incomingProject.note,
            projectNote: rawPayload.projectNote ?? incomingProject.projectNote
        });
        mergedProject.notes = projectHasNotes(incomingNotesValue) || !projectHasNotes(existingNotesValue)
            ? incomingNotesValue
            : existingNotesValue;
    }
    if (!realtimePayloadHasField(rawPayload, 'calendarNotes', 'projectCalendarNotes') || hasLocalUnsynced) {
        mergedProject.calendarNotes = normalizeProjectCalendarNotes(existingProject.calendarNotes || existingProject.projectCalendarNotes || {});
    }
    if (!realtimePayloadHasField(rawPayload, 'tags', 'projectTags') || hasLocalUnsynced) {
        mergedProject.tags = normalizeProjectTags(existingProject.tags || existingProject.projectTags || []);
    }

    return mergedProject;
}

function startRealtimeSync() {
    connectRealtime({
        onProjectUpsert: (project, payload) => {
            if (!isRealtimeFromCurrentUser(payload)) upsertRealtimeProject(project);
        },
        onProjectDelete: (projectId, payload) => {
            if (!isRealtimeFromCurrentUser(payload)) removeRealtimeProject(projectId);
        },
        onError: (err) => console.warn('Realtime connection unavailable:', err?.message || err)
    });
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
            evaluatePersonalProgression({ showModals: true });
            finalResult = await saveDataToServer(state.getProjects(), syncDerivedCompletedProjectStats());
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
                    refreshProjectHistoryIfPresent(projectId);
                });
            }
            try {
                await refreshAccountProfile();
            } catch (err) {
                console.error('Failed to refresh account profile after save:', err);
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
    const panel = document.getElementById('newProjectCreatePanel');
    const nameInput = document.getElementById('newProjectTitleInput');
    const descriptionInput = document.getElementById('newProjectDescriptionInput');

    if (panel && descriptionInput) {
        if (panel.classList.contains('hidden')) {
            showNewProjectCreatePanel();
            return;
        }

        const projectTitle = normalizeProjectTitleInput(nameInput?.value);
        if (!validateProjectTitleInput(nameInput)) return;

        const description = normalizeProjectDescription(descriptionInput.value);

        await createProjectWithDescription(description, projectTitle);
        resetNewProjectCreatePanel();
        return;
    }
}

function normalizeProjectTitleInput(value) {
    return decodeHtmlEntities(value).trim().replace(/\s+/g, ' ');
}

function getProjectTitleWarningMessage(value) {
    const title = normalizeProjectTitleInput(value) || 'New Project';
    return title.length > PROJECT_TITLE_MAX_LENGTH
        ? `Project title must be ${PROJECT_TITLE_MAX_LENGTH} characters or fewer.`
        : '';
}

function showProjectTitleWarning(input, message = '') {
    if (!input) return;
    let warning = input.nextElementSibling;
    if (!warning || !warning.classList?.contains('project-title-warning')) {
        warning = document.createElement('div');
        warning.className = 'project-title-warning hidden';
        input.insertAdjacentElement('afterend', warning);
    }
    warning.textContent = message;
    warning.classList.toggle('hidden', !message);
    input.classList.toggle('has-error', Boolean(message));
}

function triggerProjectTitleShake(input) {
    if (!input) return;
    input.classList.remove('project-title-shake');
    void input.offsetWidth;
    input.classList.add('project-title-shake');
}

function handleProjectTitleInput(input) {
    if (!input) return true;
    const rawValue = String(input.value ?? '');
    const normalizedValue = normalizeProjectTitleInput(rawValue);
    if (normalizedValue.length > PROJECT_TITLE_MAX_LENGTH) {
        const caretPosition = input.selectionStart || rawValue.length;
        input.value = rawValue.slice(0, Math.max(0, PROJECT_TITLE_MAX_LENGTH));
        const nextCaret = Math.min(input.value.length, caretPosition - 1);
        try { input.setSelectionRange(nextCaret, nextCaret); } catch { /* noop */ }
        const message = `Project title must be ${PROJECT_TITLE_MAX_LENGTH} characters or fewer.`;
        showProjectTitleWarning(input, message);
        triggerProjectTitleShake(input);
        return false;
    }
    const message = getProjectTitleWarningMessage(input.value);
    if (message) {
        showProjectTitleWarning(input, message);
        triggerProjectTitleShake(input);
        return false;
    }
    clearProjectTitleWarning(input);
    return true;
}

function clearProjectTitleWarning(input) {
    if (!input) return;
    input.classList.remove('has-error');
    const warning = input.nextElementSibling;
    if (warning?.classList?.contains('project-title-warning')) {
        warning.classList.add('hidden');
        warning.textContent = '';
    }
}

function validateProjectTitleInput(input) {
    const message = getProjectTitleWarningMessage(input?.value);
    showProjectTitleWarning(input, message);
    if (message && input) {
        triggerProjectTitleShake(input);
        input.focus({ preventScroll: true });
    }
    return !message;
}

async function createProjectWithDescription(descriptionValue = '', projectTitle = '') {
    const tempId = Date.now();
    const createdAt = new Date().toISOString();
    const newProject = {
        id: tempId,
        title: projectTitle || 'New Project',
        tasks: [],
        dateCreated: createdAt,
        lastModified: createdAt,
        priority: state.getProjects().length,
        projectPriorityTag: DEFAULT_TASK_TAG,
        dueDate: '',
        completed: false,
        notes: '',
        calendarNotes: {},
        description: descriptionValue,
        tags: [],
        taskCategories: [],
        userRole: 'owner',
        collaborators: []
    };

    state.addProject(newProject);
    evaluatePersonalProgression({ showModals: true, persistStatsOnly: true });
    render();

    // Create on server and get the MongoDB _id back
    const created = await createProjectOnServer(newProject);
    if (created) {
        state.updateProject(tempId, projectUpdate({
            _id: created._id || created.id,
            id:  created.id  || created._id,
            lastModified: created.lastModified || createdAt,
            __syncedLastModified: created.lastModified || createdAt,
            description: typeof created.description === 'string' ? created.description : descriptionValue,
            projectPriorityTag: getProjectPriorityTag(created),
            dueDate: getProjectDueDate(created),
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
    }, 150);
}

function showNewProjectCreatePanel() {
    const panel = document.getElementById('newProjectCreatePanel');
    const nameInput = document.getElementById('newProjectTitleInput');
    const descriptionInput = document.getElementById('newProjectDescriptionInput');
    if (!panel || !descriptionInput) return;
    panel.classList.remove('hidden');
    showNewProjectDescriptionWarning(false);
    if (nameInput && !nameInput.__projectTitleWarningBound) {
        nameInput.__projectTitleWarningBound = true;
        nameInput.addEventListener('input', () => handleProjectTitleInput(nameInput));
        nameInput.addEventListener('animationend', () => nameInput.classList.remove('project-title-shake'));
    }
    requestAnimationFrame(() => (nameInput || descriptionInput).focus({ preventScroll: true }));
}

function resetNewProjectCreatePanel() {
    const panel = document.getElementById('newProjectCreatePanel');
    const nameInput = document.getElementById('newProjectTitleInput');
    const descriptionInput = document.getElementById('newProjectDescriptionInput');
    if (nameInput) nameInput.value = '';
    if (descriptionInput) descriptionInput.value = '';
    clearProjectTitleWarning(nameInput);
    if (panel) panel.classList.add('hidden');
    showNewProjectDescriptionWarning(false);
}

function showNewProjectDescriptionWarning(show = true) {
    const input = document.getElementById('newProjectDescriptionInput');
    const warning = document.getElementById('newProjectDescriptionWarning');
    input?.classList.toggle('has-error', Boolean(show));
    warning?.classList.toggle('hidden', !show);
}

function deleteProject(projectId) {
    if (!state.isOwner(projectId)) {
        alert('Only the project owner can delete it.');
        return;
    }
    const project = state.findProject(projectId);
    const mongoId = project?._id;

    if (isProjectCompleted(project)) state.decrementCompletedProjects();
    const completedTasks = project?.tasks.filter(t => isTaskCompleted(t)).length || 0;
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
    
    const newCompleted = !isProjectCompleted(project);
    if (newCompleted) {
        state.incrementCompletedProjects();
    } else {
        state.decrementCompletedProjects();
    }
    
    const identity = getCurrentUserIdentity();
    state.updateProject(projectId, projectUpdate({
        completed: newCompleted,
        completedDate: newCompleted ? new Date().toISOString() : null,
        completedBy: newCompleted ? identity.id : '',
        completedByName: newCompleted ? identity.name : ''
    }));
    
    saveData();
    refreshProjectCalendarIfPresent(projectId);
    render();
}

function normalizeProjectDescription(value) {
    return decodeHtmlEntities(value).trim().replace(/\s+/g, ' ').slice(0, 280);
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

function updateProjectDetails(projectId, details = {}) {
    if (!state.canEdit(projectId)) return false;
    const trimmedTitle = normalizeProjectTitleInput(details.title);
    const cleanTitle = trimmedTitle || 'New Project';
    if (getProjectTitleWarningMessage(cleanTitle)) return false;
    const description = normalizeProjectDescription(details.description);
    state.updateProject(projectId, projectUpdate({ title: cleanTitle, description }));
    saveData();
    render();
    return true;
}

function updateProjectTitle(projectId, newTitle) {
    const project = state.findProject(projectId);
    updateProjectDetails(projectId, {
        title: newTitle,
        description: project?.description || ''
    });
}

function updateProjectDescription(projectId, descriptionValue) {
    if (!state.canEdit(projectId)) return;
    const project = state.findProject(projectId);
    if (!project) return;
    const description = normalizeProjectDescription(descriptionValue);
    if (description === (project.description || '')) return;
    state.updateProject(projectId, projectUpdate({ description }));
    saveData();
}

function getProjectNotesDataForProject(projectId) {
    const project = state.findProject(projectId);
    return normalizeProjectNotesData(getProjectNotesValueFromProject(project));
}

function stageProjectNotesData(projectId, data, options = {}) {
    if (!state.canEdit(projectId)) return '';
    const serializedNotes = serializeProjectNotesData(data);
    rememberRecentLocalProjectNotesSnapshot(projectId, serializedNotes);
    state.updateProject(projectId, projectUpdate({ notes: serializedNotes }));
    updateProjectNotesIndicators(projectId, serializedNotes);
    if (options.persist) saveData();
    return serializedNotes;
}

function saveProjectNotesData(projectId, data, options = {}) {
    const serializedNotes = stageProjectNotesData(projectId, data);
    if (!serializedNotes) return;
    saveData();

    if (options.renderSurface) {
        renderProjectNotesSurface(projectId, options.renderSurface);
    }
}

function reorderProjectNoteTabs(projectId, surface = 'modal', orderedTabIds = []) {
    if (!state.canEdit(projectId)) return;
    const safeSurface = String(surface || 'modal');
    let data = getProjectNotesDataForProject(projectId);
    data = captureActiveProjectNoteEdits(projectId, safeSurface, data);

    const existingIds = data.tabs.map(tab => String(tab.id));
    const nextIds = normalizeOrderedList(orderedTabIds, existingIds);
    if (existingIds.join('|') === nextIds.join('|')) {
        renderProjectNotesSurface(projectId, safeSurface);
        return;
    }

    const tabsById = new Map(data.tabs.map(tab => [String(tab.id), tab]));
    data.tabs = nextIds.map(id => tabsById.get(id)).filter(Boolean);
    if (!data.tabs.some(tab => tab.id === data.activeTabId)) {
        data.activeTabId = data.tabs[0]?.id || '';
    }
    saveProjectNotesData(projectId, data, { renderSurface: safeSurface });
}

function updateProjectNotes(projectId, notes) {
    const data = normalizeProjectNotesData(notes);
    saveProjectNotesData(projectId, data);
}

function updateProjectNotesIndicators(projectId, notesValue = null) {
    const project = state.findProject(projectId);
    const notes = notesValue ?? project?.notes ?? '';
    const hasNotes = projectHasNotes(notes);
    const preview = formatProjectNotesPreview(notes);

    document.querySelectorAll(`[data-project-notes-button="${projectId}"]`).forEach(button => {
        button.classList.toggle('has-note', hasNotes);
        button.setAttribute('title', hasNotes ? preview : 'Add project notes');
        button.setAttribute('aria-label', hasNotes ? 'Edit project notes' : 'Add project notes');
    });

    const modalTab = document.getElementById(`notes-tab-${projectId}`);
    if (modalTab) {
        modalTab.classList.toggle('has-note', hasNotes);
        modalTab.setAttribute('title', hasNotes ? preview : 'Project notes');
    }
}

function updateProjectCardNotesPreview(projectId, notes) {
    updateProjectNotesIndicators(projectId, notes);
}

function getProjectNotesActiveTab(projectId) {
    const data = getProjectNotesDataForProject(projectId);
    return data.tabs.find(tab => tab.id === data.activeTabId) || data.tabs[0] || createDefaultProjectNotesTab('');
}

function normalizeProjectNoteHref(value = '') {
    const rawHref = decodeHtmlEntities(value).trim();
    if (!rawHref) return '';
    const href = rawHref.toLowerCase().startsWith('www.') ? `https://${rawHref}` : rawHref;
    if (!/^(https?:\/\/|mailto:)/i.test(href)) return '';
    return href.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 500);
}

function expandProjectNoteLinkCandidates(links = []) {
    if (!links) return [];
    if (Array.isArray(links)) return links;
    if (typeof links === 'string') {
        const raw = links.trim();
        if (!raw) return [];
        if ((raw.startsWith('[') && raw.endsWith(']')) || (raw.startsWith('{') && raw.endsWith('}'))) {
            try {
                return expandProjectNoteLinkCandidates(JSON.parse(raw));
            } catch {
                return [raw];
            }
        }
        return [raw];
    }
    if (typeof links === 'object') {
        const nested = links.links ?? links.hyperlinks ?? links.urls ?? links.urlList ?? links.items ?? links.entries;
        if (nested && nested !== links) return expandProjectNoteLinkCandidates(nested);
        return Object.entries(links).map(([key, value]) => {
            if (value && typeof value === 'object') {
                return { label: value.label ?? value.text ?? value.title ?? value.name ?? key, ...value };
            }
            return { label: key, href: value };
        });
    }
    return [];
}

function normalizeProjectNoteLinks(links = []) {
    const candidates = expandProjectNoteLinkCandidates(links);
    const seen = new Set();
    return candidates
        .map((link, index) => {
            const fallbackId = `link-${Date.now()}-${index}`;
            const source = link && typeof link === 'object' ? link : { href: link, label: link };
            const id = String(source.id || source._id || source.key || fallbackId).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 48) || fallbackId;
            const href = normalizeProjectNoteHref(
                source.href ??
                source.url ??
                source.link ??
                source.linkUrl ??
                source.linkURL ??
                source.webUrl ??
                source.webURL ??
                source.address ??
                source.uri ??
                source.to ??
                source.value ??
                ''
            );
            const label = decodeHtmlEntities(source.label ?? source.text ?? source.title ?? source.name ?? source.displayText ?? source.caption ?? '')
                .trim()
                .replace(/\s+/g, ' ')
                .slice(0, 80);
            if (!label && !href) return null;
            const safeLabel = label || href;
            const key = href ? href.toLowerCase() : `${safeLabel.toLowerCase()}|${index}`;
            if (seen.has(key)) return null;
            seen.add(key);
            return { id, label: safeLabel, href };
        })
        .filter(Boolean)
        .slice(0, 20);
}

function addUniqueProjectNoteLink(target, seen, link) {
    const normalized = normalizeProjectNoteLinks([link])[0];
    if (!normalized?.href) return;
    const key = normalized.href.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    target.push({ ...normalized, id: normalized.id || `legacy-${target.length}` });
}

function extractLinksFromText(text = '') {
    const rawText = String(text ?? '');
    const links = [];
    const seen = new Set();
    let match;

    const anchorPattern = /<a\b[^>]*?href\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>([\s\S]*?)<\/a>/gi;
    while ((match = anchorPattern.exec(rawText)) !== null) {
        const href = decodeHtmlEntities(match[2] || match[3] || match[4] || '');
        const label = getRichTextPlainText(match[5] || '').trim() || href;
        addUniqueProjectNoteLink(links, seen, { id: `legacy-anchor-${links.length}`, href, label });
    }

    const markdownPattern = /\[([^\]\n]+)\]\(((?:https?:\/\/|www\.|mailto:)[^)\s]+)\)/gi;
    while ((match = markdownPattern.exec(rawText)) !== null) {
        addUniqueProjectNoteLink(links, seen, { id: `legacy-markdown-${links.length}`, href: match[2], label: match[1] });
    }

    const plainText = getRichTextPlainText(rawText || '');
    const urlPattern = /\b((?:https?:\/\/|www\.)[^\s<>"']+)/gi;
    while ((match = urlPattern.exec(plainText)) !== null) {
        const label = match[1].replace(/[),.;:!?]+$/g, '');
        if (!label) continue;
        addUniqueProjectNoteLink(links, seen, { id: `legacy-url-${links.length}`, href: label, label });
    }

    return links;
}

function collectProjectNoteLinksFromSurface(tabId, surface = 'modal') {
    const safeSurface = String(surface || 'modal').replace(/[^a-zA-Z0-9_-]/g, '');
    return Array.from(document.querySelectorAll(`[data-project-notes-links="${safeSurface}"][data-tab-id="${tabId}"] [data-project-note-link-row]`))
        .map((row, index) => {
            const labelControl = row.querySelector('[data-project-note-link-label]');
            const urlControl = row.querySelector('[data-project-note-link-url]');
            return {
                id: row.getAttribute('data-link-id') || `link-${Date.now()}-${index}`,
                label: labelControl?.value || labelControl?.getAttribute('data-project-note-link-label') || labelControl?.textContent || '',
                href: urlControl?.value || urlControl?.getAttribute('data-project-note-link-url') || urlControl?.getAttribute('href') || ''
            };
        });
}

function renderProjectNotesLinksMarkup(projectId, tabId, links = [], canEdit = false, surface = 'modal', legacyText = '') {
    const safeLinks = normalizeProjectNoteLinks(links);
    const linkedItems = safeLinks.filter(link => link.href);
    const legacyLinks = [];
    if (!canEdit && !linkedItems.length && !legacyLinks.length) return '';

    const safeSurface = String(surface || 'modal').replace(/[^a-zA-Z0-9_-]/g, '');
    const linkTags = linkedItems.map(link => `
        <span class="project-notes-link-chip" data-project-note-link-row data-link-id="${escapeHtml(link.id)}">
            <a class="project-notes-link project-notes-link--tag project-card-tag"
               href="${escapeHtml(link.href)}"
               target="_blank"
               rel="noopener noreferrer"
               data-project-note-link-label="${escapeHtml(link.label)}"
               data-project-note-link-url="${escapeHtml(link.href)}">${escapeHtml(link.label)}</a>
            ${canEdit ? `<button class="project-notes-edit-link project-notes-edit-link--tag" type="button" onclick="editProjectNoteLink('${projectId}', '${tabId}', '${link.id}', '${safeSurface}', event)" aria-label="Edit link" title="Edit link"><svg class="icon" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path></svg></button>` : ''}
        </span>
    `).join('');

    const legacyRows = legacyLinks.length ? `
        <div class="project-notes-legacy-links" aria-label="Links found in note text">
            <div class="project-notes-link-preview-label">Detected note links</div>
            <div class="project-notes-link-list project-notes-link-list--tags">
                ${legacyLinks.map(link => `<a class="project-notes-link project-notes-link--tag project-notes-link--legacy project-card-tag" href="${escapeHtml(link.href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(link.label)}</a>`).join('')}
            </div>
        </div>
    ` : '';

    return `
        <div class="project-notes-link-editor" data-project-notes-links="${safeSurface}" data-tab-id="${tabId}" aria-label="Project note links">
            <div class="project-notes-link-editor-header">
                <div>
                    <div class="project-notes-link-preview-label">Links</div>
                    <p class="project-notes-link-helper">Click + to attach a URL to custom hyperlink text.</p>
                </div>
                ${canEdit ? `<button class="project-notes-add-link" type="button" onmousedown="event.preventDefault()" onclick="addProjectNoteLink('${projectId}', '${tabId}', '${safeSurface}', event)" title="Add link" aria-label="Add link">+</button>` : ''}
            </div>
            ${linkedItems.length ? `<div class="project-notes-link-list project-notes-link-list--tags">${linkTags}</div>` : (canEdit ? '<p class="project-notes-link-empty">No links added yet.</p>' : '')}
            ${legacyRows}
        </div>
    `;
}

function isEditingProjectNoteTab(projectId, tabId, surface = 'modal') {
    const editing = uiState.editingProjectNoteTab;
    return !!editing
        && String(editing.projectId) === String(projectId)
        && String(editing.tabId) === String(tabId)
        && String(editing.surface || 'modal') === String(surface || 'modal');
}

function clearEditingProjectNoteTab(projectId = null, tabId = null, surface = null) {
    const editing = uiState.editingProjectNoteTab;
    if (!editing) return;
    if (projectId !== null && String(editing.projectId) !== String(projectId)) return;
    if (tabId !== null && String(editing.tabId) !== String(tabId)) return;
    if (surface !== null && String(editing.surface || 'modal') !== String(surface || 'modal')) return;
    uiState.editingProjectNoteTab = null;
}

function getSafeProjectNotesSurface(surface = 'modal') {
    return String(surface || 'modal').replace(/[^a-zA-Z0-9_-]/g, '') || 'modal';
}

function commitPendingProjectNoteTabName(projectId, surface = 'modal') {
    const safeSurface = getSafeProjectNotesSurface(surface);
    const editing = uiState.editingProjectNoteTab;
    if (!editing || String(editing.projectId) !== String(projectId) || String(editing.surface || 'modal') !== safeSurface) return false;
    if (!state.canEdit(projectId)) return false;

    const data = getProjectNotesDataForProject(projectId);
    const tab = data.tabs.find(item => item.id === editing.tabId);
    if (!tab) {
        clearEditingProjectNoteTab(projectId, null, safeSurface);
        return false;
    }

    const input = document.querySelector(`[data-project-notes-editor="${safeSurface}"] .project-notes-tab-input`);
    const nextTitle = String(input?.value ?? tab.title ?? '')
        .trim()
        .replace(/\s+/g, ' ')
        .slice(0, 40) || tab.title || 'Note';
    tab.title = nextTitle;
    data.activeTabId = tab.id;
    clearEditingProjectNoteTab(projectId, tab.id, safeSurface);
    saveProjectNotesData(projectId, data);
    return true;
}

function commitProjectNoteTabName(projectId, tabId, surface = 'modal', value = '') {
    if (!state.canEdit(projectId)) return;
    const safeSurface = getSafeProjectNotesSurface(surface);
    const wasEditing = isEditingProjectNoteTab(projectId, tabId, safeSurface);
    const data = getProjectNotesDataForProject(projectId);
    const tab = data.tabs.find(item => item.id === tabId);
    if (!tab) return;
    const nextTitle = String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, 40) || tab.title || 'Note';
    tab.title = nextTitle;
    data.activeTabId = tabId;
    clearEditingProjectNoteTab(projectId, tabId, safeSurface);
    saveProjectNotesData(projectId, data, wasEditing ? { renderSurface: safeSurface } : {});
}

function cancelProjectNoteTabName(projectId, tabId, surface = 'modal') {
    clearEditingProjectNoteTab(projectId, tabId, surface);
    renderProjectNotesSurface(projectId, surface);
}

function handleProjectNoteTabNameKeydown(projectId, tabId, surface = 'modal', event) {
    if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        commitProjectNoteTabName(projectId, tabId, surface, event.currentTarget.value);
    } else if (event.key === 'Escape') {
        event.preventDefault();
        cancelProjectNoteTabName(projectId, tabId, surface);
    }
}

function buildProjectNotesEditorMarkup(projectId, project, surface = 'modal') {
    const data = normalizeProjectNotesData(getProjectNotesValueFromProject(project));
    const activeTab = data.tabs.find(tab => tab.id === data.activeTabId) || data.tabs[0] || createDefaultProjectNotesTab('');
    const canEdit = state.canEdit(projectId);
    const safeSurface = String(surface || 'modal').replace(/[^a-zA-Z0-9_-]/g, '');
    const tabButtons = data.tabs.map(tab => {
        const isActive = tab.id === activeTab.id;
        const hasNote = getRichTextPlainText(tab.body).length > 0;
        const isEditingTitle = canEdit && isEditingProjectNoteTab(projectId, tab.id, safeSurface);
        if (isEditingTitle) {
            return `<span class="project-notes-tab project-notes-tab--input ${isActive ? 'is-active' : ''} ${hasNote ? 'has-note' : ''}"
                        data-project-note-tab-reorder="${escapeHtml(tab.id)}">
                        <input class="project-notes-tab-input"
                               type="text"
                               value="${escapeHtml(tab.title)}"
                               placeholder="Tab name"
                               maxlength="40"
                               aria-label="Name note tab"
                               onmousedown="event.stopPropagation()"
                               onclick="event.stopPropagation()"
                               onkeydown="handleProjectNoteTabNameKeydown('${projectId}', '${tab.id}', '${safeSurface}', event)"
                               onblur="commitProjectNoteTabName('${projectId}', '${tab.id}', '${safeSurface}', this.value)">
                    </span>`;
        }
        return `<button class="project-notes-tab ${isActive ? 'is-active' : ''} ${hasNote ? 'has-note' : ''}"
                        type="button"
                        data-project-note-tab-reorder="${escapeHtml(tab.id)}"
                        onmousedown="commitPendingProjectNoteTabName('${projectId}', '${safeSurface}')"
                        onclick="selectProjectNoteTab('${projectId}', '${tab.id}', '${safeSurface}', event)">
                    <span>${escapeHtml(tab.title)}</span>
                </button>`;
    }).join('');

    return `
        <div class="project-notes-editor project-notes-editor--${safeSurface}" data-project-notes-editor="${safeSurface}" data-project-id="${projectId}">
            <div class="project-notes-editor-header">
                <div>
                    <h4 class="modal-project-notes-title">Project Notes</h4>
                    <p class="modal-project-notes-subtitle">Shared notes for this project.</p>
                </div>
                <svg class="modal-project-notes-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7h8M8 11h8M8 15h4"></path>
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 3h12a2 2 0 012 2v11.5a2 2 0 01-2 2H9l-5 3V5a2 2 0 012-2z"></path>
                </svg>
            </div>
            <div class="project-notes-tab-strip">
                <div class="project-notes-tabs" role="tablist">${tabButtons}</div>
                ${canEdit ? `<button class="project-notes-add-tab" type="button" onmousedown="commitPendingProjectNoteTabName('${projectId}', '${safeSurface}')" onclick="addProjectNoteTab('${projectId}', '${safeSurface}', event)" title="Add note tab" aria-label="Add note tab">+</button>` : ''}
            </div>
            <div class="project-notes-active-panel">
                <div class="project-notes-active-title-row">
                    <input class="project-notes-title-input"
                           id="project-notes-title-${safeSurface}"
                           type="text"
                           value="${escapeHtml(activeTab.title)}"
                           maxlength="40"
                           ${canEdit ? `onblur="updateProjectNoteTitle('${projectId}', '${activeTab.id}', this.value, '${safeSurface}')" onkeydown="if(event.key==='Enter'){ event.preventDefault(); this.blur(); }"` : 'readonly'}>
                    ${canEdit && data.tabs.length > 1 ? `<button class="project-notes-delete-tab" type="button" onclick="deleteProjectNoteTab('${projectId}', '${activeTab.id}', '${safeSurface}', event)" title="Delete this note tab">Delete tab</button>` : ''}
                </div>
                ${buildRichTextToolbarMarkup(`project-notes-body-${safeSurface}`, !canEdit)}
                <div class="project-notes-textarea rich-text-editor"
                     id="project-notes-body-${safeSurface}"
                     role="textbox"
                     aria-multiline="true"
                     data-placeholder="Write project notes here..."
                     data-project-id="${projectId}"
                     data-project-note-tab-id="${activeTab.id}"
                     data-project-notes-surface="${safeSurface}"
                     contenteditable="${canEdit ? 'true' : 'false'}"
                     ${canEdit ? `oninput="handleProjectNoteBodyInput('${projectId}', '${activeTab.id}', '${safeSurface}', this)" onblur="updateProjectNoteBody('${projectId}', '${activeTab.id}', getRichTextEditorValue(this), '${safeSurface}')"` : ''}>${getRichTextDisplayHtml(activeTab.body || '')}</div>
                ${renderProjectNotesLinksMarkup(projectId, activeTab.id, activeTab.links || [], canEdit, safeSurface, activeTab.body || '')}
                ${canEdit ? `<div class="project-notes-actions"><button class="modal-done-btn project-notes-save-button" type="button" onmousedown="commitPendingProjectNoteTabName('${projectId}', '${safeSurface}')" onclick="saveActiveProjectNoteFromSurface('${projectId}', '${safeSurface}')">Save Notes</button></div>` : ''}
            </div>
        </div>`;
}

function renderProjectNotesSurface(projectId, surface = 'modal') {
    const project = state.findProject(projectId);
    if (!project) return;
    const safeSurface = String(surface || 'modal');
    let target = null;
    if (safeSurface === 'quick') {
        target = document.getElementById('projectNotesModalBody');
    } else {
        target = document.getElementById(`notes-section-${projectId}`);
    }
    if (!target) return;
    target.innerHTML = buildProjectNotesEditorMarkup(projectId, project, safeSurface);
    updateProjectNotesIndicators(projectId);
    setupProjectNotesTabReorder(projectId, safeSurface);
}

function selectProjectNoteTab(projectId, tabId, surface = 'modal', event) {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    commitPendingProjectNoteTabName(projectId, surface);
    let data = getProjectNotesDataForProject(projectId);
    data = captureActiveProjectNoteEdits(projectId, surface, data);
    if (!data.tabs.some(tab => tab.id === tabId)) return;
    data.activeTabId = tabId;
    saveProjectNotesData(projectId, data, { renderSurface: surface });
}

function addProjectNoteTab(projectId, surface = 'quick', event) {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    if (!state.canEdit(projectId)) return;
    commitPendingProjectNoteTabName(projectId, surface);
    let data = getProjectNotesDataForProject(projectId);
    data = captureActiveProjectNoteEdits(projectId, surface, data);
    const nextNumber = data.tabs.length + 1;
    const nextTab = normalizeProjectNotesTab({
        id: `notes-${Date.now()}`,
        title: `Note ${nextNumber}`,
        body: ''
    }, nextNumber - 1);
    data.tabs.push(nextTab);
    data.activeTabId = nextTab.id;
    uiState.editingProjectNoteTab = { projectId, tabId: nextTab.id, surface };
    saveProjectNotesData(projectId, data, { renderSurface: surface });
    requestAnimationFrame(() => {
        const input = document.querySelector(`[data-project-notes-editor="${surface}"] .project-notes-tab-input`);
        if (input) {
            input.focus({ preventScroll: true });
            input.select?.();
        }
    });
}

function deleteProjectNoteTab(projectId, tabId, surface = 'quick', event) {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    if (!state.canEdit(projectId)) return;
    let data = getProjectNotesDataForProject(projectId);
    data = captureActiveProjectNoteEdits(projectId, surface, data);
    if (data.tabs.length <= 1) return;
    const tab = data.tabs.find(item => item.id === tabId);
    openConfirmationDialog({
        title: 'Delete Note Tab?',
        message: `Delete "${tab?.title || 'this note tab'}"? This cannot be undone.`,
        confirmLabel: 'Delete Tab',
        onConfirm: () => {
            const nextTabs = data.tabs.filter(item => item.id !== tabId);
            if (nextTabs.length === data.tabs.length) return;
            data.tabs = nextTabs;
            data.activeTabId = nextTabs[0].id;
            saveProjectNotesData(projectId, data, { renderSurface: surface });
        }
    });
}

function updateProjectNoteTitle(projectId, tabId, titleValue, surface = 'modal') {
    if (!state.canEdit(projectId)) return;
    const data = getProjectNotesDataForProject(projectId);
    const tab = data.tabs.find(item => item.id === tabId);
    if (!tab) return;
    const nextTitle = String(titleValue ?? '').trim().replace(/\s+/g, ' ').slice(0, 40) || tab.title || 'Note';
    if (nextTitle === tab.title) return;
    tab.title = nextTitle;
    saveProjectNotesData(projectId, data, { renderSurface: surface });
}

function updateProjectNoteBody(projectId, tabId, bodyValue, surface = 'modal') {
    if (!state.canEdit(projectId)) return;
    const data = getProjectNotesDataForProject(projectId);
    const tab = data.tabs.find(item => item.id === tabId);
    if (!tab) return;
    const nextBody = sanitizeRichTextHtml(bodyValue).trim();
    const currentBody = sanitizeRichTextHtml(tab.body || '').trim();
    if (nextBody === currentBody) return;
    tab.body = getRichTextPlainText(nextBody) ? nextBody : '';
    saveProjectNotesData(projectId, data, { renderSurface: surface });
}


const projectNoteDetectedLinkState = {
    declined: new Set(),
    promptTimer: null,
    active: null
};

function getLatestProjectNoteUrlCandidate(editor) {
    const plainText = getRichTextPlainText(editor?.innerHTML || editor?.textContent || '');
    if (!plainText) return null;
    const matches = Array.from(plainText.matchAll(/\b((?:https?:\/\/|www\.)[^\s<>"']+)/gi));
    if (!matches.length) return null;
    const last = matches[matches.length - 1];
    const rawUrl = String(last[1] || '').replace(/[),.;:!?]+$/g, '');
    const href = normalizeProjectNoteHref(rawUrl);
    if (!href) return null;
    return {
        rawUrl,
        href,
        label: rawUrl,
        textSnapshot: plainText,
        endIndex: Number(last.index || 0) + rawUrl.length
    };
}

function getProjectNoteDeclinedLinkKey(projectId, tabId, surface, href, textSnapshot = '') {
    const snapshotKey = String(textSnapshot || '').slice(-240);
    return [projectId, tabId, surface, href, snapshotKey].map(value => String(value ?? '')).join('|');
}

function ensureProjectNoteDetectedLinkPrompt() {
    let prompt = document.getElementById('projectNoteDetectedLinkPrompt');
    if (prompt) return prompt;

    document.body.insertAdjacentHTML('beforeend', `
        <div class="project-note-detected-link-prompt" id="projectNoteDetectedLinkPrompt" role="dialog" aria-live="polite" aria-hidden="true">
            <span class="project-note-detected-link-label">Add this link?</span>
            <button class="project-note-detected-link-choice project-note-detected-link-choice--yes" type="button" aria-label="Yes, add this link" title="Yes">✓</button>
            <button class="project-note-detected-link-choice project-note-detected-link-choice--no" type="button" aria-label="No, do not add this link" title="No">×</button>
        </div>
    `);
    prompt = document.getElementById('projectNoteDetectedLinkPrompt');
    prompt.querySelector('.project-note-detected-link-choice--yes')?.addEventListener('mousedown', event => event.preventDefault());
    prompt.querySelector('.project-note-detected-link-choice--no')?.addEventListener('mousedown', event => event.preventDefault());
    prompt.querySelector('.project-note-detected-link-choice--yes')?.addEventListener('click', confirmDetectedProjectNoteLink);
    prompt.querySelector('.project-note-detected-link-choice--no')?.addEventListener('click', declineDetectedProjectNoteLink);
    return prompt;
}

function hideProjectNoteDetectedLinkPrompt() {
    const prompt = document.getElementById('projectNoteDetectedLinkPrompt');
    if (!prompt) return;
    prompt.classList.remove('is-visible');
    prompt.setAttribute('aria-hidden', 'true');
    prompt.style.left = '';
    prompt.style.top = '';
    delete prompt.dataset.projectId;
    delete prompt.dataset.tabId;
    delete prompt.dataset.surface;
    delete prompt.dataset.href;
    delete prompt.dataset.label;
    delete prompt.dataset.textSnapshot;
    projectNoteDetectedLinkState.active = null;
}

function positionProjectNoteDetectedLinkPrompt(prompt, editor) {
    const editorRect = editor?.getBoundingClientRect?.();
    if (!prompt || !editorRect) return;
    let left = editorRect.left + Math.min(editorRect.width - 12, Math.max(12, editorRect.width * 0.62));
    let top = editorRect.top + Math.min(editorRect.height - 8, Math.max(38, editorRect.scrollHeight || editorRect.height));

    const selection = window.getSelection?.();
    const savedRanges = [];
    if (selection?.rangeCount) {
        for (let index = 0; index < selection.rangeCount; index += 1) {
            savedRanges.push(selection.getRangeAt(index).cloneRange());
        }
    }

    if (document.createRange && editor) {
        const range = document.createRange();
        range.selectNodeContents(editor);
        range.collapse(false);
        const marker = document.createElement('span');
        marker.textContent = '\u200b';
        marker.className = 'project-note-detected-link-marker';
        try {
            range.insertNode(marker);
            const markerRect = marker.getBoundingClientRect();
            if (markerRect.width || markerRect.height) {
                left = markerRect.right + 6;
                top = markerRect.bottom + 6;
            }
        } catch {
            // Keep the safe fallback position inside the editor.
        } finally {
            marker.remove?.();
            if (selection && savedRanges.length) {
                selection.removeAllRanges();
                savedRanges.forEach(savedRange => selection.addRange(savedRange));
            }
        }
    }

    const promptRect = prompt.getBoundingClientRect();
    const maxLeft = Math.max(8, window.innerWidth - (promptRect.width || 180) - 8);
    const maxTop = Math.max(8, window.innerHeight - (promptRect.height || 42) - 8);
    prompt.style.left = `${Math.min(Math.max(8, left), maxLeft)}px`;
    prompt.style.top = `${Math.min(Math.max(8, top), maxTop)}px`;
}

function showProjectNoteDetectedLinkPrompt(projectId, tabId, surface, editor, candidate) {
    if (!candidate?.href || !state.canEdit(projectId)) {
        hideProjectNoteDetectedLinkPrompt();
        return;
    }
    const declineKey = getProjectNoteDeclinedLinkKey(projectId, tabId, surface, candidate.href, candidate.textSnapshot);
    if (projectNoteDetectedLinkState.declined.has(declineKey)) {
        hideProjectNoteDetectedLinkPrompt();
        return;
    }

    const data = getProjectNotesDataForProject(projectId);
    const tab = data.tabs.find(item => item.id === tabId);
    const existingLinks = normalizeProjectNoteLinks(tab?.links || []);
    if (existingLinks.some(link => link.href && link.href.toLowerCase() === candidate.href.toLowerCase())) {
        hideProjectNoteDetectedLinkPrompt();
        return;
    }

    const prompt = ensureProjectNoteDetectedLinkPrompt();
    prompt.dataset.projectId = projectId;
    prompt.dataset.tabId = tabId;
    prompt.dataset.surface = surface;
    prompt.dataset.href = candidate.href;
    prompt.dataset.label = candidate.label || candidate.href;
    prompt.dataset.textSnapshot = candidate.textSnapshot || '';
    prompt.classList.add('is-visible');
    prompt.setAttribute('aria-hidden', 'false');
    projectNoteDetectedLinkState.active = { projectId, tabId, surface, href: candidate.href };
    requestAnimationFrame(() => positionProjectNoteDetectedLinkPrompt(prompt, editor));
}

function handleProjectNoteBodyInput(projectId, tabId, surface = 'modal', editor = null) {
    if (!state.canEdit(projectId)) return;
    const safeSurface = getSafeProjectNotesSurface(surface);
    const targetEditor = editor || document.getElementById(`project-notes-body-${safeSurface}`);
    if (!targetEditor) return;
    const visiblePrompt = document.getElementById('projectNoteDetectedLinkPrompt');
    if (visiblePrompt?.classList.contains('is-visible')) {
        const activePrompt = projectNoteDetectedLinkState.active;
        if (activePrompt
            && String(activePrompt.projectId) === String(projectId)
            && String(activePrompt.tabId) === String(tabId)
            && String(activePrompt.surface) === String(safeSurface)) {
            requestAnimationFrame(() => positionProjectNoteDetectedLinkPrompt(visiblePrompt, targetEditor));
            return;
        }
    }
    clearTimeout(projectNoteDetectedLinkState.promptTimer);
    projectNoteDetectedLinkState.promptTimer = setTimeout(() => {
        const activeElement = document.activeElement;
        if (activeElement !== targetEditor && !targetEditor.contains(activeElement)) return;
        const candidate = getLatestProjectNoteUrlCandidate(targetEditor);
        if (!candidate) return;
        showProjectNoteDetectedLinkPrompt(String(projectId), String(tabId), safeSurface, targetEditor, candidate);
    }, 220);
}

function openProjectNoteLinkModalWithSuggestion(projectId, tabId, surface = 'modal', suggestion = {}) {
    if (!state.canEdit(projectId)) return;
    let data = getProjectNotesDataForProject(projectId);
    data = captureActiveProjectNoteEdits(projectId, surface, data);
    const tab = data.tabs.find(item => item.id === tabId);
    if (!tab) return;
    stageProjectNotesData(projectId, data, { persist: true });

    const modal = ensureProjectNoteLinkModal();
    const textInput = document.getElementById('projectNoteLinkTextInput');
    const urlInput = document.getElementById('projectNoteLinkUrlInput');
    const errorEl = document.getElementById('projectNoteLinkError');
    modal.dataset.projectId = projectId;
    modal.dataset.tabId = tabId;
    modal.dataset.surface = getSafeProjectNotesSurface(surface);
    modal.dataset.mode = 'create';
    delete modal.dataset.linkId;
    configureProjectNoteLinkModal('create');
    const suggestedHref = normalizeProjectNoteHref(suggestion.href || suggestion.rawUrl || '');
    const suggestedLabel = String(suggestion.label || suggestion.rawUrl || suggestedHref || '').trim().replace(/\s+/g, ' ').slice(0, 80);
    if (textInput) textInput.value = suggestedLabel;
    if (urlInput) urlInput.value = suggestedHref;
    if (errorEl) errorEl.textContent = '';
    modal.classList.add('active');
    modal.setAttribute('aria-hidden', 'false');
    requestAnimationFrame(() => textInput?.focus({ preventScroll: true }));
}

function confirmDetectedProjectNoteLink(event) {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    const prompt = document.getElementById('projectNoteDetectedLinkPrompt');
    if (!prompt) return;
    const { projectId, tabId, surface, href, label } = prompt.dataset;
    hideProjectNoteDetectedLinkPrompt();
    if (!projectId || !tabId || !href) return;
    openProjectNoteLinkModalWithSuggestion(projectId, tabId, surface || 'modal', { href, label: label || href });
}

function declineDetectedProjectNoteLink(event) {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    const prompt = document.getElementById('projectNoteDetectedLinkPrompt');
    if (!prompt) return;
    const { projectId, tabId, surface, href, textSnapshot } = prompt.dataset;
    if (projectId && tabId && href) {
        projectNoteDetectedLinkState.declined.add(getProjectNoteDeclinedLinkKey(projectId, tabId, surface || 'modal', href, textSnapshot || ''));
    }
    hideProjectNoteDetectedLinkPrompt();
}

function ensureProjectNoteLinkModal() {
    let modal = document.getElementById('projectNoteLinkModal');
    if (modal) return modal;

    document.body.insertAdjacentHTML('beforeend', `
        <div class="modal-overlay project-note-link-modal-overlay" id="projectNoteLinkModal" aria-hidden="true">
            <div class="modal-content project-note-link-modal-content" role="dialog" aria-modal="true" aria-labelledby="projectNoteLinkModalTitle">
                <div class="task-note-modal-header project-note-link-modal-header">
                    <div>
                        <h3 class="task-note-modal-title" id="projectNoteLinkModalTitle">Create Link</h3>
                        <p class="task-note-modal-subtitle">Attach a URL to custom text.</p>
                    </div>
                    <button class="modal-close" type="button" onclick="closeProjectNoteLinkModal()" aria-label="Close create link modal">
                        <svg class="icon-lg" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
                        </svg>
                    </button>
                </div>
                <div class="project-note-link-modal-body">
                    <label class="project-note-link-field">
                        <span>Text</span>
                        <input id="projectNoteLinkTextInput" type="text" maxlength="80" placeholder="Example: Contract" autocomplete="off">
                    </label>
                    <label class="project-note-link-field">
                        <span>URL</span>
                        <input id="projectNoteLinkUrlInput" type="url" maxlength="500" placeholder="https://example.com" autocomplete="off">
                    </label>
                    <p class="project-note-link-error" id="projectNoteLinkError" role="alert" aria-live="polite"></p>
                    <div class="project-note-link-actions">
                        <button class="project-note-link-delete" id="projectNoteLinkDeleteButton" type="button" onclick="deleteProjectNoteLinkFromModal()">Delete Link</button>
                        <span class="project-note-link-actions-spacer" aria-hidden="true"></span>
                        <button class="project-note-link-cancel" type="button" onclick="closeProjectNoteLinkModal()">Cancel</button>
                        <button class="project-note-link-create" id="projectNoteLinkSubmitButton" type="button" onclick="createProjectNoteLinkFromModal()">Create</button>
                    </div>
                </div>
            </div>
        </div>
    `);

    modal = document.getElementById('projectNoteLinkModal');
    modal?.addEventListener('click', event => {
        if (event.target === modal) closeProjectNoteLinkModal();
    });
    ['projectNoteLinkTextInput', 'projectNoteLinkUrlInput'].forEach(id => {
        document.getElementById(id)?.addEventListener('keydown', event => {
            if (event.key === 'Enter') {
                event.preventDefault();
                createProjectNoteLinkFromModal();
            }
        });
    });
    return modal;
}

function configureProjectNoteLinkModal(mode = 'create') {
    const isEdit = mode === 'edit';
    const title = document.getElementById('projectNoteLinkModalTitle');
    const subtitle = document.querySelector('#projectNoteLinkModal .task-note-modal-subtitle');
    const submitButton = document.getElementById('projectNoteLinkSubmitButton');
    const deleteButton = document.getElementById('projectNoteLinkDeleteButton');
    if (title) title.textContent = isEdit ? 'Edit Link' : 'Create Link';
    if (subtitle) subtitle.textContent = isEdit ? 'Update the hyperlink text, URL, or delete the link.' : 'Attach a URL to custom text.';
    if (submitButton) submitButton.textContent = isEdit ? 'Update' : 'Create';
    if (deleteButton) deleteButton.classList.toggle('is-hidden', !isEdit);
}

function addProjectNoteLink(projectId, tabId, surface = 'modal', event) {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    openProjectNoteLinkModalWithSuggestion(projectId, tabId, surface, {});
}

function editProjectNoteLink(projectId, tabId, linkId, surface = 'modal', event) {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    if (!state.canEdit(projectId)) return;
    let data = getProjectNotesDataForProject(projectId);
    data = captureActiveProjectNoteEdits(projectId, surface, data);
    stageProjectNotesData(projectId, data, { persist: true });
    const tab = data.tabs.find(item => item.id === tabId);
    if (!tab) return;
    const link = normalizeProjectNoteLinks(tab.links || []).find(item => item.id === linkId);
    if (!link) return;

    const modal = ensureProjectNoteLinkModal();
    const textInput = document.getElementById('projectNoteLinkTextInput');
    const urlInput = document.getElementById('projectNoteLinkUrlInput');
    const errorEl = document.getElementById('projectNoteLinkError');
    modal.dataset.projectId = projectId;
    modal.dataset.tabId = tabId;
    modal.dataset.linkId = linkId;
    modal.dataset.surface = String(surface || 'modal').replace(/[^a-zA-Z0-9_-]/g, '') || 'modal';
    modal.dataset.mode = 'edit';
    configureProjectNoteLinkModal('edit');
    if (textInput) textInput.value = link.label || '';
    if (urlInput) urlInput.value = link.href || '';
    if (errorEl) errorEl.textContent = '';
    modal.classList.add('active');
    modal.setAttribute('aria-hidden', 'false');
    requestAnimationFrame(() => textInput?.focus({ preventScroll: true }));
}

function closeProjectNoteLinkModal() {
    const modal = document.getElementById('projectNoteLinkModal');
    if (!modal) return;
    modal.classList.remove('active');
    modal.setAttribute('aria-hidden', 'true');
    delete modal.dataset.projectId;
    delete modal.dataset.tabId;
    delete modal.dataset.linkId;
    delete modal.dataset.surface;
    delete modal.dataset.mode;
    configureProjectNoteLinkModal('create');
}

function createProjectNoteLinkFromModal() {
    const modal = document.getElementById('projectNoteLinkModal');
    if (!modal) return;
    const projectId = modal.dataset.projectId;
    const tabId = modal.dataset.tabId;
    const surface = modal.dataset.surface || 'modal';
    const mode = modal.dataset.mode || 'create';
    const editLinkId = modal.dataset.linkId;
    if (!projectId || !tabId || !state.canEdit(projectId)) return;

    const textInput = document.getElementById('projectNoteLinkTextInput');
    const urlInput = document.getElementById('projectNoteLinkUrlInput');
    const errorEl = document.getElementById('projectNoteLinkError');
    const label = String(textInput?.value || '').trim().replace(/\s+/g, ' ').slice(0, 80);
    const href = normalizeProjectNoteHref(urlInput?.value || '');

    if (!label) {
        if (errorEl) errorEl.textContent = 'Add the text for the hyperlink.';
        textInput?.focus({ preventScroll: true });
        return;
    }
    if (!href) {
        if (errorEl) errorEl.textContent = 'Add a valid URL that starts with http://, https://, www., or mailto:.';
        urlInput?.focus({ preventScroll: true });
        return;
    }

    const data = getProjectNotesDataForProject(projectId);
    const tab = data.tabs.find(item => item.id === tabId);
    if (!tab) return;
    const currentLinks = normalizeProjectNoteLinks(tab.links || []);
    if (mode === 'edit' && editLinkId) {
        const linkIndex = currentLinks.findIndex(item => item.id === editLinkId);
        if (linkIndex === -1) {
            if (errorEl) errorEl.textContent = 'This link could not be found.';
            return;
        }
        currentLinks[linkIndex] = { ...currentLinks[linkIndex], label, href };
        tab.links = normalizeProjectNoteLinks(currentLinks);
    } else {
        const nextLinkId = `link-${Date.now()}-${currentLinks.length + 1}`;
        tab.links = normalizeProjectNoteLinks([...currentLinks, { id: nextLinkId, label, href }]);
    }
    data.activeTabId = tabId;
    closeProjectNoteLinkModal();
    saveProjectNotesData(projectId, data, { renderSurface: surface });
}

function deleteProjectNoteLinkFromModal() {
    const modal = document.getElementById('projectNoteLinkModal');
    if (!modal) return;
    const projectId = modal.dataset.projectId;
    const tabId = modal.dataset.tabId;
    const linkId = modal.dataset.linkId;
    const surface = modal.dataset.surface || 'modal';
    if (!projectId || !tabId || !linkId || !state.canEdit(projectId)) return;

    const data = getProjectNotesDataForProject(projectId);
    const tab = data.tabs.find(item => item.id === tabId);
    if (!tab) return;
    tab.links = normalizeProjectNoteLinks(tab.links || []).filter(item => item.id !== linkId);
    data.activeTabId = tabId;
    closeProjectNoteLinkModal();
    saveProjectNotesData(projectId, data, { renderSurface: surface });
}

function focusProjectNoteLinkUrl(linkId, event) {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    const safeLinkId = String(linkId || '').replace(/[^a-zA-Z0-9_-]/g, '');
    const row = document.querySelector(`[data-link-id="${safeLinkId}"]`);
    const urlInput = row?.querySelector('[data-project-note-link-url]');
    if (!urlInput) return;
    urlInput.focus({ preventScroll: true });
    urlInput.select?.();
}

function updateProjectNoteLink(projectId, tabId, linkId, field, value, surface = 'modal') {
    if (!state.canEdit(projectId)) return;
    const data = getProjectNotesDataForProject(projectId);
    const tab = data.tabs.find(item => item.id === tabId);
    if (!tab) return;
    const links = normalizeProjectNoteLinks(tab.links || []);
    const link = links.find(item => item.id === linkId);
    if (!link) return;
    if (field === 'href') {
        link.href = normalizeProjectNoteHref(value);
    } else {
        link.label = String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, 80);
    }
    tab.links = normalizeProjectNoteLinks(links);
    data.activeTabId = tabId;
    saveProjectNotesData(projectId, data);
}

function deleteProjectNoteLink(projectId, tabId, linkId, surface = 'modal', event) {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    if (!state.canEdit(projectId)) return;
    const data = getProjectNotesDataForProject(projectId);
    const tab = data.tabs.find(item => item.id === tabId);
    if (!tab) return;
    const link = normalizeProjectNoteLinks(tab.links || []).find(item => item.id === linkId);
    openConfirmationDialog({
        title: 'Delete Link?',
        message: `Delete "${link?.label || 'this link'}"?`,
        confirmLabel: 'Delete Link',
        onConfirm: () => {
            tab.links = normalizeProjectNoteLinks(tab.links || []).filter(item => item.id !== linkId);
            data.activeTabId = tabId;
            saveProjectNotesData(projectId, data, { renderSurface: surface });
        }
    });
}

function saveActiveProjectNoteFromSurface(projectId, surface = 'modal') {
    if (!state.canEdit(projectId)) return;
    const safeSurface = getSafeProjectNotesSurface(surface);
    commitPendingProjectNoteTabName(projectId, safeSurface);
    const data = getProjectNotesDataForProject(projectId);
    const activeTab = data.tabs.find(item => item.id === data.activeTabId) || data.tabs[0];
    if (!activeTab) return;
    const titleInput = document.getElementById(`project-notes-title-${safeSurface}`);
    const bodyEditor = document.getElementById(`project-notes-body-${safeSurface}`);
    const tab = data.tabs.find(item => item.id === activeTab.id);
    if (!tab) return;
    if (titleInput) tab.title = decodeHtmlEntities(titleInput.value || tab.title || 'Note').trim().replace(/\s+/g, ' ').slice(0, 40) || 'Note';
    if (bodyEditor) tab.body = getRichTextEditorValue(bodyEditor);
    tab.links = normalizeProjectNoteLinks([
        ...normalizeProjectNoteLinks(tab.links || []),
        ...collectProjectNoteLinksFromSurface(activeTab.id, safeSurface)
    ]);
    saveProjectNotesData(projectId, data, { renderSurface: safeSurface });
    requestAnimationFrame(() => {
        const button = document.querySelector(`[data-project-notes-editor="${safeSurface}"] .project-notes-save-button`);
        if (!button) return;
        button.textContent = 'Notes Saved!';
        button.classList.add('is-saved');
        window.clearTimeout(button.__notesSavedResetTimer);
        button.__notesSavedResetTimer = window.setTimeout(() => {
            if (!button.isConnected) return;
            button.textContent = 'Save Notes';
            button.classList.remove('is-saved');
        }, 1800);
    });
}

function ensureProjectNotesModal() {
    let modal = document.getElementById('projectNotesModal');
    if (modal) return modal;

    document.body.insertAdjacentHTML('beforeend', `
        <div class="modal-overlay project-notes-modal-overlay" id="projectNotesModal" aria-hidden="true">
            <div class="modal-content project-notes-modal-content" role="dialog" aria-modal="true" aria-labelledby="projectNotesModalTitle">
                <div class="task-note-modal-header project-notes-modal-header">
                    <div>
                        <h3 class="task-note-modal-title" id="projectNotesModalTitle">Project Notes</h3>
                        <p class="task-note-modal-subtitle" id="projectNotesModalSubtitle">Add notes for this project.</p>
                    </div>
                    <button class="modal-close" type="button" onclick="closeProjectNotesModal()" aria-label="Close project notes">
                        <svg class="icon-lg" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
                        </svg>
                    </button>
                </div>
                <div id="projectNotesModalBody"></div>
            </div>
        </div>
    `);

    modal = document.getElementById('projectNotesModal');
    modal.addEventListener('click', (event) => {
        if (event.target === modal) closeProjectNotesModal();
    });
    return modal;
}

function openProjectNotes(projectId, event) {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    const project = state.findProject(projectId);
    if (!project) return;
    const modal = ensureProjectNotesModal();
    modal.dataset.projectId = projectId;
    const subtitle = modal.querySelector('#projectNotesModalSubtitle');
    if (subtitle) subtitle.textContent = project.title ? `Notes for: ${project.title}` : 'Add notes for this project.';
    renderProjectNotesSurface(projectId, 'quick');
    modal.classList.add('active');
    modal.setAttribute('aria-hidden', 'false');
    requestAnimationFrame(() => document.getElementById('project-notes-body-quick')?.focus({ preventScroll: true }));
}

function closeProjectNotesModal() {
    const modal = document.getElementById('projectNotesModal');
    if (!modal) return;
    const projectId = modal.dataset.projectId;
    if (projectId) saveActiveProjectNoteFromSurface(projectId, 'quick');
    modal.classList.remove('active');
    modal.setAttribute('aria-hidden', 'true');
    delete modal.dataset.projectId;
}

function writeClipboardText(text) {
    const value = String(text ?? '');
    if (navigator.clipboard?.writeText) {
        return navigator.clipboard.writeText(value);
    }

    return new Promise((resolve, reject) => {
        try {
            const textarea = document.createElement('textarea');
            textarea.value = value;
            textarea.setAttribute('readonly', '');
            textarea.style.position = 'fixed';
            textarea.style.top = '-9999px';
            textarea.style.left = '-9999px';
            document.body.appendChild(textarea);
            textarea.select();
            const copied = document.execCommand('copy');
            textarea.remove();
            copied ? resolve() : reject(new Error('Clipboard copy failed'));
        } catch (err) {
            reject(err);
        }
    });
}

function showCopyButtonFeedback(button) {
    if (!button) return;
    const originalHTML = button.innerHTML;
    button.classList.add('is-copied');
    button.innerHTML = `
        <svg class="icon-lg" fill="none" stroke="currentColor" viewBox="0 0 24 24" style="width: 20px; height: 20px;">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7"></path>
        </svg>
    `;

    setTimeout(() => {
        button.innerHTML = originalHTML;
        button.classList.remove('is-copied');
    }, 1500);
}

function copyProjectToClipboard(projectId, evt) {
    const project = state.findProject(projectId);
    if (!project) return;

    // Only copy incomplete task text
    const incompleteTasks = project.tasks.filter(t => !isTaskCompleted(t));

    const text = incompleteTasks.map(task => getTaskPlainText(task.text)).join('\n');

    writeClipboardText(text).then(() => {
        showCopyButtonFeedback(evt?.target?.closest('button'));
    }).catch(err => {
        console.error('Failed to copy:', err);
    });
}

function copyTaskToClipboard(projectId, taskId, evt) {
    evt?.preventDefault?.();
    evt?.stopPropagation?.();

    const project = state.findProject(projectId);
    if (!project) return;

    const task = (Array.isArray(project.tasks) ? project.tasks : [])
        .map((item, index) => normalizeTask(item, index))
        .find(item => item.id === Number(taskId));
    const text = getTaskPlainText(task?.text).trim();
    if (!text) return;

    writeClipboardText(text).then(() => {
        showCopyButtonFeedback(evt?.target?.closest('button'));
    }).catch(err => {
        console.error('Failed to copy task:', err);
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
    
    const willBeCompleted = !isTaskCompleted(task);
    const shouldAnimateAway = willBeCompleted && getProjectHideCompletedPreference(projectId);
    
    // Only use the fade-away animation when completed tasks are hidden from view.
    // With "Hide completed tasks" off, completing a task should update in place.
    if (shouldAnimateAway) {
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
    
    // When completed tasks stay visible, update immediately with no going-away animation.
    performTaskToggle(projectId, taskId);
}

function performTaskToggle(projectId, taskId) {
    const project = state.findProject(projectId);
    if (!project) return;

    const modalOpen = document.getElementById('projectModal')?.classList.contains('active');
    const modalState = modalOpen ? captureProjectModalState(projectId) : null;
    const pageScrollX = window.scrollX;
    const pageScrollY = window.scrollY;
    
    const updatedTasks = project.tasks.map(t => {
        if (t.id === taskId) {
            const newCompleted = !isTaskCompleted(t);
            if (newCompleted) {
                state.incrementCompletedTasks();
            } else {
                state.decrementCompletedTasks();
            }
            return newCompleted
                ? applyTaskCompletionAttribution(t)
                : clearTaskCompletionAttribution(t);
        }
        return t;
    });
    saveTaskCompletionUndoState(projectId, project.tasks, updatedTasks);
    
    // Sort tasks after toggling
    const sortedTasks = sortTasks(updatedTasks);
    state.updateProject(projectId, projectUpdate({ tasks: sortedTasks }));
    saveData();
    
    // Re-render in place so checking off a task does not jump the project modal to the top.
    if (modalOpen) {
        renderModalTaskList(projectId);
        updateProjectProgress(projectId);
        restoreProjectModalScrollPosition(projectId, modalState);
        render();
        restoreProjectModalScrollPosition(projectId, modalState);
        requestAnimationFrame(() => window.scrollTo(pageScrollX, pageScrollY));
    } else {
        render();
    }
    refreshProjectCalendarIfPresent(projectId);
    
    // Update stats display
    const completedTasksCountEl = document.getElementById('completedTasksCount');
    if (completedTasksCountEl) completedTasksCountEl.textContent = calculateVisibleCompletionStats().completedTasks;
    updateTotalCompletion();
}

function completeTaskBatch(projectId, shouldCompleteTask) {
    if (!state.canEdit(projectId) || typeof shouldCompleteTask !== 'function') return;
    const project = state.findProject(projectId);
    if (!project || !Array.isArray(project.tasks)) return;

    let completedCount = 0;
    const completedDate = new Date().toISOString();
    const updatedTasks = project.tasks.map((task, index) => {
        const normalizedTask = normalizeTask(task, index);
        if (normalizedTask.completed || !shouldCompleteTask(normalizedTask)) return normalizedTask;
        completedCount += 1;
        return applyTaskCompletionAttribution(normalizedTask, completedDate);
    });

    if (completedCount <= 0) return;

    saveTaskCompletionUndoState(projectId, project.tasks, updatedTasks);
    for (let i = 0; i < completedCount; i++) state.incrementCompletedTasks();

    const pageScrollX = window.scrollX;
    const pageScrollY = window.scrollY;
    const modalOpen = document.getElementById('projectModal')?.classList.contains('active');
    const modalState = modalOpen ? captureProjectModalState(projectId) : null;

    state.updateProject(projectId, projectUpdate({ tasks: sortTasks(updatedTasks) }));
    saveData();

    if (modalOpen) {
        renderModalTaskList(projectId);
        updateProjectProgress(projectId);
        restoreProjectModalState(projectId, modalState);
    }

    render();
    updateTotalCompletion();
    const completedTasksCountEl = document.getElementById('completedTasksCount');
    if (completedTasksCountEl) completedTasksCountEl.textContent = calculateVisibleCompletionStats().completedTasks;
    requestAnimationFrame(() => window.scrollTo(pageScrollX, pageScrollY));
}

function completeTasksByCategory(projectId, categoryValue, event) {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    const normalizedCategory = categoryValue === TASK_CATEGORY_DROP_ALL || categoryValue === DEFAULT_TASK_CATEGORY_FILTER
        ? TASK_CATEGORY_DROP_ALL
        : sanitizeTaskCategoryName(categoryValue);
    uiState.openTaskCategoryMenu = null;
    completeTaskBatch(projectId, (task) => {
        if (normalizedCategory === TASK_CATEGORY_DROP_ALL) return true;
        return task.category === normalizedCategory;
    });
}

function completeTasksByPriority(projectId, tagValue, event) {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    const normalizedTag = normalizePriorityTagValue(tagValue);
    uiState.openTaskPriorityMenu = null;
    completeTaskBatch(projectId, (task) => task.tag === normalizedTag);
}

function getSelectedTaskIdsForProject(projectId) {
    const project = state.findProject(projectId);
    const selectedTasks = state.getSelectedTasks(projectId);
    if (!project || !selectedTasks || selectedTasks.size === 0) return [];

    const existingIds = new Set((Array.isArray(project.tasks) ? project.tasks : [])
        .map((task, index) => normalizeTask(task, index).id));

    return [...selectedTasks]
        .map(taskId => Number(taskId))
        .filter(taskId => Number.isFinite(taskId) && existingIds.has(taskId));
}

function getSelectedTaskCountForProject(projectId) {
    return getSelectedTaskIdsForProject(projectId).length;
}

function getVisibleSelectableTaskIds(projectId) {
    const project = state.findProject(projectId);
    if (!project) return [];
    const hideCompleted = getProjectHideCompletedPreference(projectId);
    const sortMode = getProjectTaskSortPreference(projectId);
    const activeCategory = getProjectTaskCategoryFilter(projectId);
    return getDisplayTasksForProject(project, { hideCompleted, sortMode, activeCategory })
        .map(task => normalizeTask(task).id)
        .filter(taskId => Number.isFinite(Number(taskId)));
}

function areAllVisibleTasksSelected(projectId, visibleTaskIds = null) {
    const ids = Array.isArray(visibleTaskIds) ? visibleTaskIds : getVisibleSelectableTaskIds(projectId);
    if (!ids.length) return false;
    const selectedIds = new Set(getSelectedTaskIdsForProject(projectId));
    return ids.every(taskId => selectedIds.has(Number(taskId)));
}

function buildTaskSelectAllControlMarkup(projectId, displayTasks = [], selectedTasks = new Set()) {
    if (!state.canEdit(projectId)) return '';
    const visibleTaskIds = (Array.isArray(displayTasks) ? displayTasks : [])
        .map(task => normalizeTask(task).id)
        .filter(taskId => Number.isFinite(Number(taskId)));
    const selectedIds = new Set([...selectedTasks].map(taskId => Number(taskId)));
    const allSelected = visibleTaskIds.length > 0 && visibleTaskIds.every(taskId => selectedIds.has(Number(taskId)));
    const disabled = visibleTaskIds.length <= 0;
    return `
        <label class="task-select-all-control-inner ${allSelected ? 'is-selected' : ''} ${disabled ? 'is-disabled' : ''}">
            <input type="checkbox"
                   ${allSelected ? 'checked' : ''}
                   ${disabled ? 'disabled' : ''}
                   aria-label="Select all visible tasks"
                   onchange="toggleSelectAllVisibleTasks('${projectId}', this.checked)">
            <span class="task-select-all-box" aria-hidden="true"></span>
            <span>Select All Tasks</span>
        </label>
    `;
}

function renderTaskSelectAllControl(projectId, displayTasks = null) {
    const container = document.getElementById(`task-select-all-control-${projectId}`);
    if (!container) return;
    const project = state.findProject(projectId);
    if (!project) return;
    const tasksForControl = Array.isArray(displayTasks)
        ? displayTasks
        : getDisplayTasksForProject(project, {
            hideCompleted: getProjectHideCompletedPreference(projectId),
            sortMode: getProjectTaskSortPreference(projectId),
            activeCategory: getProjectTaskCategoryFilter(projectId)
        });
    container.innerHTML = buildTaskSelectAllControlMarkup(projectId, tasksForControl, state.getSelectedTasks(projectId));
}

function toggleSelectAllVisibleTasks(projectId, shouldSelect) {
    if (!state.canEdit(projectId)) return;
    const visibleTaskIds = getVisibleSelectableTaskIds(projectId);
    state.clearTaskSelection(projectId);
    if (shouldSelect) {
        visibleTaskIds.forEach(taskId => state.selectTask(projectId, Number(taskId), true));
    }
    renderModalTaskList(projectId);
}

function updateCompletedTaskStatBy(delta) {
    const amount = Number(delta) || 0;
    if (amount > 0) {
        for (let i = 0; i < amount; i++) state.incrementCompletedTasks();
    } else if (amount < 0) {
        for (let i = 0; i < Math.abs(amount); i++) state.decrementCompletedTasks();
    }
}

function getTaskCompletionUndoStates(beforeTasks = [], afterTasks = []) {
    const afterById = new Map((Array.isArray(afterTasks) ? afterTasks : [])
        .map((task, index) => normalizeTask(task, index))
        .map(task => [task.id, task]));

    return (Array.isArray(beforeTasks) ? beforeTasks : [])
        .map((task, index) => normalizeTask(task, index))
        .filter(task => {
            const afterTask = afterById.get(task.id);
            return afterTask && isTaskCompleted(afterTask) !== isTaskCompleted(task);
        })
        .map(task => ({
            id: task.id,
            completed: isTaskCompleted(task),
            completedDate: task.completedDate || null,
            completedBy: task.completedBy || '',
            completedByName: task.completedByName || ''
        }));
}

function saveTaskCompletionUndoState(projectId, beforeTasks = [], afterTasks = []) {
    const taskStates = getTaskCompletionUndoStates(beforeTasks, afterTasks);
    if (!taskStates.length) return false;

    state.saveUndoState('taskCompletion', { projectId, taskStates });
    updateUndoButton();
    return true;
}

function restoreTaskCompletionUndo(undoEntry) {
    const { projectId, taskStates } = undoEntry?.data || {};
    const project = state.findProject(projectId);
    if (!project || !Array.isArray(project.tasks) || !Array.isArray(taskStates)) return false;

    const previousStateById = new Map(taskStates.map(task => [Number(task.id), task]));
    let completedStatDelta = 0;
    let changed = false;

    const updatedTasks = project.tasks.map((task, index) => {
        const normalizedTask = normalizeTask(task, index);
        const previousState = previousStateById.get(normalizedTask.id);
        if (!previousState || isTaskCompleted(normalizedTask) === parseTaskCompletedValue(previousState.completed)) return normalizedTask;

        completedStatDelta += previousState.completed ? 1 : -1;
        changed = true;
        return {
            ...normalizedTask,
            completed: parseTaskCompletedValue(previousState.completed),
            completedDate: previousState.completed ? (previousState.completedDate || null) : null,
            completedBy: previousState.completed ? (previousState.completedBy || '') : '',
            completedByName: previousState.completed ? (previousState.completedByName || '') : ''
        };
    });

    if (!changed) return false;

    const pageScrollX = window.scrollX;
    const pageScrollY = window.scrollY;
    const modalOpen = document.getElementById('projectModal')?.classList.contains('active');
    const modalState = modalOpen ? captureProjectModalState(projectId) : null;

    updateCompletedTaskStatBy(completedStatDelta);
    state.updateProject(projectId, projectUpdate({ tasks: sortTasks(updatedTasks) }));
    saveData();

    if (modalOpen) {
        renderModalTaskList(projectId);
        updateProjectProgress(projectId);
        if (modalState) restoreProjectModalState(projectId, modalState);
    }

    render();
    updateTotalCompletion();
    const completedTasksCountEl = document.getElementById('completedTasksCount');
    if (completedTasksCountEl) completedTasksCountEl.textContent = calculateVisibleCompletionStats().completedTasks;
    requestAnimationFrame(() => window.scrollTo(pageScrollX, pageScrollY));
    return true;
}

function refreshModalTaskUi(projectId, options = {}) {
    const modalOpen = document.getElementById('projectModal')?.classList.contains('active');
    const modalState = modalOpen ? (options.modalState || captureProjectModalState(projectId)) : null;
    const pageScrollX = window.scrollX;
    const pageScrollY = window.scrollY;

    if (modalOpen) {
        renderModalTaskList(projectId);
        updateProjectProgress(projectId);
        if (modalState) restoreProjectModalState(projectId, modalState);
    }

    render();
    updateTotalCompletion();
    const completedTasksCountEl = document.getElementById('completedTasksCount');
    if (completedTasksCountEl) completedTasksCountEl.textContent = calculateVisibleCompletionStats().completedTasks;
    requestAnimationFrame(() => window.scrollTo(pageScrollX, pageScrollY));
}

function buildTaskBulkActionsMarkup(projectId, project, selectedTasks) {
    const selectedCount = selectedTasks?.size ? getSelectedTaskCountForProject(projectId) : 0;
    if (!state.canEdit(projectId) || selectedCount <= 0) return '';

    const categories = [DEFAULT_TASK_CATEGORY, ...getProjectTaskCategories(project)]
        .filter((category, index, list) => list.indexOf(category) === index);

    return `
        <div class="task-bulk-actions" id="task-bulk-actions-inner-${projectId}" aria-label="Bulk task actions">
            <span class="task-bulk-actions-count">${selectedCount} selected</span>
            <select class="task-bulk-action-select" aria-label="Move selected tasks to tab" onchange="moveSelectedTasksToCategory('${projectId}', this.value); this.value='';">
                <option value="">MOVE TO...</option>
                ${categories.map(category => `<option value="${escapeHtml(category)}">${escapeHtml(category)}</option>`).join('')}
            </select>
            <label class="task-bulk-date-control" title="Set due date for selected tasks">
                <span>SET DUE DATE</span>
                <input type="date" aria-label="Set due date for selected tasks" onchange="setSelectedTasksDueDate('${projectId}', this.value); this.value='';">
            </label>
            <select class="task-bulk-action-select" aria-label="Set priority for selected tasks" onchange="setSelectedTasksPriority('${projectId}', this.value); this.value='';">
                <option value="">SET PRIORITY LEVEL</option>
                ${TASK_TAG_OPTIONS.map(option => `<option value="${option.value}">${option.label}</option>`).join('')}
            </select>
            <button class="task-bulk-action-button" type="button" onclick="completeSelectedTasks('${projectId}', event)">MARK COMPLETED</button>
            <button class="task-bulk-action-button task-bulk-action-button--danger" type="button" onclick="deleteSelectedTasks('${projectId}', event)">DELETE</button>
        </div>
    `;
}

function renderTaskBulkActions(projectId) {
    const project = state.findProject(projectId);
    const container = document.getElementById(`task-bulk-actions-${projectId}`);
    if (!project || !container) return;
    container.innerHTML = buildTaskBulkActionsMarkup(projectId, project, state.getSelectedTasks(projectId));
}

function toggleTaskBulkSelection(projectId, taskId, event) {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    if (!state.canEdit(projectId)) return;

    state.toggleTaskSelection(projectId, Number(taskId));
    renderModalTaskList(projectId);
}

function clearSelectedTasksForProject(projectId, shouldRender = true) {
    state.clearTaskSelection(projectId);
    if (shouldRender) renderModalTaskList(projectId);
}

function updateSelectedTasks(projectId, updater) {
    if (!state.canEdit(projectId) || typeof updater !== 'function') return false;
    const project = state.findProject(projectId);
    if (!project || !Array.isArray(project.tasks)) return false;

    const selectedIds = new Set(getSelectedTaskIdsForProject(projectId));
    if (selectedIds.size <= 0) return false;

    let changed = false;
    let completedStatDelta = 0;
    const updatedTasks = project.tasks.map((task, index) => {
        const normalizedTask = normalizeTask(task, index);
        if (!selectedIds.has(normalizedTask.id)) return normalizedTask;

        const beforeCompleted = isTaskCompleted(normalizedTask);
        const nextTask = normalizeTask(updater(normalizedTask) || normalizedTask, index);
        if (JSON.stringify(nextTask) !== JSON.stringify(normalizedTask)) changed = true;
        if (!beforeCompleted && isTaskCompleted(nextTask)) completedStatDelta += 1;
        if (beforeCompleted && !isTaskCompleted(nextTask)) completedStatDelta -= 1;
        return nextTask;
    });

    if (!changed) return false;

    if (completedStatDelta !== 0) {
        saveTaskCompletionUndoState(projectId, project.tasks, updatedTasks);
    }
    updateCompletedTaskStatBy(completedStatDelta);
    state.updateProject(projectId, projectUpdate({ tasks: sortTasks(updatedTasks) }));
    saveData();
    return true;
}

function moveSelectedTasksToCategory(projectId, categoryValue) {
    const nextCategory = sanitizeTaskCategoryName(categoryValue || '');
    if (!nextCategory) return;
    const project = state.findProject(projectId);
    if (!project) return;
    const modalState = captureProjectModalState(projectId);
    const changed = updateSelectedTasks(projectId, task => ({ ...task, category: nextCategory }));
    if (!changed) return;
    const nextCategories = getTaskCategoryListWith([...getProjectTaskCategories(project), nextCategory]);
    state.updateProject(projectId, projectUpdate({ taskCategories: nextCategories }));
    saveData();
    clearSelectedTasksForProject(projectId, false);
    refreshModalTaskUi(projectId, { modalState });
}

function setSelectedTasksDueDate(projectId, dueDateValue) {
    const dueDate = normalizeTaskDueDate(dueDateValue);
    if (!dueDate) return;
    const modalState = captureProjectModalState(projectId);
    const changed = updateSelectedTasks(projectId, task => ({ ...task, dueDate }));
    if (!changed) return;
    clearSelectedTasksForProject(projectId, false);
    refreshModalTaskUi(projectId, { modalState });
    refreshProjectCalendarIfPresent(projectId);
}

function setSelectedTasksPriority(projectId, tagValue) {
    const nextTag = normalizePriorityTagValue(tagValue);
    const modalState = captureProjectModalState(projectId);
    const changed = updateSelectedTasks(projectId, task => ({ ...task, tag: nextTag }));
    if (!changed) return;
    uiState.openTaskPriorityMenu = null;
    clearSelectedTasksForProject(projectId, false);
    refreshModalTaskUi(projectId, { modalState });
    refreshProjectCalendarIfPresent(projectId);
}

function completeSelectedTasks(projectId, event) {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    const completedDate = new Date().toISOString();
    const modalState = captureProjectModalState(projectId);
    const changed = updateSelectedTasks(projectId, task => isTaskCompleted(task)
        ? task
        : applyTaskCompletionAttribution(task, completedDate));
    if (!changed) return;
    clearSelectedTasksForProject(projectId, false);
    refreshModalTaskUi(projectId, { modalState });
}

function deleteSelectedTasks(projectId, event) {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    if (!state.canEdit(projectId)) return;
    const project = state.findProject(projectId);
    if (!project || !Array.isArray(project.tasks)) return;

    const selectedIds = new Set(getSelectedTaskIdsForProject(projectId));
    if (selectedIds.size <= 0) return;

    openConfirmationDialog({
        title: selectedIds.size === 1 ? 'Delete Selected Task?' : 'Delete Selected Tasks?',
        message: `Delete ${selectedIds.size} selected ${selectedIds.size === 1 ? 'task' : 'tasks'}? This cannot be undone.`,
        confirmLabel: 'Delete Tasks',
        onConfirm: () => {
            const modalState = captureProjectModalState(projectId);
            const deletedTasks = project.tasks
                .map((task, index) => normalizeTask(task, index))
                .filter(task => selectedIds.has(task.id));
            const completedDeletedCount = deletedTasks.filter(task => isTaskCompleted(task)).length;
            const updatedTasks = project.tasks
                .map((task, index) => normalizeTask(task, index))
                .filter(task => !selectedIds.has(task.id));

            updateCompletedTaskStatBy(-completedDeletedCount);
            state.updateProject(projectId, projectUpdate({ tasks: updatedTasks }));
            clearSelectedTasksForProject(projectId, false);
            saveData();
            refreshModalTaskUi(projectId, { modalState });
            refreshProjectCalendarIfPresent(projectId);
        }
    });
}

function updateProjectProgress(projectId) {
    const project = state.findProject(projectId);
    if (!project) return;
    
    const completedTasks = project.tasks.filter(t => isTaskCompleted(t)).length;
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

    const pageScrollX = window.scrollX;
    const pageScrollY = window.scrollY;
    const modalOpen = document.getElementById('projectModal')?.classList.contains('active');
    const modalState = modalOpen ? captureProjectModalState(projectId) : null;
    const taskList = modalOpen ? document.getElementById(`modal-task-list-${projectId}`) : null;
    const taskListScrollTop = taskList?.scrollTop || 0;
    
    const taskToDelete = project.tasks.find(t => t.id === taskId);
    if (taskToDelete?.completed) {
        state.decrementCompletedTasks();
    }
    
    // Save undo state for task deletion
    state.saveUndoState('deleteTask', { projectId, task: { ...taskToDelete } });
    
    const updatedTasks = project.tasks.filter(t => t.id !== taskId);
    state.updateProject(projectId, projectUpdate({ tasks: updatedTasks }));
    saveData();

    if (modalOpen) {
        render();
        renderModalTaskList(projectId);
        updateProjectProgress(projectId);
        restoreProjectModalState(projectId, modalState);
        requestAnimationFrame(() => {
            if (taskList) taskList.scrollTop = taskListScrollTop;
            window.scrollTo(pageScrollX, pageScrollY);
        });
    } else {
        render();
    }

    refreshProjectCalendarIfPresent(projectId);
    updateUndoButton();
    updateTotalCompletion();
}

function updateTaskText(projectId, taskId, newText) {
    if (!state.canEdit(projectId)) return;
    const project = state.findProject(projectId);
    if (!project) return;
    
    const cleanText = sanitizeRichTextHtml(newText).trim();
    const hasText = getTaskPlainText(cleanText).length > 0;
    const updatedTasks = project.tasks.map(t => 
        t.id === taskId ? { ...t, text: hasText ? cleanText : '' } : t
    );
    
    state.updateProject(projectId, projectUpdate({ tasks: updatedTasks }));
    saveData();
    refreshProjectCalendarIfPresent(projectId);
    render();
}

function updateTaskDueDate(projectId, taskId, dueDateValue) {
    if (!state.canEdit(projectId)) return;
    const project = state.findProject(projectId);
    if (!project) return;

    const dueDate = normalizeTaskDueDate(dueDateValue);
    const updatedTasks = (Array.isArray(project.tasks) ? project.tasks : []).map((task, index) => {
        const normalized = normalizeTask(task, index);
        return normalized.id === taskId ? { ...normalized, dueDate } : normalized;
    });

    state.updateProject(projectId, projectUpdate({ tasks: updatedTasks }));
    saveData();

    const dueInput = document.getElementById(`modal-task-due-${taskId}`);
    const dueControl = dueInput?.closest?.('.task-due-date-control');
    if (dueInput) dueInput.value = dueDate;
    if (dueControl) {
        const normalizedTask = updatedTasks.find(task => normalizeTask(task).id === taskId);
        const overdue = isTaskOverdue(normalizedTask);
        dueControl.classList.toggle('has-due-date', !!dueDate);
        dueControl.classList.toggle('is-overdue', overdue);
        dueControl.setAttribute('title', overdue ? `Overdue: ${formatTaskDueDate(dueDate)}` : (dueDate ? `Due ${formatTaskDueDate(dueDate)}` : 'Add due date'));
        if (overdue && !dueControl.querySelector('.task-due-overdue-icon')) {
            dueControl.insertAdjacentHTML('afterbegin', renderWarningTriangleIcon('task-due-overdue-icon'));
        } else if (!overdue) {
            dueControl.querySelector('.task-due-overdue-icon')?.remove();
        }
    }

    refreshProjectCalendarIfPresent(projectId);
}

function openTaskDueDatePicker(projectId, taskId, event) {
    event?.preventDefault?.();
    event?.stopPropagation?.();

    const dueInput = document.getElementById(`modal-task-due-${taskId}`);
    if (!dueInput || dueInput.disabled) return;

    try {
        if (typeof dueInput.showPicker === 'function') {
            dueInput.showPicker();
        } else {
            dueInput.focus({ preventScroll: true });
            dueInput.click();
        }
    } catch (error) {
        dueInput.focus({ preventScroll: true });
    }
}

function addTaskToProject(projectId) {
    if (!state.canEdit(projectId)) return;
    const project = state.findProject(projectId);
    if (!project) return;
    const activeCategory = getProjectTaskCategoryFilter(projectId);
    const category = activeCategory === DEFAULT_TASK_CATEGORY_FILTER ? DEFAULT_TASK_CATEGORY : sanitizeTaskCategoryName(activeCategory);
    const nextCategories = getTaskCategoryListWith([...getProjectTaskCategories(project), category]);
    const newTask = normalizeTask({ id: Date.now(), text: '', completed: false, tag: DEFAULT_TASK_TAG, category });
    // Add new tasks above existing tasks so the newest task appears at the top.
    const updatedTasks = sortTasks([newTask, ...project.tasks]);
    
    state.updateProject(projectId, projectUpdate({ tasks: updatedTasks, taskCategories: nextCategories }));
    saveData();
    refreshProjectCalendarIfPresent(projectId);
    
    return newTask.id;
}

function reorderTasks(projectId, oldIndex, newIndex, renderedTaskIds = []) {
    const project = state.findProject(projectId);
    if (!project || !Array.isArray(project.tasks)) return;

    const visibleTaskIds = renderedTaskIds
        .map(id => Number(id))
        .filter(id => Number.isFinite(id));

    const movedTaskId = visibleTaskIds[oldIndex];
    if (!Number.isFinite(movedTaskId)) return;

    const displayOrder = [...visibleTaskIds];
    const [movedId] = displayOrder.splice(oldIndex, 1);
    displayOrder.splice(newIndex, 0, movedId);

    const displayIndexById = new Map(displayOrder.map((id, index) => [id, index]));
    const originalTasks = project.tasks.map((task, index) => normalizeTask(task, index));
    const visibleTasks = originalTasks.filter(task => displayIndexById.has(task.id));

    if (visibleTasks.length !== displayOrder.length) return;

    const reorderedVisibleTasks = [...visibleTasks].sort((a, b) => {
        return displayIndexById.get(a.id) - displayIndexById.get(b.id);
    });

    let visibleCursor = 0;
    const tasks = originalTasks.map(task => {
        if (!displayIndexById.has(task.id)) return task;
        return reorderedVisibleTasks[visibleCursor++] || task;
    });

    const pageScrollX = window.scrollX;
    const pageScrollY = window.scrollY;
    const modalState = captureProjectModalState(projectId);

    state.updateProject(projectId, projectUpdate({ tasks }));
    saveData();

    if (document.getElementById('projectModal')?.classList.contains('active')) {
        renderModalTaskList(projectId);
        updateProjectProgress(projectId);
        restoreProjectModalState(projectId, modalState);
    } else {
        render();
    }

    requestAnimationFrame(() => window.scrollTo(pageScrollX, pageScrollY));
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
        const completedTasks = project.tasks.filter(t => isTaskCompleted(t)).length;
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
            
            if (isTaskCompleted(task)) {
                state.incrementCompletedTasks();
            }
            
            saveData();
            const modalOpen = document.getElementById('projectModal')?.classList.contains('active');
            const modalTaskList = document.getElementById(`modal-task-list-${projectId}`);
            render();
            if (modalOpen && modalTaskList) {
                renderModalTaskList(projectId);
                updateProjectProgress(projectId);
            }
        }
    } else if (undoEntry.action === 'taskCompletion') {
        restoreTaskCompletionUndo(undoEntry);
    }
    
    updateUndoButton();
    updateTotalCompletion();
}

function updateUndoButton() {
    const hasUndo = state.hasUndo();
    const sidebarUndoButton = document.getElementById('undoButton');

    if (sidebarUndoButton) {
        if (hasUndo) {
            sidebarUndoButton.classList.remove('hidden');
        } else {
            sidebarUndoButton.classList.add('hidden');
        }
    }

    document.querySelectorAll('[data-undo-button]').forEach(button => {
        button.disabled = !hasUndo;
        button.setAttribute('aria-disabled', String(!hasUndo));
        button.classList.toggle('is-disabled', !hasUndo);
    });
}

// ============================================================================
// TASK SELECTION (SHIFT-CLICK)
// ============================================================================

function handleTaskClick(projectId, taskId, event) {
    if (event?.shiftKey) {
        const lastSelected = state.lastSelectedTask.get(projectId);
        if (lastSelected) {
            state.selectTaskRange(projectId, lastSelected, taskId);
        } else {
            state.selectTask(projectId, taskId, false);
        }
        renderModalTaskList(projectId);
    } else if (event?.ctrlKey || event?.metaKey) {
        state.toggleTaskSelection(projectId, taskId);
        renderModalTaskList(projectId);
    }
}

// ============================================================================
// TOTAL COMPLETION CALCULATION
// ============================================================================

function calculateVisibleCompletionStats() {
    const projects = state.getProjects().filter(project => !isProjectArchived(project));
    return projects.reduce((totals, project) => {
        const tasks = Array.isArray(project.tasks) ? project.tasks : [];
        totals.totalTasks += tasks.length;
        totals.completedTasks += tasks.filter(task => isTaskCompleted(task)).length;
        return totals;
    }, { totalTasks: 0, completedTasks: 0 });
}

function calculateTotalCompletion() {
    const { totalTasks, completedTasks } = calculateVisibleCompletionStats();
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
    syncProjectCategorySelect();
}

function getCurrentProjectCategoryValue() {
    if (state.getView() === VIEWS.ARCHIVED) return 'archived';
    if (state.getView() === VIEWS.COMPLETED) return 'completed';
    if (uiState.ownerFilter === 'shared') return 'shared';
    return 'active';
}

function syncProjectCategorySelect() {
    const select = document.getElementById('projectCategorySelect');
    if (select) select.value = getCurrentProjectCategoryValue();
}

function switchProjectCategory(categoryValue) {
    if (categoryValue === 'shared') {
        switchToSharedView();
    } else if (categoryValue === 'completed') {
        switchToCompletedView();
    } else if (categoryValue === 'archived') {
        switchToArchivedView();
    } else {
        switchToActiveView();
    }
}

function setProjectCardSortMode(sortMode, persist = true) {
    uiState.sortMode = normalizeProjectSortMode(sortMode);
    syncProjectSortSelect();
    if (persist) persistProjectSortPreference(uiState.sortMode);
    render();
}

function syncViewTitle() {
    if (state.getView() === VIEWS.ARCHIVED) {
        setViewTitle('Archived Projects');
    } else if (state.getView() === VIEWS.COMPLETED) {
        setViewTitle('Completed Projects');
    } else if (uiState.ownerFilter === 'shared') {
        setViewTitle('Shared');
    } else {
        setViewTitle('Active Projects');
    }
}

// ============================================================================
// VIEW MANAGEMENT
// ============================================================================

function setSidebarProjectsNav(activeId) {
    const collapsedNavMap = {
        activeProjectsCard: 'collapsedActiveProjectsCard',
        sharedProjectsCard: 'collapsedSharedProjectsCard',
        completedProjectsCard: 'collapsedCompletedProjectsCard',
        archivedProjectsMoreBtn: 'collapsedArchivedProjectsMoreBtn'
    };
    ['activeProjectsCard', 'sharedProjectsCard', 'completedProjectsCard', 'archivedProjectsMoreBtn'].forEach(id => {
        document.getElementById(id)?.classList.toggle('active', id === activeId);
        const collapsedId = collapsedNavMap[id];
        document.getElementById(collapsedId)?.classList.toggle('active', id === activeId);
    });
}

function switchToActiveView() {
    // Reset the internal view filter so clicking "Active" after "Shared"
    // shows all active projects.
    uiState.ownerFilter = 'all';
    state.setView(VIEWS.ACTIVE);
    setSidebarProjectsNav('activeProjectsCard');
    setViewTitle('Active Projects');
    render();
}

function switchToCompletedView() {
    uiState.ownerFilter = 'all';
    state.setView(VIEWS.COMPLETED);
    setSidebarProjectsNav('completedProjectsCard');
    setViewTitle('Completed Projects');
    render();
}

function switchToArchivedView() {
    uiState.ownerFilter = 'all';
    uiState.activeSavedViewId = '';
    state.setView(VIEWS.ARCHIVED);
    setSidebarProjectsNav('archivedProjectsMoreBtn');
    setViewTitle('Archived Projects');
    render();
}

// ============================================================================
// DRAG AND DROP
// ============================================================================

// Project drag-to-reorder (handle-based pointer slide)
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

    if (!projectGrid.__projectGridClickBound) {
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
        projectGrid.__projectGridClickBound = true;
    }

    const cards = Array.from(projectGrid.querySelectorAll('.project-card'));
    cards.forEach((card) => {
        card.setAttribute('draggable', 'false');
        const handle = card.querySelector('.project-card-reorder-handle');
        if (!handle || handle.__projectReorderHandleBound) return;
        handle.__projectReorderHandleBound = true;

        handle.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
        }, true);

        handle.addEventListener('pointerdown', (e) => {
            if (e.button !== 0) return;
            if (card.dataset.projectCanReorder !== 'true') return;

            const projectId = card.getAttribute('data-project-id');
            if (!projectId) return;

            const viewProjects = state.getCurrentViewProjects();
            const startIndex = viewProjects.findIndex(p => String(p.id) === String(projectId));
            if (startIndex === -1) return;

            e.preventDefault();
            e.stopPropagation();
            clearProjectLongPress();

            const scrollEl = getScrollParent(projectGrid);
            __projectDragScrollEl = scrollEl;
            __projectDrag = {
                pointerId:  e.pointerId,
                startIndex,
                startX:     e.clientX,
                startY:     e.clientY,
                startScrollTop: getProjectDragScrollTop(scrollEl),
                startScrollLeft: getProjectDragScrollLeft(scrollEl),
                scrollEl,
                grid:       projectGrid,
                sourceCard: card,
                sourceHandle: handle,
                active:     false,
                pendingLongPress: false,
                longPressReady: true,
                snapshots:  null,
                targetIndex:     startIndex,
                lastTargetIndex: startIndex
            };

            try { handle.setPointerCapture(e.pointerId); } catch { /* noop */ }

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

    // Escape closes task-note modal first, then exits drag edit mode.
    document.addEventListener('keydown', (e) => {
        if (isTypingTarget(e.target)) return;
        if (e.key === 'Escape' && document.getElementById('sidebarLeaderboardModal')?.classList.contains('active')) {
            closeSidebarLeaderboardModal();
            return;
        }
        if (e.key === 'Escape' && document.getElementById('sidebarSettingsModal')?.classList.contains('active')) {
            closeSidebarSettingsModal();
            return;
        }
        if (e.key === 'Escape' && document.getElementById('leaderboardProfileModal')?.classList.contains('active')) {
            closeLeaderboardProfileModal();
            return;
        }
        if (e.key === 'Escape' && document.getElementById('taskNoteModal')?.classList.contains('active')) {
            closeTaskNoteModal();
            return;
        }
        if (e.key === 'Escape' && __projectEditMode) setProjectEditMode(false);
    });

    // Click outside the grid (or on the modal) exits drag edit mode.
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

function getProjectDragScrollTop(el) {
    if (!el) return 0;
    return (el === document.scrollingElement || el === document.documentElement)
        ? window.scrollY
        : el.scrollTop;
}

function getProjectDragScrollLeft(el) {
    if (!el) return 0;
    return (el === document.scrollingElement || el === document.documentElement)
        ? window.scrollX
        : el.scrollLeft;
}

function getProjectDragDelta(event) {
    if (!__projectDrag) return { dx: 0, dy: 0 };
    const scrollEl = __projectDrag.scrollEl || __projectDragScrollEl;
    return {
        dx: (event.clientX - __projectDrag.startX) + (getProjectDragScrollLeft(scrollEl) - (__projectDrag.startScrollLeft || 0)),
        dy: (event.clientY - __projectDrag.startY) + (getProjectDragScrollTop(scrollEl) - (__projectDrag.startScrollTop || 0))
    };
}

function autoScrollProjectDrag(clientY) {
    if (!__projectDrag || !__projectDrag.active) return;

    // Cache the scroll container for this gesture
    if (!__projectDragScrollEl) __projectDragScrollEl = __projectDrag.scrollEl || getScrollParent(__projectDrag.grid);

    const el = __projectDrag.scrollEl || __projectDragScrollEl;
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

function setProjectDragTransform(card, transformValue) {
    if (!card) return;
    card.style.transform = transformValue;
    card.style.setProperty('--project-card-drag-transform', transformValue);
}

function clearProjectDragTransform(card) {
    if (!card) return;
    card.style.transform = '';
    card.style.removeProperty('--project-card-drag-transform');
}
// ──────────────────────────────────────────────────────────────────────────────
// Pointer handlers
// ──────────────────────────────────────────────────────────────────────────────

function onProjectPointerMove(e) {
    if (!__projectDrag || e.pointerId !== __projectDrag.pointerId) return;

    const moved = Math.hypot(e.clientX - __projectDrag.startX, e.clientY - __projectDrag.startY);

    e.preventDefault();

    // Small movement threshold after grabbing the reorder handle.
    if (!__projectDrag.active) {
        const THRESHOLD = 2;
        if (moved < THRESHOLD) return;
        startProjectSlide(e);
    }

    // Let the viewport scroll first, then include the scroll delta in the drag
    // transform so the card remains attached to the cursor while scrolling.
    autoScrollProjectDrag(e.clientY);

    const { dx, dy } = getProjectDragDelta(e);
    setProjectDragTransform(__projectDrag.sourceCard, `translate3d(${dx}px, ${dy}px, 0)`);

    // Slide idle cards to make room / fill the gap.
    updateProjectSlideItems(e.clientX, e.clientY);
}


function onProjectPointerUp(e) {
    if (!__projectDrag) return;

    // Pointer released before the drag threshold was crossed — nothing to commit.
    if (!__projectDrag.active) {
        e.preventDefault();
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
    setProjectEditMode(true);
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

    const { dx, dy } = getProjectDragDelta(e);
    setProjectDragTransform(sourceCard, `translate3d(${dx}px, ${dy}px, 0)`);
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
    if (sourceCard)  {
        sourceCard.classList.remove('dragging', 'project-card--long-press-pending', 'project-card--long-press-ready');
        clearProjectDragTransform(sourceCard);
        sourceCard.style.cursor = '';
    }
    if (snapshots)   snapshots.forEach(s => {
        s.card.style.setProperty('--slide-x', '0px');
        s.card.style.setProperty('--slide-y', '0px');
    });
}

function cleanupProjectDrag() {
    window.removeEventListener('pointermove',  onProjectPointerMove);
    window.removeEventListener('pointerup',    onProjectPointerUp);
    window.removeEventListener('pointercancel', onProjectPointerCancel);

    if (__projectLongPressTimer) {
        clearTimeout(__projectLongPressTimer);
        __projectLongPressTimer = null;
    }

    const drag = __projectDrag;
    if (drag?.sourceCard) {
        drag.sourceCard.classList.remove('dragging', 'project-card--long-press-pending', 'project-card--long-press-ready');
        clearProjectDragTransform(drag.sourceCard);
        drag.sourceCard.style.cursor = '';
        try { (drag.sourceHandle || drag.sourceCard).releasePointerCapture(drag.pointerId); } catch { /* noop */ }
    }

    __projectPendingPress = null;
    __projectDrag = null;
    __projectDragScrollEl = null;
    setProjectEditMode(false);
    document.body.style.cursor = '';
}




function applyProjectCalendarManualTaskOrder(projectId, orderedVisibleTaskIds = []) {
    if (!state.canEdit(projectId)) return;
    const project = state.findProject(projectId);
    if (!project || !Array.isArray(project.tasks)) return;

    const orderedIds = orderedVisibleTaskIds.map(id => String(id)).filter(Boolean);
    const uniqueOrderedIds = [...new Set(orderedIds)];
    if (uniqueOrderedIds.length < 2) return;

    const originalTasks = project.tasks.map((task, index) => normalizeTask(task, index));
    const visibleIdSet = new Set(uniqueOrderedIds);
    const taskById = new Map(originalTasks.map(task => [String(task.id), task]));
    const reorderedVisibleTasks = uniqueOrderedIds.map(id => taskById.get(id)).filter(Boolean);

    if (reorderedVisibleTasks.length !== uniqueOrderedIds.length) return;

    const currentVisibleOrder = originalTasks
        .filter(task => visibleIdSet.has(String(task.id)))
        .map(task => String(task.id));
    const nextVisibleOrder = reorderedVisibleTasks.map(task => String(task.id));
    if (currentVisibleOrder.join('|') === nextVisibleOrder.join('|')) return;

    let visibleCursor = 0;
    const tasks = originalTasks.map(task => {
        if (!visibleIdSet.has(String(task.id))) return task;
        return reorderedVisibleTasks[visibleCursor++] || task;
    });

    const pageScrollX = window.scrollX;
    const pageScrollY = window.scrollY;
    const modalState = captureProjectModalState(projectId);

    state.updateProject(projectId, projectUpdate({ tasks }));
    saveData();
    renderModalTaskList(projectId);
    renderProjectCalendarSection(projectId, { preserveScroll: true });
    updateProjectProgress(projectId);
    restoreProjectModalState(projectId, modalState);

    requestAnimationFrame(() => window.scrollTo(pageScrollX, pageScrollY));
}

function setupProjectCalendarTaskDockDrag(projectId) {
    const calendarSection = document.getElementById(`calendar-section-${projectId}`);
    const taskList = calendarSection?.querySelector?.('.project-calendar-task-dock-list');
    if (!taskList) return;

    if (typeof taskList.__calendarTaskDragCleanup === 'function') {
        taskList.__calendarTaskDragCleanup();
    }

    let draggingItem = null;
    let dragMode = null;
    let originalOrder = [];
    let moved = false;
    let pointerStartX = 0;
    let pointerStartY = 0;
    let dragScrollContainer = null;
    let dragStartScrollTop = 0;
    let calendarDragGhost = null;
    let calendarDragLayer = null;
    let calendarDragOffsetX = 0;
    let calendarDragOffsetY = 0;

    function getPoint(e) {
        const touch = e.touches?.[0] || e.changedTouches?.[0];
        return {
            x: e.clientX ?? touch?.clientX ?? 0,
            y: e.clientY ?? touch?.clientY ?? 0
        };
    }

    function getCalendarScrollContainer() {
        const modalScroll = taskList.closest('.modal-scroll-inner');
        if (modalScroll && modalScroll.scrollHeight > modalScroll.clientHeight) return modalScroll;
        return document.scrollingElement || document.documentElement;
    }

    function getCalendarScrollTop(scrollEl = getCalendarScrollContainer()) {
        if (scrollEl === document.scrollingElement || scrollEl === document.documentElement || scrollEl === document.body) {
            return window.scrollY || document.documentElement.scrollTop || 0;
        }
        return scrollEl?.scrollTop || 0;
    }

    function getItems() {
        return Array.from(taskList.querySelectorAll('[data-calendar-task-item]'));
    }

    function getTaskIds() {
        return getItems().map(item => item.dataset.taskId).filter(Boolean);
    }

    function getAfterElement(pointerY) {
        const draggableItems = getItems().filter(item => item !== draggingItem);
        return draggableItems.reduce((closest, child) => {
            const box = child.getBoundingClientRect();
            const offset = pointerY - box.top - box.height / 2;
            if (offset < 0 && offset > closest.offset) {
                return { offset, element: child };
            }
            return closest;
        }, { offset: Number.NEGATIVE_INFINITY, element: null }).element;
    }

    function isIgnoredTarget(target) {
        return !!target.closest?.('button, input, textarea, select, a, .task-checkbox, .project-calendar-task-priority-control, .project-calendar-task-priority-select');
    }

    function getCalendarDropDayAtPoint(x, y) {
        const hits = typeof document.elementsFromPoint === 'function'
            ? document.elementsFromPoint(x, y)
            : [document.elementFromPoint(x, y)].filter(Boolean);
        return hits
            ?.map(element => element?.closest?.('.project-calendar-day[data-calendar-date]'))
            ?.find(Boolean) || null;
    }

    function markDropDayAtPoint(x, y) {
        clearProjectCalendarDropTargets();
        const dropDay = getCalendarDropDayAtPoint(x, y);
        dropDay?.classList?.add('is-drop-target');
        return dropDay;
    }

    function getOrCreateCalendarDragLayer() {
        if (calendarDragLayer?.isConnected) return calendarDragLayer;
        calendarDragLayer = document.querySelector('.project-calendar-drag-layer');
        if (!calendarDragLayer) {
            calendarDragLayer = document.createElement('div');
            calendarDragLayer.className = 'project-calendar-drag-layer';
            calendarDragLayer.setAttribute('aria-hidden', 'true');
            document.body.appendChild(calendarDragLayer);
        }
        return calendarDragLayer;
    }

    function createCalendarDragGhost(item, point = { x: pointerStartX, y: pointerStartY }) {
        if (!item) return null;
        const rect = item.getBoundingClientRect();
        const ghost = item.cloneNode(true);
        ghost.removeAttribute('id');
        ghost.removeAttribute('draggable');
        ghost.querySelectorAll?.('[id]').forEach(child => child.removeAttribute('id'));
        ghost.querySelectorAll?.('button, input, select, textarea').forEach(control => {
            control.setAttribute('tabindex', '-1');
            control.setAttribute('aria-hidden', 'true');
            control.disabled = true;
        });
        ghost.setAttribute('aria-hidden', 'true');
        ghost.classList.remove('is-calendar-task-scheduling', 'is-calendar-task-reordering', 'is-calendar-task-scheduling-source');
        ghost.classList.add('project-calendar-drag-ghost');
        calendarDragOffsetX = Math.max(0, Math.min(rect.width, point.x - rect.left));
        calendarDragOffsetY = Math.max(0, Math.min(rect.height, point.y - rect.top));
        // Apply positioning inline so the ghost sits at the exact source position on
        // first paint, then follows the pointer via updateCalendarDraggedTaskPosition.
        ghost.style.setProperty('position', 'fixed', 'important');
        ghost.style.setProperty('left', '0', 'important');
        ghost.style.setProperty('top', '0', 'important');
        ghost.style.setProperty('width', `${rect.width}px`, 'important');
        ghost.style.setProperty('height', `${rect.height}px`, 'important');
        ghost.style.setProperty('margin', '0', 'important');
        ghost.style.setProperty('z-index', '2147483647', 'important');
        ghost.style.setProperty('pointer-events', 'none', 'important');
        ghost.style.setProperty('transform', `translate3d(${rect.left}px, ${rect.top}px, 0)`, 'important');
        ghost.style.setProperty('will-change', 'transform', 'important');
        getOrCreateCalendarDragLayer().appendChild(ghost);
        item.classList.add('is-calendar-task-scheduling-source');
        return ghost;
    }

    function removeCalendarDragGhost() {
        if (calendarDragGhost) {
            calendarDragGhost.remove();
            calendarDragGhost = null;
        }
        if (calendarDragLayer && !calendarDragLayer.children.length) {
            calendarDragLayer.remove();
            calendarDragLayer = null;
        }
        calendarDragOffsetX = 0;
        calendarDragOffsetY = 0;
    }

    function updateCalendarDraggedTaskPosition(x, y) {
        if (!draggingItem) return;
        if (calendarDragGhost) {
            calendarDragGhost.style.setProperty('transform', `translate3d(${x - calendarDragOffsetX}px, ${y - calendarDragOffsetY}px, 0)`, 'important');
        } else {
            const scrollDelta = getCalendarScrollTop(dragScrollContainer || getCalendarScrollContainer()) - dragStartScrollTop;
            draggingItem.style.setProperty('transform', `translate3d(${x - pointerStartX}px, ${y - pointerStartY + scrollDelta}px, 0)`, 'important');
        }
        markDropDayAtPoint(x, y);
    }

    function clearCalendarDragClasses() {
        taskList.classList.remove('is-calendar-task-reordering', 'is-calendar-task-scheduling');
        if (draggingItem) {
            draggingItem.classList.remove('is-calendar-task-reordering', 'is-calendar-task-scheduling', 'is-calendar-task-scheduling-source');
            draggingItem.style.transform = '';
        }
        taskList.querySelectorAll('.is-calendar-task-scheduling-source').forEach(item => {
            item.classList.remove('is-calendar-task-scheduling-source');
        });
        removeCalendarDragGhost();
    }

    function onStart(e) {
        const item = e.target.closest?.('[data-calendar-task-item]');
        if (!item || !taskList.contains(item) || !state.canEdit(projectId)) return;

        const handle = e.target.closest?.('.project-calendar-task-drag-handle');
        const isManualReorder = !!handle && getProjectTaskSortPreference(projectId) === DEFAULT_TASK_SORT_MODE;
        if (!isManualReorder && isIgnoredTarget(e.target)) return;
        if (isManualReorder && !item.contains(handle)) return;

        const point = getPoint(e);
        e.preventDefault();
        e.stopPropagation();
        draggingItem = item;
        dragMode = isManualReorder ? 'reorder' : 'schedule';
        originalOrder = getTaskIds();
        pointerStartX = point.x;
        pointerStartY = point.y;
        dragScrollContainer = getCalendarScrollContainer();
        dragStartScrollTop = getCalendarScrollTop(dragScrollContainer);
        moved = false;
        item.classList.add(dragMode === 'reorder' ? 'is-calendar-task-reordering' : 'is-calendar-task-scheduling');
        calendarDragGhost = createCalendarDragGhost(item, point);
        updateCalendarDraggedTaskPosition(point.x, point.y);
        taskList.classList.add(dragMode === 'reorder' ? 'is-calendar-task-reordering' : 'is-calendar-task-scheduling');
        document.body.style.userSelect = 'none';
        document.body.classList.add('is-calendar-task-dragging');

        document.addEventListener('mousemove', onMove);
        document.addEventListener('touchmove', onMove, { passive: false });
        document.addEventListener('mouseup', onEnd);
        document.addEventListener('touchend', onEnd);
        document.addEventListener('touchcancel', onEnd);
    }

    function onMove(e) {
        if (!draggingItem) return;
        e.preventDefault();
        const point = getPoint(e);

        if (dragMode === 'reorder') {
            const afterElement = getAfterElement(point.y);
            if (!afterElement) taskList.appendChild(draggingItem);
            else taskList.insertBefore(draggingItem, afterElement);
        }

        updateCalendarDraggedTaskPosition(point.x, point.y);
        moved = true;
    }

    function onEnd(e) {
        if (!draggingItem) return;
        const activeDraggingItem = draggingItem;
        const activeDragMode = dragMode;
        const nextOrder = getTaskIds();
        const point = getPoint(e || {});
        const dropDay = getCalendarDropDayAtPoint(point.x, point.y);
        const dropDate = dropDay?.getAttribute?.('data-calendar-date') || '';
        const droppedTaskId = activeDraggingItem.dataset.taskId;

        clearCalendarDragClasses();
        document.body.style.userSelect = '';
        document.body.classList.remove('is-calendar-task-dragging');
        draggingItem = null;
        dragMode = null;
        dragScrollContainer = null;
        dragStartScrollTop = 0;

        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('touchmove', onMove);
        document.removeEventListener('mouseup', onEnd);
        document.removeEventListener('touchend', onEnd);
        document.removeEventListener('touchcancel', onEnd);

        if (dropDate && scheduleProjectCalendarTask(projectId, droppedTaskId, dropDate, { preserveScroll: true })) {
            clearProjectCalendarDropTargets();
            return;
        }

        clearProjectCalendarDropTargets();
        if (activeDragMode === 'reorder' && moved && originalOrder.join('|') !== nextOrder.join('|')) {
            applyProjectCalendarManualTaskOrder(projectId, nextOrder);
        }
    }

    taskList.addEventListener('mousedown', onStart);
    taskList.addEventListener('touchstart', onStart, { passive: false });
    taskList.__calendarTaskDragCleanup = () => {
        taskList.removeEventListener('mousedown', onStart);
        taskList.removeEventListener('touchstart', onStart);
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('touchmove', onMove);
        document.removeEventListener('mouseup', onEnd);
        document.removeEventListener('touchend', onEnd);
        document.removeEventListener('touchcancel', onEnd);
        clearCalendarDragClasses();
        clearProjectCalendarDropTargets();
        removeCalendarDragGhost();
        draggingItem = null;
        dragMode = null;
        dragScrollContainer = null;
        dragStartScrollTop = 0;
        document.body.style.userSelect = '';
        document.body.classList.remove('is-calendar-task-dragging');
    };
}

function setupTaskDragAndDrop(projectId) {
    const taskList = document.getElementById(`modal-task-list-${projectId}`);
    if (!taskList) return;

    if (typeof taskList.__taskDragCleanup === 'function') {
        taskList.__taskDragCleanup();
    }

    // ── per-gesture state (reset each drag) ──
    let pendingDragItem = null;
    let draggableItem = null;
    let pointerStartX = 0;
    let pointerStartY = 0;
    let lastPointerX = 0;
    let lastPointerY = 0;
    let itemsGap = 0;
    let cachedItems = [];          // lazily populated, cleared on release
    let currentDropCategory = null;
    let autoScrollFrame = null;
    let autoScrollVelocity = 0;
    let suppressClickAfterDrag = false;
    let dragScrollContainer = null;
    let dragStartScrollPosition = 0;

    // ── helpers ──
function suppressNextTaskClick(event) {
    if (!suppressClickAfterDrag) return;
    suppressClickAfterDrag = false;
    document.removeEventListener('click', suppressNextTaskClick, true);

    // Only suppress the synthetic click that follows a task drag inside the task list.
    // Outside/backdrop clicks should still close the project modal with one click.
    if (!taskList.contains(event.target)) return;

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation?.();
}
    function getPoint(e) {
        const touch = e.touches?.[0] || e.changedTouches?.[0];
        return {
            x: e.clientX ?? touch?.clientX ?? 0,
            y: e.clientY ?? touch?.clientY ?? 0
        };
    }
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
    function isTaskDragIgnoredTarget(target) {
        return !!target.closest?.('button, input, textarea, select, a, .task-bulk-select, .task-checkbox, .task-meta-controls, .task-due-date-control, .task-due-date-input, .task-priority-control, .task-note-button, .delete-button, [contenteditable="true"], [role="textbox"]');
    }
    function getTaskScrollContainer() {
        const modalScroll = taskList.closest('.modal-scroll-inner');
        if (modalScroll && modalScroll.scrollHeight > modalScroll.clientHeight) return modalScroll;
        return document.scrollingElement || document.documentElement;
    }
    function getTaskScrollPosition(scrollEl = getTaskScrollContainer()) {
        if (scrollEl === document.scrollingElement || scrollEl === document.documentElement || scrollEl === document.body) {
            return window.scrollY || document.documentElement.scrollTop || 0;
        }
        return scrollEl?.scrollTop || 0;
    }
    function getCategoryDropTargets() {
        return Array.from(document.querySelectorAll('[data-task-category-drop]'))
            .filter(el => el.dataset.taskCategoryDropProject === projectId);
    }
    function clearCategoryDropTarget() {
        getCategoryDropTargets().forEach(el => el.classList.remove('is-drop-target'));
        currentDropCategory = null;
    }
    function setCategoryDropTarget(category) {
        const dropCategory = category || null;
        currentDropCategory = dropCategory;
        getCategoryDropTargets().forEach(el => {
            el.classList.toggle('is-drop-target', !!dropCategory && el.dataset.taskCategoryDrop === dropCategory);
        });
    }
    function getCategoryDropTargetAtPoint(x, y) {
        const hits = typeof document.elementsFromPoint === 'function'
            ? document.elementsFromPoint(x, y)
            : [document.elementFromPoint(x, y)].filter(Boolean);

        for (const hit of hits) {
            if (!hit) continue;
            if (draggableItem && (hit === draggableItem || draggableItem.contains(hit))) continue;
            const target = hit.closest?.('[data-task-category-drop]');
            if (!target || target.dataset.taskCategoryDropProject !== projectId) continue;
            return target.dataset.taskCategoryDrop || null;
        }
        return null;
    }
    function stopTaskAutoScroll() {
        autoScrollVelocity = 0;
        if (autoScrollFrame) {
            cancelAnimationFrame(autoScrollFrame);
            autoScrollFrame = null;
        }
    }
    function runTaskAutoScroll() {
        if (!draggableItem || !autoScrollVelocity) {
            autoScrollFrame = null;
            return;
        }

        const scrollEl = getTaskScrollContainer();
        if (scrollEl === document.scrollingElement || scrollEl === document.documentElement || scrollEl === document.body) {
            window.scrollBy(0, autoScrollVelocity);
        } else {
            scrollEl.scrollTop += autoScrollVelocity;
        }

        updateDraggedTaskPosition(lastPointerX, lastPointerY);
        autoScrollFrame = requestAnimationFrame(runTaskAutoScroll);
    }
    function updateTaskAutoScroll(pointerY) {
        const scrollEl = getTaskScrollContainer();
        const rect = (scrollEl === document.scrollingElement || scrollEl === document.documentElement || scrollEl === document.body)
            ? { top: 0, bottom: window.innerHeight }
            : scrollEl.getBoundingClientRect();
        const edgeSize = 92;
        const maxSpeed = 18;
        let velocity = 0;

        if (pointerY < rect.top + edgeSize) {
            velocity = -Math.ceil(((rect.top + edgeSize - pointerY) / edgeSize) * maxSpeed);
        } else if (pointerY > rect.bottom - edgeSize) {
            velocity = Math.ceil(((pointerY - (rect.bottom - edgeSize)) / edgeSize) * maxSpeed);
        }

        autoScrollVelocity = velocity;
        if (velocity && !autoScrollFrame) {
            autoScrollFrame = requestAnimationFrame(runTaskAutoScroll);
        } else if (!velocity) {
            stopTaskAutoScroll();
        }
    }
    function beginDrag() {
        if (!pendingDragItem || draggableItem) return;
        draggableItem = pendingDragItem;
        clearCategoryDropTarget();

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

        dragScrollContainer = getTaskScrollContainer();
        dragStartScrollPosition = getTaskScrollPosition(dragScrollContainer);
        draggableItem.classList.add('dragging');
        suppressClickAfterDrag = true;
        document.addEventListener('click', suppressNextTaskClick, true);
        taskList.classList.add('is-task-dragging');
        document.body.classList.add('is-task-dragging');

        // Prevent text selection while dragging without hiding the page scrollbar.
        document.body.style.userSelect = 'none';
        document.body.style.touchAction = 'none';
    }
    function updateDraggedTaskPosition(cx, cy) {
        if (!draggableItem) return;

        lastPointerX = cx;
        lastPointerY = cy;
        setCategoryDropTarget(getCategoryDropTargetAtPoint(cx, cy));

        // 1. follow the pointer, including scroll delta so the task stays attached while the modal/page auto-scrolls.
        const scrollDelta = getTaskScrollPosition(dragScrollContainer || getTaskScrollContainer()) - dragStartScrollPosition;
        draggableItem.style.transform =
            `translate(${cx - pointerStartX}px, ${cy - pointerStartY + scrollDelta}px)`;

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

        updateTaskAutoScroll(cy);
    }

    // ── drag start ──
    function onStart(e) {
        const item = e.target.closest?.('[data-task-item]');
        if (!item || !taskList.contains(item)) return;

        const handle = e.target.closest?.('.task-drag-handle');
        if (!handle || !item.contains(handle)) return;
        if (isTaskDragIgnoredTarget(e.target)) return;

        const point = getPoint(e);
        pendingDragItem = item;
        pointerStartX = point.x;
        pointerStartY = point.y;
        lastPointerX = pointerStartX;
        lastPointerY = pointerStartY;
        cachedItems = [];
        clearCategoryDropTarget();

        // Make row dragging feel responsive while preventing accidental text selection.
        document.body.style.userSelect = 'none';
        taskList.classList.add('is-task-drag-pending');

        document.addEventListener('mousemove', onMove);
        document.addEventListener('touchmove', onMove, { passive: false });
        document.addEventListener('mouseup',   onEnd);
        document.addEventListener('touchend',  onEnd);
        document.addEventListener('touchcancel', onEnd);
    }

    // ── drag move ──
    function onMove(e) {
        if (!pendingDragItem && !draggableItem) return;
        const point = getPoint(e);
        const dx = point.x - pointerStartX;
        const dy = point.y - pointerStartY;
        const distance = Math.hypot(dx, dy);

        if (!draggableItem) {
            if (distance < 3) return;
            beginDrag();
        }

        if (!draggableItem) return;
        e.preventDefault();
        updateDraggedTaskPosition(point.x, point.y);
    }

    // ── drag end ──
    function onEnd(e) {
        if (!pendingDragItem && !draggableItem) return;

        if (!draggableItem) {
            reset();
            return;
        }

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

        const dropCategory = currentDropCategory || getCategoryDropTargetAtPoint(lastPointerX, lastPointerY);
        const targetCategory = dropCategory === TASK_CATEGORY_DROP_ALL
            ? DEFAULT_TASK_CATEGORY
            : (dropCategory ? sanitizeTaskCategoryName(dropCategory) : null);
        const draggedTaskId = Number(draggableItem.dataset.taskId);
        const draggedTask = state.findProject(projectId)?.tasks
            ?.map((task, index) => normalizeTask(task, index))
            .find(task => task.id === draggedTaskId);
        const shouldMoveToCategory = !!targetCategory &&
            Number.isFinite(draggedTaskId) &&
            draggedTask &&
            draggedTask.category !== targetCategory;

        // wipe all visual state before committing (reorderTasks/updateTaskCategory re-renders the modal)
        draggableItem.classList.remove('dragging');
        draggableItem.style.transform = '';
        all.forEach(item => {
            delete item.dataset.isAbove;
            delete item.dataset.isToggled;
            item.style.transform = '';
        });

        reset();

        if (shouldMoveToCategory) {
            updateTaskCategory(projectId, draggedTaskId, targetCategory);
            return;
        }

        // persist the new order (updates state → saves to MongoDB → re-renders modal)
        if (getProjectTaskSortPreference(projectId) === DEFAULT_TASK_SORT_MODE && originalIndex !== newIndex) {
            const renderedTaskIds = all.map(item => item.dataset.taskId).filter(Boolean);
            reorderTasks(projectId, originalIndex, newIndex, renderedTaskIds);
        }
    }

    // ── cleanup ──
    function reset() {
        stopTaskAutoScroll();
        cachedItems     = [];
        pendingDragItem = null;
        draggableItem   = null;
        dragScrollContainer = null;
        dragStartScrollPosition = 0;
        clearCategoryDropTarget();
        taskList.classList.remove('is-task-drag-pending', 'is-task-dragging');
        document.body.classList.remove('is-task-dragging');
        document.body.style.userSelect  = '';
        document.body.style.touchAction = '';
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('touchmove', onMove);
        document.removeEventListener('mouseup',   onEnd);
        document.removeEventListener('touchend',  onEnd);
        document.removeEventListener('touchcancel', onEnd);
    }

    // ── attach ──
    taskList.addEventListener('mousedown',  onStart);
    taskList.addEventListener('touchstart', onStart, { passive: false });
    taskList.__taskDragCleanup = () => {
        taskList.removeEventListener('mousedown', onStart);
        taskList.removeEventListener('touchstart', onStart);
        reset();
    };
}

// ============================================================================
// MODAL MANAGEMENT
// ============================================================================



function getDisplayTasksForProject(project, options = {}) {
    const tasks = Array.isArray(project?.tasks) ? project.tasks : [];
    const sortMode = options.sortMode || getProjectTaskSortPreference(project?.id);
    const hideCompleted = options.hideCompleted !== undefined
        ? !!options.hideCompleted
        : getProjectHideCompletedPreference(project?.id);
    const activeCategory = options.activeCategory !== undefined
        ? options.activeCategory
        : getProjectTaskCategoryFilter(project?.id);
    const orderedTasks = sortTasksForDisplay(tasks, sortMode);
    const categoryFilteredTasks = activeCategory && activeCategory !== DEFAULT_TASK_CATEGORY_FILTER
        ? orderedTasks.filter(task => normalizeTask(task).category === activeCategory)
        : orderedTasks;
    const displayState = hideCompleted
        ? { visibleTasks: categoryFilteredTasks.filter(task => !isTaskCompleted(task)) }
        : getCompletedTaskDisplayState(project, { sortMode, activeCategory });
    const visibleTasks = displayState.visibleTasks;
    const draftTaskId = Number(uiState.newTaskDraft?.taskId);
    const draftProjectId = String(uiState.newTaskDraft?.projectId || '');
    if (draftProjectId && String(project?.id) === draftProjectId && Number.isFinite(draftTaskId)) {
        const draftIndex = visibleTasks.findIndex(task => Number(task.id) === draftTaskId);
        if (draftIndex > 0) {
            const nextTasks = [...visibleTasks];
            const [draftTask] = nextTasks.splice(draftIndex, 1);
            nextTasks.unshift(draftTask);
            return nextTasks;
        }
    }
    return visibleTasks;
}



function renderProjectPriorityControlMarkup(projectId, project, surface = 'modal') {
    const tag = getProjectPriorityTag(project);
    const label = getProjectPriorityLabel(project);
    const canEdit = state.canEdit(projectId);
    const menuOpen = canEdit && isProjectPriorityMenuOpen(projectId, surface);
    const surfaceClass = surface === 'card' ? 'project-priority-control--card' : 'project-priority-control--modal';
    const buttonClass = surface === 'card'
        ? `project-priority-card-button project-priority-card-button--${tag}`
        : `project-priority-button project-priority-button--${tag}`;
    const indicatorClass = surface === 'card'
        ? `project-priority-card-indicator project-priority-card-indicator--${tag}`
        : `project-priority-indicator project-priority-indicator--${tag}`;
    const buttonLabel = surface === 'card'
        ? `<span class="${indicatorClass}">${renderPriorityFlagMarkup(tag)}</span>`
        : `<span class="${indicatorClass}">${renderPriorityFlagMarkup(tag)}</span><span>Priority: ${escapeHtml(label)}</span>`;
    const clickHandler = canEdit
        ? `onclick="toggleProjectPriorityMenu('${projectId}', '${surface}', event)"`
        : `onclick="event.preventDefault(); event.stopPropagation();" aria-disabled="true"`;

    return `
        <div class="project-priority-control ${surfaceClass} ${menuOpen ? 'is-open' : ''}" onclick="event.stopPropagation();">
            <button class="${buttonClass} ${canEdit ? '' : 'is-readonly'}"
                    type="button"
                    title="Project priority: ${escapeHtml(label)}"
                    aria-label="Project priority: ${escapeHtml(label)}"
                    ${clickHandler}>
                ${buttonLabel}
            </button>
            ${menuOpen ? `
                <div class="task-priority-popover project-priority-popover" onclick="event.stopPropagation()">
                    ${TASK_TAG_OPTIONS.map(option => `
                        <button class="task-priority-option ${tag === option.value ? 'is-active' : ''}"
                                type="button"
                                onclick="selectProjectPriority('${projectId}', '${option.value}', '${surface}', event)">
                            <span class="task-tag-flag task-tag-flag--${option.value}" aria-hidden="true"></span>
                            <span>${option.label}</span>
                        </button>
                    `).join('')}
                </div>
            ` : ''}
        </div>
    `;
}

function renderTaskTagOptions(selectedValue) {
    return TASK_TAG_OPTIONS.map(option => `
        <option value="${option.value}" ${selectedValue === option.value ? 'selected' : ''}>${option.label}</option>
    `).join('');
}

function renderTaskCategoryOptions(project, selectedValue) {
    return getProjectTaskCategories(project).map(category => `
        <option value="${escapeHtml(category)}" ${selectedValue === category ? 'selected' : ''}>${escapeHtml(category)}</option>
    `).join('');
}

function getIncompleteTaskCountForCategory(project, categoryValue) {
    const tasks = Array.isArray(project?.tasks) ? project.tasks : [];
    const normalizedCategory = categoryValue === TASK_CATEGORY_DROP_ALL || categoryValue === DEFAULT_TASK_CATEGORY_FILTER
        ? TASK_CATEGORY_DROP_ALL
        : sanitizeTaskCategoryName(categoryValue);

    return tasks.reduce((count, task, index) => {
        const normalizedTask = normalizeTask(task, index);
        if (normalizedTask.completed) return count;
        if (normalizedCategory === TASK_CATEGORY_DROP_ALL) return count + 1;
        return normalizedTask.category === normalizedCategory ? count + 1 : count;
    }, 0);
}

function getIncompleteTaskCountForPriority(project, tagValue) {
    const tasks = Array.isArray(project?.tasks) ? project.tasks : [];
    const normalizedTag = normalizePriorityTagValue(tagValue);

    return tasks.reduce((count, task, index) => {
        const normalizedTask = normalizeTask(task, index);
        return !normalizedTask.completed && normalizedTask.tag === normalizedTag ? count + 1 : count;
    }, 0);
}

function buildTaskCategoryControlsMarkup(projectId, project, activeCategory) {
    const categories = getProjectTaskCategories(project);
    const canEdit = state.canEdit(projectId);
    const isCreating = uiState.creatingTaskCategoryProjectId === projectId;
    const editingCategory = uiState.editingTaskCategory?.projectId === projectId
        ? uiState.editingTaskCategory.category
        : null;
    const tabItems = [
        { kind: 'all', label: 'All', category: DEFAULT_TASK_CATEGORY_FILTER }
    ];

    categories.forEach(category => {
        tabItems.push({ kind: 'category', label: category, category });
    });

    if (canEdit) {
        tabItems.push({ kind: isCreating ? 'create-input' : 'create', label: '+', category: null });
    }

    return `
        <div class="task-category-toolbar">
            <div class="task-category-tabs" role="tablist" aria-label="Task categories">
                ${tabItems.map((tab, index) => {
                    const positionClass = getTaskCategoryTabPositionClass(index, tabItems.length);
                    const isAll = tab.kind === 'all';
                    const isCategory = tab.kind === 'category';
                    const isEditingCategory = isCategory && editingCategory === tab.category;
                    const isCreate = tab.kind === 'create' || tab.kind === 'create-input';
                    const isInput = tab.kind === 'create-input';
                    const isActive = !isCreate && activeCategory === tab.category;
                    const categoryLiteral = tab.category ? serializeInlineJsString(tab.category) : null;
                    const filterLiteral = serializeInlineJsString(tab.category || DEFAULT_TASK_CATEGORY_FILTER);
                    const menuCategoryValue = isAll ? TASK_CATEGORY_DROP_ALL : (isCategory ? tab.category : null);
                    const menuCategoryLiteral = menuCategoryValue ? serializeInlineJsString(menuCategoryValue) : null;
                    const canShowTabMenu = canEdit && !isEditingCategory && (isAll || isCategory);
                    const menuOpen = canShowTabMenu && isTaskCategoryMenuOpen(projectId, menuCategoryValue);
                    const incompleteInTab = canShowTabMenu ? getIncompleteTaskCountForCategory(project, menuCategoryValue) : 0;
                    const shellClasses = ['task-category-tab-shell', positionClass];
                    const wrapClasses = ['task-category-tab-wrap', positionClass.replace('shell', 'wrap')];
                    if (isAll) {
                        shellClasses.push('task-category-tab-shell--all');
                        wrapClasses.push('task-category-tab-wrap--all');
                    }
                    if (isCreate) {
                        shellClasses.push('task-category-tab-shell--create');
                        wrapClasses.push('task-category-tab-wrap--create');
                    }
                    if (isInput || isEditingCategory) {
                        shellClasses.push('is-editing');
                        wrapClasses.push('is-editing');
                    }
                    if (isActive) {
                        shellClasses.push('is-active');
                        wrapClasses.push('is-active');
                    }
                    if (menuOpen) {
                        shellClasses.push('is-menu-open');
                        wrapClasses.push('is-menu-open');
                    }
                    const dropCategoryValue = tab.kind === 'all'
                        ? TASK_CATEGORY_DROP_ALL
                        : (tab.kind === 'category' ? tab.category : null);
                    const dropAttributes = dropCategoryValue
                        ? ` data-task-category-drop="${escapeHtml(dropCategoryValue)}" data-task-category-drop-project="${escapeHtml(projectId)}"`
                        : '';
                    const reorderAttributes = isCategory
                        ? ` data-task-category-reorder="${escapeHtml(tab.category)}"`
                        : '';
                    const shellClick = (isInput || isEditingCategory)
                        ? ''
                        : (tab.kind === 'create'
                            ? ` onclick="startInlineTaskCategoryCreate('${projectId}', event)"`
                            : ` onclick="setProjectTaskCategoryFilter('${projectId}', ${filterLiteral})"`);
                    const tabControl = isInput ? `
                        <input class="task-category-inline-input"
                               type="text"
                               aria-label="New task category"
                               placeholder="New tab"
                               autocomplete="off"
                               onkeydown="handleInlineTaskCategoryCreateKeydown('${projectId}', event)"
                               onblur="commitInlineTaskCategoryCreate('${projectId}', this.value)">
                    ` : (isEditingCategory ? `
                        <input class="task-category-inline-input task-category-inline-input--edit"
                               type="text"
                               aria-label="Edit task tab title"
                               value="${escapeHtml(tab.label)}"
                               autocomplete="off"
                               onclick="event.stopPropagation();"
                               onkeydown="handleInlineTaskCategoryEditKeydown('${projectId}', ${categoryLiteral}, event)"
                               onblur="commitInlineTaskCategoryEdit('${projectId}', ${categoryLiteral}, this.value)">
                    ` : `
                        <button class="task-category-tab"
                                type="button"
                                ${tab.kind === 'category' ? `ondblclick="event.stopPropagation(); renameTaskCategoryPrompt('${projectId}', ${categoryLiteral})"` : ''}
                                onclick="event.stopPropagation(); ${tab.kind === 'create' ? `startInlineTaskCategoryCreate('${projectId}', event)` : `setProjectTaskCategoryFilter('${projectId}', ${filterLiteral})`}">${escapeHtml(tab.label)}</button>
                    `);
                    return `
                        <div class="${wrapClasses.join(' ')}"${dropAttributes}${reorderAttributes}>
                            <div class="${shellClasses.join(' ')}"${shellClick}>
                                ${tabControl}
                                ${canShowTabMenu ? `
                                    <button class="task-category-menu-button"
                                            type="button"
                                            aria-label="Tab options"
                                            aria-expanded="${menuOpen ? 'true' : 'false'}"
                                            onmousedown="event.stopPropagation();"
                                            onpointerdown="event.stopPropagation();"
                                            onclick="toggleTaskCategoryMenu('${projectId}', ${menuCategoryLiteral}, event)">
                                        <span></span><span></span><span></span>
                                    </button>
                                ` : ''}
                            </div>
                            ${menuOpen ? `
                                <div class="task-category-menu-popover" onclick="event.stopPropagation()">
                                    <button class="task-category-menu-option task-category-menu-option--bulk"
                                            type="button"
                                            ${incompleteInTab > 0 ? '' : 'disabled'}
                                            onclick="event.stopPropagation(); completeTasksByCategory('${projectId}', ${menuCategoryLiteral}, event)">
                                        Mark ${isAll ? 'all tasks' : 'tab tasks'} complete${incompleteInTab > 0 ? ` (${incompleteInTab})` : ''}
                                    </button>
                                    ${isCategory ? `
                                        <button class="task-category-menu-option" type="button" onclick="event.stopPropagation(); renameTaskCategoryPrompt('${projectId}', ${categoryLiteral})">Edit</button>
                                        <button class="task-category-menu-option task-category-menu-option--danger" type="button" onclick="event.stopPropagation(); deleteTaskCategory('${projectId}', ${categoryLiteral})">Delete</button>
                                    ` : ''}
                                </div>
                            ` : ''}
                        </div>`;
                }).join('')}
            </div>
        </div>
    `;
}

function renderTaskCategoryControls(projectId) {
    const project = state.findProject(projectId);
    const container = document.getElementById(`task-category-controls-${projectId}`);
    if (!project || !container) return;
    let activeCategory = getProjectTaskCategoryFilter(projectId);
    const categories = getProjectTaskCategories(project);
    if (activeCategory !== DEFAULT_TASK_CATEGORY_FILTER && !categories.includes(activeCategory)) {
        activeCategory = DEFAULT_TASK_CATEGORY_FILTER;
        setStoredProjectTaskCategoryFilter(projectId, activeCategory);
    }
    container.innerHTML = buildTaskCategoryControlsMarkup(projectId, project, activeCategory);
    setupTaskCategoryTabReorder(projectId);
    if (uiState.creatingTaskCategoryProjectId === projectId || uiState.editingTaskCategory?.projectId === projectId) {
        requestAnimationFrame(() => {
            const input = container.querySelector('.task-category-inline-input');
            if (input) {
                input.focus();
                input.select?.();
            }
        });
    }
}


function buildProjectTagControlsMarkup(projectId, project) {
    const tags = getProjectTags(project);
    const canEdit = state.canEdit(projectId);
    const isCreating = uiState.creatingProjectTagProjectId === projectId;
    const editingTag = uiState.editingProjectTag?.projectId === projectId
        ? uiState.editingProjectTag.originalTag
        : null;

    return `
        <div class="project-tag-controls" id="project-tag-controls-${projectId}">
            <div class="project-tag-chip-list">
                ${tags.length ? tags.map(tag => {
                    const tagLiteral = serializeInlineJsString(tag);
                    const isEditing = canEdit && editingTag === tag;
                    return `
                        <span class="project-tag-chip ${isEditing ? 'is-editing' : ''}">
                            ${isEditing ? `
                                <input class="project-tag-inline-input project-tag-inline-input--edit"
                                       type="text"
                                       maxlength="${PROJECT_TAG_MAX_LENGTH}"
                                       value="${escapeHtml(tag)}"
                                       autocomplete="off"
                                       aria-label="Edit ${escapeHtml(tag)} tag"
                                       onclick="event.stopPropagation();"
                                       onkeydown="handleInlineProjectTagEditKeydown('${projectId}', ${tagLiteral}, event)"
                                       onblur="commitInlineProjectTagEdit('${projectId}', ${tagLiteral}, this.value)">
                            ` : `
                                <button class="project-tag-label"
                                        type="button"
                                        title="Edit ${escapeHtml(tag)} tag"
                                        aria-label="Edit ${escapeHtml(tag)} tag"
                                        onclick="startInlineProjectTagEdit('${projectId}', ${tagLiteral}, event)">${escapeHtml(tag)}</button>
                                ${canEdit ? `<button class="project-tag-remove" type="button" aria-label="Remove ${escapeHtml(tag)} tag" onclick="deleteProjectTag('${projectId}', ${tagLiteral}, event)">×</button>` : ''}
                            `}
                        </span>
                    `;
                }).join('') : ''}
                ${canEdit ? (isCreating ? `
                    <input class="project-tag-inline-input"
                           type="text"
                           maxlength="${PROJECT_TAG_MAX_LENGTH}"
                           placeholder="New tag"
                           autocomplete="off"
                           onkeydown="handleInlineProjectTagCreateKeydown('${projectId}', event)"
                           onblur="commitInlineProjectTagCreate('${projectId}', this.value)">
                ` : `
                    <button class="project-tag-add" type="button" onclick="startInlineProjectTagCreate('${projectId}', event)">+</button>
                `) : ''}
            </div>
        </div>
    `;
}

function renderProjectTagControls(projectId) {
    const project = state.findProject(projectId);
    const container = document.getElementById(`project-tag-controls-${projectId}`);
    if (!project || !container) return;
    container.outerHTML = buildProjectTagControlsMarkup(projectId, project);
    if (uiState.creatingProjectTagProjectId === projectId) {
        requestAnimationFrame(() => {
            document.querySelector(`#project-tag-controls-${projectId} .project-tag-inline-input`)?.focus({ preventScroll: true });
        });
    }
    if (uiState.editingProjectTag?.projectId === projectId) {
        requestAnimationFrame(() => {
            const input = document.querySelector(`#project-tag-controls-${projectId} .project-tag-inline-input--edit`);
            if (input) {
                input.focus({ preventScroll: true });
                input.select?.();
            }
        });
    }
}

function ensureProjectTagPickerModal() {
    let modal = document.getElementById('projectTagPickerModal');
    if (modal) return modal;

    document.body.insertAdjacentHTML('beforeend', `
        <div class="modal-overlay project-tag-picker-overlay" id="projectTagPickerModal" aria-hidden="true">
            <div class="modal-content project-tag-picker-content" role="dialog" aria-modal="true" aria-labelledby="projectTagPickerTitle">
                <div class="project-tag-picker-header">
                    <div>
                        <h3 class="project-tag-picker-title" id="projectTagPickerTitle">Project Tags</h3>
                        <p class="project-tag-picker-subtitle">Choose an existing tag or create a new one.</p>
                    </div>
                    <button class="modal-close" type="button" onclick="closeProjectTagPickerModal()" aria-label="Close project tag picker">
                        <svg class="icon-lg" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
                        </svg>
                    </button>
                </div>
                <div class="project-tag-picker-body" id="projectTagPickerBody"></div>
            </div>
        </div>
    `);

    modal = document.getElementById('projectTagPickerModal');
    modal.addEventListener('click', (event) => {
        if (event.target === modal) closeProjectTagPickerModal();
    });
    return modal;
}

function renderProjectTagPickerModal(projectId) {
    const project = state.findProject(projectId);
    const body = document.getElementById('projectTagPickerBody');
    if (!project || !body) return;

    const currentTags = new Set(getProjectTags(project));
    const tagLimitReached = currentTags.size >= PROJECT_TAG_MAX_COUNT;
    const availableTags = [...new Set(state.getProjects()
        .flatMap(existingProject => getProjectTags(existingProject))
        .filter(Boolean))]
        .sort((a, b) => a.localeCompare(b))
        .filter(tag => !currentTags.has(tag));

    body.innerHTML = tagLimitReached ? `
        <div class="project-tag-picker-limit">Projects can have up to ${PROJECT_TAG_MAX_COUNT} tags. Remove a tag before adding another.</div>
    ` : `
        <div class="project-tag-picker-existing">
            <div class="project-tag-picker-label">Existing tags</div>
            <div class="project-tag-picker-list">
                ${availableTags.length ? availableTags.map(tag => {
                    const tagLiteral = serializeInlineJsString(tag);
                    return `<button class="project-tag-picker-chip" type="button" onclick="addProjectTagFromPicker('${projectId}', ${tagLiteral})">${escapeHtml(tag)}</button>`;
                }).join('') : '<span class="project-tag-picker-empty">No unused tags yet</span>'}
            </div>
        </div>
        <div class="project-tag-picker-new">
            <label class="project-tag-picker-label" for="projectTagPickerInput">New tag</label>
            <div class="project-tag-picker-input-row">
                <input class="project-tag-picker-input" id="projectTagPickerInput" maxlength="${PROJECT_TAG_MAX_LENGTH}" placeholder="Type a new tag" autocomplete="off" onkeydown="handleProjectTagPickerKeydown('${projectId}', event)">
                <button class="project-tag-picker-add" type="button" onclick="commitProjectTagPickerInput('${projectId}')">Add Tag</button>
            </div>
        </div>
    `;
}

function openProjectTagPickerModal(projectId, event) {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    if (!state.canEdit(projectId)) return;
    uiState.editingProjectTag = null;
    uiState.creatingProjectTagProjectId = projectId;
    const modal = ensureProjectTagPickerModal();
    renderProjectTagPickerModal(projectId);
    modal.classList.add('active');
    modal.setAttribute('aria-hidden', 'false');
    setTimeout(() => document.getElementById('projectTagPickerInput')?.focus({ preventScroll: true }), 0);
}

function closeProjectTagPickerModal() {
    const projectId = uiState.creatingProjectTagProjectId;
    uiState.creatingProjectTagProjectId = null;
    const modal = document.getElementById('projectTagPickerModal');
    if (modal) {
        modal.classList.remove('active');
        modal.setAttribute('aria-hidden', 'true');
    }
    if (projectId) renderProjectTagControls(projectId);
}

function addProjectTagFromPicker(projectId, rawValue) {
    const project = state.findProject(projectId);
    if (!project || !state.canEdit(projectId)) return;
    const currentTags = getProjectTags(project);
    if (currentTags.length >= PROJECT_TAG_MAX_COUNT) {
        renderProjectTagPickerModal(projectId);
        return;
    }
    const nextTag = normalizeProjectTagName(rawValue);
    if (!nextTag) return;

    const nextTags = normalizeProjectTags([...currentTags, nextTag]);
    state.updateProject(projectId, projectUpdate({ tags: nextTags }));
    saveData();
    closeProjectTagPickerModal();
    const openProjectId = getOpenProjectModalId();
    if (openProjectId && String(openProjectId) === String(projectId)) {
        const modalState = captureProjectModalState(projectId);
        openProjectModal(projectId, { restoreState: modalState });
    } else {
        render();
    }
}

function commitProjectTagPickerInput(projectId) {
    const input = document.getElementById('projectTagPickerInput');
    addProjectTagFromPicker(projectId, input?.value || '');
}

function handleProjectTagPickerKeydown(projectId, event) {
    if (event.key === 'Enter') {
        event.preventDefault();
        commitProjectTagPickerInput(projectId);
    } else if (event.key === 'Escape') {
        event.preventDefault();
        closeProjectTagPickerModal();
    }
}

function startInlineProjectTagCreate(projectId, event) {
    openProjectTagPickerModal(projectId, event);
}

function cancelInlineProjectTagCreate(projectId) {
    if (uiState.creatingProjectTagProjectId !== projectId) return;
    closeProjectTagPickerModal();
}

function commitInlineProjectTagCreate(projectId, rawValue) {
    addProjectTagFromPicker(projectId, rawValue);
}

function handleInlineProjectTagCreateKeydown(projectId, event) {
    handleProjectTagPickerKeydown(projectId, event);
}

function startInlineProjectTagEdit(projectId, tagName, event) {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    if (!state.canEdit(projectId)) return;
    const project = state.findProject(projectId);
    if (!project) return;
    const normalizedTag = normalizeProjectTagName(tagName);
    if (!getProjectTags(project).includes(normalizedTag)) return;
    uiState.creatingProjectTagProjectId = null;
    uiState.editingProjectTag = { projectId, originalTag: normalizedTag };
    renderProjectTagControls(projectId);
}

function cancelInlineProjectTagEdit(projectId) {
    if (uiState.editingProjectTag?.projectId !== projectId) return;
    uiState.editingProjectTag = null;
    renderProjectTagControls(projectId);
}

function commitInlineProjectTagEdit(projectId, originalTagName, rawValue) {
    if (!state.canEdit(projectId)) return;
    const editing = uiState.editingProjectTag;
    if (!editing || editing.projectId !== projectId) return;

    const project = state.findProject(projectId);
    if (!project) return;

    const originalTag = normalizeProjectTagName(originalTagName || editing.originalTag);
    const nextTag = normalizeProjectTagName(rawValue);
    uiState.editingProjectTag = null;

    if (!originalTag) {
        renderProjectTagControls(projectId);
        return;
    }

    let nextTags;
    if (!nextTag) {
        nextTags = getProjectTags(project).filter(tag => tag !== originalTag);
        if (uiState.activeProjectTag === originalTag) uiState.activeProjectTag = PROJECT_TAG_ALL_FILTER;
    } else {
        nextTags = normalizeProjectTags(getProjectTags(project).map(tag => tag === originalTag ? nextTag : tag));
        if (uiState.activeProjectTag === originalTag) uiState.activeProjectTag = nextTag;
    }

    state.updateProject(projectId, projectUpdate({ tags: nextTags }));
    saveData();
    renderProjectTagControls(projectId);
    render();
}

function handleInlineProjectTagEditKeydown(projectId, originalTagName, event) {
    if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        commitInlineProjectTagEdit(projectId, originalTagName, event.currentTarget.value);
    } else if (event.key === 'Escape') {
        event.preventDefault();
        cancelInlineProjectTagEdit(projectId);
    }
}

function openProjectTagEditFromCard(projectId, tagName, event) {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    if (!state.canEdit(projectId)) return;
    const normalizedTag = normalizeProjectTagName(tagName);
    uiState.creatingProjectTagProjectId = null;
    uiState.editingProjectTag = { projectId, originalTag: normalizedTag };
    openProjectModal(projectId);
}

function deleteProjectTag(projectId, tagName, event) {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    if (!state.canEdit(projectId)) return;
    const project = state.findProject(projectId);
    if (!project) return;
    const normalizedTag = normalizeProjectTagName(tagName);
    openConfirmationDialog({
        title: 'Delete Project Tag?',
        message: `Delete the "${normalizedTag}" tag from this project?`,
        confirmLabel: 'Delete Tag',
        onConfirm: () => {
            const nextTags = getProjectTags(project).filter(tag => tag !== normalizedTag);
            state.updateProject(projectId, projectUpdate({ tags: nextTags }));
            if (uiState.activeProjectTag === normalizedTag) uiState.activeProjectTag = PROJECT_TAG_ALL_FILTER;
            if (uiState.editingProjectTag?.projectId === projectId && uiState.editingProjectTag.originalTag === normalizedTag) {
                uiState.editingProjectTag = null;
            }
            saveData();
            renderProjectTagControls(projectId);
            render();
        }
    });
}

function setProjectTagFilter(tagName) {
    const normalizedTag = tagName === PROJECT_TAG_ALL_FILTER ? PROJECT_TAG_ALL_FILTER : normalizeProjectTagName(tagName);
    uiState.activeProjectTag = normalizedTag || PROJECT_TAG_ALL_FILTER;
    uiState.activeSavedViewId = '';
    render();
}

function getProjectCardPreviewTasks(project) {
    if (!Array.isArray(project?.tasks)) return [];
    const sortMode = getProjectTaskSortPreference(project?.id);
    const orderedTasks = sortTasksForDisplay(project.tasks, sortMode)
        .map((task, index) => ({ task: normalizeTask(task, index), index }))
        .filter(entry => !isTaskCompleted(entry.task));

    const hasPriorityTasks = orderedTasks.some(entry =>
        normalizePriorityTagValue(entry.task.tag) !== DEFAULT_TASK_TAG
    );

    const previewEntries = hasPriorityTasks
        ? [...orderedTasks].sort((a, b) => {
            const aPriority = getTaskTagPriority(a.task);
            const bPriority = getTaskTagPriority(b.task);
            if (aPriority !== bPriority) return aPriority - bPriority;
            return a.index - b.index;
        })
        : orderedTasks;

    return previewEntries
        .slice(0, 3)
        .map(entry => entry.task);
}

function formatProjectSyncText(project) {
    return `LAST SYNC: ${timeAgo(project?.lastModified || project?.dateCreated)}`;
}

function getProjectCardDescription(project) {
    const rawDescription = String(project?.description || project?.summary || '').trim();
    if (!rawDescription) return '';
    return rawDescription.replace(/\s+/g, ' ').slice(0, 110);
}

function createDefaultProjectNotesTab(body = '') {
    return {
        id: PROJECT_NOTES_DEFAULT_TAB_ID,
        title: 'Notes',
        body: String(body ?? ''),
        links: []
    };
}

function noteCandidateHasContent(value) {
    const normalized = normalizeProjectNotesValue(value);
    if (!String(normalized || '').trim()) return false;
    try {
        const data = normalizeProjectNotesData(normalized);
        return data.tabs.some(tab => getRichTextPlainText(tab.body).length > 0 || normalizeProjectNoteLinks(tab.links || []).length > 0);
    } catch {
        return getRichTextPlainText(normalized).length > 0;
    }
}

function getProjectNotesCandidateFields(project = {}) {
    if (!project || typeof project !== 'object') return [];
    const candidateKeys = [
        'notes',
        'projectNotes',
        'projectNote',
        'notesData',
        'noteTabs',
        'noteTabsData',
        'projectNoteTabs',
        'projectNotesTabs',
        'projectNotesData',
        'notesHtml',
        'notesHTML',
        'notesText',
        'noteText',
        'richTextNotes',
        'projectNotesHtml',
        'projectNotesHTML',
        'projectNotesText',
        'note'
    ];
    const nestedKeys = ['metadata', 'meta', 'details', 'data', 'customFields', 'extra', 'legacy'];
    const values = [];

    candidateKeys.forEach(key => {
        if (Object.prototype.hasOwnProperty.call(project, key)) values.push(project[key]);
    });

    nestedKeys.forEach(parentKey => {
        const nested = project[parentKey];
        if (!nested || typeof nested !== 'object') return;
        candidateKeys.forEach(key => {
            if (Object.prototype.hasOwnProperty.call(nested, key)) values.push(nested[key]);
        });
    });

    return values;
}

function getBestProjectNotesValue(...values) {
    const expandedValues = values.flatMap(value => {
        if (value && typeof value === 'object' && !Array.isArray(value)) {
            const projectCandidates = getProjectNotesCandidateFields(value);
            return projectCandidates.length ? projectCandidates : [value];
        }
        return [value];
    });

    const normalizedValues = expandedValues
        .map(value => normalizeProjectNotesValue(value))
        .filter(value => String(value ?? '').trim().length > 0);

    const withContent = normalizedValues.find(noteCandidateHasContent);
    return withContent || normalizedValues[0] || '';
}

function getProjectNotesValueFromProject(project = {}) {
    if (!project || typeof project !== 'object') return '';
    return getBestProjectNotesValue(project);
}

function normalizeLegacyProjectNoteEntry(entry, index = 0, fallbackTitle = '') {
    const fallbackId = index === 0 ? PROJECT_NOTES_DEFAULT_TAB_ID : `notes-legacy-${index}`;
    const title = String(
        entry?.title ??
        entry?.name ??
        entry?.label ??
        entry?.heading ??
        fallbackTitle ??
        `Note ${index + 1}`
    ).replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim() || `Note ${index + 1}`;
    const bodyValue = typeof entry === 'string'
        ? entry
        : (
            entry?.body ??
            entry?.text ??
            entry?.note ??
            entry?.content ??
            entry?.html ??
            entry?.value ??
            entry?.description ??
            entry?.comment ??
            ''
        );
    const body = typeof bodyValue === 'string' ? bodyValue : normalizeProjectNotesValue(bodyValue);
    const explicitLinks = typeof entry === 'object' && entry !== null
        ? (entry.links ?? entry.hyperlinks ?? entry.urls ?? entry.urlList ?? entry.linkList ?? entry.link ?? entry.url ?? entry.href ?? [])
        : [];
    return normalizeProjectNotesTab({
        id: entry?.id || entry?._id || fallbackId,
        title,
        body,
        links: normalizeProjectNoteLinks(explicitLinks)
    }, index);
}

function buildProjectNotesTabsFromArray(value = []) {
    return value
        .map((entry, index) => normalizeLegacyProjectNoteEntry(entry, index))
        .filter(tab => getRichTextPlainText(tab.body).length > 0 || normalizeProjectNoteLinks(tab.links || []).length > 0);
}

function buildProjectNotesTabsFromMap(value = {}) {
    return Object.entries(value)
        .filter(([key]) => !['__projectNotesTabs', 'activeTabId', 'tabs', 'items', 'entries', 'pages', 'sections', 'links', 'hyperlinks', 'urls', '_id', 'id', 'createdAt', 'updatedAt', 'lastModified'].includes(key))
        .map(([key, entry], index) => normalizeLegacyProjectNoteEntry(entry, index, key))
        .filter(tab => getRichTextPlainText(tab.body).length > 0 || normalizeProjectNoteLinks(tab.links || []).length > 0);
}

function normalizeProjectNotesValue(value = '') {
    if (typeof value === 'string') {
        const raw = value.trim();
        if ((raw.startsWith('{') && raw.endsWith('}')) || (raw.startsWith('[') && raw.endsWith(']'))) {
            try {
                const parsed = JSON.parse(raw);
                if (parsed && typeof parsed === 'object') {
                    if (parsed[PROJECT_NOTES_TAB_DATA_FLAG] === true || Array.isArray(parsed.tabs)) return value;
                    const normalizedParsed = normalizeProjectNotesValue(parsed);
                    if (String(normalizedParsed || '').trim()) return normalizedParsed;
                }
            } catch {
                // Keep plain text that happens to contain braces/brackets.
            }
        }
        return value;
    }
    if (Array.isArray(value)) {
        const tabs = buildProjectNotesTabsFromArray(value);
        if (tabs.length) {
            return serializeProjectNotesData({
                activeTabId: tabs[0]?.id || PROJECT_NOTES_DEFAULT_TAB_ID,
                tabs
            });
        }
        try {
            return JSON.stringify({
                [PROJECT_NOTES_TAB_DATA_FLAG]: true,
                activeTabId: value[0]?.id || PROJECT_NOTES_DEFAULT_TAB_ID,
                tabs: value
            });
        } catch {
            return '';
        }
    }
    if (!value || typeof value !== 'object') return '';

    if (value[PROJECT_NOTES_TAB_DATA_FLAG] === true || Array.isArray(value.tabs)) {
        const sourceTabs = Array.isArray(value.tabs) ? value.tabs : [];
        const normalizedTabs = sourceTabs.length ? buildProjectNotesTabsFromArray(sourceTabs) : [];
        try {
            return JSON.stringify({
                [PROJECT_NOTES_TAB_DATA_FLAG]: true,
                activeTabId: value.activeTabId || normalizedTabs[0]?.id || '',
                tabs: normalizedTabs.length ? normalizedTabs : sourceTabs
            });
        } catch {
            return '';
        }
    }

    const arrayTabFields = ['items', 'entries', 'pages', 'sections', 'noteTabs', 'noteTabsData', 'projectNoteTabs', 'projectNotesTabs', 'projectNotesData'];
    for (const key of arrayTabFields) {
        if (Array.isArray(value[key])) {
            const tabs = buildProjectNotesTabsFromArray(value[key]);
            if (tabs.length) {
                return serializeProjectNotesData({
                    activeTabId: value.activeTabId || tabs[0].id,
                    tabs
                });
            }
        }
    }

    const objectTabFields = ['items', 'entries', 'pages', 'sections', 'noteTabs', 'noteTabsData', 'projectNoteTabs', 'projectNotesTabs', 'projectNotesData'];
    for (const key of objectTabFields) {
        if (value[key] && typeof value[key] === 'object' && !Array.isArray(value[key])) {
            const nestedNotes = normalizeProjectNotesValue(value[key]);
            if (String(nestedNotes || '').trim()) return nestedNotes;
        }
    }

    const legacyBody = value.body ?? value.text ?? value.note ?? value.notes ?? value.content ?? value.html ?? value.value ?? value.description ?? value.comment ?? '';
    const legacyTitle = value.title ?? value.name ?? value.label ?? value.heading ?? 'Notes';
    if (typeof legacyBody === 'string' && legacyBody.trim()) {
        return serializeProjectNotesData({
            activeTabId: PROJECT_NOTES_DEFAULT_TAB_ID,
            tabs: [{
                id: PROJECT_NOTES_DEFAULT_TAB_ID,
                title: legacyTitle,
                body: legacyBody,
                links: value.links ?? value.hyperlinks ?? value.urls ?? []
            }]
        });
    }

    if (legacyBody && typeof legacyBody === 'object') {
        const nestedNotes = normalizeProjectNotesValue(legacyBody);
        if (String(nestedNotes || '').trim()) return nestedNotes;
    }

    const mappedTabs = buildProjectNotesTabsFromMap(value);
    if (mappedTabs.length) {
        return serializeProjectNotesData({
            activeTabId: mappedTabs[0].id,
            tabs: mappedTabs
        });
    }

    return '';
}


function normalizeProjectNotesTab(tab, index = 0) {
    const fallbackId = index === 0 ? PROJECT_NOTES_DEFAULT_TAB_ID : `notes-${Date.now()}-${index}`;
    const id = String(tab?.id || tab?._id || fallbackId).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 48) || fallbackId;
    const title = decodeHtmlEntities(tab?.title || tab?.name || tab?.label || `Note ${index + 1}`).trim().replace(/\s+/g, ' ').slice(0, 40) || `Note ${index + 1}`;
    const body = decodeHtmlEntities(tab?.body ?? tab?.text ?? tab?.note ?? tab?.content ?? tab?.html ?? tab?.value ?? '');
    const links = normalizeProjectNoteLinks(tab?.links ?? tab?.hyperlinks ?? tab?.urls ?? tab?.urlList ?? tab?.linkList ?? tab?.link ?? tab?.url ?? tab?.href ?? []);
    return { id, title, body, links };
}

function normalizeProjectNotesData(notes) {
    const raw = normalizeProjectNotesValue(notes);
    if (raw.trim()) {
        try {
            const parsed = JSON.parse(raw);
            if (parsed && parsed[PROJECT_NOTES_TAB_DATA_FLAG] === true && Array.isArray(parsed.tabs)) {
                const tabs = parsed.tabs.map(normalizeProjectNotesTab).filter(Boolean);
                const safeTabs = tabs.length ? tabs : [createDefaultProjectNotesTab('')];
                const activeTabId = safeTabs.some(tab => tab.id === parsed.activeTabId)
                    ? parsed.activeTabId
                    : safeTabs[0].id;
                return { activeTabId, tabs: safeTabs };
            }
        } catch {
            // Existing plain-text project notes are migrated into the first tab.
        }
    }
    return {
        activeTabId: PROJECT_NOTES_DEFAULT_TAB_ID,
        tabs: [createDefaultProjectNotesTab(raw)]
    };
}

function serializeProjectNotesData(data) {
    const tabs = (Array.isArray(data?.tabs) ? data.tabs : [])
        .map(normalizeProjectNotesTab)
        .filter(Boolean);
    const safeTabs = tabs.length ? tabs : [createDefaultProjectNotesTab('')];
    const activeTabId = safeTabs.some(tab => tab.id === data?.activeTabId)
        ? data.activeTabId
        : safeTabs[0].id;
    return JSON.stringify({
        [PROJECT_NOTES_TAB_DATA_FLAG]: true,
        activeTabId,
        tabs: safeTabs
    });
}

function getProjectNotesPlainText(notes) {
    const data = normalizeProjectNotesData(notes);
    return data.tabs
        .map(tab => `${tab.title} ${getRichTextPlainText(tab.body)} ${(tab.links || []).map(link => `${link.label} ${link.href}`).join(' ')}`.trim())
        .filter(Boolean)
        .join(' ')
        .trim();
}

function projectHasNotes(notes) {
    const data = normalizeProjectNotesData(notes);
    return data.tabs.some(tab => getRichTextPlainText(tab.body).length > 0 || normalizeProjectNoteLinks(tab.links || []).length > 0);
}

function formatProjectNotesPreview(notes) {
    const rawNotes = getProjectNotesPlainText(notes).trim();
    return rawNotes ? rawNotes.replace(/\s+/g, ' ').slice(0, 96) : '';
}

function getProjectModalDescription(project) {
    const rawDescription = String(project?.description || project?.summary || '').trim();
    return rawDescription.replace(/\s+/g, ' ').slice(0, 280);
}

function formatLeaderboardScore(entry, isCurrent = false) {
    const score = getLeaderboardScoreValue(entry);
    return `${Number.isFinite(score) ? score : 0} task${score === 1 ? '' : 's'}`;
}

function renderProjectDueDateControlMarkup(project, surface = 'card') {
    const projectId = project?.id || '';
    const dueDate = getProjectDueDate(project);
    const overdue = isProjectDueDateOverdue(project);
    const canEdit = projectId && state.canEdit(projectId);
    const title = overdue
        ? `Project overdue: ${formatProjectDueDate(dueDate)}`
        : (dueDate ? `Project due ${formatProjectDueDate(dueDate)}` : 'Add project due date');
    const visibleDueDateLabel = dueDate ? `DUE DATE: ${formatProjectDueDate(dueDate)}` : '';
    const safeSurface = String(surface || 'card').replace(/[^a-zA-Z0-9_-]/g, '') || 'card';

    return `
        <label class="project-due-date-control project-due-date-control--${safeSurface} ${dueDate ? 'has-due-date' : ''} ${overdue ? 'is-overdue' : ''} ${canEdit ? '' : 'is-disabled'}"
               title="${escapeHtml(title)}"
               onclick="event.stopPropagation();"
               onpointerdown="event.stopPropagation();">
            ${overdue ? renderWarningTriangleIcon('project-due-overdue-icon') : ''}
            <svg class="project-due-date-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <rect x="3" y="4" width="18" height="18" rx="2.5"></rect>
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 2v4M8 2v4M3 10h18"></path>
            </svg>
            ${dueDate ? `<span class="project-due-date-value" aria-hidden="true">${escapeHtml(visibleDueDateLabel)}</span>` : ''}
            <input class="project-due-date-input"
                   id="project-due-${safeSurface}-${projectId}"
                   type="date"
                   value="${escapeHtml(dueDate)}"
                   aria-label="Project due date"
                   ${canEdit ? `onchange="updateProjectDueDate('${projectId}', this.value)"` : 'disabled'}
                   onclick="event.stopPropagation(); this.showPicker?.();"
                   onpointerdown="event.stopPropagation();">
        </label>
    `;
}

function renderModalTaskItem(projectId, task, selectedTasks = new Set(), sortMode = DEFAULT_TASK_SORT_MODE) {
    const normalizedTask = normalizeTask(task);
    const project = state.findProject(projectId);
    const priorityMenuOpen = isTaskPriorityMenuOpen(projectId, normalizedTask.id);
    const hasTaskNote = getRichTextPlainText(normalizedTask.note).length > 0;
    const dueDate = normalizeTaskDueDate(normalizedTask.dueDate);
    const taskOverdue = isTaskOverdue(normalizedTask);
    const dueDateLabel = taskOverdue ? `Overdue: ${formatTaskDueDate(dueDate)}` : (dueDate ? `Due ${formatTaskDueDate(dueDate)}` : 'Add due date');
    const priorityBulkCount = getIncompleteTaskCountForPriority(project, normalizedTask.tag);
    const priorityBulkLabel = getPriorityTagLabel(normalizedTask.tag);
    const canManualReorder = sortMode === DEFAULT_TASK_SORT_MODE;

    return `
        <div class="task-item ${selectedTasks.has(normalizedTask.id) ? 'selected' : ''}"
             data-task-item
             data-task-id="${normalizedTask.id}"
             onclick="handleTaskClick('${projectId}', ${normalizedTask.id}, event)">
            ${state.canEdit(projectId) ? `
                <button class="task-bulk-select ${selectedTasks.has(normalizedTask.id) ? 'is-selected' : ''}"
                        type="button"
                        aria-label="${selectedTasks.has(normalizedTask.id) ? 'Remove task from bulk edit selection' : 'Select task for bulk editing'}"
                        aria-pressed="${selectedTasks.has(normalizedTask.id) ? 'true' : 'false'}"
                        onclick="toggleTaskBulkSelection('${projectId}', ${normalizedTask.id}, event)">
                    <span aria-hidden="true"></span>
                </button>
            ` : ''}
            ${canManualReorder ? `
                <svg class="task-drag-handle" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 8h16M4 16h16"></path>
                </svg>
            ` : '<span class="task-drag-handle-spacer" aria-hidden="true"></span>'}
            <div class="task-checkbox ${normalizedTask.completed ? 'checked' : ''}"
                 data-task-checkbox="${normalizedTask.id}"
                 onclick="event.stopPropagation(); toggleTask('${projectId}', ${normalizedTask.id})">
                ${normalizedTask.completed ? `
                    <svg class="icon" fill="none" stroke="#f0f4f8" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path>
                    </svg>
                ` : ''}
            </div>
            <div class="task-main-content">
                <span class="task-text ${normalizedTask.completed ? 'completed' : ''}"
                      data-task-text="${normalizedTask.id}"
                      id="modal-task-text-${normalizedTask.id}"
                      onclick="event.stopPropagation(); editModalTask(${normalizedTask.id})">${getTaskDisplayHtml(normalizedTask.text, 'New task')}</span>
                ${state.canEdit(projectId) ? `<div class="task-edit-rich-toolbar" id="modal-task-toolbar-${normalizedTask.id}">${buildRichTextToolbarMarkup(`modal-task-input-${normalizedTask.id}`)}</div>` : ''}
                <div class="task-input task-input--textarea modal-task-edit-editor rich-text-editor"
                     id="modal-task-input-${normalizedTask.id}"
                     role="textbox"
                     aria-multiline="true"
                     data-placeholder="New task"
                     contenteditable="${state.canEdit(projectId) ? 'true' : 'false'}"
                     style="display: none;"
                     oninput="autoResizeModalTaskInput(this)"
                     onblur="finishEditModalTask('${projectId}', ${normalizedTask.id})"
                     onkeydown="handleModalTaskEditKeydown('${projectId}', ${normalizedTask.id}, event)">${getRichTextDisplayHtml(normalizedTask.text || '')}</div>
            </div>
            <div class="task-meta-controls" onclick="event.stopPropagation();">
                <button class="task-copy-button"
                        type="button"
                        aria-label="Copy task"
                        title="Copy task"
                        onclick="copyTaskToClipboard('${projectId}', ${normalizedTask.id}, event)">
                    <svg class="icon" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"></path>
                    </svg>
                </button>
                <label class="task-due-date-control ${dueDate ? 'has-due-date' : ''} ${taskOverdue ? 'is-overdue' : ''}"
                       title="${escapeHtml(dueDateLabel)}"
                       onclick="openTaskDueDatePicker('${projectId}', ${normalizedTask.id}, event)"
                       onpointerdown="event.stopPropagation();">
                    ${taskOverdue ? renderWarningTriangleIcon('task-due-overdue-icon') : ''}
                    <input class="task-due-date-input"
                           id="modal-task-due-${normalizedTask.id}"
                           type="date"
                           value="${escapeHtml(dueDate)}"
                           aria-label="Task due date"
                           onchange="updateTaskDueDate('${projectId}', ${normalizedTask.id}, this.value)"
                           onclick="openTaskDueDatePicker('${projectId}', ${normalizedTask.id}, event)"
                           onpointerdown="event.stopPropagation();">
                </label>
                <button class="task-note-button ${hasTaskNote ? 'has-note' : ''}"
                        type="button"
                        aria-label="${hasTaskNote ? 'Edit task note' : 'Add task note'}"
                        title="${hasTaskNote ? 'Edit task note' : 'Add task note'}"
                        onclick="openTaskNoteModal('${projectId}', ${normalizedTask.id}, event)">
                    <svg class="icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7h8M8 11h8M8 15h4"></path>
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 3h12a2 2 0 012 2v11.5a2 2 0 01-2 2H9l-5 3V5a2 2 0 012-2z"></path>
                    </svg>
                </button>
                <div class="task-priority-control ${priorityMenuOpen ? 'is-open' : ''}" onclick="event.stopPropagation();">
                    <button class="task-priority-button task-priority-button--${normalizedTask.tag}"
                            type="button"
                            aria-label="Task priority"
                            onclick="toggleTaskPriorityMenu('${projectId}', ${normalizedTask.id}, event)">
                        <span class="task-tag-flag task-tag-flag--${normalizedTask.tag}" aria-hidden="true"></span>
                    </button>
                    ${priorityMenuOpen ? `
                        <div class="task-priority-popover" onclick="event.stopPropagation()">
                            ${TASK_TAG_OPTIONS.map(option => `
                                <button class="task-priority-option ${normalizedTask.tag === option.value ? 'is-active' : ''}"
                                        type="button"
                                        onclick="selectTaskPriority('${projectId}', ${normalizedTask.id}, '${option.value}')">
                                    <span class="task-tag-flag task-tag-flag--${option.value}" aria-hidden="true"></span>
                                    <span>${option.label}</span>
                                </button>
                            `).join('')}
                            <div class="task-priority-menu-divider" aria-hidden="true"></div>
                            <button class="task-priority-option task-priority-option--bulk"
                                    type="button"
                                    ${priorityBulkCount > 0 ? '' : 'disabled'}
                                    onclick="completeTasksByPriority('${projectId}', '${normalizedTask.tag}', event)">
                                <span class="task-tag-flag task-tag-flag--${normalizedTask.tag}" aria-hidden="true"></span>
                                <span>Mark all ${escapeHtml(priorityBulkLabel)} complete${priorityBulkCount > 0 ? ` (${priorityBulkCount})` : ''}</span>
                            </button>
                        </div>
                    ` : ''}
                </div>
                <button class="delete-button" onclick="event.stopPropagation(); deleteTaskFromModal('${projectId}', ${normalizedTask.id})" style="opacity: 1;">
                    <svg class="icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path>
                    </svg>
                </button>
            </div>
        </div>
    `;
}

function ensureTaskNoteModal() {
    let modal = document.getElementById('taskNoteModal');
    if (modal) return modal;

    document.body.insertAdjacentHTML('beforeend', `
        <div class="modal-overlay task-note-modal-overlay" id="taskNoteModal" aria-hidden="true">
            <div class="modal-content task-note-modal-content" role="dialog" aria-modal="true" aria-labelledby="taskNoteModalTitle">
                <div class="task-note-modal-header">
                    <div>
                        <h3 class="task-note-modal-title" id="taskNoteModalTitle">Task Note</h3>
                        <p class="task-note-modal-subtitle" id="taskNoteModalSubtitle">Add details for this task.</p>
                    </div>
                    <button class="modal-close" type="button" onclick="closeTaskNoteModal()" aria-label="Close task note">
                        <svg class="icon-lg" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
                        </svg>
                    </button>
                </div>
                ${buildRichTextToolbarMarkup('taskNoteEditor')}
                <div class="task-note-textarea rich-text-editor"
                     id="taskNoteEditor"
                     role="textbox"
                     aria-multiline="true"
                     data-placeholder="Write a note for this task..."
                     contenteditable="true"></div>
                <div class="task-note-modal-actions">
                    <button class="confirm-cancel" type="button" onclick="closeTaskNoteModal()">Cancel</button>
                    <button class="modal-done-btn" type="button" onclick="saveTaskNoteFromModal()">Save Note</button>
                </div>
            </div>
        </div>
    `);

    modal = document.getElementById('taskNoteModal');
    modal.addEventListener('click', (event) => {
        if (event.target === modal) closeTaskNoteModal();
    });
    return modal;
}

function openTaskNoteModal(projectId, taskId, event) {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    if (!state.canEdit(projectId)) return;
    const project = state.findProject(projectId);
    if (!project) return;
    const task = (project.tasks || [])
        .map((item, index) => normalizeTask(item, index))
        .find(item => item.id === taskId);
    if (!task) return;

    const modal = ensureTaskNoteModal();
    modal.dataset.projectId = projectId;
    modal.dataset.taskId = String(taskId);

    const subtitle = modal.querySelector('#taskNoteModalSubtitle');
    if (subtitle) {
        const taskLabel = getTaskPlainText(task.text);
        subtitle.textContent = taskLabel ? `Note for: ${taskLabel}` : 'Add details for this task.';
    }

    const editor = modal.querySelector('#taskNoteEditor');
    if (editor) editor.innerHTML = getRichTextDisplayHtml(task.note || '');

    modal.classList.add('active');
    modal.setAttribute('aria-hidden', 'false');
    requestAnimationFrame(() => editor?.focus({ preventScroll: true }));
}

function closeTaskNoteModal() {
    const modal = document.getElementById('taskNoteModal');
    if (!modal) return;
    modal.classList.remove('active');
    modal.setAttribute('aria-hidden', 'true');
    delete modal.dataset.projectId;
    delete modal.dataset.taskId;
}

function saveTaskNoteFromModal() {
    const modal = document.getElementById('taskNoteModal');
    if (!modal) return;
    const projectId = modal.dataset.projectId;
    const taskId = Number(modal.dataset.taskId);
    const editor = modal.querySelector('#taskNoteEditor');
    if (!projectId || !Number.isFinite(taskId) || !editor) return;
    updateTaskNote(projectId, taskId, getRichTextEditorValue(editor));
    closeTaskNoteModal();
}

function updateTaskNote(projectId, taskId, noteValue) {
    if (!state.canEdit(projectId)) return;
    const project = state.findProject(projectId);
    if (!project) return;

    const updatedTasks = (project.tasks || []).map((task, index) => {
        const normalizedTask = normalizeTask(task, index);
        if (normalizedTask.id !== taskId) return normalizedTask;
        const nextNote = sanitizeRichTextHtml(noteValue).trim();
        return {
            ...normalizedTask,
            note: getRichTextPlainText(nextNote) ? nextNote : ''
        };
    });

    rememberRecentLocalTaskSnapshot(project, updatedTasks);
    state.updateProject(projectId, projectUpdate({ tasks: updatedTasks }));
    saveData();
    renderModalTaskList(projectId);
    render();
}

function buildCompletedTaskDisplayControlsMarkup(projectId, displayState, hideCompleted) {
    if (hideCompleted || !displayState) return '';

    const totalCompleted = Number(displayState.totalCompleted) || 0;
    if (totalCompleted <= 0) return '';

    const visibleCompleted = Number(displayState.visibleCompleted) || 0;
    const hiddenCompleted = Math.max(0, totalCompleted - visibleCompleted);
    const isShowingAll = hiddenCompleted <= 0;
    const showMoreDisabled = isShowingAll ? 'disabled aria-disabled="true"' : '';
    const showAllDisabled = isShowingAll || displayState.completedLimit === 'all'
        ? 'disabled aria-disabled="true"'
        : '';

    return `
        <div class="completed-task-display-controls" id="completed-task-display-controls-${projectId}">
            <span class="completed-task-display-summary">
                ${isShowingAll
                    ? `Showing all ${totalCompleted} completed tasks`
                    : `Showing ${visibleCompleted} of ${totalCompleted} completed tasks`}
            </span>
            <div class="completed-task-display-actions" aria-label="Show more completed tasks">
                <button type="button" class="completed-task-display-button" ${showMoreDisabled} data-completed-task-action="show-more" data-project-id="${escapeHtml(projectId)}" data-amount="50">
                    Show 50 more
                </button>
                <button type="button" class="completed-task-display-button" ${showMoreDisabled} data-completed-task-action="show-more" data-project-id="${escapeHtml(projectId)}" data-amount="100">
                    Show 100 more
                </button>
                <button type="button" class="completed-task-display-button" ${showAllDisabled} data-completed-task-action="show-all" data-project-id="${escapeHtml(projectId)}">
                    Show all
                </button>
            </div>
        </div>
    `;
}

function renderCompletedTaskDisplayControls(projectId, displayState, hideCompleted) {
    const container = document.getElementById(`completed-task-display-controls-shell-${projectId}`);
    if (!container) return;
    container.innerHTML = buildCompletedTaskDisplayControlsMarkup(projectId, displayState, hideCompleted);
}

function getLiveCompletedTaskDisplayState(projectId) {
    const project = state.findProject(projectId);
    if (!project) return null;
    const sortMode = getProjectTaskSortPreference(projectId);
    let activeCategory = getProjectTaskCategoryFilter(projectId);
    const categories = getProjectTaskCategories(project);
    if (activeCategory !== DEFAULT_TASK_CATEGORY_FILTER && !categories.includes(activeCategory)) {
        activeCategory = DEFAULT_TASK_CATEGORY_FILTER;
        setStoredProjectTaskCategoryFilter(projectId, activeCategory);
    }
    return getCompletedTaskDisplayState(project, { sortMode, activeCategory });
}

function showMoreCompletedTasks(projectId, amount) {
    const displayState = getLiveCompletedTaskDisplayState(projectId);
    if (!displayState || displayState.completedLimit === 'all') return;

    const totalCompleted = Number(displayState.totalCompleted) || 0;
    const visibleCompleted = Number(displayState.visibleCompleted) || COMPLETED_TASK_BATCH_DEFAULT;
    const increment = Number(amount);
    const nextLimit = Math.min(
        totalCompleted,
        visibleCompleted + (Number.isFinite(increment) && increment > 0 ? increment : COMPLETED_TASK_BATCH_DEFAULT)
    );

    setProjectCompletedTaskLimitPreference(projectId, nextLimit >= totalCompleted ? 'all' : nextLimit);
    renderModalTaskList(projectId);
}

function showAllCompletedTasks(projectId) {
    setProjectCompletedTaskLimitPreference(projectId, 'all');
    renderModalTaskList(projectId);
}

function handleCompletedTaskDisplayControlClick(event) {
    const button = event.target.closest('[data-completed-task-action]');
    if (!button || button.disabled || button.getAttribute('aria-disabled') === 'true') return;

    const projectId = button.getAttribute('data-project-id');
    const action = button.getAttribute('data-completed-task-action');
    if (!projectId || !action) return;

    event.preventDefault();
    event.stopPropagation();

    if (action === 'show-more') {
        showMoreCompletedTasks(projectId, Number(button.getAttribute('data-amount')) || COMPLETED_TASK_BATCH_DEFAULT);
    } else if (action === 'show-all') {
        showAllCompletedTasks(projectId);
    }
}

if (typeof document !== 'undefined' && !document.__completedTaskDisplayControlsBound) {
    document.addEventListener('click', handleCompletedTaskDisplayControlClick);
    document.__completedTaskDisplayControlsBound = true;
}

function renderModalTaskList(projectId) {
    const project = state.findProject(projectId);
    if (!project) return;
    const taskList = document.getElementById(`modal-task-list-${projectId}`);
    if (!taskList) return;

    const hideCompleted = getProjectHideCompletedPreference(projectId);
    const sortMode = getProjectTaskSortPreference(projectId);
    let activeCategory = getProjectTaskCategoryFilter(projectId);
    const categories = getProjectTaskCategories(project);
    if (activeCategory !== DEFAULT_TASK_CATEGORY_FILTER && !categories.includes(activeCategory)) {
        activeCategory = DEFAULT_TASK_CATEGORY_FILTER;
        setStoredProjectTaskCategoryFilter(projectId, activeCategory);
    }
    const completedDisplayState = hideCompleted
        ? null
        : getCompletedTaskDisplayState(project, { sortMode, activeCategory });
    const displayTasks = completedDisplayState
        ? completedDisplayState.visibleTasks
        : getDisplayTasksForProject(project, { hideCompleted, sortMode, activeCategory });
    const selectedTasks = state.getSelectedTasks(projectId);

    taskList.dataset.sortMode = sortMode;
    taskList.dataset.activeCategory = activeCategory;
    taskList.innerHTML = displayTasks.map(task => renderModalTaskItem(projectId, task, selectedTasks, sortMode)).join('');
    renderCompletedTaskDisplayControls(projectId, completedDisplayState, hideCompleted);
    renderTaskSelectAllControl(projectId, displayTasks);
    renderTaskBulkActions(projectId);
    renderTaskCategoryControls(projectId);

    setTimeout(() => setupTaskDragAndDrop(projectId), 100);
}


function setProjectTaskSortMode(projectId, sortMode) {
    setProjectTaskSortPreference(projectId, sortMode);
    renderModalTaskList(projectId);
    refreshProjectCalendarIfPresent(projectId);
    render();
}

function setProjectTaskCategoryFilter(projectId, categoryValue) {
    const project = state.findProject(projectId);
    if (!project) return;
    const categories = getProjectTaskCategories(project);
    const nextCategory = categoryValue === DEFAULT_TASK_CATEGORY_FILTER
        ? DEFAULT_TASK_CATEGORY_FILTER
        : (categories.includes(categoryValue) ? categoryValue : DEFAULT_TASK_CATEGORY_FILTER);
    setStoredProjectTaskCategoryFilter(projectId, nextCategory);
    renderModalTaskList(projectId);
}

function toggleTaskPriorityMenu(projectId, taskId, event) {
    event?.stopPropagation?.();
    const isOpen = isTaskPriorityMenuOpen(projectId, taskId);
    uiState.openTaskCategoryMenu = null;
    uiState.openProjectPriorityMenu = null;
    uiState.openTaskPriorityMenu = isOpen ? null : { projectId, taskId };
    renderModalTaskList(projectId);
}

function selectTaskPriority(projectId, taskId, tagValue) {
    updateTaskTag(projectId, taskId, tagValue);
    uiState.openTaskPriorityMenu = null;
    renderModalTaskList(projectId);
}

function toggleTaskCategoryMenu(projectId, category, event) {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    event?.stopImmediatePropagation?.();
    const isOpen = isTaskCategoryMenuOpen(projectId, category);
    uiState.openTaskPriorityMenu = null;
    uiState.openProjectPriorityMenu = null;
    uiState.openTaskCategoryMenu = isOpen ? null : { projectId, category };
    renderTaskCategoryControls(projectId);
}

function renameTaskCategoryPrompt(projectId, currentCategory) {
    if (!state.canEdit(projectId)) return;
    const project = state.findProject(projectId);
    if (!project) return;
    const nextNameRaw = window.prompt('Rename category', currentCategory);
    if (nextNameRaw === null) return;
    const nextCategory = sanitizeTaskCategoryName(nextNameRaw);
    if (!nextCategory) return;
    if (nextCategory === currentCategory) {
        uiState.openTaskCategoryMenu = null;
        renderTaskCategoryControls(projectId);
        return;
    }

    const updatedTasks = (project.tasks || []).map((task, index) => {
        const normalizedTask = normalizeTask(task, index);
        if (normalizedTask.category !== currentCategory) return normalizedTask;
        return { ...normalizedTask, category: nextCategory };
    });
    const nextCategories = getTaskCategoryListWith(getProjectTaskCategories(project).map(category => category === currentCategory ? nextCategory : category));

    state.updateProject(projectId, projectUpdate({ tasks: updatedTasks, taskCategories: nextCategories }));
    if (getProjectTaskCategoryFilter(projectId) === currentCategory) {
        setStoredProjectTaskCategoryFilter(projectId, nextCategory);
    }
    uiState.openTaskCategoryMenu = null;
    saveData();
    uiState.openTaskPriorityMenu = null;
    renderModalTaskList(projectId);
    render();
}

function deleteTaskCategory(projectId, currentCategory) {
    if (!state.canEdit(projectId) || currentCategory === DEFAULT_TASK_CATEGORY) return;
    const project = state.findProject(projectId);
    if (!project) return;

    openConfirmationDialog({
        title: 'Delete Task Category?',
        message: `Delete "${currentCategory}"? Tasks in this category will move back to All.`,
        confirmLabel: 'Delete Category',
        onConfirm: () => {
            const updatedTasks = (project.tasks || []).map((task, index) => {
                const normalizedTask = normalizeTask(task, index);
                if (normalizedTask.category !== currentCategory) return normalizedTask;
                return { ...normalizedTask, category: DEFAULT_TASK_CATEGORY };
            });
            const nextCategories = getProjectTaskCategories(project).filter(category => category !== currentCategory);

            state.updateProject(projectId, projectUpdate({ tasks: updatedTasks, taskCategories: nextCategories }));
            if (getProjectTaskCategoryFilter(projectId) === currentCategory) {
                setStoredProjectTaskCategoryFilter(projectId, DEFAULT_TASK_CATEGORY_FILTER);
            }
            uiState.openTaskCategoryMenu = null;
            saveData();
            renderModalTaskList(projectId);
            render();
        }
    });
}

function updateTaskTag(projectId, taskId, tagValue) {
    if (!state.canEdit(projectId)) return;
    const normalizedTagValue = String(tagValue ?? '').trim().toLowerCase();
    const nextTag = Object.prototype.hasOwnProperty.call(TASK_TAG_PRIORITY, normalizedTagValue) ? normalizedTagValue : DEFAULT_TASK_TAG;
    const project = state.findProject(projectId);
    if (!project) return;

    const updatedTasks = project.tasks.map((task, index) => {
        const normalizedTask = normalizeTask(task, index);
        if (normalizedTask.id !== taskId) return normalizedTask;
        return {
            ...normalizedTask,
            tag: nextTag
        };
    });

    state.updateProject(projectId, projectUpdate({ tasks: updatedTasks }));
    saveData();
    renderModalTaskList(projectId);
    refreshProjectCalendarIfPresent(projectId);
    render();
}

function cycleProjectCardTaskPriority(projectId, taskId, event) {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    if (!state.canEdit(projectId)) return;

    const project = state.findProject(projectId);
    const task = project?.tasks
        ?.map((item, index) => normalizeTask(item, index))
        .find(item => item.id === taskId);
    if (!task) return;

    updateTaskTag(projectId, taskId, getNextTaskPriorityValue(task));
}

function updateProjectDueDate(projectId, dueDateValue) {
    if (!state.canEdit(projectId)) return;
    const project = state.findProject(projectId);
    if (!project) return;

    const dueDate = normalizeTaskDueDate(dueDateValue);
    state.updateProject(projectId, projectUpdate({ dueDate }));
    saveData();

    const modalOpen = document.getElementById('projectModal')?.classList.contains('active');
    const modalState = modalOpen ? captureProjectModalState(projectId) : null;
    if (modalOpen) {
        openProjectModal(projectId, { restoreState: modalState });
    } else {
        render();
    }
}

function updateProjectPriority(projectId, tagValue) {
    if (!state.canEdit(projectId)) return;
    const project = state.findProject(projectId);
    if (!project) return;

    const nextTag = normalizePriorityTagValue(tagValue);
    uiState.openProjectPriorityMenu = null;
    state.updateProject(projectId, projectUpdate({ projectPriorityTag: nextTag }));
    saveData();

    const modalOpen = document.getElementById('projectModal')?.classList.contains('active');
    const modalState = modalOpen ? captureProjectModalState(projectId) : null;
    if (modalOpen) {
        openProjectModal(projectId, { restoreState: modalState });
    } else {
        render();
    }
}

function renderProjectPrioritySurface(projectId) {
    const openProjectId = getOpenProjectModalId();
    if (openProjectId && String(openProjectId) === String(projectId)) {
        const modalState = captureProjectModalState(projectId);
        openProjectModal(projectId, { restoreState: modalState });
        return;
    }
    render();
}

function toggleProjectPriorityMenu(projectId, surface = 'modal', event) {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    if (!state.canEdit(projectId)) return;

    const isOpen = isProjectPriorityMenuOpen(projectId, surface);
    uiState.openTaskPriorityMenu = null;
    uiState.openTaskCategoryMenu = null;
    uiState.openProjectPriorityMenu = isOpen ? null : { projectId, surface };
    renderProjectPrioritySurface(projectId);
}

function selectProjectPriority(projectId, tagValue, surface = 'modal', event) {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    uiState.openProjectPriorityMenu = null;
    updateProjectPriority(projectId, tagValue);
}

function cycleProjectPriority(projectId, event) {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    if (!state.canEdit(projectId)) return;
    const project = state.findProject(projectId);
    if (!project) return;
    updateProjectPriority(projectId, getNextProjectPriorityValue(project));
}

function updateTaskCategory(projectId, taskId, categoryValue) {
    if (!state.canEdit(projectId)) return;
    const project = state.findProject(projectId);
    if (!project) return;
    const nextCategory = sanitizeTaskCategoryName(categoryValue || DEFAULT_TASK_CATEGORY);
    const updatedTasks = project.tasks.map((task, index) => {
        const normalizedTask = normalizeTask(task, index);
        if (normalizedTask.id !== taskId) return normalizedTask;
        return {
            ...normalizedTask,
            category: nextCategory
        };
    });
    const nextCategories = getTaskCategoryListWith([...getProjectTaskCategories(project), nextCategory]);
    state.updateProject(projectId, projectUpdate({ tasks: updatedTasks, taskCategories: nextCategories }));
    saveData();
    renderModalTaskList(projectId);
    render();
}

function reorderTaskCategories(projectId, orderedCategories = []) {
    if (!state.canEdit(projectId)) return;
    const project = state.findProject(projectId);
    if (!project) return;

    const existingCategories = getProjectTaskCategories(project);
    const nextCategories = normalizeOrderedList(
        (Array.isArray(orderedCategories) ? orderedCategories : []).map(sanitizeTaskCategoryName),
        existingCategories
    );

    if (existingCategories.join('|') === nextCategories.join('|')) {
        renderTaskCategoryControls(projectId);
        return;
    }

    state.updateProject(projectId, projectUpdate({ taskCategories: nextCategories }));
    saveData();
    renderTaskCategoryControls(projectId);
    renderModalTaskList(projectId);
    render();
}

function startInlineTaskCategoryCreate(projectId, event) {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    if (!state.canEdit(projectId)) return;
    const project = state.findProject(projectId);
    if (!project) return;

    const nextCategory = getUniqueTaskCategoryName(project, 'New Tab');
    const nextCategories = getTaskCategoryListWith([...getProjectTaskCategories(project), nextCategory]);

    uiState.openTaskPriorityMenu = null;
    uiState.openTaskCategoryMenu = null;
    uiState.creatingTaskCategoryProjectId = null;
    uiState.editingTaskCategory = { projectId, category: nextCategory, isNew: true };

    state.updateProject(projectId, projectUpdate({ taskCategories: nextCategories }));
    setStoredProjectTaskCategoryFilter(projectId, nextCategory);
    saveData();
    renderModalTaskList(projectId);
    render();
}

function cancelInlineTaskCategoryCreate(projectId) {
    const wasCreating = uiState.creatingTaskCategoryProjectId === projectId;
    const wasEditingNew = uiState.editingTaskCategory?.projectId === projectId && uiState.editingTaskCategory.isNew;
    if (!wasCreating && !wasEditingNew) return;
    uiState.creatingTaskCategoryProjectId = null;
    uiState.editingTaskCategory = null;
    renderTaskCategoryControls(projectId);
}

function commitInlineTaskCategoryCreate(projectId, rawValue) {
    if (uiState.creatingTaskCategoryProjectId !== projectId) return;
    if (!state.canEdit(projectId)) return;
    const project = state.findProject(projectId);
    if (!project) return;

    const rawText = String(rawValue ?? '').trim();
    if (!rawText) {
        cancelInlineTaskCategoryCreate(projectId);
        return;
    }

    const nextCategory = sanitizeTaskCategoryName(rawText);
    if (isDefaultTaskCategoryName(nextCategory)) {
        cancelInlineTaskCategoryCreate(projectId);
        return;
    }
    const nextCategories = getTaskCategoryListWith([...getProjectTaskCategories(project), nextCategory]);
    uiState.creatingTaskCategoryProjectId = null;
    state.updateProject(projectId, projectUpdate({ taskCategories: nextCategories }));
    saveData();
    setProjectTaskCategoryFilter(projectId, nextCategory);
    render();
}

function handleInlineTaskCategoryCreateKeydown(projectId, event) {
    if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        commitInlineTaskCategoryCreate(projectId, event.currentTarget.value);
    } else if (event.key === 'Escape') {
        event.preventDefault();
        cancelInlineTaskCategoryCreate(projectId);
    }
}

function commitInlineTaskCategoryEdit(projectId, currentCategory, rawValue) {
    if (uiState.editingTaskCategory?.projectId !== projectId || uiState.editingTaskCategory.category !== currentCategory) return;
    if (!state.canEdit(projectId)) return;
    const project = state.findProject(projectId);
    if (!project) return;

    const nextCategory = sanitizeTaskCategoryName(rawValue);
    uiState.editingTaskCategory = null;

    if (!nextCategory || nextCategory === currentCategory || isDefaultTaskCategoryName(nextCategory)) {
        renderModalTaskList(projectId);
        return;
    }

    const existingCategories = getProjectTaskCategories(project);
    const existingCategory = existingCategories.find(category => category !== currentCategory && category.toLowerCase() === nextCategory.toLowerCase());
    const finalCategory = existingCategory || nextCategory;

    const updatedTasks = (project.tasks || []).map((task, index) => {
        const normalizedTask = normalizeTask(task, index);
        if (normalizedTask.category !== currentCategory) return normalizedTask;
        return { ...normalizedTask, category: finalCategory };
    });
    const nextCategories = getTaskCategoryListWith(existingCategories.map(category => category === currentCategory ? finalCategory : category));

    state.updateProject(projectId, projectUpdate({ tasks: updatedTasks, taskCategories: nextCategories }));
    if (getProjectTaskCategoryFilter(projectId) === currentCategory) {
        setStoredProjectTaskCategoryFilter(projectId, finalCategory);
    }
    saveData();
    renderModalTaskList(projectId);
    render();
}

function cancelInlineTaskCategoryEdit(projectId) {
    if (uiState.editingTaskCategory?.projectId !== projectId) return;
    uiState.editingTaskCategory = null;
    renderModalTaskList(projectId);
}

function handleInlineTaskCategoryEditKeydown(projectId, currentCategory, event) {
    if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        commitInlineTaskCategoryEdit(projectId, currentCategory, event.currentTarget.value);
    } else if (event.key === 'Escape') {
        event.preventDefault();
        cancelInlineTaskCategoryEdit(projectId);
    }
}

function createTaskCategory(projectId, rawValue = '') {
    if (rawValue) {
        uiState.creatingTaskCategoryProjectId = projectId;
        commitInlineTaskCategoryCreate(projectId, rawValue);
        return;
    }
    startInlineTaskCategoryCreate(projectId);
}

function handleTaskCategoryCreateKeydown(event, projectId) {
    if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        startInlineTaskCategoryCreate(projectId, event);
    }
}

function getProjectMetadataRows(project) {
    const tasks = Array.isArray(project?.tasks) ? project.tasks : [];
    const collaborators = Array.isArray(project?.collaborators) ? project.collaborators : [];
    const completedTasks = tasks.filter(task => normalizeTask(task).completed).length;
    const remainingTasks = Math.max(0, tasks.length - completedTasks);
    const overdueTasks = tasks.filter(task => isTaskOverdue(normalizeTask(task))).length;
    const projectTags = getProjectTags(project);
    const status = isProjectArchived(project)
        ? 'Archived'
        : (isProjectCompleted(project) ? 'Completed' : 'Active');
    const progress = tasks.length > 0 ? `${Math.round((completedTasks / tasks.length) * 100)}%` : '0%';
    const ownerLabel = project?.ownerName || (project?.userRole === 'owner' ? 'Me' : 'Unknown');
    const collaboratorLabel = collaborators.length
        ? collaborators.map(member => member.username || member.email || 'Collaborator').join(', ')
        : 'None';

    return [
        ['Project', project?.title || 'Untitled Project'],
        ['Status', status],
        ['Role', project?.userRole ? toTitleCase(project.userRole) : 'Owner'],
        ['Owner', ownerLabel],
        ['Created', project?.dateCreated ? formatCompactDateTime(project.dateCreated) : 'Unknown'],
        ['Updated', project?.lastModified ? formatCompactDateTime(project.lastModified) : (project?.dateCreated ? formatCompactDateTime(project.dateCreated) : 'Unknown')],
        ['Project due date', getProjectDueDate(project) ? formatProjectDueDate(getProjectDueDate(project)) : 'None'],
        ['Priority', getProjectPriorityLabel(project)],
        ['Progress', progress],
        ['Total tasks', String(tasks.length)],
        ['Completed tasks', String(completedTasks)],
        ['Remaining tasks', String(remainingTasks)],
        ['Overdue tasks', String(overdueTasks)],
        ['Collaborators', collaboratorLabel],
        ['Tags', projectTags.length ? projectTags.join(', ') : 'None'],
        ['Project ID', project?.id || 'Unknown']
    ];
}

function buildProjectMetadataDetailsCard(project) {
    const rows = getProjectMetadataRows(project);
    return `
        <div class="project-metadata-card">
            ${rows.map(([label, value]) => `
                <div class="project-metadata-row">
                    <span class="project-metadata-label">${escapeHtml(label)}</span>
                    <span class="project-metadata-value">${escapeHtml(value)}</span>
                </div>
            `).join('')}
        </div>
    `;
}

function ensureProjectMetadataDetailsModal() {
    let modal = document.getElementById('projectMetadataDetailsModal');
    if (modal) return modal;

    document.body.insertAdjacentHTML('beforeend', `
        <div class="modal-overlay project-metadata-details-overlay" id="projectMetadataDetailsModal" aria-hidden="true">
            <div class="modal-content project-metadata-details-content" role="dialog" aria-modal="true" aria-labelledby="projectMetadataDetailsTitle">
                <div class="project-metadata-details-header">
                    <div>
                        <h3 class="project-metadata-details-title" id="projectMetadataDetailsTitle">Project Details</h3>
                        <p class="project-metadata-details-subtitle" id="projectMetadataDetailsSubtitle">Project metadata</p>
                    </div>
                    <button class="modal-close" type="button" onclick="closeProjectMetadataDetails()" aria-label="Close project details">
                        <svg class="icon-lg" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
                        </svg>
                    </button>
                </div>
                <div class="project-metadata-details-body" id="projectMetadataDetailsBody"></div>
            </div>
        </div>
    `);

    modal = document.getElementById('projectMetadataDetailsModal');
    modal.addEventListener('click', event => {
        if (event.target === modal) closeProjectMetadataDetails();
    });
    return modal;
}

function openProjectMetadataDetails(projectId, event) {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    closeProjectMeatballsMenus();
    const project = state.findProject(projectId);
    if (!project) return;

    const modal = ensureProjectMetadataDetailsModal();
    const title = document.getElementById('projectMetadataDetailsTitle');
    const subtitle = document.getElementById('projectMetadataDetailsSubtitle');
    const body = document.getElementById('projectMetadataDetailsBody');
    if (title) title.textContent = 'Project Details';
    if (subtitle) subtitle.textContent = project.title || 'Project metadata';
    if (body) body.innerHTML = buildProjectMetadataDetailsCard(project);
    modal.classList.add('active');
    modal.setAttribute('aria-hidden', 'false');
}

function closeProjectMetadataDetails() {
    const modal = document.getElementById('projectMetadataDetailsModal');
    if (!modal) return;
    modal.classList.remove('active');
    modal.setAttribute('aria-hidden', 'true');
}

function closeProjectMeatballsMenus() {
    document.querySelectorAll('.project-meatballs[open]').forEach(menu => {
        menu.removeAttribute('open');
    });
}

function buildProjectMeatballsMenuMarkup(project, surface = 'card') {
    const projectIdLiteral = serializeInlineJsString(project?.id || '');
    const canEditProject = state.canEdit(project?.id);
    const canDeleteProject = project?.userRole === 'owner' || state.isOwner(project?.id);
    const editAction = surface === 'modal'
        ? `editModalTitle(${projectIdLiteral})`
        : `editProjectTitleOnCard(${projectIdLiteral})`;
    const deleteAction = surface === 'modal'
        ? `confirmDeleteProject(${projectIdLiteral})`
        : `confirmDeleteProjectCard(${projectIdLiteral})`;

    return `
        <details class="project-meatballs project-meatballs--${escapeHtml(surface)}" onclick="event.stopPropagation();">
            <summary class="project-meatballs-toggle" role="button" aria-label="Project actions" title="Project actions" onclick="event.stopPropagation();">
                <span class="project-meatballs-icon" aria-hidden="true"><span></span><span></span><span></span></span>
            </summary>
            <div class="project-meatballs-dropdown" role="menu" onclick="event.stopPropagation();">
                ${canEditProject ? `<button class="project-meatballs-item" type="button" role="menuitem" onclick="event.preventDefault(); event.stopPropagation(); closeProjectMeatballsMenus(); ${editAction}">Edit</button>` : ''}
                <button class="project-meatballs-item" type="button" role="menuitem" onclick="openProjectMetadataDetails(${projectIdLiteral}, event)">Details</button>
                ${canDeleteProject ? `<button class="project-meatballs-item project-meatballs-item--danger" type="button" role="menuitem" onclick="event.preventDefault(); event.stopPropagation(); closeProjectMeatballsMenus(); ${deleteAction}">Delete Project</button>` : ''}
            </div>
        </details>
    `;
}

function buildProjectCalendarSectionMarkup(project) {
    const projectIdLiteral = serializeInlineJsString(project?.id || '');
    const currentMonthKey = getProjectCalendarMonthKey(project?.id);
    const selectedDate = getProjectCalendarSelectedDate(project?.id);

    return `
        <div class="project-calendar-panel">
            <div class="project-calendar-main-row">
                <div class="project-calendar-shell">
                    <div class="project-calendar-toolbar">
                        <button class="project-calendar-nav-button" type="button" onclick="changeProjectCalendarMonth(${projectIdLiteral}, -1, event)" aria-label="Previous month">‹</button>
                        <div class="project-calendar-current-month">${escapeHtml(getCalendarMonthLabel(currentMonthKey))}</div>
                        <button class="project-calendar-nav-button" type="button" onclick="changeProjectCalendarMonth(${projectIdLiteral}, 1, event)" aria-label="Next month">›</button>
                        <button class="project-calendar-today-button" type="button" onclick="goToProjectCalendarToday(${projectIdLiteral}, event)">Today</button>
                    </div>
                    ${buildProjectCalendarGridMarkup(project, currentMonthKey, selectedDate)}
                </div>
                <div class="project-calendar-side-panel">
                    ${buildProjectCalendarSelectedDayMarkup(project, selectedDate)}
                </div>
            </div>
            ${buildProjectCalendarTaskDockMarkup(project)}
        </div>
    `;
}

function renderProjectCalendarSection(projectId, options = {}) {
    const project = state.findProject(projectId);
    if (!project) return;
    const section = document.getElementById(`calendar-section-${project.id}`);
    if (!section) return;
    const preserveScroll = options.preserveScroll !== false;
    const scrollEl = document.querySelector('#modalContent .modal-scroll-inner');
    const previousScrollTop = preserveScroll ? scrollEl?.scrollTop : null;
    const previousPageScrollX = preserveScroll ? window.scrollX : null;
    const previousPageScrollY = preserveScroll ? window.scrollY : null;

    section.innerHTML = buildProjectCalendarSectionMarkup(project);
    setupProjectCalendarTaskDockDrag(projectId);

    if (preserveScroll) {
        requestAnimationFrame(() => {
            if (scrollEl && typeof previousScrollTop === 'number') {
                scrollEl.scrollTop = previousScrollTop;
            }
            if (typeof previousPageScrollX === 'number' && typeof previousPageScrollY === 'number') {
                window.scrollTo(previousPageScrollX, previousPageScrollY);
            }
        });
    }
}

function refreshProjectCalendarIfPresent(projectId) {
    const calendarSection = document.getElementById(`calendar-section-${projectId}`);
    if (!calendarSection) return;
    renderProjectCalendarSection(projectId, { preserveScroll: true });
}

function selectProjectCalendarDay(projectId, dateKey, event) {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    if (!state.findProject(projectId)) return;
    setProjectCalendarSelectedDate(projectId, normalizeTaskDueDate(dateKey) || getTodayDateKey());
    renderProjectCalendarSection(projectId);
    saveOpenProjectModalState(projectId, 'calendar');
}

function changeProjectCalendarMonth(projectId, direction = 0, event) {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    if (!state.findProject(projectId)) return;
    const currentMonthKey = getProjectCalendarMonthKey(projectId);
    const [year, month] = currentMonthKey.split('-').map(Number);
    const currentSelection = parseDateKey(getProjectCalendarSelectedDate(projectId));
    const nextMonth = new Date(year, month - 1 + Number(direction || 0), 1, 12);
    const selectedDay = currentSelection ? currentSelection.getDate() : 1;
    const lastDayInNextMonth = new Date(nextMonth.getFullYear(), nextMonth.getMonth() + 1, 0).getDate();
    const nextSelectedDate = new Date(nextMonth.getFullYear(), nextMonth.getMonth(), Math.min(selectedDay, lastDayInNextMonth), 12);
    setProjectCalendarSelectedDate(projectId, formatDateKey(nextSelectedDate));
    renderProjectCalendarSection(projectId);
    saveOpenProjectModalState(projectId, 'calendar');
}

function goToProjectCalendarToday(projectId, event) {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    if (!state.findProject(projectId)) return;
    setProjectCalendarSelectedDate(projectId, getTodayDateKey());
    renderProjectCalendarSection(projectId);
    saveOpenProjectModalState(projectId, 'calendar');
}

function saveProjectCalendarNote(projectId, dateKey, event) {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    if (!state.canEdit(projectId)) return;
    const project = state.findProject(projectId);
    if (!project) return;
    const safeDateKey = normalizeTaskDueDate(dateKey) || getProjectCalendarSelectedDate(projectId);
    if (!isValidDateKey(safeDateKey)) return;

    const noteInput = document.getElementById(`project-calendar-note-${project.id}`);
    const noteText = String(noteInput?.value || '').trim().slice(0, PROJECT_CALENDAR_NOTE_MAX_LENGTH);
    const nextNotes = { ...getProjectCalendarNotes(project) };
    if (noteText) nextNotes[safeDateKey] = noteText;
    else delete nextNotes[safeDateKey];

    state.updateProject(projectId, projectUpdate({ calendarNotes: nextNotes }));
    saveData();
    renderProjectCalendarSection(projectId);
    saveOpenProjectModalState(projectId, 'calendar');
}

function deleteProjectCalendarNote(projectId, dateKey, event) {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    if (!state.canEdit(projectId)) return;
    const project = state.findProject(projectId);
    if (!project) return;
    const safeDateKey = normalizeTaskDueDate(dateKey) || getProjectCalendarSelectedDate(projectId);
    if (!isValidDateKey(safeDateKey)) return;

    const nextNotes = { ...getProjectCalendarNotes(project) };
    delete nextNotes[safeDateKey];
    state.updateProject(projectId, projectUpdate({ calendarNotes: nextNotes }));
    saveData();
    renderProjectCalendarSection(projectId);
    saveOpenProjectModalState(projectId, 'calendar');
}

function buildProjectModalMenuTabs(project, collaborators = []) {
    const projectId = project?.id || '';
    const projectIdLiteral = serializeInlineJsString(projectId);
    const tabDefinitions = {
        tasks: {
            className: '',
            title: '',
            html: 'Tasks'
        },
        notes: {
            className: `modal-tab--notes ${projectHasNotes(project?.notes) ? 'has-note' : ''}`.trim(),
            title: formatProjectNotesPreview(project?.notes) || 'Project notes',
            html: 'Notes'
        },
        members: {
            className: '',
            title: '',
            html: `Members ${collaborators.length > 0 ? `<span class="members-count">${collaborators.length}</span>` : ''}`
        },
        history: {
            className: '',
            title: '',
            html: 'History'
        },
        calendar: {
            className: '',
            title: '',
            html: 'Calendar'
        }
    };

    return getProjectModalTabOrder().map(tabId => {
        const tab = tabDefinitions[tabId];
        if (!tab) return '';
        const titleAttr = tab.title ? ` title="${escapeHtml(tab.title)}"` : '';
        return `<button class="modal-tab modal-menu-item ${tabId === 'tasks' ? 'active' : ''} ${tab.className}"
                       role="menuitem"
                       id="${tabId}-tab-${escapeHtml(String(projectId))}"
                       data-movable-tab-id="${escapeHtml(tabId)}"
                       type="button"
                       onclick="switchModalTab(${projectIdLiteral}, '${tabId}')"${titleAttr}>${tab.html}</button>`;
    }).join('');
}

function openProjectModal(projectId, options = {}) {
    const project = state.findProject(projectId);
    if (!project) return;

    const tasks = Array.isArray(project.tasks) ? project.tasks : [];
    const collaborators = Array.isArray(project.collaborators) ? project.collaborators : [];
    if (!options.restoreState) {
        resetProjectCompletedTaskLimitPreference(project.id);
    }
    const hideCompleted = getProjectHideCompletedPreference(project.id);
    const taskSortMode = getProjectTaskSortPreference(project.id);
    const activeCategory = getProjectTaskCategoryFilter(project.id);
    state.setHideCompletedTasks(hideCompleted);
    const completedDisplayState = hideCompleted
        ? null
        : getCompletedTaskDisplayState(project, { sortMode: taskSortMode, activeCategory });
    const displayTasks = completedDisplayState
        ? completedDisplayState.visibleTasks
        : getDisplayTasksForProject(project, { hideCompleted, sortMode: taskSortMode, activeCategory });

    const completedTasks = tasks.filter(t => isTaskCompleted(t)).length;
    const totalTasks = tasks.length;
    const remainingTasks = tasks.filter(t => !isTaskCompleted(t)).length;
    const percentage = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;
    
    const modal = document.getElementById('projectModal');
    const content = document.getElementById('modalContent');
    modal?.classList.remove('is-calendar-tab-active');
    
    const selectedTasks = state.getSelectedTasks(projectId);
    const modalMenuBarMarkup = `
        <div class="modal-menu-bar" role="menubar" aria-label="Project modal menu">
            ${buildProjectModalMenuTabs(project, collaborators)}
            ${buildProjectMeatballsMenuMarkup(project, 'modal')}
            <button class="modal-close modal-menu-close" onclick="closeProjectModal()" type="button" aria-label="Close project modal">
                <svg class="icon-lg" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
                </svg>
            </button>
        </div>`;
    
    content.innerHTML = `<div class="modal-top-menu-shell">
        ${modalMenuBarMarkup}
    </div>
    <div class="modal-scroll-inner">
        <div class="modal-header-centered">
            <div class="modal-title-container">
                <div class="modal-title-row">
                    <button class="modal-title modal-title-edit-button" id="modal-title-${project.id}" onclick="editModalTitle('${project.id}')" type="button" title="Edit project name and description">${escapeHtml(project.title)}</button>
                    <input type="text" 
                           class="modal-title-input" 
                           id="modal-title-input-${project.id}"
                           value="${escapeHtml(project.title)}"
                           style="display: none;"
                           onblur="finishEditModalTitle('${project.id}')"
                           oninput="handleProjectTitleInput(this)"
                           onanimationend="this.classList.remove('project-title-shake')"
                           onkeydown="if(event.key==='Enter'){ event.preventDefault(); finishEditModalTitle('${project.id}'); } if(event.key==='Escape'){ event.preventDefault(); this.blur(); }" >
                    ${renderProjectDueDateControlMarkup(project, 'modal')}
                </div>
                <div class="modal-project-description-view ${getProjectModalDescription(project) ? '' : 'is-empty'}"
                     id="modal-project-description-view-${project.id}">
                    <span class="modal-project-description-text"
                          id="modal-project-description-${project.id}"
                          data-placeholder="Add project description"
                          role="textbox"
                          ${state.canEdit(project.id) ? `tabindex="0" onclick="editProjectDescription('${project.id}', event)" onfocus="editProjectDescription('${project.id}', event)" onblur="finishEditProjectDescription('${project.id}')" onkeydown="if(event.key === 'Enter'){ event.preventDefault(); finishEditProjectDescription('${project.id}'); return false; } if(event.key === 'Escape'){ event.preventDefault(); cancelEditProjectDescription('${project.id}'); }"` : ''}>${getProjectModalDescription(project) ? escapeHtml(getProjectModalDescription(project)) : 'Add project description'}</span>
                    ${state.canEdit(project.id) ? `<button class="modal-project-description-edit" type="button" onclick="editProjectDescription('${project.id}', event)">Edit</button>` : ''}
                </div>
                ${buildProjectTagControlsMarkup(project.id, project)}
                <div class="modal-project-priority-row">
                    ${renderProjectPriorityControlMarkup(project.id, project, 'modal')}
                </div>
            </div>
        </div>

        <div class="modal-progress">
            <div class="progress-bar-container">
                <div class="progress-bar" data-progress-bar="${project.id}" style="width: ${percentage}%"></div>
            </div>
            <div class="progress-text-large" data-progress-text="${project.id}">${percentage}%</div>
        </div>

        
        <!-- Tasks Section -->
        <div class="modal-section" id="tasks-section-${project.id}">
            <div class="modal-tasks-card">
                <div class="task-category-controls" id="task-category-controls-${project.id}">
                    ${buildTaskCategoryControlsMarkup(project.id, project, activeCategory)}
                </div>

                <div class="modal-tasks-card-body">
                    <div class="modal-task-controls-row">
                        <div class="hide-completed-toggle">
                            <div class="toggle-label">Hide completed tasks</div>
                            <label class="toggle-switch">
                                <input type="checkbox" id="hide-completed-checkbox" ${hideCompleted ? 'checked' : ''} 
                                       onchange="toggleHideCompleted()">
                                <span class="toggle-slider"></span>
                            </label>
                        </div>
                        <div class="task-sort-control">
                            <select class="task-sort-select" id="task-sort-select-${project.id}" aria-label="Sort tasks" onchange="setProjectTaskSortMode('${project.id}', this.value)">
                                <option value="default" ${taskSortMode === 'default' ? 'selected' : ''}>MANUAL</option>
                                <option value="ascending" ${taskSortMode === 'ascending' ? 'selected' : ''}>A-Z ↑</option>
                                <option value="descending" ${taskSortMode === 'descending' ? 'selected' : ''}>A-Z ↓</option>
                                <option value="due-date" ${taskSortMode === 'due-date' ? 'selected' : ''}>DUE DATE</option>
                                <option value="tag-priority" ${taskSortMode === 'tag-priority' ? 'selected' : ''}>TAG PRIORITY</option>
                            </select>
                        </div>
                    </div>
                    
                    <div class="modal-tasks">
                        <div class="task-bulk-actions-shell" id="task-bulk-actions-${project.id}">
                            ${buildTaskBulkActionsMarkup(project.id, project, selectedTasks)}
                        </div>
                        <div class="completed-task-display-controls-shell" id="completed-task-display-controls-shell-${project.id}">
                            ${buildCompletedTaskDisplayControlsMarkup(project.id, completedDisplayState, hideCompleted)}
                        </div>
                        <div class="task-list" id="modal-task-list-${project.id}" data-sort-mode="${escapeHtml(taskSortMode)}">
                            ${displayTasks.map(task => renderModalTaskItem(project.id, task, selectedTasks, taskSortMode)).join('')}
                        </div>
                        
                        <!-- Paste Tasks Section in Modal -->
                        <div class="modal-paste-section">
                            <h4 class="modal-paste-title">Add Tasks</h4>
                            ${buildRichTextToolbarMarkup(`modal-paste-box-${project.id}`)}
                            <div class="paste-box modal-task-entry-editor rich-text-editor"
                                 id="modal-paste-box-${project.id}"
                                 role="textbox"
                                 aria-multiline="true"
                                 data-placeholder="Enter tasks here"
                                 contenteditable="true"
                                 oninput="handleModalPasteInput('${project.id}', event)"
                                 onkeydown="handleModalPasteKeydown('${project.id}', event)"></div>
                            <div class="modal-paste-actions">
                                <button 
                                    class="paste-button"
                                    onclick="pasteTasksInModal('${project.id}')">
                                    Add Tasks
                                </button>
                                <button
                                    class="paste-button modal-copy-all-tasks-button"
                                    type="button"
                                    onclick="copyProjectToClipboard('${project.id}', event)">
                                    Copy All Tasks
                                </button>
                                <button
                                    class="paste-button paste-undo-button"
                                    type="button"
                                    data-undo-button
                                    onclick="performUndo()">
                                    Undo
                                </button>
                            </div>
                        </div>
                        <div class="task-select-all-control task-select-all-control--below-add" id="task-select-all-control-${project.id}">
                            ${buildTaskSelectAllControlMarkup(project.id, displayTasks, selectedTasks)}
                        </div>
                    </div>
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
                ${project.archived ? `<button class="modal-delete-btn" onclick="restoreArchivedProject('${project.id}', event)">Restore Project</button>` : `<button class="modal-delete-btn" onclick="archiveProject('${project.id}', event)">Archive Project</button>`}
                ${project.userRole === 'owner' ? `<button class="modal-delete-btn" onclick="confirmDeleteProject('${project.id}')">Delete Project</button>` : ''}
                <button class="modal-done-btn" onclick="completeProjectFromModal('${project.id}')">
                    ${isProjectCompleted(project) ? 'Mark as Active' : 'Mark as Complete'}
                </button>
            </div>`}
        </div>

        <!-- Notes Section -->
        <div class="modal-section hidden" id="notes-section-${project.id}">
            ${buildProjectNotesEditorMarkup(project.id, project, 'modal')}
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


        <div class="modal-section hidden" id="calendar-section-${project.id}">
            ${buildProjectCalendarSectionMarkup(project)}
        </div>

        <div class="modal-section hidden" id="history-section-${project.id}">
            ${buildProjectHistoryMarkup(project)}
        </div>
    </div>`;
    
    setupProjectModalTabReorder(project.id);
    setupTaskCategoryTabReorder(project.id);
    setupProjectNotesTabReorder(project.id, 'modal');

    modal.classList.add('active');
    updateUndoButton();

    if (options.restoreState) {
        restoreProjectModalState(project.id, options.restoreState);
    } else if (options.activeTab) {
        switchModalTab(project.id, options.activeTab);
    }
    saveOpenProjectModalState(project.id);
    
    // Setup task dragging for manual reordering and category-tab drops.
    setTimeout(() => {
        setupTaskDragAndDrop(project.id);
        setupProjectCalendarTaskDockDrag(project.id);
    }, 100);
}


function switchModalTab(projectId, tab) {
    const normalizedTab = tab === 'calendar' ? 'calendar' : tab;
    ['tasks', 'notes', 'members', 'history', 'calendar'].forEach(s => {
        const sec = document.getElementById(`${s}-section-${projectId}`);
        const btn = document.getElementById(`${s}-tab-${projectId}`);
        if (!sec || !btn) return;
        if (s === normalizedTab) { sec.classList.remove('hidden'); btn.classList.add('active'); }
        else                    { sec.classList.add('hidden');    btn.classList.remove('active'); }
    });

    const projectModal = document.getElementById('projectModal');
    projectModal?.classList.toggle('is-calendar-tab-active', normalizedTab === 'calendar');

    if (projectModal?.classList.contains('active')) {
        saveOpenProjectModalState(projectId, normalizedTab);
    }
}

function saveProjectNotes(projectId) {
    saveActiveProjectNoteFromSurface(projectId, 'modal');
}

function toggleHideCompleted() {
    const checkbox = document.getElementById('hide-completed-checkbox');
    if (!checkbox) return;
    state.setHideCompletedTasks(checkbox.checked);

    const modalContent = document.getElementById('modalContent');
    const progressBar = modalContent?.querySelector('[data-progress-bar]');
    const projectId = progressBar?.getAttribute('data-progress-bar');
    if (!projectId) return;

    setProjectHideCompletedPreference(projectId, checkbox.checked);
    if (!checkbox.checked) {
        resetProjectCompletedTaskLimitPreference(projectId);
    }
    renderModalTaskList(projectId);
}

function closeProjectModal() {
    const modal = document.getElementById('projectModal');
    modal.classList.remove('active');
    clearOpenProjectModalState();
    state.clearAllTaskSelections();
    render();
}

function editModalTitle(projectId) {
    if (!state.canEdit(projectId)) return;
    const titleButton = document.getElementById(`modal-title-${projectId}`);
    const titleInput = document.getElementById(`modal-title-input-${projectId}`);
    if (!titleButton || !titleInput) return;
    titleButton.style.display = 'none';
    titleInput.style.display = 'block';
    titleInput.value = titleButton.textContent.trim() || 'New Project';
    requestAnimationFrame(() => {
        titleInput.focus({ preventScroll: true });
        titleInput.select();
    });
}

function finishEditModalTitle(projectId) {
    const titleButton = document.getElementById(`modal-title-${projectId}`);
    const titleInput = document.getElementById(`modal-title-input-${projectId}`);
    if (!titleButton || !titleInput) return;

    const nextTitle = normalizeProjectTitleInput(titleInput.value) || 'New Project';
    titleInput.value = nextTitle;
    if (!validateProjectTitleInput(titleInput)) return;
    clearProjectTitleWarning(titleInput);
    titleButton.textContent = nextTitle;
    titleInput.style.display = 'none';
    titleButton.style.display = '';
    updateProjectTitle(projectId, nextTitle);
}

function setProjectDescriptionViewState(projectId, description) {
    const descriptionView = document.getElementById(`modal-project-description-view-${projectId}`);
    const descriptionText = document.getElementById(`modal-project-description-${projectId}`);
    const cleanDescription = normalizeProjectDescription(description);

    if (descriptionText) {
        descriptionText.textContent = cleanDescription || 'Add project description';
        descriptionText.classList.toggle('is-empty', !cleanDescription);
    }
    descriptionView?.classList.toggle('is-empty', !cleanDescription);
}

function selectEditableText(element) {
    if (!element) return;
    const range = document.createRange();
    range.selectNodeContents(element);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
}

function editProjectDescription(projectId, event) {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    if (!state.canEdit(projectId)) return;

    const project = state.findProject(projectId);
    const descriptionView = document.getElementById(`modal-project-description-view-${projectId}`);
    const descriptionText = document.getElementById(`modal-project-description-${projectId}`);
    if (!descriptionView || !descriptionText) return;
    if (descriptionText.isContentEditable) return;

    const currentDescription = getProjectModalDescription(project);
    descriptionText.textContent = currentDescription;
    descriptionText.setAttribute('contenteditable', 'true');
    descriptionText.classList.add('is-editing');
    descriptionView.classList.add('is-editing');
    descriptionView.querySelector('.modal-project-description-edit')?.classList.add('hidden');

    requestAnimationFrame(() => {
        descriptionText.focus({ preventScroll: true });
        selectEditableText(descriptionText);
    });
}

function cancelEditProjectDescription(projectId) {
    const project = state.findProject(projectId);
    const descriptionView = document.getElementById(`modal-project-description-view-${projectId}`);
    const descriptionText = document.getElementById(`modal-project-description-${projectId}`);
    if (!descriptionView || !descriptionText) return;

    descriptionText.removeAttribute('contenteditable');
    descriptionText.classList.remove('is-editing');
    descriptionView.classList.remove('is-editing');
    descriptionView.querySelector('.modal-project-description-edit')?.classList.remove('hidden');
    setProjectDescriptionViewState(projectId, getProjectModalDescription(project));
}

function finishEditProjectDescription(projectId) {
    const descriptionText = document.getElementById(`modal-project-description-${projectId}`);
    const descriptionView = document.getElementById(`modal-project-description-view-${projectId}`);
    if (!descriptionText || !descriptionText.isContentEditable) return;

    const description = normalizeProjectDescription(descriptionText.textContent);
    descriptionText.removeAttribute('contenteditable');
    descriptionText.classList.remove('is-editing');
    if (descriptionView) {
        descriptionView.classList.remove('is-editing');
        descriptionView.querySelector('.modal-project-description-edit')?.classList.remove('hidden');
    }
    setProjectDescriptionViewState(projectId, description);
    updateProjectDescription(projectId, description);
}
function autoResizeModalTaskInput(input) {
    if (!input) return;
    input.style.height = 'auto';
    input.style.height = `${Math.max(input.scrollHeight, 44)}px`;
}

function handleModalTaskEditKeydown(projectId, taskId, event) {
    if (handleRichTextShortcutKeydown(event, `modal-task-input-${taskId}`)) return;
    if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        finishEditModalTask(projectId, taskId);
    }
    if (event.key === 'Escape') {
        event.preventDefault();
        event.currentTarget?.blur?.();
    }
}

function editModalTask(taskId) {
    const taskText = document.getElementById(`modal-task-text-${taskId}`);
    const taskInput = document.getElementById(`modal-task-input-${taskId}`);
    const taskItem = taskInput?.closest?.('[data-task-item]');
    if (taskText && taskInput) {
        taskItem?.classList.add('is-editing');
        taskText.style.display = 'none';
        taskInput.style.display = 'block';
        autoResizeModalTaskInput(taskInput);
        taskInput.focus({ preventScroll: true });
        if (taskInput.getAttribute('contenteditable') === 'true') {
            selectRichTextEditorContents(taskInput);
        } else {
            taskInput.select?.();
        }
    }
}

function finishEditModalTask(projectId, taskId) {
    const taskText = document.getElementById(`modal-task-text-${taskId}`);
    const taskInput = document.getElementById(`modal-task-input-${taskId}`);
    const taskItem = taskInput?.closest?.('[data-task-item]');
    if (taskText && taskInput) {
        const nextValue = taskInput.getAttribute('contenteditable') === 'true'
            ? getRichTextEditorValue(taskInput)
            : sanitizeRichTextHtml(taskInput.value || '');
        const trimmed = getTaskPlainText(nextValue).trim();
        const wasNewTaskDraft = String(uiState.newTaskDraft?.projectId || '') === String(projectId)
            && Number(uiState.newTaskDraft?.taskId) === Number(taskId);
        taskItem?.classList.remove('is-editing');
        if (trimmed.length === 0) {
            // Empty text — remove the task entirely, don't persist it
            if (wasNewTaskDraft) uiState.newTaskDraft = null;
            deleteTask(projectId, taskId);
            openProjectModal(projectId);
            return;
        }
        if (wasNewTaskDraft) uiState.newTaskDraft = null;
        updateTaskText(projectId, taskId, nextValue);
        taskText.innerHTML = getTaskDisplayHtml(nextValue, 'New task');
        taskText.style.display = 'block';
        taskInput.style.display = 'none';
        taskInput.style.height = '';
        if (wasNewTaskDraft) {
            requestAnimationFrame(() => renderModalTaskList(projectId));
        }
    }
}

function addTaskToModal(projectId) {
    const newTaskId = addTaskToProject(projectId);
    if (!newTaskId) return;

    uiState.newTaskDraft = { projectId: String(projectId), taskId: Number(newTaskId) };

    const modal = document.getElementById('projectModal');
    const modalIsOpen = modal?.classList.contains('active');

    if (modalIsOpen) {
        renderModalTaskList(projectId);
        updateProjectProgress(projectId);
        updateTotalCompletion();
        render();
    } else {
        render();
        openProjectModal(projectId);
    }

    requestAnimationFrame(() => {
        const taskItem = document.querySelector(`#modal-task-list-${projectId} [data-task-id="${newTaskId}"]`);
        taskItem?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        editModalTask(newTaskId);
    });
}


function deleteTaskFromModal(projectId, taskId) {
    const project = state.findProject(projectId);
    const task = project?.tasks?.map((item, index) => normalizeTask(item, index)).find(item => item.id === taskId);
    openConfirmationDialog({
        title: 'Delete Task?',
        message: `Delete "${task?.text || 'this task'}"? This cannot be undone.`,
        confirmLabel: 'Delete Task',
        onConfirm: () => deleteTask(projectId, taskId)
    });
}

function completeProjectFromModal(projectId) {
    completeProject(projectId);
    closeProjectModal();
}

// ============================================================================
// CONFIRMATION DIALOGS
// ============================================================================

function openConfirmationDialog({ title = 'Confirm Delete', message = 'Are you sure you want to delete this item?', confirmLabel = 'Delete', onConfirm } = {}) {
    const confirmDialog = document.getElementById('confirmDialog');
    const confirmBtn = document.getElementById('confirmDeleteBtn');
    const titleEl = confirmDialog?.querySelector('.confirm-dialog h3');
    const messageEl = document.getElementById('confirmMessage');

    if (!confirmDialog || !confirmBtn) {
        if (window.confirm(message) && typeof onConfirm === 'function') onConfirm();
        return;
    }

    if (titleEl) titleEl.textContent = title;
    if (messageEl) messageEl.textContent = message;
    confirmBtn.textContent = confirmLabel;
    confirmBtn.onclick = () => {
        if (typeof onConfirm === 'function') onConfirm();
        closeConfirmDialog();
    };

    confirmDialog.classList.add('active');
}

function confirmDeleteProject(projectId) {
    const project = state.findProject(projectId);
    openConfirmationDialog({
        title: 'Delete Project?',
        message: `Delete ${project?.title ? `"${project.title}"` : 'this project'}? This cannot be undone.`,
        confirmLabel: 'Delete Project',
        onConfirm: () => {
            deleteProject(projectId);
            closeProjectModal();
        }
    });
}

function confirmDeleteProjectCard(projectId) {
    const project = state.findProject(projectId);
    openConfirmationDialog({
        title: 'Delete Project?',
        message: `Delete ${project?.title ? `"${project.title}"` : 'this project'}? This cannot be undone.`,
        confirmLabel: 'Delete Project',
        onConfirm: () => deleteProject(projectId)
    });
}

function closeConfirmDialog() {
    const confirmDialog = document.getElementById('confirmDialog');
    const titleEl = confirmDialog?.querySelector('.confirm-dialog h3');
    const messageEl = document.getElementById('confirmMessage');
    const confirmBtn = document.getElementById('confirmDeleteBtn');
    if (confirmDialog) confirmDialog.classList.remove('active');
    if (titleEl) titleEl.textContent = 'Delete Project?';
    if (messageEl) messageEl.textContent = 'Are you sure you want to delete this project? This action cannot be undone.';
    if (confirmBtn) {
        confirmBtn.textContent = 'Delete';
        confirmBtn.onclick = null;
    }
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
    
    const newTasks = taskLines.map(text => normalizeTask({
        id: Date.now() + Math.random(),
        text,
        completed: false,
        tag: DEFAULT_TASK_TAG,
        category: DEFAULT_TASK_CATEGORY
    }));
    const nextCategories = getProjectTaskCategories(project);
    
    const updatedTasks = sortTasks([...newTasks, ...project.tasks]);
    state.updateProject(projectId, projectUpdate({ tasks: updatedTasks, taskCategories: nextCategories }));
    
    pasteBox.value = '';
    projectSelect.value = '';
    document.getElementById('pasteButton').disabled = true;
    
    saveData();
    render();
}

function pasteTasksInModal(projectId) {
    const pasteBox = document.getElementById(`modal-paste-box-${projectId}`);
    if (!pasteBox) return;

    const taskEntries = getModalPasteTaskEntries(pasteBox);
    if (taskEntries.length === 0) return;

    const project = state.findProject(projectId);
    if (!project) return;

    const modalScroll = pasteBox.closest('.modal-scroll-inner');
    const previousScrollTop = modalScroll?.scrollTop ?? null;
    const activeCategory = getProjectTaskCategoryFilter(projectId);
    const category = activeCategory === DEFAULT_TASK_CATEGORY_FILTER ? DEFAULT_TASK_CATEGORY : sanitizeTaskCategoryName(activeCategory);
    const newTasks = taskEntries.map(entry => normalizeTask({
        id: Date.now() + Math.random(),
        text: entry.text,
        completed: false,
        tag: DEFAULT_TASK_TAG,
        category
    }));
    const nextCategories = getTaskCategoryListWith([...getProjectTaskCategories(project), category]);

    const updatedTasks = sortTasks([...newTasks, ...project.tasks]);
    state.updateProject(projectId, projectUpdate({ tasks: updatedTasks, taskCategories: nextCategories }));

    clearTaskEntryElement(pasteBox);
    adjustModalPasteBox(pasteBox);
    saveData();
    renderModalTaskList(projectId);
    updateProjectProgress(projectId);
    refreshProjectCalendarIfPresent(projectId);

    requestAnimationFrame(() => {
        if (modalScroll && previousScrollTop !== null) {
            modalScroll.scrollTop = previousScrollTop;
        }
        const nextPasteBox = document.getElementById(`modal-paste-box-${projectId}`);
        if (nextPasteBox) nextPasteBox.focus({ preventScroll: true });
    });
}

function getProjectStatusAnimationElement(projectId, event = null) {
    const eventElement = event?.currentTarget?.closest?.('.project-card, .archived-project-card');
    if (eventElement) return eventElement;
    return Array.from(document.querySelectorAll('.project-card, .archived-project-card'))
        .find(card => String(card.getAttribute('data-project-id') || '') === String(projectId || '')) || null;
}

function animateProjectStatusChange(projectId, className, onComplete, event = null) {
    const element = getProjectStatusAnimationElement(projectId, event);
    const reduceMotion = typeof window !== 'undefined'
        && typeof window.matchMedia === 'function'
        && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!element || reduceMotion) {
        onComplete?.();
        return;
    }

    element.classList.add(className);
    window.setTimeout(() => onComplete?.(), 190);
}

async function archiveProject(projectId, event = null) {
    const project = state.findProject(projectId);
    if (!project || !project._id) return;
    closeProjectModal();

    animateProjectStatusChange(projectId, 'project-card--archive-exit', async () => {
        state.updateProject(projectId, projectUpdate({ archived: true }));
        syncDerivedCompletedProjectStats();
        render();
        await saveData();
    }, event);
}

async function restoreArchivedProject(projectId, event = null) {
    const project = state.findProject(projectId);
    if (!project || !project._id) return;
    closeProjectModal();

    animateProjectStatusChange(projectId, 'project-card--restore-exit', async () => {
        state.updateProject(projectId, projectUpdate({ archived: false, completed: false, completedDate: null, completedBy: '', completedByName: '' }));
        if (state.getView() === VIEWS.ARCHIVED) {
            uiState.ownerFilter = 'all';
            uiState.activeSavedViewId = '';
            state.setView(VIEWS.ACTIVE);
            setSidebarProjectsNav('activeProjectsCard');
            setViewTitle('Active Projects');
        }
        closeArchivedProjectsModal();
        syncDerivedCompletedProjectStats();
        render();
        await saveData();
    }, event);
}

function adjustModalPasteBox(pasteBox) {
    if (!pasteBox) return;
    const hasText = getTaskEntryPlainText(pasteBox).trim().length > 0;
    pasteBox.classList.toggle('has-task-text', hasText);
    if (!hasText) {
        pasteBox.style.setProperty('height', '2.75rem', 'important');
        return;
    }
    pasteBox.style.setProperty('height', 'auto', 'important');
    pasteBox.style.setProperty('height', `${pasteBox.scrollHeight}px`, 'important');
}

function handleModalPasteInput(projectId, event) {
    adjustModalPasteBox(event?.target || document.getElementById(`modal-paste-box-${projectId}`));
}

function handleModalPasteKeydown(projectId, event) {
    if (!event || event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
    event.preventDefault();
    pasteTasksInModal(projectId);
}

function getCommandPaletteActions() {
    const currentVisible = getFilteredProjects();
    return [
        { id: 'new-project', title: 'Create new project', copy: 'Add a project and open it immediately.', run: () => addProject() },
        { id: 'view-active', title: 'Switch to Active Projects', copy: 'Show active projects.', run: () => switchToActiveView() },
        { id: 'view-completed', title: 'Switch to Completed Projects', copy: 'Show completed projects.', run: () => switchToCompletedView() },
        { id: 'view-archived', title: 'Switch to Archived Projects', copy: 'Show archived projects.', run: () => switchToArchivedView() },
        { id: 'toggle-panel', title: 'Toggle control panel', copy: 'Collapse or expand the side panel.', run: () => {
            document.getElementById('panelEdgeToggle')?.click();
        } },
        { id: 'open-account', title: 'Open account settings', copy: 'Edit your profile and stats.', run: () => openAccountSettingsModal() },
        { id: 'open-ui', title: 'Open UI options', copy: 'Change the current theme.', run: () => openUiOptionsModal() },
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

const PROJECT_GRID_LAYOUT_DEFAULT = Object.freeze({
    columns: 'auto',
    density: 'comfortable'
});

const PROJECT_GRID_DESKTOP_MIN_WIDTH = 861;
const PROJECT_GRID_LARGE_LAYOUT_WIDTH = 1760;

function normalizeProjectGridLayoutPreference(layout) {
    const columns = ['auto', '1', '2', '3', '4'].includes(String(layout?.columns))
        ? String(layout.columns)
        : PROJECT_GRID_LAYOUT_DEFAULT.columns;
    const density = ['compact', 'comfortable', 'spacious'].includes(String(layout?.density))
        ? String(layout.density)
        : PROJECT_GRID_LAYOUT_DEFAULT.density;
    return { columns, density };
}

function getAccountUiPreferences() {
    const preferences = accountState.user?.uiPreferences || accountState.user?.preferences || {};
    return preferences && typeof preferences === 'object' ? preferences : {};
}

function loadProjectGridLayoutPreference() {
    return normalizeProjectGridLayoutPreference(getAccountUiPreferences().projectGridLayout);
}

async function saveProjectGridLayoutPreference(layout) {
    const normalizedLayout = normalizeProjectGridLayoutPreference(layout);
    const currentPreferences = getAccountUiPreferences();
    const nextPreferences = {
        ...currentPreferences,
        projectGridLayout: normalizedLayout
    };

    accountState.user = {
        ...(accountState.user || getCurrentUser?.() || {}),
        uiPreferences: nextPreferences
    };

    try {
        const response = await updateAccountProfileOnServer({ uiPreferences: nextPreferences });
        if (response?.user) {
            accountState.user = response.user;
            state.setCurrentUser(accountState.user);
        }
    } catch (err) {
        console.warn('Failed to save project grid layout preference to the user profile:', err);
        setSaveStatus('error', 'Layout preference could not be saved to your profile');
    }

    return normalizedLayout;
}

function getProjectGridViewportMetrics(grid = document.getElementById('projectGrid')) {
    const cssWidth = window.innerWidth || document.documentElement?.clientWidth || 0;
    const cssHeight = window.innerHeight || document.documentElement?.clientHeight || 0;
    const deviceScale = Math.max(window.devicePixelRatio || 1, 1);
    const gridRect = grid?.getBoundingClientRect?.();
    const computedGridStyle = grid ? window.getComputedStyle(grid) : null;
    const parsedColumnGap = parseFloat(computedGridStyle?.columnGap || computedGridStyle?.gap || '0');
    return {
        cssWidth,
        cssHeight,
        physicalWidth: Math.round(cssWidth * deviceScale),
        physicalHeight: Math.round(cssHeight * deviceScale),
        gridWidth: Math.max(0, Math.floor(gridRect?.width || 0)),
        columnGap: Number.isFinite(parsedColumnGap) ? parsedColumnGap : 0
    };
}

function getMaximumProjectGridColumns(metrics = getProjectGridViewportMetrics()) {
    if (metrics.cssWidth < PROJECT_GRID_DESKTOP_MIN_WIDTH) return 1;
    const availableGridWidth = metrics.gridWidth || metrics.cssWidth;
    if (metrics.cssWidth >= 2400 || availableGridWidth >= PROJECT_GRID_LARGE_LAYOUT_WIDTH || metrics.physicalWidth >= 3000) return 4;
    if (metrics.cssWidth >= 1680 || metrics.physicalWidth >= 1900) return 3;
    return 2;
}

function isProjectGridLargeDesktopViewport(metrics = getProjectGridViewportMetrics()) {
    return getMaximumProjectGridColumns(metrics) >= 3;
}

function getAutoProjectGridColumns(metrics = getProjectGridViewportMetrics()) {
    if (metrics.cssWidth < PROJECT_GRID_DESKTOP_MIN_WIDTH) return null;
    return Math.min(getMaximumProjectGridColumns(metrics), 3);
}

function getEffectiveProjectGridColumns(columns, grid = document.getElementById('projectGrid')) {
    const raw = String(columns || PROJECT_GRID_LAYOUT_DEFAULT.columns);
    const metrics = getProjectGridViewportMetrics(grid);
    if (metrics.cssWidth < PROJECT_GRID_DESKTOP_MIN_WIDTH) return null;
    if (raw === 'auto') return getAutoProjectGridColumns(metrics);
    const requested = Number(raw);
    if (!Number.isFinite(requested) || requested < 1) return null;
    return Math.min(Math.max(Math.floor(requested), 1), 4);
}

function applyProjectGridLayoutPreference() {
    const grid = document.getElementById('projectGrid');
    if (!grid) return;
    const layout = loadProjectGridLayoutPreference();
    const metrics = getProjectGridViewportMetrics(grid);
    const maximumColumns = getMaximumProjectGridColumns(metrics);
    const effectiveColumns = getEffectiveProjectGridColumns(layout.columns, grid);
    grid.dataset.layoutColumns = layout.columns;
    grid.dataset.layoutDensity = layout.density;
    grid.dataset.layoutMaxColumns = maximumColumns || 'auto';
    grid.dataset.layoutEffectiveColumns = effectiveColumns || 'auto';
    grid.classList.toggle('project-grid--manual-layout', layout.columns !== 'auto' && !!effectiveColumns);

    if (effectiveColumns) {
        grid.style.setProperty('grid-template-columns', `repeat(${effectiveColumns}, minmax(0, 1fr))`, 'important');
    } else {
        grid.style.removeProperty('grid-template-columns');
    }

    const gapMap = {
        compact: '0.65rem',
        comfortable: '1.35rem',
        spacious: '2.35rem'
    };
    if (gapMap[layout.density]) {
        grid.style.setProperty('gap', gapMap[layout.density], 'important');
    } else {
        grid.style.removeProperty('gap');
    }
}

function buildProjectLayoutControlsMarkup(layout) {
    const columnOptions = [
        ['auto', 'Auto'],
        ['1', '1'],
        ['2', '2'],
        ['3', '3'],
        ['4', '4']
    ];
    const densityOptions = [
        ['compact', 'Compact'],
        ['comfortable', 'Comfortable'],
        ['spacious', 'Spacious']
    ];
    return `
        <button class="project-layout-toggle" type="button" aria-label="Project card layout options" aria-expanded="false" onclick="toggleProjectLayoutMenu(event)">
            <svg fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <circle cx="6" cy="6" r="1.7"></circle>
                <circle cx="12" cy="6" r="1.7"></circle>
                <circle cx="18" cy="6" r="1.7"></circle>
                <circle cx="6" cy="12" r="1.7"></circle>
                <circle cx="12" cy="12" r="1.7"></circle>
                <circle cx="18" cy="12" r="1.7"></circle>
                <circle cx="6" cy="18" r="1.7"></circle>
                <circle cx="12" cy="18" r="1.7"></circle>
                <circle cx="18" cy="18" r="1.7"></circle>
            </svg>
        </button>
        <div class="project-layout-menu" role="menu" aria-label="Project card layout menu">
            <div class="project-layout-menu-title">Cards per row</div>
            <div class="project-layout-options" role="group" aria-label="Cards per row">
                ${columnOptions.map(([value, label]) => `<button class="project-layout-option ${layout.columns === value ? 'is-active' : ''}" type="button" onclick="setProjectGridLayoutOption('columns', '${value}', event)">${label}</button>`).join('')}
            </div>
            <div class="project-layout-menu-title">Spacing</div>
            <div class="project-layout-options" role="group" aria-label="Project card spacing">
                ${densityOptions.map(([value, label]) => `<button class="project-layout-option ${layout.density === value ? 'is-active' : ''}" type="button" onclick="setProjectGridLayoutOption('density', '${value}', event)">${label}</button>`).join('')}
            </div>
        </div>`;
}

function ensureProjectLayoutControls() {
    const grid = document.getElementById('projectGrid');
    if (!grid?.parentElement) return;
    const fallbackHost = grid.parentElement;
    fallbackHost.classList.add('project-grid-layout-host');
    const slot = document.getElementById('topAppLayoutControlSlot');
    const host = slot || fallbackHost;
    const layout = loadProjectGridLayoutPreference();
    let controls = document.getElementById('projectLayoutControls');
    if (!controls) {
        controls = document.createElement('div');
        controls.id = 'projectLayoutControls';
        controls.className = 'project-layout-controls';
    }
    if (controls.parentElement !== host) {
        host.appendChild(controls);
    }
    controls.innerHTML = buildProjectLayoutControlsMarkup(layout);
    controls.classList.remove('is-open');
    applyProjectGridLayoutPreference();
}

function closeProjectLayoutMenu() {
    const controls = document.getElementById('projectLayoutControls');
    if (!controls) return;
    controls.classList.remove('is-open');
    controls.querySelector('.project-layout-toggle')?.setAttribute('aria-expanded', 'false');
}

function toggleProjectLayoutMenu(event) {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    const controls = document.getElementById('projectLayoutControls');
    if (!controls) return;
    if (isMobileWebSidebarViewport()) {
        controls.classList.remove('is-open');
        controls.querySelector('.project-layout-toggle')?.setAttribute('aria-expanded', 'false');
        return;
    }
    const isOpen = !controls.classList.contains('is-open');
    if (isOpen) {
        controls.innerHTML = buildProjectLayoutControlsMarkup(loadProjectGridLayoutPreference());
    }
    controls.classList.toggle('is-open', isOpen);
    controls.querySelector('.project-layout-toggle')?.setAttribute('aria-expanded', String(isOpen));
}

function setProjectGridLayoutOption(key, value, event) {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    if (isMobileWebSidebarViewport()) {
        closeProjectLayoutMenu();
        return;
    }
    const layout = loadProjectGridLayoutPreference();
    if (key === 'columns') {
        layout.columns = ['auto', '1', '2', '3', '4'].includes(String(value)) ? String(value) : PROJECT_GRID_LAYOUT_DEFAULT.columns;
    }
    if (key === 'density') layout.density = ['compact', 'comfortable', 'spacious'].includes(String(value)) ? String(value) : PROJECT_GRID_LAYOUT_DEFAULT.density;
    const normalizedLayout = normalizeProjectGridLayoutPreference(layout);
    accountState.user = {
        ...(accountState.user || getCurrentUser?.() || {}),
        uiPreferences: {
            ...getAccountUiPreferences(),
            projectGridLayout: normalizedLayout
        }
    };
    const controls = document.getElementById('projectLayoutControls');
    if (controls) {
        controls.innerHTML = buildProjectLayoutControlsMarkup(normalizedLayout);
        controls.classList.add('is-open');
        controls.querySelector('.project-layout-toggle')?.setAttribute('aria-expanded', 'true');
    }
    applyProjectGridLayoutPreference();
    saveProjectGridLayoutPreference(normalizedLayout);
}

function openHowToGuideModal() {
    closeMobileWebSidebarForModal();
    document.getElementById('howToGuideModal')?.classList.add('active');
}

function closeHowToGuideModal() {
    document.getElementById('howToGuideModal')?.classList.remove('active');
    handleSidebarSettingsChildClosed('howToGuideModal');
}


// ============================================================================
// UI RENDERING
// ============================================================================

function render() {
    const displayProjects = getFilteredProjects();
    const projectGrid = document.getElementById('projectGrid');
    const emptyState = document.getElementById('emptyState');
    if (!projectGrid || !emptyState) return;
    ensureProjectLayoutControls();

    const stats = syncDerivedCompletedProjectStats() || { completedTasks: 0, completedProjects: 0 };
    const visibleCompletionStats = calculateVisibleCompletionStats();
    const activeProjectsCountEl = document.getElementById('activeProjectsCount');
    const completedTasksCountEl = document.getElementById('completedTasksCount');
    const completedProjectsCountEl = document.getElementById('completedProjectsCount');

    if (activeProjectsCountEl) activeProjectsCountEl.textContent = state.getProjects().filter(project => !isProjectCompleted(project) && !isProjectArchived(project)).length;
    if (completedTasksCountEl) completedTasksCountEl.textContent = visibleCompletionStats.completedTasks || 0;
    if (completedProjectsCountEl) completedProjectsCountEl.textContent = stats.completedProjects || 0;

    const incompleteTasks = Math.max(0, (visibleCompletionStats.totalTasks || 0) - (visibleCompletionStats.completedTasks || 0));
    const incompleteEl = document.getElementById('incompleteTasksCount');
    if (incompleteEl) incompleteEl.textContent = incompleteTasks;

    runRenderStep('total completion', updateTotalCompletion);
    runRenderStep('view title', syncViewTitle);
    runRenderStep('shared projects panel', renderSharedProjectsPanel);
    runRenderStep('archived projects panel', renderArchivedProjectsPanel);
    runRenderStep('leaderboard panel', renderLeaderboardPanel);
    runRenderStep('notifications', () => { updateNotificationUnreadIndicator(); refreshNotificationsModalIfOpen(); });
    runRenderStep('saved views panel', renderSavedViewsPanel);
    runRenderStep('active filter chips', renderActiveFilterChips);
    runRenderStep('account stats', syncAccountStatsToModal);
    runRenderStep('undo button', updateUndoButton);

    if (displayProjects.length === 0) {
        emptyState.style.display = 'flex';
        projectGrid.innerHTML = '';
        projectGrid.style.display = 'none';
        syncMobileProjectListView([]);
        const emptyTitle = emptyState.querySelector('.title');
        const emptySubtitle = emptyState.querySelector('.subtitle');
        if (emptyTitle) {
            emptyTitle.textContent = uiState.projectSearch.trim()
                ? 'No matching projects'
                : (state.getView() === VIEWS.ARCHIVED
                    ? 'No archived projects'
                    : (state.getView() === VIEWS.ACTIVE ? 'No active projects' : 'No completed projects'));
        }
        if (emptySubtitle) {
            emptySubtitle.textContent = uiState.projectSearch.trim()
                ? 'Try a broader search or different filters'
                : (state.getView() === VIEWS.ARCHIVED
                    ? 'Archived projects will appear here.'
                    : (state.getView() === VIEWS.ACTIVE ? 'Click "New Project" to get started.' : 'Only projects marked complete will appear here.'));
        }
    } else {
        emptyState.style.display = 'none';
        projectGrid.style.display = 'grid';
        projectGrid.innerHTML = displayProjects.map(renderProjectCard).join('');
        applyProjectGridLayoutPreference();
        syncMobileProjectListView(displayProjects);

        if (!isMobileWebSidebarViewport() && state.getView() === VIEWS.ACTIVE && !uiState.projectSearch.trim() && uiState.ownerFilter === 'all' && uiState.sortMode === 'manual' && uiState.activeProjectTag === PROJECT_TAG_ALL_FILTER) {
            setTimeout(setupProjectDragAndDrop, 100);
        }
    }

    runRenderStep('project select', updateProjectSelect);
    runRenderStep('project category select', syncProjectCategorySelect);
}


function renderProjectCard(project) {
    const tasks = Array.isArray(project.tasks) ? project.tasks.map((task, index) => normalizeTask(task, index)) : [];
    const collaborators = Array.isArray(project.collaborators) ? project.collaborators : [];
    const completedTasksCount = tasks.filter(t => isTaskCompleted(t)).length;
    const totalTasks = tasks.length;
    const remainingTasksCount = tasks.filter(t => !isTaskCompleted(t)).length;
    const progressPercentage = totalTasks > 0 ? Math.round((completedTasksCount / totalTasks) * 100) : 0;
    const hasOverdueTasks = projectHasOverdueTasks(project);
    const isShared = collaborators.length > 0;
    const isViewer = project.userRole === 'viewer';
    const isEditor = project.userRole === 'editor';
    const canEditProject = state.canEdit(project.id);
    const canOwnerDelete = project.userRole === 'owner';
    const canShowReorderHandle = canEditProject && !uiState.projectSearch.trim() && uiState.ownerFilter === 'all' && uiState.activeProjectTag === PROJECT_TAG_ALL_FILTER;
    const canReorderProject = canShowReorderHandle && uiState.sortMode === 'manual';
    const showTaskPreview = isProjectCardTaskPreviewEnabled();
    const previewTasks = showTaskPreview ? getProjectCardPreviewTasks(project) : [];
    const projectTags = getProjectTags(project);
    const projectDescription = getProjectCardDescription(project);
    const accessLabel = isViewer || isEditor
        ? `Owner: <strong>${escapeHtml(project.ownerName || 'Unknown')}</strong>`
        : (isShared ? `Shared with <strong>${collaborators.length} user${collaborators.length === 1 ? '' : 's'}</strong>` : 'Owner: <strong>Me</strong>');

    const statusLabel = isProjectArchived(project)
        ? '<span class="project-card-status project-card-status--archived">ARCHIVED</span>'
        : (isProjectCompleted(project)
            ? '<span class="project-card-status project-card-status--completed">COMPLETED</span>'
            : (isViewer || isEditor
                ? `<span class="project-card-status">${escapeHtml(project.userRole.toUpperCase())}</span>`
                : '<span class="project-card-status">ACTIVE</span>'));

    return `
        <div class="project-card stitch-project-card ${isViewer ? 'project-card--viewer' : ''} ${showTaskPreview ? '' : 'project-card--task-preview-disabled'}"
             data-project-id="${project.id}"
             data-project-can-reorder="${canReorderProject ? 'true' : 'false'}"
             onclick="openProjectModal('${project.id}')">
            ${canReorderProject ? `<button class="project-card-reorder-handle" type="button" title="Reorder project" aria-label="Reorder project" onclick="event.preventDefault(); event.stopPropagation();">
                <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 8h16M4 16h16"></path>
                </svg>
            </button>` : ''}
            <div class="project-header">
                <div class="project-title-container">
                    <div class="project-card-title-stack">
                        <div class="project-title" id="project-title-${project.id}" ${canEditProject ? `ondblclick="event.stopPropagation(); editProjectTitleOnCard('${project.id}')"` : ''}>${escapeHtml(project.title)}</div>
                        <input type="text"
                               class="project-title-input project-title-input--card"
                               id="project-title-input-${project.id}"
                               value="${escapeHtml(project.title)}"
                               style="display: none;"
                               onclick="event.stopPropagation();"
                               onblur="finishEditProjectTitleOnCard('${project.id}')"
                               oninput="event.stopPropagation(); handleProjectTitleInput(this)"
                               onanimationend="this.classList.remove('project-title-shake')"
                               onkeydown="if(event.key==='Enter'){ event.preventDefault(); finishEditProjectTitleOnCard('${project.id}'); } if(event.key==='Escape'){ event.preventDefault(); cancelEditProjectTitleOnCard('${project.id}'); }">
                        <p class="project-sync-text">${escapeHtml(formatProjectSyncText(project))}</p>
                    </div>
                </div>
                <div class="project-actions">
                    ${buildProjectMeatballsMenuMarkup(project, 'card')}
                </div>
            </div>

            <div class="project-card-tags ${projectTags.length ? '' : 'project-card-tags--empty'}">
                ${projectTags.length ? projectTags.slice(0, PROJECT_TAG_MAX_COUNT).map(tag => {
                    const tagLiteral = serializeInlineJsString(tag);
                    return `<button class="project-card-tag project-card-tag--editable" type="button" title="Edit ${escapeHtml(tag)} tag" onclick="openProjectTagEditFromCard('${project.id}', ${tagLiteral}, event)">${escapeHtml(tag)}</button>`;
                }).join('') : ''}
                ${canEditProject && projectTags.length < PROJECT_TAG_MAX_COUNT ? `<button class="project-card-tag project-card-tag--add" type="button" title="Add a tag" aria-label="Add a tag" onclick="openProjectTagPickerModal('${project.id}', event)">+</button>` : ''}
            </div>

            <div class="project-card-progress">
                <div class="project-card-description-row project-card-progress-summary">
                    <span class="project-card-progress-spacer" aria-hidden="true"></span>
                    <strong>${progressPercentage}%</strong>
                </div>
                <div class="progress-bar-container">
                    <div class="progress-bar" data-progress-bar="${project.id}" style="width: ${progressPercentage}%"></div>
                </div>
                <div class="project-card-tasks-remaining">Tasks Remaining: ${remainingTasksCount}</div>
                ${hasOverdueTasks ? `<div class="project-card-overdue-warning">${renderWarningTriangleIcon('project-card-overdue-icon')}<span>OVERDUE TASKS</span></div>` : ''}
            </div>

            ${showTaskPreview ? `<ul class="project-preview-list">
                ${previewTasks.length ? previewTasks.map(task => `
                    <li class="project-preview-task ${isTaskCompleted(task) ? 'is-completed' : ''} ${isTaskOverdue(task) ? 'is-overdue' : ''}">
                        <span class="project-preview-priority project-preview-priority--${task.tag}" title="Priority: ${escapeHtml(getTaskTagLabel(task))}" aria-hidden="true"><span class="task-tag-flag task-tag-flag--${task.tag}"></span></span>
                        <span>${getTaskDisplayHtml(task.text || '', 'Untitled task')}</span>
                    </li>
                `).join('') : '<li class="project-preview-empty">No tasks yet</li>'}
            </ul>` : ''}

            <div class="project-card-notes-bar project-card-action-row">
                ${renderProjectPriorityControlMarkup(project.id, project, 'card')}
                <button class="project-card-notes-button task-note-button ${projectHasNotes(project.notes) ? 'has-note' : ''}"
                        type="button"
                        data-project-notes-button="${project.id}"
                        title="${escapeHtml(formatProjectNotesPreview(project.notes) || 'Add project notes')}"
                        aria-label="${projectHasNotes(project.notes) ? 'Edit project notes' : 'Add project notes'}"
                        onclick="openProjectNotes('${project.id}', event)">
                    <svg class="icon" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7h8M8 11h8M8 15h4"></path>
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 3h12a2 2 0 012 2v11.5a2 2 0 01-2 2H9l-5 3V5a2 2 0 012-2z"></path>
                    </svg>
                </button>
                ${renderProjectDueDateControlMarkup(project, 'card')}
            </div>

            <div class="project-card-footer">
                <div class="project-card-footer-left">
                    <span class="project-card-access">${accessLabel}</span>
                </div>
                <span class="project-card-meta">
                    ${statusLabel}
                    ${isProjectCompleted(project) ? `<button class="activate-button" onclick="event.stopPropagation(); completeProject('${project.id}')">Activate</button>` : ''}
                </span>
            </div>
        </div>
    `;
}
function renderSharedProjectsPanel() {
    const sharedProjectsList = document.getElementById('sharedProjectsList');
    const sharedProjectsCount = document.getElementById('sharedProjectsCount');

    const sharedActiveProjects = state.getProjects().filter(project => !isProjectCompleted(project) && !isProjectArchived(project)).filter(project =>
        project.userRole !== 'owner' || ((project.collaborators || []).length > 0)
    );

    if (sharedProjectsCount) sharedProjectsCount.textContent = String(sharedActiveProjects.length);
    if (!sharedProjectsList) return;

    if (!sharedActiveProjects.length) {
        sharedProjectsList.innerHTML = '<div class="side-panel-empty">No shared active projects</div>';
        return;
    }

    sharedProjectsList.innerHTML = sharedActiveProjects.map(project => {
        const tasks = Array.isArray(project.tasks) ? project.tasks : [];
        const collaborators = Array.isArray(project.collaborators) ? project.collaborators : [];
        const completedTasksCount = tasks.filter(task => isTaskCompleted(task)).length;
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

function openShortcutsModal() {
    closeMobileWebSidebarForModal();
    document.getElementById('shortcutsModal')?.classList.add('active');
}

function closeShortcutsModal() {
    document.getElementById('shortcutsModal')?.classList.remove('active');
    handleSidebarSettingsChildClosed('shortcutsModal');
}

function switchToSharedView() {
    uiState.ownerFilter = 'shared';
    uiState.activeSavedViewId = '';
    state.setView(VIEWS.ACTIVE);
    setSidebarProjectsNav('sharedProjectsCard');
    setViewTitle('Shared');
    render();
}

function renderArchivedProjectsModalList() {
    const list = document.getElementById('archivedProjectsModalList');
    if (!list) return;
    const archivedProjects = getArchivedProjects();
    if (!archivedProjects.length) {
        list.innerHTML = '<div class="side-panel-empty">No archived projects</div>';
        return;
    }
    list.innerHTML = archivedProjects.map(project => `
        <div class="archived-project-card" data-project-id="${escapeHtml(project.id)}">
            <div>
                <div class="archived-project-title">${escapeHtml(project.title)}</div>
                <div class="archived-project-meta">Updated ${escapeHtml(formatCompactDateTime(project.lastModified || project.dateCreated))}</div>
            </div>
            <div class="archived-project-actions">
                <button class="icon-button-small" type="button" onclick="restoreArchivedProject('${project.id}', event)">Restore</button>
                <button class="icon-button-small" type="button" onclick="openProjectModal('${project.id}')">Open</button>
            </div>
        </div>
    `).join('');
}

function openArchivedProjectsModal() {
    renderArchivedProjectsModalList();
    document.getElementById('archivedProjectsModal')?.classList.add('active');
}

function closeArchivedProjectsModal() {
    document.getElementById('archivedProjectsModal')?.classList.remove('active');
    if (state.getView() === VIEWS.ARCHIVED) {
        setSidebarProjectsNav('archivedProjectsMoreBtn');
    } else if (uiState.ownerFilter === 'shared' && state.getView() === VIEWS.ACTIVE) {
        setSidebarProjectsNav('sharedProjectsCard');
    } else if (state.getView() === VIEWS.COMPLETED) {
        setSidebarProjectsNav('completedProjectsCard');
    } else {
        setSidebarProjectsNav('activeProjectsCard');
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
    const nextTitle = normalizeProjectTitleInput(titleInput.value) || 'New Project';
    titleInput.value = nextTitle;
    if (!validateProjectTitleInput(titleInput)) return;
    clearProjectTitleWarning(titleInput);
    updateProjectTitle(projectId, nextTitle);
    titleDiv.textContent = nextTitle;
    titleDiv.style.display = 'block';
    titleInput.style.display = 'none';
}

function cancelEditProjectTitleOnCard(projectId) {
    const project = state.findProject(projectId);
    const titleDiv = document.getElementById(`project-title-${projectId}`);
    const titleInput = document.getElementById(`project-title-input-${projectId}`);
    if (!titleDiv || !titleInput || !project) return;
    titleInput.value = project.title;
    clearProjectTitleWarning(titleInput);
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
// MOBILE PROJECT EXPANDABLE LIST VIEW
// ============================================================================
function getMobileProjectListCards(grid = document.getElementById('projectGrid')) {
    if (!grid) return [];
    return Array.from(grid.querySelectorAll('.project-card'));
}

function clearMobileProjectListView() {
    const projectGrid = document.getElementById('projectGrid');
    const deckControls = document.getElementById('mobileProjectDeckControls');
    deckControls?.remove();
    document.body.classList.remove('mobile-project-deck-view', 'mobile-project-list-view');
    if (!projectGrid) return;
    projectGrid.classList.remove('project-grid--mobile-deck', 'project-grid--mobile-list');
    getMobileProjectListCards(projectGrid).forEach(card => {
        card.classList.remove('mobile-deck-card', 'mobile-deck-card--active', 'mobile-deck-card--before', 'mobile-deck-card--after', 'mobile-list-card');
        card.removeAttribute('data-mobile-deck-index');
        card.removeAttribute('data-mobile-deck-state');
        card.removeAttribute('aria-current');
        card.removeAttribute('title');
        card.style.removeProperty('--mobile-deck-distance');
        card.style.removeProperty('--mobile-deck-abs-distance');
        card.style.removeProperty('z-index');
    });
}

function syncMobileProjectListView(displayProjects = null) {
    const projectGrid = document.getElementById('projectGrid');
    if (!projectGrid) return;
    const projects = Array.isArray(displayProjects) ? displayProjects : getFilteredProjects();
    if (!isMobileWebSidebarViewport() || !projects.length) {
        clearMobileProjectListView();
        return;
    }

    const cards = getMobileProjectListCards(projectGrid);
    if (!cards.length) {
        clearMobileProjectListView();
        return;
    }

    document.body.classList.remove('mobile-project-deck-view');
    document.body.classList.add('mobile-project-list-view');
    document.getElementById('mobileProjectDeckControls')?.remove();
    projectGrid.classList.remove('project-grid--mobile-deck');
    projectGrid.classList.add('project-grid--mobile-list');

    cards.forEach(card => {
        card.classList.remove('mobile-deck-card', 'mobile-deck-card--active', 'mobile-deck-card--before', 'mobile-deck-card--after');
        card.classList.add('mobile-list-card');
        card.removeAttribute('data-mobile-deck-index');
        card.removeAttribute('data-mobile-deck-state');
        card.removeAttribute('aria-current');
        card.setAttribute('title', 'Tap to open this project');
        card.style.removeProperty('--mobile-deck-distance');
        card.style.removeProperty('--mobile-deck-abs-distance');
        card.style.removeProperty('z-index');
    });
}

function scheduleMobileProjectListSync() {
    requestAnimationFrame(() => syncMobileProjectListView());
}

// ============================================================================
// MOBILE WEB SIDEBAR
// ============================================================================

function isMobileWebSidebarViewport() {
    return window.matchMedia('(max-width: 980px)').matches;
}

function renderPanelEdgeToggleIcon(isOpen) {
    const panelEdgeToggle = document.getElementById('panelEdgeToggle');
    if (!panelEdgeToggle) return;

    if (isMobileWebSidebarViewport()) {
        panelEdgeToggle.innerHTML = isOpen
            ? `<svg class="icon-lg" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
               </svg>`
            : `<svg class="icon-lg" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16"></path>
               </svg>`;
        panelEdgeToggle.setAttribute('aria-label', isOpen ? 'Close sidebar' : 'Open sidebar');
        panelEdgeToggle.setAttribute('aria-expanded', String(isOpen));
        return;
    }

    panelEdgeToggle.innerHTML = `<svg class="icon-lg" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"></path>
        </svg>`;
}

function setMobileWebSidebarOpen(isOpen) {
    const nextOpen = !!isOpen && isMobileWebSidebarViewport();
    document.body.classList.toggle('mobile-drawer-open', nextOpen);
    document.body.classList.remove('mobile-sidebar-open');
    document.getElementById('controlPanel')?.setAttribute('aria-hidden', nextOpen ? 'false' : 'true');
    renderPanelEdgeToggleIcon(nextOpen);
}

function closeMobileWebSidebarForModal() {
    if (!isMobileWebSidebarViewport()) return;
    setMobileWebSidebarOpen(false);
}

function syncMobileAppBarHeight() {
    const topAppBar = document.querySelector('.top-app-bar');
    const root = document.documentElement;
    if (!topAppBar || !root) return;

    if (!isMobileWebSidebarViewport()) {
        root.style.removeProperty('--mobile-app-bar-height');
        return;
    }

    const measuredHeight = Math.ceil(topAppBar.getBoundingClientRect().height || 0);
    const nextHeight = measuredHeight > 0 ? measuredHeight : 54;
    root.style.setProperty('--mobile-app-bar-height', `${nextHeight}px`);
}

function initializeMobileWebSidebar() {
    const controlPanel = document.getElementById('controlPanel');
    const panelEdgeToggle = document.getElementById('panelEdgeToggle');
    if (!controlPanel || !panelEdgeToggle) return;

    const isSidebarOpen = () => document.body.classList.contains('mobile-drawer-open');
    const isModalOpen = () => !!document.querySelector('.modal-overlay.active, .auth-overlay:not(.hidden)');
    const isInsideSidebar = target => !!target?.closest?.('#controlPanel');
    const isToggle = target => !!target?.closest?.('#panelEdgeToggle');
    const isInteractiveTarget = target => !!target?.closest?.('input, textarea, select, button, a, [contenteditable="true"], .modal-overlay, .auth-overlay');

    const syncMobileSidebarState = () => {
        syncMobileAppBarHeight();
        if (!isMobileWebSidebarViewport()) {
            setMobileWebSidebarOpen(false);
            controlPanel.removeAttribute('aria-hidden');
            renderPanelEdgeToggleIcon(false);
            return;
        }
        controlPanel.setAttribute('aria-hidden', isSidebarOpen() ? 'false' : 'true');
        renderPanelEdgeToggleIcon(isSidebarOpen());
    };

    document.addEventListener('click', event => {
        if (!isMobileWebSidebarViewport() || !isSidebarOpen() || isModalOpen()) return;
        if (isInsideSidebar(event.target) || isToggle(event.target)) return;
        setMobileWebSidebarOpen(false);
    }, true);

    controlPanel.addEventListener('click', event => {
        if (!isMobileWebSidebarViewport()) return;
        const navigationTarget = event.target.closest?.('#activeProjectsCard, #sharedProjectsCard, #completedProjectsCard, #archivedProjectsMoreBtn');
        if (navigationTarget) setMobileWebSidebarOpen(false);
    });

    // Mobile web uses an explicit menu button and outside-click dismissal.
    // No edge-swipe listeners are registered so page/card scrolling remains vertical and predictable.

    document.addEventListener('keydown', event => {
        if (event.key === 'Escape' && isMobileWebSidebarViewport() && isSidebarOpen()) {
            setMobileWebSidebarOpen(false);
        }
    });

    window.addEventListener('resize', syncMobileSidebarState);
    window.addEventListener('orientationchange', () => requestAnimationFrame(syncMobileSidebarState));
    if (typeof ResizeObserver !== 'undefined') {
        const topAppBar = document.querySelector('.top-app-bar');
        if (topAppBar) {
            window.__mobileTopBarObserver?.disconnect?.();
            window.__mobileTopBarObserver = new ResizeObserver(() => syncMobileAppBarHeight());
            window.__mobileTopBarObserver.observe(topAppBar);
        }
    }
    requestAnimationFrame(syncMobileSidebarState);
    syncMobileSidebarState();
}


function initializeMobileToolbarSearch() {
    const searchInput = document.getElementById('projectSearchInput');
    const searchWrap = searchInput?.closest?.('.view-toolbar-search-wrap');
    if (!searchInput || !searchWrap) return;

    const syncSearchState = () => {
        const shouldStayOpen = isMobileWebSidebarViewport() && (document.activeElement === searchInput || !!searchInput.value.trim());
        searchWrap.classList.toggle('is-mobile-search-open', shouldStayOpen);
    };

    searchWrap.addEventListener('click', event => {
        if (!isMobileWebSidebarViewport()) return;
        event.stopPropagation();
        searchInput.focus({ preventScroll: true });
        searchWrap.classList.add('is-mobile-search-open');
        syncMobileAppBarHeight();
    });

    searchInput.addEventListener('focus', () => {
        if (!isMobileWebSidebarViewport()) return;
        searchWrap.classList.add('is-mobile-search-open');
        syncMobileAppBarHeight();
    });

    searchInput.addEventListener('blur', () => {
        window.setTimeout(() => {
            syncSearchState();
            syncMobileAppBarHeight();
        }, 90);
    });

    searchInput.addEventListener('keydown', event => {
        if (!isMobileWebSidebarViewport() || event.key !== 'Escape') return;
        if (searchInput.value) {
            searchInput.value = '';
            uiState.projectSearch = '';
            render();
        }
        searchInput.blur();
        searchWrap.classList.remove('is-mobile-search-open');
        syncMobileAppBarHeight();
    });

    window.addEventListener('resize', syncSearchState);
    window.addEventListener('orientationchange', () => requestAnimationFrame(syncSearchState));
    syncSearchState();
}

// Tracks modal backdrop interactions from their true start point so click-drag
// gestures that begin inside modal content cannot close a modal when released
// over the backdrop.
let __modalBackdropStartTarget = null;
let __modalBackdropGuardInitialized = false;

function getModalBackdropTarget(target) {
    if (!target || typeof target.matches !== 'function') return null;
    return target.matches('.modal-overlay, .auth-overlay') ? target : null;
}

function initializeModalBackdropDismissalGuard() {
    if (__modalBackdropGuardInitialized) return;
    __modalBackdropGuardInitialized = true;

    const rememberStartTarget = event => {
        __modalBackdropStartTarget = getModalBackdropTarget(event.target);
    };

    const clearStartTarget = () => {
        __modalBackdropStartTarget = null;
    };

    document.addEventListener('pointerdown', rememberStartTarget, true);
    document.addEventListener('mousedown', rememberStartTarget, true);
    document.addEventListener('touchstart', rememberStartTarget, true);
    document.addEventListener('pointercancel', clearStartTarget, true);
    document.addEventListener('touchcancel', clearStartTarget, true);

    document.addEventListener('click', event => {
        const clickBackdrop = getModalBackdropTarget(event.target);
        if (!clickBackdrop) {
            __modalBackdropStartTarget = null;
            return;
        }

        const startedOnSameBackdrop = __modalBackdropStartTarget === clickBackdrop;
        __modalBackdropStartTarget = null;
        if (startedOnSameBackdrop) return;

        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation?.();
    }, true);
}

// ============================================================================
// EVENT HANDLERS
// ============================================================================

function initializeEventHandlers() {
    initializeModalBackdropDismissalGuard();

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
        const panelEdgeToggle = document.getElementById('panelEdgeToggle');
        panelEdgeToggle?.setAttribute('aria-expanded', String(!isCollapsed));
        panelEdgeToggle?.setAttribute('aria-label', isCollapsed ? 'Open control panel' : 'Close control panel');
    };

    const collapseControlPanel = () => {
        if (!controlPanel) return;
        state.setControlPanelOpen(false);
        controlPanel.classList.add('collapsed');
        viewport?.classList.remove('full');
        syncControlPanelState();
    };

    const expandControlPanel = () => {
        if (!controlPanel) return;
        state.setControlPanelOpen(true);
        controlPanel.classList.remove('collapsed');
        viewport?.classList.remove('full');
        syncControlPanelState();
    };

    collapseButton?.addEventListener('click', collapseControlPanel);
    expandButton?.addEventListener('click', expandControlPanel);

    // Always-visible edge toggle — toggles between expand/collapse based on current state
    const panelEdgeToggle = document.getElementById('panelEdgeToggle');
    panelEdgeToggle?.addEventListener('click', () => {
        if (isMobileWebSidebarViewport()) {
            setMobileWebSidebarOpen(!document.body.classList.contains('mobile-drawer-open'));
            return;
        }
        if (controlPanel?.classList.contains('collapsed')) {
            expandControlPanel();
        } else {
            collapseControlPanel();
        }
    });

    syncControlPanelState();
    initializeMobileWebSidebar();
    initializeMobileToolbarSearch();

    // Add project button
    document.getElementById('addProjectButton')?.addEventListener('click', addProject);
    document.getElementById('confirmNewProjectButton')?.addEventListener('click', addProject);
    document.getElementById('cancelNewProjectButton')?.addEventListener('click', resetNewProjectCreatePanel);
    document.getElementById('newProjectDescriptionInput')?.addEventListener('input', () => showNewProjectDescriptionWarning(false));
    ['newProjectTitleInput', 'newProjectDescriptionInput'].forEach(inputId => {
        document.getElementById(inputId)?.addEventListener('keydown', event => {
            if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
                event.preventDefault();
                addProject();
            }
            if (event.key === 'Escape') resetNewProjectCreatePanel();
        });
    });

    // Undo button
    document.getElementById('undoButton')?.addEventListener('click', performUndo);

    // Paste button
    document.getElementById('pasteButton')?.addEventListener('click', pasteTasks);

    initializeSidebarSections();
    document.querySelectorAll('[data-sidebar-toggle]').forEach(button => {
        button.addEventListener('click', () => toggleSidebarSection(button.dataset.sidebarToggle));
    });

    const sidebarMoreToggleBtn = document.getElementById('sidebarMoreToggleBtn');
    const sidebarMoreGroup = sidebarMoreToggleBtn?.closest('.sidebar-more-group');
    const sidebarMoreMenu = document.getElementById('sidebarMoreMenu');
    if (sidebarMoreToggleBtn && sidebarMoreGroup) {
        sidebarMoreToggleBtn.setAttribute('aria-expanded', sidebarMoreGroup.classList.contains('is-expanded') ? 'true' : 'false');
        if (sidebarMoreMenu?.id) sidebarMoreToggleBtn.setAttribute('aria-controls', sidebarMoreMenu.id);
        sidebarMoreToggleBtn.addEventListener('click', (event) => {
            event.preventDefault();
            const nextExpanded = !sidebarMoreGroup.classList.contains('is-expanded');
            sidebarMoreGroup.classList.toggle('is-expanded', nextExpanded);
            sidebarMoreToggleBtn.setAttribute('aria-expanded', nextExpanded ? 'true' : 'false');
        });
    }

    document.getElementById('sidebarAccountSettingsBtn')?.addEventListener('click', openAccountSettingsModal);
    document.getElementById('sidebarUiOptionsBtn')?.addEventListener('click', openUiOptionsModal);
    document.getElementById('sidebarShortcutsBtn')?.addEventListener('click', openShortcutsModal);
    document.getElementById('sidebarHowToGuideBtn')?.addEventListener('click', openHowToGuideModal);
    document.getElementById('sidebarSignOutBtn')?.addEventListener('click', logout);
    document.getElementById('activeProjectsCard')?.addEventListener('click', switchToActiveView);
    document.getElementById('completedProjectsCard')?.addEventListener('click', switchToCompletedView);
    document.getElementById('sharedProjectsCard')?.addEventListener('click', switchToSharedView);
    document.getElementById('archivedProjectsMoreBtn')?.addEventListener('click', switchToArchivedView);

    document.getElementById('collapsedPanelUserPill')?.addEventListener('click', () => {
        document.getElementById('panelUserPill')?.click();
    });
    document.getElementById('collapsedPanelNotificationButton')?.addEventListener('click', () => {
        document.getElementById('panelNotificationButton')?.click();
    });
    document.getElementById('collapsedAddProjectButton')?.addEventListener('click', () => {
        expandControlPanel();
        requestAnimationFrame(() => document.getElementById('addProjectButton')?.click());
    });
    document.getElementById('collapsedActiveProjectsCard')?.addEventListener('click', switchToActiveView);
    document.getElementById('collapsedCompletedProjectsCard')?.addEventListener('click', switchToCompletedView);
    document.getElementById('collapsedSharedProjectsCard')?.addEventListener('click', switchToSharedView);
    document.getElementById('collapsedArchivedProjectsMoreBtn')?.addEventListener('click', switchToArchivedView);
    document.getElementById('collapsedLeaderboardButton')?.addEventListener('click', openSidebarLeaderboardModal);
    document.getElementById('collapsedSettingsButton')?.addEventListener('click', openSidebarSettingsModal);

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

    document.getElementById('shortcutsModal')?.addEventListener('click', (e) => {
        if (e.target.id === 'shortcutsModal') closeShortcutsModal();
    });
    document.getElementById('closeShortcutsModalBtn')?.addEventListener('click', closeShortcutsModal);

    document.getElementById('howToGuideModal')?.addEventListener('click', (e) => {
        if (e.target.id === 'howToGuideModal') closeHowToGuideModal();
    });
    document.getElementById('closeHowToGuideModalBtn')?.addEventListener('click', closeHowToGuideModal);

    document.getElementById('archivedProjectsModal')?.addEventListener('click', (e) => {
        if (e.target.id === 'archivedProjectsModal') closeArchivedProjectsModal();
    });
    document.getElementById('closeArchivedProjectsModalBtn')?.addEventListener('click', closeArchivedProjectsModal);

    document.getElementById('commandPaletteModal')?.addEventListener('click', (e) => {
        if (e.target.id === 'commandPaletteModal') closeCommandPalette();
    });

    document.getElementById('projectSearchInput')?.addEventListener('input', (e) => {
        uiState.projectSearch = e.target.value || '';
        uiState.activeSavedViewId = '';
        render();
    });
    document.getElementById('projectCategorySelect')?.addEventListener('change', (e) => {
        switchProjectCategory(e.target.value || 'active');
    });
    const projectSortSelect = document.getElementById('projectSortSelect');
    projectSortSelect?.addEventListener('pointerdown', () => {
        projectSortSelect.classList.add('is-interacting');
    });
    projectSortSelect?.addEventListener('focus', () => {
        projectSortSelect.classList.add('is-interacting');
    });
    projectSortSelect?.addEventListener('blur', () => {
        projectSortSelect.classList.remove('is-interacting');
    });
    projectSortSelect?.addEventListener('change', (e) => {
        uiState.activeSavedViewId = '';
        setProjectCardSortMode(e.target.value || 'recent');
        window.requestAnimationFrame(() => e.target.blur());
    });
    document.querySelectorAll('[data-theme-family-option]').forEach(button => {
        button.addEventListener('click', () => applyThemeFamily(button.getAttribute('data-theme-family-option')));
    });
    const toggleColorMode = () => {
        const meta = getThemeMeta(uiState.theme);
        const nextMode = meta.mode === 'dark' ? 'light' : 'dark';
        applyTheme(buildThemeName(meta.family, nextMode));
    };
    document.getElementById('colorModeToggleBtn')?.addEventListener('click', toggleColorMode);
    document.getElementById('uiColorModeToggleBtn')?.addEventListener('click', toggleColorMode);
    document.getElementById('projectTaskPreviewToggleBtn')?.addEventListener('click', () => {
        setProjectCardTaskPreviewEnabled(!isProjectCardTaskPreviewEnabled());
    });
    initializeRichTextInputShortcuts();
    document.getElementById('commandPaletteInput')?.addEventListener('input', (e) => {
        uiState.commandQuery = e.target.value || '';
        uiState.commandActiveIndex = 0;
        renderCommandPalette();
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        const isCommandPaletteInput = uiState.commandPaletteOpen && e.target?.id === 'commandPaletteInput';
        const modalActive = isAnyModalActive() && !uiState.commandPaletteOpen;
        if (modalActive) {
            return;
        }
        if (isTypingTarget(e.target) && !isCommandPaletteInput) {
            return;
        }

        if (!isTypingTarget(e.target) && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
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
            if (isCommandPaletteInput) return;
        }
        
        switch(e.key.toLowerCase()) {
            case SHORTCUTS.NEW_PROJECT:
                addProject();
                break;
            case SHORTCUTS.TOGGLE_PANEL:
                document.getElementById('panelEdgeToggle')?.click();
                break;
            case SHORTCUTS.TOGGLE_MENU:
                openShortcutsModal();
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
M - Keyboard Shortcuts
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
- Long-click and drag a project card to reorder projects
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
    if (errEl) {
        errEl.textContent = '';
        errEl.classList.add('hidden');
        errEl.classList.remove('is-success');
    }

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
            const pendingMessage = updated.pendingInvitationMessage || '';
            openProjectModal(projectId);
            // Re-open on Members tab
            setTimeout(() => {
                switchModalTab(projectId, 'members');
                if (pendingMessage) {
                    const freshErrEl = document.getElementById(`invite-error-${projectId}`);
                    if (freshErrEl) {
                        freshErrEl.textContent = pendingMessage;
                        freshErrEl.classList.remove('hidden');
                        freshErrEl.classList.add('is-success');
                    }
                }
            }, 50);
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
window.copyTaskToClipboard = copyTaskToClipboard;
window.switchToActiveView = switchToActiveView;
window.switchToCompletedView = switchToCompletedView;
window.switchToArchivedView = switchToArchivedView;
window.openProjectModal = openProjectModal;
window.openAccountSettingsModal = openAccountSettingsModal;
window.closeAccountSettingsModal = closeAccountSettingsModal;
window.closePersonalProgressionModal = closePersonalProgressionModal;
window.triggerProfilePicUpload = triggerProfilePicUpload;
window.removeProfilePicture = removeProfilePicture;
window.saveAccountSettingsFromModal = saveAccountSettingsFromModal;
window.closeProjectModal = closeProjectModal;
window.editModalTitle = editModalTitle;
window.finishEditModalTitle = finishEditModalTitle;
window.handleProjectTitleInput = handleProjectTitleInput;
window.editProjectDescription = editProjectDescription;
window.cancelEditProjectDescription = cancelEditProjectDescription;
window.finishEditProjectDescription = finishEditProjectDescription;
window.editModalTask = editModalTask;
window.finishEditModalTask = finishEditModalTask;
window.handleModalTaskEditKeydown = handleModalTaskEditKeydown;
window.autoResizeModalTaskInput = autoResizeModalTaskInput;
window.addTaskToModal = addTaskToModal;
window.updateTaskDueDate = updateTaskDueDate;
window.updateProjectDueDate = updateProjectDueDate;
window.deleteTaskFromModal = deleteTaskFromModal;
window.completeProjectFromModal = completeProjectFromModal;
window.confirmDeleteProject = confirmDeleteProject;
window.confirmDeleteProjectCard = confirmDeleteProjectCard;
window.openProjectMetadataDetails = openProjectMetadataDetails;
window.closeProjectMetadataDetails = closeProjectMetadataDetails;
window.selectProjectCalendarDay = selectProjectCalendarDay;
window.changeProjectCalendarMonth = changeProjectCalendarMonth;
window.goToProjectCalendarToday = goToProjectCalendarToday;
window.saveProjectCalendarNote = saveProjectCalendarNote;
window.deleteProjectCalendarNote = deleteProjectCalendarNote;
window.handleProjectCalendarTaskDragStart = handleProjectCalendarTaskDragStart;
window.handleProjectCalendarTaskDragEnd = handleProjectCalendarTaskDragEnd;
window.handleProjectCalendarDayDragOver = handleProjectCalendarDayDragOver;
window.handleProjectCalendarDayDragLeave = handleProjectCalendarDayDragLeave;
window.handleProjectCalendarTaskDrop = handleProjectCalendarTaskDrop;
window.updateProjectCalendarTaskPriority = updateProjectCalendarTaskPriority;
window.createProjectCalendarTask = createProjectCalendarTask;
window.removeProjectCalendarTaskFromDay = removeProjectCalendarTaskFromDay;
window.closeProjectMeatballsMenus = closeProjectMeatballsMenus;
window.closeConfirmDialog = closeConfirmDialog;
window.pasteTasks = pasteTasks;
window.pasteTasksInModal = pasteTasksInModal;
window.handleTaskClick = handleTaskClick;
window.switchModalTab = switchModalTab;
window.saveProjectNotes = saveProjectNotes;
window.openProjectNotes = openProjectNotes;
window.closeProjectNotesModal = closeProjectNotesModal;
window.selectProjectNoteTab = selectProjectNoteTab;
window.addProjectNoteTab = addProjectNoteTab;
window.deleteProjectNoteTab = deleteProjectNoteTab;
window.commitPendingProjectNoteTabName = commitPendingProjectNoteTabName;
window.updateProjectNoteTitle = updateProjectNoteTitle;
window.updateProjectNoteBody = updateProjectNoteBody;
window.getRichTextEditorValue = getRichTextEditorValue;
window.applyRichTextCommand = applyRichTextCommand;
window.handleProjectNoteBodyInput = handleProjectNoteBodyInput;
window.addProjectNoteLink = addProjectNoteLink;
window.closeProjectNoteLinkModal = closeProjectNoteLinkModal;
window.editProjectNoteLink = editProjectNoteLink;
window.createProjectNoteLinkFromModal = createProjectNoteLinkFromModal;
window.focusProjectNoteLinkUrl = focusProjectNoteLinkUrl;
window.updateProjectNoteLink = updateProjectNoteLink;
window.deleteProjectNoteLink = deleteProjectNoteLink;
window.deleteProjectNoteLinkFromModal = deleteProjectNoteLinkFromModal;
window.saveActiveProjectNoteFromSurface = saveActiveProjectNoteFromSurface;
window.toggleHideCompleted = toggleHideCompleted;
window.showMoreCompletedTasks = showMoreCompletedTasks;
window.showAllCompletedTasks = showAllCompletedTasks;
window.setProjectTaskSortMode = setProjectTaskSortMode;
window.updateTaskTag = updateTaskTag;
window.cycleProjectCardTaskPriority = cycleProjectCardTaskPriority;
window.cycleProjectPriority = cycleProjectPriority;
window.toggleProjectPriorityMenu = toggleProjectPriorityMenu;
window.selectProjectPriority = selectProjectPriority;
window.updateTaskCategory = updateTaskCategory;
window.setProjectTaskCategoryFilter = setProjectTaskCategoryFilter;
window.toggleTaskPriorityMenu = toggleTaskPriorityMenu;
window.selectTaskPriority = selectTaskPriority;
window.completeTasksByCategory = completeTasksByCategory;
window.completeTasksByPriority = completeTasksByPriority;
window.toggleTaskBulkSelection = toggleTaskBulkSelection;
window.moveSelectedTasksToCategory = moveSelectedTasksToCategory;
window.setSelectedTasksDueDate = setSelectedTasksDueDate;
window.setSelectedTasksPriority = setSelectedTasksPriority;
window.completeSelectedTasks = completeSelectedTasks;
window.deleteSelectedTasks = deleteSelectedTasks;
window.toggleSelectAllVisibleTasks = toggleSelectAllVisibleTasks;
window.openTaskDueDatePicker = openTaskDueDatePicker;
window.openTaskNoteModal = openTaskNoteModal;
window.closeTaskNoteModal = closeTaskNoteModal;
window.saveTaskNoteFromModal = saveTaskNoteFromModal;
window.updateTaskNote = updateTaskNote;
window.toggleTaskCategoryMenu = toggleTaskCategoryMenu;
window.renameTaskCategoryPrompt = renameTaskCategoryPrompt;
window.deleteTaskCategory = deleteTaskCategory;
window.createTaskCategory = createTaskCategory;
window.startInlineTaskCategoryCreate = startInlineTaskCategoryCreate;
window.commitInlineTaskCategoryCreate = commitInlineTaskCategoryCreate;
window.cancelInlineTaskCategoryCreate = cancelInlineTaskCategoryCreate;
window.handleInlineTaskCategoryCreateKeydown = handleInlineTaskCategoryCreateKeydown;
window.commitInlineTaskCategoryEdit = commitInlineTaskCategoryEdit;
window.cancelInlineTaskCategoryEdit = cancelInlineTaskCategoryEdit;
window.handleInlineTaskCategoryEditKeydown = handleInlineTaskCategoryEditKeydown;
window.handleTaskCategoryCreateKeydown = handleTaskCategoryCreateKeydown;
window.setProjectTagFilter = setProjectTagFilter;
window.startInlineProjectTagCreate = startInlineProjectTagCreate;
window.commitInlineProjectTagCreate = commitInlineProjectTagCreate;
window.cancelInlineProjectTagCreate = cancelInlineProjectTagCreate;
window.handleInlineProjectTagCreateKeydown = handleInlineProjectTagCreateKeydown;
window.openProjectTagPickerModal = openProjectTagPickerModal;
window.closeProjectTagPickerModal = closeProjectTagPickerModal;
window.addProjectTagFromPicker = addProjectTagFromPicker;
window.commitProjectTagPickerInput = commitProjectTagPickerInput;
window.handleProjectTagPickerKeydown = handleProjectTagPickerKeydown;
window.deleteProjectTag = deleteProjectTag;
window.performUndo = performUndo;
window.inviteCollaborator = inviteCollaborator;
window.changeCollaboratorRole = changeCollaboratorRole;
window.removeCollaborator = removeCollaborator;
window.editProjectTitleOnCard = editProjectTitleOnCard;
window.finishEditProjectTitleOnCard = finishEditProjectTitleOnCard;
window.cancelEditProjectTitleOnCard = cancelEditProjectTitleOnCard;
window.toggleSidebarSection = toggleSidebarSection;
window.handleModalPasteInput = handleModalPasteInput;
window.handleModalPasteKeydown = handleModalPasteKeydown;
window.openShortcutsModal = openShortcutsModal;
window.closeShortcutsModal = closeShortcutsModal;
window.switchToSharedView = switchToSharedView;
window.openArchivedProjectsModal = openArchivedProjectsModal;
window.closeArchivedProjectsModal = closeArchivedProjectsModal;
window.openLeaderboardProfileModal = openLeaderboardProfileModal;
window.closeLeaderboardProfileModal = closeLeaderboardProfileModal;
window.openSidebarLeaderboardModal = openSidebarLeaderboardModal;
window.closeSidebarLeaderboardModal = closeSidebarLeaderboardModal;
window.openSidebarSettingsModal = openSidebarSettingsModal;
window.closeSidebarSettingsModal = closeSidebarSettingsModal;
window.openNotificationsModal = openNotificationsModal;
window.closeNotificationsModal = closeNotificationsModal;

window.applySavedView = applySavedView;
window.deleteSavedView = deleteSavedView;
window.restoreArchivedProject = restoreArchivedProject;
window.archiveProject = archiveProject;
window.closeUiOptionsModal = closeUiOptionsModal;
window.openUiOptionsModal = openUiOptionsModal;
window.applyAccentColor = applyAccentColor;

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
        .then(() => startRealtimeSync())
        .catch(err => {
            console.error('Initial data load failed:', err);
            setSaveStatus('error', 'Could not load user data');
        });

    Promise.resolve()
        .then(() => refreshAccountProfile())
        .catch(err => console.error('Initial account profile load failed:', err));

}

// ============================================================================
// INITIALIZATION
// ============================================================================

document.addEventListener('click', handleTaskFloatingMenuDocumentClick);
document.addEventListener('click', closeProjectLayoutMenu);
window.addEventListener('resize', applyProjectGridLayoutPreference);
window.addEventListener('resize', scheduleMobileProjectListSync);
window.addEventListener('orientationchange', scheduleMobileProjectListSync);
window.addEventListener('beforeunload', persistOpenProjectModalBeforeUnload);

document.addEventListener('DOMContentLoaded', () => {
    state.setHideCompletedTasks(true);
    loadSavedViewsFromStorage();
    loadThemePreference();
    loadAccentColorPreference();
    loadProjectSortPreference();
    loadProjectCardTaskPreviewPreference();
    moveColorModeToggleToSidebarHeader();
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

window.setProjectCardSortMode = setProjectCardSortMode;
window.toggleProjectLayoutMenu = toggleProjectLayoutMenu;
window.setProjectGridLayoutOption = setProjectGridLayoutOption;
