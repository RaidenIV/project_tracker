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

function formatSignedNumber(value) {
    const number = Number(value) || 0;
    return `${number > 0 ? '+' : ''}${formatNumber(number)}`;
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

function getFilenameFromDisposition(disposition = '', fallback = 'taskcom-analytics-export') {
    const match = String(disposition || '').match(/filename="?([^";]+)"?/i);
    return match?.[1] || fallback;
}

async function downloadAnalyticsExport(format = 'csv') {
    const isJson = format === 'json';
    const url = isJson ? endpoints.EXPORT_JSON : endpoints.EXPORT_CSV;
    const button = document.getElementById(isJson ? 'analyticsExportJsonBtn' : 'analyticsExportCsvBtn');
    const originalText = button?.textContent || (isJson ? 'Export JSON' : 'Export CSV');

    if (!url || button?.disabled) return;
    if (button) {
        button.disabled = true;
        button.textContent = isJson ? 'Exporting JSON…' : 'Exporting CSV…';
    }
    setStatus(`Preparing ${isJson ? 'JSON' : 'CSV'} export for the selected range…`);

    try {
        const res = await fetch(withRange(url), {
            method: 'GET',
            headers: getAuthHeaders(),
            credentials: 'omit',
            cache: 'no-store'
        });

        if (res.status === 401) {
            logout();
            return;
        }
        if (res.status === 403) {
            throw new Error('Admin access required. Sign in with an admin account or set ADMIN_EMAILS for your admin email.');
        }
        if (!res.ok) {
            let data = {};
            try { data = await res.json(); } catch {}
            throw new Error(data.error || `Export failed with HTTP ${res.status}`);
        }

        const blob = await res.blob();
        const objectUrl = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = objectUrl;
        link.download = getFilenameFromDisposition(
            res.headers.get('content-disposition'),
            `taskcom-analytics-events-${state.range}.${isJson ? 'json' : 'csv'}`
        );
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(objectUrl);
        setStatus(`${isJson ? 'JSON' : 'CSV'} export downloaded.`);
        setTimeout(() => setStatus(''), 3200);
    } catch (err) {
        console.error(err);
        setStatus(err.message || 'Analytics export failed.', true);
    } finally {
        if (button) {
            button.disabled = false;
            button.textContent = originalText;
        }
    }
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

    document.getElementById('overviewCards').innerHTML = cards.map(([label, value, note]) => `
        <article class="analytics-card">
            <div class="analytics-card-top">
                <div class="analytics-card-label">${escapeHtml(label)}</div>
            </div>
            <div class="analytics-card-value">${escapeHtml(formatNumberIfNumeric(value))}</div>
            <div class="analytics-card-note">${escapeHtml(note)}</div>
        </article>
    `).join('');
}

function compactSeries(rows = [], maxBars = 18) {
    const safeRows = Array.isArray(rows) ? rows : [];
    if (safeRows.length <= maxBars) return safeRows.map(row => ({ ...row, label: String(row.date || '').slice(5) || '—' }));

    const bucketSize = Math.ceil(safeRows.length / maxBars);
    const buckets = [];
    for (let index = 0; index < safeRows.length; index += bucketSize) {
        const chunk = safeRows.slice(index, index + bucketSize);
        const first = chunk[0]?.date || '';
        const last = chunk[chunk.length - 1]?.date || first;
        buckets.push({
            date: first,
            label: first === last ? first.slice(5) : `${first.slice(5)}–${last.slice(5)}`,
            created: chunk.reduce((sum, row) => sum + (Number(row.created) || 0), 0),
            completed: chunk.reduce((sum, row) => sum + (Number(row.completed) || 0), 0)
        });
    }
    return buckets;
}

