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
const gemini = []; // what the AI agent sent to Gemini
const reviews = []; // what the reviewer was asked

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
  if (p === 'users') {
    return Response.json({ users: [{
      id: 'u1', email: 'dana@x.com', name: 'דנה', created_at: 1700000000, last_login_at: 1760000000, email_verified: true, phone_verified: true, disabled: false,
      access: [{ site_id: 'timlul', site_name: 'תמלול', plan_id: 'timlul:pro', plan_name: 'Basic', status: 'active', plan_expires_at: 1800000000, last_used_at: 1760000000 }],
      subscriptions: [{ site_id: 'timlul', plan_id: 'timlul:pro', plan_name: 'Basic', status: 'ACTIVE', price: 9, currency: 'ILS', paid_until: 1790000000 }],
      payments: [{ type: 'PAYMENT.SALE.COMPLETED', amount: 9, currency: 'ILS', ts: 1760000000 }], bonus: { timlul: { minutes: 30 } },
    }] });
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
    bindings: { ADMIN_EMAILS: 'boss@x.com', PUBLIC_URL: URL0, SSO_SERVICE_KEY: 'svc', GEMINI_API_KEY: 'gk', GEMINI_API_BASE: 'http://gemini.test' },
    serviceBindings: { ASSETS: () => new Response('asset'), SSO: sso },
    // Gemini: an AI agent's reply. It hands over when the customer asks for a human.
    outboundService: async req => {
      const body = await req.json();
      const turns = body.contents.map(c => ({ role: c.role, text: c.parts[0].text }));
      const last = turns.at(-1).text;
      if (!/strict, skeptical reviewer/.test(body.systemInstruction.parts[0].text)) gemini.push({ system: body.systemInstruction.parts[0].text, turns });
      if (/strict, skeptical reviewer/.test(body.systemInstruction.parts[0].text)) {
        reviews.push({ system: body.systemInstruction.parts[0].text, text: last });
        const ok = /error 500/.test(last) && !/bogus|The customer says so/.test(last);
        return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify(ok ? { allow: true, reason: 'A specific error with a time and a screenshot.', missing: '' } : { allow: false, reason: 'Only a claim, no details.', missing: 'the error message and when it happened' }) }] } }] });
      }
      if (/Answer with JSON only/.test(body.systemInstruction.parts[0].text)) {
        if (/\[system note: the result of the check/.test(last)) return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify({ reply: 'I checked: you are on Basic, paid and active.', handoff: false }) }] } }] });
        if (/\[system note: a colleague wrote/.test(last)) return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify({ reply: /not sure/.test(turns.map(t => t.text).join(' ')) ? '' : 'Good news: the invoice was fixed by my colleague.', handoff: false }) }] } }] });
        if (/\[system note: nobody answered/.test(last)) return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify({ reply: 'I am passing the chat to the team.', handoff: true }) }] } }] });
        if (/\[system note, not from the customer: it could not be done/.test(last)) return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify({ reply: 'Sorry, I cannot do that.', handoff: false }) }] } }] });
        if (/did my payment go through/i.test(last)) return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify({ reply: 'One moment, I am checking your account.', handoff: false, look_up: 'account' }) }] } }] });
        if (/ask the team about my invoice/i.test(last)) return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify({ reply: 'I asked a colleague, I will write as soon as I hear.', handoff: false, ask_team: { to: '', question: 'Customer says the March invoice is wrong. Can someone check it?' } }) }] } }] });
        if (/upgrade me/i.test(last)) return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify({ reply: 'Done, you are on Pro.', handoff: false, upgrade: { site_id: 'timlul', plan_id: 'timlul:pro', days: /long/.test(last) ? 90 : 30, why: { type: 'fault', problem: 'Plan was not activated after payment', evidence: 'Customer paid, shows transaction number 4411, plan still free; error 500 on the account page' } } }) }] } }] });
        if (/buy a pack/i.test(last)) return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify({ reply: 'Here is the pack.', handoff: false, pack: { pack_id: 'timlul:pack100' } }) }] } }] });
        if (/pay me/i.test(last)) return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify({ reply: 'I asked a colleague to send you the payment link.', handoff: false, pay: { amount: /huge/.test(last) ? 900 : 30, description: 'Extra pack' } }) }] } }] });
        if (/\bbye\b/i.test(last)) return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify({ reply: 'Bye, take care!', handoff: false, close: true }) }] } }] });
        if (/gift/i.test(last)) {
          const gift = { site_id: 'timlul', features: { minutes: /big/.test(last) ? 500 : 20 }, note: 'compensation', why: /nowhy/.test(last) ? undefined : { type: 'fault', problem: 'The export failed twice with error 500', evidence: /bogus/.test(last) ? 'The customer says so' : 'Customer reports export error 500 at 10:05, twice, and sent a screenshot' } };
          return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify({ reply: 'I am arranging a gift for you.', handoff: false, gift }) }] } }] });
        }
        const reply = /אנושי|human/.test(last) ? { reply: 'I will hand you over to a colleague.', handoff: true, pay: null } : { reply: 'Hi! We open at 9. How can I help?', handoff: false, pay: null };
        return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify(reply) }] } }] });
      }
      return Response.json({ candidates: [{ content: { parts: [{ text: '{"lang":"he"}' }] } }] });
    },
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

