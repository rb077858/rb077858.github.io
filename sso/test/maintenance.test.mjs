// System shutdown from the admin dashboard (maintenance.js): who is refused in each scope, admins always
// get in, the message users see, and the automatic end. Miniflare with a real D1 schema.
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
    bindings: { ADMIN_EMAILS: 'boss@x.com' },
    serviceBindings: { ASSETS: () => new Response('asset') },
    outboundService: () => new Response('no', { status: 599 }),
  });
  db = await mf.getD1Database('DB');
  const schema = fs.readFileSync(new URL('../schema.sql', import.meta.url), 'utf8').replace(/--.*$/gm, '');
  for (const s of schema.split(';').map(x => x.trim()).filter(Boolean)) await db.prepare(s).run();
  await db.prepare("INSERT INTO sites (id, name, url, redirect_uris, created_at) VALUES ('timlul', 'תמלול', ?, ?, ?)").bind(SITE + '/', JSON.stringify([SITE + '/']), t0).run();
  await db.prepare("INSERT INTO users (id, email, name, created_at, email_verified) VALUES ('u1', 'dana@x.com', 'דנה', ?, 1), ('admin', 'boss@x.com', 'Boss', ?, 1)").bind(t0, t0).run();
  await db.prepare("INSERT INTO access (user_id, site_id, status, created_at) VALUES ('u1', 'timlul', 'active', ?), ('admin', 'timlul', 'active', ?)").bind(t0, t0).run();
  for (const [tok, user, client] of [['tok', 'u1', 'timlul'], ['dana', 'u1', null], ['adm', 'admin', null], ['admtok', 'admin', 'timlul']]) {
    await db.prepare('INSERT INTO sessions (id, user_id, client_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?)').bind(hash(tok), user, client, t0, t0 + 86400).run();
  }
});
after(() => mf?.dispose());

const call = (path, { cookie, bearer, body, method } = {}) => mf.dispatchFetch(BASE + path, {
  method: method || (body ? 'POST' : 'GET'),
  headers: { 'content-type': 'application/json', ...(cookie ? { cookie: 'sso_session=' + cookie } : {}), ...(bearer ? { authorization: 'Bearer ' + bearer } : {}) },
  body: body ? JSON.stringify(body) : undefined,
});
const setDown = body => call('/api/admin/maintenance', { cookie: 'adm', method: 'PUT', body });
const authz = { client_id: 'timlul', redirect_uri: SITE + '/', state: 's', code_challenge: 'x'.repeat(43), code_challenge_method: 'S256' };

test('only admins can switch it; an end time must be in the future', async () => {
  assert.equal((await call('/api/admin/maintenance', { cookie: 'dana', method: 'PUT', body: { on: true } })).status, 403);
  assert.equal((await setDown({ on: true, until: t0 - 60 })).status, 400);
  const m = (await (await call('/api/admin/maintenance', { cookie: 'adm' })).json()).maintenance;
  assert.equal(m.on, false);
  assert.ok(m.default_message);
});

test("scope 'login': no sign-ins, registrations or purchases; signed-in site users keep working; admins get in", async () => {
  const r = await (await setDown({ on: true, scope: 'login', message: 'שדרוג שרתים', until: t0 + 3600 })).json();
  assert.equal(r.maintenance.on, true);
  assert.equal(r.maintenance.by, 'boss@x.com');

  const cfg = await (await call('/api/config')).json();
  assert.equal(cfg.maintenance.message, 'שדרוג שרתים');
  assert.equal(cfg.maintenance.until, t0 + 3600);
  assert.match(cfg.maintenance.text, /^שדרוג שרתים \(צפוי לחזור ב-/);

  const reg = await call('/api/auth/register', { body: { email: 'new@x.com', password: 'Password123!x', name: 'x' } });
  assert.equal(reg.status, 503);
  assert.equal((await reg.json()).error, 'maintenance');

  const a = await call('/api/authorize', { cookie: 'dana', body: authz });
  assert.equal(a.status, 503);
  assert.match((await a.json()).message, /שדרוג שרתים/);
  const adm = await (await call('/api/authorize', { cookie: 'adm', body: authz })).json();
  assert.equal(adm.status, 'ok');

  assert.equal((await call('/api/billing/pack/order', { bearer: 'tok', body: { pack_id: 'x' } })).status, 503);
  assert.equal((await call('/api/userinfo', { bearer: 'tok' })).status, 200);
  assert.equal((await call('/api/me', { cookie: 'dana' })).status, 200);
});

test("scope 'all': sites and the account page are closed too, except for admins", async () => {
  await setDown({ on: true, scope: 'all', message: '' });
  const cfg = await (await call('/api/config')).json();
  assert.equal(cfg.maintenance.until, null);
  assert.equal(cfg.maintenance.text, cfg.maintenance.message); // the default text, no end time

  const ui = await call('/api/userinfo', { bearer: 'tok' });
  assert.equal(ui.status, 503);
  assert.equal((await ui.json()).error, 'maintenance');
  assert.equal((await call('/api/me', { cookie: 'dana' })).status, 503);
  assert.equal((await call('/api/me', { cookie: 'adm' })).status, 200);
  assert.equal((await call('/api/userinfo', { bearer: 'admtok' })).status, 200);
  assert.equal((await call('/api/admin/stats', { cookie: 'adm' })).status, 200);
});

test('it ends by itself at the end time, and can be turned off', async () => {
  await setDown({ on: true, scope: 'all', until: Math.floor(Date.now() / 1000) + 2 });
  assert.equal((await call('/api/userinfo', { bearer: 'tok' })).status, 503);
  await new Promise(r => setTimeout(r, 2600));
  assert.equal((await call('/api/userinfo', { bearer: 'tok' })).status, 200);
  const m = (await (await call('/api/admin/maintenance', { cookie: 'adm' })).json()).maintenance;
  assert.equal(m.on, false);
  assert.ok(m.ended_at);

  await setDown({ on: true, scope: 'all' });
  assert.equal((await call('/api/me', { cookie: 'dana' })).status, 503);
  await setDown({ on: false });
  assert.equal((await call('/api/me', { cookie: 'dana' })).status, 200);
  assert.equal((await (await call('/api/config')).json()).maintenance, null);
});
