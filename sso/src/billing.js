// Central billing: monthly subscriptions and coupon codes for every site, all through the one
// PayPal account of login.reembir.com (PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET).
//
// A plan with a price (Sites → site → Plans) gets a PayPal subscription plan automatically. Sites
// show the plans with the SDK (auth.billing.*); when someone subscribes, their plan on that site is
// set here with an expiry = the end of the paid month, and renewed on every payment. Sites only read
// user.plan / user.features as usual.
//
// Coupons (per site):
//   percent  value% off for `months` months (0 = for the whole subscription)
//   amount   value off the monthly price, same rule
//   trial    the first `months` months free (PayPal still asks for a card)
//   gift     `months` months of one plan without paying
import { HttpError, json, readJson, now, parseJsonField } from './lib.js';
import { paypalRequest } from './pay.js';

const DAY = 86400;
export const ppEnv = env => (env.PAYPAL_ENV === 'sandbox' ? 'sandbox' : 'live');
const paypalReady = env => !!(env.PAYPAL_CLIENT_ID && env.PAYPAL_CLIENT_SECRET);
const round2 = n => Math.round(n * 100) / 100;
const CUR = { ILS: '₪', USD: '$', EUR: '€' };
const cur = c => CUR[c] || (c ? c + ' ' : '');