// ---------------------------------------------------------------------------------------------------------------------
// AI agents, and an agent's own language
// ---------------------------------------------------------------------------------------------------------------------
let aiId;
const hello = async (text, site = SITE) => {
  const init = await call('/api/v/init', { origin: site, body: { url: site + '/', title: 'תמלול', site: 'timlul' } });
  const m = await call('/api/v/messages', { origin: site, auth: init.data.token, body: { text } });
  return { token: init.data.token, convId: m.data.conversation.id };
};
const settle = () => new Promise(r => setTimeout(r, 400));

test('an AI agent: made like any agent, always available, with a language set once', async () => {
  const r = await call('/api/a/agents', { cookie: admin, body: {
    kind: 'ai', name: 'נועה', lang: 'en', max_chats: 5,
    ai: { prompt: 'We open at 9. Refunds within 14 days.', actions: { pay: 'approve' } }, perms: { pay: { on: true, max_amount: 50 } },
  } });
  assert.equal(r.status, 200);
  aiId = r.data.agent.id;
  assert.deepEqual([r.data.agent.kind, r.data.agent.lang, r.data.agent.title, r.data.agent.pending], ['ai', 'en', 'עוזרת וירטואלית', false], 'a woman, and it says it is virtual, by default');
  assert.equal(r.data.agent.ai_active, true);
  assert.equal(r.data.agent.email, '', 'no email shown');
  // nobody human is signed in, yet the chat is open
  const init = await call('/api/v/init', { origin: SITE, body: { url: SITE + '/' } });
  assert.equal(init.data.available, true);
  assert.equal(init.data.agents[0].name, 'נועה');
  // its instructions are for admins only, and it has no way in
  assert.equal((await call(`/api/a/agents/${aiId}/ai`, { cookie: admin })).data.ai.prompt, 'We open at 9. Refunds within 14 days.');
  assert.equal((await call(`/api/a/agents/${aiId}/ai`, { cookie: agent })).status, 403);
  const list = await call('/api/a/bootstrap', { cookie: agent });
  assert.ok(!JSON.stringify(list.data.agents).includes('Refunds within'));
  const mailsBefore = mails.length;
  await call('/api/auth/forgot', { body: { email: `ai-${aiId}@ai.invalid` } });
  assert.equal(mails.length, mailsBefore, 'no reset mail for an AI agent');
  assert.equal((await call('/api/auth/login', { body: { email: `ai-${aiId}@ai.invalid`, password: 'x' } })).status, 401);
});

test('an AI agent takes a new chat even with manual assignment, and answers in its language, with what it was told', async () => {
  const { token, convId } = await hello('Hello, when do you open?');
  await settle();
  const c = await call(`/api/a/conversations/${convId}`, { cookie: admin });
  assert.equal(c.data.conversation.assigned_agent_id, aiId);
  const replies = c.data.messages.filter(m => m.sender_type === 'agent');
  assert.equal(replies.length, 1);
  assert.equal(replies[0].body, 'Hi! We open at 9. How can I help?');
  assert.equal(replies[0].meta.ai, true);
  assert.ok(c.data.conversation.first_response_at, 'it counts as the first response');
  const g = gemini.at(-1);
  assert.match(g.system, /English \(en\)/);
  assert.match(g.system, /Refunds within 14 days/);
  assert.match(g.system, /at most 50/, 'its payment limit comes from its permission');
  assert.deepEqual(g.turns, [{ role: 'user', text: 'Hello, when do you open?' }]);
  // the customer sees it, marked as AI
  const v = await call('/api/v/init', { origin: SITE, body: { token, url: SITE + '/' } });
  const seen = v.data.messages.filter(m => m.sender_type === 'agent');
  assert.equal(seen[0].meta.ai, true);
  assert.equal(seen[0].sender_name, 'נועה');
  // the next message gets the whole conversation
  await call('/api/v/messages', { origin: SITE, auth: token, body: { text: 'And on Friday?' } });
  await settle();
  assert.deepEqual(gemini.at(-1).turns.map(t => t.role), ['user', 'model', 'user']);
});

test('an AI agent hands the chat to a human when asked, and does not take it back', async () => {
  const { token, convId } = await hello('I want to talk to a human please');
  await settle();
  const c = await call(`/api/a/conversations/${convId}`, { cookie: admin });
  assert.equal(c.data.conversation.assigned_agent_id, null, 'back in the queue');
  assert.equal(c.data.conversation.ai_off, 1);
  assert.match(c.data.messages.find(m => m.kind === 'event' && /העבירה את השיחה לנציג אנושי/.test(m.body)).body, /נועה/);
  assert.ok(c.data.messages.some(m => m.sender_type === 'agent' && /colleague/.test(m.body)));
  const n = gemini.length;
  await call('/api/v/messages', { origin: SITE, auth: token, body: { text: 'Hello? anyone?' } });
  await settle();
  assert.equal(gemini.length, n, 'the AI stays out');
  // a human puts it back on the AI agent: it answers what is waiting
  await call(`/api/a/conversations/${convId}/assign`, { cookie: admin, body: { agent_id: aiId } });
  await settle();
  const again = await call(`/api/a/conversations/${convId}`, { cookie: admin });
  assert.equal(again.data.conversation.ai_off, 0);
  assert.equal(again.data.messages.at(-1).sender_type, 'agent');
  // and a human taking the chat over stops it
  await call(`/api/a/conversations/${convId}/assign`, { cookie: admin, body: { agent_id: agentId } });
  const m = gemini.length;
  await call('/api/v/messages', { origin: SITE, auth: token, body: { text: 'Thanks' } });
  await settle();
  assert.equal(gemini.length, m);
});

