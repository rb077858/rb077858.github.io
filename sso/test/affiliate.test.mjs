// Partner program, end to end: the worker in Miniflare with a real D1 schema and PayPal mocked.
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
const orders = {};
let n = 0;

async function paypal(req) {
  const url = new URL(req.url);
  if (url.pathname === '/v1/oauth2/token') return Response.json({ access_token: 'x', expires_in: 3600 });
  if (url.pathname === '/v1/catalogs/products') return Response.json({ id: 'PROD-' + ++n });
  if (url.pathname === '/v1/billing/plans') { const id = 'P-' + ++n; created[id] = await req.json(); return Response.json({ id }); }
  let m = url.pathname.match(/^\/v1\/billing\/subscriptions\/([^/]+)(\/cancel)?$/);
  if (m && m[2]) { if (subs[m[1]]) subs[m[1]].status = 'CANCELLED'; return new Response(null, { status: 204 }); }
  if (m) return subs[m[1]] ? Response.json(subs[m[1]]) : Response.json({ message: 'nope' }, { status: 404 });
  if (url.pathname === '/v2/checkout/orders') {
    const id = 'ORDER-' + String(++n).padStart(4, '0');
    orders[id] = await req.json();
    return Response.json({ id }, { status: 201 });
  }
  m = url.pathname.match(/^\/v2\/checkout\/orders\/([^/]+)\/capture$/);
  if (m) {
    const unit = orders[m[1]].purchase_units[0];
    return Response.json({ id: m[1], status: 'COMPLETED', purchase_units: [{ ...unit, payments: { captures: [{ id: 'CAP-' + m[1], status: 'COMPLETED', amount: unit.amount, custom_id: unit.custom_id }] } }] });
  }
  return Response.json({ message: 'unexpected ' + url.pathname }, { status: 599 });
}

let mf, db;
const hash = t => crypto.createHash('sha256').update(t).digest('base64url');
const t0 = Math.floor(Date.now() / 1000);

async function addUser(id, { site = true, joined = t0, plan = null } = {}) {
  await db.prepare('INSERT INTO users (id, email, name, created_at, email_verified) VALUES (?, ?, ?, ?, 1)').bind(id, id + '@x.com', 'User ' + id, t0).run();
  await db.prepare('INSERT INTO sessions (id, user_id, client_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?)').bind(hash('site-' + id), id, 'timlul', t0, t0 + 86400).run();
  await db.prepare('INSERT INTO sessions (id, user_id, client_id, created_at, expires_at) VALUES (?, ?, NULL, ?, ?)').bind(hash('portal-' + id), id, t0, t0 + 86400).run();
  if (site) await db.prepare("INSERT INTO access (user_id, site_id, status, plan_id, created_at) VALUES (?, 'timlul', 'active', ?, ?)").bind(id, plan, joined).run();
}

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
  await db.prepare("INSERT INTO sites (id, name, url, redirect_uris, access_mode, created_at, default_plan) VALUES ('timlul', 'תמלול', ?, ?, 'open', ?, 'timlul:free')")
    .bind(SITE + '/', JSON.stringify([SITE + '/']), t0).run();
  for (const [id, name, sort] of [['timlul:free', 'חינם', 0], ['timlul:pro', 'מקצועי', 1]]) {
    await db.prepare('INSERT INTO plans (id, site_id, name, features, sort) VALUES (?, ?, ?, ?, ?)').bind(id, 'timlul', name, '{}', sort).run();
  }
  await db.prepare("INSERT INTO users (id, email, created_at, email_verified) VALUES ('admin', 'boss@x.com', ?, 1)").bind(t0).run();
  await db.prepare("INSERT INTO sessions (id, user_id, client_id, created_at, expires_at) VALUES (?, 'admin', NULL, ?, ?)").bind(hash('adm'), t0, t0 + 86400).run();
  await mf.dispatchFetch(BASE + '/api/config');
  await db.prepare("UPDATE plans SET price = 20, currency = 'ILS', public = 1 WHERE id = 'timlul:pro'").run();
  await addUser('partner');
  await addUser('old', { joined: t0 - 90 * 86400 });
  await addUser('outsider', { site: false });
});
after(() => mf?.dispose());

