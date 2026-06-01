// ─── CSP-SAFE EVENT DELEGATION ──────────────────────────
// Inline on*= handlers were removed so the CSP can drop 'unsafe-inline'.
// Markup declares behaviour via data-<event>="fnName" + optional
// data-<event>-args (a JSON array). Arg tokens: "$el" -> the element,
// "$value" -> el.value, "$event" -> the event. Bare data-stop / data-prevent
// map to stopPropagation() / preventDefault().
(function () {
  var EVENTS = { click: 'data-click', input: 'data-input', change: 'data-change', submit: 'data-submit' };
  function resolveArg(a, el, e) {
    if (a === '$el') return el;
    if (a === '$value') return el.value;
    if (a === '$event') return e;
    return a;
  }
  Object.keys(EVENTS).forEach(function (evt) {
    var attr = EVENTS[evt];
    document.addEventListener(evt, function (e) {
      var t = e.target;
      if (!t || !t.closest) return;
      var el = t.closest('[' + attr + ']');
      if (!el) return;
      if (el.hasAttribute('data-prevent')) e.preventDefault();
      if (el.hasAttribute('data-stop')) e.stopPropagation();
      var name = el.getAttribute(attr);
      if (!name) return;
      var fn = window[name];
      if (typeof fn !== 'function') return;
      var raw = el.getAttribute(attr + '-args');
      var args = raw ? JSON.parse(raw).map(function (a) { return resolveArg(a, el, e); }) : [];
      fn.apply(el, args);
    });
  });
})();

// Helper for handlers that just click another element (e.g. hidden file inputs).
function clickEl(id) { var el = document.getElementById(id); if (el) el.click(); }

// ─── API BASE ───────────────────────────────────────────
const FUNCTIONS_BASE = 'https://hbiquvmldtoinqtmbvgd.supabase.co/functions/v1';

// ─── AUTH TOKEN ─────────────────────────────────────────
function getAuthToken() { return localStorage.getItem('pwt_token') || ''; }
function setAuthToken(token) { localStorage.setItem('pwt_token', token); }
function clearAuthToken() { localStorage.removeItem('pwt_token'); }
function authHeaders(extra = {}) {
  const h = { ...extra };
  const token = getAuthToken();
  if (token) h['Authorization'] = 'Bearer ' + token;
  return h;
}

// ─── PUSH NOTIFICATIONS ────────────────────────────────
const VAPID_PUBLIC_KEY = 'BL29sKEeP1_D13VrWxN8kEMe8UbJi7Jkq8Jeo1Tn9ehdx4ZHo08rlqugwhZyaUXg3pNYW5KzZNIeaht2VwLkvfw';
let swRegistration = null;

async function initServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  try {
    swRegistration = await navigator.serviceWorker.register('/sw.js');
    console.log('SW registered');
  } catch (err) {
    console.error('SW registration failed:', err);
  }
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

async function subscribeToPush() {
  if (!swRegistration) return;
  try {
    let sub = await swRegistration.pushManager.getSubscription();
    if (!sub) {
      sub = await swRegistration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      });
    }
    // Send subscription to backend
    await fetch(FUNCTIONS_BASE + '/subscribe', {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ subscription: sub.toJSON() }),
    });
    localStorage.setItem('pwt_push_enabled', '1');
    showToast('Notifications enabled', 'success');
    updateNotifButton();
  } catch (err) {
    console.error('Push subscribe error:', err);
    if (Notification.permission === 'denied') {
      showToast('Notifications blocked. Enable in browser settings.', 'error');
    } else {
      showToast('Could not enable notifications', 'error');
    }
  }
}

async function unsubscribeFromPush() {
  if (!swRegistration) return;
  try {
    const sub = await swRegistration.pushManager.getSubscription();
    if (sub) {
      const endpoint = sub.endpoint;
      await sub.unsubscribe();
      await fetch(FUNCTIONS_BASE + '/subscribe', {
        method: 'DELETE',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ endpoint }),
      });
    }
    localStorage.removeItem('pwt_push_enabled');
    showToast('Notifications disabled', 'success');
    updateNotifButton();
  } catch (err) {
    console.error('Push unsubscribe error:', err);
  }
}

function isIOSSafari() {
  return /iP(hone|ad|od)/.test(navigator.userAgent) && !navigator.standalone;
}

function toggleNotifications() {
  if (isIOSSafari()) {
    showToast('To get notifications on iPhone: tap the Share button ↑ then "Add to Home Screen", then open the app and tap Notify again.', 'error', 6000);
    return;
  }
  if (!('PushManager' in window)) {
    showToast('Push notifications are not supported on this browser.', 'error');
    return;
  }
  if (localStorage.getItem('pwt_push_enabled') === '1') {
    unsubscribeFromPush();
  } else {
    subscribeToPush();
  }
}

function updateNotifButton() {
  const btn = document.getElementById('notifToggleBtn');
  if (!btn) return;
  const enabled = localStorage.getItem('pwt_push_enabled') === '1';
  const svg = enabled
    ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 01-3.46 0"/></svg>'
    : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 01-3.46 0"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';
  btn.innerHTML = svg + '<span class="btn-label">' + (enabled ? 'On' : 'Notify') + '</span>';
  btn.title = enabled ? 'Disable notifications' : 'Enable notifications';
  if (enabled) {
    btn.classList.remove('btn-ghost');
    btn.classList.add('btn-primary');
  } else {
    btn.classList.remove('btn-primary');
    btn.classList.add('btn-ghost');
  }
}

// Register SW on page load
initServiceWorker();

// ─── GEOLOCATION TRACKING ──────────────────────────────
let _locationInterval = null;

function startLocationTracking() {
  if (!('geolocation' in navigator)) return;
  // Send location immediately, then every 10 minutes
  sendLocation();
  if (_locationInterval) clearInterval(_locationInterval);
  _locationInterval = setInterval(sendLocation, 10 * 60 * 1000);
}

function sendLocation() {
  if (!getAuthToken()) { console.warn('[loc] no auth token'); return; }
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      console.log('[loc] got position:', pos.coords.latitude.toFixed(4), pos.coords.longitude.toFixed(4));
      fetch(FUNCTIONS_BASE + '/location', {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      }).then(r => {
        if (!r.ok) r.text().then(t => console.error('[loc] server error', r.status, t));
        else console.log('[loc] sent ok');
      }).catch(err => console.error('[loc] network error', err));
    },
    (err) => console.warn('[loc] geolocation error', err.code, err.message),
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 300000 }
  );
}

function stopLocationTracking() {
  if (_locationInterval) { clearInterval(_locationInterval); _locationInterval = null; }
}

// ─── LOCATION MAP (admin) ──────────────────────────────
let _locationMap = null;
let _locationMarkers = [];

async function loadLocationMap() {
  if (currentEngineer?.role !== 'admin') return;

  try {
    const res = await fetch(FUNCTIONS_BASE + '/location', { headers: authHeaders() });
    if (!res.ok) throw new Error('Failed to load locations');
    const data = await res.json();
    const locations = data.locations || [];

    renderLocationMap(locations);
  } catch (err) {
    console.error('Location load error:', err);
    document.getElementById('locationList').innerHTML =
      '<div style="text-align:center;padding:40px;color:var(--text-muted);">Could not load engineer locations</div>';
  }
}

function renderLocationMap(locations) {
  const container = document.getElementById('locationMap');

  // Initialize map if needed
  if (!_locationMap) {
    _locationMap = L.map(container).setView([30.05, 31.25], 6); // Default: Egypt
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap',
      maxZoom: 18,
    }).addTo(_locationMap);
  }

  // Clear existing markers
  _locationMarkers.forEach(m => _locationMap.removeLayer(m));
  _locationMarkers = [];

  if (locations.length === 0) {
    document.getElementById('locationList').innerHTML =
      '<div style="text-align:center;padding:20px;color:var(--text-muted);">No engineer locations available yet. Engineers need to allow location access.</div>';
    return;
  }

  // Unique color palette for engineers
  const ENG_COLORS = [
    { fill: '#3b82f6', stroke: '#2563eb' },  // blue
    { fill: '#f97316', stroke: '#ea580c' },  // orange
    { fill: '#10b981', stroke: '#059669' },  // emerald
    { fill: '#a855f7', stroke: '#9333ea' },  // purple
    { fill: '#f43f5e', stroke: '#e11d48' },  // rose
    { fill: '#eab308', stroke: '#ca8a04' },  // yellow
    { fill: '#06b6d4', stroke: '#0891b2' },  // cyan
    { fill: '#ec4899', stroke: '#db2777' },  // pink
    { fill: '#14b8a6', stroke: '#0d9488' },  // teal
    { fill: '#f59e0b', stroke: '#d97706' },  // amber
  ];
  const STALE_COLOR = { fill: '#6b7280', stroke: '#4b5563' };

  // Assign a stable color per engineer ID
  const idToColor = {};
  locations.forEach((loc, i) => { idToColor[loc.id] = ENG_COLORS[i % ENG_COLORS.length]; });

  // Add markers
  const bounds = [];
  locations.forEach(loc => {
    const timeDiff = Date.now() - new Date(loc.updatedAt).getTime();
    const minsAgo = Math.round(timeDiff / 60000);
    const timeLabel = minsAgo < 1 ? 'just now' : minsAgo < 60 ? minsAgo + 'm ago' : Math.round(minsAgo / 60) + 'h ago';
    const isStale = timeDiff > 60 * 60 * 1000; // >1 hour
    const col = isStale ? STALE_COLOR : idToColor[loc.id];

    const marker = L.circleMarker([loc.lat, loc.lng], {
      radius: 10,
      fillColor: col.fill,
      color: col.stroke,
      weight: 2,
      opacity: 1,
      fillOpacity: 0.8,
    }).addTo(_locationMap);

    marker.bindPopup(
      '<div style="font-family:DM Sans,sans-serif;min-width:120px;">' +
        '<strong>' + esc(loc.fullName) + '</strong><br>' +
        '<span style="font-size:12px;color:#888;">' + esc(loc.role) + '</span><br>' +
        '<span style="font-size:11px;color:' + (isStale ? '#ef4444' : '#22c55e') + ';">' + timeLabel + '</span>' +
      '</div>'
    );

    _locationMarkers.push(marker);
    bounds.push([loc.lat, loc.lng]);
  });

  if (bounds.length > 0) {
    _locationMap.fitBounds(bounds, { padding: [40, 40], maxZoom: 14 });
  }

  // Render list below map
  document.getElementById('locationList').innerHTML = locations.map(loc => {
    const timeDiff = Date.now() - new Date(loc.updatedAt).getTime();
    const minsAgo = Math.round(timeDiff / 60000);
    const timeLabel = minsAgo < 1 ? 'just now' : minsAgo < 60 ? minsAgo + 'm ago' : Math.round(minsAgo / 60) + 'h ago';
    const isStale = timeDiff > 60 * 60 * 1000;
    const dotColor = isStale ? STALE_COLOR.fill : idToColor[loc.id].fill;
    return '<div class="detail-card" style="display:flex;justify-content:space-between;align-items:center;cursor:pointer;" data-click="panToEngineer" data-click-args="[' + loc.lat + ',' + loc.lng + ']">' +
      '<div style="display:flex;align-items:center;gap:10px;">' +
        '<span style="display:inline-block;width:12px;height:12px;border-radius:50%;background:' + dotColor + ';flex-shrink:0;"></span>' +
        '<span><strong>' + esc(loc.fullName) + '</strong> <span style="color:var(--text-muted);font-size:12px;">(' + esc(loc.role) + ')</span></span>' +
      '</div>' +
      '<div style="font-size:12px;color:' + (isStale ? 'var(--red)' : 'var(--green)') + ';">' + timeLabel + '</div>' +
    '</div>';
  }).join('');

  // Fix map rendering (Leaflet needs invalidateSize after container is shown)
  setTimeout(() => _locationMap.invalidateSize(), 100);
}

function panToEngineer(lat, lng) {
  if (_locationMap) _locationMap.setView([lat, lng], 15);
}

// ─── DATA ───────────────────────────────────────────────
let sites = [];
let clients = [];
let editingId = null;
let pendingEntry = null;
let filterStatus = 'All';
let sortCol = 'name';
let sortAsc = true;
let currentEngineer = null; // { id, fullName, role }
let activeTab = 'leads';
let _suppressRoute = false;

function setCurrentEngineer(eng) {
  currentEngineer = eng;
  const nameEl = document.getElementById('engineerName');
  if (nameEl) nameEl.textContent = eng?.fullName || '';
  // Show/hide admin features
  const adminEls = document.querySelectorAll('.admin-only');
  adminEls.forEach(el => el.style.display = eng?.role === 'admin' ? '' : 'none');
  // Update notification bell state
  updateNotifButton();
}

const STATUS_MAP = {
  'Potential Prospect': 'badge-pp',
  'Qualified Prospect': 'badge-qp',
  'Interested Prospect': 'badge-ip',
  'Hot Prospect': 'badge-hp',
  'Hot Lead': 'badge-hp',
  'Follow Up': 'badge-ip',
  'Active': 'badge-qp',
  'Pending': 'badge-pp',
  'Closed Won': 'badge-closed',
  'Lost': 'badge-lost',
};
const EQUIP_OPTS = [
  { key: 'boilers',  label: 'Boilers',       match: ['boiler'] },
  { key: 'cooling',  label: 'Cooling Towers', match: ['cooling','tower'] },
  { key: 'chillers', label: 'Chillers',       match: ['chiller'] },
  { key: 'pools',    label: 'Swimming Pools', match: ['swimming','pool'] },
];
function equipChipsHTML(prefix, val) {
  const lower = (val || '').toLowerCase();
  return '<div class="equip-chips">' + EQUIP_OPTS.map(o => {
    const checked = o.match.some(m => lower.includes(m)) ? ' checked' : '';
    return `<span class="equip-chip"><input type="checkbox" id="${prefix}_${o.key}" value="${o.label}"${checked}><label for="${prefix}_${o.key}">${o.label}</label></span>`;
  }).join('') + '</div>';
}
function readEquipChips(prefix) {
  return EQUIP_OPTS.filter(o => document.getElementById(`${prefix}_${o.key}`)?.checked).map(o => o.label).join(', ');
}

const STATUS_SHORT = {
  'Potential Prospect': 'PP',
  'Qualified Prospect': 'QP',
  'Interested Prospect': 'IP',
  'Hot Prospect': 'HP',
  'Hot Lead': 'HP',
  'Follow Up': 'IP',
  'Active': 'QP',
  'Pending': 'PP',
};

async function saveSite(site) {
  const res = await fetch(FUNCTIONS_BASE + '/sites', {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ site })
  });
  if (res.status === 401) { showLogin(); throw new Error('unauthorized'); }
  if (!res.ok) throw new Error('save failed');
  const data = await res.json().catch(() => ({}));
  return data;
}

