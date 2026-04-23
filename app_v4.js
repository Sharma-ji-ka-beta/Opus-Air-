/* ── app.js — Opus Air Hackathon Frontend ── */

const API = 'http://127.0.0.1:5000';
let currentRec = null;
let perfChart = null;
let activeCpFlight = 'OA101';
let lastData = null;
let simDelays = {}; // for the How-It-Works simulator

// ─────────────── CLOCK ───────────────
function tickClock() {
  const el = document.getElementById('live-clock');
  if (el) el.textContent = new Date().toLocaleTimeString('en-GB');
}
setInterval(tickClock, 1000);
tickClock();

// ─────────────── POLLING ───────────────
let backendOnline = false;

async function fetchStatus() {
  try {
    const res = await fetch(`${API}/api/status`);
    if (!res.ok) throw new Error('bad response');
    const data = await res.json();
    lastData = data;
    backendOnline = true;
    document.getElementById('live-clock').style.color = '';
    updateStats(data.stats);
    updateFlightsList(data.flights);
    updateCriticalPath(data.flights, activeCpFlight);
    updateChart(data.stats);
    fetchLogs();
  } catch (e) {
    if (!backendOnline) showOfflinePlaceholder();
  }
}
setInterval(fetchStatus, 3000);
fetchStatus();

function showOfflinePlaceholder() {
  // Show placeholder rows so the dashboard isn't blank
  const container = document.getElementById('flights-list');
  if (!container) return;
  const placeholderFlights = [
    { id: 'OA101', destination: 'Dubai',     gate: 'A3', status: 'Turnaround', scheduled_dep: '14:30', estimated_dep: '14:30', delay_minutes: 0,
      tasks: [{name:'Deboarding',status:'complete'},{name:'Cleaning',status:'complete'},{name:'Fueling',status:'in_progress'},{name:'Catering',status:'in_progress'},{name:'Boarding',status:'pending'}] },
    { id: 'OA204', destination: 'Singapore', gate: 'B1', status: 'Turnaround', scheduled_dep: '15:00', estimated_dep: '15:00', delay_minutes: 0,
      tasks: [{name:'Deboarding',status:'complete'},{name:'Cleaning',status:'in_progress'},{name:'Fueling',status:'pending'},{name:'Catering',status:'pending'},{name:'Boarding',status:'pending'}] },
    { id: 'OA315', destination: 'London',    gate: 'C7', status: 'Turnaround', scheduled_dep: '15:45', estimated_dep: '15:45', delay_minutes: 0,
      tasks: [{name:'Deboarding',status:'in_progress'},{name:'Cleaning',status:'pending'},{name:'Fueling',status:'pending'},{name:'Catering',status:'pending'},{name:'Boarding',status:'pending'}] },
  ];
  const byId = {};
  placeholderFlights.forEach(f => byId[f.id] = f);
  lastData = { flights: byId, stats: { active_turnarounds: 3, critical_alerts: 0, time_saved_today: 0, delays_prevented: 0, on_time_history: [95,92,88,91,94], time_labels: ['11:00','12:00','13:00','13:30','14:00'] } };
  updateStats(lastData.stats);
  updateFlightsList(lastData.flights);
  updateCriticalPath(lastData.flights, activeCpFlight);
  // Log a soft warning
  const logEl = document.getElementById('event-log');
  if (logEl) logEl.innerHTML = `<div class="log-entry warning"><span class="log-ts">${new Date().toLocaleTimeString('en-GB')}</span><span class="log-msg">Backend offline — showing static preview. Run: python app.py</span></div>`;
}

// ─────────────── STATS ───────────────
function updateStats(stats) {
  setText('stat-active',  stats.active_turnarounds);
  setText('stat-saved',   stats.time_saved_today);
  setText('stat-prevented', `${stats.delays_prevented} delay${stats.delays_prevented !== 1 ? 's' : ''} prevented`);

  const alertEl = document.getElementById('stat-alerts');
  alertEl.textContent = stats.critical_alerts;
  const alertSub = document.getElementById('stat-alerts-sub');
  if (stats.critical_alerts > 0) {
    alertEl.classList.add('critical');
    alertSub.textContent = `${stats.critical_alerts} flight${stats.critical_alerts > 1 ? 's' : ''} delayed`;
  } else {
    alertEl.classList.remove('critical');
    alertSub.textContent = 'All systems nominal';
  }

  const pct = stats.on_time_history?.slice(-1)[0] ?? 94;
  setText('stat-ontime', `${pct}%`);
}

