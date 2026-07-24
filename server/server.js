const http = require('http');
const crypto = require('crypto');
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const { Server } = require('socket.io');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const PROJECT_TAG_MAX_COUNT = 5;
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';
const JWT_EXPIRES_IN = '30d';
const SAFE_AUTH_HEADER_MAX_CHARS = 8192;
const SAFE_JWT_MAX_CHARS = 4096;

// Node's default maxHeaderSize is 8 KB, which can trip a 431 when Chrome sends
// accumulated cookies from the app origin. Auth uses bearer tokens, not cookies,
// so client API calls omit cookies and the server clears legacy app cookies.
// The larger cap lets the cleanup response reach users who already have bloated
// cookies stored in Chrome.
const server = http.createServer({ maxHeaderSize: 512 * 1024 }, app);
const io = new Server(server, {
    cors: { origin: true, credentials: false }
});

// ─── Middleware ───────────────────────────────────────────────────────────────


function getCookieClearDomains(hostname = '') {
    const cleanHost = String(hostname || '').split(':')[0].toLowerCase();
    if (!cleanHost || cleanHost === 'localhost' || /^\d+\.\d+\.\d+\.\d+$/.test(cleanHost)) {
        return [null];
    }

    const domains = [null, cleanHost, `.${cleanHost}`];
    const parts = cleanHost.split('.').filter(Boolean);
    if (parts.length > 2) {
        const rootDomain = parts.slice(-2).join('.');
        domains.push(rootDomain, `.${rootDomain}`);
    }
    return [...new Set(domains)];
}

function getLegacyCookieNames(cookieHeader = '') {
    return String(cookieHeader || '')
        .split(';')
        .map(part => part.split('=')[0]?.trim())
        .filter(name => name && /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(name))
        .filter((name, index, names) => names.indexOf(name) === index)
        .slice(0, 60);
}

function clearLegacyAppCookies(req, res, next) {
    const cookieNames = getLegacyCookieNames(req.headers.cookie || '');
    if (!cookieNames.length) return next();

    const domains = getCookieClearDomains(req.hostname);
    const secure = req.secure || req.get('x-forwarded-proto') === 'https';
    const expires = 'Expires=Thu, 01 Jan 1970 00:00:00 GMT';
    const baseAttrs = `Max-Age=0; ${expires}; Path=/; SameSite=Lax${secure ? '; Secure' : ''}`;

    cookieNames.forEach(name => {
        domains.forEach(domain => {
            const domainAttr = domain ? `; Domain=${domain}` : '';
            res.append('Set-Cookie', `${name}=; ${baseAttrs}${domainAttr}`);
        });
    });

    next();
}

function rejectOversizedAppHeaders(req, res, next) {
    const authorization = String(req.headers.authorization || '');
    if (authorization.length > SAFE_AUTH_HEADER_MAX_CHARS) {
        return res.status(431).json({
            error: 'Request headers too large',
            code: 'HEADER_TOO_LARGE',
            details: 'Authorization header is too large. Reset the browser session and log in again.'
        });
    }
    next();
}

app.use(cors({
    origin: true,
    credentials: false,
    allowedHeaders: ['Content-Type', 'Authorization'],
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']
}));
app.use(clearLegacyAppCookies);
app.use(rejectOversizedAppHeaders);
app.use(express.json({ limit: '6mb' }));
app.use(express.urlencoded({ extended: true, limit: '6mb' }));
app.use(express.static(path.join(__dirname, '..', 'client')));

// ─── Realtime Collaboration ─────────────────────────────────────────────────

io.use((socket, next) => {
    const token = socket.handshake.auth?.token || '';
    if (!token) return next(new Error('No token provided'));
    if (token.length > SAFE_JWT_MAX_CHARS || token.split('.').length !== 3) {
        return next(new Error('Invalid or oversized token'));
    }
    try {
        socket.user = jwt.verify(token, JWT_SECRET);
        next();
    } catch {
        next(new Error('Invalid or expired token'));
    }
});

io.on('connection', (socket) => {
    const userId = socket.user?.id;
    if (!userId) return socket.disconnect(true);
    socket.join(`user:${userId}`);
});

// ─── MongoDB ──────────────────────────────────────────────────────────────────

mongoose.connect(process.env.MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
})
.then(() => console.log('Connected to MongoDB'))
.catch((err) => console.error('MongoDB connection error:', err));

// ─── Schemas & Models ─────────────────────────────────────────────────────────

const accountSchema = new mongoose.Schema({
    email:        { type: String, required: true, unique: true, lowercase: true, trim: true },
    username:     { type: String, required: true, trim: true },
    profilePic:   { type: String, default: '' },
    uiPreferences:{ type: mongoose.Schema.Types.Mixed, default: () => ({}) },
    role:         { type: String, enum: ['user', 'admin'], default: 'user', index: true },
    passwordHash: { type: String, required: true },
    createdAt:    { type: Date, default: Date.now }
});
const Account = mongoose.model('Account', accountSchema);

const taskSchema = new mongoose.Schema({
    id:            Number,
    text:          String,
    completed:     { type: Boolean, default: false },
    completedDate: String,
    completedBy:   { type: String, default: '' },
    completedByName: { type: String, default: '' },
    dueDate:       { type: String, default: '' },
    tag:           { type: String, enum: ['', 'critical', 'high', 'medium', 'low'], default: '' },
    category:      { type: String, default: '' },
    note:          { type: String, default: '' },
    assigneeUserId:{ type: String, default: '' },
    assigneeName:  { type: String, default: '' },
    assigneeEmail: { type: String, default: '' },
    assigneeAssignedAt: { type: String, default: '' }
});

const collaboratorSchema = new mongoose.Schema({
    userId:   { type: String, required: true },
    email:    { type: String, required: true },
    username: { type: String, required: true },
    role:     { type: String, enum: ['viewer', 'editor'], default: 'editor' }
}, { _id: false });

const activitySchema = new mongoose.Schema({
    actorUserId: { type: String, default: '' },
    actorName:   { type: String, default: 'System' },
    type:        { type: String, default: 'project_updated' },
    message:     { type: String, required: true },
    createdAt:   { type: Date, default: Date.now }
}, { _id: false });

const projectSchema = new mongoose.Schema({
    title:         { type: String, default: 'New Project' },
    tasks:         [taskSchema],
    dateCreated:   String,
    priority:      { type: Number, default: 0 },
    projectPriorityTag: { type: String, default: 'none' },
    dueDate:       { type: String, default: '' },
    completed:     { type: Boolean, default: false },
    completedDate: String,
    completedBy:   { type: String, default: '' },
    completedByName: { type: String, default: '' },
    notes:         { type: mongoose.Schema.Types.Mixed, default: '' },
    projectNotes:  { type: mongoose.Schema.Types.Mixed, default: undefined },
    projectNote:   { type: mongoose.Schema.Types.Mixed, default: undefined },
    notesData:     { type: mongoose.Schema.Types.Mixed, default: undefined },
    noteTabs:      { type: mongoose.Schema.Types.Mixed, default: undefined },
    noteTabsData:  { type: mongoose.Schema.Types.Mixed, default: undefined },
    note:          { type: mongoose.Schema.Types.Mixed, default: undefined },
    calendarNotes: { type: Object, default: {} },
    description:   { type: String, default: '' },
    tags:          { type: [String], default: [] },
    archived:      { type: Boolean, default: false },
    owner:         { type: String, required: true },   // Account._id as string
    collaborators: [collaboratorSchema],
    activities:    { type: [activitySchema], default: [] },
    taskCategories: { type: [String], default: [] },
    lastModified:  { type: Date, default: Date.now }
});
const Project = mongoose.model('Project', projectSchema);

const pendingInvitationSchema = new mongoose.Schema({
    projectId: { type: String, required: true, index: true },
    email:     { type: String, required: true, lowercase: true, trim: true, index: true },
    role:      { type: String, enum: ['viewer', 'editor'], default: 'editor' },
    invitedBy: { type: String, required: true },
    token:     { type: String, required: true, unique: true, index: true },
    createdAt: { type: Date, default: Date.now },
    expiresAt: { type: Date, required: true, index: true },
    acceptedAt:{ type: Date, default: null }
});
pendingInvitationSchema.index({ projectId: 1, email: 1, acceptedAt: 1 });
const PendingInvitation = mongoose.model('PendingInvitation', pendingInvitationSchema);

// Per-user cumulative stats (persist across project deletions)
const statsSchema = new mongoose.Schema({
    userId:            { type: String, required: true, unique: true },
    completedTasks:    { type: Number, default: 0 },
    completedProjects: { type: Number, default: 0 },
    progression:       { type: mongoose.Schema.Types.Mixed, default: () => ({}) }
});
const Stats = mongoose.model('Stats', statsSchema);

const ANALYTICS_EVENT_NAMES = new Set([
    'session_started',
    'project_created',
    'project_completed',
    'project_archived',
    'task_created',
    'task_completed',
    'task_deleted',
    'task_reordered',
    'task_pasted',
    'note_created',
    'member_added',
    'calendar_task_dragged',
    'notification_opened',
    'achievement_unlocked',
    'settings_changed',
    'search_used',
    'sort_changed',
    'layout_changed',
    'user_registered',
    'notification_created',
    'api_request',
    'api_error',
    'client_error'
]);

const analyticsDeviceSchema = new mongoose.Schema({
    viewportWidth: Number,
    viewportHeight: Number,
    screenWidth: Number,
    screenHeight: Number,
    browser: String,
    os: String,
    deviceType: String
}, { _id: false });