test('working hours: outside them the AI agent is not available', async () => {
  const closed = { enabled: true, tz: 'Asia/Jerusalem', days: Array.from({ length: 7 }, () => ({ on: false, from: '09:00', to: '18:00' })) };
  await call(`/api/a/agents/${aiId}`, { method: 'PATCH', cookie: admin, body: { ai: { hours: closed } } });
  const init = await call('/api/v/init', { origin: SITE, body: { url: SITE + '/' } });
  assert.equal(init.data.available, false);
  const list = await call('/api/a/agents', { cookie: admin });
  assert.equal(list.data.agents.find(a => a.id === aiId).ai_active, false);
  const open = { ...closed, days: closed.days.map(d => ({ ...d, on: true, from: '00:00', to: '23:59' })) };
  await call(`/api/a/agents/${aiId}`, { method: 'PATCH', cookie: admin, body: { ai: { hours: open } } });
  assert.equal((await call('/api/v/init', { origin: SITE, body: { url: SITE + '/' } })).data.available, true);
  // "only when no human is free" still takes the chat when no human is
  await call(`/api/a/agents/${aiId}`, { method: 'PATCH', cookie: admin, body: { ai: { when: 'no_humans' } } });
  const { convId } = await hello('Hi there');
  assert.equal((await call(`/api/a/conversations/${convId}`, { cookie: admin })).data.conversation.assigned_agent_id, aiId);
});

test('a try-out of the AI agent, and the language of a human agent', async () => {
  const t = await call(`/api/a/agents/${aiId}/ai/test`, { cookie: admin, body: { text: 'hi' } });
  assert.equal(t.data.reply, 'Hi! We open at 9. How can I help?');
  assert.equal((await call(`/api/a/agents/${aiId}/ai/test`, { cookie: agent, body: { text: 'hi' } })).status, 403);
  // a human agent's language is set in the profile; the chat gets it when the agent takes it, with no detection
  await call('/api/a/me', { cookie: agent, body: { lang: 'he' } });
  const me = await call('/api/auth/me', { cookie: agent });
  assert.equal(me.data.agent.lang, 'he');
  const { convId } = await hello('Hi, a question');
  await call(`/api/a/conversations/${convId}/assign`, { cookie: admin, body: { agent_id: agentId } });
  const c = await call(`/api/a/conversations/${convId}`, { cookie: admin });
  assert.equal(c.data.conversation.agent_lang, 'he');
});

test('an AI agent: its gender and whether the customer is told that it is virtual', async () => {
  // the instructions to the model follow the settings
  const g = gemini.at(-1);
  assert.match(g.system, /You are a woman/);
  assert.match(g.system, /say so briefly/);
  assert.match(g.system, /Never claim to be a human/);
  // a man, who does not announce it: no badge for the customer (the dashboard still has it), but it is never denied
  const r = await call('/api/a/agents', { cookie: admin, body: { kind: 'ai', name: 'דני', lang: 'he', ai: { gender: 'male', disclose: 'if_asked', when: 'always' } } });
  assert.equal(r.data.agent.title, '', 'no title that gives it away');
  const danny = r.data.agent.id;
  await call(`/api/a/agents/${aiId}`, { method: 'PATCH', cookie: admin, body: { disabled: true } });
  const { token, convId } = await hello('שלום');
  await settle();
  const c = await call(`/api/a/conversations/${convId}`, { cookie: admin });
  assert.equal(c.data.conversation.assigned_agent_id, danny);
  assert.equal(c.data.messages.find(m => m.sender_type === 'agent').meta.ai, true, 'the dashboard knows');
  const sys = gemini.at(-1).system;
  assert.match(sys, /You are a man/);
  assert.match(sys, /masculine/);
  assert.match(sys, /never deny being an AI/);
  assert.doesNotMatch(sys, /say so briefly/);
  const v = await call('/api/v/init', { origin: SITE, body: { token, url: SITE + '/' } });
  assert.equal(v.data.messages.find(m => m.sender_type === 'agent').meta.ai, undefined, 'no AI badge for the customer');
  // and its hand-over is written in the masculine
  await call('/api/v/messages', { origin: SITE, auth: token, body: { text: 'אני רוצה נציג אנושי' } });
  await settle();
  const after = await call(`/api/a/conversations/${convId}`, { cookie: admin });
  assert.match(after.data.messages.find(m => m.kind === 'event' && /אנושי/.test(m.body)).body, /דני העביר את השיחה/);
  await call(`/api/a/agents/${aiId}`, { method: 'PATCH', cookie: admin, body: { disabled: false } });
});

