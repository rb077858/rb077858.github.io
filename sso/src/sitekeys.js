// Per-site server keys: a site's own backend (e.g. a Worker that takes payments) can set
// which plan its users have — on that site only. The admin creates the key in
// Sites → <site> → "מפתח שרת"; it is shown once and stored here only as a hash.
//
//   GET /api/site/plans                 the site's plans
//   GET /api/site/access?email=…        a user's plan on the site
//   PUT /api/site/access                { email, plan_id | null, expires_at (unix seconds) | null }
//
// All three take the header  x-site-key: rsk_…
import { HttpError, json, readJson, now, randomToken, sha256, normalizeEmail, parseJsonField } from './lib.js';

let ready = false;

async function ensureSchema(env) {
  if (ready) return;
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS site_keys (
       site_id TEXT PRIMARY KEY, key_hash TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL, last_used_at INTEGER
     )`,
  ).run();
  ready = true;
}

/** site_id → { created_at, last_used_at } for the admin's site list. */
export async function keyInfo(env) {
  await ensureSchema(env);
  const { results } = await env.DB.prepare('SELECT site_id, created_at, last_used_at FROM site_keys').all();
  return Object.fromEntries(results.map(r => [r.site_id, { created_at: r.created_at, last_used_at: r.last_used_at }]));
}

export async function deleteKey(env, siteId) {
  await ensureSchema(env);
  await env.DB.prepare('DELETE FROM site_keys WHERE site_id = ?').bind(siteId).run();
}

export async function adminCreateKey(request, env, h, siteId) {
  await h.requireAdmin(request, env);
  if (!(await h.getSite(env, siteId))) throw new HttpError(404, 'not_found', 'האתר לא נמצא');
  await ensureSchema(env);
  const key = 'rsk_' + randomToken(32);
  await env.DB.prepare(
    `INSERT INTO site_keys (site_id, key_hash, created_at) VALUES (?, ?, ?)
     ON CONFLICT(site_id) DO UPDATE SET key_hash = excluded.key_hash, created_at = excluded.created_at, last_used_at = NULL`,
  ).bind(siteId, await sha256(key), now()).run();
  return json({ key, site_id: siteId });
}

export async function adminDeleteKey(request, env, h, siteId) {
  await h.requireAdmin(request, env);
  await deleteKey(env, siteId);
  return json({ ok: true });
}

async function requireSiteKey(request, env, h) {
  const key = request.headers.get('x-site-key') || '';
  if (!key.startsWith('rsk_')) throw new HttpError(401, 'bad_site_key', 'חסר מפתח שרת');
  await ensureSchema(env);
  const row = await env.DB.prepare('SELECT site_id, last_used_at FROM site_keys WHERE key_hash = ?').bind(await sha256(key)).first();
  if (!row) throw new HttpError(401, 'bad_site_key', 'מפתח השרת שגוי או בוטל');
  const site = await h.getSite(env, row.site_id);
  if (!site) throw new HttpError(401, 'bad_site_key', 'האתר הוסר');
  if (!row.last_used_at || row.last_used_at < now() - 3600) {
    await env.DB.prepare('UPDATE site_keys SET last_used_at = ? WHERE site_id = ?').bind(now(), site.id).run();
  }
  return site;
}

async function accessView(env, h, site, user) {
  const row = await env.DB.prepare('SELECT status, plan_id, plan_expires_at FROM access WHERE user_id = ? AND site_id = ?')
    .bind(user.id, site.id).first();
  const expired = !!(row && row.plan_id && row.plan_expires_at && row.plan_expires_at < now());
  return {
    email: user.email,
    status: row ? row.status : 'none',
    plan_id: row ? row.plan_id : null,
    plan_expires_at: row ? row.plan_expires_at : null,
    plan_expired: expired,
  };
}

export async function sitePlans(request, env, h) {
  const site = await requireSiteKey(request, env, h);
  const { results } = await env.DB.prepare('SELECT id, name, features, sort FROM plans WHERE site_id = ? ORDER BY sort, name')
    .bind(site.id).all();
  return json({
    site: { id: site.id, name: site.name, default_plan: site.default_plan },
    plans: results.map(p => ({ ...p, features: parseJsonField(p.features, {}) })),
  });
}

export async function siteGetAccess(request, env, h) {
  const site = await requireSiteKey(request, env, h);
  const email = normalizeEmail(new URL(request.url).searchParams.get('email'));
  const user = await h.getUserByEmail(env, email);
  if (!user) throw new HttpError(404, 'not_found', 'המשתמש לא נמצא');
  return json(await accessView(env, h, site, user));
}

export async function siteSetAccess(request, env, h) {
  const site = await requireSiteKey(request, env, h);
  const body = await readJson(request);
  const user = await h.getUserByEmail(env, normalizeEmail(body.email));
  if (!user) throw new HttpError(404, 'not_found', 'המשתמש לא נמצא');

  const planId = body.plan_id ? String(body.plan_id) : null;
  if (planId) {
    const plan = await h.getPlan(env, planId);
    if (!plan || plan.site_id !== site.id) throw new HttpError(400, 'bad_plan', `התוכנית ${planId} לא קיימת באתר ${site.id}`);
  }
  let expires = null;
  if (body.expires_at !== null && body.expires_at !== undefined) {
    expires = Math.round(Number(body.expires_at));
    if (!Number.isFinite(expires) || expires < 1e9 || expires > 1e11) throw new HttpError(400, 'bad_expiry', 'expires_at צריך להיות בשניות (unix)');
  }

  // A new row starts active; an existing one keeps its status (a site can't unblock a user).
  await env.DB.prepare(
    `INSERT INTO access (user_id, site_id, status, plan_id, plan_expires_at, created_at) VALUES (?, ?, 'active', ?, ?, ?)
     ON CONFLICT(user_id, site_id) DO UPDATE SET plan_id = excluded.plan_id, plan_expires_at = excluded.plan_expires_at`,
  ).bind(user.id, site.id, planId, planId ? expires : null, now()).run();
  return json(await accessView(env, h, site, user));
}
