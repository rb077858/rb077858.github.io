/* reem.bi chat — admin dashboard (core, auth, shell, inbox). Pages live in pages.js. */
'use strict';

// =============================================================================
// Tiny DOM toolkit
// =============================================================================

const ICONS = {
  logo: '<path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 9.3 9.3 0 0 1-3.8-.8L3 21l1.9-5A8.4 8.4 0 0 1 12 3a8.5 8.5 0 0 1 9 8.5z"/>',
  inbox: '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.5 5.1 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.5-6.9A2 2 0 0 0 16.8 4H7.2a2 2 0 0 0-1.7 1.1z"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  history: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l4 2"/>',
  chart: '<path d="M3 3v18h18"/><path d="M7 16v-5M12 16V8M17 16v-8"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/>',
  zap: '<path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/>',
  settings: '<path d="M12.2 2h-.4a2 2 0 0 0-2 2v.2a2 2 0 0 1-1 1.7l-.4.3a2 2 0 0 1-2 0l-.2-.1a2 2 0 0 0-2.7.7l-.2.4a2 2 0 0 0 .7 2.7l.2.1a2 2 0 0 1 1 1.7v.5a2 2 0 0 1-1 1.7l-.2.1a2 2 0 0 0-.7 2.7l.2.4a2 2 0 0 0 2.7.7l.2-.1a2 2 0 0 1 2 0l.4.3a2 2 0 0 1 1 1.7v.2a2 2 0 0 0 2 2h.4a2 2 0 0 0 2-2v-.2a2 2 0 0 1 1-1.7l.4-.3a2 2 0 0 1 2 0l.2.1a2 2 0 0 0 2.7-.7l.2-.4a2 2 0 0 0-.7-2.7l-.2-.1a2 2 0 0 1-1-1.7v-.5a2 2 0 0 1 1-1.7l.2-.1a2 2 0 0 0 .7-2.7l-.2-.4a2 2 0 0 0-2.7-.7l-.2.1a2 2 0 0 1-2 0l-.4-.3a2 2 0 0 1-1-1.7V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  send: '<path d="m22 2-7 20-4-9-9-4z"/><path d="M22 2 11 13"/>',
  clip: '<path d="m21.4 11.1-9.2 9.2a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.8-2.8l8.5-8.5"/>',
  smile: '<circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  checks: '<path d="M18 6 7 17l-5-5M22 10l-7.5 7.5L13 16"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  more: '<circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/>',
  chevron: '<path d="m6 9 6 6 6-6"/>',
  back: '<path d="M5 12h14M12 5l7 7-7 7"/>',
  whisper: '<path d="M7 10h10M7 14h6"/><path d="M21 12a9 9 0 0 1-13.5 7.8L3 21l1.2-4.5A9 9 0 1 1 21 12z"/>',
  lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  mail: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 6L2 7"/>',
  phone: '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.9.6 2.8.7a2 2 0 0 1 1.7 2z"/>',
  user: '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  pin: '<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z"/><circle cx="12" cy="10" r="3"/>',
  monitor: '<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>',
  globe: '<circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.8 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  tag: '<path d="M12.6 2.6A2 2 0 0 0 11.2 2H4a2 2 0 0 0-2 2v7.2a2 2 0 0 0 .6 1.4l8.7 8.7a2.4 2.4 0 0 0 3.4 0l6.6-6.6a2.4 2.4 0 0 0 0-3.4z"/><circle cx="7.5" cy="7.5" r=".5" fill="currentColor"/>',
  note: '<path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5z"/><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>',
  star: '<path d="m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z"/>',
  ban: '<circle cx="12" cy="12" r="10"/><path d="m4.9 4.9 14.2 14.2"/>',
  trash: '<path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  edit: '<path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
  moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.9 1.9 0 0 0 3.4 0"/>',
  bellOff: '<path d="M8.7 3A6 6 0 0 1 18 8a21 21 0 0 0 .6 5M17 17H3s3-2 3-9a4.7 4.7 0 0 1 .3-1.7M10.3 21a1.9 1.9 0 0 0 3.4 0M2 2l20 20"/>',
  volume: '<path d="M11 5 6 9H2v6h4l5 4zM15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14"/>',
  mute: '<path d="M11 5 6 9H2v6h4l5 4zM22 9l-6 6M16 9l6 6"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
  refresh: '<path d="M3 12a9 9 0 0 1 15-6.7L21 8M21 3v5h-5M21 12a9 9 0 0 1-15 6.7L3 16M3 21v-5h5"/>',
  copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  palette: '<circle cx="13.5" cy="6.5" r=".5" fill="currentColor"/><circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/><circle cx="8.5" cy="7.5" r=".5" fill="currentColor"/><circle cx="6.5" cy="12.5" r=".5" fill="currentColor"/><path d="M12 2a10 10 0 0 0 0 20c.9 0 1.7-.8 1.7-1.7 0-.4-.2-.8-.4-1.1-.3-.3-.4-.7-.4-1.1 0-.9.8-1.7 1.7-1.7h2A5.6 5.6 0 0 0 22 11c0-5-4.5-9-10-9z"/>',
  form: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M7 8h10M7 12h10M7 16h6"/>',
  code: '<path d="m16 18 6-6-6-6M8 6l-6 6 6 6"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
  sliders: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
  route: '<circle cx="6" cy="19" r="3"/><path d="M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15"/><circle cx="18" cy="5" r="3"/>',
  msg: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  timer: '<path d="M10 2h4M12 14l3-3"/><circle cx="12" cy="14" r="8"/>',
  heart: '<path d="M19 14c1.5-1.5 3-3.2 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.8 0-3 .5-4.5 2-1.5-1.5-2.7-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4 3 5.5l7 7z"/>',
  alert: '<path d="m21.7 18-8-14a2 2 0 0 0-3.4 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.7-3z"/><path d="M12 9v4M12 17h.01"/>',
  arrowIn: '<path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M15 12H3"/>',
  sidebar: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M15 3v18"/>',
  play: '<path d="m5 3 14 9-14 9z"/>',
  card: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20M6 15h4"/>',
  translate: '<path d="m5 8 6 6M4 14l6-6 2-3M2 5h12M7 2h1M22 22l-5-10-5 10M14 18h6"/>',
  rocket: '<path d="M4.5 16.5c-1.5 1.3-2 5-2 5s3.7-.5 5-2c.7-.8.7-2.1-.1-2.9a2.2 2.2 0 0 0-2.9-.1zM12 15l-3-3a22 22 0 0 1 2-3.9A12.9 12.9 0 0 1 22 2c0 2.7-.8 7.5-6 11a22.4 22.4 0 0 1-4 2z"/><path d="M9 12H4s.6-3 2-4c1.6-1.1 5 0 5 0M12 15v5s3-.6 4-2c1.1-1.6 0-5 0-5"/>',
  key: '<path d="m15.5 7.5 3 3L22 7l-3-3M21 2l-9.6 9.6"/><circle cx="7.5" cy="15.5" r="5.5"/>',
};

/** Language name in Hebrew ("he" → "עברית"). */
const langName = code => { if (!code) return ''; try { return new Intl.DisplayNames(['he'], { type: 'language' }).of(code) || code; } catch { return code; } };

function icon(name, size) {
  const t = document.createElement('template');
  t.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"${size ? ` style="width:${size}px;height:${size}px"` : ''}>${ICONS[name] || ''}</svg>`;
  return t.content.firstChild;
}

function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k === 'html') el.innerHTML = v;
      else if (k === 'text') el.textContent = v;
      else if (k === 'value') el.value = v;
      else if (k === 'checked' || k === 'disabled' || k === 'selected') el[k] = !!v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
  }
  const add = c => {
    if (c == null || c === false) return;
    if (Array.isArray(c)) return c.forEach(add);
    el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  };
  kids.forEach(add);
  return el;
}

const $ = (sel, root = document) => root.querySelector(sel);
const clear = el => { while (el && el.firstChild) el.removeChild(el.firstChild); return el; };
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

function linkify(text, { mentions } = {}) {
  const frag = document.createDocumentFragment();
  const re = /(https?:\/\/[^\s<]+[^\s<.,;:!?)\]'"])|(@[^\s@]{2,30}(?:\s[^\s@]{2,20})?)/g;
  let last = 0; let m;
  while ((m = re.exec(text))) {
    if (m.index > last) frag.append(text.slice(last, m.index));
    if (m[1]) frag.append(h('a', { href: m[1], target: '_blank', rel: 'noopener noreferrer' }, m[1]));
    else {
      const name = mentions && S.agents.find(a => m[2].startsWith('@' + a.name));
      if (name) {
        frag.append(h('span', { class: 'mention' }, '@' + name.name));
        re.lastIndex = m.index + name.name.length + 1;
      } else {
        frag.append(m[2]);
      }
    }
    last = re.lastIndex;
  }
  if (last < text.length) frag.append(text.slice(last));
  return frag;
}

function initials(name) {
  const p = String(name || '?').trim().split(/\s+/);
  return ((p[0] || '?')[0] + (p[1] ? p[1][0] : '')).toUpperCase();
}

function avatar(a, size = '', presence) {
  const el = h('span', { class: `av ${size}`, style: { background: a?.color || '#94a3b8' }, title: a?.name || '' }, initials(a?.name));
  if (presence) el.append(h('span', { class: `pres ${presence}` }));
  return el;
}

function visitorAvatar(v, size = '', online) {
  const name = v?.visitor_name ?? v?.name;
  const el = h('span', { class: `av visitor ${size}`, style: { background: name ? colorFor(v.visitor_id || v.id) : '' } }, name ? initials(name) : icon('user', size === 'xl' ? 30 : size === 'lg' ? 22 : 16));
  if (online !== undefined) el.append(h('span', { class: `pres ${online ? 'online' : ''}` }));
  return el;
}

function colorFor(id = '') {
  const colors = ['#0ea5e9', '#8b5cf6', '#ec4899', '#f59e0b', '#14b8a6', '#6366f1', '#ef4444', '#84cc16', '#06b6d4', '#a855f7'];
  let n = 0;
  for (const c of String(id)) n = (n * 31 + c.charCodeAt(0)) >>> 0;
  return colors[n % colors.length];
}

const flag = cc => (cc && /^[A-Z]{2}$/.test(cc) ? String.fromCodePoint(...[...cc].map(c => 127397 + c.charCodeAt(0))) : '');
const countryName = cc => { try { return new Intl.DisplayNames(['he'], { type: 'region' }).of(cc); } catch { return cc; } };