// ─────────────── FLIGHTS LIST ───────────────
function updateFlightsList(flights) {
  const container = document.getElementById('flights-list');
  const arr = Object.values(flights);
  document.getElementById('flights-count').textContent = `${arr.length} flights`;

  container.innerHTML = arr.map(f => {
    const delayed = f.estimated_dep !== f.scheduled_dep;
    const dots = f.tasks.map(t =>
      `<div class="task-dot ${t.status}" title="${t.name}: ${t.progress}/${t.duration}m"></div>`
    ).join('');

    return `
      <div class="flight-row ${delayed ? 'delayed' : ''}" onclick="openFlightModal('${f.id}')">
        <div>
          <div class="flight-id">${f.id}</div>
          <div class="flight-dest">${f.destination}</div>
        </div>
        <div>
          <div style="font-size:.72rem;color:var(--text-dim)">Gate ${f.gate}</div>
          <div style="font-size:.72rem;color:var(--text-dim)">${f.status}</div>
        </div>
        <div class="flight-times">
          <div class="time-row">
            <span class="time-label">SCH</span>
            <span class="time-val">${f.scheduled_dep}</span>
          </div>
          <div class="time-row">
            <span class="time-label">EST</span>
            <span class="time-val ${delayed ? 'delayed' : ''}">${f.estimated_dep}${delayed ? ' ⚠' : ''}</span>
          </div>
        </div>
        <div class="task-dots">${dots}</div>
        <div class="flight-chevron">›</div>
      </div>`;
  }).join('');
}

// ─────────────── CRITICAL PATH ───────────────
function updateCriticalPath(flights, flightId) {
  const flight = flights[flightId];
  if (!flight) return;
  document.getElementById('cp-flight-label').textContent = flightId;
  const container = document.getElementById('critical-path-viz');

  // Split catering (parallel with fueling) out
  const mainPath = flight.tasks.filter(t => t.name !== 'Catering');
  const catering = flight.tasks.find(t => t.name === 'Catering');

  let html = '<div class="cp-row">';
  mainPath.forEach((task, i) => {
    const pct = task.duration > 0 ? Math.round((task.progress / task.duration) * 100) : 0;
    const cls = [task.status, task.is_critical ? 'critical' : ''].join(' ').trim();

    // Insert catering parallel with fueling
    if (task.name === 'Fueling' && catering) {
      html += `
        <div class="cp-parallel">
          ${taskBox(task, pct, cls)}
          ${taskBox(catering, Math.round((catering.progress/catering.duration)*100),
            [catering.status, catering.is_critical ? 'critical':''].join(' ').trim())}
        </div>`;
    } else {
      html += taskBox(task, pct, cls);
    }

    if (i < mainPath.length - 1) {
      html += `<div class="cp-arrow">→</div>`;
    }
  });
  html += '</div>';
  container.innerHTML = html;
}

function taskBox(task, pct, cls) {
  return `
    <div class="cp-node">
      <div class="cp-box ${cls}">
        ${task.name}
        <span class="cp-dur">${task.duration}m</span>
      </div>
      <div class="cp-progress-bar">
        <div class="cp-progress-fill" style="width:${pct}%"></div>
      </div>
    </div>`;
}

// CP tab switching
document.querySelectorAll('.cp-tab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.cp-tab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    activeCpFlight = btn.dataset.flight;
    if (lastData) updateCriticalPath(lastData.flights, activeCpFlight);
  });
});

// ─────────────── CHART ───────────────
function initChart() {
  const ctx = document.getElementById('perf-chart')?.getContext('2d');
  if (!ctx) return;
  perfChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: ['11:00','12:00','13:00','13:30','14:00'],
      datasets: [{
        label: 'On-Time %',
        data: [95, 92, 88, 91, 94],
        borderColor: '#38bdf8',
        backgroundColor: 'rgba(56, 189, 248, 0.12)',
        borderWidth: 2.5,
        tension: 0.4,
        pointBackgroundColor: '#38bdf8',
        pointRadius: 4,
        fill: true,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        y: {
          min: 50, max: 100,
          ticks: { callback: v => v + '%', font: { family: 'IBM Plex Mono' } },
          grid: { color: 'rgba(255,255,255,0.08)' }
        },
        x: {
          ticks: { font: { family: 'IBM Plex Mono', size: 10 } },
          grid: { display: false }
        }
      }
    }
  });
}

function updateChart(stats) {
  if (!perfChart || !stats.on_time_history?.length) return;
  perfChart.data.labels = stats.time_labels;
  perfChart.data.datasets[0].data = stats.on_time_history;
  perfChart.update('none');
}

