// Server-to-server API for chat.reembir.com (the support chat): support agents send payment
// requests from inside a conversation and upgrade customers' plans. Authenticated with a shared
// secret (CHAT_SERVICE_KEY here, SSO_SERVICE_KEY in the chat worker) — the chat checks each
// agent's own permissions before calling.
import { HttpError, json, readJson, sha256 } from './lib.js';
import { createPayRequest, getRequest, adminView, applyPlan, effectiveStatus, ensurePaySchema } from './pay.js';
import { serviceEmail } from './email.js';
import { agentBonus, bonusKeys, bonusTotalsByUser } from './affiliate.js';
import { validateCoupon, couponLabel, ensureBillingSchema, COUPON_TYPES } from './billing.js';
import { ensurePacksSchema } from './packs.js';

async function requireService(request, env) {
  const key = request.headers.get('x-service-key') || '';
  if (!env.CHAT_SERVICE_KEY || !key || (await sha256(key)) !== (await sha256(env.CHAT_SERVICE_KEY))) {
    throw new HttpError(401, 'bad_service_key', 'מפתח השירות שגוי — בדקו ש-CHAT_SERVICE_KEY זהה ל-SSO_SERVICE_KEY של הצ׳אט');
  }
}

const parse = v => { try { return JSON.parse(v); } catch { return {}; } };

export async function catalog(request, env) {
  await requireService(request, env);
  await ensurePacksSchema(env);
  const [sites, plans, packs] = await env.DB.batch([
    env.DB.prepare("SELECT id, name, url FROM sites WHERE id != 'pay' ORDER BY created_at"),
    env.DB.prepare('SELECT id, site_id, name, features, price, currency FROM plans ORDER BY site_id, sort, name'),
    env.DB.prepare('SELECT id, site_id, name, price, currency, features FROM billing_packs WHERE active = 1 ORDER BY site_id, sort, price'),
  ]);
  return json({
    sites: sites.results,
    plans: plans.results.map(p => ({ ...p, features: parse(p.features), price: p.price || 0, currency: p.currency || 'ILS' })),
    // For the chat's gift / pack / coupon tools: what each site sells and gives.
    packs: packs.results.map(p => ({ ...p, features: parse(p.features) })),
    bonus_keys: await bonusKeys(env),
    coupon_types: COUPON_TYPES,
  });
}

export async function users(request, env) {
  await requireService(request, env);
  const url = new URL(request.url);
  const q = (url.searchParams.get('q') || '').trim().toLowerCase();
  const exact = (url.searchParams.get('email') || '').trim().toLowerCase();
  const stmt = exact
    ? env.DB.prepare('SELECT id, email, name, email_verified, disabled FROM users WHERE email = ? LIMIT 1').bind(exact)
    : env.DB.prepare(
      `SELECT id, email, name, email_verified, disabled FROM users
       WHERE lower(email) LIKE ?1 OR lower(name) LIKE ?1 ORDER BY last_login_at DESC LIMIT 20`,
    ).bind(`%${q}%`);
  const { results } = await stmt.all();
  const out = [];
  for (const u of results.slice(0, 20)) {
    const { results: access } = await env.DB.prepare(
      `SELECT a.site_id, a.status, a.plan_id, a.plan_expires_at, s.name AS site_name, p.name AS plan_name
       FROM access a JOIN sites s ON s.id = a.site_id LEFT JOIN plans p ON p.id = a.plan_id
       WHERE a.user_id = ? AND a.site_id != 'pay'`,
    ).bind(u.id).all();
    out.push({ ...u, email_verified: !!u.email_verified, disabled: !!u.disabled, access, bonus: await bonusTotalsByUser(env, u.id) });
  }
  return json({ users: out });
}

export async function email(request, env) {
  await requireService(request, env);
  return serviceEmail(request, env);
}

