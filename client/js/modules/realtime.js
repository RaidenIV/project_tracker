// Realtime collaboration layer for shared project updates.

import { getToken } from './auth.js';

let socket = null;
let callbacks = {};

export function connectRealtime(nextCallbacks = {}) {
    callbacks = { ...callbacks, ...nextCallbacks };

    const token = getToken();
    if (!token) return null;
    if (socket?.connected) return socket;
    if (typeof window.io !== 'function') {
        console.warn('Realtime client unavailable: /socket.io/socket.io.js was not loaded.');
        return null;
    }

    if (socket) {
        socket.removeAllListeners();
        socket.disconnect();
    }

    socket = window.io({
        auth: { token },
        transports: ['websocket', 'polling'],
        withCredentials: false,
        reconnection: true,
        reconnectionAttempts: Infinity,
        reconnectionDelay: 800,
        reconnectionDelayMax: 5000
    });

    socket.on('connect', () => callbacks.onConnect?.());
    socket.on('disconnect', (reason) => callbacks.onDisconnect?.(reason));
    socket.on('connect_error', (err) => callbacks.onError?.(err));

    socket.on('project:upsert', (payload = {}) => {
        if (payload?.project) callbacks.onProjectUpsert?.(payload.project, payload);
    });

    socket.on('project:delete', (payload = {}) => {
        const projectId = payload?.projectId;
        if (projectId) callbacks.onProjectDelete?.(projectId, payload);
    });

    return socket;
}

export function disconnectRealtime() {
    if (!socket) return;
    socket.removeAllListeners();
    socket.disconnect();
    socket = null;
}
