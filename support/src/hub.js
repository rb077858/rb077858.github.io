// ChatHub — a single SQLite-backed Durable Object that owns everything:
// storage (agents, visitors, conversations, messages, files, settings),
// live WebSockets (agents + visitors, with hibernation), the HTTP API,
// and delayed email notifications (DO alarm).

import { DurableObject } from 'cloudflare:workers';
import {
  HttpError, json, readJson, randomToken, randomId, sha256, hashPassword, verifyPassword,
  validatePassword, normalizeEmail, cleanLine, cleanText, parseJson, getCookie, sessionCookie,
  SESSION_COOKIE, clientIp, parseUserAgent,
} from './util.js';
import { templates, sendMail } from './mail.js';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const SESSION_TTL = 30 * DAY;
const MAX_FILE = 1_500_000; // DO SQLite rows are limited to 2MB
const VISITOR_EVENT_TYPES = ['joined', 'closed', 'transferred'];

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

const WEEK = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

export const DEFAULT_SETTINGS = {
  site_name: 'reem.bi',
  brand_color: '#00a862',
  accent_color: '#0b3d25',
  position: 'right',            // 'right' | 'left'
  lang: 'auto',                 // 'auto' (from the page) | 'he' | 'en'
  launcher_style: 'bubble',     // 'bubble' | 'pill'
  show_agents: true,            // avatars of online agents in the header
  texts: {
    he: {
      title: 'דברו איתנו',
      subtitle: 'בדרך כלל עונים תוך כמה דקות',
      greeting: 'היי! 👋 איך אפשר לעזור היום?',
      launcher: 'צריכים עזרה?',
      offline_title: 'אנחנו לא זמינים כרגע',
      offline_text: 'השאירו הודעה ונחזור אליכם במייל בהקדם.',
    },
    en: {
      title: 'Chat with us',
      subtitle: 'We usually reply in a few minutes',
      greeting: 'Hi there! 👋 How can we help?',
      launcher: 'Need help?',
      offline_title: "We're away right now",
      offline_text: "Leave us a message and we'll get back to you by email.",
    },
  },
  prechat: { enabled: true, name: 'required', email: 'optional', phone: 'hidden' },
  topics: [],                   // optional department / topic picker, e.g. ["מכירות","תמיכה"]
  availability: 'auto',         // 'auto' | 'offline' (force the offline form)
  hours: {
    enabled: false,
    tz: 'Asia/Jerusalem',
    days: WEEK.map((_, i) => ({ on: i < 5, from: '09:00', to: '18:00' })),
  },
  assignment: 'manual',         // 'manual' | 'auto' (round-robin to the least busy online agent)
  allowed_origins: [],          // empty = any site may embed the widget
  notify: {
    offline_emails: true,       // email the team when a chat starts and nobody is online
    unanswered_minutes: 3,      // email the team when a chat waits this long (0 = off)
    visitor_reply_minutes: 5,   // email the visitor an unread reply after this long (0 = off)
    extra_emails: '',           // more addresses (comma separated) for team notifications
  },
  auto_close_hours: 24,         // close idle open chats (0 = never)
  rating: true,
  transcript: true,
  attachments: true,
  sound: true,
  track_visitors: true,         // show live visitors on the site in the dashboard
};

function mergeDeep(base, patch) {
  if (Array.isArray(base) || typeof base !== 'object' || base === null) return patch === undefined ? base : patch;
  const out = { ...base };
  for (const [k, v] of Object.entries(patch || {})) {
    if (!(k in base)) continue;
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && typeof base[k] === 'object' && !Array.isArray(base[k])
      ? mergeDeep(base[k], v)
      : v;
  }
  return out;
}

