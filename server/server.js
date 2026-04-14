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

// ─── MongoDB Connection ───────────────────────────────────────────────────────

mongoose.connect(process.env.MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
})
.then(() => console.log('✅ Connected to MongoDB'))
.catch((err) => console.error('❌ MongoDB connection error:', err));

// ─── Schemas & Models ─────────────────────────────────────────────────────────

const accountSchema = new mongoose.Schema({
    email: {
        type: String,
        required: true,
        unique: true,
        lowercase: true,
        trim: true
    },
    username: {
        type: String,
        required: true,
        trim: true
    },
    passwordHash: {
        type: String,
        required: true
    },
    createdAt: { type: Date, default: Date.now }
});

const Account = mongoose.model('Account', accountSchema);

const taskSchema = new mongoose.Schema({
    id: Number,
    text: String,
    completed: Boolean,
    completedDate: String
});

const projectSchema = new mongoose.Schema({
    id: Number,
    title: String,
    tasks: [taskSchema],
    dateCreated: String,
    priority: Number,
    completed: Boolean,
    completedDate: String,
    notes: { type: String, default: '' }
});

const statsSchema = new mongoose.Schema({
    completedTasks: { type: Number, default: 0 },
    completedProjects: { type: Number, default: 0 }
});

const userDataSchema = new mongoose.Schema({
    userId: { type: String, required: true, unique: true },
    projects: [projectSchema],
    stats: statsSchema,
    lastModified: { type: Date, default: Date.now }
});

const UserData = mongoose.model('UserData', userDataSchema);

// ─── Auth Middleware ──────────────────────────────────────────────────────────

function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Bearer <token>

    if (!token) {
        return res.status(401).json({ error: 'No token provided' });
    }

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded; // { id, email, username }
        next();
    } catch (err) {
        return res.status(401).json({ error: 'Invalid or expired token' });
    }
}

// ─── Auth Routes ─────────────────────────────────────────────────────────────

// Register
app.post('/api/auth/register', async (req, res) => {
    try {
        const { email, username, password } = req.body;

        if (!email || !username || !password) {
            return res.status(400).json({ error: 'Email, username, and password are required' });
        }

        if (password.length < 6) {
            return res.status(400).json({ error: 'Password must be at least 6 characters' });
        }

        const existing = await Account.findOne({ email: email.toLowerCase() });
        if (existing) {
            return res.status(409).json({ error: 'An account with that email already exists' });
        }

        const passwordHash = await bcrypt.hash(password, 12);
        const account = new Account({ email, username, passwordHash });
        await account.save();

        // Provision empty data doc for this user
        await UserData.create({
            userId: account._id.toString(),
            projects: [],
            stats: { completedTasks: 0, completedProjects: 0 }
        });

        const token = jwt.sign(
            { id: account._id.toString(), email: account.email, username: account.username },
            JWT_SECRET,
            { expiresIn: JWT_EXPIRES_IN }
        );

        res.status(201).json({
            token,
            user: { id: account._id, email: account.email, username: account.username }
        });
    } catch (error) {
        console.error('Register error:', error);
        res.status(500).json({ error: 'Registration failed', details: error?.message });
    }
});

// Login
app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password are required' });
        }

        const account = await Account.findOne({ email: email.toLowerCase() });
        if (!account) {
            return res.status(401).json({ error: 'Invalid email or password' });
        }

        const valid = await bcrypt.compare(password, account.passwordHash);
        if (!valid) {
            return res.status(401).json({ error: 'Invalid email or password' });
        }

        const token = jwt.sign(
            { id: account._id.toString(), email: account.email, username: account.username },
            JWT_SECRET,
            { expiresIn: JWT_EXPIRES_IN }
        );

        res.json({
            token,
            user: { id: account._id, email: account.email, username: account.username }
        });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Login failed', details: error?.message });
    }
});

// Verify token / get current user
app.get('/api/auth/me', authenticateToken, (req, res) => {
    res.json({ user: req.user });
});

// ─── Data Routes (all protected) ─────────────────────────────────────────────

// Helper: get or create the UserData doc for the logged-in user
async function getOrCreateUserData(userId) {
    let userData = await UserData.findOne({ userId });
    if (!userData) {
        userData = await UserData.create({
            userId,
            projects: [],
            stats: { completedTasks: 0, completedProjects: 0 }
        });
    }
    return userData;
}

// GET /api/data
app.get('/api/data', authenticateToken, async (req, res) => {
    try {
        const userData = await getOrCreateUserData(req.user.id);
        res.json({ projects: userData.projects, stats: userData.stats });
    } catch (error) {
        console.error('Error fetching data:', error);
        res.status(500).json({ error: 'Failed to fetch data', details: error?.message });
    }
});

// POST /api/data  (full replace — atomic upsert)
app.post('/api/data', authenticateToken, async (req, res) => {
    try {
        const { projects, stats } = req.body;

        if (!Array.isArray(projects) || typeof stats !== 'object' || stats === null) {
            return res.status(400).json({
                error: 'Invalid payload',
                details: 'Expected { projects: Array, stats: Object }'
            });
        }

        await UserData.findOneAndUpdate(
            { userId: req.user.id },
            { userId: req.user.id, projects, stats, lastModified: new Date() },
            { upsert: true, new: true, setDefaultsOnInsert: true }
        );

        res.json({ success: true, message: 'Data saved successfully' });
    } catch (error) {
        console.error('Error saving data:', error);
        res.status(500).json({ error: 'Failed to save data', details: error?.message });
    }
});

// PUT /api/projects
app.put('/api/projects', authenticateToken, async (req, res) => {
    try {
        const { projects } = req.body;
        const userData = await getOrCreateUserData(req.user.id);
        userData.projects = projects;
        userData.lastModified = new Date();
        await userData.save();
        res.json({ success: true, projects: userData.projects });
    } catch (error) {
        console.error('Error updating projects:', error);
        res.status(500).json({ error: 'Failed to update projects' });
    }
});

// PUT /api/stats
app.put('/api/stats', authenticateToken, async (req, res) => {
    try {
        const { stats } = req.body;
        const userData = await getOrCreateUserData(req.user.id);
        userData.stats = stats;
        userData.lastModified = new Date();
        await userData.save();
        res.json({ success: true, stats: userData.stats });
    } catch (error) {
        console.error('Error updating stats:', error);
        res.status(500).json({ error: 'Failed to update stats' });
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

// ─── Start ────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`📁 Serving frontend from: ${path.join(__dirname, '..', 'client')}`);
});
