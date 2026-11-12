// Central billing, end to end: the worker in Miniflare with a real D1 schema and PayPal mocked.
// Run: npm test   (builds into /tmp first)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { Miniflare } from 'miniflare';

const BASE = 'https://login.reembir.com';
const SITE = 'https://timlul.reembir.com';
const subs = {};
const created = {};
const txns = []; // PayPal Transaction Search
const deactivated = [];
let n = 0;

async function paypal(req) {
  const url = new URL(req.url);
  if (url.pathname === '/v1/oauth2/token') return Response.json({ access_token: 'x', expires_in: 3600 });
  if (url.pathname === '/v1/catalogs/products') return Response.json({ id: 'PROD-' + ++n });
  if (url.pathname === '/v1/billing/plans' && req.method === 'POST') {
    const body = await req.json();
    const id = 'P-' + ++n;
    created[id] = body;
    return Response.json({ id });
  }
  if (url.pathname === '/v1/notifications/verify-webhook-signature') {
    const b = await req.json();
    return Response.json({ verification_status: b.webhook_event.id === 'WH-EV-BAD' ? 'FAILURE' : 'SUCCESS' });
  }
  if (url.pathname === '/v1/notifications/webhooks') return Response.json({ id: 'WH-1' });
  if (url.pathname === '/v1/billing/plans' && req.method === 'GET') {
    return Response.json({ total_pages: 1, plans: [...Object.keys(created).slice(0, 1).map(id => ({ id, name: 'mine', status: 'ACTIVE' })), { id: 'P-OLD', name: 'ישנה', status: 'ACTIVE' }] });
  }
  if (url.pathname.endsWith('/deactivate')) { deactivated.push(url.pathname); return new Response(null, { status: 204 }); }
  if (url.pathname === '/v1/reporting/transactions') return Response.json({ transaction_details: txns, total_pages: 1 });
  const m = url.pathname.match(/^\/v1\/billing\/subscriptions\/([^/]+)(\/cancel)?$/);
  if (m && m[2]) { if (subs[m[1]]) subs[m[1]].status = 'CANCELLED'; return new Response(null, { status: 204 }); }
  if (m) return subs[m[1]] ? Response.json(subs[m[1]]) : Response.json({ message: 'nope' }, { status: 404 });
  return Response.json({ message: 'unexpected ' + url.pathname }, { status: 599 });
}

let mf, db;
const hash = t => crypto.createHash('sha256').update(t).digest('base64url');
const t0 = Math.floor(Date.now() / 1000);

before(async () => {
  mf = new Miniflare({
    modules: true, scriptPath: 'index.js', modulesRoot: '.', rootPath: process.env.SSO_DIST || '/tmp/ssodist',
    compatibilityDate: '2025-09-01', d1Databases: ['DB'],
    bindings: { PAYPAL_CLIENT_ID: 'cid', PAYPAL_CLIENT_SECRET: 'sec', ADMIN_EMAILS: 'boss@x.com' },
    serviceBindings: { ASSETS: () => new Response('asset'), CHAT: () => new Response('{}') },
    outboundService: paypal,
  });
  db = await mf.getD1Database('DB');
  const schema = fs.readFileSync(new URL('../schema.sql', import.meta.url), 'utf8').replace(/--.*$/gm, '');
  for (const s of schema.split(';').map(x => x.trim()).filter(Boolean)) await db.prepare(s).run();
  await db.prepare("INSERT INTO sites (id, name, url, redirect_uris, created_at, default_plan) VALUES ('timlul', 'תמלול', ?, ?, ?, 'timlul:free')")
    .bind(SITE + '/', JSON.stringify([SITE + '/']), t0).run();
  for (const [id, name, sort] of [['timlul:free', 'חינם', 0], ['timlul:basic', 'בסיסי', 1], ['timlul:pro', 'מקצועי', 2]]) {
    await db.prepare('INSERT INTO plans (id, site_id, name, features, sort) VALUES (?, ?, ?, ?, ?)').bind(id, 'timlul', name, '{}', sort).run();
  }
  for (const [id, email] of [['u1', 'a@x.com'], ['u2', 'b@x.com'], ['admin', 'boss@x.com']]) {
    await db.prepare('INSERT INTO users (id, email, created_at, email_verified) VALUES (?, ?, ?, 1)').bind(id, email, t0).run();
  }
  // Site tokens for the users, and a dashboard session for the admin.
  for (const [token, user, client] of [['tok-a', 'u1', 'timlul'], ['tok-b', 'u2', 'timlul'], ['adm', 'admin', null]]) {
    await db.prepare('INSERT INTO sessions (id, user_id, client_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?)').bind(hash(token), user, client, t0, t0 + 86400).run();
  }
  // The plan columns arrive with the first request's migration.
  await mf.dispatchFetch(BASE + '/api/config');
});
after(() => mf?.dispose());

