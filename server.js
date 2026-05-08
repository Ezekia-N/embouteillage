/**
 * AMBOTAKA - Fitantanana ny Fihaonan'ny Làlana
 * Backend server: Express + WebSocket
 * 
 * Installation: npm install express ws multer uuid
 * Run: node server.js
 * Ngrok: ngrok http 3000
 */

const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// ── Storage ──────────────────────────────────────────────────────────────────
const DB = {
  users: [
    {
      id: 'admin-001',
      username: 'Admin',
      phone: '+261320000000',
      password: hashPwd('admin1234'),
      role: 'admin',
      points: 9999,
      badges: ['admin', 'fondateur'],
      reliability: 100,
      createdAt: new Date().toISOString(),
      profilePic: null,
      banned: false,
      warnings: []
    },
    {
      id: uuidv4(),
      username: 'RadoTraffic',
      phone: '+261321234567',
      password: hashPwd('pass12345'),
      role: 'user',
      points: 120,
      badges: ['alerte'],
      reliability: 85,
      createdAt: new Date().toISOString(),
      profilePic: null,
      banned: false,
      warnings: []
    }
  ],
  incidents: [],
  sessions: {}   // token → userId
};

// ── Helpers ───────────────────────────────────────────────────────────────────
function hashPwd(pwd) {
  return crypto.createHash('sha256').update(pwd).digest('hex');
}
function genToken() { return uuidv4(); }
function authMiddleware(req, res, next) {
  const token = req.headers['authorization']?.split(' ')[1];
  const userId = DB.sessions[token];
  if (!userId) return res.status(401).json({ error: 'Tsy nahazo alalana' });
  req.user = DB.users.find(u => u.id === userId);
  if (!req.user || req.user.banned) return res.status(403).json({ error: 'Voarara' });
  next();
}
function adminMiddleware(req, res, next) {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin ihany' });
  next();
}

// ── File upload ───────────────────────────────────────────────────────────────
const uploadsDir = path.join(__dirname, 'public/uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => cb(null, uuidv4() + path.extname(file.originalname))
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Images seulement'));
  }
});

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// CORS for ngrok
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '/*');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// ── Auth routes ───────────────────────────────────────────────────────────────
app.post('/api/register', upload.single('profilePic'), (req, res) => {
  const { username, phone, password } = req.body;
  if (!username || !phone || !password)
    return res.status(400).json({ error: 'Fenoina ny tsaha rehetra' });
  if (username.length < 3)
    return res.status(400).json({ error: 'Anarana fohy loatra (3 tarehintsoratra farafahakeliny)' });
  if (DB.users.find(u => u.username.toLowerCase() === username.toLowerCase()))
    return res.status(409).json({ error: 'Efa misy io anarana io' });
  if (!/^\+261[0-9]{9}$/.test(phone.replace(/\s/g, '')))
    return res.status(400).json({ error: 'Laharana finday tsy manara-penitra' });
  if (password.length < 8)
    return res.status(400).json({ error: 'Teny miafina fohy loatra (8 tarehintsoratra farafahakeliny)' });

  const user = {
    id: uuidv4(),
    username,
    phone,
    password: hashPwd(password),
    role: 'user',
    points: 0,
    badges: [],
    reliability: 100,
    createdAt: new Date().toISOString(),
    profilePic: req.file ? `/uploads/${req.file.filename}` : null,
    banned: false,
    warnings: []
  };
  DB.users.push(user);
  res.json({ success: true, message: `Vita ny fisoratana! Tonga soa ${username}.` });
});

app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  const user = DB.users.find(u => u.username.toLowerCase() === username?.toLowerCase());
  if (!user) return res.status(401).json({ error: 'Tsy hita ny kaonty' });
  if (user.banned) return res.status(403).json({ error: 'Voarara ny kaonty. Mifandraisa amin\'ny admin.' });
  if (user.password !== hashPwd(password)) return res.status(401).json({ error: 'Diso ny teny miafina' });

  const token = genToken();
  DB.sessions[token] = user.id;
  const { password: _, ...safeUser } = user;
  res.json({ token, user: safeUser });
});

app.post('/api/logout', authMiddleware, (req, res) => {
  const token = req.headers['authorization']?.split(' ')[1];
  delete DB.sessions[token];
  res.json({ success: true });
});

