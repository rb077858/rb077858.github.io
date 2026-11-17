// Phone verification by SMS (Firebase Authentication), required of every user.
//
// The SMS itself is sent and checked by Firebase in the user's browser (login page). What arrives here is
// Firebase's signed ID token proving "this person controls +972…": it is verified against Google's keys,
// and the number is saved on the user. One number belongs to one account.
//
// The policy (dashboard → Overview → Phone verification):
//   off  nobody is asked
//   on   from the moment it is switched on, users who joined before it have `grace_days` (3) to verify;
//        users who join after it must verify at once. When the time is up and they haven't, they can still
//        sign in on login.reembir.com (to verify) but every site refuses them, until they do.
//   Admins are never blocked. An admin can skip one user, reset one (their number is cleared and they get a new
//   period), or give one more time.
import { HttpError, json, readJson, now, rateLimit, b64urlDecode, utf8 } from './lib.js';

const DAY = 86400;
export const GRACE_DEFAULT = 3;
const JWKS = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';

// ---------------------------------------------------------------- config & policy

/** Firebase's public web config, for the login page. null when the project isn't set up. */
export function firebaseConfig(env) {
  if (!env.FIREBASE_API_KEY || !env.FIREBASE_PROJECT_ID) return null;
  return {
    apiKey: env.FIREBASE_API_KEY,
    projectId: env.FIREBASE_PROJECT_ID,
    authDomain: env.FIREBASE_AUTH_DOMAIN || `${env.FIREBASE_PROJECT_ID}.firebaseapp.com`,
  };
}

/** The business number people write to (digits only, with the country code), for the wa.me link. null when not set. */
export function waNumber(env) {
  const n = String(env.WHATSAPP_NUMBER || '').replace(/\D/g, '');
  return n.length >= 8 ? n : null;
}
/** Verifying by WhatsApp needs the number, and the app secret (so a message can be trusted to come from Meta). */
export const waConfigured = env => !!(waNumber(env) && env.WHATSAPP_APP_SECRET);

let schemaReady = false;
async function ensureSchema(env) {
  if (schemaReady) return;
  await env.DB.prepare('CREATE TABLE IF NOT EXISTS phone_wa_codes (code TEXT PRIMARY KEY, user_id TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, done INTEGER NOT NULL DEFAULT 0, error TEXT)').run();
  await env.DB.prepare('CREATE TABLE IF NOT EXISTS system_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL)').run();
  schemaReady = true;
}

let cache = { at: 0, value: null };
export async function getPolicy(env) {
  if (Date.now() - cache.at < 5000 && cache.value) return cache.value;
  await ensureSchema(env);
  const row = await env.DB.prepare("SELECT value FROM system_settings WHERE key = 'phone_policy'").first();
  let v = null;
  try { v = row ? JSON.parse(row.value) : null; } catch { v = null; }
  const policy = { on: !!(v && v.on) && !!(firebaseConfig(env) || waConfigured(env)), since: (v && v.since) || 0, grace_days: v && Number.isFinite(v.grace_days) ? v.grace_days : GRACE_DEFAULT, wanted: !!(v && v.on) };
  cache = { at: Date.now(), value: policy };
  return policy;
}

// ---------------------------------------------------------------- one user's state

const maskPhone = p => (p ? p.slice(0, -4).replace(/\d/g, '•') + p.slice(-4) : null);

/** What the policy means for one user (admin: the user is an admin, so never blocked). */
export function stateOf(user, policy, admin) {
  const verified = !!(user.phone && user.phone_verified_at);
  const skipped = !!user.phone_skip;
  const base = { enabled: policy.on, verified, skipped, phone: maskPhone(user.phone), verified_at: user.phone_verified_at || null };
  if (!policy.on) return { ...base, required: false, needs_step: false, blocked: false, due: null, days_left: null, grace_days: policy.grace_days };
  // Who joined after the policy started must verify at once; the others have until since + grace.
  const due = user.phone_due || (user.created_at >= policy.since ? user.created_at : policy.since + policy.grace_days * DAY);
  const required = !verified && !skipped && !admin;
  const blocked = required && due <= now();
  return {
    ...base, required, needs_step: required, blocked, due,
    days_left: required && !blocked ? Math.max(1, Math.ceil((due - now()) / DAY)) : null,
    grace_days: policy.grace_days,
  };
}

