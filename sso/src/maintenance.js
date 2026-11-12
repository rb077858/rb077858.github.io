// System shutdown ("השבתת מערכת"), switched from the admin dashboard.
//
//   scope 'login' — no new sign-ins, registrations, sign-ins to sites or payments. Whoever is already
//                   signed in to a site keeps working.
//   scope 'all'   — the above, and sites can't use reem.bi at all (tokens, user info, billing): everyone
//                   is effectively out until it ends.
//
// Admins are never blocked, so they can always sign in and turn it off. With an end time it ends by
// itself. The message (optional) is what users see on the sign-in page and in the sites' errors.
import { HttpError, json, readJson, now } from './lib.js';

export const DEFAULT_MESSAGE = 'המערכת בתחזוקה כרגע ותחזור בקרוב. אפשר לנסות שוב מאוחר יותר.';
const SCOPES = ['login', 'all'];

let schemaReady = false;
async function ensureSchema(env) {
  if (schemaReady) return;
  await env.DB.prepare('CREATE TABLE IF NOT EXISTS system_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL)').run();
  schemaReady = true;
}

// Read on every API request: cached per isolate for a few seconds.
let cache = { at: 0, value: null };
async function stored(env) {
  if (Date.now() - cache.at < 5000) return cache.value;
  await ensureSchema(env);
  const row = await env.DB.prepare("SELECT value FROM system_settings WHERE key = 'maintenance'").first();
  let value = null;
  try { value = row ? JSON.parse(row.value) : null; } catch { value = null; }
  cache = { at: Date.now(), value };
  return value;
}

// The shutdown in force right now, or null.
export async function active(env) {
  const m = await stored(env);
  if (!m || !m.on) return null;
  if (m.until && m.until <= now()) return null;
  return m;
}

const fmtUntil = t => new Date(t * 1000).toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem', day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' });

// What a user sees (sign-in page, sites' error messages).
export function userText(m) {
  return (m.message || DEFAULT_MESSAGE) + (m.until ? ` (צפוי לחזור ב-${fmtUntil(m.until)})` : '');
}

export function blocked(m) {
  return new HttpError(503, 'maintenance', userText(m));
}

// For /api/config: shown on the sign-in page.
export async function publicInfo(env) {
  const m = await active(env);
  return m ? { scope: m.scope, message: m.message || DEFAULT_MESSAGE, until: m.until || null, text: userText(m) } : null;
}

// ---------------------------------------------------------------- admin

function view(m) {
  const on = !!(m && m.on && (!m.until || m.until > now()));
  return {
    on,
    scope: (m && m.scope) || 'login',
    until: on ? m.until || null : null,
    message: (m && m.message) || '',
    since: on ? m.since || null : null,
    by: on ? m.by || null : null,
    ended_at: m && !on && m.on && m.until ? m.until : null, // it ended by itself
    default_message: DEFAULT_MESSAGE,
  };
}

export async function adminGet(request, env, H) {
  await H.requireAdmin(request, env);
  return json({ maintenance: view(await stored(env)) });
}

export async function adminSave(request, env, H) {
  const admin = await H.requireAdmin(request, env);
  const body = await readJson(request);
  const prev = await stored(env);
  const on = !!body.on;
  const scope = SCOPES.includes(body.scope) ? body.scope : 'login';
  const message = String(body.message || '').trim().slice(0, 500);
  let until = body.until ? Math.floor(Number(body.until)) : null;
  if (until !== null && !(until > 0)) throw new HttpError(400, 'bad_until', 'תאריך הסיום לא תקין');
  if (on && until !== null && until <= now()) throw new HttpError(400, 'bad_until', 'תאריך הסיום כבר עבר');
  const wasOn = !!(prev && prev.on && (!prev.until || prev.until > now()));
  const value = {
    on, scope, message, until: on ? until : null,
    since: on ? (wasOn && prev.since) || now() : null,
    by: on ? admin.email : null,
  };
  await ensureSchema(env);
  await env.DB.prepare(
    `INSERT INTO system_settings (key, value, updated_at) VALUES ('maintenance', ?1, ?2)
     ON CONFLICT(key) DO UPDATE SET value = ?1, updated_at = ?2`,
  ).bind(JSON.stringify(value), now()).run();
  cache = { at: Date.now(), value };
  return json({ maintenance: view(value) });
}
