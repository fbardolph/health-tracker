// Health Tracker App

const STORAGE_KEY = 'healthTracker_entries';
const SETTINGS_KEY = 'healthTracker_settings';

// Field definitions
const FIELDS = [
    { id: 'weight', label: 'Weight', csvHeader: 'Weight' },
    { id: 'waist', label: 'Waist Circumference', csvHeader: 'Waist Circumference' },
    { id: 'bp', label: 'Blood Pressure', csvHeader: 'Blood Pressure' },
    { id: 'totalChol', label: 'Total Cholesterol', csvHeader: 'Total Chol' },
    { id: 'hdl', label: 'HDL', csvHeader: 'HDL' },
    { id: 'ldl', label: 'LDL', csvHeader: 'LDL' },
    { id: 'nonHdl', label: 'Non-HDL', csvHeader: 'Non-HDL' },
    { id: 'triglycerides', label: 'Triglycerides', csvHeader: 'Triglycerides' },
    { id: 'bmi', label: 'BMI', csvHeader: 'BMI' },
    { id: 'apoB', label: 'ApoB', csvHeader: 'ApoB' },
    { id: 'alcohol', label: 'Alcoholic Drinks', csvHeader: 'Alcohol' }
];

// State
let entries = [];
let settings = {
    visibleFields: FIELDS.map(f => f.id)
};
let weightChart = null;
let lipidChart = null;
let alcoholChart = null;
let fullscreenChart = null;
let currentFullscreenType = null;

// Target values
const TARGETS = {
    weight: 175,          // lbs
    totalChol: 200,       // mg/dL - desirable is below this
    ldl: 100,             // mg/dL - optimal is below this
    hdl: 60               // mg/dL - protective level (higher is better)
};

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    loadData();
    loadSettings();
    setupEventListeners();
    renderDashboard();
    renderFieldToggles();
    applyFieldVisibility();

    // Debug: verify zoom plugin loaded
    console.log('Chart.js version:', Chart.version);
    console.log('Zoom plugin registered:', !!Chart.registry.plugins.get('zoom'));
    console.log('Hammer.js available:', typeof Hammer !== 'undefined');
});

// Data Management
function loadData() {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
        entries = JSON.parse(stored);
    }
}

function saveData() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
}

function loadSettings() {
    const stored = localStorage.getItem(SETTINGS_KEY);
    if (stored) {
        settings = JSON.parse(stored);
    }
}

function saveSettings() {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

function getNextId() {
    if (entries.length === 0) return 1;
    return Math.max(...entries.map(e => e.id)) + 1;
}

// View Management
function showView(viewName) {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.getElementById(`view-${viewName}`).classList.add('active');

    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.view === viewName);
    });

    if (viewName === 'dashboard') {
        renderDashboard();
    } else if (viewName === 'entry') {
        resetEntryForm();
    } else if (viewName === 'data') {
        renderDataTable();
    } else if (viewName === 'settings') {
        updateEntryCount();
    }
}

// Chart time-axis helpers
function isoToLocalDate(iso) {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y, m - 1, d);
}

// Trailing 3-month default window, anchored to the most recent date in the data
function threeMonthWindow(sortedAscEntries) {
    const lastISO = sortedAscEntries[sortedAscEntries.length - 1].date;
    const max = isoToLocalDate(lastISO);
    max.setDate(max.getDate() + 1); // pad a day so the last point isn't clipped
    const min = new Date(max);
    min.setMonth(min.getMonth() - 3);
    return { min: min.getTime(), max: max.getTime() };
}

// Full timestamp span of the data, used for zoom/pan limits
function dataSpan(sortedAscEntries) {
    const first = isoToLocalDate(sortedAscEntries[0].date).getTime();
    const last = isoToLocalDate(sortedAscEntries[sortedAscEntries.length - 1].date).getTime();
    return { min: first, max: last + 86400000 };
}

// Build a continuous day-by-day series so missing days render as gaps (null)
function buildDailySeries(sortedAscEntries, valueKey) {
    const byDate = {};
    sortedAscEntries.forEach(e => { byDate[e.date] = e[valueKey]; });

    const startISO = sortedAscEntries[0].date;
    const endISO = sortedAscEntries[sortedAscEntries.length - 1].date;
    const [sy, sm, sd] = startISO.split('-').map(Number);
    const [ey, em, ed] = endISO.split('-').map(Number);

    let t = Date.UTC(sy, sm - 1, sd);
    const end = Date.UTC(ey, em - 1, ed);
    const out = [];
    while (t <= end) {
        const iso = new Date(t).toISOString().slice(0, 10);
        out.push({ x: iso, y: (iso in byDate) ? byDate[iso] : null });
        t += 86400000;
    }
    return out;
}