const site = (token, path, body) => mf.dispatchFetch(BASE + path, {
  method: body ? 'POST' : 'GET', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json', origin: SITE },
  body: body ? JSON.stringify(body) : undefined,
});
const admin = (path, body, method) => mf.dispatchFetch(BASE + path, {
  method: method || (body ? 'POST' : 'GET'), headers: { cookie: 'sso_session=adm', 'content-type': 'application/json' },
  body: body ? JSON.stringify(body) : undefined,
});
const savePlan = (id, extra) => admin('/api/admin/plans/' + id, { site_id: 'timlul', name: id, features: { minutes: 1 }, sort: 1, ...extra }, 'PUT');
function paypalSub(id, planId, custom) {
  subs[id] = { id, status: 'ACTIVE', plan_id: planId, custom_id: custom, start_time: new Date().toISOString(),
    billing_info: { next_billing_time: new Date(Date.now() + 30 * 864e5).toISOString(), last_payment: { time: new Date().toISOString() } } };
}

test('prices make plans for sale; the catalog creates their PayPal plans once', async () => {
  assert.equal((await savePlan('timlul:basic', { name: 'בסיסי', price: 9, sort: 1 })).status, 200);
  assert.equal((await savePlan('timlul:pro', { name: 'מקצועי', price: 19, sort: 2 })).status, 200);
  const res = await mf.dispatchFetch(BASE + '/api/billing/catalog?client_id=timlul', { headers: { origin: SITE } });
  assert.equal(res.status, 200);
  const c = await res.json();
  assert.deepEqual(c.plans.map(p => [p.id, p.price]), [['timlul:basic', 9], ['timlul:pro', 19]]);
  assert.equal(c.free.id, 'timlul:free');
  assert.equal(c.paypal.client_id, 'cid');
  assert.ok(c.plans.every(p => p.paypal_plan_id));
  const again = await (await mf.dispatchFetch(BASE + '/api/billing/catalog?client_id=timlul')).json();
  assert.deepEqual(again.plans.map(p => p.paypal_plan_id), c.plans.map(p => p.paypal_plan_id), 'reused');

  await savePlan('timlul:pro', { name: 'מקצועי', price: 21, sort: 2 });
  const changed = await (await mf.dispatchFetch(BASE + '/api/billing/catalog?client_id=timlul')).json();
  assert.notEqual(changed.plans[1].paypal_plan_id, c.plans[1].paypal_plan_id, 'a new price gets a new PayPal plan');
  assert.equal(created[changed.plans[1].paypal_plan_id].billing_cycles[0].pricing_scheme.fixed_price.value, '21');

  await savePlan('timlul:pro', { name: 'מקצועי', price: 21, sort: 2, public: false });
  const hidden = await (await mf.dispatchFetch(BASE + '/api/billing/catalog?client_id=timlul')).json();
  assert.deepEqual(hidden.plans.map(p => p.id), ['timlul:basic'], 'hidden plans are not for sale');
  await savePlan('timlul:pro', { name: 'מקצועי', price: 19, sort: 2, public: true });
});