const analyticsEventSchema = new mongoose.Schema({
    userId:      { type: String, required: true, index: true },
    event:       { type: String, required: true, index: true },
    timestamp:   { type: Date, default: Date.now, index: true },
    ingestedAt:  { type: Date, default: Date.now, index: true },
    source:      { type: String, default: 'live', index: true },
    backfillKey: { type: String, index: true, sparse: true },
    metadata:    { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
    device:      { type: analyticsDeviceSchema, default: () => ({}) }
});
analyticsEventSchema.index({ event: 1, timestamp: -1 });
analyticsEventSchema.index({ userId: 1, timestamp: -1 });
analyticsEventSchema.index({ source: 1, timestamp: -1 });
analyticsEventSchema.index({ backfillKey: 1 }, { unique: true, sparse: true });
const AnalyticsEvent = mongoose.model('AnalyticsEvent', analyticsEventSchema, 'analytics_events');

// ─── Auth Middleware ──────────────────────────────────────────────────────────

function authenticateToken(req, res, next) {
    const token = (req.headers['authorization'] || '').split(' ')[1];
    if (!token) return res.status(401).json({ error: 'No token provided' });
    if (token.length > SAFE_JWT_MAX_CHARS || token.split('.').length !== 3) {
        return res.status(401).json({ error: 'Invalid or oversized token' });
    }
    try {
        req.user = jwt.verify(token, JWT_SECRET);
        next();
    } catch {
        return res.status(401).json({ error: 'Invalid or expired token' });
    }
}

function getConfiguredAdminEmails() {
    return String(process.env.ADMIN_EMAILS || process.env.ADMIN_EMAIL || '')
        .split(',')
        .map(email => email.trim().toLowerCase())
        .filter(Boolean);
}

function isAdminAccount(accountOrUser = {}) {
    if (!accountOrUser) return false;
    if (String(accountOrUser.role || '').toLowerCase() === 'admin') return true;
    const email = String(accountOrUser.email || '').trim().toLowerCase();
    return !!email && getConfiguredAdminEmails().includes(email);
}

async function requireAdminAccount(req, res, next) {
    try {
        const account = await Account.findById(req.user.id, 'email username role');
        if (!account) return res.status(404).json({ error: 'Account not found' });
        if (!isAdminAccount(account)) {
            return res.status(403).json({ error: 'Admin access required' });
        }
        req.account = account;
        next();
    } catch (err) {
        console.error('Admin auth error:', err);
        res.status(500).json({ error: 'Failed to verify admin access', details: err?.message });
    }
}

function sanitizeAnalyticsNumber(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}

function sanitizeAnalyticsText(value, maxLength = 120) {
    return String(value ?? '').trim().slice(0, maxLength);
}

function sanitizeAnalyticsDevice(device = {}, req = null) {
    const userAgent = req?.get?.('user-agent') || '';
    return {
        viewportWidth: sanitizeAnalyticsNumber(device.viewportWidth),
        viewportHeight: sanitizeAnalyticsNumber(device.viewportHeight),
        screenWidth: sanitizeAnalyticsNumber(device.screenWidth),
        screenHeight: sanitizeAnalyticsNumber(device.screenHeight),
        browser: sanitizeAnalyticsText(device.browser || parseBrowserFromUserAgent(userAgent), 60),
        os: sanitizeAnalyticsText(device.os || parseOsFromUserAgent(userAgent), 60),
        deviceType: sanitizeAnalyticsText(device.deviceType || inferDeviceTypeFromUserAgent(userAgent), 32)
    };
}

function parseBrowserFromUserAgent(userAgent = '') {
    const ua = String(userAgent || '');
    if (/Edg\//.test(ua)) return 'Edge';
    if (/Chrome\//.test(ua) && !/Chromium\//.test(ua)) return 'Chrome';
    if (/Safari\//.test(ua) && !/Chrome\//.test(ua)) return 'Safari';
    if (/Firefox\//.test(ua)) return 'Firefox';
    return 'Unknown';
}

function parseOsFromUserAgent(userAgent = '') {
    const ua = String(userAgent || '');
    if (/Windows NT/.test(ua)) return 'Windows';
    if (/iPhone|iPad|iPod/.test(ua)) return 'iOS';
    if (/Android/.test(ua)) return 'Android';
    if (/Mac OS X/.test(ua)) return 'macOS';
    if (/Linux/.test(ua)) return 'Linux';
    return 'Unknown';
}

function inferDeviceTypeFromUserAgent(userAgent = '') {
    const ua = String(userAgent || '');
    if (/Mobi|Android|iPhone|iPod/.test(ua)) return 'mobile';
    if (/iPad|Tablet/.test(ua)) return 'tablet';
    return 'desktop';
}

function sanitizeAnalyticsMetadata(metadata = {}) {
    const source = metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? metadata : {};
    const output = {};
    Object.entries(source).slice(0, 40).forEach(([key, value]) => {
        const safeKey = sanitizeAnalyticsText(key, 64);
        if (!safeKey) return;
        if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) {
            output[safeKey] = typeof value === 'string' ? value.slice(0, 500) : value;
        } else if (Array.isArray(value)) {
            output[safeKey] = value.slice(0, 25).map(item => {
                if (item === null || ['string', 'number', 'boolean'].includes(typeof item)) return item;
                return sanitizeAnalyticsText(JSON.stringify(item), 300);
            });
        } else if (typeof value === 'object') {
            output[safeKey] = sanitizeAnalyticsText(JSON.stringify(value), 1000);
        }
    });
    return output;
}

async function recordAnalyticsEvent(req, event, metadata = {}, device = null) {
    try {
        const safeEvent = sanitizeAnalyticsText(event, 80);
        if (!ANALYTICS_EVENT_NAMES.has(safeEvent)) return null;
        const userId = String(req?.user?.id || metadata.userId || '').trim();
        if (!userId) return null;
        return await AnalyticsEvent.create({
            userId,
            event: safeEvent,
            timestamp: new Date(),
            ingestedAt: new Date(),
            source: 'live',
            metadata: sanitizeAnalyticsMetadata(metadata),
            device: sanitizeAnalyticsDevice(device || metadata.device || {}, req)
        });
    } catch (err) {
        console.warn('Analytics event write failed:', err?.message || err);
        return null;
    }
}

function countCompletedTasks(tasks = []) {
    return Array.isArray(tasks) ? tasks.filter(task => !!task?.completed).length : 0;
}

function getTaskOrderSignature(tasks = []) {
    return Array.isArray(tasks) ? tasks.map(task => String(task?.id ?? '')).join('|') : '';
}

function deriveProjectAnalyticsEvents(previousProject = {}, changedFields = {}) {
    const events = [];
    const metadataBase = {
        projectId: String(previousProject?._id || previousProject?.id || ''),
        projectTitle: String(previousProject?.title || '').slice(0, 120)
    };

    if (Object.prototype.hasOwnProperty.call(changedFields, 'completed') && !previousProject.completed && changedFields.completed) {
        events.push(['project_completed', metadataBase]);
    }
    if (Object.prototype.hasOwnProperty.call(changedFields, 'archived') && !previousProject.archived && changedFields.archived) {
        events.push(['project_archived', metadataBase]);
    }

    if (Array.isArray(changedFields.tasks)) {
        const oldTasks = Array.isArray(previousProject.tasks) ? previousProject.tasks : [];
        const newTasks = changedFields.tasks;
        const oldById = new Map(oldTasks.map(task => [String(task?.id ?? ''), task]));
        const newById = new Map(newTasks.map(task => [String(task?.id ?? ''), task]));
        const added = newTasks.filter(task => !oldById.has(String(task?.id ?? '')));
        const deleted = oldTasks.filter(task => !newById.has(String(task?.id ?? '')));
        const completed = newTasks.filter(task => {
            const oldTask = oldById.get(String(task?.id ?? ''));
            return oldTask && !oldTask.completed && task?.completed;
        });
        if (added.length) events.push(['task_created', { ...metadataBase, count: added.length }]);
        if (added.length > 1) events.push(['task_pasted', { ...metadataBase, count: added.length, source: 'bulk_update' }]);
        if (deleted.length) events.push(['task_deleted', { ...metadataBase, count: deleted.length }]);
        if (completed.length) events.push(['task_completed', { ...metadataBase, count: completed.length }]);
        if (!added.length && !deleted.length && getTaskOrderSignature(oldTasks) !== getTaskOrderSignature(newTasks)) {
            events.push(['task_reordered', metadataBase]);
        }
        const noteCreated = newTasks.some(task => {
            const oldTask = oldById.get(String(task?.id ?? ''));
            return oldTask && !projectNotesHaveContent(oldTask.note) && projectNotesHaveContent(task?.note);
        });
        if (noteCreated) events.push(['note_created', { ...metadataBase, source: 'task_note' }]);
    }

    if (Object.prototype.hasOwnProperty.call(changedFields, 'notes') && !projectNotesHaveContent(previousProject.notes) && projectNotesHaveContent(changedFields.notes)) {
        events.push(['note_created', { ...metadataBase, source: 'project_notes' }]);
    }

    return events;
}

// Middleware factory: resolve a project + enforce minimum role
function requireRole(minRole) {
    const roleOrder = { owner: 3, editor: 2, viewer: 1 };
    return async (req, res, next) => {
        let project;
        try {
            project = await Project.findById(req.params.id);
        } catch {
            return res.status(400).json({ error: 'Invalid project ID' });
        }
        if (!project) return res.status(404).json({ error: 'Project not found' });

        const userId = req.user.id;
        let userRole;
        if (project.owner === userId) {
            userRole = 'owner';
        } else {
            const collab = project.collaborators.find(c => c.userId === userId);
            if (!collab) return res.status(403).json({ error: 'Access denied' });
            userRole = collab.role;
        }

        if (roleOrder[userRole] < roleOrder[minRole]) {
            return res.status(403).json({ error: `Requires ${minRole} access` });
        }

        req.project  = project;
        req.userRole = userRole;
        next();
    };
}

// ─── Helper: enrich project for client ───────────────────────────────────────

async function enrichProject(project, userId, accountMap) {
    const pObj = project.toObject ? project.toObject() : { ...project };
    pObj.id = project._id ? project._id.toString() : project.id;
    pObj.notes = getBestProjectNotesValue(pObj);

    const collaborators = Array.isArray(project.collaborators) ? project.collaborators : [];
    const ownerId = String(project.owner || '');
    const collab = collaborators.find(c => c.userId === userId);
    pObj.userRole  = ownerId === userId ? 'owner' : (collab?.role || 'viewer');
    pObj.ownerName = accountMap?.[ownerId]?.username || 'Unknown';
    pObj.ownerEmail = accountMap?.[ownerId]?.email || '';
    return pObj;
}

async function buildAccountMap(ownerIds) {
    const accounts = await Account.find({ _id: { $in: ownerIds } }, 'username email profilePic');
    return Object.fromEntries(accounts.map(a => [a._id.toString(), a]));
}

function getProjectAudienceIds(project) {
    const audience = new Set();
    if (project?.owner) audience.add(String(project.owner));
    (project?.collaborators || []).forEach(collaborator => {
        if (collaborator?.userId) audience.add(String(collaborator.userId));
    });
    return Array.from(audience).filter(Boolean);
}

async function emitProjectUpsert(project, actor = {}) {
    if (!project) return;
    try {
        const audienceIds = getProjectAudienceIds(project);
        const accountMap = await buildAccountMap([project.owner]);
        await Promise.all(audienceIds.map(async (userId) => {
            const enriched = await enrichProject(project, userId, accountMap);
            io.to(`user:${userId}`).emit('project:upsert', {
                project: enriched,
                sourceUserId: actor?.id || ''
            });
        }));
    } catch (err) {
        console.error('Realtime project upsert failed:', err);
    }
}

function emitProjectDelete(project, actor = {}, explicitAudienceIds = null) {
    const audienceIds = explicitAudienceIds || getProjectAudienceIds(project);
    const projectId = project?._id ? project._id.toString() : (project?.id ? String(project.id) : '');
    if (!projectId) return;
    audienceIds.forEach(userId => {
        if (!userId) return;
        io.to(`user:${userId}`).emit('project:delete', {
            projectId,
            sourceUserId: actor?.id || ''
        });
    });
}

function appendProjectActivity(project, actor, type, message) {
    if (!project || !message) return;
    const activities = Array.isArray(project.activities) ? project.activities : [];
    activities.unshift({
        actorUserId: actor?.id || '',
        actorName: actor?.username || 'System',
        type: type || 'project_updated',
        message,
        createdAt: new Date()
    });
    project.activities = activities.slice(0, 60);
}

function escapeHtmlText(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function getPublicAppUrl(req) {
    const configuredUrl = String(
        process.env.APP_PUBLIC_URL ||
        process.env.PUBLIC_APP_URL ||
        process.env.CLIENT_URL ||
        ''
    ).trim().replace(/\/+$/, '');
    if (configuredUrl) return configuredUrl;

    const forwardedProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
    const proto = forwardedProto || req.protocol || 'https';
    const host = req.get('host') || `localhost:${PORT}`;
    return `${proto}://${host}`.replace(/\/+$/, '');
}

function getInvitationEmailConfigError() {
    if (!process.env.SMTP_HOST) return 'SMTP_HOST is not configured';
    if (!process.env.MAIL_FROM && !process.env.SMTP_FROM && !process.env.SMTP_USER) {
        return 'MAIL_FROM or SMTP_USER is not configured';
    }
    return '';
}

let cachedMailTransporter = null;
function getMailTransporter() {
    const configError = getInvitationEmailConfigError();
    if (configError) throw new Error(configError);

    if (cachedMailTransporter) return cachedMailTransporter;

    const port = Number(process.env.SMTP_PORT || 587);
    cachedMailTransporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: Number.isFinite(port) ? port : 587,
        secure: String(process.env.SMTP_SECURE || '').toLowerCase() === 'true',
        auth: process.env.SMTP_USER || process.env.SMTP_PASS
            ? {
                user: process.env.SMTP_USER,
                pass: process.env.SMTP_PASS
            }
            : undefined
    });

    return cachedMailTransporter;
}

function buildAccountCreationInviteUrl({ email, token, req }) {
    const appUrl = getPublicAppUrl(req);
    return `${appUrl}/?invite=${encodeURIComponent(token)}&email=${encodeURIComponent(email)}`;
}

async function sendAccountCreationInviteEmail({ email, project, role, token, inviter, req }) {
    const transporter = getMailTransporter();
    const inviteUrl = buildAccountCreationInviteUrl({ email, token, req });
    const projectTitle = project?.title || 'a project';
    const inviterName = inviter?.username || inviter?.email || 'A project owner';
    const roleLabel = role === 'viewer' ? 'viewer' : 'editor';
    const from = process.env.MAIL_FROM || process.env.SMTP_FROM || process.env.SMTP_USER;

    await transporter.sendMail({
        from,
        to: email,
        subject: `${inviterName} invited you to ${projectTitle}`,
        text: [
            `${inviterName} invited you to collaborate on "${projectTitle}" as a ${roleLabel}.`,
            '',
            'Create an account with this email address to access the project:',
            inviteUrl,
            '',
            'After you create the account, the project invitation will be applied automatically.'
        ].join('\n'),
        html: `
            <div style="font-family:Arial,sans-serif;line-height:1.5;color:#111827;">
                <h2 style="margin:0 0 12px;">Project invitation</h2>
                <p>${escapeHtmlText(inviterName)} invited you to collaborate on <strong>${escapeHtmlText(projectTitle)}</strong> as a <strong>${escapeHtmlText(roleLabel)}</strong>.</p>
                <p><a href="${escapeHtmlText(inviteUrl)}" style="display:inline-block;padding:10px 14px;border-radius:8px;background:#2563eb;color:#ffffff;text-decoration:none;">Create your account</a></p>
                <p style="font-size:13px;color:#4b5563;">Use ${escapeHtmlText(email)} when creating the account. After registration, the project access will be applied automatically.</p>
            </div>
        `
    });
}

async function claimPendingInvitationsForAccount(account) {
    const accountId = account?._id ? account._id.toString() : '';
    const email = String(account?.email || '').trim().toLowerCase();
    if (!accountId || !email) return [];

    const pendingInvites = await PendingInvitation.find({
        email,
        acceptedAt: null,
        expiresAt: { $gt: new Date() }
    });

    const claimed = [];
    for (const invite of pendingInvites) {
        const project = await Project.findById(invite.projectId);
        if (!project) {
            invite.acceptedAt = new Date();
            await invite.save();
            continue;
        }

        const isOwner = String(project.owner) === accountId;
        const alreadyCollaborator = project.collaborators.some(c => String(c.userId) === accountId);
        if (!isOwner && !alreadyCollaborator) {
            project.collaborators.push({
                userId: accountId,
                email: account.email,
                username: account.username,
                role: invite.role
            });
            project.lastModified = new Date();
            appendProjectActivity(project, account, 'pending_invite_accepted', `${account.username} joined from an email invitation as ${invite.role}`);
            await project.save();
            await emitProjectUpsert(project, account);
            claimed.push(project._id.toString());
        }

        invite.acceptedAt = new Date();
        await invite.save();
    }

    return claimed;
}

function comparableProjectValue(value) {
    if (value === undefined) return '__undefined__';
    if (value === null) return null;
    if (value instanceof Date) return value.toISOString();

    if (Array.isArray(value)) return value.map(comparableProjectValue);

    if (value && typeof value === 'object') {
        if (typeof value.toObject === 'function') {
            return comparableProjectValue(value.toObject({ depopulate: true, versionKey: false }));
        }
        if (typeof value.toJSON === 'function' && value.constructor?.name !== 'Object') {
            return comparableProjectValue(value.toJSON());
        }
        if (value._bsontype === 'ObjectId' && typeof value.toString === 'function') {
            return value.toString();
        }

        return Object.keys(value).sort().reduce((acc, key) => {
            if (key === '__v') return acc;
            acc[key] = comparableProjectValue(value[key]);
            return acc;
        }, {});
    }

    return value;
}

function projectFieldChanged(existingValue, incomingValue) {
    return JSON.stringify(comparableProjectValue(existingValue)) !== JSON.stringify(comparableProjectValue(incomingValue));
}

function sanitizeDateKey(value) {
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

function sanitizeDateTime(value) {
    const raw = String(value ?? '').trim();
    if (!raw) return '';
    const parsed = new Date(raw);
    return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString();
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

function calculateTaskProgressPercentage(completedTasks, totalTasks) {
    const total = Math.max(0, Number(totalTasks || 0) || 0);
    if (total <= 0) return 0;

    const completed = Math.max(0, Math.min(total, Number(completedTasks || 0) || 0));
    if (completed >= total) return 100;

    return Math.max(0, Math.min(99, Math.round((completed / total) * 100)));
}

function sanitizeTask(task, index = 0) {
    const fallbackId = Date.now() + index;
    const numericId = Number(task?.id);
    const hasValidId = Number.isFinite(numericId);
    const rawTag = String(task?.tag || task?.priorityTag || '').trim().toLowerCase();
    const allowedTags = new Set(['', 'critical', 'high', 'medium', 'low']);
    const tag = rawTag === 'critical' ? 'high' : (allowedTags.has(rawTag) ? rawTag : '');
    const category = typeof task?.category === 'string' && task.category.trim()
        ? task.category.trim().replace(/\s+/g, ' ').slice(0, 32)
        : '';
    return {
        id: hasValidId ? numericId : fallbackId,
        text: typeof task?.text === 'string' ? task.text : '',
        completed: parseTaskCompletedValue(task?.completed),
        completedDate: task?.completedDate ? String(task.completedDate) : null,
        completedBy: task?.completedBy ? String(task.completedBy).slice(0, 80) : '',
        completedByName: task?.completedByName ? String(task.completedByName).trim().replace(/\s+/g, ' ').slice(0, 80) : '',
        dueDate: sanitizeDateKey(task?.dueDate || task?.due_date || task?.deadline || ''),
        tag,
        category,
        note: typeof task?.note === 'string' ? task.note.trim() : (typeof task?.notes === 'string' ? task.notes.trim() : ''),
        assigneeUserId: task?.assigneeUserId ? String(task.assigneeUserId).trim().slice(0, 80) : '',
        assigneeName: task?.assigneeName ? String(task.assigneeName).trim().replace(/\s+/g, ' ').slice(0, 80) : '',
        assigneeEmail: task?.assigneeEmail ? String(task.assigneeEmail).trim().toLowerCase().slice(0, 254) : '',
        assigneeAssignedAt: sanitizeDateTime(task?.assigneeAssignedAt || task?.assignedAt || '')
    };
}

function sanitizeProjectTags(tags = []) {
    return [...new Set((Array.isArray(tags) ? tags : [])
        .map(tag => String(tag || '').trim().replace(/\s+/g, ' ').slice(0, 24))
        .filter(tag => tag && tag.toLowerCase() !== 'all'))].slice(0, PROJECT_TAG_MAX_COUNT);
}

function sanitizeProjectCalendarNotes(value = {}) {
    const source = value instanceof Map ? Object.fromEntries(value.entries()) : value;
    if (!source || typeof source !== 'object' || Array.isArray(source)) return {};

    return Object.entries(source).reduce((notes, [rawDate, rawNote]) => {
        const dateKey = sanitizeDateKey(rawDate);
        if (!dateKey) return notes;
        const noteText = String(rawNote ?? '').trim().slice(0, 1000);
        if (!noteText) return notes;
        notes[dateKey] = noteText;
        return notes;
    }, {});
}

function projectNotesPlainText(value = '') {
    return String(value ?? '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/gi, "'")
        .replace(/\s+/g, ' ')
        .trim();
}

function decodeProjectNoteEntities(value = '') {
    let text = String(value ?? '');
    for (let i = 0; i < 4; i += 1) {
        const decoded = text
            .replace(/&nbsp;/gi, ' ')
            .replace(/&quot;/gi, '"')
            .replace(/&#39;|&#x27;|&apos;/gi, "'")
            .replace(/&lt;/gi, '<')
            .replace(/&gt;/gi, '>')
            .replace(/&amp;/gi, '&');
        if (decoded === text) break;
        text = decoded;
    }
    return text;
}

function normalizeProjectNoteHref(value = '') {
    const rawHref = decodeProjectNoteEntities(value).trim();
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
            const label = decodeProjectNoteEntities(source.label ?? source.text ?? source.title ?? source.name ?? source.displayText ?? source.caption ?? '')
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

function extractProjectNoteLinks(value = '') {
    const rawText = String(value ?? '');
    const links = [];
    const seen = new Set();
    let match;

    const anchorPattern = /<a\b[^>]*?href\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>([\s\S]*?)<\/a>/gi;
    while ((match = anchorPattern.exec(rawText)) !== null) {
        const href = decodeProjectNoteEntities(match[2] || match[3] || match[4] || '');
        const label = projectNotesPlainText(match[5] || '').trim() || href;
        addUniqueProjectNoteLink(links, seen, { id: `legacy-anchor-${links.length}`, href, label });
    }

    const markdownPattern = /\[([^\]\n]+)\]\(((?:https?:\/\/|www\.|mailto:)[^)\s]+)\)/gi;
    while ((match = markdownPattern.exec(rawText)) !== null) {
        addUniqueProjectNoteLink(links, seen, { id: `legacy-markdown-${links.length}`, href: match[2], label: match[1] });
    }

    const plainText = projectNotesPlainText(rawText || '');
    const urlPattern = /\b((?:https?:\/\/|www\.)[^\s<>"']+)/gi;
    while ((match = urlPattern.exec(plainText)) !== null) {
        const label = match[1].replace(/[),.;:!?]+$/g, '');
        if (!label) continue;
        addUniqueProjectNoteLink(links, seen, { id: `legacy-url-${links.length}`, href: label, label });
    }

    return links;
}

function normalizeLegacyProjectNoteEntry(entry, index = 0, fallbackTitle = '') {
    const title = String(
        entry?.title ??
        entry?.name ??
        entry?.label ??
        entry?.heading ??
        fallbackTitle ??
        `Note ${index + 1}`
    ).replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40) || `Note ${index + 1}`;
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
    const body = typeof bodyValue === 'string' ? bodyValue : sanitizeProjectNotesValue(bodyValue);
    const explicitLinks = typeof entry === 'object' && entry !== null
        ? (entry.links ?? entry.hyperlinks ?? entry.urls ?? entry.urlList ?? entry.linkList ?? entry.link ?? entry.url ?? entry.href ?? [])
        : [];
    const links = normalizeProjectNoteLinks([
        ...normalizeProjectNoteLinks(explicitLinks),
        ...extractProjectNoteLinks(body)
    ]);
    return {
        id: String(entry?.id || entry?._id || (index === 0 ? 'notes-general' : `notes-legacy-${index}`)).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 48) || (index === 0 ? 'notes-general' : `notes-legacy-${index}`),
        title,
        body,
        links
    };
}

function buildProjectNotesTabsFromArray(value = []) {
    return value
        .map((entry, index) => normalizeLegacyProjectNoteEntry(entry, index))
        .filter(tab => projectNotesPlainText(tab.body).length > 0 || normalizeProjectNoteLinks(tab.links || []).length > 0);
}

function buildProjectNotesTabsFromMap(value = {}) {
    return Object.entries(value)
        .filter(([key]) => !['__projectNotesTabs', 'activeTabId', 'tabs', 'items', 'entries', 'pages', 'sections', 'links', 'hyperlinks', 'urls', '_id', 'id', 'createdAt', 'updatedAt', 'lastModified'].includes(key))
        .map(([key, entry], index) => normalizeLegacyProjectNoteEntry(entry, index, key))
        .filter(tab => projectNotesPlainText(tab.body).length > 0 || normalizeProjectNoteLinks(tab.links || []).length > 0);
}

function serializeProjectNotesTabs(tabs = [], activeTabId = '') {
    try {
        const safeTabs = (Array.isArray(tabs) ? tabs : []).map((tab, index) => {
            const fallbackId = index === 0 ? 'notes-general' : `notes-legacy-${index}`;
            const body = String(tab?.body ?? tab?.text ?? tab?.note ?? tab?.content ?? tab?.html ?? tab?.value ?? '');
            return {
                ...tab,
                id: String(tab?.id || tab?._id || fallbackId).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 48) || fallbackId,
                title: String(tab?.title || tab?.name || tab?.label || `Note ${index + 1}`).trim().replace(/\s+/g, ' ').slice(0, 40) || `Note ${index + 1}`,
                body,
                links: normalizeProjectNoteLinks([
                    ...normalizeProjectNoteLinks(tab?.links ?? tab?.hyperlinks ?? tab?.urls ?? tab?.urlList ?? tab?.linkList ?? tab?.link ?? tab?.url ?? tab?.href ?? []),
                    ...extractProjectNoteLinks(body)
                ])
            };
        });
        return JSON.stringify({
            __projectNotesTabs: true,
            activeTabId: activeTabId || safeTabs[0]?.id || 'notes-general',
            tabs: safeTabs
        });
    } catch {
        return '';
    }
}

function sanitizeProjectNotesValue(value = '') {
    if (typeof value === 'string') {
        const raw = value.trim();
        if ((raw.startsWith('{') && raw.endsWith('}')) || (raw.startsWith('[') && raw.endsWith(']'))) {
            try {
                const parsed = JSON.parse(raw);
                if (parsed && typeof parsed === 'object') {
                    if (parsed.__projectNotesTabs === true || Array.isArray(parsed.tabs)) return value;
                    const normalizedParsed = sanitizeProjectNotesValue(parsed);
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
        if (tabs.length) return serializeProjectNotesTabs(tabs, tabs[0]?.id || 'notes-general');
        return serializeProjectNotesTabs(value, value[0]?.id || 'notes-general');
    }
    if (!value || typeof value !== 'object') return '';

    try {
        if (value.__projectNotesTabs === true || Array.isArray(value.tabs)) {
            const sourceTabs = Array.isArray(value.tabs) ? value.tabs : [];
            const normalizedTabs = buildProjectNotesTabsFromArray(sourceTabs);
            return serializeProjectNotesTabs(normalizedTabs.length ? normalizedTabs : sourceTabs, value.activeTabId || normalizedTabs[0]?.id || sourceTabs[0]?.id || 'notes-general');
        }
    } catch {
        return '';
    }

    const arrayTabFields = ['items', 'entries', 'pages', 'sections', 'noteTabs', 'noteTabsData', 'projectNoteTabs', 'projectNotesTabs', 'projectNotesData'];
    for (const key of arrayTabFields) {
        if (Array.isArray(value[key])) {
            const tabs = buildProjectNotesTabsFromArray(value[key]);
            if (tabs.length) return serializeProjectNotesTabs(tabs, value.activeTabId || tabs[0].id);
        }
    }

    const objectTabFields = ['items', 'entries', 'pages', 'sections', 'noteTabs', 'noteTabsData', 'projectNoteTabs', 'projectNotesTabs', 'projectNotesData'];
    for (const key of objectTabFields) {
        if (value[key] && typeof value[key] === 'object' && !Array.isArray(value[key])) {
            const nestedNotes = sanitizeProjectNotesValue(value[key]);
            if (String(nestedNotes || '').trim()) return nestedNotes;
        }
    }

    const legacyText = value.body ?? value.text ?? value.note ?? value.notes ?? value.content ?? value.html ?? value.value ?? value.description ?? value.comment ?? '';
    const legacyTitle = value.title ?? value.name ?? value.label ?? value.heading ?? 'Notes';
    if (typeof legacyText === 'string' && legacyText.trim()) {
        return serializeProjectNotesTabs([{
            id: 'notes-general',
            title: String(legacyTitle || 'Notes').slice(0, 40) || 'Notes',
            body: legacyText,
            links: normalizeProjectNoteLinks([
                ...(normalizeProjectNoteLinks(value.links ?? value.hyperlinks ?? value.urls ?? value.urlList ?? value.linkList ?? value.link ?? value.url ?? value.href ?? [])),
                ...extractProjectNoteLinks(legacyText)
            ])
        }], 'notes-general');
    }
    if (legacyText && typeof legacyText === 'object') return sanitizeProjectNotesValue(legacyText);

    const mappedTabs = buildProjectNotesTabsFromMap(value);
    if (mappedTabs.length) return serializeProjectNotesTabs(mappedTabs, mappedTabs[0].id);

    return '';
}

function projectNotesHaveContent(value = '') {
    const normalized = sanitizeProjectNotesValue(value);
    if (!String(normalized || '').trim()) return false;
    try {
        const parsed = JSON.parse(normalized);
        if (parsed && Array.isArray(parsed.tabs)) {
            return parsed.tabs.some(tab => projectNotesPlainText(tab?.body).length > 0 || normalizeProjectNoteLinks(tab?.links || []).length > 0 || extractProjectNoteLinks(tab?.body || '').length > 0);
        }
    } catch {
        // Legacy plain-text notes are handled below.
    }
    return projectNotesPlainText(normalized).length > 0;
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

function getBestProjectNotesValue(projectOrValue = {}, ...extraValues) {
    const values = projectOrValue && typeof projectOrValue === 'object' && !Array.isArray(projectOrValue)
        ? [...getProjectNotesCandidateFields(projectOrValue), ...extraValues]
        : [projectOrValue, ...extraValues];

    const normalizedValues = values
        .map(value => sanitizeProjectNotesValue(value))
        .filter(value => String(value ?? '').trim().length > 0);

    return normalizedValues.find(projectNotesHaveContent) || normalizedValues[0] || '';
}

function taskPayloadHasNoteField(task = {}) {
    return !!task && typeof task === 'object' && (
        Object.prototype.hasOwnProperty.call(task, 'note') ||
        Object.prototype.hasOwnProperty.call(task, 'notes')
    );
}

function mergeExistingTaskNotes(sanitizedTasks = [], rawTasks = [], existingTasks = []) {
    if (!Array.isArray(sanitizedTasks) || !Array.isArray(existingTasks) || !existingTasks.length) {
        return Array.isArray(sanitizedTasks) ? sanitizedTasks : [];
    }

    const rawById = Array.isArray(rawTasks)
        ? new Map(rawTasks.map(r => [String(r?.id ?? ''), r]))
        : new Map();
    const existingById = new Map(existingTasks.map(task => [String(task?.id ?? ''), task]));
    return sanitizedTasks.map(task => {
        const taskIdKey = String(task?.id ?? '');
        const rawTask = rawById.get(taskIdKey) ?? null;
        const existingTask = existingById.get(taskIdKey);
        const existingNote = typeof existingTask?.note === 'string' ? existingTask.note : '';
        if (!taskPayloadHasNoteField(rawTask) && !task.note && existingNote) {
            return { ...task, note: existingNote };
        }
        return task;
    });
}


function sanitizeProjectPriorityTag(value) {
    const raw = String(value || 'none').trim().toLowerCase();
    const tag = raw === 'critical' ? 'high' : raw;
    return ['none', 'high', 'medium', 'low'].includes(tag) ? tag : 'none';
}


function sanitizeIncomingProjectUpdate(body = {}) {
    const sanitized = {};

    if (body.title !== undefined) sanitized.title = String(body.title ?? '');
    if (body.tasks !== undefined) sanitized.tasks = Array.isArray(body.tasks)
        ? body.tasks.map((task, index) => sanitizeTask(task, index))
        : [];
    if (body.taskCategories !== undefined) sanitized.taskCategories = Array.isArray(body.taskCategories)
        ? [...new Set(body.taskCategories.map(category => String(category || '').trim().replace(/\s+/g, ' ').slice(0, 32)).filter(Boolean))]
        : [];
    if (body.tags !== undefined) sanitized.tags = sanitizeProjectTags(body.tags);
    if (body.priority !== undefined) {
        const numericPriority = Number(body.priority);
        sanitized.priority = Number.isFinite(numericPriority) ? numericPriority : 0;
    }
    if (body.projectPriorityTag !== undefined || body.projectPriority !== undefined || body.priorityTag !== undefined) {
        sanitized.projectPriorityTag = sanitizeProjectPriorityTag(body.projectPriorityTag ?? body.projectPriority ?? body.priorityTag);
    }
    if (body.dueDate !== undefined || body.projectDueDate !== undefined || body.deadline !== undefined) {
        sanitized.dueDate = sanitizeDateKey(body.dueDate ?? body.projectDueDate ?? body.deadline);
    }
    if (body.completed !== undefined) sanitized.completed = !!body.completed;
    if (body.completedDate !== undefined) sanitized.completedDate = body.completedDate ? String(body.completedDate) : null;
    if (body.completedBy !== undefined) sanitized.completedBy = body.completedBy ? String(body.completedBy).slice(0, 80) : '';
    if (body.completedByName !== undefined) sanitized.completedByName = body.completedByName ? String(body.completedByName).trim().replace(/\s+/g, ' ').slice(0, 80) : '';
    if (body.notes !== undefined || body.projectNotes !== undefined || body.projectNote !== undefined || body.notesData !== undefined || body.noteTabs !== undefined || body.noteTabsData !== undefined || body.note !== undefined) {
        sanitized.notes = getBestProjectNotesValue({
            notes: body.notes,
            projectNotes: body.projectNotes,
            projectNote: body.projectNote,
            notesData: body.notesData,
            noteTabs: body.noteTabs,
            noteTabsData: body.noteTabsData,
            note: body.note
        });
    }
    if (body.calendarNotes !== undefined || body.projectCalendarNotes !== undefined) {
        sanitized.calendarNotes = sanitizeProjectCalendarNotes(body.calendarNotes ?? body.projectCalendarNotes);
    }
    if (body.description !== undefined) sanitized.description = typeof body.description === 'string'
        ? body.description.trim().replace(/\s+/g, ' ').slice(0, 280)
        : String(body.description ?? '').trim().replace(/\s+/g, ' ').slice(0, 280);
    if (body.archived !== undefined) sanitized.archived = !!body.archived;

    return sanitized;
}

function summarizeProjectUpdate(existingProject, incomingBody) {
    const oldProject = existingProject.toObject ? existingProject.toObject() : existingProject;
    const update = incomingBody || {};

    if (typeof update.title === 'string' && update.title !== oldProject.title) {
        return { type: 'project_renamed', message: `renamed the project to “${update.title}”` };
    }

    if (typeof update.projectPriorityTag === 'string' && update.projectPriorityTag !== (oldProject.projectPriorityTag || 'none')) {
        return { type: 'project_priority_updated', message: 'updated the project priority' };
    }

    if (typeof update.dueDate === 'string' && update.dueDate !== (oldProject.dueDate || '')) {
        return { type: 'project_due_date_updated', message: update.dueDate ? 'updated the project due date' : 'cleared the project due date' };
    }

    if (typeof update.archived === 'boolean' && update.archived !== !!oldProject.archived) {
        return update.archived
            ? { type: 'project_archived', message: 'archived the project' }
            : { type: 'project_restored', message: 'restored the project' };
    }

    if (typeof update.completed === 'boolean' && update.completed !== !!oldProject.completed) {
        return update.completed
            ? { type: 'project_completed', message: 'marked the project as completed' }
            : { type: 'project_reactivated', message: 'reactivated the project' };
    }

    if (Array.isArray(update.tasks)) {
        const oldTasks = Array.isArray(oldProject.tasks) ? oldProject.tasks : [];
        const newTasks = update.tasks;
        const oldCount = oldTasks.length;
        const newCount = newTasks.length;
        const oldCompleted = oldTasks.filter(t => t.completed).length;
        const newCompleted = newTasks.filter(t => t.completed).length;

        if (newCount > oldCount) {
            const diff = newCount - oldCount;
            return { type: 'task_added', message: diff === 1 ? 'added a task' : `added ${diff} tasks` };
        }
        if (newCount < oldCount) {
            const diff = oldCount - newCount;
            return { type: 'task_deleted', message: diff === 1 ? 'deleted a task' : `deleted ${diff} tasks` };
        }
        if (newCompleted > oldCompleted) {
            const diff = newCompleted - oldCompleted;
            return { type: 'task_completed', message: diff === 1 ? 'completed a task' : `completed ${diff} tasks` };
        }
        if (newCompleted < oldCompleted) {
            const diff = oldCompleted - newCompleted;
            return { type: 'task_reopened', message: diff === 1 ? 'reopened a task' : `reopened ${diff} tasks` };
        }

        const oldTaskMap = new Map(oldTasks.map(task => [String(task.id), task]));
        const renamedTask = newTasks.find(task => {
            const previous = oldTaskMap.get(String(task.id));
            return previous && previous.text !== task.text;
        });
        if (renamedTask) {
            return { type: 'task_updated', message: 'updated task details' };
        }
    }

    if (typeof update.description === 'string' && update.description !== (oldProject.description || '')) {
        return { type: 'description_updated', message: 'updated the project description' };
    }

    if (typeof update.notes === 'string' && update.notes !== (oldProject.notes || '')) {
        return { type: 'notes_updated', message: 'updated the project notes' };
    }

    if (update.calendarNotes && projectFieldChanged(update.calendarNotes, oldProject.calendarNotes || {})) {
        return { type: 'calendar_notes_updated', message: 'updated the project calendar notes' };
    }

    const keys = Object.keys(update).filter(key => key !== 'priority');
    if (keys.length) {
        return { type: 'project_updated', message: 'updated the project' };
    }

    return null;
}

// Keep JWTs small. Profile pictures can be large data URLs, so they must stay in
// normal API response bodies and never be embedded in bearer tokens. Large JWTs
// can trigger HTTP 431 and can also make the client reject a successful login.
function createAuthToken(account) {
    return jwt.sign(
        {
            id: account._id.toString(),
            email: account.email,
            username: account.username,
            role: isAdminAccount(account) ? 'admin' : 'user'
        },
        JWT_SECRET,
        { expiresIn: JWT_EXPIRES_IN }
    );
}

function sanitizeUiPreferences(value = {}) {
    const source = value && typeof value === 'object' ? value : {};
    const gridLayout = source.projectGridLayout && typeof source.projectGridLayout === 'object' ? source.projectGridLayout : {};
    const columns = ['auto', '1', '2', '3', '4'].includes(String(gridLayout.columns))
        ? String(gridLayout.columns)
        : 'auto';
    const density = ['compact', 'comfortable', 'spacious'].includes(String(gridLayout.density))
        ? String(gridLayout.density)
        : 'comfortable';

    return {
        ...source,
        projectGridLayout: { columns, density }
    };
}

function formatAuthUser(account) {
    return {
        id: account._id.toString(),
        email: account.email,
        username: account.username,
        profilePic: account.profilePic || '',
        role: isAdminAccount(account) ? 'admin' : 'user',
        uiPreferences: sanitizeUiPreferences(account.uiPreferences || {}),
        createdAt: account.createdAt
    };
}

// ─── Auth Routes ─────────────────────────────────────────────────────────────

app.post('/api/auth/register', async (req, res) => {
    try {
        const { email, username, password } = req.body;
        if (!email || !username || !password)
            return res.status(400).json({ error: 'Email, username, and password are required' });
        if (password.length < 6)
            return res.status(400).json({ error: 'Password must be at least 6 characters' });
        if (await Account.findOne({ email: email.toLowerCase() }))
            return res.status(409).json({ error: 'An account with that email already exists' });

        const passwordHash = await bcrypt.hash(password, 12);
        const existingAccountCount = await Account.estimatedDocumentCount();
        const normalizedEmail = String(email || '').trim().toLowerCase();
        const role = existingAccountCount === 0 || getConfiguredAdminEmails().includes(normalizedEmail) ? 'admin' : 'user';
        const account = await new Account({ email, username, passwordHash, role }).save();
        const newUserId = account._id.toString();

        // Claim any legacy 'default' projects (one-time migration for first user)
        await Project.updateMany({ owner: 'default' }, { $set: { owner: newUserId } });
        await claimPendingInvitationsForAccount(account);

        const token = createAuthToken(account);
        res.status(201).json({ token, user: formatAuthUser(account) });
    } catch (err) {
        console.error('Register error:', err);
        res.status(500).json({ error: 'Registration failed', details: err?.message });
    }
});

app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password)
            return res.status(400).json({ error: 'Email and password are required' });

        const account = await Account.findOne({ email: email.toLowerCase() });
        if (!account || !(await bcrypt.compare(password, account.passwordHash)))
            return res.status(401).json({ error: 'Invalid email or password' });

        const token = createAuthToken(account);
        res.json({ token, user: formatAuthUser(account) });
    } catch (err) {
        console.error('Login error:', err);
        res.status(500).json({ error: 'Login failed', details: err?.message });
    }
});

app.get('/api/auth/me', authenticateToken, async (req, res) => {
    const account = await Account.findById(req.user.id, 'email username profilePic role uiPreferences createdAt');
    if (!account) return res.status(404).json({ error: 'Account not found' });
    res.json({ user: {
        id: account._id.toString(),
        email: account.email,
        username: account.username,
        profilePic: account.profilePic || '',
        role: isAdminAccount(account) ? 'admin' : 'user',
        uiPreferences: sanitizeUiPreferences(account.uiPreferences || {}),
        createdAt: account.createdAt
    }});
});

// ─── Project Routes ───────────────────────────────────────────────────────────

// GET /api/projects — all projects the user owns or collaborates on
app.get('/api/projects', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;
        const projects = await Project.collection.find({
            $or: [{ owner: userId }, { 'collaborators.userId': userId }]
        }).sort({ priority: 1 }).toArray();

        const ownerIds = [...new Set(projects.map(p => String(p.owner || '')).filter(Boolean))];
        const accountMap = await buildAccountMap(ownerIds);
        const enriched = await Promise.all(projects.map(p => enrichProject(p, userId, accountMap)));
        res.json(enriched);
    } catch (err) {
        console.error('Error fetching projects:', err);
        res.status(500).json({ error: 'Failed to fetch projects', details: err?.message });
    }
});

// POST /api/projects — create a new project
app.post('/api/projects', authenticateToken, async (req, res) => {
    try {
        const { title, tasks, taskCategories, tags, dateCreated, priority, projectPriorityTag, projectPriority, priorityTag, dueDate, projectDueDate, deadline, completed, completedDate, completedBy, completedByName, notes, calendarNotes, projectCalendarNotes, description } = req.body;
        const sanitizedDescription = typeof description === 'string'
            ? description.trim().replace(/\s+/g, ' ').slice(0, 280)
            : String(description ?? '').trim().replace(/\s+/g, ' ').slice(0, 280);

        const project = await new Project({
            title:         title        || 'New Project',
            tasks:         Array.isArray(tasks) ? tasks.map((task, index) => sanitizeTask(task, index)) : [],
            taskCategories: Array.isArray(taskCategories) ? [...new Set(taskCategories.map(category => String(category || '').trim().replace(/\s+/g, ' ').slice(0, 32)).filter(Boolean))] : [],
            tags:          sanitizeProjectTags(tags),
            dateCreated:   dateCreated  || new Date().toISOString(),
            priority:      priority     ?? 0,
            projectPriorityTag: sanitizeProjectPriorityTag(projectPriorityTag ?? projectPriority ?? priorityTag),
            dueDate:       sanitizeDateKey(dueDate ?? projectDueDate ?? deadline),
            completed:     completed    || false,
            completedDate: completedDate || null,
            completedBy:   completed ? String(completedBy || req.user.id || '') : '',
            completedByName: completed ? String(completedByName || req.user.username || '') : '',
            notes:         getBestProjectNotesValue({ notes, projectNotes: req.body.projectNotes, projectNote: req.body.projectNote, notesData: req.body.notesData, noteTabs: req.body.noteTabs, noteTabsData: req.body.noteTabsData, note: req.body.note }),
            calendarNotes: sanitizeProjectCalendarNotes(calendarNotes ?? projectCalendarNotes),
            description:   sanitizedDescription,
            archived:      false,
            owner:         req.user.id,
            collaborators: [],
            activities:    [{ actorUserId: req.user.id, actorName: req.user.username, type: 'project_created', message: 'created the project', createdAt: new Date() }],
            lastModified:  new Date()
        }).save();

        const pObj = project.toObject();
        pObj.id        = project._id.toString();
        pObj.userRole  = 'owner';
        pObj.ownerName = req.user.username;
        pObj.ownerEmail = req.user.email;
        await emitProjectUpsert(project, req.user);
        await recordAnalyticsEvent(req, 'project_created', { projectId: project._id.toString(), projectTitle: project.title, taskCount: project.tasks.length });
        if (project.tasks.length) {
            await recordAnalyticsEvent(req, 'task_created', { projectId: project._id.toString(), projectTitle: project.title, count: project.tasks.length });
        }
        res.status(201).json(pObj);
    } catch (err) {
        console.error('Error creating project:', err);
        res.status(500).json({ error: 'Failed to create project', details: err?.message });
    }
});


// PUT /api/projects/:id — update (owner or editor)
app.put('/api/projects/:id', authenticateToken, requireRole('editor'), async (req, res) => {
    try {
        const allowed = ['title', 'tasks', 'taskCategories', 'tags', 'priority', 'projectPriorityTag', 'dueDate', 'completed', 'completedDate', 'completedBy', 'completedByName', 'notes', 'calendarNotes', 'description', 'archived'];
        const clientKnownLastModified = req.body.__clientKnownLastModified ? new Date(req.body.__clientKnownLastModified) : null;
        if (clientKnownLastModified && !Number.isNaN(clientKnownLastModified.getTime())) {
            const serverModified = new Date(req.project.lastModified || 0);
            if (serverModified.getTime() > clientKnownLastModified.getTime()) {
                return res.status(409).json({ error: 'This project was updated elsewhere. Refresh to load the newest version.', code: 'PROJECT_CONFLICT' });
            }
        }

        const incoming = sanitizeIncomingProjectUpdate(req.body || {});
        if (Array.isArray(incoming.tasks)) {
            const validAssigneeUserIds = new Set([
                String(req.project.owner || ''),
                ...(Array.isArray(req.project.collaborators)
                    ? req.project.collaborators.map(collaborator => String(collaborator?.userId || ''))
                    : [])
            ].filter(Boolean));
            incoming.tasks = incoming.tasks.map(task => {
                if (!task.assigneeUserId || validAssigneeUserIds.has(String(task.assigneeUserId))) return task;
                return { ...task, assigneeUserId: '', assigneeName: '', assigneeEmail: '', assigneeAssignedAt: '' };
            });
        }
        const rawCurrentProject = await Project.collection.findOne({ _id: req.project._id });
        const currentProject = {
            ...(req.project.toObject({ depopulate: true, versionKey: false }) || {}),
            ...(rawCurrentProject || {})
        };
        if (Array.isArray(incoming.tasks)) {
            incoming.tasks = mergeExistingTaskNotes(incoming.tasks, req.body?.tasks, currentProject.tasks || []);
        }
        if (Object.prototype.hasOwnProperty.call(incoming, 'notes')) {
            const existingNotes = getBestProjectNotesValue(currentProject);
            const incomingNotes = getBestProjectNotesValue({
                notes: incoming.notes,
                projectNotes: req.body?.projectNotes,
                projectNote: req.body?.projectNote,
                notesData: req.body?.notesData,
                noteTabs: req.body?.noteTabs,
                noteTabsData: req.body?.noteTabsData,
                note: req.body?.note
            });
            incoming.notes = incomingNotes;
            const changedNonNoteFields = Object.keys(incoming).filter(key => key !== 'notes' && projectFieldChanged(currentProject[key], incoming[key]));
            if (!projectNotesHaveContent(incomingNotes) && projectNotesHaveContent(existingNotes) && changedNonNoteFields.length > 0) {
                incoming.notes = existingNotes;
            }
        }
        const changedFields = {};
        allowed.forEach(key => {
            if (incoming[key] === undefined) return;
            if (projectFieldChanged(currentProject[key], incoming[key])) {
                changedFields[key] = incoming[key];
            }
        });

        const summary = summarizeProjectUpdate(currentProject, changedFields);
        if (Object.keys(changedFields).length > 0) {
            Object.assign(req.project, changedFields, { lastModified: new Date() });
            if (summary) appendProjectActivity(req.project, req.user, summary.type, summary.message);
            await req.project.save();
            await emitProjectUpsert(req.project, req.user);
            const analyticsEvents = deriveProjectAnalyticsEvents(currentProject, changedFields);
            await Promise.all(analyticsEvents.map(([eventName, metadata]) => recordAnalyticsEvent(req, eventName, metadata)));
        }
        const updated = req.project;

        const ownerMap = await buildAccountMap([updated.owner]);
        const enriched = await enrichProject(updated, req.user.id, ownerMap);
        res.json(enriched);
    } catch (err) {
        console.error('Error updating project:', err);
        res.status(500).json({ error: 'Failed to update project', details: err?.message });
    }
});

// PATCH /api/projects/priorities — batch priority update for reordering
app.patch('/api/projects/priorities', authenticateToken, async (req, res) => {
    try {
        const { priorities } = req.body; // [{_id, priority}]
        if (!Array.isArray(priorities)) return res.status(400).json({ error: 'priorities must be an array' });

        const requested = priorities
            .map(({ _id, priority }) => ({ _id, priority: Number(priority) }))
            .filter(item => item._id && Number.isFinite(item.priority));

        if (!requested.length) return res.json({ success: true, updated: 0 });

        const ids = requested.map(item => item._id);
        const projects = await Project.find({
            _id: { $in: ids },
            $or: [{ owner: req.user.id }, { 'collaborators.userId': req.user.id }]
        });

        const byId = new Map(projects.map(project => [project._id.toString(), project]));
        const now = new Date();
        const changedProjects = [];

        requested.forEach(({ _id, priority }) => {
            const project = byId.get(String(_id));
            if (!project || Number(project.priority) === priority) return;
            project.priority = priority;
            project.lastModified = now;
            changedProjects.push(project);
        });

        if (changedProjects.length) {
            await Promise.all(changedProjects.map(project => project.save()));
            await Promise.all(changedProjects.map(project => emitProjectUpsert(project, req.user)));
            await recordAnalyticsEvent(req, 'task_reordered', { source: 'project_card_reorder', count: changedProjects.length });
        }

        res.json({ success: true, updated: changedProjects.length });
    } catch (err) {
        console.error('Error reordering projects:', err);
        res.status(500).json({ error: 'Failed to reorder', details: err?.message });
    }
});

// DELETE /api/projects/:id — delete (owner only)
app.delete('/api/projects/:id', authenticateToken, requireRole('owner'), async (req, res) => {
    try {
        const deletedProject = req.project;
        await Project.findByIdAndDelete(req.params.id);
        emitProjectDelete(deletedProject, req.user);
        res.json({ success: true });
    } catch (err) {
        console.error('Error deleting project:', err);
        res.status(500).json({ error: 'Failed to delete project', details: err?.message });
    }
});

// ─── Sharing Routes ───────────────────────────────────────────────────────────

// POST /api/projects/:id/share — invite by email (owner only)
app.post('/api/projects/:id/share', authenticateToken, requireRole('owner'), async (req, res) => {
    try {
        const { email, role } = req.body;
        const normalizedEmail = String(email || '').trim().toLowerCase();
        if (!normalizedEmail || !['viewer', 'editor'].includes(role))
            return res.status(400).json({ error: 'Valid email and role (viewer/editor) are required' });

        if (normalizedEmail === String(req.user.email || '').trim().toLowerCase())
            return res.status(400).json({ error: 'You cannot share a project with yourself' });

        const project = req.project;
        const invitee = await Account.findOne({ email: normalizedEmail });

        if (!invitee) {
            const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 14);
            let pendingInvite = await PendingInvitation.findOne({
                projectId: project._id.toString(),
                email: normalizedEmail,
                acceptedAt: null
            });

            if (!pendingInvite) {
                pendingInvite = new PendingInvitation({
                    projectId: project._id.toString(),
                    email: normalizedEmail,
                    role,
                    invitedBy: req.user.id,
                    token: crypto.randomBytes(24).toString('hex'),
                    expiresAt
                });
            } else {
                pendingInvite.role = role;
                pendingInvite.invitedBy = req.user.id;
                pendingInvite.expiresAt = expiresAt;
            }
            await pendingInvite.save();

            const inviteUrl = buildAccountCreationInviteUrl({
                email: normalizedEmail,
                token: pendingInvite.token,
                req
            });
            const configError = getInvitationEmailConfigError();
            let emailSent = false;
            let emailDeliveryIssue = configError;

            if (!configError) {
                try {
                    await sendAccountCreationInviteEmail({
                        email: normalizedEmail,
                        project,
                        role,
                        token: pendingInvite.token,
                        inviter: req.user,
                        req
                    });
                    emailSent = true;
                    emailDeliveryIssue = '';
                } catch (mailErr) {
                    emailDeliveryIssue = mailErr?.message || 'Email delivery failed';
                    console.error('Failed to send account creation invite:', mailErr);
                }
            }

            project.lastModified = new Date();
            appendProjectActivity(
                project,
                req.user,
                'pending_invite_sent',
                emailSent
                    ? `sent an account creation invite to ${normalizedEmail} as ${role}`
                    : `created a pending invitation for ${normalizedEmail} as ${role}`
            );
            await project.save();
            await emitProjectUpsert(project, req.user);
            await recordAnalyticsEvent(req, 'member_added', {
                projectId: project._id.toString(),
                projectTitle: project.title,
                inviteType: emailSent ? 'pending_email' : 'pending_manual',
                role
            });

            const ownerMap = await buildAccountMap([project.owner]);
            const enriched = await enrichProject(project, req.user.id, ownerMap);
            enriched.pendingInvitationCreated = true;
            enriched.pendingInvitationEmailSent = emailSent;
            enriched.pendingInvitationManualInviteUrl = emailSent ? '' : inviteUrl;
            enriched.pendingInvitationEmailIssue = emailDeliveryIssue || '';
            enriched.pendingInvitationMessage = emailSent
                ? `No account exists for ${normalizedEmail}, so an account creation email was sent.`
                : `No account exists for ${normalizedEmail}. A pending invite was created. Ask them to create an account with this email address to accept the invite.`;
            return res.json(enriched);
        }

        if (invitee._id.toString() === req.user.id)
            return res.status(400).json({ error: 'You cannot share a project with yourself' });

        if (project.collaborators.find(c => c.userId === invitee._id.toString()))
            return res.status(409).json({ error: `${invitee.username} is already a collaborator` });

        project.collaborators.push({
            userId:   invitee._id.toString(),
            email:    invitee.email,
            username: invitee.username,
            role
        });
        project.lastModified = new Date();
        appendProjectActivity(project, req.user, 'project_shared', `shared “${project.title}” with ${invitee.username} as ${role}`);
        await project.save();
        await emitProjectUpsert(project, req.user);
        await recordAnalyticsEvent(req, 'member_added', { projectId: project._id.toString(), projectTitle: project.title, inviteType: 'existing_account', role });

        const ownerMap = await buildAccountMap([project.owner]);
        const enriched = await enrichProject(project, req.user.id, ownerMap);
        res.json(enriched);
    } catch (err) {
        console.error('Error sharing project:', err);
        res.status(500).json({ error: 'Failed to share project', details: err?.message });
    }
});

// PUT /api/projects/:id/collaborators/:userId — change role (owner only)
app.put('/api/projects/:id/collaborators/:userId', authenticateToken, requireRole('owner'), async (req, res) => {
    try {
        const { role } = req.body;
        if (!['viewer', 'editor'].includes(role))
            return res.status(400).json({ error: 'Role must be viewer or editor' });

        const collab = req.project.collaborators.find(c => c.userId === req.params.userId);
        if (!collab) return res.status(404).json({ error: 'Collaborator not found' });

        collab.role = role;
        req.project.lastModified = new Date();
        appendProjectActivity(req.project, req.user, 'role_changed', `changed ${collab.username}'s access to ${role}`);
        await req.project.save();
        await emitProjectUpsert(req.project, req.user);

        const ownerMap = await buildAccountMap([req.project.owner]);
        const enriched = await enrichProject(req.project, req.user.id, ownerMap);
        res.json(enriched);
    } catch (err) {
        console.error('Error updating collaborator:', err);
        res.status(500).json({ error: 'Failed to update collaborator', details: err?.message });
    }
});

// DELETE /api/projects/:id/collaborators/:userId — remove collaborator (owner only)

app.delete('/api/projects/:id/collaborators/:userId', authenticateToken, requireRole('owner'), async (req, res) => {
    try {
        const removedCollaborator = req.project.collaborators.find(c => c.userId === req.params.userId);
        req.project.collaborators = req.project.collaborators.filter(c => c.userId !== req.params.userId);
        req.project.lastModified = new Date();
        if (removedCollaborator) appendProjectActivity(req.project, req.user, 'access_removed', `removed ${removedCollaborator.username}'s access`);
        await req.project.save();
        if (removedCollaborator?.userId) emitProjectDelete(req.project, req.user, [removedCollaborator.userId]);
        await emitProjectUpsert(req.project, req.user);

        const ownerMap = await buildAccountMap([req.project.owner]);
        const enriched = await enrichProject(req.project, req.user.id, ownerMap);
        res.json(enriched);
    } catch (err) {
        console.error('Error removing collaborator:', err);
        res.status(500).json({ error: 'Failed to remove collaborator', details: err?.message });
    }
});




// ─── Account Routes ───────────────────────────────────────────────────────────

app.get('/api/account', authenticateToken, async (req, res) => {
    try {
        const [account, stats, ownedProjects, sharedProjects, activeProjects, leaderboardPayload] = await Promise.all([
            Account.findById(req.user.id, 'email username profilePic role uiPreferences createdAt'),
            getOrCreateStats(req.user.id),
            Project.countDocuments({ owner: req.user.id }),
            Project.countDocuments({ 'collaborators.userId': req.user.id, archived: false }),
            Project.countDocuments({
                $or: [{ owner: req.user.id }, { 'collaborators.userId': req.user.id }],
                completed: false,
                archived: false
            }),
            buildLeaderboardData(req.user.id)
        ]);

        if (!account) return res.status(404).json({ error: 'Account not found' });

        res.json({
            user: {
                id: account._id.toString(),
                email: account.email,
                username: account.username,
                profilePic: account.profilePic || '',
                role: isAdminAccount(account) ? 'admin' : 'user',
                uiPreferences: sanitizeUiPreferences(account.uiPreferences || {}),
                createdAt: account.createdAt
            },
            stats: {
                completedTasks: stats.completedTasks || 0,
                completedProjects: stats.completedProjects || 0,
                progression: sanitizeStatsProgression(stats.progression || {}),
                ownedProjects,
                sharedProjects,
                activeProjects
            },
            leaderboard: leaderboardPayload.leaderboard,
            leaderboardMode: leaderboardPayload.leaderboardMode,
            currentLeaderboardRank: leaderboardPayload.currentLeaderboardRank,
            currentLeaderboardEntry: leaderboardPayload.currentLeaderboardEntry
        });
    } catch (err) {
        console.error('Error fetching account:', err);
        res.status(500).json({ error: 'Failed to fetch account', details: err?.message });
    }
});

app.put('/api/account', authenticateToken, async (req, res) => {
    try {
        const updates = {};
        if (typeof req.body.username === 'string') {
            const username = req.body.username.trim();
            if (!username) return res.status(400).json({ error: 'User name is required' });
            if (username.length > 40) return res.status(400).json({ error: 'User name must be 40 characters or fewer' });
            updates.username = username;
        }

        if (req.body.profilePic !== undefined) {
            const profilePic = String(req.body.profilePic || '');
            if (profilePic.length > 1600000) {
                return res.status(400).json({ error: 'Profile picture is too large' });
            }
            updates.profilePic = profilePic;
        }

        if (req.body.uiPreferences !== undefined) {
            updates.uiPreferences = sanitizeUiPreferences(req.body.uiPreferences);
        }

        const account = await Account.findByIdAndUpdate(req.user.id, updates, { new: true, runValidators: true, select: 'email username profilePic role uiPreferences createdAt' });
        if (!account) return res.status(404).json({ error: 'Account not found' });

        if (updates.username) {
            await Project.updateMany(
                { 'collaborators.userId': req.user.id },
                { $set: { 'collaborators.$[collab].username': updates.username } },
                { arrayFilters: [{ 'collab.userId': req.user.id }] }
            );
        }

        const token = createAuthToken(account);

        res.json({
            token,
            user: formatAuthUser(account)
        });
    } catch (err) {
        console.error('Error updating account:', err);
        res.status(500).json({ error: 'Failed to update account', details: err?.message });
    }
});

// ─── Stats Routes ─────────────────────────────────────────────────────────────

function sanitizeStatsProgression(value = {}) {
    const source = value && typeof value === 'object' ? value : {};
    const sanitizeIdList = (value, limit = 100) => Array.isArray(value)
        ? [...new Set(value
            .map(id => String(id || '').trim().replace(/[^a-z0-9-]/gi, '').slice(0, 80))
            .filter(Boolean))]
            .slice(0, limit)
        : [];
    // Notification keys (read-state + competitive keys) are free-form strings that
    // legitimately contain colons, spaces and punctuation (e.g. "competitive:<id>:..."
    // or "<title>:<detail>:<time>"), so they get a more permissive sanitizer than IDs.
    const sanitizeKeyList = (value, limit = 500) => Array.isArray(value)
        ? [...new Set(value
            // strip control characters but otherwise preserve the key shape
            .map(key => String(key || '').replace(/[\u0000-\u001F\u007F]/g, '').trim().slice(0, 200))
            .filter(Boolean))]
            .slice(-limit)
        : [];
    const unlockedAchievementIds = sanitizeIdList(source.unlockedAchievementIds, 100);
    const numberField = (field, fallback = 0) => {
        const number = Number(source[field]);
        return Number.isFinite(number) ? Math.max(0, Math.round(number)) : fallback;
    };

    const competitiveSource = source.competitive && typeof source.competitive === 'object' ? source.competitive : {};
    return {
        unlockedAchievementIds,
        // Per-user notification state — must survive saves so notifications don't
        // re-appear as unread on every login / new device.
        notifiedAchievementIds: sanitizeIdList(source.notifiedAchievementIds, 200),
        notifiedLevel: Math.max(1, numberField('notifiedLevel', 1)),
        notifiedCompetitiveAchievementKeys: sanitizeKeyList(source.notifiedCompetitiveAchievementKeys, 400),
        readNotificationKeys: sanitizeKeyList(source.readNotificationKeys, 500),
        achievementPoints: numberField('achievementPoints'),
        projectPoints: numberField('projectPoints'),
        totalPoints: numberField('totalPoints'),
        lastLevel: Math.max(1, numberField('lastLevel', 1)),
        competitive: {
            currentWeekKey: String(competitiveSource.currentWeekKey || '').slice(0, 20),
            currentWeekRank: Number.isFinite(Number(competitiveSource.currentWeekRank)) ? Math.max(0, Math.round(Number(competitiveSource.currentWeekRank))) : 0,
            previousWeekRank: Number.isFinite(Number(competitiveSource.previousWeekRank)) ? Math.max(0, Math.round(Number(competitiveSource.previousWeekRank))) : 0,
            rankBeforePreviousWeek: Number.isFinite(Number(competitiveSource.rankBeforePreviousWeek)) ? Math.max(0, Math.round(Number(competitiveSource.rankBeforePreviousWeek))) : 0,
            lastRankOneDayKey: String(competitiveSource.lastRankOneDayKey || '').slice(0, 20),
            rankOneStreak: Number.isFinite(Number(competitiveSource.rankOneStreak)) ? Math.max(0, Math.round(Number(competitiveSource.rankOneStreak))) : 0
        },
        initialized: Boolean(source.initialized)
    };
}

function formatStatsPayload(stats = {}) {
    return {
        completedTasks: Number(stats.completedTasks || 0),
        completedProjects: Number(stats.completedProjects || 0),
        progression: sanitizeStatsProgression(stats.progression || {})
    };
}

async function getOrCreateStats(userId) {
    let s = await Stats.findOne({ userId });
    if (!s) s = await Stats.create({ userId, completedTasks: 0, completedProjects: 0, progression: {} });
    return s;
}

const COMPETITIVE_ACHIEVEMENTS = {
    efficiencyLead: { id: 'efficiency-lead', name: 'Efficiency Lead', description: 'Have the highest completion percentage among users with 3+ projects.' },
    closer: { id: 'closer', name: 'Closer', description: 'Complete the final task in 5 different shared projects.' },
    teamCarry: { id: 'team-carry', name: 'Team Carry', description: 'Complete 50%+ of tasks in a shared project.' },
    domination: { id: 'domination', name: 'Domination', description: 'Hold #1 on the leaderboard for 7 consecutive days.' },
    taskHunter: { id: 'task-hunter', name: 'Task Hunter', description: 'Complete the most tasks in a single day among all users.' },
    projectHunter: { id: 'project-hunter', name: 'Project Hunter', description: 'Complete the most projects in a single day among all users.' },
    triumvirate: { id: 'triumvirate', name: 'Triumvirate', description: 'Finish a week in the top 3.' },
    risingStar: { id: 'rising-star', name: 'Rising Star', description: 'Move up 5 leaderboard positions or more in one week.' },
    weeklyTaskChampion: { id: 'weekly-task-champion', name: 'Weekly Task Champion', description: 'Complete the most tasks in a week.' },
    weeklyProjectChampion: { id: 'weekly-project-champion', name: 'Weekly Project Champion', description: 'Complete the most projects in a week.' },
    monthlyTaskChampion: { id: 'monthly-task-champion', name: 'Monthly Task Champion', description: 'Complete the most tasks in a month.' },
    monthlyProjectChampion: { id: 'monthly-project-champion', name: 'Monthly Project Champion', description: 'Complete the most projects in a month.' }
};

const LEADERBOARD_TIME_ZONE = process.env.LEADERBOARD_TIME_ZONE || 'America/New_York';
const LEADERBOARD_DATE_FORMATTER = new Intl.DateTimeFormat('en-US', {
    timeZone: LEADERBOARD_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
});
const LEADERBOARD_DATE_TIME_FORMATTER = new Intl.DateTimeFormat('en-US', {
    timeZone: LEADERBOARD_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    hourCycle: 'h23'
});

function extractLeaderboardDateParts(formatter, date) {
    return formatter.formatToParts(date).reduce((parts, part) => {
        if (part.type !== 'literal') parts[part.type] = part.value;
        return parts;
    }, {});
}

function getLeaderboardCalendarParts(date = new Date()) {
    const source = date instanceof Date ? date : new Date(date);
    const safeDate = Number.isNaN(source.getTime()) ? new Date() : source;
    const parts = extractLeaderboardDateParts(LEADERBOARD_DATE_FORMATTER, safeDate);
    return {
        year: Number(parts.year),
        month: Number(parts.month),
        day: Number(parts.day)
    };
}

function getLeaderboardDateTimeParts(date = new Date()) {
    const source = date instanceof Date ? date : new Date(date);
    const safeDate = Number.isNaN(source.getTime()) ? new Date() : source;
    const parts = extractLeaderboardDateParts(LEADERBOARD_DATE_TIME_FORMATTER, safeDate);
    return {
        year: Number(parts.year),
        month: Number(parts.month),
        day: Number(parts.day),
        hour: Number(parts.hour || 0) % 24,
        minute: Number(parts.minute || 0),
        second: Number(parts.second || 0)
    };
}

function leaderboardZonedDateTimeToUtc(year, month, day, hour = 0, minute = 0, second = 0) {
    const utcGuess = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
    const actual = getLeaderboardDateTimeParts(utcGuess);
    const targetUtc = Date.UTC(year, month - 1, day, hour, minute, second);
    const actualUtc = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute, actual.second);
    return new Date(utcGuess.getTime() + (targetUtc - actualUtc));
}

