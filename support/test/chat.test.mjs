// The support chat across reem.bi's sites: the site of each conversation, a verified account, and
// what an agent may do for the customer (gifts, personal coupons, packs, upgrades) by permission.
// The worker in Miniflare with its real Durable Object storage; login.reembir.com is mocked.
// Run: npm test   (builds into /tmp first)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Miniflare } from 'miniflare';

const URL0 = 'http://chat.test';
const SITE = 'https://timlul.reembir.com';
const mails = [];
const calls = [];

async function sso(req) {
  const url = new URL(req.url);
  const body = req.method === 'POST' ? await req.json().catch(() => ({})) : null;
  calls.push({ path: url.pathname, body });
  if (url.pathname === '/api/userinfo') {
    if (req.headers.get('authorization') !== 'Bearer tok-dana') return Response.json({ error: 'invalid_token' }, { status: 401 });
    return Response.json({ user: { id: 'u1', email: 'dana@x.com', name: 'דנה' }, access: {}, site: { id: 'timlul', name: 'תמלול', url: SITE + '/' } });
  }
  if (req.headers.get('x-service-key') !== 'svc') return Response.json({ error: 'bad_service_key' }, { status: 401 });
  const p = url.pathname.replace('/api/service/', '');
  if (p === 'email') { mails.push(body); return Response.json({ ok: true }); }
  if (p === 'catalog') {
    return Response.json({
      sites: [{ id: 'timlul', name: 'תמלול', url: SITE + '/' }, { id: 'other', name: 'אחר', url: 'https://other.x/' }],
      plans: [{ id: 'timlul:pro', site_id: 'timlul', name: 'מקצועי' }, { id: 'timlul:biz', site_id: 'timlul', name: 'עסקי' }],
      packs: [{ id: 'timlul:pack100', site_id: 'timlul', name: '100 דקות', price: 8, currency: 'ILS', features: { minutes: 100 } }],
      bonus_keys: { timlul: ['minutes'] }, coupon_types: ['percent', 'amount', 'trial', 'gift'],
    });
  }
  if (p === 'bonus') return Response.json({ result: { user_email: 'dana@x.com', site_name: 'תמלול', label: `${body.features.minutes} דקות` } });
  if (p === 'coupon') return Response.json({ result: { code: 'CABCDEFG', label: '50% הנחה לחודש הראשון', site_name: 'תמלול', link: SITE + '/?coupon=CABCDEFG' } });
  if (p === 'access') return Response.json({ result: { user_email: 'dana@x.com', site_name: 'תמלול', plan_name: 'מקצועי', expires_at: null } });
  if (p === 'pay') {
    return Response.json({
      request: {
        id: 'p' + calls.length, link: 'https://pay.reembir.com/r/x', amount_text: '₪' + body.amount, amount_cents: body.amount * 100, currency: body.currency,
        description: body.description, email: 'dana@x.com', expires_at: body.expires_at,
        on_paid: body.on_paid?.pack_id ? { pack_id: body.on_paid.pack_id, site_name: 'תמלול', pack_name: '100 דקות' } : null,
      },
      emailed: false,
    });
  }
  return Response.json({ message: 'unexpected ' + p }, { status: 599 });
}

let mf;
before(async () => {
  mf = new Miniflare({
    modules: true, scriptPath: 'index.js', modulesRoot: '/tmp/chatdist', rootPath: '/tmp/chatdist',
    compatibilityDate: '2025-09-01',
    durableObjects: { HUB: { className: 'ChatHub', useSQLite: true } },
    bindings: { ADMIN_EMAILS: 'boss@x.com', PUBLIC_URL: URL0, SSO_SERVICE_KEY: 'svc' },
    serviceBindings: { ASSETS: () => new Response('asset'), SSO: sso },
  });
});
after(() => mf?.dispose());