function renderLineChart(targetId, rows = [], metaId = '') {
    const target = document.getElementById(targetId);
    if (!target) return;
    const sourceRows = Array.isArray(rows) ? rows : [];
    const totalActivity = sourceRows.reduce((sum, row) => sum + (Number(row.created) || 0) + (Number(row.completed) || 0), 0);
    if (!sourceRows.length || totalActivity === 0) {
        target.innerHTML = '<div class="analytics-empty">No activity in this range yet. Run historical backfill or select a wider date range.</div>';
        if (metaId) {
            const meta = document.getElementById(metaId);
            if (meta) meta.textContent = '';
        }
        return;
    }

    const safeRows = compactSeries(sourceRows, 18);
    const width = 820;
    const height = 238;
    const pad = { left: 42, right: 18, top: 18, bottom: 48 };
    const maxValue = Math.max(1, ...safeRows.flatMap(row => [Number(row.created) || 0, Number(row.completed) || 0]));
    const plotWidth = width - pad.left - pad.right;
    const plotHeight = height - pad.top - pad.bottom;
    const baselineY = height - pad.bottom;
    const groupWidth = plotWidth / safeRows.length;
    const barWidth = Math.max(6, Math.min(18, groupWidth * 0.3));
    const firstDate = sourceRows[0]?.date || '';
    const lastDate = sourceRows[sourceRows.length - 1]?.date || '';

    if (metaId) {
        const meta = document.getElementById(metaId);
        if (meta) meta.textContent = `${firstDate} → ${lastDate}`;
    }

    const yFor = value => pad.top + plotHeight - ((Number(value) || 0) / maxValue) * plotHeight;
    const gridLines = [0, 0.25, 0.5, 0.75, 1].map(ratio => {
        const y = pad.top + plotHeight - ratio * plotHeight;
        const label = Math.round(maxValue * ratio);
        return `<line class="analytics-chart-grid" x1="${pad.left}" y1="${y}" x2="${width - pad.right}" y2="${y}"></line><text class="analytics-chart-label" x="10" y="${y + 4}">${label}</text>`;
    }).join('');

    const bars = safeRows.map((row, index) => {
        const groupX = pad.left + index * groupWidth + groupWidth / 2;
        const createdY = yFor(row.created);
        const completedY = yFor(row.completed);
        const createdHeight = Math.max(1, baselineY - createdY);
        const completedHeight = Math.max(1, baselineY - completedY);
        const showLabel = safeRows.length <= 10 || index === 0 || index === safeRows.length - 1 || index % Math.ceil(safeRows.length / 6) === 0;
        return `
            <rect class="analytics-chart-bar-created" x="${groupX - barWidth - 2}" y="${createdY}" width="${barWidth}" height="${createdHeight}" rx="2"></rect>
            <rect class="analytics-chart-bar-completed" x="${groupX + 2}" y="${completedY}" width="${barWidth}" height="${completedHeight}" rx="2"></rect>
            ${showLabel ? `<text class="analytics-chart-label" x="${groupX - groupWidth / 2 + 2}" y="${height - 14}">${escapeHtml(row.label || '')}</text>` : ''}
        `;
    }).join('');

    target.innerHTML = `
        <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Analytics grouped bar chart">
            ${gridLines}
            <line class="analytics-chart-axis" x1="${pad.left}" y1="${baselineY}" x2="${width - pad.right}" y2="${baselineY}"></line>
            ${bars}
        </svg>
        <div class="analytics-legend">
            <span><span class="analytics-legend-dot"></span>Created</span>
            <span><span class="analytics-legend-dot is-completed"></span>Completed</span>
        </div>
    `;
}


function getSegmentColor(index = 0) {
    const colors = [
        'var(--chart-accent)',
        '#2ecc71',
        '#f1c40f',
        '#e74c3c',
        '#9b59b6'
    ];
    return colors[index % colors.length];
}

