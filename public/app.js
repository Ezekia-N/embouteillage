/**
 * AMBOTAKA - app.js
 * Complete frontend logic
 */

'use strict';

var IsOpen = true;

// ── Configuration ────────────────────────────────────────────────────────────
// Auto-detect: if running on localhost use ws://, else wss://
const isLocal = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
const API_BASE = '';   // same origin
const WS_URL = (isLocal ? 'ws://' : 'wss://') + location.host;

document.getElementById("profileUpload").style.visibility = "hidden";
const mitadyId = document.getElementById("mitadyId");

// ── State ────────────────────────────────────────────────────────────────────
let currentUser = null;
let token = localStorage.getItem('ambotaka_token') || null;
let ws = null;
let map = null;
let markerCluster = null;
let heatLayer = null;
let heatmapActive = false;
let incidents = [];
let incidentMarkers = {}; // id → marker
let userPosition = null;
let activeFilter = 'all';
let selectedIncidentType = 'accident';
let selectedPriorityType = 'travaux';
let recognizing = false;
let recognition = null;
let routeLine = null;
let currentIncidentId = null; // for detail modal
let hourlyChart = null;

// ── Incident config ───────────────────────────────────────────────────────────
const INCIDENT_CONFIG = {
  accident:      { label: 'Loza',           icon: 'fa-car-crash',         color: '#dc2626', bg: '#fee2e2' },
  embouteillage: { label: 'Embouteillage',  icon: 'fa-traffic-light',     color: '#d97706', bg: '#fef3c7' },
  route_fermee:  { label: 'Voarindrina',    icon: 'fa-road',              color: '#7c3aed', bg: '#ede9fe' },
  travaux:       { label: 'Asa',            icon: 'fa-hard-hat',          color: '#0369a1', bg: '#e0f2fe' },
  inondation:    { label: 'Ranobe',         icon: 'fa-water',             color: '#0891b2', bg: '#cffafe' },
  controle:      { label: 'Fanaraha-maso',  icon: 'fa-shield-alt',        color: '#059669', bg: '#d1fae5' },
  anomalie:      { label: 'Anomalia',       icon: 'fa-exclamation-triangle', color: '#ea580c', bg: '#ffedd5' },
  autres:        { label: 'Hafa',           icon: 'fa-question-circle',   color: '#64748b', bg: '#f1f5f9' }
};

// ── API helpers ───────────────────────────────────────────────────────────────
async function api(method, path, body = null, isFormData = false) {
  const opts = {
    method,
    headers: { 'Authorization': `Bearer ${token}` }
  };
  if (body) {
    if (isFormData) { opts.body = body; }
    else { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
  }
  const res = await fetch(API_BASE + path, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Lesoka tsy fantatra');
  return data;
}

// ── Toast ─────────────────────────────────────────────────────────────────────
function toast(msg, type = 'info', duration = 3500) {
  const tc = document.getElementById('toastContainer');
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  const icons = { success: '✅', error: '❌', warning: '⚠️', priority: '🚨', info: 'ℹ️' };
  t.innerHTML = `<span>${icons[type] || 'ℹ️'}</span><span>${msg}</span>`;
  tc.appendChild(t);
  setTimeout(() => t.remove(), duration);
}

// ── Message boxes ─────────────────────────────────────────────────────────────
function showMsg(id, msg, isError = true) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = msg;
  el.className = 'message-box ' + (isError ? 'error-msg' : 'success-msg');
  setTimeout(() => { if (el.textContent === msg) el.innerHTML = ''; }, 3500);
}

// ── Auth logic ────────────────────────────────────────────────────────────────
async function doLogin(username, password) {
  try {
    const data = await api('POST', '/api/login', { username, password });
    token = data.token;
    localStorage.setItem('ambotaka_token', token);
    currentUser = data.user;
    onLoggedIn();
  } catch(e) { showMsg('loginMsg', e.message); }
}

async function doRegister(formData) {
  try {
    const data = await fetch(API_BASE + '/api/register', {
      method: 'POST', body: formData
    }).then(r => r.json());
    if (data.error) { showMsg('signupMsg', data.error); return; }
    showMsg('signupMsg', data.message || 'Vita!', false);
    setTimeout(() => {
      showLoginForm();
      document.getElementById('loginUsername').value = formData.get('username');
      showMsg('loginMsg', 'Kaonty vita. Ampidiro ny teny miafinao.', false);
    }, 1500);
  } catch(e) { showMsg('signupMsg', 'Lesoka tampoka. Andamo indray.'); }
}

async function doLogout() {
  try { await api('POST', '/api/logout'); } catch(e) {}
  token = null;
  currentUser = null;
  localStorage.removeItem('ambotaka_token');
  if (ws) ws.close();
  document.getElementById('appScreen').classList.add('hidden');
  document.getElementById('authScreen').classList.remove('hidden');
  toast('Niala soa aman-tsara', 'info');
}

// ── Init after login ──────────────────────────────────────────────────────────
function onLoggedIn() {
  document.getElementById('authScreen').classList.add('hidden');
  document.getElementById('appScreen').classList.remove('hidden');
  updateNavProfile();
  initMap();
  connectWS();
  loadIncidents();
  getPosition();
  // Admin button
  if (currentUser.role === 'admin') {
    document.getElementById('adminPanelBtn').style.display = 'flex';
  }
}

// ── Profile UI ────────────────────────────────────────────────────────────────
function updateNavProfile() {
  if (!currentUser) return;
  // Nav avatar
  if (currentUser.profilePic) {
    document.getElementById('navAvatar').src = currentUser.profilePic;
    document.getElementById('navAvatar').style.display = 'block';
    document.getElementById('navAvatarIcon').style.display = 'none';
  } else {
    document.getElementById('navAvatar').style.display = 'none';
    document.getElementById('navAvatarIcon').style.display = 'block';
  }
  // Dropdown
  document.getElementById('dropdownUsername').textContent = currentUser.username;
  document.getElementById('dropdownRole').textContent = currentUser.role === 'admin' ? 'Administrateur' : 'Mpampiasa';
  document.getElementById('userPoints').textContent = currentUser.points;
  document.getElementById('userReliability').textContent = currentUser.reliability;
  if (currentUser.profilePic) {
    document.getElementById('dropdownAvatar').src = currentUser.profilePic;
    document.getElementById('dropdownAvatar').style.display = 'block';
    document.getElementById('dropdownAvatarIcon').style.display = 'none';
  }
  renderBadges();
}

function renderBadges() {
  const BADGE_LABELS = {
    admin: { label: 'Admin', cls: 'admin-badge' },
    fondateur: { label: 'Mpanorina', cls: '' },
    debutant: { label: 'Mpianatra', cls: '' },
    alerte: { label: 'Mpiambina', cls: '' },
    expert: { label: 'Manampahaizana', cls: '' },
    champion: { label: 'Champion', cls: '' },
    legende: { label: 'Lohahevitra', cls: '' }
  };
  const wrap = document.getElementById('dropdownBadges');
  wrap.innerHTML = (currentUser.badges || []).map(b => {
    const bd = BADGE_LABELS[b] || { label: b, cls: '' };
    return `<span class="badge-pill ${bd.cls}">${bd.label}</span>`;
  }).join('');
}

// ── MAP ───────────────────────────────────────────────────────────────────────
function initMap() {
  if (map) return;
  // Center on Antananarivo
  map = L.map('map', { zoomControl: false }).setView([-18.9137, 47.5361], 13);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap contributors', maxZoom: 19
  }).addTo(map);
  L.control.zoom({ position: 'topleft' }).addTo(map);
  markerCluster = L.markerClusterGroup({ maxClusterRadius: 60 });
  map.addLayer(markerCluster);
}