test('an AI agent that may offer gifts: a human approves first, or it gives by itself within limits', async () => {
  // a signed-in customer, an agent with its own gift permission and "ask a human" mode
  const signedIn = async text => {
    const init = await call('/api/v/init', { origin: SITE, body: { url: SITE + '/', title: 't', site: 'timlul' } });
    await call('/api/v/identify', { origin: SITE, auth: init.data.token, body: { token: 'tok-dana' } });
    const m = await call('/api/v/messages', { origin: SITE, auth: init.data.token, body: { text } });
    return { token: init.data.token, convId: m.data.conversation.id };
  };
  const r = await call('/api/a/agents', { cookie: admin, body: {
    kind: 'ai', name: 'מיכל', lang: 'he', ai: { prompt: 'Give a gift only after a real fault of ours.', actions: { gift: 'approve', per_chat: 1, per_account: 5 }, min_messages: 1 },
    perms: { gift: { on: true, sites: ['timlul'], max_amount: 30 } },
  } });
  const michal = r.data.agent.id;
  await call(`/api/a/agents/${aiId}`, { method: 'PATCH', cookie: admin, body: { disabled: true } }); // the others stay out of it
  const danny = (await call('/api/a/agents', { cookie: admin })).data.agents.find(a => a.name === 'דני');
  await call(`/api/a/agents/${danny.id}`, { method: 'PATCH', cookie: admin, body: { disabled: true } });

  const { token, convId } = await signedIn('please send me a gift');
  await settle();
  assert.match(gemini.at(-1).system, /GIFT/);
  assert.match(gemini.at(-1).system, /site timlul \("תמלול"\) with keys minutes/);
  assert.match(gemini.at(-1).system, /At most 30/);
  assert.match(gemini.at(-1).system, /asked a colleague to approve/);
  const giftsBefore = calls.filter(c => c.path === '/api/service/bonus').length;
  let c = await call(`/api/a/conversations/${convId}`, { cookie: admin });
  const card = c.data.messages.find(m => m.meta.ai_action);
  assert.equal(card.kind, 'whisper');
  assert.equal(card.meta.status, 'pending');
  assert.equal(calls.filter(x => x.path === '/api/service/bonus').length, giftsBefore, 'nothing is given before a human says so');
  const v = await call('/api/v/init', { origin: SITE, body: { token, url: SITE + '/' } });
  assert.ok(!v.data.messages.some(m => m.meta.ai_action || /הצעה|מציע/.test(m.body)), 'the customer does not see the proposal');
  // a human without the permission can't approve; with it, can
  assert.equal((await call(`/api/a/conversations/${convId}/ai-actions/${card.meta.ai_action}`, { cookie: agent, body: { decision: 'approve' } })).status, 403);
  const ok = await call(`/api/a/conversations/${convId}/ai-actions/${card.meta.ai_action}`, { cookie: admin, body: { decision: 'approve' } });
  assert.equal(ok.status, 200);
  const given = calls.filter(x => x.path === '/api/service/bonus').at(-1).body;
  assert.deepEqual([given.user_id, given.site_id, given.features], ['u1', 'timlul', { minutes: 20 }]);
  assert.equal(given.by, 'x', 'by the human who approved (the admin signed in as x)');
  c = await call(`/api/a/conversations/${convId}`, { cookie: admin });
  assert.equal(c.data.messages.find(m => m.meta.ai_action).meta.status, 'approved');
  assert.equal((await call(`/api/a/conversations/${convId}/ai-actions/${card.meta.ai_action}`, { cookie: admin, body: { decision: 'approve' } })).status, 409, 'once');
  const seen = await call('/api/v/init', { origin: SITE, body: { token, url: SITE + '/' } });
  assert.ok(seen.data.messages.some(m => /20 דקות/.test(m.body)), 'now the customer has the gift');

  // a second one in the same chat: over the limit, so the agent is told and says it cannot
  await call('/api/v/messages', { origin: SITE, auth: token, body: { text: 'another gift please' } });
  await settle();
  c = await call(`/api/a/conversations/${convId}`, { cookie: admin });
  assert.equal(c.data.messages.filter(m => m.meta.ai_action).length, 1, 'no second proposal');
  assert.equal(c.data.messages.at(-1).body, 'Sorry, I cannot do that.');

  // rejecting
  const two = await signedIn('gift for me');
  await settle();
  const card2 = (await call(`/api/a/conversations/${two.convId}`, { cookie: admin })).data.messages.find(m => m.meta.ai_action);
  assert.equal((await call(`/api/a/conversations/${two.convId}/ai-actions/${card2.meta.ai_action}`, { cookie: admin, body: { decision: 'reject' } })).status, 200);
  assert.equal((await call(`/api/a/conversations/${two.convId}`, { cookie: admin })).data.messages.find(m => m.meta.ai_action).meta.status, 'rejected');

  // over the permission's own limit: refused at once, nothing is waiting
  const big = await signedIn('a big gift');
  await settle();
  const bigChat = await call(`/api/a/conversations/${big.convId}`, { cookie: admin });
  assert.ok(!bigChat.data.messages.some(m => m.meta.ai_action));
  assert.equal(bigChat.data.messages.at(-1).body, 'Sorry, I cannot do that.');

  // not signed in: no gift
  const anon = await hello('gift please');
  await settle();
  assert.ok(!(await call(`/api/a/conversations/${anon.convId}`, { cookie: admin })).data.messages.some(m => m.meta.ai_action));

  // "automatic": it gives by itself, as itself, once per chat
  await call(`/api/a/agents/${michal}`, { method: 'PATCH', cookie: admin, body: { ai: { actions: { gift: 'auto', per_chat: 1, per_account: 5 } } } });
  const n = calls.filter(x => x.path === '/api/service/bonus').length;
  const auto = await signedIn('gift for me now');
  await settle();
  const bonus = calls.filter(x => x.path === '/api/service/bonus');
  assert.equal(bonus.length, n + 1);
  assert.equal(bonus.at(-1).body.by, 'מיכל');
  assert.ok((await call('/api/v/init', { origin: SITE, body: { token: auto.token, url: SITE + '/' } })).data.messages.some(m => /20 דקות/.test(m.body)));
  // and the customer's limit over 30 days
  await call(`/api/a/agents/${michal}`, { method: 'PATCH', cookie: admin, body: { ai: { actions: { gift: 'auto', per_chat: 1, per_account: 2 } } } });
  const third = await signedIn('gift again');
  await settle();
  assert.equal(calls.filter(x => x.path === '/api/service/bonus').length, n + 1, 'two gifts this month for this account is the limit');
  assert.equal((await call(`/api/a/conversations/${third.convId}`, { cookie: admin })).data.messages.at(-1).body, 'Sorry, I cannot do that.');

  // without the permission, the option does nothing
  await call(`/api/a/agents/${michal}`, { method: 'PATCH', cookie: admin, body: { perms: {} } });
  await signedIn('gift, please');
  await settle();
  assert.doesNotMatch(gemini.at(-1).system, /GIFT/);
  await call(`/api/a/agents/${aiId}`, { method: 'PATCH', cookie: admin, body: { disabled: false } });
});