function startOfLocalDay(date = new Date()) {
    const parts = getLeaderboardCalendarParts(date);
    return leaderboardZonedDateTimeToUtc(parts.year, parts.month, parts.day);
}

function startOfLocalWeek(date = new Date()) {
    const parts = getLeaderboardCalendarParts(date);
    const calendarDate = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
    calendarDate.setUTCDate(calendarDate.getUTCDate() - calendarDate.getUTCDay());
    return leaderboardZonedDateTimeToUtc(calendarDate.getUTCFullYear(), calendarDate.getUTCMonth() + 1, calendarDate.getUTCDate());
}

function startOfLocalMonth(date = new Date()) {
    const parts = getLeaderboardCalendarParts(date);
    return leaderboardZonedDateTimeToUtc(parts.year, parts.month, 1);
}

function addLocalCalendarDays(date, days) {
    const parts = getLeaderboardCalendarParts(date);
    const calendarDate = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
    calendarDate.setUTCDate(calendarDate.getUTCDate() + Number(days || 0));
    return leaderboardZonedDateTimeToUtc(calendarDate.getUTCFullYear(), calendarDate.getUTCMonth() + 1, calendarDate.getUTCDate());
}

function addLocalCalendarMonths(date, months) {
    const parts = getLeaderboardCalendarParts(date);
    const calendarDate = new Date(Date.UTC(parts.year, parts.month - 1 + Number(months || 0), 1));
    return leaderboardZonedDateTimeToUtc(calendarDate.getUTCFullYear(), calendarDate.getUTCMonth() + 1, 1);
}