function getPosition() {
  if (!navigator.geolocation) { toast('GPS tsy misy amin\'ity fitaovana ity', 'warning'); return; }
  navigator.geolocation.getCurrentPosition(pos => {
    userPosition = { lat: pos.coords.latitude, lng: pos.coords.longitude };
    if (map) {
      L.circleMarker([userPosition.lat, userPosition.lng], {
        radius: 8, fillColor: '#3b82f6', color: 'white', weight: 2, fillOpacity: 1
      }).addTo(map).bindPopup('<b>Toeranao ankehitriny</b>');
      map.setView([userPosition.lat, userPosition.lng], 14);
    }
    document.getElementById('gpsInfoText').textContent = `Toerana: ${userPosition.lat.toFixed(5)}, ${userPosition.lng.toFixed(5)}`;
    document.getElementById('priorityGpsText') && (document.getElementById('priorityGpsText').textContent = document.getElementById('gpsInfoText').textContent);
  }, err => {
    toast('Tsy azo ny toerana GPS. Alefaso ny GPS.', 'warning');
    document.getElementById('gpsInfoText').textContent = 'GPS tsy hita - alefaso ny GPS aloha';
  });
}

// ── Incidents ─────────────────────────────────────────────────────────────────
async function loadIncidents() {
  try {
    incidents = await api('GET', '/api/incidents');
    renderMarkers();
  } catch(e) { toast('Tsy azo ny lisi-signal: ' + e.message, 'error'); }
}

function makeMarkerIcon(incident) {
  const cfg = INCIDENT_CONFIG[incident.type] || INCIDENT_CONFIG.autres;
  const isPriority = incident.isPriority || incident.authorRole === 'admin';
  const border = isPriority ? `border:3px solid #e11d48;box-shadow:0 0 12px rgba(225,29,72,0.7);` : '';
  return L.divIcon({
    className: '',
    html: `<div style="width:36px;height:36px;border-radius:50%;background:${cfg.bg};display:flex;align-items:center;justify-content:center;font-size:14px;color:${cfg.color};${border}box-shadow:0 3px 8px rgba(0,0,0,0.2);">
      <i class="fas ${cfg.icon}"></i>
    </div>`,
    iconSize: [36, 36], iconAnchor: [18, 18], popupAnchor: [0, -20]
  });
}

function renderMarkers() {
  markerCluster.clearLayers();
  incidentMarkers = {};

  incidents.forEach(inc => {
    if (activeFilter !== 'all' && inc.type !== activeFilter) return;
    const cfg = INCIDENT_CONFIG[inc.type] || INCIDENT_CONFIG.autres;
    const marker = L.marker([inc.lat, inc.lng], { icon: makeMarkerIcon(inc) });
    const age = Math.round((Date.now() - new Date(inc.createdAt).getTime()) / 60000);
    const isPriority = inc.isPriority || inc.authorRole === 'admin';
    marker.bindPopup(`
      <div class="popup-title" style="color:${cfg.color};">
        <i class="fas ${cfg.icon}"></i>${isPriority ? '🚨 ' : ''}${cfg.label}
      </div>
      <div class="popup-meta">
        ${inc.description || ''}<br>
        <i class="fas fa-user" style="color:#94a3b8;"></i> ${inc.authorName} · ${age}min lasa
        <br>👍 ${inc.votes.up.length} · 👎 ${inc.votes.down.length}
      </div>
      <button class="popup-btn" onclick="openDetailModal('${inc.id}')">
        <i class="fas fa-info-circle"></i> Jereo bebe kokoa
      </button>
    `);
    markerCluster.addLayer(marker);
    incidentMarkers[inc.id] = marker;
  });
}