app.get('/api/me', authMiddleware, (req, res) => {
  const { password: _, ...safeUser } = req.user;
  res.json(safeUser);
});

app.put('/api/me', authMiddleware, upload.single('profilePic'), (req, res) => {
  const { username, phone } = req.body;
  const user = req.user;
  if (username && username !== user.username) {
    if (DB.users.find(u => u.username.toLowerCase() === username.toLowerCase() && u.id !== user.id))
      return res.status(409).json({ error: 'Efa misy io anarana io' });
    user.username = username;
  }
  if (phone) user.phone = phone;
  if (req.file) user.profilePic = `/uploads/${req.file.filename}`;
  const { password: _, ...safeUser } = user;
  res.json(safeUser);
});

// ── Incidents routes ──────────────────────────────────────────────────────────
app.get('/api/incidents', authMiddleware, (req, res) => {
  const now = Date.now();
  // Expiration: minimum 15min, ou durée custom
  const active = DB.incidents.filter(i => {
    const dur = i.duration || 15;
    return (now - new Date(i.createdAt).getTime()) < dur * 60 * 1000;
  });
  // Remove expired from DB
  DB.incidents = active;
  res.json(active);
});

app.post('/api/incidents', authMiddleware, upload.single('photo'), (req, res) => {
  const { type, description, lat, lng, duration } = req.body;
  if (!type || !lat || !lng) return res.status(400).json({ error: 'Daty tsy feno' });

  const incident = {
    id: uuidv4(),
    type,
    description: description || '',
    lat: parseFloat(lat),
    lng: parseFloat(lng),
    duration: Math.max(15, parseInt(duration) || 15),
    photo: req.file ? `/uploads/${req.file.filename}` : null,
    authorId: req.user.id,
    authorName: req.user.username,
    authorRole: req.user.role,
    createdAt: new Date().toISOString(),
    votes: { up: [], down: [] },
    comments: [],
    confirmed: false
  };
  DB.incidents.push(incident);

  // Points
  req.user.points += 10;
  updateBadges(req.user);

  // Broadcast via WS
  broadcast({ type: 'NEW_INCIDENT', data: incident });

  res.json(incident);
});

app.post('/api/incidents/:id/vote', authMiddleware, (req, res) => {
  const incident = DB.incidents.find(i => i.id === req.params.id);
  if (!incident) return res.status(404).json({ error: 'Tsy hita' });
  if (incident.authorId === req.user.id) return res.status(400).json({ error: 'Tsy afaka mifidy ny signalement nataonao' });

  const { vote } = req.body; // 'up' or 'down'
  const uid = req.user.id;

  // Remove existing vote
  incident.votes.up = incident.votes.up.filter(v => v !== uid);
  incident.votes.down = incident.votes.down.filter(v => v !== uid);

  if (vote === 'up') {
    incident.votes.up.push(uid);
    req.user.points += 2;
    // Author gains points
    const author = DB.users.find(u => u.id === incident.authorId);
    if (author) { author.points += 5; updateBadges(author); }
  } else if (vote === 'down') {
    incident.votes.down.push(uid);
    // If majority down, author loses points
    const downs = incident.votes.down.length;
    const ups = incident.votes.up.length;
    if (downs > ups + 1) {
      const author = DB.users.find(u => u.id === incident.authorId);
      if (author) { author.points = Math.max(0, author.points - 8); author.reliability = Math.max(0, author.reliability - 5); }
    }
  }
  updateBadges(req.user);
  broadcast({ type: 'VOTE_UPDATE', data: { incidentId: incident.id, votes: incident.votes } });
  res.json({ votes: incident.votes });
});

app.post('/api/incidents/:id/comments', authMiddleware, (req, res) => {
  const incident = DB.incidents.find(i => i.id === req.params.id);
  if (!incident) return res.status(404).json({ error: 'Tsy hita' });
  const { text } = req.body;
  if (!text?.trim()) return res.status(400).json({ error: 'Tsy misy hafatra' });

  const comment = {
    id: uuidv4(),
    authorId: req.user.id,
    authorName: req.user.username,
    text: text.trim(),
    createdAt: new Date().toISOString()
  };
  incident.comments.push(comment);
  req.user.points += 1;
  broadcast({ type: 'NEW_COMMENT', data: { incidentId: incident.id, comment } });
  res.json(comment);
});

