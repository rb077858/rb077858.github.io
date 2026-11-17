// Phone verification (phone.js): the policy and its clock, Firebase's proof, one number per account, and what an
// admin can do for one user. Firebase's keys and tokens are made here. Miniflare with a real D1 schema.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { Miniflare } from 'miniflare';

const BASE = 'https://login.reembir.com';
const SITE = 'https://timlul.reembir.com';
const PROJECT = 'proj-1';
let mf, db;
const hash = t => crypto.createHash('sha256').update(t).digest('base64url');
const t0 = Math.floor(Date.now() / 1000);

const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const other = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256', use: 'sig' };
const b64 = o => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString('base64url');
function idToken(over = {}, key = privateKey) {
  const t = Math.floor(Date.now() / 1000);
  const claims = {
    iss: `https://securetoken.google.com/${PROJECT}`, aud: PROJECT, sub: 'fb-uid', iat: t, exp: t + 3600, auth_time: t,
    phone_number: '+972501234567', firebase: { sign_in_provider: 'phone', identities: { phone: ['+972501234567'] } }, ...over,
  };
  const h = b64({ alg: 'RS256', kid: 'k1', typ: 'JWT' }), p = b64(claims);
  return `${h}.${p}.${crypto.sign('RSA-SHA256', Buffer.from(`${h}.${p}`), key).toString('base64url')}`;
}

before(async () => {
  mf = new Miniflare({
    modules: true, scriptPath: 'index.js', modulesRoot: '.', rootPath: process.env.SSO_DIST || '/tmp/ssodist',
    compatibilityDate: '2025-09-01', d1Databases: ['DB'],
    bindings: { ADMIN_EMAILS: 'boss@x.com', FIREBASE_API_KEY: 'AIza-test', FIREBASE_PROJECT_ID: PROJECT },
    serviceBindings: { ASSETS: () => new Response('asset') },
    outboundService: req => new URL(req.url).pathname.includes('securetoken@system.gserviceaccount.com')
      ? Response.json({ keys: [jwk] }, { headers: { 'cache-control': 'max-age=3600' } }) : new Response('no', { status: 599 }),
  });
  db = await mf.getD1Database('DB');
  const schema = fs.readFileSync(new URL('../schema.sql', import.meta.url), 'utf8').replace(/--.*$/gm, '');
  for (const s of schema.split(';').map(x => x.trim()).filter(Boolean)) await db.prepare(s).run();
  await db.prepare("INSERT INTO sites (id, name, url, redirect_uris, created_at) VALUES ('timlul', 'תמלולי', ?, ?, ?)").bind(SITE + '/', JSON.stringify([SITE + '/']), t0).run();
  await mf.dispatchFetch(BASE + '/api/config'); // the migrations
  const old = t0 - 30 * 86400;
  for (const [id, email] of [['u1', 'one@x.com'], ['u2', 'two@x.com'], ['u3', 'three@x.com']]) {
    await db.prepare('INSERT INTO users (id, email, name, created_at, email_verified) VALUES (?, ?, ?, ?, 1)').bind(id, email, id, old).run();
    await db.prepare("INSERT INTO access (user_id, site_id, status, created_at) VALUES (?, 'timlul', 'active', ?)").bind(id, old).run();
  }
  await db.prepare("INSERT INTO users (id, email, name, created_at, email_verified) VALUES ('admin', 'boss@x.com', 'Boss', ?, 1)").bind(old).run();
  for (const [tok, user, client] of [['adm', 'admin', null], ['p1', 'u1', null], ['p2', 'u2', null], ['p3', 'u3', null], ['s1', 'u1', 'timlul'], ['s2', 'u2', 'timlul'], ['sadm', 'admin', 'timlul']]) {
    await db.prepare('INSERT INTO sessions (id, user_id, client_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?)').bind(hash(tok), user, client, t0, t0 + 86400).run();
  }
});
after(() => mf?.dispose());

const call = (path, { cookie, bearer, body, method } = {}) => mf.dispatchFetch(BASE + path, {
  method: method || (body ? 'POST' : 'GET'),
  headers: { 'content-type': 'application/json', ...(cookie ? { cookie: 'sso_session=' + cookie } : {}), ...(bearer ? { authorization: 'Bearer ' + bearer } : {}) },
  body: body ? JSON.stringify(body) : undefined,
});
const policy = body => call('/api/admin/phone', { cookie: 'adm', method: 'PUT', body });
const authz = { client_id: 'timlul', redirect_uri: SITE + '/', state: 's', code_challenge: 'x'.repeat(43), code_challenge_method: 'S256' };
const authorize = cookie => call('/api/authorize', { cookie, body: authz }).then(r => r.json());
const userinfo = tok => call('/api/userinfo', { bearer: tok });
const meState = async cookie => (await (await call('/api/me', { cookie })).json()).phone;
const adminAct = (id, body) => call(`/api/admin/users/${id}/phone`, { cookie: 'adm', body });