// ---------- time ----------
const fmt = (opts, ts) => new Intl.DateTimeFormat('he-IL', opts).format(new Date(ts));
const fmtTime = ts => fmt({ hour: '2-digit', minute: '2-digit' }, ts);
const fmtDate = ts => fmt({ day: 'numeric', month: 'short', year: new Date(ts).getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined }, ts);
const fmtDateTime = ts => `${fmtDate(ts)} · ${fmtTime(ts)}`;
function fmtDay(ts) {
  const d = new Date(ts); const t = new Date(); const y = new Date(); y.setDate(t.getDate() - 1);
  if (d.toDateString() === t.toDateString()) return 'היום';
  if (d.toDateString() === y.toDateString()) return 'אתמול';
  return fmt({ weekday: 'long', day: 'numeric', month: 'long' }, ts);
}
function ago(ts) {
  if (!ts) return '';
  const s = Math.max(0, (Date.now() - ts) / 1000);
  if (s < 45) return 'עכשיו';
  if (s < 3600) return `${Math.round(s / 60)} ד׳`;
  if (s < 86400) return `${Math.round(s / 3600)} שע׳`;
  if (s < 7 * 86400) return `${Math.round(s / 86400)} ימים`;
  return fmtDate(ts);
}
function dur(ms) {
  if (ms == null) return '—';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} שנ׳`;
  if (s < 3600) return `${Math.floor(s / 60)} ד׳${s % 60 ? ` ${s % 60} שנ׳` : ''}`;
  if (s < 86400) return `${Math.floor(s / 3600)} שע׳ ${Math.round((s % 3600) / 60)} ד׳`;
  return `${Math.round(s / 86400)} ימים`;
}

// =============================================================================
// State + API
// =============================================================================

const S = {
  me: null, agents: [], settings: null, canned: [], counts: {}, tags: [], viewers: {}, visitors: new Map(),
  emailConfigured: true, route: { name: 'inbox' }, integrations: {}, langs: {},
  inbox: { view: localStorage.getItem('chat_admin_view') || 'mine', q: '', list: [], more: false, loading: false },
  conv: null, typing: {}, drafts: {}, ws: null, connected: false, wsTries: 0,
  sound: localStorage.getItem('chat_admin_sound') !== '0',
  known: new Map(), // latest summary of every conversation we've heard about
};
window.S = S;

async function api(path, { method = 'GET', body, form } = {}) {
  const opts = { method, headers: {} };
  if (form) opts.body = form;
  else if (body !== undefined) { opts.body = JSON.stringify(body); opts.headers['content-type'] = 'application/json'; }
  const res = await fetch(`/api/${path}`, opts);
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && S.me && !path.startsWith('auth/')) { S.me = null; location.reload(); }
  if (!res.ok) { const e = new Error(data.message || 'שגיאה'); e.code = data.error; e.status = res.status; throw e; }
  return data;
}

const isAdmin = () => S.me?.role === 'admin';
const agentById = id => S.agents.find(a => a.id === id);

// =============================================================================
// Toasts, modals, popovers, sound, desktop notifications
// =============================================================================

function toast({ title, text, kind = '', ic = 'check', onclick, ms = 4500 }) {
  const el = h('div', { class: `toast ${kind} ${onclick ? 'click' : ''}`, onclick: () => { onclick?.(); dismiss(); } },
    h('div', { class: 't-ic' }, icon(ic)),
    h('div', { class: 'grow' }, h('div', { class: 't-title' }, title), text ? h('div', { class: 't-text' }, text) : null));
  const dismiss = () => { el.classList.add('out'); setTimeout(() => el.remove(), 250); };
  $('#toasts').append(el);
  setTimeout(dismiss, ms);
}
const toastError = e => toast({ title: e.message || 'שגיאה', kind: 'error', ic: 'alert' });

function modal({ title, body, foot, wide, onclose }) {
  const close = () => { overlay.remove(); document.removeEventListener('keydown', esc); onclose?.(); };
  const esc = e => { if (e.key === 'Escape') close(); };
  const overlay = h('div', { class: 'overlay', onmousedown: e => { if (e.target === overlay) close(); } },
    h('div', { class: `modal ${wide ? 'wide' : ''}`, role: 'dialog', 'aria-modal': 'true' },
      h('div', { class: 'modal-head' }, h('h2', null, title), h('button', { class: 'icon-btn', onclick: close, 'aria-label': 'סגירה' }, icon('x'))),
      h('div', { class: 'modal-body' }, body),
      foot ? h('div', { class: 'modal-foot' }, typeof foot === 'function' ? foot(close) : foot) : null));
  document.body.append(overlay);
  document.addEventListener('keydown', esc);
  setTimeout(() => overlay.querySelector('input:not([type=checkbox]):not([type=color]), textarea, select')?.focus(), 60);
  return close;
}

function confirmModal({ title, text, ok = 'אישור', danger }) {
  return new Promise(resolve => {
    let done = false;
    const close = modal({
      title, body: h('p', { class: 'muted' }, text),
      foot: c => [
        h('button', { class: 'btn', onclick: () => c() }, 'ביטול'),
        h('button', { class: `btn ${danger ? 'danger' : 'primary'}`, onclick: () => { done = true; c(); resolve(true); } }, ok),
      ],
      onclose: () => { if (!done) resolve(false); },
    });
    return close;
  });
}

let openPop = null;
function popover(anchor, content, { align = 'start' } = {}) {
  closePop();
  const pop = h('div', { class: 'pop' }, content);
  document.body.append(pop);
  const r = anchor.getBoundingClientRect();
  const pr = pop.getBoundingClientRect();
  const rtl = document.dir === 'rtl';
  let left = align === 'end' ? (rtl ? r.left : r.right - pr.width) : (rtl ? r.right - pr.width : r.left);
  left = Math.max(8, Math.min(left, innerWidth - pr.width - 8));
  let top = r.bottom + 6;
  if (top + pr.height > innerHeight - 8) top = Math.max(8, r.top - pr.height - 6);
  Object.assign(pop.style, { left: `${left}px`, top: `${top}px` });
  setTimeout(() => document.addEventListener('mousedown', outside), 0);
  function outside(e) { if (!pop.contains(e.target)) closePop(); }
  openPop = { pop, outside };
  return pop;
}
function closePop() {
  if (!openPop) return;
  openPop.pop.remove();
  document.removeEventListener('mousedown', openPop.outside);
  openPop = null;
}
const popItem = (ic, label, onclick, cls = '') => h('button', { class: `item ${cls}`, onclick: () => { closePop(); onclick(); } }, ic ? icon(ic) : null, label);

let audioCtx;
function ding(kind = 'msg') {
  if (!S.sound) return;
  try {
    audioCtx ||= new (window.AudioContext || window.webkitAudioContext)();
    const t = audioCtx.currentTime;
    const notes = kind === 'new' ? [[660, 0], [880, 0.12], [1320, 0.24]] : kind === 'whisper' ? [[520, 0], [780, 0.1]] : [[880, 0], [1320, 0.1]];
    for (const [f, d] of notes) {
      const o = audioCtx.createOscillator(); const g = audioCtx.createGain();
      o.type = 'sine'; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t + d);
      g.gain.exponentialRampToValueAtTime(0.2, t + d + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + d + 0.4);
      o.connect(g); g.connect(audioCtx.destination); o.start(t + d); o.stop(t + d + 0.45);
    }
  } catch { /* no audio */ }
}

function desktopNotify(title, body, convId) {
  if (!('Notification' in window) || Notification.permission !== 'granted' || !document.hidden) return;
  try {
    const n = new Notification(title, { body, tag: `conv-${convId}`, renotify: true });
    n.onclick = () => { window.focus(); if (convId) go(`c/${convId}`); n.close(); };
  } catch { /* unsupported */ }
}

function updateTitle() {
  const n = (S.counts.unread || 0);
  document.title = `${n ? `(${n}) ` : ''}מוקד הצ׳אט · ${S.settings?.site_name || 'reem.bi'}`;
}

// =============================================================================
// Routing
// =============================================================================

function parseRoute() {
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  const [name = 'inbox', ...params] = parts;
  if (name === 'c') return { name: 'inbox', convId: Number(params[0]) || null };
  return { name, params };
}
const go = path => { location.hash = `#/${path}`; };

// =============================================================================
// Auth screens
// =============================================================================

function authShell(...content) {
  const app = clear($('#app'));
  app.append(h('div', { class: 'auth' }, h('div', { class: 'auth-card' },
    h('div', { class: 'auth-logo' }, h('div', { class: 'logo-mark' }, icon('logo')), 'מוקד הצ׳אט'),
    ...content)));
}

function renderLogin({ setup, dev } = {}, mode = 'login', msg) {
  if (setup) mode = 'forgot';
  const email = h('input', { class: 'input ltr', type: 'email', autocomplete: 'email', placeholder: 'name@example.com', required: true });
  const pass = h('input', { class: 'input ltr', type: 'password', autocomplete: 'current-password', placeholder: '••••••••' });
  const alert = h('div', { class: msg ? `alert ${msg.kind || ''}` : 'hidden' }, msg?.node || msg?.text || '');
  const btn = h('button', { class: 'btn primary lg block', type: 'submit' }, mode === 'login' ? 'כניסה' : setup ? 'שליחת קישור הגדרה' : 'שליחת קישור');
  const form = h('form', {
    onsubmit: async e => {
      e.preventDefault();
      btn.disabled = true;
      alert.className = 'hidden';
      try {
        if (mode === 'login') {
          const d = await api('auth/login', { method: 'POST', body: { email: email.value, password: pass.value } });
          S.me = d.agent;
          startApp();
        } else {
          const d = await api('auth/forgot', { method: 'POST', body: { email: email.value } });
          alert.className = 'alert ok';
          clear(alert).append(d.devLink
            ? h('span', null, 'מצב פיתוח — הקישור: ', h('a', { href: d.devLink }, d.devLink))
            : 'אם המייל רשום במערכת, שלחנו אליו קישור. בדקו את תיבת הדואר (וגם את הספאם).');
        }
      } catch (err) {
        alert.className = 'alert';
        alert.textContent = err.message;
      }
      btn.disabled = false;
    },
  },
  alert,
  h('div', { class: 'field' }, h('label', { class: 'label' }, 'אימייל'), email),
  mode === 'login' ? h('div', { class: 'field' }, h('label', { class: 'label' }, 'סיסמה'), pass) : null,
  btn);

  authShell(
    h('h1', null, setup ? 'ברוכים הבאים! 🎉' : mode === 'login' ? 'כניסה למוקד' : 'שכחתי סיסמה'),
    h('p', { class: 'sub' }, setup
      ? 'אין עדיין נציגים במערכת. הכניסו את המייל שהוגדר ב-ADMIN_EMAILS ונשלח לכם קישור ליצירת חשבון המנהל.'
      : mode === 'login' ? 'התחברו כדי לענות ללקוחות בזמן אמת' : 'נשלח לכם קישור לבחירת סיסמה חדשה'),
    form,
    setup ? null : h('div', { class: 'links' },
      h('button', { onclick: () => renderLogin({ setup, dev }, mode === 'login' ? 'forgot' : 'login') }, mode === 'login' ? 'שכחתי סיסמה' : 'חזרה לכניסה'),
      h('span', { class: 'faint' }, 'reem.bi')),
  );
  setTimeout(() => email.focus(), 50);
}