function renderDonutChart(targetId, segments = [], { value = '', label = 'Total' } = {}) {
    const target = document.getElementById(targetId);
    if (!target) return;

    const cleanSegments = segments
        .map((segment, index) => ({
            ...segment,
            label: segment.label || `Segment ${index + 1}`,
            value: Math.max(0, Number(segment.value) || 0),
            color: segment.color || getSegmentColor(index)
        }))
        .filter(segment => segment.value > 0);

    const total = cleanSegments.reduce((sum, segment) => sum + segment.value, 0);
    if (!total) {
        target.innerHTML = '<div class="analytics-empty">No composition data yet.</div>';
        return;
    }

    const radius = 70;
    const circumference = 2 * Math.PI * radius;
    let offset = 0;
    const circles = cleanSegments.map(segment => {
        const dash = (segment.value / total) * circumference;
        const circle = `<circle class="analytics-donut-segment" cx="88" cy="88" r="${radius}" style="--segment-color:${segment.color};stroke-dasharray:${dash} ${circumference - dash};stroke-dashoffset:${-offset};"></circle>`;
        offset += dash;
        return circle;
    }).join('');

    const legend = cleanSegments.map(segment => {
        const pct = total ? Math.round((segment.value / total) * 100) : 0;
        return `
            <div class="analytics-donut-legend-row">
                <span class="analytics-donut-legend-dot" style="--segment-color:${segment.color}"></span>
                <span class="analytics-donut-legend-name">${escapeHtml(segment.label)}</span>
                <span class="analytics-donut-legend-value">${formatNumber(segment.value)} · ${pct}%</span>
            </div>
        `;
    }).join('');

    target.innerHTML = `
        <div class="analytics-donut-shell">
            <div class="analytics-donut-figure">
                <svg viewBox="0 0 176 176" role="img" aria-label="${escapeHtml(label)} donut chart">
                    <circle class="analytics-donut-bg" cx="88" cy="88" r="${radius}"></circle>
                    ${circles}
                </svg>
                <div class="analytics-donut-center">
                    <div class="analytics-donut-value">${escapeHtml(value || formatNumber(total))}</div>
                    <div class="analytics-donut-label">${escapeHtml(label)}</div>
                </div>
            </div>
            <div class="analytics-donut-legend">${legend}</div>
        </div>
    `;
}

