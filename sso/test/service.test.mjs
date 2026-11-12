// The service API for the support chat (chat.reembir.com): gifts, personal coupons, pack requests,
// and userinfo telling which site a token is for. Miniflare with a real D1 schema.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { Miniflare } from 'miniflare';

const BASE = 'https://login.reembir.com';
const SITE = 'https://timlul.reembir.com';
let mf, db;
const hash = t => crypto.createHash('sha256').update(t).digest('base64url');
const t0 = Math.floor(Date.now() / 1000);

before(async () => {
  mf = new Miniflare({
    modules: true, scriptPath: 'index.js', modulesRoot: '.', rootPath: process.env.SSO_DIST || '/tmp/ssodist',
    compatibilityDate: '2025-09-01', d1Databases: ['DB'],
    bindings: { CHAT_SERVICE_KEY: 'svc', ADMIN_EMAILS: 'boss@x.com' },
    serviceBindings: { ASSETS: () => new Response('asset'), CHAT: () => new Response('{}') },
    outboundService: () => new Response('no', { status: 599 }),
  });
  db = await mf.getD1Database('DB');
  const schema = fs.readFileSync(new URL('../schema.sql', import.meta.url), 'utf8').replace(/--.*$/gm, '');
  for (const s of schema.split(';').map(x => x.trim()).filter(Boolean)) await db.prepare(s).run();
  await db.prepare("INSERT INTO sites (id, name, url, redirect_uris, created_at, default_plan) VALUES ('timlul', 'תמלול', ?, ?, ?, NULL)").bind(SITE + '/', JSON.stringify([SITE + '/']), t0).run();
  await db.prepare("INSERT INTO plans (id, site_id, name, features, sort) VALUES ('timlul:pro', 'timlul', 'מקצועי', '{}', 1)").run();
  await db.prepare("INSERT INTO users (id, email, name, created_at, email_verified) VALUES ('u1', 'dana@x.com', 'דנה', ?, 1), ('admin', 'boss@x.com', 'Boss', ?, 1)").bind(t0, t0).run();
  await db.prepare("INSERT INTO access (user_id, site_id, status, created_at) VALUES ('u1', 'timlul', 'active', ?)").bind(t0).run();
  await db.prepare("INSERT INTO sessions (id, user_id, client_id, created_at, expires_at) VALUES (?, 'u1', 'timlul', ?, ?), (?, 'admin', NULL, ?, ?)").bind(hash('tok'), t0, t0 + 86400, hash('adm'), t0, t0 + 86400).run();
  await mf.dispatchFetch(BASE + '/api/config');
  await db.prepare("UPDATE plans SET price = 19, currency = 'ILS' WHERE id = 'timlul:pro'").run();
  await mf.dispatchFetch(BASE + '/api/admin/sites/timlul/packs/timlul:pack100', {
    method: 'PUT', headers: { cookie: 'sso_session=adm', 'content-type': 'application/json' },
    body: JSON.stringify({ name: '100 דקות', price: 8, features: { minutes: 100 } }),
  });
});
after(() => mf?.dispose());

const svc = (path, body, key = 'svc') => mf.dispatchFetch(BASE + '/api/service/' + path, {
  method: body ? 'POST' : 'GET', headers: { 'x-service-key': key, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined,
});

test('userinfo says which site the token is for', async () => {
  const r = await (await mf.dispatchFetch(BASE + '/api/userinfo', { headers: { authorization: 'Bearer tok' } })).json();
  assert.deepEqual(r.site, { id: 'timlul', name: 'תמלול', url: SITE + '/' });
  assert.equal(r.user.email, 'dana@x.com');
});

test('catalog has packs and what each site gives; a gift from the chat shows on the user', async () => {
  assert.equal((await svc('catalog', null, 'wrong')).status, 401);
  const c = await (await svc('catalog')).json();
  assert.equal(c.packs[0].id, 'timlul:pack100');
  assert.deepEqual(c.bonus_keys.timlul, ['minutes']);
  assert.ok(c.coupon_types.includes('gift'));

  assert.equal((await svc('bonus', { user_id: 'u1', site_id: 'timlul', features: { minutes: -5 } })).status, 400);
  const r = await (await svc('bonus', { user_id: 'u1', site_id: 'timlul', features: { minutes: 30 }, note: 'פיצוי', by: 'רים' })).json();
  assert.equal(r.result.label, '30 דקות');
  const info = await (await mf.dispatchFetch(BASE + '/api/userinfo', { headers: { authorization: 'Bearer tok' } })).json();
  assert.deepEqual(info.access.rewards.totals, { minutes: 30 });
  const u = await (await svc('users?email=dana%40x.com')).json();
  assert.deepEqual(u.users[0].bonus, { timlul: { minutes: 30 } });
  const page = await (await mf.dispatchFetch(BASE + '/api/admin/users/u1', { headers: { cookie: 'sso_session=adm' } })).json();
  assert.equal(page.bonuses[0].why, 'מתנה מנציג בצ׳אט (פיצוי · על ידי רים)');
});

test('a personal coupon: one use, a link to the site', async () => {
  const r = await (await svc('coupon', { site_id: 'timlul', type: 'percent', value: 50, months: 1, by: 'רים' })).json();
  assert.match(r.result.code, /^C[A-Z2-9]{7}$/);
  assert.equal(r.result.link, SITE + '/?coupon=' + r.result.code);
  assert.equal(r.result.label, '50% הנחה לחודש הראשון');
  const row = await db.prepare('SELECT max_uses, expires_at FROM coupons WHERE code = ?').bind(r.result.code).first();
  assert.equal(row.max_uses, 1);
  assert.ok(row.expires_at > t0 + 29 * 86400);
  assert.equal((await svc('coupon', { site_id: 'timlul', type: 'percent', value: 500 })).status, 400);
});

test('a pack sent as a payment request must be for an account, at the pack price', async () => {
  const base = { created_by: 'agent@x.com', description: '100 דקות', currency: 'ILS', user_id: 'u1' };
  assert.equal((await svc('pay', { ...base, amount: 5, on_paid: { pack_id: 'timlul:pack100' } })).status, 400, 'pack price');
  assert.equal((await svc('pay', { ...base, user_id: undefined, email: 'a@x.com', amount: 8, on_paid: { pack_id: 'timlul:pack100' } })).status, 400);
  const r = await (await svc('pay', { ...base, amount: 8, on_paid: { pack_id: 'timlul:pack100' } })).json();
  assert.equal(r.request.on_paid.pack_name, '100 דקות');
  assert.equal(r.request.on_paid.site_name, 'תמלול');
});