test('off by default: nobody is asked or blocked; only admins can change the policy', async () => {
  const r = await (await call('/api/admin/phone', { cookie: 'adm' })).json();
  assert.equal(r.phone.configured, true);
  assert.equal(r.phone.on, false);
  assert.equal(r.phone.counts.waiting, 3, 'three users without a phone (and the admin is exempt)');
  assert.equal((await authorize('p1')).status, 'ok');
  assert.equal((await meState('p1')).needs_step, false);
  assert.ok([401, 403].includes((await call('/api/admin/phone', { cookie: 'p1', method: 'PUT', body: { on: true, grace_days: 3 } })).status));
  assert.equal((await (await call('/api/config')).json()).firebase.projectId, PROJECT);
});

test('switched on: existing users get three days, then the sites refuse them; the login page still works', async () => {
  assert.equal((await policy({ on: true, grace_days: 999 })).status, 400);
  const on = await (await policy({ on: true, grace_days: 3 })).json();
  assert.equal(on.phone.on, true);
  assert.ok(on.phone.since >= t0);

  const s = await meState('p1');
  assert.deepEqual([s.needs_step, s.blocked, s.days_left], [true, false, 3]);
  assert.equal((await authorize('p1')).status, 'ok', 'inside the three days');
  assert.equal((await userinfo('s1')).status, 200);

  // the time runs out (a clock of 0 days: due = the moment it was switched on)
  await policy({ on: true, grace_days: 0 });
  const late = await meState('p1');
  assert.equal(late.blocked, true, 'the portal still answers, so they can verify');
  assert.equal((await authorize('p1')).status, 'phone_required');
  const ui = await userinfo('s1');
  assert.equal(ui.status, 401);
  assert.equal((await ui.json()).error, 'phone_required');
  assert.equal((await authorize('adm')).status, 'ok', 'admins are never blocked');
  assert.equal((await userinfo('sadm')).status, 200);
});

test("Firebase's proof: a fresh phone sign-in for this project, nothing else", async () => {
  const verify = id_token => call('/api/phone/verify', { cookie: 'p1', body: { id_token } });
  assert.equal((await verify('nonsense')).status, 400);
  assert.equal((await verify(idToken({}, other.privateKey))).status, 400, 'signed by someone else');
  assert.equal((await verify(idToken({ aud: 'other-project', iss: 'https://securetoken.google.com/other-project' }))).status, 400, 'another project');
  assert.equal((await verify(idToken({ firebase: { sign_in_provider: 'password' } }))).status, 400, 'not a phone sign-in');
  assert.equal((await verify(idToken({ auth_time: Math.floor(Date.now() / 1000) - 3600 }))).status, 400, 'an old sign-in');
  assert.equal((await verify(idToken({ exp: Math.floor(Date.now() / 1000) - 600 }))).status, 400, 'expired');
  assert.equal((await call('/api/phone/verify', { body: { id_token: idToken() } })).status, 401, 'needs a signed-in user');

  const ok = await verify(idToken());
  assert.equal(ok.status, 200);
  const st = (await ok.json()).phone;
  assert.deepEqual([st.verified, st.blocked, st.required], [true, false, false]);
  assert.match(st.phone, /4567$/);
  assert.ok(!st.phone.includes('501234'), 'the number is masked');
  assert.equal((await authorize('p1')).status, 'ok');
  assert.equal((await userinfo('s1')).status, 200);
  assert.equal((await db.prepare("SELECT phone FROM users WHERE id = 'u1'").first()).phone, '+972501234567');
});

test('one number, one account; the number is checked before an SMS is sent', async () => {
  const start = phone => call('/api/phone/start', { cookie: 'p2', body: { phone } });
  assert.equal((await start('050-123-4567')).status, 409, 'u1 already has it (written the way people dial it)');
  assert.equal((await start('123')).status, 400);
  const ok = await (await start('052 765 4321')).json();
  assert.equal(ok.phone, '+972527654321');
  assert.equal((await call('/api/phone/verify', { cookie: 'p2', body: { id_token: idToken() } })).status, 409, 'the same number in a token');
});

test('only SMS that were really sent count toward the limit (failed tries do not)', async () => {
  const start = () => call('/api/phone/start', { cookie: 'p3', body: { phone: '053 111 2222' } });
  const sent = () => call('/api/phone/sent', { cookie: 'p3', body: {} });
  for (let i = 0; i < 8; i++) assert.equal((await start()).status, 200, 'trying again and again without sending costs nothing');
  for (let i = 0; i < 5; i++) assert.equal((await sent()).status, 200);
  assert.equal((await start()).status, 429, 'five SMS in an hour');
  assert.equal((await sent()).status, 429);
});