const call = async (path, { body, cookie, origin = URL0, method, auth } = {}) => {
  const r = await mf.dispatchFetch(URL0 + path, {
    method: method || (body ? 'POST' : 'GET'),
    headers: { 'content-type': 'application/json', origin, ...(cookie ? { cookie } : {}), ...(auth ? { authorization: 'Bearer ' + auth } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, data: await r.json().catch(() => ({})), headers: r.headers };
};
const tokenFromMail = () => { const m = (mails.at(-1).html + mails.at(-1).text).match(/password\/([A-Za-z0-9_-]{20,})/); if (!m) console.log('MAIL', mails.at(-1)); return m[1]; };
async function signIn(token) {
  const r = await call('/api/auth/set-password', { body: { token, password: 'Password123!x', name: 'x' } });
  return r.headers.get('set-cookie').split(';')[0];
}

let admin, agent, agentId, visitor, convId;

test('admins and agents', async () => {
  await call('/api/auth/forgot', { body: { email: 'boss@x.com' } });
  admin = await signIn(tokenFromMail());
  const r = await call('/api/a/agents', { cookie: admin, body: { email: 'agent@x.com', name: 'סוכן' } });
  agentId = r.data.agent.id;
  agent = await signIn(tokenFromMail());
  assert.ok(agent);
});

test('the customer: which site, and a verified reem.bi account', async () => {
  const init = await call('/api/v/init', { origin: SITE, body: { url: SITE + '/', title: 'תמלול', site: 'timlul' } });
  visitor = init.data.token;
  assert.equal((await call('/api/v/identify', { origin: SITE, auth: visitor, body: { token: 'forged' } })).status, 401);
  assert.equal((await call('/api/v/identify', { origin: SITE, auth: visitor, body: { token: 'tok-dana' } })).data.verified, true);
  const m = await call('/api/v/messages', { origin: SITE, auth: visitor, body: { text: 'שלום, התמלול נעצר' } });
  convId = m.data.conversation.id;
  const c = await call(`/api/a/conversations/${convId}`, { cookie: admin });
  assert.deepEqual([c.data.conversation.site_id, c.data.conversation.site_name], ['timlul', 'תמלול']);
  assert.deepEqual([c.data.visitor.account_id, c.data.visitor.account_email, c.data.visitor.name], ['u1', 'dana@x.com', 'דנה']);
  const list = await call('/api/a/conversations?view=open&site=timlul', { cookie: admin });
  assert.equal(list.data.conversations[0].account_email, 'dana@x.com');
  assert.equal((await call('/api/a/conversations?view=open&site=other', { cookie: admin })).data.conversations.length, 0);

  // Without data-site, the site comes from the page's address.
  const other = await call('/api/v/init', { origin: SITE, body: { url: SITE + '/pricing' } });
  await call('/api/v/messages', { origin: SITE, auth: other.data.token, body: { text: 'שאלה' } });
  const all = await call('/api/a/conversations?view=open', { cookie: admin });
  assert.ok(all.data.conversations.every(x => x.site_name === 'תמלול'));
});

test('gifts: only with the permission, on the allowed sites, up to the limit', async () => {
  const gift = (body, cookie = agent) => call(`/api/a/conversations/${convId}/gift`, { cookie, body });
  assert.equal((await gift({ site_id: 'timlul', features: { minutes: 20 } })).status, 403, 'no permission');
  await call(`/api/a/agents/${agentId}`, { method: 'PATCH', cookie: admin, body: { perms: { gift: { on: true, sites: ['other'], max_amount: 30 } } } });
  assert.equal((await gift({ site_id: 'timlul', features: { minutes: 20 } })).status, 403, 'not this site');
  await call(`/api/a/agents/${agentId}`, { method: 'PATCH', cookie: admin, body: { perms: { gift: { on: true, sites: ['timlul'], max_amount: 30 } } } });
  assert.equal((await gift({ site_id: 'timlul', features: { minutes: 40 } })).status, 403, 'over the limit');
  const r = await gift({ site_id: 'timlul', features: { minutes: 20 }, note: 'פיצוי' });
  assert.equal(r.status, 200);
  assert.deepEqual(calls.filter(c => c.path === '/api/service/bonus').at(-1).body, { user_id: 'u1', site_id: 'timlul', features: { minutes: 20 }, note: 'פיצוי', by: 'x' });
  assert.match(r.data.message.body, /קיבלת מתנה: 20 דקות בתמלול/);
  // The customer sees it.
  const v = await call('/api/v/init', { origin: SITE, body: { token: visitor, url: SITE + '/' } });
  assert.ok(v.data.messages.some(m => /20 דקות/.test(m.body)));
});

test('personal coupons and packs, with their own limits', async () => {
  await call(`/api/a/agents/${agentId}`, { method: 'PATCH', cookie: admin, body: { perms: {
    coupon: { on: true, types: ['percent'], max_percent: 30, max_months: 2 },
    pack: { on: true, sites: ['timlul'] },
  } } });
  const coupon = body => call(`/api/a/conversations/${convId}/coupon`, { cookie: agent, body: { site_id: 'timlul', ...body } });
  assert.equal((await coupon({ type: 'gift', months: 1, plan_ids: ['timlul:pro'] })).status, 403, 'type');
  assert.equal((await coupon({ type: 'percent', value: 50, months: 1 })).status, 403, '30% at most');
  assert.equal((await coupon({ type: 'percent', value: 20, months: 3 })).status, 403, '2 months at most');
  assert.equal((await coupon({ type: 'percent', value: 20, months: 0 })).status, 403, 'not forever');
  const c = await coupon({ type: 'percent', value: 20, months: 1 });
  assert.equal(c.status, 200);
  assert.match(c.data.message.body, /CABCDEFG/);
  assert.match(c.data.message.body, /\?coupon=CABCDEFG/);

  const p = await call(`/api/a/conversations/${convId}/pack`, { cookie: agent, body: { pack_id: 'timlul:pack100' } });
  assert.equal(p.status, 200);
  assert.equal(p.data.message.kind, 'pay');
  assert.deepEqual(p.data.message.meta.pack, { site_name: 'תמלול', pack_name: '100 דקות' });
  const sent = calls.filter(x => x.path === '/api/service/pay').at(-1).body;
  assert.deepEqual([sent.amount, sent.currency, sent.user_id, sent.on_paid.pack_id], [8, 'ILS', 'u1', 'timlul:pack100'], 'the server price, the verified account');
  assert.equal((await call(`/api/a/conversations/${convId}/pack`, { cookie: agent, body: { pack_id: 'nope' } })).status, 404);
});

test('upgrades: allowed plans and days', async () => {
  await call(`/api/a/agents/${agentId}`, { method: 'PATCH', cookie: admin, body: { perms: { upgrade: { on: true, plans: ['timlul:pro'], max_days: 30 } } } });
  const up = body => call('/api/a/sso/access', { cookie: agent, body: { conv_id: convId, user_id: 'u1', site_id: 'timlul', ...body } });
  assert.equal((await up({ plan_id: 'timlul:biz', days: 30 })).status, 403, 'plan');
  assert.equal((await up({ plan_id: 'timlul:pro', days: 0 })).status, 403, 'forever');
  assert.equal((await up({ plan_id: 'timlul:pro', days: 60 })).status, 403, 'days');
  assert.equal((await up({ plan_id: 'timlul:pro', days: 30 })).status, 200);
  const me = await call('/api/auth/me', { cookie: agent });
  assert.deepEqual(me.data.agent.perms.upgrade.plans, ['timlul:pro']);
});