// ─────────────── EVENT LOG ───────────────
async function fetchLogs() {
  try {
    const res = await fetch(`${API}/api/logs`);
    const data = await res.json();
    const logs = data.logs ?? [];
    document.getElementById('log-count').textContent = `${logs.length} events`;
    const el = document.getElementById('event-log');
    el.innerHTML = [...logs].reverse().map(l =>
      `<div class="log-entry ${l.level}">
        <span class="log-ts">${l.ts}</span>
        <span class="log-msg">${l.message}</span>
      </div>`
    ).join('');
  } catch (e) {}
}

// ─────────────── DELAY INJECTION MODAL ───────────────
document.getElementById('btn-open-modal').addEventListener('click', () => {
  document.getElementById('delay-modal').classList.remove('hidden');
});
document.getElementById('btn-close-modal').addEventListener('click', closeDelayModal);
document.getElementById('btn-cancel-modal').addEventListener('click', closeDelayModal);
document.getElementById('delay-modal').addEventListener('click', e => {
  if (e.target === e.currentTarget) closeDelayModal();
});

function closeDelayModal() {
  document.getElementById('delay-modal').classList.add('hidden');
}

// Preset buttons
document.querySelectorAll('.preset-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.getElementById('inp-minutes').value = btn.dataset.val;
  });
});

document.getElementById('btn-confirm-inject').addEventListener('click', async () => {
  const flightId = document.getElementById('sel-flight').value;
  const task     = document.getElementById('sel-task').value;
  const minutes  = parseInt(document.getElementById('inp-minutes').value, 10);

  document.getElementById('btn-confirm-inject').textContent = 'Analyzing…';
  document.getElementById('btn-confirm-inject').disabled = true;

  try {
    const res = await fetch(`${API}/api/inject_delay`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ flight_id: flightId, task, minutes })
    });
    const data = await res.json();
    closeDelayModal();
    showRecommendation(data.recommendation);
    fetchStatus();
  } catch (e) {
    alert('Backend not reachable — is app.py running?');
  } finally {
    document.getElementById('btn-confirm-inject').textContent = 'Inject & Analyze →';
    document.getElementById('btn-confirm-inject').disabled = false;
  }
});

// ─────────────── RECOMMENDATION PANEL ───────────────
function showRecommendation(rec) {
  currentRec = rec;
  document.getElementById('rec-idle').classList.add('hidden');
  document.getElementById('rec-success').classList.add('hidden');
  document.getElementById('rec-active').classList.remove('hidden');

  document.getElementById('rec-text').textContent = rec.text;
  document.getElementById('rec-save-label').textContent = `+${rec.minutes_saved} min saved`;
  document.getElementById('rec-flight-label').textContent = rec.flight_id;
  document.getElementById('rec-confidence-badge').textContent = `${rec.confidence ?? 'Medium'} Confidence`;
}

document.getElementById('btn-accept').addEventListener('click', async () => {
  if (!currentRec) return;
  try {
    const res = await fetch(`${API}/api/accept_recommendation`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(currentRec)
    });
    const data = await res.json();

    document.getElementById('rec-active').classList.add('hidden');
    document.getElementById('rec-success').classList.remove('hidden');
    document.getElementById('rec-success-sub').textContent =
      `${currentRec.flight_id} updated. Total saved today: ${data.time_saved_today} min.`;

    document.getElementById('ai-panel').classList.add('accepted');
    setTimeout(() => {
      document.getElementById('ai-panel').classList.remove('accepted');
    }, 900);

    currentRec = null;
    fetchStatus();
  } catch (e) { alert('Backend error.'); }
});

document.getElementById('btn-dismiss').addEventListener('click', () => {
  document.getElementById('rec-active').classList.add('hidden');
  document.getElementById('rec-idle').classList.remove('hidden');
  currentRec = null;
});

// ─────────────── FLIGHT DETAIL MODAL ───────────────
function openFlightModal(flightId) {
  const flight = lastData?.flights?.[flightId];
  if (!flight) return;

  document.getElementById('flight-modal-title').textContent =
    `${flightId} · ${flight.destination} · Gate ${flight.gate}`;

  const delayed = flight.estimated_dep !== flight.scheduled_dep;
  const body = document.getElementById('flight-modal-body');

  const taskRows = flight.tasks.map(t => {
    const pct = t.duration > 0 ? Math.round((t.progress / t.duration) * 100) : 0;
    const barColor = t.status === 'complete' ? 'var(--green)'
                   : t.status === 'in_progress' ? 'var(--amber)'
                   : 'rgba(255,255,255,0.08)';
    return `
      <div class="fmd-task-row">
        <div class="task-dot ${t.status}"></div>
        <div class="fmd-task-name">${t.name}${t.is_critical ? ' <span style="color:var(--amber);font-size:.7rem">★ critical</span>' : ''}</div>
        <div class="fmd-bar"><div class="fmd-bar-fill" style="width:${pct}%;background:${barColor}"></div></div>
        <div class="fmd-task-prog">${t.progress}/${t.duration}m</div>
      </div>`;
  }).join('');

  body.innerHTML = `
    <div class="fmd-grid">
      <div><div class="fmd-label">Scheduled</div><div class="fmd-val">${flight.scheduled_dep}</div></div>
      <div><div class="fmd-label">Estimated</div><div class="fmd-val ${delayed ? 'time-val delayed' : ''}">${flight.estimated_dep}${delayed ? ' ⚠' : ''}</div></div>
      <div><div class="fmd-label">Total Delay</div><div class="fmd-val" style="color:${flight.delay_minutes > 0 ? 'var(--red)' : 'var(--green)'}">${flight.delay_minutes} min</div></div>
      <div><div class="fmd-label">Status</div><div class="fmd-val">${flight.status}</div></div>
    </div>
    <div class="fmd-tasks">
      <div class="fmd-label" style="margin-bottom:.5rem">Task Progress</div>
      ${taskRows}
    </div>`;

  document.getElementById('flight-modal').classList.remove('hidden');
}