test('subscribe: the plan is set until the paid date, shown in userinfo, then cancel', async () => {
  const c = await (await mf.dispatchFetch(BASE + '/api/billing/catalog?client_id=timlul')).json();
  paypalSub('I-SUB1', c.plans[0].paypal_plan_id, 'timlul:u1');
  paypalSub('I-SUBX', c.plans[0].paypal_plan_id, 'timlul:u2');
  assert.equal((await site('tok-a', '/api/billing/activate', { subscription_id: 'I-SUBX' })).status, 403, 'someone else’s');

  let r = await site('tok-a', '/api/billing/activate', { subscription_id: 'I-SUB1' });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('access-control-allow-origin'), SITE);
  let u = await r.json();
  assert.equal(u.access.plan.id, 'timlul:basic');
  assert.ok(u.access.plan_expires_at > t0 + 29 * 86400);
  assert.equal(u.access.subscription.status, 'ACTIVE');

  // Upgrade: the old subscription is cancelled at PayPal.
  paypalSub('I-SUB2', c.plans[1].paypal_plan_id, 'timlul:u1');
  u = await (await site('tok-a', '/api/billing/activate', { subscription_id: 'I-SUB2' })).json();
  assert.equal(u.access.plan.id, 'timlul:pro');
  assert.equal(subs['I-SUB1'].status, 'CANCELLED');

  u = await (await site('tok-a', '/api/billing/cancel', {})).json();
  assert.equal(u.access.plan.id, 'timlul:pro', 'keeps the plan until the paid month ends');
  assert.equal(u.access.subscription.status, 'CANCELLED');

  const b = await (await admin('/api/admin/sites/timlul/billing')).json();
  assert.equal(b.subscriptions.length, 2);
  assert.equal(b.subscriptions[0].email, 'a@x.com');
});

test('renewal: a due subscription moves the expiry forward on the next userinfo', async () => {
  const c = await (await mf.dispatchFetch(BASE + '/api/billing/catalog?client_id=timlul')).json();
  paypalSub('I-SUB3', c.plans[0].paypal_plan_id, 'timlul:u2');
  await site('tok-b', '/api/billing/activate', { subscription_id: 'I-SUB3' });
  await db.prepare('UPDATE subscriptions SET paid_until = ?, checked_at = ? WHERE id = ?').bind(t0 + 60, t0 - 7200, 'I-SUB3').run();
  await db.prepare('UPDATE access SET plan_expires_at = ? WHERE user_id = ?').bind(t0 + 60, 'u2').run();
  subs['I-SUB3'].billing_info.next_billing_time = new Date(Date.now() + 60 * 864e5).toISOString();
  const u = await (await site('tok-b', '/api/userinfo')).json();
  assert.ok(u.access.plan_expires_at > t0 + 59 * 86400, 'renewed');
});