async function deleteSite(id) {
  const res = await fetch(FUNCTIONS_BASE + '/sites?id=' + encodeURIComponent(id), { method: 'DELETE', headers: authHeaders() });
  if (res.status === 401) { showLogin(); throw new Error('unauthorized'); }
  if (!res.ok) throw new Error('delete failed');
}

// ─── PAGINATION ────────────────────────────────────────
// Server endpoints are paginated (limit/offset). These helpers page through
// all results so the existing client-side search/sort/stats keep working,
// while each request stays bounded (no silent truncation at large row counts).
const PAGE_SIZE = 500;

async function fetchAllPages(path, key) {
  let offset = 0;
  let rows = [];
  let lastData = {};
  // Hard cap to avoid an unbounded loop if the server misbehaves.
  for (let i = 0; i < 1000; i++) {
    const sep = path.includes('?') ? '&' : '?';
    const url = FUNCTIONS_BASE + path + sep + 'limit=' + PAGE_SIZE + '&offset=' + offset;
    const res = await fetch(url, { headers: authHeaders() });
    if (res.status === 401) { showLogin(); throw new Error('unauthorized'); }
    if (!res.ok) throw new Error('fetch failed');
    const data = await res.json();
    lastData = data;
    const page = data[key] || [];
    rows = rows.concat(page);
    const p = data.pagination;
    // Stop when the server says there's no more, or (back-compat) when a
    // non-paginated response returns fewer than a full page.
    if (!p) break;
    if (!p.hasMore || page.length === 0) break;
    offset += PAGE_SIZE;
  }
  return { rows, lastData };
}

async function fetchSites() {
  const { rows } = await fetchAllPages('/sites', 'sites');
  return rows;
}

// ─── AUTH / INIT ───────────────────────────────────────
let isAuthenticated = false;

function hideSplash() {
  const s = document.getElementById('splashScreen');
  if (s) s.style.display = 'none';
}
function showLogin() {
  isAuthenticated = false;
  hideSplash();
  document.getElementById('appShell').style.display = 'none';
  document.getElementById('loginOverlay').style.display = 'flex';
  document.body.style.overflow = 'hidden';
  setTimeout(() => document.getElementById('usernameInput')?.focus(), 50);
}
function hideLogin() {
  isAuthenticated = true;
  hideSplash();
  document.getElementById('loginOverlay').style.display = 'none';
  document.getElementById('appShell').style.display = '';
  document.body.style.overflow = '';
}
function requireAuth() {
  if (!isAuthenticated) { showLogin(); return false; }
  return true;
}

async function doLogin() {
  const username = document.getElementById('usernameInput').value.trim();
  const pw = document.getElementById('passwordInput').value;
  const errEl = document.getElementById('loginError');
  const btn = document.querySelector('.login-card .btn');
  errEl.textContent = '';
  if (!username || !pw) { errEl.textContent = 'Enter username and password'; return; }
  btn.disabled = true;
  btn.textContent = 'Signing in...';
  try {
    const res = await fetch(FUNCTIONS_BASE + '/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password: pw })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      errEl.textContent = data.error || data.message || 'Login failed — please try again';
      btn.disabled = false;
      btn.textContent = 'Sign In';
      return;
    }
    // Store token in localStorage
    if (data.token) setAuthToken(data.token);
    // Immediately hide login & show skeletons — don't wait for data
    if (data.engineer) setCurrentEngineer(data.engineer);
    hideLogin();
    showLeadSkeletons();
    document.getElementById('usernameInput').value = '';
    document.getElementById('passwordInput').value = '';
    btn.disabled = false;
    btn.textContent = 'Sign In';
    // Now load data in background (skeletons are already showing)
    loadDataAfterLogin();
  } catch {
    errEl.textContent = 'Connection error';
    btn.disabled = false;
    btn.textContent = 'Sign In';
  }
}

async function loadDataAfterLogin() {
  try {
    // Start location tracking for all engineers
    startLocationTracking();

    sites = await fetchSites();
    await maybeMigrateLocal();
    renderStats();
    renderPills();
    renderTable();
    if (pendingRoute) {
      const r = pendingRoute; pendingRoute = null;
      location.hash = r;
      handleRoute();
    } else {
      handleRoute();
    }
  } catch (err) {
    console.error(err);
    showToast('Could not load data. Refresh to retry.', 'error');
  }
}

async function loadData() {
  try {
    // Check if we have a stored token
    if (!getAuthToken()) { showLogin(); return; }

    // Check auth first (returns engineer info)
    const authRes = await fetch(FUNCTIONS_BASE + '/auth', { headers: authHeaders() });
    const authData = await authRes.json();
    if (!authData.authed) { clearAuthToken(); showLogin(); return; }
    if (authData.engineer) setCurrentEngineer(authData.engineer);

    // Auth valid — immediately show app with skeletons (hide splash + login)
    hideLogin();
    showLeadSkeletons();
    startLocationTracking();

    // Fetch sites (all pages)
    sites = await fetchSites();

    await maybeMigrateLocal();
    renderStats();
    renderPills();
    renderTable();
    // Handle route after data is ready
    if (pendingRoute) {
      const r = pendingRoute; pendingRoute = null;
      location.hash = r;
      handleRoute();
    } else {
      handleRoute();
    }
  } catch (err) {
    console.error(err);
    showLogin();
  }
}

async function maybeMigrateLocal() {
  if (sites.length > 0) return;
  const raw = localStorage.getItem('sitetrack_v1');
  if (!raw) return;
  let arr;
  try { arr = JSON.parse(raw); } catch { return; }
  if (!Array.isArray(arr) || !arr.length) return;
  showToast(`Importing ${arr.length} local site${arr.length !== 1 ? 's' : ''}...`, 'success');
  for (const s of arr) {
    if (!s.id) s.id = uid();
    try { await saveSite(s); } catch (err) { console.error('migration error', err); }
  }
  sites = await fetchSites();
  localStorage.setItem('sitetrack_v1_migrated_' + Date.now(), raw);
  localStorage.removeItem('sitetrack_v1');
}

function uid() {
  return crypto.randomUUID();
}

// ─── STATS ──────────────────────────────────────────────
function renderStats() {
  const total = sites.length;
  const hot = sites.filter(s => s.status === 'Hot Prospect' || s.status === 'Hot Lead').length;
  const interested = sites.filter(s => s.status === 'Interested Prospect' || s.status === 'Follow Up').length;
  const qualified = sites.filter(s => s.status === 'Qualified Prospect' || s.status === 'Active').length;
  const today = new Date(); today.setHours(0,0,0,0);
  const overdue = sites.filter(s => {
    if (!s.dueDate) return false;
    return new Date(s.dueDate) < today;
  }).length;

  const potential = sites.filter(s => s.status === 'Potential Prospect' || s.status === 'Pending').length;

  const stats = [
    { label: 'Total Sites', val: total, color: 'var(--text)' },
    { label: 'Potential', val: potential, color: 'var(--blue)' },
    { label: 'Qualified', val: qualified, color: 'var(--yellow)' },
    { label: 'Interested', val: interested, color: 'var(--orange)' },
    { label: 'Hot', val: hot, color: 'var(--red)' },
    { label: 'Overdue', val: overdue, color: 'var(--red)' },
  ];

  document.getElementById('statsRow').innerHTML = stats.map(s => `
    <div class="stat-card">
      <div class="stat-label">${s.label}</div>
      <div class="stat-val" style="color:${s.color}">${s.val}</div>
    </div>
  `).join('');
}

// ─── FILTER PILLS ───────────────────────────────────────
function renderPills() {
  const statuses = ['All', 'Potential Prospect', 'Qualified Prospect', 'Interested Prospect', 'Hot Prospect'];
  document.getElementById('filterPills').innerHTML = statuses.map(s => `
    <div class="pill${s === filterStatus ? ' active' : ''}" data-click="setFilter" data-click-args="[&quot;${s}&quot;]">${s}</div>
  `).join('');
}

function setFilter(s) {
  filterStatus = s;
  renderPills();
  renderTable();
}

// ─── TABLE ──────────────────────────────────────────────
function sortBy(col) {
  if (sortCol === col) sortAsc = !sortAsc;
  else { sortCol = col; sortAsc = true; }
  renderTable();
}

function renderTable() {
  const isAdm = currentEngineer?.role === 'admin';
  const q = document.getElementById('searchInput').value.toLowerCase();
  let filtered = sites.filter(s => {
    const match = (s.name + s.contact + s.phone + s.equipment + s.location + s.nextAction + s.notes)
      .toLowerCase().includes(q);
    const statusMatch = filterStatus === 'All' || s.status === filterStatus;
    return match && statusMatch;
  });

  // Sort
  filtered.sort((a, b) => {
    let av = a[sortCol] || '', bv = b[sortCol] || '';
    if (sortCol === 'dueDate') {
      av = av ? new Date(av) : new Date('9999'); 
      bv = bv ? new Date(bv) : new Date('9999');
    } else {
      av = av.toString().toLowerCase();
      bv = bv.toString().toLowerCase();
    }
    if (av < bv) return sortAsc ? -1 : 1;
    if (av > bv) return sortAsc ? 1 : -1;
    return 0;
  });

  document.getElementById('rowCount').textContent = `${filtered.length} site${filtered.length !== 1 ? 's' : ''}`;

  const tbody = document.getElementById('tableBody');
  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="9">
      <div class="empty-state">
        <div class="empty-icon">📋</div>
        <div class="empty-title">No sites yet</div>
        <div class="empty-sub">Click "Add Site" and describe your site naturally</div>
      </div>
    </td></tr>`;
    return;
  }

  const today = new Date(); today.setHours(0,0,0,0);
  const soon = new Date(today); soon.setDate(soon.getDate() + 2);

  tbody.innerHTML = filtered.map(s => {
    const badgeClass = STATUS_MAP[s.status] || 'badge-lost';
    const badgeLabel = STATUS_SHORT[s.status] || s.status || '—';
    let dueCls = '', dueLabel = s.dueDate ? formatDate(s.dueDate) : '—';
    if (s.dueDate) {
      const d = new Date(s.dueDate);
      if (d < today) dueCls = 'overdue';
      else if (d <= soon) dueCls = 'soon';
    }
    return `<tr data-click="viewClient" data-click-args="[&quot;${s.id}&quot;]">
      <td><div class="site-name">${esc(s.name || '—')}</div>${isAdm && s.engineerName ? `<div style="font-size:11px;color:var(--text-muted);margin-top:2px;">${esc(s.engineerName)}</div>` : ''}</td>
      <td>
        <div class="contact-info">
          <div class="contact-name">${esc(s.contact || '—')}</div>
          ${s.phone ? `<a class="contact-phone" href="tel:${esc(s.phone)}" data-click data-stop>${esc(s.phone)}</a>` : ''}
        </div>
      </td>
      <td>
        <div class="equipment-info">
          <div class="eq-type">${esc(s.equipment || '—')}</div>
          <div class="eq-spec">${esc(s.specs || '')}</div>
        </div>
      </td>
      <td><div class="location-tag">📍 ${esc(s.location || '—')}</div></td>
      <td><span class="badge ${badgeClass}">${esc(badgeLabel)}</span></td>
      <td><div class="next-action">${esc(s.nextAction || '—')}</div></td>
      <td><div class="due-date ${dueCls}">${dueLabel}</div></td>
      <td><div class="notes-preview" title="${esc(s.notes || '')}">${esc(s.notes || '—')}</div></td>
      <td>
        <div class="row-actions">
          <button class="icon-btn" data-click="openEdit" data-click-args="[&quot;${s.id}&quot;]" data-stop title="Edit">✎</button>
          <button class="icon-btn delete" data-click="confirmDelete" data-click-args="[&quot;${s.id}&quot;,&quot;$el&quot;]" data-stop title="Delete">✕</button>
        </div>
      </td>
    </tr>`;
  }).join('');
}

function formatDate(d) {
  const dt = new Date(d);
  return dt.toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric' });
}

function formatDateTime(d) {
  const dt = new Date(d);
  return dt.toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric' })
    + ' ' + dt.toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit' });
}

function esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

// ─── ADD MODAL ──────────────────────────────────────────
let attachedImage = null; // { mimeType, data, size, previewUrl }
let attachedAudio = null; // { mimeType, data, size, durationMs }
let mediaRecorder = null;
let recordingStartMs = 0;
let recordingTimer = null;

function openAddModal() {
  document.getElementById('aiInput').value = '';
  removeImage();
  removeAudio();
  showPhase('inputPhase');
  document.getElementById('addModal').classList.add('open');
  setTimeout(() => document.getElementById('aiInput').focus(), 200);
}

function showPhase(phase) {
  ['inputPhase','loadingPhase','previewPhase'].forEach(p => {
    document.getElementById(p).style.display = p === phase ? 'block' : 'none';
  });
}

function backToInput() {
  showPhase('inputPhase');
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result.split(',')[1]);
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}

function renderMediaTray() {
  const tray = document.getElementById('mediaTray');
  let html = '';
  if (attachedImage) {
    html += `<div class="media-chip">
      <img class="media-chip-thumb" src="${attachedImage.previewUrl}" alt="">
      <div class="media-chip-info">
        <div class="media-chip-name">Image attached</div>
        <div class="media-chip-meta">${attachedImage.mimeType} · ${Math.round(attachedImage.size/1024)} KB</div>
      </div>
      <button class="media-chip-remove" type="button" data-click="removeImage">Remove</button>
    </div>`;
  }
  if (attachedAudio) {
    const secs = Math.max(1, Math.round(attachedAudio.durationMs / 1000));
    html += `<div class="media-chip">
      <div class="media-chip-thumb">🎙</div>
      <div class="media-chip-info">
        <div class="media-chip-name">Voice recording</div>
        <div class="media-chip-meta">${secs}s · ${Math.round(attachedAudio.size/1024)} KB</div>
      </div>
      <button class="media-chip-remove" type="button" data-click="removeAudio">Remove</button>
    </div>`;
  }
  tray.innerHTML = html;
}

function removeImage() {
  if (attachedImage?.previewUrl) URL.revokeObjectURL(attachedImage.previewUrl);
  attachedImage = null;
  renderMediaTray();
}
function removeAudio() {
  attachedAudio = null;
  renderMediaTray();
}

async function handleImageFile(event) {
  const file = event.target.files?.[0];
  event.target.value = '';
  if (!file) return;
  try {
    const bitmap = await createImageBitmap(file);
    const maxDim = 1600;
    const ratio = Math.min(maxDim / bitmap.width, maxDim / bitmap.height, 1);
    const w = Math.round(bitmap.width * ratio);
    const h = Math.round(bitmap.height * ratio);
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    canvas.getContext('2d').drawImage(bitmap, 0, 0, w, h);
    const blob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', 0.85));
    const data = await blobToBase64(blob);
    if (attachedImage?.previewUrl) URL.revokeObjectURL(attachedImage.previewUrl);
    attachedImage = {
      mimeType: 'image/jpeg',
      data,
      size: blob.size,
      previewUrl: URL.createObjectURL(blob),
    };
    renderMediaTray();
  } catch (err) {
    console.error(err);
    showToast('Could not load image', 'error');
  }
}

async function toggleRecording() {
  const btn = document.getElementById('recBtn');
  const label = document.getElementById('recLabel');
  const dot = btn.querySelector('.rec-dot');
  const icon = btn.querySelector('.rec-icon');

  if (mediaRecorder && mediaRecorder.state === 'recording') {
    mediaRecorder.stop();
    return;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const chunks = [];
    const mime = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm'
               : MediaRecorder.isTypeSupported('audio/mp4') ? 'audio/mp4'
               : '';
    mediaRecorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
    const actualMime = mediaRecorder.mimeType || mime || 'audio/webm';
    recordingStartMs = Date.now();
    mediaRecorder.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
    mediaRecorder.onstop = async () => {
      const durationMs = Date.now() - recordingStartMs;
      stream.getTracks().forEach(t => t.stop());
      btn.classList.remove('recording');
      dot.style.display = 'none';
      icon.style.display = '';
      label.textContent = 'Record voice';
      clearInterval(recordingTimer);
      mediaRecorder = null;
      if (!chunks.length) return;
      const blob = new Blob(chunks, { type: actualMime });
      const data = await blobToBase64(blob);
      attachedAudio = { mimeType: actualMime.split(';')[0], data, size: blob.size, durationMs };
      renderMediaTray();
    };
    mediaRecorder.start();
    btn.classList.add('recording');
    dot.style.display = '';
    icon.style.display = 'none';
    const tick = () => {
      const s = Math.floor((Date.now() - recordingStartMs) / 1000);
      label.textContent = `Stop (${s}s)`;
    };
    tick();
    recordingTimer = setInterval(tick, 250);
    setTimeout(() => { if (mediaRecorder?.state === 'recording') mediaRecorder.stop(); }, 120000);
  } catch (err) {
    console.error(err);
    showToast('Microphone permission denied', 'error');
  }
}

async function processAI() {
  const text = document.getElementById('aiInput').value.trim();
  if (!text && !attachedImage && !attachedAudio) {
    showToast('Add a description, photo, or voice note first', 'error');
    return;
  }

  showPhase('loadingPhase');

  try {
    const payload = { text };
    if (attachedImage) payload.image = { mimeType: attachedImage.mimeType, data: attachedImage.data };
    if (attachedAudio) payload.audio = { mimeType: attachedAudio.mimeType, data: attachedAudio.data };
    const res = await fetch(FUNCTIONS_BASE + '/extract', {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${res.status}`);
    }
    const parsed = await res.json();

    pendingEntry = {
      id: uid(),
      name: parsed.name || '',
      contact: parsed.contact || '',
      phone: parsed.phone || '',
      equipment: parsed.equipment || '',
      specs: parsed.specs || '',
      location: parsed.location || '',
      status: parsed.status || 'Potential Prospect',
      nextAction: parsed.nextAction || '',
      dueDate: parsed.dueDate || '',
      notes: parsed.notes || '',
    };

    renderPreview(pendingEntry);
    showPhase('previewPhase');
  } catch (err) {
    console.error(err);
    showToast('AI failed — please try again', 'error');
    showPhase('inputPhase');
  }
}

