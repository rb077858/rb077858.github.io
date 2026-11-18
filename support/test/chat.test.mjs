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
    bindings: { ADMIN_EMAILS: 'boss@x.com', PUBLIC_URL: URL0, SSO_SERVICE_KEY: 'svc', GEMINI_API_KEY: 'gk', GEMINI_API_BASE: 'http://gemini.test' },
    serviceBindings: { ASSETS: () => new Response('asset'), SSO: sso },
    // Gemini: an AI agent's reply. It hands over when the customer asks for a human.
    outboundService: async req => {
      const body = await req.json();
      const turns = body.contents.map(c => ({ role: c.role, text: c.parts[0].text }));
      gemini.push({ system: body.systemInstruction.parts[0].text, turns });
      const last = turns.at(-1).text;
      if (/Answer with JSON only/.test(body.systemInstruction.parts[0].text)) {
        if (/\[system note/.test(last)) return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify({ reply: 'Sorry, I cannot do that.', handoff: false }) }] } }] });
        if (/gift/i.test(last)) {
          const gift = { site_id: 'timlul', features: { minutes: /big/.test(last) ? 500 : 20 }, note: 'compensation' };
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
    ai: { prompt: 'We open at 9. Refunds within 14 days.' }, perms: { pay: { on: true, max_amount: 50 } },
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
    kind: 'ai', name: 'מיכל', lang: 'he', ai: { prompt: 'Give a gift only after a real fault of ours.', actions: { gift: 'approve', per_chat: 1, per_account: 5 } },
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
