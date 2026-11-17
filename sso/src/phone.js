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

let schemaReady = false;
async function ensureSchema(env) {
  if (schemaReady) return;
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
  const policy = { on: !!(v && v.on) && !!firebaseConfig(env), since: (v && v.since) || 0, grace_days: v && Number.isFinite(v.grace_days) ? v.grace_days : GRACE_DEFAULT, wanted: !!(v && v.on) };
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

/** POST /api/phone/start { phone } — before the browser asks Firebase to send an SMS. Limits what one user can spend. */
export async function start(request, env, h) {
  const user = await h.requirePortalUser(request, env);
  if (!firebaseConfig(env)) throw new HttpError(501, 'not_configured', 'אימות הטלפון עוד לא הוגדר');
  const phone = normalizePhone((await readJson(request)).phone);
  if (!allowedCountry(env, phone)) throw new HttpError(400, 'country', 'אפשר לאמת רק מספרים ' + String(env.PHONE_COUNTRIES).split(',').join(' / '));
  // each SMS to Israel costs money: a few tries an hour, and a day's limit
  await rateLimit(env, `phone-start:${user.id}`, 5, 3600);
  await rateLimit(env, `phone-start-day:${user.id}`, 10, 86400);
  const taken = await env.DB.prepare('SELECT 1 FROM users WHERE phone = ? AND phone_verified_at IS NOT NULL AND id != ?').bind(phone, user.id).first();
  if (taken) throw new HttpError(409, 'phone_taken', 'המספר הזה כבר משויך לחשבון אחר. אם זה שלכם, פנו אלינו: support@reembir.com');
  return json({ phone });
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
    configured: !!firebaseConfig(env), project: env.FIREBASE_PROJECT_ID || null,
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
  if (body.on && !firebaseConfig(env)) throw new HttpError(400, 'not_configured', 'צריך קודם להגדיר את Firebase (המשתנים FIREBASE_API_KEY ו-FIREBASE_PROJECT_ID)');
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