/** For the dashboard's users list: one word. */
export function labelOf(s) {
  if (!s.enabled) return s.verified ? 'verified' : 'off';
  if (s.verified) return 'verified';
  if (s.skipped) return 'skipped';
  if (!s.required) return 'exempt';
  return s.blocked ? 'overdue' : 'waiting';
}

export async function stateFor(env, user, isAdmin) {
  return stateOf(user, await getPolicy(env), isAdmin);
}

/** Sites call this on every request of a signed-in user: someone whose time ran out is signed out of the sites. */
export async function assertAllowed(env, user, isAdmin) {
  const s = await stateFor(env, user, isAdmin);
  if (s.blocked) throw new HttpError(401, 'phone_required', 'צריך לאמת מספר טלפון כדי להמשיך. התחברו ל-login.reembir.com');
}

// ---------------------------------------------------------------- numbers

export function normalizePhone(input) {
  let s = String(input || '').trim().replace(/[\s\-().]/g, '');
  if (s.startsWith('00')) s = '+' + s.slice(2);
  if (/^0\d{8,10}$/.test(s)) s = '+972' + s.slice(1); // an Israeli number as it is dialled at home
  if (!/^\+[1-9]\d{7,14}$/.test(s)) throw new HttpError(400, 'bad_phone', 'מספר טלפון לא תקין. למשל 050-1234567');
  return s;
}

function allowedCountry(env, phone) {
  const list = String(env.PHONE_COUNTRIES || '').split(',').map(x => x.trim()).filter(Boolean);
  return !list.length || list.some(p => phone.startsWith(p));
}

// ---------------------------------------------------------------- Firebase ID token

let jwks = null;
async function firebaseKeys() {
  if (jwks && jwks.expires > Date.now()) return jwks.keys;
  const res = await fetch(JWKS);
  if (!res.ok) throw new HttpError(502, 'firebase_unavailable', 'לא הצלחנו לאמת מול Firebase, נסו שוב');
  const maxAge = Number((res.headers.get('cache-control') || '').match(/max-age=(\d+)/)?.[1] || 3600);
  const { keys } = await res.json();
  jwks = { keys, expires: Date.now() + maxAge * 1000 };
  return keys;
}

/** Verifies a Firebase ID token and returns its claims. The token must be a fresh phone sign-in for our project. */
export async function verifyFirebaseIdToken(env, token) {
  const bad = (m = 'האימות לא תקין, נסו שוב') => new HttpError(400, 'invalid_token', m);
  const project = env.FIREBASE_PROJECT_ID;
  if (!project) throw new HttpError(501, 'not_configured', 'אימות הטלפון עוד לא הוגדר');
  const parts = String(token || '').split('.');
  if (parts.length !== 3) throw bad();
  const [h, p, s] = parts;
  let header, claims;
  try {
    header = JSON.parse(new TextDecoder().decode(b64urlDecode(h)));
    claims = JSON.parse(new TextDecoder().decode(b64urlDecode(p)));
  } catch { throw bad(); }
  const jwk = (await firebaseKeys()).find(k => k.kid === header.kid);
  if (!jwk || header.alg !== 'RS256') throw bad();
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  if (!(await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64urlDecode(s), utf8(`${h}.${p}`)))) throw bad();

  const t = now();
  if (claims.iss !== `https://securetoken.google.com/${project}` || claims.aud !== project) throw bad('האימות לא שייך למערכת הזו');
  if (!claims.sub || claims.exp < t - 30 || claims.iat > t + 60) throw bad('פג תוקף האימות, נסו שוב');
  if (!claims.auth_time || claims.auth_time > t + 60 || t - claims.auth_time > 600) throw bad('האימות ישן מדי, שלחו קוד חדש');
  if (claims.firebase?.sign_in_provider !== 'phone' || !claims.phone_number) throw bad('זה לא אימות טלפון');
  return claims;
}

// ---------------------------------------------------------------- the user's own calls

const SMS_PER_HOUR = 5;
const SMS_PER_DAY = 10;

// Is this user over their limit of SMS? (Only looks: the count goes up in sent(), when an SMS really went out.)
async function smsAllowed(env, userId) {
  for (const [key, limit, window] of [[`phone-sms:${userId}`, SMS_PER_HOUR, 3600], [`phone-sms-day:${userId}`, SMS_PER_DAY, 86400]]) {
    const row = await env.DB.prepare('SELECT count, window_start FROM rate_limits WHERE key = ?').bind(key).first();
    if (row && row.window_start + window > now() && row.count >= limit) {
      throw new HttpError(429, 'rate_limited', 'שלחנו כבר כמה קודים. נסו שוב בעוד זמן מה, או פנו אלינו: support@reembir.com');
    }
  }
}