// ── Detail Modal ──────────────────────────────────────────────────────────────
window.openDetailModal = function(incidentId) {
  const inc = incidents.find(i => i.id === incidentId);
  if (!inc) return;
  currentIncidentId = incidentId;
  const cfg = INCIDENT_CONFIG[inc.type] || INCIDENT_CONFIG.autres;
  const isPriority = inc.isPriority || inc.authorRole === 'admin';
  const age = Math.round((Date.now() - new Date(inc.createdAt).getTime()) / 60000);
  const userUp = inc.votes.up.includes(currentUser?.id);
  const userDown = inc.votes.down.includes(currentUser?.id);
  const isOwn = inc.authorId === currentUser?.id;

  document.getElementById('detailTitle').innerHTML = `
    <span style="color:${cfg.color};"><i class="fas ${cfg.icon}"></i></span>
    ${isPriority ? '🚨 ' : ''}${cfg.label}`;

  const body = document.getElementById('detailBody');
  body.innerHTML = `
    <div class="incident-detail-header">
      <div class="incident-type-icon" style="background:${cfg.bg};color:${cfg.color};">
        <i class="fas ${cfg.icon}"></i>
      </div>
      <div>
        <div style="font-weight:700;font-size:0.9rem;color:#0f172a;">${inc.description || cfg.label}</div>
        <div style="font-size:0.7rem;color:#94a3b8;margin-top:2px;">
          <i class="fas fa-user"></i> ${inc.authorName} · <i class="fas fa-clock"></i> ${age} min lasa
          ${isPriority ? ' · <span style="color:#e11d48;font-weight:700;">Signal Ofisialy</span>' : ''}
        </div>
      </div>
    </div>
    ${inc.photo ? `<img src="${inc.photo}" style="width:100%;border-radius:0.75rem;max-height:180px;object-fit:cover;margin-bottom:0.75rem;">` : ''}
    ${!isOwn ? `
    <div class="vote-section">
      <button class="vote-btn vote-up ${userUp ? 'active' : ''}" onclick="doVote('${inc.id}','up')">
        <i class="fas fa-thumbs-up"></i> Manamarina (${inc.votes.up.length})
      </button>
      <button class="vote-btn vote-down ${userDown ? 'active' : ''}" onclick="doVote('${inc.id}','down')">
        <i class="fas fa-thumbs-down"></i> Manda (${inc.votes.down.length})
      </button>
    </div>` : `<p style="font-size:0.75rem;color:#94a3b8;text-align:center;margin-bottom:0.75rem;">Ianao no nandefa ity signal ity</p>`}
    <div class="comments-section">
      <h4><i class="fas fa-comments"></i> Hafatra (${inc.comments.length})</h4>
      <div class="comment-list" id="commentList">
        ${(inc.comments || []).map(c => `
          <div class="comment-item">
            <div class="comment-author">${c.authorName}</div>
            <div class="comment-text">${c.text}</div>
            <div class="comment-time">${formatTime(c.createdAt)}</div>
          </div>
        `).join('') || '<p style="font-size:0.75rem;color:#94a3b8;text-align:center;padding:0.5rem;">Tsy misy hafatra mbola</p>'}
      </div>
      <div class="comment-input-row">
        <input type="text" id="newComment" placeholder="Ampidiro hafatra...">
        <button onclick="submitComment('${inc.id}')"><i class="fas fa-paper-plane"></i></button>
      </div>
    </div>
    ${currentUser?.role === 'admin' ? `
    <hr style="border-color:#e2e8f0;margin:0.75rem 0;">
    <button onclick="adminDeleteIncident('${inc.id}')" style="width:100%;background:#fef2f2;color:#b91c1c;border:1px solid #fecaca;border-radius:0.75rem;padding:0.5rem;font-size:0.8rem;font-weight:700;cursor:pointer;">
      <i class="fas fa-trash"></i> Fafao ity signal ity (Admin)
    </button>` : ''}
  `;
  document.getElementById('detailModal').classList.remove('hidden');
};

async function doVote(id, vote) {
  try {
    const data = await api('POST', `/api/incidents/${id}/vote`, { vote });
    // Update local
    const inc = incidents.find(i => i.id === id);
    if (inc) inc.votes = data.votes;
    openDetailModal(id); // Re-render
    toast(vote === 'up' ? 'Nanamarina ny signal ✅' : 'Nanda ny signal', vote === 'up' ? 'success' : 'warning');
  } catch(e) { toast(e.message, 'error'); }
}

async function submitComment(incidentId) {
  const input = document.getElementById('newComment');
  const text = input.value.trim();
  if (!text) return;
  try {
    const comment = await api('POST', `/api/incidents/${incidentId}/comments`, { text });
    const inc = incidents.find(i => i.id === incidentId);
    if (inc) inc.comments.push(comment);
    input.value = '';
    openDetailModal(incidentId);
  } catch(e) { toast(e.message, 'error'); }
}

window.adminDeleteIncident = async function(id) {
  if (!confirm('Hofafaina ny signal ity?')) return;
  try {
    await api('DELETE', `/api/admin/incidents/${id}`);
    incidents = incidents.filter(i => i.id !== id);
    renderMarkers();
    closeModal('detailModal');
    toast('Signal hofafaina', 'success');
  } catch(e) { toast(e.message, 'error'); }
};

// ── Post incident ─────────────────────────────────────────────────────────────
async function submitIncident(e) {
  e.preventDefault();
  if (!userPosition) {
    toast('Tsy hita ny toeranao GPS. Alefaso ny GPS aloha.', 'error');
    return;
  }
  const formData = new FormData();
  formData.append('type', selectedIncidentType);
  formData.append('description', document.getElementById('incidentDescription').value);
  formData.append('duration', document.getElementById('incidentDuration').value);
  formData.append('lat', userPosition.lat);
  formData.append('lng', userPosition.lng);
  const photo = document.getElementById('incidentPhoto').files[0];
  if (photo) formData.append('photo', photo);

  try {
    const incident = await api('POST', '/api/incidents', formData, true);
    incidents.push(incident);
    renderMarkers();
    closeModal('incidentModal');
    toast('Signal nalefa! +10 pts', 'success');
    currentUser.points += 10;
    document.getElementById('userPoints').textContent = currentUser.points;
    // Reset form
    document.getElementById('incidentDescription').value = '';
    document.getElementById('incidentDuration').value = '30';
    document.getElementById('incidentPhoto').value = '';
    document.getElementById('photoPreviewWrap').classList.add('hidden');
  } catch(e) { toast('Lesoka: ' + e.message, 'error'); }
}