async function renderSetPassword(token) {
  authShell(h('div', { class: 'center-fill', style: { padding: '30px' } }, h('div', { class: 'spinner' })));
  let info;
  try {
    info = await api(`auth/token?token=${encodeURIComponent(token)}`);
  } catch (e) {
    authShell(h('h1', null, 'הקישור לא תקף'), h('p', { class: 'sub' }, e.message),
      h('button', { class: 'btn primary lg block', onclick: () => { history.replaceState(null, '', '/admin/'); boot(); } }, 'למסך הכניסה'));
    return;
  }
  const invite = info.type === 'invite';
  const name = h('input', { class: 'input', value: info.name, autocomplete: 'name' });
  const pass = h('input', { class: 'input ltr', type: 'password', autocomplete: 'new-password', placeholder: 'לפחות 8 תווים', minlength: 8 });
  const alert = h('div', { class: 'hidden' });
  const btn = h('button', { class: 'btn primary lg block', type: 'submit' }, invite ? 'הצטרפות לצוות' : 'שמירה וכניסה');
  authShell(
    h('h1', null, invite ? 'הצטרפות לצוות 👋' : 'בחירת סיסמה'),
    h('p', { class: 'sub' }, h('span', { class: 'ltr' }, info.email)),
    h('form', {
      onsubmit: async e => {
        e.preventDefault();
        btn.disabled = true;
        try {
          const d = await api('auth/set-password', { method: 'POST', body: { token, password: pass.value, name: name.value } });
          S.me = d.agent;
          history.replaceState(null, '', '/admin/#/inbox');
          startApp();
        } catch (err) {
          alert.className = 'alert'; alert.textContent = err.message; btn.disabled = false;
        }
      },
    }, alert,
    h('div', { class: 'field' }, h('label', { class: 'label' }, 'השם שיוצג ללקוחות'), name),
    h('div', { class: 'field' }, h('label', { class: 'label' }, 'סיסמה'), pass),
    btn),
  );
}

// =============================================================================
// Boot
// =============================================================================

async function boot() {
  window.onhashchange = () => { if (!S.me) boot(); };
  const m = location.hash.match(/^#\/password\/(.+)$/);
  if (m) return renderSetPassword(m[1]);
  try {
    const d = await api('auth/me');
    if (d.agent) { S.me = d.agent; startApp(); } else renderLogin(d);
  } catch {
    authShell(h('h1', null, 'אין חיבור לשרת'), h('p', { class: 'sub' }, 'נסו לרענן את הדף בעוד רגע.'),
      h('button', { class: 'btn primary lg block', onclick: () => location.reload() }, 'רענון'));
  }
}

async function startApp() {
  const d = await api('a/bootstrap');
  Object.assign(S, {
    me: d.me, agents: d.agents, settings: d.settings, canned: d.canned, counts: d.counts, tags: d.tags,
    viewers: d.viewers, emailConfigured: d.email_configured, integrations: d.integrations || {}, langs: d.langs || {},
  });
  S.visitors = new Map(d.visitors.map(v => [v.id, v]));
  renderShell();
  connectWs();
  window.onhashchange = route;
  route();
}

// =============================================================================
// WebSocket
// =============================================================================

function connectWs() {
  if (S.ws) return;
  const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws/agent`);
  S.ws = ws;
  ws.onopen = () => {
    S.connected = true;
    const wasReconnect = S.wsTries > 0;
    S.wsTries = 0;
    renderConnBanner();
    if (S.conv?.id) wsSend({ t: 'view', convId: S.conv.id });
    if (wasReconnect) resync();
    ws._ping = setInterval(() => { try { ws.send('ping'); } catch { /* closed */ } }, 25000);
  };
  ws.onmessage = e => { if (e.data !== 'pong') { try { onWs(JSON.parse(e.data)); } catch (err) { console.error(err); } } };
  ws.onclose = e => {
    clearInterval(ws._ping);
    S.ws = null; S.connected = false;
    if (e.code === 4001) { location.reload(); return; }
    renderConnBanner();
    setTimeout(connectWs, Math.min(20000, 800 * 2 ** S.wsTries++));
  };
}
const wsSend = msg => { if (S.ws?.readyState === 1) S.ws.send(JSON.stringify(msg)); };

async function resync() {
  try {
    const d = await api('a/bootstrap');
    Object.assign(S, { agents: d.agents, counts: d.counts, viewers: d.viewers, canned: d.canned, integrations: d.integrations || {} });
    S.visitors = new Map(d.visitors.map(v => [v.id, v]));
    renderRail();
    if (S.route.name === 'inbox') { loadList(); if (S.conv?.id) openConv(S.conv.id, { keep: true }); }
  } catch { /* retry on next reconnect */ }
}

function renderConnBanner() {
  const main = $('.main');
  if (!main) return;
  let b = $('.conn-banner');
  if (S.connected || S.wsTries < 2) { b?.remove(); return; }
  if (!b) main.prepend(h('div', { class: 'conn-banner' }, 'החיבור נותק — מתחבר מחדש…'));
}

const refreshCounts = debounce(async () => {
  try { S.counts = (await api('a/counts')).counts; renderRail(); renderTabs(); updateTitle(); } catch { /* ignore */ }
}, 600);

function onWs(ev) {
  switch (ev.t) {
    case 'hello': S.viewers = ev.viewers || {}; break;

    case 'conv': {
      S.known.set(ev.conv.id, ev.conv);
      upsertListItem(ev.conv);
      if (S.conv?.id === ev.conv.id && S.conv.data) {
        S.conv.data.conversation = ev.conv;
        renderThreadHead();
        renderSide();
        renderComposerArea();
      }
      if (S.route.name === 'history') window.Pages?.historyUpsert?.(ev.conv);
      refreshCounts();
      break;
    }

    case 'conv_deleted':
      S.inbox.list = S.inbox.list.filter(c => c.id !== ev.convId);
      renderListItems();
      if (S.conv?.id === ev.convId) { S.conv = null; go('inbox'); }
      refreshCounts();
      break;

    case 'message': {
      const m = ev.message;
      const item = S.inbox.list.find(c => c.id === ev.convId);
      const viewing = S.conv?.id === ev.convId && S.conv.data;
      if (viewing) {
        const list = S.conv.data.messages;
        const i = list.findIndex(x => x.id === m.id || (x._tmp && x._tmp === m.meta?.client_tmp));
        if (i >= 0) list[i] = m; else if (!list.some(x => x.id === m.id)) list.push(m);
        if (m.sender_type === 'visitor' && S.typing[ev.convId]) delete S.typing[ev.convId].visitor;
        if (m.sender_type === 'agent' && S.typing[ev.convId]?.agents) delete S.typing[ev.convId].agents[m.agent_id];
        renderMessages();
        renderTypingLine();
        if (m.sender_type === 'visitor' && !document.hidden) markRead(ev.convId);
      }
      if (m.sender_type === 'visitor') {
        // A brand-new conversation is announced by the 'notify' event instead.
        const conv = item || (viewing ? S.conv.data.conversation : null) || S.known.get(ev.convId);
        if (!conv) break;
        const relevant = !conv.assigned_agent_id || conv.assigned_agent_id === S.me.id;
        if (relevant && (!viewing || document.hidden)) {
          ding('msg');
          const who = conv?.visitor_name || 'מבקר';
          const body = m.kind === 'file' ? `📎 ${m.body}` : m.body;
          if (!viewing) toast({ title: who, text: body, ic: 'msg', onclick: () => go(`c/${ev.convId}`) });
          desktopNotify(who, body, ev.convId);
        }
      }
      break;
    }

    case 'message_update': {
      if (S.conv?.id !== ev.convId || !S.conv.data) break;
      const list = S.conv.data.messages;
      const i = list.findIndex(x => x.id === ev.message.id);
      if (i >= 0) { list[i] = ev.message; renderMessages(); }
      break;
    }

    case 'perms':
      // Permissions changed (granted for a chat, or the chat closed) — re-check what I may do here.
      if ((!ev.agentId || ev.agentId === S.me.id) && S.conv?.data && (!ev.convId || ev.convId === S.conv.id)) openConv(S.conv.id, { keep: true });
      break;

    case 'integrations': S.integrations = ev.integrations; break;

    case 'visitor_lang':
      if (S.conv?.data?.visitor?.id === ev.visitorId) { S.conv.data.visitor.spoken_lang = ev.lang; renderSide(); }
      break;

    case 'typing': {
      const t = (S.typing[ev.convId] ||= { agents: {} });
      if (ev.who === 'visitor') {
        if (ev.on) t.visitor = { text: ev.text, at: Date.now() }; else delete t.visitor;
      } else if (ev.agentId !== S.me.id) {
        if (ev.on) t.agents[ev.agentId] = { name: ev.name, whisper: ev.whisper, at: Date.now() }; else delete t.agents[ev.agentId];
      }
      if (S.conv?.id === ev.convId) { renderTypingSneak(); renderTypingLine(); }
      renderListItem(ev.convId);
      break;
    }

    case 'read':
      if (S.conv?.id === ev.convId && S.conv.data) {
        S.conv.data.conversation.visitor_read_at = ev.at;
        renderMessages();
      }
      break;

    case 'agents': {
      S.agents = ev.agents;
      const me = ev.agents.find(a => a.id === S.me.id);
      const permsChanged = me && (JSON.stringify(me.perms) !== JSON.stringify(S.me.perms) || me.role !== S.me.role);
      if (me) Object.assign(S.me, { status: me.status, name: me.name, color: me.color, title: me.title, role: me.role, perms: me.perms });
      if (permsChanged && S.conv?.data) openConv(S.conv.id, { keep: true });
      renderRail();
      if (S.conv?.data) { renderThreadHead(); renderViewers(); }
      if (S.route.name === 'team') window.Pages?.team?.render?.();
      break;
    }

    case 'viewing':
      S.viewers = ev.viewers || {};
      renderViewers();
      break;

    case 'visitor': {
      const v = ev.visitor;
      if (v.online) S.visitors.set(v.id, v); else S.visitors.delete(v.id);
      if (S.conv?.data?.visitor?.id === v.id) {
        Object.assign(S.conv.data.visitor, { online: v.online, current_url: v.current_url, current_title: v.current_title });
        if (S.conv.data.conversation) S.conv.data.conversation.visitor_online = v.online;
        renderThreadHead(); renderSide();
      }
      const item = S.inbox.list.find(c => c.visitor_id === v.id);
      if (item) { item.visitor_online = v.online; renderListItem(item.id); }
      renderRail();
      if (S.route.name === 'visitors') window.Pages?.visitors?.render?.();
      break;
    }

    case 'visitor_updated':
      if (S.conv?.data?.visitor?.id === ev.visitor.id) { Object.assign(S.conv.data.visitor, ev.visitor); renderSide(); }
      break;

    case 'notify':
      if (ev.kind === 'new') {
        ding('new');
        toast({ title: 'שיחה חדשה 💬', text: `${ev.name || 'מבקר'}: ${ev.preview || ''}`, ic: 'inbox', onclick: () => go(`c/${ev.convId}`), ms: 8000 });
        desktopNotify('שיחה חדשה', `${ev.name || 'מבקר'}: ${ev.preview || ''}`, ev.convId);
      } else if (ev.kind === 'whisper') {
        ding('whisper');
        toast({ title: `🤫 ${ev.from} כתב/ה לך`, text: ev.text, kind: 'whisper', ic: 'whisper', onclick: () => go(`c/${ev.convId}`), ms: 9000 });
        desktopNotify(`🤫 ${ev.from} כתב/ה לך בשיחה #${ev.convId}`, ev.text, ev.convId);
      } else if (ev.kind === 'paid') {
        ding('new');
        toast({ title: `💳 התקבל תשלום בשיחה #${ev.convId}`, text: ev.text + (ev.upgradeFailed ? ' · ⚠️ השדרוג האוטומטי נכשל' : ''), kind: ev.upgradeFailed ? 'error' : '', ic: 'card', onclick: () => go(`c/${ev.convId}`), ms: 10000 });
        desktopNotify('💳 התקבל תשלום', ev.text, ev.convId);
      } else if (ev.kind === 'assigned') {
        ding('new');
        toast({ title: `שיחה #${ev.convId} הועברה אליך`, text: ev.by ? `על ידי ${ev.by}` : 'שיבוץ אוטומטי', ic: 'arrowIn', onclick: () => go(`c/${ev.convId}`), ms: 8000 });
        desktopNotify(`שיחה #${ev.convId} הועברה אליך`, ev.by ? `על ידי ${ev.by}` : '', ev.convId);
      }
      break;

    case 'canned': S.canned = ev.canned; if (S.route.name === 'canned') window.Pages?.canned?.render?.(); break;
    case 'settings': S.settings = ev.settings; updateTitle(); break;
  }
}