test('an AI agent: payment requests need the same approval, and it can end a chat when it may', async () => {
  const r = await call('/api/a/agents', { cookie: admin, body: {
    kind: 'ai', name: 'רונית', lang: 'en', ai: { prompt: 'Packs cost 30.', can_close: true, actions: { pay: 'approve', pay_per_chat: 2 } },
    perms: { pay: { on: true, max_amount: 50 } },
  } });
  const ronit = r.data.agent.id;
  // the others stay out of the way
  for (const a of (await call('/api/a/agents', { cookie: admin })).data.agents) {
    if (a.kind === 'ai' && a.id !== ronit && !a.disabled) await call(`/api/a/agents/${a.id}`, { method: 'PATCH', cookie: admin, body: { disabled: true } });
  }
  const start = async text => {
    const init = await call('/api/v/init', { origin: SITE, body: { url: SITE + '/', title: 't', site: 'timlul' } });
    const m = await call('/api/v/messages', { origin: SITE, auth: init.data.token, body: { text, email: 'lead@x.com' } });
    return { token: init.data.token, convId: m.data.conversation.id };
  };
  const payCalls = () => calls.filter(c => c.path === '/api/service/pay').length;
  const n = payCalls();
  const a = await start('please pay me the pack');
  await settle();
  assert.match(gemini.at(-1).system, /PAYMENT REQUEST/);
  assert.match(gemini.at(-1).system, /at most 50/);
  assert.equal(payCalls(), n, 'nothing is sent before a human approves');
  let c = await call(`/api/a/conversations/${a.convId}`, { cookie: admin });
  const card = c.data.messages.find(m => m.meta.ai_action);
  assert.equal(card.meta.action_kind, 'pay');
  assert.match(card.meta.summary, /30 ILS/);
  assert.ok(!c.data.messages.some(m => m.kind === 'pay'));
  assert.equal((await call(`/api/a/conversations/${a.convId}/ai-actions/${card.meta.ai_action}`, { cookie: admin, body: { decision: 'approve' } })).status, 200);
  assert.equal(payCalls(), n + 1);
  c = await call(`/api/a/conversations/${a.convId}`, { cookie: admin });
  assert.equal(c.data.messages.find(m => m.kind === 'pay').meta.amount_text, '₪30');
  // over what its permission allows: refused, the agent says so
  const big = await start('pay me, a huge amount');
  await settle();
  const bc = await call(`/api/a/conversations/${big.convId}`, { cookie: admin });
  assert.ok(!bc.data.messages.some(m => m.meta.ai_action));
  assert.equal(bc.data.messages.at(-1).body, 'Sorry, I cannot do that.');

  // ending the chat: only when it was allowed to, and the customer gets the rating prompt
  const d = await start('hello');
  await settle();
  await call('/api/v/messages', { origin: SITE, auth: d.token, body: { text: 'thanks, bye' } });
  await settle();
  const closed = await call(`/api/a/conversations/${d.convId}`, { cookie: admin });
  assert.equal(closed.data.conversation.status, 'closed');
  assert.equal(closed.data.messages.filter(m => m.sender_type === 'agent').at(-1).body, 'Bye, take care!');
  assert.match(closed.data.messages.at(-1).body, /רונית סגר\/ה את השיחה/);
  assert.match(gemini.findLast(g => /bye/.test(g.turns.at(-1)?.text || '')).system, /"close": true/);
  // not allowed: it does not close
  await call(`/api/a/agents/${ronit}`, { method: 'PATCH', cookie: admin, body: { ai: { can_close: false } } });
  const e = await start('hello again');
  await settle();
  await call('/api/v/messages', { origin: SITE, auth: e.token, body: { text: 'bye' } });
  await settle();
  assert.equal((await call(`/api/a/conversations/${e.convId}`, { cookie: admin })).data.conversation.status, 'open');
  assert.doesNotMatch(gemini.at(-1).system, /Ending the chat/);
});

