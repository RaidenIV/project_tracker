const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'client')));

// MongoDB Connection
mongoose.connect(process.env.MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
})
.then(() => console.log('✅ Connected to MongoDB'))
.catch((err) => console.error('❌ MongoDB connection error:', err));

// MongoDB Schemas
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
    userId: { type: String, required: true, unique: true, default: 'default' },
    projects: [projectSchema],
    stats: statsSchema,
    lastModified: { type: Date, default: Date.now }
});

const UserData = mongoose.model('UserData', userDataSchema);

// API Routes

// Get all data (public)
app.get('/api/data', async (req, res) => {
    try {
        let userData = await UserData.findOne({ userId: 'default' });

        if (!userData) {
            userData = new UserData({
                userId: 'default',
                projects: [],
                stats: { completedTasks: 0, completedProjects: 0 }
            });
            await userData.save();
        }

        res.json({
            projects: userData.projects,
            stats: userData.stats
        });
    } catch (error) {
        console.error('Error fetching data:', error);
        res.status(500).json({ error: 'Failed to fetch data', details: error?.message || String(error) });
    }
});

// Save all data (public)
app.post('/api/data', async (req, res) => {
    try {
        const { projects, stats } = req.body;

        if (!Array.isArray(projects) || typeof stats !== 'object' || stats === null) {
            return res.status(400).json({
                error: 'Invalid payload',
                details: 'Expected { projects: Array, stats: Object }'
            });
        }

        const update = {
            userId: 'default',
            projects,
            stats,
            lastModified: new Date()
        };

        await UserData.findOneAndUpdate(
            { userId: 'default' },
            update,
            { upsert: true, new: true, setDefaultsOnInsert: true }
        );

        res.json({ success: true, message: 'Data saved successfully' });
    } catch (error) {
        console.error('Error saving data:', error);
        res.status(500).json({
            error: 'Failed to save data',
            details: error?.message || String(error)
        });
    }
});

// Update projects (public)
app.put('/api/projects', async (req, res) => {
    try {
        const { projects } = req.body;

        const userData = await UserData.findOne({ userId: 'default' });
        if (!userData) {
            return res.status(404).json({ error: 'User data not found' });
        }

        userData.projects = projects;
        userData.lastModified = new Date();
        await userData.save();

        res.json({ success: true, projects: userData.projects });
    } catch (error) {
        console.error('Error updating projects:', error);
        res.status(500).json({ error: 'Failed to update projects', details: error?.message || String(error) });
    }
});

// Update stats (public)
app.put('/api/stats', async (req, res) => {
    try {
        const { stats } = req.body;

        const userData = await UserData.findOne({ userId: 'default' });
        if (!userData) {
            return res.status(404).json({ error: 'User data not found' });
        }

        userData.stats = stats;
        userData.lastModified = new Date();
        await userData.save();

        res.json({ success: true, stats: userData.stats });
    } catch (error) {
        console.error('Error updating stats:', error);
        res.status(500).json({ error: 'Failed to update stats', details: error?.message || String(error) });
    }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        mongodb: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
        timestamp: new Date().toISOString()
    });
});

// Serve the frontend
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'client', 'index.html'));
});

// Start server
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Serving frontend from: ${path.join(__dirname, '..', 'client')}`);
});