const site = (id, path, body) => mf.dispatchFetch(BASE + path, {
  method: body ? 'POST' : 'GET', headers: { authorization: 'Bearer site-' + id, 'content-type': 'application/json', origin: SITE },
  body: body ? JSON.stringify(body) : undefined,
});
const admin = (path, body, method) => mf.dispatchFetch(BASE + path, {
  method: method || (body ? 'POST' : 'GET'), headers: { cookie: 'sso_session=adm', 'content-type': 'application/json' },
  body: body ? JSON.stringify(body) : undefined,
});
const settings = body => admin('/api/admin/sites/timlul/affiliates/settings', { enabled: true, ...body }, 'PUT');
const me = async id => (await (await site(id, '/api/userinfo')).json()).access;
// The first sign-in to the site, on login.reembir.com (with whatever cookies the browser has).
const authorize = (id, cookie = '') => mf.dispatchFetch(BASE + '/api/authorize', {
  method: 'POST', headers: { cookie: `sso_session=portal-${id}; ${cookie}`, 'content-type': 'application/json' },
  body: JSON.stringify({ client_id: 'timlul', redirect_uri: SITE + '/', code_challenge_method: 'S256', code_challenge: 'a'.repeat(43) }),
});

let code;

test('admin: settings, and partners only from the site’s users', async () => {
  assert.equal((await settings({ referee_type: 'bonus', referee_features: '{}' })).status, 400, 'a bonus needs content');
  assert.equal((await settings({ referee_type: 'percent', referee_value: 500 })).status, 400, 'coupon rules apply');
  assert.equal((await settings({ partner_features: '[1]' })).status, 400);
  let r = await settings({ referee_type: 'bonus', referee_features: '{"minutes": 30}', partner_features: { minutes: 100 }, reward_on: 'signup' });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).settings.label, 'מתנה: 30 דקות');

  assert.equal((await admin('/api/admin/sites/timlul/affiliates', { user_id: 'outsider' })).status, 400, 'not on the site');
  assert.equal((await admin('/api/admin/sites/timlul/affiliates', { user_id: 'partner', code: 'a' })).status, 400, 'bad code');
  r = await admin('/api/admin/sites/timlul/affiliates', { user_id: 'partner', code: 'dana' });
  assert.equal(r.status, 200);
  const d = await r.json();
  assert.equal(d.partners[0].code, 'DANA');
  assert.equal(d.partners[0].link, BASE + '/join/DANA');
  code = 'DANA';
  assert.equal((await admin('/api/admin/sites/timlul/affiliates', { user_id: 'partner' })).status, 400, 'already a partner');
  assert.equal((await admin('/api/admin/sites/timlul/affiliates', { user_id: 'old', code: 'DANA' })).status, 400, 'code taken');
  r = await (await admin('/api/admin/sites/timlul/affiliates', { user_id: 'old' })).json();
  assert.match(r.partners.find(p => p.user_id === 'old').code, /^[A-Z2-9]{8}$/, 'random code');
  assert.equal((await site('a', '/api/admin/sites/timlul/affiliates')).status, 401);

  const p = await me('partner');
  assert.deepEqual(p.affiliate, { code: 'DANA', link: BASE + '/join/DANA', active: true, referrals: 0, paid: 0 });
});

test('the link: a cookie, then the first sign-in to the site is the partner’s', async () => {
  const j = await mf.dispatchFetch(BASE + '/join/dana', { redirect: 'manual' });
  assert.equal(j.status, 302);
  assert.equal(j.headers.get('location'), SITE + '/?coupon=DANA');
  const cookie = j.headers.get('set-cookie').split(';')[0];
  assert.equal(cookie, 'reem_ref=' + encodeURIComponent('timlul:DANA'));
  assert.equal((await mf.dispatchFetch(BASE + '/join/NOPE1', { redirect: 'manual' })).headers.get('location'), BASE + '/');

  await addUser('newbie', { site: false });
  assert.equal((await (await authorize('newbie', cookie)).json()).status, 'ok');
  assert.deepEqual((await me('newbie')).rewards, { totals: { minutes: 30 }, count: 1 }, 'the newcomer’s gift');
  assert.deepEqual((await me('partner')).rewards, { totals: { minutes: 100 }, count: 1 }, 'the partner’s reward');

  // Signing in again (or someone already on the site) doesn't count again.
  await authorize('newbie', cookie);
  await authorize('old', cookie);
  const p = await me('partner');
  assert.equal(p.affiliate.referrals, 1);
  assert.deepEqual(p.rewards.totals, { minutes: 100 });
});

