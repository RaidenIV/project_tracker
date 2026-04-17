const http = require('http');
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';
const JWT_EXPIRES_IN = '30d';

// ─── Middleware ───────────────────────────────────────────────────────────────

app.use(cors());
app.use(express.json({ limit: '6mb' }));
app.use(express.urlencoded({ extended: true, limit: '6mb' }));
app.use(express.static(path.join(__dirname, '..', 'client')));

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
    passwordHash: { type: String, required: true },
    createdAt:    { type: Date, default: Date.now }
});
const Account = mongoose.model('Account', accountSchema);

const taskSchema = new mongoose.Schema({
    id:            Number,
    text:          String,
    completed:     Boolean,
    completedDate: String
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
    completed:     { type: Boolean, default: false },
    completedDate: String,
    notes:         { type: String, default: '' },
    archived:      { type: Boolean, default: false },
    owner:         { type: String, required: true },   // Account._id as string
    collaborators: [collaboratorSchema],
    activities:    { type: [activitySchema], default: [] },
    lastModified:  { type: Date, default: Date.now }
});
const Project = mongoose.model('Project', projectSchema);

// Per-user cumulative stats (persist across project deletions)
const statsSchema = new mongoose.Schema({
    userId:            { type: String, required: true, unique: true },
    completedTasks:    { type: Number, default: 0 },
    completedProjects: { type: Number, default: 0 }
});
const Stats = mongoose.model('Stats', statsSchema);

const notificationSchema = new mongoose.Schema({
    userId:      { type: String, required: true, index: true },
    projectId:   { type: String, required: true },
    projectTitle:{ type: String, default: 'Project' },
    actorUserId: { type: String, required: true },
    actorName:   { type: String, required: true },
    type:        { type: String, default: 'project_updated' },
    message:     { type: String, required: true },
    read:        { type: Boolean, default: false },
    createdAt:   { type: Date, default: Date.now }
});
notificationSchema.index({ userId: 1, createdAt: -1 });
const Notification = mongoose.model('Notification', notificationSchema);

// ─── Auth Middleware ──────────────────────────────────────────────────────────