test('coupons: discounts with their own PayPal plans, gifts without payment, once per person', async () => {
  const create = body => admin('/api/admin/sites/timlul/coupons', body);
  assert.equal((await create({ code: 'X', type: 'percent', value: 10 })).status, 400);
  assert.equal((await create({ code: 'HALF', type: 'percent', value: 50, months: 3, plan_ids: ['timlul:pro'] })).status, 200);
  assert.equal((await create({ code: 'half', type: 'trial', months: 1 })).status, 400, 'duplicate');
  assert.equal((await create({ code: 'GIFT', type: 'gift', months: 2, plan_ids: ['timlul:pro'] })).status, 200);

  const offer = await (await site('tok-b', '/api/billing/coupon', { code: 'half' })).json();
  const o = offer.offers['timlul:pro'];
  assert.equal(o.first_price, 9.5);
  const cyc = created[o.paypal_plan_id].billing_cycles;
  assert.equal(cyc[0].tenure_type, 'TRIAL');
  assert.equal(cyc[0].total_cycles, 3);

  paypalSub('I-SUBC', o.paypal_plan_id, 'timlul:u2');
  assert.equal((await site('tok-b', '/api/billing/activate', { subscription_id: 'I-SUBC' })).status, 200);
  assert.equal((await site('tok-b', '/api/billing/coupon', { code: 'HALF' })).status, 400, 'used');
  paypalSub('I-SUBC2', o.paypal_plan_id, 'timlul:u2');
  assert.equal((await site('tok-b', '/api/billing/activate', { subscription_id: 'I-SUBC2' })).status, 400, 'second use of the coupon plan');
  assert.equal(subs['I-SUBC2'].status, 'CANCELLED');

  // u1 has a cancelled-but-running pro subscription: a gift isn't for them.
  assert.equal((await site('tok-a', '/api/billing/redeem', { code: 'GIFT' })).status, 400);
  await db.prepare("INSERT INTO users (id, email, created_at, email_verified) VALUES ('u3', 'c@x.com', ?, 1)").bind(t0).run();
  await db.prepare("INSERT INTO sessions (id, user_id, client_id, created_at, expires_at) VALUES (?, 'u3', 'timlul', ?, ?)").bind(hash('tok-c'), t0, t0 + 86400).run();
  const g = await (await site('tok-c', '/api/billing/redeem', { code: 'gift' })).json();
  assert.equal(g.access.plan.id, 'timlul:pro');
  assert.ok(Math.abs(g.access.plan_expires_at - (t0 + 61 * 86400)) < 3 * 86400, 'two months');
  assert.equal((await site('tok-c', '/api/billing/redeem', { code: 'GIFT' })).status, 400, 'once');

  const b = await (await admin('/api/admin/sites/timlul/billing')).json();
  assert.equal(b.coupons.find(c => c.code === 'HALF').uses, 1);
  assert.equal(b.coupons.find(c => c.code === 'GIFT').label, 'מתנה: 2 חודשים בתוכנית מקצועי, בלי תשלום');
  assert.equal((await admin('/api/admin/sites/timlul/coupons/HALF', null, 'DELETE')).status, 400, 'used codes stay');
  assert.equal((await admin('/api/admin/sites/timlul/coupons/HALF/disable', {})).status, 200);
  assert.equal((await site('tok-c', '/api/billing/coupon', { code: 'HALF' })).status, 400, 'disabled');
});

test('the admin can cancel a subscription; non-admins get nothing', async () => {
  assert.equal((await site('tok-a', '/api/admin/sites/timlul/billing')).status, 401);
  const r = await (await admin('/api/admin/subscriptions/I-SUB3/cancel', {})).json();
  assert.equal(r.subscriptions.find(s => s.id === 'I-SUB3').status, 'CANCELLED');
  const st = await (await admin('/api/admin/stats')).json();
  assert.equal(st.billing.configured, true);
});

test('paid but the page never confirmed: the started subscription becomes the plan on the next userinfo', async () => {
  await db.prepare("INSERT INTO users (id, email, created_at, email_verified) VALUES ('u5', 'lost1@x.com', ?, 1)").bind(t0).run();
  await db.prepare('INSERT INTO sessions (id, user_id, client_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?)').bind(hash('tok-e'), 'u5', 'timlul', t0, t0 + 86400).run();
  const c = await (await mf.dispatchFetch(BASE + '/api/billing/catalog?client_id=timlul')).json();
  paypalSub('I-LOST1', c.plans[0].paypal_plan_id, 'timlul:u5');
  assert.equal((await site('tok-e', '/api/billing/started', { subscription_id: 'I-LOST1' })).status, 200);
  // ...and the tab closed. A minute later the site asks for the user:
  await db.prepare('UPDATE subscription_starts SET created_at = ? WHERE id = ?').bind(t0 - 120, 'I-LOST1').run();
  const u = await (await site('tok-e', '/api/userinfo')).json();
  assert.equal(u.access.plan.id, 'timlul:basic');
  assert.equal(u.access.subscription.status, 'ACTIVE');
  assert.equal((await db.prepare('SELECT done FROM subscription_starts WHERE id = ?').bind('I-LOST1').first()).done, 1);
});

