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
    passwordHash: { type: String, required: true },
    createdAt:    { type: Date, default: Date.now }
});
const Account = mongoose.model('Account', accountSchema);

const taskSchema = new mongoose.Schema({
    id:            Number,
    text:          String,
    completed:     Boolean,
    completedDate: String,
    completedBy:   { type: String, default: '' },
    completedByName: { type: String, default: '' },
    dueDate:       { type: String, default: '' },
    tag:           { type: String, enum: ['', 'critical', 'high', 'medium', 'low'], default: '' },
    category:      { type: String, default: '' },
    note:          { type: String, default: '' }
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
    notes:         { type: String, default: '' },
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

    const collab = project.collaborators.find(c => c.userId === userId);
    pObj.userRole  = project.owner === userId ? 'owner' : (collab?.role || 'viewer');
    pObj.ownerName = accountMap?.[project.owner]?.username || 'Unknown';
    pObj.ownerEmail = accountMap?.[project.owner]?.email || '';
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

async function sendAccountCreationInviteEmail({ email, project, role, token, inviter, req }) {
    const transporter = getMailTransporter();
    const appUrl = getPublicAppUrl(req);
    const inviteUrl = `${appUrl}/?invite=${encodeURIComponent(token)}&email=${encodeURIComponent(email)}`;
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
        completed: !!task?.completed,
        completedDate: task?.completedDate ? String(task.completedDate) : null,
        completedBy: task?.completedBy ? String(task.completedBy).slice(0, 80) : '',
        completedByName: task?.completedByName ? String(task.completedByName).trim().replace(/\s+/g, ' ').slice(0, 80) : '',
        dueDate: sanitizeDateKey(task?.dueDate || task?.due_date || task?.deadline || ''),
        tag,
        category,
        note: typeof task?.note === 'string' ? task.note.trim() : (typeof task?.notes === 'string' ? task.notes.trim() : '')
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
    if (body.notes !== undefined) sanitized.notes = typeof body.notes === 'string' ? body.notes : String(body.notes ?? '');
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
            username: account.username
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
        const account = await new Account({ email, username, passwordHash }).save();
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
    const account = await Account.findById(req.user.id, 'email username profilePic uiPreferences createdAt');
    if (!account) return res.status(404).json({ error: 'Account not found' });
    res.json({ user: {
        id: account._id.toString(),
        email: account.email,
        username: account.username,
        profilePic: account.profilePic || '',
        uiPreferences: sanitizeUiPreferences(account.uiPreferences || {}),
        createdAt: account.createdAt
    }});
});

// ─── Project Routes ───────────────────────────────────────────────────────────

// GET /api/projects — all projects the user owns or collaborates on
app.get('/api/projects', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;
        const projects = await Project.find({
            $or: [{ owner: userId }, { 'collaborators.userId': userId }]
        }).sort({ priority: 1 });

        const ownerIds = [...new Set(projects.map(p => p.owner))];
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

        if (!sanitizedDescription) {
            return res.status(400).json({ error: 'Project description is required.' });
        }

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
            notes:         notes        || '',
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
        const currentProject = req.project.toObject({ depopulate: true, versionKey: false });
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
            const configError = getInvitationEmailConfigError();
            if (configError) {
                return res.status(503).json({
                    error: 'No account found with that email, and the account creation email could not be sent.',
                    details: configError
                });
            }

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

            try {
                await sendAccountCreationInviteEmail({
                    email: normalizedEmail,
                    project,
                    role,
                    token: pendingInvite.token,
                    inviter: req.user,
                    req
                });
            } catch (mailErr) {
                console.error('Failed to send account creation invite:', mailErr);
                return res.status(502).json({
                    error: 'No account found with that email, and the account creation email could not be sent.',
                    details: mailErr?.message
                });
            }

            project.lastModified = new Date();
            appendProjectActivity(project, req.user, 'pending_invite_sent', `sent an account creation invite to ${normalizedEmail} as ${role}`);
            await project.save();
            await emitProjectUpsert(project, req.user);

            const ownerMap = await buildAccountMap([project.owner]);
            const enriched = await enrichProject(project, req.user.id, ownerMap);
            enriched.pendingInvitationEmailSent = true;
            enriched.pendingInvitationMessage = `No account exists for ${normalizedEmail}, so an account creation email was sent.`;
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
            Account.findById(req.user.id, 'email username profilePic uiPreferences createdAt'),
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

        const account = await Account.findByIdAndUpdate(req.user.id, updates, { new: true, runValidators: true, select: 'email username profilePic uiPreferences createdAt' });
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
    const unlockedAchievementIds = Array.isArray(source.unlockedAchievementIds)
        ? source.unlockedAchievementIds
            .map(id => String(id || '').trim().replace(/[^a-z0-9-]/gi, '').slice(0, 80))
            .filter(Boolean)
            .slice(0, 100)
        : [];
    const numberField = (field, fallback = 0) => {
        const number = Number(source[field]);
        return Number.isFinite(number) ? Math.max(0, Math.round(number)) : fallback;
    };

    const competitiveSource = source.competitive && typeof source.competitive === 'object' ? source.competitive : {};
    return {
        unlockedAchievementIds: [...new Set(unlockedAchievementIds)],
        achievementPoints: numberField('achievementPoints'),
        projectPoints: numberField('projectPoints'),
        totalPoints: numberField('totalPoints'),
        lastLevel: Math.max(1, numberField('lastLevel', 1)),
        competitive: {
            currentWeekKey: String(competitiveSource.currentWeekKey || '').slice(0, 20),
            currentWeekRank: Number.isFinite(Number(competitiveSource.currentWeekRank)) ? Math.max(0, Math.round(Number(competitiveSource.currentWeekRank))) : 0,
            previousWeekRank: Number.isFinite(Number(competitiveSource.previousWeekRank)) ? Math.max(0, Math.round(Number(competitiveSource.previousWeekRank))) : 0,
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

function startOfLocalDay(date = new Date()) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function startOfLocalWeek(date = new Date()) {
    const start = startOfLocalDay(date);
    const daysSinceMonday = (start.getDay() + 6) % 7;
    start.setDate(start.getDate() - daysSinceMonday);
    return start;
}

function startOfLocalMonth(date = new Date()) {
    return new Date(date.getFullYear(), date.getMonth(), 1);
}

function localDayKey(date = new Date()) {
    const d = date instanceof Date ? date : new Date(date);
    if (Number.isNaN(d.getTime())) return '';
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function periodKey(prefix, date = new Date()) {
    if (prefix === 'week') return `${prefix}:${localDayKey(startOfLocalWeek(date))}`;
    if (prefix === 'month') {
        const d = startOfLocalMonth(date);
        return `${prefix}:${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
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
    if (!task?.completed) return [];
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

async function updateCompetitiveRankHistory(leaderboard, statsByUserId, weekKey, todayKey) {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayKey = localDayKey(yesterday);
    const updates = [];

    leaderboard.forEach(row => {
        const stats = statsByUserId.get(row.userId);
        if (!stats) return;
        const progression = sanitizeStatsProgression(stats.progression || {});
        const competitive = progression.competitive || {};
        const nextCompetitive = { ...competitive };

        if (competitive.currentWeekKey !== weekKey) {
            nextCompetitive.previousWeekRank = Number(competitive.currentWeekRank || 0) || 0;
            nextCompetitive.currentWeekKey = weekKey;
        }
        nextCompetitive.currentWeekRank = row.rank;

        if (row.rank === 1 && competitive.lastRankOneDayKey !== todayKey) {
            nextCompetitive.rankOneStreak = competitive.lastRankOneDayKey === yesterdayKey
                ? (Number(competitive.rankOneStreak || 0) + 1)
                : 1;
            nextCompetitive.lastRankOneDayKey = todayKey;
        }

        const nextProgression = { ...progression, competitive: nextCompetitive };
        stats.progression = nextProgression;
        row.playerLevel = Math.max(1, Number(nextProgression.lastLevel || row.playerLevel || 1));
        row.previousWeekRank = nextCompetitive.previousWeekRank || 0;
        row.currentWeekRank = nextCompetitive.currentWeekRank || row.rank;
        row.rankOneStreak = nextCompetitive.rankOneStreak || 0;
        updates.push(stats.save().catch(err => console.error('Failed to update competitive rank history:', err)));
    });

    await Promise.all(updates);
}

async function buildLeaderboardData(currentUserId) {
    const [accounts, projects, statsRecords] = await Promise.all([
        Account.find({}, 'username profilePic').lean(),
        Project.find({ archived: false }, 'owner completed completedDate completedBy completedByName tasks collaborators').lean(),
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
            monthlyCompletedTasks: 0,
            dailyCompletedProjects: 0,
            weeklyCompletedProjects: 0,
            monthlyCompletedProjects: 0,
            finalSharedProjectClosures: 0,
            sharedCarryProjects: 0,
            playerLevel: Math.max(1, Number(progression.lastLevel || 1) || 1),
            previousWeekRank: Number(progression.competitive?.previousWeekRank || 0) || 0,
            rankOneStreak: Number(progression.competitive?.rankOneStreak || 0) || 0,
            leaderboardScore: 0,
            rank: null,
            competitiveAchievements: []
        });
    });

    const now = new Date();
    const dayStart = startOfLocalDay(now);
    const dayEnd = new Date(dayStart); dayEnd.setDate(dayEnd.getDate() + 1);
    const previousDayStart = new Date(dayStart); previousDayStart.setDate(previousDayStart.getDate() - 1);
    const previousDayEnd = new Date(dayStart);
    const weekStart = startOfLocalWeek(now);
    const weekEnd = new Date(weekStart); weekEnd.setDate(weekEnd.getDate() + 7);
    const monthStart = startOfLocalMonth(now);
    const monthEnd = new Date(monthStart); monthEnd.setMonth(monthEnd.getMonth() + 1);
    const todayKey = localDayKey(now);
    const previousDayKey = localDayKey(previousDayStart);
    const currentWeekKey = periodKey('week', now);
    const currentMonthKey = periodKey('month', now);

    projects.forEach(project => {
        const ownerId = String(project.owner || '');
        const collaborators = Array.isArray(project.collaborators) ? project.collaborators : [];
        const collaboratorIds = collaborators.map(collaborator => String(collaborator?.userId || '')).filter(Boolean);
        const participantIds = [...new Set([ownerId, ...collaboratorIds].filter(Boolean))];
        const isSharedProject = collaborators.length > 0;
        const tasks = Array.isArray(project.tasks) ? project.tasks : [];
        const completedTaskCount = tasks.filter(task => task && task.completed).length;
        const remainingTaskCount = Math.max(0, tasks.length - completedTaskCount);
        const taskCompletionRate = tasks.length > 0 ? completedTaskCount / tasks.length : 0;
        const completedProject = !!project.completed;
        const projectCompletedBy = String(project.completedBy || ownerId || '');
        const latestCompletedTask = tasks
            .filter(task => task?.completed && task.completedDate)
            .sort((a, b) => new Date(b.completedDate || 0) - new Date(a.completedDate || 0))[0] || null;

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
                if (timestampInRange(project.completedDate, dayStart, dayEnd)) row.dailyCompletedProjects += 1;
                if (timestampInRange(project.completedDate, weekStart, weekEnd)) row.weeklyCompletedProjects += 1;
                if (timestampInRange(project.completedDate, monthStart, monthEnd)) row.monthlyCompletedProjects += 1;
            }

            if (isSharedProject) {
                row.sharedProjects += 1;
                row.sharedTasks += tasks.length;
                row.sharedCompletedTasks += completedTaskCount;
                row.sharedRemainingTasks += remainingTaskCount;
                if (completedProject && latestCompletedTask && String(latestCompletedTask.completedBy || ownerId || '') === participantId) {
                    row.finalSharedProjectClosures += 1;
                }
                const creditedSharedTasks = tasks.filter(task => getCreditedUserIdsForCompletedTask(task, participantIds, ownerId).includes(participantId)).length;
                if (tasks.length > 0 && creditedSharedTasks / tasks.length >= 0.5) row.sharedCarryProjects += 1;
            }
        });

        tasks.forEach(task => {
            const creditedUserIds = getCreditedUserIdsForCompletedTask(task, participantIds, ownerId);
            creditedUserIds.forEach(userId => {
                const row = rows.get(userId);
                if (!row) return;
                if (timestampInRange(task.completedDate, dayStart, dayEnd)) row.dailyCompletedTasks += 1;
                if (timestampInRange(task.completedDate, previousDayStart, previousDayEnd)) row.previousDailyCompletedTasks += 1;
                if (timestampInRange(task.completedDate, weekStart, weekEnd)) row.weeklyCompletedTasks += 1;
                if (timestampInRange(task.completedDate, monthStart, monthEnd)) row.monthlyCompletedTasks += 1;
            });
        });
    });

    let leaderboard = Array.from(rows.values()).map(row => {
        const activeProjectCompletionPercentage = row.activeProjects > 0
            ? Math.round((row.activeProgressRaw / row.activeProjects) * 100)
            : 0;
        return {
            ...row,
            totalCompletionPercentage: row.totalTasks > 0 ? Math.round((row.completedTasks / row.totalTasks) * 100) : 0,
            projectCompletionPercentage: row.totalProjects > 0 ? Math.round((row.completedProjects / row.totalProjects) * 100) : 0,
            activeProjectCompletionPercentage,
            sharedCompletionPercentage: row.sharedTasks > 0 ? Math.round((row.sharedCompletedTasks / row.sharedTasks) * 100) : 0,
            leaderboardScore: Math.max(0, Math.round(row.weeklyCompletedTasks || 0)),
            scoreBreakdown: { weeklyCompletedTasks: Math.max(0, Math.round(row.weeklyCompletedTasks || 0)) }
        };
    }).sort((a, b) => {
        return (b.leaderboardScore - a.leaderboardScore)
            || (b.completedTasks - a.completedTasks)
            || (b.completedProjects - a.completedProjects)
            || (b.sharedCompletedTasks - a.sharedCompletedTasks)
            || (a.remainingTasks - b.remainingTasks)
            || String(a.username || '').localeCompare(String(b.username || ''));
    }).map((row, index) => ({ ...row, rank: index + 1 }));

    const statsDocs = await Stats.find({ userId: { $in: leaderboard.map(row => row.userId) } });
    const statsDocMap = new Map(statsDocs.map(stats => [String(stats.userId || ''), stats]));
    await updateCompetitiveRankHistory(leaderboard, statsDocMap, currentWeekKey, todayKey);

    const maxFor = (field, filter = () => true) => Math.max(0, ...leaderboard.filter(filter).map(row => Number(row[field] || 0)));
    const maxEfficiency = maxFor('totalCompletionPercentage', row => row.totalProjects >= 3);
    const maxPreviousDailyTasks = maxFor('previousDailyCompletedTasks');
    const maxDailyProjects = maxFor('dailyCompletedProjects');
    const maxWeeklyTasks = maxFor('weeklyCompletedTasks');
    const maxWeeklyProjects = maxFor('weeklyCompletedProjects');
    const maxMonthlyTasks = maxFor('monthlyCompletedTasks');
    const maxMonthlyProjects = maxFor('monthlyCompletedProjects');
    const dailyAwardAt = new Date(dayStart);
    const dayAwardAt = new Date(dayEnd.getTime() - 1);
    const weekAwardAt = new Date(weekEnd.getTime() - 1);
    const monthAwardAt = new Date(monthEnd.getTime() - 1);

    leaderboard = leaderboard.map(row => {
        const achievements = [];
        const add = (base, key, achievedAt = now) => achievements.push(makeCompetitiveAchievement(base, row.userId, key, achievedAt));
        if (row.totalProjects >= 3 && maxEfficiency > 0 && row.totalCompletionPercentage === maxEfficiency) add(COMPETITIVE_ACHIEVEMENTS.efficiencyLead, `all:${todayKey}`, now);
        if (row.finalSharedProjectClosures >= 5) add(COMPETITIVE_ACHIEVEMENTS.closer, `all:${row.finalSharedProjectClosures}`, now);
        if (row.sharedCarryProjects >= 1) add(COMPETITIVE_ACHIEVEMENTS.teamCarry, `all:${row.sharedCarryProjects}`, now);
        if (row.rankOneStreak >= 7) add(COMPETITIVE_ACHIEVEMENTS.domination, `streak:${row.rankOneStreak}`, dayAwardAt);
        if (maxPreviousDailyTasks > 0 && row.previousDailyCompletedTasks === maxPreviousDailyTasks) add(COMPETITIVE_ACHIEVEMENTS.taskHunter, `day:${previousDayKey}`, dailyAwardAt);
        if (maxDailyProjects > 0 && row.dailyCompletedProjects === maxDailyProjects) add(COMPETITIVE_ACHIEVEMENTS.projectHunter, `day:${todayKey}`, dayAwardAt);
        if (row.rank <= 3) add(COMPETITIVE_ACHIEVEMENTS.triumvirate, currentWeekKey, weekAwardAt);
        if (row.previousWeekRank > 0 && row.previousWeekRank - row.rank >= 5) add(COMPETITIVE_ACHIEVEMENTS.risingStar, currentWeekKey, weekAwardAt);
        if (maxWeeklyTasks > 0 && row.weeklyCompletedTasks === maxWeeklyTasks) add(COMPETITIVE_ACHIEVEMENTS.weeklyTaskChampion, currentWeekKey, weekAwardAt);
        if (maxWeeklyProjects > 0 && row.weeklyCompletedProjects === maxWeeklyProjects) add(COMPETITIVE_ACHIEVEMENTS.weeklyProjectChampion, currentWeekKey, weekAwardAt);
        if (maxMonthlyTasks > 0 && row.monthlyCompletedTasks === maxMonthlyTasks) add(COMPETITIVE_ACHIEVEMENTS.monthlyTaskChampion, currentMonthKey, monthAwardAt);
        if (maxMonthlyProjects > 0 && row.monthlyCompletedProjects === maxMonthlyProjects) add(COMPETITIVE_ACHIEVEMENTS.monthlyProjectChampion, currentMonthKey, monthAwardAt);
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
        leaderboardScore: row.leaderboardScore,
        scoreBreakdown: row.scoreBreakdown,
        competitiveAchievements: row.competitiveAchievements,
        rank: row.rank
    }));

    const currentUserKey = String(currentUserId || '');
    const currentUserEntry = formattedLeaderboard.find(row => row.userId === currentUserKey) || null;
    return {
        leaderboard: formattedLeaderboard.slice(0, 10),
        currentLeaderboardRank: currentUserEntry?.rank || null,
        currentLeaderboardEntry: currentUserEntry
    };
}

app.get('/api/leaderboard', authenticateToken, async (req, res) => {
    try {
        const leaderboardPayload = await buildLeaderboardData(req.user.id);
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

// ─── Health Check ─────────────────────────────────────────────────────────────

app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        mongodb: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
        timestamp: new Date().toISOString()
    });
});

// ─── Frontend Fallback ────────────────────────────────────────────────────────

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'client', 'index.html'));
});

server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Serving frontend from: ${path.join(__dirname, '..', 'client')}`);
});
