// Payment requests: the admin (or a support agent, through chat.reembir.com) creates a
// request (amount, currency, description, who pays), shares the link, and the payer signs
// in with their reem.bi account — the request's account, or any verified account with the
// request's email — and pays with PayPal. No sign-in, no payment: the pay token is short-lived
// and dies with the reem.bi sign-in it came from. The server creates and captures the PayPal
// order itself, so the amount can't be changed in the browser. A request can carry an
// automatic plan upgrade that is applied the moment it's paid.
import { HttpError, json, readJson, now, randomToken, normalizeEmail } from './lib.js';
import { sendNotice } from './mail.js';

export const CURRENCIES = { ILS: '₪', USD: '$', EUR: '€' };
// Fake PayPal for local development only — never active without DEV=1.
const isMock = env => env.PAYPAL_MOCK === '1' && env.DEV === '1';

export const payBase = env => (env.PAY_URL || 'https://pay.reembir.com').replace(/\/+$/, '');
const loginBase = env => (env.PUBLIC_URL || 'https://login.reembir.com').replace(/\/+$/, '');
const payLink = (env, id) => `${payBase(env)}/r/${id}`;

let schemaReady = false;
export async function ensurePaySchema(env) {
  if (schemaReady) return;
  const base = payBase(env);
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS pay_requests (
      id TEXT PRIMARY KEY, amount_cents INTEGER NOT NULL, currency TEXT NOT NULL, description TEXT NOT NULL,
      user_id TEXT, email TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open',
      created_by TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER,
      paid_at INTEGER, paypal_order_id TEXT, paypal_capture_id TEXT, paypal_payer_email TEXT,
      otp_hash TEXT, otp_expires INTEGER, otp_attempts INTEGER NOT NULL DEFAULT 0, emailed_at INTEGER)`),
    env.DB.prepare('CREATE TABLE IF NOT EXISTS pay_tokens (id TEXT PRIMARY KEY, request_id TEXT NOT NULL, expires_at INTEGER NOT NULL)'),
    // The payment page signs payers in through reem.bi like any other site.
    // It must stay "open": each request is still locked to its own payer.
    env.DB.prepare(
      `INSERT OR IGNORE INTO sites (id, name, description, url, redirect_uris, access_mode, default_plan, created_at)
       VALUES ('pay', 'תשלומים', 'תשלום מאובטח ל-reem.bi', ?, ?, 'open', NULL, ?)`,
    ).bind(base + '/', JSON.stringify([base + '/r/']), now()),
  ]);
  for (const col of ['source TEXT', 'source_ref TEXT', 'on_paid TEXT', 'on_paid_result TEXT']) {
    try {
      await env.DB.prepare(`ALTER TABLE pay_requests ADD COLUMN ${col}`).run();
    } catch (e) {
      if (!/duplicate column/i.test(String(e?.message || e))) throw e;
    }
  }
  schemaReady = true;
}

export function formatMoney(cents, currency) {
  try {
    // "₪1,250.00" / "$99.00" — symbol first reads the same in Hebrew and English.
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(cents / 100);
  } catch {
    return `${CURRENCIES[currency] || currency}${(cents / 100).toFixed(2)}`;
  }
}

const fmtDate = t => new Date(t * 1000).toLocaleDateString('he-IL', { timeZone: 'Asia/Jerusalem' });
const fmtDateTime = t => new Date(t * 1000).toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem', dateStyle: 'short', timeStyle: 'short' });

function maskEmail(email) {
  const [local, domain] = String(email).split('@');
  const keep = local.length <= 2 ? local.slice(0, 1) : local.slice(0, 2);
  return `${keep}***@${domain}`;
}

const parseJsonSafe = v => { try { return v ? JSON.parse(v) : null; } catch { return null; } };

export function effectiveStatus(r) {
  if (r.status === 'open' && r.expires_at && r.expires_at < now()) return 'expired';
  return r.status;
}

export async function getRequest(env, id) {
  await ensurePaySchema(env);
  const r = await env.DB.prepare('SELECT * FROM pay_requests WHERE id = ?').bind(String(id || '')).first();
  if (!r) throw new HttpError(404, 'not_found', 'בקשת התשלום לא נמצאה');
  return r;
}

export function adminView(env, r, userName) {
  return {
    id: r.id,
    link: payLink(env, r.id),
    amount_cents: r.amount_cents,
    currency: r.currency,
    amount_text: formatMoney(r.amount_cents, r.currency),
    description: r.description,
    user_id: r.user_id,
    user_name: userName || null,
    email: r.email,
    status: effectiveStatus(r),
    created_by: r.created_by,
    created_at: r.created_at,
    expires_at: r.expires_at,
    paid_at: r.paid_at,
    emailed_at: r.emailed_at,
    paypal_capture_id: r.paypal_capture_id,
    paypal_payer_email: r.paypal_payer_email,
    source: r.source || null,
    source_ref: r.source_ref || null,
    on_paid: parseJsonSafe(r.on_paid),
    on_paid_result: parseJsonSafe(r.on_paid_result),
  };
}

export async function emailRequest(env, r) {
  const money = formatMoney(r.amount_cents, r.currency);
  const rows = [['עבור', r.description], ['סכום', money]];
  if (r.expires_at) rows.push(['לתשלום עד', fmtDate(r.expires_at)]);
  await sendNotice(env, r.email, `בקשת תשלום: ${money} — ${r.description}`, {
    title: 'בקשת תשלום',
    intro: 'קיבלת בקשת תשלום מ-reem.bi. אפשר לשלם בקלות ובאופן מאובטח דרך PayPal — עם חשבון PayPal או בכרטיס אשראי.',
    rows,
    button: 'לתשלום',
    link: payLink(env, r.id),
    outro: r.user_id
      ? 'כדי לשלם תתבקשו להתחבר לחשבון reem.bi שלכם.'
      : 'כדי לשלם תתבקשו להתחבר לחשבון reem.bi עם כתובת המייל הזו (אין חשבון? אפשר לפתוח אחד בחינם תוך רגע).',
  });
  await env.DB.prepare('UPDATE pay_requests SET emailed_at = ? WHERE id = ?').bind(now(), r.id).run();
}

// ======================================================================
// Admin (dashboard)
// ======================================================================

export async function adminListPay(request, env, h) {
  await h.requireAdmin(request, env);
  await ensurePaySchema(env);
  const { results } = await env.DB.prepare(
    `SELECT p.*, u.name AS user_name FROM pay_requests p LEFT JOIN users u ON u.id = p.user_id
     ORDER BY p.created_at DESC LIMIT 300`,
  ).all();
  const list = results.map(r => adminView(env, r, r.user_name));
  const totals = {};
  for (const r of list) {
    if (r.status !== 'paid') continue;
    totals[r.currency] = (totals[r.currency] || 0) + r.amount_cents;
  }
  return json({
    requests: list,
    paid_totals: Object.entries(totals).map(([c, cents]) => formatMoney(cents, c)),
    open: list.filter(r => r.status === 'open').length,
    configured: !!(env.PAYPAL_CLIENT_ID && env.PAYPAL_CLIENT_SECRET) || isMock(env),
    paypal_env: env.PAYPAL_ENV === 'sandbox' ? 'sandbox' : 'live',
  });
}

export async function adminCreatePay(request, env, h) {
  const admin = await h.requireAdmin(request, env);
  const body = await readJson(request);
  return json(await createPayRequest(env, h, body, { createdBy: admin.email }));
}

/** Validates and stores a request. Shared by the admin dashboard and the chat service API. */
export async function createPayRequest(env, h, body, { createdBy, source = null, sourceRef = null, onPaid = null }) {
  await ensurePaySchema(env);
  const amount = Number(String(body.amount ?? '').replace(/[,\s₪$€]/g, ''));
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1000000) throw new HttpError(400, 'bad_amount', 'סכום לא תקין');
  const cents = Math.round(amount * 100);
  const currency = String(body.currency || 'ILS').toUpperCase();
  if (!CURRENCIES[currency]) throw new HttpError(400, 'bad_currency', 'מטבע לא נתמך');
  const description = String(body.description || '').replace(/\s+/g, ' ').trim().slice(0, 200);
  if (!description) throw new HttpError(400, 'no_description', 'כתבו עבור מה התשלום');

  let userId = null;
  let email;
  if (body.user_id) {
    const user = await h.getUserById(env, String(body.user_id));
    if (!user) throw new HttpError(404, 'not_found', 'המשתמש לא נמצא');
    userId = user.id;
    email = user.email;
  } else {
    email = normalizeEmail(body.email);
  }
  const expires = body.expires_at ? Number(body.expires_at) : null;
  if (expires && expires < now()) throw new HttpError(400, 'bad_expiry', 'תאריך התוקף כבר עבר');

  // Automatic upgrade once paid: always for the paying account itself.
  let onPaidJson = null;
  if (onPaid && onPaid.site_id) {
    if (!userId) throw new HttpError(400, 'upgrade_needs_user', 'שדרוג אוטומטי אפשרי רק כשהתשלום מחשבון reem.bi מסוים');
    const site = await h.getSite(env, String(onPaid.site_id));
    if (!site) throw new HttpError(404, 'not_found', 'האתר לא נמצא');
    const planId = onPaid.plan_id ? String(onPaid.plan_id) : null;
    const plan = planId ? await h.getPlan(env, planId) : null;
    if (planId && (!plan || plan.site_id !== site.id)) throw new HttpError(400, 'bad_plan', 'התוכנית לא שייכת לאתר הזה');
    const days = Math.max(0, Math.min(3650, Math.round(Number(onPaid.days) || 0)));
    onPaidJson = JSON.stringify({ user_id: userId, site_id: site.id, site_name: site.name, plan_id: planId, plan_name: plan ? plan.name : '', days });
  }

  const id = randomToken(9);
  await env.DB.prepare(
    `INSERT INTO pay_requests (id, amount_cents, currency, description, user_id, email, status, created_by, created_at, expires_at, source, source_ref, on_paid)
     VALUES (?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?, ?, ?)`,
  ).bind(id, cents, currency, description, userId, email, createdBy, now(), expires, source, sourceRef, onPaidJson).run();

  const r = await getRequest(env, id);
  let emailed = false;
  if (body.send_email) {
    await emailRequest(env, r);
    emailed = true;
  }
  return { request: adminView(env, { ...r, emailed_at: emailed ? now() : null }), emailed };
}

/** Put a user on a plan (and activate their access to the site). Extends a running plan of the same kind. */
export async function applyPlan(env, h, { user_id, site_id, plan_id, days }) {
  const user = await h.getUserById(env, String(user_id || ''));
  if (!user) throw new HttpError(404, 'not_found', 'המשתמש לא נמצא');
  const site = await h.getSite(env, String(site_id || ''));
  if (!site) throw new HttpError(404, 'not_found', 'האתר לא נמצא');
  const planId = plan_id ? String(plan_id) : null;
  const plan = planId ? await h.getPlan(env, planId) : null;
  if (planId && (!plan || plan.site_id !== site.id)) throw new HttpError(400, 'bad_plan', 'התוכנית לא שייכת לאתר הזה');
  const d = Math.max(0, Math.min(3650, Math.round(Number(days) || 0)));
  const row = await env.DB.prepare('SELECT plan_id, plan_expires_at FROM access WHERE user_id = ? AND site_id = ?').bind(user.id, site.id).first();
  let base = now();
  if (d && row && row.plan_id === planId && row.plan_expires_at && row.plan_expires_at > base) base = row.plan_expires_at;
  const expires = d ? base + d * 86400 : null;
  await env.DB.prepare(
    `INSERT INTO access (user_id, site_id, status, plan_id, plan_expires_at, created_at) VALUES (?, ?, 'active', ?, ?, ?)
     ON CONFLICT(user_id, site_id) DO UPDATE SET status = 'active', plan_id = excluded.plan_id, plan_expires_at = excluded.plan_expires_at`,
  ).bind(user.id, site.id, planId, expires, now()).run();
  return { user_id: user.id, user_email: user.email, site_id: site.id, site_name: site.name, plan_id: planId, plan_name: plan ? plan.name : 'ברירת המחדל', expires_at: expires };
}

/** Tell chat.reembir.com that a request it created changed (paid / cancelled / deleted). */
export async function notifyChat(env, r, status, extra = {}) {
  if (r.source !== 'chat' || !env.CHAT_SERVICE_KEY) return;
  const base = (env.CHAT_URL || 'https://chat.reembir.com').replace(/\/+$/, '');
  try {
    const req = new Request(`${base}/api/hooks/pay`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-service-key': env.CHAT_SERVICE_KEY },
      body: JSON.stringify({ id: r.id, status, ...extra }),
    });
    const res = env.CHAT ? await env.CHAT.fetch(req) : await fetch(req);
    if (!res.ok) console.error('chat hook', res.status, await res.text());
  } catch (e) {
    console.error('chat hook failed', e);
  }
}

export async function adminPayAction(request, env, h, id, action) {
  await h.requireAdmin(request, env);
  const r = await getRequest(env, id);
  const status = effectiveStatus(r);
  if (action === 'cancel') {
    if (status === 'paid') throw new HttpError(400, 'paid', 'הבקשה כבר שולמה');
    await env.DB.prepare("UPDATE pay_requests SET status = 'cancelled' WHERE id = ? AND status != 'paid'").bind(id).run();
    await notifyChat(env, r, 'cancelled');
  } else if (action === 'reopen') {
    if (r.status !== 'cancelled') throw new HttpError(400, 'bad_state', 'אפשר לפתוח מחדש רק בקשה שבוטלה');
    await env.DB.prepare("UPDATE pay_requests SET status = 'open' WHERE id = ?").bind(id).run();
    await notifyChat(env, r, 'open');
  } else if (action === 'send') {
    if (status !== 'open') throw new HttpError(400, 'bad_state', 'אפשר לשלוח רק בקשה פתוחה');
    await emailRequest(env, r);
  } else if (action === 'delete') {
    // Paid requests can be deleted too — this only removes the record here; the payment stays in PayPal.
    await env.DB.batch([
      env.DB.prepare('DELETE FROM pay_tokens WHERE request_id = ?').bind(id),
      env.DB.prepare('DELETE FROM pay_requests WHERE id = ?').bind(id),
    ]);
    if (status !== 'paid') await notifyChat(env, r, 'cancelled');
    return json({ ok: true });
  }
  const fresh = await env.DB.prepare('SELECT p.*, u.name AS user_name FROM pay_requests p LEFT JOIN users u ON u.id = p.user_id WHERE p.id = ?').bind(id).first();
  return json({ request: adminView(env, fresh, fresh.user_name) });
}

// ======================================================================
// Payment page (pay.reembir.com/r/<id>)
// ======================================================================

export async function payInfo(request, env, id) {
  const r = await getRequest(env, id);
  return json({
    id: r.id,
    amount_cents: r.amount_cents,
    currency: r.currency,
    amount_text: formatMoney(r.amount_cents, r.currency),
    description: r.description,
    status: effectiveStatus(r),
    payer_type: r.user_id ? 'user' : 'email',
    email_masked: maskEmail(r.email),
    expires_at: r.expires_at,
    paid_at: r.paid_at,
    login_url: loginBase(env),
    paypal: {
      client_id: env.PAYPAL_CLIENT_ID || '',
      env: env.PAYPAL_ENV === 'sandbox' ? 'sandbox' : 'live',
      mock: isMock(env),
    },
  });
}

// Who is paying? Always a live reem.bi sign-in: a payment-page token whose parent
// login.reembir.com session still exists (signing out anywhere kills it), for the request's
// account — or, for a request made out to an email, a verified account with that email.
async function authorizePayer(request, env, h, r) {
  const loginRequired = () => new HttpError(401, 'login_required', 'צריך להתחבר לחשבון reem.bi כדי לשלם');
  let session;
  try {
    session = await h.requireSiteSession(request, env);
  } catch {
    throw loginRequired();
  }
  if (session.client_id !== 'pay' || !session.parent_session_id) throw loginRequired();
  const parent = await env.DB.prepare('SELECT expires_at FROM sessions WHERE id = ? AND client_id IS NULL AND user_id = ?')
    .bind(session.parent_session_id, session.id).first();
  if (!parent || parent.expires_at < now()) {
    await env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(session.session_id).run();
    throw loginRequired();
  }
  const ok = r.user_id ? session.id === r.user_id : session.email === r.email && !!session.email_verified;
  if (!ok) throw new HttpError(403, 'wrong_user', 'בקשת התשלום הזו מיועדת לחשבון אחר');
}

function assertPayable(r) {
  const status = effectiveStatus(r);
  if (status === 'paid') throw new HttpError(409, 'paid', 'הבקשה הזו כבר שולמה');
  if (status === 'cancelled') throw new HttpError(410, 'cancelled', 'בקשת התשלום בוטלה');
  if (status === 'expired') throw new HttpError(410, 'expired', 'תוקף בקשת התשלום פג');
}

export async function payCheck(request, env, h, id) {
  const r = await getRequest(env, id);
  await authorizePayer(request, env, h, r);
  return json({ ok: true });
}

// The emailed 6-digit code used to be a way to pay without an account. Not anymore.
export async function paySendCode() {
  throw new HttpError(410, 'login_required', 'כדי לשלם צריך להתחבר לחשבון reem.bi');
}
export const payVerifyCode = paySendCode;

// ---------- PayPal ----------

const ppBase = env => (env.PAYPAL_ENV === 'sandbox' ? 'https://api-m.sandbox.paypal.com' : 'https://api-m.paypal.com');
let ppToken = null;

async function paypalAccessToken(env) {
  if (!env.PAYPAL_CLIENT_ID || !env.PAYPAL_CLIENT_SECRET) {
    throw new HttpError(501, 'paypal_not_configured', 'התשלום עוד לא הוגדר. נסו שוב מאוחר יותר.');
  }
  if (ppToken && ppToken.base === ppBase(env) && ppToken.expires > Date.now() + 60000) return ppToken.token;
  const res = await fetch(ppBase(env) + '/v1/oauth2/token', {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + btoa(`${env.PAYPAL_CLIENT_ID}:${env.PAYPAL_CLIENT_SECRET}`),
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  if (!res.ok) {
    console.error('PayPal token error', res.status, await res.text());
    throw new HttpError(502, 'paypal_error', 'PayPal לא זמין כרגע, נסו שוב בעוד רגע');
  }
  const data = await res.json();
  ppToken = { token: data.access_token, expires: Date.now() + data.expires_in * 1000, base: ppBase(env) };
  return ppToken.token;
}

async function paypal(env, method, path, body) {
  const res = await fetch(ppBase(env) + path, {
    method,
    headers: {
      Authorization: 'Bearer ' + (await paypalAccessToken(env)),
      'content-type': 'application/json',
      Prefer: 'return=representation',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

export async function payCreateOrder(request, env, h, id) {
  const r = await getRequest(env, id);
  assertPayable(r);
  await authorizePayer(request, env, h, r);

  let orderId;
  if (isMock(env)) {
    orderId = 'MOCK-' + randomToken(6);
  } else {
    const res = await paypal(env, 'POST', '/v2/checkout/orders', {
      intent: 'CAPTURE',
      purchase_units: [{
        reference_id: r.id,
        custom_id: r.id,
        description: r.description.slice(0, 127),
        amount: { currency_code: r.currency, value: (r.amount_cents / 100).toFixed(2) },
      }],
      application_context: { brand_name: 'reem.bi', shipping_preference: 'NO_SHIPPING', user_action: 'PAY_NOW', locale: 'he-IL' },
    });
    if (!res.ok) {
      console.error('PayPal create order', res.status, JSON.stringify(res.data));
      throw new HttpError(502, 'paypal_error', 'לא הצלחנו לפתוח תשלום ב-PayPal, נסו שוב');
    }
    orderId = res.data.id;
  }
  await env.DB.prepare('UPDATE pay_requests SET paypal_order_id = ? WHERE id = ?').bind(orderId, r.id).run();
  return json({ orderID: orderId });
}

export async function payCapture(request, env, h, id) {
  const r = await getRequest(env, id);
  await authorizePayer(request, env, h, r);
  if (effectiveStatus(r) === 'paid') return json({ status: 'paid', capture_id: r.paypal_capture_id });
  const body = await readJson(request);
  if (!body.orderID || body.orderID !== r.paypal_order_id) throw new HttpError(400, 'bad_order', 'התשלום לא תואם לבקשה, נסו שוב');

  let captureId;
  let payerEmail = null;
  if (isMock(env)) {
    captureId = 'MOCKCAP-' + randomToken(6);
    payerEmail = r.email;
  } else {
    let res = await paypal(env, 'POST', `/v2/checkout/orders/${encodeURIComponent(r.paypal_order_id)}/capture`);
    if (!res.ok && res.data?.details?.some(d => d.issue === 'ORDER_ALREADY_CAPTURED')) {
      res = await paypal(env, 'GET', `/v2/checkout/orders/${encodeURIComponent(r.paypal_order_id)}`);
    }
    if (!res.ok) {
      console.error('PayPal capture', res.status, JSON.stringify(res.data));
      const declined = res.data?.details?.some(d => d.issue === 'INSTRUMENT_DECLINED');
      throw new HttpError(402, declined ? 'declined' : 'paypal_error', declined ? 'אמצעי התשלום נדחה — נסו אמצעי אחר' : 'התשלום לא הושלם, נסו שוב');
    }
    const unit = res.data.purchase_units?.[0] || {};
    const capture = unit.payments?.captures?.[0];
    const expected = (r.amount_cents / 100).toFixed(2);
    if (
      !capture || capture.status !== 'COMPLETED' ||
      capture.amount?.currency_code !== r.currency || Number(capture.amount?.value).toFixed(2) !== expected ||
      (capture.custom_id && capture.custom_id !== r.id)
    ) {
      console.error('PayPal capture mismatch', JSON.stringify(res.data));
      throw new HttpError(402, 'not_completed', 'התשלום עדיין לא הושלם. אם חויבתם, פנו ל-support@reembir.com');
    }
    captureId = capture.id;
    payerEmail = res.data.payer?.email_address || null;
  }

  const t = now();
  const upd = await env.DB.prepare(
    "UPDATE pay_requests SET status = 'paid', paid_at = ?, paypal_capture_id = ?, paypal_payer_email = ? WHERE id = ? AND status != 'paid'",
  ).bind(t, captureId, payerEmail, r.id).run();

  if (upd.meta.changes) {
    // Automatic upgrade attached to the request.
    let upgrade = null;
    const onPaid = parseJsonSafe(r.on_paid);
    if (onPaid && onPaid.site_id) {
      try {
        upgrade = { ok: true, ...(await applyPlan(env, h, onPaid)) };
      } catch (e) {
        console.error('on_paid upgrade failed', e);
        upgrade = { ok: false, error: e.message || 'failed', site_name: onPaid.site_name, plan_name: onPaid.plan_name };
      }
      await env.DB.prepare('UPDATE pay_requests SET on_paid_result = ? WHERE id = ?').bind(JSON.stringify(upgrade), r.id).run();
    }
    await notifyChat(env, r, 'paid', { paid_at: t, capture_id: captureId, upgrade });
    const upgradeRows = upgrade
      ? [['שדרוג', upgrade.ok ? `${upgrade.site_name} · ${upgrade.plan_name}${upgrade.expires_at ? ` עד ${fmtDate(upgrade.expires_at)}` : ''} ✓` : `נכשל: ${upgrade.error}`]]
      : [];
    const money = formatMoney(r.amount_cents, r.currency);
    const payerName = r.user_id ? ((await h.getUserById(env, r.user_id))?.name || '') : '';
    const jobs = [
      sendNotice(env, r.email, `קבלה על תשלום: ${money}`, {
        title: 'התשלום התקבל, תודה! ✓',
        intro: 'זה אישור על התשלום שביצעת.',
        rows: [['עבור', r.description], ['סכום', money], ['תאריך', fmtDateTime(t)], ['אסמכתא (PayPal)', captureId], ['מספר בקשה', r.id]],
        outro: 'המסמך הזה הוא אישור תשלום ואינו חשבונית מס. לשאלות: support@reembir.com',
      }),
      sendNotice(env, r.created_by, `🎉 התקבל תשלום: ${money} — ${r.description}`, {
        title: 'התקבל תשלום 🎉',
        rows: [
          ['עבור', r.description], ['סכום', money],
          ['שילם', [payerName, r.email].filter(Boolean).join(' · ')],
          ...(payerEmail && payerEmail !== r.email ? [['חשבון PayPal', payerEmail]] : []),
          ['תאריך', fmtDateTime(t)], ['אסמכתא (PayPal)', captureId], ...upgradeRows,
        ],
        button: 'לבקשות התשלום',
        link: `${loginBase(env)}/admin#pay`,
      }),
    ];
    const results = await Promise.allSettled(jobs);
    results.forEach(x => { if (x.status === 'rejected') console.error('pay email failed', x.reason); });
  }
  return json({ status: 'paid', capture_id: captureId });
}