test('the admin finds payments at PayPal that never became a plan, and fixes them', async () => {
  await db.prepare("INSERT INTO users (id, email, name, created_at, email_verified) VALUES ('u6', 'lost2@x.com', 'דורית', ?, 1)").bind(t0).run();
  const c = await (await mf.dispatchFetch(BASE + '/api/billing/catalog?client_id=timlul')).json();
  paypalSub('I-LOST2', c.plans[1].paypal_plan_id, 'timlul:u6');
  const tx = (id, value) => ({ transaction_info: { paypal_reference_id: id, paypal_reference_id_type: 'SUB', transaction_initiation_date: new Date().toISOString(), transaction_amount: { value: String(value), currency_code: 'ILS' } }, payer_info: { email_address: 'dorit@paypal.com' } });
  txns.push(tx('I-LOST2', 19), tx('I-SUB2', 19)); // I-SUB2 is known here (cancelled, still paid up) → fine

  assert.equal((await site('tok-a', '/api/admin/billing/scan')).status, 401);
  const r = await (await admin('/api/admin/billing/scan')).json();
  assert.equal(r.search_error, null, JSON.stringify(r));
  assert.deepEqual(r.problems.map(p => p.id), ['I-LOST2'], JSON.stringify(r));
  const p = r.problems[0];
  assert.equal(p.user.email, 'lost2@x.com');
  assert.equal(p.plan.id, 'timlul:pro');
  assert.equal(p.payer, 'dorit@paypal.com');
  assert.equal(p.fixable, true);

  assert.equal((await admin('/api/admin/billing/link', { subscription_id: 'nope' })).status, 400);
  const f = await (await admin('/api/admin/billing/link', { subscription_id: 'I-LOST2' })).json();
  assert.equal(f.fixed?.user.id, 'u6', JSON.stringify(f));
  const acc = await db.prepare("SELECT plan_id, plan_expires_at FROM access WHERE user_id = 'u6' AND site_id = 'timlul'").first();
  assert.equal(acc.plan_id, 'timlul:pro');
  assert.ok(acc.plan_expires_at > t0 + 29 * 86400);
  assert.deepEqual((await (await admin('/api/admin/billing/scan')).json()).problems, []);
});

const hook = (id, type, resource) => mf.dispatchFetch(BASE + '/api/paypal/webhook', {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'paypal-transmission-id': 't', 'paypal-transmission-sig': 's', 'paypal-transmission-time': 'x', 'paypal-cert-url': 'https://x', 'paypal-auth-algo': 'a' },
  body: JSON.stringify({ id, event_type: type, create_time: new Date().toISOString(), resource }),
});

test('webhook: refused until it is connected; connecting is one admin click', async () => {
  assert.equal((await hook('WH-EV-0', 'PAYMENT.SALE.COMPLETED', {})).status, 503);
  assert.ok([401, 403].includes((await site('tok-a', '/api/admin/billing/paypal/webhook', {})).status), 'not for sites');
  const st = await (await admin('/api/admin/billing/paypal/webhook', {})).json();
  assert.equal(st.webhook.connected, true);
  assert.equal(st.webhook.id, 'WH-1');
  assert.equal(st.webhook.url, BASE + '/api/paypal/webhook');
});

test('webhook: a payment the page never confirmed becomes the plan, and the money is counted', async () => {
  await db.prepare("INSERT INTO users (id, email, name, created_at, email_verified) VALUES ('u7', 'hook@x.com', 'הוק', ?, 1)").bind(t0).run();
  const c = await (await mf.dispatchFetch(BASE + '/api/billing/catalog?client_id=timlul')).json();
  paypalSub('I-HOOK1', c.plans[1].paypal_plan_id, 'timlul:u7'); // pro
  assert.equal((await hook('WH-EV-BAD', 'BILLING.SUBSCRIPTION.ACTIVATED', { id: 'I-HOOK1' })).status, 401, 'signature is checked');
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM access WHERE user_id = 'u7'").first()).n, 0);

  assert.equal((await hook('WH-EV-1', 'BILLING.SUBSCRIPTION.ACTIVATED', { id: 'I-HOOK1' })).status, 200);
  const acc = await db.prepare("SELECT plan_id, plan_expires_at FROM access WHERE user_id = 'u7' AND site_id = 'timlul'").first();
  assert.equal(acc.plan_id, 'timlul:pro');
  assert.ok(acc.plan_expires_at > t0 + 29 * 86400);

  const sale = { id: 'SALE-1', billing_agreement_id: 'I-HOOK1', amount: { total: '19.00', currency: 'ILS' }, transaction_fee: { value: '1.85' } };
  assert.equal((await hook('WH-EV-2', 'PAYMENT.SALE.COMPLETED', sale)).status, 200);
  assert.equal((await (await hook('WH-EV-2', 'PAYMENT.SALE.COMPLETED', sale)).json()).duplicate, true, 'PayPal retries are ignored');

  const st = await (await admin('/api/admin/billing/paypal')).json();
  assert.deepEqual(st.revenue_30d, [{ currency: 'ILS', payments: 1, gross: 19, fees: 1.85, refunds: 0, net: 17.15 }]);
  await hook('WH-EV-3', 'PAYMENT.SALE.REFUNDED', { id: 'R-1', sale_id: 'SALE-1', amount: { total: '19.00', currency: 'ILS' } });
  assert.equal((await (await admin('/api/admin/billing/paypal')).json()).revenue_30d[0].net, -1.85);

  // The page then confirms the same subscription: no error, no double count.
  await db.prepare("INSERT INTO sessions (id, user_id, client_id, created_at, expires_at) VALUES (?, 'u7', 'timlul', ?, ?)").bind(hash('tok-h'), t0, t0 + 86400).run();
  const act = await site('tok-h', '/api/billing/activate', { subscription_id: 'I-HOOK1' });
  assert.equal(act.status, 200);
  const b = await (await admin('/api/admin/sites/timlul/billing')).json();
  assert.equal(b.stats.collected_30d[0].gross, 19);
});

