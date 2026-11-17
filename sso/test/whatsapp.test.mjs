// The WhatsApp Cloud API webhook: Meta's verification handshake, and signed events.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { Miniflare } from 'miniflare';

const BASE = 'https://login.reembir.com';
let mf;
const sign = (secret, body) => 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');

before(async () => {
  mf = new Miniflare({
    modules: true, scriptPath: 'index.js', modulesRoot: '.', rootPath: process.env.SSO_DIST || '/tmp/ssodist',
    compatibilityDate: '2025-09-01', d1Databases: ['DB'],
    bindings: { WHATSAPP_VERIFY_TOKEN: 'verify-me', WHATSAPP_APP_SECRET: 'app-secret' },
    serviceBindings: { ASSETS: () => new Response('asset') },
    outboundService: () => new Response('no', { status: 599 }),
  });
  const db = await mf.getD1Database('DB');
  const schema = fs.readFileSync(new URL('../schema.sql', import.meta.url), 'utf8').replace(/--.*$/gm, '');
  for (const s of schema.split(';').map(x => x.trim()).filter(Boolean)) await db.prepare(s).run();
});
after(() => mf?.dispose());

test('Meta’s handshake: the challenge comes back only with our verify token', async () => {
  const get = q => mf.dispatchFetch(`${BASE}/api/whatsapp/webhook?${q}`);
  const ok = await get('hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=1158201444');
  assert.equal(ok.status, 200);
  assert.equal(await ok.text(), '1158201444');
  assert.equal((await get('hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=1')).status, 403);
  assert.equal((await get('hub.mode=subscribe&hub.challenge=1')).status, 403);
  assert.equal((await get('')).status, 403);
});

test('events must be signed with the app secret', async () => {
  const body = JSON.stringify({ object: 'whatsapp_business_account', entry: [{ changes: [{ field: 'messages', value: { statuses: [{ id: 'wamid.1', status: 'delivered', recipient_id: '972501234567' }] } }] }] });
  const post = (sig, b = body) => mf.dispatchFetch(`${BASE}/api/whatsapp/webhook`, { method: 'POST', headers: { 'content-type': 'application/json', ...(sig ? { 'x-hub-signature-256': sig } : {}) }, body: b });
  assert.equal((await post(sign('app-secret', body))).status, 200);
  assert.equal((await post(sign('other-secret', body))).status, 401, 'signed with another secret');
  assert.equal((await post(null)).status, 401, 'not signed');
  assert.equal((await post(sign('app-secret', body), body + ' ')).status, 401, 'changed after signing');
  const bad = 'not json';
  assert.equal((await post(sign('app-secret', bad), bad)).status, 400);
});

test('without a verify token configured it says so (503), and does not hand out a challenge', async () => {
  const bare = new Miniflare({
    modules: true, scriptPath: 'index.js', modulesRoot: '.', rootPath: process.env.SSO_DIST || '/tmp/ssodist',
    compatibilityDate: '2025-09-01', d1Databases: ['DB'], serviceBindings: { ASSETS: () => new Response('asset') }, outboundService: () => new Response('no', { status: 599 }),
  });
  try {
    const d = await bare.getD1Database('DB');
    const schema = fs.readFileSync(new URL('../schema.sql', import.meta.url), 'utf8').replace(/--.*$/gm, '');
    for (const q of schema.split(';').map(x => x.trim()).filter(Boolean)) await d.prepare(q).run();
    assert.equal((await bare.dispatchFetch(`${BASE}/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=x&hub.challenge=1`)).status, 503);
  } finally { await bare.dispose(); }
});

test('verifying a phone by WhatsApp: the person writes the code, the sender’s number becomes theirs', async () => {
  const mfw = new Miniflare({
    modules: true, scriptPath: 'index.js', modulesRoot: '.', rootPath: process.env.SSO_DIST || '/tmp/ssodist',
    compatibilityDate: '2025-09-01', d1Databases: ['DB'],
    bindings: { WHATSAPP_APP_SECRET: 'app-secret', WHATSAPP_NUMBER: '+972 50-000-0000', WHATSAPP_TOKEN: 't', WHATSAPP_PHONE_ID: '99' },
    serviceBindings: { ASSETS: () => new Response('asset') },
    outboundService: () => new Response('{}', { status: 200 }),
  });
  try {
    const d = await mfw.getD1Database('DB');
    const schema = fs.readFileSync(new URL('../schema.sql', import.meta.url), 'utf8').replace(/--.*$/gm, '');
    for (const q of schema.split(';').map(x => x.trim()).filter(Boolean)) await d.prepare(q).run();
    await mfw.dispatchFetch(BASE + '/api/config');
    const t = Math.floor(Date.now() / 1000), h = x => crypto.createHash('sha256').update(x).digest('base64url');
    for (const [id, tok] of [['a', 'ta'], ['b', 'tb']]) {
      await d.prepare('INSERT INTO users (id, email, name, created_at, email_verified) VALUES (?, ?, ?, ?, 1)').bind(id, id + '@x.com', id, t).run();
      await d.prepare('INSERT INTO sessions (id, user_id, client_id, created_at, expires_at) VALUES (?, ?, NULL, ?, ?)').bind(h(tok), id, t, t + 9999).run();
    }
    const api = (path, tok, body) => mfw.dispatchFetch(BASE + path, { method: 'POST', headers: { 'content-type': 'application/json', cookie: 'sso_session=' + tok }, body: JSON.stringify(body || {}) });
    const incoming = async (from, text, secret = 'app-secret') => {
      const body = JSON.stringify({ entry: [{ changes: [{ value: { messages: [{ from, type: 'text', text: { body: text } }] } }] }] });
      return mfw.dispatchFetch(`${BASE}/api/whatsapp/webhook`, { method: 'POST', headers: { 'x-hub-signature-256': sign(secret, body) }, body });
    };
    assert.equal((await (await mfw.dispatchFetch(BASE + '/api/config')).json()).whatsapp, true);
    const a = await (await api('/api/phone/wa/start', 'ta')).json();
    assert.match(a.link, /^https:\/\/wa\.me\/972500000000\?text=/);
    assert.match(a.code, /^[A-Z2-9]{6}$/);
    assert.equal((await (await api('/api/phone/wa/status', 'ta', { code: a.code })).json()).status, 'waiting');
    assert.equal((await (await api('/api/phone/wa/status', 'tb', { code: a.code })).json()).status, 'expired', 'someone else’s code');
    await incoming('972521112222', 'אימות ' + a.code, 'wrong-secret'); // forged: not signed by Meta
    assert.equal((await (await api('/api/phone/wa/status', 'ta', { code: a.code })).json()).status, 'waiting');
    assert.equal((await incoming('972521112222', 'אימות ' + a.code)).status, 200);
    const st = await (await api('/api/phone/wa/status', 'ta', { code: a.code })).json();
    assert.equal(st.status, 'done');
    assert.equal((await d.prepare("SELECT phone FROM users WHERE id='a'").first()).phone, '+972521112222');
    // the same number can't be claimed by another account
    const b = await (await api('/api/phone/wa/start', 'tb')).json();
    await incoming('972521112222', b.code);
    assert.equal((await (await api('/api/phone/wa/status', 'tb', { code: b.code })).json()).status, 'error');
    assert.equal((await d.prepare("SELECT phone FROM users WHERE id='b'").first()).phone, null);
    // a code works once
    await incoming('972539990000', a.code);
    assert.equal((await d.prepare("SELECT phone FROM users WHERE id='a'").first()).phone, '+972521112222');
  } finally { await mfw.dispose(); }
});
