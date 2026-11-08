// Packs: one-time purchases on top of a plan (e.g. 100 extra minutes), through the same central
// PayPal account as the subscriptions (billing.js).
//
// A pack (Sites → site → Packs) has a price and a features JSON ({"minutes": 100}). plan_ids says
// which plans may buy it (empty = everyone). The server creates and captures the PayPal order
// itself, so the price can't be changed in the browser. userinfo reports access.packs =
// { eligible, totals, count }: totals sums every number in the features of the completed
// purchases. The site keeps track of what was used and subtracts it itself.
import { HttpError, json, readJson, now, parseJsonField } from './lib.js';
import { paypalRequest, formatMoney } from './pay.js';
import { sendNotice } from './mail.js';
import { adminSiteBilling } from './billing.js';

const DAY = 86400;
const ppEnv = env => (env.PAYPAL_ENV === 'sandbox' ? 'sandbox' : 'live');
const paypalReady = env => !!(env.PAYPAL_CLIENT_ID && env.PAYPAL_CLIENT_SECRET);
const CURRENCIES = ['ILS', 'USD', 'EUR'];
const fmtDateTime = t => new Date(t * 1000).toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem', dateStyle: 'short', timeStyle: 'short' });

let ready = false;
export async function ensurePacksSchema(env) {
  if (ready) return;
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS billing_packs (
      id TEXT PRIMARY KEY, site_id TEXT NOT NULL, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
      price REAL NOT NULL, currency TEXT NOT NULL DEFAULT 'ILS', features TEXT NOT NULL DEFAULT '{}',
      plan_ids TEXT NOT NULL DEFAULT '[]', active INTEGER NOT NULL DEFAULT 1, sort INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL)`),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS billing_packs_site ON billing_packs(site_id)'),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS pack_purchases (
      order_id TEXT PRIMARY KEY, user_id TEXT NOT NULL, site_id TEXT NOT NULL, pack_id TEXT NOT NULL,
      pack_name TEXT NOT NULL, price REAL NOT NULL, currency TEXT NOT NULL, features TEXT NOT NULL DEFAULT '{}',
      env TEXT NOT NULL, status TEXT NOT NULL, capture_id TEXT, created_at INTEGER NOT NULL, paid_at INTEGER)`),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS pack_purchases_user ON pack_purchases(user_id, site_id)'),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS pack_purchases_site ON pack_purchases(site_id, status, paid_at)'),
  ]);
  ready = true;
}

function packRow(r) {
  return r && { ...r, features: parseJsonField(r.features, {}), plan_ids: parseJsonField(r.plan_ids, []), active: !!r.active };
}

async function sitePacks(env, siteId) {
  const { results } = await env.DB.prepare('SELECT * FROM billing_packs WHERE site_id = ? ORDER BY sort, price').bind(siteId).all();
  return results.map(packRow);
}

const allowedFor = (pack, planId) => !pack.plan_ids.length || pack.plan_ids.includes(planId);

/** For the catalog: the packs a site sells. */
export async function catalogPacks(env, siteId) {
  await ensurePacksSchema(env);
  return (await sitePacks(env, siteId)).filter(p => p.active).map(p => ({
    id: p.id, name: p.name, description: p.description || '', price: p.price, currency: p.currency, features: p.features, plan_ids: p.plan_ids,
  }));
}

/** For the userinfo payload: what the user bought on the site, and whether their plan can buy packs. */
export async function packsView(env, userId, siteId, planId) {
  await ensurePacksSchema(env);
  // Disabled packs count too: stopping sales doesn't freeze what people already bought.
  const packs = await sitePacks(env, siteId);
  const { results } = await env.DB.prepare(
    "SELECT features FROM pack_purchases WHERE user_id = ? AND site_id = ? AND status = 'COMPLETED' AND env = ?",
  ).bind(userId, siteId, ppEnv(env)).all();
  const totals = {};
  for (const r of results) {
    for (const [k, v] of Object.entries(parseJsonField(r.features, {}))) {
      if (typeof v === 'number' && Number.isFinite(v)) totals[k] = Math.round(((totals[k] || 0) + v) * 1e6) / 1e6;
    }
  }
  return { eligible: packs.some(p => allowedFor(p, planId)), totals, count: results.length };
}

// ---------- site-facing API (bearer token of the site, CORS) ----------