/** POST /api/phone/start { phone } — before the browser asks Firebase to send an SMS: the number is checked. Nothing is counted yet. */
export async function start(request, env, h) {
  const user = await h.requirePortalUser(request, env);
  if (!firebaseConfig(env)) throw new HttpError(501, 'not_configured', 'אימות הטלפון עוד לא הוגדר');
  const phone = normalizePhone((await readJson(request)).phone);
  if (!allowedCountry(env, phone)) throw new HttpError(400, 'country', 'אפשר לאמת רק מספרים ' + String(env.PHONE_COUNTRIES).split(',').join(' / '));
  await smsAllowed(env, user.id);
  const taken = await env.DB.prepare('SELECT 1 FROM users WHERE phone = ? AND phone_verified_at IS NOT NULL AND id != ?').bind(phone, user.id).first();
  if (taken) throw new HttpError(409, 'phone_taken', 'המספר הזה כבר משויך לחשבון אחר. אם זה שלכם, פנו אלינו: support@reembir.com');
  return json({ phone });
}

/** POST /api/phone/sent — the browser says Firebase sent an SMS. Each SMS costs money, so a few an hour and a day's limit. */
export async function sent(request, env, h) {
  const user = await h.requirePortalUser(request, env);
  await smsAllowed(env, user.id);
  await rateLimit(env, `phone-sms:${user.id}`, SMS_PER_HOUR, 3600);
  await rateLimit(env, `phone-sms-day:${user.id}`, SMS_PER_DAY, 86400);
  return json({ ok: true });
}

/** POST /api/phone/verify { id_token } — Firebase's proof; the number is saved as the user's. */
export async function verify(request, env, h) {
  const user = await h.requirePortalUser(request, env);
  await rateLimit(env, `phone-verify:${user.id}`, 15, 3600);
  const claims = await verifyFirebaseIdToken(env, (await readJson(request)).id_token);
  const phone = normalizePhone(claims.phone_number);
  if (!allowedCountry(env, phone)) throw new HttpError(400, 'country', 'המדינה של המספר הזה לא נתמכת');
  const taken = await env.DB.prepare('SELECT 1 FROM users WHERE phone = ? AND id != ?').bind(phone, user.id).first();
  if (taken) throw new HttpError(409, 'phone_taken', 'המספר הזה כבר משויך לחשבון אחר. אם זה שלכם, פנו אלינו: support@reembir.com');
  try {
    await env.DB.prepare('UPDATE users SET phone = ?, phone_verified_at = ?, phone_due = NULL WHERE id = ?').bind(phone, now(), user.id).run();
  } catch (e) {
    if (/unique/i.test(String(e?.message || e))) throw new HttpError(409, 'phone_taken', 'המספר הזה כבר משויך לחשבון אחר');
    throw e;
  }
  const fresh = await h.getUserById(env, user.id);
  return json({ phone: stateOf(fresh, await getPolicy(env), h.isAdmin(env, fresh)) });
}

// ---------------------------------------------------------------- WhatsApp: the person writes to us

const WA_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I
const WA_TTL = 15 * 60;

/** POST /api/phone/wa/start — a code for this user, and the wa.me link that opens a chat with it already typed. */
export async function waStart(request, env, h) {
  const user = await h.requirePortalUser(request, env);
  if (!waConfigured(env)) throw new HttpError(501, 'not_configured', 'אימות בוואטסאפ עוד לא הוגדר');
  await ensureSchema(env);
  await rateLimit(env, `phone-wa:${user.id}`, 10, 3600);
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  const code = [...bytes].map(b => WA_ALPHABET[b % WA_ALPHABET.length]).join('');
  await env.DB.prepare('DELETE FROM phone_wa_codes WHERE user_id = ? OR expires_at < ?').bind(user.id, now()).run();
  await env.DB.prepare('INSERT INTO phone_wa_codes (code, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').bind(code, user.id, now(), now() + WA_TTL).run();
  const text = `אימות ${code}`;
  return json({ code, text, number: waNumber(env), link: `https://wa.me/${waNumber(env)}?text=${encodeURIComponent(text)}`, expires_in: WA_TTL });
}