function localDayKey(date = new Date()) {
    const parts = getLeaderboardCalendarParts(date);
    return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
}

function periodKey(prefix, date = new Date()) {
    if (prefix === 'week') return `${prefix}:${localDayKey(startOfLocalWeek(date))}`;
    if (prefix === 'month') {
        const parts = getLeaderboardCalendarParts(startOfLocalMonth(date));
        return `${prefix}:${parts.year}-${String(parts.month).padStart(2, '0')}`;
    }
    return `${prefix}:${localDayKey(date)}`;
}

function timestampInRange(value, start, end) {
    const parsed = new Date(value || '');
    if (Number.isNaN(parsed.getTime())) return false;
    const time = parsed.getTime();
    return time >= start.getTime() && time < end.getTime();
}

function getCreditedUserIdsForCompletedTask(task, participantIds, ownerId) {
    if (!isTaskCompleted(task)) return [];
    const completedBy = String(task.completedBy || '');
    if (completedBy && participantIds.includes(completedBy)) return [completedBy];
    return ownerId ? [ownerId] : [];
}

function makeCompetitiveAchievement(base, userId, unlockKey, achievedAt = new Date()) {
    const achievedDate = achievedAt instanceof Date ? achievedAt : new Date(achievedAt || Date.now());
    return {
        ...base,
        achievedAt: Number.isNaN(achievedDate.getTime()) ? new Date().toISOString() : achievedDate.toISOString(),
        notificationKey: `competitive:${userId}:${base.id}:${unlockKey}`
    };
}