test('webhook: renewal moves the expiry, a cancellation shows, a failed charge is counted', async () => {
  subs['I-HOOK1'].billing_info.next_billing_time = new Date(Date.now() + 70 * 864e5).toISOString();
  await hook('WH-EV-4', 'PAYMENT.SALE.COMPLETED', { id: 'SALE-2', billing_agreement_id: 'I-HOOK1', amount: { total: '19', currency: 'ILS' } });
  assert.ok((await db.prepare("SELECT plan_expires_at FROM access WHERE user_id = 'u7'").first()).plan_expires_at > t0 + 69 * 86400);

  await hook('WH-EV-5', 'BILLING.SUBSCRIPTION.PAYMENT.FAILED', { id: 'I-HOOK1' });
  assert.equal((await (await admin('/api/admin/billing/paypal')).json()).failed_payments_30d, 1);

  subs['I-HOOK1'].status = 'CANCELLED';
  await hook('WH-EV-6', 'BILLING.SUBSCRIPTION.CANCELLED', { id: 'I-HOOK1' });
  assert.equal((await db.prepare("SELECT status FROM subscriptions WHERE id = 'I-HOOK1'").first()).status, 'CANCELLED');
  assert.equal((await db.prepare("SELECT plan_id FROM access WHERE user_id = 'u7'").first()).plan_id, 'timlul:pro', 'paid month keeps working');
});

test('the admin sees PayPal plans, and can switch off only the ones the system does not use', async () => {
  const r = await (await admin('/api/admin/billing/paypal/plans')).json();
  assert.equal(r.plans.find(p => p.id === 'P-OLD').in_use, false);
  const mineId = r.plans.find(p => p.name === 'mine').id;
  assert.equal((await admin(`/api/admin/billing/paypal/plans/${mineId}/deactivate`, {})).status, 400);
  assert.equal((await admin('/api/admin/billing/paypal/plans/P-OLD/deactivate', {})).status, 200);
  assert.deepEqual(deactivated, ['/v1/billing/plans/P-OLD/deactivate']);
});