function renderPreview(entry) {
  const VALID = ['Potential Prospect', 'Qualified Prospect', 'Interested Prospect', 'Hot Prospect'];
  const status = VALID.includes(entry.status) ? entry.status : 'Potential Prospect';
  const tf = (id, label, val, full = false) =>
    `<div class="preview-field${full ? ' pf-full' : ''}">
      <div class="pf-label">${label}</div>
      <input class="pf-input" type="text" id="${id}" value="${esc(val || '')}">
    </div>`;
  const sel = (opts, cur) => opts.map(([v, l]) =>
    `<option value="${v}"${cur === v ? ' selected' : ''}>${l}</option>`).join('');

  document.getElementById('previewGrid').innerHTML = `
    ${tf('pv_name', 'Site Name', entry.name)}
    ${tf('pv_contact', 'Contact', entry.contact)}
    ${tf('pv_phone', 'Phone', entry.phone)}
    <div class="preview-field">
      <div class="pf-label">Equipment</div>
      ${equipChipsHTML('pv_eq', entry.equipment)}
    </div>
    ${tf('pv_specs', 'Specs', entry.specs)}
    ${tf('pv_location', 'Location', entry.location)}
    <div class="preview-field">
      <div class="pf-label">Status</div>
      <select class="pf-input" id="pv_status">${sel([
        ['Potential Prospect','🔵 Potential Prospect'],
        ['Qualified Prospect','🟡 Qualified Prospect'],
        ['Interested Prospect','🟠 Interested Prospect'],
        ['Hot Prospect','🔴 Hot Prospect'],
      ], status)}</select>
    </div>
    <div class="preview-field">
      <div class="pf-label">Due Date</div>
      <input class="pf-input" type="date" id="pv_dueDate" value="${esc(entry.dueDate || '')}">
    </div>
    ${tf('pv_nextAction', 'Next Action', entry.nextAction, true)}
    ${tf('pv_notes', 'Notes', entry.notes, true)}
  `;
}

async function confirmAdd() {
  if (!pendingEntry) return;
  const entry = {
    ...pendingEntry,
    name:       document.getElementById('pv_name')?.value ?? pendingEntry.name,
    contact:    document.getElementById('pv_contact')?.value ?? pendingEntry.contact,
    phone:      document.getElementById('pv_phone')?.value ?? pendingEntry.phone,
    equipment:  readEquipChips('pv_eq') || pendingEntry.equipment,
    specs:      document.getElementById('pv_specs')?.value ?? pendingEntry.specs,
    location:   document.getElementById('pv_location')?.value ?? pendingEntry.location,
    status:     document.getElementById('pv_status')?.value ?? pendingEntry.status,
    dueDate:    document.getElementById('pv_dueDate')?.value ?? pendingEntry.dueDate,
    nextAction: document.getElementById('pv_nextAction')?.value ?? pendingEntry.nextAction,
    notes:      document.getElementById('pv_notes')?.value ?? pendingEntry.notes,
  };
  pendingEntry = null;
  const btn = document.getElementById('confirmAddBtn');
  if (btn) { btn.classList.add('is-loading'); btn.disabled = true; }
  try {
    const result = await saveSite(entry);
    if (result.id) entry.id = result.id; // use server-generated ID
    sites.unshift(entry);
    renderStats();
    renderTable();
    closeModal('addModal');
    showToast(`${entry.name || 'Site'} added`, 'success');
  } catch (err) {
    pendingEntry = entry;
    if (err.message !== 'unauthorized') showToast('Could not save', 'error');
  } finally {
    if (btn) { btn.classList.remove('is-loading'); btn.disabled = false; }
  }
}

// ─── EDIT MODAL ─────────────────────────────────────────
function openEdit(id) {
  const s = sites.find(x => x.id === id);
  if (!s) return;
  editingId = id;
  document.getElementById('e_name').value = s.name || '';
  document.getElementById('e_contact').value = s.contact || '';
  document.getElementById('e_phone').value = s.phone || '';
  const eqLower = (s.equipment || '').toLowerCase();
  document.getElementById('e_eq_boilers').checked = eqLower.includes('boiler');
  document.getElementById('e_eq_cooling').checked = eqLower.includes('cooling') || eqLower.includes('tower');
  document.getElementById('e_eq_chillers').checked = eqLower.includes('chiller');
  document.getElementById('e_eq_pools').checked = eqLower.includes('swimming') || eqLower.includes('pool');
  document.getElementById('e_specs').value = s.specs || '';
  document.getElementById('e_location').value = s.location || '';
  document.getElementById('e_status').value = s.status || 'Potential Prospect';
  document.getElementById('e_dueDate').value = s.dueDate || '';
  document.getElementById('e_nextAction').value = s.nextAction || '';
  document.getElementById('e_notes').value = s.notes || '';
  document.getElementById('editModal').classList.add('open');
}

async function saveEdit() {
  if (!editingId) return;
  const idx = sites.findIndex(x => x.id === editingId);
  if (idx === -1) return;
  const btn = document.getElementById('saveEditBtn');
  if (btn?.disabled) return;
  const updated = {
    ...sites[idx],
    name: document.getElementById('e_name').value,
    contact: document.getElementById('e_contact').value,
    phone: document.getElementById('e_phone').value,
    equipment: readEquipChips('e_eq'),
    specs: document.getElementById('e_specs').value,
    location: document.getElementById('e_location').value,
    status: document.getElementById('e_status').value,
    dueDate: document.getElementById('e_dueDate').value,
    nextAction: document.getElementById('e_nextAction').value,
    notes: document.getElementById('e_notes').value,
  };
  if (btn) { btn.classList.add('is-loading'); btn.disabled = true; }
  try {
    await saveSite(updated);
    sites[idx] = updated;
    renderStats();
    renderTable();
    closeModal('editModal');
    // Refresh detail view if open
    if (location.hash.startsWith('#lead/')) showDetailView(editingId);
    showToast('Changes saved ✓', 'success');
  } catch (err) {
    if (err.message !== 'unauthorized') showToast('Could not save', 'error');
  } finally {
    if (btn) { btn.classList.remove('is-loading'); btn.disabled = false; }
  }
}

function deleteEntry() {
  confirmDelete(editingId, document.getElementById('deleteBtn'));
}

async function confirmDelete(id, btn) {
  const s = sites.find(x => x.id === id);
  if (!s) return;
  if (btn?.disabled) return;
  if (!confirm(`Delete "${s.name}"? This can't be undone.`)) return;
  if (btn) { btn.classList.add('is-loading'); btn.disabled = true; }
  try {
    await deleteSite(id);
    sites = sites.filter(x => x.id !== id);
    renderStats();
    renderTable();
    closeModal('editModal');
    if (location.hash.startsWith('#lead/')) backToList();
    showToast(`${s.name} deleted`, 'error');
  } catch (err) {
    if (err.message !== 'unauthorized') showToast('Could not delete', 'error');
  } finally {
    if (btn) { btn.classList.remove('is-loading'); btn.disabled = false; }
  }
}

// ─── MODAL HELPERS ──────────────────────────────────────
function closeModal(id) {
  document.getElementById(id).classList.remove('open');
}

document.querySelectorAll('.modal-backdrop').forEach(backdrop => {
  backdrop.addEventListener('click', e => {
    if (e.target === backdrop) backdrop.classList.remove('open');
  });
});

// Block all clicks on login overlay and splash screen from leaking through
document.getElementById('loginOverlay').addEventListener('click', e => {
  e.stopPropagation();
});
document.getElementById('splashScreen').addEventListener('click', e => {
  e.stopPropagation();
});

document.addEventListener('keydown', e => {
  if (!isAuthenticated) {
    // Allow typing in login form inputs
    const tag = e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    e.preventDefault();
    return;
  }
  if (e.key === 'Escape') document.querySelectorAll('.modal-backdrop.open').forEach(m => m.classList.remove('open'));
});

