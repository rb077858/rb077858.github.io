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
let n = 0;

async function paypal(req) {
  const url = new URL(req.url);
  if (url.pathname === '/v1/oauth2/token') return Response.json({ access_token: 'x', expires_in: 3600 });
  if (url.pathname === '/v1/catalogs/products') return Response.json({ id: 'PROD-' + ++n });
  if (url.pathname === '/v1/billing/plans') {
    const body = await req.json();
    const id = 'P-' + ++n;
    created[id] = body;
    return Response.json({ id });
  }
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
