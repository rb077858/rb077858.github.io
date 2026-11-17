// WhatsApp Cloud API (Meta) webhook: https://login.reembir.com/api/whatsapp/webhook
//
// Meta calls it for two things:
//   GET   once, when you press "Verify and save" in the app's dashboard: it sends hub.challenge and our verify token
//   POST  every status update of a message we sent (sent / delivered / read / failed) and every message people send us
// Both are public (no cookie): the GET is protected by the verify token, the POST by Meta's signature (X-Hub-Signature-256,
// an HMAC of the body with the app secret).
//
// Settings (Cloudflare → the reem-sso Worker → Settings → Variables and secrets):
//   WHATSAPP_VERIFY_TOKEN   a string you make up, and paste into Meta's "Verify token" field
//   WHATSAPP_APP_SECRET     Meta app dashboard → App settings → Basic → App secret (checks the signature of every event)
import { json, utf8 } from './lib.js';

function same(a, b) {
  const x = utf8(String(a)), y = utf8(String(b));
  if (x.length !== y.length) return false;
  let d = 0;
  for (let i = 0; i < x.length; i++) d |= x[i] ^ y[i];
  return d === 0;
}

async function signature(secret, body) {
  const key = await crypto.subtle.importKey('raw', utf8(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, body));
  return 'sha256=' + [...mac].map(b => b.toString(16).padStart(2, '0')).join('');
}

/** GET: Meta checks that the address is ours. */
export function verify(request, env) {
  if (!env.WHATSAPP_VERIFY_TOKEN) return new Response('not configured', { status: 503 });
  const q = new URL(request.url).searchParams;
  if (q.get('hub.mode') === 'subscribe' && same(q.get('hub.verify_token') || '', env.WHATSAPP_VERIFY_TOKEN)) {
    return new Response(q.get('hub.challenge') || '', { status: 200, headers: { 'content-type': 'text/plain' } });
  }
  return new Response('forbidden', { status: 403 });
}

/** POST: an event. Answered quickly with 200 (Meta retries anything else). */
export async function receive(request, env) {
  const raw = new Uint8Array(await request.arrayBuffer());
  if (env.WHATSAPP_APP_SECRET) {
    const given = request.headers.get('x-hub-signature-256') || '';
    if (!same(given, await signature(env.WHATSAPP_APP_SECRET, raw))) return new Response('bad signature', { status: 401 });
  } else {
    console.error('whatsapp webhook: WHATSAPP_APP_SECRET is not set, so the signature is not checked');
  }
  let body;
  try { body = JSON.parse(new TextDecoder().decode(raw)); } catch { return new Response('bad json', { status: 400 }); }
  for (const entry of body.entry || []) {
    for (const change of entry.changes || []) {
      const v = change.value || {};
      // what happened to the messages we sent: failures are the ones to look at
      for (const st of v.statuses || []) {
        const err = (st.errors || [])[0];
        console.log(JSON.stringify({ whatsapp: 'status', status: st.status, id: st.id, to: st.recipient_id, error: err ? { code: err.code, title: err.title, detail: err.error_data && err.error_data.details } : undefined }));
      }
      // people writing to the number: nothing answers them yet
      for (const m of v.messages || []) console.log(JSON.stringify({ whatsapp: 'message', from: m.from, type: m.type }));
    }
  }
  return json({ ok: true });
}