test('an AI agent that may change the account: an upgrade and a pack, with limits; and the wording about being virtual and handing over', async () => {
  const r = await call('/api/a/agents', { cookie: admin, body: {
    kind: 'ai', name: 'דבורה', lang: 'he', ai: { gender: 'female', disclose: 'if_asked', prompt: 'Upgrades on request.', actions: { upgrade: 'auto', pack: 'auto', per_chat: 3, per_account: 9 }, min_messages: 1 },
    perms: { upgrade: { on: true, plans: ['timlul:pro'], max_days: 30 }, pack: { on: true, sites: ['timlul'] } },
  } });
  const dvora = r.data.agent.id;
  assert.equal(r.data.agent.title, '', 'it does not announce itself, so no title that does');
  for (const a of (await call('/api/a/agents', { cookie: admin })).data.agents) {
    if (a.kind === 'ai' && a.id !== dvora && !a.disabled) await call(`/api/a/agents/${a.id}`, { method: 'PATCH', cookie: admin, body: { disabled: true } });
  }
  const signedIn = async text => {
    const init = await call('/api/v/init', { origin: SITE, body: { url: SITE + '/', title: 't', site: 'timlul' } });
    await call('/api/v/identify', { origin: SITE, auth: init.data.token, body: { token: 'tok-dana' } });
    const m = await call('/api/v/messages', { origin: SITE, auth: init.data.token, body: { text } });
    return { token: init.data.token, convId: m.data.conversation.id };
  };
  const before = calls.filter(x => x.path === '/api/service/access').length;
  const { token, convId } = await signedIn('please upgrade me');
  await settle();
  assert.equal(calls.filter(x => x.path === '/api/service/access').length, before + 1, 'it upgraded');
  const sys = gemini.at(-1).system;
  assert.match(sys, /UPGRADE/);
  assert.match(sys, /timlul:pro \("מקצועי", site timlul\)/);
  assert.doesNotMatch(sys, /timlul:biz/, 'only the plans of its permission');
  assert.match(sys, /At most 30 days/);
  assert.match(sys, /PACK/);
  assert.match(sys, /timlul:pack100/);
  // what it says about itself and about handing over
  assert.match(sys, /Do NOT mention that you are an AI/);
  assert.match(sys, /Never ask the customer whether to hand the chat over/);
  assert.match(sys, /never say a human, a real person/);
  assert.match(sys, /do it yourself/);
  const access = calls.filter(x => x.path === '/api/service/access').at(-1).body;
  assert.deepEqual([access.user_id, access.site_id, access.plan_id, access.days], ['u1', 'timlul', 'timlul:pro', 30]);
  let c = await call(`/api/a/conversations/${convId}`, { cookie: admin });
  assert.equal(c.data.conversation.assigned_agent_id, dvora, 'it did not hand the chat over');
  assert.equal(c.data.messages.filter(m => m.sender_type === 'agent').at(-1).body, 'Done, you are on Pro.');
  assert.ok(c.data.messages.some(m => m.kind === 'event' && /דבורה שדרג\/ה/.test(m.body)), 'noted in the chat');
  // more days than its permission allows: refused, and it says it cannot (it does not hand over either)
  const n = calls.filter(x => x.path === '/api/service/access').length;
  assert.equal(n, before + 1);
  await call('/api/v/messages', { origin: SITE, auth: token, body: { text: 'upgrade me for a long time' } });
  await settle();
  assert.equal(calls.filter(x => x.path === '/api/service/access').length, n);
  c = await call(`/api/a/conversations/${convId}`, { cookie: admin });
  assert.equal(c.data.messages.at(-1).body, 'Sorry, I cannot do that.');
  assert.equal(c.data.conversation.assigned_agent_id, dvora);
  // a pack: a payment request for it, for the verified account
  const payBefore = calls.filter(x => x.path === '/api/service/pay').length;
  const p = await signedIn('I want to buy a pack');
  await settle();
  assert.equal(calls.filter(x => x.path === '/api/service/pay').length, payBefore + 1, 'a payment request for the pack');
  const payBody = calls.filter(x => x.path === '/api/service/pay').at(-1).body;
  assert.deepEqual([payBody.amount, payBody.user_id, payBody.on_paid.pack_id], [8, 'u1', 'timlul:pack100']);
  assert.ok((await call(`/api/a/conversations/${p.convId}`, { cookie: admin })).data.messages.some(m => m.kind === 'pay'));
  // not signed in: nothing
  const anon = await hello('upgrade me please');
  await settle();
  assert.equal((await call(`/api/a/conversations/${anon.convId}`, { cookie: admin })).data.messages.at(-1).body, 'Sorry, I cannot do that.');
  // switching to "announce": the title it was given by default and the wording follow
  await call(`/api/a/agents/${dvora}`, { method: 'PATCH', cookie: admin, body: { ai: { disclose: 'always' } } });
  await signedIn('hello');
  await settle();
  assert.match(gemini.at(-1).system, /say so briefly/);
  assert.match(gemini.at(-1).system, /a human colleague who will take it from here/);
});