/** POST /api/phone/wa/status { code } — the login page asks while the person is in WhatsApp. */
export async function waStatus(request, env, h) {
  const user = await h.requirePortalUser(request, env);
  await ensureSchema(env);
  const code = String((await readJson(request)).code || '').toUpperCase();
  const row = await env.DB.prepare('SELECT done, error, expires_at FROM phone_wa_codes WHERE code = ? AND user_id = ?').bind(code, user.id).first();
  if (row && row.done) {
    const fresh = await h.getUserById(env, user.id);
    return json({ status: 'done', phone: stateOf(fresh, await getPolicy(env), h.isAdmin(env, fresh)) });
  }
  if (row && row.error) return json({ status: 'error', message: row.error });
  if (!row || row.expires_at < now()) return json({ status: 'expired' });
  return json({ status: 'waiting' });
}

/**
 * A WhatsApp message arrived (already signed by Meta). If it carries one of our codes, the sender's number — which
 * WhatsApp itself vouches for — becomes the verified phone of the user the code belongs to.
 * Returns the text to answer with, or null when the message isn't ours.
 */
export async function waIncoming(env, from, text) {
  if (!waConfigured(env)) return null;
  await ensureSchema(env);
  const m = String(text || '').toUpperCase().match(new RegExp(`\\b([${WA_ALPHABET}]{6})\\b`));
  if (!m) return null;
  const row = await env.DB.prepare('SELECT user_id, done, expires_at FROM phone_wa_codes WHERE code = ?').bind(m[1]).first();
  if (!row || row.done || row.expires_at < now()) return 'הקוד לא תקף או שפג תוקפו. חזרו לאתר ובקשו קישור חדש.';
  const fail = async (error, reply) => {
    await env.DB.prepare('UPDATE phone_wa_codes SET error = ? WHERE code = ?').bind(error, m[1]).run();
    return reply;
  };
  let phone;
  try { phone = normalizePhone('+' + String(from).replace(/\D/g, '')); } catch { return fail('מספר לא תקין', 'לא הצלחנו לאמת את המספר.'); }
  if (!allowedCountry(env, phone)) return fail('המדינה של המספר הזה לא נתמכת', 'המדינה של המספר הזה לא נתמכת.');
  const taken = await env.DB.prepare('SELECT 1 FROM users WHERE phone = ? AND id != ?').bind(phone, row.user_id).first();
  if (taken) return fail('המספר הזה כבר משויך לחשבון אחר. אם זה שלכם, פנו אלינו: support@reembir.com', 'המספר הזה כבר משויך לחשבון אחר. פנו אלינו: support@reembir.com');
  try {
    await env.DB.prepare('UPDATE users SET phone = ?, phone_verified_at = ?, phone_due = NULL WHERE id = ?').bind(phone, now(), row.user_id).run();
  } catch (e) {
    if (/unique/i.test(String(e?.message || e))) return fail('המספר הזה כבר משויך לחשבון אחר', 'המספר הזה כבר משויך לחשבון אחר.');
    throw e;
  }
  await env.DB.prepare('UPDATE phone_wa_codes SET done = 1 WHERE code = ?').bind(m[1]).run();
  return 'המספר אומת ✓ אפשר לחזור לדפדפן, והמשך ייפתח אוטומטית. אם לא, היכנסו שוב: https://login.reembir.com/';
}

// ---------------------------------------------------------------- the dashboard

async function allUsers(env) {
  const { results } = await env.DB.prepare('SELECT id, email, name, role, email_verified, phone, phone_verified_at, phone_skip, phone_due, created_at, disabled FROM users').all();
  return results;
}

export async function counts(env, h) {
  const policy = await getPolicy(env);
  const out = { verified: 0, waiting: 0, overdue: 0, skipped: 0, exempt: 0, total: 0 };
  for (const u of await allUsers(env)) {
    out.total++;
    const admin = h.isAdmin(env, u);
    // before it is switched on there is no clock: everyone who isn't verified is simply "waiting"
    const label = policy.on ? labelOf(stateOf(u, policy, admin))
      : (u.phone && u.phone_verified_at) ? 'verified' : u.phone_skip ? 'skipped' : admin ? 'exempt' : 'waiting';
    if (label === 'verified') out.verified++;
    else if (label === 'skipped') out.skipped++;
    else if (label === 'exempt') out.exempt++;
    else if (label === 'overdue') out.overdue++;
    else out.waiting++;
  }
  return out;
}