// ── WebSocket ─────────────────────────────────────────────────────────────────
function connectWS() {
  try {
    ws = new WebSocket(WS_URL);
    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'AUTH', token }));
    };
    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        handleWSMessage(msg);
      } catch(err) {}
    };
    ws.onclose = () => {
      setTimeout(() => { if (token) connectWS(); }, 3000);
    };
  } catch(e) {}
}

function handleWSMessage(msg) {
  switch(msg.type) {
    case 'ONLINE_COUNT':
      document.getElementById('onlineCount').textContent = msg.data.count;
      break;
    case 'NEW_INCIDENT':
      if (!incidents.find(i => i.id === msg.data.id)) {
        incidents.push(msg.data);
        renderMarkers();
        const cfg = INCIDENT_CONFIG[msg.data.type] || INCIDENT_CONFIG.autres;
        toast(`Signal vaovao: ${cfg.label} avy amin'i ${msg.data.authorName}`, msg.data.isPriority ? 'priority' : 'info');
      }
      break;
    case 'PRIORITY_INCIDENT':
      if (!incidents.find(i => i.id === msg.data.id)) {
        incidents.push(msg.data);
        renderMarkers();
        toast(`🚨 Signal Ofisialy: ${msg.data.description}`, 'priority', 6000);
      }
      break;
    case 'VOTE_UPDATE': {
      const inc = incidents.find(i => i.id === msg.data.incidentId);
      if (inc) inc.votes = msg.data.votes;
      break;
    }
    case 'NEW_COMMENT': {
      const inc = incidents.find(i => i.id === msg.data.incidentId);
      if (inc) inc.comments.push(msg.data.comment);
      if (currentIncidentId === msg.data.incidentId) {
        openDetailModal(currentIncidentId); // refresh comments
      }
      break;
    }
    case 'INCIDENTS_EXPIRED':
      loadIncidents();
      toast('Ola signal vita lany andro', 'info', 2000);
      break;
    case 'USER_BANNED':
      if (msg.data.userId === currentUser?.id && msg.data.banned) {
        toast('Voarara ny kaontinao. Hiala.', 'error', 5000);
        setTimeout(doLogout, 2000);
      }
      break;
    case 'WARNING':
      if (msg.data.userId === currentUser?.id) {
        toast(`⚠️ Hafatra avy amin'ny Admin: ${msg.data.message}`, 'warning', 8000);
      }
      break;
    case 'BADGE_EARNED':
      if (msg.data.userId === currentUser?.id) {
        toast(`🏅 Badge vaovao: ${msg.data.badge.label}!`, 'success', 5000);
        if (!currentUser.badges.includes(msg.data.badge.id)) {
          currentUser.badges.push(msg.data.badge.id);
          renderBadges();
        }
      }
      break;
  }
}

// ── Heatmap ───────────────────────────────────────────────────────────────────
async function toggleHeatmap() {
  if (heatmapActive) {
    if (heatLayer) map.removeLayer(heatLayer);
    heatmapActive = false;
    document.getElementById('heatmapBtn').classList.remove('active');
    document.getElementById('heatmapOverlay').classList.add('hidden');
    return;
  }
  try {
    const points = await api('GET', '/api/heatmap');
    const data = points.map(p => [p.lat, p.lng, p.weight]);
    heatLayer = L.heatLayer(data, { radius: 35, blur: 20, maxZoom: 16, max: 5 });
    map.addLayer(heatLayer);
    heatmapActive = true;
    document.getElementById('heatmapBtn').classList.add('active');
    document.getElementById('heatmapOverlay').classList.remove('hidden');
    toast('Heatmap miseho', 'info', 2000);
  } catch(e) { toast('Tsy azo ny heatmap', 'error'); }
}