function renderDonutInsights() {
    const totals = state.overview?.totals || state.tasks?.snapshot || state.projects?.snapshot || {};
    const totalTasks = Math.max(0, Number(totals.totalTasks) || 0);
    const completedTasks = Math.max(0, Number(totals.completedTasks) || 0);
    const overdueTasks = Math.max(0, Number(totals.overdueTasks) || 0);
    const openTasks = Math.max(0, totalTasks - completedTasks - overdueTasks);

    renderDonutChart('completionDonut', [
        { label: 'Completed', value: completedTasks, color: '#2ecc71' },
        { label: 'Open', value: openTasks, color: 'var(--chart-accent)' },
        { label: 'Overdue', value: overdueTasks, color: '#f1c40f' }
    ], {
        value: formatPercent(totals.completionRate),
        label: 'Complete'
    });

    const activeProjects = Math.max(0, Number(totals.activeProjects) || 0);
    const completedProjects = Math.max(0, Number(totals.completedProjects) || 0);
    const archivedProjects = Math.max(0, Number(totals.archivedProjects) || 0);

    renderDonutChart('projectStatusDonut', [
        { label: 'Active', value: activeProjects, color: 'var(--chart-accent)' },
        { label: 'Completed', value: completedProjects, color: '#2ecc71' },
        { label: 'Archived', value: archivedProjects, color: '#9b59b6' }
    ], {
        value: formatNumber(totals.totalProjects),
        label: 'Projects'
    });

    const features = state.features?.features || state.overview?.featureUsage || [];
    const topFeatures = features.slice(0, 4).map(row => ({
        label: humanizeEvent(row.event),
        value: Number(row.count) || 0
    }));
    const other = features.slice(4).reduce((sum, row) => sum + (Number(row.count) || 0), 0);
    const activitySegments = other > 0 ? [...topFeatures, { label: 'Other', value: other }] : topFeatures;
    renderDonutChart('activityMixDonut', activitySegments, {
        value: formatNumber(activitySegments.reduce((sum, row) => sum + (Number(row.value) || 0), 0)),
        label: 'Events'
    });
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
    document.getElementById('performanceSummary').innerHTML = cards.map(([label, value, note]) => `
        <article class="analytics-card">
            <div class="analytics-card-top">
                <div class="analytics-card-label">${escapeHtml(label)}</div>
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
            <td><span class="analytics-pill${(user.role || 'user') === 'admin' ? ' analytics-pill--admin' : ''}">${escapeHtml(user.role || 'user')}</span></td>
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

function sumSeries(rows = [], key = '') {
    return (Array.isArray(rows) ? rows : []).reduce((sum, row) => sum + (Number(row?.[key]) || 0), 0);
}

function getInsightTone({ value = 0, goodAtOrAbove = null, warnAtOrAbove = null, badAtOrAbove = null, lowerIsBetter = false } = {}) {
    const number = Number(value) || 0;
    if (lowerIsBetter) {
        if (badAtOrAbove !== null && number >= badAtOrAbove) return 'bad';
        if (warnAtOrAbove !== null && number >= warnAtOrAbove) return 'warn';
        return 'good';
    }
    if (goodAtOrAbove !== null && number >= goodAtOrAbove) return 'good';
    if (warnAtOrAbove !== null && number >= warnAtOrAbove) return 'warn';
    return 'bad';
}

function renderAnalyticalInsights() {
    const target = document.getElementById('analyticsInsights');
    const recommendationTarget = document.getElementById('analyticsRecommendation');
    const meta = document.getElementById('analyticsInsightsMeta');
    if (!target) return;

    const totals = state.overview?.totals || {};
    const performance = state.performance?.summary || {};
    const taskSeries = state.overview?.charts?.tasksSeries || state.tasks?.series || [];
    const projectSeries = state.overview?.charts?.projectsSeries || state.projects?.series || [];

    const taskCreated = sumSeries(taskSeries, 'created');
    const taskCompleted = sumSeries(taskSeries, 'completed');
    const projectCreated = sumSeries(projectSeries, 'created');
    const projectCompleted = sumSeries(projectSeries, 'completed');
    const backlogDelta = taskCreated - taskCompleted;
    const taskThroughput = taskCreated ? (taskCompleted / taskCreated) * 100 : 0;
    const projectDelivery = projectCreated ? (projectCompleted / projectCreated) * 100 : 0;
    const weeklyActivation = totals.totalUsers ? ((Number(totals.activeThisWeek) || 0) / totals.totalUsers) * 100 : 0;
    const openTasks = Math.max(0, (Number(totals.totalTasks) || 0) - (Number(totals.completedTasks) || 0));
    const overduePressure = openTasks ? ((Number(totals.overdueTasks) || 0) / openTasks) * 100 : 0;
    const apiReliability = performance.requestCount ? ((performance.requestCount - (Number(performance.failedRequests) || 0)) / performance.requestCount) * 100 : 100;

    const insights = [
        {
            label: 'Backlog Delta',
            value: formatSignedNumber(backlogDelta),
            note: `${formatNumber(taskCreated)} created · ${formatNumber(taskCompleted)} completed`,
            status: backlogDelta > 0 ? 'Building' : backlogDelta < 0 ? 'Shrinking' : 'Balanced',
            tone: backlogDelta > 0 ? 'warn' : 'good'
        },
        {
            label: 'Task Throughput',
            value: formatPercent(taskThroughput),
            note: 'Completed tasks divided by created tasks in range',
            status: taskCreated ? 'Range ratio' : 'No range data',
            tone: taskCreated ? getInsightTone({ value: taskThroughput, goodAtOrAbove: 85, warnAtOrAbove: 60 }) : 'neutral'
        },
        {
            label: 'Project Delivery',
            value: formatPercent(projectDelivery),
            note: `${formatNumber(projectCompleted)} completed · ${formatNumber(projectCreated)} created`,
            status: projectCreated ? 'Delivery ratio' : 'No range data',
            tone: projectCreated ? getInsightTone({ value: projectDelivery, goodAtOrAbove: 70, warnAtOrAbove: 35 }) : 'neutral'
        },
        {
            label: 'Weekly Activation',
            value: formatPercent(weeklyActivation),
            note: `${formatNumber(totals.activeThisWeek)} of ${formatNumber(totals.totalUsers)} users active`,
            status: 'User adoption',
            tone: getInsightTone({ value: weeklyActivation, goodAtOrAbove: 35, warnAtOrAbove: 15 })
        },
        {
            label: 'Overdue Pressure',
            value: formatPercent(overduePressure),
            note: `${formatNumber(totals.overdueTasks)} overdue across ${formatNumber(openTasks)} open tasks`,
            status: 'Execution risk',
            tone: getInsightTone({ value: overduePressure, lowerIsBetter: true, warnAtOrAbove: 8, badAtOrAbove: 18 })
        },
        {
            label: 'API Reliability',
            value: formatPercent(apiReliability),
            note: `${formatNumber(performance.failedRequests)} failures from ${formatNumber(performance.requestCount)} requests`,
            status: 'System quality',
            tone: getInsightTone({ value: apiReliability, goodAtOrAbove: 99, warnAtOrAbove: 95 })
        }
    ];

    if (meta) meta.textContent = `${state.range === 'all' ? 'All Historical' : state.range} Scorecard`;
    target.innerHTML = insights.map(insight => `
        <article class="analytics-insight-card analytics-insight-card--${escapeHtml(insight.tone)}">
            <div class="analytics-insight-top">
                <div class="analytics-insight-label">${escapeHtml(insight.label)}</div>
            </div>
            <div class="analytics-insight-value">${escapeHtml(insight.value)}</div>
            <div class="analytics-insight-note">${escapeHtml(insight.note)}</div>
        </article>
    `).join('');

    if (recommendationTarget) {
        const focus = overduePressure >= 18
            ? ['Reduce overdue pressure', 'Prioritize overdue task cleanup before adding more project volume.']
            : backlogDelta > 0
                ? ['Watch backlog growth', 'More tasks were created than completed in the selected range.']
                : weeklyActivation < 15
                    ? ['Improve activation', 'Most registered users are not active in the current weekly window.']
                    : apiReliability < 95
                        ? ['Investigate reliability', 'API failures are high enough to affect confidence in usage data.']
                        : ['Maintain current trajectory', 'Task flow, activation, overdue pressure, and API reliability are within healthy ranges.'];
        recommendationTarget.innerHTML = `
            <div class="analytics-recommendation-label">Recommended Focus</div>
            <strong>${escapeHtml(focus[0])}</strong>
            <span>${escapeHtml(focus[1])}</span>
        `;
    }
}

function renderAll() {
    renderBackfillSummary();
    renderCards();
    renderAnalyticalInsights();
    renderLineChart('tasksChart', state.overview?.charts?.tasksSeries || state.tasks?.series || [], 'tasksChartMeta');
    renderLineChart('projectsChart', state.overview?.charts?.projectsSeries || state.projects?.series || [], 'projectsChartMeta');
    renderDonutInsights();

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
    const range = document.getElementById('analyticsRange');
    const refresh = document.getElementById('analyticsRefreshBtn');
    const exportCsv = document.getElementById('analyticsExportCsvBtn');
    const exportJson = document.getElementById('analyticsExportJsonBtn');
    const backfill = document.getElementById('analyticsBackfillBtn');
    if (range) {
        range.value = state.range;
        range.addEventListener('change', () => {
            state.range = range.value || '30d';
            loadAnalytics();
        });
    }
    refresh?.addEventListener('click', () => loadAnalytics());
    exportCsv?.addEventListener('click', () => downloadAnalyticsExport('csv'));
    exportJson?.addEventListener('click', () => downloadAnalyticsExport('json'));
    backfill?.addEventListener('click', runBackfill);
    loadAnalytics();
}

document.addEventListener('DOMContentLoaded', init);
