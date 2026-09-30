// Payment requests: the admin creates a request (amount, currency, description,
// who pays), shares the link, and the payer proves who they are — with their
// reem.bi account, or with a 6-digit code sent to the email the admin entered —
// and pays with PayPal. The server creates and captures the PayPal order itself,
// so the amount can't be changed in the browser.
import { HttpError, json, readJson, now, randomToken, sha256, normalizeEmail, rateLimit, clientIp } from './lib.js';
import { sendNotice } from './mail.js';

export const CURRENCIES = { ILS: '₪', USD: '$', EUR: '€' };
const OTP_TTL = 10 * 60;
// Fake PayPal for local development only — never active without DEV=1.
const isMock = env => env.PAYPAL_MOCK === '1' && env.DEV === '1';
const PAY_TOKEN_TTL = 2 * 60 * 60;

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

function effectiveStatus(r) {
  if (r.status === 'open' && r.expires_at && r.expires_at < now()) return 'expired';
  return r.status;
}

async function getRequest(env, id) {
  await ensurePaySchema(env);
  const r = await env.DB.prepare('SELECT * FROM pay_requests WHERE id = ?').bind(String(id || '')).first();
  if (!r) throw new HttpError(404, 'not_found', 'בקשת התשלום לא נמצאה');
  return r;
}

function adminView(env, r, userName) {
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
  };
}

async function emailRequest(env, r) {
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
      : 'לפני התשלום נשלח אליכם קוד אימות בן 6 ספרות למייל הזה.',
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
  await ensurePaySchema(env);
  const body = await readJson(request);

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

  const id = randomToken(9);
  await env.DB.prepare(
    `INSERT INTO pay_requests (id, amount_cents, currency, description, user_id, email, status, created_by, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, 'open', ?, ?, ?)`,
  ).bind(id, cents, currency, description, userId, email, admin.email, now(), expires).run();

  const r = await getRequest(env, id);
  let emailed = false;
  if (body.send_email) {
    await emailRequest(env, r);
    emailed = true;
  }
  return json({ request: adminView(env, { ...r, emailed_at: emailed ? now() : null }), emailed });
}

export async function adminPayAction(request, env, h, id, action) {
  await h.requireAdmin(request, env);
  const r = await getRequest(env, id);
  const status = effectiveStatus(r);
  if (action === 'cancel') {
    if (status === 'paid') throw new HttpError(400, 'paid', 'הבקשה כבר שולמה');
    await env.DB.prepare("UPDATE pay_requests SET status = 'cancelled' WHERE id = ? AND status != 'paid'").bind(id).run();
  } else if (action === 'reopen') {
    if (r.status !== 'cancelled') throw new HttpError(400, 'bad_state', 'אפשר לפתוח מחדש רק בקשה שבוטלה');
    await env.DB.prepare("UPDATE pay_requests SET status = 'open' WHERE id = ?").bind(id).run();
  } else if (action === 'send') {
    if (status !== 'open') throw new HttpError(400, 'bad_state', 'אפשר לשלוח רק בקשה פתוחה');
    await emailRequest(env, r);
  } else if (action === 'delete') {
    // Paid requests can be deleted too — this only removes the record here; the payment stays in PayPal.
    await env.DB.batch([
      env.DB.prepare('DELETE FROM pay_tokens WHERE request_id = ?').bind(id),
      env.DB.prepare('DELETE FROM pay_requests WHERE id = ?').bind(id),
    ]);
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

// Who is paying? A reem.bi session for the right user, or a pay token from the email code.
async function authorizePayer(request, env, h, r) {
  if (r.user_id) {
    let session;
    try {
      session = await h.requireSiteSession(request, env);
    } catch {
      throw new HttpError(401, 'login_required', 'צריך להתחבר לחשבון reem.bi');
    }
    if (session.client_id !== 'pay') throw new HttpError(401, 'login_required', 'צריך להתחבר לחשבון reem.bi');
    if (session.id !== r.user_id) throw new HttpError(403, 'wrong_user', 'בקשת התשלום הזו מיועדת לחשבון אחר');
    return;
  }
  const token = request.headers.get('x-pay-token') || '';
  const row = token
    ? await env.DB.prepare('SELECT * FROM pay_tokens WHERE id = ?').bind(await sha256(token)).first()
    : null;
  if (!row || row.request_id !== r.id || row.expires_at < now()) {
    throw new HttpError(401, 'verify_required', 'צריך לאמת את המייל עם הקוד שנשלח');
  }
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

export async function paySendCode(request, env, id) {
  const r = await getRequest(env, id);
  assertPayable(r);
  if (r.user_id) throw new HttpError(400, 'not_email', 'את הבקשה הזו משלמים דרך חשבון reem.bi');
  await rateLimit(env, `pay-otp:${r.id}`, 4, 900);
  await rateLimit(env, `pay-otp-ip:${clientIp(request)}`, 15, 900);

  const n = crypto.getRandomValues(new Uint32Array(1))[0] % 1000000;
  const code = String(n).padStart(6, '0');
  await env.DB.prepare('UPDATE pay_requests SET otp_hash = ?, otp_expires = ?, otp_attempts = 0 WHERE id = ?')
    .bind(await sha256(`${r.id}:${code}`), now() + OTP_TTL, r.id).run();
  await sendNotice(env, r.email, `קוד אימות לתשלום: ${code}`, {
    title: 'קוד האימות שלך',
    intro: `הזינו את הקוד בדף התשלום כדי להמשיך לתשלום של ${formatMoney(r.amount_cents, r.currency)} (${r.description}). הקוד תקף ל-10 דקות.`,
    code,
    outro: 'לא ביקשתם לשלם? אפשר פשוט להתעלם מהמייל הזה.',
  });
  return json({ ok: true, email_masked: maskEmail(r.email), ...(env.DEV === '1' ? { dev_code: code } : {}) });
}

export async function payVerifyCode(request, env, id) {
  const r = await getRequest(env, id);
  assertPayable(r);
  const body = await readJson(request);
  const code = String(body.code || '').replace(/\D/g, '');
  if (!r.otp_hash || !r.otp_expires || r.otp_expires < now()) throw new HttpError(400, 'code_expired', 'הקוד פג תוקף — שלחו קוד חדש');
  if (r.otp_attempts >= 5) throw new HttpError(429, 'too_many', 'יותר מדי ניסיונות — שלחו קוד חדש');
  if (code.length !== 6 || (await sha256(`${r.id}:${code}`)) !== r.otp_hash) {
    await env.DB.prepare('UPDATE pay_requests SET otp_attempts = otp_attempts + 1 WHERE id = ?').bind(r.id).run();
    throw new HttpError(400, 'bad_code', 'הקוד שגוי');
  }
  const token = randomToken();
  await env.DB.batch([
    env.DB.prepare('UPDATE pay_requests SET otp_hash = NULL, otp_expires = NULL, otp_attempts = 0 WHERE id = ?').bind(r.id),
    env.DB.prepare('DELETE FROM pay_tokens WHERE expires_at < ?').bind(now()),
    env.DB.prepare('INSERT INTO pay_tokens (id, request_id, expires_at) VALUES (?, ?, ?)').bind(await sha256(token), r.id, now() + PAY_TOKEN_TTL),
  ]);
  return json({ pay_token: token });
}

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
          ['תאריך', fmtDateTime(t)], ['אסמכתא (PayPal)', captureId],
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
