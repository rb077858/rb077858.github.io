// Server-to-server API for chat.reembir.com (the support chat): support agents send payment
// requests from inside a conversation and upgrade customers' plans. Authenticated with a shared
// secret (CHAT_SERVICE_KEY here, SSO_SERVICE_KEY in the chat worker) — the chat checks each
// agent's own permissions before calling.
import { HttpError, json, readJson, sha256 } from './lib.js';
import { createPayRequest, getRequest, adminView, applyPlan, effectiveStatus, ensurePaySchema } from './pay.js';

async function requireService(request, env) {
  const key = request.headers.get('x-service-key') || '';
  if (!env.CHAT_SERVICE_KEY || !key || (await sha256(key)) !== (await sha256(env.CHAT_SERVICE_KEY))) {
    throw new HttpError(401, 'bad_service_key', 'מפתח השירות שגוי — בדקו ש-CHAT_SERVICE_KEY זהה ל-SSO_SERVICE_KEY של הצ׳אט');
  }
}

const parse = v => { try { return JSON.parse(v); } catch { return {}; } };

export async function catalog(request, env) {
  await requireService(request, env);
  const [sites, plans] = await env.DB.batch([
    env.DB.prepare("SELECT id, name, url FROM sites WHERE id != 'pay' ORDER BY created_at"),
    env.DB.prepare('SELECT id, site_id, name, features FROM plans ORDER BY site_id, sort, name'),
  ]);
  return json({
    sites: sites.results,
    plans: plans.results.map(p => ({ ...p, features: parse(p.features) })),
  });
}

export async function users(request, env) {
  await requireService(request, env);
  const url = new URL(request.url);
  const q = (url.searchParams.get('q') || '').trim().toLowerCase();
  const exact = (url.searchParams.get('email') || '').trim().toLowerCase();
  const stmt = exact
    ? env.DB.prepare('SELECT id, email, name, email_verified, disabled FROM users WHERE email = ? LIMIT 1').bind(exact)
    : env.DB.prepare(
      `SELECT id, email, name, email_verified, disabled FROM users
       WHERE lower(email) LIKE ?1 OR lower(name) LIKE ?1 ORDER BY last_login_at DESC LIMIT 20`,
    ).bind(`%${q}%`);
  const { results } = await stmt.all();
  const out = [];
  for (const u of results) {
    const { results: access } = await env.DB.prepare(
      `SELECT a.site_id, a.status, a.plan_id, a.plan_expires_at, s.name AS site_name, p.name AS plan_name
       FROM access a JOIN sites s ON s.id = a.site_id LEFT JOIN plans p ON p.id = a.plan_id
       WHERE a.user_id = ? AND a.site_id != 'pay'`,
    ).bind(u.id).all();
    out.push({ ...u, email_verified: !!u.email_verified, disabled: !!u.disabled, access });
  }
  return json({ users: out });
}

export async function setAccess(request, env, h) {
  await requireService(request, env);
  const body = await readJson(request);
  return json({ result: await applyPlan(env, h, body) });
}

export async function createPay(request, env, h) {
  await requireService(request, env);
  const body = await readJson(request);
  const createdBy = String(body.created_by || '').trim().toLowerCase().slice(0, 254);
  if (!createdBy.includes('@')) throw new HttpError(400, 'bad_creator', 'חסר מייל של הנציג');
  return json(await createPayRequest(env, h, body, {
    createdBy, source: 'chat', sourceRef: String(body.source_ref || '').slice(0, 100) || null, onPaid: body.on_paid || null,
  }));
}

export async function getPay(request, env, h, id) {
  await requireService(request, env);
  return json({ request: adminView(env, await getRequest(env, id)) });
}

export async function cancelPay(request, env, h, id) {
  await requireService(request, env);
  await ensurePaySchema(env);
  const r = await getRequest(env, id);
  if (effectiveStatus(r) === 'paid') throw new HttpError(400, 'paid', 'הבקשה כבר שולמה');
  await env.DB.prepare("UPDATE pay_requests SET status = 'cancelled' WHERE id = ? AND status != 'paid'").bind(id).run();
  return json({ request: adminView(env, await getRequest(env, id)) });
}
