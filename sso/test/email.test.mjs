// Central email: sites send through reem.bi's one Resend account, from the sender chosen per site.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { Miniflare } from 'miniflare';

const BASE = 'https://login.reembir.com';
const SITE = 'https://timlul.reembir.com';
const sent = [];

async function resend(req) {
  const url = new URL(req.url);
  if (url.pathname === '/domains') return Response.json({ data: [{ name: 'reembir.com', status: 'verified' }, { name: 'other.co.il', status: 'pending' }] });
  if (url.pathname === '/emails') { sent.push(await req.json()); return Response.json({ id: 'e' + sent.length }); }
  if (url.pathname === '/usage') return Response.json({}, { status: 401 });
  return Response.json({}, { status: 599 });
}

let mf;
const hash = t => crypto.createHash('sha256').update(t).digest('base64url');
before(async () => {
  mf = new Miniflare({
    modules: true, scriptPath: 'index.js', modulesRoot: '.', rootPath: process.env.SSO_DIST || '/tmp/ssodist',
    compatibilityDate: '2025-09-01', d1Databases: ['DB'],
    bindings: { RESEND_API_KEY: 're_x', ADMIN_EMAILS: 'boss@x.com', CHAT_SERVICE_KEY: 'svc-secret' },
    serviceBindings: { ASSETS: () => new Response('asset'), CHAT: () => new Response('{}') },
    outboundService: resend,
  });
  const db = await mf.getD1Database('DB');
  const schema = fs.readFileSync(new URL('../schema.sql', import.meta.url), 'utf8').replace(/--.*$/gm, '');
  for (const s of schema.split(';').map(x => x.trim()).filter(Boolean)) await db.prepare(s).run();
  const t = Math.floor(Date.now() / 1000);
  await db.prepare("INSERT INTO sites (id, name, url, redirect_uris, created_at) VALUES ('timlul', 'תמלול', ?, ?, ?)").bind(SITE + '/', JSON.stringify([SITE + '/']), t).run();
  for (const [id, mail] of [['admin', 'boss@x.com'], ['u1', 'a@x.com']]) await db.prepare('INSERT INTO users (id, email, created_at, email_verified) VALUES (?, ?, ?, 1)').bind(id, mail, t).run();
  for (const [tok, user, client] of [['adm', 'admin', null], ['tok-a', 'u1', 'timlul']]) {
    await db.prepare('INSERT INTO sessions (id, user_id, client_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?)').bind(hash(tok), user, client, t, t + 86400).run();
  }
  await mf.dispatchFetch(BASE + '/api/config'); // migrations
  await db.prepare("INSERT INTO site_keys (site_id, key_hash, created_at) VALUES ('timlul', ?, ?)").bind(hash('rsk_test'), t).run().catch(async () => {
    await mf.dispatchFetch(BASE + '/api/site/plans', { headers: { 'x-site-key': 'rsk_nope' } }); // creates the table
    await db.prepare("INSERT INTO site_keys (site_id, key_hash, created_at) VALUES ('timlul', ?, ?)").bind(hash('rsk_test'), t).run();
  });
});
after(() => mf?.dispose());

const admin = (path, body, method) => mf.dispatchFetch(BASE + path, {
  method: method || (body ? 'POST' : 'GET'), headers: { cookie: 'sso_session=adm', 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined,
});
const saveSite = mailFrom => admin('/api/admin/sites/timlul', { name: 'תמלול', url: SITE + '/', redirect_uris: [SITE + '/'], access_mode: 'open', mail_from: mailFrom }, 'PUT');

test('the admin sees the Resend domains and picks the site’s sender', async () => {
  const d = await (await admin('/api/admin/email/domains')).json();
  assert.deepEqual(d.domains.map(x => x.name), ['reembir.com', 'other.co.il']);
  assert.equal((await saveSite('תמלול <timlul@nope.com>')).status, 400, 'domain not in the account');
  assert.equal((await saveSite('bad address')).status, 400);
  const r = await (await saveSite('תמלול <Timlul@reembir.com>')).json();
  assert.equal(r.sites.find(s => s.id === 'timlul').mail_from, 'תמלול <timlul@reembir.com>');
  const log = await (await admin('/api/admin/email/log')).json();
  assert.deepEqual(log.domains, ['reembir.com'], 'only verified domains in the email tab');
});

test('a site emails the signed-in user, from its own sender, with attachments', async () => {
  const res = await mf.dispatchFetch(BASE + '/api/email/me', {
    method: 'POST', headers: { authorization: 'Bearer tok-a', 'content-type': 'application/json', origin: SITE },
    body: JSON.stringify({ subject: 'התמלול שלך', text: 'מצורף', attachments: [{ filename: 'a.txt', content: 'aGk=' }], to: 'evil@x.com' }),
  });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('access-control-allow-origin'), SITE);
  const m = sent.at(-1);
  assert.deepEqual(m.to, ['a@x.com'], 'only to the user, whatever the body says');
  assert.equal(m.from, 'תמלול <timlul@reembir.com>');
  assert.equal(m.attachments[0].filename, 'a.txt');
  assert.equal((await mf.dispatchFetch(BASE + '/api/email/me', { method: 'POST', body: '{}' })).status, 401);
});

test('a site server sends to anyone with its key; default sender when none is set', async () => {
  const send = (key, body) => mf.dispatchFetch(BASE + '/api/site/email', { method: 'POST', headers: { 'x-site-key': key, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal((await send('rsk_wrong', { to: 'b@x.com', subject: 's', text: 't' })).status, 401);
  assert.equal((await send('rsk_test', { to: [], subject: 's', text: 't' })).status, 400);
  assert.equal((await send('rsk_test', { to: ['b@x.com', 'c@x.com'], subject: 'שלום', html: '<b>hi</b>' })).status, 200);
  assert.deepEqual(sent.at(-1).to, ['b@x.com', 'c@x.com']);
  await saveSite(null);
  await send('rsk_test', { to: 'b@x.com', subject: 's', text: 't' });
  assert.equal(sent.at(-1).from, 'reem.bi <no-reply@reembir.com>');
});

test('the support chat sends through the same account with its service key', async () => {
  const send = (key, body) => mf.dispatchFetch(BASE + '/api/service/email', { method: 'POST', headers: { 'x-service-key': key, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal((await send('wrong', { to: 'x@x.com', subject: 's', text: 't' })).status, 401);
  assert.equal((await send('svc-secret', { to: 'agent@x.com', subject: 'שיחה חדשה', html: '<p>hi</p>', from: 'reem.bi Support <support@reembir.com>' })).status, 200);
  assert.equal(sent.at(-1).from, 'reem.bi Support <support@reembir.com>');
  await send('svc-secret', { to: 'agent@x.com', subject: 's', text: 't', from: 'x <x@not-mine.com>' });
  assert.equal(sent.at(-1).from, 'reem.bi <no-reply@reembir.com>', 'a domain outside the account falls back to the default');
});