// A gift from a support agent: bonus units on a site (e.g. {"minutes": 30}), shown on the user's
// page in the dashboard as "מתנה מנציג בצ׳אט".
export async function giveBonus(request, env, h) {
  await requireService(request, env);
  const b = await readJson(request);
  const user = await h.getUserById(env, String(b.user_id || ''));
  if (!user) throw new HttpError(404, 'not_found', 'המשתמש לא נמצא');
  const site = await h.getSite(env, String(b.site_id || ''));
  if (!site) throw new HttpError(404, 'not_found', 'האתר לא נמצא');
  const by = String(b.by || '').slice(0, 80);
  const label = await agentBonus(env, { siteId: site.id, userId: user.id, features: b.features, note: [b.note, by && `על ידי ${by}`].filter(Boolean).join(' · ') });
  return json({ result: { user_email: user.email, site_id: site.id, site_name: site.name, site_url: site.url, label } });
}

// A personal coupon made by a support agent: one use, 30 days, a random code.
export async function makeCoupon(request, env, h) {
  await requireService(request, env);
  await ensureBillingSchema(env);
  const b = await readJson(request);
  const site = await h.getSite(env, String(b.site_id || ''));
  if (!site) throw new HttpError(404, 'not_found', 'האתר לא נמצא');
  const plans = (await env.DB.prepare('SELECT * FROM plans WHERE site_id = ?').bind(site.id).all()).results.map(p => ({ ...p, price: p.price || 0 }));
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (let i = 0; i < 5; i++) {
    const code = 'C' + Array.from(crypto.getRandomValues(new Uint8Array(7)), n => chars[n % chars.length]).join('');
    const c = validateCoupon({
      code, type: b.type, value: b.value, months: b.months, plan_ids: b.plan_ids, max_uses: 1,
      expires_at: Math.floor(Date.now() / 1000) + 30 * 86400, note: String(b.note || `מהצ׳אט${b.by ? ' · ' + b.by : ''}`),
    }, plans);
    const r = await env.DB.prepare(
      `INSERT OR IGNORE INTO coupons (site_id, code, type, value, months, plan_ids, max_uses, uses, expires_at, active, note, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, 1, ?, ?)`,
    ).bind(site.id, c.code, c.type, c.value, c.months, JSON.stringify(c.plan_ids), 1, c.expires_at, c.note, Math.floor(Date.now() / 1000)).run();
    if (!r.meta.changes) continue;
    const p = plans.find(x => x.id === c.plan_ids[0]);
    const link = site.url ? site.url + (site.url.includes('?') ? '&' : '?') + 'coupon=' + c.code : null;
    return json({ result: { code: c.code, label: couponLabel(c, p?.currency || 'ILS', c.type === 'gift' ? p?.name : null), site_id: site.id, site_name: site.name, link, expires_at: c.expires_at } });
  }
  throw new HttpError(500, 'server_error', 'לא הצלחנו ליצור קוד, נסו שוב');
}

export async function setAccess(request, env, h) {
  await requireService(request, env);
  const body = await readJson(request);
  return json({ result: await applyPlan(env, h, body) });
}

export async function createPay(request, env, h) {
  await requireService(request, env);
  const body = await readJson(request);
  const createdBy = String(body.created_by || '').trim().toLowerCase().slice(0, 254);
  if (!createdBy.includes('@')) throw new HttpError(400, 'bad_creator', 'חסר מייל של הנציג');
  return json(await createPayRequest(env, h, body, {
    createdBy, source: 'chat', sourceRef: String(body.source_ref || '').slice(0, 100) || null, onPaid: body.on_paid || null,
  }));
}

export async function getPay(request, env, h, id) {
  await requireService(request, env);
  return json({ request: adminView(env, await getRequest(env, id)) });
}

export async function cancelPay(request, env, h, id) {
  await requireService(request, env);
  await ensurePaySchema(env);
  const r = await getRequest(env, id);
  if (effectiveStatus(r) === 'paid') throw new HttpError(400, 'paid', 'הבקשה כבר שולמה');
  await env.DB.prepare("UPDATE pay_requests SET status = 'cancelled' WHERE id = ? AND status != 'paid'").bind(id).run();
  return json({ request: adminView(env, await getRequest(env, id)) });
}