// ── Route search ──────────────────────────────────────────────────────────────
async function searchRoute() {
  const dest = document.getElementById('destinationInput').value.trim();
  if (!dest) { toast('Ampidiro ny toerana haleha', 'warning'); return; }
  if (!userPosition) { toast('Tsy hita ny toeranao. Alefaso ny GPS.', 'error'); return; }

  // Use Nominatim for geocoding
  const res = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(dest + ', Madagascar')}&format=json&limit=3`);
  const results = await res.json().catch(() => []);

  const container = document.getElementById('routeResults');
  if (!results.length) { container.innerHTML = '<p style="font-size:0.8rem;color:#94a3b8;text-align:center;padding:1rem;">Tsy hita ny toerana</p>'; return; }

  container.innerHTML = results.map((r, i) => {
    const destLat = parseFloat(r.lat);
    const destLng = parseFloat(r.lon);
    // Check incidents along rough bounding box
    const incidentsOnRoute = incidents.filter(inc => {
      const minLat = Math.min(userPosition.lat, destLat) - 0.01;
      const maxLat = Math.max(userPosition.lat, destLat) + 0.01;
      const minLng = Math.min(userPosition.lng, destLng) - 0.01;
      const maxLng = Math.max(userPosition.lng, destLng) + 0.01;
      return inc.lat >= minLat && inc.lat <= maxLat && inc.lng >= minLng && inc.lng <= maxLng;
    });
    const status = incidentsOnRoute.length === 0 ? 'clear' : incidentsOnRoute.length <= 2 ? 'warning' : 'blocked';
    const statusLabel = { clear: '✅ Lalana madio', warning: `⚠️ ${incidentsOnRoute.length} signal`, blocked: `🚫 ${incidentsOnRoute.length} signal maro` };
    const dist = Math.round(Math.sqrt(Math.pow((destLat - userPosition.lat) * 111, 2) + Math.pow((destLng - userPosition.lng) * 111 * Math.cos(userPosition.lat * Math.PI / 180), 2)) * 10) / 10;

    return `<div class="route-option" onclick="showRoute(${userPosition.lat},${userPosition.lng},${destLat},${destLng},'${r.display_name.split(',')[0]}')">
      <h4><i class="fas fa-map-marker-alt" style="color:#3b82f6;"></i> ${r.display_name.split(',')[0]}</h4>
      <p style="font-size:0.68rem;">${r.display_name}</p>
      <div style="display:flex;align-items:center;gap:0.5rem;margin-top:4px;">
        <span class="route-badge ${status}">${statusLabel[status]}</span>
        <span style="font-size:0.68rem;color:#64748b;">${dist} km</span>
      </div>
    </div>`;
  }).join('');
}



window.showRoute = function(fromLat, fromLng, toLat, toLng, name) {

  // Open in Google Maps
  if (IsOpen)
  {
    const gmUrl = `https://www.google.com/maps/dir/${fromLat},${fromLng}/${toLat},${toLng}`;
    window.location.href = `${gmUrl}`;
    // const btn = document.createElement('div');
    // btn.style.cssText = 'position:fixed;bottom:5rem;left:50%;transform:translateX(-50%);z-index:300;';
    // btn.innerHTML = `<a href="${gmUrl}" target="_blank" style="background:#1e3a8a;color:white;padding:0.6rem 1.2rem;border-radius:2rem;font-size:0.82rem;font-weight:700;text-decoration:none;display:flex;align-items:center;gap:6px;box-shadow:0 4px 12px rgba(0,0,0,0.2);">
    //   <i class="fas fa-external-link-alt"></i> Jereo amin'ny Google Maps
    // </a>`;
    // document.body.appendChild(btn);
    // setTimeout(() => btn.remove(), 6000);
  }
  else
  {
    if (routeLine) map.removeLayer(routeLine);
    routeLine = L.polyline([[fromLat, fromLng], [toLat, toLng]], {
      color: '#3b82f6', weight: 4, opacity: 0.8, dashArray: '8,6'
    }).addTo(map);
    map.fitBounds([[fromLat, fromLng], [toLat, toLng]], { padding: [30, 30] });
    closeModal('routeModal');
    toast(`Itinéraire: ${name}`, 'success');
  }
};

// ── History ───────────────────────────────────────────────────────────────────
async function loadHistory() {
  const date = document.getElementById('historyDate').value;
  try {
    const data = await api('GET', `/api/incidents/history${date ? '?date=' + date : ''}`);
    const list = document.getElementById('historyList');
    if (!data.length) { list.innerHTML = '<p style="font-size:0.8rem;color:#94a3b8;text-align:center;padding:1rem;">Tsy misy signal amin\'ity andro ity</p>'; return; }
    list.innerHTML = data.map(inc => {
      const cfg = INCIDENT_CONFIG[inc.type] || INCIDENT_CONFIG.autres;
      return `<div class="history-item">
        <div class="history-item-icon" style="background:${cfg.bg};color:${cfg.color};"><i class="fas ${cfg.icon}"></i></div>
        <div class="history-item-info">
          <div class="history-item-type">${cfg.label}${inc.isPriority ? ' 🚨' : ''}</div>
          <div style="font-size:0.78rem;color:#334155;">${inc.description || '—'}</div>
          <div class="history-item-meta"><i class="fas fa-user"></i> ${inc.authorName} · ${formatTime(inc.createdAt)} · 👍${inc.votes.up.length} 👎${inc.votes.down.length}</div>
        </div>
      </div>`;
    }).join('');
  } catch(e) { toast('Tsy azo ny tantara', 'error'); }
}

// ── ETA ───────────────────────────────────────────────────────────────────────
async function generateETA() {
  const minutes = document.getElementById('etaMinutes').value;
  const message = document.getElementById('etaMessage').value;
  try {
    const data = await api('POST', '/api/eta', { minutes, message });
    const fullLink = location.origin + data.link;
    document.getElementById('etaLinkResult').classList.remove('hidden');
    document.getElementById('etaLinkResult').innerHTML = `
      <p><i class="fas fa-link"></i> Rohy ETA nataonao:</p>
      <input type="text" value="${fullLink}" readonly onclick="this.select();document.execCommand('copy');">
      <button class="eta-copy-btn" onclick="copyETA('${fullLink}')"><i class="fas fa-copy"></i> Adikao ny rohy</button>
    `;
    toast('Rohy ETA vita!', 'success');
  } catch(e) { toast(e.message, 'error'); }
}

window.copyETA = function(link) {
  navigator.clipboard.writeText(link).then(() => toast('Rohy nakopy!', 'success')).catch(() => toast('Tsy azo nakopy', 'error'));
};

// ── Edit Profile ──────────────────────────────────────────────────────────────
async function saveProfile() {
  const username = document.getElementById('editUsername').value.trim();
  const picFile = document.getElementById('editProfilePic').files[0];
  const formData = new FormData();
  if (username) formData.append('username', username);
  if (picFile) formData.append('profilePic', picFile);

  try {
    const res = await fetch(API_BASE + '/api/me', { method: 'PUT', headers: { 'Authorization': `Bearer ${token}` }, body: formData });
    const data = await res.json();
    if (data.error) { showMsg('editProfileMsg', data.error); return; }
    currentUser = { ...currentUser, ...data };
    updateNavProfile();
    closeModal('editProfileModal');
    toast('Profil novaina!', 'success');
  } catch(e) { showMsg('editProfileMsg', e.message); }
}