export async function packOrder(request, env, h) {
  const session = await h.requireSiteSession(request, env);
  if (!paypalReady(env)) throw new HttpError(501, 'paypal_not_configured', 'התשלומים עוד לא הופעלו');
  await ensurePacksSchema(env);
  const site = await h.getSite(env, session.client_id);
  const packId = String((await readJson(request)).pack_id || '');
  const pack = packRow(await env.DB.prepare('SELECT * FROM billing_packs WHERE id = ? AND site_id = ?').bind(packId, site.id).first());
  if (!pack || !pack.active) throw new HttpError(404, 'not_found', 'החבילה לא קיימת');
  const access = await h.resolveAccess(env, session, site, { create: false });
  if (!allowedFor(pack, access.plan?.id)) throw new HttpError(403, 'upgrade', 'החבילה הזו זמינה רק בתוכנית אחרת');

  const r = await paypalRequest(env, 'POST', '/v2/checkout/orders', {
    intent: 'CAPTURE',
    purchase_units: [{
      reference_id: pack.id.slice(0, 256),
      custom_id: `${site.id}:${session.id}`,
      description: `${site.name || site.id} - ${pack.name}`.slice(0, 127),
      amount: { currency_code: pack.currency, value: pack.price.toFixed(2) },
    }],
    application_context: { brand_name: 'reem.bi', shipping_preference: 'NO_SHIPPING', user_action: 'PAY_NOW', locale: 'he-IL' },
  });
  if (!r.ok || !r.data?.id) {
    console.error('PayPal pack order', r.status, JSON.stringify(r.data).slice(0, 500));
    throw new HttpError(502, 'paypal_error', 'לא הצלחנו לפתוח תשלום ב-PayPal, נסו שוב');
  }
  await env.DB.prepare(
    `INSERT INTO pack_purchases (order_id, user_id, site_id, pack_id, pack_name, price, currency, features, env, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'CREATED', ?)`,
  ).bind(r.data.id, session.id, site.id, pack.id, pack.name, pack.price, pack.currency, JSON.stringify(pack.features), ppEnv(env), now()).run();
  return json({ id: r.data.id });
}

export async function packCapture(request, env, h) {
  const session = await h.requireSiteSession(request, env);
  await ensurePacksSchema(env);
  const site = await h.getSite(env, session.client_id);
  const orderId = String((await readJson(request)).order_id || '');
  const row = /^[A-Z0-9-]{5,40}$/i.test(orderId)
    ? await env.DB.prepare('SELECT * FROM pack_purchases WHERE order_id = ? AND user_id = ? AND site_id = ?').bind(orderId, session.id, site.id).first()
    : null;
  if (!row) throw new HttpError(404, 'not_found', 'ההזמנה לא נמצאה');
  // Safe to retry: a completed order is never captured or counted again.
  if (row.status === 'COMPLETED') return json(await h.siteUserPayload(env, session, site));

  const path = '/v2/checkout/orders/' + encodeURIComponent(orderId);
  let res = await paypalRequest(env, 'POST', path + '/capture');
  if (!res.ok && res.data?.details?.some(d => d.issue === 'ORDER_ALREADY_CAPTURED')) res = await paypalRequest(env, 'GET', path);
  if (!res.ok) {
    console.error('PayPal pack capture', res.status, JSON.stringify(res.data).slice(0, 500));
    const declined = res.data?.details?.some(d => d.issue === 'INSTRUMENT_DECLINED');
    throw new HttpError(402, declined ? 'declined' : 'paypal_error', declined ? 'אמצעי התשלום נדחה. נסו אמצעי אחר' : 'התשלום לא הושלם, נסו שוב');
  }
  const unit = res.data.purchase_units?.[0] || {};
  const capture = unit.payments?.captures?.[0];
  const custom = capture?.custom_id || unit.custom_id;
  if (
    !capture || capture.status !== 'COMPLETED' ||
    capture.amount?.currency_code !== row.currency || Number(capture.amount?.value).toFixed(2) !== Number(row.price).toFixed(2) ||
    custom !== `${site.id}:${session.id}`
  ) {
    console.error('PayPal pack capture mismatch', JSON.stringify(res.data).slice(0, 1000));
    throw new HttpError(402, 'not_completed', 'התשלום עדיין לא הושלם. אם חויבתם, פנו ל-support@reembir.com');
  }

  const t = now();
  const upd = await env.DB.prepare("UPDATE pack_purchases SET status = 'COMPLETED', capture_id = ?, paid_at = ? WHERE order_id = ? AND status != 'COMPLETED'")
    .bind(capture.id, t, orderId).run();
  if (upd.meta.changes && session.email) {
    const money = formatMoney(Math.round(row.price * 100), row.currency);
    try {
      await sendNotice(env, session.email, `קבלה על תשלום: ${money}`, {
        title: 'התשלום התקבל, תודה! ✓',
        intro: `החבילה נוספה לחשבון שלך ב-${site.name || site.id}.`,
        rows: [['עבור', `${site.name || site.id} · ${row.pack_name}`], ['סכום', money], ['תאריך', fmtDateTime(t)], ['אסמכתא (PayPal)', capture.id]],
        button: site.url ? 'חזרה לאתר' : undefined,
        link: site.url || undefined,
        outro: 'המסמך הזה הוא אישור תשלום ואינו חשבונית מס. לשאלות: support@reembir.com',
      });
    } catch (e) {
      console.error('pack receipt email failed', e);
    }
  }
  return json(await h.siteUserPayload(env, session, site));
}

// ---------- admin ----------

