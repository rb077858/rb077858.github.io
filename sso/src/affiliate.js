// Partner program (affiliates), per site. The admin picks users of the site as partners; each
// gets a code (chosen or random) and a link, login.reembir.com/join/<CODE>.
//
// Only new users count: whoever signs in to the site for the first time after the partner's link
// (it leaves a cookie here) is that partner's referral, once per user and site. A partner code
// typed in the site's coupon box (auth.billing.checkCoupon / redeem, e.g. a discount) works only
// for users who came through the link of that same partner; never for users who were already on
// the site, and never a second partner's code.
// Per site the admin decides what the code gives the newcomer (nothing, a bonus JSON like
// {"minutes": 30}, or any coupon type from billing.js) and what the partner gets for each referral
// (a bonus JSON), on sign-up or on the referral's first payment. Bonuses add up in userinfo:
// access.rewards = { totals, count }; a partner also gets access.affiliate = { code, link, … }.
//
// A partner can have several codes (affiliate_codes); each can be on or off, and one is the
// primary: the only one shown to the partner. With "self_join" on, users join the program by
// themselves from the site (auth.affiliate.join()) and get a random code; userinfo then carries
// access.affiliate_program = { self_join, label, reward, reward_on } for the site's join card.
//
// Every bonus given (bonus_grants) shows on the user's page in the dashboard, where the admin can
// delete it or add one by hand.
//
// Welcome gift (per site, dashboard → Plans): a bonus JSON, e.g. {"minutes": 10}, given once to
// every user on their first sign-in to the site (and, on request, to users already there).
import { HttpError, json, readJson, now, parseJsonField, getCookie } from './lib.js';
import { validateCoupon, couponLabel, ensureBillingSchema } from './billing.js';
import { ensurePacksSchema } from './packs.js';

const DAY = 86400;
const CLAIM_DAYS = 30;
const COOKIE = 'reem_ref';
export const REFEREE_TYPES = ['none', 'bonus', 'percent', 'amount', 'trial', 'gift'];
const loginBase = env => (env.PUBLIC_URL || 'https://login.reembir.com').replace(/\/+$/, '');
export const joinLink = (env, code) => `${loginBase(env)}/join/${encodeURIComponent(code)}`;

let ready = false;
export async function ensureAffiliateSchema(env) {
  if (ready) return;
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS affiliate_settings (
      site_id TEXT PRIMARY KEY, enabled INTEGER NOT NULL DEFAULT 0, referee_type TEXT NOT NULL DEFAULT 'none',
      referee_value REAL NOT NULL DEFAULT 0, referee_months INTEGER NOT NULL DEFAULT 0, referee_plan_ids TEXT NOT NULL DEFAULT '[]',
      referee_features TEXT NOT NULL DEFAULT '{}', referee_label TEXT NOT NULL DEFAULT '',
      partner_features TEXT NOT NULL DEFAULT '{}', reward_on TEXT NOT NULL DEFAULT 'signup', updated_at INTEGER NOT NULL)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS affiliates (
      site_id TEXT NOT NULL, user_id TEXT NOT NULL, code TEXT NOT NULL UNIQUE, active INTEGER NOT NULL DEFAULT 1,
      note TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL, PRIMARY KEY (site_id, user_id))`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS referrals (
      site_id TEXT NOT NULL, user_id TEXT NOT NULL, partner_id TEXT NOT NULL, code TEXT NOT NULL, source TEXT NOT NULL,
      created_at INTEGER NOT NULL, paid_at INTEGER, rewarded_at INTEGER, PRIMARY KEY (site_id, user_id))`),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS referrals_partner ON referrals(site_id, partner_id)'),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS bonus_grants (
      id INTEGER PRIMARY KEY AUTOINCREMENT, site_id TEXT NOT NULL, user_id TEXT NOT NULL, features TEXT NOT NULL,
      reason TEXT NOT NULL, ref_user_id TEXT, created_at INTEGER NOT NULL)`),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS bonus_grants_user ON bonus_grants(user_id, site_id)'),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS affiliate_codes (
      code TEXT PRIMARY KEY, site_id TEXT NOT NULL, user_id TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL)`),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS affiliate_codes_user ON affiliate_codes(site_id, user_id)'),
    env.DB.prepare('CREATE TABLE IF NOT EXISTS welcome_bonus (site_id TEXT PRIMARY KEY, features TEXT NOT NULL, updated_at INTEGER NOT NULL)'),
  ]);
  for (const sql of [
    'ALTER TABLE affiliate_settings ADD COLUMN self_join INTEGER NOT NULL DEFAULT 0',
    "ALTER TABLE affiliates ADD COLUMN source TEXT NOT NULL DEFAULT 'admin'",
    "ALTER TABLE bonus_grants ADD COLUMN note TEXT NOT NULL DEFAULT ''",
  ]) {
    try {
      await env.DB.prepare(sql).run();
    } catch (e) {
      if (!/duplicate column/i.test(String(e?.message || e))) throw e;
    }
  }
  // Partners from before there were several codes: their code becomes their first one.
  await env.DB.prepare(
    'INSERT OR IGNORE INTO affiliate_codes (code, site_id, user_id, active, created_at) SELECT code, site_id, user_id, 1, created_at FROM affiliates',
  ).run();
  ready = true;
}