// ── Voice recognition ─────────────────────────────────────────────────────────
function initVoice() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) { toast('Signalement vocal tsy mety amin\'ity fitaovana ity', 'warning'); return; }
  recognition = new SpeechRecognition();
  recognition.lang = 'fr-FR'; // Closest to Malagasy
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;
  recognition.onresult = (e) => {
    const transcript = e.results[0][0].transcript.toLowerCase();
    // Auto-fill type from keywords
    if (transcript.includes('accident') || transcript.includes('loza')) selectedIncidentType = 'accident';
    else if (transcript.includes('embouteillage') || transcript.includes('fitohan')) selectedIncidentType = 'embouteillage';
    else if (transcript.includes('fermé') || transcript.includes('voarindrina')) selectedIncidentType = 'route_fermee';
    else if (transcript.includes('travaux') || transcript.includes('asa')) selectedIncidentType = 'travaux';
    else if (transcript.includes('inondation') || transcript.includes('rano')) selectedIncidentType = 'inondation';
    else if (transcript.includes('contrôle') || transcript.includes('fanaraha')) selectedIncidentType = 'controle';

    openIncidentModal();
    document.getElementById('incidentDescription').value = transcript;
    // Highlight matching type button
    document.querySelectorAll('#incidentForm .type-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.type === selectedIncidentType);
    });
    toast(`Voaray: "${transcript}"`, 'success');
  };
  recognition.onerror = () => { toast('Lesoka audio', 'error'); };
  recognition.onend = () => {
    recognizing = false;
    document.getElementById('fabVoice').classList.remove('recording');
  };
}

function toggleVoice() {
  if (!recognition) initVoice();
  if (!recognition) return;
  if (recognizing) { recognition.stop(); recognizing = false; return; }
  recognition.start();
  recognizing = true;
  document.getElementById('fabVoice').classList.add('recording');
  toast('Mihaino... Lazao ny zava-misy', 'info', 3000);
}

// ── Admin ─────────────────────────────────────────────────────────────────────
async function loadAdminStats() {
  try {
    const data = await api('GET', '/api/admin/stats');
    document.getElementById('statUsers').textContent = data.totalUsers;
    document.getElementById('statIncidents').textContent = data.totalIncidents;
    document.getElementById('statActive').textContent = data.activeIncidents;
    renderHourlyChart(data.hourly);
    renderRouteStats(data.routeStats);
  } catch(e) { toast('Tsy azo ny statistika', 'error'); }
}

function renderHourlyChart(hourly) {
  const ctx = document.getElementById('hourlyChart');
  if (!ctx) return;
  if (hourlyChart) hourlyChart.destroy();
  hourlyChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: Array.from({length: 24}, (_, i) => i + 'h'),
      datasets: [{
        data: hourly,
        backgroundColor: hourly.map((v, i) => (i >= 6 && i <= 9) || (i >= 16 && i <= 19) ? 'rgba(220,38,38,0.7)' : 'rgba(59,130,246,0.7)'),
        borderRadius: 4
      }]
    },
    options: {
      plugins: { legend: { display: false } },
      scales: {
        y: { ticks: { font: { size: 10 } }, grid: { color: 'rgba(0,0,0,0.05)' } },
        x: { ticks: { font: { size: 9 } }, grid: { display: false } }
      }
    }
  });
}

function renderRouteStats(stats) {
  const max = Math.max(...Object.values(stats), 1);
  const container = document.getElementById('routeStatsBar');
  container.innerHTML = Object.entries(stats).map(([route, count]) => `
    <div class="route-bar-item">
      <span class="route-bar-label">${route}</span>
      <div class="route-bar-track"><div class="route-bar-fill" style="width:${(count/max*100).toFixed(0)}%"></div></div>
      <span class="route-bar-count">${count}</span>
    </div>
  `).join('');
}

async function loadLeaderboard() {
  try {
    const data = await api('GET', '/api/admin/leaderboard');
    const list = document.getElementById('leaderboardList');
    list.innerHTML = data.map((u, i) => {
      const rankCls = i === 0 ? 'gold' : i === 1 ? 'silver' : i === 2 ? 'bronze' : '';
      const medals = ['🥇', '🥈', '🥉'];
      return `<div class="lb-item">
        <div class="lb-rank ${rankCls}">${medals[i] || (i + 1)}</div>
        <div class="lb-info">
          <div class="lb-name">${u.username}</div>
          <div style="display:flex;gap:0.5rem;">
            <span class="lb-pts"><i class="fas fa-star"></i> ${u.points} pts</span>
            <span class="lb-reliability"><i class="fas fa-chart-line"></i> ${u.reliability}%</span>
          </div>
        </div>
        <div style="font-size:0.7rem;color:#94a3b8;">${(u.badges || []).length} badge${(u.badges||[]).length>1?'s':''}</div>
      </div>`;
    }).join('') || '<p style="text-align:center;color:#94a3b8;padding:1rem;">Tsy misy data</p>';
  } catch(e) { toast('Tsy azo ny classement', 'error'); }
}

async function loadBadActors() {
  try {
    const data = await api('GET', '/api/admin/bad-actors');
    const list = document.getElementById('badActorsList');
    list.innerHTML = data.map(u => `
      <div class="bad-actor-item">
        <div class="bad-actor-name"><i class="fas fa-user-slash"></i> ${u.username}</div>
        <div class="bad-actor-stats">Fiainana: ${u.reliability}% · Points: ${u.points} · ${u.banned ? '🚫 Voarara' : 'Miasa'}</div>
        <div class="bad-actor-actions">
          <button class="btn-ban" onclick="adminBan('${u.id}','${u.username}',${u.banned})">
            ${u.banned ? '<i class="fas fa-unlock"></i> Alefaso' : '<i class="fas fa-ban"></i> Banira'}
          </button>
          <button class="btn-warn" onclick="adminWarn('${u.id}','${u.username}')">
            <i class="fas fa-exclamation-triangle"></i> Hafatra
          </button>
        </div>
      </div>
    `).join('') || '<p style="text-align:center;color:#94a3b8;padding:1rem;">Tsy misy mpampiasa diso</p>';
  } catch(e) { toast('Tsy azo ny lisi', 'error'); }
}