// Stale typing indicators disappear on their own.
setInterval(() => {
  const now = Date.now();
  for (const [id, t] of Object.entries(S.typing)) {
    let changed = false;
    if (t.visitor && now - t.visitor.at > 9000) { delete t.visitor; changed = true; }
    for (const [aid, a] of Object.entries(t.agents || {})) if (now - a.at > 9000) { delete t.agents[aid]; changed = true; }
    if (changed && S.conv?.id === Number(id)) { renderTypingSneak(); renderTypingLine(); }
    if (changed) renderListItem(Number(id));
  }
}, 3000);

// =============================================================================
// Shell
// =============================================================================

const NAV = [
  ['inbox', 'inbox', 'שיחות'],
  ['visitors', 'eye', 'מבקרים באתר'],
  ['history', 'history', 'היסטוריה'],
  ['analytics', 'chart', 'דוחות'],
  ['team', 'users', 'צוות'],
  ['canned', 'zap', 'תשובות מוכנות'],
  ['settings', 'settings', 'הגדרות'],
];
// On a phone the bottom bar shows these; the rest live under "עוד".
const MOBILE_NAV = ['inbox', 'visitors', 'history'];
const SHORT_LABEL = { visitors: 'מבקרים', canned: 'תשובות' };
const isMobile = () => matchMedia('(max-width: 820px)').matches;

function renderShell() {
  const app = clear($('#app'));
  app.append(h('div', { class: 'app' }, h('nav', { class: 'rail', 'aria-label': 'ניווט' }), h('main', { class: 'main' })));
  renderRail();
  updateTitle();
}

function renderRail() {
  const rail = $('.rail');
  if (!rail) return;
  clear(rail);
  const me = S.agents.find(a => a.id === S.me.id) || S.me;
  const presence = S.connected || me.connected ? me.status : '';
  rail.append(
    h('div', { class: 'logo-mark', title: 'reem.bi' }, icon('logo')),
    ...NAV.filter(([k]) => k !== 'settings' || isAdmin()).map(([key, ic, label]) => {
      const badge = key === 'inbox' ? (S.counts.unread || S.counts.unassigned || 0) : key === 'visitors' ? S.visitors.size : 0;
      return h('button', { class: `nav-btn ${S.route.name === key ? 'on' : ''} ${MOBILE_NAV.includes(key) ? '' : 'desk-only'}`, onclick: () => go(key), 'aria-label': label },
        icon(ic),
        badge ? h('span', { class: `count ${key === 'inbox' ? 'red' : ''}` }, badge > 99 ? '99+' : badge) : null,
        h('span', { class: 'lbl' }, SHORT_LABEL[key] || label),
        h('span', { class: 'tip' }, label));
    }),
    h('button', {
      class: `nav-btn mobile-only ${NAV.some(([k]) => k === S.route.name && !MOBILE_NAV.includes(k)) ? 'on' : ''}`,
      onclick: e => moreMenu(e.currentTarget), 'aria-label': 'עוד',
    }, icon('more'), h('span', { class: 'lbl' }, 'עוד')),
    h('div', { class: 'spacer' }),
    h('button', { class: 'nav-btn desk-only', onclick: toggleSound, 'aria-label': S.sound ? 'השתקת צלילים' : 'הפעלת צלילים' },
      icon(S.sound ? 'volume' : 'mute'), h('span', { class: 'tip' }, S.sound ? 'צלילים פעילים' : 'צלילים מושתקים')),
    h('button', { class: 'me-btn', onclick: e => meMenu(e.currentTarget), 'aria-label': 'הפרופיל שלי' }, avatar(me, '', presence), h('span', { class: 'lbl' }, 'אני')),
  );
}

/** Phone: the pages that don't fit in the bottom bar, plus sound. */
function moreMenu(anchor) {
  popover(anchor, [
    ...NAV.filter(([k]) => !MOBILE_NAV.includes(k) && (k !== 'settings' || isAdmin()))
      .map(([key, ic, label]) => h('button', { class: `item ${S.route.name === key ? 'active' : ''}`, onclick: () => { closePop(); go(key); } }, icon(ic), label)),
    h('div', { class: 'sep' }),
    popItem(S.sound ? 'volume' : 'mute', S.sound ? 'השתקת צלילים' : 'הפעלת צלילים', toggleSound),
  ], { align: 'end' });
}

function toggleSound() {
  S.sound = !S.sound;
  localStorage.setItem('chat_admin_sound', S.sound ? '1' : '0');
  if (S.sound) ding();
  renderRail();
}

function setTheme(t) {
  if (t === 'auto') { delete document.documentElement.dataset.theme; localStorage.removeItem('chat_admin_theme'); }
  else { document.documentElement.dataset.theme = t; localStorage.setItem('chat_admin_theme', t); }
}

function meMenu(anchor) {
  const theme = document.documentElement.dataset.theme || 'auto';
  const setStatus = async status => {
    try { S.me = (await api('a/me', { method: 'POST', body: { status } })).me; renderRail(); } catch (e) { toastError(e); }
  };
  popover(anchor, [
    h('div', { class: 'head row' }, avatar(S.me), h('div', { class: 'grow' }, h('div', { style: { fontWeight: 700 } }, S.me.name), h('div', { class: 'muted ltr ellipsis', style: { fontSize: '12.5px' } }, S.me.email))),
    h('div', { class: 'sep' }),
    h('button', { class: 'item', onclick: () => { closePop(); setStatus('online'); } }, h('span', { class: 'pres online', style: { width: '10px', height: '10px', borderRadius: '50%', display: 'inline-block' } }), 'זמין/ה', S.me.status === 'online' ? h('span', { class: 'check' }, icon('check', 16)) : null),
    h('button', { class: 'item', onclick: () => { closePop(); setStatus('away'); } }, h('span', { class: 'pres away', style: { width: '10px', height: '10px', borderRadius: '50%', display: 'inline-block' } }), 'לא זמין/ה', S.me.status === 'away' ? h('span', { class: 'check' }, icon('check', 16)) : null),
    h('div', { class: 'sep' }),
    popItem('user', 'הפרופיל שלי', profileModal),
    'Notification' in window && Notification.permission !== 'granted' ? popItem('bell', 'הפעלת התראות בדפדפן', () => Notification.requestPermission().then(renderInboxBanner)) : null,
    popItem(theme === 'dark' ? 'sun' : 'moon', theme === 'dark' ? 'מצב בהיר' : 'מצב כהה', () => setTheme(theme === 'dark' ? 'light' : 'dark')),
    h('div', { class: 'sep' }),
    popItem('logout', 'התנתקות', async () => { await api('auth/logout', { method: 'POST' }); location.href = '/admin/'; }, 'danger'),
  ], { align: 'start' });
}

function profileModal() {
  const me = S.me;
  const f = {
    name: h('input', { class: 'input', value: me.name }),
    title: h('input', { class: 'input', value: me.title, placeholder: 'למשל: תמיכה טכנית' }),
    color: h('input', { type: 'color', value: me.color }),
    signature: h('textarea', { class: 'input', rows: 2, placeholder: 'לא חובה' }, me.signature || ''),
    notify: h('input', { type: 'checkbox', checked: me.notify_email }),
    cur: h('input', { class: 'input ltr', type: 'password', autocomplete: 'current-password' }),
    pass: h('input', { class: 'input ltr', type: 'password', autocomplete: 'new-password', placeholder: 'להשאיר ריק כדי לא לשנות' }),
  };
  modal({
    title: 'הפרופיל שלי',
    body: [
      h('div', { class: 'row', style: { gap: '14px', marginBottom: '18px' } }, avatar(me, 'lg'), h('div', null, h('div', { style: { fontWeight: 700 } }, me.email), h('div', { class: 'muted' }, me.role === 'admin' ? 'מנהל/ת' : 'נציג/ה'))),
      h('div', { class: 'grid', style: { gridTemplateColumns: '1fr 1fr' } },
        h('div', { class: 'field' }, h('label', { class: 'label' }, 'שם'), f.name),
        h('div', { class: 'field' }, h('label', { class: 'label' }, 'תפקיד (מוצג ללקוחות)'), f.title)),
      h('div', { class: 'field' }, h('label', { class: 'label' }, 'צבע'), h('div', { class: 'color-input' }, f.color)),
      h('div', { class: 'field' }, h('label', { class: 'label' }, 'חתימה לתשובות מוכנות ({signature})'), f.signature),
      h('label', { class: 'switch field' }, f.notify, h('span', { class: 'track' }), 'התראות במייל כשאני לא מחובר/ת'),
      h('div', { class: 'sep', style: { height: '1px', background: 'var(--line)', margin: '6px 0 16px' } }),
      h('div', { class: 'grid', style: { gridTemplateColumns: '1fr 1fr' } },
        h('div', { class: 'field' }, h('label', { class: 'label' }, 'סיסמה נוכחית'), f.cur),
        h('div', { class: 'field' }, h('label', { class: 'label' }, 'סיסמה חדשה'), f.pass)),
    ],
    foot: close => [
      h('button', { class: 'btn', onclick: close }, 'ביטול'),
      h('button', {
        class: 'btn primary',
        onclick: async () => {
          try {
            const body = { name: f.name.value, title: f.title.value, color: f.color.value, signature: f.signature.value, notify_email: f.notify.checked };
            if (f.pass.value) Object.assign(body, { password: f.pass.value, current_password: f.cur.value });
            S.me = (await api('a/me', { method: 'POST', body })).me;
            renderRail(); close(); toast({ title: 'הפרופיל נשמר' });
          } catch (e) { toastError(e); }
        },
      }, 'שמירה'),
    ],
  });
}

function route() {
  closePop();
  document.querySelectorAll('.overlay').forEach(el => el.remove());
  const r = parseRoute();
  if (r.name === 'settings' && !isAdmin()) return go('inbox');
  const prev = S.route;
  S.route = r;
  renderRail();
  if (r.name === 'inbox') {
    if (prev.name !== 'inbox' || !$('.inbox')) renderInbox();
    if (r.convId) openConv(r.convId);
    else closeConv();
    return;
  }
  if (S.conv) { S.conv = null; wsSend({ t: 'view', convId: null }); }
  const main = clear($('.main'));
  renderConnBanner();
  const page = window.Pages?.[r.name];
  if (page) page.mount(main, r.params);
  else go('inbox');
}

