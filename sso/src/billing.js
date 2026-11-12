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
//
// One-time packs on top of a plan (e.g. extra minutes) are in packs.js. Partner codes (affiliate.js)
// work like coupons of the type the site chose for them.
import { HttpError, json, readJson, now, parseJsonField } from './lib.js';
import { paypalRequest } from './pay.js';
import { catalogPacks, adminPacksData } from './packs.js';
import * as affiliate from './affiliate.js';

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
    // Every subscription a user started at PayPal (the SDK reports it before they approve): if the page
    // never got to /activate (closed tab, lost connection), the payment is matched to the plan later.
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS subscription_starts (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, site_id TEXT NOT NULL, created_at INTEGER NOT NULL,
      checked_at INTEGER NOT NULL DEFAULT 0, done INTEGER NOT NULL DEFAULT 0)`),
    // What PayPal tells us (webhook): payments with their fee, failures, cancellations. The revenue stats come from here.
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS paypal_events (
      id TEXT PRIMARY KEY, type TEXT NOT NULL, sub_id TEXT, user_id TEXT, site_id TEXT,
      amount REAL, fee REAL, currency TEXT, env TEXT, ts INTEGER NOT NULL)`),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS paypal_events_ts ON paypal_events(ts)'),
    env.DB.prepare('CREATE TABLE IF NOT EXISTS paypal_state (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL)'),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS coupon_redemptions (
      site_id TEXT NOT NULL, code TEXT NOT NULL, user_id TEXT NOT NULL, ts INTEGER NOT NULL, sub_id TEXT,
      PRIMARY KEY (site_id, code, user_id))`),
  ]);
  // offer: what a coupon plan was made for, so a partner code whose discount changed gets a new one.
  try {
    await env.DB.prepare('ALTER TABLE billing_plans ADD COLUMN offer TEXT').run();
  } catch (e) {
    if (!/duplicate column/i.test(String(e?.message || e))) throw e;
  }
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
  const offerKey = coupon?.offer_key || '';
  const row = await env.DB.prepare(
    `SELECT paypal_plan_id FROM billing_plans WHERE plan_id = ? AND env = ? AND price = ? AND currency = ?
     AND ${code ? 'coupon_code = ?' : 'coupon_code IS NULL'} AND COALESCE(offer, ?) = ?`,
  ).bind(...[plan.id, ppEnv(env), plan.price, plan.currency, ...(code ? [code] : []), offerKey, offerKey]).first();
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
    'INSERT INTO billing_plans (paypal_plan_id, plan_id, env, price, currency, coupon_code, created_at, offer) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  ).bind(created.id, plan.id, ppEnv(env), plan.price, plan.currency, code, now(), offerKey).run();
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
export async function refreshIfDue(env, userId, siteId, h) {
  if (!paypalReady(env)) return;
  await ensureBillingSchema(env);
  if (h) await syncStarted(env, h, userId, siteId);
  const sub = await env.DB.prepare(
    `SELECT * FROM subscriptions WHERE user_id = ? AND site_id = ? AND status = 'ACTIVE' AND env = ?
     AND paid_until < ? AND checked_at < ? ORDER BY created_at DESC LIMIT 1`,
  ).bind(userId, siteId, ppEnv(env), now() + 6 * 3600, now() - 3600).first();
  if (!sub) return;
  try { await refreshSub(env, sub); } catch (e) { console.error('refresh subscription', sub.id, e.message); }
}

/** Daily cron: renew every subscription that is about to run out. */
export async function refreshDue(env, h) {
  if (!paypalReady(env)) return;
  await ensureBillingSchema(env);
  if (h) { try { await reconcile(env, h); } catch (e) { console.error('reconcile', e); } }
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
  const c = couponRow(await env.DB.prepare('SELECT * FROM coupons WHERE site_id = ? AND code = ?')
    .bind(siteId, String(code || '').trim().toUpperCase()).first());
  return c || (await affiliate.affiliateCoupon(env, siteId, code));
}

async function usableCoupon(env, siteId, code, userId) {
  const c = await getCoupon(env, siteId, code);
  const problem = couponProblem(c);
  if (problem) throw new HttpError(400, 'bad_coupon', problem);
  if (c.affiliate) await affiliate.assertReferredBy(env, siteId, userId, c);
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

export function validateCoupon(input, plans) {
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
    packs: await catalogPacks(env, site.id),
    // A one-time gift for new users, e.g. { minutes: 10 } (dashboard → Plans).
    welcome: await affiliate.welcomeFeatures(env, site.id),
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
  if (c.type === 'referral') return affiliate.referralCheck(env, site, c);
  const plans = await sitePlans(env, site.id);
  const partner = c.affiliate ? { partner: c.affiliate.name } : {};
  if (c.type === 'gift') {
    const p = plans.find(x => x.id === c.plan_ids[0]);
    return json({ code: c.code, type: c.type, label: couponLabel(c, p?.currency, p?.name), plan_id: c.plan_ids[0], months: c.months, ...partner });
  }
  if (!paypalReady(env)) throw new HttpError(501, 'paypal_not_configured', 'התשלומים עוד לא הופעלו');
  const offers = {};
  for (const p of plans) {
    const o = couponOffer(c, p);
    if (o) offers[p.id] = { ...o, currency: p.currency, paypal_plan_id: await paypalPlanFor(env, site, p, c) };
  }
  if (!Object.keys(offers).length) throw new HttpError(400, 'bad_coupon', 'הקוד לא מתאים לאף תוכנית');
  return json({ code: c.code, type: c.type, label: couponLabel(c, Object.values(offers)[0].currency), offers, ...partner });
}

export async function redeemGift(request, env, h) {
  const session = await h.requireSiteSession(request, env);
  await ensureBillingSchema(env);
  const site = await h.getSite(env, session.client_id);
  const c = await usableCoupon(env, site.id, (await readJson(request)).code, session.id);
  if (c.type === 'referral') return affiliate.claimReferral(env, h, session, site, c);
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
  await applySubscription(env, h, s, session.id, site, { strict: true });
  return json(await h.siteUserPayload(env, session, site));
}

/** The SDK reports a subscription as soon as PayPal creates it (before approval), as a safety net. */
export async function started(request, env, h) {
  const session = await h.requireSiteSession(request, env);
  await ensureBillingSchema(env);
  const id = String((await readJson(request)).subscription_id || '');
  if (!/^[A-Z0-9-]{5,40}$/i.test(id)) throw new HttpError(400, 'bad_request', 'מזהה מנוי לא תקין');
  await env.DB.prepare('INSERT OR IGNORE INTO subscription_starts (id, user_id, site_id, created_at) VALUES (?, ?, ?, ?)')
    .bind(id, session.id, session.client_id, now()).run();
  return json({ ok: true });
}

// Puts the user on the plan of a PayPal subscription that is ACTIVE/APPROVED. strict (the user's own
// checkout): a coupon or partner code they may not use cancels the subscription. From the safety net or
// the admin, the payment already happened, so the plan is given anyway.
async function applySubscription(env, h, s, userId, site, { strict = false } = {}) {
  const bp = await env.DB.prepare('SELECT * FROM billing_plans WHERE paypal_plan_id = ?').bind(s.plan_id).first();
  const plan = bp && (await h.getPlan(env, bp.plan_id));
  if (!plan || plan.site_id !== site.id) throw new HttpError(400, 'unknown_plan', 'תוכנית לא מוכרת');
  if (!['ACTIVE', 'APPROVED'].includes(s.status)) throw new HttpError(400, 'not_active', 'המנוי עוד לא פעיל ב-PayPal. נסו לרענן בעוד דקה');

  // Already applied (the webhook got here first, or the page retried): nothing to redeem or cancel again.
  const already = await env.DB.prepare('SELECT 1 FROM subscriptions WHERE id = ? AND user_id = ?').bind(s.id, userId).first();
  if (already) {
    // fall through to refresh the dates and the plan
  } else if (strict) {
    // A partner's discount: only for users who came through that partner's link.
    const partnerCoupon = bp.coupon_code ? await getCoupon(env, site.id, bp.coupon_code) : null;
    if (partnerCoupon?.affiliate) {
      try {
        await affiliate.assertReferredBy(env, site.id, userId, partnerCoupon);
      } catch (e) {
        await paypalRequest(env, 'POST', `/v1/billing/subscriptions/${encodeURIComponent(s.id)}/cancel`, { reason: 'Partner code not allowed' });
        throw new HttpError(400, 'bad_coupon', e.message + '. המנוי בוטל');
      }
    }
    if (bp.coupon_code && !(await redeem(env, site.id, bp.coupon_code, userId, s.id))) {
      await paypalRequest(env, 'POST', `/v1/billing/subscriptions/${encodeURIComponent(s.id)}/cancel`, { reason: 'Coupon already used' });
      throw new HttpError(400, 'coupon_used', 'כבר השתמשת בקוד הקופון הזה. המנוי בוטל');
    }
  } else if (bp.coupon_code) {
    await redeem(env, site.id, bp.coupon_code, userId, s.id).catch(() => false);
  }

  // Switching plans: stop billing the previous subscription on this site.
  const { results: old } = await env.DB.prepare(
    "SELECT id FROM subscriptions WHERE user_id = ? AND site_id = ? AND status = 'ACTIVE' AND id != ?",
  ).bind(userId, site.id, s.id).all();
  for (const o of old) {
    const r = await paypalRequest(env, 'POST', `/v1/billing/subscriptions/${encodeURIComponent(o.id)}/cancel`, { reason: 'Switched plan' });
    if (r.ok || r.status === 422) await env.DB.prepare("UPDATE subscriptions SET status = 'CANCELLED', updated_at = ? WHERE id = ?").bind(now(), o.id).run();
  }

  const prev = await env.DB.prepare('SELECT * FROM subscriptions WHERE id = ?').bind(s.id).first();
  const sub = {
    id: s.id, user_id: userId, site_id: site.id, plan_id: plan.id, coupon_code: bp.coupon_code, env: ppEnv(env),
    price: bp.price, currency: bp.currency, created_at: prev?.created_at, ...subFromPaypal({ ...s, status: 'ACTIVE' }, prev),
  };
  await saveSub(env, sub);
  await setAccessPlan(env, userId, site.id, plan.id, sub.paid_until);
  await env.DB.prepare('UPDATE subscription_starts SET done = 1 WHERE id = ?').bind(s.id).run();
  // Partner program: the referral's payment can reward the partner.
  if (!prev) { try { await affiliate.onPaid(env, site.id, userId); } catch (e) { console.error('referral', e); } }
  return { sub, plan };
}

// The custom_id the SDK puts on a subscription: "<site id>:<user id>".
function ownerOf(s) {
  const i = String(s.custom_id || '').indexOf(':');
  return i > 0 ? { siteId: s.custom_id.slice(0, i), userId: s.custom_id.slice(i + 1) } : null;
}

// Safety net: subscriptions that were started but never activated. Checked at PayPal at most once a
// minute each (for one user when their site asks for them, for everyone in the daily cron), for a week.
export async function syncStarted(env, h, userId, siteId) {
  if (!paypalReady(env)) return [];
  await ensureBillingSchema(env);
  const t = now();
  const q = userId
    ? env.DB.prepare('SELECT * FROM subscription_starts WHERE done = 0 AND user_id = ? AND site_id = ? AND created_at > ? AND created_at < ? AND checked_at < ? LIMIT 5')
      .bind(userId, siteId, t - 7 * DAY, t - 20, t - 60)
    : env.DB.prepare('SELECT * FROM subscription_starts WHERE done = 0 AND created_at > ? AND checked_at < ? LIMIT 100').bind(t - 7 * DAY, t - 3600);
  const { results } = await q.all();
  const fixed = [];
  for (const row of results) {
    await env.DB.prepare('UPDATE subscription_starts SET checked_at = ? WHERE id = ?').bind(t, row.id).run();
    try {
      const r = await paypalRequest(env, 'GET', '/v1/billing/subscriptions/' + encodeURIComponent(row.id));
      if (!r.ok) continue;
      const s = r.data;
      if (!['ACTIVE', 'APPROVED'].includes(s.status)) {
        if (['CANCELLED', 'EXPIRED'].includes(s.status)) await env.DB.prepare('UPDATE subscription_starts SET done = 1 WHERE id = ?').bind(row.id).run();
        continue;
      }
      const who = ownerOf(s);
      if (!who || who.userId !== row.user_id || who.siteId !== row.site_id) continue;
      const known = await env.DB.prepare('SELECT 1 FROM subscriptions WHERE id = ?').bind(s.id).first();
      if (known) { await env.DB.prepare('UPDATE subscription_starts SET done = 1 WHERE id = ?').bind(row.id).run(); continue; }
      const site = await h.getSite(env, row.site_id);
      if (!site) continue;
      await applySubscription(env, h, s, row.user_id, site);
      console.log('billing: activated a subscription the page never confirmed', s.id, row.user_id);
      fixed.push(s.id);
    } catch (e) { console.error('sync subscription', row.id, e.message); }
  }
  return fixed;
}

// ---------- admin: payments at PayPal that never became a plan ----------

const dateParam = t => new Date(t * 1000).toISOString().replace(/\.\d+Z$/, 'Z');

/**
 * Subscription payments in the PayPal account (last `days` days, Transaction Search) whose
 * subscription isn't active here, plus started subscriptions that never got confirmed.
 */
async function findProblems(env, h, days) {
  const end = now(), start = end - days * DAY;
  const subIds = new Map(); // subscription id → payments
  let searchError = null;
  for (let page = 1, pages = 1; page <= pages && page <= 5; page++) {
    const r = await paypalRequest(env, 'GET', `/v1/reporting/transactions?start_date=${dateParam(start)}&end_date=${dateParam(end)}&fields=transaction_info,payer_info&page_size=500&page=${page}`);
    if (!r.ok) {
      searchError = r.status === 403
        ? 'ל-PayPal אין עדיין הרשאה לחיפוש תשלומים (Transaction Search). ההרשאה מופעלת באפליקציית ה-Live ב-developer.paypal.com ← Features ← Transaction Search, ולפי PayPal לוקח עד כ-9 שעות עד שהיא נכנסת לתוקף. בינתיים אפשר לחבר מנוי לפי המזהה שלו (I-…).'
        : 'PayPal: ' + (r.data?.message || r.status);
      break;
    }
    pages = r.data.total_pages || 1;
    for (const t of r.data.transaction_details || []) {
      const ti = t.transaction_info || {};
      if (ti.paypal_reference_id_type !== 'SUB' || !ti.paypal_reference_id) continue;
      if (Number(ti.transaction_amount?.value) <= 0) continue;
      const list = subIds.get(ti.paypal_reference_id) || [];
      list.push({ at: Math.floor(Date.parse(ti.transaction_initiation_date) / 1000), amount: Number(ti.transaction_amount.value), currency: ti.transaction_amount.currency_code, payer: t.payer_info?.email_address || null, custom: ti.custom_field || null });
      subIds.set(ti.paypal_reference_id, list);
    }
  }
  const { results: starts } = await env.DB.prepare('SELECT id FROM subscription_starts WHERE done = 0 AND created_at > ?').bind(end - 31 * DAY).all();
  for (const row of starts) if (!subIds.has(row.id)) subIds.set(row.id, []);

  const problems = [];
  for (const [id, payments] of subIds) {
    const known = await env.DB.prepare('SELECT status, paid_until FROM subscriptions WHERE id = ?').bind(id).first();
    if (known && (known.status === 'ACTIVE' || known.paid_until > end)) continue;
    const r = await paypalRequest(env, 'GET', '/v1/billing/subscriptions/' + encodeURIComponent(id));
    if (!r.ok) continue;
    const s = r.data;
    if (!payments.length && !['ACTIVE', 'APPROVED'].includes(s.status)) continue; // started, never paid
    if (known && !['ACTIVE', 'APPROVED'].includes(s.status)) continue;            // ended, and we know it
    problems.push(await describeSub(env, h, s, payments));
  }
  problems.sort((a, b) => (b.last_payment_at || 0) - (a.last_payment_at || 0));
  return { problems, searchError };
}

export async function adminScan(request, env, h) {
  await h.requireAdmin(request, env);
  await ensureBillingSchema(env);
  if (!paypalReady(env)) throw new HttpError(400, 'no_paypal', 'PayPal לא מחובר');
  const days = Math.min(31, Math.max(1, Number(new URL(request.url).searchParams.get('days')) || 31));
  const { problems, searchError } = await findProblems(env, h, days);
  return json({ days, problems, search_error: searchError });
}

async function describeSub(env, h, s, payments = []) {
  const who = ownerOf(s);
  const user = who ? await h.getUserById(env, who.userId) : null;
  const site = who ? await h.getSite(env, who.siteId) : null;
  const bp = await env.DB.prepare('SELECT * FROM billing_plans WHERE paypal_plan_id = ?').bind(s.plan_id).first();
  const plan = bp ? await h.getPlan(env, bp.plan_id) : null;
  const access = user && site ? await env.DB.prepare('SELECT plan_id, plan_expires_at FROM access WHERE user_id = ? AND site_id = ?').bind(user.id, site.id).first() : null;
  const last = payments.reduce((a, p) => (p.at > (a?.at || 0) ? p : a), null);
  return {
    id: s.id, status: s.status,
    user: user ? { id: user.id, email: user.email, name: user.name } : null,
    site: site ? { id: site.id, name: site.name } : null,
    plan: plan ? { id: plan.id, name: plan.name } : null,
    current_plan: access?.plan_id || null,
    payer: last?.payer || s.subscriber?.email_address || null,
    payments: payments.length,
    last_payment_at: last?.at || Math.floor(Date.parse(s.billing_info?.last_payment?.time || '') / 1000) || null,
    amount: last ? last.amount : Number(s.billing_info?.last_payment?.amount?.value) || null,
    currency: last ? last.currency : s.billing_info?.last_payment?.amount?.currency_code || bp?.currency || null,
    fixable: !!(user && site && plan && ['ACTIVE', 'APPROVED'].includes(s.status)),
  };
}

/** Admin: give the plan of a PayPal subscription (by its I-… id) to the account that paid for it. */
export async function adminLink(request, env, h) {
  await h.requireAdmin(request, env);
  await ensureBillingSchema(env);
  const id = String((await readJson(request)).subscription_id || '').trim();
  if (!/^I-[A-Z0-9]{4,40}$/i.test(id)) throw new HttpError(400, 'bad_request', 'מזהה מנוי של PayPal מתחיל ב-I- (למשל I-ABC123DEF456)');
  const r = await paypalRequest(env, 'GET', '/v1/billing/subscriptions/' + encodeURIComponent(id));
  if (!r.ok) throw new HttpError(404, 'not_found', 'PayPal לא מצא מנוי כזה');
  const s = r.data;
  const info = await describeSub(env, h, s);
  if (!info.user || !info.site) throw new HttpError(400, 'no_owner', 'המנוי הזה לא נוצר מאתר של reem.bi (אין בו משתמש)');
  if (!info.plan) throw new HttpError(400, 'unknown_plan', 'התוכנית של המנוי לא מוכרת');
  if (!['ACTIVE', 'APPROVED'].includes(s.status)) throw new HttpError(400, 'not_active', `המנוי ב-PayPal במצב ${s.status}, לא פעיל`);
  const site = await h.getSite(env, info.site.id);
  await applySubscription(env, h, s, info.user.id, site);
  return json({ fixed: { ...info, current_plan: info.plan.id } });
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
  const webhookId = await getState(env, 'webhook_id');
  return { env: ppEnv(env), configured: paypalReady(env), by_site: results, webhook: !!webhookId, collected_30d: await revenue(env, monthAgo()) };
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
      collected_30d: await revenue(env, monthAgo(), siteId),
    },
    subscriptions: subs.results.map(s => ({ ...s, plan_name: planName(s.plan_id) })),
    coupons: coupons.results.map(r => {
      const c = couponRow(r);
      const p = plans.find(x => x.id === c.plan_ids[0]);
      return { ...c, label: couponLabel(c, p?.currency || 'ILS', c.type === 'gift' ? p?.name : null), plan_names: c.plan_ids.map(planName) };
    }),
    ...(await adminPacksData(env, siteId)),
    welcome: await affiliate.welcomeInfo(env, siteId),
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
    // Its discounted PayPal plans are of no use any more (a code can only be deleted if nobody used it).
    const { results: made } = await env.DB.prepare(
      'SELECT paypal_plan_id FROM billing_plans WHERE coupon_code = ? AND plan_id LIKE ?',
    ).bind(c.code, siteId + ':%').all();
    for (const row of made) { try { await retirePlan(env, row.paypal_plan_id); } catch (e) { console.error('retire plan', row.paypal_plan_id, e.message); } }
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


// ======================================================================
// PayPal → reem.bi, automatically (webhook), and the daily safety net
// ======================================================================

const WEBHOOK_EVENTS = [
  'BILLING.SUBSCRIPTION.ACTIVATED', 'BILLING.SUBSCRIPTION.RE-ACTIVATED', 'BILLING.SUBSCRIPTION.UPDATED',
  'BILLING.SUBSCRIPTION.CANCELLED', 'BILLING.SUBSCRIPTION.SUSPENDED', 'BILLING.SUBSCRIPTION.EXPIRED',
  'BILLING.SUBSCRIPTION.PAYMENT.FAILED', 'PAYMENT.SALE.COMPLETED', 'PAYMENT.SALE.REFUNDED', 'PAYMENT.SALE.REVERSED',
];

async function getState(env, key) {
  const row = await env.DB.prepare('SELECT value FROM paypal_state WHERE key = ?').bind(key).first();
  try { return row ? JSON.parse(row.value) : null; } catch { return null; }
}
async function setState(env, key, value) {
  await env.DB.prepare(
    `INSERT INTO paypal_state (key, value, updated_at) VALUES (?1, ?2, ?3)
     ON CONFLICT(key) DO UPDATE SET value = ?2, updated_at = ?3`,
  ).bind(key, JSON.stringify(value), now()).run();
}

// Brings one PayPal subscription up to date here: status and renewal date if we know it, or the plan
// itself if it was paid but never became one. PayPal is the source of truth, so the event only says
// "look at this subscription".
async function syncSubscription(env, h, subId) {
  const r = await paypalRequest(env, 'GET', '/v1/billing/subscriptions/' + encodeURIComponent(subId));
  if (!r.ok) return { user_id: null, site_id: null };
  const s = r.data;
  const known = await env.DB.prepare('SELECT * FROM subscriptions WHERE id = ?').bind(subId).first();
  if (known) {
    await refreshSub(env, known);
    return { user_id: known.user_id, site_id: known.site_id };
  }
  const who = ownerOf(s);
  if (who && ['ACTIVE', 'APPROVED'].includes(s.status)) {
    const site = await h.getSite(env, who.siteId);
    if (site && (await h.getUserById(env, who.userId))) {
      try {
        await applySubscription(env, h, s, who.userId, site);
        console.log('billing: webhook activated a subscription the page never confirmed', s.id, who.userId);
      } catch (e) { console.error('webhook activate', s.id, e.message); }
    }
  }
  return who ? { user_id: who.userId, site_id: who.siteId } : { user_id: null, site_id: null };
}

async function verifyWebhook(env, request, raw, event, webhookId) {
  const hd = n => request.headers.get(n);
  const r = await paypalRequest(env, 'POST', '/v1/notifications/verify-webhook-signature', {
    auth_algo: hd('paypal-auth-algo'), cert_url: hd('paypal-cert-url'), transmission_id: hd('paypal-transmission-id'),
    transmission_sig: hd('paypal-transmission-sig'), transmission_time: hd('paypal-transmission-time'),
    webhook_id: webhookId, webhook_event: event,
  });
  return r.ok && r.data.verification_status === 'SUCCESS';
}

/** POST /api/paypal/webhook — called by PayPal. Signature-checked; the event is never trusted on its own. */
export async function webhook(request, env, h) {
  await ensureBillingSchema(env);
  const webhookId = await getState(env, 'webhook_id');
  if (!webhookId || !paypalReady(env)) return new Response('not configured', { status: 503 });
  const raw = await request.text();
  let ev;
  try { ev = JSON.parse(raw); } catch { return new Response('bad json', { status: 400 }); }
  if (!ev || !ev.id || !ev.event_type) return new Response('bad event', { status: 400 });
  if (!(await verifyWebhook(env, request, raw, ev, webhookId))) return new Response('bad signature', { status: 401 });

  const res = ev.resource || {};
  const type = String(ev.event_type);
  const subId = type.startsWith('BILLING.SUBSCRIPTION') ? res.id : res.billing_agreement_id || null;
  const sale = type.startsWith('PAYMENT.SALE');
  const sign = type === 'PAYMENT.SALE.COMPLETED' ? 1 : -1;
  const amount = sale ? sign * Math.abs(Number(res.amount?.total ?? res.amount?.value) || 0) : null;
  const fee = type === 'PAYMENT.SALE.COMPLETED' ? Number(res.transaction_fee?.value) || null : null;
  const cur = sale ? res.amount?.currency || res.amount?.currency_code || null : null;
  const ts = Math.floor(Date.parse(ev.create_time || res.create_time || '') / 1000) || now();

  const ins = await env.DB.prepare(
    'INSERT OR IGNORE INTO paypal_events (id, type, sub_id, amount, fee, currency, env, ts) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  ).bind(ev.id, type, subId, amount, fee, cur, ppEnv(env), ts).run();
  if (!ins.meta.changes) return json({ ok: true, duplicate: true }); // PayPal retries

  if (subId) {
    try {
      const who = await syncSubscription(env, h, subId);
      await env.DB.prepare('UPDATE paypal_events SET user_id = ?, site_id = ? WHERE id = ?').bind(who.user_id, who.site_id, ev.id).run();
    } catch (e) {
      // A failure here must make PayPal retry the event.
      await env.DB.prepare('DELETE FROM paypal_events WHERE id = ?').bind(ev.id).run();
      console.error('webhook sync', type, subId, e.message);
      return new Response('retry', { status: 500 });
    }
  }
  return json({ ok: true });
}

/**
 * The daily safety net, on top of the webhook: subscriptions that were started and never confirmed,
 * and payments in the account that never became a plan (Transaction Search) are fixed by themselves.
 */
export async function reconcile(env, h) {
  await syncStarted(env, h);
  const out = { at: now(), fixed: 0, unresolved: 0, error: null };
  try {
    const { problems, searchError } = await findProblems(env, h, 7);
    out.error = searchError;
    for (const p of problems) {
      if (!p.fixable) { out.unresolved++; continue; }
      try {
        const r = await paypalRequest(env, 'GET', '/v1/billing/subscriptions/' + encodeURIComponent(p.id));
        const site = await h.getSite(env, p.site.id);
        await applySubscription(env, h, r.data, p.user.id, site);
        out.fixed++;
        console.log('billing: reconcile activated', p.id, p.user.id);
      } catch (e) { out.unresolved++; console.error('reconcile', p.id, e.message); }
    }
  } catch (e) { out.error = String(e.message || e); }
  await setState(env, 'last_reconcile', out);
}

// ---------- admin: the PayPal connection and its numbers ----------

const monthAgo = () => now() - 30 * DAY;

// A PayPal plan is in use unless it was made for a coupon / partner code that no longer exists.
const PLAN_IN_USE = `(bp.coupon_code IS NULL OR EXISTS (
  SELECT 1 FROM coupons c JOIN plans p ON p.site_id = c.site_id WHERE p.id = bp.plan_id AND c.code = bp.coupon_code))`;

// Switches a PayPal plan off for new sign-ups (existing subscribers are not affected) and forgets it here,
// so the catalog never offers a deactivated plan.
async function retirePlan(env, paypalPlanId) {
  const r = await paypalRequest(env, 'POST', `/v1/billing/plans/${encodeURIComponent(paypalPlanId)}/deactivate`);
  if (!r.ok && r.status !== 422 && r.status !== 404) throw new HttpError(502, 'paypal_error', 'PayPal: ' + (r.data?.message || r.status));
  await env.DB.prepare('DELETE FROM billing_plans WHERE paypal_plan_id = ?').bind(paypalPlanId).run();
}

async function revenue(env, since, siteId) {
  const q = siteId
    ? env.DB.prepare("SELECT currency, SUM(amount) AS gross, SUM(COALESCE(fee, 0)) AS fees, COUNT(*) AS n FROM paypal_events WHERE type = 'PAYMENT.SALE.COMPLETED' AND ts > ? AND env = ? AND site_id = ? GROUP BY currency").bind(since, ppEnv(env), siteId)
    : env.DB.prepare("SELECT currency, SUM(amount) AS gross, SUM(COALESCE(fee, 0)) AS fees, COUNT(*) AS n FROM paypal_events WHERE type = 'PAYMENT.SALE.COMPLETED' AND ts > ? AND env = ? GROUP BY currency").bind(since, ppEnv(env));
  const refunds = await env.DB.prepare("SELECT currency, SUM(amount) AS amount FROM paypal_events WHERE type IN ('PAYMENT.SALE.REFUNDED', 'PAYMENT.SALE.REVERSED') AND ts > ? AND env = ?" + (siteId ? ' AND site_id = ?' : '') + ' GROUP BY currency')
    .bind(...(siteId ? [since, ppEnv(env), siteId] : [since, ppEnv(env)])).all();
  const rf = Object.fromEntries(refunds.results.map(x => [x.currency, x.amount]));
  const { results } = await q.all();
  return results.map(x => ({
    currency: x.currency, payments: x.n, gross: round2(x.gross), fees: round2(x.fees), refunds: round2(rf[x.currency] || 0),
    net: round2(x.gross - x.fees + (rf[x.currency] || 0)),
  }));
}

export async function adminPaypalStatus(request, env, h) {
  await h.requireAdmin(request, env);
  await ensureBillingSchema(env);
  const webhookId = await getState(env, 'webhook_id');
  const last = await env.DB.prepare('SELECT MAX(ts) AS ts FROM paypal_events').first();
  const failed = await env.DB.prepare("SELECT COUNT(*) AS n FROM paypal_events WHERE type = 'BILLING.SUBSCRIPTION.PAYMENT.FAILED' AND ts > ? AND env = ?").bind(monthAgo(), ppEnv(env)).first();
  const waiting = await env.DB.prepare('SELECT COUNT(*) AS n FROM subscription_starts WHERE done = 0 AND created_at > ?').bind(now() - 7 * DAY).first();
  return json({
    configured: paypalReady(env), env: ppEnv(env),
    webhook: { connected: !!webhookId, id: webhookId, url: new URL(request.url).origin + '/api/paypal/webhook', last_event_at: last?.ts || null },
    last_reconcile: await getState(env, 'last_reconcile'),
    failed_payments_30d: failed.n,
    starts_waiting: waiting.n,
    revenue_30d: await revenue(env, monthAgo()),
  });
}

/** One click: create the webhook at PayPal (or find and refresh the existing one) and remember its id. */
export async function adminConnectWebhook(request, env, h) {
  await h.requireAdmin(request, env);
  await ensureBillingSchema(env);
  if (!paypalReady(env)) throw new HttpError(400, 'no_paypal', 'PayPal לא מחובר');
  const url = new URL(request.url).origin + '/api/paypal/webhook';
  const body = { url, event_types: WEBHOOK_EVENTS.map(name => ({ name })) };
  let id = null;
  const created = await paypalRequest(env, 'POST', '/v1/notifications/webhooks', body);
  if (created.ok) id = created.data.id;
  else {
    // Already there (maybe made by hand): find it by its address, and make sure it listens to what we need.
    const list = await paypalRequest(env, 'GET', '/v1/notifications/webhooks');
    const found = list.ok && (list.data.webhooks || []).find(w => w.url === url);
    if (!found) throw new HttpError(502, 'paypal_error', 'PayPal: ' + (created.data?.details?.[0]?.description || created.data?.message || created.status));
    id = found.id;
    await paypalRequest(env, 'PATCH', '/v1/notifications/webhooks/' + encodeURIComponent(id), [{ op: 'replace', path: '/event_types', value: body.event_types }]);
  }
  await setState(env, 'webhook_id', id);
  return adminPaypalStatus(request, env, h);
}

/** The subscription plans in the PayPal account, and which of them reem.bi uses. */
export async function adminPaypalPlans(request, env, h) {
  await h.requireAdmin(request, env);
  await ensureBillingSchema(env);
  if (!paypalReady(env)) throw new HttpError(400, 'no_paypal', 'PayPal לא מחובר');
  const plans = [];
  for (let page = 1; page <= 5; page++) {
    const r = await paypalRequest(env, 'GET', `/v1/billing/plans?page_size=20&page=${page}&total_required=true`);
    if (!r.ok) throw new HttpError(502, 'paypal_error', 'PayPal: ' + (r.data?.message || r.status));
    plans.push(...(r.data.plans || []));
    if (page >= (r.data.total_pages || 1)) break;
  }
  const { results: mine } = await env.DB.prepare(`SELECT bp.paypal_plan_id FROM billing_plans bp WHERE bp.env = ? AND ${PLAN_IN_USE}`).bind(ppEnv(env)).all();
  const used = new Set(mine.map(x => x.paypal_plan_id));
  const out = [];
  for (const p of plans) {
    out.push({ id: p.id, name: p.name, status: p.status, product_id: p.product_id, in_use: used.has(p.id) });
  }
  return json({ plans: out });
}

export async function adminDeactivatePlan(request, env, h, planId) {
  await h.requireAdmin(request, env);
  await ensureBillingSchema(env);
  const inUse = await env.DB.prepare(`SELECT 1 FROM billing_plans bp WHERE bp.paypal_plan_id = ? AND ${PLAN_IN_USE}`).bind(planId).first();
  if (inUse) throw new HttpError(400, 'in_use', 'התוכנית הזו בשימוש במערכת, אי אפשר להשבית אותה');
  await retirePlan(env, planId);
  return adminPaypalPlans(request, env, h);
}
