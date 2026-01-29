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
    { id: 'apoB', label: 'ApoB', csvHeader: 'ApoB' }
];

// State
let entries = [];
let settings = {
    visibleFields: FIELDS.map(f => f.id)
};
let weightChart = null;
let lipidChart = null;

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    loadData();
    loadSettings();
    setupEventListeners();
    renderDashboard();
    renderFieldToggles();
    applyFieldVisibility();
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
    } else if (viewName === 'settings') {
        updateEntryCount();
    }
}

// Dashboard
function renderDashboard() {
    renderQuickStats();
    renderWeightChart();
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

    // Show last 90 entries initially, but allow scrolling to see all
    const initialVisibleCount = Math.min(90, allEntries.length);
    const minIndex = Math.max(0, allEntries.length - initialVisibleCount);

    weightChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: allEntries.map(e => formatDateWithYear(e.date)),
            datasets: [
                {
                    label: 'Weight (lbs)',
                    data: allEntries.map(e => e.weight || null),
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
                    data: allEntries.map(e => e.waist || null),
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
                },
                zoom: {
                    pan: {
                        enabled: true,
                        mode: 'x',
                        modifierKey: null,
                        onPanStart: function({chart, point}) {
                            return true;
                        }
                    },
                    limits: {
                        x: { min: 0, max: allEntries.length - 1 }
                    }
                }
            },
            scales: {
                x: {
                    display: true,
                    min: minIndex,
                    max: allEntries.length - 1,
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
            labels: lipidEntries.map(e => formatDateWithYear(e.date)),
            datasets: [
                {
                    label: 'Total',
                    data: lipidEntries.map(e => e.totalChol || null),
                    borderColor: '#FF9500',
                    backgroundColor: 'transparent',
                    tension: 0.3,
                    pointRadius: 3
                },
                {
                    label: 'LDL',
                    data: lipidEntries.map(e => e.ldl || null),
                    borderColor: '#FF3B30',
                    backgroundColor: 'transparent',
                    tension: 0.3,
                    pointRadius: 3
                },
                {
                    label: 'HDL',
                    data: lipidEntries.map(e => e.hdl || null),
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
                },
                zoom: {
                    pan: {
                        enabled: true,
                        mode: 'x'
                    },
                    limits: {
                        x: { min: 0, max: lipidEntries.length - 1 }
                    }
                }
            },
            scales: {
                x: {
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
    applyFieldVisibility();
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
        apoB: parseFloatOrNull(document.getElementById('entry-apob').value)
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
            apoB: parseFloatOrNull(row['ApoB'])
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
                     'Total Chol', 'HDL', 'LDL', 'Non-HDL', 'Triglycerides', 'BMI', 'ApoB'];

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
        e.apoB || ''
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

// Make functions globally available
window.showView = showView;
window.editEntry = editEntry;
window.deleteEntry = deleteEntry;
window.toggleField = toggleField;
window.exportCSV = exportCSV;
window.clearAllData = clearAllData;