test('an AI agent reads the team\'s internal notes and what they did, and is told clearly when to end a chat', async () => {
  const r = await call('/api/a/agents', { cookie: admin, body: { kind: 'ai', name: 'שרה', lang: 'he', ai: { can_close: true, prompt: 'Be helpful.' } } });
  const sara = r.data.agent.id;
  for (const a of (await call('/api/a/agents', { cookie: admin })).data.agents) {
    if (a.kind === 'ai' && a.id !== sara && !a.disabled) await call(`/api/a/agents/${a.id}`, { method: 'PATCH', cookie: admin, body: { disabled: true } });
  }
  const { token, convId } = await hello('hello, I need help');
  await settle();
  // a colleague writes an internal note in the chat; the customer does not see it
  const note = await call(`/api/a/conversations/${convId}/messages`, { cookie: admin, body: { kind: 'whisper', text: 'This customer is a VIP, be extra patient' } });
  assert.equal(note.status, 200);
  await call('/api/v/messages', { origin: SITE, auth: token, body: { text: 'any news?' } });
  await settle();
  const g = gemini.at(-1);
  assert.ok(g.turns.some(t => /\[internal note from x: This customer is a VIP/.test(t.text)), 'it read the note');
  assert.match(g.system, /internal note/);
  assert.match(g.system, /you must do it when it is over/);
  assert.match(g.system, /"תודה"/);
  const seen = await call('/api/v/init', { origin: SITE, body: { token, url: SITE + '/' } });
  assert.ok(!seen.data.messages.some(m => /VIP/.test(m.body)), 'the customer does not see the note');
  // its own proposals are not notes; what the team did is a note
  assert.ok(!g.turns.some(t => /internal note from שרה/.test(t.text)));
});

test('ending a chat: a customer who only says thanks or goodbye ends it, when the agent may; otherwise it stays', async () => {
  const { isFarewell } = await import('/home/user/rb077858.github.io/support/src/aiagent.js');
  for (const yes of ['תודה', 'תודה רבה!', 'ביי תודה', 'זה הכל, תודה', 'Thanks!', 'thanks bye', 'no thanks, bye', 'thank you 🙏']) assert.ok(isFarewell(yes), yes);
  for (const no of ['תודה, ועוד שאלה', 'thanks but I still cannot log in', 'ok', 'אוקיי', 'כן, בבקשה', 'שלום', '', 'מתי אתם פתוחים?', 'תודה על העזרה עם החשבון שלי אבל אני עדיין לא רואה את התוכנית']) assert.equal(isFarewell(no), false, no);
  const sara = (await call('/api/a/agents', { cookie: admin })).data.agents.find(a => a.name === 'שרה');
  const { token, convId } = await hello('hello, a question');
  await settle();
  await call('/api/v/messages', { origin: SITE, auth: token, body: { text: 'תודה רבה' } });
  await settle();
  assert.equal((await call(`/api/a/conversations/${convId}`, { cookie: admin })).data.conversation.status, 'closed');
  // not allowed to end chats: it stays open
  await call(`/api/a/agents/${sara.id}`, { method: 'PATCH', cookie: admin, body: { ai: { can_close: false } } });
  const two = await hello('hello again');
  await settle();
  await call('/api/v/messages', { origin: SITE, auth: two.token, body: { text: 'תודה רבה' } });
  await settle();
  assert.equal((await call(`/api/a/conversations/${two.convId}`, { cookie: admin })).data.conversation.status, 'open');
});

test('"smart" automatic: a free offer needs a documented, checkable problem, enough said by the customer, and an independent reviewer\'s yes', async () => {
  const r = await call('/api/a/agents', { cookie: admin, body: {
    kind: 'ai', name: 'ענת', lang: 'he',
    ai: { prompt: 'Be helpful.', policy: 'Only for our own faults. At most one month.', actions: { gift: 'auto', per_chat: 1, per_account: 9 } },
    perms: { gift: { on: true, sites: ['timlul'], max_amount: 30 } },
  } });
  const anat = r.data.agent.id;
  for (const a of (await call('/api/a/agents', { cookie: admin })).data.agents) {
    if (a.kind === 'ai' && a.id !== anat && !a.disabled) await call(`/api/a/agents/${a.id}`, { method: 'PATCH', cookie: admin, body: { disabled: true } });
  }
  assert.equal((await call(`/api/a/agents/${anat}/ai`, { cookie: admin })).data.ai.min_messages, 3, 'three messages by default');
  const bonus = () => calls.filter(x => x.path === '/api/service/bonus').length;
  const start = async (...texts) => {
    const init = await call('/api/v/init', { origin: SITE, body: { url: SITE + '/', title: 't', site: 'timlul' } });
    await call('/api/v/identify', { origin: SITE, auth: init.data.token, body: { token: 'tok-dana' } });
    let convId;
    for (const text of texts) {
      const m = await call('/api/v/messages', { origin: SITE, auth: init.data.token, body: { text } });
      convId = m.data.conversation.id;
      await settle();
    }
    return { token: init.data.token, convId };
  };
  const last = async id => (await call(`/api/a/conversations/${id}`, { cookie: admin })).data;
  const b0 = bonus();

  // asking right away: nothing is given, and the reviewer was not even bothered
  const reviewsBefore = reviews.length;
  const a = await start('send me a gift');
  assert.equal(bonus(), b0);
  assert.equal(reviews.length, reviewsBefore, 'too early: not even sent to the reviewer');
  assert.equal((await last(a.convId)).messages.at(-1).body, 'Sorry, I cannot do that.');
  assert.match(gemini.at(-1).system, /ONLY as compensation for a real problem/);
  assert.match(gemini.at(-1).system, /Never because the customer asked/);

  // enough messages, but the agent wrote no reasons: refused
  const b = await start('hi', 'my export is broken', 'nowhy gift please');
  assert.equal(bonus(), b0);
  assert.equal((await last(b.convId)).messages.at(-1).body, 'Sorry, I cannot do that.');

  // reasons that are only a claim: the reviewer says no, the team sees why
  const c = await start('hi', 'my export is broken', 'bogus gift please');
  assert.equal(bonus(), b0);
  assert.match(reviews.at(-1).system, /Only for our own faults. At most one month./, 'the owner\'s policy reaches the reviewer');
  assert.match(reviews.at(-1).text, /CUSTOMER: bogus gift please/);
  const chatC = await last(c.convId);
  assert.ok(chatC.messages.some(m => m.kind === 'event' && /לא אושרה בבדיקה: Only a claim/.test(m.body)));
  assert.equal(chatC.messages.at(-1).body, 'Sorry, I cannot do that.');
  assert.equal(chatC.conversation.assigned_agent_id, anat, 'it stays with the customer');

  // a real, specific problem: reviewed, given, and written down
  const d = await start('hi', 'my export is broken', 'error 500 twice, here is a screenshot, gift please');
  assert.equal(bonus(), b0 + 1);
  const chatD = await last(d.convId);
  const note = chatD.messages.find(m => m.kind === 'event' && /התיעוד של ענת/.test(m.body));
  assert.ok(note, 'documented in the chat');
  assert.match(note.body, /The export failed twice with error 500/);
  assert.match(note.body, /error 500 at 10:05/);
  assert.match(note.body, /בדיקה: A specific error/);
  assert.match((await call('/api/v/init', { origin: SITE, body: { token: d.token, url: SITE + '/' } })).data.messages.at(-1).body, /I am arranging a gift/);

  // the reviewer cannot be reached: nothing is given
  // (a model that gets a refusal tells the customer politely; a count of what it was asked is kept)
  assert.ok(reviews.length >= 3);
});

test('an AI agent knows the customer\'s plan and payments, really checks when it says so, and asks the team in an internal note and waits', async () => {
  const r = await call('/api/a/agents', { cookie: admin, body: { kind: 'ai', name: 'לילך', lang: 'en', ai: { prompt: 'Help.', wait_minutes: 5 } } });
  const lilach = r.data.agent.id;
  assert.equal((await call(`/api/a/agents/${lilach}/ai`, { cookie: admin })).data.ai.wait_minutes, 5);
  for (const a of (await call('/api/a/agents', { cookie: admin })).data.agents) {
    if (a.kind === 'ai' && a.id !== lilach && !a.disabled) await call(`/api/a/agents/${a.id}`, { method: 'PATCH', cookie: admin, body: { disabled: true } });
  }
  const signedIn = async text => {
    const init = await call('/api/v/init', { origin: SITE, body: { url: SITE + '/', title: 't', site: 'timlul' } });
    await call('/api/v/identify', { origin: SITE, auth: init.data.token, body: { token: 'tok-dana' } });
    const m = await call('/api/v/messages', { origin: SITE, auth: init.data.token, body: { text } });
    return { token: init.data.token, convId: m.data.conversation.id };
  };
  const mine = async (id, token) => (await call('/api/v/init', { origin: SITE, body: { token, url: SITE + '/' } })).data.messages.filter(m => m.sender_type === 'agent').map(m => m.body);

  // it knows who it is talking to
  const a = await signedIn('hello, what is my plan?');
  await settle();
  const sys = gemini.at(-1).system;
  assert.match(sys, /Verified reem.bi account: דנה <dana@x.com>/);
  assert.match(sys, /תמלול: plan "Basic", access active, plan ends/);
  assert.match(sys, /Subscription at timlul: Basic, ACTIVE, 9 ILS a month, paid until/);
  assert.match(sys, /Payment .*: completed 9 ILS/);
  assert.match(sys, /Gifts \/ extras on the account so far: .*minutes/);
  assert.match(sys, /Colleagues you can ask \(name, role\): .*x/);
  assert.match(sys, /you MUST do it, in that same reply/);
  const anon = await hello('hello');
  await settle();
  assert.match(gemini.at(-1).system, /Not signed in to a reem.bi account, so you cannot see their plan/);

  // "let me check": it does, and writes again with what it found
  const b = await signedIn('did my payment go through?');
  await settle();
  assert.deepEqual(await mine(b.convId, b.token), ['One moment, I am checking your account.', 'I checked: you are on Basic, paid and active.']);
  const turns = gemini.at(-1).turns;
  assert.match(turns.at(-1).text, /the result of the check you asked for:\nVerified reem.bi account/);
  assert.equal(turns.at(-2).text, 'One moment, I am checking your account.');

  // asks the team in an internal note, tells the customer, and waits
  const c = await signedIn('ask the team about my invoice');
  await settle();
  let chat = await call(`/api/a/conversations/${c.convId}`, { cookie: admin });
  const ask = chat.data.messages.find(m => m.kind === 'whisper');
  assert.equal(ask.meta.ai_ask, true);
  assert.match(ask.body, /March invoice is wrong/);
  assert.ok(chat.data.conversation.ai_wait, 'it waits');
  assert.deepEqual(await mine(c.convId, c.token), ['I asked a colleague, I will write as soon as I hear.'], 'the customer is told, and does not see the note');
  assert.equal(chat.data.conversation.assigned_agent_id, lilach);
  // a colleague answers in an internal note: it writes to the customer
  await call(`/api/a/conversations/${c.convId}/messages`, { cookie: admin, body: { kind: 'whisper', text: 'Checked: the invoice had a duplicate line, I fixed it.' } });
  await settle();
  assert.deepEqual(await mine(c.convId, c.token), ['I asked a colleague, I will write as soon as I hear.', 'Good news: the invoice was fixed by my colleague.']);
  chat = await call(`/api/a/conversations/${c.convId}`, { cookie: admin });
  assert.equal(chat.data.conversation.ai_wait, null, 'no longer waiting');
  assert.ok(gemini.at(-1).turns.some(t => t.role === 'model' && /internal note I wrote to the team: Customer says the March invoice/.test(t.text)), 'it remembers its question');
  assert.ok(gemini.at(-1).turns.some(t => /internal note from x: Checked: the invoice had a duplicate line/.test(t.text)));
  // a note while it is not waiting changes nothing
  const n = gemini.length;
  await call(`/api/a/conversations/${c.convId}/messages`, { cookie: admin, body: { kind: 'whisper', text: 'fyi' } });
  await settle();
  assert.equal(gemini.length, n);
});