// =============================================================================
// Inbox
// =============================================================================

const VIEWS = [['mine', 'שלי'], ['unassigned', 'ממתינות'], ['open', 'כל הפתוחות'], ['closed', 'סגורות']];

function renderInbox() {
  const main = clear($('.main'));
  renderConnBanner();
  const search = h('input', { class: 'input', type: 'search', placeholder: 'חיפוש לפי שם, מייל, #מספר או תוכן…', value: S.inbox.q });
  search.addEventListener('input', debounce(() => { S.inbox.q = search.value.trim(); loadList(); }, 300));
  main.append(
    h('div', { class: 'notif-slot' }),
    h('div', { class: 'inbox' },
      h('section', { class: 'list-col' },
        h('div', { class: 'list-head' },
          h('h2', null, 'שיחות', h('span', { class: 'grow' }),
            h('button', { class: 'icon-btn', title: 'רענון', onclick: () => loadList() }, icon('refresh'))),
          h('div', { class: 'search' }, icon('search'), search)),
        h('div', { class: 'tabs', role: 'tablist' }),
        h('div', { class: 'conv-list' })),
      h('section', { class: 'thread-col' }),
      h('aside', { class: 'side-col' })));
  renderInboxBanner();
  renderTabs();
  loadList();
  if (!parseRoute().convId) renderThreadEmpty();
}

function renderInboxBanner() {
  const slot = $('.notif-slot');
  if (!slot) return;
  clear(slot);
  if (!('Notification' in window) || Notification.permission !== 'default' || localStorage.getItem('chat_admin_notif_dismissed')) return;
  slot.append(h('div', { class: 'notif-banner' }, icon('bell'), h('span', { class: 'grow' }, 'רוצים לקבל התראה על הודעות חדשות גם כשהלשונית ברקע?'),
    h('button', { class: 'btn sm primary', onclick: () => Notification.requestPermission().then(renderInboxBanner) }, 'הפעלת התראות'),
    h('button', { class: 'icon-btn', onclick: () => { localStorage.setItem('chat_admin_notif_dismissed', '1'); renderInboxBanner(); } }, icon('x'))));
}

function renderTabs() {
  const tabs = $('.tabs');
  if (!tabs) return;
  clear(tabs).append(...VIEWS.map(([k, label]) => {
    const n = k === 'closed' ? 0 : S.counts[k] || 0;
    return h('button', { class: S.inbox.view === k ? 'on' : '', role: 'tab', onclick: () => { S.inbox.view = k; localStorage.setItem('chat_admin_view', k); renderTabs(); loadList(); } },
      label, n ? h('span', { class: 'count' }, n) : null);
  }));
}

let listReq = 0;
async function loadList(more = false) {
  const my = ++listReq;
  const p = new URLSearchParams({ view: S.inbox.view });
  if (S.inbox.q) p.set('q', S.inbox.q);
  if (more && S.inbox.list.length) p.set('before', S.inbox.list[S.inbox.list.length - 1].last_message_at);
  if (!more) { S.inbox.loading = true; renderListItems(); }
  try {
    const d = await api(`a/conversations?${p}`);
    if (my !== listReq) return;
    S.inbox.list = more ? [...S.inbox.list, ...d.conversations] : d.conversations;
    for (const c of d.conversations) S.known.set(c.id, c);
    S.inbox.more = d.more;
    S.counts = d.counts;
  } catch (e) { toastError(e); }
  S.inbox.loading = false;
  renderListItems(); renderTabs(); renderRail(); updateTitle();
}

function matchesView(c) {
  const v = S.inbox.view;
  if (v === 'mine') return c.status === 'open' && c.assigned_agent_id === S.me.id;
  if (v === 'unassigned') return c.status === 'open' && !c.assigned_agent_id;
  if (v === 'open') return c.status === 'open';
  if (v === 'closed') return c.status === 'closed';
  return true;
}

function upsertListItem(conv) {
  const i = S.inbox.list.findIndex(c => c.id === conv.id);
  const fits = matchesView(conv);
  if (i >= 0 && !fits) S.inbox.list.splice(i, 1);
  else if (i >= 0) S.inbox.list[i] = conv;
  else if (fits && !S.inbox.q) S.inbox.list.push(conv);
  else return;
  S.inbox.list.sort((a, b) => b.last_message_at - a.last_message_at);
  renderListItems();
}

function renderListItems() {
  const box = $('.conv-list');
  if (!box) return;
  const scroll = box.scrollTop;
  clear(box);
  if (S.inbox.loading && !S.inbox.list.length) {
    for (let i = 0; i < 6; i++) box.append(h('div', { class: 'conv' }, h('div', { class: 'skeleton', style: { width: '36px', height: '36px', borderRadius: '50%' } }), h('div', { class: 'grow stack' }, h('div', { class: 'skeleton', style: { height: '12px', width: '60%' } }), h('div', { class: 'skeleton', style: { height: '11px', width: '85%' } }))));
    return;
  }
  if (!S.inbox.list.length) {
    const msgs = { mine: ['אין לך שיחות פתוחות', 'שיחות שמשובצות אליך יופיעו כאן'], unassigned: ['אין שיחות ממתינות 🎉', 'כל הלקוחות קיבלו מענה'], open: ['אין שיחות פתוחות', 'כשמישהו יכתוב בצ׳אט, זה יופיע כאן'], closed: ['אין שיחות סגורות', ''] };
    const [t, s] = S.inbox.q ? ['לא נמצאו תוצאות', 'נסו חיפוש אחר'] : msgs[S.inbox.view] || ['', ''];
    box.append(h('div', { class: 'empty' }, h('div', { class: 'e-ic' }, icon(S.inbox.q ? 'search' : 'inbox')), h('h3', null, t), h('div', null, s)));
    return;
  }
  for (const c of S.inbox.list) box.append(listItem(c));
  if (S.inbox.more) box.append(h('button', { class: 'btn sm load-more', onclick: () => loadList(true) }, 'טעינת עוד'));
  box.scrollTop = scroll;
}

function listItem(c) {
  const agent = agentById(c.assigned_agent_id);
  const t = S.typing[c.id];
  const unread = c.unread_agent > 0 && c.status === 'open';
  const waiting = c.status === 'open' && !c.first_response_at && !c.offline;
  return h('button', {
    class: `conv ${S.conv?.id === c.id ? 'on' : ''} ${unread ? 'unread' : ''} ${waiting ? 'waiting' : ''}`,
    'data-id': c.id, onclick: () => go(`c/${c.id}`),
  },
  visitorAvatar(c, '', c.visitor_online),
  h('div', { class: 'grow' },
    h('div', { class: 'c-top' },
      h('span', { class: 'c-name ellipsis' }, c.visitor_name || `מבקר #${c.id}`),
      c.country ? h('span', { class: 'flag', title: countryName(c.country) }, flag(c.country)) : null,
      h('span', { class: 'c-time' }, ago(c.last_message_at))),
    h('div', { class: 'c-prev' }, t?.visitor
      ? h('span', { class: 'typing-inline' }, 'מקליד/ה…')
      : [c.last_sender === 'agent' ? h('span', { class: 'faint' }, 'את/ה: ') : null, c.last_message_preview || '—']),
    h('div', { class: 'c-foot' },
      c.offline ? h('span', { class: 'badge warn' }, icon('mail', 12), 'הודעה מחוץ לשעות') : null,
      waiting ? h('span', { class: 'badge warn' }, icon('clock', 12), `ממתין ${ago(c.created_at)}`) : null,
      c.topic ? h('span', { class: 'badge' }, c.topic) : null,
      ...c.tags.slice(0, 2).map(tg => h('span', { class: 'tag' }, tg)),
      h('span', { class: 'grow' }),
      c.rating ? h('span', { class: 'badge', style: { color: '#b45309' } }, '★', c.rating) : null,
      agent ? avatar(agent, 'xs') : null,
      unread ? h('span', { class: 'count red' }, c.unread_agent) : null)));
}

function renderListItem(id) {
  const el = $(`.conv[data-id="${id}"]`);
  const c = S.inbox.list.find(x => x.id === id);
  if (el && c) el.replaceWith(listItem(c));
}

// ---------- thread ----------

function renderThreadEmpty() {
  const col = $('.thread-col');
  if (!col) return;
  $('.inbox')?.classList.remove('has-conv');
  clear(col).append(h('div', { class: 'center-fill' }, h('div', { class: 'empty' },
    h('div', { class: 'e-ic' }, icon('msg')),
    h('h3', null, `שלום ${S.me.name.split(' ')[0]} 👋`),
    h('div', null, 'בחרו שיחה מהרשימה כדי להתחיל'),
    h('div', { class: 'row', style: { justifyContent: 'center', marginTop: '18px', gap: '10px' } },
      h('span', { class: 'badge brand' }, `${S.agents.filter(a => a.online).length} נציגים זמינים`),
      h('span', { class: 'badge' }, `${S.visitors.size} מבקרים באתר`)))));
  clear($('.side-col'));
}

function closeConv() {
  if (S.conv) wsSend({ t: 'view', convId: null });
  S.conv = null;
  renderThreadEmpty();
  document.querySelectorAll('.conv.on').forEach(el => el.classList.remove('on'));
}

async function openConv(id, { keep } = {}) {
  if (!keep && S.conv?.id === id && S.conv.data) return;
  if (S.conv?.id && S.conv.id !== id && S.composer) S.drafts[S.conv.id] = S.composer.ta.value;
  S.conv = { id, data: keep ? S.conv?.data : null };
  $('.inbox')?.classList.add('has-conv');
  document.querySelectorAll('.conv').forEach(el => el.classList.toggle('on', Number(el.dataset.id) === id));
  wsSend({ t: 'view', convId: id });
  if (!keep) {
    $('.side-col')?.classList.remove('force');
    const col = clear($('.thread-col'));
    col.append(h('div', { class: 'center-fill' }, h('div', { class: 'spinner' })));
    clear($('.side-col'));
  }
  try {
    const d = await api(`a/conversations/${id}`);
    if (S.conv?.id !== id) return;
    S.conv.data = d;
    renderThread();
    renderSide();
    if (d.conversation.unread_agent > 0 || d.conversation.status === 'open') markRead(id);
  } catch (e) {
    toastError(e);
    if (e.status === 404) go('inbox');
  }
}

const markRead = debounce(id => {
  const item = S.inbox.list.find(c => c.id === id);
  if (item && item.unread_agent) { item.unread_agent = 0; renderListItem(id); }
  api(`a/conversations/${id}/read`, { method: 'POST' }).then(refreshCounts).catch(() => {});
}, 400);

