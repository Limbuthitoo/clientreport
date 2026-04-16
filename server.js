const express = require('express');
const path = require('path');
const Database = require('better-sqlite3');
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const { JWT_SECRET } = require('./config');

const app = express();
const PORT = 5173;

// ============ SECURITY MIDDLEWARE ============
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

// Security headers
app.use((req, res, next) => {
  res.removeHeader('X-Powered-By');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
});

// Rate limiter (simple in-memory)
const rateLimitMap = new Map();
function rateLimit(windowMs, maxRequests) {
  return (req, res, next) => {
    const ip = req.ip;
    const now = Date.now();
    const windowStart = now - windowMs;
    if (!rateLimitMap.has(ip)) rateLimitMap.set(ip, []);
    const timestamps = rateLimitMap.get(ip).filter(t => t > windowStart);
    if (timestamps.length >= maxRequests) {
      return res.status(429).json({ error: 'Too many requests. Please try again later.' });
    }
    timestamps.push(now);
    rateLimitMap.set(ip, timestamps);
    next();
  };
}

// Clean rate limit map periodically
setInterval(() => {
  const cutoff = Date.now() - 900000;
  for (const [ip, timestamps] of rateLimitMap) {
    const filtered = timestamps.filter(t => t > cutoff);
    if (filtered.length === 0) rateLimitMap.delete(ip);
    else rateLimitMap.set(ip, filtered);
  }
}, 300000);