async function updateCompetitiveRankHistory(leaderboard, statsByUserId, weekKey, todayKey, previousDayKey) {
    const updates = [];

    leaderboard.forEach(row => {
        const stats = statsByUserId.get(row.userId);
        if (!stats) return;
        const progression = sanitizeStatsProgression(stats.progression || {});
        const competitive = progression.competitive || {};
        const nextCompetitive = { ...competitive };

        if (competitive.currentWeekKey !== weekKey) {
            nextCompetitive.rankBeforePreviousWeek = Number(competitive.previousWeekRank || 0) || 0;
            nextCompetitive.previousWeekRank = Number(competitive.currentWeekRank || 0) || 0;
            nextCompetitive.currentWeekKey = weekKey;
        }
        nextCompetitive.currentWeekRank = row.rank;

        if (row.rank === 1 && competitive.lastRankOneDayKey !== todayKey) {
            nextCompetitive.rankOneStreak = competitive.lastRankOneDayKey === previousDayKey
                ? (Number(competitive.rankOneStreak || 0) + 1)
                : 1;
            nextCompetitive.lastRankOneDayKey = todayKey;
        }

        const nextProgression = { ...progression, competitive: nextCompetitive };
        stats.progression = nextProgression;
        row.playerLevel = Math.max(1, Number(nextProgression.lastLevel || row.playerLevel || 1));
        row.previousWeekRank = nextCompetitive.previousWeekRank || 0;
        row.rankBeforePreviousWeek = nextCompetitive.rankBeforePreviousWeek || 0;
        row.currentWeekRank = nextCompetitive.currentWeekRank || row.rank;
        row.rankOneStreak = nextCompetitive.rankOneStreak || 0;
        updates.push(stats.save().catch(err => console.error('Failed to update competitive rank history:', err)));
    });

    await Promise.all(updates);
}

function normalizeLeaderboardMode(mode = 'weekly') {
    const normalized = String(mode || '').trim().toLowerCase();
    return ['weekly', 'monthly', 'all'].includes(normalized) ? normalized : 'weekly';
}

function getLeaderboardModeScore(row = {}, mode = 'weekly') {
    switch (normalizeLeaderboardMode(mode)) {
        case 'monthly':
            return Math.max(0, Math.round(Number(row.monthlyCompletedTasks || 0) || 0));
        case 'all':
            return Math.max(0, Math.round(Number(row.allTimeCompletedTasks ?? row.completedTasks ?? 0) || 0));
        case 'weekly':
        default:
            return Math.max(0, Math.round(Number(row.weeklyCompletedTasks || 0) || 0));
    }
}

function buildLeaderboardScoreBreakdown(row = {}) {
    return {
        weeklyCompletedTasks: Math.max(0, Math.round(Number(row.weeklyCompletedTasks || 0) || 0)),
        monthlyCompletedTasks: Math.max(0, Math.round(Number(row.monthlyCompletedTasks || 0) || 0)),
        allTimeCompletedTasks: Math.max(0, Math.round(Number(row.allTimeCompletedTasks ?? row.completedTasks ?? 0) || 0))
    };
}