let ready = false;
export async function ensureBillingSchema(env) {
  if (ready) return;
  await env.DB.batch([
    env.DB.prepare('CREATE TABLE IF NOT EXISTS billing_products (site_id TEXT, env TEXT, product_id TEXT, PRIMARY KEY (site_id, env))'),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS billing_plans (
      paypal_plan_id TEXT PRIMARY KEY, plan_id TEXT NOT NULL, env TEXT NOT NULL, price REAL NOT NULL, currency TEXT NOT NULL,
      coupon_code TEXT, created_at INTEGER NOT NULL)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS subscriptions (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, site_id TEXT NOT NULL, plan_id TEXT NOT NULL, coupon_code TEXT,
      status TEXT NOT NULL, env TEXT NOT NULL, price REAL, currency TEXT, period_start INTEGER, paid_until INTEGER,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, checked_at INTEGER NOT NULL)`),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS subscriptions_user ON subscriptions(user_id, site_id)'),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS coupons (
      site_id TEXT NOT NULL, code TEXT NOT NULL, type TEXT NOT NULL, value REAL NOT NULL DEFAULT 0, months INTEGER NOT NULL DEFAULT 0,
      plan_ids TEXT NOT NULL DEFAULT '[]', max_uses INTEGER NOT NULL DEFAULT 0, uses INTEGER NOT NULL DEFAULT 0,
      expires_at INTEGER, active INTEGER NOT NULL DEFAULT 1, note TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL,
      PRIMARY KEY (site_id, code))`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS coupon_redemptions (
      site_id TEXT NOT NULL, code TEXT NOT NULL, user_id TEXT NOT NULL, ts INTEGER NOT NULL, sub_id TEXT,
      PRIMARY KEY (site_id, code, user_id))`),
  ]);
  ready = true;
}

// ---------- PayPal ----------

async function pp(env, method, path, body) {
  const r = await paypalRequest(env, method, path, body);
  if (!r.ok) {
    console.error('PayPal', method, path, r.status, JSON.stringify(r.data).slice(0, 500));
    throw new HttpError(502, 'paypal_error', 'PayPal: ' + (r.data?.message || r.data?.details?.[0]?.description || r.status));
  }
  return r.data;
}

async function productFor(env, site) {
  const row = await env.DB.prepare('SELECT product_id FROM billing_products WHERE site_id = ? AND env = ?').bind(site.id, ppEnv(env)).first();
  if (row) return row.product_id;
  const p = await pp(env, 'POST', '/v1/catalogs/products', {
    name: String(site.name || site.id).slice(0, 120), description: String(site.description || site.name || site.id).slice(0, 250),
    type: 'SERVICE', category: 'SOFTWARE',
  });
  await env.DB.prepare('INSERT OR REPLACE INTO billing_products (site_id, env, product_id) VALUES (?, ?, ?)').bind(site.id, ppEnv(env), p.id).run();
  return p.id;
}

function cycles(offer, currency) {
  const price = v => ({ fixed_price: { value: String(v), currency_code: currency } });
  const month = { interval_unit: 'MONTH', interval_count: 1 };
  if (!offer.months) return [{ frequency: month, tenure_type: 'REGULAR', sequence: 1, total_cycles: 0, pricing_scheme: price(offer.first_price) }];
  const trial = { frequency: month, tenure_type: 'TRIAL', sequence: 1, total_cycles: offer.months };
  if (offer.first_price > 0) trial.pricing_scheme = price(offer.first_price);
  return [trial, { frequency: month, tenure_type: 'REGULAR', sequence: 2, total_cycles: 0, pricing_scheme: price(offer.regular_price) }];
}

// The PayPal plan for a site plan at today's price (optionally with a coupon); created on first use.
async function paypalPlanFor(env, site, plan, coupon) {
  const code = coupon ? coupon.code : null;
  const row = await env.DB.prepare(
    `SELECT paypal_plan_id FROM billing_plans WHERE plan_id = ? AND env = ? AND price = ? AND currency = ?
     AND ${code ? 'coupon_code = ?' : 'coupon_code IS NULL'}`,
  ).bind(...[plan.id, ppEnv(env), plan.price, plan.currency, ...(code ? [code] : [])]).first();
  if (row) return row.paypal_plan_id;
  const offer = coupon ? couponOffer(coupon, plan) : { first_price: plan.price, regular_price: plan.price, months: 0 };
  const created = await pp(env, 'POST', '/v1/billing/plans', {
    product_id: await productFor(env, site),
    name: (plan.name + (code ? ` (${code})` : '')).slice(0, 127),
    description: (coupon ? couponLabel(coupon, plan.currency) : site.name + ' - ' + plan.name).slice(0, 127),
    status: 'ACTIVE',
    billing_cycles: cycles(offer, plan.currency),
    payment_preferences: { auto_bill_outstanding: true, payment_failure_threshold: 1 },
  });
  await env.DB.prepare(
    'INSERT INTO billing_plans (paypal_plan_id, plan_id, env, price, currency, coupon_code, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).bind(created.id, plan.id, ppEnv(env), plan.price, plan.currency, code, now()).run();
  return created.id;
}

// ---------- plans ----------

function planRow(p) {
  return { ...p, features: parseJsonField(p.features, {}), price: p.price || 0, currency: p.currency || 'ILS', public: p.public !== 0 };
}

async function sitePlans(env, siteId) {
  const { results } = await env.DB.prepare('SELECT * FROM plans WHERE site_id = ? ORDER BY sort, name').bind(siteId).all();
  return results.map(planRow);
}

const paidPlans = plans => plans.filter(p => p.price > 0);

// ---------- subscriptions ----------

function subFromPaypal(s, prev) {
  const next = Math.floor((Date.parse(s.billing_info?.next_billing_time || '') || 0) / 1000) || null;
  const last = Math.floor((Date.parse(s.billing_info?.last_payment?.time || '') || 0) / 1000) || null;
  const start = last || Math.floor((Date.parse(s.start_time || '') || Date.now()) / 1000);
  let paidUntil = prev?.paid_until || null;
  if (s.status === 'ACTIVE' && next) paidUntil = next + DAY; // a day of grace for the renewal charge
  if (!paidUntil) paidUntil = start + 31 * DAY;
  return { status: s.status, period_start: s.status === 'ACTIVE' ? start : prev?.period_start || start, paid_until: paidUntil };
}

async function setAccessPlan(env, userId, siteId, planId, expiresAt) {
  await env.DB.prepare(
    `INSERT INTO access (user_id, site_id, status, plan_id, plan_expires_at, created_at) VALUES (?, ?, 'active', ?, ?, ?)
     ON CONFLICT(user_id, site_id) DO UPDATE SET plan_id = excluded.plan_id, plan_expires_at = excluded.plan_expires_at`,
  ).bind(userId, siteId, planId, expiresAt, now()).run();
}

async function saveSub(env, sub) {
  await env.DB.prepare(
    `INSERT INTO subscriptions (id, user_id, site_id, plan_id, coupon_code, status, env, price, currency, period_start, paid_until, created_at, updated_at, checked_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET status = excluded.status, period_start = excluded.period_start, paid_until = excluded.paid_until,
       updated_at = excluded.updated_at, checked_at = excluded.checked_at`,
  ).bind(sub.id, sub.user_id, sub.site_id, sub.plan_id, sub.coupon_code || null, sub.status, sub.env, sub.price ?? null, sub.currency || null,
    sub.period_start, sub.paid_until, sub.created_at || now(), now(), now()).run();
}

// Re-reads a subscription from PayPal and, if it renewed, moves the user's plan expiry forward —
// unless the admin has since put the user on a different plan by hand.
async function refreshSub(env, sub) {
  const s = await pp(env, 'GET', '/v1/billing/subscriptions/' + encodeURIComponent(sub.id));
  const next = { ...sub, ...subFromPaypal(s, sub) };
  await saveSub(env, next);
  if (next.paid_until !== sub.paid_until) {
    await env.DB.prepare('UPDATE access SET plan_expires_at = ? WHERE user_id = ? AND site_id = ? AND plan_id = ?')
      .bind(next.paid_until, sub.user_id, sub.site_id, sub.plan_id).run();
  }
  return next;
}

/** Called before a site gets the user's plan (sign-in, userinfo): renews a subscription that is due. */
export async function refreshIfDue(env, userId, siteId) {
  if (!paypalReady(env)) return;
  await ensureBillingSchema(env);
  const sub = await env.DB.prepare(
    `SELECT * FROM subscriptions WHERE user_id = ? AND site_id = ? AND status = 'ACTIVE' AND env = ?
     AND paid_until < ? AND checked_at < ? ORDER BY created_at DESC LIMIT 1`,
  ).bind(userId, siteId, ppEnv(env), now() + 6 * 3600, now() - 3600).first();
  if (!sub) return;
  try { await refreshSub(env, sub); } catch (e) { console.error('refresh subscription', sub.id, e.message); }
}

/** Daily cron: renew every subscription that is about to run out. */
export async function refreshDue(env) {
  if (!paypalReady(env)) return;
  await ensureBillingSchema(env);
  const { results } = await env.DB.prepare(
    `SELECT * FROM subscriptions WHERE status = 'ACTIVE' AND env = ? AND paid_until < ? AND checked_at < ? LIMIT 200`,
  ).bind(ppEnv(env), now() + 2 * DAY, now() - 3600).all();
  for (const sub of results) {
    try { await refreshSub(env, sub); } catch (e) { console.error('refresh subscription', sub.id, e.message); }
  }
}

/** For the userinfo payload: the user's current subscription on the site, if any. */
export async function subscriptionView(env, userId, siteId) {
  await ensureBillingSchema(env);
  const sub = await env.DB.prepare(
    `SELECT id, plan_id, status, paid_until, coupon_code FROM subscriptions WHERE user_id = ? AND site_id = ?
     AND (status = 'ACTIVE' OR (status = 'CANCELLED' AND paid_until > ?)) ORDER BY created_at DESC LIMIT 1`,
  ).bind(userId, siteId, now()).first();
  return sub ? { id: sub.id, plan_id: sub.plan_id, status: sub.status, paid_until: sub.paid_until, coupon: sub.coupon_code } : null;
}

// ---------- coupons ----------

export const COUPON_TYPES = ['percent', 'amount', 'trial', 'gift'];

function couponRow(r) {
  return r && { ...r, plan_ids: parseJsonField(r.plan_ids, []), active: !!r.active };
}

export function couponOffer(c, plan) {
  if (!plan || !(plan.price > 0) || c.type === 'gift' || !c.plan_ids.includes(plan.id)) return null;
  let first;
  if (c.type === 'percent') first = round2(plan.price * (1 - c.value / 100));
  else if (c.type === 'amount') first = round2(Math.max(0, plan.price - c.value));
  else first = 0;
  if (!c.months && first <= 0) return null;
  return { first_price: first, months: c.months, regular_price: c.months ? plan.price : first };
}

export function couponLabel(c, currency, planName) {
  const period = m => (m === 1 ? 'לחודש הראשון' : `ל-${m} החודשים הראשונים`);
  switch (c.type) {
    case 'percent': return `${c.value}% הנחה ${c.months ? period(c.months) : 'לכל תקופת המנוי'}`;
    case 'amount': return `${cur(currency)}${c.value} הנחה בחודש ${c.months ? period(c.months) : 'לכל תקופת המנוי'}`;
    case 'trial': return c.months === 1 ? 'חודש ראשון חינם' : `${c.months} חודשים ראשונים חינם`;
    case 'gift': return `מתנה: ${c.months === 1 ? 'חודש' : c.months + ' חודשים'}${planName ? ' בתוכנית ' + planName : ''}, בלי תשלום`;
    default: return '';
  }
}

function couponProblem(c) {
  if (!c || !c.active) return 'הקוד לא קיים או לא פעיל';
  if (c.expires_at && c.expires_at < now()) return 'תוקף הקוד פג';
  if (c.max_uses && c.uses >= c.max_uses) return 'הקוד כבר נוצל עד הסוף';
  return null;
}

async function getCoupon(env, siteId, code) {
  return couponRow(await env.DB.prepare('SELECT * FROM coupons WHERE site_id = ? AND code = ?')
    .bind(siteId, String(code || '').trim().toUpperCase()).first());
}

async function usableCoupon(env, siteId, code, userId) {
  const c = await getCoupon(env, siteId, code);
  const problem = couponProblem(c);
  if (problem) throw new HttpError(400, 'bad_coupon', problem);
  const used = await env.DB.prepare('SELECT 1 FROM coupon_redemptions WHERE site_id = ? AND code = ? AND user_id = ?').bind(siteId, c.code, userId).first();
  if (used) throw new HttpError(400, 'bad_coupon', 'כבר השתמשת בקוד הזה');
  return c;
}

async function redeem(env, siteId, code, userId, subId) {
  const r = await env.DB.prepare('INSERT OR IGNORE INTO coupon_redemptions (site_id, code, user_id, ts, sub_id) VALUES (?, ?, ?, ?, ?)')
    .bind(siteId, code, userId, now(), subId || null).run();
  if (!r.meta.changes) {
    const prev = await env.DB.prepare('SELECT sub_id FROM coupon_redemptions WHERE site_id = ? AND code = ? AND user_id = ?').bind(siteId, code, userId).first();
    return !!subId && prev?.sub_id === subId;
  }
  await env.DB.prepare('UPDATE coupons SET uses = uses + 1 WHERE site_id = ? AND code = ?').bind(siteId, code).run();
  return true;
}

function validateCoupon(input, plans) {
  const code = String(input.code || '').trim().toUpperCase();
  if (!/^[A-Z0-9_-]{3,30}$/.test(code)) throw new HttpError(400, 'bad_coupon', 'קוד: 3-30 תווים, אותיות באנגלית, ספרות, מקף או קו תחתון');
  const type = input.type;
  if (!COUPON_TYPES.includes(type)) throw new HttpError(400, 'bad_coupon', 'סוג קופון לא מוכר');
  const value = Number(input.value) || 0;
  const months = Math.round(Number(input.months) || 0);
  const paid = paidPlans(plans).map(p => p.id);
  const all = plans.map(p => p.id);
  let planIds = (Array.isArray(input.plan_ids) ? input.plan_ids : []).filter(id => (type === 'gift' ? all : paid).includes(id));
  const bad = m => { throw new HttpError(400, 'bad_coupon', m); };
  if (type === 'percent' && !(value > 0 && value <= 100)) bad('אחוז ההנחה צריך להיות בין 1 ל-100');
  if (type === 'amount' && !(value > 0)) bad('סכום ההנחה צריך להיות גדול מ-0');
  if ((type === 'percent' || type === 'amount') && (months < 0 || months > 24)) bad('מספר החודשים: 0 (לתמיד) עד 24');
  if (type === 'percent' && value === 100 && months === 0) bad('100% לתמיד זה מתנה. בחרו "מתנה" עם מספר חודשים');
  if (type === 'trial' && (months < 1 || months > 12)) bad('חודשים חינם: 1 עד 12');
  if (type === 'gift' && (months < 1 || months > 24)) bad('מתנה: 1 עד 24 חודשים');
  if (type === 'gift' && planIds.length !== 1) bad('במתנה בוחרים תוכנית אחת');
  if (type !== 'gift' && !planIds.length) planIds = paid;
  if (type !== 'gift' && !planIds.length) bad('אין לאתר תוכניות בתשלום. קבעו מחיר לתוכנית קודם');
  const expiresAt = input.expires_at ? Math.floor(Number(input.expires_at) / (Number(input.expires_at) > 1e11 ? 1000 : 1)) : null;
  if (expiresAt !== null && !(expiresAt > now())) bad('תאריך התפוגה כבר עבר');
  return {
    code, type, value: type === 'trial' || type === 'gift' ? 0 : value, months, plan_ids: planIds,
    max_uses: Math.max(0, Math.round(Number(input.max_uses) || 0)), expires_at: expiresAt, note: String(input.note || '').slice(0, 200),
  };
}

// ---------- site-facing API (bearer token of the site, CORS) ----------

/** GET /api/billing/catalog?client_id=… — public: the plans a site sells, ready for PayPal buttons. */
export async function catalog(request, env, h) {
  await ensureBillingSchema(env);
  const site = await h.getSite(env, new URL(request.url).searchParams.get('client_id') || '');
  if (!site) throw new HttpError(404, 'not_found', 'האתר לא מוכר');
  const plans = await sitePlans(env, site.id);
  const forSale = paidPlans(plans).filter(p => p.public);
  const out = [];
  for (const p of forSale) {
    let paypalPlanId = null;
    if (paypalReady(env)) {
      try { paypalPlanId = await paypalPlanFor(env, site, p, null); } catch (e) { console.error('paypal plan', p.id, e.message); }
    }
    out.push({ id: p.id, name: p.name, description: p.description || '', price: p.price, currency: p.currency, features: p.features, sort: p.sort, paypal_plan_id: paypalPlanId });
  }
  const def = plans.find(p => p.id === site.default_plan);
  return json({
    site: { id: site.id, name: site.name },
    paypal: paypalReady(env) ? { client_id: env.PAYPAL_CLIENT_ID, env: ppEnv(env) } : null,
    currency: forSale[0]?.currency || 'ILS',
    free: def ? { id: def.id, name: def.name, description: def.description || '', features: def.features } : null,
    plans: out,
  });
}

export async function billingMe(request, env, h) {
  const session = await h.requireSiteSession(request, env);
  return json({ subscription: await subscriptionView(env, session.id, session.client_id) });
}

export async function checkCoupon(request, env, h) {
  const session = await h.requireSiteSession(request, env);
  await ensureBillingSchema(env);
  const site = await h.getSite(env, session.client_id);
  const c = await usableCoupon(env, site.id, (await readJson(request)).code, session.id);
  const plans = await sitePlans(env, site.id);
  if (c.type === 'gift') {
    const p = plans.find(x => x.id === c.plan_ids[0]);
    return json({ code: c.code, type: c.type, label: couponLabel(c, p?.currency, p?.name), plan_id: c.plan_ids[0], months: c.months });
  }
  if (!paypalReady(env)) throw new HttpError(501, 'paypal_not_configured', 'התשלומים עוד לא הופעלו');
  const offers = {};
  for (const p of plans) {
    const o = couponOffer(c, p);
    if (o) offers[p.id] = { ...o, currency: p.currency, paypal_plan_id: await paypalPlanFor(env, site, p, c) };
  }
  if (!Object.keys(offers).length) throw new HttpError(400, 'bad_coupon', 'הקוד לא מתאים לאף תוכנית');
  return json({ code: c.code, type: c.type, label: couponLabel(c, Object.values(offers)[0].currency), offers });
}

export async function redeemGift(request, env, h) {
  const session = await h.requireSiteSession(request, env);
  await ensureBillingSchema(env);
  const site = await h.getSite(env, session.client_id);
  const c = await usableCoupon(env, site.id, (await readJson(request)).code, session.id);
  if (c.type !== 'gift') throw new HttpError(400, 'bad_coupon', 'הקוד הזה הוא הנחה למנוי. בחרו תוכנית');
  const planId = c.plan_ids[0];
  if (await subscriptionView(env, session.id, site.id)) throw new HttpError(400, 'has_plan', 'כבר יש לך מנוי בתשלום');
  const row = await env.DB.prepare('SELECT plan_id, plan_expires_at FROM access WHERE user_id = ? AND site_id = ?').bind(session.id, site.id).first();
  const current = row && row.plan_id && (!row.plan_expires_at || row.plan_expires_at > now()) ? row : null;
  if (current && current.plan_id !== planId) {
    const plans = await sitePlans(env, site.id);
    const rank = id => plans.findIndex(p => p.id === id);
    if (!current.plan_expires_at || rank(current.plan_id) > rank(planId)) throw new HttpError(400, 'has_plan', 'כבר יש לך תוכנית גבוהה יותר');
  }
  if (current && current.plan_id === planId && !current.plan_expires_at) throw new HttpError(400, 'has_plan', 'כבר יש לך את התוכנית הזו');
  if (!(await redeem(env, site.id, c.code, session.id, null))) throw new HttpError(400, 'bad_coupon', 'כבר השתמשת בקוד הזה');
  const base = current && current.plan_id === planId ? current.plan_expires_at : now();
  const d = new Date(base * 1000);
  d.setUTCMonth(d.getUTCMonth() + c.months);
  await setAccessPlan(env, session.id, site.id, planId, Math.floor(d.getTime() / 1000));
  return json(await h.siteUserPayload(env, session, site));
}

export async function activate(request, env, h) {
  const session = await h.requireSiteSession(request, env);
  await ensureBillingSchema(env);
  const site = await h.getSite(env, session.client_id);
  const id = String((await readJson(request)).subscription_id || '');
  if (!/^[A-Z0-9-]{5,40}$/i.test(id)) throw new HttpError(400, 'bad_request', 'מזהה מנוי לא תקין');

  const s = await pp(env, 'GET', '/v1/billing/subscriptions/' + encodeURIComponent(id));
  if (s.custom_id !== `${site.id}:${session.id}`) throw new HttpError(403, 'forbidden', 'המנוי הזה לא שייך לחשבון שלך');
  const bp = await env.DB.prepare('SELECT * FROM billing_plans WHERE paypal_plan_id = ?').bind(s.plan_id).first();
  const plan = bp && (await h.getPlan(env, bp.plan_id));
  if (!plan || plan.site_id !== site.id) throw new HttpError(400, 'unknown_plan', 'תוכנית לא מוכרת');
  if (!['ACTIVE', 'APPROVED'].includes(s.status)) throw new HttpError(400, 'not_active', 'המנוי עוד לא פעיל ב-PayPal. נסו לרענן בעוד דקה');

  if (bp.coupon_code && !(await redeem(env, site.id, bp.coupon_code, session.id, s.id))) {
    await paypalRequest(env, 'POST', `/v1/billing/subscriptions/${encodeURIComponent(s.id)}/cancel`, { reason: 'Coupon already used' });
    throw new HttpError(400, 'coupon_used', 'כבר השתמשת בקוד הקופון הזה. המנוי בוטל');
  }

  // Switching plans: stop billing the previous subscription on this site.
  const { results: old } = await env.DB.prepare(
    "SELECT id FROM subscriptions WHERE user_id = ? AND site_id = ? AND status = 'ACTIVE' AND id != ?",
  ).bind(session.id, site.id, s.id).all();
  for (const o of old) {
    const r = await paypalRequest(env, 'POST', `/v1/billing/subscriptions/${encodeURIComponent(o.id)}/cancel`, { reason: 'Switched plan' });
    if (r.ok || r.status === 422) await env.DB.prepare("UPDATE subscriptions SET status = 'CANCELLED', updated_at = ? WHERE id = ?").bind(now(), o.id).run();
  }

  const prev = await env.DB.prepare('SELECT * FROM subscriptions WHERE id = ?').bind(s.id).first();
  const sub = {
    id: s.id, user_id: session.id, site_id: site.id, plan_id: plan.id, coupon_code: bp.coupon_code, env: ppEnv(env),
    price: bp.price, currency: bp.currency, created_at: prev?.created_at, ...subFromPaypal({ ...s, status: 'ACTIVE' }, prev),
  };
  await saveSub(env, sub);
  await setAccessPlan(env, session.id, site.id, plan.id, sub.paid_until);
  return json(await h.siteUserPayload(env, session, site));
}

export async function cancel(request, env, h) {
  const session = await h.requireSiteSession(request, env);
  await ensureBillingSchema(env);
  const sub = await env.DB.prepare("SELECT * FROM subscriptions WHERE user_id = ? AND site_id = ? AND status = 'ACTIVE' ORDER BY created_at DESC LIMIT 1")
    .bind(session.id, session.client_id).first();
  if (!sub) throw new HttpError(400, 'no_subscription', 'אין מנוי פעיל');
  await cancelSubscription(env, sub, 'Cancelled by the user');
  const site = await h.getSite(env, session.client_id);
  return json(await h.siteUserPayload(env, session, site));
}

async function cancelSubscription(env, sub, reason) {
  const r = await paypalRequest(env, 'POST', `/v1/billing/subscriptions/${encodeURIComponent(sub.id)}/cancel`, { reason });
  if (!r.ok && r.status !== 422) throw new HttpError(502, 'paypal_error', 'PayPal: ' + (r.data?.message || r.status));
  // The plan keeps working until the end of the month that was paid for (the access expiry).
  await env.DB.prepare("UPDATE subscriptions SET status = 'CANCELLED', updated_at = ? WHERE id = ?").bind(now(), sub.id).run();
}

// ---------- admin ----------

/** For the main overview: active subscriptions and monthly revenue per currency. */
export async function summary(env) {
  await ensureBillingSchema(env);
  const { results } = await env.DB.prepare(
    "SELECT site_id, currency, COUNT(*) AS n, SUM(price) AS mrr FROM subscriptions WHERE status = 'ACTIVE' AND env = ? GROUP BY site_id, currency",
  ).bind(ppEnv(env)).all();
  return { env: ppEnv(env), configured: paypalReady(env), by_site: results };
}

export async function adminSiteBilling(request, env, h, siteId) {
  await h.requireAdmin(request, env);
  await ensureBillingSchema(env);
  const site = await h.getSite(env, siteId);
  if (!site) throw new HttpError(404, 'not_found', 'האתר לא נמצא');
  const plans = await sitePlans(env, siteId);
  const [subs, coupons, counts] = await env.DB.batch([
    env.DB.prepare(
      `SELECT s.id, s.plan_id, s.status, s.paid_until, s.coupon_code, s.price, s.currency, s.created_at, s.env, u.id AS user_id, u.email, u.name
       FROM subscriptions s JOIN users u ON u.id = s.user_id WHERE s.site_id = ? ORDER BY s.created_at DESC LIMIT 200`,
    ).bind(siteId),
    env.DB.prepare('SELECT * FROM coupons WHERE site_id = ? ORDER BY created_at DESC').bind(siteId),
    env.DB.prepare('SELECT plan_id, COUNT(*) AS n FROM access WHERE site_id = ? AND plan_id IS NOT NULL AND (plan_expires_at IS NULL OR plan_expires_at > ?) GROUP BY plan_id').bind(siteId, now()),
  ]);
  const active = subs.results.filter(s => s.status === 'ACTIVE' && s.env === ppEnv(env));
  const byPlan = Object.fromEntries(counts.results.map(r => [r.plan_id, r.n]));
  // Everyone without a (running) plan of their own is on the site's default plan.
  if (site.default_plan) {
    const total = (await env.DB.prepare("SELECT COUNT(*) AS n FROM access WHERE site_id = ? AND status = 'active'").bind(siteId).first()).n;
    const explicit = counts.results.filter(r => r.plan_id !== site.default_plan).reduce((a, r) => a + r.n, 0);
    byPlan[site.default_plan] = Math.max(0, total - explicit);
  }
  const planName = id => (plans.find(p => p.id === id) || { name: id }).name;
  return json({
    paypal: { configured: paypalReady(env), env: ppEnv(env) },
    plans: plans.map(p => ({ ...p, users: byPlan[p.id] || 0, subscribers: active.filter(s => s.plan_id === p.id).length })),
    stats: {
      active: active.length,
      mrr: Object.entries(active.reduce((a, s) => ({ ...a, [s.currency || 'ILS']: round2((a[s.currency || 'ILS'] || 0) + (s.price || 0)) }), {}))
        .map(([c, v]) => cur(c) + v).join(' + ') || cur(plans.find(p => p.price > 0)?.currency || 'ILS') + '0',
      cancelled: subs.results.filter(s => s.status === 'CANCELLED' && s.paid_until > now()).length,
    },
    subscriptions: subs.results.map(s => ({ ...s, plan_name: planName(s.plan_id) })),
    coupons: coupons.results.map(r => {
      const c = couponRow(r);
      const p = plans.find(x => x.id === c.plan_ids[0]);
      return { ...c, label: couponLabel(c, p?.currency || 'ILS', c.type === 'gift' ? p?.name : null), plan_names: c.plan_ids.map(planName) };
    }),
  });
}

export async function adminCreateCoupon(request, env, h, siteId) {
  await h.requireAdmin(request, env);
  await ensureBillingSchema(env);
  if (!(await h.getSite(env, siteId))) throw new HttpError(404, 'not_found', 'האתר לא נמצא');
  const c = validateCoupon(await readJson(request), await sitePlans(env, siteId));
  const r = await env.DB.prepare(
    `INSERT OR IGNORE INTO coupons (site_id, code, type, value, months, plan_ids, max_uses, uses, expires_at, active, note, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, 1, ?, ?)`,
  ).bind(siteId, c.code, c.type, c.value, c.months, JSON.stringify(c.plan_ids), c.max_uses, c.expires_at, c.note, now()).run();
  if (!r.meta.changes) throw new HttpError(400, 'exists', 'כבר קיים קוד כזה באתר');
  return adminSiteBilling(request, env, h, siteId);
}

export async function adminCouponAction(request, env, h, siteId, code, action) {
  await h.requireAdmin(request, env);
  await ensureBillingSchema(env);
  if (action === 'delete') {
    const c = await getCoupon(env, siteId, code);
    if (!c) throw new HttpError(404, 'not_found', 'הקוד לא נמצא');
    if (c.uses > 0) throw new HttpError(400, 'used', 'אי אפשר למחוק קוד שכבר נוצל. אפשר להשבית אותו');
    await env.DB.prepare('DELETE FROM coupons WHERE site_id = ? AND code = ?').bind(siteId, c.code).run();
  } else {
    await env.DB.prepare('UPDATE coupons SET active = ? WHERE site_id = ? AND code = ?').bind(action === 'enable' ? 1 : 0, siteId, code).run();
  }
  return adminSiteBilling(request, env, h, siteId);
}

export async function adminCancelSubscription(request, env, h, id) {
  await h.requireAdmin(request, env);
  await ensureBillingSchema(env);
  const sub = await env.DB.prepare('SELECT * FROM subscriptions WHERE id = ?').bind(id).first();
  if (!sub) throw new HttpError(404, 'not_found', 'המנוי לא נמצא');
  if (sub.status === 'ACTIVE') await cancelSubscription(env, sub, 'Cancelled by the admin');
  return adminSiteBilling(request, env, h, sub.site_id);
}