// ETA Share
app.post('/api/eta', authMiddleware, (req, res) => {
  const { minutes, message } = req.body;
  const token = uuidv4().substr(0, 8);
  DB.sessions['eta_' + token] = { userId: req.user.id, minutes, message, createdAt: Date.now() };
  res.json({ link: `/eta/${token}`, token });
});

app.get('/api/eta/:token', (req, res) => {
  const eta = DB.sessions['eta_' + req.params.token];
  if (!eta) return res.status(404).json({ error: 'Lien ETA tsy hita na efa lany andro' });
  const user = DB.users.find(u => u.id === eta.userId);
  res.json({ username: user?.username, ...eta });
});

// ── Admin routes ──────────────────────────────────────────────────────────────
app.get('/api/admin/stats', authMiddleware, adminMiddleware, (req, res) => {
  const now = Date.now();
  const week = 7 * 24 * 3600 * 1000;

  // Traffic by hour (simulate from incidents)
  const hourly = Array(24).fill(0);
  DB.incidents.forEach(i => {
    const h = new Date(i.createdAt).getHours();
    hourly[h]++;
  });

  // By route (based on coordinates, very rough for Madagascar)
  const routeStats = { RN1: 0, RN2: 0, RN4: 0, RN7: 0, Autre: 0 };
  DB.incidents.forEach(i => {
    // Very rough bounding boxes for Antananarivo area
    if (i.lng < 47.5) routeStats.RN1++;
    else if (i.lat > -18.8) routeStats.RN2++;
    else if (i.lng > 47.6) routeStats.RN4++;
    else routeStats.Autre++;
  });

  res.json({
    totalUsers: DB.users.filter(u => u.role !== 'admin').length,
    totalIncidents: DB.incidents.length,
    activeIncidents: DB.incidents.filter(i => (now - new Date(i.createdAt).getTime()) < 15 * 60 * 1000).length,
    hourly,
    routeStats
  });
});

app.get('/api/admin/leaderboard', authMiddleware, adminMiddleware, (req, res) => {
  const users = DB.users
    .filter(u => u.role !== 'admin')
    .sort((a, b) => b.points - a.points)
    .slice(0, 20)
    .map(({ password: _, ...u }) => u);
  res.json(users);
});

app.get('/api/admin/bad-actors', authMiddleware, adminMiddleware, (req, res) => {
  const users = DB.users
    .filter(u => u.role !== 'admin' && u.reliability < 70)
    .sort((a, b) => a.reliability - b.reliability)
    .map(({ password: _, ...u }) => u);
  res.json(users);
});

app.post('/api/admin/ban/:userId', authMiddleware, adminMiddleware, (req, res) => {
  const user = DB.users.find(u => u.id === req.params.userId);
  if (!user) return res.status(404).json({ error: 'Tsy hita' });
  if (user.role === 'admin') return res.status(400).json({ error: 'Tsy azo banira admin' });
  user.banned = !user.banned;
  broadcast({ type: 'USER_BANNED', data: { userId: user.id, banned: user.banned } });
  res.json({ banned: user.banned });
});

app.post('/api/admin/warn/:userId', authMiddleware, adminMiddleware, (req, res) => {
  const user = DB.users.find(u => u.id === req.params.userId);
  if (!user) return res.status(404).json({ error: 'Tsy hita' });
  const { message } = req.body;
  user.warnings.push({ message, date: new Date().toISOString() });
  broadcast({ type: 'WARNING', data: { userId: user.id, message } });
  res.json({ success: true });
});

app.post('/api/admin/priority-signal', authMiddleware, adminMiddleware, upload.single('photo'), (req, res) => {
  const { type, description, lat, lng, duration } = req.body;
  if (!type || !lat || !lng) return res.status(400).json({ error: 'Daty tsy feno' });

  const incident = {
    id: uuidv4(),
    type,
    description: description || '',
    lat: parseFloat(lat),
    lng: parseFloat(lng),
    duration: Math.max(15, parseInt(duration) || 60),
    photo: req.file ? `/uploads/${req.file.filename}` : null,
    authorId: req.user.id,
    authorName: req.user.username,
    authorRole: 'admin',
    isPriority: true,
    createdAt: new Date().toISOString(),
    votes: { up: [], down: [] },
    comments: []
  };
  DB.incidents.push(incident);
  broadcast({ type: 'PRIORITY_INCIDENT', data: incident });
  res.json(incident);
});

