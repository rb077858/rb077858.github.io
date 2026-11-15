// Add-ons from the dashboard: a gift of something extra (summaries, files, minutes) to one user or many,
// with an optional end date, undone as one. Miniflare with a real D1 schema.
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
    compatibilityDate: '2025-09-01', d1Databases: ['DB'], bindings: { ADMIN_EMAILS: 'boss@x.com' },
    serviceBindings: { ASSETS: () => new Response('asset') },
    outboundService: () => new Response('no', { status: 599 }),
  });
  db = await mf.getD1Database('DB');
  const schema = fs.readFileSync(new URL('../schema.sql', import.meta.url), 'utf8').replace(/--.*$/gm, '');
  for (const s of schema.split(';').map(x => x.trim()).filter(Boolean)) await db.prepare(s).run();
  await db.prepare("INSERT INTO sites (id, name, url, redirect_uris, created_at) VALUES ('timlul', 'תמלול', ?, ?, ?)").bind(SITE + '/', JSON.stringify([SITE + '/']), t0).run();
  for (const [id, name] of [['timlul:basic', 'Basic'], ['timlul:pro', 'Pro']]) {
    await db.prepare('INSERT INTO plans (id, site_id, name, features, sort) VALUES (?, ?, ?, ?, 1)').bind(id, 'timlul', name, '{}').run();
  }
  const users = [['free1', 'free1@x.com'], ['pro1', 'pro1@x.com'], ['lapsed', 'lapsed@x.com'], ['basic1', 'basic1@x.com'], ['off', 'off@x.com']];
  for (const [id, email] of users) await db.prepare('INSERT INTO users (id, email, created_at, email_verified, disabled) VALUES (?, ?, ?, 1, ?)').bind(id, email, t0, id === 'off' ? 1 : 0).run();
  await db.prepare("INSERT INTO users (id, email, created_at, email_verified) VALUES ('admin', 'boss@x.com', ?, 1)").bind(t0).run();
  const grants = [['free1', null, null], ['pro1', 'timlul:pro', t0 + 86400], ['lapsed', 'timlul:pro', t0 - 86400], ['basic1', 'timlul:basic', null], ['off', null, null]];
  for (const [id, plan, exp] of grants) {
    await db.prepare("INSERT INTO access (user_id, site_id, status, plan_id, plan_expires_at, created_at) VALUES (?, 'timlul', 'active', ?, ?, ?)").bind(id, plan, exp, t0).run();
  }
  for (const [tok, user, client] of [['adm', 'admin', null], ['tok-free1', 'free1', 'timlul'], ['tok-pro1', 'pro1', 'timlul'], ['tok-lapsed', 'lapsed', 'timlul']]) {
    await db.prepare('INSERT INTO sessions (id, user_id, client_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?)').bind(hash(tok), user, client, t0, t0 + 86400).run();
  }
  await mf.dispatchFetch(BASE + '/api/config');
});
after(() => mf?.dispose());

const admin = (path, body, method) => mf.dispatchFetch(BASE + path, {
  method: method || (body ? 'POST' : 'GET'), headers: { cookie: 'sso_session=adm', 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined,
});
const totals = async tok => (await (await mf.dispatchFetch(BASE + '/api/userinfo', { headers: { authorization: 'Bearer ' + tok } })).json()).access.rewards.totals;
const bulk = body => admin('/api/admin/sites/timlul/addons', body);

test('one user: an add-on with an end date; an expired one stops counting', async () => {
  assert.equal((await admin('/api/admin/users/free1/bonuses', { site_id: 'timlul', features: { summaries: 3 }, expires_at: t0 - 10 })).status, 400, 'in the past');
  assert.equal((await admin('/api/admin/users/free1/bonuses', { site_id: 'timlul', features: { summaries: 3 }, expires_at: t0 + 86400 })).status, 200);
  assert.deepEqual(await totals('tok-free1'), { summaries: 3 });
  await db.prepare("UPDATE bonus_grants SET expires_at = ? WHERE user_id = 'free1'").bind(t0 - 1).run();
  assert.deepEqual(await totals('tok-free1'), {}, 'ended');
  const page = await (await admin('/api/admin/users/free1')).json();
  assert.equal(page.bonuses[0].expired, true);
  assert.equal(page.bonuses[0].label, '3 סיכומים');
  await db.prepare("DELETE FROM bonus_grants WHERE user_id = 'free1'").run();
});

test('bulk: who each audience reaches (no plan includes a plan that ran out; disabled users never)', async () => {
  const count = async b => (await (await bulk({ ...b, preview: true })).json()).count;
  assert.equal(await count({ mode: 'no_plan' }), 2, 'free1 and lapsed');
  assert.equal(await count({ mode: 'plan', plan_id: 'timlul:pro' }), 1, 'pro1 only: the lapsed one is not on Pro any more');
  assert.equal(await count({ mode: 'plan', plan_id: 'timlul:basic' }), 1);
  assert.equal(await count({ mode: 'all' }), 4);
  assert.equal(await count({ mode: 'emails', emails: 'basic1@x.com, nobody@x.com\nPRO1@x.com' }), 2);
  assert.equal((await bulk({ mode: 'plan', preview: true })).status, 400);
  assert.equal((await bulk({ mode: 'what', preview: true })).status, 400);
});

test('bulk: give, see, and take back as one', async () => {
  assert.equal((await bulk({ mode: 'no_plan', features: { summary_files: 0 } })).status, 400, 'a positive number');
  assert.equal((await bulk({ mode: 'no_plan', features: { summaries: 5 }, expires_at: t0 - 5 })).status, 400);
  const r = await (await bulk({ mode: 'no_plan', features: { summaries: 5, summary_files: 2 }, note: 'מבצע', expires_at: t0 + 30 * 86400 })).json();
  assert.equal(r.count, 2);
  assert.ok(r.units.includes('summaries') && r.units.includes('summary_files'), 'timlul offers its units from the start');
  assert.equal(r.batches[0].users, 2);
  assert.equal(r.batches[0].label, '5 סיכומים, 2 קבצים לסיכום');
  assert.deepEqual(await totals('tok-free1'), { summaries: 5, summary_files: 2 });
  assert.deepEqual(await totals('tok-lapsed'), { summaries: 5, summary_files: 2 });
  assert.deepEqual(await totals('tok-pro1'), {}, 'not in the audience');

  // On top of an individual gift
  await admin('/api/admin/users/lapsed/bonuses', { site_id: 'timlul', features: { summaries: 1 } });
  assert.equal((await totals('tok-lapsed')).summaries, 6);

  const undone = await (await admin(`/api/admin/sites/timlul/addons/${r.batch}`, null, 'DELETE')).json();
  assert.deepEqual(undone.batches, []);
  assert.deepEqual(await totals('tok-free1'), {});
  assert.deepEqual(await totals('tok-lapsed'), { summaries: 1 }, 'the individual gift stays');
});

test('only admins', async () => {
  const r = await mf.dispatchFetch(BASE + '/api/admin/sites/timlul/addons', { headers: { cookie: 'sso_session=tok-free1' } });
  assert.ok([401, 403].includes(r.status));
});
