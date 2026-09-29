// Small helpers shared by the worker and the ChatHub Durable Object.

export const now = () => Date.now();

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

// ---------- encoding / crypto ----------

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

export const randomId = (bytes = 12) => randomToken(bytes);

export async function sha256(str) {
  return b64url(await crypto.subtle.digest('SHA-256', utf8(str)));
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
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
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

export function normalizeEmail(email, { optional = false } = {}) {
  const e = String(email || '').trim().toLowerCase();
  if (!e && optional) return '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) || e.length > 254) {
    throw new HttpError(400, 'invalid_email', 'כתובת המייל לא תקינה');
  }
  return e;
}

export const cleanLine = (s, max = 120) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
export const cleanText = (s, max = 5000) => String(s ?? '').replace(/\r\n?/g, '\n').replace(/\n{4,}/g, '\n\n\n').trim().slice(0, max);

export function parseJson(value, fallback) {
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

// ---------- cookies ----------

export const SESSION_COOKIE = 'chat_session';

export function getCookie(request, name) {
  const header = request.headers.get('cookie') || '';
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

export function sessionCookie(request, token, maxAgeSec) {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${secure}`;
}

export function clientIp(request) {
  return request.headers.get('cf-connecting-ip') || 'local';
}

// ---------- user agent → readable browser / OS / device ----------

export function parseUserAgent(ua = '') {
  const browser =
    /Edg\//.test(ua) ? 'Edge' :
    /OPR\/|Opera/.test(ua) ? 'Opera' :
    /SamsungBrowser/.test(ua) ? 'Samsung Internet' :
    /Firefox\//.test(ua) ? 'Firefox' :
    /Chrome\//.test(ua) ? 'Chrome' :
    /Safari\//.test(ua) ? 'Safari' : 'אחר';
  const os =
    /Windows/.test(ua) ? 'Windows' :
    /iPhone|iPad|iPod/.test(ua) ? 'iOS' :
    /Android/.test(ua) ? 'Android' :
    /Mac OS X/.test(ua) ? 'macOS' :
    /Linux/.test(ua) ? 'Linux' : 'אחר';
  const device = /iPad|Tablet/.test(ua) ? 'tablet' : /Mobi|iPhone|Android/.test(ua) ? 'mobile' : 'desktop';
  return { browser, os, device };
}
