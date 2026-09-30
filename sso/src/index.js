// reem.bi SSO — one login for every project.
// Runs on Cloudflare Workers + D1 at https://login.reembir.com
//
//   /                 login / account page (static, ./public)
//   /admin            admin dashboard (static, ./public)
//   /sdk.js           the script every site includes
//   /api/...          this worker
//
// Sites use an OAuth-style "authorization code + PKCE" flow: they redirect to
// login.reembir.com, get a one-time code back, and exchange it for a bearer token.

import {
  HttpError, json, readJson, now, randomToken, sha256, b64url, utf8,
  hashPassword, verifyPassword, validatePassword, normalizeEmail, cleanName, parseJsonField,
  getCookie, sessionCookie, SESSION_COOKIE, rateLimit, clientIp,
} from './lib.js';
import { verifyGoogleIdToken, firebaseCustomToken } from './jwt.js';
import { sendTemplate, sendCustomBatch, renderCustomEmail } from './mail.js';
import * as passkeys from './passkeys.js';
import * as pay from './pay.js';

const PORTAL_SESSION_TTL = 60 * 60 * 24 * 30; // 30 days
const SITE_SESSION_TTL = 60 * 60 * 24 * 30;
const CODE_TTL = 5 * 60;
const TOKEN_TTL = { magic: 15 * 60, reset: 60 * 60, verify: 60 * 60 * 24 * 3 };

// ======================================================================
// Users & sessions
// ======================================================================

function adminEmails(env) {
  return String(env.ADMIN_EMAILS || '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
}

function isAdmin(env, user) {
  return !!user && (user.role === 'admin' || (!!user.email_verified && adminEmails(env).includes(user.email)));
}

function publicUser(env, u) {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    avatar: u.avatar,
    email_verified: !!u.email_verified,
    has_password: !!u.password_hash,
    google: !!u.google_sub,
    is_admin: isAdmin(env, u),
    created_at: u.created_at,
  };
}

const getUserById = (env, id) => env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(id).first();
const getUserByEmail = (env, email) => env.DB.prepare('SELECT * FROM users WHERE email = ?').bind(email).first();