// ---------- settings ----------

const DEFAULTS = {
  enabled: false, referee_type: 'none', referee_value: 0, referee_months: 0, referee_plan_ids: [],
  referee_features: {}, referee_label: '', partner_features: {}, reward_on: 'signup', self_join: false,
};

async function getSettings(env, siteId) {
  const r = await env.DB.prepare('SELECT * FROM affiliate_settings WHERE site_id = ?').bind(siteId).first();
  if (!r) return { site_id: siteId, ...DEFAULTS };
  return {
    ...r, enabled: !!r.enabled, self_join: !!r.self_join, referee_plan_ids: parseJsonField(r.referee_plan_ids, []),
    referee_features: parseJsonField(r.referee_features, {}), partner_features: parseJsonField(r.partner_features, {}),
  };
}

const isDiscount = type => ['percent', 'amount', 'trial', 'gift'].includes(type);

function featuresLabel(f) {
  const parts = Object.entries(f || {}).map(([k, v]) => (k === 'minutes' ? `${v} דקות` : `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`));
  return parts.join(', ');
}

function refereeLabel(s, partnerName, currency, planName) {
  if (s.referee_label) return s.referee_label;
  if (s.referee_type === 'bonus') return 'מתנה: ' + featuresLabel(s.referee_features);
  if (isDiscount(s.referee_type)) {
    return couponLabel({ type: s.referee_type, value: s.referee_value, months: s.referee_months }, currency, planName);
  }
  return partnerName ? `הגעת דרך ${partnerName}` : 'קוד שותף';
}

function parseFeatures(v, what) {
  if (typeof v === 'string') {
    try { v = JSON.parse(v.trim() || '{}'); } catch { throw new HttpError(400, 'bad_settings', `${what} לא בפורמט JSON תקין`); }
  }
  if (v === undefined || v === null) v = {};
  if (typeof v !== 'object' || Array.isArray(v)) throw new HttpError(400, 'bad_settings', `${what} צריך להיות אובייקט JSON, למשל {"minutes": 30}`);
  return v;
}

// ---------- codes as coupons (billing.js asks here for codes that aren't regular coupons) ----------

// Any of a partner's codes; active only while both the code and the partner are on.
async function partnerByCode(env, code) {
  return env.DB.prepare(
    `SELECT c.code, c.site_id, c.user_id, (c.active AND a.active) AS active, u.name, u.email
     FROM affiliate_codes c JOIN affiliates a ON a.site_id = c.site_id AND a.user_id = c.user_id JOIN users u ON u.id = c.user_id
     WHERE c.code = ?`,
  ).bind(String(code || '').trim().toUpperCase()).first();
}

/** A partner code dressed as a coupon row (see billing.js getCoupon), or null. */
export async function affiliateCoupon(env, siteId, code) {
  await ensureAffiliateSchema(env);
  const a = await partnerByCode(env, code);
  if (!a || a.site_id !== siteId) return null;
  const s = await getSettings(env, siteId);
  const type = isDiscount(s.referee_type) ? s.referee_type : 'referral';
  return {
    site_id: siteId, code: a.code, type, value: s.referee_value, months: s.referee_months, plan_ids: s.referee_plan_ids,
    max_uses: 0, uses: 0, expires_at: null, active: !!(a.active && s.enabled), note: '',
    affiliate: { user_id: a.user_id, name: a.name || a.email.split('@')[0] },
    // PayPal plans made for this code are reused only while the offer stays the same.
    offer_key: JSON.stringify([type, s.referee_value, s.referee_months]),
  };
}

/** For checkCoupon on a code that only records the referral (and maybe a bonus). */
export async function referralCheck(env, site, c) {
  const s = await getSettings(env, site.id);
  return json({ code: c.code, type: 'referral', label: refereeLabel(s, c.affiliate.name), partner: c.affiliate.name, bonus: s.referee_type === 'bonus' ? s.referee_features : null });
}

// ---------- referrals ----------

