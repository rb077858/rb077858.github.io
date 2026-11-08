// Packs (one-time purchases on top of a plan), end to end: the worker in Miniflare with a real D1
// schema and PayPal orders mocked. Run: npm test   (builds into /tmp first)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { Miniflare } from 'miniflare';

const BASE = 'https://login.reembir.com';
const SITE = 'https://timlul.reembir.com';
const orders = {};
let n = 0;
let declineNext = false;

async function paypal(req) {
  const url = new URL(req.url);
  if (url.pathname === '/v1/oauth2/token') return Response.json({ access_token: 'x', expires_in: 3600 });
  if (url.pathname === '/v1/catalogs/products') return Response.json({ id: 'PROD-' + ++n });
  if (url.pathname === '/v1/billing/plans') return Response.json({ id: 'P-' + ++n });
  if (url.pathname === '/v2/checkout/orders' && req.method === 'POST') {
    const body = await req.json();
    const id = 'ORDER-' + String(++n).padStart(4, '0');
    orders[id] = { id, status: 'CREATED', body };
    return Response.json({ id, status: 'CREATED' }, { status: 201 });
  }
  const m = url.pathname.match(/^\/v2\/checkout\/orders\/([^/]+)(\/capture)?$/);
  if (m) {
    const o = orders[m[1]];
    if (!o) return Response.json({ name: 'RESOURCE_NOT_FOUND' }, { status: 404 });
    if (m[2]) {
      if (declineNext) { declineNext = false; return Response.json({ name: 'UNPROCESSABLE_ENTITY', details: [{ issue: 'INSTRUMENT_DECLINED' }] }, { status: 422 }); }
      if (o.status === 'COMPLETED') return Response.json({ name: 'UNPROCESSABLE_ENTITY', details: [{ issue: 'ORDER_ALREADY_CAPTURED' }] }, { status: 422 });
      o.status = 'COMPLETED';
      o.captures = (o.captures || 0) + 1;
    }
    const unit = o.body.purchase_units[0];
    return Response.json({
      id: o.id, status: o.status, payer: { email_address: 'payer@x.com' },
      purchase_units: [{ ...unit, payments: o.status === 'COMPLETED'
        ? { captures: [{ id: 'CAP-' + o.id, status: 'COMPLETED', amount: unit.amount, custom_id: unit.custom_id }] } : undefined }],
    });
  }
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
  await db.prepare("INSERT INTO sites (id, name, url, redirect_uris, created_at) VALUES ('other', 'אחר', 'https://o.x/', '[]', ?)").bind(t0).run();
  for (const [id, name, sort] of [['timlul:free', 'חינם', 0], ['timlul:basic', 'בסיסי', 1], ['timlul:business', 'עסקי', 2]]) {
    await db.prepare('INSERT INTO plans (id, site_id, name, features, sort) VALUES (?, ?, ?, ?, ?)').bind(id, 'timlul', name, '{}', sort).run();
  }
  for (const [id, email] of [['u1', 'a@x.com'], ['u2', 'b@x.com'], ['admin', 'boss@x.com']]) {
    await db.prepare('INSERT INTO users (id, email, name, created_at, email_verified) VALUES (?, ?, ?, ?, 1)').bind(id, email, 'User ' + id, t0).run();
  }
  for (const [token, user, client] of [['tok-a', 'u1', 'timlul'], ['tok-b', 'u2', 'timlul'], ['adm', 'admin', null]]) {
    await db.prepare('INSERT INTO sessions (id, user_id, client_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?)').bind(hash(token), user, client, t0, t0 + 86400).run();
  }
  await mf.dispatchFetch(BASE + '/api/config');
  // u1 is on the business plan; u2 on the free one (the site's default).
  await db.prepare("INSERT INTO access (user_id, site_id, status, plan_id, created_at) VALUES ('u1', 'timlul', 'active', 'timlul:business', ?)").bind(t0).run();
  await db.prepare("INSERT INTO access (user_id, site_id, status, created_at) VALUES ('u2', 'timlul', 'active', ?)").bind(t0).run();
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
const savePack = (id, body) => admin('/api/admin/sites/timlul/packs/' + encodeURIComponent(id), body, 'PUT');
const catalog = async () => (await mf.dispatchFetch(BASE + '/api/billing/catalog?client_id=timlul')).json();
const buy = async (token, packId) => {
  const r = await site(token, '/api/billing/pack/order', { pack_id: packId });
  return { status: r.status, data: await r.json() };
};

test('admin: packs are validated, saved, and the active ones are in the catalog', async () => {
  const ok = { name: '100 דקות נוספות', price: 8, features: { minutes: 100 }, plan_ids: ['timlul:business'] };
  assert.equal((await savePack('other:pack', ok)).status, 400, 'id must start with the site');
  assert.equal((await savePack('timlul:pack100', { ...ok, name: ' ' })).status, 400, 'name');
  assert.equal((await savePack('timlul:pack100', { ...ok, price: 0 })).status, 400, 'price > 0');
  assert.equal((await savePack('timlul:pack100', { ...ok, price: 100001 })).status, 400, 'price cap');
  assert.equal((await savePack('timlul:pack100', { ...ok, currency: 'GBP' })).status, 400, 'currency');
  assert.equal((await savePack('timlul:pack100', { ...ok, features: '[1]' })).status, 400, 'features is an object');
  assert.equal((await savePack('timlul:pack100', { ...ok, features: '{bad' })).status, 400, 'features is JSON');
  assert.equal((await savePack('timlul:pack100', { ...ok, plan_ids: ['timlul:nope'] })).status, 400, 'plans exist');
  assert.equal((await mf.dispatchFetch(BASE + '/api/admin/sites/timlul/packs/timlul:x', { method: 'PUT', body: '{}' })).status, 401);

  let r = await savePack('timlul:pack100', { ...ok, features: '{"minutes": 100}', sort: 1 });
  assert.equal(r.status, 200);
  r = await savePack('timlul:pack300', { ...ok, name: '300 דקות נוספות', price: 21, features: { minutes: 300 }, sort: 2 });
  const b = await r.json();
  assert.deepEqual(b.packs.map(p => [p.id, p.sold, p.active]), [['timlul:pack100', 0, true], ['timlul:pack300', 0, true]]);
  assert.deepEqual(b.packs[0].features, { minutes: 100 });
  assert.deepEqual(b.purchases, []);
  assert.deepEqual(b.month, []);
  await savePack('timlul:hidden', { ...ok, name: 'מושבתת', price: 1, active: false, sort: 0 });

  const c = await catalog();
  assert.deepEqual(c.packs.map(p => p.id), ['timlul:pack100', 'timlul:pack300'], 'active only, by sort');
  assert.deepEqual(c.packs[0], { id: 'timlul:pack100', name: '100 דקות נוספות', description: '', price: 8, currency: 'ILS', features: { minutes: 100 }, plan_ids: ['timlul:business'] });
});

test('only an allowed plan can buy; the order is the server price', async () => {
  let r = await buy('tok-b', 'timlul:pack100');
  assert.equal(r.status, 403);
  assert.equal(r.data.error, 'upgrade');
  assert.equal((await buy('tok-a', 'timlul:nope')).status, 404);
  assert.equal((await buy('tok-a', 'timlul:hidden')).status, 404, 'disabled');

  r = await buy('tok-a', 'timlul:pack100');
  assert.equal(r.status, 200);
  const o = orders[r.data.id].body;
  assert.equal(o.intent, 'CAPTURE');
  assert.equal(o.purchase_units[0].custom_id, 'timlul:u1');
  assert.deepEqual(o.purchase_units[0].amount, { currency_code: 'ILS', value: '8.00' });
  assert.equal(o.application_context.brand_name, 'reem.bi');

  const u = await (await site('tok-b', '/api/userinfo')).json();
  assert.deepEqual(u.access.packs, { eligible: false, totals: {}, count: 0 });
});

test('capture: not for another user, a declined card adds nothing, the same order counts once', async () => {
  const { data } = await buy('tok-a', 'timlul:pack100');
  assert.equal((await site('tok-b', '/api/billing/pack/capture', { order_id: data.id })).status, 404, 'someone else’s order');
  assert.equal(orders[data.id].status, 'CREATED', 'not captured');

  declineNext = true;
  let r = await site('tok-a', '/api/billing/pack/capture', { order_id: data.id });
  assert.equal(r.status, 402);
  assert.equal((await r.json()).error, 'declined');
  let u = await (await site('tok-a', '/api/userinfo')).json();
  assert.deepEqual(u.access.packs, { eligible: true, totals: {}, count: 0 });

  r = await site('tok-a', '/api/billing/pack/capture', { order_id: data.id });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('access-control-allow-origin'), SITE);
  u = await r.json();
  assert.deepEqual(u.access.packs, { eligible: true, totals: { minutes: 100 }, count: 1 });

  u = await (await site('tok-a', '/api/billing/pack/capture', { order_id: data.id })).json();
  assert.deepEqual(u.access.packs.totals, { minutes: 100 }, 'retry is safe');
  assert.equal(orders[data.id].captures, 1);

  // Captured at PayPal but the reply was lost: ORDER_ALREADY_CAPTURED → read the order.
  const second = await buy('tok-a', 'timlul:pack100');
  orders[second.data.id].status = 'COMPLETED';
  u = await (await site('tok-a', '/api/billing/pack/capture', { order_id: second.data.id })).json();
  assert.deepEqual(u.access.packs, { eligible: true, totals: { minutes: 200 }, count: 2 });
});