/** For adminSiteBilling: the packs with their sales, the latest purchases and the last 30 days. */
export async function adminPacksData(env, siteId) {
  await ensurePacksSchema(env);
  const [packs, purchases, month] = await env.DB.batch([
    env.DB.prepare(
      `SELECT p.*, (SELECT COUNT(*) FROM pack_purchases x WHERE x.pack_id = p.id AND x.status = 'COMPLETED') AS sold
       FROM billing_packs p WHERE p.site_id = ? ORDER BY p.sort, p.price`,
    ).bind(siteId),
    env.DB.prepare(
      `SELECT x.order_id, x.pack_id, x.pack_name, x.price, x.currency, x.features, x.env, x.capture_id, x.paid_at,
       u.id AS user_id, u.email, u.name
       FROM pack_purchases x JOIN users u ON u.id = x.user_id
       WHERE x.site_id = ? AND x.status = 'COMPLETED' ORDER BY x.paid_at DESC LIMIT 200`,
    ).bind(siteId),
    env.DB.prepare(
      `SELECT currency, COUNT(*) AS n, SUM(price) AS total FROM pack_purchases
       WHERE site_id = ? AND status = 'COMPLETED' AND env = ? AND paid_at > ? GROUP BY currency`,
    ).bind(siteId, ppEnv(env), now() - 30 * DAY),
  ]);
  return {
    packs: packs.results.map(packRow),
    purchases: purchases.results.map(r => ({ ...r, features: parseJsonField(r.features, {}) })),
    month: month.results.map(r => ({ currency: r.currency, n: r.n, total: Math.round(r.total * 100) / 100 })),
  };
}

function validatePack(input, siteId, id, plans) {
  const bad = m => { throw new HttpError(400, 'bad_pack', m); };
  if (!id.startsWith(siteId + ':') || !/^[a-z0-9_-]{2,40}$/.test(id.slice(siteId.length + 1))) bad(`מזהה: ${siteId}: ואחריו 2-40 אותיות קטנות באנגלית, ספרות, מקף או קו תחתון`);
  const name = String(input.name || '').replace(/\s+/g, ' ').trim().slice(0, 80);
  if (!name) bad('חסר שם לחבילה');
  const price = Math.round(Number(input.price) * 100) / 100;
  if (!(price > 0 && price <= 100000)) bad('המחיר צריך להיות גדול מ-0 ועד 100,000');
  const currency = String(input.currency || 'ILS').toUpperCase();
  if (!CURRENCIES.includes(currency)) bad('מטבע לא נתמך');
  let features = input.features ?? {};
  if (typeof features === 'string') {
    try { features = JSON.parse(features.trim() || '{}'); } catch { bad('"מה מקבלים" לא בפורמט JSON תקין'); }
  }
  if (!features || typeof features !== 'object' || Array.isArray(features)) bad('"מה מקבלים" צריך להיות אובייקט JSON, למשל {"minutes": 100}');
  const planIds = Array.isArray(input.plan_ids) ? [...new Set(input.plan_ids.map(String))] : [];
  const known = plans.map(p => p.id);
  if (planIds.some(p => !known.includes(p))) bad('אחת התוכניות לא קיימת באתר');
  return {
    name, price, currency, features, plan_ids: planIds,
    description: String(input.description || '').slice(0, 200),
    active: input.active === undefined ? 1 : input.active ? 1 : 0,
    sort: Math.round(Number(input.sort) || 0),
  };
}

export async function adminSavePack(request, env, h, siteId, id) {
  await h.requireAdmin(request, env);
  await ensurePacksSchema(env);
  if (!(await h.getSite(env, siteId))) throw new HttpError(404, 'not_found', 'האתר לא נמצא');
  const { results: plans } = await env.DB.prepare('SELECT id FROM plans WHERE site_id = ?').bind(siteId).all();
  const p = validatePack(await readJson(request), siteId, id, plans);
  await env.DB.prepare(
    `INSERT INTO billing_packs (id, site_id, name, description, price, currency, features, plan_ids, active, sort, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET name = excluded.name, description = excluded.description, price = excluded.price,
       currency = excluded.currency, features = excluded.features, plan_ids = excluded.plan_ids, active = excluded.active, sort = excluded.sort`,
  ).bind(id, siteId, p.name, p.description, p.price, p.currency, JSON.stringify(p.features), JSON.stringify(p.plan_ids), p.active, p.sort, now()).run();
  return adminSiteBilling(request, env, h, siteId);
}

export async function adminDeletePack(request, env, h, siteId, id) {
  await h.requireAdmin(request, env);
  await ensurePacksSchema(env);
  const pack = await env.DB.prepare('SELECT id FROM billing_packs WHERE id = ? AND site_id = ?').bind(id, siteId).first();
  if (!pack) throw new HttpError(404, 'not_found', 'החבילה לא נמצאה');
  const sold = await env.DB.prepare("SELECT COUNT(*) AS n FROM pack_purchases WHERE pack_id = ? AND status = 'COMPLETED'").bind(id).first();
  if (sold.n > 0) throw new HttpError(400, 'sold', 'אי אפשר למחוק חבילה שכבר נקנתה. אפשר להשבית אותה');
  await env.DB.batch([
    env.DB.prepare("DELETE FROM pack_purchases WHERE pack_id = ? AND status != 'COMPLETED'").bind(id),
    env.DB.prepare('DELETE FROM billing_packs WHERE id = ?').bind(id),
  ]);
  return adminSiteBilling(request, env, h, siteId);
}