function authenticateToken(req, res, next) {
    const token = (req.headers['authorization'] || '').split(' ')[1];
    if (!token) return res.status(401).json({ error: 'No token provided' });
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

async function resolveActorForNotifications(actor) {
    if (!actor?.id) {
        return { id: actor?.id || '', username: actor?.username || 'Someone' };
    }
    const account = await Account.findById(actor.id, 'username');
    return {
        id: actor.id,
        username: account?.username || actor.username || 'Someone'
    };
}


function getProjectParticipantIds(project) {
    return Array.from(new Set([
        project.owner,
        ...(project.collaborators || []).map(c => c.userId)
    ].filter(Boolean)));
}

async function createProjectNotifications({ project, actor, type = 'project_updated', message, recipientIds }) {
    const freshActor = await resolveActorForNotifications(actor);
    const recipients = (recipientIds || getProjectParticipantIds(project))
        .filter(userId => userId && userId !== freshActor.id);

    if (!recipients.length || !message) return;

    await Notification.insertMany(recipients.map(userId => ({
        userId,
        projectId: project._id.toString(),
        projectTitle: project.title || 'Project',
        actorUserId: freshActor.id,
        actorName: freshActor.username || 'Someone',
        type,
        message,
        read: false,
        createdAt: new Date()
    })));
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

function summarizeProjectUpdate(existingProject, incomingBody) {
    const oldProject = existingProject.toObject ? existingProject.toObject() : existingProject;
    const update = incomingBody || {};

    if (typeof update.title === 'string' && update.title !== oldProject.title) {
        return { type: 'project_renamed', message: `renamed the project to “${update.title}”` };
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

    if (typeof update.notes === 'string' && update.notes !== (oldProject.notes || '')) {
        return { type: 'notes_updated', message: 'updated the project notes' };
    }

    const keys = Object.keys(update).filter(key => key !== 'priority');
    if (keys.length) {
        return { type: 'project_updated', message: 'updated the project' };
    }

    return null;
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

        const token = jwt.sign(
            { id: newUserId, email: account.email, username: account.username, profilePic: account.profilePic || '' },
            JWT_SECRET, { expiresIn: JWT_EXPIRES_IN }
        );
        res.status(201).json({ token, user: { id: newUserId, email: account.email, username: account.username, profilePic: account.profilePic || '' } });
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

        const token = jwt.sign(
            { id: account._id.toString(), email: account.email, username: account.username, profilePic: account.profilePic || '' },
            JWT_SECRET, { expiresIn: JWT_EXPIRES_IN }
        );
        res.json({ token, user: { id: account._id, email: account.email, username: account.username, profilePic: account.profilePic || '' } });
    } catch (err) {
        console.error('Login error:', err);
        res.status(500).json({ error: 'Login failed', details: err?.message });
    }
});

app.get('/api/auth/me', authenticateToken, async (req, res) => {
    const account = await Account.findById(req.user.id, 'email username profilePic createdAt');
    if (!account) return res.status(404).json({ error: 'Account not found' });
    res.json({ user: {
        id: account._id.toString(),
        email: account.email,
        username: account.username,
        profilePic: account.profilePic || '',
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
        const { title, tasks, dateCreated, priority, completed, completedDate, notes } = req.body;
        const project = await new Project({
            title:         title        || 'New Project',
            tasks:         tasks        || [],
            dateCreated:   dateCreated  || new Date().toISOString(),
            priority:      priority     ?? 0,
            completed:     completed    || false,
            completedDate: completedDate || null,
            notes:         notes        || '',
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
        res.status(201).json(pObj);
    } catch (err) {
        console.error('Error creating project:', err);
        res.status(500).json({ error: 'Failed to create project', details: err?.message });
    }
});


// PUT /api/projects/:id — update (owner or editor)
app.put('/api/projects/:id', authenticateToken, requireRole('editor'), async (req, res) => {
    try {
        const allowed = ['title', 'tasks', 'priority', 'completed', 'completedDate', 'notes', 'archived'];
        const clientKnownLastModified = req.body.__clientKnownLastModified ? new Date(req.body.__clientKnownLastModified) : null;
        if (clientKnownLastModified && !Number.isNaN(clientKnownLastModified.getTime())) {
            const serverModified = new Date(req.project.lastModified || 0);
            if (serverModified.getTime() > clientKnownLastModified.getTime()) {
                return res.status(409).json({ error: 'This project was updated elsewhere. Refresh to load the newest version.', code: 'PROJECT_CONFLICT' });
            }
        }

        const update = { lastModified: new Date() };
        allowed.forEach(k => { if (req.body[k] !== undefined) update[k] = req.body[k]; });

        const summary = summarizeProjectUpdate(req.project, req.body);
        Object.assign(req.project, update);
        if (summary) appendProjectActivity(req.project, req.user, summary.type, summary.message);
        await req.project.save();
        const updated = req.project;

        if (summary && updated.collaborators.length > 0) {
            await createProjectNotifications({
                project: updated,
                actor: req.user,
                type: summary.type,
                message: summary.message
            });
        }

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
        await Promise.all(priorities.map(({ _id, priority }) =>
            Project.findOneAndUpdate(
                { _id, $or: [{ owner: req.user.id }, { 'collaborators.userId': req.user.id }] },
                { priority }
            )
        ));
        res.json({ success: true });
    } catch (err) {
        console.error('Error reordering projects:', err);
        res.status(500).json({ error: 'Failed to reorder', details: err?.message });
    }
});

// DELETE /api/projects/:id — delete (owner only)
app.delete('/api/projects/:id', authenticateToken, requireRole('owner'), async (req, res) => {
    try {
        await Project.findByIdAndDelete(req.params.id);
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
        if (!email || !['viewer', 'editor'].includes(role))
            return res.status(400).json({ error: 'Valid email and role (viewer/editor) are required' });

        const invitee = await Account.findOne({ email: email.toLowerCase() });
        if (!invitee)
            return res.status(404).json({ error: 'No account found with that email' });
        if (invitee._id.toString() === req.user.id)
            return res.status(400).json({ error: 'You cannot share a project with yourself' });

        const project = req.project;
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

        await createProjectNotifications({
            project,
            actor: req.user,
            type: 'project_shared',
            message: `shared “${project.title}” with you as ${role}` ,
            recipientIds: [invitee._id.toString()]
        });

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

        await createProjectNotifications({
            project: req.project,
            actor: req.user,
            type: 'role_changed',
            message: `changed your access to “${req.project.title}” to ${role}` ,
            recipientIds: [collab.userId]
        });

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

        if (removedCollaborator) {
            await createProjectNotifications({
                project: req.project,
                actor: req.user,
                type: 'access_removed',
                message: `removed your access to “${req.project.title}”`,
                recipientIds: [removedCollaborator.userId]
            });
        }

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
        const [account, stats, ownedProjects, sharedProjects, activeProjects] = await Promise.all([
            Account.findById(req.user.id, 'email username profilePic createdAt'),
            getOrCreateStats(req.user.id),
            Project.countDocuments({ owner: req.user.id }),
            Project.countDocuments({ 'collaborators.userId': req.user.id, archived: false }),
            Project.countDocuments({
                $or: [{ owner: req.user.id }, { 'collaborators.userId': req.user.id }],
                completed: false,
                archived: false
            })
        ]);

        if (!account) return res.status(404).json({ error: 'Account not found' });

        res.json({
            user: {
                id: account._id.toString(),
                email: account.email,
                username: account.username,
                profilePic: account.profilePic || '',
                createdAt: account.createdAt
            },
            stats: {
                completedTasks: stats.completedTasks || 0,
                completedProjects: stats.completedProjects || 0,
                ownedProjects,
                sharedProjects,
                activeProjects
            }
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

        const account = await Account.findByIdAndUpdate(req.user.id, updates, { new: true, runValidators: true, select: 'email username profilePic createdAt' });
        if (!account) return res.status(404).json({ error: 'Account not found' });

        if (updates.username) {
            await Project.updateMany(
                { 'collaborators.userId': req.user.id },
                { $set: { 'collaborators.$[collab].username': updates.username } },
                { arrayFilters: [{ 'collab.userId': req.user.id }] }
            );
        }

        const token = jwt.sign(
            { id: account._id.toString(), email: account.email, username: account.username, profilePic: account.profilePic || '' },
            JWT_SECRET, { expiresIn: JWT_EXPIRES_IN }
        );

        res.json({
            token,
            user: {
                id: account._id.toString(),
                email: account.email,
                username: account.username,
                profilePic: account.profilePic || '',
                createdAt: account.createdAt
            }
        });
    } catch (err) {
        console.error('Error updating account:', err);
        res.status(500).json({ error: 'Failed to update account', details: err?.message });
    }
});

// ─── Notification Routes ─────────────────────────────────────────────────────


app.get('/api/notifications', authenticateToken, async (req, res) => {
    try {
        const limit = Math.min(Math.max(parseInt(req.query.limit || '25', 10), 1), 100);
        const [notifications, unreadCount] = await Promise.all([
            Notification.find({ userId: req.user.id }).sort({ createdAt: -1 }).limit(limit),
            Notification.countDocuments({ userId: req.user.id, read: false })
        ]);
        res.json({ notifications, unreadCount });
    } catch (err) {
        console.error('Error fetching notifications:', err);
        res.status(500).json({ error: 'Failed to fetch notifications', details: err?.message });
    }
});

app.post('/api/notifications/read-all', authenticateToken, async (req, res) => {
    try {
        await Notification.updateMany({ userId: req.user.id, read: false }, { $set: { read: true } });
        res.json({ success: true });
    } catch (err) {
        console.error('Error marking notifications read:', err);
        res.status(500).json({ error: 'Failed to mark notifications read', details: err?.message });
    }
});

app.post('/api/notifications/:notificationId/read', authenticateToken, async (req, res) => {
    try {
        const updated = await Notification.findOneAndUpdate(
            { _id: req.params.notificationId, userId: req.user.id },
            { $set: { read: true } },
            { new: true }
        );
        if (!updated) return res.status(404).json({ error: 'Notification not found' });
        res.json({ success: true, notification: updated });
    } catch (err) {
        console.error('Error marking notification read:', err);
        res.status(500).json({ error: 'Failed to mark notification read', details: err?.message });
    }
});

// ─── Stats Routes ─────────────────────────────────────────────────────────────

async function getOrCreateStats(userId) {
    let s = await Stats.findOne({ userId });
    if (!s) s = await Stats.create({ userId, completedTasks: 0, completedProjects: 0 });
    return s;
}

app.get('/api/stats', authenticateToken, async (req, res) => {
    try {
        const s = await getOrCreateStats(req.user.id);
        res.json({ completedTasks: s.completedTasks, completedProjects: s.completedProjects });
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch stats', details: err?.message });
    }
});

app.put('/api/stats', authenticateToken, async (req, res) => {
    try {
        const { completedTasks, completedProjects } = req.body;
        await Stats.findOneAndUpdate(
            { userId: req.user.id },
            { completedTasks, completedProjects },
            { upsert: true, new: true }
        );
        res.json({ success: true });
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

// Node's default maxHeaderSize is 8 KB, which trips a 431 when the browser
// sends large accumulated cookies. 32 KB covers real-world usage while staying
// well within safe limits.
const server = http.createServer({ maxHeaderSize: 32 * 1024 }, app);
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Serving frontend from: ${path.join(__dirname, '..', 'client')}`);
});