test('an admin: skip one user, reset one, give more time', async () => {
  // u2 is blocked (the clock ran out)
  assert.equal((await authorize('p2')).status, 'phone_required');
  assert.equal((await adminAct('u2', { action: 'skip' })).status, 200);
  assert.equal((await authorize('p2')).status, 'ok', 'skipped');
  assert.equal((await userinfo('s2')).status, 200);
  assert.equal((await meState('p2')).skipped, true);
  await adminAct('u2', { action: 'unskip' });
  assert.equal((await authorize('p2')).status, 'phone_required');

  // extend: two more days
  const ext = await (await adminAct('u2', { action: 'extend', days: 2 })).json();
  assert.equal(ext.phone.days_left, 2);
  assert.equal((await authorize('p2')).status, 'ok');

  // reset u1: the number is released, and a new period starts
  const rs = await (await adminAct('u1', { action: 'reset', days: 3 })).json();
  assert.equal(rs.phone.verified, false);
  assert.equal(rs.phone.number, null);
  assert.equal(rs.phone.days_left, 3);
  assert.equal((await db.prepare("SELECT phone FROM users WHERE id = 'u1'").first()).phone, null);
  // ...so the number can be used by someone else now
  assert.equal((await call('/api/phone/verify', { cookie: 'p3', body: { id_token: idToken() } })).status, 200);
  // reset at once (0 days): blocked right away
  await adminAct('u2', { action: 'reset', days: 0 });
  assert.equal((await authorize('p2')).status, 'phone_required');
  assert.equal((await adminAct('u2', { action: 'what' })).status, 400);
});

test('new users must verify at once; the list and counts say who is where', async () => {
  await db.prepare("INSERT INTO users (id, email, name, created_at, email_verified) VALUES ('fresh', 'fresh@x.com', 'fresh', ?, 1)").bind(Math.floor(Date.now() / 1000)).run();
  await db.prepare("INSERT INTO sessions (id, user_id, client_id, created_at, expires_at) VALUES (?, 'fresh', NULL, ?, ?)").bind(hash('pf'), t0, t0 + 86400).run();
  await db.prepare("INSERT INTO access (user_id, site_id, status, created_at) VALUES ('fresh', 'timlul', 'active', ?)").bind(t0).run();
  assert.equal((await authorize('pf')).status, 'phone_required', 'joined after the policy: no grace');

  const list = await (await call('/api/admin/users?q=', { cookie: 'adm' })).json();
  const stateOf = id => list.users.find(u => u.id === id).phone_state;
  assert.equal(stateOf('u3'), 'verified');
  assert.equal(stateOf('u1'), 'waiting');
  assert.equal(stateOf('u2'), 'overdue');
  assert.equal(stateOf('admin'), 'exempt');
  assert.equal(list.users.find(u => u.id === 'u3').phone, undefined, 'the list never carries numbers');

  const one = await (await call('/api/admin/users/u3', { cookie: 'adm' })).json();
  assert.equal(one.phone.number, '+972501234567', 'an admin sees the number in full');

  const c = (await (await call('/api/admin/phone', { cookie: 'adm' })).json()).phone.counts;
  assert.deepEqual([c.verified, c.waiting, c.overdue, c.exempt], [1, 1, 2, 1]);

  const missing = await (await call('/api/admin/users?filter=phone_missing', { cookie: 'adm' })).json();
  assert.deepEqual(missing.users.map(u => u.id).filter(id => id !== 'admin').sort(), ['fresh', 'u1', 'u2']); // (an admin only counts as one in the database after their first sign-in)
});

test('a reminder goes to those who still have to verify', async () => {
  const r = await (await call('/api/admin/email/preview', { cookie: 'adm', body: { to: { mode: 'phone' } } })).json();
  assert.deepEqual(r.sample.sort(), ['fresh@x.com', 'one@x.com', 'two@x.com']);
});

test('without Firebase configured the policy cannot be switched on, and nothing is blocked', async () => {
  const bare = new Miniflare({
    modules: true, scriptPath: 'index.js', modulesRoot: '.', rootPath: process.env.SSO_DIST || '/tmp/ssodist',
    compatibilityDate: '2025-09-01', d1Databases: ['DB'], bindings: { ADMIN_EMAILS: 'boss@x.com' },
    serviceBindings: { ASSETS: () => new Response('asset') }, outboundService: () => new Response('no', { status: 599 }),
  });
  try {
    const d = await bare.getD1Database('DB');
    const schema = fs.readFileSync(new URL('../schema.sql', import.meta.url), 'utf8').replace(/--.*$/gm, '');
    for (const s of schema.split(';').map(x => x.trim()).filter(Boolean)) await d.prepare(s).run();
    await bare.dispatchFetch(BASE + '/api/config');
    await d.prepare("INSERT INTO users (id, email, name, created_at, email_verified) VALUES ('admin', 'boss@x.com', 'Boss', ?, 1)").bind(t0).run();
    await d.prepare('INSERT INTO sessions (id, user_id, client_id, created_at, expires_at) VALUES (?, ?, NULL, ?, ?)').bind(hash('adm'), 'admin', t0, t0 + 86400).run();
    const res = await bare.dispatchFetch(BASE + '/api/admin/phone', { method: 'PUT', headers: { cookie: 'sso_session=adm', 'content-type': 'application/json' }, body: JSON.stringify({ on: true, grace_days: 3 }) });
    assert.equal(res.status, 400);
    assert.equal((await (await bare.dispatchFetch(BASE + '/api/config')).json()).firebase, null);
  } finally { await bare.dispose(); }
});
