// Small helpers shared by the worker: responses, crypto, cookies, rate limiting.

export const now = () => Math.floor(Date.now() / 1000);

export class HttpError extends Error {
  constructor(status, code, message) {
    super(message || code);
    this.status = status;
    this.code = code;
  }
}

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  });
}

export async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

// ---------- encoding ----------

export function b64url(bytes) {
  let s = '';
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function b64urlDecode(str) {
  const s = str.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(s + '='.repeat((4 - (s.length % 4)) % 4));
  return Uint8Array.from(bin, c => c.charCodeAt(0));
}

export const utf8 = s => new TextEncoder().encode(s);

export function randomToken(bytes = 32) {
  return b64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

export async function sha256(str) {
  const hash = await crypto.subtle.digest('SHA-256', utf8(str));
  return b64url(hash);
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// ---------- passwords (PBKDF2-SHA256; 100k is the Workers maximum) ----------

const PBKDF2_ITERATIONS = 100000;

async function pbkdf2(password, salt, iterations) {
  const key = await crypto.subtle.importKey('raw', utf8(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    key,
    256,
  );
  return b64url(bits);
}

export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(password, salt, PBKDF2_ITERATIONS);
  return `pbkdf2$${PBKDF2_ITERATIONS}$${b64url(salt)}$${hash}`;
}

export async function verifyPassword(password, stored) {
  if (!stored) return false;
  const [scheme, iter, salt, hash] = stored.split('$');
  if (scheme !== 'pbkdf2') return false;
  const candidate = await pbkdf2(password, b64urlDecode(salt), Number(iter));
  return timingSafeEqual(candidate, hash);
}

export function validatePassword(password) {
  if (typeof password !== 'string' || password.length < 8) {
    throw new HttpError(400, 'weak_password', 'הסיסמה חייבת להכיל לפחות 8 תווים');
  }
  if (password.length > 200) throw new HttpError(400, 'weak_password', 'הסיסמה ארוכה מדי');
}

// ---------- validation ----------

export function normalizeEmail(email) {
  const e = String(email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) || e.length > 254) {
    throw new HttpError(400, 'invalid_email', 'כתובת המייל לא תקינה');
  }
  return e;
}

export function cleanName(name, fallbackEmail) {
  const n = String(name || '').replace(/\s+/g, ' ').trim().slice(0, 80);
  return n || (fallbackEmail ? fallbackEmail.split('@')[0] : '');
}

export function parseJsonField(value, fallback) {
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

// ---------- cookies ----------

export const SESSION_COOKIE = 'sso_session';

export function getCookie(request, name) {
  const header = request.headers.get('cookie') || '';
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

export function sessionCookie(request, token, maxAge) {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

// ---------- rate limiting (fixed window, stored in D1) ----------

export async function rateLimit(env, key, limit, windowSec) {
  const t = now();
  const row = await env.DB.prepare('SELECT count, window_start FROM rate_limits WHERE key = ?').bind(key).first();
  if (!row || row.window_start + windowSec <= t) {
    await env.DB.prepare(
      'INSERT INTO rate_limits (key, count, window_start) VALUES (?, 1, ?) ON CONFLICT(key) DO UPDATE SET count = 1, window_start = excluded.window_start',
    ).bind(key, t).run();
    return;
  }
  if (row.count >= limit) {
    throw new HttpError(429, 'rate_limited', 'יותר מדי ניסיונות, נסו שוב בעוד כמה דקות');
  }
  await env.DB.prepare('UPDATE rate_limits SET count = count + 1 WHERE key = ?').bind(key).run();
}

export function clientIp(request) {
  return request.headers.get('cf-connecting-ip') || 'local';
}