test('typing the code: new users only, never your own, once', async () => {
  let r = await site('partner', '/api/billing/coupon', { code: 'dana' });
  assert.equal(r.status, 400, 'own code');
  await addUser('typist');
  r = await (await site('typist', '/api/billing/coupon', { code: 'dana' })).json();
  assert.equal(r.type, 'referral');
  assert.equal(r.label, 'מתנה: 30 דקות');
  assert.equal(r.partner, 'User partner');
  const u = await (await site('typist', '/api/billing/redeem', { code: 'DANA' })).json();
  assert.deepEqual(u.access.rewards.totals, { minutes: 30 });
  assert.equal((await site('typist', '/api/billing/redeem', { code: 'DANA' })).status, 200, 'idempotent');
  assert.deepEqual((await me('typist')).rewards.totals, { minutes: 30 });
  assert.equal((await site('old', '/api/billing/redeem', { code: 'DANA' })).status, 400, 'joined long ago');
  assert.equal((await me('partner')).affiliate.referrals, 2);
});

test('a discount code: its own PayPal plan, the referral on subscribing, the reward on paying', async () => {
  await settings({ referee_type: 'percent', referee_value: 50, referee_months: 1, partner_features: { minutes: 200 }, reward_on: 'paid' });
  await addUser('payer');
  const c = await (await site('payer', '/api/billing/coupon', { code: 'DANA' })).json();
  assert.equal(c.type, 'percent');
  const o = c.offers['timlul:pro'];
  assert.equal(o.first_price, 10);
  assert.equal(created[o.paypal_plan_id].billing_cycles[0].pricing_scheme.fixed_price.value, '10');

  subs['I-AFF1'] = { id: 'I-AFF1', status: 'ACTIVE', plan_id: o.paypal_plan_id, custom_id: 'timlul:payer', start_time: new Date().toISOString(),
    billing_info: { next_billing_time: new Date(Date.now() + 30 * 864e5).toISOString() } };
  assert.equal((await site('payer', '/api/billing/activate', { subscription_id: 'I-AFF1' })).status, 200);
  const p = await me('partner');
  assert.equal(p.affiliate.referrals, 3);
  assert.equal(p.affiliate.paid, 1);
  assert.deepEqual(p.rewards.totals, { minutes: 400 }, '100 + 100 on sign-up, +200 on payment');

  // A new discount gets a new PayPal plan for the same code.
  await settings({ referee_type: 'percent', referee_value: 25, referee_months: 1, partner_features: { minutes: 200 }, reward_on: 'paid' });
  await addUser('payer2');
  const c2 = await (await site('payer2', '/api/billing/coupon', { code: 'DANA' })).json();
  assert.equal(c2.offers['timlul:pro'].first_price, 15);
  assert.notEqual(c2.offers['timlul:pro'].paypal_plan_id, o.paypal_plan_id);
});

test('reward on payment also works with a pack; a disabled partner or program stops new referrals', async () => {
  await settings({ referee_type: 'none', partner_features: { minutes: 50 }, reward_on: 'paid' });
  const j = await mf.dispatchFetch(BASE + '/join/DANA', { redirect: 'manual' });
  assert.equal(j.headers.get('location'), SITE + '/', 'nothing to apply on the site');
  const cookie = j.headers.get('set-cookie').split(';')[0];
  await addUser('buyer', { site: false });
  await authorize('buyer', cookie);
  assert.equal((await me('partner')).affiliate.referrals, 4);
  assert.deepEqual((await me('partner')).rewards.totals, { minutes: 400 }, 'not yet');

  await admin('/api/admin/sites/timlul/packs/timlul:p1', { name: 'p', price: 5, features: { minutes: 10 } }, 'PUT');
  const { id } = await (await site('buyer', '/api/billing/pack/order', { pack_id: 'timlul:p1' })).json();
  assert.equal((await site('buyer', '/api/billing/pack/capture', { order_id: id })).status, 200);
  assert.deepEqual((await me('partner')).rewards.totals, { minutes: 450 });

  assert.equal((await admin('/api/admin/sites/timlul/affiliates/partner', null, 'DELETE')).status, 400, 'has referrals');
  await admin('/api/admin/sites/timlul/affiliates/partner/disable', {});
  assert.equal((await site('typist', '/api/billing/coupon', { code: 'DANA' })).status, 400, 'disabled');
  assert.equal((await mf.dispatchFetch(BASE + '/join/DANA', { redirect: 'manual' })).headers.get('location'), BASE + '/');

  const d = await (await admin('/api/admin/sites/timlul/affiliates')).json();
  assert.equal(d.referrals.length, 4);
  assert.deepEqual(d.partners.find(p => p.code === 'DANA').referrals, 4);
  const other = d.partners.find(p => p.user_id === 'old');
  assert.equal((await admin('/api/admin/sites/timlul/affiliates/old', null, 'DELETE')).status, 200, `unused partner ${other.code} can go`);
});