test('totals add up across packs; a new price does not change an open order', async () => {
  const { data } = await buy('tok-a', 'timlul:pack300');
  await savePack('timlul:pack300', { name: '300 דקות נוספות', price: 25, features: { minutes: 300 }, plan_ids: ['timlul:business'], sort: 2 });
  let r = await site('tok-a', '/api/billing/pack/capture', { order_id: data.id });
  assert.equal(r.status, 200);
  let u = await r.json();
  assert.deepEqual(u.access.packs.totals, { minutes: 500 });

  // A paid amount that doesn't match the order is refused.
  const bad = await buy('tok-a', 'timlul:pack100');
  orders[bad.data.id].body.purchase_units[0].amount.value = '1.00';
  assert.equal((await site('tok-a', '/api/billing/pack/capture', { order_id: bad.data.id })).status, 402);

  u = await (await site('tok-a', '/api/userinfo')).json();
  assert.deepEqual(u.access.packs, { eligible: true, totals: { minutes: 500 }, count: 3 });

  const b = await (await admin('/api/admin/sites/timlul/billing')).json();
  assert.equal(b.purchases.length, 3);
  assert.equal(b.purchases[0].email, 'a@x.com');
  assert.equal(b.purchases[0].price, 21, 'the price when ordered');
  assert.deepEqual(b.month, [{ currency: 'ILS', n: 3, total: 37 }]);
  assert.equal(b.packs.find(p => p.id === 'timlul:pack100').sold, 2);
});

test('a sold pack can only be disabled; an unsold one can be deleted', async () => {
  let r = await admin('/api/admin/sites/timlul/packs/timlul%3Apack100', null, 'DELETE');
  assert.equal(r.status, 400);
  assert.match((await r.json()).message, /להשבית/);
  r = await admin('/api/admin/sites/timlul/packs/timlul%3Ahidden', null, 'DELETE');
  assert.equal(r.status, 200);
  assert.deepEqual((await r.json()).packs.map(p => p.id), ['timlul:pack100', 'timlul:pack300']);

  // Disabling every pack stops sales, but what was bought still counts.
  await savePack('timlul:pack100', { name: '100', price: 8, features: { minutes: 100 }, plan_ids: ['timlul:business'], active: false });
  await savePack('timlul:pack300', { name: '300', price: 21, features: { minutes: 300 }, plan_ids: ['timlul:business'], active: false });
  assert.deepEqual((await catalog()).packs, []);
  assert.equal((await buy('tok-a', 'timlul:pack100')).status, 404);
  const u = await (await site('tok-a', '/api/userinfo')).json();
  assert.deepEqual(u.access.packs, { eligible: true, totals: { minutes: 500 }, count: 3 });
});