window.adminBan = async function(userId, username, isBanned) {
  if (!confirm(`${isBanned ? 'Alefaso' : 'Banira'} i ${username}?`)) return;
  try {
    const data = await api('POST', `/api/admin/ban/${userId}`);
    toast(`${username}: ${data.banned ? 'Voarara' : 'Nafahana'}`, data.banned ? 'warning' : 'success');
    loadBadActors();
  } catch(e) { toast(e.message, 'error'); }
};

window.adminWarn = async function(userId, username) {
  const msg = prompt(`Hafatra ho an'i ${username}:`);
  if (!msg) return;
  try {
    await api('POST', `/api/admin/warn/${userId}`, { message: msg });
    toast(`Hafatra nalefa ho an'i ${username}`, 'success');
  } catch(e) { toast(e.message, 'error'); }
};

async function submitPrioritySignal(e) {
  e.preventDefault();
  if (!userPosition) { toast('Tsy hita ny toerana GPS', 'error'); return; }
  const formData = new FormData();
  formData.append('type', selectedPriorityType);
  formData.append('description', document.getElementById('priorityDescription').value);
  formData.append('duration', document.getElementById('priorityDuration').value);
  formData.append('lat', userPosition.lat);
  formData.append('lng', userPosition.lng);
  try {
    await api('POST', '/api/admin/priority-signal', formData, true);
    toast('Signal Prioritaire nalefa!', 'priority');
    document.getElementById('priorityDescription').value = '';
  } catch(e) { toast(e.message, 'error'); }
}

// ── Modals ────────────────────────────────────────────────────────────────────
function openModal(id) { document.getElementById(id).classList.remove('hidden'); }
function closeModal(id) { document.getElementById(id).classList.add('hidden'); }

function openIncidentModal() {
  if (!userPosition) {
    getPosition();
    toast('Mitady toerana GPS...', 'info', 2000);
  }
  openModal('incidentModal');
}