// ─── EXPORT EXCEL ────────────────────────────────────────
function exportExcel() {
  const headers = ['Site Name','Contact','Phone','Equipment','Specs','Location','Status','Next Action','Due Date','Notes'];
  const q = (document.getElementById('searchInput')?.value || '').toLowerCase();
  const filtered = sites.filter(s => {
    const match = (s.name + s.contact + s.phone + s.equipment + s.location + s.nextAction + s.notes)
      .toLowerCase().includes(q);
    const statusMatch = filterStatus === 'All' || s.status === filterStatus;
    return match && statusMatch;
  });
  const rows = filtered.map(s => [
    s.name, s.contact, s.phone, s.equipment, s.specs,
    s.location, s.status, s.nextAction, s.dueDate, s.notes
  ]);

  const csvRows = [headers, ...rows].map(r =>
    r.map(cell => `"${(cell||'').toString().replace(/"/g,'""')}"`).join(',')
  );
  const csv = '\uFEFF' + csvRows.join('\n'); // BOM for Excel UTF-8

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `pwt_sales_${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('CSV file downloaded', 'success');
}

// ─── TOAST ───────────────────────────────────────────────
let toastTimer;
function showToast(msg, type='success', duration=2800) {
  const t = document.getElementById('toast');
  t.className = `toast ${type}`;
  document.getElementById('toastMsg').textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), duration);
}

// ─── SKELETON LOADING ───────────────────────────────────
function showClientSkeletons() {
  document.getElementById('clientStatsRow').innerHTML =
    '<div class="skel skel-stat"></div><div class="skel skel-stat"></div><div class="skel skel-stat"></div>';
  document.getElementById('clientRowCount').textContent = '';
  document.getElementById('clientTableBody').innerHTML =
    '<tr><td colspan="7" style="padding:0;border:none"><div class="skel skel-row"></div><div class="skel skel-row"></div><div class="skel skel-row"></div></td></tr>';
}

function showEngineerSkeletons() {
  document.getElementById('engineerStatsRow').innerHTML =
    '<div class="skel skel-stat"></div><div class="skel skel-stat"></div><div class="skel skel-stat"></div>';
  document.getElementById('engineerRowCount').textContent = '';
  document.getElementById('engineerTableBody').innerHTML =
    '<tr><td colspan="5" style="padding:0;border:none"><div class="skel skel-row"></div><div class="skel skel-row"></div></td></tr>';
}

function showLeadSkeletons() {
  document.getElementById('statsRow').innerHTML =
    '<div class="skel skel-stat"></div><div class="skel skel-stat"></div><div class="skel skel-stat"></div><div class="skel skel-stat"></div><div class="skel skel-stat"></div><div class="skel skel-stat"></div>';
  document.getElementById('filterPills').innerHTML =
    '<span class="skel skel-pill"></span><span class="skel skel-pill"></span><span class="skel skel-pill"></span><span class="skel skel-pill"></span>';
  document.getElementById('rowCount').textContent = '';
  document.getElementById('tableBody').innerHTML =
    '<tr><td colspan="9" style="padding:0;border:none"><div class="skel skel-row"></div><div class="skel skel-row"></div><div class="skel skel-row"></div><div class="skel skel-row"></div></td></tr>';
}

// ─── THEME TOGGLE ───────────────────────────────────────
const SUN_SVG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>';
const MOON_SVG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';

function applyTheme(t) {
  document.documentElement.setAttribute('data-theme', t);
  localStorage.setItem('pwt_theme', t);
  const btn = document.getElementById('themeToggleBtn');
  if (btn) btn.innerHTML = t === 'dark' ? SUN_SVG : MOON_SVG;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', t === 'dark' ? '#0d0a14' : '#f7f4fc');
}
function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') || 'dark';
  applyTheme(current === 'dark' ? 'light' : 'dark');
}
applyTheme(localStorage.getItem('pwt_theme') || 'dark');

async function logout() {
  stopLocationTracking();
  await fetch(FUNCTIONS_BASE + '/auth', { method: 'DELETE', headers: authHeaders() }).catch(() => {});
  clearAuthToken();
  sites = [];
  clients = [];
  currentEngineer = null;
  renderStats();
  renderTable();
  showLogin();
}

// ─── TAB SWITCHING ──────────────────────────────────────
function updateHeaderButtons(tab) {
  document.getElementById('addSiteBtn').style.display = tab === 'leads' ? '' : 'none';
  document.getElementById('exportBtn').style.display = tab === 'leads' ? '' : 'none';
  document.getElementById('addClientBtn').style.display = tab === 'clients' ? '' : 'none';
  document.getElementById('addEngineerBtn').style.display = tab === 'engineers' ? '' : 'none';
}

function switchTab(tab) {
  if (!requireAuth()) return;
  activeTab = tab;
  document.querySelectorAll('.tab-bar .tab').forEach(t => {
    t.classList.toggle('active', t.dataset.tab === tab);
  });
  document.querySelector('main').style.display = tab === 'leads' ? '' : 'none';
  document.getElementById('clientsSection').style.display = tab === 'clients' ? '' : 'none';
  document.getElementById('engineersSection').style.display = tab === 'engineers' ? '' : 'none';
  document.getElementById('locationSection').style.display = tab === 'location' ? '' : 'none';
  document.getElementById('detailPage').classList.remove('active');
  document.querySelector('.name-banner').style.display = '';
  document.querySelector('.tab-bar').style.display = '';

  updateHeaderButtons(tab);

  // Set hash first (suppressed via flag to avoid double-load from handleRoute)
  _suppressRoute = true;
  if (tab === 'leads') location.hash = '';
  else if (tab === 'clients') location.hash = 'clients';
  else if (tab === 'engineers') location.hash = 'engineers';
  else if (tab === 'location') location.hash = 'location';
  _suppressRoute = false;

  if (tab === 'clients') { showClientSkeletons(); loadClients(); }
  if (tab === 'engineers') { showEngineerSkeletons(); loadEngineers(); }
  if (tab === 'location') { loadLocationMap(); }
}

// ─── LEAD DETAIL PAGE ───────────────────────────────────
function viewClient(id) {
  if (!requireAuth()) return;
  location.hash = 'lead/' + id;
}

function viewCustomer(id) {
  if (!requireAuth()) return;
  location.hash = 'customer/' + id;
}

function viewEngineer(id) {
  if (!requireAuth()) return;
  location.hash = 'engineer/' + id;
}

function backToList() {
  // Always ensure detail page is dismissed
  showListView();
  if (activeTab === 'clients') {
    location.hash = 'clients';
    showClientSkeletons();
    loadClients();
  } else if (activeTab === 'engineers') {
    location.hash = 'engineers';
    showEngineerSkeletons();
    loadEngineers();
  } else {
    location.hash = '';
  }
  window.scrollTo(0, 0);
}

function showListView() {
  document.querySelector('main').style.display = activeTab === 'leads' ? '' : 'none';
  document.getElementById('clientsSection').style.display = activeTab === 'clients' ? '' : 'none';
  document.getElementById('engineersSection').style.display = activeTab === 'engineers' ? '' : 'none';
  document.getElementById('locationSection').style.display = activeTab === 'location' ? '' : 'none';
  document.querySelector('.name-banner').style.display = '';
  document.querySelector('.tab-bar').style.display = '';
  document.getElementById('detailPage').classList.remove('active');
}

function showDetailView(id) {
  const s = sites.find(x => x.id === id);
  if (!s) { showListView(); return; }

  document.querySelector('main').style.display = 'none';
  document.getElementById('clientsSection').style.display = 'none';
  document.getElementById('engineersSection').style.display = 'none';
  document.getElementById('locationSection').style.display = 'none';
  document.querySelector('.name-banner').style.display = 'none';
  document.querySelector('.tab-bar').style.display = 'none';
  document.getElementById('backLabel').textContent = 'Back to leads';

  const badgeClass = STATUS_MAP[s.status] || 'badge-lost';
  const badgeLabel = s.status || 'Unknown';
  const today = new Date(); today.setHours(0,0,0,0);
  const soon = new Date(today); soon.setDate(soon.getDate() + 2);
  let dueCls = '';
  if (s.dueDate) {
    const d = new Date(s.dueDate);
    if (d < today) dueCls = 'overdue';
    else if (d <= soon) dueCls = 'soon';
  }

  document.getElementById('detailContent').innerHTML = `
    <div class="detail-header">
      <div>
        <div class="detail-title">${esc(s.name || 'Untitled Site')}</div>
        <div style="margin-top:8px; display:flex; align-items:center; gap:12px; flex-wrap:wrap;">
          <span class="badge ${badgeClass}" style="font-size:12px; padding:5px 14px;">${esc(badgeLabel)}</span>
          ${s.createdAt ? `<span style="font-family:'DM Mono',monospace; font-size:11px; color:var(--text-muted);">Recorded ${formatDateTime(s.createdAt)}</span>` : ''}
        </div>
      </div>
      <div class="detail-actions">
        ${s.status === 'Closed Won' ? `<button class="btn btn-primary" data-click="convertToClient" data-click-args="[&quot;${s.id}&quot;]" style="background:#22c55e;border-color:#22c55e;">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
          Convert to Client
        </button>` : ''}
        <button class="btn btn-primary" data-click="openLeadQuote" data-click-args="[&quot;${s.id}&quot;]">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M8 13h8M8 17h6"/></svg>
          Generate Quote
        </button>
        <button class="btn btn-ghost" data-click="openEdit" data-click-args="[&quot;${s.id}&quot;]">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>
          Edit
        </button>
        <button class="btn btn-danger" data-click="confirmDelete" data-click-args="[&quot;${s.id}&quot;]">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
          Delete
        </button>
      </div>
    </div>

    <div class="detail-section">
      <div class="detail-section-title">Contact & Location</div>
      <div class="detail-cards">
        <div class="detail-card">
          <div class="detail-card-label">Contact Person</div>
          <div class="detail-card-value${s.contact ? '' : ' empty'}">${esc(s.contact || 'Not set')}</div>
        </div>
        <div class="detail-card">
          <div class="detail-card-label">Phone</div>
          <div class="detail-card-value${s.phone ? '' : ' empty'}">
            ${s.phone ? `<a href="tel:${esc(s.phone)}" style="display:inline-flex;align-items:center;gap:6px"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>${esc(s.phone)}</a>` : 'Not set'}
          </div>
        </div>
        <div class="detail-card">
          <div class="detail-card-label">Location</div>
          <div class="detail-card-value${s.location ? '' : ' empty'}">
            ${s.location ? `<a href="https://www.google.com/maps/search/${encodeURIComponent(s.location)}" target="_blank" rel="noopener" style="display:inline-flex;align-items:center;gap:6px"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>${esc(s.location)}</a>` : 'Not set'}
          </div>
        </div>
      </div>
    </div>

    <div class="detail-section">
      <div class="detail-section-title">Equipment</div>
      <div class="detail-cards">
        <div class="detail-card span-2">
          <div class="detail-card-label">Equipment Type</div>
          <div class="detail-card-value${s.equipment ? '' : ' empty'}">${esc(s.equipment || 'Not set')}</div>
        </div>
        <div class="detail-card">
          <div class="detail-card-label">Specs</div>
          <div class="detail-card-value${s.specs ? '' : ' empty'}">
            ${s.specs ? `<span class="eq-spec">${esc(s.specs)}</span>` : 'Not set'}
          </div>
        </div>
      </div>
    </div>

    <div class="detail-section">
      <div class="detail-section-title">Pipeline</div>
      <div class="detail-cards">
        <div class="detail-card">
          <div class="detail-card-label">Next Action</div>
          <div class="detail-card-value${s.nextAction ? '' : ' empty'}">${esc(s.nextAction || 'Not set')}</div>
        </div>
        <div class="detail-card">
          <div class="detail-card-label">Due Date</div>
          <div class="detail-card-value${s.dueDate ? '' : ' empty'}">
            ${s.dueDate ? `<span class="due-date ${dueCls}">${formatDate(s.dueDate)}</span>` : 'Not set'}
          </div>
        </div>
      </div>
    </div>

    <div class="detail-section">
      <div class="detail-section-title">Notes</div>
      <div class="detail-card span-3" style="border-radius:var(--radius-lg)">
        <div class="detail-card-value${s.notes ? '' : ' empty'}">
          ${s.notes ? `<div class="detail-notes">${esc(s.notes)}</div>` : 'No notes yet'}
        </div>
      </div>
    </div>
  `;

  document.getElementById('detailPage').classList.add('active');
  window.scrollTo(0, 0);
}

// ─── CLIENTS ────────────────────────────────────────────
let clientSortCol = 'name';
let clientSortAsc = true;
let editingClientId = null;
let editingProductId = null;
let productFilterCategory = 'All';
let currentClientProducts = [];
let viewingClientId = null;

const PRODUCT_CATALOG = {
  boilers: [
    { code: 'PW-10', desc: 'O₂ scavenger – Sulfite' },
    { code: 'PW-60', desc: 'Corrosion inhibitor – Tannin' },
    { code: 'PW-40', desc: 'Scale inhibitor' },
    { code: 'PW-40A', desc: 'Scale inhibitor (acidic)' },
    { code: 'PW-20', desc: 'Alkaline builder' },
    { code: 'PW-80', desc: 'Steam treatment' },
    { code: 'PW-47', desc: 'All-in-one – Tannin' },
    { code: 'PW-48', desc: 'All-in-one – Sulfite' },
    { code: 'Aquacure 285', desc: 'O₂ scavenger – DEHA' },
    { code: 'Aquacure 288', desc: 'O₂ scavenger – CHZ' },
    { code: 'Aquacure 296', desc: 'Scale inhibitor' },
    { code: 'PW-141', desc: 'Hot water boiler – Nitrite' },
    { code: 'PW-142', desc: 'Hot water boiler – Tannin' },
  ],
  cooling_towers: [
    { code: 'CT-10', desc: 'Oxidizing biocide – NaOCl (12.5%)' },
    { code: 'CT-12', desc: 'Oxidizing biocide – Liquid Bromine' },
    { code: 'CT-25', desc: 'Non-ox biocide – Isothiazolin' },
    { code: 'CT-28', desc: 'Non-ox biocide – Glutaraldehyde' },
    { code: 'CT-40', desc: 'Scale & corrosion inhibitor' },
    { code: 'CT-42', desc: 'Corrosion inhibitor – Molybdate' },
    { code: 'CT-54', desc: 'Galvanized passivation' },
    { code: 'CT-85', desc: 'Bio-dispersant' },
  ],
  chillers: [
    { code: 'CH-10', desc: 'Corrosion inhibitor – Nitrite' },
    { code: 'CH-12', desc: 'Al-safe corrosion inhibitor' },
    { code: 'CH-20', desc: 'O₂ scavenger – Tannin' },
    { code: 'CH-35', desc: 'Biocide – Isothiazolin' },
    { code: 'CH-50', desc: 'MEG antifreeze' },
    { code: 'CH-55', desc: 'PG antifreeze (food-grade)' },
    { code: 'CH-77', desc: 'Pre-commission cleaner' },
  ],
  swimming_pools: [
    { code: 'SP-10', desc: 'Pool shock – Ca(OCl)₂ (65%)' },
    { code: 'SP-12', desc: 'Stabilized chlorine – Dichlor' },
    { code: 'SP-15', desc: 'Non-chlorine shock – MPS' },
    { code: 'SP-30', desc: 'Algaecide – Quat Ammonium' },
    { code: 'SP-35', desc: 'Algae killer – Chelated Copper' },
    { code: 'SP-40', desc: 'pH increaser – Soda Ash' },
    { code: 'SP-42', desc: 'pH decreaser – Dry Acid' },
    { code: 'SP-60', desc: 'Clarifier – PAC' },
    { code: 'SP-80', desc: 'Phosphate remover' },
  ],
};

const CATEGORY_LABELS = {
  boilers: 'Boilers',
  cooling_towers: 'Cooling Towers',
  chillers: 'Chillers',
  swimming_pools: 'Swimming Pools',
};

function updateProductNameOptions() {
  const cat = document.getElementById('p_category').value;
  const products = PRODUCT_CATALOG[cat] || [];
  const sel = document.getElementById('p_name');
  sel.innerHTML = products.map(p => {
    const val = p.code + ': ' + p.desc;
    return '<option value="' + esc(val) + '">' + esc(p.code) + ': ' + esc(p.desc) + '</option>';
  }).join('') + '<option value="__other__">Other (custom)</option>';
  document.getElementById('p_name_custom').style.display = 'none';
  document.getElementById('p_name_custom').value = '';
}

function onProductNameChange() {
  const isOther = document.getElementById('p_name').value === '__other__';
  document.getElementById('p_name_custom').style.display = isOther ? '' : 'none';
  if (isOther) document.getElementById('p_name_custom').focus();
}

async function loadClients() {
  try {
    const { rows } = await fetchAllPages('/clients', 'clients');
    clients = rows;
    renderClientStats();
    renderClientTable();
  } catch (err) {
    if (err.message === 'unauthorized') return;
    console.error(err);
    showToast('Could not load clients', 'error');
  }
}

function renderClientStats() {
  const total = clients.length;
  const totalProducts = clients.reduce((s, c) => s + (c.productCount || 0), 0);
  const lowStock = clients.reduce((s, c) => s + (c.lowStockCount || 0), 0);
  const stats = [
    { label: 'Total Clients', val: total, color: 'var(--text)' },
    { label: 'Total Products', val: totalProducts, color: 'var(--blue)' },
    { label: 'Low Stock', val: lowStock, color: lowStock > 0 ? 'var(--red)' : 'var(--text)' },
  ];
  document.getElementById('clientStatsRow').innerHTML = stats.map(s => `
    <div class="stat-card">
      <div class="stat-label">${s.label}</div>
      <div class="stat-val" style="color:${s.color}">${s.val}</div>
    </div>
  `).join('');
}

function clientSortBy(col) {
  if (clientSortCol === col) clientSortAsc = !clientSortAsc;
  else { clientSortCol = col; clientSortAsc = true; }
  renderClientTable();
}

function renderClientTable() {
  const q = (document.getElementById('clientSearchInput')?.value || '').toLowerCase();
  let filtered = clients.filter(c => {
    if (q && !(c.name + c.contact + c.phone + c.location).toLowerCase().includes(q)) return false;
    return true;
  });

  filtered.sort((a, b) => {
    const va = (a[clientSortCol] || '').toLowerCase();
    const vb = (b[clientSortCol] || '').toLowerCase();
    return clientSortAsc ? va.localeCompare(vb) : vb.localeCompare(va);
  });

  document.getElementById('clientRowCount').textContent = `${filtered.length} client${filtered.length !== 1 ? 's' : ''}`;

  const isAdm = currentEngineer?.role === 'admin';
  document.getElementById('clientTableBody').innerHTML = filtered.map(c => `
    <tr data-click="viewCustomer" data-click-args="[&quot;${c.id}&quot;]" style="cursor:pointer">
      <td><strong>${esc(c.name || 'Unnamed')}</strong>${isAdm && c.engineerName ? `<br><span style="font-size:11px;color:var(--text-muted)">${esc(c.engineerName)}</span>` : ''}</td>
      <td>${esc(c.contact || '—')}</td>
      <td>${esc(c.phone || '—')}</td>
      <td>${esc(c.location || '—')}</td>
      <td><span style="font-family:'DM Mono',monospace;font-size:12px">${c.productCount || 0}</span></td>
      <td>${(c.categories || []).map(cat => `<span class="cat-chip cat-${cat}">${CATEGORY_LABELS[cat] || cat}</span>`).join(' ')}</td>
      <td>
        <button class="row-btn" data-click="openEditClient" data-click-args="[&quot;${c.id}&quot;]" data-stop>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>
        </button>
      </td>
    </tr>
  `).join('');
}

function openAddClientModal() {
  editingClientId = null;
  document.getElementById('clientModalTitle').textContent = 'Add Client';
  document.getElementById('c_name').value = '';
  document.getElementById('c_contact').value = '';
  document.getElementById('c_phone').value = '';
  document.getElementById('c_location').value = '';
  document.getElementById('c_notes').value = '';
  document.getElementById('deleteClientBtn').style.display = 'none';
  document.getElementById('clientModal').classList.add('open');
}

function openEditClient(id) {
  const c = clients.find(x => x.id === id);
  if (!c) return;
  editingClientId = id;
  document.getElementById('clientModalTitle').textContent = 'Edit Client';
  document.getElementById('c_name').value = c.name;
  document.getElementById('c_contact').value = c.contact;
  document.getElementById('c_phone').value = c.phone;
  document.getElementById('c_location').value = c.location;
  document.getElementById('c_notes').value = c.notes;
  document.getElementById('deleteClientBtn').style.display = '';
  document.getElementById('clientModal').classList.add('open');
}

async function saveClient() {
  const client = {
    id: editingClientId || crypto.randomUUID(),
    name: document.getElementById('c_name').value.trim(),
    contact: document.getElementById('c_contact').value.trim(),
    phone: document.getElementById('c_phone').value.trim(),
    location: document.getElementById('c_location').value.trim(),
    notes: document.getElementById('c_notes').value.trim(),
  };
  if (!client.name) { showToast('Client name is required', 'error'); return; }
  try {
    const res = await fetch(FUNCTIONS_BASE + '/clients', {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ client }),
    });
    if (!res.ok) throw new Error((await res.json()).error || 'Save failed');
    closeModal('clientModal');
    showToast(editingClientId ? 'Client updated' : 'Client added', 'success');
    await loadClients();
    if (location.hash.startsWith('#customer/')) {
      const cId = location.hash.split('/')[1];
      if (cId) showCustomerDetailView(cId);
    }
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function deleteClient() {
  if (!editingClientId) return;
  if (!confirm('Delete this client and all their products?')) return;
  try {
    const res = await fetch(FUNCTIONS_BASE + '/clients?id=' + encodeURIComponent(editingClientId), { method: 'DELETE', headers: authHeaders() });
    if (!res.ok) throw new Error('Delete failed');
    closeModal('clientModal');
    showToast('Client deleted', 'success');
    location.hash = 'clients';
    await loadClients();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ─── CUSTOMER (CLIENT) DETAIL VIEW ─────────────────────
async function showCustomerDetailView(id) {
  let c = clients.find(x => x.id === id);
  if (!c) {
    // Might not be loaded yet
    await loadClients();
    c = clients.find(x => x.id === id);
    if (!c) { showListView(); return; }
  }

  viewingClientId = id;
  productFilterCategory = 'All';

  // Load products
  try {
    const res = await fetch(FUNCTIONS_BASE + '/products?clientId=' + encodeURIComponent(id), { headers: authHeaders() });
    if (res.ok) {
      const data = await res.json();
      currentClientProducts = data.products || [];
    }
  } catch { currentClientProducts = []; }

  document.querySelector('main').style.display = 'none';
  document.getElementById('clientsSection').style.display = 'none';
  document.getElementById('engineersSection').style.display = 'none';
  document.getElementById('locationSection').style.display = 'none';
  document.querySelector('.name-banner').style.display = 'none';
  document.querySelector('.tab-bar').style.display = 'none';

  document.getElementById('backLabel').textContent = 'Back to clients';

  document.getElementById('detailContent').innerHTML = buildCustomerDetailHTML(c);
  document.getElementById('detailPage').classList.add('active');
  window.scrollTo(0, 0);
}

function buildCustomerDetailHTML(c) {
  const productsHTML = buildProductsSectionHTML();
  return `
    <div class="detail-header">
      <div>
        <div class="detail-title">${esc(c.name || 'Unnamed Client')}</div>
        <div style="margin-top:8px; display:flex; align-items:center; gap:12px; flex-wrap:wrap;">
          <span class="badge badge-active" style="font-size:12px; padding:5px 14px;">Client</span>
          ${c.convertedAt ? `<span style="font-family:'DM Mono',monospace; font-size:11px; color:var(--text-muted);">Converted ${formatDateTime(c.convertedAt)}</span>` : ''}
          ${c.createdAt ? `<span style="font-family:'DM Mono',monospace; font-size:11px; color:var(--text-muted);">Added ${formatDateTime(c.createdAt)}</span>` : ''}
        </div>
      </div>
      <div class="detail-actions">
        <button class="btn btn-primary" data-click="openQuoteModal">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M8 13h8M8 17h6"/></svg>
          Generate Quote
        </button>
        <button class="btn btn-ghost" data-click="openEditClient" data-click-args="[&quot;${c.id}&quot;]">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>
          Edit
        </button>
      </div>
    </div>

    <div class="detail-section">
      <div class="detail-section-title">Contact & Location</div>
      <div class="detail-cards">
        <div class="detail-card">
          <div class="detail-card-label">Contact Person</div>
          <div class="detail-card-value${c.contact ? '' : ' empty'}">${esc(c.contact || 'Not set')}</div>
        </div>
        <div class="detail-card">
          <div class="detail-card-label">Phone</div>
          <div class="detail-card-value${c.phone ? '' : ' empty'}">
            ${c.phone ? `<a href="tel:${esc(c.phone)}" style="display:inline-flex;align-items:center;gap:6px"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>${esc(c.phone)}</a>` : 'Not set'}
          </div>
        </div>
        <div class="detail-card">
          <div class="detail-card-label">Location</div>
          <div class="detail-card-value${c.location ? '' : ' empty'}">
            ${c.location ? `<a href="https://www.google.com/maps/search/${encodeURIComponent(c.location)}" target="_blank" rel="noopener" style="display:inline-flex;align-items:center;gap:6px"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>${esc(c.location)}</a>` : 'Not set'}
          </div>
        </div>
      </div>
    </div>

    ${c.notes ? `<div class="detail-section">
      <div class="detail-section-title">Notes</div>
      <div class="detail-card span-3" style="border-radius:var(--radius-lg)">
        <div class="detail-card-value"><div class="detail-notes">${esc(c.notes)}</div></div>
      </div>
    </div>` : ''}

    <div class="detail-section">
      <div class="detail-section-title" style="display:flex;align-items:center;justify-content:space-between;">
        Products & Inventory
        <button class="btn btn-primary" data-click="openAddProductModal" data-click-args="[&quot;${c.id}&quot;]" style="font-size:12px;padding:8px 14px;">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 5v14M5 12h14"/></svg>
          Add Product
        </button>
      </div>
      <div class="filter-pills" style="margin-bottom:12px;" id="productFilterPills">
        ${buildProductFilterPillsHTML()}
      </div>
      <div id="productsContainer">${productsHTML}</div>
    </div>
  `;
}

/* ============ GENERATE QUOTE (full PWT proposal document) ============ */
let quoteItems = [];           // [{ code, usage, price, kg }]
let quoteForName = '';

const SYSTEM_LABELS = {
  boiler: 'Boiler',
  cooling_tower: 'Cooling Tower',
  chiller: 'Chiller',
  swimming_pool: 'Swimming Pool',
};

// Per-product technical text used on the "Product Specifications" pages.
const PRODUCT_SPECS = {
  'PW-142': { title: 'INTERNAL TREATMENT – PW PRESERVE-142', usage: 'Scale inhibitor',
    desc: 'PW PRESERVE-142 is a mixture of corrosion inhibitors based on tannin, silicate & phosphate for closed cooling systems and chilled water circuits using distilled or fresh water. PW Preserve-142 deposits a microfilm on metal surfaces.',
    app: 'Can be fed as such or diluted. Non-volatile. Not for attemperation. The chemical should be continuously fed to the boiler feed water tank.' },
  'PW-40': { title: 'INTERNAL TREATMENT – PW-40 (phosphate program)', usage: 'Scale inhibitor',
    desc: 'PW-40 is an organic polymer, phosphate-based compound, used for boilers under any pressure up to 40 bars to precipitate calcium and magnesium hardness as phosphate sludge.',
    app: 'PW-40 is normally maintained within set limits in boiler water. The optimum treatment dosage depends on operating conditions such as boiler pressure and the chemical characteristics of the treated water.' },
  'PW-10': { title: 'INTERNAL TREATMENT – PW-10 (Oxygen scavenger – corrosion inhibitor)', usage: 'Oxygen scavenger',
    desc: 'PW-10 is a catalyzed sodium sulfite-based compound; it reacts with oxygen to form sodium sulfate. The catalyst is incorporated to speed the reaction.',
    app: 'Can be fed as such or diluted. Non-volatile. Not for attemperation. On oxygen: 7.8 ppm of SO3 for 1 ppm of oxygen on feed water. Recommended residual sulfite on boiler water: 30-60 ppm.' },
  'PW-80': { title: 'INTERNAL TREATMENT – PW-80 (Steam-condensate pH control)', usage: 'Steam treatment',
    desc: 'PW-80 is based on neutralizing amine derivatives. It is designed to adjust the pH of condensate systems; it has a very high capability for absorbing CO2, exceptionally good thermal stability and is completely water soluble.',
    app: 'PW-80 can be dosed with usual feeding equipment, either into the boiler feed water or directly into the boiler drum, or into the steam line. The dose required depends on the existing amount of carbon dioxide in steam, condensate recovery and pH value of condensate.' },
};

const QUOTE_FOOTER = `Address: Zahraa Smouha Tower, No. 12 Nader Mosque St., Smouha, Alexandria, Egypt &nbsp;|&nbsp; Factory &amp; Warehouse: Borg Alarab - Industrial Zone (4)<br>Tel / Fax: 002 034280687 &nbsp;|&nbsp; Mob: 01002274773 - 01005710128 &nbsp;|&nbsp; pwt@pwtchem.com - info@pwtinternational.com &nbsp;|&nbsp; www.pwtinternational.com`;

function fmtMoney(n) {
  return (Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtInt(n) {
  return (Number(n) || 0).toLocaleString(undefined, { maximumFractionDigits: 0 });
}

/* ---- offer number series (per-device counter) ---- */
function nextOfferNumber() {
  let n = parseInt(localStorage.getItem('pwt_quote_next_offer') || '', 10);
  if (!Number.isFinite(n)) {
    const start = prompt('Set the starting Offer number (e.g. 16632):', '16632');
    n = parseInt(start, 10);
    if (!Number.isFinite(n)) n = 1;
  }
  return n;
}
function bumpOfferNumber(used) {
  const n = parseInt(used, 10);
  if (Number.isFinite(n)) localStorage.setItem('pwt_quote_next_offer', String(n + 1));
}
function offerSuffix(d) {
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yy = String(d.getFullYear()).slice(-2);
  return `${mm} ${yy}`;
}

/* ---- amount in words (EGP) ---- */
function numberToWordsEGP(num) {
  num = Math.round(Number(num) || 0);
  if (num === 0) return 'Zero EGP';
  const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
    'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  function below1000(n) {
    let s = '';
    if (n >= 100) { s += ones[Math.floor(n / 100)] + ' Hundred'; n %= 100; if (n) s += ' And '; }
    if (n >= 20) { s += tens[Math.floor(n / 10)]; n %= 10; if (n) s += '-' + ones[n]; }
    else if (n > 0) s += ones[n];
    return s;
  }
  const units = [[1e9, 'Billion'], [1e6, 'Million'], [1e3, 'Thousand'], [1, '']];
  let words = '';
  for (const [val, name] of units) {
    if (num >= val) {
      const chunk = Math.floor(num / val);
      num %= val;
      words += below1000(chunk) + (name ? ' ' + name : '');
      if (num) words += ' And ';
    }
  }
  return 'Only ' + words.trim().replace(/\s+/g, ' ') + ' EGP';
}

/* ---- open from a CLIENT ---- */
function openQuoteModal() {
  const c = clients.find(x => x.id === viewingClientId);
  if (!c) return;
  quoteForName = c.name || 'Client';
  quoteItems = currentClientProducts.map(p => ({
    code: p.productName || '', usage: '', price: 0, kg: Number(p.quantity) || 0,
  }));
  showQuoteModal({
    company: c.name || '', businessLine: c.businessLine || '',
    attName: c.attName || (c.contact ? ('Eng. / ' + c.contact) : ''), attTitle: c.attTitle || '',
  });
}

/* ---- open from a LEAD / prospect ---- */
function openLeadQuote(id) {
  const s = sites.find(x => x.id === id);
  if (!s) return;
  quoteForName = s.name || 'Lead';
  quoteItems = [];
  showQuoteModal({
    company: s.name || '', businessLine: s.businessLine || '',
    attName: s.attName || (s.contact ? ('Eng. / ' + s.contact) : ''), attTitle: s.attTitle || '',
    system: s.equipment && /cool/i.test(s.equipment) ? 'cooling_tower' : (s.equipment && /chill/i.test(s.equipment) ? 'chiller' : (s.equipment && /pool/i.test(s.equipment) ? 'swimming_pool' : 'boiler')),
  });
}

function showQuoteModal(meta) {
  meta = meta || {};
  const today = new Date();
  const valid = new Date(today); valid.setDate(valid.getDate() + 9);
  const iso = d => d.toISOString().slice(0, 10);
  const offer = nextOfferNumber();
  const setVal = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
  setVal('q_company', meta.company || quoteForName);
  setVal('q_businessLine', meta.businessLine || '');
  if (meta.system) setVal('q_system', meta.system);
  setVal('q_date', iso(today));
  setVal('q_offerNo', `${offer} ${offerSuffix(today)}`);
  setVal('q_worksheetNo', `${offer} -${offerSuffix(today)} International`);
  setVal('q_attName', meta.attName || '');
  setVal('q_attTitle', meta.attTitle || '');
  setVal('q_validTill', iso(valid));
  setVal('q_deliveryDays', '10');
  populateQuoteProductList();
  if (quoteItems.length === 0) quoteItems.push({ code: '', usage: '', price: 0, kg: 0 });
  renderQuoteItems();
  document.getElementById('quoteModal').classList.add('open');
}

function populateQuoteProductList() {
  const dl = document.getElementById('quoteProductList');
  if (!dl || dl.childElementCount) return;
  let opts = '';
  for (const cat of Object.keys(PRODUCT_CATALOG)) {
    for (const p of PRODUCT_CATALOG[cat]) {
      opts += `<option value="${esc(p.code)}">${esc(p.code)} — ${esc(p.desc)}</option>`;
    }
  }
  dl.innerHTML = opts;
}

function onQuoteSystemChange() { /* reserved: could swap default products by system */ }

function catalogDescFor(code) {
  const key = (code || '').split(':')[0].trim();
  for (const cat of Object.keys(PRODUCT_CATALOG)) {
    const found = PRODUCT_CATALOG[cat].find(p => p.code === key);
    if (found) return found.desc;
  }
  return '';
}

function renderQuoteItems() {
  const body = document.getElementById('quoteItemsBody');
  if (quoteItems.length === 0) {
    body.innerHTML = '<div class="quote-empty">No products yet. Tap “Add product”.</div>';
  } else {
    body.innerHTML = quoteItems.map((it, i) => `
      <div class="quote-irow">
        <input class="qprod" type="text" list="quoteProductList" value="${esc(it.code)}" placeholder="PW-40" data-input="updateQuoteItem" data-input-args="[${i},&quot;code&quot;,&quot;$value&quot;]" aria-label="Product code">
        <input type="text" value="${esc(it.usage)}" placeholder="usage" data-input="updateQuoteItem" data-input-args="[${i},&quot;usage&quot;,&quot;$value&quot;]" aria-label="Usage">
        <input type="number" min="0" step="0.01" value="${it.price || ''}" placeholder="0" data-input="updateQuoteItem" data-input-args="[${i},&quot;price&quot;,&quot;$value&quot;]" aria-label="Price per Kg">
        <input type="number" min="0" step="0.01" value="${it.kg || ''}" placeholder="0" data-input="updateQuoteItem" data-input-args="[${i},&quot;kg&quot;,&quot;$value&quot;]" aria-label="Kg per year">
        <div class="qcost" id="quoteLine${i}">${fmtMoney((it.price||0)*(it.kg||0))}</div>
        <button type="button" class="quote-remove" data-click="removeQuoteRow" data-click-args="[${i}]" aria-label="Remove">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12"/></svg>
        </button>
      </div>`).join('');
  }
  recalcQuoteTotal();
}

function updateQuoteItem(i, field, val) {
  if (field === 'code') {
    quoteItems[i].code = val;
    if (!quoteItems[i].usage) {
      const k = (val || '').split(':')[0].trim();
      const spec = PRODUCT_SPECS[k];
      if (spec) quoteItems[i].usage = spec.usage;
    }
  } else if (field === 'usage') {
    quoteItems[i].usage = val;
  } else {
    quoteItems[i][field] = Number(val) || 0;
  }
  if (field === 'price' || field === 'kg') {
    document.getElementById('quoteLine' + i).textContent = fmtMoney((quoteItems[i].price||0)*(quoteItems[i].kg||0));
    recalcQuoteTotal();
  }
}

function addQuoteRow() { quoteItems.push({ code: '', usage: '', price: 0, kg: 0 }); renderQuoteItems(); }
function removeQuoteRow(i) { quoteItems.splice(i, 1); renderQuoteItems(); }

function quoteTotal() { return quoteItems.reduce((s, it) => s + (it.price||0)*(it.kg||0), 0); }
function recalcQuoteTotal() {
  const t = quoteTotal();
  document.getElementById('quoteTotal').textContent = fmtMoney(t);
  const w = document.getElementById('quoteTotalWords');
  if (w) w.textContent = t > 0 ? numberToWordsEGP(t) : '';
}

function quoteValidItems() {
  return quoteItems.filter(it => (it.code || '').trim() !== '');
}

function gatherQuoteMeta() {
  const g = id => { const el = document.getElementById(id); return el ? (el.value || '').trim() : ''; };
  const dateVal = g('q_date');
  const d = dateVal ? new Date(dateVal) : new Date();
  const ord = n => { const s = ['th','st','nd','rd'], v = n % 100; return n + (s[(v-20)%10] || s[v] || s[0]); };
  const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const dateLong = `${months[d.getMonth()]} ${ord(d.getDate())}, ${d.getFullYear()}`;
  const validRaw = g('q_validTill');
  const validFmt = validRaw ? validRaw.split('-').reverse().join(' / ') : '';
  const sys = document.getElementById('q_system') ? document.getElementById('q_system').value : 'boiler';
  return {
    company: g('q_company') || quoteForName, businessLine: g('q_businessLine'),
    system: sys, systemLabel: SYSTEM_LABELS[sys] || 'Boiler',
    offerNo: g('q_offerNo'), worksheetNo: g('q_worksheetNo'),
    dateLong, attName: g('q_attName'), attTitle: g('q_attTitle'),
    prepName: g('q_prepName'), prepTitle: g('q_prepTitle'),
    validTill: validFmt, deliveryDays: g('q_deliveryDays') || '10',
  };
}

function buildQuoteText() {
  const m = gatherQuoteMeta();
  const lines = [`PWT INTERNATIONAL — ${m.systemLabel} Water Treatment`, `Company: ${m.company}`, `Offer No.: ${m.offerNo}`, `Date: ${m.dateLong}`, ''];
  let total = 0;
  for (const it of quoteValidItems()) {
    const cost = (it.price||0)*(it.kg||0); total += cost;
    lines.push(`${it.code} — ${it.usage || ''} : ${fmtMoney(it.price)} EGP/Kg × ${fmtInt(it.kg)} Kg = ${fmtMoney(cost)} EGP`);
  }
  lines.push('', `Total: ${fmtMoney(total)} EGP`, numberToWordsEGP(total));
  return lines.join('\n');
}

function copyQuote() {
  if (quoteValidItems().length === 0) { showToast('Add at least one product', 'error'); return; }
  navigator.clipboard.writeText(buildQuoteText())
    .then(() => showToast('Quote copied to clipboard'))
    .catch(() => showToast('Could not copy', 'error'));
}

/* ---- the full multi-page printable document ---- */
function printQuote() {
  const items = quoteValidItems();
  if (items.length === 0) { showToast('Add at least one product', 'error'); return; }
  const m = gatherQuoteMeta();
  const total = quoteTotal();
  const logo = location.origin + '/logoo.png';

  const offerRows = items.map(it => {
    const cost = (it.price||0)*(it.kg||0);
    return `<tr><td>${esc(it.code)}</td><td>${esc(it.usage || catalogDescFor(it.code))}</td>
      <td class="r">${fmtMoney(it.price)}</td><td class="r">${fmtInt(it.kg)}</td><td class="r">${fmtMoney(cost)}</td></tr>`;
  }).join('');

  const specBlocks = items.map(it => {
    const k = (it.code || '').split(':')[0].trim();
    const spec = PRODUCT_SPECS[k];
    const title = spec ? spec.title : `INTERNAL TREATMENT – ${esc(it.code)}`;
    const desc = spec ? spec.desc : (catalogDescFor(it.code) || '');
    const app = spec ? spec.app : 'The chemical should be continuously fed to the system at the recommended dosage.';
    return `<div class="spec"><h3>${esc(title)}</h3><p><b>General description:</b> ${esc(desc)}</p><p><b>Application and dosage:</b> ${esc(app)}</p></div>`;
  }).join('');

  const refRows = [
    ['Asyut Oil Refining Company (ASORC)', 'Cooling tower: 3500 m³ · Boiler steam generator: 3 × 25 ton/hr · Waste water unit: 2000 m³/day'],
    ['Aluminum Company of Egypt (EGYPTALUM)', 'Cooling towers: up to 5000 m³'],
    ['Alexandria National Refining & Petrochemical Co (ANRPC)', 'Cooling tower: 5000 m³ · Boiler steam generator: 100 ton/hr'],
    ['Egyptian Linear Alkyl Benzene Company (ELAB)', 'Cooling tower: 2500 m³ · Boiler steam generator: 20 ton/hr'],
    ['Alexandria Petroleum Company', 'Boiler steam generator: 2 × 70 ton/hr'],
    ['MISR Petroleum Co.', 'Boiler steam generators: 2×20, 3×12, 2×8 ton/hr'],
    ['Sidi Kerir Petrochemical Company (SIDPEC)', 'Chilled water system · Thermal desalination: 5000 m³/day'],
    ['NILE SUGAR', 'Boiler steam generators: 100 & 60 ton/hr'],
    ['Egyptian Ethylene & Derivatives Company (ETHYDCO)', 'Closed loop water system: 4 × 80 m³'],
  ].map(r => `<tr><td>${esc(r[0])}</td><td>${esc(r[1])}</td></tr>`).join('');

  const waterRows = ['pH','Conductivity (µs/cm)','Total Dissolved Solids [TDS]','Total Hardness as CaCO3','Calcium Hardness as CaCO3','Magnesium Hardness as CaCO3','P-Alkalinity as CaCO3','M-Alkalinity as CaCO3','OH-Alkalinity as CaCO3','Chloride [Cl]','Ortho Phosphate [PO4]','Iron [Fe]','Oxy scavenger (Sulfite)','Cycle of concentration']
    .map(e => `<tr><td>${esc(e)}</td><td></td><td></td><td></td><td></td></tr>`).join('');

  const page = (cls, inner) => `<section class="page ${cls||''}">${inner}<div class="pfoot">${QUOTE_FOOTER}</div></section>`;
  const band = `<div class="band"><img src="${logo}" class="logo"><div class="bandtxt"><div class="bt1">PWT INTERNATIONAL</div><div class="bt2">Water Treatment Technologies</div></div></div>`;

  const cover = `<section class="page cover">
    ${band}
    <div class="cover-mid">
      <div class="cdoc">- TECHNICAL ECONOMICAL PROPOSAL -</div>
      <div class="csub">${esc(m.systemLabel)} Water Treatment Chemicals and Service</div>
      <div class="ccompany">${esc(m.company)}</div>
      <div class="cline">${esc(m.businessLine)}</div>
      <div class="cmeta">
        <div><b>Offer No.:</b> ${esc(m.offerNo)}</div>
        <div><b>Work sheet no:</b> ${esc(m.worksheetNo)}</div>
        <div class="cdate">${esc(m.dateLong)}</div>
        <div class="catt"><b>Kind att.:</b> ${esc(m.attName)} ${m.attTitle ? '<span class="paren">((' + esc(m.attTitle) + '))</span>' : ''}</div>
        <div class="cprep"><b>Prepared by:</b> ${esc(m.prepName)} ${m.prepTitle ? '<span class="paren">((' + esc(m.prepTitle) + '))</span>' : ''}</div>
      </div>
      <div class="cslogan">Think Globally Act Locally</div>
    </div>
    <div class="pfoot">${QUOTE_FOOTER}</div>
  </section>`;

  const letter = page('', `${band}
    <p>Dear Sir,</p>
    <p>On behalf of PWT INTERNATIONAL, we would like to take this opportunity to thank ${esc(m.company)} for inviting our organization to be involved in your quotation on ${esc(m.systemLabel)} Water Treatment program supplying.</p>
    <p>Our intention with this proposal is to demonstrate our commitment to improving overall value and delivering the best cost/performance ratio. We are encouraged that our proposal will serve to meet this exciting goal.</p>
    <p>We believe that by choosing PWT INTERNATIONAL as a valued partner, you will gain superior account management capabilities, numerous new and fresh ideas for process improvement and cost reduction, and experienced personnel to manage your chemical needs.</p>
    <p>Thank you again for the opportunity to work with you and your organization on this important initiative. We confirm our availability to discuss our proposal at your convenience and we thank you for your kind cooperation.</p>
    <p>Sincerely yours,<br><b>PWT INTERNATIONAL</b><br>Best regards</p>`);

  const index = page('', `<h2>INDEX</h2>
    <ol class="idx">
      <li>Goal of the Proposal<ul><li>Introduction to PWT</li><li>Mission – Service goals</li></ul></li>
      <li>System Knowledge<ul><li>Technical data</li><li>Water chemistry</li><li>Operational issues</li></ul></li>
      <li>Technical Proposal – PWT Treatment Chemicals<ul><li>Treatment technologies</li><li>Product specifications and application guidelines</li><li>Efficiency check</li></ul></li>
      <li>Program Summary</li>
      <li>Opportunities for Improvements</li>
      <li>Requirements for Success of the Treatment</li>
      <li>Technical Service and Monitoring</li>
      <li>Conclusion – References</li>
    </ol>`);

  const goal = page('', `<h2>1) Goal of the Proposal</h2>
    <h3>a. Introduction to PWT INTERNATIONAL</h3>
    <p>PWT INTERNATIONAL is a water, waste water and chemical treatment company operating in this field for a long time. PWT INTERNATIONAL is well aware of the different industry sectors where water (water, steam, ice…) or water-related equipment (boilers, coolers…) represents a vital role of its existence and success.</p>
    <p>PWT INTERNATIONAL is a registered trademark, well known in the Egyptian market. PWT INTERNATIONAL is ISO 9001 – 14001 – OHSAS 18001 certified; our chemicals undergo strict quality-control documentation and follow-up from the moment raw material is delivered to our facility until the product is dispatched to the client.</p>
    <p>PWT INTERNATIONAL – Chemical Trading · Technical Services · Consultancy services · Waste treatment services · Oil field and chemical cleaning services · Water treatment chemicals manufacturing.</p>
    <h3>b. Mission – Service goals</h3>
    <p><i>We, the associates of PWT INTERNATIONAL, will excel in providing measurable, cost-effective improvements in output and quality for our customers by delivering customer-specific services and products and the creative application of knowledge.</i></p>`);

  const systemKnow = page('', `<h2>2) System Knowledge</h2>
    <h3>a. Technical data</h3>
    <p class="muted">System specifications for ${esc(m.company)} (to be completed from the site survey).</p>
    <table class="g"><tbody>
      <tr><td>Number of units</td><td></td></tr>
      <tr><td>Type</td><td></td></tr>
      <tr><td>Capacity</td><td></td></tr>
      <tr><td>Operating pressure</td><td></td></tr>
      <tr><td>Make-up water</td><td></td></tr>
      <tr><td>Feed water</td><td></td></tr>
      <tr><td>Operating time</td><td></td></tr>
    </tbody></table>
    <h3>b. Water chemistry</h3>
    <table class="g"><thead><tr><th>Element to be analyzed</th><th>Make-up</th><th>Feed water</th><th>Boiler 1</th><th>Boiler 2</th></tr></thead>
    <tbody>${waterRows}</tbody></table>`);

  const technical = page('', `<h2>3) Technical Proposal – PWT Treatment Chemicals</h2>
    <h3>a. Treatment technologies</h3>
    <p>PWT INTERNATIONAL proposes the following chemical program for your ${esc(m.systemLabel.toLowerCase())} system, selected to minimize corrosion and deposits while maintaining steam/water quality and reducing operating cost.</p>
    <h3>b. Product specifications and application guidelines</h3>
    ${specBlocks}`);

  const offer = page('', `<h2>Economical Offer</h2>
    <table class="g offer"><thead><tr><th>Product</th><th>Usage</th><th class="r">Price EGP/Kg</th><th class="r">Kg / year</th><th class="r">Cost / year</th></tr></thead>
      <tbody>${offerRows}</tbody>
      <tfoot><tr><td colspan="4" class="r">Total</td><td class="r">${fmtMoney(total)}</td></tr></tfoot>
    </table>
    <p class="words">${esc(numberToWordsEGP(total))}</p>
    <h3>Commercial terms</h3>
    <ul class="terms">
      <li>This price is excluding 14% value added tax.</li>
      <li>Delivery: within ${esc(m.deliveryDays)} days from receiving P.O.</li>
      <li>This offer is valid till ${esc(m.validTill)}.</li>
      <li>Payment: cash against delivery or according to a specific agreement.</li>
    </ul>`);

  const requirements = page('', `<h2>4) Requirements for Success of the Treatment</h2>
    <p>The PWT INTERNATIONAL treatment program is designed to prevent corrosion and scaling while decreasing loss of water and chemicals and reducing the risk of tube failures and unplanned shutdowns. Its success depends on:</p>
    <ul>
      <li>Correct selection of treatment chemicals and their dosages</li>
      <li>Application of the correct dosages</li>
      <li>Control of the water chemistry within the preset limits</li>
      <li>Monitoring the treatment chemical actives in the water and taking corrective actions as necessary</li>
      <li>Implementation of the agreed service</li>
    </ul>`);

  const monitoring = page('', `<h2>5) Technical Service and Monitoring</h2>
    <p>Control ranges (according to British Standard 2486/1997):</p>
    <table class="g"><thead><tr><th>Parameter</th><th>Range</th></tr></thead><tbody>
      <tr><td>Boiler feed water – pH</td><td>&gt; 8.5</td></tr>
      <tr><td>Boiler feed water – Total Hardness (ppm CaCO3)</td><td>&lt; 2</td></tr>
      <tr><td>Boiler water – pH</td><td>10.5 – 12</td></tr>
      <tr><td>Boiler water – P Alkalinity</td><td>&lt; 700</td></tr>
      <tr><td>Boiler water – Hydroxide Alkalinity (ppm CaCO3)</td><td>350 – 500</td></tr>
      <tr><td>Boiler water – Conductivity (µmho/cm)</td><td>&lt; 7000</td></tr>
      <tr><td>Boiler water – T.D.S</td><td>&lt; 3500</td></tr>
      <tr><td>Boiler water – Sulfite residual (ppm)</td><td>30 – 60</td></tr>
      <tr><td>Boiler water – Phosphate residual (ppm)</td><td>20 – 40</td></tr>
      <tr><td>Condensate – pH</td><td>8.3 – 9.5</td></tr>
    </tbody></table>
    <h3>Service plan</h3>
    <p>At start-up our service engineer will be present for a full day to train your staff. We then implement our "Customer Care" program with regular monitoring visits; at the end of each visit a written service report (analyses, recommendations, stock data) is submitted, and a business review is held at year end.</p>`);

  const reportSheet = page('', `<h2>Report Sheet</h2>
    <div class="rsmeta"><span>Client: ${esc(m.company)}</span><span>Date: ____ / ____ / ${new Date().getFullYear()}</span><span>Contact person: ________________</span></div>
    <h3>Operation conditions</h3>
    <table class="g"><tbody>
      <tr><td>Boiler manufacture</td><td></td><td>Feed T.K temperature</td><td></td></tr>
      <tr><td>Operating pressure</td><td></td><td>Fuel type</td><td></td></tr>
      <tr><td>Boiler capacity</td><td></td><td>Blow down rate</td><td></td></tr>
      <tr><td>Hrs of operation</td><td></td><td>Condensate return</td><td></td></tr>
    </tbody></table>
    <h3>Water analysis</h3>
    <table class="g"><thead><tr><th>Element</th><th>Make-up</th><th>Feed water</th><th>Blow down</th><th>Condensate</th></tr></thead>
    <tbody>${waterRows}</tbody></table>`);

  const references = page('', `<h2>6) Conclusion – References</h2>
    <p>Below are some of the most important sites where PWT INTERNATIONAL has performed industrial water treatment:</p>
    <table class="g"><thead><tr><th>Client</th><th>Utility</th></tr></thead><tbody>${refRows}</tbody></table>`);

  const css = `
    @page { size: A4; margin: 0; }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: 'Segoe UI', Arial, Helvetica, sans-serif; color: #1c2733; }
    .page { position: relative; width: 210mm; min-height: 297mm; padding: 18mm 16mm 24mm; page-break-after: always; }
    .page:last-child { page-break-after: auto; }
    .band { display: flex; align-items: center; gap: 12px; border-bottom: 3px solid #1769b0; padding-bottom: 8px; margin-bottom: 16px; }
    .band .logo { height: 46px; }
    .bandtxt .bt1 { font-weight: 800; color: #14507f; letter-spacing: 1px; font-size: 16px; }
    .bandtxt .bt2 { color: #6b7c8d; font-size: 11px; }
    h2 { color: #14507f; font-size: 18px; border-left: 4px solid #1769b0; padding-left: 10px; margin: 0 0 12px; }
    h3 { color: #1769b0; font-size: 13px; margin: 14px 0 6px; }
    p, li { font-size: 12px; line-height: 1.55; }
    .muted { color: #7a8a99; font-style: italic; }
    table.g { width: 100%; border-collapse: collapse; margin: 8px 0 14px; }
    table.g th, table.g td { border: 1px solid #c7d3de; padding: 6px 8px; font-size: 11px; text-align: left; }
    table.g th { background: #eaf2f9; color: #14507f; }
    table.g .r, td.r, th.r { text-align: right; }
    table.offer tfoot td { font-weight: 800; background: #eaf2f9; color: #14507f; font-size: 12px; }
    .words { font-style: italic; font-weight: 700; color: #14507f; }
    ul.terms li { margin-bottom: 4px; }
    .idx { font-size: 13px; line-height: 1.8; }
    .idx ul { font-size: 12px; color: #46586a; }
    .spec { border: 1px solid #dce6ef; border-radius: 6px; padding: 10px 12px; margin-bottom: 10px; }
    .spec h3 { margin-top: 0; }
    .rsmeta { display: flex; justify-content: space-between; font-size: 11px; margin-bottom: 8px; flex-wrap: wrap; gap: 6px; }
    .pfoot { position: absolute; left: 16mm; right: 16mm; bottom: 10mm; border-top: 1px solid #c7d3de; padding-top: 6px; font-size: 8px; color: #7a8a99; text-align: center; line-height: 1.5; }
    .cover .cover-mid { text-align: center; margin-top: 22mm; }
    .cdoc { font-weight: 800; color: #14507f; letter-spacing: 1px; font-size: 16px; }
    .csub { color: #46586a; font-size: 13px; margin: 6px 0 26px; }
    .ccompany { font-size: 30px; font-weight: 800; color: #1c2733; }
    .cline { font-size: 14px; color: #6b7c8d; letter-spacing: 1px; margin-bottom: 26px; }
    .cmeta { text-align: left; max-width: 150mm; margin: 0 auto; font-size: 12px; line-height: 1.9; }
    .cmeta .cdate { text-align: right; color: #46586a; }
    .cmeta .paren { color: #1769b0; }
    .cslogan { margin-top: 30mm; color: #1769b0; font-weight: 700; letter-spacing: 2px; }
  `;

  const doc = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Quotation — ${esc(m.company)} — ${esc(m.offerNo)}</title><style>${css}</style></head>
  <body>
    ${cover}${letter}${index}${goal}${systemKnow}${technical}${offer}${requirements}${monitoring}${reportSheet}${references}
  </body></html>`;

  const w = window.open('', '_blank');
  if (!w) { showToast('Allow pop-ups to print the quote', 'error'); return; }
  w.document.write(doc);
  w.document.close();
  w.focus();
  bumpOfferNumber(parseInt(m.offerNo, 10));
  setTimeout(() => w.print(), 400);
}

function buildProductFilterPillsHTML() {
  const cats = ['All', 'Boilers', 'Cooling Towers', 'Chillers', 'Swimming Pools'];
  return cats.map(c =>
    `<button class="pill${productFilterCategory === c ? ' active' : ''}" data-click="filterProductsByCategory" data-click-args="[&quot;${c}&quot;]">${c}</button>`
  ).join('');
}

function filterProductsByCategory(cat) {
  productFilterCategory = cat;
  document.getElementById('productFilterPills').innerHTML = buildProductFilterPillsHTML();
  document.getElementById('productsContainer').innerHTML = buildProductsSectionHTML();
}

const CATEGORY_COLORS = {
  boilers: 'var(--red)',
  cooling_towers: 'var(--blue)',
  chillers: 'var(--purple)',
  swimming_pools: 'var(--accent-2)',
};

function buildProductsSectionHTML() {
  if (currentClientProducts.length === 0) {
    return '<div style="text-align:center;padding:32px;color:var(--text-muted);font-size:13px;">No products yet. Add the first one above.</div>';
  }

  const grouped = {};
  for (const p of currentClientProducts) {
    if (!grouped[p.category]) grouped[p.category] = [];
    grouped[p.category].push(p);
  }

  const order = ['boilers', 'cooling_towers', 'chillers', 'swimming_pools'];
  // Apply category filter
  const filterKey = productFilterCategory !== 'All'
    ? Object.entries(CATEGORY_LABELS).find(([k,v]) => v === productFilterCategory)?.[0]
    : null;

  const visibleCats = order.filter(cat => grouped[cat] && (!filterKey || cat === filterKey));

  if (visibleCats.length === 0) {
    return '<div style="text-align:center;padding:32px;color:var(--text-muted);font-size:13px;">No products in this category.</div>';
  }

  return visibleCats.map(cat => {
    const products = grouped[cat];
    const color = CATEGORY_COLORS[cat] || 'var(--accent)';
    return `
      <div style="margin-top:16px;">
        <div style="font-family:'Syne',sans-serif;font-size:13px;font-weight:600;color:${color};margin-bottom:8px;letter-spacing:0.5px;">${CATEGORY_LABELS[cat]}</div>
        <div class="detail-cards">
          ${products.map(p => `
            <div class="detail-card" style="cursor:pointer;" data-click="openEditProduct" data-click-args="[&quot;${p.id}&quot;]">
              <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:6px;">
                <div class="detail-card-label" style="margin:0">${esc(p.productName || 'Unnamed')}</div>
                <span class="badge ${p.status === 'active' ? 'badge-active' : 'badge-stock'}" style="font-size:10px;padding:3px 8px;">${p.status === 'active' ? 'Active' : 'Low Stock'}</span>
              </div>
              ${p.model ? `<div style="font-size:12px;color:var(--text-muted);margin-bottom:4px;">Model: ${esc(p.model)}</div>` : ''}
              <div style="font-size:12px;color:var(--text-muted);">
                Qty: <strong style="color:var(--text)">${p.quantity}</strong>
                ${p.installDate ? ` · Purchased: ${formatDate(p.installDate)}` : ''}
                ${p.nextMaintenanceDate ? ` · Next purchase: <span class="${new Date(p.nextMaintenanceDate) < new Date() ? 'overdue' : ''}">${formatDate(p.nextMaintenanceDate)}</span>` : ''}
              </div>
              ${p.notes ? `<div style="font-size:11px;color:var(--text-muted);margin-top:4px;font-style:italic;">${esc(p.notes)}</div>` : ''}
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }).join('');
}

// ─── PRODUCT CRUD ───────────────────────────────────────
function openAddProductModal(clientId) {
  editingProductId = null;
  viewingClientId = clientId;
  document.getElementById('productModalTitle').textContent = 'Add Product';
  document.getElementById('p_category').value = 'boilers';
  updateProductNameOptions();
  document.getElementById('p_model').value = '';
  document.getElementById('p_quantity').value = '1';
  document.getElementById('p_installDate').value = '';
  document.getElementById('p_nextMaintenance').value = '';
  document.getElementById('p_status').value = 'active';
  document.getElementById('p_notes').value = '';
  document.getElementById('deleteProductBtn').style.display = 'none';
  document.getElementById('productModal').classList.add('open');
}

function openEditProduct(id) {
  const p = currentClientProducts.find(x => x.id === id);
  if (!p) return;
  editingProductId = id;
  document.getElementById('productModalTitle').textContent = 'Edit Product';
  document.getElementById('p_category').value = p.category;
  updateProductNameOptions();
  // Try to match stored product name to a catalog option
  const sel = document.getElementById('p_name');
  const match = [...sel.options].find(o => o.value === p.productName);
  if (match) {
    sel.value = p.productName;
  } else {
    sel.value = '__other__';
    document.getElementById('p_name_custom').style.display = '';
    document.getElementById('p_name_custom').value = p.productName;
  }
  document.getElementById('p_model').value = p.model;
  document.getElementById('p_quantity').value = p.quantity;
  document.getElementById('p_installDate').value = p.installDate || '';
  document.getElementById('p_nextMaintenance').value = p.nextMaintenanceDate || '';
  document.getElementById('p_status').value = p.status;
  document.getElementById('p_notes').value = p.notes;
  document.getElementById('deleteProductBtn').style.display = '';
  document.getElementById('productModal').classList.add('open');
}

async function saveProduct() {
  const nameVal = document.getElementById('p_name').value;
  const productName = nameVal === '__other__'
    ? document.getElementById('p_name_custom').value.trim()
    : nameVal;
  const product = {
    id: editingProductId || crypto.randomUUID(),
    clientId: viewingClientId,
    category: document.getElementById('p_category').value,
    productName: productName,
    model: document.getElementById('p_model').value.trim(),
    quantity: parseInt(document.getElementById('p_quantity').value) || 1,
    installDate: document.getElementById('p_installDate').value || null,
    nextMaintenanceDate: document.getElementById('p_nextMaintenance').value || null,
    status: document.getElementById('p_status').value,
    notes: document.getElementById('p_notes').value.trim(),
  };
  if (!product.productName) { showToast('Product name is required', 'error'); return; }
  try {
    const res = await fetch(FUNCTIONS_BASE + '/products', {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ product }),
    });
    if (!res.ok) throw new Error((await res.json()).error || 'Save failed');
    closeModal('productModal');
    showToast(editingProductId ? 'Product updated' : 'Product added', 'success');
    // Refresh detail view
    await showCustomerDetailView(viewingClientId);
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function deleteProduct() {
  if (!editingProductId) return;
  if (!confirm('Delete this product?')) return;
  try {
    const res = await fetch(FUNCTIONS_BASE + '/products?id=' + encodeURIComponent(editingProductId), { method: 'DELETE', headers: authHeaders() });
    if (!res.ok) throw new Error('Delete failed');
    closeModal('productModal');
    showToast('Product deleted', 'success');
    await showCustomerDetailView(viewingClientId);
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ─── LEAD → CLIENT CONVERSION ───────────────────────────
async function convertToClient(siteId) {
  if (!confirm('Convert this lead to a client?')) return;
  try {
    const res = await fetch(FUNCTIONS_BASE + '/convert', {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ siteId }),
    });
    const data = await res.json();
    if (!res.ok) {
      if (data.clientId) {
        // Already converted — navigate to the existing client
        showToast('Already converted — opening client', 'success');
        location.hash = 'customer/' + data.clientId;
        return;
      }
      throw new Error(data.error || 'Conversion failed');
    }
    // Remove the lead from local array
    sites = sites.filter(s => s.id !== siteId);
    showToast('Lead converted to client!', 'success');
    location.hash = 'customer/' + data.clientId;
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ─── ENGINEERS (admin) ──────────────────────────────────
let engineers = [];
let editingEngineerId = null;

async function loadEngineers() {
  if (currentEngineer?.role !== 'admin') return;
  try {
    const { rows } = await fetchAllPages('/engineers', 'engineers');
    engineers = rows;
    renderEngineerStats();
    renderEngineerTable();
  } catch (err) {
    if (err.message === 'unauthorized') return;
    console.error(err);
  }
}

function renderEngineerStats() {
  const total = engineers.length;
  const active = engineers.filter(e => e.isActive).length;
  const admins = engineers.filter(e => e.role === 'admin').length;
  const stats = [
    { label: 'Total Engineers', val: total, color: 'var(--text)' },
    { label: 'Active', val: active, color: 'var(--blue)' },
    { label: 'Admins', val: admins, color: 'var(--purple)' },
  ];
  document.getElementById('engineerStatsRow').innerHTML = stats.map(s => `
    <div class="stat-card">
      <div class="stat-label">${s.label}</div>
      <div class="stat-val" style="color:${s.color}">${s.val}</div>
    </div>
  `).join('');
}

function renderEngineerTable() {
  const q = (document.getElementById('engineerSearchInput')?.value || '').toLowerCase();
  let filtered = engineers.filter(e => {
    if (q && !(e.fullName + e.username + e.role).toLowerCase().includes(q)) return false;
    return true;
  });

  document.getElementById('engineerRowCount').textContent = `${filtered.length} engineer${filtered.length !== 1 ? 's' : ''}`;

  document.getElementById('engineerTableBody').innerHTML = filtered.map(e => `
    <tr data-click="viewEngineer" data-click-args="[&quot;${e.id}&quot;]" style="cursor:pointer">
      <td><strong>${esc(e.fullName)}</strong></td>
      <td><span style="font-family:'DM Mono',monospace;font-size:12px">${esc(e.username)}</span></td>
      <td><span class="badge ${e.role === 'admin' ? 'badge-hp' : 'badge-qp'}" style="font-size:11px;padding:3px 10px;">${e.role}</span></td>
      <td><span class="badge ${e.isActive ? 'badge-active' : 'badge-stock'}" style="font-size:11px;padding:3px 10px;">${e.isActive ? 'Active' : 'Disabled'}</span></td>
      <td>
        <button class="row-btn" data-click="openEditEngineer" data-click-args="[&quot;${e.id}&quot;]" data-stop>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>
        </button>
      </td>
    </tr>
  `).join('');
}

function openAddEngineerModal() {
  editingEngineerId = null;
  document.getElementById('engineerModalTitle').textContent = 'Add Engineer';
  document.getElementById('eng_name').value = '';
  document.getElementById('eng_username').value = '';
  document.getElementById('eng_password').value = '';
  document.getElementById('eng_role').value = 'engineer';
  document.getElementById('engineerModal').classList.add('open');
}

function openEditEngineer(id) {
  const e = engineers.find(x => x.id === id);
  if (!e) return;
  editingEngineerId = id;
  document.getElementById('engineerModalTitle').textContent = 'Edit Engineer';
  document.getElementById('eng_name').value = e.fullName;
  document.getElementById('eng_username').value = e.username;
  document.getElementById('eng_password').value = '';
  document.getElementById('eng_role').value = e.role;
  document.getElementById('engineerModal').classList.add('open');
}

async function saveEngineer() {
  const engineer = {
    id: editingEngineerId || undefined,
    fullName: document.getElementById('eng_name').value.trim(),
    username: document.getElementById('eng_username').value.trim(),
    password: document.getElementById('eng_password').value || undefined,
    role: document.getElementById('eng_role').value,
  };
  if (!engineer.username) { showToast('Username is required', 'error'); return; }
  if (!editingEngineerId && !engineer.password) { showToast('Password is required for new engineer', 'error'); return; }
  try {
    const res = await fetch(FUNCTIONS_BASE + '/engineers', {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ engineer }),
    });
    if (!res.ok) throw new Error((await res.json()).error || 'Save failed');
    closeModal('engineerModal');
    showToast(editingEngineerId ? 'Engineer updated' : 'Engineer added', 'success');
    await loadEngineers();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function showEngineerDetailView(id) {
  // Make sure engineers are loaded
  if (engineers.length === 0) {
    await loadEngineers();
  }
  const eng = engineers.find(x => x.id === id);
  if (!eng) { showListView(); return; }

  // Fetch this engineer's leads and clients in parallel (all pages each)
  let engLeads = [], engClients = [], totalLowStock = 0;
  try {
    const q = '?engineerId=' + encodeURIComponent(id);
    const [leadsResult, clientsResult] = await Promise.all([
      fetchAllPages('/sites' + q, 'sites'),
      fetchAllPages('/clients' + q, 'clients'),
    ]);
    engLeads = leadsResult.rows;
    engClients = clientsResult.rows;
    // totalLowStock is reported per page — recompute from the full result set.
    totalLowStock = engClients.reduce((sum, c) => sum + (c.lowStockCount || 0), 0);
  } catch (err) {
    if (err.message !== 'unauthorized') console.error('Failed to load engineer data:', err);
  }

  document.querySelector('main').style.display = 'none';
  document.getElementById('clientsSection').style.display = 'none';
  document.getElementById('engineersSection').style.display = 'none';
  document.getElementById('locationSection').style.display = 'none';
  document.querySelector('.name-banner').style.display = 'none';
  document.querySelector('.tab-bar').style.display = 'none';

  document.getElementById('backLabel').textContent = 'Back to team';

  document.getElementById('detailContent').innerHTML = buildEngineerDetailHTML(eng, engLeads, engClients, totalLowStock);
  document.getElementById('detailPage').classList.add('active');
  window.scrollTo(0, 0);
}

function buildEngineerDetailHTML(e, leads, clients, totalLowStock) {
  const today = new Date(); today.setHours(0,0,0,0);
  const soon = new Date(today); soon.setDate(soon.getDate() + 2);

  // Build leads rows
  let leadsHTML = '';
  if (leads.length === 0) {
    leadsHTML = '<div style="text-align:center;padding:32px;color:var(--text-muted);font-size:13px;">No leads yet.</div>';
  } else {
    leadsHTML = `<div class="table-wrap"><table><thead><tr>
      <th>Name</th><th>Status</th><th>Contact</th><th>Due Date</th>
    </tr></thead><tbody>` + leads.map(s => {
      const badgeClass = STATUS_MAP[s.status] || 'badge-lost';
      const badgeLabel = STATUS_SHORT[s.status] || s.status || '—';
      let dueCls = '';
      if (s.dueDate) {
        const d = new Date(s.dueDate);
        if (d < today) dueCls = 'overdue';
        else if (d <= soon) dueCls = 'soon';
      }
      return `<tr data-click="viewClient" data-click-args="[&quot;${s.id}&quot;]" style="cursor:pointer">
        <td><strong>${esc(s.name || '—')}</strong></td>
        <td><span class="badge ${badgeClass}" style="font-size:11px;padding:3px 10px;">${esc(badgeLabel)}</span></td>
        <td>${esc(s.contact || '—')}</td>
        <td>${s.dueDate ? `<span class="due-date ${dueCls}">${formatDate(s.dueDate)}</span>` : '—'}</td>
      </tr>`;
    }).join('') + '</tbody></table></div>';
  }

  // Build clients rows
  let clientsHTML = '';
  if (clients.length === 0) {
    clientsHTML = '<div style="text-align:center;padding:32px;color:var(--text-muted);font-size:13px;">No clients yet.</div>';
  } else {
    clientsHTML = `<div class="table-wrap"><table><thead><tr>
      <th>Name</th><th>Contact</th><th>Products</th><th>Categories</th>
    </tr></thead><tbody>` + clients.map(c => {
      return `<tr data-click="viewCustomer" data-click-args="[&quot;${c.id}&quot;]" style="cursor:pointer">
        <td><strong>${esc(c.name || 'Unnamed')}</strong></td>
        <td>${esc(c.contact || '—')}</td>
        <td><span style="font-family:'DM Mono',monospace;font-size:12px">${c.productCount || 0}</span></td>
        <td>${(c.categories || []).map(cat => `<span class="cat-chip cat-${cat}">${CATEGORY_LABELS[cat] || cat}</span>`).join(' ')}</td>
      </tr>`;
    }).join('') + '</tbody></table></div>';
  }

  return `
    <div class="detail-header">
      <div>
        <div class="detail-title">${esc(e.fullName || 'Unnamed Engineer')}</div>
        <div style="margin-top:8px; display:flex; align-items:center; gap:12px; flex-wrap:wrap;">
          <span class="badge ${e.role === 'admin' ? 'badge-hp' : 'badge-qp'}" style="font-size:12px; padding:5px 14px;">${esc(e.role)}</span>
          <span class="badge ${e.isActive ? 'badge-active' : 'badge-stock'}" style="font-size:12px; padding:5px 14px;">${e.isActive ? 'Active' : 'Disabled'}</span>
          <span style="font-family:'DM Mono',monospace; font-size:11px; color:var(--text-muted);">@${esc(e.username)}</span>
          ${e.createdAt ? `<span style="font-family:'DM Mono',monospace; font-size:11px; color:var(--text-muted);">Joined ${formatDateTime(e.createdAt)}</span>` : ''}
        </div>
      </div>
      <div class="detail-actions">
        <button class="btn btn-ghost" data-click="openEditEngineer" data-click-args="[&quot;${e.id}&quot;]">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>
          Edit
        </button>
      </div>
    </div>

    <div class="stats-row" style="margin-bottom:24px;">
      <div class="stat-card">
        <div class="stat-label">Total Leads</div>
        <div class="stat-val" style="color:var(--accent)">${leads.length}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Total Clients</div>
        <div class="stat-val" style="color:var(--blue)">${clients.length}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Low Stock</div>
        <div class="stat-val" style="color:${totalLowStock > 0 ? 'var(--orange)' : 'var(--text)'}">${totalLowStock}</div>
      </div>
    </div>

    <div class="detail-section">
      <div class="detail-section-title">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-2px;margin-right:6px;"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
        Leads <span style="font-family:'DM Mono',monospace;font-size:12px;color:var(--text-muted);margin-left:8px;">${leads.length}</span>
      </div>
      ${leadsHTML}
    </div>

    <div class="detail-section">
      <div class="detail-section-title">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-2px;margin-right:6px;"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
        Clients <span style="font-family:'DM Mono',monospace;font-size:12px;color:var(--text-muted);margin-left:8px;">${clients.length}</span>
      </div>
      ${clientsHTML}
    </div>
  `;
}

function handleRoute() {
  if (_suppressRoute) return;
  if (!isAuthenticated) return;
  const hash = location.hash.replace('#', '');

  // Backward compat: #client/id → #lead/id
  if (hash.startsWith('client/')) {
    location.hash = 'lead/' + hash.split('/')[1];
    return;
  }

  if (hash.startsWith('lead/')) {
    const id = hash.split('/')[1];
    activeTab = 'leads';
    document.querySelectorAll('.tab-bar .tab').forEach(t => t.classList.toggle('active', t.dataset.tab === 'leads'));
    updateHeaderButtons('leads');
    if (sites.length > 0) {
      showDetailView(id);
    } else {
      pendingRoute = hash;
    }
    return;
  }

  if (hash.startsWith('customer/')) {
    const id = hash.split('/')[1];
    activeTab = 'clients';
    document.querySelectorAll('.tab-bar .tab').forEach(t => t.classList.toggle('active', t.dataset.tab === 'clients'));
    updateHeaderButtons('clients');
    showCustomerDetailView(id);
    return;
  }

  if (hash === 'clients') {
    activeTab = 'clients';
    document.querySelectorAll('.tab-bar .tab').forEach(t => t.classList.toggle('active', t.dataset.tab === 'clients'));
    updateHeaderButtons('clients');
    showListView();
    showClientSkeletons();
    loadClients();
    return;
  }

  if (hash.startsWith('engineer/')) {
    if (currentEngineer?.role !== 'admin') { location.hash = ''; return; }
    const id = hash.split('/')[1];
    activeTab = 'engineers';
    document.querySelectorAll('.tab-bar .tab').forEach(t => t.classList.toggle('active', t.dataset.tab === 'engineers'));
    updateHeaderButtons('engineers');
    showEngineerDetailView(id);
    return;
  }

  if (hash === 'engineers') {
    if (currentEngineer?.role !== 'admin') { location.hash = ''; return; }
    activeTab = 'engineers';
    document.querySelectorAll('.tab-bar .tab').forEach(t => t.classList.toggle('active', t.dataset.tab === 'engineers'));
    updateHeaderButtons('engineers');
    showListView();
    showEngineerSkeletons();
    loadEngineers();
    return;
  }

  if (hash === 'location') {
    if (currentEngineer?.role !== 'admin') { location.hash = ''; return; }
    activeTab = 'location';
    document.querySelectorAll('.tab-bar .tab').forEach(t => t.classList.toggle('active', t.dataset.tab === 'location'));
    updateHeaderButtons('location');
    showListView();
    loadLocationMap();
    return;
  }

  // Default: leads
  activeTab = 'leads';
  document.querySelectorAll('.tab-bar .tab').forEach(t => t.classList.toggle('active', t.dataset.tab === 'leads'));
  updateHeaderButtons('leads');
  showListView();
}

let pendingRoute = null;
window.addEventListener('hashchange', handleRoute);

// ─── SESSION GUARD ──────────────────────────────────────
// Re-verify session when user returns to the tab
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState === 'visible' && isAuthenticated) {
    try {
      const r = await fetch(FUNCTIONS_BASE + '/auth', { headers: authHeaders() });
      const d = await r.json();
      if (!d.authed) { clearAuthToken(); showLogin(); }
    } catch {}
  }
});

// ─── INIT ────────────────────────────────────────────────
// Splash screen is visible — loadData() checks auth, then either shows login or app
loadData();
