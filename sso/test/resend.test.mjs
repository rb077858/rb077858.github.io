// The overview's "emails today" comes from Resend (whole account), not only the dashboard's sends.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { Miniflare } from 'miniflare';

const BASE = 'https://login.reembir.com';
let usageAllowed = true;

async function resend(req) {
  const url = new URL(req.url);
  if (url.pathname === '/usage') {
    if (!usageAllowed) return Response.json({ message: 'restricted key' }, { status: 401 });
    return Response.json({ emails: { daily: { used: 37, limit: 100 }, monthly: { used: 420, limit: 3000 } } });
  }
  if (url.pathname === '/emails') {
    return Response.json({ id: 'e1' }, { headers: { 'x-resend-daily-quota': '12', 'x-resend-monthly-quota': '250' } });
  }
  return Response.json({}, { status: 599 });
}

let mf;
const hash = t => crypto.createHash('sha256').update(t).digest('base64url');
before(async () => {
  mf = new Miniflare({
    modules: true, scriptPath: 'index.js', modulesRoot: '.', rootPath: process.env.SSO_DIST || '/tmp/ssodist',
    compatibilityDate: '2025-09-01', d1Databases: ['DB'],
    bindings: { RESEND_API_KEY: 're_x', ADMIN_EMAILS: 'boss@x.com' },
    serviceBindings: { ASSETS: () => new Response('asset'), CHAT: () => new Response('{}') },
    outboundService: resend,
  });
  const db = await mf.getD1Database('DB');
  const schema = fs.readFileSync(new URL('../schema.sql', import.meta.url), 'utf8').replace(/--.*$/gm, '');
  for (const s of schema.split(';').map(x => x.trim()).filter(Boolean)) await db.prepare(s).run();
  const t = Math.floor(Date.now() / 1000);
  await db.prepare("INSERT INTO users (id, email, created_at, email_verified) VALUES ('admin', 'boss@x.com', ?, 1)").bind(t).run();
  await db.prepare("INSERT INTO sessions (id, user_id, client_id, created_at, expires_at) VALUES (?, 'admin', NULL, ?, ?)").bind(hash('adm'), t, t + 86400).run();
});
after(() => mf?.dispose());

const stats = async () => (await mf.dispatchFetch(BASE + '/api/admin/stats', { headers: { cookie: 'sso_session=adm' } })).json();

test('live numbers from Resend /usage', async () => {
  const s = await stats();
  assert.deepEqual(s.resend, { daily: 37, daily_limit: 100, monthly: 420, monthly_limit: 3000, source: 'resend' });
});

test('without access to /usage: the quota header from the last email sent', async () => {
  usageAllowed = false;
  // A fresh isolate cache would be needed to drop the cached /usage answer; wait it out instead.
  await mf.setOptions({
    modules: true, scriptPath: 'index.js', modulesRoot: '.', rootPath: process.env.SSO_DIST || '/tmp/ssodist',
    compatibilityDate: '2025-09-01', d1Databases: ['DB'],
    bindings: { RESEND_API_KEY: 're_x', ADMIN_EMAILS: 'boss@x.com' },
    serviceBindings: { ASSETS: () => new Response('asset'), CHAT: () => new Response('{}') },
    outboundService: resend,
  });
  let s = await stats();
  assert.equal(s.resend.source, null, 'nothing known yet');
  // Any automatic email (here: a magic sign-in link) brings the account's quota back in its headers.
  const r = await mf.dispatchFetch(BASE + '/api/auth/magic', {
    method: 'POST', headers: { 'content-type': 'application/json', origin: BASE }, body: JSON.stringify({ email: 'someone@x.com' }),
  });
  assert.equal(r.status, 200);
  s = await stats();
  assert.equal(s.resend.source, 'header');
  assert.equal(s.resend.daily, 12);
  assert.equal(s.resend.monthly, 250);
});