// ── Time formatter ────────────────────────────────────────────────────────────
function formatTime(iso) {
  const d = new Date(iso);
  return d.toLocaleString('fr-MG', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

// ── Auto-restore session ──────────────────────────────────────────────────────
async function tryRestoreSession() {
  if (!token) return;
  try {
    currentUser = await api('GET', '/api/me');
    onLoggedIn();
  } catch(e) {
    token = null;
    localStorage.removeItem('ambotaka_token');
  }
}

// ══════════════════════════════════════════════════════════════════
// EVENT LISTENERS
// ══════════════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', async () => {

  // --- Auth toggle ---
  const loginPanel = document.getElementById('loginPanel');
  const signupPanel = document.getElementById('signupPanel');
  const toggleBtn = document.getElementById('showSignupBtnMobile');

  function showSignupForm() {
    loginPanel.classList.add('hidden');
    signupPanel.classList.remove('hidden');
    toggleBtn.innerHTML = '<i class="fas fa-arrow-left"></i> Hiverina amin\'ny fidirana';
  }
  function showLoginForm() {
    loginPanel.classList.remove('hidden');
    signupPanel.classList.add('hidden');
    toggleBtn.innerHTML = '<i class="fas fa-user-plus"></i> Mamorona kaonty';
  }
  window.showLoginForm = showLoginForm;

  toggleBtn.onclick = () => loginPanel.classList.contains('hidden') ? showLoginForm() : showSignupForm();

  // Password toggles
  document.querySelectorAll('.toggle-pwd').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const inp = document.getElementById(btn.dataset.pwd);
      inp.type = inp.type === 'password' ? 'text' : 'password';
      btn.innerHTML = inp.type === 'password' ? '<i class="far fa-eye-slash"></i>' : '<i class="far fa-eye"></i>';
    });
  });

  // Profile image preview (auth)
  document.getElementById('profileUpload').addEventListener('change', function() {
    const f = this.files[0];
    if (f) {
      if (f.size > 2 * 1024 * 1024) { showMsg('signupMsg', 'Ny sary dia mihoatra 2MB'); this.value = ''; return; }
      const r = new FileReader();
      r.onload = (ev) => {
        document.getElementById('profileImageDisplay').src = ev.target.result;
        document.getElementById('profileImageDisplay').style.display = 'block';
        document.getElementById('defaultAvatarIcon').style.display = 'none';
      };
      r.readAsDataURL(f);
    }
  });

  // Login form
  document.getElementById('loginForm').addEventListener('submit', (e) => {
    e.preventDefault();
    doLogin(document.getElementById('loginUsername').value.trim(), document.getElementById('loginPassword').value);
  });

  // Signup form
  document.getElementById('signupForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const username = document.getElementById('signupName').value.trim();
    const phone = document.getElementById('signupPhone').value.trim();
    const password = document.getElementById('signupPassword').value;
    const confirm = document.getElementById('signupConfirmPwd').value;
    if (password !== confirm) { showMsg('signupMsg', 'Tsy mitovy ny teny miafina roa'); return; }
    const fd = new FormData();
    fd.append('username', username);
    fd.append('phone', phone);
    fd.append('password', password);
    const pic = document.getElementById('profileUpload').files[0];
    if (pic) fd.append('profilePic', pic);
    doRegister(fd);
  });

  // Forgot password
  document.getElementById('forgotPwdLink').addEventListener('click', (e) => {
    e.preventDefault();
    const u = document.getElementById('loginUsername').value.trim();
    showMsg('loginMsg', u ? 'Simulation: SMS nalefa tamin\'ny laharanao' : 'Ampidiro ny anarana aloha', !u);
  });

  // NAV BUTTONS
  document.getElementById('locateBtn').addEventListener('click', () => {
    getPosition();
    toast('Mitady toerana...', 'info', 2000);
    IsOpen = false;
    mitadyId.textContent = "Mitady toerana";
    openModal('routeModal');

  });

  document.getElementById('heatmapBtn').addEventListener('click', toggleHeatmap);
  document.getElementById('closeHeatmap').addEventListener('click', toggleHeatmap);

  document.getElementById('historyBtn').addEventListener('click', () => {
    document.getElementById('historyDate').value = new Date().toISOString().split('T')[0];
    openModal('historyModal');
    loadHistory();
  });
  document.getElementById('historyDate').addEventListener('change', loadHistory);
  document.getElementById('closeHistoryModal').addEventListener('click', () => closeModal('historyModal'));

  document.getElementById('searchRouteBtn').addEventListener('click', () => {
    IsOpen = true;
    mitadyId.textContent = "Mitady Lalana";
    openModal('routeModal')});
  document.getElementById('closeRouteModal').addEventListener('click', () => closeModal('routeModal'));
  document.getElementById('closeRouteModal2').addEventListener('click', () => closeModal('routeModal'));
  document.getElementById('searchRouteAction').addEventListener('click', () => {

    searchRoute();

  });
  document.getElementById('destinationInput').addEventListener('keydown', (e) => { 
    if (e.key === 'Enter')
    {
      searchRoute();

    }
  });

  // PROFILE DROPDOWN
  document.getElementById('profileMenuBtn').addEventListener('click', (e) => {
    e.stopPropagation();
    document.getElementById('profileDropdown').classList.toggle('hidden');
  });
  document.addEventListener('click', (e) => {
    if (!document.getElementById('profileDropdown').contains(e.target) && e.target.id !== 'profileMenuBtn') {
      document.getElementById('profileDropdown').classList.add('hidden');
    }
  });
  document.getElementById('logoutBtn').addEventListener('click', doLogout);
  document.getElementById('editProfileBtn').addEventListener('click', () => {
    document.getElementById('editUsername').value = currentUser.username;
    if (currentUser.profilePic) {
      document.getElementById('editAvatarImg').src = currentUser.profilePic;
      document.getElementById('editAvatarImg').style.display = 'block';
      document.getElementById('editAvatarIcon').style.display = 'none';
    }
    document.getElementById('profileDropdown').classList.add('hidden');
    openModal('editProfileModal');
  });
  document.getElementById('closeEditProfileModal').addEventListener('click', () => closeModal('editProfileModal'));
  document.getElementById('closeEditProfileModal2').addEventListener('click', () => closeModal('editProfileModal'));
  document.getElementById('saveProfileBtn').addEventListener('click', saveProfile);

  document.getElementById('editProfilePic').addEventListener('change', function() {
    const f = this.files[0];
    if (f) {
      const r = new FileReader();
      r.onload = (ev) => {
        document.getElementById('editAvatarImg').src = ev.target.result;
        document.getElementById('editAvatarImg').style.display = 'block';
        document.getElementById('editAvatarIcon').style.display = 'none';
      };
      r.readAsDataURL(f);
    }
  });

  // ETA
  document.getElementById('etaBtn').addEventListener('click', () => {
    document.getElementById('profileDropdown').classList.add('hidden');
    openModal('etaModal');
  });
  document.getElementById('closeEtaModal').addEventListener('click', () => closeModal('etaModal'));
  document.getElementById('closeEtaModal2').addEventListener('click', () => closeModal('etaModal'));
  document.getElementById('generateEtaBtn').addEventListener('click', generateETA);

  // ADMIN
  document.getElementById('adminPanelBtn').addEventListener('click', () => {
    document.getElementById('profileDropdown').classList.add('hidden');
    openModal('adminPanel');
    loadAdminStats();
  });
  document.getElementById('closeAdminPanel').addEventListener('click', () => closeModal('adminPanel'));

  document.querySelectorAll('.admin-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.admin-tab-content').forEach(c => c.classList.add('hidden'));
      tab.classList.add('active');
      document.getElementById('tab-' + tab.dataset.tab).classList.remove('hidden');
      if (tab.dataset.tab === 'leaderboard') loadLeaderboard();
      if (tab.dataset.tab === 'badActors') loadBadActors();
    });
  });

  // Priority signal type buttons
  document.querySelectorAll('#priorityForm .type-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#priorityForm .type-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      selectedPriorityType = btn.dataset.type;
    });
  });
  document.getElementById('priorityForm').addEventListener('submit', submitPrioritySignal);

  // FAB
  document.getElementById('fabSignal').addEventListener('click', openIncidentModal);
  document.getElementById('fabVoice').addEventListener('click', toggleVoice);

  // Incident modal
  document.getElementById('closeIncidentModal').addEventListener('click', () => closeModal('incidentModal'));
  document.getElementById('cancelIncident').addEventListener('click', () => closeModal('incidentModal'));

  document.querySelectorAll('#incidentForm .type-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#incidentForm .type-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      selectedIncidentType = btn.dataset.type;
    });
  });

  document.getElementById('incidentPhoto').addEventListener('change', function() {
    const f = this.files[0];
    if (f) {
      const r = new FileReader();
      r.onload = (ev) => {
        document.getElementById('photoPreview').src = ev.target.result;
        document.getElementById('photoPreviewWrap').classList.remove('hidden');
      };
      r.readAsDataURL(f);
    }
  });

  document.getElementById('incidentForm').addEventListener('submit', submitIncident);

  // Detail modal close
  document.getElementById('closeDetailModal').addEventListener('click', () => {
    closeModal('detailModal');
    currentIncidentId = null;
  });

  // Filter bar
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeFilter = btn.dataset.type;
      renderMarkers();
    });
  });

  // Close modals on overlay click
  ['incidentModal', 'detailModal', 'routeModal', 'historyModal', 'etaModal', 'editProfileModal', 'adminPanel'].forEach(id => {
    document.getElementById(id).addEventListener('click', function(e) {
      if (e.target === this) closeModal(id);
    });
  });

  // ── Try restore session or show auth ──
  await tryRestoreSession();
});