test('self-join: closed until the switch is on, then a random code; the site sees the program', async () => {
  await addUser('fan');
  await settings({ referee_type: 'bonus', referee_features: { minutes: 30 }, partner_features: { minutes: 100 }, reward_on: 'paid', self_join: false });
  assert.equal((await site('fan', '/api/affiliate/join', {})).status, 403);
  let a = await me('fan');
  assert.deepEqual(a.affiliate_program, { self_join: false, label: 'מתנה: 30 דקות', reward: { minutes: 100 }, reward_on: 'paid' });

  await settings({ referee_type: 'bonus', referee_features: { minutes: 30 }, partner_features: { minutes: 100 }, reward_on: 'paid', self_join: true });
  const r = await site('fan', '/api/affiliate/join', {});
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('access-control-allow-origin'), SITE);
  a = (await r.json()).access;
  assert.match(a.affiliate.code, /^[A-Z2-9]{8}$/);
  assert.equal(a.affiliate_program.self_join, true);
  const again = (await (await site('fan', '/api/affiliate/join', {})).json()).access;
  assert.equal(again.affiliate.code, a.affiliate.code, 'joining twice keeps the code');
  // A partner the admin disabled can't rejoin by themself.
  assert.equal((await site('partner', '/api/affiliate/join', {})).status, 403);

  const d = await (await admin('/api/admin/sites/timlul/affiliates')).json();
  const fan = d.partners.find(p => p.user_id === 'fan');
  assert.equal(fan.source, 'self');
  assert.equal(d.settings.self_join, true);

  await settings({ referee_type: 'none', enabled: false });
  assert.equal((await me('fan')).affiliate_program, null, 'program off');
  await settings({ referee_type: 'none', self_join: true });
});

test('several codes per partner: only the primary is shown; old codes stay on or off', async () => {
  const codes = (path, body) => admin('/api/admin/sites/timlul/affiliates/fan/codes' + path, body, body === null ? 'DELETE' : undefined);
  const first = (await me('fan')).affiliate.code;
  let d = await (await codes('', { code: 'FANNY', keep_old: true })).json();
  let fan = d.partners.find(p => p.user_id === 'fan');
  assert.equal(fan.code, 'FANNY');
  assert.deepEqual(fan.codes.map(c => [c.code, c.active, c.primary]), [[first, true, false], ['FANNY', true, true]]);
  assert.equal((await me('fan')).affiliate.code, 'FANNY', 'the partner sees only the primary');
  assert.equal((await codes('', { code: 'dana' })).status, 400, 'taken by another partner');

  // Both work: someone new types the old code.
  await addUser('viaold');
  assert.equal((await (await site('viaold', '/api/billing/coupon', { code: first })).json()).type, 'referral');
  assert.equal((await site('viaold', '/api/billing/redeem', { code: first })).status, 200);

  d = await (await codes('', { code: 'FAN2', keep_old: false })).json();
  fan = d.partners.find(p => p.user_id === 'fan');
  assert.deepEqual(fan.codes.map(c => [c.code, c.active, c.primary]), [[first, true, false], ['FANNY', false, false], ['FAN2', true, true]]);
  await addUser('late');
  assert.equal((await site('late', '/api/billing/coupon', { code: 'FANNY' })).status, 400, 'the replaced code is off');
  assert.equal((await mf.dispatchFetch(BASE + '/join/FANNY', { redirect: 'manual' })).headers.get('location'), BASE + '/');

  assert.equal((await codes('/FANNY/enable', {})).status, 200, 'changed my mind');
  assert.equal((await site('late', '/api/billing/coupon', { code: 'FANNY' })).status, 200);
  assert.equal((await codes('/FAN2/disable', {})).status, 400, 'not the primary');
  assert.equal((await codes('/' + first + '/primary', {})).status, 200);
  assert.equal((await me('fan')).affiliate.code, first);
  assert.equal((await codes('/' + first, null)).status, 400, 'the primary stays');
  assert.equal((await codes('/FAN2', null)).status, 200, 'an unused code can go');
  d = await (await admin('/api/admin/sites/timlul/affiliates')).json();
  fan = d.partners.find(p => p.user_id === 'fan');
  assert.deepEqual(fan.codes.map(c => [c.code, c.referrals]), [[first, 1], ['FANNY', 0]]);
  assert.equal(fan.referrals, 1);
});
