import { API_ENDPOINTS } from './modules/config.js';
import { getToken, isLoggedIn, logout } from './modules/auth.js';

const endpoints = API_ENDPOINTS.ADMIN_ANALYTICS;
const state = {
    range: '30d',
    overview: null,
    users: null,
    projects: null,
    tasks: null,
    features: null,
    devices: null,
    performance: null,
    errors: null
};

function formatNumber(value) {
    return new Intl.NumberFormat().format(Number(value) || 0);
}

function formatPercent(value) {
    return `${Number(value || 0).toFixed(Number(value) % 1 ? 1 : 0)}%`;
}

function formatDuration(ms) {
    return `${formatNumber(Math.round(Number(ms) || 0))} ms`;
}

function formatDateTime(value) {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleString([], { dateStyle: 'short', timeStyle: 'short' });
}

function escapeHtml(value = '') {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function setStatus(message = '', isError = false) {
    const status = document.getElementById('analyticsStatus');
    if (!status) return;
    status.textContent = message;
    status.classList.toggle('is-hidden', !message);
    status.classList.toggle('is-error', !!isError);
}

function getAuthHeaders() {
    const token = getToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
}

async function request(url) {
    const res = await fetch(`${url}?range=${encodeURIComponent(state.range)}`, {
        method: 'GET',
        headers: getAuthHeaders(),
        credentials: 'omit',
        cache: 'no-store'
    });

    if (res.status === 401) {
        logout();
        return new Promise(() => {});
    }
    if (res.status === 403) {
        throw new Error('Admin access required. Sign in with an admin account or set ADMIN_EMAILS for your admin email.');
    }

    let data = {};
    try { data = await res.json(); } catch {}
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
}

function applyAccentFromStorage() {
    try {
        const accent = localStorage.getItem('tracker_accent_color_v1') || '#ff8a00';
        const hex = String(accent).replace('#', '');
        const r = parseInt(hex.slice(0, 2), 16);
        const g = parseInt(hex.slice(2, 4), 16);
        const b = parseInt(hex.slice(4, 6), 16);
        if (![r, g, b].every(Number.isFinite)) return;
        document.documentElement.style.setProperty('--accent', accent);
        document.documentElement.style.setProperty('--accent-color', accent);
        document.documentElement.style.setProperty('--accent-rgb', `${r}, ${g}, ${b}`);
        document.body.style.setProperty('--accent', accent);
        document.body.style.setProperty('--accent-color', accent);
        document.body.style.setProperty('--accent-rgb', `${r}, ${g}, ${b}`);
    } catch {}
}

function renderCards() {
    const totals = state.overview?.totals || {};
    const perf = state.performance?.summary || {};
    const cards = [
        ['Total Users', totals.totalUsers, 'Registered accounts'],
        ['Active Today', totals.activeToday, 'Users with analytics events today'],
        ['Active This Week', totals.activeThisWeek, 'Users active over the last 7 days'],
        ['Total Projects', totals.totalProjects, `${formatNumber(totals.activeProjects)} active`],
        ['Total Tasks', totals.totalTasks, `${formatNumber(totals.completedTasks)} completed`],
        ['Completion Rate', formatPercent(totals.completionRate), `${formatNumber(totals.overdueTasks)} overdue`],
        ['Error Rate', formatPercent(perf.errorRate), `${formatNumber(perf.failedRequests)} failed requests`],
        ['Avg Response', formatDuration(perf.avgResponseTime), `${formatNumber(perf.requestCount)} tracked requests`]
    ];

    document.getElementById('overviewCards').innerHTML = cards.map(([label, value, note]) => `
        <article class="analytics-card">
            <div class="analytics-card-label">${escapeHtml(label)}</div>
            <div class="analytics-card-value">${escapeHtml(formatNumberIfNumeric(value))}</div>
            <div class="analytics-card-note">${escapeHtml(note)}</div>
        </article>
    `).join('');
}

function formatNumberIfNumeric(value) {
    if (typeof value === 'number') return formatNumber(value);
    return value ?? '0';
}

function buildLinePath(points) {
    return points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ');
}

function renderLineChart(targetId, rows = [], metaId = '') {
    const target = document.getElementById(targetId);
    if (!target) return;
    const safeRows = Array.isArray(rows) ? rows : [];
    if (!safeRows.length) {
        target.innerHTML = '<div class="analytics-empty">No chart data yet.</div>';
        return;
    }

    const width = 760;
    const height = 270;
    const pad = { left: 42, right: 18, top: 20, bottom: 38 };
    const maxValue = Math.max(1, ...safeRows.flatMap(row => [Number(row.created) || 0, Number(row.completed) || 0]));
    const plotWidth = width - pad.left - pad.right;
    const plotHeight = height - pad.top - pad.bottom;
    const xFor = index => pad.left + (safeRows.length === 1 ? plotWidth / 2 : (index / (safeRows.length - 1)) * plotWidth);
    const yFor = value => pad.top + plotHeight - ((Number(value) || 0) / maxValue) * plotHeight;
    const createdPoints = safeRows.map((row, index) => ({ x: xFor(index), y: yFor(row.created) }));
    const completedPoints = safeRows.map((row, index) => ({ x: xFor(index), y: yFor(row.completed) }));
    const firstDate = safeRows[0]?.date || '';
    const lastDate = safeRows[safeRows.length - 1]?.date || '';

    if (metaId) {
        const meta = document.getElementById(metaId);
        if (meta) meta.textContent = `${firstDate} → ${lastDate}`;
    }

    const gridLines = [0, 0.25, 0.5, 0.75, 1].map(ratio => {
        const y = pad.top + plotHeight - ratio * plotHeight;
        const label = Math.round(maxValue * ratio);
        return `<line class="analytics-chart-grid" x1="${pad.left}" y1="${y}" x2="${width - pad.right}" y2="${y}"></line><text class="analytics-chart-label" x="8" y="${y + 4}">${label}</text>`;
    }).join('');

    const dateLabels = safeRows.length > 1 ? [
        { text: firstDate.slice(5), x: pad.left },
        { text: lastDate.slice(5), x: width - pad.right - 32 }
    ] : [{ text: firstDate.slice(5), x: pad.left }];

    target.innerHTML = `
        <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Analytics trend chart">
            ${gridLines}
            <line class="analytics-chart-axis" x1="${pad.left}" y1="${height - pad.bottom}" x2="${width - pad.right}" y2="${height - pad.bottom}"></line>
            <path class="analytics-chart-created" d="${buildLinePath(createdPoints)}"></path>
            <path class="analytics-chart-completed" d="${buildLinePath(completedPoints)}"></path>
            ${createdPoints.map(point => `<circle class="analytics-chart-point-created" cx="${point.x}" cy="${point.y}" r="3"></circle>`).join('')}
            ${completedPoints.map(point => `<circle class="analytics-chart-point-completed" cx="${point.x}" cy="${point.y}" r="3"></circle>`).join('')}
            ${dateLabels.map(label => `<text class="analytics-chart-label" x="${label.x}" y="${height - 12}">${escapeHtml(label.text)}</text>`).join('')}
        </svg>
        <div class="analytics-legend">
            <span><span class="analytics-legend-dot"></span>Created</span>
            <span><span class="analytics-legend-dot is-completed"></span>Completed</span>
        </div>
    `;
}

function renderList(targetId, rows = [], labelFn, valueFn) {
    const target = document.getElementById(targetId);
    if (!target) return;
    if (!rows.length) {
        target.innerHTML = '<div class="analytics-empty">No data yet.</div>';
        return;
    }
    const max = Math.max(1, ...rows.map(row => Number(valueFn(row)) || 0));
    target.innerHTML = rows.map(row => {
        const value = Number(valueFn(row)) || 0;
        const pct = Math.max(4, Math.round((value / max) * 100));
        return `
            <div class="analytics-list-row">
                <div>
                    <div class="analytics-list-label">${escapeHtml(labelFn(row))}</div>
                    <div class="analytics-mini-bar" aria-hidden="true"><span style="width:${pct}%"></span></div>
                </div>
                <div class="analytics-list-count">${formatNumber(value)}</div>
            </div>
        `;
    }).join('');
}

function renderTable(targetId, headers = [], rows = []) {
    const target = document.getElementById(targetId);
    if (!target) return;
    if (!rows.length) {
        target.innerHTML = '<div class="analytics-empty">No data yet.</div>';
        return;
    }
    target.innerHTML = `
        <table class="analytics-table">
            <thead><tr>${headers.map(header => `<th>${escapeHtml(header)}</th>`).join('')}</tr></thead>
            <tbody>${rows.join('')}</tbody>
        </table>
    `;
}

function renderPerformance() {
    const summary = state.performance?.summary || {};
    const cards = [
        ['Requests', summary.requestCount || 0, 'Tracked API calls'],
        ['Avg Response', formatDuration(summary.avgResponseTime), 'Mean response time'],
        ['Failures', summary.failedRequests || 0, 'HTTP/network failures'],
        ['Slow Requests', summary.slowRequests || 0, 'Requests over 1000 ms']
    ];
    document.getElementById('performanceSummary').innerHTML = cards.map(([label, value, note]) => `
        <article class="analytics-card">
            <div class="analytics-card-label">${escapeHtml(label)}</div>
            <div class="analytics-card-value">${escapeHtml(formatNumberIfNumeric(value))}</div>
            <div class="analytics-card-note">${escapeHtml(note)}</div>
        </article>
    `).join('');

    renderTable('slowRoutesTable', ['Route', 'Avg', 'Max', 'Failures'], (state.performance?.slowRoutes || []).map(row => `
        <tr>
            <td>${escapeHtml(row.route || 'unknown')}</td>
            <td>${formatDuration(row.avgResponseTime)}</td>
            <td>${formatDuration(row.maxResponseTime)}</td>
            <td>${formatNumber(row.failures)}</td>
        </tr>
    `));
}

function renderUsers() {
    const users = state.users?.users || [];
    document.getElementById('usersMeta').textContent = `${formatNumber(users.length)} shown`;
    renderTable('usersTable', ['User', 'Events', 'Last Active', 'Role'], users.map(user => `
        <tr>
            <td><strong>${escapeHtml(user.username)}</strong><br><span class="analytics-muted">${escapeHtml(user.email)}</span></td>
            <td>${formatNumber(user.events)}</td>
            <td>${formatDateTime(user.lastActive)}</td>
            <td>${escapeHtml(user.role || 'user')}</td>
        </tr>
    `));
}

function renderErrors() {
    const errors = state.errors?.errors || state.overview?.recentErrors || [];
    document.getElementById('errorsMeta').textContent = `${formatNumber(errors.length)} shown`;
    renderTable('errorsTable', ['Time', 'Event', 'Message', 'Device'], errors.map(error => {
        const metadata = error.metadata || {};
        const device = error.device || {};
        return `
            <tr>
                <td>${formatDateTime(error.timestamp)}</td>
                <td>${escapeHtml(error.event)}</td>
                <td><strong>${escapeHtml(metadata.message || metadata.error || 'Unknown error')}</strong><br><span class="analytics-muted">${escapeHtml(metadata.url || metadata.source || metadata.path || '')}</span></td>
                <td>${escapeHtml([device.deviceType, device.browser, device.os].filter(Boolean).join(' / '))}<br><span class="analytics-muted">${escapeHtml(`${device.viewportWidth || 0}×${device.viewportHeight || 0}`)}</span></td>
            </tr>
        `;
    }));
}

function renderAll() {
    renderCards();
    renderLineChart('tasksChart', state.overview?.charts?.tasksSeries || state.tasks?.series || [], 'tasksChartMeta');
    renderLineChart('projectsChart', state.overview?.charts?.projectsSeries || state.projects?.series || [], 'projectsChartMeta');

    const features = state.features?.features || state.overview?.featureUsage || [];
    document.getElementById('featureUsageMeta').textContent = `${formatNumber(features.length)} events`;
    renderList('featureUsageList', features, row => row.event, row => row.count);

    const devices = state.devices?.devices || state.overview?.devices || [];
    document.getElementById('devicesMeta').textContent = `${formatNumber(devices.length)} groups`;
    renderList('devicesList', devices, row => {
        const viewport = row.viewportWidth && row.viewportHeight ? `${row.viewportWidth}×${row.viewportHeight}` : 'unknown viewport';
        return [row.deviceType || 'unknown', viewport, row.browser || 'unknown', row.os || 'unknown'].join(' / ');
    }, row => row.count);

    renderPerformance();
    renderUsers();
    renderErrors();
}

async function loadAnalytics() {
    if (!isLoggedIn()) {
        window.location.href = '/';
        return;
    }

    setStatus('Loading analytics…');
    try {
        const [overview, users, projects, tasks, features, devices, performance, errors] = await Promise.all([
            request(endpoints.OVERVIEW),
            request(endpoints.USERS),
            request(endpoints.PROJECTS),
            request(endpoints.TASKS),
            request(endpoints.FEATURES),
            request(endpoints.DEVICES),
            request(endpoints.PERFORMANCE),
            request(endpoints.ERRORS)
        ]);
        Object.assign(state, { overview, users, projects, tasks, features, devices, performance, errors });
        renderAll();
        const generated = overview?.generatedAt ? `Updated ${formatDateTime(overview.generatedAt)}` : '';
        setStatus(generated);
        setTimeout(() => setStatus(''), 2600);
    } catch (err) {
        console.error(err);
        setStatus(err.message || 'Failed to load analytics.', true);
    }
}

function init() {
    applyAccentFromStorage();
    const range = document.getElementById('analyticsRange');
    const refresh = document.getElementById('analyticsRefreshBtn');
    if (range) {
        range.value = state.range;
        range.addEventListener('change', () => {
            state.range = range.value || '30d';
            loadAnalytics();
        });
    }
    refresh?.addEventListener('click', loadAnalytics);
    loadAnalytics();
}

document.addEventListener('DOMContentLoaded', init);