async function view(env, h) {
  const policy = await getPolicy(env);
  return {
    configured: !!(firebaseConfig(env) || waConfigured(env)), sms: !!firebaseConfig(env), whatsapp: waConfigured(env), project: env.FIREBASE_PROJECT_ID || null,
    on: policy.on, wanted: policy.wanted, since: policy.since || null, grace_days: policy.grace_days,
    countries: String(env.PHONE_COUNTRIES || '').split(',').map(x => x.trim()).filter(Boolean),
    counts: await counts(env, h),
  };
}

export async function adminGet(request, env, h) {
  await h.requireAdmin(request, env);
  return json({ phone: await view(env, h) });
}

/** PUT { on, grace_days } — switching it on starts the clock for everyone who is not verified. */
export async function adminSave(request, env, h) {
  await h.requireAdmin(request, env);
  const body = await readJson(request);
  const grace = Math.floor(Number(body.grace_days));
  if (!(grace >= 0 && grace <= 60)) throw new HttpError(400, 'bad_days', 'מספר הימים: 0 עד 60');
  if (body.on && !firebaseConfig(env) && !waConfigured(env)) throw new HttpError(400, 'not_configured', 'צריך קודם להגדיר דרך אימות: Firebase (FIREBASE_API_KEY ו-FIREBASE_PROJECT_ID) או וואטסאפ (WHATSAPP_NUMBER ו-WHATSAPP_APP_SECRET)');
  await ensureSchema(env);
  const prev = await getPolicy(env);
  const wasOn = prev.on;
  const value = { on: !!body.on, grace_days: grace, since: body.on ? (wasOn ? prev.since : now()) : prev.since };
  await env.DB.prepare(
    `INSERT INTO system_settings (key, value, updated_at) VALUES ('phone_policy', ?1, ?2)
     ON CONFLICT(key) DO UPDATE SET value = ?1, updated_at = ?2`,
  ).bind(JSON.stringify(value), now()).run();
  cache = { at: 0, value: null };
  return json({ phone: await view(env, h) });
}

/** POST /api/admin/users/:id/phone { action: skip | unskip | reset | extend, days? } */
export async function adminUserAction(request, env, h, userId) {
  await h.requireAdmin(request, env);
  const user = await h.getUserById(env, userId);
  if (!user) throw new HttpError(404, 'not_found', 'המשתמש לא נמצא');
  const body = await readJson(request);
  const policy = await getPolicy(env);
  const days = Number.isFinite(Number(body.days)) && body.days !== '' && body.days !== null ? Math.floor(Number(body.days)) : policy.grace_days;
  if (!(days >= 0 && days <= 365)) throw new HttpError(400, 'bad_days', 'מספר הימים: 0 עד 365');
  const t = now();
  switch (body.action) {
    case 'skip': await env.DB.prepare('UPDATE users SET phone_skip = 1 WHERE id = ?').bind(userId).run(); break;
    case 'unskip': await env.DB.prepare('UPDATE users SET phone_skip = 0 WHERE id = ?').bind(userId).run(); break;
    // start over: the number is released and the user gets a new period (0 days = at once)
    case 'reset':
      await env.DB.prepare('UPDATE users SET phone = NULL, phone_verified_at = NULL, phone_skip = 0, phone_due = ? WHERE id = ?').bind(t + days * DAY, userId).run();
      break;
    case 'extend': await env.DB.prepare('UPDATE users SET phone_due = ? WHERE id = ?').bind(t + days * DAY, userId).run(); break;
    default: throw new HttpError(400, 'bad_action', 'פעולה לא מוכרת');
  }
  const fresh = await h.getUserById(env, userId);
  return json({ phone: userPhone(fresh, policy, h.isAdmin(env, fresh)) });
}

/** The user as the admin sees it: the number in full, and where they stand. */
export function userPhone(user, policy, admin) {
  const s = stateOf(user, policy, admin);
  return { ...s, number: user.phone || null, label: labelOf(s), skipped: !!user.phone_skip, custom_due: !!user.phone_due };
}

/** The people a reminder goes to: required to verify and not yet. */
export async function reminderRecipients(env, h) {
  const policy = await getPolicy(env);
  if (!policy.on) return [];
  return (await allUsers(env))
    .filter(u => !u.disabled && stateOf(u, policy, h.isAdmin(env, u)).required)
    .map(u => ({ email: u.email, name: u.name || '' }));
}