test('deleting a coupon switches off its PayPal plan; a plan of a deleted code is "old" in the cleanup list', async () => {
  deactivated.length = 0;
  assert.equal((await admin('/api/admin/sites/timlul/coupons', { code: 'TMPX', type: 'percent', value: 20, months: 1, plan_ids: ['timlul:pro'] })).status, 200);
  await db.prepare("INSERT INTO billing_plans (paypal_plan_id, plan_id, env, price, currency, coupon_code, created_at, offer) VALUES ('P-TMPX', 'timlul:pro', 'live', 15, 'ILS', 'TMPX', ?, '')").bind(t0).run();
  let r = await (await admin('/api/admin/billing/paypal/plans')).json();
  assert.equal(r.plans.find(p => p.id === 'P-OLD').in_use, false);

  assert.equal((await admin('/api/admin/sites/timlul/coupons/TMPX', undefined, 'DELETE')).status, 200);
  assert.deepEqual(deactivated, ['/v1/billing/plans/P-TMPX/deactivate']);
  assert.equal(await db.prepare("SELECT 1 AS x FROM billing_plans WHERE paypal_plan_id = 'P-TMPX'").first(), null, 'forgotten, so the catalog never offers it');

  // A plan whose code was deleted by hand (before this fix) can be cleaned up from the list.
  await db.prepare("INSERT INTO billing_plans (paypal_plan_id, plan_id, env, price, currency, coupon_code, created_at, offer) VALUES ('P-GONE', 'timlul:pro', 'live', 15, 'ILS', 'GONE', ?, '')").bind(t0).run();
  assert.equal((await admin('/api/admin/billing/paypal/plans/P-GONE/deactivate', {})).status, 200);
  assert.equal(await db.prepare("SELECT 1 AS x FROM billing_plans WHERE paypal_plan_id = 'P-GONE'").first(), null);
});

test('linking a subscription by hand counts the payment it already made; the webhook then replaces the estimate', async () => {
  await db.prepare("INSERT INTO users (id, email, name, created_at, email_verified) VALUES ('u8', 'late@x.com', 'מאוחרת', ?, 1)").bind(t0).run();
  const c = await (await mf.dispatchFetch(BASE + '/api/billing/catalog?client_id=timlul')).json();
  paypalSub('I-LATE1', c.plans[1].paypal_plan_id, 'timlul:u8');
  subs['I-LATE1'].billing_info.last_payment = { time: new Date().toISOString(), amount: { value: '19.00', currency_code: 'ILS' } };
  const before = (await (await admin('/api/admin/sites/timlul/billing')).json()).stats.collected_30d[0].gross;
  assert.equal((await admin('/api/admin/billing/link', { subscription_id: 'I-LATE1' })).status, 200);
  let after = (await (await admin('/api/admin/sites/timlul/billing')).json()).stats.collected_30d[0];
  assert.equal(after.gross, before + 19);

  await hook('WH-EV-L1', 'PAYMENT.SALE.COMPLETED', { id: 'SALE-L', billing_agreement_id: 'I-LATE1', amount: { total: '19.00', currency: 'ILS' }, transaction_fee: { value: '1.85' } });
  after = (await (await admin('/api/admin/sites/timlul/billing')).json()).stats.collected_30d[0];
  assert.equal(after.gross, before + 19, 'not counted twice');
  assert.equal(after.fees, 1.85 + 1.85, 'and now with its fee');
});

test('a subscription linked before the numbers existed gets its payment filled in on the next look', async () => {
  await db.prepare("INSERT INTO users (id, email, created_at, email_verified) VALUES ('u9', 'old@x.com', ?, 1)").bind(t0).run();
  const c = await (await mf.dispatchFetch(BASE + '/api/billing/catalog?client_id=timlul')).json();
  paypalSub('I-OLD1', c.plans[0].paypal_plan_id, 'timlul:u9');
  subs['I-OLD1'].billing_info.last_payment = { time: new Date().toISOString(), amount: { value: '9.00', currency_code: 'ILS' } };
  const baseline = (await (await admin('/api/admin/billing/paypal')).json()).revenue_30d[0].gross;
  // known here since long ago, with no payment recorded
  await db.prepare("INSERT INTO subscriptions (id, user_id, site_id, plan_id, status, env, price, currency, period_start, paid_until, created_at, updated_at, checked_at) VALUES ('I-OLD1', 'u9', 'timlul', 'timlul:basic', 'ACTIVE', 'live', 9, 'ILS', ?, ?, ?, ?, ?)").bind(t0, t0 + 20 * 86400, t0, t0, t0).run();
  await db.prepare("DELETE FROM paypal_state WHERE key = 'last_backfill'").run();
  const st = await (await admin('/api/admin/billing/paypal')).json();
  assert.equal(st.revenue_30d[0].gross, baseline + 9);
});
