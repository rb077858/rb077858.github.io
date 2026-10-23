// One Resend account (RESEND_API_KEY, full access) sends the email of every site.
//
// Sites don't need a Resend key of their own:
//   POST /api/email/me     bearer token of the signed-in user → an email to that user only
//                          (e.g. "send me the transcript"); works from a browser too (auth.emailMe)
//   POST /api/site/email   x-site-key of the site's server → up to 50 recipients
// Each site picks its sender (domain from the Resend account, address, name) in
// admin → Sites → <site> → Settings → Sending email.
import { HttpError, json, readJson, rateLimit, normalizeEmail } from './lib.js';
import { noteQuota } from './mail.js';

const DEFAULT_FROM = 'reem.bi <no-reply@reembir.com>';
const MAX_BYTES = 8 * 1024 * 1024;

let domainCache = { at: 0, list: null };

/** The domains in the Resend account: [{ name, status }] (verified first). null if Resend can't say. */
export async function resendDomains(env, { fresh = false } = {}) {
  if (!env.RESEND_API_KEY) return null;
  if (!fresh && domainCache.list && Date.now() - domainCache.at < 300000) return domainCache.list;
  try {
    const res = await fetch('https://api.resend.com/domains', { headers: { Authorization: `Bearer ${env.RESEND_API_KEY}` } });
    if (!res.ok) return null;
    const body = await res.json();
    const list = (body.data || body.domains || [])
      .map(d => ({ name: String(d.name || '').toLowerCase(), status: d.status || 'unknown' }))
      .filter(d => d.name)
      .sort((a, b) => (a.status === 'verified' ? 0 : 1) - (b.status === 'verified' ? 0 : 1) || a.name.localeCompare(b.name));
    domainCache = { at: Date.now(), list };
    return list;
  } catch (e) {
    console.error('resend domains', e.message);
    return null;
  }
}

export const defaultFrom = env => env.MAIL_FROM || DEFAULT_FROM;
export const siteFrom = (env, site) => (site && site.mail_from) || defaultFrom(env);

/** Validates "Name <local@domain>" (or a bare address) against the account's domains. */
export async function checkFrom(env, value) {
  const v = String(value || '').trim();
  if (!v) return null;
  const m = v.match(/^(?:([^<>"\r\n]{0,60}?)\s*<)?([a-z0-9](?:[a-z0-9._+-]{0,62}[a-z0-9])?)@([a-z0-9.-]+\.[a-z]{2,})>?$/i);
  if (!m) throw new HttpError(400, 'bad_from', 'כתובת השולח לא תקינה. למשל: תמלול <timlul@reembir.com>');
  const [, name, local, domain] = m;
  const domains = await resendDomains(env);
  if (domains && !domains.some(d => d.name === domain.toLowerCase())) {
    throw new HttpError(400, 'bad_domain', `הדומיין ${domain} לא נמצא בחשבון Resend`);
  }
  const address = `${local.toLowerCase()}@${domain.toLowerCase()}`;
  return name && name.trim() ? `${name.trim()} <${address}>` : address;
}

function message(body) {
  const subject = String(body.subject || '').replace(/[\r\n]+/g, ' ').trim().slice(0, 200);
  if (!subject) throw new HttpError(400, 'no_subject', 'חסר נושא');
  const text = body.text ? String(body.text) : '';
  const html = body.html ? String(body.html) : '';
  if (!text.trim() && !html.trim()) throw new HttpError(400, 'no_body', 'חסר תוכן');
  const attachments = (Array.isArray(body.attachments) ? body.attachments : []).slice(0, 5).map(a => ({
    filename: String(a.filename || 'file').replace(/[\\/\r\n]/g, '_').slice(0, 120),
    content: String(a.content || ''),
  })).filter(a => a.content);
  const size = text.length + html.length + attachments.reduce((n, a) => n + a.content.length, 0);
  if (size > MAX_BYTES) throw new HttpError(413, 'too_large', 'המייל גדול מדי');
  const replyTo = body.reply_to ? normalizeEmail(body.reply_to) : null;
  return { subject, text, html, attachments, replyTo };
}

async function send(env, from, to, msg) {
  if (!env.RESEND_API_KEY) throw new HttpError(501, 'not_configured', 'שליחת מיילים עוד לא הוגדרה (RESEND_API_KEY ב-reem-sso)');
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      from, to, subject: msg.subject,
      ...(msg.html ? { html: msg.html } : {}), ...(msg.text ? { text: msg.text } : {}),
      ...(msg.replyTo ? { reply_to: msg.replyTo } : {}),
      ...(msg.attachments.length ? { attachments: msg.attachments } : {}),
    }),
  });
  await noteQuota(env, res);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error('Resend error', res.status, JSON.stringify(data).slice(0, 300));
    throw new HttpError(502, 'send_failed', 'שליחת המייל נכשלה: ' + (data.message || res.status));
  }
  return data.id || null;
}

/** POST /api/email/me — an email from the site to the signed-in user. */
export async function emailMe(request, env, h) {
  const session = await h.requireSiteSession(request, env);
  const site = await h.getSite(env, session.client_id);
  const msg = message(await readJson(request));
  await rateLimit(env, `email-me:${site.id}:${session.id}`, 30, 86400);
  const id = await send(env, siteFrom(env, site), [session.email], msg);
  return json({ ok: true, id, to: session.email });
}

/** POST /api/site/email — the site's server sends to anyone (x-site-key). */
export async function siteEmail(request, env, h, site) {
  const body = await readJson(request);
  const to = [...new Set((Array.isArray(body.to) ? body.to : [body.to]).filter(Boolean).map(normalizeEmail))];
  if (!to.length) throw new HttpError(400, 'no_recipients', 'חסר נמען');
  if (to.length > 50) throw new HttpError(400, 'too_many', 'עד 50 נמענים בבקשה');
  const msg = message(body);
  await rateLimit(env, `site-email:${site.id}`, 500, 86400);
  const id = await send(env, siteFrom(env, site), to, msg);
  return json({ ok: true, id, to });
}

/** POST /api/service/email — chat.reembir.com (x-service-key) sends its notifications from here too. */
export async function serviceEmail(request, env) {
  const body = await readJson(request);
  const to = [...new Set((Array.isArray(body.to) ? body.to : [body.to]).filter(Boolean).map(normalizeEmail))];
  if (!to.length || to.length > 50) throw new HttpError(400, 'bad_recipients', 'בין 1 ל-50 נמענים');
  const msg = message(body);
  await rateLimit(env, 'service-email', 2000, 86400);
  const from = (await checkFrom(env, body.from).catch(() => null)) || defaultFrom(env);
  const id = await send(env, from, to, msg);
  return json({ ok: true, id });
}

export async function adminDomains(request, env, h) {
  await h.requireAdmin(request, env);
  return json({ domains: await resendDomains(env, { fresh: true }), default_from: defaultFrom(env) });
}