function renderThread() {
  const col = clear($('.thread-col'));
  col.append(
    h('header', { class: 'thread-head' }),
    h('div', { class: 'viewers hidden' }),
    h('div', { class: 'messages', role: 'log', 'aria-live': 'polite' }),
    h('div', { class: 'agent-typing' }),
    h('div', { class: 'composer-area' }));
  S.renderedMaxId = 0;
  // Stay pinned to the newest message when the list's box changes size — the composer is added
  // (and grows while typing) after the messages are drawn, which used to leave them off-screen.
  const box = $('.messages');
  S.msgStick = true;
  box.addEventListener('scroll', () => { S.msgStick = box.scrollHeight - box.scrollTop - box.clientHeight < 120; }, { passive: true });
  if (window.ResizeObserver) new ResizeObserver(() => { if (S.msgStick) box.scrollTop = box.scrollHeight; }).observe(box);
  renderThreadHead();
  renderViewers();
  renderMessages(true);
  renderTypingLine();
  renderComposerArea(true);
  box.scrollTop = box.scrollHeight; // now that the composer has taken its space
}

function renderThreadHead() {
  const head = $('.thread-head');
  if (!head || !S.conv?.data) return;
  const { conversation: c, visitor: v } = S.conv.data;
  const agent = agentById(c.assigned_agent_id);
  const online = v.online ?? c.visitor_online;
  clear(head).append(
    h('button', { class: 'icon-btn back-btn', onclick: () => go('inbox'), 'aria-label': 'חזרה' }, icon('back')),
    h('button', { class: 't-who', onclick: () => { if (isMobile()) $('.side-col').classList.add('force'); }, 'aria-label': 'פרטי הלקוח' }, visitorAvatar({ ...c, name: v.name }, '', online)),
    h('div', { class: 'grow', onclick: () => { if (isMobile()) $('.side-col').classList.add('force'); } },
      h('div', { class: 't-name' }, h('span', { class: 'ellipsis' }, v.name || `מבקר #${c.id}`), h('span', { class: 'faint', style: { fontWeight: 500, fontSize: '13px' } }, `#${c.id}`),
        c.status === 'closed' ? h('span', { class: 'badge' }, 'סגורה') : null),
      h('div', { class: 't-sub' },
        online ? [h('span', { class: 'pulse' }), 'באתר עכשיו'] : [`נראה/תה ${ago(v.last_seen)}`],
        v.current_url ? [h('span', { class: 'faint' }, '·'), h('a', { href: v.current_url, target: '_blank', rel: 'noopener', class: 'ellipsis', style: { maxWidth: '300px' } }, v.current_title || v.current_url)] : null)),
    window.Tools.translateChip(c) || '',
    h('button', { class: 'assignee', onclick: e => assignMenu(e.currentTarget), title: agent ? `משויך ל${agent.name}` : 'לא משויך' },
      agent ? avatar(agent, 'xs') : icon('user'), h('span', { class: 'as-name' }, agent ? agent.name : 'לא משויך'), icon('chevron')),
    c.status === 'open'
      ? h('button', { class: 'btn primary sm', onclick: () => convAction('close'), title: 'סגירת השיחה' }, icon('check'), h('span', { class: 'btn-lbl' }, 'סגירה'))
      : h('button', { class: 'btn sm', onclick: () => convAction('reopen'), title: 'פתיחה מחדש' }, icon('refresh'), h('span', { class: 'btn-lbl' }, 'פתיחה מחדש')),
    h('button', { class: 'icon-btn', onclick: () => $('.side-col').classList.toggle('force'), title: 'פרטי הלקוח' }, icon('sidebar')),
    h('button', { class: 'icon-btn', onclick: e => convMenu(e.currentTarget), 'aria-label': 'עוד פעולות' }, icon('more')));
}

function renderViewers() {
  const bar = $('.viewers');
  if (!bar || !S.conv) return;
  const others = (S.viewers[S.conv.id] || []).filter(id => id !== S.me.id).map(agentById).filter(Boolean);
  bar.classList.toggle('hidden', !others.length);
  clear(bar).append(icon('eye', 15), ...others.map(a => avatar(a, 'xs')), `${others.map(a => a.name).join(', ')} ${others.length > 1 ? 'צופים' : 'צופה'} גם בשיחה הזו`);
}

function assignMenu(anchor) {
  const c = S.conv.data.conversation;
  const assign = async id => {
    try { await api(`a/conversations/${c.id}/assign`, { method: 'POST', body: { agent_id: id } }); } catch (e) { toastError(e); }
  };
  popover(anchor, [
    h('div', { class: 'head muted', style: { fontSize: '12px', fontWeight: 700 } }, 'שיוך / העברה'),
    c.assigned_agent_id !== S.me.id ? popItem('arrowIn', 'לקחת את השיחה אליי', () => assign(S.me.id)) : null,
    ...S.agents.filter(a => !a.disabled && !a.pending).map(a => h('button', { class: `item ${a.id === c.assigned_agent_id ? 'active' : ''}`, onclick: () => { closePop(); assign(a.id); } },
      avatar(a, 'sm', a.online ? 'online' : a.connected ? 'away' : ''),
      h('div', { class: 'grow' }, h('div', null, a.name + (a.id === S.me.id ? ' (אני)' : '')), h('div', { class: 'muted', style: { fontSize: '12px' } }, `${a.active_chats}/${a.max_chats} שיחות · ${a.online ? 'זמין' : a.connected ? 'לא זמין' : 'לא מחובר'}`)),
      a.id === c.assigned_agent_id ? h('span', { class: 'check' }, icon('check', 16)) : null)),
    h('div', { class: 'sep' }),
    popItem('inbox', 'החזרה לתור (ללא שיוך)', () => assign(null)),
  ], { align: 'end' });
}

async function convAction(action) {
  const c = S.conv.data.conversation;
  try {
    const d = await api(`a/conversations/${c.id}/${action}`, { method: 'POST' });
    if (d.conversation) { S.conv.data.conversation = d.conversation; renderThreadHead(); renderComposerArea(); }
    if (action === 'close') toast({ title: `שיחה #${c.id} נסגרה`, text: S.settings.rating ? 'הלקוח/ה יתבקש/ת לדרג את השירות' : '' });
  } catch (e) { toastError(e); }
}

function convMenu(anchor) {
  const { conversation: c, visitor: v } = S.conv.data;
  popover(anchor, [
    popItem('mail', 'שליחת תמליל במייל', () => transcriptModal(c, v)),
    popItem('copy', 'העתקת קישור לשיחה', () => { navigator.clipboard.writeText(`${location.origin}/admin/#/c/${c.id}`); toast({ title: 'הקישור הועתק' }); }),
    popItem('history', 'כל השיחות של הלקוח', () => go(`history/visitor/${v.id}`)),
    isAdmin() && c.status === 'open' ? popItem('shield', 'הרשאות זמניות לשיחה הזו', () => window.Tools.grantsModal()) : null,
    h('div', { class: 'sep' }),
    popItem('ban', v.blocked ? 'ביטול חסימה' : 'חסימת המבקר', async () => {
      if (!v.blocked && !(await confirmModal({ title: 'לחסום את המבקר?', text: 'הצ׳אט ייעלם אצלו והוא לא יוכל לשלוח הודעות.', ok: 'חסימה', danger: true }))) return;
      try { const d = await api(`a/visitors/${v.id}`, { method: 'POST', body: { blocked: !v.blocked } }); Object.assign(v, d.visitor); renderSide(); toast({ title: v.blocked ? 'המבקר נחסם' : 'החסימה בוטלה' }); } catch (e) { toastError(e); }
    }, 'danger'),
    isAdmin() ? popItem('trash', 'מחיקת השיחה', async () => {
      if (!(await confirmModal({ title: `למחוק את שיחה #${c.id}?`, text: 'כל ההודעות והקבצים יימחקו לצמיתות.', ok: 'מחיקה', danger: true }))) return;
      try { await api(`a/conversations/${c.id}/delete`, { method: 'POST' }); toast({ title: 'השיחה נמחקה' }); } catch (e) { toastError(e); }
    }, 'danger') : null,
  ], { align: 'end' });
}

function transcriptModal(c, v) {
  const email = h('input', { class: 'input ltr', type: 'email', value: v.email || '', placeholder: 'customer@example.com' });
  modal({
    title: 'שליחת תמליל השיחה',
    body: [h('p', { class: 'muted', style: { marginBottom: '14px' } }, 'הלקוח יקבל מייל מעוצב עם כל ההודעות (בלי הערות פנימיות).'), h('div', { class: 'field' }, h('label', { class: 'label' }, 'לכתובת'), email)],
    foot: close => [h('button', { class: 'btn', onclick: close }, 'ביטול'), h('button', {
      class: 'btn primary',
      onclick: async () => {
        try { const d = await api(`a/conversations/${c.id}/transcript`, { method: 'POST', body: { email: email.value } }); close(); toast({ title: d.dev ? 'מצב פיתוח — המייל רק נרשם בלוג' : 'התמליל נשלח ✓' }); } catch (e) { toastError(e); }
      },
    }, icon('send'), 'שליחה')],
  });
}

// ---------- messages ----------

const EVENT_ICONS = { joined: 'arrowIn', transferred: 'route', closed: 'check', reopened: 'refresh', unassigned: 'inbox', rated: 'star', note: 'mail', paid: 'card' };

