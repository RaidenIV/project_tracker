// API calls to server

import { API_ENDPOINTS } from './config.js';

export async function loadDataFromServer() {
    try {
        const response = await fetch(API_ENDPOINTS.DATA);
        if (!response.ok) {
            throw new Error('Failed to fetch data');
        }
        const data = await response.json();
        return {
            projects: data.projects || [],
            stats: data.stats || { completedTasks: 0, completedProjects: 0 }
        };
    } catch (error) {
        console.error('Error loading data:', error);
        // Return empty data as fallback
        return {
            projects: [],
            stats: { completedTasks: 0, completedProjects: 0 }
        };
    }
}

export async function saveDataToServer(projects, stats) {
    try {
        const response = await fetch(API_ENDPOINTS.DATA, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ projects, stats })
        });
        
        if (!response.ok) {
            throw new Error('Failed to save data');
        }
        
        const result = await response.json();
        console.log('✅ Data saved to MongoDB:', result.message);
        return true;
    } catch (error) {
        console.error('❌ Error saving data:', error);
        alert('Failed to save data. Please check your connection.');
        return false;
    }
}

export async function checkServerHealth() {
    try {
        const response = await fetch(API_ENDPOINTS.HEALTH);
        if (!response.ok) {
            throw new Error('Health check failed');
        }
        const health = await response.json();
        console.log('Server health:', health);
        return health;
    } catch (error) {
        console.error('Error checking server health:', error);
        return null;
    }
}