// ============ DATABASE SETUP ============
const db = new Database(path.join(__dirname, 'analytics.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    full_name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'employee',
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS clients (
    id TEXT PRIMARY KEY,
    company_name TEXT NOT NULL,
    contact_person TEXT NOT NULL,
    email TEXT NOT NULL,
    phone TEXT,
    industry TEXT,
    website TEXT,
    notes TEXT,
    created_by TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS campaigns (
    id TEXT PRIMARY KEY,
    client_id TEXT NOT NULL,
    campaign_name TEXT NOT NULL,
    platform TEXT NOT NULL DEFAULT 'Facebook',
    ad_type TEXT NOT NULL,
    objective TEXT NOT NULL,
    start_date TEXT,
    end_date TEXT,
    status TEXT DEFAULT 'draft',
    notes TEXT,
    created_by TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS pre_boost_metrics (
    id TEXT PRIMARY KEY,
    campaign_id TEXT NOT NULL UNIQUE,
    reach INTEGER DEFAULT 0,
    impressions INTEGER DEFAULT 0,
    reactions INTEGER DEFAULT 0,
    comments INTEGER DEFAULT 0,
    shares INTEGER DEFAULT 0,
    link_clicks INTEGER DEFAULT 0,
    post_saves INTEGER DEFAULT 0,
    page_likes INTEGER DEFAULT 0,
    page_followers INTEGER DEFAULT 0,
    video_views INTEGER DEFAULT 0,
    profile_visits INTEGER DEFAULT 0,
    updated_by TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS post_boost_metrics (
    id TEXT PRIMARY KEY,
    campaign_id TEXT NOT NULL UNIQUE,
    amount_spent REAL DEFAULT 0,
    duration_days INTEGER DEFAULT 0,
    reach INTEGER DEFAULT 0,
    impressions INTEGER DEFAULT 0,
    frequency REAL DEFAULT 0,
    reactions INTEGER DEFAULT 0,
    comments INTEGER DEFAULT 0,
    shares INTEGER DEFAULT 0,
    link_clicks INTEGER DEFAULT 0,
    ctr REAL DEFAULT 0,
    cpc REAL DEFAULT 0,
    cpm REAL DEFAULT 0,
    conversions INTEGER DEFAULT 0,
    leads INTEGER DEFAULT 0,
    page_likes INTEGER DEFAULT 0,
    page_followers INTEGER DEFAULT 0,
    video_views INTEGER DEFAULT 0,
    post_saves INTEGER DEFAULT 0,
    profile_visits INTEGER DEFAULT 0,
    website_visits INTEGER DEFAULT 0,
    target_audience TEXT,
    target_location TEXT,
    target_age_range TEXT,
    target_gender TEXT,
    updated_by TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS activity_log (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    action TEXT NOT NULL,
    entity_type TEXT,
    entity_id TEXT,
    details TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );
`);

// ============ SEED SUPER ADMIN ============
const adminExists = db.prepare("SELECT id FROM users WHERE role='superadmin'").get();
if (!adminExists) {
  const adminId = uuidv4();
  const hashedPw = bcrypt.hashSync('admin123', 12);
  db.prepare(`INSERT INTO users (id, full_name, email, password, role) VALUES (?, ?, ?, ?, ?)`).run(
    adminId, 'Super Admin', 'admin@metapulse.com', hashedPw, 'superadmin'
  );
  console.log('Default super admin created: admin@metapulse.com / admin123');
}

// ============ AUTH HELPERS ============
function generateToken(user) {
  return jwt.sign({ id: user.id, role: user.role, name: user.full_name }, JWT_SECRET, { expiresIn: '8h' });
}

function authMiddleware(req, res, next) {
  const token = req.cookies.token || req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Authentication required' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = db.prepare('SELECT id, full_name, email, role, is_active FROM users WHERE id = ?').get(decoded.id);
    if (!user || !user.is_active) return res.status(401).json({ error: 'Account disabled or not found' });
    req.user = user;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

function adminOnly(req, res, next) {
  if (req.user.role !== 'superadmin') return res.status(403).json({ error: 'Admin access required' });
  next();
}

function logActivity(userId, action, entityType, entityId, details) {
  db.prepare('INSERT INTO activity_log (id, user_id, action, entity_type, entity_id, details) VALUES (?,?,?,?,?,?)')
    .run(uuidv4(), userId, action, entityType || null, entityId || null, details || null);
}

// Input sanitizer
function sanitize(str, maxLen = 1000) {
  if (!str) return str;
  return String(str).slice(0, maxLen).replace(/[<>]/g, '').trim();
}

// ============ AUTH ROUTES (public) ============
app.post('/api/auth/login', rateLimit(900000, 15), (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(sanitize(email));
  if (!user || !user.is_active) return res.status(401).json({ error: 'Invalid credentials' });
  if (!bcrypt.compareSync(password, user.password)) return res.status(401).json({ error: 'Invalid credentials' });

  const token = generateToken(user);
  res.cookie('token', token, { httpOnly: true, sameSite: 'strict', maxAge: 8 * 60 * 60 * 1000, secure: process.env.NODE_ENV === 'production' });
  logActivity(user.id, 'login', 'user', user.id, null);
  res.json({ user: { id: user.id, full_name: user.full_name, email: user.email, role: user.role }, token });
});

app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ success: true });
});

app.get('/api/auth/me', authMiddleware, (req, res) => {
  res.json({ user: req.user });
});

// ============ PROTECT API ROUTES ============
app.use('/api', authMiddleware);

// Serve static files publicly (auth is handled client-side via app.js)
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1h' }));

// ============ USER MANAGEMENT (admin only) ============
app.get('/api/users', adminOnly, (req, res) => {
  const users = db.prepare('SELECT id, full_name, email, role, is_active, created_at FROM users ORDER BY created_at DESC').all();
  res.json(users);
});

app.post('/api/users', adminOnly, (req, res) => {
  const { full_name, email, password, role } = req.body;
  if (!full_name || !email || !password) return res.status(400).json({ error: 'Name, email and password required' });
  if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });

  const exists = db.prepare('SELECT id FROM users WHERE email = ?').get(sanitize(email));
  if (exists) return res.status(409).json({ error: 'Email already registered' });

  const id = uuidv4();
  const validRole = ['employee', 'superadmin'].includes(role) ? role : 'employee';
  const hashed = bcrypt.hashSync(password, 12);
  db.prepare('INSERT INTO users (id, full_name, email, password, role) VALUES (?, ?, ?, ?, ?)')
    .run(id, sanitize(full_name), sanitize(email), hashed, validRole);

  logActivity(req.user.id, 'create_user', 'user', id, `Created user ${sanitize(full_name)}`);
  const user = db.prepare('SELECT id, full_name, email, role, is_active, created_at FROM users WHERE id = ?').get(id);
  res.status(201).json(user);
});

app.put('/api/users/:id', adminOnly, (req, res) => {
  const { full_name, email, role, is_active, password } = req.body;
  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!target) return res.status(404).json({ error: 'User not found' });

  const validRole = ['employee', 'superadmin'].includes(role) ? role : target.role;
  db.prepare('UPDATE users SET full_name=?, email=?, role=?, is_active=?, updated_at=datetime(\'now\') WHERE id=?')
    .run(sanitize(full_name) || target.full_name, sanitize(email) || target.email, validRole, is_active !== undefined ? is_active : target.is_active, req.params.id);

  if (password && password.length >= 6) {
    db.prepare('UPDATE users SET password=? WHERE id=?').run(bcrypt.hashSync(password, 12), req.params.id);
  }

  logActivity(req.user.id, 'update_user', 'user', req.params.id, null);
  const user = db.prepare('SELECT id, full_name, email, role, is_active, created_at FROM users WHERE id = ?').get(req.params.id);
  res.json(user);
});

app.delete('/api/users/:id', adminOnly, (req, res) => {
  if (req.params.id === req.user.id) return res.status(400).json({ error: 'Cannot delete your own account' });
  db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
  logActivity(req.user.id, 'delete_user', 'user', req.params.id, null);
  res.json({ success: true });
});

// Change own password
app.put('/api/auth/password', (req, res) => {
  const { current_password, new_password } = req.body;
  if (!current_password || !new_password) return res.status(400).json({ error: 'Both passwords required' });
  if (new_password.length < 6) return res.status(400).json({ error: 'New password must be at least 6 characters' });

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!bcrypt.compareSync(current_password, user.password)) return res.status(401).json({ error: 'Current password incorrect' });

  db.prepare('UPDATE users SET password=?, updated_at=datetime(\'now\') WHERE id=?').run(bcrypt.hashSync(new_password, 12), req.user.id);
  res.json({ success: true });
});

// ============ CLIENT ROUTES ============
app.get('/api/clients', (req, res) => {
  const clients = db.prepare('SELECT * FROM clients ORDER BY created_at DESC').all();
  res.json(clients);
});

app.get('/api/clients/:id', (req, res) => {
  const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(req.params.id);
  if (!client) return res.status(404).json({ error: 'Client not found' });
  res.json(client);
});

app.post('/api/clients', (req, res) => {
  const id = uuidv4();
  const { company_name, contact_person, email, phone, industry, website, notes } = req.body;
  if (!company_name || !contact_person || !email) return res.status(400).json({ error: 'Company name, contact person and email required' });

  db.prepare('INSERT INTO clients (id, company_name, contact_person, email, phone, industry, website, notes, created_by) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(id, sanitize(company_name), sanitize(contact_person), sanitize(email), sanitize(phone), sanitize(industry), sanitize(website), sanitize(notes), req.user.id);

  logActivity(req.user.id, 'create_client', 'client', id, sanitize(company_name));
  res.status(201).json(db.prepare('SELECT * FROM clients WHERE id = ?').get(id));
});

app.put('/api/clients/:id', (req, res) => {
  const { company_name, contact_person, email, phone, industry, website, notes } = req.body;
  db.prepare('UPDATE clients SET company_name=?, contact_person=?, email=?, phone=?, industry=?, website=?, notes=?, updated_at=datetime(\'now\') WHERE id=?')
    .run(sanitize(company_name), sanitize(contact_person), sanitize(email), sanitize(phone), sanitize(industry), sanitize(website), sanitize(notes), req.params.id);
  logActivity(req.user.id, 'update_client', 'client', req.params.id, null);
  res.json(db.prepare('SELECT * FROM clients WHERE id = ?').get(req.params.id));
});

app.delete('/api/clients/:id', adminOnly, (req, res) => {
  db.prepare('DELETE FROM clients WHERE id = ?').run(req.params.id);
  logActivity(req.user.id, 'delete_client', 'client', req.params.id, null);
  res.json({ success: true });
});

// ============ CAMPAIGN ROUTES ============
app.get('/api/campaigns', (req, res) => {
  const { client_id } = req.query;
  let query = 'SELECT c.*, cl.company_name as client_name, cl.contact_person FROM campaigns c JOIN clients cl ON c.client_id = cl.id';
  const params = [];
  if (client_id) { query += ' WHERE c.client_id = ?'; params.push(client_id); }
  query += ' ORDER BY c.created_at DESC';
  res.json(db.prepare(query).all(...params));
});

app.get('/api/campaigns/:id', (req, res) => {
  const campaign = db.prepare('SELECT c.*, cl.company_name as client_name, cl.contact_person FROM campaigns c JOIN clients cl ON c.client_id = cl.id WHERE c.id = ?').get(req.params.id);
  if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
  const preBoost = db.prepare('SELECT * FROM pre_boost_metrics WHERE campaign_id = ?').get(req.params.id);
  const postBoost = db.prepare('SELECT * FROM post_boost_metrics WHERE campaign_id = ?').get(req.params.id);
  res.json({ campaign, preBoost, postBoost });
});

app.post('/api/campaigns', (req, res) => {
  const id = uuidv4();
  const { client_id, campaign_name, platform, ad_type, objective, start_date, end_date, notes } = req.body;
  if (!client_id || !campaign_name || !ad_type || !objective) return res.status(400).json({ error: 'Client, name, ad type and objective required' });

  db.prepare('INSERT INTO campaigns (id, client_id, campaign_name, platform, ad_type, objective, start_date, end_date, notes, created_by) VALUES (?,?,?,?,?,?,?,?,?,?)')
    .run(id, client_id, sanitize(campaign_name), sanitize(platform) || 'Facebook', sanitize(ad_type), sanitize(objective), start_date || null, end_date || null, sanitize(notes), req.user.id);

  logActivity(req.user.id, 'create_campaign', 'campaign', id, sanitize(campaign_name));
  res.status(201).json(db.prepare('SELECT c.*, cl.company_name as client_name FROM campaigns c JOIN clients cl ON c.client_id = cl.id WHERE c.id = ?').get(id));
});

app.put('/api/campaigns/:id', (req, res) => {
  const { campaign_name, platform, ad_type, objective, start_date, end_date, status, notes } = req.body;
  db.prepare('UPDATE campaigns SET campaign_name=?, platform=?, ad_type=?, objective=?, start_date=?, end_date=?, status=?, notes=?, updated_at=datetime(\'now\') WHERE id=?')
    .run(sanitize(campaign_name), sanitize(platform), sanitize(ad_type), sanitize(objective), start_date, end_date, sanitize(status), sanitize(notes), req.params.id);
  logActivity(req.user.id, 'update_campaign', 'campaign', req.params.id, null);
  res.json(db.prepare('SELECT c.*, cl.company_name as client_name FROM campaigns c JOIN clients cl ON c.client_id = cl.id WHERE c.id = ?').get(req.params.id));
});

app.delete('/api/campaigns/:id', adminOnly, (req, res) => {
  db.prepare('DELETE FROM campaigns WHERE id = ?').run(req.params.id);
  logActivity(req.user.id, 'delete_campaign', 'campaign', req.params.id, null);
  res.json({ success: true });
});

// ============ PRE-BOOST METRICS ============
app.post('/api/campaigns/:id/pre-boost', (req, res) => {
  const campaign_id = req.params.id;
  const m = req.body;
  const existing = db.prepare('SELECT id FROM pre_boost_metrics WHERE campaign_id = ?').get(campaign_id);

  const vals = [
    m.reach || 0, m.impressions || 0, m.reactions || 0, m.comments || 0,
    m.shares || 0, m.link_clicks || 0, m.post_saves || 0, m.page_likes || 0,
    m.page_followers || 0, m.video_views || 0, m.profile_visits || 0, req.user.id
  ];

  if (existing) {
    db.prepare(`UPDATE pre_boost_metrics SET reach=?, impressions=?, reactions=?, comments=?, shares=?,
      link_clicks=?, post_saves=?, page_likes=?, page_followers=?, video_views=?, profile_visits=?, updated_by=? WHERE campaign_id=?`)
      .run(...vals, campaign_id);
  } else {
    db.prepare(`INSERT INTO pre_boost_metrics (id, campaign_id, reach, impressions, reactions, comments, shares,
      link_clicks, post_saves, page_likes, page_followers, video_views, profile_visits, updated_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(uuidv4(), campaign_id, ...vals);
  }

  db.prepare("UPDATE campaigns SET status='pre-boost', updated_at=datetime('now') WHERE id=?").run(campaign_id);
  logActivity(req.user.id, 'update_pre_boost', 'campaign', campaign_id, null);
  res.json(db.prepare('SELECT * FROM pre_boost_metrics WHERE campaign_id = ?').get(campaign_id));
});

// ============ POST-BOOST METRICS ============
app.post('/api/campaigns/:id/post-boost', (req, res) => {
  const campaign_id = req.params.id;
  const m = req.body;
  const existing = db.prepare('SELECT id FROM post_boost_metrics WHERE campaign_id = ?').get(campaign_id);

  const vals = [
    m.amount_spent || 0, m.duration_days || 0, m.reach || 0, m.impressions || 0,
    m.frequency || 0, m.reactions || 0, m.comments || 0, m.shares || 0,
    m.link_clicks || 0, m.ctr || 0, m.cpc || 0, m.cpm || 0,
    m.conversions || 0, m.leads || 0, m.page_likes || 0, m.page_followers || 0,
    m.video_views || 0, m.post_saves || 0, m.profile_visits || 0, m.website_visits || 0,
    sanitize(m.target_audience), sanitize(m.target_location), sanitize(m.target_age_range), sanitize(m.target_gender),
    req.user.id
  ];

  if (existing) {
    db.prepare(`UPDATE post_boost_metrics SET amount_spent=?, duration_days=?, reach=?, impressions=?, frequency=?,
      reactions=?, comments=?, shares=?, link_clicks=?, ctr=?, cpc=?, cpm=?,
      conversions=?, leads=?, page_likes=?, page_followers=?, video_views=?, post_saves=?, profile_visits=?, website_visits=?,
      target_audience=?, target_location=?, target_age_range=?, target_gender=?, updated_by=? WHERE campaign_id=?`)
      .run(...vals, campaign_id);
  } else {
    db.prepare(`INSERT INTO post_boost_metrics (id, campaign_id, amount_spent, duration_days, reach, impressions, frequency,
      reactions, comments, shares, link_clicks, ctr, cpc, cpm,
      conversions, leads, page_likes, page_followers, video_views, post_saves, profile_visits, website_visits,
      target_audience, target_location, target_age_range, target_gender, updated_by)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(uuidv4(), campaign_id, ...vals);
  }

  db.prepare("UPDATE campaigns SET status='completed', updated_at=datetime('now') WHERE id=?").run(campaign_id);
  logActivity(req.user.id, 'update_post_boost', 'campaign', campaign_id, null);
  res.json(db.prepare('SELECT * FROM post_boost_metrics WHERE campaign_id = ?').get(campaign_id));
});

// ============ DASHBOARD ============
app.get('/api/dashboard', (req, res) => {
  const totalClients = db.prepare('SELECT COUNT(*) as count FROM clients').get().count;
  const totalCampaigns = db.prepare('SELECT COUNT(*) as count FROM campaigns').get().count;
  const completedCampaigns = db.prepare("SELECT COUNT(*) as count FROM campaigns WHERE status='completed'").get().count;
  const totalSpent = db.prepare('SELECT COALESCE(SUM(amount_spent), 0) as total FROM post_boost_metrics').get().total;
  const totalReach = db.prepare('SELECT COALESCE(SUM(reach), 0) as total FROM post_boost_metrics').get().total;

  const recentCampaigns = db.prepare(`
    SELECT c.*, cl.company_name as client_name FROM campaigns c JOIN clients cl ON c.client_id = cl.id ORDER BY c.created_at DESC LIMIT 5
  `).all();

  res.json({ totalClients, totalCampaigns, completedCampaigns, totalSpent, totalReach, recentCampaigns });
});

// ============ ACTIVITY LOG (admin) ============
app.get('/api/activity', adminOnly, (req, res) => {
  const logs = db.prepare(`
    SELECT a.*, u.full_name as user_name FROM activity_log a LEFT JOIN users u ON a.user_id = u.id ORDER BY a.created_at DESC LIMIT 50
  `).all();
  res.json(logs);
});

// Catch-all: serve index for SPA (skip /api paths)
app.get('*', (req, res) => {
  if (req.path.startsWith('/api')) return res.status(404).json({ error: 'Not found' });
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Global error handler
app.use((err, req, res, _next) => {
  console.error('Unhandled error:', err.message);
  res.status(500).json({ error: 'Internal server error' });
});

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`MetaPulse running at http://localhost:${PORT}`);
  console.log(`Network: http://${require('os').networkInterfaces()?.eth0?.[0]?.address || '0.0.0.0'}:${PORT}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  server.close(() => { db.close(); process.exit(0); });
});
process.on('SIGINT', () => {
  server.close(() => { db.close(); process.exit(0); });
});
