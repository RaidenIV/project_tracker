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
    errors: null,
    backfill: null
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

function formatDate(value) {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
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

function getAuthHeaders(includeJson = false) {
    const token = getToken();
    return {
        ...(includeJson ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {})
    };
}

function withRange(url) {
    const separator = url.includes('?') ? '&' : '?';
    return `${url}${separator}range=${encodeURIComponent(state.range)}`;
}

async function request(url) {
    const res = await fetch(withRange(url), {
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

async function postRequest(url, body = {}) {
    const res = await fetch(url, {
        method: 'POST',
        headers: getAuthHeaders(true),
        credentials: 'omit',
        cache: 'no-store',
        body: JSON.stringify(body)
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

function formatNumberIfNumeric(value) {
    if (typeof value === 'number') return formatNumber(value);
    return value ?? '0';
}

function humanizeEvent(event = '') {
    return String(event || '')
        .replace(/_/g, ' ')
        .replace(/\b\w/g, letter => letter.toUpperCase());
}

function renderBackfillSummary() {
    const target = document.getElementById('backfillSummary');
    if (!target) return;
    const backfill = state.backfill?.backfill || state.overview?.backfill || {};
    const totalEvents = Number(backfill.totalEvents || 0);
    const estimated = Number(backfill.estimatedTimestampEvents || 0);
    const exact = Math.max(0, totalEvents - estimated);
    const lastRun = backfill.lastIngestedAt ? formatDateTime(backfill.lastIngestedAt) : 'Not run yet';
    const range = backfill.firstEventAt && backfill.lastEventAt
        ? `${formatDate(backfill.firstEventAt)} → ${formatDate(backfill.lastEventAt)}`
        : 'No recovered range yet';

    target.innerHTML = `
        <div class="analytics-backfill-title">
            <span>Historical Recovery</span>
            <span class="analytics-pill">Idempotent</span>
        </div>
        <div class="analytics-backfill-big">${formatNumber(totalEvents)}</div>
        <div class="analytics-muted">Recovered events. Re-running is safe; duplicates are skipped.</div>
        <div class="analytics-backfill-grid">
            <div class="analytics-backfill-stat"><span>Exact dates</span><strong>${formatNumber(exact)}</strong></div>
            <div class="analytics-backfill-stat"><span>Estimated dates</span><strong>${formatNumber(estimated)}</strong></div>
            <div class="analytics-backfill-stat"><span>Event range</span><strong>${escapeHtml(range)}</strong></div>
            <div class="analytics-backfill-stat"><span>Last run</span><strong>${escapeHtml(lastRun)}</strong></div>
        </div>
    `;
}

function renderCards() {
    const totals = state.overview?.totals || {};
    const perf = state.performance?.summary || {};
    const backfill = state.backfill?.backfill || state.overview?.backfill || {};
    const cards = [
        ['Total Users', totals.totalUsers, 'Registered accounts'],
        ['Active Today', totals.activeToday, 'Live users today'],
        ['Active This Week', totals.activeThisWeek, 'Live users over 7 days'],
        ['Total Projects', totals.totalProjects, `${formatNumber(totals.activeProjects)} active`],
        ['Total Tasks', totals.totalTasks, 'All project tasks'],
        ['Completed Tasks', totals.completedTasks, 'Recovered + live completion data'],
        ['Completion Rate', formatPercent(totals.completionRate), `${formatNumber(totals.overdueTasks)} overdue`],
        ['Shared Projects', totals.sharedProjects, 'Collaboration footprint'],
        ['Avg Tasks / Project', totals.avgTasksPerProject, 'Project density'],
        ['Historical Events', backfill.totalEvents, `${formatNumber(backfill.estimatedTimestampEvents)} estimated`],
        ['Error Rate', formatPercent(perf.errorRate), `${formatNumber(perf.failedRequests)} failed requests`],
        ['Avg Response', formatDuration(perf.avgResponseTime), `${formatNumber(perf.requestCount)} tracked requests`]
    ];

    document.getElementById('overviewCards').innerHTML = cards.map(([label, value, note], index) => `
        <article class="analytics-card">
            <div class="analytics-card-top">
                <div class="analytics-card-label">${escapeHtml(label)}</div>
                <div class="analytics-card-index">${String(index + 1).padStart(2, '0')}</div>
            </div>
            <div class="analytics-card-value">${escapeHtml(formatNumberIfNumeric(value))}</div>
            <div class="analytics-card-note">${escapeHtml(note)}</div>
        </article>
    `).join('');
}

function buildLinePath(points) {
    return points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ');
}

function buildAreaPath(points, baselineY) {
    if (!points.length) return '';
    return `M ${points[0].x} ${baselineY} L ${points.map(point => `${point.x} ${point.y}`).join(' L ')} L ${points[points.length - 1].x} ${baselineY} Z`;
}

function renderLineChart(targetId, rows = [], metaId = '') {
    const target = document.getElementById(targetId);
    if (!target) return;
    const safeRows = Array.isArray(rows) ? rows : [];
    const totalActivity = safeRows.reduce((sum, row) => sum + (Number(row.created) || 0) + (Number(row.completed) || 0), 0);
    if (!safeRows.length || totalActivity === 0) {
        target.innerHTML = '<div class="analytics-empty">No activity in this range yet. Run historical backfill or select a wider date range.</div>';
        if (metaId) {
            const meta = document.getElementById(metaId);
            if (meta) meta.textContent = '';
        }
        return;
    }

    const width = 820;
    const height = 290;
    const pad = { left: 46, right: 22, top: 22, bottom: 40 };
    const maxValue = Math.max(1, ...safeRows.flatMap(row => [Number(row.created) || 0, Number(row.completed) || 0]));
    const plotWidth = width - pad.left - pad.right;
    const plotHeight = height - pad.top - pad.bottom;
    const baselineY = height - pad.bottom;
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
        return `<line class="analytics-chart-grid" x1="${pad.left}" y1="${y}" x2="${width - pad.right}" y2="${y}"></line><text class="analytics-chart-label" x="10" y="${y + 4}">${label}</text>`;
    }).join('');

    const dateLabels = safeRows.length > 1 ? [
        { text: firstDate.slice(5), x: pad.left },
        { text: lastDate.slice(5), x: width - pad.right - 38 }
    ] : [{ text: firstDate.slice(5), x: pad.left }];

    target.innerHTML = `
        <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Analytics trend chart">
            ${gridLines}
            <line class="analytics-chart-axis" x1="${pad.left}" y1="${baselineY}" x2="${width - pad.right}" y2="${baselineY}"></line>
            <path class="analytics-chart-area-created" d="${buildAreaPath(createdPoints, baselineY)}"></path>
            <path class="analytics-chart-area-completed" d="${buildAreaPath(completedPoints, baselineY)}"></path>
            <path class="analytics-chart-created" d="${buildLinePath(createdPoints)}"></path>
            <path class="analytics-chart-completed" d="${buildLinePath(completedPoints)}"></path>
            ${createdPoints.map(point => `<circle class="analytics-chart-point-created" cx="${point.x}" cy="${point.y}" r="3.5"></circle>`).join('')}
            ${completedPoints.map(point => `<circle class="analytics-chart-point-completed" cx="${point.x}" cy="${point.y}" r="3.5"></circle>`).join('')}
            ${dateLabels.map(label => `<text class="analytics-chart-label" x="${label.x}" y="${height - 13}">${escapeHtml(label.text)}</text>`).join('')}
        </svg>
        <div class="analytics-legend">
            <span><span class="analytics-legend-dot"></span>Created</span>
            <span><span class="analytics-legend-dot is-completed"></span>Completed</span>
        </div>
    `;
}

function renderList(targetId, rows = [], labelFn, valueFn, subtitleFn = null) {
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
        const subtitle = subtitleFn ? subtitleFn(row) : '';
        return `
            <div class="analytics-list-row">
                <div>
                    <div class="analytics-list-label">${escapeHtml(labelFn(row))}</div>
                    ${subtitle ? `<div class="analytics-list-subtitle">${escapeHtml(subtitle)}</div>` : ''}
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
    document.getElementById('performanceSummary').innerHTML = cards.map(([label, value, note], index) => `
        <article class="analytics-card">
            <div class="analytics-card-top">
                <div class="analytics-card-label">${escapeHtml(label)}</div>
                <div class="analytics-card-index">P${index + 1}</div>
            </div>
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
            <td><span class="analytics-pill">${escapeHtml(user.role || 'user')}</span></td>
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
                <td><span class="analytics-pill">${escapeHtml(humanizeEvent(error.event))}</span></td>
                <td><strong>${escapeHtml(metadata.message || metadata.error || 'Unknown error')}</strong><br><span class="analytics-muted">${escapeHtml(metadata.url || metadata.source || metadata.path || '')}</span></td>
                <td>${escapeHtml([device.deviceType, device.browser, device.os].filter(Boolean).join(' / '))}<br><span class="analytics-muted">${escapeHtml(`${device.viewportWidth || 0}×${device.viewportHeight || 0}`)}</span></td>
            </tr>
        `;
    }));
}

function renderAll() {
    renderBackfillSummary();
    renderCards();
    renderLineChart('tasksChart', state.overview?.charts?.tasksSeries || state.tasks?.series || [], 'tasksChartMeta');
    renderLineChart('projectsChart', state.overview?.charts?.projectsSeries || state.projects?.series || [], 'projectsChartMeta');

    const features = state.features?.features || state.overview?.featureUsage || [];
    document.getElementById('featureUsageMeta').textContent = `${formatNumber(features.length)} event types`;
    renderList('featureUsageList', features, row => humanizeEvent(row.event), row => row.count, row => row.uniqueUsers !== undefined ? `${formatNumber(row.uniqueUsers)} unique users` : 'tracked event volume');

    const devices = state.devices?.devices || state.overview?.devices || [];
    document.getElementById('devicesMeta').textContent = `${formatNumber(devices.length)} groups`;
    renderList('devicesList', devices, row => {
        const viewport = row.viewportWidth && row.viewportHeight ? `${row.viewportWidth}×${row.viewportHeight}` : 'unknown viewport';
        return [row.deviceType || 'unknown', viewport, row.browser || 'unknown', row.os || 'unknown'].join(' / ');
    }, row => row.count, row => row.viewportWidth && row.viewportHeight ? 'live viewport telemetry' : 'live device telemetry');

    renderPerformance();
    renderUsers();
    renderErrors();
}

async function loadAnalytics({ preserveStatus = false } = {}) {
    if (!isLoggedIn()) {
        window.location.href = '/';
        return;
    }

    if (!preserveStatus) setStatus('Loading analytics…');
    try {
        const [overview, users, projects, tasks, features, devices, performance, errors, backfill] = await Promise.all([
            request(endpoints.OVERVIEW),
            request(endpoints.USERS),
            request(endpoints.PROJECTS),
            request(endpoints.TASKS),
            request(endpoints.FEATURES),
            request(endpoints.DEVICES),
            request(endpoints.PERFORMANCE),
            request(endpoints.ERRORS),
            request(endpoints.BACKFILL_STATUS)
        ]);
        Object.assign(state, { overview, users, projects, tasks, features, devices, performance, errors, backfill });
        renderAll();
        const generated = overview?.generatedAt ? `Updated ${formatDateTime(overview.generatedAt)}` : '';
        if (!preserveStatus) {
            setStatus(generated);
            setTimeout(() => setStatus(''), 2600);
        }
    } catch (err) {
        console.error(err);
        setStatus(err.message || 'Failed to load analytics.', true);
    }
}

async function runBackfill() {
    const button = document.getElementById('analyticsBackfillBtn');
    if (button?.disabled) return;

    const originalText = button?.textContent || 'Backfill History';
    if (button) {
        button.disabled = true;
        button.textContent = 'Backfilling…';
    }
    setStatus('Recovering historical analytics from existing MongoDB records…');

    try {
        const data = await postRequest(endpoints.BACKFILL, {});
        const result = data.result || {};
        state.backfill = { backfill: data.backfill || {} };
        await loadAnalytics({ preserveStatus: true });
        setStatus(`Historical backfill complete: ${formatNumber(result.insertedEvents)} new events inserted, ${formatNumber(result.existingEvents)} existing events skipped.`);
        setTimeout(() => setStatus(''), 5200);
    } catch (err) {
        console.error(err);
        setStatus(err.message || 'Historical backfill failed.', true);
    } finally {
        if (button) {
            button.disabled = false;
            button.textContent = originalText;
        }
    }
}

function init() {
    applyAccentFromStorage();
    const range = document.getElementById('analyticsRange');
    const refresh = document.getElementById('analyticsRefreshBtn');
    const backfill = document.getElementById('analyticsBackfillBtn');
    if (range) {
        range.value = state.range;
        range.addEventListener('change', () => {
            state.range = range.value || '30d';
            loadAnalytics();
        });
    }
    refresh?.addEventListener('click', () => loadAnalytics());
    backfill?.addEventListener('click', runBackfill);
    loadAnalytics();
}

document.addEventListener('DOMContentLoaded', init);