app.delete('/api/admin/incidents/:id', authMiddleware, adminMiddleware, (req, res) => {
  const idx = DB.incidents.findIndex(i => i.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Tsy hita' });
  DB.incidents.splice(idx, 1);
  broadcast({ type: 'INCIDENT_DELETED', data: { id: req.params.id } });
  res.json({ success: true });
});

// ── Online users count ────────────────────────────────────────────────────────
app.get('/api/online', authMiddleware, (req, res) => {
  const count = [...wss.clients].filter(c => c.readyState === WebSocket.OPEN).length;
  res.json({ count });
});

// ── Heatmap data ──────────────────────────────────────────────────────────────
app.get('/api/heatmap', authMiddleware, (req, res) => {
  const points = DB.incidents.map(i => ({ lat: i.lat, lng: i.lng, weight: 1 + i.votes.up.length }));
  res.json(points);
});

// ── History ───────────────────────────────────────────────────────────────────
app.get('/api/incidents/history', authMiddleware, (req, res) => {
  const { date } = req.query;
  let incidents = DB.incidents;
  if (date) {
    const d = new Date(date);
    incidents = DB.incidents.filter(i => {
      const id = new Date(i.createdAt);
      return id.toDateString() === d.toDateString();
    });
  }
  res.json(incidents);
});

// ── Serve SPA ─────────────────────────────────────────────────────────────────
app.get('/*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── WebSocket ─────────────────────────────────────────────────────────────────
const clients = new Map(); // ws → { userId, username }

wss.on('connection', (ws, req) => {
  ws.on('message', (msg) => {
    try {
      const data = JSON.parse(msg);
      if (data.type === 'AUTH') {
        const userId = DB.sessions[data.token];
        const user = DB.users.find(u => u.id === userId);
        if (user) {
          clients.set(ws, { userId: user.id, username: user.username });
          broadcastOnlineCount();
          // Send pending warnings
          if (user.warnings.length > 0) {
            ws.send(JSON.stringify({ type: 'WARNINGS', data: user.warnings }));
          }
        }
      }
    } catch(e) {}
  });

  ws.on('close', () => {
    clients.delete(ws);
    broadcastOnlineCount();
  });
});

function broadcast(msg) {
  const str = JSON.stringify(msg);
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) client.send(str);
  });
}

function broadcastOnlineCount() {
  broadcast({ type: 'ONLINE_COUNT', data: { count: clients.size } });
}

// ── Badge logic ───────────────────────────────────────────────────────────────
function updateBadges(user) {
  const BADGES = [
    { id: 'debutant', label: 'Mpianatra', points: 10 },
    { id: 'alerte', label: 'Mpiambina', points: 50 },
    { id: 'expert', label: 'Manampahaizana', points: 200 },
    { id: 'champion', label: 'Champion', points: 500 },
    { id: 'legende', label: 'Lohahevitra', points: 1000 }
  ];
  BADGES.forEach(b => {
    if (user.points >= b.points && !user.badges.includes(b.id)) {
      user.badges.push(b.id);
      broadcast({ type: 'BADGE_EARNED', data: { userId: user.id, badge: b } });
    }
  });
}

// ── Incident auto-expiry ──────────────────────────────────────────────────────
setInterval(() => {
  const now = Date.now();
  const before = DB.incidents.length;
  DB.incidents = DB.incidents.filter(i => {
    const dur = i.duration || 15;
    return (now - new Date(i.createdAt).getTime()) < dur * 60 * 1000;
  });
  if (DB.incidents.length !== before) {
    broadcast({ type: 'INCIDENTS_EXPIRED', data: {} });
  }
}, 60 * 1000); // Check every minute

// ── Start server ──────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n🚦 AMBOTAKA Server running on http://localhost:${PORT}`);
  console.log(`📡 WebSocket ready`);
  console.log(`\n🔑 Admin credentials: username=Admin, password=admin1234`);
  console.log(`👤 Demo user: username=RadoTraffic, password=pass12345`);
  console.log(`\n📲 For ngrok: ngrok http ${PORT}\n`);
});