function renderMessages(forceBottom) {
  const box = $('.messages');
  if (!box || !S.conv?.data) return;
  const stick = forceBottom || box.scrollHeight - box.scrollTop - box.clientHeight < 120;
  const { messages, conversation: c, visitor: v } = S.conv.data;
  const prevMax = S.renderedMaxId || 0;
  clear(box);
  let lastDay = null;
  const lastAgentMsg = [...messages].reverse().find(m => m.sender_type === 'agent' && m.kind !== 'whisper');
  messages.forEach((m, i) => {
    const day = new Date(m.created_at).toDateString();
    if (day !== lastDay) { box.append(h('div', { class: 'day-sep' }, fmtDay(m.created_at))); lastDay = day; }
    if (m.kind === 'event') {
      box.append(h('div', { class: 'event' }, h('span', null, icon(EVENT_ICONS[m.meta?.type] || 'clock'), m.body, h('span', { class: 'faint' }, fmtTime(m.created_at)))));
      return;
    }
    const next = messages[i + 1]; const prev = messages[i - 1];
    const same = (a, b) => a && b && a.kind !== 'event' && b.kind !== 'event' && a.sender_type === b.sender_type && a.agent_id === b.agent_id && (a.kind === 'whisper') === (b.kind === 'whisper') && Math.abs(a.created_at - b.created_at) < 5 * 60000;
    const isLast = !same(m, next);
    const isFirst = !same(prev, m);
    const fromVisitor = m.sender_type === 'visitor';
    const whisper = m.kind === 'whisper';
    const agent = agentById(m.agent_id);
    let bubble;
    if (m.kind === 'file') {
      bubble = /^image\//.test(m.meta?.mime || '')
        ? h('div', { class: 'bubble img' }, h('img', { src: m.meta.url, alt: m.body, loading: 'lazy', onclick: () => lightbox(m.meta.url), onload: () => { if (stick) box.scrollTop = box.scrollHeight; } }))
        : h('a', { class: 'bubble file', href: m.meta?.url, target: '_blank', rel: 'noopener' }, icon('file'), h('div', null, h('div', null, m.body), h('div', { style: { fontSize: '12px', opacity: '.7' } }, `${Math.round((m.meta?.size || 0) / 1024)} KB`)));
    } else if (m.kind === 'pay') {
      bubble = window.Tools.payCard(m);
    } else {
      bubble = h('div', { class: 'bubble' });
      if (whisper) bubble.append(h('div', { class: 'whisper-label' }, icon('lock'), 'הערה פנימית · הלקוח לא רואה'));
      const tr = m.meta?.tr;
      if (tr?.text && fromVisitor) {
        // The customer's message, translated for us; the original underneath.
        bubble.append(linkify(tr.text), h('div', { class: 'tr-orig' }, icon('translate', 12), `${langName(tr.from)}: `, h('span', { dir: 'auto' }, m.body)));
      } else {
        bubble.append(linkify(m.body, { mentions: whisper }));
        if (tr?.text) bubble.append(h('div', { class: 'tr-orig' }, icon('translate', 12), `נשלח ללקוח ב${langName(tr.lang)}: `, h('span', { dir: 'auto' }, tr.text)));
        else if (m.meta?.tr_failed) bubble.append(h('div', { class: 'tr-orig' }, icon('alert', 12), 'התרגום נכשל — נשלח כפי שנכתב'));
      }
    }
    const seen = m === lastAgentMsg && c.visitor_read_at && c.visitor_read_at >= m.created_at;
    const cls = ['msg', fromVisitor ? 'visitor' : whisper ? 'whisper' : 'agent', !fromVisitor && m.agent_id !== S.me.id ? 'other' : '', isLast ? 'last' : '', m._pending ? 'pending' : ''];
    const el = h('div', { class: cls.join(' ') },
      fromVisitor ? visitorAvatar({ ...c, name: v.name }, 'sm') : avatar(agent || { name: m.sender_name, color: m.meta?.color }, 'sm'),
      h('div', { class: 'm-body' },
        isFirst ? h('div', { class: 'm-who' }, fromVisitor ? (v.name || 'מבקר') : (m.sender_name || agent?.name) + (m.agent_id === S.me.id ? ' (את/ה)' : '')) : null,
        bubble,
        isLast || m._failed ? h('div', { class: 'm-meta' }, m._failed ? h('span', { style: { color: 'var(--danger)' } }, 'לא נשלח') : m._pending ? 'שולח…' : fmtTime(m.created_at), seen ? [icon('checks'), 'נקרא'] : null) : null));
    if (typeof m.id === 'number' && m.id <= prevMax) el.style.animation = 'none';
    box.append(el);
  });
  const sneak = h('div', { class: 'sneak-slot' });
  box.append(sneak);
  S.renderedMaxId = Math.max(prevMax, ...messages.map(m => (typeof m.id === 'number' ? m.id : 0)));
  renderTypingSneak();
  if (stick) box.scrollTop = box.scrollHeight;
}

function renderTypingSneak() {
  const slot = $('.sneak-slot');
  if (!slot || !S.conv?.data) return;
  const box = $('.messages');
  const stick = box.scrollHeight - box.scrollTop - box.clientHeight < 120;
  const t = S.typing[S.conv.id]?.visitor;
  clear(slot);
  if (t) {
    const { conversation: c, visitor: v } = S.conv.data;
    slot.append(h('div', { class: 'sneak', title: 'תצוגה מקדימה של מה שהלקוח מקליד' },
      visitorAvatar({ ...c, name: v.name }, 'sm'),
      h('div', { class: 'bubble' }, t.text ? t.text : '', h('span', { class: 'dots' }, h('i'), h('i'), h('i')))));
  }
  if (stick) box.scrollTop = box.scrollHeight;
}

function renderTypingLine() {
  const line = $('.agent-typing');
  if (!line || !S.conv) return;
  const agents = Object.values(S.typing[S.conv.id]?.agents || {});
  clear(line);
  if (agents.length) line.append(h('span', { class: 'typing-dots' }, h('i'), h('i'), h('i')), `${agents.map(a => a.name).join(', ')} ${agents.some(a => a.whisper) ? 'כותב/ת הערה פנימית' : 'מקליד/ה ללקוח'}…`);
}

function lightbox(src) {
  const el = h('div', { class: 'lightbox', onclick: () => el.remove() }, h('img', { src }));
  document.body.append(el);
}

// ---------- composer ----------

const EMOJI = ['😀', '😂', '😊', '😍', '🙏', '👍', '👌', '👏', '🎉', '❤️', '💚', '🔥', '🤔', '😅', '😢', '😮', '🙌', '✅', '❌', '⭐', '👋', '💡', '📦', '📞', '⏰', '📧', '🚀', '✨', '💪', '🙂', '😉', '🤝'];

function renderComposerArea(fresh) {
  const area = $('.composer-area');
  if (!area || !S.conv?.data) return;
  const c = S.conv.data.conversation;
  const blocked = S.conv.data.visitor.blocked;
  const wantClosed = c.status === 'closed';
  if (!fresh && S.composer && area.contains(S.composer.root) && !!S.composer.closedMode === wantClosed) {
    return; // keep the textarea (and what's typed in it) intact
  }
  if (S.composer?.ta && S.composer.convId) S.drafts[S.composer.convId] = S.composer.ta.value;
  clear(area);
  S.composer = buildComposer(c, { closedMode: wantClosed, blocked });
  area.append(S.composer.root);
}

function buildComposer(conv, { closedMode, blocked }) {
  let mode = closedMode ? 'whisper' : 'reply';
  const ta = h('textarea', { rows: 1, 'aria-label': 'הודעה' });
  ta.value = S.drafts[conv.id] || '';
  const suggest = h('div', { class: 'suggest hidden' });
  const fileIn = h('input', { type: 'file', class: 'hidden', onchange: e => { upload(e.target.files[0]); e.target.value = ''; } });
  const sendBtn = h('button', { class: 'btn primary sm send', onclick: () => send() }, icon('send'), 'שליחה');
  const box = h('div', { class: 'composer' });
  const tabs = h('div', { class: 'c-tabs' });
  let sugg = null; // { type, items, index, start }

  function setMode(m) {
    mode = m;
    box.classList.toggle('whisper', m === 'whisper');
    ta.placeholder = m === 'whisper'
      ? 'הערה פנימית לצוות — הלקוח לא יראה. @ כדי לתייג נציג/ה'
      : closedMode ? '' : isMobile() ? 'כתבו תשובה… (/ לתשובות מוכנות)' : 'כתבו תשובה… (/ לתשובות מוכנות, Enter לשליחה, Shift+Enter לשורה חדשה)';
    sendBtn.lastChild.textContent = m === 'whisper' ? 'הוספת הערה' : 'שליחה';
    clear(tabs).append(
      closedMode ? null : h('button', { class: m === 'reply' ? 'on' : '', onclick: () => { setMode('reply'); ta.focus(); } }, icon('msg'), 'תשובה ללקוח'),
      h('button', { class: m === 'whisper' ? 'on' : '', onclick: () => { setMode('whisper'); ta.focus(); } }, icon('lock'), isMobile() ? 'הערה פנימית' : 'Whisper · הערה פנימית'));
    hideSuggest();
  }

  function autosize() { ta.style.height = 'auto'; ta.style.height = `${Math.min(220, ta.scrollHeight)}px`; }

  let typingAt = 0; let typingOff;
  function typing() {
    if (closedMode) return;
    clearTimeout(typingOff);
    const now = Date.now();
    if (ta.value && now - typingAt > 2500) { typingAt = now; wsSend({ t: 'typing', convId: conv.id, on: true, whisper: mode === 'whisper' }); }
    typingOff = setTimeout(() => { typingAt = 0; wsSend({ t: 'typing', convId: conv.id, on: false, whisper: mode === 'whisper' }); }, ta.value ? 3500 : 0);
  }

  function fillPlaceholders(text) {
    const v = S.conv.data.visitor;
    return text
      .replace(/\{name\}/g, (v.name || '').split(' ')[0] || '')
      .replace(/\{agent\}/g, S.me.name.split(' ')[0])
      .replace(/\{signature\}/g, S.me.signature || '')
      .replace(/\{site\}/g, S.settings.site_name);
  }

  function checkSuggest() {
    const pos = ta.selectionStart;
    const before = ta.value.slice(0, pos);
    let m;
    if ((m = before.match(/(^|\s)\/([\w֐-׿-]*)$/))) {
      const q = m[2].toLowerCase();
      const items = S.canned.filter(x => x.shortcut.includes(q) || x.title.toLowerCase().includes(q)).slice(0, 8);
      return showSuggest({ type: 'canned', items, start: pos - m[2].length - 1 });
    }
    if (mode === 'whisper' && (m = before.match(/(^|\s)@([^\s@]*)$/))) {
      const q = m[2].toLowerCase();
      const items = S.agents.filter(a => !a.disabled && a.id !== S.me.id && a.name.toLowerCase().includes(q)).slice(0, 8);
      return showSuggest({ type: 'mention', items, start: pos - m[2].length - 1 });
    }
    hideSuggest();
  }

  function showSuggest(s) {
    if (!s.items.length) return hideSuggest();
    sugg = { ...s, index: 0 };
    drawSuggest();
  }
  function drawSuggest() {
    suggest.classList.remove('hidden');
    clear(suggest).append(...sugg.items.map((it, i) => h('button', {
      class: `s-item ${i === sugg.index ? 'on' : ''}`,
      onmousedown: e => { e.preventDefault(); pick(i); },
    }, sugg.type === 'canned'
      ? [h('span', { class: 's-key' }, `/${it.shortcut}`), h('div', { class: 'grow' }, h('div', { class: 's-title' }, it.title), h('div', { class: 's-body' }, it.body))]
      : [avatar(it, 'sm', it.online ? 'online' : ''), h('div', { class: 'grow' }, h('div', { class: 's-title' }, it.name), h('div', { class: 's-body' }, it.title || it.email))])));
    suggest.querySelector('.on')?.scrollIntoView({ block: 'nearest' });
  }
  function hideSuggest() { sugg = null; suggest.classList.add('hidden'); }
  function pick(i) {
    const it = sugg.items[i];
    const insert = sugg.type === 'canned' ? fillPlaceholders(it.body) : `@${it.name} `;
    const end = ta.selectionStart;
    ta.value = ta.value.slice(0, sugg.start) + insert + ta.value.slice(end);
    const caret = sugg.start + insert.length;
    ta.setSelectionRange(caret, caret);
    hideSuggest(); autosize(); ta.focus();
  }

  ta.addEventListener('input', () => { autosize(); checkSuggest(); typing(); S.drafts[conv.id] = ta.value; });
  ta.addEventListener('click', checkSuggest);
  ta.addEventListener('blur', () => setTimeout(hideSuggest, 150));
  ta.addEventListener('keydown', e => {
    if (sugg) {
      if (e.key === 'ArrowDown') { e.preventDefault(); sugg.index = (sugg.index + 1) % sugg.items.length; return drawSuggest(); }
      if (e.key === 'ArrowUp') { e.preventDefault(); sugg.index = (sugg.index - 1 + sugg.items.length) % sugg.items.length; return drawSuggest(); }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); return pick(sugg.index); }
      if (e.key === 'Escape') { e.preventDefault(); return hideSuggest(); }
    }
    // On a phone Enter is a new line (like any messaging app) — the send button sends.
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && !isMobile()) { e.preventDefault(); send(); }
  });
  ta.addEventListener('paste', e => {
    const file = [...(e.clipboardData?.files || [])][0];
    if (file && mode === 'reply') { e.preventDefault(); upload(file); }
  });

  async function send() {
    const text = ta.value.trim();
    if (!text || (closedMode && mode !== 'whisper')) return;
    const kind = mode === 'whisper' ? 'whisper' : 'text';
    const mentions = kind === 'whisper' ? S.agents.filter(a => text.includes(`@${a.name}`)).map(a => a.id) : [];
    ta.value = ''; S.drafts[conv.id] = ''; autosize();
    wsSend({ t: 'typing', convId: conv.id, on: false });
    const tmp = { id: `tmp-${Date.now()}`, _pending: true, sender_type: 'agent', agent_id: S.me.id, sender_name: S.me.name, kind, body: text, meta: { color: S.me.color }, created_at: Date.now() };
    const list = S.conv.data.messages;
    list.push(tmp);
    renderMessages(true);
    try {
      const d = await api(`a/conversations/${conv.id}/messages`, { method: 'POST', body: { text, kind, mentions } });
      const i = list.indexOf(tmp);
      if (list.some(x => x.id === d.message.id)) list.splice(i, 1); else list[i] = d.message;
    } catch (e) {
      tmp._pending = false; tmp._failed = true;
      ta.value = text;
      toastError(e);
    }
    renderMessages();
  }

  async function upload(file) {
    if (!file) return;
    if (file.size > 1_500_000) return toastError(new Error('הקובץ גדול מדי (עד 1.5MB)'));
    const fd = new FormData(); fd.append('file', file);
    try { await api(`a/conversations/${conv.id}/files`, { method: 'POST', form: fd }); } catch (e) { toastError(e); }
  }

  const emojiBtn = h('button', {
    class: 'icon-btn', title: 'אימוג׳י',
    onclick: e => {
      popover(e.currentTarget, h('div', { class: 'emoji-pop' }, EMOJI.map(em => h('button', {
        onclick: () => { const p = ta.selectionStart; ta.value = ta.value.slice(0, p) + em + ta.value.slice(ta.selectionEnd); closePop(); ta.focus(); ta.setSelectionRange(p + em.length, p + em.length); },
      }, em))));
    },
  }, icon('smile'));

  const cannedBtn = h('button', {
    class: 'icon-btn', title: 'תשובות מוכנות (/)',
    onclick: () => { ta.focus(); const p = ta.selectionStart; const pre = p && !/\s/.test(ta.value[p - 1]) ? ' /' : '/'; ta.value = ta.value.slice(0, p) + pre + ta.value.slice(p); ta.setSelectionRange(p + pre.length, p + pre.length); checkSuggest(); },
  }, icon('zap'));

  box.append(
    tabs, ta,
    h('div', { class: 'c-bar' },
      emojiBtn, cannedBtn,
      h('button', { class: 'icon-btn', title: 'צירוף קובץ', disabled: closedMode, onclick: () => fileIn.click() }, icon('clip')),
      S.integrations.pay && S.conv.data.can?.pay ? h('button', { class: 'icon-btn', title: 'בקשת תשלום', disabled: closedMode, onclick: () => window.Tools.payModal() }, icon('card')) : null,
      fileIn,
      h('span', { class: 'hint' }, blocked ? '⛔ המבקר חסום' : ''),
      sendBtn));

  const root = h('div', { class: 'composer-wrap' },
    closedMode ? h('div', { class: 'closed-bar' }, icon('lock', 16), 'השיחה סגורה. הודעה ללקוח תפתח אותה מחדש —',
      h('button', { class: 'btn sm', onclick: () => { closedMode = false; S.composer.closedMode = false; setMode('reply'); root.querySelector('.closed-bar').remove(); ta.focus(); } }, 'כתיבה ללקוח')) : null,
    suggest, box);
  setMode(mode);
  setTimeout(() => { autosize(); if (innerWidth > 820) ta.focus(); }, 30);
  return { root, ta, convId: conv.id, closedMode };
}