function rankLeaderboardRows(rows = [], mode = 'weekly') {
    const leaderboardMode = normalizeLeaderboardMode(mode);
    const modeProjectField = leaderboardMode === 'monthly'
        ? 'monthlyCompletedProjects'
        : (leaderboardMode === 'all' ? 'allTimeCompletedProjects' : 'weeklyCompletedProjects');
    return rows.map(row => ({
        ...row,
        leaderboardMode,
        leaderboardScore: getLeaderboardModeScore(row, leaderboardMode),
        scoreBreakdown: buildLeaderboardScoreBreakdown(row)
    })).sort((a, b) => {
        return (b.leaderboardScore - a.leaderboardScore)
            || (Number(b[modeProjectField] || 0) - Number(a[modeProjectField] || 0))
            || (Number(b.allTimeCompletedTasks || 0) - Number(a.allTimeCompletedTasks || 0))
            || (Number(b.allTimeCompletedProjects || 0) - Number(a.allTimeCompletedProjects || 0))
            || (Number(b.totalCompletionPercentage || 0) - Number(a.totalCompletionPercentage || 0))
            || String(a.username || '').localeCompare(String(b.username || ''));
    }).map((row, index) => ({ ...row, rank: index + 1 }));
}

async function buildLeaderboardData(currentUserId, mode = 'weekly') {
    const leaderboardMode = normalizeLeaderboardMode(mode);
    const [accounts, projects, statsRecords] = await Promise.all([
        Account.find({}, 'username profilePic').lean(),
        Project.find({}, 'owner completed completedDate completedBy completedByName tasks collaborators archived').lean(),
        Stats.find({}).lean()
    ]);

    const statsByUserId = new Map(statsRecords.map(stats => [String(stats.userId || ''), stats]).filter(([userId]) => userId));
    const rows = new Map();
    accounts.forEach(account => {
        const userId = account?._id ? String(account._id) : '';
        if (!userId) return;
        const stats = statsByUserId.get(userId) || {};
        const progression = sanitizeStatsProgression(stats.progression || {});
        rows.set(userId, {
            userId,
            username: account.username || 'User',
            profilePic: account.profilePic || '',
            totalProjects: 0,
            activeProjects: 0,
            completedProjects: 0,
            completedTasks: 0,
            allTimeCompletedProjects: 0,
            allTimeCompletedTasks: 0,
            remainingTasks: 0,
            totalTasks: 0,
            sharedProjects: 0,
            sharedTasks: 0,
            sharedCompletedTasks: 0,
            sharedRemainingTasks: 0,
            activeProgressRaw: 0,
            totalCompletionPercentage: 0,
            projectCompletionPercentage: 0,
            activeProjectCompletionPercentage: 0,
            sharedCompletionPercentage: 0,
            dailyCompletedTasks: 0,
            previousDailyCompletedTasks: 0,
            weeklyCompletedTasks: 0,
            previousWeeklyCompletedTasks: 0,
            monthlyCompletedTasks: 0,
            previousMonthlyCompletedTasks: 0,
            dailyCompletedProjects: 0,
            previousDailyCompletedProjects: 0,
            weeklyCompletedProjects: 0,
            previousWeeklyCompletedProjects: 0,
            monthlyCompletedProjects: 0,
            previousMonthlyCompletedProjects: 0,
            finalSharedProjectClosures: 0,
            sharedCarryProjects: 0,
            playerLevel: Math.max(1, Number(progression.lastLevel || 1) || 1),
            previousWeekRank: Number(progression.competitive?.previousWeekRank || 0) || 0,
            rankBeforePreviousWeek: Number(progression.competitive?.rankBeforePreviousWeek || 0) || 0,
            rankOneStreak: Number(progression.competitive?.rankOneStreak || 0) || 0,
            leaderboardScore: 0,
            rank: null,
            competitiveAchievements: []
        });
    });

    const now = new Date();
    const dayStart = startOfLocalDay(now);
    const dayEnd = addLocalCalendarDays(dayStart, 1);
    const previousDayStart = addLocalCalendarDays(dayStart, -1);
    const previousDayEnd = dayStart;
    const weekStart = startOfLocalWeek(now);
    const weekEnd = addLocalCalendarDays(weekStart, 7);
    const previousWeekStart = addLocalCalendarDays(weekStart, -7);
    const previousWeekEnd = weekStart;
    const monthStart = startOfLocalMonth(now);
    const monthEnd = addLocalCalendarMonths(monthStart, 1);
    const previousMonthStart = addLocalCalendarMonths(monthStart, -1);
    const previousMonthEnd = monthStart;
    const todayKey = localDayKey(now);
    const previousDayKey = localDayKey(previousDayStart);
    const currentWeekKey = periodKey('week', now);
    const previousWeekKey = periodKey('week', previousWeekStart);
    const currentMonthKey = periodKey('month', now);
    const previousMonthKey = periodKey('month', previousMonthStart);

    projects.forEach(project => {
        const ownerId = String(project.owner || '');
        const collaborators = Array.isArray(project.collaborators) ? project.collaborators : [];
        const collaboratorIds = collaborators.map(collaborator => String(collaborator?.userId || '')).filter(Boolean);
        const participantIds = [...new Set([ownerId, ...collaboratorIds].filter(Boolean))];
        const isSharedProject = collaborators.length > 0;
        const tasks = Array.isArray(project.tasks) ? project.tasks : [];
        const completedTaskCount = tasks.filter(task => task && isTaskCompleted(task)).length;
        const remainingTaskCount = Math.max(0, tasks.length - completedTaskCount);
        const taskCompletionRate = tasks.length > 0 ? completedTaskCount / tasks.length : 0;
        const completedProject = !!project.completed;
        const archivedProject = !!project.archived;
        const projectCompletedBy = String(project.completedBy || ownerId || '');
        const latestCompletedTask = tasks
            .filter(task => isTaskCompleted(task) && task.completedDate)
            .sort((a, b) => new Date(b.completedDate || 0) - new Date(a.completedDate || 0))[0] || null;

        if (!archivedProject) {
            participantIds.forEach(participantId => {
                const row = rows.get(participantId);
                if (!row) return;

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

                if (completedProject && projectCompletedBy === participantId) {
                    row.allTimeCompletedProjects += 1;
                    if (timestampInRange(project.completedDate, dayStart, dayEnd)) row.dailyCompletedProjects += 1;
                    if (timestampInRange(project.completedDate, previousDayStart, previousDayEnd)) row.previousDailyCompletedProjects += 1;
                    if (timestampInRange(project.completedDate, weekStart, weekEnd)) row.weeklyCompletedProjects += 1;
                    if (timestampInRange(project.completedDate, previousWeekStart, previousWeekEnd)) row.previousWeeklyCompletedProjects += 1;
                    if (timestampInRange(project.completedDate, monthStart, monthEnd)) row.monthlyCompletedProjects += 1;
                    if (timestampInRange(project.completedDate, previousMonthStart, previousMonthEnd)) row.previousMonthlyCompletedProjects += 1;
                }

                if (isSharedProject) {
                    row.sharedProjects += 1;
                    row.sharedTasks += tasks.length;
                    row.sharedCompletedTasks += completedTaskCount;
                    row.sharedRemainingTasks += remainingTaskCount;
                    if (completedProject && latestCompletedTask && String(latestCompletedTask.completedBy || ownerId || '') === participantId) {
                        row.finalSharedProjectClosures += 1;
                    }
                    const creditedSharedTasks = tasks.filter(task => isTaskCompleted(task) && getCreditedUserIdsForCompletedTask(task, participantIds, ownerId).includes(participantId)).length;
                    if (tasks.length > 0 && creditedSharedTasks / tasks.length >= 0.5) row.sharedCarryProjects += 1;
                }
            });
        }

        tasks.forEach(task => {
            const creditedUserIds = getCreditedUserIdsForCompletedTask(task, participantIds, ownerId);
            creditedUserIds.forEach(userId => {
                const row = rows.get(userId);
                if (!row) return;
                row.allTimeCompletedTasks += 1;
                if (timestampInRange(task.completedDate, dayStart, dayEnd)) row.dailyCompletedTasks += 1;
                if (timestampInRange(task.completedDate, previousDayStart, previousDayEnd)) row.previousDailyCompletedTasks += 1;
                if (timestampInRange(task.completedDate, weekStart, weekEnd)) row.weeklyCompletedTasks += 1;
                if (timestampInRange(task.completedDate, previousWeekStart, previousWeekEnd)) row.previousWeeklyCompletedTasks += 1;
                if (timestampInRange(task.completedDate, monthStart, monthEnd)) row.monthlyCompletedTasks += 1;
                if (timestampInRange(task.completedDate, previousMonthStart, previousMonthEnd)) row.previousMonthlyCompletedTasks += 1;
            });
        });
    });

    const computedRows = Array.from(rows.values()).map(row => {
        const activeProjectCompletionPercentage = row.activeProjects > 0
            ? Math.round((row.activeProgressRaw / row.activeProjects) * 100)
            : 0;
        const boundedActiveProjectCompletionPercentage = row.activeProjects > 0 && row.activeProgressRaw < row.activeProjects
            ? Math.min(99, activeProjectCompletionPercentage)
            : activeProjectCompletionPercentage;
        return {
            ...row,
            totalCompletionPercentage: calculateTaskProgressPercentage(row.completedTasks, row.totalTasks),
            projectCompletionPercentage: row.totalProjects > 0 ? Math.round((row.completedProjects / row.totalProjects) * 100) : 0,
            activeProjectCompletionPercentage: boundedActiveProjectCompletionPercentage,
            sharedCompletionPercentage: calculateTaskProgressPercentage(row.sharedCompletedTasks, row.sharedTasks),
            scoreBreakdown: buildLeaderboardScoreBreakdown(row)
        };
    });

    const weeklyLeaderboard = rankLeaderboardRows(computedRows, 'weekly');
    const statsDocs = await Stats.find({ userId: { $in: weeklyLeaderboard.map(row => row.userId) } });
    const statsDocMap = new Map(statsDocs.map(stats => [String(stats.userId || ''), stats]));
    await updateCompetitiveRankHistory(weeklyLeaderboard, statsDocMap, currentWeekKey, todayKey, previousDayKey);
    const weeklyRankByUserId = new Map(weeklyLeaderboard.map(row => [String(row.userId || ''), row]));

    let leaderboard = rankLeaderboardRows(computedRows.map(row => {
        const weeklyRow = weeklyRankByUserId.get(String(row.userId || '')) || {};
        return {
            ...row,
            playerLevel: weeklyRow.playerLevel || row.playerLevel,
            previousWeekRank: weeklyRow.previousWeekRank || row.previousWeekRank,
            rankBeforePreviousWeek: weeklyRow.rankBeforePreviousWeek || row.rankBeforePreviousWeek,
            currentWeekRank: weeklyRow.currentWeekRank || weeklyRow.rank || row.currentWeekRank,
            rankOneStreak: weeklyRow.rankOneStreak || row.rankOneStreak
        };
    }), leaderboardMode);

    const maxFor = (field, filter = () => true) => Math.max(0, ...leaderboard.filter(filter).map(row => Number(row[field] || 0)));
    const maxEfficiency = maxFor('totalCompletionPercentage', row => row.totalProjects >= 3);
    const maxPreviousDailyTasks = maxFor('previousDailyCompletedTasks');
    const maxPreviousDailyProjects = maxFor('previousDailyCompletedProjects');
    const maxPreviousWeeklyTasks = maxFor('previousWeeklyCompletedTasks');
    const maxPreviousWeeklyProjects = maxFor('previousWeeklyCompletedProjects');
    const maxPreviousMonthlyTasks = maxFor('previousMonthlyCompletedTasks');
    const maxPreviousMonthlyProjects = maxFor('previousMonthlyCompletedProjects');
    const previousDayAwardAt = new Date(dayStart.getTime() - 1);
    const previousWeekAwardAt = new Date(weekStart.getTime() - 1);
    const previousMonthAwardAt = new Date(monthStart.getTime() - 1);

    leaderboard = leaderboard.map(row => {
        const achievements = [];
        const add = (base, key, achievedAt = now) => {
            const awardDate = achievedAt instanceof Date ? achievedAt : new Date(achievedAt || Date.now());
            if (Number.isNaN(awardDate.getTime()) || awardDate.getTime() > now.getTime()) return;
            achievements.push(makeCompetitiveAchievement(base, row.userId, key, awardDate));
        };
        if (row.totalProjects >= 3 && maxEfficiency > 0 && row.totalCompletionPercentage === maxEfficiency) add(COMPETITIVE_ACHIEVEMENTS.efficiencyLead, `all:${todayKey}`, now);
        if (row.finalSharedProjectClosures >= 5) add(COMPETITIVE_ACHIEVEMENTS.closer, `all:${row.finalSharedProjectClosures}`, now);
        if (row.sharedCarryProjects >= 1) add(COMPETITIVE_ACHIEVEMENTS.teamCarry, `all:${row.sharedCarryProjects}`, now);
        if (row.rankOneStreak >= 8) add(COMPETITIVE_ACHIEVEMENTS.domination, `streak:${row.rankOneStreak - 1}`, previousDayAwardAt);
        if (maxPreviousDailyTasks > 0 && row.previousDailyCompletedTasks === maxPreviousDailyTasks) add(COMPETITIVE_ACHIEVEMENTS.taskHunter, `day:${previousDayKey}`, previousDayAwardAt);
        if (maxPreviousDailyProjects > 0 && row.previousDailyCompletedProjects === maxPreviousDailyProjects) add(COMPETITIVE_ACHIEVEMENTS.projectHunter, `day:${previousDayKey}`, previousDayAwardAt);
        if (row.previousWeekRank > 0 && row.previousWeekRank <= 3) add(COMPETITIVE_ACHIEVEMENTS.triumvirate, previousWeekKey, previousWeekAwardAt);
        if (row.rankBeforePreviousWeek > 0 && row.previousWeekRank > 0 && row.rankBeforePreviousWeek - row.previousWeekRank >= 5) add(COMPETITIVE_ACHIEVEMENTS.risingStar, previousWeekKey, previousWeekAwardAt);
        if (maxPreviousWeeklyTasks > 0 && row.previousWeeklyCompletedTasks === maxPreviousWeeklyTasks) add(COMPETITIVE_ACHIEVEMENTS.weeklyTaskChampion, previousWeekKey, previousWeekAwardAt);
        if (maxPreviousWeeklyProjects > 0 && row.previousWeeklyCompletedProjects === maxPreviousWeeklyProjects) add(COMPETITIVE_ACHIEVEMENTS.weeklyProjectChampion, previousWeekKey, previousWeekAwardAt);
        if (maxPreviousMonthlyTasks > 0 && row.previousMonthlyCompletedTasks === maxPreviousMonthlyTasks) add(COMPETITIVE_ACHIEVEMENTS.monthlyTaskChampion, previousMonthKey, previousMonthAwardAt);
        if (maxPreviousMonthlyProjects > 0 && row.previousMonthlyCompletedProjects === maxPreviousMonthlyProjects) add(COMPETITIVE_ACHIEVEMENTS.monthlyProjectChampion, previousMonthKey, previousMonthAwardAt);
        return { ...row, competitiveAchievements: achievements };
    });

    const formattedLeaderboard = leaderboard.map(row => ({
        userId: row.userId,
        username: row.username,
        profilePic: row.profilePic || '',
        totalProjects: row.totalProjects,
        activeProjects: row.activeProjects,
        completedProjects: row.completedProjects,
        completedTasks: row.completedTasks,
        allTimeCompletedProjects: row.allTimeCompletedProjects,
        allTimeCompletedTasks: row.allTimeCompletedTasks,
        remainingTasks: row.remainingTasks,
        totalTasks: row.totalTasks,
        sharedProjects: row.sharedProjects,
        sharedTasks: row.sharedTasks,
        sharedCompletedTasks: row.sharedCompletedTasks,
        sharedRemainingTasks: row.sharedRemainingTasks,
        totalCompletionPercentage: row.totalCompletionPercentage,
        projectCompletionPercentage: row.projectCompletionPercentage,
        activeProjectCompletionPercentage: row.activeProjectCompletionPercentage,
        sharedCompletionPercentage: row.sharedCompletionPercentage,
        dailyCompletedTasks: row.dailyCompletedTasks,
        weeklyCompletedTasks: row.weeklyCompletedTasks,
        monthlyCompletedTasks: row.monthlyCompletedTasks,
        dailyCompletedProjects: row.dailyCompletedProjects,
        weeklyCompletedProjects: row.weeklyCompletedProjects,
        monthlyCompletedProjects: row.monthlyCompletedProjects,
        playerLevel: row.playerLevel,
        leaderboardMode: row.leaderboardMode || leaderboardMode,
        leaderboardScore: row.leaderboardScore,
        scoreBreakdown: row.scoreBreakdown,
        competitiveAchievements: row.competitiveAchievements,
        rank: row.rank
    }));

    const currentUserKey = String(currentUserId || '');
    const currentUserEntry = formattedLeaderboard.find(row => row.userId === currentUserKey) || null;
    return {
        leaderboard: formattedLeaderboard.slice(0, 10),
        leaderboardMode,
        currentLeaderboardRank: currentUserEntry?.rank || null,
        currentLeaderboardEntry: currentUserEntry
    };
}