async function grant(env, siteId, userId, features, reason, refUserId) {
  if (!features || !Object.keys(features).length) return;
  await env.DB.prepare('INSERT INTO bonus_grants (site_id, user_id, features, reason, ref_user_id, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(siteId, userId, JSON.stringify(features), reason, refUserId || null, now()).run();
}

async function rewardPartner(env, s, ref) {
  const r = await env.DB.prepare('UPDATE referrals SET rewarded_at = ? WHERE site_id = ? AND user_id = ? AND rewarded_at IS NULL')
    .bind(now(), ref.site_id, ref.user_id).run();
  if (r.meta.changes) await grant(env, ref.site_id, ref.partner_id, s.partner_features, 'partner', ref.user_id);
}

/**
 * Records that userId came through the partner code (once per user and site). Returns the referral
 * row, or null when it doesn't count (the partner themself, already referred, program off).
 */
async function recordReferral(env, siteId, userId, code, source) {
  await ensureAffiliateSchema(env);
  const a = await partnerByCode(env, code);
  if (!a || a.site_id !== siteId || !a.active || a.user_id === userId) return null;
  const s = await getSettings(env, siteId);
  if (!s.enabled) return null;
  const ins = await env.DB.prepare(
    'INSERT OR IGNORE INTO referrals (site_id, user_id, partner_id, code, source, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).bind(siteId, userId, a.user_id, a.code, source, now()).run();
  if (!ins.meta.changes) return null;
  const ref = { site_id: siteId, user_id: userId, partner_id: a.user_id };
  if (s.referee_type === 'bonus') await grant(env, siteId, userId, s.referee_features, 'referred', a.user_id);
  if (s.reward_on === 'signup') await rewardPartner(env, s, ref);
  return ref;
}

/** First sign-in to a site: the partner link's cookie, if it's for this site. */
export async function attributeFromCookie(request, env, userId, siteId) {
  const v = getCookie(request, COOKIE) || '';
  const i = v.indexOf(':');
  if (i < 1 || v.slice(0, i) !== siteId) return;
  await recordReferral(env, siteId, userId, v.slice(i + 1), 'link');
}

/**
 * A partner code works only for a user who came through that partner's link (billing.js calls this
 * for every partner code: check, redeem, and the subscription made with its discount).
 */
export async function assertReferredBy(env, siteId, userId, c) {
  if (c.affiliate.user_id === userId) throw new HttpError(400, 'bad_coupon', 'זה הקוד שלך. שתפו אותו עם אחרים');
  const ref = await env.DB.prepare('SELECT partner_id FROM referrals WHERE site_id = ? AND user_id = ?').bind(siteId, userId).first();
  if (!ref) throw new HttpError(400, 'bad_coupon', 'קוד שותף עובד רק למשתמשים חדשים שנרשמו דרך הקישור של השותף');
  if (ref.partner_id !== c.affiliate.user_id) throw new HttpError(400, 'bad_coupon', 'כבר הצטרפת דרך שותף אחר, ורק הקוד שלו עובד בשבילך');
}

/** The user paid on the site (a subscription or a pack): rewards the partner if that's the rule. */
export async function onPaid(env, siteId, userId) {
  await ensureAffiliateSchema(env);
  const ref = await env.DB.prepare('SELECT * FROM referrals WHERE site_id = ? AND user_id = ?').bind(siteId, userId).first();
  if (!ref) return;
  if (!ref.paid_at) await env.DB.prepare('UPDATE referrals SET paid_at = ? WHERE site_id = ? AND user_id = ? AND paid_at IS NULL').bind(now(), siteId, userId).run();
  const s = await getSettings(env, siteId);
  if (s.reward_on === 'paid' && !ref.rewarded_at) await rewardPartner(env, s, ref);
}

/** redeem() with a code that only records the referral: already done by the link, so just confirm. */
export async function claimReferral(env, h, session, site, c) {
  await assertReferredBy(env, site.id, session.id, c);
  return json(await h.siteUserPayload(env, session, site));
}

// ---------- bonuses on the user's page in the dashboard ----------

const REASONS = { referred: 'מתנת הצטרפות', partner: 'תגמול שותף', admin: 'נוסף ידנית', welcome: 'מתנת הצטרפות לאתר', agent: 'מתנה מנציג בצ׳אט' };

/** Everything given to a user from the partner program (or by hand), and how they came. */
export async function userBonuses(env, userId) {
  await ensureAffiliateSchema(env);
  const [grants, refs] = await env.DB.batch([
    env.DB.prepare(
      `SELECT g.id, g.site_id, g.features, g.reason, g.note, g.ref_user_id, g.created_at, u.email AS ref_email, u.name AS ref_name
       FROM bonus_grants g LEFT JOIN users u ON u.id = g.ref_user_id WHERE g.user_id = ? ORDER BY g.created_at DESC`,
    ).bind(userId),
    env.DB.prepare(
      `SELECT r.site_id, r.code, r.source, r.created_at, r.paid_at, r.partner_id, u.email AS partner_email, u.name AS partner_name
       FROM referrals r JOIN users u ON u.id = r.partner_id WHERE r.user_id = ?`,
    ).bind(userId),
  ]);
  return {
    // What can be given on each site (the numbers in its packs, partner settings and past bonuses),
    // so the dashboard offers the site's own units, e.g. minutes on a transcription site.
    bonus_keys: await bonusKeys(env),
    bonuses: grants.results.map(g => {
      const features = parseJsonField(g.features, {});
      const who = g.ref_name || g.ref_email || '';
      const why = g.reason === 'referred' ? `${REASONS.referred}${who ? ' דרך ' + who : ''}`
        : g.reason === 'partner' ? `${REASONS.partner}${who ? ': ' + who + ' הצטרף' : ''}`
        : REASONS[g.reason] || g.reason;
      return { ...g, features, label: featuresLabel(features), why: why + (g.note ? ` (${g.note})` : '') };
    }),
    referred_by: refs.results,
  };
}

export async function bonusKeys(env) {
  const keys = {};
  const note = (siteId, f) => {
    for (const [k, v] of Object.entries(parseJsonField(f, {}) || {})) {
      if (typeof v === 'number') (keys[siteId] = keys[siteId] || new Set()).add(k);
    }
  };
  await ensurePacksSchema(env);
  const [packs, settings, grants] = await env.DB.batch([
    env.DB.prepare("SELECT site_id, features FROM billing_packs"),
    env.DB.prepare('SELECT site_id, referee_features, partner_features FROM affiliate_settings'),
    env.DB.prepare('SELECT DISTINCT site_id, features FROM bonus_grants LIMIT 1000'),
  ]);
  for (const r of packs.results) note(r.site_id, r.features);
  for (const r of settings.results) { note(r.site_id, r.referee_features); note(r.site_id, r.partner_features); }
  for (const r of grants.results) note(r.site_id, r.features);
  return Object.fromEntries(Object.entries(keys).map(([k, v]) => [k, [...v]]));
}

// ---------- welcome gift ----------

export async function welcomeFeatures(env, siteId) {
  await ensureAffiliateSchema(env);
  const r = await env.DB.prepare('SELECT features FROM welcome_bonus WHERE site_id = ?').bind(siteId).first();
  return r ? parseJsonField(r.features, {}) : {};
}

/** First sign-in to a site: the site's welcome gift, once per user. */
export async function grantWelcome(env, userId, siteId) {
  const f = await welcomeFeatures(env, siteId);
  if (!Object.keys(f).length) return;
  const had = await env.DB.prepare("SELECT 1 FROM bonus_grants WHERE user_id = ? AND site_id = ? AND reason = 'welcome'").bind(userId, siteId).first();
  if (!had) await grant(env, siteId, userId, f, 'welcome', null);
}

/** For the dashboard (Plans tab): the gift, and how many users of the site have it or not. */
export async function welcomeInfo(env, siteId) {
  const features = await welcomeFeatures(env, siteId);
  const [granted, missing] = await env.DB.batch([
    env.DB.prepare("SELECT COUNT(DISTINCT user_id) AS n FROM bonus_grants WHERE site_id = ? AND reason = 'welcome'").bind(siteId),
    env.DB.prepare(
      `SELECT COUNT(*) AS n FROM access a WHERE a.site_id = ? AND a.status = 'active'
       AND NOT EXISTS (SELECT 1 FROM bonus_grants g WHERE g.site_id = a.site_id AND g.user_id = a.user_id AND g.reason = 'welcome')`,
    ).bind(siteId),
  ]);
  return { features, label: featuresLabel(features), granted: granted.results[0].n, missing: missing.results[0].n };
}

export async function adminSaveWelcome(request, env, h, siteId) {
  await h.requireAdmin(request, env);
  await ensureAffiliateSchema(env);
  if (!(await h.getSite(env, siteId))) throw new HttpError(404, 'not_found', 'האתר לא נמצא');
  const features = parseFeatures((await readJson(request)).features, 'מתנת ההצטרפות');
  if (Object.keys(features).length) {
    await env.DB.prepare('INSERT INTO welcome_bonus (site_id, features, updated_at) VALUES (?, ?, ?) ON CONFLICT(site_id) DO UPDATE SET features = excluded.features, updated_at = excluded.updated_at')
      .bind(siteId, JSON.stringify(features), now()).run();
  } else {
    await env.DB.prepare('DELETE FROM welcome_bonus WHERE site_id = ?').bind(siteId).run();
  }
}

/** Give the welcome gift to everyone already on the site who doesn't have it yet. */
export async function adminBackfillWelcome(request, env, h, siteId) {
  await h.requireAdmin(request, env);
  const f = await welcomeFeatures(env, siteId);
  if (!Object.keys(f).length) throw new HttpError(400, 'no_gift', 'קודם קבעו מה המתנה');
  await env.DB.prepare(
    `INSERT INTO bonus_grants (site_id, user_id, features, reason, ref_user_id, created_at, note)
     SELECT a.site_id, a.user_id, ?, 'welcome', NULL, ?, '' FROM access a WHERE a.site_id = ? AND a.status = 'active'
     AND NOT EXISTS (SELECT 1 FROM bonus_grants g WHERE g.site_id = a.site_id AND g.user_id = a.user_id AND g.reason = 'welcome')`,
  ).bind(JSON.stringify(f), now(), siteId).run();
}

/** A bonus given by a support agent from the chat (service.js). */
export async function agentBonus(env, { siteId, userId, features, note }) {
  await ensureAffiliateSchema(env);
  const f = parseFeatures(features, 'המתנה');
  const nums = Object.entries(f).filter(([, v]) => typeof v === 'number' && Number.isFinite(v) && v > 0);
  if (!nums.length || nums.length !== Object.keys(f).length) throw new HttpError(400, 'bad_bonus', 'מתנה: מספרים חיוביים בלבד, למשל {"minutes": 30}');
  await env.DB.prepare('INSERT INTO bonus_grants (site_id, user_id, features, reason, ref_user_id, created_at, note) VALUES (?, ?, ?, ?, NULL, ?, ?)')
    .bind(siteId, userId, JSON.stringify(f), 'agent', now(), String(note || '').replace(/\s+/g, ' ').trim().slice(0, 120)).run();
  return featuresLabel(f);
}

/** Totals of all bonuses per site for a user, e.g. { timlul: { minutes: 40 } }. */
export async function bonusTotalsByUser(env, userId) {
  await ensureAffiliateSchema(env);
  const { results } = await env.DB.prepare('SELECT site_id, features FROM bonus_grants WHERE user_id = ?').bind(userId).all();
  const out = {};
  for (const r of results) {
    for (const [k, v] of Object.entries(parseJsonField(r.features, {}))) {
      if (typeof v === 'number') { out[r.site_id] = out[r.site_id] || {}; out[r.site_id][k] = (out[r.site_id][k] || 0) + v; }
    }
  }
  return out;
}

export async function adminAddBonus(request, env, h, userId) {
  await h.requireAdmin(request, env);
  await ensureAffiliateSchema(env);
  const body = await readJson(request);
  const site = await h.getSite(env, String(body.site_id || ''));
  if (!site) throw new HttpError(404, 'not_found', 'האתר לא נמצא');
  if (!(await h.getUserById(env, userId))) throw new HttpError(404, 'not_found', 'המשתמש לא נמצא');
  const features = parseFeatures(body.features, 'התוספת');
  const nums = Object.values(features).filter(v => typeof v === 'number' && Number.isFinite(v));
  if (!nums.length) throw new HttpError(400, 'bad_bonus', 'כתבו מספר, למשל {"minutes": 30}');
  await env.DB.prepare('INSERT INTO bonus_grants (site_id, user_id, features, reason, ref_user_id, created_at, note) VALUES (?, ?, ?, ?, NULL, ?, ?)')
    .bind(site.id, userId, JSON.stringify(features), 'admin', now(), String(body.note || '').replace(/\s+/g, ' ').trim().slice(0, 120)).run();
}

export async function adminDeleteBonus(request, env, h, id) {
  await h.requireAdmin(request, env);
  await ensureAffiliateSchema(env);
  const g = await env.DB.prepare('SELECT user_id FROM bonus_grants WHERE id = ?').bind(Number(id)).first();
  if (!g) throw new HttpError(404, 'not_found', 'התוספת לא נמצאה');
  await env.DB.prepare('DELETE FROM bonus_grants WHERE id = ?').bind(Number(id)).run();
  return g.user_id;
}

// ---------- userinfo ----------

export async function rewardsView(env, userId, siteId) {
  await ensureAffiliateSchema(env);
  const s = await getSettings(env, siteId);
  const [grants, mine] = await env.DB.batch([
    env.DB.prepare('SELECT features FROM bonus_grants WHERE user_id = ? AND site_id = ?').bind(userId, siteId),
    env.DB.prepare(
      `SELECT a.code, a.active, (SELECT COUNT(*) FROM referrals r WHERE r.site_id = a.site_id AND r.partner_id = a.user_id) AS referrals,
       (SELECT COUNT(*) FROM referrals r WHERE r.site_id = a.site_id AND r.partner_id = a.user_id AND r.paid_at IS NOT NULL) AS paid
       FROM affiliates a WHERE a.site_id = ? AND a.user_id = ?`,
    ).bind(siteId, userId),
  ]);
  const totals = {};
  for (const r of grants.results) {
    for (const [k, v] of Object.entries(parseJsonField(r.features, {}))) {
      if (typeof v === 'number' && Number.isFinite(v)) totals[k] = Math.round(((totals[k] || 0) + v) * 1e6) / 1e6;
    }
  }
  const a = mine.results[0];
  return {
    rewards: { totals, count: grants.results.length },
    affiliate: a ? { code: a.code, link: joinLink(env, a.code), active: !!a.active, referrals: a.referrals, paid: a.paid } : null,
    // For the site's "join the partner program" card (only while the program is on).
    affiliate_program: s.enabled ? {
      self_join: s.self_join, label: s.referee_type === 'none' && !s.referee_label ? '' : refereeLabel(s, null, 'ILS'), reward: s.partner_features, reward_on: s.reward_on,
    } : null,
  };
}

// ---------- the link: login.reembir.com/join/<CODE> ----------

export async function join(request, env, code) {
  await ensureAffiliateSchema(env);
  const a = await partnerByCode(env, code);
  const site = a && (await env.DB.prepare('SELECT id, url FROM sites WHERE id = ?').bind(a.site_id).first());
  const s = site && (await getSettings(env, site.id));
  if (!site || !site.url || !a.active || !s.enabled) return Response.redirect(loginBase(env) + '/', 302);
  const target = new URL(site.url);
  if (s.referee_type !== 'none') target.searchParams.set('coupon', a.code);
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return new Response(null, {
    status: 302,
    headers: {
      location: target.href,
      'set-cookie': `${COOKIE}=${encodeURIComponent(site.id + ':' + a.code)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${CLAIM_DAYS * DAY}${secure}`,
      'cache-control': 'no-store',
    },
  });
}

// ---------- admin ----------

async function sitePlansList(env, siteId) {
  const { results } = await env.DB.prepare('SELECT id, name, price, currency FROM plans WHERE site_id = ? ORDER BY sort, name').bind(siteId).all();
  return results.map(p => ({ ...p, price: p.price || 0, currency: p.currency || 'ILS' }));
}

export async function adminAffiliates(request, env, h, siteId) {
  await h.requireAdmin(request, env);
  await ensureAffiliateSchema(env);
  const site = await h.getSite(env, siteId);
  if (!site) throw new HttpError(404, 'not_found', 'האתר לא נמצא');
  const s = await getSettings(env, siteId);
  const plans = await sitePlansList(env, siteId);
  const [partners, refs, codes, given] = await env.DB.batch([
    env.DB.prepare(
      `SELECT a.user_id, a.code, a.active, a.note, a.source, a.created_at, u.email, u.name, u.avatar,
       (SELECT COUNT(*) FROM referrals r WHERE r.site_id = a.site_id AND r.partner_id = a.user_id) AS referrals,
       (SELECT COUNT(*) FROM referrals r WHERE r.site_id = a.site_id AND r.partner_id = a.user_id AND r.paid_at IS NOT NULL) AS paid,
       (SELECT COUNT(*) FROM referrals r WHERE r.site_id = a.site_id AND r.partner_id = a.user_id AND r.rewarded_at IS NOT NULL) AS rewarded
       FROM affiliates a JOIN users u ON u.id = a.user_id WHERE a.site_id = ? ORDER BY a.created_at DESC`,
    ).bind(siteId),
    env.DB.prepare(
      `SELECT r.user_id, r.partner_id, r.code, r.source, r.created_at, r.paid_at, r.rewarded_at,
       u.email, u.name, p.email AS partner_email, p.name AS partner_name
       FROM referrals r JOIN users u ON u.id = r.user_id JOIN users p ON p.id = r.partner_id
       WHERE r.site_id = ? ORDER BY r.created_at DESC LIMIT 200`,
    ).bind(siteId),
    env.DB.prepare(
      `SELECT c.code, c.user_id, c.active, c.created_at, (SELECT COUNT(*) FROM referrals r WHERE r.code = c.code) AS referrals
       FROM affiliate_codes c WHERE c.site_id = ? ORDER BY c.created_at`,
    ).bind(siteId),
    env.DB.prepare("SELECT features FROM bonus_grants WHERE site_id = ? AND reason IN ('partner', 'referred')").bind(siteId),
  ]);
  // What the program gave (joining gifts and partner rewards), for the "delete everything" sheet.
  const givenTotals = {};
  for (const g of given.results) {
    for (const [k, v] of Object.entries(parseJsonField(g.features, {}))) if (typeof v === 'number') givenTotals[k] = (givenTotals[k] || 0) + v;
  }
  const gift = plans.find(p => p.id === s.referee_plan_ids[0]);
  const currency = (plans.find(p => p.price > 0) || {}).currency || 'ILS';
  return json({
    settings: { ...s, label: refereeLabel(s, 'השותף', currency, gift?.name) },
    plans,
    partners: partners.results.map(p => ({
      ...p, active: !!p.active, link: joinLink(env, p.code),
      codes: codes.results.filter(c => c.user_id === p.user_id)
        .map(c => ({ code: c.code, active: !!c.active, primary: c.code === p.code, referrals: c.referrals, created_at: c.created_at, link: joinLink(env, c.code) })),
    })),
    referrals: refs.results,
    given: { count: given.results.length, label: featuresLabel(givenTotals) },
  });
}

export async function adminSaveSettings(request, env, h, siteId) {
  await h.requireAdmin(request, env);
  await ensureAffiliateSchema(env);
  await ensureBillingSchema(env);
  if (!(await h.getSite(env, siteId))) throw new HttpError(404, 'not_found', 'האתר לא נמצא');
  const input = await readJson(request);
  const type = String(input.referee_type || 'none');
  if (!REFEREE_TYPES.includes(type)) throw new HttpError(400, 'bad_settings', 'סוג לא מוכר');
  let value = 0, months = 0, planIds = [];
  if (isDiscount(type)) {
    // The same rules as a regular coupon of that type.
    const plans = (await env.DB.prepare('SELECT * FROM plans WHERE site_id = ?').bind(siteId).all()).results
      .map(p => ({ ...p, price: p.price || 0 }));
    const c = validateCoupon({ code: 'PARTNER', type, value: input.referee_value, months: input.referee_months, plan_ids: input.referee_plan_ids }, plans);
    ({ value, months, plan_ids: planIds } = c);
  }
  const refereeFeatures = type === 'bonus' ? parseFeatures(input.referee_features, 'המתנה למצטרף') : {};
  if (type === 'bonus' && !Object.keys(refereeFeatures).length) throw new HttpError(400, 'bad_settings', 'כתבו מה המצטרף מקבל, למשל {"minutes": 30}');
  const partnerFeatures = parseFeatures(input.partner_features, 'מה שהשותף מקבל');
  const rewardOn = input.reward_on === 'paid' ? 'paid' : 'signup';
  await env.DB.prepare(
    `INSERT INTO affiliate_settings (site_id, enabled, referee_type, referee_value, referee_months, referee_plan_ids, referee_features, referee_label, partner_features, reward_on, updated_at, self_join)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(site_id) DO UPDATE SET enabled = excluded.enabled, self_join = excluded.self_join, referee_type = excluded.referee_type, referee_value = excluded.referee_value,
       referee_months = excluded.referee_months, referee_plan_ids = excluded.referee_plan_ids, referee_features = excluded.referee_features,
       referee_label = excluded.referee_label, partner_features = excluded.partner_features, reward_on = excluded.reward_on, updated_at = excluded.updated_at`,
  ).bind(siteId, input.enabled ? 1 : 0, type, value, months, JSON.stringify(planIds), JSON.stringify(refereeFeatures),
    String(input.referee_label || '').replace(/\s+/g, ' ').trim().slice(0, 120), JSON.stringify(partnerFeatures), rewardOn, now(), input.self_join ? 1 : 0).run();
  return adminAffiliates(request, env, h, siteId);
}

function randomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from(crypto.getRandomValues(new Uint8Array(8)), n => chars[n % chars.length]).join('');
}

// A free code: the one asked for (or a random one), not used by any partner or coupon of the site.
async function freeCode(env, siteId, wanted) {
  await ensureBillingSchema(env);
  const code = String(wanted || '').trim().toUpperCase();
  if (code && !/^[A-Z0-9_-]{3,30}$/.test(code)) throw new HttpError(400, 'bad_code', 'קוד: 3-30 תווים, אותיות באנגלית, ספרות, מקף או קו תחתון');
  for (let i = 0; i < 5; i++) {
    const c = code || randomCode();
    const taken = await env.DB.batch([
      env.DB.prepare('SELECT 1 FROM affiliate_codes WHERE code = ?').bind(c),
      env.DB.prepare('SELECT 1 FROM coupons WHERE site_id = ? AND code = ?').bind(siteId, c),
    ]);
    if (!taken[0].results.length && !taken[1].results.length) return c;
    if (code) throw new HttpError(400, 'exists', 'הקוד הזה כבר תפוס. בחרו אחר');
  }
  throw new HttpError(500, 'server_error', 'לא הצלחנו ליצור קוד, נסו שוב');
}

async function makePartner(env, siteId, userId, wanted, source, note = '') {
  const onSite = await env.DB.prepare('SELECT status FROM access WHERE user_id = ? AND site_id = ?').bind(userId, siteId).first();
  if (!onSite) throw new HttpError(400, 'not_on_site', 'המשתמש עוד לא נכנס לאתר הזה');
  const mine = await env.DB.prepare('SELECT code FROM affiliates WHERE site_id = ? AND user_id = ?').bind(siteId, userId).first();
  if (mine) throw new HttpError(400, 'exists', `המשתמש כבר שותף, עם הקוד ${mine.code}`);
  const code = await freeCode(env, siteId, wanted);
  await env.DB.batch([
    env.DB.prepare('INSERT INTO affiliates (site_id, user_id, code, active, note, created_at, source) VALUES (?, ?, ?, 1, ?, ?, ?)')
      .bind(siteId, userId, code, String(note || '').slice(0, 200), now(), source),
    env.DB.prepare('INSERT INTO affiliate_codes (code, site_id, user_id, active, created_at) VALUES (?, ?, ?, 1, ?)').bind(code, siteId, userId, now()),
  ]);
  return code;
}

export async function adminAddPartner(request, env, h, siteId) {
  await h.requireAdmin(request, env);
  await ensureAffiliateSchema(env);
  if (!(await h.getSite(env, siteId))) throw new HttpError(404, 'not_found', 'האתר לא נמצא');
  const body = await readJson(request);
  await makePartner(env, siteId, String(body.user_id || ''), body.code, 'admin', body.note);
  return adminAffiliates(request, env, h, siteId);
}

/** POST /api/affiliate/join (site token): the user joins the program by themself, with a random code. */
export async function selfJoin(request, env, h) {
  const session = await h.requireSiteSession(request, env);
  await ensureAffiliateSchema(env);
  const site = await h.getSite(env, session.client_id);
  const s = await getSettings(env, site.id);
  if (!s.enabled || !s.self_join) throw new HttpError(403, 'closed', 'ההצטרפות לתוכנית השותפים סגורה כרגע');
  const mine = await env.DB.prepare('SELECT active FROM affiliates WHERE site_id = ? AND user_id = ?').bind(site.id, session.id).first();
  if (mine && !mine.active) throw new HttpError(403, 'disabled', 'השותפות שלך הושבתה. לפרטים: support@reembir.com');
  if (!mine) await makePartner(env, site.id, session.id, null, 'self');
  return json(await h.siteUserPayload(env, session, site));
}

/**
 * A new code for a partner. primary: it becomes the code they see; keep_old: whether the previous
 * primary still works (it can be turned on or off later anyway).
 */
export async function adminAddCode(request, env, h, siteId, userId) {
  await h.requireAdmin(request, env);
  await ensureAffiliateSchema(env);
  const a = await env.DB.prepare('SELECT code FROM affiliates WHERE site_id = ? AND user_id = ?').bind(siteId, userId).first();
  if (!a) throw new HttpError(404, 'not_found', 'השותף לא נמצא');
  const body = await readJson(request);
  const code = await freeCode(env, siteId, body.code);
  const ops = [env.DB.prepare('INSERT INTO affiliate_codes (code, site_id, user_id, active, created_at) VALUES (?, ?, ?, 1, ?)').bind(code, siteId, userId, now())];
  if (body.primary !== false) {
    ops.push(env.DB.prepare('UPDATE affiliates SET code = ? WHERE site_id = ? AND user_id = ?').bind(code, siteId, userId));
    if (body.keep_old === false) ops.push(env.DB.prepare('UPDATE affiliate_codes SET active = 0 WHERE code = ?').bind(a.code));
  }
  await env.DB.batch(ops);
  return adminAffiliates(request, env, h, siteId);
}

/** enable / disable / primary / delete one of a partner's codes. */
export async function adminCodeAction(request, env, h, siteId, userId, code, action) {
  await h.requireAdmin(request, env);
  await ensureAffiliateSchema(env);
  const a = await env.DB.prepare('SELECT code FROM affiliates WHERE site_id = ? AND user_id = ?').bind(siteId, userId).first();
  const c = a && (await env.DB.prepare('SELECT * FROM affiliate_codes WHERE code = ? AND site_id = ? AND user_id = ?').bind(code, siteId, userId).first());
  if (!c) throw new HttpError(404, 'not_found', 'הקוד לא נמצא');
  const isPrimary = a.code === c.code;
  if (action === 'primary') {
    await env.DB.batch([
      env.DB.prepare('UPDATE affiliates SET code = ? WHERE site_id = ? AND user_id = ?').bind(c.code, siteId, userId),
      env.DB.prepare('UPDATE affiliate_codes SET active = 1 WHERE code = ?').bind(c.code),
    ]);
  } else if (action === 'enable' || action === 'disable') {
    if (isPrimary && action === 'disable') throw new HttpError(400, 'primary', 'זה הקוד הראשי. קבעו קוד ראשי אחר קודם, או השביתו את השותף');
    await env.DB.prepare('UPDATE affiliate_codes SET active = ? WHERE code = ?').bind(action === 'enable' ? 1 : 0, c.code).run();
  } else if (action === 'delete') {
    if (isPrimary) throw new HttpError(400, 'primary', 'אי אפשר למחוק את הקוד הראשי');
    const used = await env.DB.prepare('SELECT 1 FROM referrals WHERE code = ?').bind(c.code).first();
    if (used) throw new HttpError(400, 'used', 'אי אפשר למחוק קוד שכבר הביא מצטרפים. אפשר להשבית אותו');
    await env.DB.prepare('DELETE FROM affiliate_codes WHERE code = ?').bind(c.code).run();
  }
  return adminAffiliates(request, env, h, siteId);
}

/**
 * Deletes all of a site's partner-program data: settings, partners, codes, referrals and the coupon
 * uses of partner codes. remove_bonuses also takes back what the program gave (joining gifts and
 * partner rewards); other bonuses (welcome gift, by hand) stay. Payments and subscriptions stay.
 */
export async function adminResetProgram(request, env, h, siteId) {
  await h.requireAdmin(request, env);
  await ensureAffiliateSchema(env);
  await ensureBillingSchema(env);
  const body = await readJson(request);
  if (body.confirm !== 'מחיקה') throw new HttpError(400, 'confirm', 'כדי למחוק, כתבו "מחיקה"');
  const ops = [
    env.DB.prepare('DELETE FROM coupon_redemptions WHERE site_id = ? AND code IN (SELECT code FROM affiliate_codes WHERE site_id = ?)').bind(siteId, siteId),
    env.DB.prepare('DELETE FROM referrals WHERE site_id = ?').bind(siteId),
    env.DB.prepare('DELETE FROM affiliate_codes WHERE site_id = ?').bind(siteId),
    env.DB.prepare('DELETE FROM affiliates WHERE site_id = ?').bind(siteId),
    env.DB.prepare('DELETE FROM affiliate_settings WHERE site_id = ?').bind(siteId),
  ];
  if (body.remove_bonuses) ops.push(env.DB.prepare("DELETE FROM bonus_grants WHERE site_id = ? AND reason IN ('partner', 'referred')").bind(siteId));
  await env.DB.batch(ops);
  return adminAffiliates(request, env, h, siteId);
}

export async function adminPartnerAction(request, env, h, siteId, userId, action) {
  await h.requireAdmin(request, env);
  await ensureAffiliateSchema(env);
  const a = await env.DB.prepare('SELECT * FROM affiliates WHERE site_id = ? AND user_id = ?').bind(siteId, userId).first();
  if (!a) throw new HttpError(404, 'not_found', 'השותף לא נמצא');
  if (action === 'delete') {
    const n = (await env.DB.prepare('SELECT COUNT(*) AS n FROM referrals WHERE site_id = ? AND partner_id = ?').bind(siteId, userId).first()).n;
    if (n > 0) throw new HttpError(400, 'used', 'אי אפשר למחוק שותף שכבר הביא מצטרפים. אפשר להשבית אותו');
    await env.DB.batch([
      env.DB.prepare('DELETE FROM affiliates WHERE site_id = ? AND user_id = ?').bind(siteId, userId),
      env.DB.prepare('DELETE FROM affiliate_codes WHERE site_id = ? AND user_id = ?').bind(siteId, userId),
    ]);
  } else {
    await env.DB.prepare('UPDATE affiliates SET active = ? WHERE site_id = ? AND user_id = ?').bind(action === 'enable' ? 1 : 0, siteId, userId).run();
  }
  return adminAffiliates(request, env, h, siteId);
}