function sanitizeSettings(s) {
  const color = c => (/^#[0-9a-f]{6}$/i.test(c) ? c : null);
  s.site_name = cleanLine(s.site_name, 60) || DEFAULT_SETTINGS.site_name;
  s.brand_color = color(s.brand_color) || DEFAULT_SETTINGS.brand_color;
  s.accent_color = color(s.accent_color) || DEFAULT_SETTINGS.accent_color;
  s.position = s.position === 'left' ? 'left' : 'right';
  s.lang = ['he', 'en', 'auto'].includes(s.lang) ? s.lang : 'auto';
  s.launcher_style = s.launcher_style === 'pill' ? 'pill' : 'bubble';
  for (const lang of ['he', 'en']) {
    for (const k of Object.keys(DEFAULT_SETTINGS.texts[lang])) {
      s.texts[lang][k] = cleanText(s.texts[lang][k], 300) || DEFAULT_SETTINGS.texts[lang][k];
    }
  }
  for (const f of ['name', 'email', 'phone']) {
    if (!['required', 'optional', 'hidden'].includes(s.prechat[f])) s.prechat[f] = DEFAULT_SETTINGS.prechat[f];
  }
  s.prechat.enabled = !!s.prechat.enabled;
  s.topics = (Array.isArray(s.topics) ? s.topics : []).map(t => cleanLine(t, 40)).filter(Boolean).slice(0, 12);
  s.availability = s.availability === 'offline' ? 'offline' : 'auto';
  s.assignment = s.assignment === 'auto' ? 'auto' : 'manual';
  s.allowed_origins = (Array.isArray(s.allowed_origins) ? s.allowed_origins : String(s.allowed_origins || '').split(/[\s,]+/))
    .map(o => o.trim().replace(/\/+$/, '')).filter(o => /^https?:\/\/[^/]+$/.test(o)).slice(0, 30);
  const n = (v, min, max, d) => (Number.isFinite(+v) ? Math.min(max, Math.max(min, Math.round(+v))) : d);
  s.notify.unanswered_minutes = n(s.notify.unanswered_minutes, 0, 1440, 3);
  s.notify.visitor_reply_minutes = n(s.notify.visitor_reply_minutes, 0, 1440, 5);
  s.notify.offline_emails = !!s.notify.offline_emails;
  s.notify.extra_emails = cleanLine(s.notify.extra_emails, 500);
  s.auto_close_hours = n(s.auto_close_hours, 0, 24 * 30, 24);
  s.hours.days = Array.from({ length: 7 }, (_, i) => {
    const d = (s.hours.days || [])[i] || DEFAULT_SETTINGS.hours.days[i];
    const t = v => (/^\d{2}:\d{2}$/.test(v) ? v : '09:00');
    return { on: !!d.on, from: t(d.from), to: t(d.to) };
  });
  try {
    new Intl.DateTimeFormat('en', { timeZone: s.hours.tz });
  } catch {
    s.hours.tz = 'Asia/Jerusalem';
  }
  for (const k of ['rating', 'transcript', 'attachments', 'sound', 'track_visitors', 'show_agents']) s[k] = !!s[k];
  return s;
}

function zonedParts(ms, tz) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(ms));
  const get = t => parts.find(p => p.type === t)?.value;
  return {
    dow: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday')),
    hour: +get('hour'),
    minute: +get('minute'),
    date: `${get('year')}-${get('month')}-${get('day')}`,
  };
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)`,
  `CREATE TABLE IF NOT EXISTS agents (
     id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL DEFAULT '', title TEXT NOT NULL DEFAULT '',
     color TEXT NOT NULL DEFAULT '#00a862', role TEXT NOT NULL DEFAULT 'agent', password_hash TEXT,
     status TEXT NOT NULL DEFAULT 'online', max_chats INTEGER NOT NULL DEFAULT 5, notify_email INTEGER NOT NULL DEFAULT 1,
     signature TEXT NOT NULL DEFAULT '', disabled INTEGER NOT NULL DEFAULT 0, invited_by TEXT,
     created_at INTEGER NOT NULL, last_seen_at INTEGER)`,
  `CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, agent_id TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, user_agent TEXT NOT NULL DEFAULT '')`,
  `CREATE TABLE IF NOT EXISTS tokens (id TEXT PRIMARY KEY, type TEXT NOT NULL, agent_id TEXT NOT NULL, expires_at INTEGER NOT NULL, used_at INTEGER)`,
  `CREATE TABLE IF NOT EXISTS visitors (
     id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE, name TEXT NOT NULL DEFAULT '', email TEXT NOT NULL DEFAULT '',
     phone TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '', blocked INTEGER NOT NULL DEFAULT 0,
     country TEXT NOT NULL DEFAULT '', city TEXT NOT NULL DEFAULT '', timezone TEXT NOT NULL DEFAULT '',
     lang TEXT NOT NULL DEFAULT '', browser TEXT NOT NULL DEFAULT '', os TEXT NOT NULL DEFAULT '', device TEXT NOT NULL DEFAULT '',
     ip TEXT NOT NULL DEFAULT '', referrer TEXT NOT NULL DEFAULT '', current_url TEXT NOT NULL DEFAULT '',
     current_title TEXT NOT NULL DEFAULT '', pages INTEGER NOT NULL DEFAULT 0, visits INTEGER NOT NULL DEFAULT 1,
     first_seen INTEGER NOT NULL, last_seen INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS visitor_pages (id INTEGER PRIMARY KEY AUTOINCREMENT, visitor_id TEXT NOT NULL, url TEXT NOT NULL, title TEXT NOT NULL DEFAULT '', at INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS visitor_pages_v ON visitor_pages(visitor_id, id)`,
  `CREATE TABLE IF NOT EXISTS conversations (
     id INTEGER PRIMARY KEY AUTOINCREMENT, visitor_id TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open',
     assigned_agent_id TEXT, topic TEXT NOT NULL DEFAULT '', offline INTEGER NOT NULL DEFAULT 0,
     page_url TEXT NOT NULL DEFAULT '', page_title TEXT NOT NULL DEFAULT '', lang TEXT NOT NULL DEFAULT 'he',
     tags TEXT NOT NULL DEFAULT '[]', rating INTEGER, rating_comment TEXT NOT NULL DEFAULT '',
     unread_agent INTEGER NOT NULL DEFAULT 0, agent_read_at INTEGER, visitor_read_at INTEGER,
     last_message_at INTEGER NOT NULL, last_message_preview TEXT NOT NULL DEFAULT '', last_sender TEXT NOT NULL DEFAULT '',
     msg_count INTEGER NOT NULL DEFAULT 0, first_response_at INTEGER, closed_at INTEGER, closed_by TEXT,
     created_at INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS conv_status ON conversations(status, last_message_at)`,
  `CREATE INDEX IF NOT EXISTS conv_visitor ON conversations(visitor_id, id)`,
  `CREATE INDEX IF NOT EXISTS conv_agent ON conversations(assigned_agent_id, status)`,
  `CREATE INDEX IF NOT EXISTS conv_created ON conversations(created_at)`,
  `CREATE TABLE IF NOT EXISTS messages (
     id INTEGER PRIMARY KEY AUTOINCREMENT, conv_id INTEGER NOT NULL, sender_type TEXT NOT NULL,
     agent_id TEXT, sender_name TEXT NOT NULL DEFAULT '', kind TEXT NOT NULL DEFAULT 'text',
     body TEXT NOT NULL DEFAULT '', meta TEXT NOT NULL DEFAULT '{}', created_at INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS msg_conv ON messages(conv_id, id)`,
  `CREATE TABLE IF NOT EXISTS files (id TEXT PRIMARY KEY, conv_id INTEGER NOT NULL, name TEXT NOT NULL, mime TEXT NOT NULL, size INTEGER NOT NULL, data BLOB NOT NULL, created_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS canned (id INTEGER PRIMARY KEY AUTOINCREMENT, shortcut TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL, created_by TEXT, created_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS jobs (id INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT NOT NULL, conv_id INTEGER, due_at INTEGER NOT NULL, data TEXT NOT NULL DEFAULT '{}')`,
  `CREATE INDEX IF NOT EXISTS jobs_due ON jobs(due_at)`,
  `CREATE TABLE IF NOT EXISTS rate (key TEXT PRIMARY KEY, count INTEGER NOT NULL, window_start INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS email_log (id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, recipient TEXT NOT NULL, subject TEXT NOT NULL, conv_id INTEGER, status TEXT NOT NULL, created_at INTEGER NOT NULL)`,
];

const AGENT_COLORS = ['#00a862', '#3b82f6', '#8b5cf6', '#ec4899', '#f59e0b', '#14b8a6', '#ef4444', '#6366f1', '#0ea5e9', '#84cc16'];

// ---------------------------------------------------------------------------
// The Durable Object
// ---------------------------------------------------------------------------

export class ChatHub extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    ctx.blockConcurrencyWhile(async () => {
      for (const stmt of SCHEMA) this.sql.exec(stmt);
    });
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
    this._settings = null;
    this._lastAvailable = null;
  }

  // ---------- SQL helpers ----------

  q(query, ...args) {
    return this.sql.exec(query, ...args.map(a => (a === undefined ? null : typeof a === 'boolean' ? +a : a))).toArray();
  }
  one(query, ...args) {
    return this.q(query, ...args)[0] || null;
  }
  run(query, ...args) {
    const cur = this.sql.exec(query, ...args.map(a => (a === undefined ? null : typeof a === 'boolean' ? +a : a)));
    cur.toArray();
    return cur;
  }
  lastId() {
    return this.one('SELECT last_insert_rowid() AS id').id;
  }

  meta(key, value) {
    if (value === undefined) return this.one('SELECT value FROM meta WHERE key = ?', key)?.value ?? null;
    this.run('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, value);
  }

  get settings() {
    if (!this._settings) this._settings = sanitizeSettings(mergeDeep(DEFAULT_SETTINGS, parseJson(this.meta('settings'), {})));
    return this._settings;
  }

  get origin() {
    return this.env.PUBLIC_URL || this.meta('origin') || 'https://chat.reembir.com';
  }

  adminLink(convId) {
    return `${this.origin}/admin/${convId ? `#/c/${convId}` : ''}`;
  }

  rateLimit(key, limit, windowMs) {
    const t = Date.now();
    const row = this.one('SELECT count, window_start FROM rate WHERE key = ?', key);
    if (!row || row.window_start + windowMs <= t) {
      this.run('INSERT INTO rate (key, count, window_start) VALUES (?, 1, ?) ON CONFLICT(key) DO UPDATE SET count = 1, window_start = excluded.window_start', key, t);
      return;
    }
    if (row.count >= limit) throw new HttpError(429, 'rate_limited', 'יותר מדי בקשות, נסו שוב בעוד רגע');
    this.run('UPDATE rate SET count = count + 1 WHERE key = ?', key);
  }

  // =========================================================================
  // HTTP entry point
  // =========================================================================

  async fetch(request) {
    const url = new URL(request.url);
    if (!this.env.PUBLIC_URL && url.origin.startsWith('https://') && this.meta('origin') !== url.origin) this.meta('origin', url.origin);
    try {
      if (url.pathname === '/ws/agent') return await this.connectAgent(request);
      if (url.pathname === '/ws/visitor') return await this.connectVisitor(request, url);
      if (url.pathname.startsWith('/api/files/')) return this.serveFile(url.pathname.slice(11));
      if (url.pathname.startsWith('/api/v/')) return await this.visitorApi(request, url);
      if (url.pathname.startsWith('/api/auth/')) return await this.authApi(request, url);
      if (url.pathname.startsWith('/api/a/')) return await this.agentApi(request, url);
      throw new HttpError(404, 'not_found', 'לא נמצא');
    } catch (err) {
      if (err instanceof HttpError) return json({ error: err.code, message: err.message }, err.status);
      console.error(err?.stack || err);
      return json({ error: 'server_error', message: 'שגיאת שרת' }, 500);
    }
  }

  // =========================================================================
  // Agents: auth
  // =========================================================================

  checkSameOrigin(request, always = false) {
    if (!always && (request.method === 'GET' || request.method === 'HEAD')) return;
    const origin = request.headers.get('origin');
    if (origin && origin !== new URL(request.url).origin) throw new HttpError(403, 'bad_origin', 'בקשה ממקור לא מורשה');
  }

  async agentFromRequest(request) {
    const token = getCookie(request, SESSION_COOKIE);
    if (!token) return null;
    const id = await sha256(token);
    const row = this.one(
      `SELECT a.*, s.expires_at AS s_exp FROM sessions s JOIN agents a ON a.id = s.agent_id
       WHERE s.id = ? AND s.expires_at > ? AND a.disabled = 0`, id, Date.now());
    if (!row) return null;
    // Sliding session: extend once a day.
    if (row.s_exp - Date.now() < SESSION_TTL - DAY) this.run('UPDATE sessions SET expires_at = ? WHERE id = ?', Date.now() + SESSION_TTL, id);
    return row;
  }

  async requireAgent(request) {
    const agent = await this.agentFromRequest(request);
    if (!agent) throw new HttpError(401, 'unauthorized', 'צריך להתחבר');
    return agent;
  }

  async createSession(request, agentId) {
    const token = randomToken();
    this.run('INSERT INTO sessions (id, agent_id, created_at, expires_at, user_agent) VALUES (?, ?, ?, ?, ?)',
      await sha256(token), agentId, Date.now(), Date.now() + SESSION_TTL, (request.headers.get('user-agent') || '').slice(0, 200));
    this.run('UPDATE agents SET last_seen_at = ? WHERE id = ?', Date.now(), agentId);
    return sessionCookie(request, token, SESSION_TTL / 1000);
  }

  adminEmails() {
    return String(this.env.ADMIN_EMAILS || '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
  }

  async authApi(request, url) {
    this.checkSameOrigin(request);
    const path = url.pathname.slice('/api/auth/'.length);
    const ip = clientIp(request);

    if (path === 'me' && request.method === 'GET') {
      const agent = await this.agentFromRequest(request);
      const count = this.one('SELECT COUNT(*) AS n FROM agents').n;
      return json({ agent: agent ? this.publicAgent(agent, true) : null, setup: count === 0, dev: !!this.env.DEV });
    }

    if (path === 'login' && request.method === 'POST') {
      this.rateLimit(`login:${ip}`, 10, 10 * MIN);
      const body = await readJson(request);
      const email = normalizeEmail(body.email);
      const agent = this.one('SELECT * FROM agents WHERE email = ?', email);
      if (!agent || agent.disabled || !(await verifyPassword(String(body.password || ''), agent.password_hash))) {
        throw new HttpError(401, 'bad_credentials', 'המייל או הסיסמה לא נכונים');
      }
      const cookie = await this.createSession(request, agent.id);
      return json({ agent: this.publicAgent(agent, true) }, 200, { 'set-cookie': cookie });
    }

    if (path === 'logout' && request.method === 'POST') {
      const token = getCookie(request, SESSION_COOKIE);
      if (token) this.run('DELETE FROM sessions WHERE id = ?', await sha256(token));
      return json({ ok: true }, 200, { 'set-cookie': sessionCookie(request, '', 0) });
    }

    // "Forgot password" — also how the very first admin sets up the system.
    if (path === 'forgot' && request.method === 'POST') {
      this.rateLimit(`forgot:${ip}`, 5, 15 * MIN);
      const email = normalizeEmail((await readJson(request)).email);
      let agent = this.one('SELECT * FROM agents WHERE email = ? AND disabled = 0', email);
      let firstAdmin = false;
      if (!agent && this.one('SELECT COUNT(*) AS n FROM agents').n === 0 && this.adminEmails().includes(email)) {
        const id = randomId();
        this.run(`INSERT INTO agents (id, email, name, role, color, created_at) VALUES (?, ?, ?, 'admin', ?, ?)`,
          id, email, email.split('@')[0], AGENT_COLORS[0], Date.now());
        agent = this.one('SELECT * FROM agents WHERE id = ?', id);
        firstAdmin = true;
      }
      let devLink;
      if (agent) {
        const link = await this.makeToken(agent.id, 'reset', HOUR);
        const t = templates.reset({ link, firstAdmin, brand: this.settings.brand_color, siteName: this.settings.site_name });
        const res = await this.mail(agent.email, t, { kind: 'reset' });
        if (res.dev && this.env.DEV) devLink = link;
      }
      return json({ ok: true, devLink });
    }

    if (path === 'token' && request.method === 'GET') {
      const row = await this.readToken(url.searchParams.get('token'));
      const agent = this.one('SELECT * FROM agents WHERE id = ?', row.agent_id);
      return json({ type: row.type, email: agent.email, name: agent.name });
    }

    if (path === 'set-password' && request.method === 'POST') {
      this.rateLimit(`setpw:${ip}`, 10, 15 * MIN);
      const body = await readJson(request);
      const row = await this.readToken(body.token);
      validatePassword(body.password);
      const name = cleanLine(body.name, 60);
      this.run('UPDATE agents SET password_hash = ?, name = CASE WHEN ? != \'\' THEN ? ELSE name END WHERE id = ?',
        await hashPassword(body.password), name, name, row.agent_id);
      this.run('UPDATE tokens SET used_at = ? WHERE id = ?', Date.now(), row.id);
      this.run('DELETE FROM sessions WHERE agent_id = ?', row.agent_id);
      const cookie = await this.createSession(request, row.agent_id);
      const agent = this.one('SELECT * FROM agents WHERE id = ?', row.agent_id);
      this.broadcastAgents({ t: 'agents', agents: this.listAgents() });
      return json({ agent: this.publicAgent(agent, true) }, 200, { 'set-cookie': cookie });
    }

    throw new HttpError(404, 'not_found', 'לא נמצא');
  }

  async makeToken(agentId, type, ttl) {
    const token = randomToken();
    this.run('DELETE FROM tokens WHERE agent_id = ? AND type = ? AND used_at IS NULL', agentId, type);
    this.run('INSERT INTO tokens (id, type, agent_id, expires_at) VALUES (?, ?, ?, ?)', await sha256(token), type, agentId, Date.now() + ttl);
    return `${this.origin}/admin/#/password/${token}`;
  }

  async readToken(token) {
    if (!token) throw new HttpError(400, 'bad_token', 'קישור לא תקין');
    const row = this.one('SELECT * FROM tokens WHERE id = ?', await sha256(String(token)));
    if (!row || row.used_at || row.expires_at < Date.now()) throw new HttpError(400, 'bad_token', 'הקישור פג תוקף או שכבר נעשה בו שימוש');
    return row;
  }

  async mail(to, tpl, { kind, convId, replyTo } = {}) {
    let res;
    try {
      res = await sendMail(this.env, { to, subject: tpl.subject, html: tpl.html, text: tpl.text, replyTo: replyTo || tpl.replyTo });
      this.run('INSERT INTO email_log (kind, recipient, subject, conv_id, status, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        kind, to, tpl.subject, convId, res.dev ? 'dev' : 'sent', Date.now());
    } catch (e) {
      this.run('INSERT INTO email_log (kind, recipient, subject, conv_id, status, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        kind, to, tpl.subject, convId, 'failed', Date.now());
      res = { failed: true };
    }
    return res;
  }

  // =========================================================================
  // Presence
  // =========================================================================

  sockets(tag) {
    return this.ctx.getWebSockets(tag).filter(ws => ws.readyState === 1);
  }

  connectedAgentIds() {
    return new Set(this.sockets('agent').map(ws => ws.deserializeAttachment()?.agentId).filter(Boolean));
  }

  onlineAgentIds() {
    const connected = this.connectedAgentIds();
    if (!connected.size) return connected;
    const ids = [...connected];
    const rows = this.q(`SELECT id FROM agents WHERE status = 'online' AND disabled = 0 AND id IN (${ids.map(() => '?').join(',')})`, ...ids);
    return new Set(rows.map(r => r.id));
  }

  onlineVisitorIds() {
    return new Set(this.sockets('visitor').map(ws => ws.deserializeAttachment()?.visitorId).filter(Boolean));
  }

  inBusinessHours() {
    const h = this.settings.hours;
    if (!h.enabled) return true;
    const p = zonedParts(Date.now(), h.tz);
    const day = h.days[p.dow];
    if (!day?.on) return false;
    const mins = p.hour * 60 + p.minute;
    const [fh, fm] = day.from.split(':').map(Number);
    const [th, tm] = day.to.split(':').map(Number);
    return mins >= fh * 60 + fm && mins < th * 60 + tm;
  }

  isAvailable() {
    return this.settings.availability !== 'offline' && this.inBusinessHours() && this.onlineAgentIds().size > 0;
  }

  onlineAgentsPublic() {
    const ids = [...this.onlineAgentIds()];
    if (!ids.length || !this.settings.show_agents) return [];
    return this.q(`SELECT name, color, title FROM agents WHERE id IN (${ids.map(() => '?').join(',')}) LIMIT 3`, ...ids);
  }

  /** Tell visitors when the team goes online / offline. */
  checkAvailability() {
    const available = this.isAvailable();
    if (available === this._lastAvailable) return;
    this._lastAvailable = available;
    this.broadcastVisitors({ t: 'availability', available, agents: this.onlineAgentsPublic() });
  }

  // =========================================================================
  // WebSockets
  // =========================================================================

  async connectAgent(request) {
    if (request.headers.get('upgrade') !== 'websocket') throw new HttpError(426, 'upgrade_required');
    this.checkSameOrigin(request, true);
    const agent = await this.requireAgent(request);
    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1], ['agent', `a:${agent.id}`]);
    pair[1].serializeAttachment({ kind: 'agent', agentId: agent.id, viewing: null });
    this.run('UPDATE agents SET last_seen_at = ? WHERE id = ?', Date.now(), agent.id);
    pair[1].send(JSON.stringify({ t: 'hello', viewers: this.viewers() }));
    this.broadcastAgents({ t: 'agents', agents: this.listAgents() });
    this.checkAvailability();
    if (this.settings.assignment === 'auto') this.autoAssignQueued();
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  async connectVisitor(request, url) {
    if (request.headers.get('upgrade') !== 'websocket') throw new HttpError(426, 'upgrade_required');
    this.checkWidgetOrigin(request);
    const visitor = await this.visitorFromToken(url.searchParams.get('t'));
    if (!visitor || visitor.blocked) throw new HttpError(401, 'unauthorized');
    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1], ['visitor', `v:${visitor.id}`]);
    pair[1].serializeAttachment({ kind: 'visitor', visitorId: visitor.id, since: Date.now() });
    const wasOnline = this.sockets(`v:${visitor.id}`).length > 1;
    this.run('UPDATE visitors SET last_seen = ? WHERE id = ?', Date.now(), visitor.id);
    if (!wasOnline) this.broadcastVisitorPresence(visitor.id, true);
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  async webSocketMessage(ws, raw) {
    if (typeof raw !== 'string' || raw.length > 8000) return;
    const msg = parseJson(raw, null);
    if (!msg || typeof msg !== 'object') return;
    const att = ws.deserializeAttachment() || {};
    try {
      if (att.kind === 'agent') await this.onAgentSocket(ws, att, msg);
      else if (att.kind === 'visitor') await this.onVisitorSocket(ws, att, msg);
    } catch (e) {
      console.error('ws message error', e?.stack || e);
    }
  }

  async webSocketClose(ws, code) {
    try { ws.close(code, 'bye'); } catch { /* already closed */ }
    this.onSocketGone(ws);
  }

  async webSocketError(ws) {
    this.onSocketGone(ws);
  }

  onSocketGone(ws) {
    const att = ws.deserializeAttachment() || {};
    if (att.kind === 'agent') {
      this.run('UPDATE agents SET last_seen_at = ? WHERE id = ?', Date.now(), att.agentId);
      if (att.viewing) this.broadcastAgents({ t: 'viewing', agentId: att.agentId, convId: null, viewers: this.viewers(ws) });
      this.broadcastAgents({ t: 'agents', agents: this.listAgents() }, ws);
      this.checkAvailability();
    } else if (att.kind === 'visitor') {
      const still = this.sockets(`v:${att.visitorId}`).filter(s => s !== ws).length;
      if (!still) {
        this.run('UPDATE visitors SET last_seen = ? WHERE id = ?', Date.now(), att.visitorId);
        this.broadcastVisitorPresence(att.visitorId, false, ws);
      }
    }
  }

  /** Who is looking at which conversation: { convId: [agentId, ...] } */
  viewers(except) {
    const map = {};
    for (const ws of this.sockets('agent')) {
      if (ws === except) continue;
      const a = ws.deserializeAttachment();
      if (a?.viewing) (map[a.viewing] ||= []).includes(a.agentId) || map[a.viewing].push(a.agentId);
    }
    return map;
  }

  async onAgentSocket(ws, att, msg) {
    if (msg.t === 'view') {
      att.viewing = Number(msg.convId) || null;
      ws.serializeAttachment(att);
      this.broadcastAgents({ t: 'viewing', viewers: this.viewers() });
    } else if (msg.t === 'typing') {
      const conv = this.one('SELECT id, visitor_id FROM conversations WHERE id = ?', Number(msg.convId));
      if (!conv) return;
      const agent = this.one('SELECT id, name, color FROM agents WHERE id = ?', att.agentId);
      const on = !!msg.on;
      if (!msg.whisper) this.sendToVisitor(conv.visitor_id, { t: 'typing', convId: conv.id, on, name: agent.name });
      this.broadcastAgents({ t: 'typing', convId: conv.id, who: 'agent', agentId: agent.id, name: agent.name, on, whisper: !!msg.whisper }, ws);
    }
  }

  async onVisitorSocket(ws, att, msg) {
    if (msg.t === 'typing') {
      const conv = this.openConvOf(att.visitorId);
      if (!conv) return;
      const text = this.settings.track_visitors ? String(msg.text || '').slice(0, 500) : '';
      this.broadcastAgents({ t: 'typing', convId: conv.id, who: 'visitor', on: !!msg.on, text });
    } else if (msg.t === 'read') {
      const conv = this.openConvOf(att.visitorId) || this.lastConvOf(att.visitorId);
      if (!conv) return;
      const t = Date.now();
      this.run('UPDATE conversations SET visitor_read_at = ? WHERE id = ?', t, conv.id);
      this.run(`DELETE FROM jobs WHERE type = 'visitor_reply' AND conv_id = ?`, conv.id);
      this.broadcastAgents({ t: 'read', convId: conv.id, by: 'visitor', at: t });
    } else if (msg.t === 'page') {
      this.trackPage(att.visitorId, msg.url, msg.title);
    }
  }

  trackPage(visitorId, url, title) {
    url = String(url || '').slice(0, 500);
    title = cleanLine(title, 200);
    if (!/^https?:\/\//.test(url)) return;
    const v = this.one('SELECT current_url FROM visitors WHERE id = ?', visitorId);
    if (!v || v.current_url === url) return;
    this.run('UPDATE visitors SET current_url = ?, current_title = ?, pages = pages + 1, last_seen = ? WHERE id = ?', url, title, Date.now(), visitorId);
    this.run('INSERT INTO visitor_pages (visitor_id, url, title, at) VALUES (?, ?, ?, ?)', visitorId, url, title, Date.now());
    this.run(`DELETE FROM visitor_pages WHERE visitor_id = ? AND id NOT IN (SELECT id FROM visitor_pages WHERE visitor_id = ? ORDER BY id DESC LIMIT 50)`, visitorId, visitorId);
    if (this.settings.track_visitors) this.broadcastAgents({ t: 'visitor', visitor: this.liveVisitor(visitorId) });
  }

  // ---------- broadcasting ----------

  send(ws, data) {
    try { ws.send(typeof data === 'string' ? data : JSON.stringify(data)); } catch { /* closed */ }
  }

  broadcastAgents(data, except) {
    const s = JSON.stringify(data);
    for (const ws of this.sockets('agent')) if (ws !== except) this.send(ws, s);
  }

  sendToAgent(agentId, data) {
    const s = JSON.stringify(data);
    const list = this.sockets(`a:${agentId}`);
    for (const ws of list) this.send(ws, s);
    return list.length > 0;
  }

  broadcastVisitors(data) {
    const s = JSON.stringify(data);
    for (const ws of this.sockets('visitor')) this.send(ws, s);
  }

  sendToVisitor(visitorId, data) {
    const s = JSON.stringify(data);
    const list = this.sockets(`v:${visitorId}`);
    for (const ws of list) this.send(ws, s);
    return list.length > 0;
  }

  broadcastVisitorPresence(visitorId, online, except) {
    if (!this.settings.track_visitors) {
      // Still let agents know whether the person in an open chat is around.
      if (!this.openConvOf(visitorId)) return;
    }
    const v = this.liveVisitor(visitorId);
    if (v) { v.online = online; this.broadcastAgents({ t: 'visitor', visitor: v }, except); }
  }

  broadcastConv(convId) {
    const conv = this.convSummary(convId);
    if (conv) this.broadcastAgents({ t: 'conv', conv });
    return conv;
  }

  // =========================================================================
  // Serializers
  // =========================================================================

  publicAgent(a, self = false) {
    return {
      id: a.id, name: a.name, email: a.email, title: a.title, color: a.color, role: a.role, status: a.status,
      max_chats: a.max_chats, notify_email: !!a.notify_email, disabled: !!a.disabled, signature: self ? a.signature : undefined,
      pending: !a.password_hash, last_seen_at: a.last_seen_at, created_at: a.created_at,
    };
  }

  listAgents() {
    const connected = this.connectedAgentIds();
    const load = Object.fromEntries(this.q(`SELECT assigned_agent_id AS id, COUNT(*) AS n FROM conversations WHERE status = 'open' AND assigned_agent_id IS NOT NULL GROUP BY assigned_agent_id`).map(r => [r.id, r.n]));
    return this.q('SELECT * FROM agents ORDER BY disabled, name').map(a => ({
      ...this.publicAgent(a), connected: connected.has(a.id), online: connected.has(a.id) && a.status === 'online', active_chats: load[a.id] || 0,
    }));
  }

  msgOut(m) {
    return { ...m, meta: parseJson(m.meta, {}) };
  }

  visitorMsgOut(m) {
    const out = this.msgOut(m);
    delete out.agent_id;
    return out;
  }

  visibleToVisitor(m) {
    if (m.kind === 'whisper') return false;
    if (m.kind === 'event') return VISITOR_EVENT_TYPES.includes(parseJson(m.meta, {}).type);
    return true;
  }

  convSummary(id) {
    const c = this.one(
      `SELECT c.*, v.name AS visitor_name, v.email AS visitor_email, v.country, v.city, v.device
       FROM conversations c JOIN visitors v ON v.id = c.visitor_id WHERE c.id = ?`, id);
    return c ? this.convOut(c) : null;
  }

  convOut(c, online = this.onlineVisitorIds()) {
    return { ...c, tags: parseJson(c.tags, []), visitor_online: online.has(c.visitor_id) };
  }

  visitorOut(v) {
    if (!v) return null;
    const { token_hash, ...rest } = v;
    return rest;
  }

  liveVisitor(id) {
    const v = this.one(
      `SELECT id, name, email, country, city, browser, os, device, current_url, current_title, referrer, pages, visits, first_seen, last_seen
       FROM visitors WHERE id = ?`, id);
    if (!v) return null;
    const open = this.openConvOf(id);
    const since = this.sockets(`v:${id}`).map(ws => ws.deserializeAttachment()?.since || 0);
    return { ...v, online: since.length > 0, since: since.length ? Math.min(...since) : null, conv_id: open?.id || null };
  }

  // =========================================================================
  // Conversation helpers
  // =========================================================================

  openConvOf(visitorId) {
    return this.one(`SELECT * FROM conversations WHERE visitor_id = ? AND status = 'open' ORDER BY id DESC LIMIT 1`, visitorId);
  }
  lastConvOf(visitorId) {
    return this.one('SELECT * FROM conversations WHERE visitor_id = ? ORDER BY id DESC LIMIT 1', visitorId);
  }

  insertMessage(convId, { sender_type, agent_id = null, sender_name = '', kind = 'text', body = '', meta = {} }) {
    const t = Date.now();
    this.run(`INSERT INTO messages (conv_id, sender_type, agent_id, sender_name, kind, body, meta, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      convId, sender_type, agent_id, sender_name, kind, body, JSON.stringify(meta), t);
    const msg = this.one('SELECT * FROM messages WHERE id = ?', this.lastId());
    if (kind === 'text' || kind === 'file') {
      const preview = kind === 'file' ? `📎 ${body}` : body.replace(/\s+/g, ' ').slice(0, 140);
      this.run(`UPDATE conversations SET last_message_at = ?, last_message_preview = ?, last_sender = ?, msg_count = msg_count + 1
                ${sender_type === 'visitor' ? ', unread_agent = unread_agent + 1' : ''} WHERE id = ?`, t, preview, sender_type, convId);
    } else if (kind === 'whisper') {
      this.run('UPDATE conversations SET last_message_at = ? WHERE id = ?', t, convId);
    }
    return msg;
  }

  /** Push a new message to everyone who should see it. */
  deliver(conv, msg) {
    const out = this.msgOut(msg);
    this.broadcastAgents({ t: 'message', convId: conv.id, message: out });
    if (this.visibleToVisitor(msg)) this.sendToVisitor(conv.visitor_id, { t: 'message', convId: conv.id, message: this.visitorMsgOut(msg) });
    this.broadcastConv(conv.id);
  }

  addEvent(conv, type, body, meta = {}) {
    const msg = this.insertMessage(conv.id, { sender_type: 'system', kind: 'event', body, meta: { type, ...meta } });
    this.deliver(conv, msg);
    return msg;
  }

  assign(conv, agentId, by) {
    const target = agentId ? this.one('SELECT * FROM agents WHERE id = ? AND disabled = 0', agentId) : null;
    if (agentId && !target) throw new HttpError(404, 'agent_not_found', 'הנציג לא נמצא');
    if ((conv.assigned_agent_id || null) === (target?.id || null)) return;
    const prev = conv.assigned_agent_id;
    this.run('UPDATE conversations SET assigned_agent_id = ? WHERE id = ?', target?.id || null, conv.id);
    conv.assigned_agent_id = target?.id || null;
    if (!target) {
      this.addEvent(conv, 'unassigned', `${by?.name || 'המערכת'} החזיר/ה את השיחה לתור`);
    } else if (by && by.id === target.id && !prev) {
      this.addEvent(conv, 'joined', `${target.name} הצטרף/ה לשיחה`, { name: target.name, color: target.color, title: target.title });
    } else {
      this.addEvent(conv, prev ? 'transferred' : 'joined',
        by ? `${by.name} העביר/ה את השיחה ל${target.name}` : `השיחה שובצה אוטומטית ל${target.name}`,
        { name: target.name, color: target.color, title: target.title });
      if (!by || by.id !== target.id) {
        const seen = this.sendToAgent(target.id, { t: 'notify', kind: 'assigned', convId: conv.id, by: by?.name || null });
        if (!seen && target.notify_email) {
          const visitor = this.one('SELECT * FROM visitors WHERE id = ?', conv.visitor_id);
          this.ctx.waitUntil(this.mail(target.email, templates.assigned({ by: by?.name || 'המערכת', conv, visitor, link: this.adminLink(conv.id), brand: this.settings.brand_color, siteName: this.settings.site_name }), { kind: 'assigned', convId: conv.id }));
        }
      }
    }
    this.broadcastAgents({ t: 'agents', agents: this.listAgents() });
  }

  /** Least-busy online agent that still has room. */
  pickAgent() {
    const online = [...this.onlineAgentIds()];
    if (!online.length) return null;
    const rows = this.q(
      `SELECT a.id, a.max_chats, (SELECT COUNT(*) FROM conversations c WHERE c.assigned_agent_id = a.id AND c.status = 'open') AS load,
              (SELECT MAX(created_at) FROM conversations c WHERE c.assigned_agent_id = a.id) AS last_at
       FROM agents a WHERE a.id IN (${online.map(() => '?').join(',')})`, ...online);
    const free = rows.filter(r => r.load < r.max_chats).sort((a, b) => a.load - b.load || (a.last_at || 0) - (b.last_at || 0));
    return free[0]?.id || null;
  }

  autoAssignQueued() {
    const queued = this.q(`SELECT * FROM conversations WHERE status = 'open' AND assigned_agent_id IS NULL ORDER BY created_at LIMIT 20`);
    for (const conv of queued) {
      const id = this.pickAgent();
      if (!id) break;
      this.assign(conv, id, null);
    }
  }

  closeConv(conv, by, { byVisitor = false, auto = false } = {}) {
    if (conv.status === 'closed') return;
    this.run(`UPDATE conversations SET status = 'closed', closed_at = ?, closed_by = ? WHERE id = ?`,
      Date.now(), byVisitor ? 'visitor' : auto ? 'auto' : by?.id || null, conv.id);
    this.run(`DELETE FROM jobs WHERE type = 'unanswered' AND conv_id = ?`, conv.id);
    conv.status = 'closed';
    const text = byVisitor ? 'הלקוח/ה סיים/ה את השיחה' : auto ? 'השיחה נסגרה אוטומטית אחרי חוסר פעילות' : `${by.name} סגר/ה את השיחה`;
    this.addEvent(conv, 'closed', text, { by: byVisitor ? 'visitor' : auto ? 'auto' : 'agent' });
    this.sendToVisitor(conv.visitor_id, { t: 'closed', convId: conv.id, rate: this.settings.rating && !conv.rating });
    this.broadcastAgents({ t: 'agents', agents: this.listAgents() });
  }

  // =========================================================================
  // Jobs (DO alarm): delayed email notifications + housekeeping
  // =========================================================================

  async scheduleJob(type, convId, dueAt, data = {}) {
    this.run('DELETE FROM jobs WHERE type = ? AND conv_id = ?', type, convId);
    this.run('INSERT INTO jobs (type, conv_id, due_at, data) VALUES (?, ?, ?, ?)', type, convId, dueAt, JSON.stringify(data));
    await this.armAlarm();
  }

  async armAlarm() {
    const next = this.one('SELECT MIN(due_at) AS t FROM jobs')?.t;
    const openCount = this.one(`SELECT COUNT(*) AS n FROM conversations WHERE status = 'open'`).n;
    let when = next || null;
    if (openCount && this.settings.auto_close_hours) when = Math.min(when || Infinity, Date.now() + 30 * MIN);
    if (!when) return;
    const current = await this.ctx.storage.getAlarm();
    if (!current || current > when || current < Date.now()) await this.ctx.storage.setAlarm(Math.max(when, Date.now() + 1000));
  }

  async alarm() {
    const due = this.q('SELECT * FROM jobs WHERE due_at <= ? ORDER BY due_at LIMIT 50', Date.now());
    for (const job of due) {
      this.run('DELETE FROM jobs WHERE id = ?', job.id);
      try {
        await this.runJob(job);
      } catch (e) {
        console.error('job failed', job.type, e?.stack || e);
      }
    }
    // Housekeeping
    const h = this.settings.auto_close_hours;
    if (h) {
      const idle = this.q(`SELECT * FROM conversations WHERE status = 'open' AND last_message_at < ? LIMIT 50`, Date.now() - h * HOUR);
      for (const conv of idle) this.closeConv(conv, null, { auto: true });
    }
    this.run('DELETE FROM sessions WHERE expires_at < ?', Date.now());
    this.run('DELETE FROM tokens WHERE expires_at < ?', Date.now() - DAY);
    this.run('DELETE FROM rate WHERE window_start < ?', Date.now() - DAY);
    await this.ctx.storage.deleteAlarm();
    await this.armAlarm();
  }

  teamRecipients({ exceptConnected = false } = {}) {
    const connected = this.connectedAgentIds();
    const emails = this.q('SELECT id, email FROM agents WHERE disabled = 0 AND notify_email = 1 AND password_hash IS NOT NULL')
      .filter(a => !exceptConnected || !connected.has(a.id)).map(a => a.email);
    for (const e of this.settings.notify.extra_emails.split(/[\s,;]+/)) {
      if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) emails.push(e.toLowerCase());
    }
    return [...new Set(emails)];
  }

  recentMessages(convId, { limit = 10, visitorOnly = false, since = 0 } = {}) {
    return this.q(`SELECT * FROM (SELECT * FROM messages WHERE conv_id = ? AND created_at > ? ORDER BY id DESC LIMIT ?) ORDER BY id`, convId, since, limit * 3)
      .filter(m => (visitorOnly ? this.visibleToVisitor(m) && m.kind !== 'event' : m.kind === 'text' || m.kind === 'file'))
      .slice(-limit)
      .map(m => this.withFileUrl(m));
  }

  withFileUrl(m) {
    const meta = parseJson(m.meta, {});
    return meta.file_id ? { ...m, file_url: `${this.origin}/api/files/${meta.file_id}` } : m;
  }

  async notifyTeamNewChat(conv, reason) {
    const visitor = this.one('SELECT * FROM visitors WHERE id = ?', conv.visitor_id);
    const tplName = reason === 'offline' && conv.offline ? 'offline' : 'newChat';
    const tpl = templates[tplName]({
      conv, visitor, reason, messages: this.recentMessages(conv.id, { limit: 6 }), link: this.adminLink(conv.id),
      brand: this.settings.brand_color, siteName: this.settings.site_name,
    });
    for (const to of this.teamRecipients({ exceptConnected: reason === 'unanswered' })) {
      await this.mail(to, tpl, { kind: tplName, convId: conv.id });
    }
  }

  async runJob(job) {
    const conv = job.conv_id ? this.one('SELECT * FROM conversations WHERE id = ?', job.conv_id) : null;
    if (!conv) return;
    if (job.type === 'unanswered') {
      if (conv.status === 'open' && !conv.first_response_at) await this.notifyTeamNewChat(conv, 'unanswered');
    } else if (job.type === 'visitor_reply') {
      const visitor = this.one('SELECT * FROM visitors WHERE id = ?', conv.visitor_id);
      if (!visitor?.email || this.sockets(`v:${visitor.id}`).length) return;
      const unread = this.recentMessages(conv.id, { limit: 8, visitorOnly: true, since: conv.visitor_read_at || 0 })
        .filter(m => m.sender_type === 'agent');
      if (!unread.length) return;
      const link = conv.page_url ? `${conv.page_url.split('#')[0]}${conv.page_url.includes('?') ? '&' : '?'}chat=open` : this.origin;
      const tpl = templates.visitorReply({
        agentName: unread[unread.length - 1].sender_name, messages: unread, link, lang: conv.lang,
        brand: this.settings.brand_color, siteName: this.settings.site_name,
      });
      const agent = conv.assigned_agent_id ? this.one('SELECT email FROM agents WHERE id = ?', conv.assigned_agent_id) : null;
      await this.mail(visitor.email, tpl, { kind: 'visitor_reply', convId: conv.id, replyTo: agent?.email });
      this.run('UPDATE conversations SET visitor_read_at = ? WHERE id = ?', Date.now(), conv.id);
    }
  }

  // =========================================================================
  // Visitor API (called cross-origin by widget.js)
  // =========================================================================

  async visitorFromToken(token) {
    if (!token || typeof token !== 'string' || token.length > 100) return null;
    return this.one('SELECT * FROM visitors WHERE token_hash = ?', await sha256(token));
  }

  checkWidgetOrigin(request) {
    const origin = request.headers.get('origin');
    const allowed = this.settings.allowed_origins;
    if (!allowed.length || !origin) return;
    if (origin === new URL(request.url).origin || allowed.includes(origin)) return;
    throw new HttpError(403, 'origin_not_allowed', 'האתר הזה לא מורשה להשתמש בצ׳אט');
  }

  publicSettings() {
    const s = this.settings;
    return {
      site_name: s.site_name, brand_color: s.brand_color, accent_color: s.accent_color, position: s.position, lang: s.lang,
      launcher_style: s.launcher_style, texts: s.texts, prechat: s.prechat, topics: s.topics, rating: s.rating,
      transcript: s.transcript, attachments: s.attachments, sound: s.sound, track: s.track_visitors,
    };
  }

  visitorConvPayload(conv) {
    if (!conv) return { conversation: null, messages: [] };
    const messages = this.q('SELECT * FROM (SELECT * FROM messages WHERE conv_id = ? ORDER BY id DESC LIMIT 200) ORDER BY id', conv.id)
      .filter(m => this.visibleToVisitor(m)).map(m => this.visitorMsgOut(m));
    const agent = conv.assigned_agent_id ? this.one('SELECT name, color, title FROM agents WHERE id = ?', conv.assigned_agent_id) : null;
    return {
      conversation: {
        id: conv.id, status: conv.status, offline: !!conv.offline, rating: conv.rating, agent,
        agent_read_at: conv.agent_read_at, created_at: conv.created_at,
      },
      messages,
    };
  }

  async visitorApi(request, url) {
    this.checkWidgetOrigin(request);
    const path = url.pathname.slice('/api/v/'.length);
    const ip = clientIp(request);
    const geo = { country: request.headers.get('x-geo-country') || '', city: decodeURIComponent(request.headers.get('x-geo-city') || '') };

    if (path === 'init' && request.method === 'POST') {
      this.rateLimit(`init:${ip}`, 120, 10 * MIN);
      const body = await readJson(request);
      let token = typeof body.token === 'string' ? body.token : null;
      let visitor = await this.visitorFromToken(token);
      const ua = request.headers.get('user-agent') || '';
      const { browser, os, device } = parseUserAgent(ua);
      if (!visitor) {
        token = randomToken(24);
        const id = randomId(9);
        this.run(`INSERT INTO visitors (id, token_hash, country, city, timezone, lang, browser, os, device, ip, referrer, first_seen, last_seen)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          id, await sha256(token), geo.country, geo.city, cleanLine(body.tz, 60), cleanLine(body.lang, 20), browser, os, device, ip,
          String(body.referrer || '').slice(0, 500), Date.now(), Date.now());
        visitor = this.one('SELECT * FROM visitors WHERE id = ?', id);
      } else {
        const newVisit = Date.now() - visitor.last_seen > 30 * MIN;
        this.run(`UPDATE visitors SET last_seen = ?, visits = visits + ?, country = ?, city = ?, browser = ?, os = ?, device = ?, ip = ? WHERE id = ?`,
          Date.now(), newVisit ? 1 : 0, geo.country || visitor.country, geo.city || visitor.city, browser, os, device, ip, visitor.id);
        token = null; // the widget already has it
      }
      if (visitor.blocked) return json({ blocked: true });
      this.trackPage(visitor.id, body.url, body.title);
      const conv = this.openConvOf(visitor.id) || this.lastConvOf(visitor.id);
      return json({
        token,
        visitor: { id: visitor.id, name: visitor.name, email: visitor.email, phone: visitor.phone },
        settings: this.publicSettings(),
        available: this.isAvailable(),
        agents: this.onlineAgentsPublic(),
        ...this.visitorConvPayload(conv),
      });
    }

    const visitor = await this.visitorFromToken((request.headers.get('authorization') || '').replace(/^Bearer\s+/i, ''));
    if (!visitor) throw new HttpError(401, 'unauthorized', 'צריך לרענן את הדף');
    if (visitor.blocked) throw new HttpError(403, 'blocked', 'blocked');

    if (path === 'profile' && request.method === 'POST') {
      const body = await readJson(request);
      this.updateVisitorProfile(visitor, body);
      return json({ ok: true });
    }

    if (path === 'messages' && request.method === 'POST') {
      this.rateLimit(`vmsg:${visitor.id}`, 30, MIN);
      const body = await readJson(request);
      const text = cleanText(body.text, 4000);
      if (!text) throw new HttpError(400, 'empty', 'ההודעה ריקה');
      if (body.name !== undefined || body.email !== undefined || body.phone !== undefined) this.updateVisitorProfile(visitor, body);
      const { conv, created } = await this.ensureConversation(visitor, body);
      const msg = this.insertMessage(conv.id, { sender_type: 'visitor', sender_name: visitor.name || '', body: text, meta: { client_id: cleanLine(body.client_id, 40) } });
      this.deliver(conv, msg);
      if (created) await this.onConversationCreated(conv);
      return json({ message: this.visitorMsgOut(msg), ...this.visitorConvPayload(this.one('SELECT * FROM conversations WHERE id = ?', conv.id)) });
    }

    if (path === 'files' && request.method === 'POST') {
      if (!this.settings.attachments) throw new HttpError(403, 'disabled', 'העלאת קבצים כבויה');
      this.rateLimit(`vfile:${visitor.id}`, 10, 10 * MIN);
      const form = await request.formData();
      const { conv, created } = await this.ensureConversation(visitor, {});
      const msg = await this.storeFile(conv, form.get('file'), { sender_type: 'visitor', sender_name: visitor.name || '' });
      this.deliver(conv, msg);
      if (created) await this.onConversationCreated(conv);
      return json({ message: this.visitorMsgOut(msg) });
    }

    if (path === 'close' && request.method === 'POST') {
      const conv = this.openConvOf(visitor.id);
      if (conv) this.closeConv(conv, null, { byVisitor: true });
      return json({ ok: true });
    }

    if (path === 'rate' && request.method === 'POST') {
      const body = await readJson(request);
      const conv = this.one('SELECT * FROM conversations WHERE id = ? AND visitor_id = ?', Number(body.conv_id), visitor.id);
      if (!conv) throw new HttpError(404, 'not_found', 'לא נמצא');
      const rating = Math.min(5, Math.max(1, Math.round(Number(body.rating) || 0)));
      const comment = cleanText(body.comment, 1000);
      this.run('UPDATE conversations SET rating = ?, rating_comment = ? WHERE id = ?', rating, comment, conv.id);
      this.addEvent(conv, 'rated', `הלקוח/ה דירג/ה את השיחה: ${'★'.repeat(rating)}${'☆'.repeat(5 - rating)}${comment ? ` — "${comment}"` : ''}`, { rating });
      return json({ ok: true });
    }

    if (path === 'transcript' && request.method === 'POST') {
      if (!this.settings.transcript) throw new HttpError(403, 'disabled', 'disabled');
      this.rateLimit(`vtr:${visitor.id}`, 3, HOUR);
      const body = await readJson(request);
      const email = normalizeEmail(body.email || visitor.email);
      const conv = this.one('SELECT * FROM conversations WHERE id = ? AND visitor_id = ?', Number(body.conv_id), visitor.id);
      if (!conv) throw new HttpError(404, 'not_found', 'לא נמצא');
      if (!visitor.email) this.run('UPDATE visitors SET email = ? WHERE id = ?', email, visitor.id);
      await this.sendTranscript(conv, email);
      return json({ ok: true });
    }

    throw new HttpError(404, 'not_found', 'לא נמצא');
  }

  updateVisitorProfile(visitor, body) {
    const name = body.name !== undefined ? cleanLine(body.name, 60) : visitor.name;
    const email = body.email !== undefined ? normalizeEmail(body.email, { optional: true }) : visitor.email;
    const phone = body.phone !== undefined ? cleanLine(body.phone, 30) : visitor.phone;
    this.run('UPDATE visitors SET name = ?, email = ?, phone = ? WHERE id = ?', name || visitor.name, email || visitor.email, phone || visitor.phone, visitor.id);
    Object.assign(visitor, { name: name || visitor.name, email: email || visitor.email, phone: phone || visitor.phone });
    const conv = this.openConvOf(visitor.id);
    if (conv) this.broadcastConv(conv.id);
  }

  async ensureConversation(visitor, body) {
    const open = this.openConvOf(visitor.id);
    if (open) return { conv: open, created: false };
    this.rateLimit(`newconv:${visitor.id}`, 10, HOUR);
    const available = this.isAvailable();
    const topic = this.settings.topics.includes(body.topic) ? body.topic : '';
    const v = this.one('SELECT * FROM visitors WHERE id = ?', visitor.id);
    const lang = body.lang === 'en' ? 'en' : 'he';
    this.run(`INSERT INTO conversations (visitor_id, status, topic, offline, page_url, page_title, lang, last_message_at, created_at)
              VALUES (?, 'open', ?, ?, ?, ?, ?, ?, ?)`,
      visitor.id, topic, !available, v.current_url, v.current_title, lang, Date.now(), Date.now());
    return { conv: this.one('SELECT * FROM conversations WHERE id = ?', this.lastId()), created: true };
  }

  async onConversationCreated(conv) {
    conv = this.one('SELECT * FROM conversations WHERE id = ?', conv.id);
    const visitor = this.one('SELECT name FROM visitors WHERE id = ?', conv.visitor_id);
    this.broadcastAgents({ t: 'notify', kind: 'new', convId: conv.id, name: visitor.name, preview: conv.last_message_preview });
    if (this.settings.assignment === 'auto' && !conv.offline) {
      const id = this.pickAgent();
      if (id) this.assign(conv, id, null);
    }
    if (conv.offline) {
      if (this.settings.notify.offline_emails) await this.notifyTeamNewChat(conv, 'offline');
    } else if (this.settings.notify.unanswered_minutes) {
      await this.scheduleJob('unanswered', conv.id, Date.now() + this.settings.notify.unanswered_minutes * MIN);
    }
    await this.armAlarm();
  }

  async storeFile(conv, file, sender) {
    if (!file || typeof file === 'string') throw new HttpError(400, 'no_file', 'לא נבחר קובץ');
    if (file.size > MAX_FILE) throw new HttpError(413, 'too_large', 'הקובץ גדול מדי (עד 1.5MB)');
    const mime = String(file.type || 'application/octet-stream').slice(0, 100);
    if (/html|javascript|svg|xml/i.test(mime)) throw new HttpError(400, 'bad_type', 'סוג הקובץ לא נתמך');
    const id = randomToken(18);
    const name = cleanLine(file.name || 'file', 120);
    this.run('INSERT INTO files (id, conv_id, name, mime, size, data, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      id, conv.id, name, mime, file.size, await file.arrayBuffer(), Date.now());
    return this.insertMessage(conv.id, { ...sender, kind: 'file', body: name, meta: { file_id: id, mime, size: file.size, url: `/api/files/${id}` } });
  }

  serveFile(id) {
    const f = this.one('SELECT * FROM files WHERE id = ?', id);
    if (!f) return new Response('Not found', { status: 404 });
    const inline = /^image\/(png|jpe?g|gif|webp)$/.test(f.mime) || f.mime === 'application/pdf';
    return new Response(f.data, {
      headers: {
        'content-type': f.mime,
        'content-disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(f.name)}`,
        'cache-control': 'private, max-age=86400',
        'x-content-type-options': 'nosniff',
        'content-security-policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'",
        'access-control-allow-origin': '*',
      },
    });
  }

  async sendTranscript(conv, email) {
    const messages = this.q('SELECT * FROM messages WHERE conv_id = ? ORDER BY id', conv.id)
      .filter(m => m.kind === 'text' || m.kind === 'file').map(m => this.withFileUrl(m));
    const tpl = templates.transcript({ conv, messages, lang: conv.lang, brand: this.settings.brand_color, siteName: this.settings.site_name });
    return this.mail(email, tpl, { kind: 'transcript', convId: conv.id });
  }

  // =========================================================================
  // Agent API (the admin dashboard)
  // =========================================================================

  async agentApi(request, url) {
    this.checkSameOrigin(request);
    const me = await this.requireAgent(request);
    const path = url.pathname.slice('/api/a/'.length);
    const method = request.method;
    const isAdmin = me.role === 'admin';
    const requireAdmin = () => { if (!isAdmin) throw new HttpError(403, 'forbidden', 'רק מנהלים יכולים לעשות את זה'); };
    let m;

    // ---------- bootstrap / me ----------
    if (path === 'bootstrap' && method === 'GET') {
      return json({
        me: this.publicAgent(me, true),
        agents: this.listAgents(),
        settings: this.settings,
        canned: this.q('SELECT * FROM canned ORDER BY shortcut'),
        counts: this.counts(me.id),
        visitors: this.settings.track_visitors ? this.liveVisitors() : [],
        tags: this.allTags(),
        viewers: this.viewers(),
        email_configured: !!this.env.RESEND_API_KEY,
      });
    }

    if (path === 'me' && method === 'POST') {
      const b = await readJson(request);
      const name = b.name !== undefined ? cleanLine(b.name, 60) || me.name : me.name;
      const status = ['online', 'away'].includes(b.status) ? b.status : me.status;
      const color = /^#[0-9a-f]{6}$/i.test(b.color || '') ? b.color : me.color;
      this.run('UPDATE agents SET name = ?, title = ?, color = ?, status = ?, notify_email = ?, signature = ? WHERE id = ?',
        name, b.title !== undefined ? cleanLine(b.title, 60) : me.title, color, status,
        b.notify_email !== undefined ? !!b.notify_email : !!me.notify_email,
        b.signature !== undefined ? cleanText(b.signature, 300) : me.signature, me.id);
      if (b.password) {
        if (!(await verifyPassword(String(b.current_password || ''), me.password_hash))) throw new HttpError(400, 'bad_password', 'הסיסמה הנוכחית לא נכונה');
        validatePassword(b.password);
        this.run('UPDATE agents SET password_hash = ? WHERE id = ?', await hashPassword(b.password), me.id);
      }
      this.broadcastAgents({ t: 'agents', agents: this.listAgents() });
      this.checkAvailability();
      if (status === 'online' && this.settings.assignment === 'auto') this.autoAssignQueued();
      return json({ me: this.publicAgent(this.one('SELECT * FROM agents WHERE id = ?', me.id), true) });
    }

    if (path === 'counts' && method === 'GET') return json({ counts: this.counts(me.id) });

    // ---------- conversations ----------
    if (path === 'conversations' && method === 'GET') {
      return json(this.searchConversations(me, url.searchParams));
    }

    if ((m = path.match(/^conversations\/(\d+)$/)) && method === 'GET') {
      const conv = this.convSummary(Number(m[1]));
      if (!conv) throw new HttpError(404, 'not_found', 'השיחה לא נמצאה');
      const visitor = this.visitorOut(this.one('SELECT * FROM visitors WHERE id = ?', conv.visitor_id));
      visitor.online = this.sockets(`v:${visitor.id}`).length > 0;
      return json({
        conversation: conv,
        visitor,
        messages: this.q('SELECT * FROM messages WHERE conv_id = ? ORDER BY id', conv.id).map(x => this.msgOut(x)),
        pages: this.q('SELECT url, title, at FROM visitor_pages WHERE visitor_id = ? ORDER BY id DESC LIMIT 20', conv.visitor_id),
        history: this.q(`SELECT id, status, created_at, last_message_preview, rating, msg_count, assigned_agent_id FROM conversations WHERE visitor_id = ? AND id != ? ORDER BY id DESC LIMIT 20`, conv.visitor_id, conv.id),
      });
    }

    if ((m = path.match(/^conversations\/(\d+)\/(\w+)$/)) && method === 'POST') {
      const conv = this.one('SELECT * FROM conversations WHERE id = ?', Number(m[1]));
      if (!conv) throw new HttpError(404, 'not_found', 'השיחה לא נמצאה');
      const action = m[2];

      if (action === 'messages') {
        const b = await readJson(request);
        const text = cleanText(b.text, 5000);
        if (!text) throw new HttpError(400, 'empty', 'ההודעה ריקה');
        const whisper = b.kind === 'whisper';
        if (!whisper) {
          if (conv.status === 'closed') {
            this.run(`UPDATE conversations SET status = 'open', closed_at = NULL, closed_by = NULL WHERE id = ?`, conv.id);
            conv.status = 'open';
            this.addEvent(conv, 'reopened', `${me.name} פתח/ה מחדש את השיחה`);
          }
          if (!conv.assigned_agent_id) this.assign(conv, me.id, me);
          if (!conv.first_response_at) this.run('UPDATE conversations SET first_response_at = ? WHERE id = ?', Date.now(), conv.id);
          this.run(`DELETE FROM jobs WHERE type = 'unanswered' AND conv_id = ?`, conv.id);
        }
        const mentions = whisper ? (Array.isArray(b.mentions) ? b.mentions : []).filter(id => typeof id === 'string').slice(0, 10) : [];
        const msg = this.insertMessage(conv.id, {
          sender_type: 'agent', agent_id: me.id, sender_name: me.name, kind: whisper ? 'whisper' : 'text', body: text,
          meta: whisper ? { mentions } : { color: me.color },
        });
        if (!whisper) this.run('UPDATE conversations SET unread_agent = 0, agent_read_at = ? WHERE id = ?', Date.now(), conv.id);
        this.deliver(conv, msg);
        if (whisper) await this.notifyMentions(conv, me, text, mentions);
        else if (this.settings.notify.visitor_reply_minutes && !this.sockets(`v:${conv.visitor_id}`).length) {
          const v = this.one('SELECT email FROM visitors WHERE id = ?', conv.visitor_id);
          if (v?.email) await this.scheduleJob('visitor_reply', conv.id, Date.now() + this.settings.notify.visitor_reply_minutes * MIN);
        }
        return json({ message: this.msgOut(msg) });
      }

      if (action === 'files') {
        const form = await request.formData();
        if (!conv.assigned_agent_id) this.assign(conv, me.id, me);
        const msg = await this.storeFile(conv, form.get('file'), { sender_type: 'agent', agent_id: me.id, sender_name: me.name });
        if (!conv.first_response_at) this.run('UPDATE conversations SET first_response_at = ? WHERE id = ?', Date.now(), conv.id);
        this.deliver(conv, msg);
        return json({ message: this.msgOut(msg) });
      }

      if (action === 'assign') {
        const b = await readJson(request);
        this.assign(conv, b.agent_id || null, me);
        return json({ conversation: this.convSummary(conv.id) });
      }

      if (action === 'close') {
        this.closeConv(conv, me);
        return json({ conversation: this.convSummary(conv.id) });
      }

      if (action === 'reopen') {
        if (conv.status === 'closed') {
          this.run(`UPDATE conversations SET status = 'open', closed_at = NULL, closed_by = NULL WHERE id = ?`, conv.id);
          this.addEvent(conv, 'reopened', `${me.name} פתח/ה מחדש את השיחה`);
          await this.armAlarm();
        }
        return json({ conversation: this.convSummary(conv.id) });
      }

      if (action === 'read') {
        const t = Date.now();
        this.run('UPDATE conversations SET unread_agent = 0, agent_read_at = ? WHERE id = ?', t, conv.id);
        this.sendToVisitor(conv.visitor_id, { t: 'read', convId: conv.id, at: t });
        this.broadcastConv(conv.id);
        return json({ ok: true });
      }

      if (action === 'tags') {
        const b = await readJson(request);
        const tags = [...new Set((Array.isArray(b.tags) ? b.tags : []).map(t => cleanLine(t, 30)).filter(Boolean))].slice(0, 15);
        this.run('UPDATE conversations SET tags = ? WHERE id = ?', JSON.stringify(tags), conv.id);
        this.broadcastConv(conv.id);
        return json({ tags });
      }

      if (action === 'transcript') {
        const b = await readJson(request);
        const v = this.one('SELECT email FROM visitors WHERE id = ?', conv.visitor_id);
        const email = normalizeEmail(b.email || v.email);
        const res = await this.sendTranscript(conv, email);
        if (res.failed) throw new HttpError(502, 'email_failed', 'שליחת המייל נכשלה');
        this.addEvent(conv, 'note', `${me.name} שלח/ה את תמליל השיחה ל-${email}`);
        return json({ ok: true, dev: !!res.dev });
      }

      if (action === 'delete') {
        requireAdmin();
        this.run('DELETE FROM messages WHERE conv_id = ?', conv.id);
        this.run('DELETE FROM files WHERE conv_id = ?', conv.id);
        this.run('DELETE FROM jobs WHERE conv_id = ?', conv.id);
        this.run('DELETE FROM conversations WHERE id = ?', conv.id);
        this.broadcastAgents({ t: 'conv_deleted', convId: conv.id });
        return json({ ok: true });
      }
    }

    // ---------- visitors ----------
    if (path === 'visitors/live' && method === 'GET') return json({ visitors: this.liveVisitors() });

    if ((m = path.match(/^visitors\/([\w-]+)$/)) && method === 'POST') {
      const v = this.one('SELECT * FROM visitors WHERE id = ?', m[1]);
      if (!v) throw new HttpError(404, 'not_found', 'לא נמצא');
      const b = await readJson(request);
      this.run('UPDATE visitors SET name = ?, email = ?, phone = ?, notes = ?, blocked = ? WHERE id = ?',
        b.name !== undefined ? cleanLine(b.name, 60) : v.name,
        b.email !== undefined ? normalizeEmail(b.email, { optional: true }) : v.email,
        b.phone !== undefined ? cleanLine(b.phone, 30) : v.phone,
        b.notes !== undefined ? cleanText(b.notes, 3000) : v.notes,
        b.blocked !== undefined ? !!b.blocked : !!v.blocked, v.id);
      if (b.blocked) {
        for (const ws of this.sockets(`v:${v.id}`)) { this.send(ws, { t: 'blocked' }); try { ws.close(4003, 'blocked'); } catch {} }
        const conv = this.openConvOf(v.id);
        if (conv) this.closeConv(conv, me);
      }
      const conv = this.openConvOf(v.id) || this.lastConvOf(v.id);
      if (conv) this.broadcastConv(conv.id);
      const out = this.visitorOut(this.one('SELECT * FROM visitors WHERE id = ?', v.id));
      this.broadcastAgents({ t: 'visitor_updated', visitor: out });
      return json({ visitor: out });
    }

    // Proactive chat: an agent starts a conversation with a visitor who is on the site right now.
    if ((m = path.match(/^visitors\/([\w-]+)\/start$/)) && method === 'POST') {
      const v = this.one('SELECT * FROM visitors WHERE id = ?', m[1]);
      if (!v) throw new HttpError(404, 'not_found', 'לא נמצא');
      const text = cleanText((await readJson(request)).text, 2000);
      if (!text) throw new HttpError(400, 'empty', 'ההודעה ריקה');
      let conv = this.openConvOf(v.id);
      if (!conv) {
        this.run(`INSERT INTO conversations (visitor_id, status, assigned_agent_id, page_url, page_title, last_message_at, first_response_at, created_at)
                  VALUES (?, 'open', ?, ?, ?, ?, ?, ?)`, v.id, me.id, v.current_url, v.current_title, Date.now(), Date.now(), Date.now());
        conv = this.one('SELECT * FROM conversations WHERE id = ?', this.lastId());
        this.addEvent(conv, 'joined', `${me.name} פתח/ה שיחה יזומה`, { name: me.name, color: me.color, title: me.title });
      }
      const msg = this.insertMessage(conv.id, { sender_type: 'agent', agent_id: me.id, sender_name: me.name, body: text, meta: { color: me.color } });
      this.deliver(conv, msg);
      this.sendToVisitor(v.id, { t: 'open' });
      await this.armAlarm();
      return json({ conversation: this.convSummary(conv.id) });
    }

    // ---------- agents (admin) ----------
    if (path === 'agents' && method === 'GET') return json({ agents: this.listAgents() });

    if (path === 'agents' && method === 'POST') {
      requireAdmin();
      const b = await readJson(request);
      const email = normalizeEmail(b.email);
      if (this.one('SELECT id FROM agents WHERE email = ?', email)) throw new HttpError(409, 'exists', 'כבר יש נציג עם המייל הזה');
      const id = randomId();
      const count = this.one('SELECT COUNT(*) AS n FROM agents').n;
      this.run(`INSERT INTO agents (id, email, name, title, role, color, max_chats, invited_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        id, email, cleanLine(b.name, 60) || email.split('@')[0], cleanLine(b.title, 60), b.role === 'admin' ? 'admin' : 'agent',
        AGENT_COLORS[count % AGENT_COLORS.length], Math.min(50, Math.max(1, Number(b.max_chats) || 5)), me.id, Date.now());
      const res = await this.sendInvite(id, me);
      this.broadcastAgents({ t: 'agents', agents: this.listAgents() });
      return json({ agent: this.publicAgent(this.one('SELECT * FROM agents WHERE id = ?', id)), ...res });
    }

    if ((m = path.match(/^agents\/([\w-]+)$/)) && method === 'PATCH') {
      const a = this.one('SELECT * FROM agents WHERE id = ?', m[1]);
      if (!a) throw new HttpError(404, 'not_found', 'לא נמצא');
      if (!isAdmin && a.id !== me.id) requireAdmin();
      const b = await readJson(request);
      const role = isAdmin && ['admin', 'agent'].includes(b.role) ? b.role : a.role;
      const disabled = isAdmin && b.disabled !== undefined ? !!b.disabled : !!a.disabled;
      if ((role !== 'admin' || disabled) && a.role === 'admin' && this.one(`SELECT COUNT(*) AS n FROM agents WHERE role = 'admin' AND disabled = 0`).n <= 1) {
        throw new HttpError(400, 'last_admin', 'חייב להישאר לפחות מנהל פעיל אחד');
      }
      this.run('UPDATE agents SET name = ?, title = ?, role = ?, max_chats = ?, disabled = ?, color = ? WHERE id = ?',
        b.name !== undefined ? cleanLine(b.name, 60) || a.name : a.name,
        b.title !== undefined ? cleanLine(b.title, 60) : a.title, role,
        b.max_chats !== undefined ? Math.min(50, Math.max(1, Number(b.max_chats) || 5)) : a.max_chats, disabled,
        /^#[0-9a-f]{6}$/i.test(b.color || '') ? b.color : a.color, a.id);
      if (disabled) {
        this.run('DELETE FROM sessions WHERE agent_id = ?', a.id);
        for (const ws of this.sockets(`a:${a.id}`)) { try { ws.close(4001, 'disabled'); } catch {} }
      }
      this.broadcastAgents({ t: 'agents', agents: this.listAgents() });
      this.checkAvailability();
      return json({ ok: true });
    }

    if ((m = path.match(/^agents\/([\w-]+)$/)) && method === 'DELETE') {
      requireAdmin();
      const a = this.one('SELECT * FROM agents WHERE id = ?', m[1]);
      if (!a) throw new HttpError(404, 'not_found', 'לא נמצא');
      if (a.id === me.id) throw new HttpError(400, 'self', 'אי אפשר למחוק את עצמך');
      if (a.role === 'admin' && this.one(`SELECT COUNT(*) AS n FROM agents WHERE role = 'admin' AND disabled = 0`).n <= 1) throw new HttpError(400, 'last_admin', 'חייב להישאר לפחות מנהל אחד');
      this.run(`UPDATE conversations SET assigned_agent_id = NULL WHERE assigned_agent_id = ?`, a.id);
      this.run('DELETE FROM sessions WHERE agent_id = ?', a.id);
      this.run('DELETE FROM tokens WHERE agent_id = ?', a.id);
      this.run('DELETE FROM agents WHERE id = ?', a.id);
      for (const ws of this.sockets(`a:${a.id}`)) { try { ws.close(4001, 'deleted'); } catch {} }
      this.broadcastAgents({ t: 'agents', agents: this.listAgents() });
      this.checkAvailability();
      return json({ ok: true });
    }

    if ((m = path.match(/^agents\/([\w-]+)\/invite$/)) && method === 'POST') {
      requireAdmin();
      return json(await this.sendInvite(m[1], me));
    }

    // ---------- canned responses ----------
    if (path === 'canned' && method === 'POST') {
      const b = await readJson(request);
      const shortcut = cleanLine(b.shortcut, 30).replace(/^\/+/, '').replace(/\s+/g, '-').toLowerCase();
      if (!shortcut || !cleanText(b.body)) throw new HttpError(400, 'invalid', 'צריך קיצור וטקסט');
      this.run('INSERT INTO canned (shortcut, title, body, created_by, created_at) VALUES (?, ?, ?, ?, ?)',
        shortcut, cleanLine(b.title, 80) || shortcut, cleanText(b.body, 3000), me.id, Date.now());
      return this.cannedChanged();
    }
    if ((m = path.match(/^canned\/(\d+)$/))) {
      if (method === 'PATCH') {
        const b = await readJson(request);
        const shortcut = cleanLine(b.shortcut, 30).replace(/^\/+/, '').replace(/\s+/g, '-').toLowerCase();
        this.run('UPDATE canned SET shortcut = ?, title = ?, body = ? WHERE id = ?', shortcut, cleanLine(b.title, 80) || shortcut, cleanText(b.body, 3000), Number(m[1]));
        return this.cannedChanged();
      }
      if (method === 'DELETE') {
        this.run('DELETE FROM canned WHERE id = ?', Number(m[1]));
        return this.cannedChanged();
      }
    }

    // ---------- settings (admin) ----------
    if (path === 'settings' && method === 'PUT') {
      requireAdmin();
      const b = await readJson(request);
      const next = sanitizeSettings(mergeDeep(mergeDeep(DEFAULT_SETTINGS, this.settings), b));
      this.meta('settings', JSON.stringify(next));
      this._settings = null;
      this._lastAvailable = null;
      this.checkAvailability();
      this.broadcastVisitors({ t: 'settings', settings: this.publicSettings() });
      this.broadcastAgents({ t: 'settings', settings: this.settings });
      await this.armAlarm();
      return json({ settings: this.settings });
    }

    if (path === 'test-email' && method === 'POST') {
      requireAdmin();
      const res = await this.mail(me.email, {
        subject: 'בדיקת מייל ממערכת הצ׳אט ✅',
        html: `<div dir="rtl" style="font-family:Arial;font-size:15px">אם קיבלת את המייל הזה — התראות המייל עובדות. 🎉</div>`,
      }, { kind: 'test' });
      if (res.failed) throw new HttpError(502, 'email_failed', 'השליחה נכשלה — בדקו את RESEND_API_KEY ואת הדומיין ב-Resend');
      return json({ ok: true, dev: !!res.dev });
    }

    if (path === 'emails' && method === 'GET') {
      requireAdmin();
      return json({ emails: this.q('SELECT * FROM email_log ORDER BY id DESC LIMIT 100') });
    }

    // ---------- analytics / export ----------
    if (path === 'stats' && method === 'GET') return json(this.stats(url.searchParams));

    if (path === 'export.csv' && method === 'GET') {
      const rows = this.searchConversations(me, url.searchParams, 5000).conversations;
      const agents = Object.fromEntries(this.q('SELECT id, name FROM agents').map(a => [a.id, a.name]));
      const iso = t => (t ? new Date(t).toISOString() : '');
      const head = ['id', 'status', 'created_at', 'closed_at', 'visitor_name', 'visitor_email', 'country', 'agent', 'topic', 'tags', 'messages', 'first_response_sec', 'rating', 'rating_comment', 'page_url', 'offline'];
      const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
      const lines = rows.map(c => [
        c.id, c.status, iso(c.created_at), iso(c.closed_at), c.visitor_name, c.visitor_email, c.country, agents[c.assigned_agent_id] || '',
        c.topic, c.tags.join('; '), c.msg_count, c.first_response_at ? Math.round((c.first_response_at - c.created_at) / 1000) : '',
        c.rating || '', c.rating_comment, c.page_url, c.offline ? 1 : 0,
      ].map(esc).join(','));
      return new Response('﻿' + [head.join(','), ...lines].join('\n'), {
        headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="chats-${new Date().toISOString().slice(0, 10)}.csv"` },
      });
    }

    throw new HttpError(404, 'not_found', 'לא נמצא');
  }

  cannedChanged() {
    const canned = this.q('SELECT * FROM canned ORDER BY shortcut');
    this.broadcastAgents({ t: 'canned', canned });
    return json({ canned });
  }

  async sendInvite(agentId, inviter) {
    const a = this.one('SELECT * FROM agents WHERE id = ?', agentId);
    if (!a) throw new HttpError(404, 'not_found', 'לא נמצא');
    const link = await this.makeToken(a.id, 'invite', 7 * DAY);
    const res = await this.mail(a.email, templates.invite({ inviter: inviter.name, link, brand: this.settings.brand_color, siteName: this.settings.site_name }), { kind: 'invite' });
    // Without email configured, hand the link to the admin so they can pass it on themselves.
    return { invite_link: res.dev || res.failed ? link : undefined, email_failed: !!res.failed };
  }

  async notifyMentions(conv, from, text, mentions) {
    const targets = mentions.length
      ? mentions
      : conv.assigned_agent_id && conv.assigned_agent_id !== from.id ? [conv.assigned_agent_id] : [];
    for (const id of targets) {
      if (id === from.id) continue;
      const a = this.one('SELECT * FROM agents WHERE id = ? AND disabled = 0', id);
      if (!a) continue;
      const seen = this.sendToAgent(a.id, { t: 'notify', kind: 'whisper', convId: conv.id, from: from.name, text: text.slice(0, 200) });
      if (!seen && a.notify_email && mentions.includes(id)) {
        await this.mail(a.email, templates.whisper({ from: from.name, conv, text, link: this.adminLink(conv.id), brand: this.settings.brand_color, siteName: this.settings.site_name }), { kind: 'whisper', convId: conv.id });
      }
    }
  }

  counts(agentId) {
    const r = this.one(
      `SELECT
         SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) AS open,
         SUM(CASE WHEN status = 'open' AND assigned_agent_id IS NULL THEN 1 ELSE 0 END) AS unassigned,
         SUM(CASE WHEN status = 'open' AND assigned_agent_id = ? THEN 1 ELSE 0 END) AS mine,
         SUM(CASE WHEN status = 'open' AND unread_agent > 0 THEN 1 ELSE 0 END) AS unread
       FROM conversations`, agentId);
    return { open: r.open || 0, unassigned: r.unassigned || 0, mine: r.mine || 0, unread: r.unread || 0 };
  }

  allTags() {
    const set = new Map();
    for (const r of this.q(`SELECT tags FROM conversations WHERE tags != '[]' ORDER BY id DESC LIMIT 2000`)) {
      for (const t of parseJson(r.tags, [])) set.set(t, (set.get(t) || 0) + 1);
    }
    return [...set.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t).slice(0, 50);
  }

  liveVisitors() {
    const ids = [...this.onlineVisitorIds()];
    return ids.map(id => this.liveVisitor(id)).filter(Boolean).sort((a, b) => (a.since || 0) - (b.since || 0));
  }

  searchConversations(me, p, max = 50) {
    const where = [];
    const args = [];
    const view = p.get('view') || 'open';
    if (view === 'open') where.push(`c.status = 'open'`);
    if (view === 'mine') { where.push(`c.status = 'open' AND c.assigned_agent_id = ?`); args.push(me.id); }
    if (view === 'unassigned') where.push(`c.status = 'open' AND c.assigned_agent_id IS NULL`);
    if (view === 'closed') where.push(`c.status = 'closed'`);
    const qStr = cleanLine(p.get('q'), 100);
    if (qStr) {
      const like = `%${qStr.replace(/[\\%_]/g, c => '\\' + c)}%`;
      where.push(`(v.name LIKE ? ESCAPE '\\' OR v.email LIKE ? ESCAPE '\\' OR c.id = ? OR EXISTS (SELECT 1 FROM messages mm WHERE mm.conv_id = c.id AND mm.body LIKE ? ESCAPE '\\'))`);
      args.push(like, like, Number(qStr.replace('#', '')) || -1, like);
    }
    if (p.get('agent')) { where.push('c.assigned_agent_id = ?'); args.push(p.get('agent')); }
    if (p.get('tag')) { where.push('c.tags LIKE ?'); args.push(`%${JSON.stringify(p.get('tag'))}%`); }
    if (p.get('rating')) {
      const r = p.get('rating');
      if (r === 'none') where.push('c.rating IS NULL');
      else if (r === 'good') where.push('c.rating >= 4');
      else if (r === 'bad') where.push('c.rating <= 2');
    }
    if (p.get('offline') === '1') where.push('c.offline = 1');
    if (p.get('from')) { where.push('c.created_at >= ?'); args.push(Number(p.get('from'))); }
    if (p.get('to')) { where.push('c.created_at < ?'); args.push(Number(p.get('to'))); }
    if (p.get('visitor')) { where.push('c.visitor_id = ?'); args.push(p.get('visitor')); }
    if (p.get('before')) { where.push('c.last_message_at < ?'); args.push(Number(p.get('before'))); }
    const limit = Math.min(max, Math.max(1, Number(p.get('limit')) || max));
    const rows = this.q(
      `SELECT c.*, v.name AS visitor_name, v.email AS visitor_email, v.country, v.city, v.device
       FROM conversations c JOIN visitors v ON v.id = c.visitor_id
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY c.last_message_at DESC LIMIT ?`, ...args, limit + 1);
    const online = this.onlineVisitorIds();
    return {
      conversations: rows.slice(0, limit).map(c => this.convOut(c, online)),
      more: rows.length > limit,
      counts: this.counts(me.id),
    };
  }

  stats(p) {
    const days = Math.min(365, Math.max(1, Number(p.get('days')) || 30));
    const tz = this.settings.hours.tz;
    const from = Date.now() - days * DAY;
    const convs = this.q(
      `SELECT id, created_at, first_response_at, closed_at, rating, offline, assigned_agent_id, msg_count, status, last_message_at
       FROM conversations WHERE created_at >= ? LIMIT 50000`, from);
    const agentMsgs = this.q(
      `SELECT m.agent_id, COUNT(*) AS n FROM messages m JOIN conversations c ON c.id = m.conv_id
       WHERE c.created_at >= ? AND m.sender_type = 'agent' AND m.kind = 'text' GROUP BY m.agent_id`, from);

    const byDay = new Map();
    for (let i = days - 1; i >= 0; i--) byDay.set(zonedParts(Date.now() - i * DAY, tz).date, { total: 0, missed: 0 });
    const heat = Array.from({ length: 7 }, () => Array(24).fill(0));
    const frts = [];
    const durations = [];
    const ratings = [0, 0, 0, 0, 0];
    const perAgent = {};
    let missed = 0;

    for (const c of convs) {
      const z = zonedParts(c.created_at, tz);
      const d = byDay.get(z.date);
      const isMissed = !c.first_response_at;
      if (d) { d.total++; if (isMissed) d.missed++; }
      if (z.dow >= 0) heat[z.dow][z.hour]++;
      if (isMissed) missed++;
      if (c.first_response_at && !c.offline) frts.push(c.first_response_at - c.created_at);
      if (c.closed_at && c.first_response_at) durations.push(c.closed_at - c.created_at);
      if (c.rating) ratings[c.rating - 1]++;
      if (c.assigned_agent_id) {
        const a = (perAgent[c.assigned_agent_id] ||= { chats: 0, frt: [], ratings: [], messages: 0 });
        a.chats++;
        if (c.first_response_at && !c.offline) a.frt.push(c.first_response_at - c.created_at);
        if (c.rating) a.ratings.push(c.rating);
      }
    }
    for (const r of agentMsgs) if (r.agent_id && perAgent[r.agent_id]) perAgent[r.agent_id].messages = r.n;

    const avg = a => (a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : null);
    const median = a => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
    const rated = ratings.reduce((a, b) => a + b, 0);
    const agents = Object.fromEntries(this.q('SELECT id, name, color FROM agents').map(a => [a.id, a]));

    return {
      days,
      total: convs.length,
      missed,
      open: convs.filter(c => c.status === 'open').length,
      avg_first_response: avg(frts),
      median_first_response: median(frts),
      avg_duration: avg(durations),
      csat: rated ? Math.round(((ratings[3] + ratings[4]) / rated) * 100) : null,
      avg_rating: rated ? +(ratings.reduce((s, n, i) => s + n * (i + 1), 0) / rated).toFixed(2) : null,
      ratings,
      rated,
      by_day: [...byDay.entries()].map(([date, v]) => ({ date, ...v })),
      heat,
      agents: Object.entries(perAgent).map(([id, a]) => ({
        id, name: agents[id]?.name || '(נמחק)', color: agents[id]?.color || '#999', chats: a.chats, messages: a.messages,
        avg_first_response: avg(a.frt), avg_rating: a.ratings.length ? +(avg(a.ratings.map(r => r * 100)) / 100).toFixed(2) : null, rated: a.ratings.length,
      })).sort((a, b) => b.chats - a.chats),
    };
  }
}
