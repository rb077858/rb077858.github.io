// JWT helpers: verifying Google ID tokens and minting Firebase custom tokens.
import { HttpError, b64url, b64urlDecode, now, utf8 } from './lib.js';

const GOOGLE_CERTS = 'https://www.googleapis.com/oauth2/v3/certs';
let googleKeys = null; // { keys, expires }

async function getGoogleKeys() {
  if (googleKeys && googleKeys.expires > Date.now()) return googleKeys.keys;
  const res = await fetch(GOOGLE_CERTS);
  if (!res.ok) throw new HttpError(502, 'google_unavailable', 'לא הצלחנו לאמת מול Google');
  const maxAge = Number((res.headers.get('cache-control') || '').match(/max-age=(\d+)/)?.[1] || 3600);
  const { keys } = await res.json();
  googleKeys = { keys, expires: Date.now() + maxAge * 1000 };
  return keys;
}

export async function verifyGoogleIdToken(token, clientId) {
  if (!clientId) throw new HttpError(500, 'google_not_configured', 'התחברות עם Google עוד לא הוגדרה');
  const parts = String(token || '').split('.');
  if (parts.length !== 3) throw new HttpError(400, 'invalid_token', 'טוקן Google לא תקין');
  const [h, p, s] = parts;
  const header = JSON.parse(new TextDecoder().decode(b64urlDecode(h)));
  const jwk = (await getGoogleKeys()).find(k => k.kid === header.kid);
  if (!jwk || header.alg !== 'RS256') throw new HttpError(400, 'invalid_token', 'טוקן Google לא תקין');

  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64urlDecode(s), utf8(`${h}.${p}`));
  if (!valid) throw new HttpError(400, 'invalid_token', 'טוקן Google לא תקין');

  const claims = JSON.parse(new TextDecoder().decode(b64urlDecode(p)));
  const t = now();
  if (!['accounts.google.com', 'https://accounts.google.com'].includes(claims.iss)) throw new HttpError(400, 'invalid_token', 'מנפיק לא תקין');
  if (claims.aud !== clientId) throw new HttpError(400, 'invalid_token', 'הטוקן לא שייך לאפליקציה הזו');
  if (claims.exp < t - 60) throw new HttpError(400, 'invalid_token', 'פג תוקף ההתחברות, נסו שוב');
  if (!claims.email || claims.email_verified !== true) throw new HttpError(400, 'email_not_verified', 'המייל בחשבון Google לא מאומת');
  return claims;
}

function pemToPkcs8(pem) {
  const body = pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  return Uint8Array.from(atob(body), c => c.charCodeAt(0));
}

/**
 * Firebase custom token — lets a site that keeps its data in Firebase (like NeverLost)
 * call signInWithCustomToken() so Firestore rules see who the user is.
 * https://firebase.google.com/docs/auth/admin/create-custom-tokens#create_custom_tokens_using_a_third-party_jwt_library
 */
export async function firebaseCustomToken(serviceAccountJson, uid, claims) {
  const sa = typeof serviceAccountJson === 'string' ? JSON.parse(serviceAccountJson) : serviceAccountJson;
  const t = now();
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iss: sa.client_email,
    sub: sa.client_email,
    aud: 'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit',
    iat: t,
    exp: t + 3600,
    uid,
    claims,
  };
  const input = `${b64url(utf8(JSON.stringify(header)))}.${b64url(utf8(JSON.stringify(payload)))}`;
  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToPkcs8(sa.private_key),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, utf8(input));
  return `${input}.${b64url(sig)}`;
}