app.get('/api/leaderboard', authenticateToken, async (req, res) => {
    try {
        const leaderboardPayload = await buildLeaderboardData(req.user.id, req.query?.mode);
        res.json(leaderboardPayload);
    } catch (err) {
        console.error('Error fetching leaderboard:', err);
        res.status(500).json({ error: 'Failed to fetch leaderboard', details: err?.message });
    }
});

app.get('/api/stats', authenticateToken, async (req, res) => {
    try {
        const s = await getOrCreateStats(req.user.id);
        res.json(formatStatsPayload(s));
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch stats', details: err?.message });
    }
});

app.put('/api/stats', authenticateToken, async (req, res) => {
    try {
        const completedTasks = Math.max(0, Number(req.body.completedTasks || 0) || 0);
        const completedProjects = Math.max(0, Number(req.body.completedProjects || 0) || 0);
        const updates = { completedTasks, completedProjects };
        if (req.body.progression !== undefined) {
            updates.progression = sanitizeStatsProgression(req.body.progression);
        }
        const stats = await Stats.findOneAndUpdate(
            { userId: req.user.id },
            updates,
            { upsert: true, new: true }
        );
        res.json(formatStatsPayload(stats));
    } catch (err) {
        res.status(500).json({ error: 'Failed to update stats', details: err?.message });
    }
});


// ─── Analytics Routes ───────────────────────────────────────────────────────

app.post('/api/analytics/events', authenticateToken, async (req, res) => {
    const event = sanitizeAnalyticsText(req.body?.event, 80);
    if (!ANALYTICS_EVENT_NAMES.has(event)) {
        return res.status(400).json({ error: 'Unsupported analytics event' });
    }
    await recordAnalyticsEvent(req, event, req.body?.metadata || {}, req.body?.device || {});
    res.status(202).json({ success: true });
});

function getAnalyticsRange(query = {}) {
    const range = String(query.range || '30d').toLowerCase();
    const days = range === '7d' ? 7 : range === '90d' ? 90 : range === 'all' ? 3650 : 30;
    const end = new Date();
    const start = new Date(end);
    start.setDate(start.getDate() - days + 1);
    start.setHours(0, 0, 0, 0);
    return { range, days, start, end };
}

function getDateKey(dateValue = new Date()) {
    const date = new Date(dateValue);
    if (Number.isNaN(date.getTime())) return new Date().toISOString().slice(0, 10);
    return date.toISOString().slice(0, 10);
}

function buildEmptyDailySeries(start, end, keys = []) {
    const cursor = new Date(start);
    cursor.setHours(0, 0, 0, 0);
    const stop = new Date(end);
    stop.setHours(0, 0, 0, 0);
    const rows = [];
    while (cursor <= stop) {
        const row = { date: getDateKey(cursor) };
        keys.forEach(key => { row[key] = 0; });
        rows.push(row);
        cursor.setDate(cursor.getDate() + 1);
    }
    return rows;
}

async function buildEventDailySeries({ start, end, events = [], aliases = {} }) {
    const match = { timestamp: { $gte: start, $lte: end } };
    if (events.length) match.event = { $in: events };
    const rows = await AnalyticsEvent.aggregate([
        { $match: match },
        { $group: { _id: { date: { $dateToString: { format: '%Y-%m-%d', date: '$timestamp' } }, event: '$event' }, count: { $sum: 1 } } },
        { $sort: { '_id.date': 1 } }
    ]);
    const keys = [...new Set(events.map(event => aliases[event] || event))];
    const series = buildEmptyDailySeries(start, end, keys);
    const byDate = new Map(series.map(row => [row.date, row]));
    rows.forEach(row => {
        const key = aliases[row._id.event] || row._id.event;
        const target = byDate.get(row._id.date);
        if (target && key) target[key] = row.count || 0;
    });
    return series;
}

async function getActiveUserCountSince(start) {
    const rows = await AnalyticsEvent.distinct('userId', { timestamp: { $gte: start } });
    return rows.length;
}

async function getProjectTaskSnapshot() {
    const projects = await Project.find({}, 'completed archived tasks dateCreated lastModified collaborators owner').lean();
    const todayKey = getDateKey(new Date());
    let totalTasks = 0;
    let completedTasks = 0;
    let overdueTasks = 0;
    let activeProjects = 0;
    let completedProjects = 0;
    let archivedProjects = 0;
    let sharedProjects = 0;

    projects.forEach(project => {
        if (project.archived) archivedProjects += 1;
        else if (project.completed) completedProjects += 1;
        else activeProjects += 1;
        if (Array.isArray(project.collaborators) && project.collaborators.length) sharedProjects += 1;
        (project.tasks || []).forEach(task => {
            totalTasks += 1;
            if (task.completed) completedTasks += 1;
            const dueDate = String(task.dueDate || '').slice(0, 10);
            if (!task.completed && dueDate && dueDate < todayKey) overdueTasks += 1;
        });
    });

    return {
        totalProjects: projects.length,
        activeProjects,
        completedProjects,
        archivedProjects,
        sharedProjects,
        totalTasks,
        completedTasks,
        overdueTasks,
        completionRate: totalTasks ? Math.round((completedTasks / totalTasks) * 1000) / 10 : 0,
        avgTasksPerProject: projects.length ? Math.round((totalTasks / projects.length) * 10) / 10 : 0
    };
}


function getValidDateOrNull(value) {
    if (!value) return null;
    if (value instanceof Date && !Number.isNaN(value.getTime())) return new Date(value);
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
}

function getMongoDocumentTimestamp(doc = {}) {
    try {
        if (doc?._id?.getTimestamp) return doc._id.getTimestamp();
        const id = String(doc?._id || '');
        if (/^[a-f0-9]{24}$/i.test(id)) return new mongoose.Types.ObjectId(id).getTimestamp();
    } catch {}
    return null;
}

function pickHistoricalDate(...values) {
    for (const value of values) {
        const date = getValidDateOrNull(value);
        if (date) return date;
    }
    return null;
}

function normalizeHistoricalDate(date, fallback = new Date()) {
    const safeDate = getValidDateOrNull(date) || getValidDateOrNull(fallback) || new Date();
    return safeDate;
}

async function getEarliestHistoricalAnalyticsDate() {
    const dates = [];
    const [firstEvent, firstAccount, projects] = await Promise.all([
        AnalyticsEvent.findOne({}, 'timestamp').sort({ timestamp: 1 }).lean(),
        Account.findOne({}, 'createdAt').sort({ createdAt: 1 }).lean(),
        Project.find({}, 'dateCreated completedDate lastModified').lean()
    ]);

    [firstEvent?.timestamp, firstAccount?.createdAt].forEach(value => {
        const date = getValidDateOrNull(value);
        if (date) dates.push(date);
    });
    projects.forEach(project => {
        [project.dateCreated, project.completedDate, project.lastModified, getMongoDocumentTimestamp(project)].forEach(value => {
            const date = getValidDateOrNull(value);
            if (date) dates.push(date);
        });
    });

    if (!dates.length) return null;
    return new Date(Math.min(...dates.map(date => date.getTime())));
}

async function getResolvedAnalyticsRange(query = {}) {
    const base = getAnalyticsRange(query);
    if (base.range !== 'all') return base;

    const earliest = await getEarliestHistoricalAnalyticsDate();
    if (!earliest) return base;

    const start = new Date(earliest);
    start.setHours(0, 0, 0, 0);
    const end = base.end;
    const days = Math.max(1, Math.ceil((end.getTime() - start.getTime()) / 86400000) + 1);
    return { ...base, days, start, end };
}

function getAnalyticsLiveSourceMatch() {
    return { $or: [{ source: { $exists: false } }, { source: { $ne: 'historical_backfill' } }] };
}

function makeBackfillMetadata(metadata = {}) {
    return sanitizeAnalyticsMetadata({
        ...metadata,
        source: 'historical_backfill',
        backfilled: true
    });
}

function buildBackfillOperation({ event, userId, timestamp, metadata = {}, backfillKey, estimatedTimestamp = false }) {
    const safeEvent = sanitizeAnalyticsText(event, 80);
    const safeUserId = String(userId || '').trim();
    const safeKey = sanitizeAnalyticsText(backfillKey, 220);
    const safeTimestamp = getValidDateOrNull(timestamp);
    if (!ANALYTICS_EVENT_NAMES.has(safeEvent) || !safeUserId || !safeKey || !safeTimestamp) return null;

    return {
        updateOne: {
            filter: { backfillKey: safeKey },
            update: {
                $setOnInsert: {
                    userId: safeUserId,
                    event: safeEvent,
                    timestamp: safeTimestamp,
                    ingestedAt: new Date(),
                    source: 'historical_backfill',
                    backfillKey: safeKey,
                    metadata: makeBackfillMetadata({
                        ...metadata,
                        estimatedTimestamp: !!estimatedTimestamp
                    }),
                    device: {
                        viewportWidth: 0,
                        viewportHeight: 0,
                        screenWidth: 0,
                        screenHeight: 0,
                        browser: 'Historical',
                        os: 'Historical',
                        deviceType: 'historical'
                    }
                }
            },
            upsert: true
        }
    };
}

function getHistoricalProjectDate(project = {}) {
    return pickHistoricalDate(project.dateCreated, getMongoDocumentTimestamp(project), project.lastModified, new Date());
}

function getHistoricalProjectCompletedDate(project = {}) {
    return pickHistoricalDate(project.completedDate, project.lastModified, project.dateCreated, getMongoDocumentTimestamp(project));
}

function getHistoricalTaskCompletedDate(task = {}, project = {}) {
    return pickHistoricalDate(task.completedDate, project.completedDate, project.lastModified, project.dateCreated, getMongoDocumentTimestamp(project));
}

function getTaskBackfillId(task = {}, index = 0) {
    const rawId = task.id ?? task._id ?? index;
    return sanitizeAnalyticsText(rawId, 80) || String(index);
}

async function buildHistoricalAnalyticsBackfillOperations() {
    const [accounts, projects] = await Promise.all([
        Account.find({}, 'createdAt email username role').lean(),
        Project.find({}, 'title owner collaborators dateCreated lastModified completed completedDate completedBy completedByName archived tasks activities notes projectNotes projectNote notesData noteTabs noteTabsData note calendarNotes description').lean()
    ]);

    const operations = [];
    const summary = {
        users: 0,
        projectsCreated: 0,
        projectsCompleted: 0,
        projectsArchived: 0,
        tasksCreated: 0,
        tasksCompleted: 0,
        notesCreated: 0,
        membersAdded: 0,
        totalEligibleEvents: 0,
        estimatedTimestampEvents: 0
    };

    const queue = (payload) => {
        const op = buildBackfillOperation(payload);
        if (!op) return;
        operations.push(op);
        summary.totalEligibleEvents += 1;
        if (payload.estimatedTimestamp) summary.estimatedTimestampEvents += 1;
    };

    accounts.forEach(account => {
        const userId = String(account._id || '');
        const timestamp = pickHistoricalDate(account.createdAt, getMongoDocumentTimestamp(account));
        if (!userId || !timestamp) return;
        summary.users += 1;
        queue({
            event: 'user_registered',
            userId,
            timestamp,
            backfillKey: `account:${userId}:registered`,
            metadata: {
                accountId: userId,
                username: account.username || '',
                role: isAdminAccount(account) ? 'admin' : (account.role || 'user')
            }
        });
    });

    projects.forEach(project => {
        const projectId = String(project._id || '');
        const ownerId = String(project.owner || '').trim();
        if (!projectId || !ownerId) return;

        const projectCreatedAt = normalizeHistoricalDate(getHistoricalProjectDate(project));
        const projectMeta = {
            projectId,
            projectTitle: String(project.title || '').slice(0, 120)
        };

        summary.projectsCreated += 1;
        queue({
            event: 'project_created',
            userId: ownerId,
            timestamp: projectCreatedAt,
            backfillKey: `project:${projectId}:created`,
            metadata: {
                ...projectMeta,
                taskCount: Array.isArray(project.tasks) ? project.tasks.length : 0,
                collaboratorCount: Array.isArray(project.collaborators) ? project.collaborators.length : 0
            }
        });

        if (project.completed) {
            const completedAt = normalizeHistoricalDate(getHistoricalProjectCompletedDate(project), projectCreatedAt);
            const estimated = !getValidDateOrNull(project.completedDate);
            summary.projectsCompleted += 1;
            queue({
                event: 'project_completed',
                userId: String(project.completedBy || ownerId),
                timestamp: completedAt,
                backfillKey: `project:${projectId}:completed`,
                estimatedTimestamp: estimated,
                metadata: projectMeta
            });
        }

        if (project.archived) {
            summary.projectsArchived += 1;
            queue({
                event: 'project_archived',
                userId: ownerId,
                timestamp: normalizeHistoricalDate(project.lastModified, projectCreatedAt),
                backfillKey: `project:${projectId}:archived`,
                estimatedTimestamp: true,
                metadata: projectMeta
            });
        }

        if (projectNotesHaveContent(getBestProjectNotesValue(project))) {
            summary.notesCreated += 1;
            queue({
                event: 'note_created',
                userId: ownerId,
                timestamp: normalizeHistoricalDate(project.lastModified, projectCreatedAt),
                backfillKey: `project:${projectId}:note`,
                estimatedTimestamp: true,
                metadata: {
                    ...projectMeta,
                    sourceType: 'project_notes'
                }
            });
        }

        (project.collaborators || []).forEach((collaborator, index) => {
            if (!collaborator?.userId && !collaborator?.email) return;
            summary.membersAdded += 1;
            queue({
                event: 'member_added',
                userId: ownerId,
                timestamp: normalizeHistoricalDate(project.lastModified, projectCreatedAt),
                backfillKey: `project:${projectId}:member:${sanitizeAnalyticsText(collaborator.userId || collaborator.email, 100)}:${index}`,
                estimatedTimestamp: true,
                metadata: {
                    ...projectMeta,
                    memberUserId: collaborator.userId || '',
                    memberEmail: collaborator.email || '',
                    memberRole: collaborator.role || ''
                }
            });
        });

        (project.tasks || []).forEach((task, index) => {
            const taskKey = getTaskBackfillId(task, index);
            const taskMeta = {
                ...projectMeta,
                taskId: taskKey,
                taskTag: task.tag || '',
                taskCategory: task.category || ''
            };
            summary.tasksCreated += 1;
            queue({
                event: 'task_created',
                userId: ownerId,
                timestamp: projectCreatedAt,
                backfillKey: `project:${projectId}:task:${taskKey}:created:${index}`,
                estimatedTimestamp: true,
                metadata: taskMeta
            });

            if (task.completed) {
                const completedAt = normalizeHistoricalDate(getHistoricalTaskCompletedDate(task, project), projectCreatedAt);
                const estimated = !getValidDateOrNull(task.completedDate);
                summary.tasksCompleted += 1;
                queue({
                    event: 'task_completed',
                    userId: String(task.completedBy || project.completedBy || ownerId),
                    timestamp: completedAt,
                    backfillKey: `project:${projectId}:task:${taskKey}:completed:${index}`,
                    estimatedTimestamp: estimated,
                    metadata: taskMeta
                });
            }

            if (projectNotesHaveContent(task.note)) {
                summary.notesCreated += 1;
                queue({
                    event: 'note_created',
                    userId: ownerId,
                    timestamp: normalizeHistoricalDate(project.lastModified, projectCreatedAt),
                    backfillKey: `project:${projectId}:task:${taskKey}:note:${index}`,
                    estimatedTimestamp: true,
                    metadata: {
                        ...taskMeta,
                        sourceType: 'task_note'
                    }
                });
            }
        });

        (project.activities || []).forEach((activity, index) => {
            if (activity?.type !== 'project_shared' && activity?.type !== 'pending_invite_accepted') return;
            const timestamp = pickHistoricalDate(activity.createdAt, project.lastModified, projectCreatedAt);
            if (!timestamp) return;
            summary.membersAdded += 1;
            queue({
                event: 'member_added',
                userId: String(activity.actorUserId || ownerId),
                timestamp,
                backfillKey: `project:${projectId}:activity:${index}:${activity.type}`,
                metadata: {
                    ...projectMeta,
                    activityType: activity.type,
                    message: activity.message || ''
                }
            });
        });
    });

    return { operations, summary };
}

async function runHistoricalAnalyticsBackfill({ dryRun = false } = {}) {
    const { operations, summary } = await buildHistoricalAnalyticsBackfillOperations();
    if (dryRun || !operations.length) {
        return { ...summary, insertedEvents: 0, existingEvents: 0, dryRun: !!dryRun };
    }

    let insertedEvents = 0;
    let existingEvents = 0;
    const batchSize = 500;
    for (let i = 0; i < operations.length; i += batchSize) {
        const batch = operations.slice(i, i + batchSize);
        const result = await AnalyticsEvent.bulkWrite(batch, { ordered: false });
        insertedEvents += result.upsertedCount || 0;
        existingEvents += result.matchedCount || 0;
    }

    return {
        ...summary,
        insertedEvents,
        existingEvents,
        dryRun: false,
        completedAt: new Date().toISOString()
    };
}