// ---------- visitor side panel ----------

function renderSide() {
  const side = $('.side-col');
  if (!side || !S.conv?.data) return;
  const { conversation: c, visitor: v, pages, history } = S.conv.data;
  const online = v.online ?? c.visitor_online;
  const saveVisitor = async patch => {
    try { const d = await api(`a/visitors/${v.id}`, { method: 'POST', body: patch }); Object.assign(v, d.visitor); } catch (e) { toastError(e); renderSide(); }
  };
  const edit = (key, placeholder, type = 'text') => h('input', {
    class: `inline-edit ${type !== 'text' ? 'ltr' : ''}`, type, value: v[key] || '', placeholder,
    onchange: e => saveVisitor({ [key]: e.target.value }),
    onkeydown: e => { if (e.key === 'Enter') e.target.blur(); },
  });
  const notes = h('textarea', { class: 'input', rows: 3, placeholder: 'הערות על הלקוח (רק לצוות)…' }, v.notes || '');
  notes.addEventListener('input', debounce(() => saveVisitor({ notes: notes.value }), 700));

  const tagInput = h('input', { placeholder: '+ תגית', list: 'tag-suggestions' });
  const saveTags = async tags => {
    try { c.tags = (await api(`a/conversations/${c.id}/tags`, { method: 'POST', body: { tags } })).tags; if (!S.tags.includes(tags[tags.length - 1])) S.tags.push(...tags.filter(t => !S.tags.includes(t))); renderSide(); } catch (e) { toastError(e); }
  };
  tagInput.addEventListener('keydown', e => {
    if ((e.key === 'Enter' || e.key === ',') && tagInput.value.trim()) { e.preventDefault(); saveTags([...c.tags, tagInput.value.trim()]); }
  });
  tagInput.addEventListener('change', () => { if (S.tags.includes(tagInput.value.trim())) saveTags([...c.tags, tagInput.value.trim()]); });

  const scroll = side.scrollTop;
  clear(side).append(
    h('div', { class: 'side-close' }, h('button', { class: 'btn sm', onclick: () => side.classList.remove('force') }, icon('back'), 'חזרה לשיחה')),
    h('div', { class: 'side-hero' },
      visitorAvatar({ ...c, name: v.name }, 'xl', online),
      h('h3', null, v.name || 'מבקר אנונימי'),
      h('div', { class: 's-status' }, online ? [h('span', { class: 'pulse' }), 'באתר עכשיו'] : `נראה/תה לאחרונה ${ago(v.last_seen)}`),
      v.blocked ? h('div', { style: { marginTop: '8px' } }, h('span', { class: 'badge danger' }, icon('ban', 12), 'חסום')) : null),
    h('div', { class: 'side-sec' },
      h('h4', null, 'פרטי קשר'),
      h('div', { class: 'kv' },
        icon('user'), edit('name', 'שם'),
        icon('mail'), edit('email', 'אימייל', 'email'),
        icon('phone'), edit('phone', 'טלפון', 'tel'))),
    window.Tools.sideTools(c, v),
    h('div', { class: 'side-sec' },
      h('h4', null, icon('tag', 14), 'תגיות לשיחה'),
      h('div', { class: 'tag-input' }, ...c.tags.map(t => h('span', { class: 'tag' }, t, h('button', { onclick: () => saveTags(c.tags.filter(x => x !== t)), 'aria-label': 'הסרה' }, icon('x')))), tagInput),
      h('datalist', { id: 'tag-suggestions' }, S.tags.filter(t => !c.tags.includes(t)).map(t => h('option', { value: t })))),
    h('div', { class: 'side-sec' },
      h('h4', null, icon('note', 14), 'הערות'),
      notes),
    h('div', { class: 'side-sec' },
      h('h4', null, 'מידע'),
      h('div', { class: 'kv' },
        icon('pin'), h('span', null, v.country ? `${flag(v.country)} ${[v.city, countryName(v.country)].filter(Boolean).join(', ')}` : '—'),
        icon('monitor'), h('span', null, `${v.browser} · ${v.os} · ${{ mobile: 'נייד', tablet: 'טאבלט', desktop: 'מחשב' }[v.device] || ''}`),
        icon('clock'), h('span', null, `ביקור ראשון ${fmtDate(v.first_seen)} · ${v.visits} ביקורים · ${v.pages} דפים`),
        v.referrer ? [icon('link'), h('a', { href: v.referrer, target: '_blank', rel: 'noopener', class: 'ellipsis ltr', style: { color: 'var(--ink-2)' } }, v.referrer.replace(/^https?:\/\//, ''))] : null,
        c.topic ? [icon('tag'), h('span', null, `נושא: ${c.topic}`)] : null,
        c.rating ? [icon('star'), h('span', null, `${'★'.repeat(c.rating)}${'☆'.repeat(5 - c.rating)}${c.rating_comment ? ` — "${c.rating_comment}"` : ''}`)] : null)),
    pages.length ? h('div', { class: 'side-sec' },
      h('h4', null, 'מסלול באתר'),
      h('ul', { class: 'pages' }, pages.slice(0, 8).map(p => h('li', null,
        h('a', { href: p.url, target: '_blank', rel: 'noopener', class: 'ellipsis' }, p.title || p.url.replace(/^https?:\/\/[^/]+/, '') || '/'),
        h('div', { class: 'p-time' }, `${ago(p.at)} · `, h('span', { class: 'ltr' }, p.url.replace(/^https?:\/\/[^/]+/, '') || '/')))))) : null,
    h('div', { class: 'side-sec' },
      h('h4', null, `שיחות קודמות (${history.length})`),
      history.length ? history.map(x => h('div', { class: 'hist-item', onclick: () => go(`c/${x.id}`) },
        h('span', { class: 'faint' }, `#${x.id}`),
        h('div', { class: 'grow' }, h('div', { class: 'ellipsis' }, x.last_message_preview || '—'), h('div', { class: 'faint', style: { fontSize: '12px' } }, `${fmtDate(x.created_at)} · ${x.msg_count} הודעות${x.rating ? ` · ★${x.rating}` : ''}`)),
        x.status === 'open' ? h('span', { class: 'badge brand' }, 'פתוחה') : null)) : h('div', { class: 'faint', style: { fontSize: '13px' } }, 'זו השיחה הראשונה')),
  );
  side.scrollTop = scroll;
}

// =============================================================================
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && S.conv?.data?.conversation?.unread_agent) markRead(S.conv.id);
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closePop();
  if ((e.metaKey || e.ctrlKey) && e.key === 'k' && S.me) { e.preventDefault(); go('inbox'); setTimeout(() => $('.search input')?.focus(), 50); }
});

window.App = { h, icon, api, S, toast, toastError, modal, confirmModal, popover, popItem, closePop, avatar, visitorAvatar, fmtDate, fmtDateTime, fmtTime, ago, dur, flag, countryName, go, isAdmin, agentById, debounce, clear, $, colorFor, langName, renderSide: () => renderSide(), renderThreadHead: () => renderThreadHead() };
window.addEventListener('DOMContentLoaded', boot);
