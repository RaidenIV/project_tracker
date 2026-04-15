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
app.use(express.json());
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

const projectSchema = new mongoose.Schema({
    title:         { type: String, default: 'New Project' },
    tasks:         [taskSchema],
    dateCreated:   String,
    priority:      { type: Number, default: 0 },
    completed:     { type: Boolean, default: false },
    completedDate: String,
    notes:         { type: String, default: '' },
    owner:         { type: String, required: true },   // Account._id as string
    collaborators: [collaboratorSchema],
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
    const accounts = await Account.find({ _id: { $in: ownerIds } }, 'username email');
    return Object.fromEntries(accounts.map(a => [a._id.toString(), a]));
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
            { id: newUserId, email: account.email, username: account.username },
            JWT_SECRET, { expiresIn: JWT_EXPIRES_IN }
        );
        res.status(201).json({ token, user: { id: newUserId, email: account.email, username: account.username } });
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
            { id: account._id.toString(), email: account.email, username: account.username },
            JWT_SECRET, { expiresIn: JWT_EXPIRES_IN }
        );
        res.json({ token, user: { id: account._id, email: account.email, username: account.username } });
    } catch (err) {
        console.error('Login error:', err);
        res.status(500).json({ error: 'Login failed', details: err?.message });
    }
});

app.get('/api/auth/me', authenticateToken, (req, res) => res.json({ user: req.user }));

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
            owner:         req.user.id,
            collaborators: [],
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
        const allowed = ['title', 'tasks', 'priority', 'completed', 'completedDate', 'notes'];
        const update = { lastModified: new Date() };
        allowed.forEach(k => { if (req.body[k] !== undefined) update[k] = req.body[k]; });

        const updated = await Project.findByIdAndUpdate(req.params.id, update, { new: true });
        const pObj = updated.toObject();
        pObj.id       = updated._id.toString();
        pObj.userRole = req.userRole;
        res.json(pObj);
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
        await project.save();

        const pObj = project.toObject();
        pObj.id       = project._id.toString();
        pObj.userRole = 'owner';
        res.json(pObj);
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
        await req.project.save();

        const pObj = req.project.toObject();
        pObj.id       = req.project._id.toString();
        pObj.userRole = 'owner';
        res.json(pObj);
    } catch (err) {
        console.error('Error updating collaborator:', err);
        res.status(500).json({ error: 'Failed to update collaborator', details: err?.message });
    }
});

// DELETE /api/projects/:id/collaborators/:userId — remove collaborator (owner only)
app.delete('/api/projects/:id/collaborators/:userId', authenticateToken, requireRole('owner'), async (req, res) => {
    try {
        req.project.collaborators = req.project.collaborators.filter(c => c.userId !== req.params.userId);
        req.project.lastModified = new Date();
        await req.project.save();

        const pObj = req.project.toObject();
        pObj.id       = req.project._id.toString();
        pObj.userRole = 'owner';
        res.json(pObj);
    } catch (err) {
        console.error('Error removing collaborator:', err);
        res.status(500).json({ error: 'Failed to remove collaborator', details: err?.message });
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

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Serving frontend from: ${path.join(__dirname, '..', 'client')}`);
});