async function getHistoricalBackfillStatus() {
    const [summary, byEvent, latest] = await Promise.all([
        AnalyticsEvent.aggregate([
            { $match: { source: 'historical_backfill' } },
            { $group: { _id: null, totalEvents: { $sum: 1 }, estimatedTimestampEvents: { $sum: { $cond: ['$metadata.estimatedTimestamp', 1, 0] } }, firstEventAt: { $min: '$timestamp' }, lastEventAt: { $max: '$timestamp' }, lastIngestedAt: { $max: '$ingestedAt' } } }
        ]),
        AnalyticsEvent.aggregate([
            { $match: { source: 'historical_backfill' } },
            { $group: { _id: '$event', count: { $sum: 1 } } },
            { $sort: { count: -1 } }
        ]),
        AnalyticsEvent.findOne({ source: 'historical_backfill' }, 'timestamp ingestedAt').sort({ ingestedAt: -1 }).lean()
    ]);
    const totals = summary[0] || {};
    return {
        totalEvents: totals.totalEvents || 0,
        estimatedTimestampEvents: totals.estimatedTimestampEvents || 0,
        firstEventAt: totals.firstEventAt || null,
        lastEventAt: totals.lastEventAt || null,
        lastIngestedAt: totals.lastIngestedAt || latest?.ingestedAt || null,
        byEvent: byEvent.map(row => ({ event: row._id, count: row.count }))
    };
}

async function getAnalyticsOverviewPayload(req) {
    const { range, start, end } = await getResolvedAnalyticsRange(req.query);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const weekStart = new Date();
    weekStart.setDate(weekStart.getDate() - 6);
    weekStart.setHours(0, 0, 0, 0);

    const [totalUsers, activeToday, activeThisWeek, snapshot, featureRows, deviceRows, recentErrors, backfill] = await Promise.all([
        Account.countDocuments({}),
        getActiveUserCountSince(today),
        getActiveUserCountSince(weekStart),
        getProjectTaskSnapshot(),
        AnalyticsEvent.aggregate([
            { $match: { timestamp: { $gte: start, $lte: end }, event: { $nin: ['api_request', 'api_error', 'client_error'] } } },
            { $group: { _id: '$event', count: { $sum: 1 } } },
            { $sort: { count: -1 } },
            { $limit: 12 }
        ]),
        AnalyticsEvent.aggregate([
            { $match: { timestamp: { $gte: start, $lte: end }, ...getAnalyticsLiveSourceMatch() } },
            { $group: { _id: { deviceType: '$device.deviceType', viewportWidth: '$device.viewportWidth', viewportHeight: '$device.viewportHeight', browser: '$device.browser', os: '$device.os' }, count: { $sum: 1 } } },
            { $sort: { count: -1 } },
            { $limit: 20 }
        ]),
        AnalyticsEvent.find({ event: { $in: ['client_error', 'api_error'] } }).sort({ timestamp: -1 }).limit(8).lean(),
        getHistoricalBackfillStatus()
    ]);

    const [tasksSeries, projectsSeries] = await Promise.all([
        buildEventDailySeries({ start, end, events: ['task_created', 'task_completed'], aliases: { task_created: 'created', task_completed: 'completed' } }),
        buildEventDailySeries({ start, end, events: ['project_created', 'project_completed'], aliases: { project_created: 'created', project_completed: 'completed' } })
    ]);

    return {
        range,
        rangeStart: start.toISOString(),
        rangeEnd: end.toISOString(),
        generatedAt: new Date().toISOString(),
        backfill,
        totals: {
            totalUsers,
            activeToday,
            activeThisWeek,
            ...snapshot
        },
        featureUsage: featureRows.map(row => ({ event: row._id, count: row.count })),
        devices: deviceRows.map(row => ({ ...row._id, count: row.count })),
        recentErrors: recentErrors.map(formatAnalyticsEvent),
        charts: { tasksSeries, projectsSeries }
    };
}

function formatAnalyticsEvent(event = {}) {
    return {
        id: String(event._id || ''),
        userId: event.userId || '',
        event: event.event || '',
        timestamp: event.timestamp,
        ingestedAt: event.ingestedAt || null,
        source: event.source || 'live',
        backfillKey: event.backfillKey || '',
        metadata: event.metadata || {},
        device: event.device || {}
    };
}

function serializeAnalyticsMetadata(metadata = {}) {
    try {
        return JSON.stringify(metadata || {});
    } catch {
        return '{}';
    }
}

function csvEscape(value = '') {
    if (value === null || value === undefined) return '';
    const text = value instanceof Date ? value.toISOString() : String(value);
    if (/[",\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
    return text;
}

function analyticsExportFilename(range = '30d', extension = 'csv') {
    const safeRange = String(range || '30d').replace(/[^a-z0-9_-]/gi, '-').slice(0, 24) || 'range';
    const stamp = new Date().toISOString().slice(0, 10);
    return `taskcom-analytics-events-${safeRange}-${stamp}.${extension}`;
}

async function getAnalyticsEventsForExport(req) {
    const { range, start, end } = await getResolvedAnalyticsRange(req.query);
    const events = await AnalyticsEvent.find({ timestamp: { $gte: start, $lte: end } })
        .sort({ timestamp: 1, _id: 1 })
        .lean();
    const userIds = [...new Set(events.map(event => String(event.userId || '')).filter(Boolean))];
    const users = await Account.find({ _id: { $in: userIds.filter(id => /^[a-f0-9]{24}$/i.test(id)) } }, 'email username role').lean();
    const userMap = new Map(users.map(user => [String(user._id), user]));
    return { range, start, end, events, userMap };
}

function formatAnalyticsExportRow(event = {}, userMap = new Map()) {
    const metadata = event.metadata || {};
    const device = event.device || {};
    const user = userMap.get(String(event.userId || '')) || {};
    return {
        id: String(event._id || ''),
        timestamp: event.timestamp ? new Date(event.timestamp).toISOString() : '',
        ingestedAt: event.ingestedAt ? new Date(event.ingestedAt).toISOString() : '',
        event: event.event || '',
        userId: event.userId || '',
        username: user.username || '',
        userEmail: user.email || '',
        userRole: isAdminAccount(user) ? 'admin' : (user.role || ''),
        source: event.source || 'live',
        backfilled: event.source === 'historical_backfill' || metadata.backfilled === true ? 'true' : 'false',
        backfillKey: event.backfillKey || '',
        projectId: metadata.projectId || '',
        projectTitle: metadata.projectTitle || '',
        taskId: metadata.taskId || '',
        priority: metadata.priority || '',
        route: metadata.url || metadata.route || '',
        method: metadata.method || '',
        status: metadata.status ?? '',
        durationMs: metadata.durationMs ?? '',
        errorMessage: metadata.message || metadata.error || '',
        deviceType: device.deviceType || '',
        browser: device.browser || '',
        os: device.os || '',
        viewportWidth: device.viewportWidth ?? '',
        viewportHeight: device.viewportHeight ?? '',
        screenWidth: device.screenWidth ?? '',
        screenHeight: device.screenHeight ?? '',
        metadata: serializeAnalyticsMetadata(metadata)
    };
}

function buildAnalyticsEventsCsv(events = [], userMap = new Map()) {
    const headers = [
        'id', 'timestamp', 'ingestedAt', 'event', 'userId', 'username', 'userEmail', 'userRole',
        'source', 'backfilled', 'backfillKey', 'projectId', 'projectTitle', 'taskId', 'priority',
        'route', 'method', 'status', 'durationMs', 'errorMessage', 'deviceType', 'browser', 'os',
        'viewportWidth', 'viewportHeight', 'screenWidth', 'screenHeight', 'metadata'
    ];
    const lines = [headers.join(',')];
    events.forEach(event => {
        const row = formatAnalyticsExportRow(event, userMap);
        lines.push(headers.map(header => csvEscape(row[header])).join(','));
    });
    return lines.join('\n');
}

app.get('/api/admin/analytics/export/events.csv', authenticateToken, requireAdminAccount, async (req, res) => {
    try {
        const { range, events, userMap } = await getAnalyticsEventsForExport(req);
        const csv = buildAnalyticsEventsCsv(events, userMap);
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${analyticsExportFilename(range, 'csv')}"`);
        res.send(csv);
    } catch (err) {
        console.error('Analytics CSV export error:', err);
        res.status(500).json({ error: 'Failed to export analytics CSV', details: err?.message });
    }
});

app.get('/api/admin/analytics/export/events.json', authenticateToken, requireAdminAccount, async (req, res) => {
    try {
        const { range, start, end, events } = await getAnalyticsEventsForExport(req);
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${analyticsExportFilename(range, 'json')}"`);
        res.json({
            exportedAt: new Date().toISOString(),
            range,
            rangeStart: start.toISOString(),
            rangeEnd: end.toISOString(),
            collection: 'analytics_events',
            count: events.length,
            events: events.map(formatAnalyticsEvent)
        });
    } catch (err) {
        console.error('Analytics JSON export error:', err);
        res.status(500).json({ error: 'Failed to export analytics JSON', details: err?.message });
    }
});

app.get('/api/admin/analytics/overview', authenticateToken, requireAdminAccount, async (req, res) => {
    try {
        res.json(await getAnalyticsOverviewPayload(req));
    } catch (err) {
        console.error('Analytics overview error:', err);
        res.status(500).json({ error: 'Failed to load analytics overview', details: err?.message });
    }
});

app.get('/api/admin/analytics/users', authenticateToken, requireAdminAccount, async (req, res) => {
    try {
        const { start, end } = await getResolvedAnalyticsRange(req.query);
        const activity = await AnalyticsEvent.aggregate([
            { $match: { timestamp: { $gte: start, $lte: end } } },
            { $group: { _id: '$userId', events: { $sum: 1 }, lastActive: { $max: '$timestamp' } } },
            { $sort: { events: -1 } },
            { $limit: 25 }
        ]);
        const users = await Account.find({ _id: { $in: activity.map(row => row._id).filter(Boolean) } }, 'email username role createdAt').lean();
        const userMap = new Map(users.map(user => [String(user._id), user]));
        res.json({
            users: activity.map(row => {
                const account = userMap.get(String(row._id)) || {};
                return {
                    userId: String(row._id || ''),
                    username: account.username || 'Unknown user',
                    email: account.email || '',
                    role: isAdminAccount(account) ? 'admin' : (account.role || 'user'),
                    events: row.events || 0,
                    lastActive: row.lastActive || null,
                    createdAt: account.createdAt || null
                };
            })
        });
    } catch (err) {
        console.error('Analytics users error:', err);
        res.status(500).json({ error: 'Failed to load user analytics', details: err?.message });
    }
});

app.get('/api/admin/analytics/projects', authenticateToken, requireAdminAccount, async (req, res) => {
    try {
        const { start, end } = await getResolvedAnalyticsRange(req.query);
        const snapshot = await getProjectTaskSnapshot();
        const series = await buildEventDailySeries({ start, end, events: ['project_created', 'project_completed'], aliases: { project_created: 'created', project_completed: 'completed' } });
        res.json({ snapshot, series });
    } catch (err) {
        console.error('Analytics projects error:', err);
        res.status(500).json({ error: 'Failed to load project analytics', details: err?.message });
    }
});

app.get('/api/admin/analytics/tasks', authenticateToken, requireAdminAccount, async (req, res) => {
    try {
        const { start, end } = await getResolvedAnalyticsRange(req.query);
        const snapshot = await getProjectTaskSnapshot();
        const series = await buildEventDailySeries({ start, end, events: ['task_created', 'task_completed'], aliases: { task_created: 'created', task_completed: 'completed' } });
        res.json({ snapshot, series });
    } catch (err) {
        console.error('Analytics tasks error:', err);
        res.status(500).json({ error: 'Failed to load task analytics', details: err?.message });
    }
});

app.get('/api/admin/analytics/features', authenticateToken, requireAdminAccount, async (req, res) => {
    try {
        const { start, end } = await getResolvedAnalyticsRange(req.query);
        const rows = await AnalyticsEvent.aggregate([
            { $match: { timestamp: { $gte: start, $lte: end }, event: { $nin: ['api_request', 'api_error', 'client_error'] } } },
            { $group: { _id: '$event', count: { $sum: 1 }, uniqueUsers: { $addToSet: '$userId' } } },
            { $sort: { count: -1 } }
        ]);
        res.json({ features: rows.map(row => ({ event: row._id, count: row.count, uniqueUsers: row.uniqueUsers.length })) });
    } catch (err) {
        console.error('Analytics features error:', err);
        res.status(500).json({ error: 'Failed to load feature analytics', details: err?.message });
    }
});

app.get('/api/admin/analytics/devices', authenticateToken, requireAdminAccount, async (req, res) => {
    try {
        const { start, end } = await getResolvedAnalyticsRange(req.query);
        const rows = await AnalyticsEvent.aggregate([
            { $match: { timestamp: { $gte: start, $lte: end }, ...getAnalyticsLiveSourceMatch() } },
            { $group: { _id: { deviceType: '$device.deviceType', browser: '$device.browser', os: '$device.os', viewportWidth: '$device.viewportWidth', viewportHeight: '$device.viewportHeight' }, count: { $sum: 1 } } },
            { $sort: { count: -1 } },
            { $limit: 100 }
        ]);
        res.json({ devices: rows.map(row => ({ ...row._id, count: row.count })) });
    } catch (err) {
        console.error('Analytics devices error:', err);
        res.status(500).json({ error: 'Failed to load device analytics', details: err?.message });
    }
});

app.get('/api/admin/analytics/performance', authenticateToken, requireAdminAccount, async (req, res) => {
    try {
        const { start, end } = await getResolvedAnalyticsRange(req.query);
        const [summary] = await AnalyticsEvent.aggregate([
            { $match: { timestamp: { $gte: start, $lte: end }, event: 'api_request' } },
            { $group: { _id: null, requestCount: { $sum: 1 }, avgResponseTime: { $avg: '$metadata.durationMs' }, failedRequests: { $sum: { $cond: [{ $gte: ['$metadata.status', 400] }, 1, 0] } }, slowRequests: { $sum: { $cond: [{ $gte: ['$metadata.durationMs', 1000] }, 1, 0] } } } }
        ]);
        const slowRoutes = await AnalyticsEvent.aggregate([
            { $match: { timestamp: { $gte: start, $lte: end }, event: 'api_request' } },
            { $group: { _id: '$metadata.url', count: { $sum: 1 }, avgResponseTime: { $avg: '$metadata.durationMs' }, maxResponseTime: { $max: '$metadata.durationMs' }, failures: { $sum: { $cond: [{ $gte: ['$metadata.status', 400] }, 1, 0] } } } },
            { $sort: { avgResponseTime: -1 } },
            { $limit: 12 }
        ]);
        res.json({
            summary: {
                requestCount: summary?.requestCount || 0,
                avgResponseTime: Math.round(summary?.avgResponseTime || 0),
                failedRequests: summary?.failedRequests || 0,
                slowRequests: summary?.slowRequests || 0,
                errorRate: summary?.requestCount ? Math.round(((summary.failedRequests || 0) / summary.requestCount) * 1000) / 10 : 0
            },
            slowRoutes: slowRoutes.map(row => ({ route: row._id || 'unknown', count: row.count, avgResponseTime: Math.round(row.avgResponseTime || 0), maxResponseTime: Math.round(row.maxResponseTime || 0), failures: row.failures || 0 }))
        });
    } catch (err) {
        console.error('Analytics performance error:', err);
        res.status(500).json({ error: 'Failed to load performance analytics', details: err?.message });
    }
});

app.get('/api/admin/analytics/errors', authenticateToken, requireAdminAccount, async (req, res) => {
    try {
        const { start, end } = await getResolvedAnalyticsRange(req.query);
        const errors = await AnalyticsEvent.find({ timestamp: { $gte: start, $lte: end }, event: { $in: ['client_error', 'api_error'] } }).sort({ timestamp: -1 }).limit(100).lean();
        res.json({ errors: errors.map(formatAnalyticsEvent) });
    } catch (err) {
        console.error('Analytics errors error:', err);
        res.status(500).json({ error: 'Failed to load error analytics', details: err?.message });
    }
});


app.get('/api/admin/analytics/backfill/status', authenticateToken, requireAdminAccount, async (req, res) => {
    try {
        res.json({ backfill: await getHistoricalBackfillStatus() });
    } catch (err) {
        console.error('Analytics backfill status error:', err);
        res.status(500).json({ error: 'Failed to load analytics backfill status', details: err?.message });
    }
});

app.post('/api/admin/analytics/backfill', authenticateToken, requireAdminAccount, async (req, res) => {
    try {
        const dryRun = !!req.body?.dryRun;
        const result = await runHistoricalAnalyticsBackfill({ dryRun });
        res.json({ success: true, result, backfill: await getHistoricalBackfillStatus() });
    } catch (err) {
        console.error('Analytics backfill error:', err);
        res.status(500).json({ error: 'Failed to backfill analytics', details: err?.message });
    }
});

// ─── Health Check ─────────────────────────────────────────────────────────────

app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        mongodb: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
        timestamp: new Date().toISOString()
    });
});

// ─── Admin Frontend Routes ───────────────────────────────────────────────────

app.get('/admin/analytics', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'client', 'admin-analytics.html'));
});

// ─── Frontend Fallback ────────────────────────────────────────────────────────

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'client', 'index.html'));
});

server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Serving frontend from: ${path.join(__dirname, '..', 'client')}`);
});