async function createUser(env, { email, name = '', avatar = '', password_hash = null, google_sub = null, email_verified = 0 }) {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO users (id, email, name, avatar, password_hash, google_sub, email_verified, role, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'user', ?)`,
  ).bind(id, email, cleanName(name, email), avatar, password_hash, google_sub, email_verified ? 1 : 0, now()).run();
  return getUserById(env, id);
}

// The mailbox owner just proved they control this address (Google / magic link / verify link).
// If the account was never verified, any password on it was set by someone who did NOT prove
// ownership — drop it so a pre-registered account can't be hijacked.
async function markVerified(env, user) {
  if (user.email_verified) return user;
  await env.DB.prepare('UPDATE users SET email_verified = 1, password_hash = NULL WHERE id = ?').bind(user.id).run();
  return getUserById(env, user.id);
}

async function createSession(env, request, userId, clientId, ttl) {
  const token = randomToken();
  const t = now();
  await env.DB.prepare(
    'INSERT INTO sessions (id, user_id, client_id, created_at, expires_at, user_agent) VALUES (?, ?, ?, ?, ?, ?)',
  ).bind(await sha256(token), userId, clientId, t, t + ttl, (request.headers.get('user-agent') || '').slice(0, 200)).run();
  return token;
}

async function sessionFromToken(env, token, clientId) {
  if (!token) return null;
  const row = await env.DB.prepare(
    `SELECT s.id AS session_id, s.client_id, s.expires_at AS session_expires, u.*
     FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ?`,
  ).bind(await sha256(token)).first();
  if (!row || row.session_expires < now()) return null;
  if (clientId === null ? row.client_id !== null : row.client_id === null) return null;
  if (row.disabled) return null;
  return row;
}

async function portalUser(request, env) {
  return sessionFromToken(env, getCookie(request, SESSION_COOKIE), null);
}

async function requirePortalUser(request, env) {
  const user = await portalUser(request, env);
  if (!user) throw new HttpError(401, 'not_logged_in', 'צריך להתחבר');
  return user;
}

async function requireAdmin(request, env) {
  const user = await requirePortalUser(request, env);
  if (!isAdmin(env, user)) throw new HttpError(403, 'forbidden', 'אין הרשאת מנהל');
  return user;
}

async function requireSiteSession(request, env) {
  const auth = request.headers.get('authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  const session = await sessionFromToken(env, token, undefined);
  if (!session || session.client_id === null) throw new HttpError(401, 'invalid_token', 'ההתחברות פגה, התחברו מחדש');
  return session;
}

// Finish any successful sign-in on login.reembir.com: open a portal session (cookie).
async function completeLogin(request, env, user, extra = {}) {
  if (user.disabled) throw new HttpError(403, 'account_disabled', 'החשבון הזה הושבת. לעזרה: support@reembir.com');
  if (user.email_verified && adminEmails(env).includes(user.email) && user.role !== 'admin') {
    await env.DB.prepare("UPDATE users SET role = 'admin' WHERE id = ?").bind(user.id).run();
    user = { ...user, role: 'admin' };
  }
  await env.DB.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').bind(now(), user.id).run();
  const token = await createSession(env, request, user.id, null, PORTAL_SESSION_TTL);
  return json({ user: publicUser(env, user), ...extra }, 200, { 'set-cookie': sessionCookie(request, token, PORTAL_SESSION_TTL) });
}

// ======================================================================
// Sites, plans & access
// ======================================================================

async function getSite(env, id) {
  const site = await env.DB.prepare('SELECT * FROM sites WHERE id = ?').bind(String(id || '')).first();
  if (!site) return null;
  return { ...site, redirect_uris: parseJsonField(site.redirect_uris, []) };
}

function redirectAllowed(site, redirectUri) {
  let url;
  try {
    url = new URL(redirectUri);
  } catch {
    return false;
  }
  const clean = url.origin + url.pathname;
  return site.redirect_uris.some(prefix => clean === prefix || (prefix.endsWith('/') && clean.startsWith(prefix)));
}

let originCache = { at: 0, origins: new Set() };
async function allowedOrigins(env) {
  if (Date.now() - originCache.at < 60000) return originCache.origins;
  const { results } = await env.DB.prepare('SELECT redirect_uris FROM sites').all();
  const origins = new Set();
  for (const r of results) {
    for (const u of parseJsonField(r.redirect_uris, [])) {
      try { origins.add(new URL(u).origin); } catch { /* ignore */ }
    }
  }
  originCache = { at: Date.now(), origins };
  return origins;
}

async function getPlan(env, id) {
  if (!id) return null;
  const plan = await env.DB.prepare('SELECT * FROM plans WHERE id = ?').bind(id).first();
  return plan ? { ...plan, features: parseJsonField(plan.features, {}) } : null;
}

/**
 * Works out what a user may do on a site. With create=true, a first visit to an 'open' site
 * grants access automatically and a visit to an 'approval' site files a pending request.
 */
async function resolveAccess(env, user, site, { create = true } = {}) {
  let row = await env.DB.prepare('SELECT * FROM access WHERE user_id = ? AND site_id = ?').bind(user.id, site.id).first();

  if (!row && create && site.access_mode !== 'invite') {
    const status = site.access_mode === 'open' || isAdmin(env, user) ? 'active' : 'pending';
    await env.DB.prepare(
      'INSERT OR IGNORE INTO access (user_id, site_id, status, created_at) VALUES (?, ?, ?, ?)',
    ).bind(user.id, site.id, status, now()).run();
    row = await env.DB.prepare('SELECT * FROM access WHERE user_id = ? AND site_id = ?').bind(user.id, site.id).first();
  }

  let status = row ? row.status : 'none';
  if (isAdmin(env, user) && status !== 'blocked') status = 'active';

  const planExpired = !!(row && row.plan_id && row.plan_expires_at && row.plan_expires_at < now());
  const planId = row && row.plan_id && !planExpired ? row.plan_id : site.default_plan;
  const plan = await getPlan(env, planId);

  return {
    status,
    plan: plan ? { id: plan.id, name: plan.name } : null,
    plan_expires_at: row && row.plan_id && !planExpired ? row.plan_expires_at : null,
    plan_expired: planExpired,
    features: { ...(plan ? plan.features : {}), ...parseJsonField(row && row.features_override, {}) },
  };
}

// ======================================================================
// Email tokens (magic link / reset / verify)
// ======================================================================

function safeNext(next) {
  return typeof next === 'string' && next.startsWith('?') && next.length < 2000 ? next : '';
}

async function issueEmailToken(env, request, type, email, data = {}) {
  const token = randomToken();
  await env.DB.prepare('INSERT INTO email_tokens (id, type, email, data, expires_at) VALUES (?, ?, ?, ?, ?)')
    .bind(await sha256(token), type, email, JSON.stringify(data), now() + TOKEN_TTL[type]).run();
  const base = env.PUBLIC_URL || new URL(request.url).origin;
  const link = `${base}/?${type}=${encodeURIComponent(token)}`;
  await sendTemplate(env, email, type, link);
  return env.DEV === '1' ? { dev_link: link } : {};
}

async function consumeEmailToken(env, type, token) {
  const id = await sha256(String(token || ''));
  const row = await env.DB.prepare('SELECT * FROM email_tokens WHERE id = ? AND type = ?').bind(id, type).first();
  if (!row || row.used_at || row.expires_at < now()) {
    throw new HttpError(400, 'invalid_link', 'הקישור לא תקין או שפג תוקפו. בקשו קישור חדש.');
  }
  // Mark used atomically so the same link can't be replayed in parallel.
  const res = await env.DB.prepare('UPDATE email_tokens SET used_at = ? WHERE id = ? AND used_at IS NULL').bind(now(), id).run();
  if (!res.meta.changes) throw new HttpError(400, 'invalid_link', 'הקישור כבר נוצל.');
  return { email: row.email, data: parseJsonField(row.data, {}) };
}

// ======================================================================
// Handlers — sign in on login.reembir.com
// ======================================================================

async function register(request, env) {
  const body = await readJson(request);
  const email = normalizeEmail(body.email);
  validatePassword(body.password);
  await rateLimit(env, `register:${clientIp(request)}`, 10, 3600);
  if (await getUserByEmail(env, email)) {
    throw new HttpError(409, 'email_exists', 'כבר קיים חשבון עם המייל הזה — התחברו או אפסו סיסמה');
  }
  const user = await createUser(env, { email, name: body.name, password_hash: await hashPassword(body.password) });
  const extra = await issueEmailToken(env, request, 'verify', email, { next: safeNext(body.next) });
  return completeLogin(request, env, user, extra);
}

async function passwordLogin(request, env) {
  const body = await readJson(request);
  const email = normalizeEmail(body.email);
  await rateLimit(env, `login:${email}`, 10, 900);
  await rateLimit(env, `login-ip:${clientIp(request)}`, 30, 900);
  const user = await getUserByEmail(env, email);
  if (!user || !(await verifyPassword(String(body.password || ''), user.password_hash))) {
    throw new HttpError(401, 'bad_credentials', 'מייל או סיסמה שגויים');
  }
  return completeLogin(request, env, user);
}

async function googleLogin(request, env) {
  const body = await readJson(request);
  const claims = await verifyGoogleIdToken(body.credential, env.GOOGLE_CLIENT_ID);
  const email = normalizeEmail(claims.email);

  let user = await env.DB.prepare('SELECT * FROM users WHERE google_sub = ?').bind(claims.sub).first();
  if (!user) {
    user = await getUserByEmail(env, email);
    if (user) {
      user = await markVerified(env, user);
      await env.DB.prepare("UPDATE users SET google_sub = ?, avatar = CASE WHEN avatar = '' THEN ? ELSE avatar END WHERE id = ?")
        .bind(claims.sub, claims.picture || '', user.id).run();
      user = await getUserById(env, user.id);
    } else {
      user = await createUser(env, { email, name: claims.name, avatar: claims.picture || '', google_sub: claims.sub, email_verified: 1 });
    }
  }
  return completeLogin(request, env, user);
}

async function sendMagicLink(request, env) {
  const body = await readJson(request);
  const email = normalizeEmail(body.email);
  await rateLimit(env, `magic:${email}`, 5, 3600);
  await rateLimit(env, `mail-ip:${clientIp(request)}`, 20, 3600);
  const user = await getUserByEmail(env, email);
  if (user && user.disabled) throw new HttpError(403, 'account_disabled', 'החשבון הזה הושבת. לעזרה: support@reembir.com');
  const extra = await issueEmailToken(env, request, 'magic', email, { next: safeNext(body.next) });
  return json({ ok: true, ...extra });
}

async function verifyMagicLink(request, env) {
  const body = await readJson(request);
  const { email, data } = await consumeEmailToken(env, 'magic', body.token);
  let user = await getUserByEmail(env, email);
  user = user ? await markVerified(env, user) : await createUser(env, { email, email_verified: 1 });
  return completeLogin(request, env, user, { next: data.next || '' });
}

async function verifyEmail(request, env) {
  const body = await readJson(request);
  const { email, data } = await consumeEmailToken(env, 'verify', body.token);
  const user = await getUserByEmail(env, email);
  if (!user) throw new HttpError(400, 'invalid_link', 'החשבון לא נמצא');
  await env.DB.prepare('UPDATE users SET email_verified = 1 WHERE id = ?').bind(user.id).run();
  return completeLogin(request, env, { ...user, email_verified: 1 }, { next: data.next || '' });
}

async function resendVerification(request, env) {
  const user = await requirePortalUser(request, env);
  if (user.email_verified) return json({ ok: true });
  const body = await readJson(request);
  await rateLimit(env, `verify:${user.email}`, 3, 3600);
  const extra = await issueEmailToken(env, request, 'verify', user.email, { next: safeNext(body.next) });
  return json({ ok: true, ...extra });
}

async function forgotPassword(request, env) {
  const body = await readJson(request);
  const email = normalizeEmail(body.email);
  await rateLimit(env, `reset:${email}`, 3, 3600);
  await rateLimit(env, `mail-ip:${clientIp(request)}`, 20, 3600);
  const user = await getUserByEmail(env, email);
  // Always answer the same way so this can't be used to discover who has an account.
  const extra = user && !user.disabled ? await issueEmailToken(env, request, 'reset', email, { next: safeNext(body.next) }) : {};
  return json({ ok: true, ...extra });
}

async function resetPassword(request, env) {
  const body = await readJson(request);
  validatePassword(body.password);
  const { email, data } = await consumeEmailToken(env, 'reset', body.token);
  const user = await getUserByEmail(env, email);
  if (!user) throw new HttpError(400, 'invalid_link', 'החשבון לא נמצא');
  await env.DB.batch([
    env.DB.prepare('UPDATE users SET password_hash = ?, email_verified = 1 WHERE id = ?').bind(await hashPassword(body.password), user.id),
    env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(user.id),
  ]);
  return completeLogin(request, env, { ...user, email_verified: 1 }, { next: data.next || '' });
}

async function logout(request, env) {
  const body = await readJson(request);
  const user = await portalUser(request, env);
  if (user) {
    if (body.all) await env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(user.id).run();
    else await env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(user.session_id).run();
  }
  return json({ ok: true }, 200, { 'set-cookie': sessionCookie(request, '', 0) });
}

// ======================================================================
// Handlers — account page
// ======================================================================

async function me(request, env) {
  const user = await requirePortalUser(request, env);
  const { results } = await env.DB.prepare(
    `SELECT a.site_id, a.status, s.name, s.url FROM access a JOIN sites s ON s.id = a.site_id
     WHERE a.user_id = ? ORDER BY a.last_used_at DESC, a.created_at DESC`,
  ).bind(user.id).all();
  const sites = [];
  for (const r of results) {
    const site = await getSite(env, r.site_id);
    const access = await resolveAccess(env, user, site, { create: false });
    sites.push({ id: r.site_id, name: r.name, url: r.url, status: access.status, plan: access.plan, plan_expires_at: access.plan_expires_at });
  }
  return json({ user: publicUser(env, user), sites });
}

async function updateProfile(request, env) {
  const user = await requirePortalUser(request, env);
  const body = await readJson(request);
  const name = cleanName(body.name, user.email);
  await env.DB.prepare('UPDATE users SET name = ? WHERE id = ?').bind(name, user.id).run();
  return json({ user: publicUser(env, { ...user, name }) });
}

async function changePassword(request, env) {
  const user = await requirePortalUser(request, env);
  const body = await readJson(request);
  validatePassword(body.password);
  if (user.password_hash) {
    await rateLimit(env, `login:${user.email}`, 10, 900);
    if (!(await verifyPassword(String(body.current || ''), user.password_hash))) {
      throw new HttpError(401, 'bad_credentials', 'הסיסמה הנוכחית שגויה');
    }
  }
  await env.DB.batch([
    env.DB.prepare('UPDATE users SET password_hash = ? WHERE id = ?').bind(await hashPassword(body.password), user.id),
    env.DB.prepare('DELETE FROM sessions WHERE user_id = ? AND id != ?').bind(user.id, user.session_id),
  ]);
  return json({ ok: true });
}

// Link / unlink a Google account to the signed-in account (from the account page).
async function linkGoogle(request, env) {
  const user = await requirePortalUser(request, env);
  const body = await readJson(request);
  const claims = await verifyGoogleIdToken(body.credential, env.GOOGLE_CLIENT_ID);
  const other = await env.DB.prepare('SELECT id, email FROM users WHERE google_sub = ? AND id != ?').bind(claims.sub, user.id).first();
  if (other) {
    throw new HttpError(409, 'google_in_use', 'חשבון ה-Google הזה כבר מקושר לחשבון reem.bi אחר');
  }
  const sameEmail = normalizeEmail(claims.email) === user.email;
  await env.DB.prepare(
    `UPDATE users SET google_sub = ?,
       avatar = CASE WHEN avatar = '' THEN ? ELSE avatar END,
       email_verified = CASE WHEN ? THEN 1 ELSE email_verified END
     WHERE id = ?`,
  ).bind(claims.sub, claims.picture || '', sameEmail ? 1 : 0, user.id).run();
  return json({ user: publicUser(env, await getUserById(env, user.id)), google_email: claims.email });
}

async function unlinkGoogle(request, env) {
  const user = await requirePortalUser(request, env);
  await env.DB.prepare('UPDATE users SET google_sub = NULL WHERE id = ?').bind(user.id).run();
  return json({ user: publicUser(env, await getUserById(env, user.id)) });
}

// ======================================================================
// Handlers — authorization flow for sites
// ======================================================================

async function authorizeInfo(request, env) {
  const url = new URL(request.url);
  const site = await getSite(env, url.searchParams.get('client_id'));
  if (!site) throw new HttpError(400, 'unknown_client', 'האתר שביקש את ההתחברות לא מוכר');
  if (!redirectAllowed(site, url.searchParams.get('redirect_uri'))) {
    throw new HttpError(400, 'bad_redirect', 'כתובת החזרה לא מאושרת עבור האתר הזה');
  }
  const user = await portalUser(request, env);
  let hasAccess = false;
  if (user) {
    const row = await env.DB.prepare('SELECT status FROM access WHERE user_id = ? AND site_id = ?').bind(user.id, site.id).first();
    hasAccess = !!row && row.status === 'active';
  }
  return json({ site: { id: site.id, name: site.name, url: site.url, description: site.description, access_mode: site.access_mode }, has_access: hasAccess });
}

async function authorize(request, env) {
  const user = await requirePortalUser(request, env);
  const body = await readJson(request);
  const site = await getSite(env, body.client_id);
  if (!site) throw new HttpError(400, 'unknown_client', 'האתר שביקש את ההתחברות לא מוכר');
  if (!redirectAllowed(site, body.redirect_uri)) throw new HttpError(400, 'bad_redirect', 'כתובת החזרה לא מאושרת');
  if (body.code_challenge_method !== 'S256' || !/^[A-Za-z0-9_-]{43}$/.test(body.code_challenge || '')) {
    throw new HttpError(400, 'bad_pkce', 'בקשה לא תקינה');
  }
  if (!user.email_verified) return json({ status: 'verify_required' });

  const access = await resolveAccess(env, user, site);
  if (access.status === 'pending') return json({ status: 'pending', site: site.name });
  if (access.status !== 'active') return json({ status: 'denied', site: site.name });

  const code = randomToken();
  await env.DB.prepare(
    'INSERT INTO auth_codes (id, user_id, client_id, redirect_uri, code_challenge, expires_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).bind(await sha256(code), user.id, site.id, body.redirect_uri, body.code_challenge, now() + CODE_TTL).run();
  return json({ status: 'ok', code });
}

async function siteUserPayload(env, user, site) {
  const access = await resolveAccess(env, user, site);
  return {
    user: { id: user.id, email: user.email, name: user.name, avatar: user.avatar, email_verified: !!user.email_verified },
    access,
  };
}

async function exchangeCode(request, env) {
  const body = await readJson(request);
  const id = await sha256(String(body.code || ''));
  const row = await env.DB.prepare('SELECT * FROM auth_codes WHERE id = ?').bind(id).first();
  await env.DB.prepare('DELETE FROM auth_codes WHERE id = ? OR expires_at < ?').bind(id, now()).run();
  if (!row || row.expires_at < now() || row.client_id !== body.client_id || row.redirect_uri !== body.redirect_uri) {
    throw new HttpError(400, 'invalid_grant', 'קוד ההתחברות לא תקין או שפג תוקפו');
  }
  const challenge = b64url(await crypto.subtle.digest('SHA-256', utf8(String(body.code_verifier || ''))));
  if (challenge !== row.code_challenge) throw new HttpError(400, 'invalid_grant', 'אימות PKCE נכשל');

  const user = await getUserById(env, row.user_id);
  const site = await getSite(env, row.client_id);
  if (!user || user.disabled || !site) throw new HttpError(400, 'invalid_grant', 'החשבון לא זמין');

  const payload = await siteUserPayload(env, user, site);
  if (payload.access.status !== 'active') throw new HttpError(403, 'no_access', 'אין לך גישה לאתר הזה');

  const token = await createSession(env, request, user.id, site.id, SITE_SESSION_TTL);
  await env.DB.prepare('UPDATE access SET last_used_at = ? WHERE user_id = ? AND site_id = ?').bind(now(), user.id, site.id).run();
  return json({ access_token: token, token_type: 'Bearer', expires_in: SITE_SESSION_TTL, ...payload });
}

async function userinfo(request, env) {
  const session = await requireSiteSession(request, env);
  const site = await getSite(env, session.client_id);
  if (!site) throw new HttpError(401, 'invalid_token', 'האתר הוסר');
  const payload = await siteUserPayload(env, session, site);
  if (payload.access.status !== 'active') throw new HttpError(403, 'no_access', 'אין לך גישה לאתר הזה');
  await env.DB.prepare('UPDATE access SET last_used_at = ? WHERE user_id = ? AND site_id = ? AND (last_used_at IS NULL OR last_used_at < ?)')
    .bind(now(), session.id, site.id, now() - 3600).run();
  return json(payload);
}

async function revokeToken(request, env) {
  try {
    const session = await requireSiteSession(request, env);
    await env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(session.session_id).run();
  } catch { /* already gone */ }
  return json({ ok: true });
}

async function firebaseToken(request, env) {
  const session = await requireSiteSession(request, env);
  const site = await getSite(env, session.client_id);
  const sa = env[`FIREBASE_SA_${site.id.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`] || env.FIREBASE_SERVICE_ACCOUNT;
  if (!sa) throw new HttpError(501, 'not_configured', 'Firebase לא הוגדר עבור האתר הזה');
  const access = await resolveAccess(env, session, site);
  if (access.status !== 'active') throw new HttpError(403, 'no_access', 'אין לך גישה לאתר הזה');
  const token = await firebaseCustomToken(sa, session.id, {
    sso_email: session.email,
    sso_site: site.id,
    sso_plan: access.plan ? access.plan.id : null,
  });
  return json({ token });
}

// ---------- the members' wall (used by the terminal on reembir.com) ----------

async function listWall(request, env) {
  const session = await requireSiteSession(request, env);
  const { results } = await env.DB.prepare(
    `SELECT w.id, w.message, w.created_at, u.name, u.id = ? AS mine
     FROM wall w JOIN users u ON u.id = w.user_id WHERE w.site_id = ? ORDER BY w.id DESC LIMIT 30`,
  ).bind(session.id, session.client_id).all();
  return json({ messages: results.map(m => ({ ...m, mine: !!m.mine })) });
}

async function postWall(request, env) {
  const session = await requireSiteSession(request, env);
  const body = await readJson(request);
  const message = String(body.message || '').replace(/\s+/g, ' ').trim();
  if (!message) throw new HttpError(400, 'empty', 'ההודעה ריקה');
  if (message.length > 280) throw new HttpError(400, 'too_long', 'עד 280 תווים');
  await rateLimit(env, `wall:${session.id}`, 5, 600);
  await env.DB.prepare('INSERT INTO wall (site_id, user_id, message, created_at) VALUES (?, ?, ?, ?)')
    .bind(session.client_id, session.id, message, now()).run();
  return json({ ok: true });
}

async function deleteOwnWall(request, env, id) {
  const session = await requireSiteSession(request, env);
  await env.DB.prepare('DELETE FROM wall WHERE id = ? AND user_id = ?').bind(Number(id), session.id).run();
  return json({ ok: true });
}

// ======================================================================
// Handlers — admin dashboard
// ======================================================================

async function adminStats(request, env) {
  await requireAdmin(request, env);
  await ensureEmailLog(env);
  const week = now() - 7 * 86400;
  const day = now() - 86400;
  const [users, newUsers, active, unverified, pending, recent, mailed] = await env.DB.batch([
    env.DB.prepare('SELECT COUNT(*) AS n FROM users'),
    env.DB.prepare('SELECT COUNT(*) AS n FROM users WHERE created_at > ?').bind(week),
    env.DB.prepare('SELECT COUNT(*) AS n FROM users WHERE last_login_at > ?').bind(week),
    env.DB.prepare('SELECT COUNT(*) AS n FROM users WHERE email_verified = 0'),
    env.DB.prepare(
      `SELECT a.user_id, a.site_id, a.created_at, u.email, u.name, s.name AS site_name
       FROM access a JOIN users u ON u.id = a.user_id JOIN sites s ON s.id = a.site_id
       WHERE a.status = 'pending' ORDER BY a.created_at`,
    ),
    env.DB.prepare('SELECT id, email, name, avatar, created_at, last_login_at FROM users ORDER BY created_at DESC LIMIT 6'),
    env.DB.prepare("SELECT COALESCE(SUM(count), 0) AS n FROM email_log WHERE created_at > ? AND status = 'sent'").bind(day),
  ]);
  return json({
    users: users.results[0].n,
    new_users: newUsers.results[0].n,
    active_users: active.results[0].n,
    unverified: unverified.results[0].n,
    pending: pending.results,
    recent: recent.results,
    emails_today: mailed.results[0].n,
  });
}

async function adminListUsers(request, env) {
  await requireAdmin(request, env);
  const url = new URL(request.url);
  const q = `%${(url.searchParams.get('q') || '').trim().toLowerCase()}%`;
  const site = url.searchParams.get('site') || '';
  const plan = url.searchParams.get('plan') || '';
  const filter = url.searchParams.get('filter') || '';
  const offset = Math.max(0, Number(url.searchParams.get('offset')) || 0);
  const where = `WHERE (lower(u.email) LIKE ?1 OR lower(u.name) LIKE ?1)
       AND (?2 = '' OR EXISTS (SELECT 1 FROM access a WHERE a.user_id = u.id AND a.site_id = ?2))
       AND (?3 = '' OR EXISTS (SELECT 1 FROM access a WHERE a.user_id = u.id AND a.plan_id = ?3))
       AND (?4 = ''
         OR (?4 = 'admin' AND u.role = 'admin')
         OR (?4 = 'disabled' AND u.disabled = 1)
         OR (?4 = 'unverified' AND u.email_verified = 0)
         OR (?4 = 'pending' AND EXISTS (SELECT 1 FROM access a WHERE a.user_id = u.id AND a.status = 'pending'))
         OR (?4 = 'blocked' AND EXISTS (SELECT 1 FROM access a WHERE a.user_id = u.id AND a.status = 'blocked'))
         OR (?4 = 'paid' AND EXISTS (SELECT 1 FROM access a WHERE a.user_id = u.id AND a.plan_id IS NOT NULL)))`;
  const [list, total] = await env.DB.batch([
    env.DB.prepare(
      `SELECT u.id, u.email, u.name, u.avatar, u.role, u.disabled, u.email_verified, u.created_at, u.last_login_at,
              u.password_hash IS NOT NULL AS has_password, u.google_sub IS NOT NULL AS google,
              (SELECT group_concat(a.site_id || '|' || a.status || '|' || COALESCE(a.plan_id, ''), ',') FROM access a WHERE a.user_id = u.id) AS access
       FROM users u ${where}
       ORDER BY u.created_at DESC LIMIT 50 OFFSET ?5`,
    ).bind(q, site, plan, filter, offset),
    env.DB.prepare(`SELECT COUNT(*) AS n FROM users u ${where}`).bind(q, site, plan, filter),
  ]);
  return json({
    total: total.results[0].n,
    users: list.results.map(u => ({
      ...u,
      has_password: !!u.has_password,
      google: !!u.google,
      is_admin: isAdmin(env, u),
      access: (u.access || '').split(',').filter(Boolean).map(s => {
        const [site_id, status, plan_id] = s.split('|');
        return { site_id, status, plan_id: plan_id || null };
      }),
    })),
  });
}

async function adminGetUser(request, env, id) {
  await requireAdmin(request, env);
  const user = await getUserById(env, id);
  if (!user) throw new HttpError(404, 'not_found', 'המשתמש לא נמצא');
  await passkeys.ensurePasskeySchema(env);
  const [access, sessions, keys] = await env.DB.batch([
    env.DB.prepare('SELECT * FROM access WHERE user_id = ? ORDER BY created_at').bind(id),
    env.DB.prepare('SELECT client_id, COUNT(*) AS n, MAX(created_at) AS last FROM sessions WHERE user_id = ? AND expires_at > ? GROUP BY client_id').bind(id, now()),
    env.DB.prepare('SELECT COUNT(*) AS n FROM passkeys WHERE user_id = ?').bind(id),
  ]);
  return json({
    user: {
      ...publicUser(env, user), role: user.role, disabled: !!user.disabled, notes: user.notes,
      last_login_at: user.last_login_at, passkeys: keys.results[0].n,
    },
    access: access.results.map(a => ({ ...a, features_override: parseJsonField(a.features_override, {}) })),
    sessions: sessions.results,
  });
}

async function adminCreateUser(request, env) {
  await requireAdmin(request, env);
  const body = await readJson(request);
  const email = normalizeEmail(body.email);
  if (await getUserByEmail(env, email)) throw new HttpError(409, 'email_exists', 'כבר קיים משתמש עם המייל הזה');
  const user = await createUser(env, { email, name: body.name });
  let extra = {};
  if (body.send_invite) extra = await issueEmailToken(env, request, 'magic', email, {});
  return json({ user: publicUser(env, user), ...extra });
}

async function adminUpdateUser(request, env, id) {
  const admin = await requireAdmin(request, env);
  const user = await getUserById(env, id);
  if (!user) throw new HttpError(404, 'not_found', 'המשתמש לא נמצא');
  const body = await readJson(request);
  const role = body.role === 'admin' ? 'admin' : body.role === 'user' ? 'user' : user.role;
  const disabled = body.disabled === undefined ? user.disabled : body.disabled ? 1 : 0;
  if (user.id === admin.id && (role !== 'admin' || disabled)) {
    throw new HttpError(400, 'self', 'אי אפשר להסיר הרשאת מנהל או להשבית את עצמך');
  }
  const stmts = [
    env.DB.prepare('UPDATE users SET name = ?, role = ?, disabled = ?, notes = ? WHERE id = ?').bind(
      body.name === undefined ? user.name : cleanName(body.name, user.email),
      role,
      disabled,
      body.notes === undefined ? user.notes : String(body.notes).slice(0, 2000),
      id,
    ),
  ];
  if (disabled) stmts.push(env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(id));
  await env.DB.batch(stmts);
  return adminGetUser(request, env, id);
}

async function adminDeleteUser(request, env, id) {
  const admin = await requireAdmin(request, env);
  if (id === admin.id) throw new HttpError(400, 'self', 'אי אפשר למחוק את עצמך');
  await passkeys.ensurePasskeySchema(env);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM passkeys WHERE user_id = ?').bind(id),
    env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(id),
    env.DB.prepare('DELETE FROM access WHERE user_id = ?').bind(id),
    env.DB.prepare('DELETE FROM auth_codes WHERE user_id = ?').bind(id),
    env.DB.prepare('DELETE FROM wall WHERE user_id = ?').bind(id),
    env.DB.prepare('DELETE FROM users WHERE id = ?').bind(id),
  ]);
  return json({ ok: true });
}

async function adminLogoutUser(request, env, id) {
  await requireAdmin(request, env);
  await env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(id).run();
  return json({ ok: true });
}

async function adminSendReset(request, env, id) {
  await requireAdmin(request, env);
  const user = await getUserById(env, id);
  if (!user) throw new HttpError(404, 'not_found', 'המשתמש לא נמצא');
  const extra = await issueEmailToken(env, request, 'reset', user.email, {});
  return json({ ok: true, ...extra });
}

async function adminSetAccess(request, env, userId, siteId) {
  await requireAdmin(request, env);
  const body = await readJson(request);
  const site = await getSite(env, siteId);
  if (!site) throw new HttpError(404, 'not_found', 'האתר לא נמצא');
  if (!(await getUserById(env, userId))) throw new HttpError(404, 'not_found', 'המשתמש לא נמצא');
  const status = ['active', 'pending', 'blocked'].includes(body.status) ? body.status : 'active';
  const planId = body.plan_id || null;
  if (planId) {
    const plan = await getPlan(env, planId);
    if (!plan || plan.site_id !== siteId) throw new HttpError(400, 'bad_plan', 'התוכנית לא שייכת לאתר הזה');
  }
  const expires = body.plan_expires_at ? Number(body.plan_expires_at) : null;
  const override = parseJsonField(body.features_override, null);
  if (override === null || typeof override !== 'object' || Array.isArray(override)) {
    throw new HttpError(400, 'bad_json', 'features חייב להיות אובייקט JSON');
  }
  await env.DB.prepare(
    `INSERT INTO access (user_id, site_id, status, plan_id, plan_expires_at, features_override, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, site_id) DO UPDATE SET status = excluded.status, plan_id = excluded.plan_id,
       plan_expires_at = excluded.plan_expires_at, features_override = excluded.features_override`,
  ).bind(userId, siteId, status, planId, expires, JSON.stringify(override), now()).run();
  if (status === 'blocked') {
    await env.DB.prepare('DELETE FROM sessions WHERE user_id = ? AND client_id = ?').bind(userId, siteId).run();
  }
  return adminGetUser(request, env, userId);
}

async function adminDeleteAccess(request, env, userId, siteId) {
  await requireAdmin(request, env);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM access WHERE user_id = ? AND site_id = ?').bind(userId, siteId),
    env.DB.prepare('DELETE FROM sessions WHERE user_id = ? AND client_id = ?').bind(userId, siteId),
  ]);
  return adminGetUser(request, env, userId);
}

async function adminListSites(request, env) {
  await requireAdmin(request, env);
  const [sites, plans, counts] = await env.DB.batch([
    env.DB.prepare('SELECT * FROM sites ORDER BY created_at'),
    env.DB.prepare('SELECT * FROM plans ORDER BY site_id, sort, name'),
    env.DB.prepare('SELECT site_id, status, plan_id, COUNT(*) AS n FROM access GROUP BY site_id, status, plan_id'),
  ]);
  return json({
    sites: sites.results.map(s => {
      const c = counts.results.filter(r => r.site_id === s.id);
      return {
        ...s,
        redirect_uris: parseJsonField(s.redirect_uris, []),
        plans: plans.results.filter(p => p.site_id === s.id).map(p => ({
          ...p,
          features: parseJsonField(p.features, {}),
          users: c.filter(r => r.plan_id === p.id).reduce((a, r) => a + r.n, 0),
        })),
        users: c.reduce((a, r) => a + r.n, 0),
        pending: c.filter(r => r.status === 'pending').reduce((a, r) => a + r.n, 0),
      };
    }),
  });
}

async function adminSaveSite(request, env, id) {
  await requireAdmin(request, env);
  if (!/^[a-z0-9-]{2,40}$/.test(id)) throw new HttpError(400, 'bad_id', 'מזהה אתר: אותיות קטנות באנגלית, ספרות ומקף בלבד');
  const body = await readJson(request);
  const uris = (Array.isArray(body.redirect_uris) ? body.redirect_uris : []).map(u => String(u).trim()).filter(Boolean);
  for (const u of uris) {
    let parsed;
    try { parsed = new URL(u); } catch { throw new HttpError(400, 'bad_uri', `כתובת לא תקינה: ${u}`); }
    const local = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
    if (parsed.protocol !== 'https:' && !local) throw new HttpError(400, 'bad_uri', `חייב https: ${u}`);
  }
  const mode = ['open', 'approval', 'invite'].includes(body.access_mode) ? body.access_mode : 'open';
  const name = String(body.name || '').trim() || id;
  await env.DB.prepare(
    `INSERT INTO sites (id, name, description, url, redirect_uris, access_mode, default_plan, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET name = excluded.name, description = excluded.description, url = excluded.url,
       redirect_uris = excluded.redirect_uris, access_mode = excluded.access_mode, default_plan = excluded.default_plan`,
  ).bind(id, name, String(body.description || ''), String(body.url || ''), JSON.stringify(uris), mode, body.default_plan || null, now()).run();
  originCache.at = 0;
  return adminListSites(request, env);
}

async function adminDeleteSite(request, env, id) {
  await requireAdmin(request, env);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM sessions WHERE client_id = ?').bind(id),
    env.DB.prepare('DELETE FROM access WHERE site_id = ?').bind(id),
    env.DB.prepare('DELETE FROM plans WHERE site_id = ?').bind(id),
    env.DB.prepare('DELETE FROM wall WHERE site_id = ?').bind(id),
    env.DB.prepare('DELETE FROM sites WHERE id = ?').bind(id),
  ]);
  originCache.at = 0;
  return adminListSites(request, env);
}

async function adminSavePlan(request, env, id) {
  await requireAdmin(request, env);
  const body = await readJson(request);
  if (!(await getSite(env, body.site_id))) throw new HttpError(400, 'bad_site', 'האתר לא קיים');
  if (!/^[a-z0-9:_-]{2,60}$/.test(id)) throw new HttpError(400, 'bad_id', 'מזהה תוכנית לא תקין');
  const features = parseJsonField(body.features, null);
  if (features === null || typeof features !== 'object' || Array.isArray(features)) {
    throw new HttpError(400, 'bad_json', 'features חייב להיות אובייקט JSON');
  }
  await env.DB.prepare(
    `INSERT INTO plans (id, site_id, name, features, sort) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET name = excluded.name, features = excluded.features, sort = excluded.sort`,
  ).bind(id, body.site_id, String(body.name || id), JSON.stringify(features), Number(body.sort) || 0).run();
  return adminListSites(request, env);
}

async function adminDeletePlan(request, env, id) {
  await requireAdmin(request, env);
  await env.DB.batch([
    env.DB.prepare('UPDATE access SET plan_id = NULL, plan_expires_at = NULL WHERE plan_id = ?').bind(id),
    env.DB.prepare('UPDATE sites SET default_plan = NULL WHERE default_plan = ?').bind(id),
    env.DB.prepare('DELETE FROM plans WHERE id = ?').bind(id),
  ]);
  return adminListSites(request, env);
}

async function adminListWall(request, env) {
  await requireAdmin(request, env);
  const { results } = await env.DB.prepare(
    `SELECT w.id, w.site_id, w.message, w.created_at, u.email, u.name
     FROM wall w JOIN users u ON u.id = w.user_id ORDER BY w.id DESC LIMIT 200`,
  ).all();
  return json({ messages: results });
}

async function adminDeleteWall(request, env, id) {
  await requireAdmin(request, env);
  await env.DB.prepare('DELETE FROM wall WHERE id = ?').bind(Number(id)).run();
  return adminListWall(request, env);
}

// ---------- emails from the dashboard ----------

async function ensureEmailLog(env) {
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS email_log (
       id INTEGER PRIMARY KEY AUTOINCREMENT, sent_by TEXT NOT NULL, from_addr TEXT NOT NULL, reply_to TEXT,
       subject TEXT NOT NULL, body TEXT NOT NULL, button_text TEXT, button_url TEXT,
       audience TEXT NOT NULL, recipients TEXT NOT NULL, count INTEGER NOT NULL,
       status TEXT NOT NULL, error TEXT, created_at INTEGER NOT NULL)`,
  ).run();
}

const MAX_RECIPIENTS = 500;

// Who an email goes to: picked users, typed addresses, everyone, a site's users or a plan's users.
async function resolveRecipients(env, to) {
  const t = now();
  let rows = [];
  const mode = to && to.mode;
  if (mode === 'emails') {
    const list = (Array.isArray(to.emails) ? to.emails : String(to.emails || '').split(/[\s,;]+/)).filter(Boolean);
    const emails = [...new Set(list.map(e => normalizeEmail(e)))];
    if (!emails.length) throw new HttpError(400, 'no_recipients', 'לא הוזנו כתובות');
    if (emails.length > MAX_RECIPIENTS) throw new HttpError(400, 'too_many', `עד ${MAX_RECIPIENTS} נמענים בשליחה`);
    const known = new Map();
    for (let i = 0; i < emails.length; i += 50) {
      const chunk = emails.slice(i, i + 50);
      const { results } = await env.DB.prepare(`SELECT email, name FROM users WHERE email IN (${chunk.map(() => '?').join(',')})`).bind(...chunk).all();
      results.forEach(r => known.set(r.email, r.name));
    }
    return emails.map(email => ({ email, name: known.get(email) || '' }));
  }
  if (mode === 'users') {
    const ids = [...new Set(Array.isArray(to.user_ids) ? to.user_ids : [])].slice(0, MAX_RECIPIENTS);
    if (!ids.length) throw new HttpError(400, 'no_recipients', 'לא נבחרו משתמשים');
    for (let i = 0; i < ids.length; i += 50) {
      const chunk = ids.slice(i, i + 50);
      const { results } = await env.DB.prepare(`SELECT email, name FROM users WHERE id IN (${chunk.map(() => '?').join(',')})`).bind(...chunk).all();
      rows.push(...results);
    }
    return rows;
  }
  if (mode === 'all') {
    ({ results: rows } = await env.DB.prepare('SELECT email, name FROM users WHERE disabled = 0 ORDER BY created_at LIMIT ?').bind(MAX_RECIPIENTS + 1).all());
  } else if (mode === 'site') {
    ({ results: rows } = await env.DB.prepare(
      `SELECT u.email, u.name FROM users u JOIN access a ON a.user_id = u.id
       WHERE a.site_id = ? AND a.status = 'active' AND u.disabled = 0 ORDER BY u.created_at LIMIT ?`,
    ).bind(String(to.site_id || ''), MAX_RECIPIENTS + 1).all());
  } else if (mode === 'plan') {
    const plan = await getPlan(env, to.plan_id);
    if (!plan) throw new HttpError(400, 'bad_plan', 'התוכנית לא נמצאה');
    const site = await getSite(env, plan.site_id);
    const isDefault = site && site.default_plan === plan.id ? 1 : 0;
    ({ results: rows } = await env.DB.prepare(
      `SELECT u.email, u.name FROM users u JOIN access a ON a.user_id = u.id
       WHERE a.site_id = ?1 AND a.status = 'active' AND u.disabled = 0
         AND ((a.plan_id = ?2 AND (a.plan_expires_at IS NULL OR a.plan_expires_at > ?3))
           OR (?4 = 1 AND (a.plan_id IS NULL OR (a.plan_expires_at IS NOT NULL AND a.plan_expires_at <= ?3))))
       ORDER BY u.created_at LIMIT ?5`,
    ).bind(plan.site_id, plan.id, t, isDefault, MAX_RECIPIENTS + 1).all());
  } else {
    throw new HttpError(400, 'bad_audience', 'לא נבחרו נמענים');
  }
  if (rows.length > MAX_RECIPIENTS) throw new HttpError(400, 'too_many', `יותר מ-${MAX_RECIPIENTS} נמענים — צמצמו את הקבוצה`);
  return rows;
}

function mailDomain(env) {
  return (env.MAIL_DOMAIN || 'reembir.com').toLowerCase();
}

function parseComposedEmail(env, body) {
  const local = String(body.from_local || '').trim().toLowerCase();
  if (!/^[a-z0-9](?:[a-z0-9._+-]{0,62}[a-z0-9])?$/.test(local)) {
    throw new HttpError(400, 'bad_from', 'הקידומת של כתובת השולח לא תקינה (אותיות באנגלית, ספרות, נקודה, מקף)');
  }
  const fromName = String(body.from_name || '').replace(/[<>"\r\n]/g, '').trim().slice(0, 60);
  const address = `${local}@${mailDomain(env)}`;
  const from = fromName ? `${fromName} <${address}>` : address;
  const replyTo = body.reply_to ? normalizeEmail(body.reply_to) : '';
  const subject = String(body.subject || '').replace(/[\r\n]+/g, ' ').trim().slice(0, 200);
  const text = String(body.body || '').slice(0, 20000);
  if (!subject) throw new HttpError(400, 'no_subject', 'חסר נושא');
  if (!text.trim()) throw new HttpError(400, 'no_body', 'חסר תוכן');
  let buttonText = String(body.button_text || '').trim().slice(0, 60);
  let buttonUrl = String(body.button_url || '').trim();
  if (buttonText || buttonUrl) {
    if (!buttonText || !/^https?:\/\/\S+$/.test(buttonUrl)) throw new HttpError(400, 'bad_button', 'לכפתור צריך טקסט וקישור שמתחיל ב-https://');
  } else {
    buttonText = buttonUrl = '';
  }
  return { address, from, replyTo, message: { subject, body: text, buttonText, buttonUrl } };
}

function describeAudience(to) {
  const m = to && to.mode;
  if (m === 'all') return 'כל המשתמשים';
  if (m === 'site') return `משתמשי ${to.site_id}`;
  if (m === 'plan') return `תוכנית ${to.plan_id}`;
  if (m === 'users') return 'משתמשים שנבחרו';
  return 'כתובות ידניות';
}

async function adminEmailPreview(request, env) {
  await requireAdmin(request, env);
  const body = await readJson(request);
  const recipients = await resolveRecipients(env, body.to);
  let preview = null;
  let from = null;
  if (body.subject || body.body) {
    try {
      const parsed = parseComposedEmail(env, { ...body, subject: body.subject || '(ללא נושא)', body: body.body || ' ' });
      from = parsed.from;
      preview = renderCustomEmail(parsed.message, recipients[0] || { name: 'ישראל', email: 'israel@example.com' }).html;
    } catch { /* preview is best-effort while typing */ }
  }
  return json({ count: recipients.length, sample: recipients.slice(0, 5).map(r => r.email), from, preview });
}

async function adminSendEmail(request, env) {
  const admin = await requireAdmin(request, env);
  const body = await readJson(request);
  await ensureEmailLog(env);
  const { address, from, replyTo, message } = parseComposedEmail(env, body);
  const recipients = await resolveRecipients(env, body.to);
  if (!recipients.length) throw new HttpError(400, 'no_recipients', 'אין נמענים בקבוצה הזו');
  await rateLimit(env, `admin-mail:${admin.id}`, 30, 3600);

  let status = 'sent';
  let error = null;
  let sent = 0;
  let dev = false;
  try {
    const r = await sendCustomBatch(env, { from, replyTo, message, recipients });
    sent = r.sent;
    dev = !!r.dev;
  } catch (err) {
    status = err.sent ? 'partial' : 'failed';
    error = String(err.message || err).slice(0, 500);
    sent = err.sent || 0;
  }
  await env.DB.prepare(
    `INSERT INTO email_log (sent_by, from_addr, reply_to, subject, body, button_text, button_url, audience, recipients, count, status, error, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    admin.email, from, replyTo || null, message.subject, message.body, message.buttonText || null, message.buttonUrl || null,
    JSON.stringify({ ...body.to, label: describeAudience(body.to) }),
    JSON.stringify(recipients.slice(0, 50).map(r => r.email)), sent, status, error, now(),
  ).run();

  if (status === 'failed') throw new HttpError(502, 'send_failed', `השליחה נכשלה: ${error}`);
  return json({ ok: true, sent, total: recipients.length, status, error, dev, from: address });
}

async function adminEmailLog(request, env) {
  await requireAdmin(request, env);
  await ensureEmailLog(env);
  const { results } = await env.DB.prepare('SELECT * FROM email_log ORDER BY id DESC LIMIT 50').all();
  return json({
    domain: mailDomain(env),
    configured: !!env.RESEND_API_KEY,
    emails: results.map(e => ({ ...e, audience: parseJsonField(e.audience, {}), recipients: parseJsonField(e.recipients, []) })),
  });
}

// Helpers handed to the passkey and payment modules.
const H = { requirePortalUser, requireAdmin, requireSiteSession, completeLogin, getUserById, getUserByEmail };

// ======================================================================
// Router
// ======================================================================

// Endpoints called by other sites (bearer token, CORS). Everything else is same-origin only.
const SITE_ROUTES = new Set(['/api/token', '/api/userinfo', '/api/token/revoke', '/api/firebase-token', '/api/wall']);

function route(method, path) {
  const m = (pattern) => {
    const match = path.match(pattern);
    return match ? match.slice(1).map(decodeURIComponent) : null;
  };
  let p;
  const R = {
    'GET /api/config': (req, env) => json({ google_client_id: env.GOOGLE_CLIENT_ID || '', dev: env.DEV === '1' }),
    'GET /api/me': me,
    'POST /api/auth/register': register,
    'POST /api/auth/login': passwordLogin,
    'POST /api/auth/google': googleLogin,
    'POST /api/auth/magic': sendMagicLink,
    'POST /api/auth/magic/verify': verifyMagicLink,
    'POST /api/auth/verify': verifyEmail,
    'POST /api/auth/verify/resend': resendVerification,
    'POST /api/auth/forgot': forgotPassword,
    'POST /api/auth/reset': resetPassword,
    'POST /api/auth/logout': logout,
    'POST /api/account/profile': updateProfile,
    'POST /api/account/password': changePassword,
    'POST /api/account/google/link': linkGoogle,
    'POST /api/account/google/unlink': unlinkGoogle,
    'GET /api/authorize/info': authorizeInfo,
    'POST /api/authorize': authorize,
    'POST /api/token': exchangeCode,
    'GET /api/userinfo': userinfo,
    'POST /api/token/revoke': revokeToken,
    'POST /api/firebase-token': firebaseToken,
    'GET /api/wall': listWall,
    'POST /api/wall': postWall,
    'GET /api/admin/stats': adminStats,
    'GET /api/admin/users': adminListUsers,
    'POST /api/admin/users': adminCreateUser,
    'GET /api/admin/sites': adminListSites,
    'GET /api/admin/wall': adminListWall,
    'POST /api/admin/email/preview': adminEmailPreview,
    'POST /api/admin/email/send': adminSendEmail,
    'GET /api/admin/email/log': adminEmailLog,
    'GET /api/passkeys': (r, e) => passkeys.listPasskeys(r, e, H),
    'POST /api/passkeys/register/options': (r, e) => passkeys.registerOptions(r, e, H),
    'POST /api/passkeys/register/verify': (r, e) => passkeys.registerVerify(r, e, H),
    'POST /api/passkeys/login/options': (r, e) => passkeys.loginOptions(r, e),
    'POST /api/passkeys/login/verify': (r, e) => passkeys.loginVerify(r, e, H),
    'GET /api/admin/pay': (r, e) => pay.adminListPay(r, e, H),
    'POST /api/admin/pay': (r, e) => pay.adminCreatePay(r, e, H),
  };
  const key = `${method} ${path}`;
  if (R[key]) return R[key];

  if ((p = m(/^\/api\/wall\/(\d+)$/)) && method === 'DELETE') return (r, e) => deleteOwnWall(r, e, p[0]);
  if ((p = m(/^\/api\/passkeys\/([^/]+)$/))) {
    if (method === 'PATCH') return (r, e) => passkeys.renamePasskey(r, e, H, p[0]);
    if (method === 'DELETE') return (r, e) => passkeys.deletePasskey(r, e, H, p[0]);
  }
  if ((p = m(/^\/api\/admin\/pay\/([\w-]+)\/(cancel|reopen|send|delete)$/)) && method === 'POST') {
    return (r, e) => pay.adminPayAction(r, e, H, p[0], p[1]);
  }
  if ((p = m(/^\/api\/pay\/([\w-]+)$/)) && method === 'GET') return (r, e) => pay.payInfo(r, e, p[0]);
  if ((p = m(/^\/api\/pay\/([\w-]+)\/(check|code|verify|order|capture)$/)) && method === 'POST') {
    const [id, action] = p;
    return {
      check: (r, e) => pay.payCheck(r, e, H, id),
      code: (r, e) => pay.paySendCode(r, e, id),
      verify: (r, e) => pay.payVerifyCode(r, e, id),
      order: (r, e) => pay.payCreateOrder(r, e, H, id),
      capture: (r, e) => pay.payCapture(r, e, H, id),
    }[action];
  }
  if ((p = m(/^\/api\/admin\/users\/([^/]+)$/))) {
    if (method === 'GET') return (r, e) => adminGetUser(r, e, p[0]);
    if (method === 'PATCH') return (r, e) => adminUpdateUser(r, e, p[0]);
    if (method === 'DELETE') return (r, e) => adminDeleteUser(r, e, p[0]);
  }
  if ((p = m(/^\/api\/admin\/users\/([^/]+)\/logout$/)) && method === 'POST') return (r, e) => adminLogoutUser(r, e, p[0]);
  if ((p = m(/^\/api\/admin\/users\/([^/]+)\/reset$/)) && method === 'POST') return (r, e) => adminSendReset(r, e, p[0]);
  if ((p = m(/^\/api\/admin\/users\/([^/]+)\/access\/([^/]+)$/))) {
    if (method === 'PUT') return (r, e) => adminSetAccess(r, e, p[0], p[1]);
    if (method === 'DELETE') return (r, e) => adminDeleteAccess(r, e, p[0], p[1]);
  }
  if ((p = m(/^\/api\/admin\/sites\/([^/]+)$/))) {
    if (method === 'PUT') return (r, e) => adminSaveSite(r, e, p[0]);
    if (method === 'DELETE') return (r, e) => adminDeleteSite(r, e, p[0]);
  }
  if ((p = m(/^\/api\/admin\/plans\/([^/]+)$/))) {
    if (method === 'PUT') return (r, e) => adminSavePlan(r, e, p[0]);
    if (method === 'DELETE') return (r, e) => adminDeletePlan(r, e, p[0]);
  }
  if ((p = m(/^\/api\/admin\/wall\/(\d+)$/)) && method === 'DELETE') return (r, e) => adminDeleteWall(r, e, p[0]);
  return null;
}

async function corsHeaders(request, env, path) {
  const origin = request.headers.get('origin');
  const isSiteRoute = SITE_ROUTES.has(path) || path.startsWith('/api/wall/');
  if (!origin || !isSiteRoute) return {};
  if (!(await allowedOrigins(env)).has(origin)) return {};
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS',
    'access-control-allow-headers': 'authorization, content-type',
    'access-control-max-age': '86400',
    vary: 'Origin',
  };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';

    if (!path.startsWith('/api/')) {
      // pay.reembir.com/r/<id> → the payment page.
      if (/^\/r\/[\w-]+$/.test(path)) return env.ASSETS.fetch(new Request(new URL('/pay', url), request));
      if (url.hostname.startsWith('pay.') && path === '/') return Response.redirect('https://reembir.com/', 302);
      return env.ASSETS.fetch(request);
    }

    let cors = {};
    try {
      cors = await corsHeaders(request, env, path);
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

      const isSiteRoute = SITE_ROUTES.has(path) || path.startsWith('/api/wall/');
      // Cookie-authenticated endpoints only accept same-origin writes (CSRF protection on top of SameSite=Lax).
      const origin = request.headers.get('origin');
      if (!isSiteRoute && request.method !== 'GET' && origin && origin !== url.origin) {
        throw new HttpError(403, 'bad_origin', 'בקשה ממקור לא מורשה');
      }

      const handler = route(request.method, path);
      if (!handler) throw new HttpError(404, 'not_found', 'לא נמצא');
      const res = await handler(request, env);
      for (const [k, v] of Object.entries(cors)) res.headers.set(k, v);
      return res;
    } catch (err) {
      if (err instanceof HttpError) return json({ error: err.code, message: err.message }, err.status, cors);
      console.error(err);
      return json({ error: 'server_error', message: 'משהו השתבש, נסו שוב' }, 500, cors);
    }
  },
};