document.getElementById('btn-close-flight-modal').addEventListener('click', () => {
  document.getElementById('flight-modal').classList.add('hidden');
});
document.getElementById('flight-modal').addEventListener('click', e => {
  if (e.target === e.currentTarget)
    document.getElementById('flight-modal').classList.add('hidden');
});

// ─────────────── RESET ───────────────
document.getElementById('btn-reset').addEventListener('click', async () => {
  if (!confirm('Reset simulation to initial state?')) return;
  try {
    await fetch(`${API}/api/reset`, { method: 'POST' });
    currentRec = null;
    document.getElementById('rec-active').classList.add('hidden');
    document.getElementById('rec-success').classList.add('hidden');
    document.getElementById('rec-idle').classList.remove('hidden');
    fetchStatus();
  } catch (e) { alert('Backend not reachable.'); }
});

// ─────────────── TAB NAVIGATION ───────────────
function showPage(pageId) {
  document.querySelectorAll('.page').forEach(p => {
    p.style.display = 'none';
    p.classList.remove('active');
  });
  document.querySelectorAll('.tab').forEach(b => b.classList.remove('active'));
  const page = document.getElementById(`page-${pageId}`);
  if (page) { page.style.display = 'block'; page.classList.add('active'); }
  const tab = document.querySelector(`.tab[data-page="${pageId}"]`);
  if (tab) tab.classList.add('active');
  if (pageId === 'how') {
    simDelays = {};
    renderSimTimeline();
  }
}

document.querySelectorAll('.tab').forEach(btn => {
  btn.addEventListener('click', () => showPage(btn.dataset.page));
});

// Init first page
showPage('dashboard');

// ─────────────── HOW IT WORKS — SIMULATOR ───────────────
const SIM_TASKS = [
  { name: 'Deboarding', duration: 10, status: 'complete',    critical: true },
  { name: 'Cleaning',   duration: 15, status: 'complete',    critical: true },
  { name: 'Fueling',    duration: 25, status: 'in_progress', critical: true },
  { name: 'Catering',   duration: 20, status: 'in_progress', critical: false },
  { name: 'Boarding',   duration: 30, status: 'pending',     critical: true },
];

function renderSimTimeline() {
  const container = document.getElementById('sim-timeline');
  if (!container) return;
  container.innerHTML = SIM_TASKS.map(t => {
    const extra = simDelays[t.name] ? ` <span style="color:var(--red);font-size:.7rem">+${simDelays[t.name]}m</span>` : '';
    const clickable = t.status !== 'complete' ? `onclick="simInjectDelay('${t.name}')"` : '';
    return `<div class="sim-task ${t.status}" ${clickable}>
      <span>${t.name}</span>
      <span>${t.duration}m${extra}</span>
    </div>`;
  }).join('');
  // cascade result
  let cascade = 0;
  SIM_TASKS.forEach(t => { if (simDelays[t.name] && t.critical) cascade += simDelays[t.name]; });
  const el = document.getElementById('sim-delay-output');
  if (el) {
    el.textContent = `${cascade} minute${cascade !== 1 ? 's' : ''}`;
    el.style.color = cascade > 0 ? 'var(--red)' : 'var(--olive)';
  }
}

function simInjectDelay(taskName) {
  const task = SIM_TASKS.find(t => t.name === taskName);
  if (!task || task.status === 'complete') return;
  simDelays[taskName] = (simDelays[taskName] || 0) + 10;
  renderSimTimeline();
}

// Legacy alias
function buildSimTimeline() { simDelays = {}; renderSimTimeline(); }

// ─────────────── HELPERS ───────────────
function setText(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

// ─────────────── INIT ───────────────
initChart();