const TIME_DISPLAY_FORMATS = {
    day: 'MMM d',
    week: 'MMM d',
    month: 'MMM yyyy'
};

// Dashboard
function renderDashboard() {    renderQuickStats();
    renderWeightChart();
    renderAlcoholChart();
    renderLipidChart();
    renderRecentEntries();
}

function renderQuickStats() {
    const sorted = [...entries].sort((a, b) => new Date(b.date) - new Date(a.date));

    // Find most recent entry with each value
    const latestWeight = sorted.find(e => e.weight);
    const latestWaist = sorted.find(e => e.waist);
    const latestBP = sorted.find(e => e.bp);

    document.getElementById('stat-weight').textContent = latestWeight ? latestWeight.weight.toFixed(1) : '--';
    document.getElementById('stat-waist').textContent = latestWaist ? latestWaist.waist.toFixed(2) : '--';
    document.getElementById('stat-bp').textContent = latestBP ? latestBP.bp : '--';
}

function renderWeightChart() {
    const ctx = document.getElementById('weight-chart').getContext('2d');

    // Get entries with weight or waist, sorted by date
    const allEntries = entries
        .filter(e => e.weight || e.waist)
        .sort((a, b) => new Date(a.date) - new Date(b.date));

    if (weightChart) {
        weightChart.destroy();
    }

    if (allEntries.length === 0) {
        return;
    }

    const windowBounds = threeMonthWindow(allEntries);

    weightChart = new Chart(ctx, {
        type: 'line',
        data: {
            datasets: [
                {
                    label: 'Weight (lbs)',
                    data: allEntries.map(e => ({ x: e.date, y: e.weight ?? null })),
                    borderColor: '#007AFF',
                    backgroundColor: 'rgba(0, 122, 255, 0.1)',
                    fill: true,
                    tension: 0.3,
                    pointRadius: 2,
                    pointHoverRadius: 5,
                    yAxisID: 'yWeight'
                },
                {
                    label: 'Waist (in)',
                    data: allEntries.map(e => ({ x: e.date, y: e.waist ?? null })),
                    borderColor: '#FF9500',
                    backgroundColor: 'transparent',
                    borderDash: [5, 5],
                    tension: 0.3,
                    pointRadius: 2,
                    pointHoverRadius: 5,
                    yAxisID: 'yWaist'
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            plugins: {
                legend: {
                    display: true,
                    position: 'bottom',
                    labels: { boxWidth: 12, font: { size: 10 } }
                }
            },
            scales: {
                x: {
                    type: 'time',
                    time: { tooltipFormat: 'MMM d, yyyy', displayFormats: TIME_DISPLAY_FORMATS },
                    min: windowBounds.min,
                    max: windowBounds.max,
                    display: true,
                    ticks: {
                        maxTicksLimit: 6,
                        font: { size: 10 }
                    }
                },
                yWeight: {
                    type: 'linear',
                    display: true,
                    position: 'left',
                    title: {
                        display: true,
                        text: 'lbs',
                        font: { size: 10 }
                    },
                    ticks: { font: { size: 10 } }
                },
                yWaist: {
                    type: 'linear',
                    display: true,
                    position: 'right',
                    title: {
                        display: true,
                        text: 'in',
                        font: { size: 10 }
                    },
                    ticks: { font: { size: 10 } },
                    grid: {
                        drawOnChartArea: false
                    }
                }
            }
        }
    });
}

function renderAlcoholChart() {
    const ctx = document.getElementById('alcohol-chart').getContext('2d');

    // Entries that recorded a drink count (0 is a valid value)
    const alcoholEntries = entries
        .filter(e => e.alcohol != null)
        .sort((a, b) => new Date(a.date) - new Date(b.date));

    if (alcoholChart) {
        alcoholChart.destroy();
    }

    if (alcoholEntries.length === 0) {
        return;
    }

    // Continuous daily series: missing days become gaps, recorded 0s stay visible
    const series = buildDailySeries(alcoholEntries, 'alcohol');
    const windowBounds = threeMonthWindow(alcoholEntries);

    alcoholChart = new Chart(ctx, {
        type: 'line',
        data: {
            datasets: [
                {
                    label: 'Drinks',
                    data: series,
                    borderColor: '#AF52DE',
                    backgroundColor: 'rgba(175, 82, 222, 0.15)',
                    fill: true,
                    spanGaps: false,
                    tension: 0,
                    stepped: false,
                    pointRadius: 2.5,
                    pointHoverRadius: 5
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            plugins: {
                legend: {
                    display: true,
                    position: 'bottom',
                    labels: { boxWidth: 12, font: { size: 10 } }
                }
            },
            scales: {
                x: {
                    type: 'time',
                    time: { tooltipFormat: 'MMM d, yyyy', displayFormats: TIME_DISPLAY_FORMATS },
                    min: windowBounds.min,
                    max: windowBounds.max,
                    display: true,
                    ticks: {
                        maxTicksLimit: 6,
                        font: { size: 10 }
                    }
                },
                y: {
                    display: true,
                    beginAtZero: true,
                    title: {
                        display: true,
                        text: 'drinks',
                        font: { size: 10 }
                    },
                    ticks: {
                        font: { size: 10 },
                        precision: 0
                    }
                }
            }
        }
    });
}

function renderLipidChart() {
    const ctx = document.getElementById('lipid-chart').getContext('2d');
    // Get entries with lipid data
    const lipidEntries = entries
        .filter(e => e.totalChol || e.ldl || e.hdl)
        .sort((a, b) => new Date(a.date) - new Date(b.date));

    if (lipidChart) {
        lipidChart.destroy();
    }

    if (lipidEntries.length === 0) {
        return;
    }

    lipidChart = new Chart(ctx, {
        type: 'line',
        data: {
            datasets: [
                {
                    label: 'Total',
                    data: lipidEntries.map(e => ({ x: e.date, y: e.totalChol ?? null })),
                    borderColor: '#FF9500',
                    backgroundColor: 'transparent',
                    tension: 0.3,
                    pointRadius: 3
                },
                {
                    label: 'LDL',
                    data: lipidEntries.map(e => ({ x: e.date, y: e.ldl ?? null })),
                    borderColor: '#FF3B30',
                    backgroundColor: 'transparent',
                    tension: 0.3,
                    pointRadius: 3
                },
                {
                    label: 'HDL',
                    data: lipidEntries.map(e => ({ x: e.date, y: e.hdl ?? null })),
                    borderColor: '#34C759',
                    backgroundColor: 'transparent',
                    tension: 0.3,
                    pointRadius: 3
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            plugins: {
                legend: {
                    display: true,
                    position: 'bottom',
                    labels: { boxWidth: 12, font: { size: 10 } }
                }
            },
            scales: {
                x: {
                    type: 'time',
                    time: { tooltipFormat: 'MMM d, yyyy', displayFormats: TIME_DISPLAY_FORMATS },
                    min: threeMonthWindow(lipidEntries).min,
                    max: threeMonthWindow(lipidEntries).max,
                    display: true,
                    ticks: {
                        maxTicksLimit: 6,
                        font: { size: 10 }
                    }
                },
                y: {
                    display: true,
                    ticks: { font: { size: 10 } }
                }
            }
        }
    });
}

function renderRecentEntries() {
    const container = document.getElementById('entries-list');
    const sorted = [...entries].sort((a, b) => new Date(b.date) - new Date(a.date));
    const recent = sorted.slice(0, 10);

    if (recent.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <p>No entries yet</p>
                <button class="btn-primary" onclick="showView('entry')">Add Your First Entry</button>
            </div>
        `;
        return;
    }

    container.innerHTML = recent.map(entry => `
        <div class="entry-item" onclick="editEntry(${entry.id})">
            <div>
                <div class="entry-date">${formatDate(entry.date)}</div>
                <div class="entry-summary">${getEntrySummary(entry)}</div>
            </div>
            <span>&rsaquo;</span>
        </div>
    `).join('');
}

function getEntrySummary(entry) {
    const parts = [];
    if (entry.weight) parts.push(`${entry.weight} lbs`);
    if (entry.waist) parts.push(`${entry.waist}" waist`);
    if (entry.bp) parts.push(entry.bp);
    if (entry.totalChol) parts.push(`TC: ${entry.totalChol}`);
    return parts.join(' | ') || 'No data';
}

// Entry Form
function setupEventListeners() {
    document.getElementById('health-form').addEventListener('submit', handleFormSubmit);
    document.getElementById('csv-import').addEventListener('change', handleCSVImport);
}

function resetEntryForm() {
    document.getElementById('health-form').reset();
    document.getElementById('entry-id').value = '';
    document.getElementById('entry-date').value = getTodayString();
    document.getElementById('entry-title').textContent = 'New Entry';
    document.getElementById('delete-btn').style.display = 'none';
    setAlcohol(0);
    applyFieldVisibility();
}

// Daily alcohol counter
function setAlcohol(count) {
    const value = Math.max(0, parseInt(count) || 0);
    document.getElementById('entry-alcohol').value = value;
    document.getElementById('entry-alcohol-display').textContent = value;
}

function changeAlcohol(delta) {
    const current = parseInt(document.getElementById('entry-alcohol').value) || 0;
    setAlcohol(current + delta);
}

function editEntry(id) {
    const entry = entries.find(e => e.id === id);
    if (!entry) return;

    showView('entry');

    document.getElementById('entry-id').value = entry.id;
    document.getElementById('entry-date').value = entry.date;
    document.getElementById('entry-weight').value = entry.weight || '';
    document.getElementById('entry-waist').value = entry.waist || '';
    document.getElementById('entry-total-chol').value = entry.totalChol || '';
    document.getElementById('entry-hdl').value = entry.hdl || '';
    document.getElementById('entry-ldl').value = entry.ldl || '';
    document.getElementById('entry-non-hdl').value = entry.nonHdl || '';
    document.getElementById('entry-trig').value = entry.triglycerides || '';
    document.getElementById('entry-bmi').value = entry.bmi || '';
    document.getElementById('entry-apob').value = entry.apoB || '';
    setAlcohol(entry.alcohol || 0);

    // Handle blood pressure
    if (entry.bp) {
        const [sys, dia] = entry.bp.split('/');
        document.getElementById('entry-bp-sys').value = sys || '';
        document.getElementById('entry-bp-dia').value = dia || '';
    } else {
        document.getElementById('entry-bp-sys').value = '';
        document.getElementById('entry-bp-dia').value = '';
    }

    document.getElementById('entry-title').textContent = 'Edit Entry';
    document.getElementById('delete-btn').style.display = 'block';
}

function handleFormSubmit(e) {
    e.preventDefault();

    const id = document.getElementById('entry-id').value;
    const bpSys = document.getElementById('entry-bp-sys').value;
    const bpDia = document.getElementById('entry-bp-dia').value;

    const entry = {
        id: id ? parseInt(id) : getNextId(),
        date: document.getElementById('entry-date').value,
        weight: parseFloatOrNull(document.getElementById('entry-weight').value),
        waist: parseFloatOrNull(document.getElementById('entry-waist').value),
        bp: (bpSys && bpDia) ? `${bpSys}/${bpDia}` : null,
        totalChol: parseFloatOrNull(document.getElementById('entry-total-chol').value),
        hdl: parseFloatOrNull(document.getElementById('entry-hdl').value),
        ldl: parseFloatOrNull(document.getElementById('entry-ldl').value),
        nonHdl: parseFloatOrNull(document.getElementById('entry-non-hdl').value),
        triglycerides: parseFloatOrNull(document.getElementById('entry-trig').value),
        bmi: parseFloatOrNull(document.getElementById('entry-bmi').value),
        apoB: parseFloatOrNull(document.getElementById('entry-apob').value),
        alcohol: parseIntOrNull(document.getElementById('entry-alcohol').value)
    };

    if (id) {
        const index = entries.findIndex(e => e.id === parseInt(id));
        if (index !== -1) {
            entries[index] = entry;
        }
    } else {
        entries.push(entry);
    }

    saveData();
    showToast(id ? 'Entry updated' : 'Entry saved');
    showView('dashboard');
}

function deleteEntry() {
    const id = document.getElementById('entry-id').value;
    if (!id) return;

    if (confirm('Delete this entry?')) {
        entries = entries.filter(e => e.id !== parseInt(id));
        saveData();
        showToast('Entry deleted');
        showView('dashboard');
    }
}

// Settings
function renderFieldToggles() {
    const container = document.getElementById('field-toggles');

    container.innerHTML = FIELDS.map(field => `
        <div class="field-toggle">
            <label>${field.label}</label>
            <label class="toggle-switch">
                <input type="checkbox"
                       data-field="${field.id}"
                       ${settings.visibleFields.includes(field.id) ? 'checked' : ''}
                       onchange="toggleField('${field.id}')">
                <span class="toggle-slider"></span>
            </label>
        </div>
    `).join('');
}

function toggleField(fieldId) {
    const index = settings.visibleFields.indexOf(fieldId);
    if (index === -1) {
        settings.visibleFields.push(fieldId);
    } else {
        settings.visibleFields.splice(index, 1);
    }
    saveSettings();
    applyFieldVisibility();
}

function applyFieldVisibility() {
    FIELDS.forEach(field => {
        const group = document.querySelector(`[data-field="${field.id}"]`);
        if (group) {
            group.classList.toggle('hidden', !settings.visibleFields.includes(field.id));
        }
    });
}

function updateEntryCount() {
    document.getElementById('entry-count').textContent = `${entries.length} entries stored`;
}

// CSV Import/Export
function handleCSVImport(e) {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
        const csv = event.target.result;
        const imported = parseCSV(csv);

        if (imported.length > 0) {
            entries = imported;
            saveData();
            showToast(`Imported ${imported.length} entries`);
            renderDashboard();
            updateEntryCount();
        } else {
            showToast('No valid entries found');
        }
    };
    reader.readAsText(file);
    e.target.value = ''; // Reset file input
}

function parseCSV(csv) {
    const lines = csv.split('\n');
    if (lines.length < 2) return [];

    const headers = lines[0].split(',').map(h => h.trim().replace(/^\uFEFF/, '')); // Remove BOM
    const results = [];

    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        const values = parseCSVLine(line);
        const row = {};

        headers.forEach((header, idx) => {
            row[header] = values[idx] || '';
        });

        // Skip empty rows
        if (!row['Date'] && !row['Weight']) continue;

        const entry = {
            id: parseInt(row['ID']) || getNextId(),
            date: parseDate(row['Date']),
            weight: parseFloatOrNull(row['Weight']),
            waist: parseFloatOrNull(row['Waist Circumference']),
            bp: row['Blood Pressure'] || null,
            totalChol: parseFloatOrNull(row['Total Chol']),
            hdl: parseFloatOrNull(row['HDL']),
            ldl: parseFloatOrNull(row['LDL']),
            nonHdl: parseFloatOrNull(row['Non-HDL']),
            triglycerides: parseFloatOrNull(row['Triglycerides']),
            bmi: parseFloatOrNull(row['BMI']),
            apoB: parseFloatOrNull(row['ApoB']),
            alcohol: parseIntOrNull(row['Alcohol'])
        };

        // Only include entries with at least a date
        if (entry.date) {
            results.push(entry);
        }
    }

    return results;
}

function parseCSVLine(line) {
    const values = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
        const char = line[i];

        if (char === '"') {
            inQuotes = !inQuotes;
        } else if (char === ',' && !inQuotes) {
            values.push(current.trim());
            current = '';
        } else {
            current += char;
        }
    }
    values.push(current.trim());

    return values;
}

function parseDate(dateStr) {
    if (!dateStr) return null;

    // Handle M/D/YYYY format
    const parts = dateStr.split('/');
    if (parts.length === 3) {
        const month = parts[0].padStart(2, '0');
        const day = parts[1].padStart(2, '0');
        const year = parts[2];
        return `${year}-${month}-${day}`;
    }

    // Already in YYYY-MM-DD format
    if (dateStr.includes('-')) {
        return dateStr;
    }

    return null;
}

function exportCSV() {
    const headers = ['ID', 'Date', 'Waist Circumference', 'Weight', 'Blood Pressure',
                     'Total Chol', 'HDL', 'LDL', 'Non-HDL', 'Triglycerides', 'BMI', 'ApoB', 'Alcohol'];

    const sorted = [...entries].sort((a, b) => new Date(b.date) - new Date(a.date));

    const rows = sorted.map(e => [
        e.id,
        formatDateForCSV(e.date),
        e.waist || '',
        e.weight || '',
        e.bp || '',
        e.totalChol || '',
        e.hdl || '',
        e.ldl || '',
        e.nonHdl || '',
        e.triglycerides || '',
        e.bmi || '',
        e.apoB || '',
        (e.alcohol === 0 || e.alcohol) ? e.alcohol : ''
    ]);

    const csv = [headers, ...rows].map(row => row.join(',')).join('\n');

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `health-tracker-export-${getTodayString()}.csv`;
    a.click();
    URL.revokeObjectURL(url);

    showToast('CSV exported');
}

function clearAllData() {
    if (confirm('Delete ALL entries? This cannot be undone.')) {
        if (confirm('Are you sure? All data will be permanently deleted.')) {
            entries = [];
            saveData();
            showToast('All data cleared');
            renderDashboard();
            updateEntryCount();
        }
    }
}

// Utilities
function parseFloatOrNull(value) {
    if (!value || value === '') return null;
    const num = parseFloat(value);
    return isNaN(num) ? null : num;
}

function parseIntOrNull(value) {
    if (value === null || value === undefined || value === '') return null;
    const num = parseInt(value);
    return isNaN(num) ? null : num;
}

function getTodayString() {
    return new Date().toISOString().split('T')[0];
}

function formatDate(dateStr) {
    if (!dateStr) return '';
    const date = new Date(dateStr + 'T00:00:00');
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatDateShort(dateStr) {
    if (!dateStr) return '';
    const date = new Date(dateStr + 'T00:00:00');
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatDateWithYear(dateStr) {
    if (!dateStr) return '';
    const date = new Date(dateStr + 'T00:00:00');
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' });
}

function formatDateForCSV(dateStr) {
    if (!dateStr) return '';
    const date = new Date(dateStr + 'T00:00:00');
    return `${date.getMonth() + 1}/${date.getDate()}/${date.getFullYear()}`;
}

function showToast(message) {
    let toast = document.querySelector('.toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.className = 'toast';
        document.body.appendChild(toast);
    }

    toast.textContent = message;
    toast.classList.add('show');

    setTimeout(() => {
        toast.classList.remove('show');
    }, 2000);
}

// Data Table
function renderDataTable() {
    const tbody = document.getElementById('data-table-body');
    const countEl = document.getElementById('data-count');

    const sorted = [...entries].sort((a, b) => new Date(b.date) - new Date(a.date));

    countEl.textContent = `${sorted.length} entries`;

    tbody.innerHTML = sorted.map(entry => `
        <tr onclick="editEntry(${entry.id})">
            <td>${formatDateShort(entry.date)}</td>
            <td>${entry.weight || '<span class="empty-cell">-</span>'}</td>
            <td>${entry.waist || '<span class="empty-cell">-</span>'}</td>
            <td>${entry.bp || '<span class="empty-cell">-</span>'}</td>
            <td>${entry.totalChol || '<span class="empty-cell">-</span>'}</td>
            <td>${entry.hdl || '<span class="empty-cell">-</span>'}</td>
            <td>${entry.ldl || '<span class="empty-cell">-</span>'}</td>
            <td>${entry.nonHdl || '<span class="empty-cell">-</span>'}</td>
            <td>${entry.triglycerides || '<span class="empty-cell">-</span>'}</td>
            <td>${entry.bmi || '<span class="empty-cell">-</span>'}</td>
            <td>${entry.apoB || '<span class="empty-cell">-</span>'}</td>
            <td>${(entry.alcohol === 0 || entry.alcohol) ? entry.alcohol : '<span class="empty-cell">-</span>'}</td>
        </tr>
    `).join('');
}

// Fullscreen Chart
function openChartFullscreen(chartType) {
    currentFullscreenType = chartType;
    const modal = document.getElementById('chart-fullscreen');
    const title = document.getElementById('fullscreen-title');

    if (chartType === 'weight') {
        title.textContent = 'Weight & Waist Trend';
    } else if (chartType === 'alcohol') {
        title.textContent = 'Alcohol Consumption';
    } else {
        title.textContent = 'Lipid Panel';
    }

    modal.classList.add('active');
    document.body.style.overflow = 'hidden';

    // Small delay to ensure modal is visible before rendering chart
    setTimeout(() => {
        renderFullscreenChart(chartType);
    }, 50);
}

function closeChartFullscreen() {
    const modal = document.getElementById('chart-fullscreen');
    modal.classList.remove('active');
    document.body.style.overflow = '';

    if (fullscreenChart) {
        fullscreenChart.destroy();
        fullscreenChart = null;
    }
    currentFullscreenType = null;
}

function resetChartZoom() {
    if (fullscreenChart) {
        fullscreenChart.resetZoom();
    }
}

function renderFullscreenChart(chartType) {
    const ctx = document.getElementById('fullscreen-chart').getContext('2d');

    if (fullscreenChart) {
        fullscreenChart.destroy();
    }

    if (chartType === 'weight') {
        renderFullscreenWeightChart(ctx);
    } else if (chartType === 'alcohol') {
        renderFullscreenAlcoholChart(ctx);
    } else {
        renderFullscreenLipidChart(ctx);
    }
}

function renderFullscreenWeightChart(ctx) {
    const allEntries = entries
        .filter(e => e.weight || e.waist)
        .sort((a, b) => new Date(a.date) - new Date(b.date));

    if (allEntries.length === 0) return;

    const windowBounds = threeMonthWindow(allEntries);
    const span = dataSpan(allEntries);

    // Target line: two points spanning the full date range
    const firstISO = allEntries[0].date;
    const lastISO = allEntries[allEntries.length - 1].date;
    const weightTargetData = [
        { x: firstISO, y: TARGETS.weight },
        { x: lastISO, y: TARGETS.weight }
    ];

    fullscreenChart = new Chart(ctx, {
        type: 'line',
        data: {
            datasets: [
                {
                    label: 'Weight (lbs)',
                    data: allEntries.map(e => ({ x: e.date, y: e.weight ?? null })),
                    borderColor: '#007AFF',
                    backgroundColor: 'rgba(0, 122, 255, 0.1)',
                    fill: true,
                    tension: 0.3,
                    pointRadius: 3,
                    pointHoverRadius: 6,
                    yAxisID: 'yWeight'
                },
                {
                    label: 'Waist (in)',
                    data: allEntries.map(e => ({ x: e.date, y: e.waist ?? null })),
                    borderColor: '#FF9500',
                    backgroundColor: 'transparent',
                    borderDash: [5, 5],
                    tension: 0.3,
                    pointRadius: 3,
                    pointHoverRadius: 6,
                    yAxisID: 'yWaist'
                },
                {
                    label: 'Target (175)',
                    data: weightTargetData,
                    borderColor: '#34C759',
                    backgroundColor: 'transparent',
                    borderDash: [10, 5],
                    borderWidth: 2,
                    pointRadius: 0,
                    pointHoverRadius: 0,
                    tension: 0,
                    yAxisID: 'yWeight'
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: true,
                    position: 'bottom',
                    labels: { boxWidth: 12, font: { size: 12 } }
                },
                zoom: {
                    pan: {
                        enabled: true,
                        mode: 'x',
                        threshold: 5
                    },
                    zoom: {
                        wheel: { enabled: false },
                        pinch: { enabled: true },
                        mode: 'x'
                    },
                    limits: {
                        x: { min: span.min, max: span.max, minRange: 10 * 86400000 }
                    }
                }
            },
            scales: {
                x: {
                    type: 'time',
                    time: { tooltipFormat: 'MMM d, yyyy', displayFormats: TIME_DISPLAY_FORMATS },
                    display: true,
                    min: windowBounds.min,
                    max: windowBounds.max,
                    ticks: {
                        maxTicksLimit: 8,
                        font: { size: 11 }
                    }
                },
                yWeight: {
                    type: 'linear',
                    display: true,
                    position: 'left',
                    title: {
                        display: true,
                        text: 'Weight (lbs)',
                        font: { size: 12 }
                    },
                    ticks: { font: { size: 11 } }
                },
                yWaist: {
                    type: 'linear',
                    display: true,
                    position: 'right',
                    title: {
                        display: true,
                        text: 'Waist (in)',
                        font: { size: 12 }
                    },
                    ticks: { font: { size: 11 } },
                    grid: { drawOnChartArea: false }
                }
            }
        }
    });
}

function renderFullscreenAlcoholChart(ctx) {
    const alcoholEntries = entries
        .filter(e => e.alcohol != null)
        .sort((a, b) => new Date(a.date) - new Date(b.date));

    if (alcoholEntries.length === 0) return;

    const series = buildDailySeries(alcoholEntries, 'alcohol');
    const windowBounds = threeMonthWindow(alcoholEntries);
    const span = dataSpan(alcoholEntries);

    // 7-day trailing average over the daily series (ignoring days with no entry)
    const trailingAvg = series.map((pt, i) => {
        const start = Math.max(0, i - 6);
        const window = series.slice(start, i + 1).map(p => p.y).filter(v => v != null);
        if (window.length === 0) return { x: pt.x, y: null };
        const sum = window.reduce((a, b) => a + b, 0);
        return { x: pt.x, y: Math.round((sum / window.length) * 10) / 10 };
    });

    fullscreenChart = new Chart(ctx, {
        type: 'line',
        data: {
            datasets: [
                {
                    label: 'Drinks',
                    data: series,
                    borderColor: '#AF52DE',
                    backgroundColor: 'rgba(175, 82, 222, 0.15)',
                    fill: true,
                    spanGaps: false,
                    tension: 0,
                    pointRadius: 3,
                    pointHoverRadius: 6,
                    order: 2
                },
                {
                    label: '7-day avg',
                    data: trailingAvg,
                    borderColor: '#FF9500',
                    backgroundColor: 'transparent',
                    borderWidth: 2,
                    spanGaps: true,
                    tension: 0.3,
                    pointRadius: 0,
                    pointHoverRadius: 4,
                    order: 1
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: true,
                    position: 'bottom',
                    labels: { boxWidth: 12, font: { size: 12 } }
                },
                zoom: {
                    pan: {
                        enabled: true,
                        mode: 'x',
                        threshold: 5
                    },
                    zoom: {
                        wheel: { enabled: false },
                        pinch: { enabled: true },
                        mode: 'x'
                    },
                    limits: {
                        x: { min: span.min, max: span.max, minRange: 7 * 86400000 }
                    }
                }
            },
            scales: {
                x: {
                    type: 'time',
                    time: { tooltipFormat: 'MMM d, yyyy', displayFormats: TIME_DISPLAY_FORMATS },
                    display: true,
                    min: windowBounds.min,
                    max: windowBounds.max,
                    ticks: {
                        maxTicksLimit: 8,
                        font: { size: 11 }
                    }
                },
                y: {
                    display: true,
                    beginAtZero: true,
                    title: {
                        display: true,
                        text: 'Drinks',
                        font: { size: 12 }
                    },
                    ticks: { font: { size: 11 }, precision: 0 }
                }
            }
        }
    });
}

function renderFullscreenLipidChart(ctx) {
    const lipidEntries = entries
        .filter(e => e.totalChol || e.ldl || e.hdl)
        .sort((a, b) => new Date(a.date) - new Date(b.date));

    if (lipidEntries.length === 0) return;

    const windowBounds = threeMonthWindow(lipidEntries);
    const span = dataSpan(lipidEntries);
    const firstISO = lipidEntries[0].date;
    const lastISO = lipidEntries[lipidEntries.length - 1].date;

    // Target lines: two points spanning the full date range
    const totalTarget = [{ x: firstISO, y: TARGETS.totalChol }, { x: lastISO, y: TARGETS.totalChol }];
    const ldlTarget = [{ x: firstISO, y: TARGETS.ldl }, { x: lastISO, y: TARGETS.ldl }];
    const hdlTarget = [{ x: firstISO, y: TARGETS.hdl }, { x: lastISO, y: TARGETS.hdl }];

    fullscreenChart = new Chart(ctx, {
        type: 'line',
        data: {
            datasets: [
                {
                    label: 'Total Chol',
                    data: lipidEntries.map(e => ({ x: e.date, y: e.totalChol ?? null })),
                    borderColor: '#FF9500',
                    backgroundColor: 'transparent',
                    tension: 0.3,
                    pointRadius: 4,
                    pointHoverRadius: 7
                },
                {
                    label: 'LDL',
                    data: lipidEntries.map(e => ({ x: e.date, y: e.ldl ?? null })),
                    borderColor: '#FF3B30',
                    backgroundColor: 'transparent',
                    tension: 0.3,
                    pointRadius: 4,
                    pointHoverRadius: 7
                },
                {
                    label: 'HDL',
                    data: lipidEntries.map(e => ({ x: e.date, y: e.hdl ?? null })),
                    borderColor: '#34C759',
                    backgroundColor: 'transparent',
                    tension: 0.3,
                    pointRadius: 4,
                    pointHoverRadius: 7
                },
                {
                    label: 'Total Target (<200)',
                    data: totalTarget,
                    borderColor: 'rgba(255, 149, 0, 0.4)',
                    backgroundColor: 'transparent',
                    borderDash: [10, 5],
                    borderWidth: 2,
                    pointRadius: 0,
                    pointHoverRadius: 0,
                    tension: 0
                },
                {
                    label: 'LDL Target (<100)',
                    data: ldlTarget,
                    borderColor: 'rgba(255, 59, 48, 0.4)',
                    backgroundColor: 'transparent',
                    borderDash: [10, 5],
                    borderWidth: 2,
                    pointRadius: 0,
                    pointHoverRadius: 0,
                    tension: 0
                },
                {
                    label: 'HDL Target (>60)',
                    data: hdlTarget,
                    borderColor: 'rgba(52, 199, 89, 0.4)',
                    backgroundColor: 'transparent',
                    borderDash: [10, 5],
                    borderWidth: 2,
                    pointRadius: 0,
                    pointHoverRadius: 0,
                    tension: 0
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: true,
                    position: 'bottom',
                    labels: { boxWidth: 12, font: { size: 12 } }
                },
                zoom: {
                    pan: {
                        enabled: true,
                        mode: 'x',
                        threshold: 5,
                        onPanStart: () => { console.log('Pan started'); return true; },
                        onPan: () => { console.log('Panning'); }
                    },
                    zoom: {
                        wheel: { enabled: false },
                        pinch: { enabled: true },
                        mode: 'x',
                        onZoomStart: () => { console.log('Zoom started'); return true; },
                        onZoom: () => { console.log('Zooming'); }
                    },
                    limits: {
                        x: { min: span.min, max: span.max, minRange: 3 * 86400000 }
                    }
                }
            },
            scales: {
                x: {
                    type: 'time',
                    time: { tooltipFormat: 'MMM d, yyyy', displayFormats: TIME_DISPLAY_FORMATS },
                    display: true,
                    min: windowBounds.min,
                    max: windowBounds.max,
                    ticks: {
                        maxTicksLimit: 8,
                        font: { size: 11 }
                    }
                },
                y: {
                    display: true,
                    title: {
                        display: true,
                        text: 'mg/dL',
                        font: { size: 12 }
                    },
                    ticks: { font: { size: 11 } }
                }
            }
        }
    });
}

// Make functions globally available
window.showView = showView;
window.editEntry = editEntry;
window.deleteEntry = deleteEntry;
window.toggleField = toggleField;
window.exportCSV = exportCSV;
window.clearAllData = clearAllData;
window.openChartFullscreen = openChartFullscreen;
window.closeChartFullscreen = closeChartFullscreen;
window.resetChartZoom = resetChartZoom;
