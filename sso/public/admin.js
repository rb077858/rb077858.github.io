// login.reembir.com/admin — users, access & plans, email, sites, wall.
(function () {
  'use strict';

  // ================================================================ helpers

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const nowSec = () => Math.floor(Date.now() / 1000);
  const fmtDate = t => (t ? new Date(t * 1000).toLocaleDateString('he-IL') : '—');
  const fmtTime = t => (t ? new Date(t * 1000).toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' }) : '—');
  function ago(t) {
    if (!t) return 'אף פעם';
    const s = nowSec() - t;
    if (s < 60) return 'עכשיו';
    if (s < 3600) return `לפני ${Math.floor(s / 60)} דק׳`;
    if (s < 86400) return `לפני ${Math.floor(s / 3600)} שע׳`;
    if (s < 86400 * 30) return `לפני ${Math.floor(s / 86400)} ימים`;
    return fmtDate(t);
  }
  const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
  const store = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch { return null; } };

  const ICONS = {
    menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
    headset: '<path d="M3 14v-2a9 9 0 0 1 18 0v2"/><path d="M21 14v3a2 2 0 0 1-2 2h-1v-7h1a2 2 0 0 1 2 2zM3 14v3a2 2 0 0 0 2 2h1v-7H5a2 2 0 0 0-2 2z"/>',
    grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
    mail: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 6L2 7"/>',
    globe: '<circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>',
    chat: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
    user: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
    x: '<path d="M18 6 6 18M6 6l12 12"/>',
    chev: '<path d="m15 18-6-6 6-6"/>',
    down: '<path d="m6 9 6 6 6-6"/>',
    key: '<circle cx="7.5" cy="15.5" r="5.5"/><path d="m21 2-9.6 9.6M15.5 7.5l3 3L22 7l-3-3"/>',
    logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
    copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
    trash: '<path d="M3 6h18M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M10 11v6M14 11v6M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>',
    send: '<path d="m22 2-7 20-4-9-9-4z"/><path d="M22 2 11 13"/>',
    eye: '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>',
    card: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20M6 15h4"/>',
    link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
    share: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4"/>',
  };
  const icon = (name, cls = '') => `<svg class="ico ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;
  const fillIcons = (root = document) => $$('[data-icon]', root).forEach(el => { el.outerHTML = icon(el.dataset.icon); });

  function avatar(u, size = 'sm') {
    return u.avatar
      ? `<span class="avatar ${size}"><img src="${esc(u.avatar)}" alt="" referrerpolicy="no-referrer"></span>`
      : `<span class="avatar ${size}">${esc((u.name || u.email || '?').charAt(0))}</span>`;
  }

  // Sign in, then come straight back here (not to the account page).
  const signInUrl = () => '/?return=' + encodeURIComponent('/admin' + location.hash);

  async function api(path, body, method) {
    const res = await fetch(path, {
      method: method || (body ? 'POST' : 'GET'),
      headers: body ? { 'content-type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (res.status === 401) location.href = signInUrl();
      throw new Error(data.message || 'שגיאה');
    }
    return data;
  }

  let toastTimer;
  function toast(text) {
    const t = $('#toast');
    t.textContent = text;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 2800);
  }

  // Run an action with a busy button and a toast; returns the result or undefined on error.
  async function act(btn, fn, okText) {
    if (btn) btn.disabled = true;
    try {
      const r = await fn();
      if (okText) toast(okText);
      return r;
    } catch (err) {
      toast('⚠️ ' + err.message);
      return undefined;
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  const STATUS = { active: ['פעיל', 'green'], pending: ['ממתין', 'warn'], blocked: ['חסום', 'red'] };
  const MODES = { open: 'פתוח — כל מי שנרשם נכנס', approval: 'באישור — כל בקשה מחכה לאישור שלך', invite: 'בהזמנה — רק מי שהוספת ידנית' };

  // ================================================================ state

  const state = {
    me: null,
    sites: [],
    stats: null,
    users: { list: [], total: 0, q: '', filter: '', site: '', plan: '', offset: 0, selected: new Set() },
    compose: null,
  };

  const siteName = id => (state.sites.find(s => s.id === id) || { name: id }).name;
  const allPlans = () => state.sites.flatMap(s => s.plans.map(p => ({ ...p, site_name: s.name })));
  const planName = id => (allPlans().find(p => p.id === id) || { name: id }).name;

  // ================================================================ navigation

  const TABS = [
    { id: 'overview', label: 'סקירה', icon: 'grid', render: renderOverview },
    { id: 'users', label: 'משתמשים', icon: 'users', render: renderUsers },
    { id: 'pay', label: 'תשלומים', icon: 'card', render: renderPay },
    { id: 'email', label: 'מיילים', icon: 'mail', render: renderEmail },
    { id: 'sites', label: 'אתרים', icon: 'globe', render: renderSites },
    { id: 'wall', label: 'קיר', icon: 'chat', render: renderWall },
    { id: 'chat', label: 'צ׳אט', icon: 'headset', render: renderChat, when: () => !!(state.stats && state.stats.chat_url) },
  ];
  const visibleTabs = () => TABS.filter(t => !t.when || t.when());
  const MOBILE_MAIN = ['overview', 'sites', 'users', 'pay'];
  let currentTab = null;

  function renderNav() {
    const pending = state.stats ? state.stats.pending.length : 0;
    const badge = t => (t.id === 'overview' && pending ? `<span class="count">${pending}</span>` : '');
    const tabs = visibleTabs();
    $('#side-nav').innerHTML = tabs.map(t => `<button class="nav-item" data-tab="${t.id}" ${t.id === currentTab ? 'aria-current="page"' : ''}>${icon(t.icon)}${t.label}${badge(t)}</button>`).join('');
    const main = tabs.filter(t => MOBILE_MAIN.includes(t.id));
    const more = tabs.filter(t => !MOBILE_MAIN.includes(t.id));
    $('#bottom-nav').style.gridTemplateColumns = `repeat(${main.length + 1}, 1fr)`;
    $('#bottom-nav').innerHTML = main.map(t => `<button data-tab="${t.id}" ${t.id === currentTab ? 'aria-current="page"' : ''}>${icon(t.icon)}<span>${t.label}</span>${badge(t)}</button>`).join('')
      + `<button data-more ${more.some(t => t.id === currentTab) ? 'aria-current="page"' : ''}>${icon('menu')}<span>עוד</span></button>`;
    $$('[data-tab]').forEach(b => { b.onclick = () => go(b.dataset.tab); });
    $('[data-more]').onclick = () => {
      const d = openDrawer(`<div class="drawer-head"><div class="txt"><b>עוד</b></div><button class="icon-btn" data-close aria-label="סגירה">${icon('x')}</button></div>
        <div class="drawer-body"><ul class="row-list">${more.map(t => `<li class="click" data-more-tab="${t.id}">${icon(t.icon)}<div class="grow"><div class="t">${t.label}</div></div>${icon('chev', 'sm')}</li>`).join('')}</ul></div>`);
      $$('[data-more-tab]', d).forEach(li => { li.onclick = () => { closeDrawer(true); go(li.dataset.moreTab); }; });
    };
  }

  function go(tab, extra) {
    const target = extra ? `${tab}/${extra}` : tab;
    if (location.hash === '#' + target) route(true);
    else location.hash = target;
  }

  let currentView = null;

  async function route(force) {
    const [tab, arg, sub] = location.hash.slice(1).split('/');
    const t = visibleTabs().find(x => x.id === tab) || TABS[0];
    const siteArg = t.id === 'sites' && arg ? decodeURIComponent(arg) : null;
    const viewKey = siteArg ? viewKeyFor(siteArg, sub) : t.id;
    if (viewKey !== currentView || (force === true && (!arg || siteArg))) {
      currentView = viewKey;
      currentTab = t.id;
      renderNav();
      $('#mobile-title').textContent = t.label;
      document.title = `${t.label} · ניהול reem.bi`;
      $('#view').innerHTML = '<div class="loading"><span class="spinner"></span></div>';
      window.scrollTo(0, 0);
      try {
        await (siteArg ? renderSitePage($('#view'), siteArg, sub || 'overview') : t.render($('#view')));
      } catch (err) {
        $('#view').innerHTML = `<div class="empty">⚠️ ${esc(err.message)}</div>`;
      }
    }
    if (t.id === 'users' && arg) openUser(decodeURIComponent(arg));
    else closeDrawer(true);
  }
  window.addEventListener('hashchange', () => route());

  // ================================================================ PayPal connection and money

  const moneyList = (rows, key) => rows.length ? rows.map(x => money(x[key], x.currency)).join(' + ') : money(0, 'ILS');

  // On the overview: is PayPal wired to reem.bi (so a payment becomes a plan by itself), and the real money.
  function renderPaypal(box, st, refresh) {
    if (!box || !st || !st.configured) return;
    const w = st.webhook;
    const rec = st.last_reconcile;
    const rev = st.revenue_30d || [];
    const warn = !w.connected || st.failed_payments_30d || st.starts_waiting || (rec && rec.unresolved) || (rec && rec.error);
    box.innerHTML = `
      <section class="panel pp-panel ${warn ? 'pp-warn' : ''}">
        <h2>PayPal ${st.env === 'sandbox' ? '<span class="badge warn">בדיקה</span>' : ''}
          <span class="badge ${w.connected ? 'green' : 'red'}">${w.connected ? 'מחובר אוטומטית' : 'לא מחובר אוטומטית'}</span></h2>
        ${w.connected ? `<div class="hint" style="margin-top:0">כל תשלום, חידוש, ביטול וכשל חיוב מגיעים אל reem.bi מיד, והתוכנית מתעדכנת לבד.${w.last_event_at ? ' אירוע אחרון: ' + esc(ago(w.last_event_at)) + '.' : ' עוד לא הגיע אירוע.'}</div>`
          : `<div class="alert warn" style="margin:0 0 10px">PayPal עדיין לא מעדכן את המערכת לבד. מי ששילם ולא חזר לאתר עלול לא לקבל תוכנית. חיבור אחד פותר את זה לתמיד.</div>
             <button class="btn btn-primary" id="pp-connect">חיבור אוטומטי ל-PayPal</button>`}
        <div class="stats" style="margin-top:12px">
          <div class="stat"><div class="n">${esc(moneyList(rev, 'net'))}</div><div class="l">נכנס ב-30 ימים, אחרי עמלות</div></div>
          <div class="stat"><div class="n">${esc(moneyList(rev, 'gross'))}</div><div class="l">נגבה ב-30 ימים (${rev.reduce((a, x) => a + x.payments, 0)} תשלומים)</div></div>
          <div class="stat"><div class="n">${esc(moneyList(rev, 'fees'))}</div><div class="l">עמלות PayPal</div></div>
          <div class="stat ${st.failed_payments_30d ? 'alert-stat' : ''}"><div class="n">${st.failed_payments_30d}</div><div class="l">חיובים שנכשלו ב-30 ימים</div></div>
        </div>
        ${w.connected && !rev.length ? '<div class="hint">המספרים נבנים מהתשלומים שמגיעים מרגע החיבור. תשלומים קודמים לא נספרים כאן.</div>' : ''}
        <div class="hint">${rec ? `בדיקת הלילה (${esc(ago(rec.at))}): ${rec.fixed ? `הופעלו ${rec.fixed} תוכניות שחסרו` : 'הכול תקין'}${rec.unresolved ? ` · <b>${rec.unresolved} דורשים בדיקה</b> (אתר ← מנויים ← בדיקה מול PayPal)` : ''}${rec.error ? ' · ' + esc(rec.error) : ''}.` : 'בדיקת הלילה תרוץ הלילה (03:23).'}</div>
        <div class="pp-links"><button class="link-btn" id="pp-plans">תוכניות ב-PayPal (ניקוי ישנות)</button></div>
      </section>`;
    const c = $('#pp-connect', box);
    if (c) c.onclick = async () => {
      const r = await act(c, () => api('/api/admin/billing/paypal/webhook', {}), 'PayPal מחובר ✓');
      if (r) refresh();
    };
    $('#pp-plans', box).onclick = ppPlansDrawer;
  }

  async function ppPlansDrawer() {
    const d = openDrawer(`
      <div class="drawer-head"><div class="txt"><b>תוכניות מנוי ב-PayPal</b><span>רק תוכניות שהמערכת לא משתמשת בהן אפשר להשבית</span></div><button class="icon-btn" data-close aria-label="סגירה">${icon('x')}</button></div>
      <div class="drawer-body" id="ppp-body"><div class="loading"><span class="spinner"></span></div></div>`);
    const draw = data => {
      const list = data.plans.filter(p => p.status === 'ACTIVE');
      const body = $('#ppp-body', d);
      body.innerHTML = `
        <div class="hint" style="margin-top:0">השבתה מונעת הרשמות חדשות לתוכנית. מנויים קיימים ממשיכים להתחייב כרגיל. ${list.filter(p => !p.in_use).length} תוכניות ישנות שלא בשימוש.</div>
        <ul class="row-list" style="margin-top:10px">${list.map(p => `
          <li style="flex-wrap:wrap"><div class="grow" style="min-width:180px"><div class="t">${esc(p.name)} ${p.in_use ? '<span class="badge green">בשימוש</span>' : '<span class="badge">ישנה</span>'}</div>
            <div class="s ltr" style="text-align:start">${esc(p.id)}</div></div>
            ${p.in_use ? '' : `<button class="btn btn-outline btn-sm" data-off="${esc(p.id)}">השבתה</button>`}</li>`).join('') || '<div class="empty">אין תוכניות פעילות</div>'}</ul>`;
      $$('[data-off]', body).forEach(b => {
        b.onclick = async () => {
          if (!confirm('להשבית את התוכנית ב-PayPal? אי אפשר יהיה להירשם אליה, מנויים קיימים לא ייפגעו.')) return;
          const r = await act(b, () => api(`/api/admin/billing/paypal/plans/${encodeURIComponent(b.dataset.off)}/deactivate`, {}), 'התוכנית הושבתה');
          if (r) draw(r);
        };
      });
    };
    try { draw(await api('/api/admin/billing/paypal/plans')); } catch (err) { $('#ppp-body', d).innerHTML = `<div class="empty">⚠️ ${esc(err.message)}</div>`; }
  }

  // ================================================================ system shutdown

  const MAINT_SCOPES = {
    login: ['התחברות והרשמה', 'אי אפשר להתחבר, להירשם, להיכנס לאתרים או לשלם. מי שכבר מחובר באתר ממשיך לעבוד.'],
    all: ['הכול', 'גם מי שכבר מחובר לא יכול להשתמש באתרים (האתרים לא מקבלים מ-reem.bi פרטי משתמש ותוכנית), ודף החשבון סגור.'],
  };
  const pad2 = n => String(n).padStart(2, '0');
  const toLocalInput = t => { const d = new Date(t * 1000); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`; };
  const fmtUntil = t => new Date(t * 1000).toLocaleString('he-IL', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' });

  // On the overview: a loud card while the system is off; otherwise a quiet line with the switch.
  function renderMaintenance(box, m, refresh) {
    if (!box || !m) return;
    if (!m.on) {
      box.innerHTML = `<div class="maint-row"><span class="badge green">המערכת פועלת</span>
        ${m.ended_at ? `<span class="s">ההשבתה הסתיימה ב-${esc(fmtUntil(m.ended_at))}</span>` : ''}
        <button class="link-btn" id="mt-open">השבתת מערכת…</button></div>`;
      $('#mt-open', box).onclick = () => maintenanceDrawer(m, refresh);
      return;
    }
    box.innerHTML = `
      <section class="panel maint-on">
        <h2>🛠️ המערכת מושבתת <span class="badge red">${esc(MAINT_SCOPES[m.scope][0])}</span></h2>
        <div class="maint-meta">
          <span>${m.until ? `חוזרת לבד ב-<b>${esc(fmtUntil(m.until))}</b>` : 'עד שתפעילו אותה מחדש'}</span>
          ${m.since ? `<span class="s">הושבתה ${esc(ago(m.since))}${m.by ? ` · ${esc(m.by)}` : ''}</span>` : ''}
        </div>
        <div class="maint" style="margin:10px 0 12px"><b>מה המשתמשים רואים</b><span>${esc(m.message || m.default_message)}</span>${m.until ? `<small>צפוי לחזור ב-${esc(fmtUntil(m.until))}</small>` : ''}</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn btn-primary" id="mt-resume">הפעלה מחדש עכשיו</button>
          <button class="btn btn-outline" id="mt-edit">עריכה</button>
        </div>
      </section>`;
    $('#mt-edit', box).onclick = () => maintenanceDrawer(m, refresh);
    $('#mt-resume', box).onclick = async e => {
      if (!confirm('להפעיל את המערכת מחדש?')) return;
      const r = await act(e.currentTarget, () => api('/api/admin/maintenance', { on: false, scope: m.scope, message: m.message }, 'PUT'), 'המערכת פועלת שוב ✓');
      if (r) refresh();
    };
  }

  function maintenanceDrawer(m, refresh) {
    let scope = m.scope || 'login';
    const soon = Math.floor(Date.now() / 1000) + 3600;
    const d = openDrawer(`
      <div class="drawer-head"><div class="txt"><b>השבתת מערכת</b><span>login.reembir.com וכל האתרים שמתחברים דרכו</span></div><button class="icon-btn" data-close aria-label="סגירה">${icon('x')}</button></div>
      <form class="drawer-body" id="mt-form">
        <label style="margin-top:0">מה נסגר</label>
        <div class="seg" id="mt-scope">${Object.entries(MAINT_SCOPES).map(([k, [l]]) => `<button type="button" data-v="${k}" aria-pressed="${k === scope}">${l}</button>`).join('')}</div>
        <div class="hint" id="mt-scope-hint"></div>

        <label class="switch-row" style="margin-top:12px">
          <span class="txt">סיום אוטומטי<small>המערכת תחזור לפעול לבד בזמן שתבחרו (לא חובה)</small></span>
          <span class="switch"><input type="checkbox" id="mt-auto" ${m.on && m.until ? 'checked' : ''}><span></span></span>
        </label>
        <div id="mt-until-box" ${m.on && m.until ? '' : 'hidden'}>
          <input id="mt-until" type="datetime-local" dir="ltr" value="${toLocalInput(m.on && m.until ? m.until : soon)}">
          <div class="mini-chips" style="margin-top:8px">
            <button type="button" data-in="3600">בעוד שעה</button>
            <button type="button" data-in="10800">בעוד 3 שעות</button>
            <button type="button" data-tomorrow="8">מחר ב-8:00</button>
          </div>
        </div>

        <label for="mt-msg">ההודעה למשתמשים (לא חובה)</label>
        <textarea id="mt-msg" rows="3" maxlength="500" placeholder="${esc(m.default_message)}">${esc(m.message)}</textarea>
        <div class="hint">מופיעה מעל טופס ההתחברות, ובאתרים כהודעת השגיאה. ריק = הטקסט הרגיל.</div>

        <label>כך זה ייראה</label>
        <div class="maint" id="mt-preview"></div>
        <div class="hint">🔑 מנהלים תמיד יכולים להתחבר ולהפעיל את המערכת מחדש.</div>

        <button class="btn ${m.on ? 'btn-primary' : 'btn-danger'} btn-block btn-lg" type="submit">${m.on ? 'שמירה' : 'השבתה עכשיו'}</button>
      </form>`);
    const until = () => ($('#mt-auto', d).checked && $('#mt-until', d).value ? Math.floor(new Date($('#mt-until', d).value).getTime() / 1000) : null);
    const draw = () => {
      $('#mt-scope-hint', d).textContent = MAINT_SCOPES[scope][1];
      const u = until();
      $('#mt-preview', d).innerHTML = `<b>🛠️ המערכת בתחזוקה</b><span>${esc($('#mt-msg', d).value.trim() || m.default_message)}</span>${u ? `<small>צפוי לחזור ב-${esc(fmtUntil(u))}</small>` : ''}`;
    };
    $$('#mt-scope button', d).forEach(b => {
      b.onclick = () => { scope = b.dataset.v; $$('#mt-scope button', d).forEach(x => x.setAttribute('aria-pressed', String(x === b))); draw(); };
    });
    $('#mt-auto', d).onchange = e => { $('#mt-until-box', d).hidden = !e.target.checked; draw(); };
    $('#mt-until', d).oninput = draw;
    $('#mt-msg', d).oninput = draw;
    $$('[data-in]', d).forEach(b => { b.onclick = () => { $('#mt-until', d).value = toLocalInput(Math.floor(Date.now() / 1000) + Number(b.dataset.in)); draw(); }; });
    $$('[data-tomorrow]', d).forEach(b => {
      b.onclick = () => { const t = new Date(); t.setDate(t.getDate() + 1); t.setHours(Number(b.dataset.tomorrow), 0, 0, 0); $('#mt-until', d).value = toLocalInput(t.getTime() / 1000); draw(); };
    });
    draw();
    $('#mt-form', d).onsubmit = async e => {
      e.preventDefault();
      if (!m.on && !confirm(scope === 'all' ? 'להשבית את כל המערכת? גם משתמשים מחוברים לא יוכלו להשתמש באתרים.' : 'להשבית התחברות, הרשמה ותשלומים?')) return;
      const r = await act(e.submitter, () => api('/api/admin/maintenance', { on: true, scope, until: until(), message: $('#mt-msg', d).value.trim() }, 'PUT'), m.on ? 'נשמר ✓' : 'המערכת הושבתה');
      if (r) { closeDrawer(); refresh(); }
    };
  }

  // ================================================================ overview

  // Emails today across the whole Resend account (sign-in links, verifications, other sites…),
  // or just the dashboard's own sends when Resend's numbers aren't available.
  function emailStat(s) {
    const r = s.resend || {};
    if (r.daily === null || r.daily === undefined) {
      return `<button class="stat" data-go="email"><div class="n">${s.emails_today}</div><div class="l">מיילים מהדשבורד ב-24 שעות</div></button>`;
    }
    const limit = r.daily_limit || (r.source === 'header' ? 100 : null);
    const warn = limit && r.daily >= limit * 0.8;
    const title = r.source === 'header' ? 'לפי Resend, נכון לשליחה האחרונה מ-reem.bi' : 'לפי Resend, כל המיילים בחשבון';
    return `<button class="stat ${warn ? 'alert-stat' : ''}" data-go="email" title="${esc(title)}"><div class="n">${r.daily}</div>
      <div class="l">מיילים היום${limit ? ` (מתוך ${limit})` : ''}${r.monthly !== null && r.monthly !== undefined ? ` · ${r.monthly} החודש` : ''}</div></button>`;
  }

  async function renderOverview(view) {
    const [s, mt, pp] = await Promise.all([api('/api/admin/stats'), api('/api/admin/maintenance').catch(() => null), api('/api/admin/billing/paypal').catch(() => null)]);
    state.stats = s;
    renderNav();
    const firstName = (state.me.name || '').split(' ')[0];
    view.innerHTML = `
      <div class="page-head">
        <div><h1>שלום${firstName ? ', ' + esc(firstName) : ''} 👋</h1><div class="sub">מה קורה במערכת</div></div>
        <div class="actions">
          <button class="btn btn-outline" id="ov-new-user">${icon('plus', 'sm')} משתמש</button>
          <button class="btn btn-primary" id="ov-mail">${icon('mail', 'sm')} מייל חדש</button>
        </div>
      </div>
      <div id="ov-maint"></div>
      <div id="ov-paypal"></div>
      <div class="stats">
        <button class="stat" data-go="users"><div class="n">${s.users}</div><div class="l">משתמשים</div></button>
        <div class="stat"><div class="n">${s.new_users}</div><div class="l">הצטרפו השבוע</div></div>
        <div class="stat"><div class="n">${s.active_users}</div><div class="l">נכנסו השבוע</div></div>
        <button class="stat ${s.pending.length ? 'alert-stat' : ''}" data-filter="pending"><div class="n">${s.pending.length}</div><div class="l">ממתינים לאישור</div></button>
        ${emailStat(s)}
        <button class="stat" data-go="sites"><div class="n">${(s.billing && s.billing.by_site || []).reduce((a, r) => a + r.n, 0)}</div><div class="l">מנויים משלמים</div></button>
        <button class="stat" data-go="sites"><div class="n">${esc(Object.entries((s.billing && s.billing.by_site || []).reduce((a, r) => ({ ...a, [r.currency]: (a[r.currency] || 0) + r.mrr }), {})).map(([c, v]) => money(v, c)).join(' + ') || money(0, 'ILS'))}</div><div class="l">הכנסה חודשית</div></button>
      </div>

      <div class="grid-2">
        <section class="panel">
          <h2>בקשות גישה ${s.pending.length ? `<span class="badge warn">${s.pending.length}</span>` : ''}</h2>
          ${s.pending.length ? `<ul class="row-list">${s.pending.map(p => `
            <li>
              <div class="grow"><div class="t">${esc(p.name || p.email)}</div><div class="s">${esc(p.site_name)} · <span class="ltr">${esc(p.email)}</span></div></div>
              <button class="btn btn-primary btn-sm" data-approve="${esc(p.user_id)}|${esc(p.site_id)}">אישור</button>
              <button class="btn btn-outline btn-sm" data-deny="${esc(p.user_id)}|${esc(p.site_id)}">דחייה</button>
            </li>`).join('')}</ul>` : '<div class="empty">אין בקשות שמחכות לך 🎉</div>'}
        </section>

        <section class="panel">
          <h2>הצטרפו לאחרונה <button class="link-btn" data-go="users">לכל המשתמשים</button></h2>
          ${s.recent.length ? `<ul class="row-list">${s.recent.map(u => `
            <li class="click" data-user="${esc(u.id)}">
              ${avatar(u)}
              <div class="grow"><div class="t">${esc(u.name || u.email)}</div><div class="s ltr">${esc(u.email)}</div></div>
              <span class="s">${ago(u.created_at)}</span>
            </li>`).join('')}</ul>` : '<div class="empty">עוד אין משתמשים</div>'}
        </section>
      </div>

      <section class="panel" style="margin-top:16px">
        <h2>אתרים <button class="link-btn" data-go="sites">לכל האתרים</button></h2>
        <ul class="row-list">${state.sites.filter(site => site.id !== 'pay').map(site => `
          <li class="click" data-site-go="${esc(site.id)}">
            <div class="grow"><div class="t">${esc(site.name)}</div><div class="s">${esc(MODES[site.access_mode].split(' — ')[0])} · ${site.users} משתמשים</div></div>
            <div class="u-tags">${site.plans.map(p => `<span class="badge">${esc(p.name)} · ${p.users}</span>`).join('')}</div>
          </li>`).join('')}</ul>
      </section>`;

    renderMaintenance($('#ov-maint', view), mt && mt.maintenance, () => renderOverview(view));
    renderPaypal($('#ov-paypal', view), pp, () => renderOverview(view));
    $('#ov-new-user').onclick = newUserDrawer;
    $('#ov-mail').onclick = () => go('email');
    $$('[data-go]', view).forEach(b => { b.onclick = () => go(b.dataset.go); });
    $$('[data-filter]', view).forEach(b => { b.onclick = () => { state.users.filter = b.dataset.filter; go('users'); }; });
    $$('[data-user]', view).forEach(li => { li.onclick = () => go('users', li.dataset.user); });
    $$('[data-site-go]', view).forEach(li => { li.onclick = () => go('sites', encodeURIComponent(li.dataset.siteGo)); });
    $$('[data-approve],[data-deny]', view).forEach(btn => {
      btn.onclick = async () => {
        const [uid, sid] = (btn.dataset.approve || btn.dataset.deny).split('|');
        const status = btn.dataset.approve ? 'active' : 'blocked';
        const r = await act(btn, () => api(`/api/admin/users/${uid}/access/${sid}`, { status, plan_id: null, features_override: {} }, 'PUT'), status === 'active' ? 'אושר ✓' : 'נדחה');
        if (r) renderOverview(view);
      };
    });
  }

  // ================================================================ users

  const FILTERS = [
    ['', 'הכול'], ['paid', 'בתוכנית בתשלום'], ['pending', 'ממתינים'], ['admin', 'מנהלים'],
    ['blocked', 'חסומים באתר'], ['unverified', 'לא מאומתים'], ['disabled', 'מושבתים'],
  ];

  async function renderUsers(view) {
    const u = state.users;
    view.innerHTML = `
      <div class="page-head">
        <div><h1>משתמשים</h1><div class="sub" id="u-total"></div></div>
        <div class="actions"><button class="btn btn-primary" id="u-new">${icon('plus', 'sm')} משתמש חדש</button></div>
      </div>
      <div class="toolbar">
        <label class="search">${icon('search')}<input type="search" id="u-q" placeholder="חיפוש לפי שם או מייל…" value="${esc(u.q)}" autocomplete="off"></label>
        <select id="u-site" aria-label="אתר"><option value="">כל האתרים</option>${state.sites.map(s => `<option value="${esc(s.id)}" ${u.site === s.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select>
        <select id="u-plan" aria-label="תוכנית"></select>
      </div>
      <div class="chips" id="u-chips">${FILTERS.map(([v, l]) => `<button class="chip" data-f="${v}" aria-pressed="${u.filter === v}">${l}</button>`).join('')}</div>
      <div class="users" id="u-list">
        <div class="u-head"><span></span><span>משתמש</span><span>גישה ותוכניות</span><span class="c-date">הצטרף</span><span class="c-last">כניסה אחרונה</span><span></span></div>
        <div id="u-rows"></div>
      </div>
      <div class="center" style="margin-top:12px"><button class="btn btn-outline btn-sm" id="u-more" hidden>טען עוד</button></div>
      <div class="bulk-bar" id="u-bulk" hidden></div>`;

    const fillPlans = () => {
      const plans = allPlans().filter(p => !u.site || p.site_id === u.site);
      if (u.plan && !plans.some(p => p.id === u.plan)) u.plan = '';
      $('#u-plan').innerHTML = `<option value="">כל התוכניות</option>${plans.map(p => `<option value="${esc(p.id)}" ${u.plan === p.id ? 'selected' : ''}>${esc(u.site ? p.name : `${p.site_name} · ${p.name}`)}</option>`).join('')}`;
    };
    fillPlans();

    $('#u-new').onclick = newUserDrawer;
    $('#u-q').oninput = debounce(e => { u.q = e.target.value; loadUsers(true); }, 250);
    $('#u-site').onchange = e => { u.site = e.target.value; fillPlans(); loadUsers(true); };
    $('#u-plan').onchange = e => { u.plan = e.target.value; loadUsers(true); };
    $$('#u-chips .chip').forEach(c => {
      c.onclick = () => {
        u.filter = c.dataset.f;
        $$('#u-chips .chip').forEach(x => x.setAttribute('aria-pressed', String(x === c)));
        loadUsers(true);
      };
    });
    $('#u-more').onclick = () => loadUsers(false);
    await loadUsers(true);
  }

  function userRow(x) {
    const u = state.users;
    const flags = [
      x.is_admin ? '<span class="badge green">מנהל</span>' : '',
      x.disabled ? '<span class="badge red">מושבת</span>' : '',
      !x.email_verified ? '<span class="badge warn">לא מאומת</span>' : '',
    ].join('');
    const tags = x.access.map(a => {
      const [, cls] = STATUS[a.status] || ['', ''];
      return `<span class="badge ${a.status === 'active' ? '' : cls}">${esc(siteName(a.site_id))}${a.plan_id ? ' · <b>' + esc(planName(a.plan_id)) + '</b>' : ''}${a.status !== 'active' ? ' · ' + STATUS[a.status][0] : ''}</span>`;
    }).join('');
    return `<div class="u-row ${u.selected.has(x.id) ? 'selected' : ''}" data-id="${esc(x.id)}">
      <span class="c-check"><input type="checkbox" class="check" aria-label="בחירה" ${u.selected.has(x.id) ? 'checked' : ''}></span>
      <span class="c-main u-main">${avatar(x)}<span class="txt"><b>${esc(x.name || x.email.split('@')[0])} ${flags}</b><div class="em">${esc(x.email)}</div></span></span>
      <span class="c-tags u-tags">${tags}</span>
      <span class="c-date u-date">${fmtDate(x.created_at)}</span>
      <span class="c-last u-date">${ago(x.last_login_at)}</span>
      <span class="chev">${icon('chev', 'sm')}</span>
    </div>`;
  }

  async function loadUsers(reset) {
    const u = state.users;
    if (reset) u.offset = 0;
    const q = new URLSearchParams({ q: u.q, site: u.site, plan: u.plan, filter: u.filter, offset: u.offset });
    const data = await api('/api/admin/users?' + q);
    if (currentTab !== 'users') return;
    u.list = reset ? data.users : u.list.concat(data.users);
    u.total = data.total;
    u.offset += data.users.length;
    $('#u-total').textContent = `${data.total} ${data.total === 1 ? 'משתמש' : 'משתמשים'}`;
    $('#u-rows').innerHTML = u.list.map(userRow).join('') || '<div class="empty">לא נמצאו משתמשים</div>';
    $('#u-more').hidden = u.list.length >= data.total;
    $$('#u-rows .u-row').forEach(row => {
      const id = row.dataset.id;
      const cb = $('.check', row);
      cb.onclick = e => {
        e.stopPropagation();
        if (cb.checked) u.selected.add(id); else u.selected.delete(id);
        row.classList.toggle('selected', cb.checked);
        renderBulk();
      };
      $('.c-check', row).onclick = e => { if (e.target !== cb) { e.stopPropagation(); cb.click(); } };
      row.onclick = () => go('users', id);
    });
    renderBulk();
  }

  function renderBulk() {
    const u = state.users;
    const bar = $('#u-bulk');
    if (!bar) return;
    bar.hidden = !u.selected.size;
    bar.innerHTML = `<b>${u.selected.size} נבחרו</b>
      <span style="flex:1"></span>
      <button class="btn btn-primary btn-sm" id="bulk-mail">${icon('mail', 'sm')} שליחת מייל</button>
      <button class="btn btn-ghost btn-sm" id="bulk-clear">ביטול</button>`;
    $('#bulk-mail').onclick = () => {
      const picked = u.list.filter(x => u.selected.has(x.id));
      startCompose({ mode: 'users', users: picked.map(x => ({ id: x.id, email: x.email, name: x.name })) });
    };
    $('#bulk-clear').onclick = () => {
      u.selected.clear();
      $$('#u-rows .u-row').forEach(r => { r.classList.remove('selected'); $('.check', r).checked = false; });
      renderBulk();
    };
  }

  // ================================================================ drawer

  function openDrawer(html) {
    const d = $('#drawer');
    d.innerHTML = html;
    document.body.classList.add('drawer-open');
    $('#drawer-backdrop').onclick = () => closeDrawer();
    $$('[data-close]', d).forEach(b => { b.onclick = () => closeDrawer(); });
    return d;
  }

  function closeDrawer(silent) {
    if (!document.body.classList.contains('drawer-open')) return;
    document.body.classList.remove('drawer-open');
    if (!silent && location.hash.startsWith('#users/')) history.back();
  }
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeDrawer(); });

  function newUserDrawer() {
    const d = openDrawer(`
      <div class="drawer-head"><div class="txt"><b>משתמש חדש</b></div><button class="icon-btn" data-close aria-label="סגירה">${icon('x')}</button></div>
      <form class="drawer-body" id="nu-form">
        <label for="nu-email" style="margin-top:0">מייל</label>
        <input id="nu-email" type="email" required dir="ltr" autocomplete="off">
        <label for="nu-name">שם</label>
        <input id="nu-name" autocomplete="off">
        <label class="switch-row" style="margin-top:12px">
          <span class="txt">שליחת קישור כניסה למייל<small>המשתמש יקבל מייל ויוכל להיכנס בלחיצה</small></span>
          <span class="switch"><input type="checkbox" id="nu-invite" checked><span></span></span>
        </label>
        <button class="btn btn-primary btn-block btn-lg" type="submit">יצירת משתמש</button>
      </form>`);
    setTimeout(() => { const el = $('#nu-email', d); if (el) el.focus(); }, 250);
    $('#nu-form', d).onsubmit = async e => {
      e.preventDefault();
      const r = await act(e.submitter, () => api('/api/admin/users', {
        email: $('#nu-email').value, name: $('#nu-name').value, send_invite: $('#nu-invite').checked,
      }), 'המשתמש נוצר ✓');
      if (!r) return;
      if (r.dev_link) prompt('מצב פיתוח — קישור הכניסה:', r.dev_link);
      if (currentTab === 'users') loadUsers(true);
      closeDrawer(true);
      go('users', r.user.id);
    };
  }

  async function openUser(id) {
    const d = openDrawer(`<div class="drawer-head"><div class="txt"><b>טוען…</b></div><button class="icon-btn" data-close aria-label="סגירה">${icon('x')}</button></div><div class="loading"><span class="spinner"></span></div>`);
    try {
      renderUser(await api('/api/admin/users/' + encodeURIComponent(id)));
    } catch (err) {
      $('.loading', d).outerHTML = `<div class="empty">⚠️ ${esc(err.message)}</div>`;
    }
  }

  function toDateInput(t) {
    if (!t) return '';
    const d = new Date(t * 1000);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function accessCard(a, user) {
    const site = state.sites.find(s => s.id === a.site_id) || { id: a.site_id, name: a.site_id, plans: [] };
    const def = site.plans.find(p => p.id === site.default_plan);
    const expired = a.plan_expires_at && a.plan_expires_at < nowSec();
    const hasOverride = Object.keys(a.features_override || {}).length > 0;
    return `<form class="card-s access-card" data-site="${esc(a.site_id)}">
      <div class="top"><b>${esc(site.name)}</b>${expired ? '<span class="badge red">התוכנית פגה</span>' : ''}<span class="meta">${a.last_used_at ? 'שימוש ' + ago(a.last_used_at) : 'עוד לא השתמש'}</span></div>
      <div class="seg" role="group" aria-label="סטטוס">
        ${Object.entries(STATUS).map(([k, [l]]) => `<button type="button" data-v="${k}" aria-pressed="${a.status === k}">${l}</button>`).join('')}
      </div>
      <input type="hidden" name="status" value="${esc(a.status)}">
      <label>תוכנית</label>
      <select name="plan_id">
        <option value="">ברירת מחדל${def ? ` (${esc(def.name)})` : ''}</option>
        ${site.plans.map(p => `<option value="${esc(p.id)}" ${p.id === a.plan_id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}
      </select>
      <label>בתוקף עד</label>
      <input type="date" name="expires" value="${toDateInput(a.plan_expires_at)}">
      <div class="mini-chips">
        <button type="button" data-add="30">+ חודש</button>
        <button type="button" data-add="90">+ 3 חודשים</button>
        <button type="button" data-add="365">+ שנה</button>
        <button type="button" data-add="0">ללא הגבלה</button>
      </div>
      <details class="adv" ${hasOverride ? 'open' : ''}><summary>הרשאות מיוחדות (מתקדם)</summary>
        <textarea class="json" name="features" placeholder='{"tag_limit": 12}'>${hasOverride ? esc(JSON.stringify(a.features_override)) : ''}</textarea>
        <div class="hint">דורס את מה שמוגדר בתוכנית, רק למשתמש הזה.</div>
      </details>
      <div class="row" style="margin-top:14px">
        <button class="btn btn-primary btn-sm" type="submit">שמירה</button>
        <button class="btn btn-ghost btn-sm" type="button" data-remove>הסרת הגישה</button>
      </div>
    </form>`;
  }

  // Bonuses from the partner program (or added by hand), added up per site.
  const unitOf = k => UNITS[k] || k;
  function bonusTotals(list) {
    const out = {};
    for (const b of list) {
      for (const [k, v] of Object.entries(b.features || {})) {
        if (typeof v === 'number') out[k] = Math.round(((out[k] || 0) + v) * 100) / 100;
      }
    }
    return Object.entries(out).map(([k, v]) => (UNITS[k] ? `${v} ${UNITS[k]}` : `${k}: ${v}`)).join(', ');
  }

  function bonusSection(access, bonuses, referredBy, keys) {
    const sites = [...new Set([...access.map(a => a.site_id), ...bonuses.map(b => b.site_id)])];
    if (!sites.length) return '<div class="card-s hint" style="margin:0">אין גישה לאף אתר.</div>';
    return `
        ${referredBy.map(r => `<div class="card-s" style="margin:0 0 8px"><div class="hint" style="margin:0">הצטרף ל<b>${esc(siteName(r.site_id))}</b> דרך <b>${esc(r.partner_name || r.partner_email)}</b> (<span class="mono ltr">${esc(r.code)}</span>) · ${fmtDate(r.created_at)}${r.paid_at ? ' · שילם' : ''}</div></div>`).join('')}
        ${sites.filter(id => bonuses.some(b => b.site_id === id)).map(id => {
          const list = bonuses.filter(b => b.site_id === id);
          return `<div class="card-s" style="margin:0 0 8px">
            <div class="top"><b>${esc(siteName(id))}</b><span class="meta">סה״כ ${esc(bonusTotals(list))}</span></div>
            <ul class="row-list">${list.map(b => `
              <li><div class="grow"><div class="t">+ ${esc(b.label)}</div><div class="s">${esc(b.why)} · ${fmtDate(b.created_at)}</div></div>
                <button class="icon-btn" type="button" data-bonus-del="${b.id}" data-bonus-label="${esc(b.label)}" aria-label="מחיקה" title="מחיקה">${icon('trash')}</button></li>`).join('')}</ul>
          </div>`;
        }).join('') || '<div class="card-s hint" style="margin:0 0 8px">עוד אין תוספות.</div>'}
        <form class="card-s" id="bonus-add" autocomplete="off" style="margin:0">
          <div class="top"><b>הוספה</b></div>
          <div class="form-grid">
            <div><label>אתר</label><select name="site">${sites.map(id => `<option value="${esc(id)}">${esc(siteName(id))}</option>`).join('')}</select></div>
            <div><label>מה מוסיפים</label><select name="key"></select><input name="custom" class="mono" dir="ltr" placeholder="שם השדה, למשל credits" hidden style="margin-top:6px"></div>
            <div><label>כמה <span class="hint" data-unit></span></label><input name="amount" type="number" inputmode="decimal" step="any" required></div>
            <div><label>סיבה <span class="hint">(לא חובה)</span></label><input name="note" maxlength="120" placeholder="למשל: פיצוי על תקלה"></div>
          </div>
          <div class="sheet-actions"><button class="btn btn-outline" type="submit">${icon('plus', 'sm')} הוספה</button></div>
        </form>`;
  }

  let userTab = 'access';
  function renderUser({ user, access, sessions, bonuses = [], referred_by: referredBy = [], bonus_keys: bonusKeys = {} }) {
    const d = $('#drawer');
    const missing = state.sites.filter(s => !access.some(a => a.site_id === s.id));
    const methods = [user.has_password && 'סיסמה', user.google && 'Google', user.passkeys && `Passkey (${user.passkeys})`].filter(Boolean).join(' + ') || 'קישור למייל';
    const siteSessions = sessions.map(s => `${s.client_id ? esc(siteName(s.client_id)) : 'דף ההתחברות'} (${s.n})`).join(', ') || 'אין';

    d.innerHTML = `
      <div class="drawer-head">
        ${avatar(user, '')}
        <div class="txt"><b>${esc(user.name || user.email)}</b><div class="em">${esc(user.email)}</div></div>
        <button class="icon-btn" data-close aria-label="סגירה">${icon('x')}</button>
      </div>
      <div class="drawer-body">
        <div class="u-tags" style="margin-bottom:14px">
          ${user.is_admin ? '<span class="badge green">מנהל</span>' : ''}
          ${user.disabled ? '<span class="badge red">מושבת</span>' : ''}
          <span class="badge ${user.email_verified ? '' : 'warn'}">${user.email_verified ? 'מייל מאומת' : 'מייל לא מאומת'}</span>
          <span class="badge">${methods}</span>
        </div>

        <div class="quick">
          <button type="button" id="q-mail">${icon('mail')}שליחת מייל</button>
          <button type="button" id="q-copy">${icon('copy')}העתקת מייל</button>
          <button type="button" id="q-reset">${icon('key')}איפוס סיסמה</button>
          <button type="button" id="q-logout">${icon('logout')}ניתוק מכשירים</button>
        </div>

        <div class="seg" id="u-tabs" style="margin-bottom:14px">
          <button type="button" data-ut="access" aria-pressed="${userTab === 'access'}">אתרים (${access.length})</button>
          <button type="button" data-ut="bonus" aria-pressed="${userTab === 'bonus'}">תוספות${bonuses.length ? ` (${bonuses.length})` : ''}</button>
          <button type="button" data-ut="details" aria-pressed="${userTab === 'details'}">פרטים</button>
        </div>
        <div data-upane="access" ${userTab === 'access' ? '' : 'hidden'}>
        ${access.map(a => accessCard(a, user)).join('') || '<div class="card-s hint" style="margin:0">עוד אין גישה לאף אתר.</div>'}
        ${missing.length ? `<form class="row" id="add-access" style="margin-top:10px">
          <select name="site" style="flex:1;width:auto">${missing.map(s => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('')}</select>
          <button class="btn btn-outline" type="submit">${icon('plus', 'sm')} מתן גישה</button></form>` : ''}
        </div>
        <div data-upane="bonus" ${userTab === 'bonus' ? '' : 'hidden'}>${bonusSection(access, bonuses, referredBy, bonusKeys)}</div>
        <div data-upane="details" ${userTab === 'details' ? '' : 'hidden'}>

        <form class="card-s" id="u-form">
          <label for="uf-name">שם</label>
          <input id="uf-name" name="name" value="${esc(user.name)}">
          <label for="uf-notes">הערות פנימיות (רק אתה רואה)</label>
          <textarea id="uf-notes" name="notes" rows="2">${esc(user.notes)}</textarea>
          <label class="switch-row" style="margin-top:8px">
            <span class="txt">מנהל<small>גישה לדשבורד הזה</small></span>
            <span class="switch"><input type="checkbox" name="admin" ${user.role === 'admin' ? 'checked' : ''}><span></span></span>
          </label>
          <label class="switch-row">
            <span class="txt">חשבון מושבת<small>לא יכול להתחבר לשום אתר</small></span>
            <span class="switch danger"><input type="checkbox" name="disabled" ${user.disabled ? 'checked' : ''}><span></span></span>
          </label>
          <button class="btn btn-primary btn-sm" type="submit" style="margin-top:8px">שמירת פרטים</button>
        </form>

        <div class="sec-title">מידע</div>
        <dl class="card-s kv">
          <dt>הצטרף</dt><dd>${fmtTime(user.created_at)}</dd>
          <dt>כניסה אחרונה</dt><dd>${fmtTime(user.last_login_at)}</dd>
          <dt>חיבורים פעילים</dt><dd>${siteSessions}</dd>
          <dt>מזהה</dt><dd class="mono ltr" style="text-align:right">${esc(user.id)}</dd>
        </dl>

        <div class="sec-title">אזור מסוכן</div>
        <div class="card-s row between"><span class="hint" style="margin:0">מחיקה לצמיתות של המשתמש, הגישות וההודעות שלו.</span>
          <button class="btn btn-danger btn-sm" id="q-delete">${icon('trash', 'sm')} מחיקה</button></div>
        </div>
      </div>`;
    $$('[data-ut]', d).forEach(b => {
      b.onclick = () => {
        userTab = b.dataset.ut;
        $$('[data-ut]', d).forEach(x => x.setAttribute('aria-pressed', String(x === b)));
        $$('[data-upane]', d).forEach(x => { x.hidden = x.dataset.upane !== userTab; });
      };
    });
    $$('[data-close]', d).forEach(b => { b.onclick = () => closeDrawer(); });

    const refresh = data => { if (data) { renderUser(data); if (currentTab === 'users') loadUsers(true); } };

    $('#q-mail').onclick = () => { closeDrawer(true); startCompose({ mode: 'users', users: [{ id: user.id, email: user.email, name: user.name }] }); };
    $('#q-copy').onclick = () => { navigator.clipboard.writeText(user.email).then(() => toast('המייל הועתק ✓'), () => toast(user.email)); };
    $('#q-reset').onclick = async e => {
      if (!confirm(`לשלוח ל-${user.email} מייל לבחירת סיסמה חדשה?`)) return;
      const r = await act(e.currentTarget, () => api(`/api/admin/users/${user.id}/reset`, {}), 'נשלח מייל איפוס ✓');
      if (r && r.dev_link) prompt('מצב פיתוח — קישור האיפוס:', r.dev_link);
    };
    $('#q-logout').onclick = async e => {
      if (!confirm('לנתק את המשתמש מכל המכשירים והאתרים?')) return;
      await act(e.currentTarget, () => api(`/api/admin/users/${user.id}/logout`, {}), 'המשתמש נותק ✓');
    };
    $('#q-delete').onclick = async e => {
      if (!confirm(`למחוק לצמיתות את ${user.email}?\nכל הגישות וההודעות שלו יימחקו.`)) return;
      const r = await act(e.currentTarget, () => api('/api/admin/users/' + user.id, null, 'DELETE'), 'המשתמש נמחק');
      if (r) { closeDrawer(); if (currentTab === 'users') loadUsers(true); }
    };

    $('#u-form').onsubmit = async e => {
      e.preventDefault();
      const f = e.target;
      refresh(await act(e.submitter, () => api('/api/admin/users/' + user.id, {
        name: f.name.value, notes: f.notes.value, role: f.admin.checked ? 'admin' : 'user', disabled: f.disabled.checked,
      }, 'PATCH'), 'נשמר ✓'));
    };

    $$('.access-card', d).forEach(form => {
      const siteId = form.dataset.site;
      $$('.seg button', form).forEach(b => {
        b.onclick = () => {
          form.status.value = b.dataset.v;
          $$('.seg button', form).forEach(x => x.setAttribute('aria-pressed', String(x === b)));
        };
      });
      $$('[data-add]', form).forEach(b => {
        b.onclick = () => {
          const days = Number(b.dataset.add);
          if (!days) { form.expires.value = ''; return; }
          const base = form.expires.value ? new Date(form.expires.value) : new Date();
          if (base < new Date()) base.setTime(Date.now());
          base.setDate(base.getDate() + days);
          form.expires.value = toDateInput(base.getTime() / 1000);
        };
      });
      form.onsubmit = async e => {
        e.preventDefault();
        let features = {};
        if (form.features.value.trim()) {
          try { features = JSON.parse(form.features.value); } catch { return toast('⚠️ ההרשאות המיוחדות לא בפורמט JSON תקין'); }
        }
        const expires = form.expires.value ? Math.floor(new Date(form.expires.value + 'T23:59:59').getTime() / 1000) : null;
        refresh(await act(e.submitter, () => api(`/api/admin/users/${user.id}/access/${siteId}`, {
          status: form.status.value, plan_id: form.plan_id.value || null, plan_expires_at: expires, features_override: features,
        }, 'PUT'), 'הגישה עודכנה ✓'));
      };
      $('[data-remove]', form).onclick = async e => {
        if (!confirm('להסיר את הגישה לאתר הזה?\n(באתר פתוח המשתמש יקבל גישה רגילה שוב בכניסה הבאה. כדי לחסום — בחרו "חסום".)')) return;
        refresh(await act(e.currentTarget, () => api(`/api/admin/users/${user.id}/access/${siteId}`, null, 'DELETE'), 'הגישה הוסרה'));
      };
    });

    $$('[data-bonus-del]', d).forEach(b => {
      b.onclick = async e => {
        if (!confirm(`למחוק את התוספת של ${b.dataset.bonusLabel}? היא תרד מהמשתמש באתר.`)) return;
        refresh(await act(e.currentTarget, () => api('/api/admin/bonuses/' + b.dataset.bonusDel, null, 'DELETE'), 'התוספת נמחקה'));
      };
    });
    // The bonus form offers what the chosen site gives (its packs, partner settings, past bonuses).
    const bonusAdd = $('#bonus-add');
    if (bonusAdd) {
      const fillKeys = () => {
        const keys = bonusKeys[bonusAdd.site.value] || [];
        bonusAdd.key.innerHTML = keys.map(k => `<option value="${esc(k)}">${esc(unitOf(k))}</option>`).join('') + '<option value="">אחר…</option>';
        syncKey();
      };
      const syncKey = () => {
        const custom = !bonusAdd.key.value;
        bonusAdd.custom.hidden = !custom;
        bonusAdd.custom.required = custom;
        $('[data-unit]', bonusAdd).textContent = custom ? '' : `(${unitOf(bonusAdd.key.value)})`;
      };
      bonusAdd.site.onchange = fillKeys;
      bonusAdd.key.onchange = syncKey;
      fillKeys();
      bonusAdd.onsubmit = async e => {
        e.preventDefault();
        const key = bonusAdd.key.value || bonusAdd.custom.value.trim();
        const n = Number(bonusAdd.amount.value);
        if (!key || !/^[A-Za-z0-9_]{1,40}$/.test(key)) return toast('⚠️ שם השדה: אותיות באנגלית, ספרות או קו תחתון');
        if (!Number.isFinite(n) || n === 0) return toast('⚠️ כמה להוסיף?');
        refresh(await act(e.submitter, () => api(`/api/admin/users/${user.id}/bonuses`, { site_id: bonusAdd.site.value, features: { [key]: n }, note: bonusAdd.note.value }), 'התוספת נוספה ✓'));
      };
    }

    const add = $('#add-access');
    if (add) add.onsubmit = async e => {
      e.preventDefault();
      refresh(await act(e.submitter, () => api(`/api/admin/users/${user.id}/access/${add.site.value}`, { status: 'active', plan_id: null, features_override: {} }, 'PUT'), 'ניתנה גישה ✓'));
    };
  }

  // ================================================================ email

  const PREFIXES = ['no-reply', 'contact', 'support', 'info', 'hello', 'team', 'billing'];

  function blankCompose() {
    return {
      from_local: store('mail:from') || 'no-reply',
      from_name: store('mail:name') || 'reem.bi',
      reply_to: '',
      mode: 'users',
      users: [],
      emails: '',
      site_id: '',
      plan_id: '',
      subject: '',
      body: '',
      button_text: '',
      button_url: '',
    };
  }

  function startCompose(preset) {
    state.compose = { ...blankCompose(), ...(state.compose && !preset ? state.compose : {}), ...(preset || {}) };
    if (currentTab === 'email') renderEmail($('#view'));
    else go('email');
  }

  function composeTo(c) {
    if (c.mode === 'users') return { mode: 'users', user_ids: c.users.map(u => u.id) };
    if (c.mode === 'emails') return { mode: 'emails', emails: c.emails };
    if (c.mode === 'site') return { mode: 'site', site_id: c.site_id };
    if (c.mode === 'plan') return { mode: 'plan', plan_id: c.plan_id };
    return { mode: 'all' };
  }

  function composeReady(c) {
    if (c.mode === 'users') return c.users.length > 0;
    if (c.mode === 'emails') return c.emails.trim().length > 0;
    if (c.mode === 'site') return !!c.site_id;
    if (c.mode === 'plan') return !!c.plan_id;
    return true;
  }

  async function renderEmail(view) {
    if (!state.compose) state.compose = blankCompose();
    const c = state.compose;
    const log = await api('/api/admin/email/log');
    if (currentTab !== 'email') return;
    // Every verified domain in the Resend account can be the sender.
    const domains = log.domains && log.domains.length ? log.domains : [log.domain];
    if (!domains.includes(c.from_domain)) c.from_domain = domains.includes(store('mail:domain')) ? store('mail:domain') : (domains.includes(log.domain) ? log.domain : domains[0]);
    const domain = c.from_domain;

    view.innerHTML = `
      <div class="page-head">
        <div><h1>מיילים</h1><div class="sub">שליחה מכל כתובת @${esc(domain)} — למשתמשים, לקבוצות או לכל כתובת</div></div>
      </div>
      ${log.configured ? '' : `<div class="alert warn" style="margin:0 0 16px">שליחת מיילים עוד לא מוגדרת (חסר <b>RESEND_API_KEY</b>) — המיילים לא יישלחו באמת.</div>`}

      <div class="compose">
        <form class="panel" id="mail-form" style="margin:0" novalidate>
          <label style="margin-top:0">מאת</label>
          <div class="form-grid" style="gap:0 10px">
            <div class="from-row"><input id="m-local" value="${esc(c.from_local)}" aria-label="קידומת הכתובת" autocomplete="off" spellcheck="false">${domains.length > 1
              ? `<select id="m-domain" class="domain" aria-label="דומיין" dir="ltr">${domains.map(d => `<option value="${esc(d)}" ${d === domain ? 'selected' : ''}>@${esc(d)}</option>`).join('')}</select>`
              : `<span class="domain">@${esc(domain)}</span>`}</div>
            <input id="m-name" value="${esc(c.from_name)}" placeholder="שם השולח (למשל reem.bi)" aria-label="שם השולח">
          </div>
          <div class="mini-chips" id="m-prefixes">${PREFIXES.map(p => `<button type="button" data-p="${p}" class="ltr">${p}@</button>`).join('')}</div>

          <label>אל</label>
          <div class="seg wrap" id="m-mode">
            ${[['users', 'משתמשים'], ['emails', 'כתובת חופשית'], ['all', 'כולם'], ['site', 'לפי אתר'], ['plan', 'לפי תוכנית']]
              .map(([v, l]) => `<button type="button" data-v="${v}" aria-pressed="${c.mode === v}">${l}</button>`).join('')}
          </div>
          <div id="m-target" style="margin-top:10px"></div>
          <div class="audience" id="m-audience">בחרו נמענים</div>

          <label for="m-subject">נושא</label>
          <input id="m-subject" value="${esc(c.subject)}" placeholder="למשל: עדכון חשוב על החשבון שלך">

          <label for="m-body">תוכן</label>
          <textarea id="m-body" rows="10" placeholder="היי {{name}},&#10;&#10;רצינו לעדכן ש…">${esc(c.body)}</textarea>
          <div class="hint">שורה ריקה = פסקה חדשה · <b>**טקסט**</b> = מודגש · קישורים הופכים ללחיצים · <span class="ltr">{{name}}</span> = שם הנמען</div>

          <details class="adv" ${c.button_text || c.reply_to ? 'open' : ''}><summary>כפתור ותשובות (אופציונלי)</summary>
            <div class="form-grid">
              <div><label>טקסט הכפתור</label><input id="m-btext" value="${esc(c.button_text)}" placeholder="כניסה לאתר"></div>
              <div><label>קישור הכפתור</label><input id="m-burl" value="${esc(c.button_url)}" placeholder="https://reembir.com/" dir="ltr"></div>
            </div>
            <label>תשובות יגיעו אל (Reply-To)</label>
            <input id="m-reply" type="email" value="${esc(c.reply_to)}" placeholder="למשל contact@${esc(domain)}" dir="ltr">
          </details>

          <div class="send-bar">
            <button class="btn btn-primary btn-lg" type="submit" id="m-send" style="margin:0">${icon('send', 'sm')} שליחה</button>
            <button class="btn btn-outline mobile-only" type="button" id="m-toggle-preview">${icon('eye', 'sm')} תצוגה</button>
            <button class="btn btn-ghost" type="button" id="m-clear">ניקוי</button>
          </div>
        </form>

        <div class="preview-box collapsed" id="m-preview-box">
          <div class="panel" style="margin:0">
            <h2>${icon('eye', 'sm')} תצוגה מקדימה</h2>
            <div class="preview-meta" id="m-preview-meta">התחילו לכתוב כדי לראות איך המייל ייראה</div>
            <iframe id="m-preview" sandbox title="תצוגה מקדימה של המייל"></iframe>
          </div>
        </div>
      </div>

      <section class="panel" style="margin-top:16px">
        <h2>נשלחו לאחרונה</h2>
        ${log.emails.length ? `<ul class="row-list">${log.emails.map(e => `
          <li class="click" data-log="${e.id}">
            <div class="grow">
              <div class="t">${esc(e.subject)}</div>
              <div class="s"><span class="ltr">${esc(e.from_addr)}</span> → ${esc(e.audience.label || '')} · ${e.count} נמענים · ${fmtTime(e.created_at)}</div>
            </div>
            <span class="badge ${e.status === 'sent' ? 'green' : e.status === 'partial' ? 'warn' : 'red'}">${e.status === 'sent' ? 'נשלח' : e.status === 'partial' ? 'חלקי' : 'נכשל'}</span>
          </li>`).join('')}</ul>` : '<div class="empty">עוד לא נשלחו מיילים</div>'}
        <div class="hint">לחיצה על מייל מהרשימה טוענת אותו לטופס, כדי לשלוח שוב או לערוך.</div>
      </section>`;

    const form = $('#mail-form');
    const sync = () => {
      c.from_local = $('#m-local').value.trim();
      if ($('#m-domain')) c.from_domain = $('#m-domain').value;
      c.from_name = $('#m-name').value;
      c.subject = $('#m-subject').value;
      c.body = $('#m-body').value;
      c.button_text = $('#m-btext').value;
      c.button_url = $('#m-burl').value;
      c.reply_to = $('#m-reply').value.trim();
    };
    const refreshPreview = debounce(() => updatePreview(), 450);
    form.addEventListener('input', () => { sync(); refreshPreview(); });

    $$('#m-prefixes button').forEach(b => { b.onclick = () => { $('#m-local').value = b.dataset.p; sync(); refreshPreview(); }; });
    $$('#m-mode button').forEach(b => {
      b.onclick = () => {
        c.mode = b.dataset.v;
        $$('#m-mode button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
        renderTarget();
        updatePreview();
      };
    });

    function renderTarget() {
      const box = $('#m-target');
      if (c.mode === 'users') {
        box.innerHTML = `<div class="picker"><label class="search">${icon('search')}<input id="m-find" type="search" placeholder="חיפוש משתמש לפי שם או מייל…" autocomplete="off"></label>
          <div class="picker-results" id="m-results" hidden></div></div>
          <div class="selected-chips" id="m-chosen"></div>`;
        const drawChosen = () => {
          $('#m-chosen').innerHTML = c.users.map((u, i) => `<span>${esc(u.name || u.email)}<button type="button" data-i="${i}" aria-label="הסרה">×</button></span>`).join('');
          $$('#m-chosen button').forEach(b => { b.onclick = () => { c.users.splice(Number(b.dataset.i), 1); drawChosen(); updatePreview(); }; });
        };
        drawChosen();
        const results = $('#m-results');
        $('#m-find').oninput = debounce(async e => {
          const q = e.target.value.trim();
          if (!q) { results.hidden = true; return; }
          const { users } = await api('/api/admin/users?' + new URLSearchParams({ q }));
          const list = users.filter(u => !c.users.some(x => x.id === u.id)).slice(0, 8);
          results.hidden = false;
          results.innerHTML = list.map(u => `<button type="button" data-id="${esc(u.id)}">${avatar(u)}<span style="min-width:0"><b>${esc(u.name || u.email)}</b><div class="hint ltr" style="margin:0">${esc(u.email)}</div></span></button>`).join('') || '<div class="empty" style="padding:14px">לא נמצאו משתמשים</div>';
          $$('button', results).forEach(b => {
            b.onclick = () => {
              const u = list.find(x => x.id === b.dataset.id);
              c.users.push({ id: u.id, email: u.email, name: u.name });
              results.hidden = true;
              $('#m-find').value = '';
              $('#m-find').focus();
              drawChosen();
              updatePreview();
            };
          });
        }, 200);
        $('#m-find').onblur = () => setTimeout(() => { results.hidden = true; }, 200);
      } else if (c.mode === 'emails') {
        box.innerHTML = `<textarea id="m-emails" rows="3" dir="ltr" placeholder="name@example.com, other@example.com">${esc(c.emails)}</textarea>
          <div class="hint">כתובת אחת או כמה — מופרדות בפסיק, רווח או שורה חדשה. לא חייבות להיות של משתמשים רשומים.</div>`;
        $('#m-emails').oninput = debounce(e => { c.emails = e.target.value; updatePreview(); }, 400);
      } else if (c.mode === 'site') {
        box.innerHTML = `<select id="m-site"><option value="">בחרו אתר…</option>${state.sites.map(s => `<option value="${esc(s.id)}" ${c.site_id === s.id ? 'selected' : ''}>${esc(s.name)} (${s.users})</option>`).join('')}</select>
          <div class="hint">כל המשתמשים הפעילים באתר.</div>`;
        $('#m-site').onchange = e => { c.site_id = e.target.value; updatePreview(); };
      } else if (c.mode === 'plan') {
        box.innerHTML = `<select id="m-plan"><option value="">בחרו תוכנית…</option>${state.sites.filter(s => s.plans.length).map(s => `<optgroup label="${esc(s.name)}">${s.plans.map(p => `<option value="${esc(p.id)}" ${c.plan_id === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</optgroup>`).join('')}</select>
          <div class="hint">כל מי שהתוכנית שלו בתוקף כרגע.</div>`;
        $('#m-plan').onchange = e => { c.plan_id = e.target.value; updatePreview(); };
      } else {
        box.innerHTML = '<div class="hint" style="margin:0">כל המשתמשים הרשומים שהחשבון שלהם לא מושבת.</div>';
      }
    }

    let previewSeq = 0;
    async function updatePreview() {
      const aud = $('#m-audience');
      const seq = ++previewSeq;
      if (!composeReady(c)) {
        aud.className = 'audience';
        aud.textContent = 'בחרו נמענים';
        return;
      }
      try {
        const r = await api('/api/admin/email/preview', { ...c, to: composeTo(c) });
        if (seq !== previewSeq || currentTab !== 'email') return;
        const more = r.count > r.sample.length ? ` ועוד ${r.count - r.sample.length}` : '';
        aud.className = 'audience ' + (r.count === 0 ? 'warn' : r.count > 100 ? 'warn' : 'ok');
        aud.innerHTML = r.count === 0
          ? 'אין נמענים בקבוצה הזו'
          : `✓ יישלח ל-<b>${r.count}</b> ${r.count === 1 ? 'נמען' : 'נמענים'}: <span class="ltr">${esc(r.sample.join(', '))}</span>${more}${r.count > 100 ? '<br>שימו לב: במסלול החינמי של Resend אפשר עד 100 מיילים ביום.' : ''}`;
        if (r.preview) {
          $('#m-preview').srcdoc = r.preview;
          $('#m-preview-meta').innerHTML = `<b>מאת:</b> <span class="ltr">${esc(r.from)}</span>`;
        }
      } catch (err) {
        if (seq !== previewSeq) return;
        aud.className = 'audience warn';
        aud.textContent = err.message;
      }
    }

    $('#m-toggle-preview').onclick = () => {
      const box = $('#m-preview-box');
      box.classList.toggle('collapsed');
      if (!box.classList.contains('collapsed')) box.scrollIntoView({ behavior: 'smooth' });
    };
    // On a wide screen the preview is always visible.
    if (matchMedia('(min-width: 861px)').matches) $('#m-preview-box').classList.remove('collapsed');

    $('#m-clear').onclick = () => {
      if ((c.subject || c.body) && !confirm('לנקות את הטופס?')) return;
      state.compose = blankCompose();
      renderEmail(view);
    };

    form.onsubmit = async e => {
      e.preventDefault();
      sync();
      if (!composeReady(c)) return toast('⚠️ בחרו נמענים');
      if (!c.subject.trim() || !c.body.trim()) return toast('⚠️ חסרים נושא או תוכן');
      const aud = $('#m-audience').textContent.match(/יישלח ל-(\d+)/);
      const count = aud ? aud[1] : '?';
      if (!confirm(`לשלוח את "${c.subject}"\nמ-${c.from_local}@${c.from_domain}\nל-${count} נמענים?`)) return;
      const r = await act($('#m-send'), () => api('/api/admin/email/send', { ...c, to: composeTo(c) }));
      if (!r) return;
      store('mail:from', c.from_local);
      store('mail:domain', c.from_domain);
      store('mail:name', c.from_name);
      toast(r.status === 'partial' ? `⚠️ נשלחו ${r.sent} מתוך ${r.total}: ${r.error}` : `✓ נשלח ל-${r.sent} ${r.sent === 1 ? 'נמען' : 'נמענים'}${r.dev ? ' (מצב פיתוח)' : ''}`);
      state.compose = { ...blankCompose(), from_local: c.from_local, from_domain: c.from_domain, from_name: c.from_name };
      renderEmail(view);
    };

    $$('[data-log]', view).forEach(li => {
      li.onclick = () => {
        const e = log.emails.find(x => String(x.id) === li.dataset.log);
        const [local] = e.from_addr.replace(/^.*</, '').replace(/>$/, '').split('@');
        const name = e.from_addr.includes('<') ? e.from_addr.replace(/\s*<.*$/, '') : '';
        const a = e.audience || {};
        state.compose = {
          ...blankCompose(),
          from_local: local, from_name: name, reply_to: e.reply_to || '',
          subject: e.subject, body: e.body, button_text: e.button_text || '', button_url: e.button_url || '',
          mode: a.mode || 'emails',
          emails: a.mode === 'emails' ? (Array.isArray(a.emails) ? a.emails.join(', ') : a.emails || '') : '',
          site_id: a.site_id || '', plan_id: a.plan_id || '',
          users: [],
        };
        if (a.mode === 'users') { state.compose.mode = 'emails'; state.compose.emails = e.recipients.join(', '); }
        renderEmail(view);
        toast('המייל נטען לטופס');
      };
    });

    renderTarget();
    updatePreview();
  }

  // ================================================================ sites
  //
  // #sites                     all sites as cards
  // #sites/<id>/<section>      one site: overview · users · plans · coupons · subs · panel · settings

  const hostOf = u => { try { const x = new URL(u); return x.host + x.pathname.replace(/\/$/, ''); } catch { return ''; } };
  const money = (v, c) => (CURRENCY[c] || (c ? c + ' ' : '')) + (Math.round((v || 0) * 100) / 100);
  const msDate = ms => fmtDate(Math.floor(ms / 1000));

  function billingBySite() {
    const out = {};
    for (const r of (state.stats && state.stats.billing && state.stats.billing.by_site) || []) {
      const o = out[r.site_id] = out[r.site_id] || { n: 0, mrr: [] };
      o.n += r.n;
      o.mrr.push(money(r.mrr, r.currency));
    }
    return out;
  }

  async function renderSites(view) {
    state.sites = (await api('/api/admin/sites')).sites;
    const b = billingBySite();
    view.innerHTML = `
      <div class="page-head">
        <div><h1>אתרים</h1><div class="sub">כל פרויקט שמתחבר דרך reem.bi. לחצו על אתר כדי לנהל אותו</div></div>
        <div class="actions"><button class="btn btn-primary" id="s-new">${icon('plus', 'sm')} אתר חדש</button></div>
      </div>
      <div class="site-grid">${state.sites.filter(s => s.id !== 'pay').map(s => `
        <button class="site-card" data-site="${esc(s.id)}">
          <span class="sc-top">
            <span class="sc-mark" aria-hidden="true">${esc((s.name || s.id).trim().charAt(0).toUpperCase())}</span>
            <span class="sc-name"><b>${esc(s.name)}</b><span class="ltr">${esc(hostOf(s.url) || s.id)}</span></span>
            ${icon('chev', 'sm')}
          </span>
          <span class="sc-stats">
            <span><b>${s.users}</b> משתמשים</span>
            ${b[s.id] ? `<span><b>${b[s.id].n}</b> מנויים</span><span><b>${esc(b[s.id].mrr.join(' + '))}</b> בחודש</span>` : ''}
          </span>
          <span class="sc-tags">
            ${s.pending ? `<span class="badge warn">${s.pending} ממתינים לאישור</span>` : ''}
            ${s.plans.some(p => p.price > 0) ? '<span class="badge green">מוכר מנויים</span>' : ''}
            ${s.admin_url ? '<span class="badge">ממשק ניהול</span>' : ''}
          </span>
        </button>`).join('') || '<div class="empty">אין אתרים</div>'}
      </div>`;
    $$('.site-card', view).forEach(c => { c.onclick = () => go('sites', encodeURIComponent(c.dataset.site)); });
    $('#s-new').onclick = newSiteDrawer;
  }

  function newSiteDrawer() {
    const d = openDrawer(`
      <div class="drawer-head"><div class="txt"><b>אתר חדש</b><span class="em">אחרי היצירה תגיעו לדף של האתר</span></div><button class="icon-btn" data-close aria-label="סגירה">${icon('x')}</button></div>
      <div class="drawer-body">${siteForm({ access_mode: 'open', redirect_uris: [], plans: [] }, true)}</div>`);
    const form = $('.site-form', d);
    $('[data-cancel]', form).onclick = () => closeDrawer(true);
    form.onsubmit = async e => {
      e.preventDefault();
      const id = form.id.value.trim();
      const r = await act(e.submitter, () => api('/api/admin/sites/' + encodeURIComponent(id), siteBody(form), 'PUT'), 'האתר נוצר ✓');
      if (!r) return;
      state.sites = r.sites;
      closeDrawer(true);
      go('sites', encodeURIComponent(id) + '/settings');
    };
  }

  function siteBody(form) {
    return {
      name: form.name.value,
      url: form.url.value,
      description: form.description.value,
      redirect_uris: form.redirect_uris.value.split('\n').map(s => s.trim()).filter(Boolean),
      access_mode: form.access_mode.value,
      default_plan: form.default_plan.value || null,
      admin_url: form.admin_url.value.trim() || null,
    };
  }

  function snippet(site) {
    return esc(`<script src="${location.origin}/sdk.js"></script>
<script>
  const auth = ReemAuth.init({ clientId: '${site.id}' });
  auth.onChange(user => { /* user?.email, user?.plan, user?.features */ });
  // auth.login()  ·  auth.logout()
</script>`);
  }

  function siteForm(site, isNew) {
    return `
      <form class="site-form" data-site="${esc(site.id || '')}">
        <div class="form-grid">
          <div><label>מזהה (client_id)</label><input name="id" class="mono" dir="ltr" value="${esc(site.id || '')}" ${isNew ? 'required pattern="[a-z0-9-]{2,40}" placeholder="my-project"' : 'disabled'}></div>
          <div><label>שם</label><input name="name" value="${esc(site.name || '')}" required></div>
          <div><label>כתובת האתר</label><input name="url" dir="ltr" value="${esc(site.url || '')}" placeholder="https://my-project.reembir.com/"></div>
          <div><label>תיאור (מוצג במסך ההתחברות)</label><input name="description" value="${esc(site.description || '')}"></div>
        </div>
        <label>כתובות חזרה מותרות — שורה לכל כתובת</label>
        <textarea name="redirect_uris" class="json" rows="2">${esc((site.redirect_uris || []).join('\n'))}</textarea>
        <div class="hint">כתובת שמסתיימת ב-/ מאשרת את כל הדפים שמתחתיה.</div>
        <div class="form-grid">
          <div><label>מי יכול להיכנס</label><select name="access_mode">${Object.entries(MODES).map(([k, l]) => `<option value="${k}" ${site.access_mode === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
          <div><label>תוכנית למשתמשים חדשים</label><select name="default_plan"><option value="">ללא</option>${(site.plans || []).map(p => `<option value="${esc(p.id)}" ${site.default_plan === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></div>
        </div>
        <label>כתובת ממשק הניהול של האתר <span class="hint">(לא חובה)</span></label>
        <input name="admin_url" dir="ltr" value="${esc(site.admin_url || '')}" placeholder="https://my-project.reembir.com/admin/">
        <div class="hint">אם לאתר יש דף ניהול משלו, הוא יופיע כאן בלשונית "ניהול האתר", מחובר אוטומטית.</div>
        <div class="row" style="margin-top:14px">
          <button class="btn btn-primary btn-sm" type="submit">${isNew ? 'יצירת אתר' : 'שמירה'}</button>
          ${isNew ? '<button type="button" class="btn btn-ghost btn-sm" data-cancel>ביטול</button>' : '<button type="button" class="btn btn-ghost btn-sm" data-snippet>קוד הטמעה</button><span style="flex:1"></span><button type="button" class="btn btn-danger btn-sm" data-delete>מחיקת אתר</button>'}
        </div>
        ${isNew ? '' : `<pre class="snippet" hidden>${snippet(site)}</pre>`}
      </form>`;
  }

  function keyBox(site) {
    const k = site.service_key;
    return `<div class="key-box" data-site="${esc(site.id)}">
        <div class="hint" style="margin-top:0">${k
          ? `קיים מפתח · נוצר ${ago(k.created_at)} · ${k.last_used_at ? 'שימוש אחרון ' + ago(k.last_used_at) : 'עוד לא השתמשו בו'}`
          : 'אין מפתח. צריך אותו רק אם לשרת של האתר יש צורך לעדכן תוכניות של משתמשים בעצמו.'}</div>
        <div class="row" style="margin-top:8px">
          <button type="button" class="btn btn-outline btn-sm" data-key-new>${k ? 'החלפת מפתח' : 'יצירת מפתח'}</button>
          ${k ? '<button type="button" class="btn btn-ghost btn-sm" data-key-del>ביטול המפתח</button>' : ''}
        </div>
        <div data-key-out hidden style="margin-top:10px">
          <div class="alert warn" style="margin:0 0 8px">המפתח מוצג רק עכשיו. העתיקו אותו להגדרות של האתר (למשל סוד בשם <b class="ltr">SSO_SITE_KEY</b> ב-Cloudflare).</div>
          <pre class="snippet ltr" style="user-select:all;white-space:pre-wrap;word-break:break-all"></pre>
          <button type="button" class="btn btn-primary btn-sm" data-key-copy>העתקה</button>
        </div>
      </div>`;
  }

  // ---------- one site ----------

  const SECTIONS = [
    ['overview', 'סקירה'], ['stats', 'נתונים'], ['users', 'משתמשים'], ['plans', 'תוכניות ומחירים'], ['packs', 'חבילות'], ['coupons', 'קופונים'], ['partners', 'שותפים'],
    ['subs', 'מנויים'], ['panel', 'ניהול האתר'], ['settings', 'הגדרות'],
  ];
  const sv = { id: null, billing: null, manifest: undefined, form: null, q: '' };
  const siteTokens = {};

  async function siteSession(siteId) {
    let t = siteTokens[siteId];
    if (!t || t.exp < Date.now() + 60000) {
      const r = await api(`/api/admin/sites/${encodeURIComponent(siteId)}/session`, {}, 'POST');
      t = siteTokens[siteId] = { token: r.token, base: r.base, exp: Date.now() + r.expires_in * 1000, expires_in: r.expires_in };
    }
    return t;
  }

  // Calls the site's own admin API (<site url>api/admin/...), for sites that describe extra
  // stats, checks and actions in api/admin/manifest (see HOW-TO-ADD-A-SITE.md).
  async function siteApi(siteId, path, body, method) {
    const t = await siteSession(siteId);
    let res;
    try {
      res = await fetch(new URL(path, t.base).href, {
        method: method || (body ? 'POST' : 'GET'),
        headers: { authorization: 'Bearer ' + t.token, ...(body ? { 'content-type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw Object.assign(new Error('האתר לא ענה'), { code: 'unreachable' });
    }
    const data = await res.json().catch(() => null);
    if (!res.ok || !data) throw Object.assign(new Error((data && data.message) || 'שגיאה ' + res.status), { status: res.status });
    return data;
  }

  // An embedded admin screen asks for a sign-in token (sdk.js does this when it runs inside a frame).
  window.addEventListener('message', async e => {
    const d = e.data;
    if (!d || d.type !== 'reemauth:token-request') return;
    const frame = $('#site-frame');
    if (!frame || e.source !== frame.contentWindow) return;
    const site = state.sites.find(s => s.id === frame.dataset.site);
    let origin = null;
    try { origin = new URL(site.admin_url).origin; } catch { /* no admin url */ }
    if (!site || e.origin !== origin || d.clientId !== site.id) return;
    try {
      const t = await siteSession(site.id);
      e.source.postMessage({ type: 'reemauth:token', clientId: site.id, token: t.token, expires_in: Math.floor((t.exp - Date.now()) / 1000) }, e.origin);
    } catch {
      e.source.postMessage({ type: 'reemauth:token', clientId: site.id, token: null }, e.origin);
    }
  });

  async function renderSitePage(view, siteId, section) {
    if (!state.sites.length) state.sites = (await api('/api/admin/sites')).sites;
    const site = state.sites.find(s => s.id === siteId);
    if (!site) { view.innerHTML = '<div class="empty">האתר לא נמצא</div>'; return; }
    if (sv.id !== siteId) Object.assign(sv, { id: siteId, billing: null, manifest: undefined, form: null, q: '', aff: null, affPick: null, affView: null, affQ: '', more: null });
    const sections = SECTIONS.filter(([id]) => id !== 'panel' || site.admin_url);
    if (!sections.some(([id]) => id === section)) section = 'overview';
    $('#mobile-title').textContent = site.name;
    document.title = `${site.name} · ניהול reem.bi`;

    view.innerHTML = `
      <div class="page-head site-head">
        <div>
          <button class="link-btn back-link" data-back>→ כל האתרים</button>
          <h1>${esc(site.name)}</h1>
          <div class="sub ltr" style="text-align:start">${esc(hostOf(site.url) || site.id)}</div>
        </div>
        <div class="actions">${site.url ? `<a class="btn btn-outline" href="${esc(site.url)}" target="_blank" rel="noopener">לאתר ↗</a>` : ''}</div>
      </div>
      <nav class="chips site-tabs" role="tablist">${sections.map(([id, label]) =>
        `<button class="chip" data-sec="${id}" aria-pressed="${id === section}">${label}</button>`).join('')}</nav>
      <div id="site-body" style="margin-top:14px"><div class="loading"><span class="spinner"></span></div></div>`;
    $('[data-back]', view).onclick = () => go('sites');
    $$('[data-sec]', view).forEach(b => { b.onclick = () => go('sites', encodeURIComponent(siteId) + '/' + b.dataset.sec); });
    const active = $(`[data-sec="${section}"]`, view);
    if (active && active.scrollIntoView) active.scrollIntoView({ inline: 'center', block: 'nearest' });

    const body = $('#site-body', view);
    try {
      if (['overview', 'stats', 'plans', 'packs', 'coupons', 'subs'].includes(section) && !sv.billing) {
        sv.billing = await api(`/api/admin/sites/${encodeURIComponent(siteId)}/billing`);
      }
      if (currentView !== viewKeyFor(siteId, section)) return;
      const render = { overview: siteOverview, stats: siteStats, users: siteUsers, plans: sitePlans, packs: sitePacks, coupons: siteCoupons, partners: sitePartners, subs: siteSubs, panel: sitePanel, settings: siteSettings }[section];
      await render(body, site);
    } catch (err) {
      body.innerHTML = `<div class="empty">⚠️ ${esc(err.message)}</div>`;
    }
  }

  const viewKeyFor = (siteId, section) => 'sites/' + siteId + '/' + (section || 'overview');

  async function reloadBilling(site) {
    sv.billing = await api(`/api/admin/sites/${encodeURIComponent(site.id)}/billing`);
  }

  // ----- statistics: what the site shares in api/admin/manifest (version 2: sections), with
  // reem.bi's own numbers for the site (income from subscriptions and packs) next to its costs.

  const TONE = { good: 'var(--accent)', warn: 'var(--warn)', bad: 'var(--danger)' };
  const SERIES = ['var(--s1)', 'var(--s2)', 'var(--s3)'];
  const fmtN = v => (Math.abs(v) >= 100 ? Math.round(v).toLocaleString('he-IL') : (Math.round(v * 100) / 100).toLocaleString('he-IL'));
  const shortDate = k => { const [, m, d] = String(k).split('-'); return d && m ? `${Number(d)}.${Number(m)}` : String(k); };
  function niceMax(v) {
    if (!(v > 0)) return 1;
    const p = Math.pow(10, Math.floor(Math.log10(v)));
    return [1, 2, 2.5, 5, 10].map(x => x * p).find(x => x >= v);
  }

  // Bars by day (stacked when there are several series). Hover or tap a day for its numbers.
  function vizChart(item, uid) {
    const W = 720, H = 210, L = 44, R = 6, T = 10, B = 26;
    const n = item.labels.length;
    const series = item.series || [];
    const totals = item.labels.map((_, i) => series.reduce((a, s) => a + (Number(s.values[i]) || 0), 0));
    const top = niceMax(item.stacked ? Math.max(...totals) : Math.max(...series.flatMap(s => s.values.map(Number))));
    const slot = (W - L - R) / n, bw = Math.max(2, Math.min(18, slot * 0.62));
    const y = v => T + (H - T - B) * (1 - v / top);
    const grid = [0, 0.5, 1].map(f => `<line x1="${L}" x2="${W - R}" y1="${y(top * f)}" y2="${y(top * f)}" class="g${f ? '' : ' base'}"/><text x="${L - 6}" y="${y(top * f) + 4}" text-anchor="end">${fmtN(top * f)}</text>`).join('');
    let bars = '';
    item.labels.forEach((_, i) => {
      const x = L + slot * i + (slot - bw) / 2;
      let base = 0;
      series.forEach((s, si) => {
        const v = Number(s.values[i]) || 0;
        if (!v) return;
        const y1 = y(base + v), y0 = y(base);
        const h = Math.max(1, y0 - y1 - (base > 0 ? 2 : 0));
        bars += `<rect x="${x}" y="${y1}" width="${bw}" height="${h}" rx="${Math.min(3, bw / 3)}" fill="${SERIES[si] || SERIES[0]}"/>`;
        if (item.stacked) base += v;
      });
    });
    const step = Math.ceil(n / 6);
    const xl = item.labels.map((k, i) => ((n - 1 - i) % step === 0 ? `<text x="${L + slot * i + slot / 2}" y="${H - 8}" text-anchor="middle">${shortDate(k)}</text>` : '')).join('');
    const hits = item.labels.map((_, i) => `<rect class="hit" data-i="${i}" x="${L + slot * i}" y="${T}" width="${slot}" height="${H - T - B}"/>`).join('');
    const empty = !totals.some(v => v > 0);
    return `<figure class="viz-chart" data-chart="${uid}">
      <figcaption><b>${esc(item.label)}</b>${series.length > 1 ? `<span class="legend">${series.map((s, si) => `<span><i style="background:${SERIES[si]}"></i>${esc(s.name)}</span>`).join('')}</span>` : ''}</figcaption>
      <div class="plot">
        <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="${esc(item.label)}"><rect class="hl" x="0" y="${T}" width="${slot}" height="${H - T - B}" opacity="0"/>${grid}${bars}${xl}${hits}</svg>
        ${empty ? '<div class="viz-empty">אין עדיין נתונים ב-30 הימים האחרונים</div>' : ''}
        <div class="viz-tip" hidden></div>
      </div>
      <details class="viz-table"><summary>טבלה</summary><div class="tbl"><table><thead><tr><th>יום</th>${series.map(s => `<th>${esc(s.name)}</th>`).join('')}${series.length > 1 ? '<th>סה״כ</th>' : ''}</tr></thead>
        <tbody>${item.labels.map((k, i) => (totals[i] ? `<tr><td>${shortDate(k)}</td>${series.map(s => `<td>${fmtN(Number(s.values[i]) || 0)}</td>`).join('')}${series.length > 1 ? `<td>${fmtN(totals[i])}</td>` : ''}</tr>` : '')).reverse().join('') || `<tr><td colspan="${series.length + 2}">אין</td></tr>`}</tbody></table></div></details>
    </figure>`;
  }
  function bindCharts(root, items) {
    $$('[data-chart]', root).forEach(fig => {
      const item = items[fig.dataset.chart];
      const svg = $('svg', fig), tip = $('.viz-tip', fig), hl = $('.hl', svg);
      const show = i => {
        const total = item.series.reduce((a, s) => a + (Number(s.values[i]) || 0), 0);
        const val = v => (item.unit === '$' ? '$' + fmtN(v) : fmtN(v) + (item.unit ? ' ' + esc(item.unit) : ''));
        tip.innerHTML = `<b>${shortDate(item.labels[i])}</b>${item.series.map((s, si) => `<span><i style="background:${SERIES[si]}"></i>${esc(s.name)} <b>${val(Number(s.values[i]) || 0)}</b></span>`).join('')}${item.series.length > 1 ? `<span>סה״כ <b>${val(total)}</b></span>` : ''}`;
        tip.hidden = false;
        const r = $(`.hit[data-i="${i}"]`, svg);
        hl.setAttribute('x', r.getAttribute('x')); hl.setAttribute('opacity', '1');
        const box = svg.getBoundingClientRect(), rb = r.getBoundingClientRect();
        const cx = rb.left - box.left + rb.width / 2;
        tip.style.left = Math.max(0, Math.min(box.width - tip.offsetWidth, cx - tip.offsetWidth / 2)) + 'px';
      };
      const hide = () => { tip.hidden = true; hl.setAttribute('opacity', '0'); };
      $$('.hit', svg).forEach(r => { r.onpointerenter = () => show(Number(r.dataset.i)); r.onclick = () => show(Number(r.dataset.i)); });
      svg.onpointerleave = hide;
    });
  }

  function vizItem(it, uid) {
    if (it.type === 'kpi') {
      return `<div class="kpi">${it.tone ? `<i class="dot" style="background:${TONE[it.tone] || 'transparent'}"></i>` : ''}<div class="l">${esc(it.label)}</div><div class="n">${esc(String(it.value))}</div>${it.sub ? `<div class="s">${esc(it.sub)}</div>` : ''}</div>`;
    }
    if (it.type === 'meter') {
      const pct = it.max > 0 ? Math.max(0, Math.min(100, (it.value / it.max) * 100)) : 0;
      return `<div class="meter-card tone-${esc(it.tone || 'good')}">
        <div class="l">${esc(it.label)}</div>
        <div class="n">${esc(it.display || String(it.value))}</div>
        <div class="meter"><span style="width:${pct}%;background:${TONE[it.tone] || TONE.good}"></span></div>
        ${it.sub ? `<div class="sub"><span class="tag" style="color:${TONE[it.tone] || TONE.good}">${it.tone === 'bad' ? '⛔' : it.tone === 'warn' ? '⚠️' : '●'}</span>${esc(it.sub)}</div>` : ''}
        ${it.note ? `<div class="s">${esc(it.note)}</div>` : ''}
      </div>`;
    }
    if (it.type === 'chart') return vizChart(it, uid);
    if (it.type === 'split') {
      const total = it.parts.reduce((a, p) => a + (Number(p.value) || 0), 0);
      return `<div class="split-card"><div class="l">${esc(it.label)}</div>
        <div class="split">${total ? it.parts.map((p, i) => `<span style="flex:${Number(p.value) || 0};background:${SERIES[i] || SERIES[0]}" title="${esc(p.label)}"></span>`).join('') : '<span style="flex:1;background:var(--border)"></span>'}</div>
        <div class="legend">${it.parts.map((p, i) => `<span><i style="background:${SERIES[i] || SERIES[0]}"></i>${esc(p.label)} <b>${fmtN(Number(p.value) || 0)}</b>${it.unit ? ' ' + esc(it.unit) : ''}${total ? ` · ${Math.round((Number(p.value) || 0) / total * 100)}%` : ''}</span>`).join('')}</div></div>`;
    }
    if (it.type === 'note') return `<div class="alert ${it.tone === 'bad' ? 'error' : 'warn'}" style="margin:0">${esc(it.text)}</div>`;
    return '';
  }

  // reem.bi's side: income for the site this month next to what the site says it cost.
  function moneyStrip(b, f) {
    if (!b || !f) return '';
    const env = b.paypal.env;
    const subs = b.subscriptions.filter(s => s.status === 'ACTIVE' && s.env === env && (s.currency || 'ILS') === 'ILS');
    const mrr = subs.reduce((a, s) => a + (s.price || 0), 0);
    const packs = (b.month || []).find(m => m.currency === 'ILS') || { total: 0, n: 0 };
    const income = mrr + packs.total;
    const fees = income * 0.034 + 1.2 * (subs.length + packs.n);
    const cost = f.cost_30d_usd * (f.usd_ils || 3.2);
    const profit = income - fees - cost;
    const pct = income > 0 ? Math.round(profit / income * 100) : null;
    const ils = v => '₪' + fmtN(v);
    return `<section class="panel money">
      <h2>החודש, בערך <span class="hint" style="margin:0;font-weight:500">${f.source === 'openai' ? 'עלויות לפי OpenAI' : 'עלויות לפי הערכה'}</span></h2>
      <div class="money-row">
        <div><div class="l">מנויים פעילים</div><div class="n">${ils(mrr)}</div><div class="s">${subs.length} מנויים לחודש</div></div>
        <span class="op">+</span>
        <div><div class="l">חבילות ב-30 יום</div><div class="n">${ils(packs.total)}</div><div class="s">${packs.n} רכישות</div></div>
        <span class="op">−</span>
        <div><div class="l">PayPal</div><div class="n">${ils(fees)}</div><div class="s">3.4% + ₪1.20</div></div>
        <span class="op">−</span>
        <div><div class="l">OpenAI ב-30 יום</div><div class="n">${ils(cost)}</div><div class="s">$${fmtN(f.cost_30d_usd)}</div></div>
        <span class="op">=</span>
        <div class="res ${profit >= 0 ? 'pos' : 'neg'}"><div class="l">נשאר</div><div class="n">${ils(profit)}</div><div class="s">${pct === null ? 'עוד אין הכנסות' : pct + '% מההכנסה'}</div></div>
      </div>
    </section>`;
  }

  async function siteStats(body, site, force) {
    if (sv.manifest === undefined || force) {
      try { sv.manifest = await siteApi(site.id, 'api/admin/manifest'); sv.manifestAt = Date.now(); } catch (e) { sv.manifest = null; sv.manifestErr = e.message; }
    }
    const m = sv.manifest;
    if (!body.isConnected) return;
    if (!m) {
      body.innerHTML = `<div class="empty">${site.url ? `האתר לא משתף נתונים${sv.manifestErr ? ` (${esc(sv.manifestErr)})` : ''}. אתר משתף נתונים דרך <span class="mono ltr">api/admin/manifest</span> (ראו HOW-TO-ADD-A-SITE.md).` : 'לאתר אין כתובת בהגדרות.'}</div>`;
      return;
    }
    const charts = [];
    const sections = m.sections || [{ title: 'מהאתר', items: (m.stats || []).map(s => ({ type: 'kpi', label: s.label, value: s.value })) }];
    const bad = (m.checks || []).filter(c => !c.ok);
    body.innerHTML = `
      <div class="stats-head"><span class="hint" style="margin:0">עודכן ${sv.manifestAt ? ago(Math.floor(sv.manifestAt / 1000)) : ''}</span>
        <button class="btn btn-outline btn-sm" data-refresh>רענון</button></div>
      ${moneyStrip(sv.billing, m.finance)}
      ${sections.map(sec => {
        const kpis = sec.items.filter(i => i.type === 'kpi');
        const rest = sec.items.filter(i => i.type !== 'kpi');
        return `<section class="panel viz-sec">
          <h2>${esc(sec.title)}</h2>${sec.subtitle ? `<div class="hint" style="margin:-8px 0 14px">${esc(sec.subtitle)}</div>` : ''}
          ${rest.filter(i => i.type === 'meter' || i.type === 'note').map(i => vizItem(i)).join('')}
          ${kpis.length ? `<div class="kpis">${kpis.map(i => vizItem(i)).join('')}</div>` : ''}
          ${rest.filter(i => i.type !== 'meter' && i.type !== 'note').map(i => { if (i.type === 'chart') charts.push(i); return vizItem(i, charts.length - 1); }).join('')}
        </section>`;
      }).join('')}
      ${(m.actions || []).length ? `<section class="panel"><h2>פעולות</h2><div class="sheet-actions" style="margin:0">${m.actions.map(a => `<button class="btn ${a.primary ? 'btn-primary' : 'btn-outline'}" data-action="${esc(a.id)}">${esc(a.label)}</button>`).join('')}</div></section>` : ''}
      ${(m.lists || []).map(list => `<section class="panel"><h2>${esc(list.title)} <span class="badge">${list.items.length}</span></h2>
        ${list.items.length ? `<ul class="row-list">${list.items.map(it => `
          <li><div class="grow"><div class="t ltr" style="text-align:start">${esc(it.title)}</div>
            ${it.subtitle || it.date ? `<div class="s">${esc(it.subtitle || '')}${it.date ? `${it.subtitle ? ' · ' : ''}${esc(it.dateLabel || '')} ${msDate(it.date)}` : ''}</div>` : ''}</div>
            ${it.badge ? `<span class="badge ${esc(it.badgeLevel || '')}">${esc(it.badge)}</span>` : ''}</li>`).join('')}</ul>`
          : `<div class="empty">${esc(list.empty || 'אין')}</div>`}</section>`).join('')}
      ${(m.checks || []).length ? `<details class="panel"><summary><b>מצב ההגדרות באתר</b> ${bad.length ? `<span class="badge red">${bad.length} דורשים טיפול</span>` : '<span class="badge green">הכול תקין</span>'}</summary>
        <ul class="row-list" style="margin-top:10px">${[...bad, ...m.checks.filter(c => c.ok)].map(c => `
          <li><span aria-hidden="true" style="font-size:18px">${c.ok ? '✅' : '⚠️'}</span>
            <div class="grow"><div class="t ltr" style="text-align:start">${esc(c.label)}</div>${c.detail ? `<div class="s" style="white-space:normal">${esc(c.detail)}</div>` : ''}</div></li>`).join('')}</ul></details>` : ''}`;
    bindCharts(body, charts);
    $('[data-refresh]', body).onclick = async e => { e.currentTarget.disabled = true; await siteStats(body, site, true); };
    $$('[data-action]', body).forEach(b => { b.onclick = () => actionSheet(body, site, m.actions.find(a => a.id === b.dataset.action)); });
  }

  // A site's action; with fields it opens a small form, and the answer's message is shown.
  function actionSheet(body, site, a) {
    const d = sheet(a.label, esc(site.name), `
      <form class="card-s" id="ac-form" autocomplete="off">
        ${a.description ? `<div class="hint" style="margin:0 0 10px">${esc(a.description)}</div>` : ''}
        ${(a.fields || []).map((f, i) => `<label for="ac-${i}">${esc(f.label)}</label>
          <input id="ac-${i}" name="${esc(f.name)}" type="${f.type === 'number' ? 'number' : 'text'}" ${f.type === 'number' ? 'inputmode="decimal" dir="ltr"' : ''}
            ${f.step ? `step="${esc(f.step)}"` : ''} ${f.min ? `min="${esc(f.min)}"` : ''} ${f.required ? 'required' : ''} placeholder="${esc(f.placeholder || '')}">`).join('')}
        ${a.confirm ? `<div class="alert warn" style="margin:12px 0 0">${esc(a.confirm)}</div>` : ''}
        <div class="sheet-actions"><button class="btn btn-primary" type="submit">${esc(a.label)}</button></div>
      </form>`);
    const form = $('#ac-form', d);
    const first = $('input', form);
    if (first) first.focus();
    form.onsubmit = async e => {
      e.preventDefault();
      const data = {};
      (a.fields || []).forEach(f => { const v = form.elements[f.name].value; data[f.name] = f.type === 'number' ? Number(v) : v; });
      const r = await act(e.submitter, () => siteApi(site.id, 'api/admin/actions/' + encodeURIComponent(a.id), data));
      if (r) { toast(r.message || 'בוצע ✓'); closeDrawer(true); sv.manifest = undefined; siteStats(body, site); }
    };
  }

  // ----- overview

  async function siteOverview(body, site) {
    const b = sv.billing;
    const pending = (state.stats ? state.stats.pending : []).filter(p => p.site_id === site.id);
    const paypalNote = !b.paypal.configured
      ? '<div class="alert warn" style="margin:0 0 14px">PayPal עוד לא מחובר (חסרים PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET ב-Worker של reem-sso), אז אי אפשר למכור מנויים.</div>'
      : b.paypal.env === 'sandbox' ? '<div class="alert warn" style="margin:0 0 14px">PayPal במצב בדיקה (sandbox): אין חיובים אמיתיים.</div>' : '';
    body.innerHTML = `
      ${paypalNote}
      <div class="stats">
        <button class="stat" data-sec-go="users"><div class="n">${site.users}</div><div class="l">משתמשים</div></button>
        <button class="stat" data-sec-go="subs"><div class="n">${b.stats.active}</div><div class="l">מנויים פעילים</div></button>
        <button class="stat" data-sec-go="subs"><div class="n">${esc(b.stats.mrr)}</div><div class="l">הכנסה חודשית</div></button>
        <button class="stat" data-sec-go="coupons"><div class="n">${b.coupons.filter(c => c.active).length}</div><div class="l">קודי קופון פעילים</div></button>
        ${b.packs.length ? `<button class="stat" data-sec-go="packs"><div class="n">${esc(b.month.map(m => money(m.total, m.currency)).join(' + ') || money(0, b.packs[0].currency))}</div><div class="l">חבילות ב-30 יום${b.month.length ? ` (${b.month.reduce((a, m) => a + m.n, 0)})` : ''}</div></button>` : ''}
      </div>
      ${pending.length ? `<section class="panel"><h2>ממתינים לאישור <span class="badge warn">${pending.length}</span></h2><ul class="row-list">${pending.map(p => `
        <li><div class="grow"><div class="t">${esc(p.name || p.email)}</div><div class="s ltr" style="text-align:start">${esc(p.email)}</div></div>
          <button class="btn btn-primary btn-sm" data-approve="${esc(p.user_id)}">אישור</button>
          <button class="btn btn-outline btn-sm" data-deny="${esc(p.user_id)}">דחייה</button></li>`).join('')}</ul></section>` : ''}
      <section class="panel"><h2>תוכניות <button class="link-btn" data-sec-go="plans">עריכה ומחירים</button></h2>
        ${b.plans.length ? `<ul class="row-list">${b.plans.map(p => `
          <li><div class="grow"><div class="t">${esc(p.name)} ${p.id === site.default_plan ? '<span class="badge">למשתמשים חדשים</span>' : ''}</div>
            <div class="s">${p.price > 0 ? money(p.price, p.currency) + ' לחודש' + (p.public ? '' : ' · מוסתרת') : 'ניתנת ידנית'}</div></div>
            <span class="s">${p.users} משתמשים${p.subscribers ? ` · ${p.subscribers} משלמים` : ''}</span></li>`).join('')}</ul>`
          : '<div class="empty">אין תוכניות. אפשר להוסיף בלשונית "תוכניות ומחירים"</div>'}
      </section>
      <div id="site-extra"></div>`;
    $$('[data-sec-go]', body).forEach(b2 => { b2.onclick = () => go('sites', encodeURIComponent(site.id) + '/' + b2.dataset.secGo); });
    $$('[data-approve],[data-deny]', body).forEach(btn => {
      btn.onclick = async () => {
        const status = btn.dataset.approve ? 'active' : 'blocked';
        const r = await act(btn, () => api(`/api/admin/users/${btn.dataset.approve || btn.dataset.deny}/access/${site.id}`, { status, plan_id: null, features_override: {} }, 'PUT'), status === 'active' ? 'אושר ✓' : 'נדחה');
        if (r) { state.stats = await api('/api/admin/stats'); renderNav(); siteOverview(body, site); }
      };
    });
    renderManifest($('#site-extra', body), site);
  }

  // Extra stats, checks, actions and lists that the site itself reports (if it supports it).
  async function renderManifest(box, site) {
    if (sv.manifest === undefined) {
      try { sv.manifest = await siteApi(site.id, 'api/admin/manifest'); } catch { sv.manifest = null; }
    }
    const m = sv.manifest;
    if (!m || !box.isConnected) return;
    const bad = (m.checks || []).filter(c => !c.ok);
    if (m.sections) {
      box.innerHTML = `
        <section class="panel"><h2>מהאתר <button class="link-btn" data-sec-go="stats">לכל הנתונים</button></h2>
          <div class="stats" style="margin:0">${(m.stats || []).map(s => `<button class="stat" data-sec-go="stats"><div class="n">${esc(String(s.value))}</div><div class="l">${esc(s.label)}</div></button>`).join('')}</div>
          ${bad.length ? `<div class="alert warn" style="margin:12px 0 0">${bad.length} הגדרות באתר דורשות טיפול: ${esc(bad.map(c => c.label).join(', '))}</div>` : ''}
        </section>`;
      $$('[data-sec-go]', box).forEach(b => { b.onclick = () => go('sites', encodeURIComponent(site.id) + '/stats'); });
      return;
    }
    box.innerHTML = `
      ${(m.stats || []).length ? `<section class="panel"><h2>מהאתר</h2><div class="stats" style="margin:0">${m.stats.map(s => `<div class="stat"><div class="n">${esc(String(s.value))}</div><div class="l">${esc(s.label)}</div></div>`).join('')}</div></section>` : ''}
      ${(m.actions || []).map(a => `<section class="panel"><h2>${esc(a.label)}</h2>${a.description ? `<div class="hint" style="margin:0 0 10px">${esc(a.description)}</div>` : ''}
        <button class="btn ${a.primary ? 'btn-primary' : 'btn-outline'} btn-sm" data-action="${esc(a.id)}">${esc(a.label)}</button></section>`).join('')}
      ${(m.checks || []).length ? `<section class="panel"><h2>מצב ההגדרות באתר ${bad.length ? `<span class="badge red">${bad.length} דורשים טיפול</span>` : '<span class="badge green">הכול תקין</span>'}</h2>
        <ul class="row-list">${[...bad, ...m.checks.filter(c => c.ok)].map(c => `
          <li><span aria-hidden="true" style="font-size:18px">${c.ok ? '✅' : '⚠️'}</span>
            <div class="grow"><div class="t ltr" style="text-align:start">${esc(c.label)}</div>${c.detail ? `<div class="s">${esc(c.detail)}</div>` : ''}</div></li>`).join('')}</ul></section>` : ''}
      ${(m.lists || []).map(list => `<section class="panel"><h2>${esc(list.title)} <span class="badge">${list.items.length}</span></h2>
        ${list.items.length ? `<ul class="row-list">${list.items.map(it => `
          <li><div class="grow"><div class="t ltr" style="text-align:start">${esc(it.title)}</div>
            <div class="s">${esc(it.subtitle || '')}${it.date ? ` · ${esc(it.dateLabel || '')} ${msDate(it.date)}` : ''}</div></div>
            ${it.badge ? `<span class="badge ${esc(it.badgeLevel || '')}">${esc(it.badge)}</span>` : ''}</li>`).join('')}</ul>`
          : `<div class="empty">${esc(list.empty || 'אין')}</div>`}</section>`).join('')}`;
    $$('[data-action]', box).forEach(b => {
      const a = m.actions.find(x => x.id === b.dataset.action);
      b.onclick = async () => {
        if (a.confirm && !confirm(a.confirm)) return;
        const r = await act(b, () => siteApi(site.id, 'api/admin/actions/' + encodeURIComponent(a.id), {}));
        if (r) { toast(r.message || 'בוצע ✓'); sv.manifest = undefined; renderManifest(box, site); }
      };
    });
  }

  // ----- users

  async function siteUsers(body, site) {
    body.innerHTML = `
      <div class="toolbar"><label class="search">${icon('search')}<input type="search" id="su-q" placeholder="חיפוש לפי שם או מייל…" value="${esc(sv.q)}" autocomplete="off"></label></div>
      <div class="hint" style="margin:0 0 10px">לחצו על משתמש כדי לשנות את התוכנית שלו, להאריך, לתת הרשאות או לחסום.</div>
      <section class="panel" style="padding:6px 14px"><ul class="row-list" id="su-list"><li><div class="loading"><span class="spinner"></span></div></li></ul></section>`;
    const load = async () => {
      const data = await api('/api/admin/users?' + new URLSearchParams({ q: sv.q, site: site.id, offset: 0 }));
      const list = $('#su-list', body);
      if (!list) return;
      list.innerHTML = data.users.map(u => {
        const a = u.access.find(x => x.site_id === site.id) || {};
        const plan = a.plan_id ? planName(a.plan_id) : 'ברירת מחדל';
        const exp = a.plan_id && a.plan_expires_at ? (a.plan_expires_at < nowSec() ? ' · פגה' : ' · עד ' + fmtDate(a.plan_expires_at)) : '';
        return `<li class="click" data-user="${esc(u.id)}">${avatar(u)}
          <div class="grow"><div class="t">${esc(u.name || u.email.split('@')[0])}</div><div class="s ltr" style="text-align:start">${esc(u.email)}</div></div>
          <span class="badge ${a.status === 'blocked' ? 'red' : a.status === 'pending' ? 'warn' : a.plan_id ? 'green' : ''}">${a.status && a.status !== 'active' ? STATUS[a.status][0] : esc(plan + exp)}</span></li>`;
      }).join('') || '<li><div class="empty" style="width:100%">לא נמצאו משתמשים</div></li>';
      if (data.total > data.users.length) list.insertAdjacentHTML('beforeend', `<li><div class="hint">מוצגים ${data.users.length} מתוך ${data.total}. חפשו כדי לצמצם.</div></li>`);
      $$('[data-user]', list).forEach(li => { li.onclick = () => openUser(li.dataset.user); });
    };
    $('#su-q', body).oninput = debounce(e => { sv.q = e.target.value; load(); }, 250);
    await load();
  }

  // ----- shared: short lists, and a side sheet (full screen on a phone) to edit one item

  function sheet(title, sub, html) {
    return openDrawer(`
      <div class="drawer-head"><div class="txt"><b>${esc(title)}</b>${sub ? `<div class="sub">${sub}</div>` : ''}</div>
        <button class="icon-btn" data-close aria-label="סגירה">${icon('x')}</button></div>
      <div class="drawer-body">${html}</div>`);
  }
  const copyText = text => navigator.clipboard.writeText(text).then(() => toast('הועתק ✓'), () => prompt('העתיקו:', text));
  const randCode = () => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    return Array.from(crypto.getRandomValues(new Uint8Array(8)), n => chars[n % chars.length]).join('');
  };
  const UNITS = { minutes: 'דקות' };
  const featText = f => Object.entries(f || {}).map(([k, v]) => (UNITS[k] ? `${v} ${UNITS[k]}` : `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`)).join(', ');
  const head = (title, count, button) => `<h2>${title}${count === null ? '' : ` <span class="badge">${count}</span>`}${button ? `<button class="btn btn-primary btn-sm act" data-new>${button}</button>` : ''}</h2>`;
  const chev = () => `<span class="chev">${icon('chev', 'sm')}</span>`;
  // Long lists show the first few, with a button for the rest.
  function moreList(items, n, render, key) {
    const open = sv.more === key;
    return `${items.slice(0, open ? items.length : n).map(render).join('')}${items.length > n && !open ? `<li><button class="link-btn" data-more="${key}">הצגת כל ה-${items.length}</button></li>` : ''}`;
  }
  function bindMore(root, rerender) {
    $$('[data-more]', root).forEach(b => { b.onclick = () => { sv.more = b.dataset.more; rerender(); }; });
  }

  // ----- plans & prices

  function sitePlans(body, site) {
    const b = sv.billing;
    body.innerHTML = `
      <section class="panel">
        ${head('התוכניות', b.plans.length, '+ תוכנית')}
        <div class="inline-field"><span>למשתמשים חדשים</span>
          <select id="sp-default"><option value="">ללא (בלי תוכנית חינמית)</option>${b.plans.map(p => `<option value="${esc(p.id)}" ${site.default_plan === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></div>
        <div class="inline-field"><span>מתנת הצטרפות</span>
          <button class="btn btn-outline btn-sm" id="sp-welcome" style="flex:1;justify-content:space-between">${b.welcome && b.welcome.label ? esc(b.welcome.label) + ', פעם אחת' : 'ללא'}<span class="hint" style="margin:0">עריכה</span></button></div>
        <ul class="row-list">${b.plans.map(p => `
          <li class="click" data-edit="${esc(p.id)}">
            <div class="grow"><div class="t">${esc(p.name)}
              ${p.id === site.default_plan ? '<span class="badge">חדשים</span>' : ''}
              ${p.price > 0 ? (p.public ? '<span class="badge green">נמכרת</span>' : '<span class="badge">מוסתרת</span>') : ''}</div>
              <div class="s">${p.price > 0 ? money(p.price, p.currency) + ' לחודש' : 'ניתנת ידנית'} · ${p.users} משתמשים${p.subscribers ? ` · ${p.subscribers} משלמים` : ''}</div></div>
            ${chev()}</li>`).join('') || '<li><div class="empty" style="width:100%">אין תוכניות</div></li>'}</ul>
        <div class="hint">תוכנית עם מחיר נמכרת כמנוי חודשי דרך PayPal המרכזי. שינוי מחיר יוצר לבד תוכנית חדשה ב-PayPal (מנויים קיימים ממשיכים במחיר שלהם).</div>
      </section>`;
    $('#sp-default', body).onchange = async e => {
      const r = await act(e.target, () => api('/api/admin/sites/' + encodeURIComponent(site.id), {
        name: site.name, url: site.url, description: site.description, redirect_uris: site.redirect_uris,
        access_mode: site.access_mode, default_plan: e.target.value || null,
      }, 'PUT'), 'נשמר ✓');
      if (r) state.sites = r.sites;
    };
    $('[data-new]', body).onclick = () => planSheet(body, site, null);
    $$('[data-edit]', body).forEach(li => { li.onclick = () => planSheet(body, site, b.plans.find(p => p.id === li.dataset.edit)); });
    $('#sp-welcome', body).onclick = () => welcomeSheet(body, site);
  }

  // A one-time gift for every new user of the site (a bonus, so it shows on each user's page).
  function welcomeSheet(body, site) {
    const w = sv.billing.welcome || { features: {}, granted: 0, missing: 0 };
    const on = Object.keys(w.features).length > 0;
    const d = sheet('מתנת הצטרפות', esc(site.name), `
      <form class="card-s" id="wl-form" autocomplete="off">
        <div class="hint" style="margin:0 0 8px">כל משתמש חדש מקבל את זה פעם אחת, בכניסה הראשונה לאתר. זה מופיע בדף המשתמש בלשונית "תוספות", ואפשר למחוק או להוסיף שם.</div>
        <label>מה מקבלים (JSON שהאתר קורא) <span class="hint">(ריק = בלי מתנה)</span></label>
        <textarea name="features" class="json" rows="2" dir="ltr" placeholder='{"minutes": 10}'>${on ? esc(JSON.stringify(w.features)) : ''}</textarea>
        <div class="sheet-actions"><button class="btn btn-primary" type="submit">שמירה</button></div>
      </form>
      ${on ? `<div class="card-s">
        <div class="hint" style="margin:0">קיבלו: ${w.granted} · משתמשים קיימים שעוד לא קיבלו: ${w.missing}</div>
        ${w.missing ? `<div class="sheet-actions"><button class="btn btn-outline" data-backfill>לתת גם ל-${w.missing} המשתמשים הקיימים</button></div>` : ''}
      </div>` : ''}`);
    const form = $('#wl-form', d);
    const done = r => { if (r) { sv.billing = r; welcomeSheet(body, site); sitePlans(body, state.sites.find(x => x.id === site.id) || site); } };
    form.onsubmit = async e => {
      e.preventDefault();
      let features;
      try { features = JSON.parse(form.features.value.trim() || '{}'); } catch { return toast('⚠️ ה-JSON לא תקין'); }
      done(await act(e.submitter, () => api(`/api/admin/sites/${encodeURIComponent(site.id)}/welcome`, { features }, 'PUT'), 'נשמר ✓'));
    };
    const bf = $('[data-backfill]', d);
    if (bf) bf.onclick = async e => {
      if (!confirm(`לתת את המתנה (${w.label}) לכל ${w.missing} המשתמשים שכבר באתר ועוד לא קיבלו? אי אפשר לבטל בבת אחת (רק אחד-אחד מדף המשתמש).`)) return;
      done(await act(e.currentTarget, () => api(`/api/admin/sites/${encodeURIComponent(site.id)}/welcome/backfill`, {}), 'המתנה ניתנה ✓'));
    };
  }

  function planSheet(body, site, p) {
    const b = sv.billing;
    const d = sheet(p ? p.name : 'תוכנית חדשה', p ? `${p.users} משתמשים${p.subscribers ? ` · ${p.subscribers} משלמים` : ''}` : esc(site.name), `
      <form class="card-s" id="pl-form" autocomplete="off">
        <div class="form-grid">
          <div><label>שם</label><input name="name" value="${esc(p ? p.name : '')}" required placeholder="למשל: מקצועי"></div>
          <div><label>מחיר לחודש <span class="hint">(ריק = לא נמכרת)</span></label>
            <div class="row" style="flex-wrap:nowrap"><input name="price" type="number" inputmode="decimal" min="0" step="0.5" value="${p && p.price > 0 ? p.price : ''}" placeholder="ללא">
            <select name="currency" style="width:auto">${['ILS', 'USD', 'EUR'].map(c => `<option value="${c}" ${(p ? p.currency : 'ILS') === c ? 'selected' : ''}>${CURRENCY[c]}</option>`).join('')}</select></div></div>
        </div>
        <label>תיאור קצר <span class="hint">(לא חובה, מופיע בדף המחירים)</span></label>
        <input name="description" value="${esc(p ? p.description || '' : '')}" maxlength="200">
        <label class="switch-row" style="margin-top:12px">
          <span class="txt">מוצגת בדף המחירים<small>כבו כדי למכור רק דרך קופון, או לתת ידנית</small></span>
          <span class="switch"><input type="checkbox" name="public" ${!p || p.public ? 'checked' : ''}><span></span></span>
        </label>
        <label>הרשאות (JSON שהאתר קורא)</label>
        <textarea name="features" class="json" rows="2" dir="ltr" placeholder='{"limit": 50}'>${p ? esc(JSON.stringify(p.features)) : '{}'}</textarea>
        <div class="form-grid">
          <div><label>מזהה</label>${p ? `<input class="mono ltr" value="${esc(p.id)}" disabled>` : `<div class="row" style="flex-wrap:nowrap"><span class="mono ltr hint" style="margin:0">${esc(site.id)}:</span><input name="pid" class="mono" dir="ltr" required pattern="[a-z0-9_-]{2,40}" placeholder="pro"></div>`}</div>
          <div><label>סדר</label><input name="sort" type="number" value="${p ? p.sort : b.plans.length}"></div>
        </div>
        <div class="sheet-actions">
          <button class="btn btn-primary" type="submit">${p ? 'שמירה' : 'הוספת התוכנית'}</button>
          ${p ? '<button type="button" class="btn btn-ghost" data-del>מחיקה</button>' : ''}
        </div>
      </form>`);
    const form = $('#pl-form', d);
    const done = async r => {
      if (!r) return;
      state.sites = r.sites;
      await reloadBilling(site);
      closeDrawer(true);
      sitePlans(body, state.sites.find(s => s.id === site.id));
    };
    form.onsubmit = async e => {
      e.preventDefault();
      let features = {};
      try { features = JSON.parse(form.features.value.trim() || '{}'); } catch { return toast('⚠️ ההרשאות לא בפורמט JSON תקין'); }
      const id = p ? p.id : site.id + ':' + form.pid.value.trim();
      done(await act(e.submitter, () => api('/api/admin/plans/' + encodeURIComponent(id), {
        site_id: site.id, name: form.name.value, features, sort: form.sort.value,
        price: form.price.value === '' ? null : Number(form.price.value), currency: form.currency.value,
        public: form.public.checked, description: form.description.value,
      }, 'PUT'), 'התוכנית נשמרה ✓'));
    };
    const del = $('[data-del]', form);
    if (del) del.onclick = async e => {
      if (!confirm('למחוק את התוכנית? מי שעליה יחזור לתוכנית של משתמשים חדשים.')) return;
      done(await act(e.currentTarget, () => api('/api/admin/plans/' + encodeURIComponent(p.id), null, 'DELETE'), 'נמחקה'));
    };
  }

  // ----- packs (one-time purchases on top of a plan)

  function sitePacks(body, site) {
    const b = sv.billing;
    const planName = id => (b.plans.find(p => p.id === id) || { name: id }).name;
    body.innerHTML = `
      ${!b.paypal.configured ? '<div class="alert warn" style="margin:0 0 14px">PayPal עוד לא מחובר, אז אי אפשר למכור חבילות.</div>' : ''}
      <section class="panel">
        ${head('החבילות', b.packs.length, '+ חבילה')}
        <ul class="row-list">${b.packs.map(p => `
          <li class="click" data-edit="${esc(p.id)}">
            <div class="grow"><div class="t">${esc(p.name)} ${p.active ? '' : '<span class="badge">מושבתת</span>'}</div>
              <div class="s">${money(p.price, p.currency)} · ${esc(featText(p.features))} · ${p.plan_ids.length ? esc(p.plan_ids.map(planName).join(', ')) : 'כולם'} · נקנתה ${p.sold}</div></div>
            ${chev()}</li>`).join('') || '<li><div class="empty" style="width:100%">עוד אין חבילות</div></li>'}</ul>
        <div class="hint">רכישה חד-פעמית בנוסף לתוכנית. האתר מקבל את הסכום של כל מה שנקנה ומנכה בעצמו את מה שנוצל.</div>
      </section>
      <section class="panel">${head('רכישות', b.purchases.length, '')}
        <ul class="row-list">${moreList(b.purchases, 8, x => `
          <li class="click" data-user="${esc(x.user_id)}">
            <div class="grow"><div class="t">${esc(x.name || x.email)}${x.env === 'sandbox' ? ' <span class="badge warn">בדיקה</span>' : ''}</div>
              <div class="s">${esc(x.pack_name)} · ${money(x.price, x.currency)} · ${fmtTime(x.paid_at)}</div></div>
            ${chev()}</li>`, 'purchases') || '<li><div class="empty" style="width:100%">עוד אין רכישות</div></li>'}</ul>
      </section>`;
    $('[data-new]', body).onclick = () => packSheet(body, site, null);
    $$('[data-edit]', body).forEach(li => { li.onclick = () => packSheet(body, site, b.packs.find(p => p.id === li.dataset.edit)); });
    $$('[data-user]', body).forEach(x => { x.onclick = () => openUser(x.dataset.user); });
    bindMore(body, () => sitePacks(body, site));
  }

  function packSheet(body, site, p) {
    const b = sv.billing;
    const choices = b.plans.filter(x => x.id !== site.default_plan);
    const d = sheet(p ? p.name : 'חבילה חדשה', p ? `נקנתה ${p.sold} פעמים` : esc(site.name), `
      <form class="card-s" id="pk-form" autocomplete="off">
        <div class="form-grid">
          <div><label>שם</label><input name="name" value="${esc(p ? p.name : '')}" required placeholder="למשל: 100 דקות נוספות"></div>
          <div><label>מחיר (חד-פעמי)</label>
            <div class="row" style="flex-wrap:nowrap"><input name="price" type="number" inputmode="decimal" min="0.01" step="0.01" required value="${p ? p.price : ''}">
            <select name="currency" style="width:auto">${['ILS', 'USD', 'EUR'].map(c => `<option value="${c}" ${(p ? p.currency : 'ILS') === c ? 'selected' : ''}>${CURRENCY[c]}</option>`).join('')}</select></div></div>
        </div>
        <label>מה מקבלים <span class="hint">(JSON שהאתר קורא)</span></label>
        <textarea name="features" class="json" rows="2" dir="ltr" placeholder='{"minutes": 100}'>${p ? esc(JSON.stringify(p.features)) : ''}</textarea>
        <label>מי יכול לקנות <span class="hint">(בלי סימון = כולם)</span></label>
        <div class="chips" style="flex-wrap:wrap">${choices.map(x => `<button type="button" class="chip" data-for="${esc(x.id)}" aria-pressed="${!!p && p.plan_ids.includes(x.id)}">${esc(x.name)}</button>`).join('') || '<span class="hint">אין תוכניות</span>'}</div>
        <label class="switch-row">
          <span class="txt">נמכרת באתר<small>מה שכבר נקנה נשאר אצל הקונים</small></span>
          <span class="switch"><input type="checkbox" name="active" ${!p || p.active ? 'checked' : ''}><span></span></span>
        </label>
        <label>תיאור קצר <span class="hint">(לא חובה)</span></label>
        <input name="description" value="${esc(p ? p.description || '' : '')}" maxlength="200">
        <div class="form-grid">
          <div><label>מזהה</label>${p ? `<input class="mono ltr" value="${esc(p.id)}" disabled>` : `<div class="row" style="flex-wrap:nowrap"><span class="mono ltr hint" style="margin:0">${esc(site.id)}:</span><input name="pid" class="mono" dir="ltr" required pattern="[a-z0-9_-]{2,40}" placeholder="pack100"></div>`}</div>
          <div><label>סדר</label><input name="sort" type="number" value="${p ? p.sort : b.packs.length}"></div>
        </div>
        <div class="sheet-actions">
          <button class="btn btn-primary" type="submit">${p ? 'שמירה' : 'הוספת החבילה'}</button>
          ${p && !p.sold ? '<button type="button" class="btn btn-ghost" data-del>מחיקה</button>' : ''}
        </div>
      </form>`);
    const form = $('#pk-form', d);
    $$('[data-for]', form).forEach(x => { x.onclick = () => x.setAttribute('aria-pressed', String(x.getAttribute('aria-pressed') !== 'true')); });
    const path = id => `/api/admin/sites/${encodeURIComponent(site.id)}/packs/${encodeURIComponent(id)}`;
    const done = r => { if (r) { sv.billing = r; closeDrawer(true); sitePacks(body, site); } };
    form.onsubmit = async e => {
      e.preventDefault();
      let features;
      try { features = JSON.parse(form.features.value.trim() || '{}'); } catch { return toast('⚠️ "מה מקבלים" לא בפורמט JSON תקין'); }
      const id = p ? p.id : site.id + ':' + form.pid.value.trim();
      done(await act(e.submitter, () => api(path(id), {
        name: form.name.value, price: Number(form.price.value), currency: form.currency.value, features,
        plan_ids: $$('[data-for][aria-pressed="true"]', form).map(x => x.dataset.for),
        active: form.active.checked, sort: form.sort.value, description: form.description.value,
      }, 'PUT'), 'החבילה נשמרה ✓'));
    };
    const del = $('[data-del]', form);
    if (del) del.onclick = async e => {
      if (!confirm('למחוק את החבילה?')) return;
      done(await act(e.currentTarget, () => api(path(p.id), null, 'DELETE'), 'נמחקה'));
    };
  }

  // ----- coupons

  const COUPON_TYPES = [
    { id: 'percent', label: 'הנחה באחוזים', value: { label: 'אחוז הנחה (%)', min: 1, max: 100, step: 1, def: 50 }, months: { label: 'לכמה חודשים (0 = לתמיד)', min: 0, max: 24, def: 1 },
      help: 'מחיר מוזל בחודשים הראשונים, ואחר כך מחיר רגיל. 0 חודשים = הנחה לכל תקופת המנוי.' },
    { id: 'amount', label: 'הנחה בסכום', value: { label: 'הנחה בחודש', min: 1, max: 1000, step: 0.5, def: 5 }, months: { label: 'לכמה חודשים (0 = לתמיד)', min: 0, max: 24, def: 1 },
      help: 'כמה יורד מהמחיר החודשי. אם ההנחה גדולה מהמחיר, החודשים האלה חינם.' },
    { id: 'trial', label: 'חודשים חינם', value: null, months: { label: 'כמה חודשים חינם', min: 1, max: 12, def: 1 },
      help: 'נרשמים ב-PayPal עם כרטיס, לא משלמים בתקופה הזו, ואחר כך מחויבים במחיר רגיל (אלא אם ביטלו).' },
    { id: 'gift', label: 'מתנה', value: null, months: { label: 'כמה חודשים', min: 1, max: 24, def: 1 }, one: true,
      help: 'התוכנית ניתנת מיד, בלי לשלם ובלי כרטיס. בסוף התקופה המשתמש חוזר לתוכנית הרגילה.' },
  ];

  function siteCoupons(body, site) {
    const b = sv.billing;
    const active = b.coupons.filter(c => c.active).length;
    body.innerHTML = `
      ${!b.plans.some(p => p.price > 0) ? '<div class="alert warn" style="margin:0 0 14px">לאתר אין עדיין תוכנית עם מחיר. אפשר ליצור רק קודי מתנה.</div>' : ''}
      <section class="panel">
        ${head('קודי קופון', b.coupons.length, '+ קוד')}
        ${b.coupons.length ? `<div class="hint" style="margin:-6px 0 8px">${active} פעילים</div>` : ''}
        <ul class="row-list">${moreList(b.coupons, 12, x => `
          <li class="click" data-edit="${esc(x.code)}">
            <div class="grow"><div class="t"><span class="mono ltr">${esc(x.code)}</span> ${x.active ? '' : '<span class="badge">מושבת</span>'}</div>
              <div class="s">${esc(x.label)} · נוצל ${x.uses}${x.max_uses ? '/' + x.max_uses : ''}${x.expires_at ? ' · עד ' + fmtDate(x.expires_at) : ''}${x.note ? ' · ' + esc(x.note) : ''}</div></div>
            ${chev()}</li>`, 'coupons') || '<li><div class="empty" style="width:100%">עוד אין קודים</div></li>'}</ul>
      </section>`;
    $('[data-new]', body).onclick = () => couponNewSheet(body, site);
    $$('[data-edit]', body).forEach(li => { li.onclick = () => couponSheet(body, site, b.coupons.find(c => c.code === li.dataset.edit)); });
    bindMore(body, () => siteCoupons(body, site));
  }

  function couponSheet(body, site, x) {
    const shareBase = site.url ? site.url + (site.url.includes('?') ? '&' : '?') + 'coupon=' : null;
    const d = sheet(x.code, esc(x.label), `
      <dl class="card-s kv">
        <dt>סוג</dt><dd>${esc(x.label)}</dd>
        ${x.type !== 'gift' ? `<dt>תוכניות</dt><dd>${esc(x.plan_names.join(', '))}</dd>` : ''}
        <dt>נוצל</dt><dd>${x.uses}${x.max_uses ? ' מתוך ' + x.max_uses : ''}</dd>
        <dt>תוקף</dt><dd>${x.expires_at ? 'עד ' + fmtDate(x.expires_at) : 'בלי תפוגה'}</dd>
        ${x.note ? `<dt>הערה</dt><dd>${esc(x.note)}</dd>` : ''}
        <dt>מצב</dt><dd>${x.active ? 'פעיל' : 'מושבת'}</dd>
      </dl>
      <div class="sheet-actions">
        ${shareBase ? '<button class="btn btn-outline" data-link>העתקת קישור</button>' : ''}
        <button class="btn btn-outline" data-copy-code>העתקת הקוד</button>
        <button class="btn ${x.active ? 'btn-ghost' : 'btn-primary'}" data-toggle>${x.active ? 'השבתה' : 'הפעלה'}</button>
        ${x.uses ? '' : '<button class="btn btn-danger" data-del>מחיקה</button>'}
      </div>`);
    const path = `/api/admin/sites/${encodeURIComponent(site.id)}/coupons/${encodeURIComponent(x.code)}`;
    const done = r => { if (r) { sv.billing = r; closeDrawer(true); siteCoupons(body, site); } };
    if (shareBase) $('[data-link]', d).onclick = () => copyText(shareBase + encodeURIComponent(x.code));
    $('[data-copy-code]', d).onclick = () => copyText(x.code);
    $('[data-toggle]', d).onclick = async e => done(await act(e.currentTarget, () => api(path + '/' + (x.active ? 'disable' : 'enable'), {}), 'נשמר ✓'));
    const del = $('[data-del]', d);
    if (del) del.onclick = async e => {
      if (!confirm(`למחוק את הקוד ${x.code}?`)) return;
      done(await act(e.currentTarget, () => api(path, null, 'DELETE'), 'נמחק'));
    };
  }

  function couponNewSheet(body, site) {
    const b = sv.billing;
    const paid = b.plans.filter(p => p.price > 0);
    const f = sv.form = sv.form || { type: paid.length ? 'percent' : 'gift', plans: [] };
    const type = COUPON_TYPES.find(t => t.id === f.type);
    const choices = type.one ? b.plans.filter(p => p.id !== site.default_plan) : paid;
    const currency = (paid[0] || {}).currency || 'ILS';
    const d = sheet('קוד קופון חדש', esc(site.name), `
      <form class="card-s" id="cp-form" autocomplete="off">
        <div class="seg wrap">${COUPON_TYPES.map(t => `<button type="button" data-type="${t.id}" aria-pressed="${t.id === type.id}">${t.label}</button>`).join('')}</div>
        <div class="hint">${esc(type.help)}</div>
        <label>קוד</label>
        <div class="row" style="flex-wrap:nowrap"><input name="code" class="mono" dir="ltr" required placeholder="SUMMER50" style="text-transform:uppercase" value="${esc(f.code || '')}">
          <button type="button" class="btn btn-outline btn-sm" data-rand>אקראי</button></div>
        <div class="form-grid">
          ${type.value ? `<div><label>${esc(type.value.label)}${type.id === 'amount' ? ` (${CURRENCY[currency] || currency})` : ''}</label>
            <input name="value" type="number" inputmode="decimal" min="${type.value.min}" max="${type.value.max}" step="${type.value.step}" value="${esc(String(f.value ?? type.value.def))}"></div>` : ''}
          <div><label>${esc(type.months.label)}</label><input name="months" type="number" inputmode="numeric" min="${type.months.min}" max="${type.months.max}" value="${esc(String(f.months ?? type.months.def))}"></div>
          <div><label>מקסימום שימושים <span class="hint">(0 = ללא הגבלה)</span></label><input name="max_uses" type="number" inputmode="numeric" min="0" value="${esc(String(f.max_uses ?? 0))}"></div>
          <div><label>בתוקף עד <span class="hint">(לא חובה)</span></label><input name="expires" type="date" value="${esc(f.expires || '')}"></div>
        </div>
        <label>${type.one ? 'איזו תוכנית מקבלים' : 'לאילו תוכניות'} ${type.one ? '' : '<span class="hint">(בלי סימון = כולן)</span>'}</label>
        <div class="chips" style="flex-wrap:wrap">${choices.map(p => `<button type="button" class="chip" data-plan="${esc(p.id)}" aria-pressed="${f.plans.includes(p.id)}">${esc(p.name)}${p.price > 0 ? ' · ' + money(p.price, p.currency) : ''}</button>`).join('') || '<span class="hint">אין תוכניות מתאימות</span>'}</div>
        <label>הערה לעצמך <span class="hint">(לא חובה)</span></label><input name="note" maxlength="200" value="${esc(f.note || '')}">
        <div class="sheet-actions"><button class="btn btn-primary" type="submit">יצירת הקוד</button></div>
      </form>`);
    const form = $('#cp-form', d);
    const keep = () => Object.assign(f, {
      code: form.code.value, value: form.value ? form.value.value : undefined, months: form.months.value,
      max_uses: form.max_uses.value, expires: form.expires.value, note: form.note.value,
    });
    $$('[data-type]', form).forEach(x => { x.onclick = () => { keep(); Object.assign(f, { type: x.dataset.type, value: undefined, months: undefined, plans: [] }); couponNewSheet(body, site); }; });
    $$('[data-plan]', form).forEach(x => {
      x.onclick = () => {
        const k = x.dataset.plan;
        f.plans = type.one ? [k] : f.plans.includes(k) ? f.plans.filter(p => p !== k) : [...f.plans, k];
        $$('[data-plan]', form).forEach(y => y.setAttribute('aria-pressed', String(f.plans.includes(y.dataset.plan))));
      };
    });
    $('[data-rand]', form).onclick = () => { form.code.value = randCode(); };
    form.onsubmit = async e => {
      e.preventDefault();
      keep();
      const r = await act(e.submitter, () => api(`/api/admin/sites/${encodeURIComponent(site.id)}/coupons`, {
        code: f.code, type: f.type, value: f.value, months: f.months, plan_ids: f.plans, max_uses: f.max_uses,
        expires_at: f.expires ? Math.floor(new Date(f.expires + 'T23:59:59').getTime() / 1000) : null, note: f.note,
      }), 'הקוד נוצר ✓');
      if (r) { sv.billing = r; sv.form = null; closeDrawer(true); siteCoupons(body, site); }
    };
  }

  // ----- partner program (affiliate.js)

  const REFEREE = [
    { id: 'none', label: 'רק שיוך', help: 'הקוד לא נותן כלום. רק רושם שהמשתמש הגיע דרך השותף.' },
    { id: 'bonus', label: 'מתנה', help: 'המצטרף מקבל JSON שהאתר קורא (למשל {"minutes": 30}), כמו חבילה בחינם.' },
    { id: 'percent', label: 'הנחה באחוזים', value: 'אחוז הנחה (%)', months: 'לכמה חודשים (0 = לתמיד)', help: 'הנחה על מנוי, כמו קופון רגיל.' },
    { id: 'amount', label: 'הנחה בסכום', value: 'הנחה בחודש', months: 'לכמה חודשים (0 = לתמיד)', help: 'הנחה קבועה מהמחיר החודשי.' },
    { id: 'trial', label: 'חודשים חינם', months: 'כמה חודשים חינם', help: 'נרשמים למנוי ולא משלמים בחודשים הראשונים.' },
    { id: 'gift', label: 'תוכנית במתנה', months: 'כמה חודשים', one: true, help: 'תוכנית אחת ניתנת מיד, בלי לשלם.' },
  ];
  const SOURCE = { link: 'קישור', code: 'קוד', coupon: 'קופון' };
  const affPath = (site, rest = '') => `/api/admin/sites/${encodeURIComponent(site.id)}/affiliates${rest}`;

  async function sitePartners(body, site) {
    if (!sv.aff) sv.aff = await api(affPath(site));
    const d = sv.aff;
    const s = d.settings;
    const view = sv.affView || 'partners';
    const sum = k => d.partners.reduce((a, p) => a + (p[k] || 0), 0);
    const q = (sv.affQ || '').trim().toLowerCase();
    const partners = q ? d.partners.filter(p => [p.name, p.email, ...p.codes.map(c => c.code)].some(v => String(v || '').toLowerCase().includes(q))) : d.partners;
    body.innerHTML = `
      ${s.enabled ? '' : '<div class="alert warn row between" style="margin:0 0 14px;flex-wrap:nowrap"><span>תוכנית השותפים כבויה: קודים וקישורים לא עובדים.</span><button class="btn btn-primary btn-sm" data-settings>הגדרה והדלקה</button></div>'}
      <div class="stats mini">
        <div class="stat"><div class="n">${d.partners.length}</div><div class="l">שותפים</div></div>
        <div class="stat"><div class="n">${sum('referrals')}</div><div class="l">מצטרפים</div></div>
        <div class="stat"><div class="n">${sum('paid')}</div><div class="l">שילמו</div></div>
        <div class="stat"><div class="n">${sum('rewarded')}</div><div class="l">תגמולים</div></div>
      </div>
      <section class="panel">
        <h2>הגדרות <button class="btn btn-outline btn-sm act" data-settings>עריכה</button></h2>
        <dl class="kv compact">
          <dt>מצב</dt><dd>${s.enabled ? '<span class="badge green">פעילה</span>' : '<span class="badge">כבויה</span>'} ${s.self_join ? '· משתמשים מצטרפים בעצמם' : '· רק המנהל מוסיף שותפים'}</dd>
          <dt>המצטרף מקבל</dt><dd>${s.referee_type === 'none' ? 'כלום (רק שיוך)' : esc(s.label)}</dd>
          <dt>השותף מקבל</dt><dd>${Object.keys(s.partner_features).length ? esc(featText(s.partner_features)) + (s.reward_on === 'paid' ? ', כשהמצטרף משלם' : ', כשהמצטרף נרשם') : 'כלום (רק מעקב)'}</dd>
        </dl>
      </section>
      <div class="seg" style="margin-bottom:12px">
        <button type="button" data-view="partners" aria-pressed="${view === 'partners'}">שותפים (${d.partners.length})</button>
        <button type="button" data-view="referrals" aria-pressed="${view === 'referrals'}">מצטרפים (${d.referrals.length})</button>
      </div>
      ${view === 'partners' ? `
      <section class="panel">
        ${head('השותפים', null, '+ שותף')}
        ${d.partners.length > 6 ? `<label class="search" style="margin-bottom:8px">${icon('search')}<input type="search" id="af-filter" placeholder="חיפוש שותף או קוד…" value="${esc(sv.affQ || '')}"></label>` : ''}
        <ul class="row-list">${moreList(partners, 15, p => `
          <li class="click" data-partner="${esc(p.user_id)}">
            <div class="grow"><div class="t">${esc(p.name || p.email)} <span class="mono ltr">${esc(p.code)}</span>${p.active ? '' : ' <span class="badge">מושבת</span>'}</div>
              <div class="s">${p.referrals} מצטרפים · ${p.paid} שילמו${p.source === 'self' ? ' · הצטרף בעצמו' : ''}${p.codes.length > 1 ? ` · ${p.codes.length} קודים` : ''}</div></div>
            <button class="icon-btn" data-copy="${esc(p.link)}" aria-label="העתקת הקישור" title="העתקת הקישור">${icon('link')}</button>
            ${chev()}</li>`, 'partners') || `<li><div class="empty" style="width:100%">${q ? 'לא נמצא' : 'עוד אין שותפים'}</div></li>`}</ul>
      </section>` : `
      <section class="panel">
        ${head('מצטרפים דרך שותפים', null, '')}
        <ul class="row-list">${moreList(d.referrals, 15, r => `
          <li class="click" data-user="${esc(r.user_id)}">
            <div class="grow"><div class="t">${esc(r.name || r.email)} ${r.paid_at ? '<span class="badge green">שילם</span>' : ''}</div>
              <div class="s">דרך ${esc(r.partner_name || r.partner_email)} · <span class="mono">${esc(r.code)}</span> · ${fmtDate(r.created_at)}${r.rewarded_at ? ' · תוגמל' : ''}</div></div>
            ${chev()}</li>`, 'referrals') || '<li><div class="empty" style="width:100%">עוד אין מצטרפים</div></li>'}</ul>
      </section>`}
      <div class="row" style="justify-content:center;margin-top:8px"><button class="link-btn" data-reset style="color:var(--danger)">מחיקת כל נתוני תוכנית השותפים באתר</button></div>`;

    const rerender = () => sitePartners(body, site);
    $$('[data-settings]', body).forEach(b => { b.onclick = () => { sv.affForm = null; partnerSettingsSheet(body, site); }; });
    $$('[data-view]', body).forEach(b => { b.onclick = () => { sv.affView = b.dataset.view; rerender(); }; });
    $('[data-reset]', body).onclick = () => resetProgramSheet(body, site);
    const nb = $('[data-new]', body);
    if (nb) nb.onclick = () => { sv.affPick = null; addPartnerSheet(body, site); };
    const filter = $('#af-filter', body);
    if (filter) filter.oninput = debounce(() => { sv.affQ = filter.value; rerender(); setTimeout(() => { const f = $('#af-filter', body); if (f) { f.focus(); f.setSelectionRange(f.value.length, f.value.length); } }); }, 250);
    $$('[data-copy]', body).forEach(x => { x.onclick = e => { e.stopPropagation(); copyText(x.dataset.copy); }; });
    $$('[data-partner]', body).forEach(li => { li.onclick = () => partnerSheet(body, site, li.dataset.partner); });
    $$('[data-user]', body).forEach(x => { x.onclick = () => openUser(x.dataset.user); });
    bindMore(body, rerender);
  }

  // Deletes everything of the site's partner program (affiliate.js adminResetProgram).
  function resetProgramSheet(body, site) {
    const d0 = sv.aff;
    const d = sheet('מחיקת נתוני תוכנית השותפים', esc(site.name), `
      <div class="alert warn" style="margin:0 0 12px">פעולה סופית, אי אפשר לבטל אותה.</div>
      <div class="card-s">
        <div class="t" style="font-weight:700;margin-bottom:6px">יימחקו:</div>
        <ul style="margin:0;padding-inline-start:18px;line-height:1.8">
          <li>ההגדרות של התוכנית (היא תהיה כבויה)</li>
          <li>${d0.partners.length} שותפים וכל הקודים והקישורים שלהם</li>
          <li>${d0.referrals.length} רישומים של "מי הצטרף דרך מי"</li>
        </ul>
        <div class="hint" style="margin-top:8px">לא נמחקים: המשתמשים עצמם, תשלומים ומנויים, מתנת ההצטרפות לאתר ותוספות ידניות.</div>
      </div>
      <form class="card-s" id="rs-form" autocomplete="off">
        ${d0.given.count ? `<label class="switch-row">
          <span class="txt">למחוק גם את מה שהתוכנית נתנה<small>${d0.given.count} מתנות ותגמולים (סה״כ ${esc(d0.given.label)}). המשתמשים יאבדו את מה שעוד לא ניצלו מהם</small></span>
          <span class="switch danger"><input type="checkbox" name="bonuses"><span></span></span>
        </label>` : ''}
        <label>כדי לאשר, כתבו <b>מחיקה</b></label>
        <input name="confirm" autocomplete="off">
        <div class="sheet-actions"><button class="btn btn-danger" type="submit">מחיקה סופית</button></div>
      </form>`);
    const form = $('#rs-form', d);
    form.onsubmit = async e => {
      e.preventDefault();
      if (form.confirm.value.trim() !== 'מחיקה') return toast('⚠️ כתבו "מחיקה" כדי לאשר');
      const r = await act(e.submitter, () => api(affPath(site, '/reset'), { confirm: 'מחיקה', remove_bonuses: !!(form.bonuses && form.bonuses.checked) }), 'הנתונים נמחקו');
      if (r) { sv.aff = r; sv.affView = 'partners'; closeDrawer(true); sitePartners(body, site); }
    };
  }

  function partnerSettingsSheet(body, site) {
    const d0 = sv.aff;
    const s = d0.settings;
    const st = sv.affForm = sv.affForm || {
      type: s.referee_type, plans: [...s.referee_plan_ids], on: s.reward_on, enabled: s.enabled, self_join: s.self_join,
      value: s.referee_value, months: s.referee_months, rf: Object.keys(s.referee_features).length ? JSON.stringify(s.referee_features) : '',
      label: s.referee_label, pf: Object.keys(s.partner_features).length ? JSON.stringify(s.partner_features) : '',
    };
    const type = REFEREE.find(t => t.id === st.type) || REFEREE[0];
    const choices = type.one ? d0.plans.filter(p => p.id !== site.default_plan) : d0.plans.filter(p => p.price > 0);
    const d = sheet('הגדרות תוכנית השותפים', esc(site.name), `
      <form class="card-s" id="af-set" autocomplete="off">
        <label class="switch-row">
          <span class="txt">התוכנית פעילה<small>כבויה: קודים וקישורים לא עובדים</small></span>
          <span class="switch"><input type="checkbox" name="enabled" ${st.enabled ? 'checked' : ''}><span></span></span>
        </label>
        <label class="switch-row">
          <span class="txt">משתמשים מצטרפים בעצמם<small>האתר מציג כפתור הצטרפות, ומי שמצטרף מקבל קוד אקראי</small></span>
          <span class="switch"><input type="checkbox" name="self_join" ${st.self_join ? 'checked' : ''}><span></span></span>
        </label>
        <label style="margin-top:14px">המצטרף מקבל</label>
        <div class="seg wrap">${REFEREE.map(t => `<button type="button" data-rt="${t.id}" aria-pressed="${t.id === type.id}">${t.label}</button>`).join('')}</div>
        <div class="hint">${esc(type.help)}</div>
        ${type.value || type.months ? `<div class="form-grid">
          ${type.value ? `<div><label>${esc(type.value)}</label><input name="value" type="number" inputmode="decimal" min="0" step="0.5" value="${esc(String(st.value || ''))}"></div>` : ''}
          ${type.months ? `<div><label>${esc(type.months)}</label><input name="months" type="number" inputmode="numeric" min="0" max="24" value="${esc(String(st.months || 1))}"></div>` : ''}
        </div>
        <label>${type.one ? 'איזו תוכנית' : 'לאילו תוכניות'} ${type.one ? '' : '<span class="hint">(בלי סימון = כל התוכניות בתשלום)</span>'}</label>
        <div class="chips" style="flex-wrap:wrap">${choices.map(p => `<button type="button" class="chip" data-rp="${esc(p.id)}" aria-pressed="${st.plans.includes(p.id)}">${esc(p.name)}</button>`).join('') || '<span class="hint">אין תוכניות מתאימות</span>'}</div>` : ''}
        ${type.id === 'bonus' ? `<label>המתנה (JSON)</label><textarea name="rf" class="json" rows="2" dir="ltr" placeholder='{"minutes": 30}'>${esc(st.rf)}</textarea>` : ''}
        ${type.id !== 'none' ? `<label>מה כתוב למצטרף <span class="hint">(לא חובה)</span></label><input name="label" maxlength="120" value="${esc(st.label)}">` : ''}
        <label style="margin-top:14px">השותף מקבל על כל מצטרף (JSON) <span class="hint">(ריק = רק מעקב)</span></label>
        <textarea name="pf" class="json" rows="2" dir="ltr" placeholder='{"minutes": 300}'>${esc(st.pf)}</textarea>
        <div class="seg" style="margin-top:8px"><button type="button" data-ro="signup" aria-pressed="${st.on === 'signup'}">כשהמצטרף נרשם</button><button type="button" data-ro="paid" aria-pressed="${st.on === 'paid'}">כשהמצטרף משלם</button></div>
        <div class="sheet-actions"><button class="btn btn-primary" type="submit">שמירה</button></div>
      </form>`);
    const form = $('#af-set', d);
    const keep = () => Object.assign(st, {
      enabled: form.enabled.checked, self_join: form.self_join.checked, pf: form.pf.value,
      ...(form.value ? { value: form.value.value } : {}), ...(form.months ? { months: form.months.value } : {}),
      ...(form.rf ? { rf: form.rf.value } : {}), ...(form.label ? { label: form.label.value } : {}),
    });
    $$('[data-rt]', form).forEach(b => { b.onclick = () => { keep(); st.type = b.dataset.rt; st.plans = []; partnerSettingsSheet(body, site); }; });
    $$('[data-ro]', form).forEach(b => { b.onclick = () => { st.on = b.dataset.ro; $$('[data-ro]', form).forEach(x => x.setAttribute('aria-pressed', String(x === b))); }; });
    $$('[data-rp]', form).forEach(b => {
      b.onclick = () => {
        const k = b.dataset.rp;
        st.plans = type.one ? [k] : st.plans.includes(k) ? st.plans.filter(x => x !== k) : [...st.plans, k];
        $$('[data-rp]', form).forEach(x => x.setAttribute('aria-pressed', String(st.plans.includes(x.dataset.rp))));
      };
    });
    form.onsubmit = async e => {
      e.preventDefault();
      keep();
      const r = await act(e.submitter, () => api(affPath(site, '/settings'), {
        enabled: st.enabled, self_join: st.self_join, referee_type: st.type,
        referee_value: type.value ? st.value : 0, referee_months: type.months ? st.months : 0, referee_plan_ids: st.plans,
        referee_features: type.id === 'bonus' ? st.rf : '{}', referee_label: type.id === 'none' ? '' : st.label,
        partner_features: st.pf, reward_on: st.on,
      }, 'PUT'), 'ההגדרות נשמרו ✓');
      if (r) { sv.aff = r; sv.affForm = null; closeDrawer(true); sitePartners(body, site); }
    };
  }

  function addPartnerSheet(body, site) {
    const pick = sv.affPick;
    const taken = new Set(sv.aff.partners.map(p => p.user_id));
    const d = sheet('הוספת שותף', 'משתמש שכבר נכנס לאתר', pick ? `
      <div class="card-s row" style="gap:10px;flex-wrap:nowrap">${avatar(pick)}<div class="grow" style="min-width:0"><b>${esc(pick.name || pick.email)}</b><div class="hint ltr" style="margin:0;text-align:start">${esc(pick.email)}</div></div>
        <button class="btn btn-ghost btn-sm" data-unpick>החלפה</button></div>
      <form class="card-s" id="af-add" autocomplete="off">
        <label>קוד <span class="hint">(ריק = אקראי)</span></label>
        <div class="row" style="flex-wrap:nowrap"><input name="code" class="mono" dir="ltr" placeholder="DANA" style="text-transform:uppercase"><button type="button" class="btn btn-outline btn-sm" data-rand>אקראי</button></div>
        <div class="sheet-actions"><button class="btn btn-primary" type="submit">הוספה כשותף</button></div>
      </form>` : `
      <label class="search">${icon('search')}<input type="search" id="af-q" placeholder="שם או מייל…" autocomplete="off"></label>
      <ul class="row-list" id="af-res" style="margin-top:8px"></ul>`);
    if (pick) {
      $('[data-unpick]', d).onclick = () => { sv.affPick = null; addPartnerSheet(body, site); };
      const form = $('#af-add', d);
      $('[data-rand]', form).onclick = () => { form.code.value = randCode(); };
      form.onsubmit = async e => {
        e.preventDefault();
        const r = await act(e.submitter, () => api(affPath(site), { user_id: pick.id, code: form.code.value }), 'השותף נוסף ✓');
        if (r) { sv.aff = r; sv.affPick = null; sv.affView = 'partners'; sitePartners(body, site); partnerSheet(body, site, pick.id); }
      };
      return;
    }
    const q = $('#af-q', d);
    q.focus();
    q.oninput = debounce(async () => {
      const res = $('#af-res', d);
      if (!q.value.trim()) { res.innerHTML = ''; return; }
      const data = await api('/api/admin/users?' + new URLSearchParams({ q: q.value, site: site.id, offset: 0 }));
      const users = data.users.filter(u => u.access.some(a => a.site_id === site.id));
      res.innerHTML = users.slice(0, 10).map(u => `<li class="click" data-pick="${esc(u.id)}">${avatar(u)}<div class="grow"><div class="t">${esc(u.name || u.email)}</div><div class="s ltr" style="text-align:start">${esc(u.email)}</div></div>${taken.has(u.id) ? '<span class="badge">כבר שותף</span>' : ''}</li>`).join('')
        || '<li><div class="hint">לא נמצאו משתמשים באתר</div></li>';
      $$('[data-pick]', res).forEach(li => {
        li.onclick = () => {
          if (taken.has(li.dataset.pick)) { partnerSheet(body, site, li.dataset.pick); return; }
          sv.affPick = users.find(u => u.id === li.dataset.pick);
          addPartnerSheet(body, site);
        };
      });
    }, 250);
  }

  // One partner: links, their codes (only the primary is shown to them), on/off, delete.
  function partnerSheet(body, site, userId) {
    const p = sv.aff.partners.find(x => x.user_id === userId);
    if (!p) { closeDrawer(true); return; }
    const d = sheet(p.name || p.email, `<span class="ltr">${esc(p.email)}</span>`, `
      ${p.active ? '' : '<div class="alert warn" style="margin:0 0 12px">השותף מושבת: אף קוד שלו לא עובד.</div>'}
      <div class="quick" style="grid-template-columns:repeat(3,minmax(0,1fr))">
        <button type="button" data-copy="${esc(p.link)}">${icon('link')}העתקת קישור</button>
        <button type="button" data-copy="${esc(p.code)}">${icon('copy')}העתקת קוד</button>
        <button type="button" data-open-user>${icon('user')}דף המשתמש</button>
      </div>
      <dl class="card-s kv">
        <dt>קוד ראשי</dt><dd class="mono ltr" style="text-align:right">${esc(p.code)}</dd>
        <dt>מצטרפים</dt><dd>${p.referrals} (${p.paid} שילמו, ${p.rewarded} תוגמלו)</dd>
        <dt>הצטרף לתוכנית</dt><dd>${fmtDate(p.created_at)}${p.source === 'self' ? ', בעצמו' : ', על ידי המנהל'}</dd>
      </dl>
      <div class="sec-title">הקודים <span class="hint">(השותף רואה רק את הראשי)</span></div>
      <div class="card-s"><ul class="row-list">${p.codes.map(c => `
        <li style="flex-wrap:wrap">
          <div class="grow"><div class="t"><span class="mono ltr">${esc(c.code)}</span>
            ${c.primary ? '<span class="badge green">ראשי</span>' : c.active ? '<span class="badge">בתוקף</span>' : '<span class="badge red">מושבת</span>'}</div>
            <div class="s">${c.referrals} מצטרפים · ${fmtDate(c.created_at)}</div></div>
          ${c.primary ? '' : `<div class="row" style="gap:6px">
            <button class="btn btn-outline btn-sm" data-code-act="primary" data-code="${esc(c.code)}">לראשי</button>
            <button class="btn btn-outline btn-sm" data-code-act="${c.active ? 'disable' : 'enable'}" data-code="${esc(c.code)}">${c.active ? 'ביטול תוקף' : 'החזרה לתוקף'}</button>
            ${c.referrals ? '' : `<button class="btn btn-ghost btn-sm" data-code-act="delete" data-code="${esc(c.code)}">מחיקה</button>`}</div>`}
        </li>`).join('')}</ul></div>
      <form class="card-s" id="new-code" autocomplete="off">
        <label>החלפת הקוד הראשי <span class="hint">(ריק = אקראי)</span></label>
        <div class="row" style="flex-wrap:nowrap"><input name="code" class="mono" dir="ltr" placeholder="NEWCODE" style="text-transform:uppercase"><button type="button" class="btn btn-outline btn-sm" data-rand>אקראי</button></div>
        <div class="hint">ומה עם הקוד הנוכחי, <span class="mono ltr">${esc(p.code)}</span>?</div>
        <div class="sheet-actions">
          <button class="btn btn-primary" type="submit" data-keep="1">נשאר בתוקף</button>
          <button class="btn btn-outline" type="submit" data-keep="0">מושבת</button>
          <button class="btn btn-ghost" type="submit" data-extra="1">רק להוסיף קוד נוסף</button>
        </div>
      </form>
      <div class="sheet-actions" style="margin-top:16px">
        <button class="btn btn-outline" data-toggle>${p.active ? 'השבתת השותף' : 'הפעלת השותף'}</button>
        ${p.referrals ? '' : '<button class="btn btn-danger" data-del>הסרת השותף</button>'}
      </div>`);
    const after = r => { if (r) { sv.aff = r; sitePartners(body, site); partnerSheet(body, site, userId); } };
    const userPath = affPath(site, '/' + encodeURIComponent(userId));
    $$('[data-copy]', d).forEach(x => { x.onclick = () => copyText(x.dataset.copy); });
    $('[data-open-user]', d).onclick = () => openUser(userId);
    $$('[data-code-act]', d).forEach(x => {
      x.onclick = async () => {
        const action = x.dataset.codeAct;
        if (action === 'delete' && !confirm(`למחוק את הקוד ${x.dataset.code}?`)) return;
        const path = userPath + '/codes/' + encodeURIComponent(x.dataset.code) + (action === 'delete' ? '' : '/' + action);
        after(await act(x, () => api(path, action === 'delete' ? null : {}, action === 'delete' ? 'DELETE' : 'POST'), 'נשמר ✓'));
      };
    });
    const form = $('#new-code', d);
    $('[data-rand]', form).onclick = () => { form.code.value = randCode(); };
    form.onsubmit = async e => {
      e.preventDefault();
      const extra = e.submitter.dataset.extra === '1';
      after(await act(e.submitter, () => api(userPath + '/codes', { code: form.code.value, primary: !extra, keep_old: e.submitter.dataset.keep !== '0' }), extra ? 'הקוד נוסף ✓' : 'הקוד הוחלף ✓'));
    };
    $('[data-toggle]', d).onclick = async e => after(await act(e.currentTarget, () => api(userPath + '/' + (p.active ? 'disable' : 'enable'), {}), 'נשמר ✓'));
    const del = $('[data-del]', d);
    if (del) del.onclick = async e => {
      if (!confirm('להסיר את השותף? הקודים והקישור שלו יפסיקו לעבוד.')) return;
      const r = await act(e.currentTarget, () => api(userPath, null, 'DELETE'), 'הוסר');
      if (r) { sv.aff = r; closeDrawer(true); sitePartners(body, site); }
    };
  }

  // ----- subscriptions

  const SUB_STATUS = { ACTIVE: ['פעיל', 'green'], CANCELLED: ['בוטל', ''], SUSPENDED: ['מושהה', 'red'], EXPIRED: ['הסתיים', ''] };

  function siteSubs(body, site) {
    const b = sv.billing;
    body.innerHTML = `
      <div class="stats">
        <div class="stat"><div class="n">${b.stats.active}</div><div class="l">פעילים</div></div>
        <div class="stat"><div class="n">${esc(b.stats.mrr)}</div><div class="l">הכנסה חודשית</div></div>
        <div class="stat"><div class="n">${b.stats.cancelled}</div><div class="l">בוטלו, פעילים עד סוף החודש</div></div>
        <div class="stat"><div class="n">${esc(moneyList(b.stats.collected_30d || [], 'net'))}</div><div class="l">נכנס ב-30 ימים, אחרי עמלות</div></div>
      </div>
      <section class="panel" id="pp-sync">
        <h2>שילמו ולא קיבלו תוכנית?</h2>
        <div class="hint" style="margin-top:0">בודק מול PayPal את התשלומים על מנויים מ-31 הימים האחרונים, ומוצא מי ששילם והתוכנית לא הופעלה לו (למשל אם סגר את הדף באמצע). בדרך כלל זה קורה לבד: PayPal מעדכן את המערכת מיד על כל תשלום (חיבור בדף הסקירה), ובדיקה יומית מתקנת את מה שפספס. הכפתור הזה לבדיקה ידנית או למקרים שלא נפתרו.</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
          <button class="btn btn-primary" id="pp-scan">בדיקה מול PayPal</button>
        </div>
        <div id="pp-result"></div>
        <details class="adv" style="margin-top:12px"><summary>חיבור מנוי לפי המזהה שלו ב-PayPal</summary>
          <div class="hint">המזהה מתחיל ב-I- ומופיע בקבלה של PayPal ללקוח, או ב-PayPal ← פעילות ← התשלום.</div>
          <form id="pp-link" style="display:flex;gap:8px;margin-top:8px">
            <input id="pp-link-id" dir="ltr" placeholder="I-ABC123DEF456" style="flex:1;min-width:0" autocomplete="off">
            <button class="btn btn-outline" type="submit">חיבור</button>
          </form>
        </details>
      </section>
      <section class="panel"><h2>מנויים</h2>
        ${b.subscriptions.length ? `<ul class="row-list">${b.subscriptions.map(s => {
          const [label, cls] = SUB_STATUS[s.status] || [s.status, ''];
          const running = s.paid_until && s.paid_until > nowSec();
          return `<li style="flex-wrap:wrap">
            <div class="grow click" data-user="${esc(s.user_id)}" style="min-width:200px">
              <div class="t">${esc(s.name || s.email)} <span class="badge ${cls}">${label}</span>${s.env === 'sandbox' ? ' <span class="badge warn">בדיקה</span>' : ''}</div>
              <div class="s ltr" style="text-align:start">${esc(s.email)}</div>
              <div class="s">${esc(s.plan_name)} · ${money(s.price, s.currency)} לחודש${s.coupon_code ? ' · קוד ' + esc(s.coupon_code) : ''} · ${s.status === 'ACTIVE' ? 'מתחדש ב-' : running ? 'פעיל עד ' : 'הסתיים ב-'}${fmtDate(s.paid_until)}</div>
            </div>
            ${s.status === 'ACTIVE' ? `<button class="btn btn-outline btn-sm" data-cancel-sub="${esc(s.id)}">ביטול המנוי</button>` : ''}
          </li>`;
        }).join('')}</ul>` : '<div class="empty">עוד אין מנויים</div>'}
      </section>`;
    $$('[data-user]', body).forEach(x => { x.onclick = () => openUser(x.dataset.user); });
    const refreshSubs = async () => { sv.billing = await api(`/api/admin/sites/${encodeURIComponent(site.id)}/billing`); siteSubs(body, site); };
    const fixRow = p => `<li style="flex-wrap:wrap">
        <div class="grow" style="min-width:200px">
          <div class="t">${esc(p.user ? p.user.name || p.user.email : 'משתמש לא ידוע')} <span class="badge red">שילם, בלי תוכנית</span></div>
          <div class="s ltr" style="text-align:start">${esc(p.user ? p.user.email : '')}${p.payer && (!p.user || p.payer !== p.user.email) ? ' · PayPal: ' + esc(p.payer) : ''}</div>
          <div class="s">${esc(p.site ? p.site.name : '?')} · ${esc(p.plan ? p.plan.name : 'תוכנית לא מוכרת')}${p.amount ? ' · ' + money(p.amount, p.currency) : ''}${p.last_payment_at ? ' · ' + fmtTime(p.last_payment_at) : ''} · <span class="ltr">${esc(p.id)}</span></div>
        </div>
        ${p.fixable ? `<button class="btn btn-primary btn-sm" data-fix="${esc(p.id)}">הפעלת התוכנית</button>` : `<span class="s">PayPal: ${esc(p.status)}</span>`}
      </li>`;
    const link = async (btn, id) => {
      const r = await act(btn, () => api('/api/admin/billing/link', { subscription_id: id }), 'התוכנית הופעלה ✓');
      if (r) { toast(`${r.fixed.user.email} עבר/ה ל${r.fixed.plan.name} ✓`); await refreshSubs(); }
    };
    $('#pp-scan', body).onclick = async e => {
      const out = $('#pp-result', body);
      out.innerHTML = '<div class="loading" style="padding:16px"><span class="spinner"></span></div>';
      const r = await act(e.currentTarget, () => api('/api/admin/billing/scan'));
      if (!r) { out.innerHTML = ''; return; }
      out.innerHTML = `
        ${r.search_error ? `<div class="alert warn" style="margin-top:12px">${esc(r.search_error)}</div>` : ''}
        ${r.problems.length ? `<ul class="row-list" style="margin-top:10px">${r.problems.map(fixRow).join('')}</ul>`
          : `<div class="empty" style="padding:14px 0 4px">${r.search_error ? 'לא נמצאו מנויים שהתחילו ולא הופעלו' : 'הכול תקין: כל מי ששילם ב-' + r.days + ' הימים האחרונים קיבל את התוכנית ✓'}</div>`}`;
      $$('[data-fix]', out).forEach(b => { b.onclick = () => link(b, b.dataset.fix); });
    };
    $('#pp-link', body).onsubmit = e => { e.preventDefault(); link(e.submitter, $('#pp-link-id', body).value.trim()); };
    $$('[data-cancel-sub]', body).forEach(x => {
      x.onclick = async () => {
        if (!confirm('לבטל את המנוי ב-PayPal? לא יהיו חיובים נוספים, והתוכנית תמשיך לעבוד עד סוף החודש ששולם.')) return;
        const r = await act(x, () => api(`/api/admin/subscriptions/${encodeURIComponent(x.dataset.cancelSub)}/cancel`, {}), 'המנוי בוטל');
        if (r) { sv.billing = r; siteSubs(body, site); }
      };
    });
  }

  // ----- the site's own admin screen, embedded and signed in

  function sitePanel(body, site) {
    body.innerHTML = `
      <div class="embed-wrap">
        <iframe id="site-frame" data-site="${esc(site.id)}" src="${esc(site.admin_url)}" title="ניהול ${esc(site.name)}" allow="clipboard-write"></iframe>
      </div>
      <div class="hint">המסך נטען מתוך האתר עצמו ומחובר אוטומטית עם החשבון שלך. <a href="${esc(site.admin_url)}" target="_blank" rel="noopener">פתיחה בחלון נפרד ↗</a></div>`;
  }

  // ----- settings (the technical part)

  function siteSettings(body, site) {
    body.innerHTML = `
      <section class="panel"><h2>פרטי האתר וההתחברות</h2>${siteForm(site, false)}</section>
      <section class="panel" id="mail-panel"><h2>שליחת מיילים</h2><div class="loading"><span class="spinner"></span></div></section>
      <section class="panel"><h2>מפתח שרת</h2>${keyBox(site)}</section>`;
    renderMailPanel($('#mail-panel', body), site);
    const form = $('.site-form', body);
    form.onsubmit = async e => {
      e.preventDefault();
      const r = await act(e.submitter, () => api('/api/admin/sites/' + encodeURIComponent(site.id), siteBody(form), 'PUT'), 'האתר נשמר ✓');
      if (r) { state.sites = r.sites; siteSettings(body, state.sites.find(s => s.id === site.id)); }
    };
    $('[data-snippet]', form).onclick = () => { const pre = $('.snippet', form); pre.hidden = !pre.hidden; };
    $('[data-delete]', form).onclick = async e => {
      if (prompt(`מחיקת האתר תמחק את כל הגישות והתוכניות שלו.\nהקלידו "${site.id}" לאישור:`) !== site.id) return;
      const r = await act(e.currentTarget, () => api('/api/admin/sites/' + site.id, null, 'DELETE'), 'האתר נמחק');
      if (r) { state.sites = r.sites; go('sites'); }
    };
    const box = $('.key-box', body);
    const out = $('[data-key-out]', box);
    $('[data-key-new]', box).onclick = async e => {
      if ($('[data-key-del]', box) && !confirm('להחליף את המפתח? המפתח הישן יפסיק לעבוד מיד.')) return;
      const r = await act(e.currentTarget, () => api(`/api/admin/sites/${encodeURIComponent(site.id)}/key`, {}, 'POST'), 'נוצר מפתח ✓');
      if (!r) return;
      $('pre', out).textContent = r.key;
      out.hidden = false;
      $('[data-key-copy]', box).onclick = () => navigator.clipboard.writeText(r.key).then(() => toast('המפתח הועתק ✓'), () => toast('סמנו והעתיקו ידנית'));
    };
    const del = $('[data-key-del]', box);
    if (del) del.onclick = async e => {
      if (!confirm('לבטל את המפתח? השרת של האתר לא יוכל לעדכן תוכניות עד שתיצרו מפתח חדש.')) return;
      const r = await act(e.currentTarget, () => api(`/api/admin/sites/${encodeURIComponent(site.id)}/key`, null, 'DELETE'), 'המפתח בוטל');
      if (r) { state.sites = (await api('/api/admin/sites')).sites; siteSettings(body, state.sites.find(s => s.id === site.id)); }
    };
  }

  // Which address the site's emails come from (sent by reem.bi with the one Resend key).
  async function renderMailPanel(box, site) {
    let info;
    try { info = await api('/api/admin/email/domains'); } catch (err) { box.innerHTML = `<h2>שליחת מיילים</h2><div class="empty">⚠️ ${esc(err.message)}</div>`; return; }
    const domains = info.domains || [];
    const current = site.mail_from || '';
    const m = current.match(/^(?:(.*?)\s*<)?([^@<\s]+)@([^>\s]+)>?$/) || [];
    const name = m[1] !== undefined ? m[1] : (current ? '' : site.name);
    const local = m[2] || site.id;
    const domain = m[3] || (domains.find(d => d.status === 'verified') || { name: 'reembir.com' }).name;
    box.innerHTML = `
      <h2>שליחת מיילים</h2>
      <div class="hint" style="margin:-6px 0 12px">המיילים של האתר (למשל תמלול שנשלח למשתמש) יוצאים דרך חשבון Resend המרכזי. כאן בוחרים מאיזו כתובת.${current ? '' : ` כרגע: ברירת המחדל <span class="ltr">${esc(info.default_from)}</span>.`}</div>
      ${domains.length ? '' : '<div class="alert warn" style="margin:0 0 12px">לא הצלחנו לקרוא את הדומיינים מ-Resend (צריך מפתח Full access ב-RESEND_API_KEY של reem-sso). אפשר עדיין לכתוב כתובת ידנית.</div>'}
      <form id="mail-form-site" class="form-grid">
        <div><label>שם השולח</label><input name="name" value="${esc(name)}" maxlength="60" placeholder="${esc(site.name)}"></div>
        <div><label>כתובת</label>
          <div class="from-row" dir="ltr"><input name="local" class="mono" dir="ltr" value="${esc(local)}" required pattern="[a-zA-Z0-9._+\-]{1,64}">
          ${domains.length
            ? `<select name="domain" class="domain" dir="ltr">${domains.map(d => `<option value="${esc(d.name)}" ${d.name === domain ? 'selected' : ''} ${d.status === 'verified' ? '' : 'disabled'}>@${esc(d.name)}${d.status === 'verified' ? '' : ' (לא מאומת)'}</option>`).join('')}</select>`
            : `<span class="domain">@</span><input name="domain" class="mono" dir="ltr" value="${esc(domain)}" style="max-width:45%">`}</div></div>
      </form>
      <div class="hint" id="mail-preview"></div>
      <div class="row" style="margin-top:12px">
        <button class="btn btn-primary btn-sm" id="mail-save">שמירה</button>
        ${current ? '<button class="btn btn-ghost btn-sm" id="mail-reset">חזרה לברירת המחדל</button>' : ''}
      </div>`;
    const form = $('#mail-form-site', box);
    const value = () => {
      const n = form.name.value.trim();
      const addr = `${form.local.value.trim()}@${form.domain.value.trim()}`;
      return n ? `${n} <${addr}>` : addr;
    };
    const preview = () => { $('#mail-preview', box).innerHTML = `המיילים יגיעו מ: <b class="ltr">${esc(value())}</b>`; };
    form.oninput = preview;
    form.onchange = preview;
    preview();
    const save = async (btn, mailFrom) => {
      const r = await act(btn, () => api('/api/admin/sites/' + encodeURIComponent(site.id), {
        name: site.name, url: site.url, description: site.description, redirect_uris: site.redirect_uris,
        access_mode: site.access_mode, default_plan: site.default_plan, mail_from: mailFrom,
      }, 'PUT'), 'נשמר ✓');
      if (r) { state.sites = r.sites; renderMailPanel(box, state.sites.find(s => s.id === site.id)); }
    };
    $('#mail-save', box).onclick = e => save(e.currentTarget, value());
    const reset = $('#mail-reset', box);
    if (reset) reset.onclick = e => save(e.currentTarget, null);
  }

  // ================================================================ support chat (chat.reembir.com), embedded

  function renderChat(view) {
    const url = state.stats && state.stats.chat_url;
    view.innerHTML = url
      ? `<div class="embed-wrap tall"><iframe src="${esc(url)}/admin" title="צ'אט שירות לקוחות" allow="clipboard-write; microphone; notifications"></iframe></div>
         <div class="hint">מוקד הנציגים של chat.reembir.com. <a href="${esc(url)}/admin" target="_blank" rel="noopener">פתיחה בחלון נפרד ↗</a></div>`
      : '<div class="empty">הצ\'אט עוד לא מחובר (חסר CHAT_SERVICE_KEY ב-Worker של reem-sso).</div>';
  }

  // ================================================================ payments

  const PAY_STATUS = { open: ['ממתין לתשלום', 'warn'], paid: ['שולם', 'green'], cancelled: ['בוטל', ''], expired: ['פג תוקף', 'red'] };
  const CURRENCY = { ILS: '₪', USD: '$', EUR: '€' };
  let payState = { filter: 'all', data: null };

  async function renderPay(view) {
    const data = payState.data = await api('/api/admin/pay');
    if (currentTab !== 'pay') return;
    const list = data.requests.filter(r => payState.filter === 'all' || r.status === payState.filter);
    view.innerHTML = `
      <div class="page-head">
        <div><h1>בקשות תשלום</h1><div class="sub">${data.open} ממתינות${data.paid_totals.length ? ' · שולם: ' + data.paid_totals.map(esc).join(' + ') : ''}</div></div>
        <div class="actions"><button class="btn btn-primary" id="pay-new">${icon('plus', 'sm')} בקשת תשלום</button></div>
      </div>
      ${data.configured ? (data.paypal_env === 'sandbox' ? '<div class="alert warn" style="margin:0 0 14px">PayPal במצב בדיקה (sandbox) — אין חיובים אמיתיים.</div>' : '') : '<div class="alert warn" style="margin:0 0 14px">PayPal עוד לא מחובר (חסרים <b>PAYPAL_CLIENT_ID</b> ו-<b>PAYPAL_CLIENT_SECRET</b>) — אפשר ליצור בקשות, אבל עוד אי אפשר לשלם.</div>'}
      <div class="chips" id="pay-chips">${[['all', 'הכול'], ['open', 'ממתינות'], ['paid', 'שולמו'], ['expired', 'פג תוקף'], ['cancelled', 'בוטלו']]
        .map(([v, l]) => `<button class="chip" data-f="${v}" aria-pressed="${payState.filter === v}">${l}</button>`).join('')}</div>
      <section class="panel">
        ${list.length ? `<ul class="row-list">${list.map(r => {
          const [label, cls] = PAY_STATUS[r.status] || [r.status, ''];
          return `<li class="click" data-pay="${esc(r.id)}">
            <div class="grow">
              <div class="t">${esc(r.description)}</div>
              <div class="s">${esc(r.user_name || '')}${r.user_name ? ' · ' : ''}<span class="ltr">${esc(r.email)}</span> · ${fmtDate(r.created_at)}</div>
            </div>
            <b class="ltr" style="white-space:nowrap">${esc(r.amount_text)}</b>
            <span class="badge ${cls}">${label}</span>
          </li>`;
        }).join('')}</ul>` : `<div class="empty">${data.requests.length ? 'אין בקשות בסינון הזה' : 'עוד לא יצרת בקשות תשלום'}</div>`}
      </section>`;
    $('#pay-new').onclick = () => newPayDrawer();
    $$('#pay-chips .chip').forEach(c => { c.onclick = () => { payState.filter = c.dataset.f; renderPay(view); }; });
    $$('[data-pay]', view).forEach(li => { li.onclick = () => openPay(data.requests.find(r => r.id === li.dataset.pay)); });
  }

  async function shareLink(r) {
    const text = `בקשת תשלום: ${r.amount_text} — ${r.description}`;
    if (navigator.share) {
      try { await navigator.share({ title: text, text, url: r.link }); return; } catch { /* cancelled */ }
    }
    await copyLink(r);
  }

  async function copyLink(r) {
    try {
      await navigator.clipboard.writeText(r.link);
      toast('הקישור הועתק ✓');
    } catch {
      prompt('העתיקו את הקישור:', r.link);
    }
  }

  function payLinkBox(r) {
    return `<div class="card-s">
      <label style="margin-top:0">קישור לתשלום</label>
      <div class="from-row"><input class="mono" readonly value="${esc(r.link)}" id="pd-link" style="border-radius:10px"></div>
      <div class="quick" style="margin:12px 0 0;grid-template-columns:repeat(3,minmax(0,1fr))">
        <button type="button" id="pd-copy">${icon('copy')}העתקה</button>
        <button type="button" id="pd-share">${icon('share')}שיתוף</button>
        <button type="button" id="pd-open">${icon('link')}פתיחה</button>
      </div>
    </div>`;
  }

  function bindLinkBox(r) {
    $('#pd-link').onclick = e => e.target.select();
    $('#pd-copy').onclick = () => copyLink(r);
    $('#pd-share').onclick = () => shareLink(r);
    $('#pd-open').onclick = () => window.open(r.link, '_blank', 'noopener');
  }

  function openPay(r) {
    const [label, cls] = PAY_STATUS[r.status] || [r.status, ''];
    openDrawer(`
      <div class="drawer-head">
        <div class="txt"><b class="ltr" style="text-align:right">${esc(r.amount_text)}</b><div class="em" style="direction:rtl">${esc(r.description)}</div></div>
        <button class="icon-btn" data-close aria-label="סגירה">${icon('x')}</button>
      </div>
      <div class="drawer-body">
        <div class="u-tags" style="margin-bottom:14px"><span class="badge ${cls}">${label}</span>
          <span class="badge">${r.user_id ? 'משתמש רשום' : 'חשבון עם המייל'}</span>${r.source === 'chat' ? '<span class="badge">💬 מהצ׳אט</span>' : ''}</div>
        ${r.status === 'open' ? payLinkBox(r) : ''}
        <div class="sec-title">פרטים</div>
        <dl class="card-s kv">
          <dt>משלם</dt><dd>${r.user_name ? esc(r.user_name) + ' · ' : ''}<span class="ltr">${esc(r.email)}</span></dd>
          <dt>נוצר</dt><dd>${fmtTime(r.created_at)}</dd>
          <dt>תוקף</dt><dd>${r.expires_at ? fmtDate(r.expires_at) : 'ללא הגבלה'}</dd>
          <dt>נשלח במייל</dt><dd>${r.emailed_at ? fmtTime(r.emailed_at) : 'לא'}</dd>
          ${r.paid_at ? `<dt>שולם</dt><dd>${fmtTime(r.paid_at)}</dd>` : ''}
          ${r.paypal_capture_id ? `<dt>אסמכתא PayPal</dt><dd class="mono ltr" style="text-align:right">${esc(r.paypal_capture_id)}</dd>` : ''}
          ${r.paypal_payer_email && r.paypal_payer_email !== r.email ? `<dt>חשבון PayPal</dt><dd class="ltr" style="text-align:right">${esc(r.paypal_payer_email)}</dd>` : ''}
          ${r.on_paid ? `<dt>שדרוג אחרי תשלום</dt><dd>${esc(r.on_paid.site_name)} · ${esc(r.on_paid.plan_name || 'ברירת מחדל')}${r.on_paid.days ? ` · ${r.on_paid.days} ימים` : ''}${r.on_paid_result ? (r.on_paid_result.ok ? ' ✓ בוצע' : ` ✗ ${esc(r.on_paid_result.error)}`) : ''}</dd>` : ''}
          ${r.source === 'chat' ? `<dt>נוצר בצ׳אט</dt><dd>${esc(r.created_by)}${r.source_ref ? ` · שיחה #${esc(r.source_ref)}` : ''}</dd>` : ''}
          <dt>מזהה</dt><dd class="mono ltr" style="text-align:right">${esc(r.id)}</dd>
        </dl>
        <div class="row" style="margin-top:16px">
          ${r.status === 'open' ? `<button class="btn btn-outline btn-sm" data-act="send">${icon('mail', 'sm')} ${r.emailed_at ? 'שליחה שוב במייל' : 'שליחה במייל'}</button>
            <button class="btn btn-outline btn-sm" data-act="cancel">ביטול הבקשה</button>` : ''}
          ${r.status === 'cancelled' ? '<button class="btn btn-outline btn-sm" data-act="reopen">פתיחה מחדש</button>' : ''}
          <span style="flex:1"></span>
          <button class="btn btn-danger btn-sm" data-act="delete">${icon('trash', 'sm')} מחיקה</button>
        </div>
      </div>`);
    if (r.status === 'open') bindLinkBox(r);
    $$('#drawer [data-act]').forEach(b => {
      b.onclick = async () => {
        const action = b.dataset.act;
        const ask = { cancel: 'לבטל את בקשת התשלום? הקישור יפסיק לעבוד.', delete: r.status === 'paid'
          ? `למחוק את הבקשה ששולמה (${r.amount_text})?\nהיא תימחק מהרשימה ומהסיכום כאן, אבל התשלום עצמו נשאר ב-PayPal (המחיקה לא מחזירה את הכסף).`
          : 'למחוק את הבקשה לצמיתות?', send: `לשלוח את הקישור ל-${r.email}?` }[action];
        if (ask && !confirm(ask)) return;
        const res = await act(b, () => api(`/api/admin/pay/${r.id}/${action}`, {}), { send: 'נשלח במייל ✓', cancel: 'הבקשה בוטלה', reopen: 'הבקשה נפתחה מחדש', delete: 'נמחקה' }[action]);
        if (!res) return;
        if (currentTab === 'pay') renderPay($('#view'));
        if (action === 'delete') closeDrawer(true);
        else openPay(res.request);
      };
    });
  }

  function newPayDrawer(preset = {}) {
    const f = { amount: '', currency: 'ILS', description: '', mode: 'user', user: null, email: '', expires: '', send: true, ...preset };
    const d = openDrawer(`
      <div class="drawer-head"><div class="txt"><b>בקשת תשלום חדשה</b></div><button class="icon-btn" data-close aria-label="סגירה">${icon('x')}</button></div>
      <form class="drawer-body" id="np-form" novalidate>
        <label for="np-amount" style="margin-top:0">סכום</label>
        <div class="row" style="flex-wrap:nowrap">
          <input id="np-amount" inputmode="decimal" placeholder="0.00" autocomplete="off" style="font-size:24px;font-weight:800;direction:ltr;text-align:right;flex:1" value="${esc(f.amount)}">
          <div class="seg" id="np-cur" style="flex-shrink:0">${Object.entries(CURRENCY).map(([c, sym]) => `<button type="button" data-v="${c}" aria-pressed="${f.currency === c}" style="min-width:44px;font-size:17px">${sym}</button>`).join('')}</div>
        </div>

        <label for="np-desc">עבור מה?</label>
        <input id="np-desc" maxlength="200" placeholder="למשל: בניית אתר — מקדמה" value="${esc(f.description)}">

        <label>מי משלם</label>
        <div class="seg" id="np-mode">
          <button type="button" data-v="user" aria-pressed="${f.mode === 'user'}">משתמש רשום</button>
          <button type="button" data-v="email" aria-pressed="${f.mode === 'email'}">לא רשום (מייל)</button>
        </div>
        <div id="np-target" style="margin-top:10px"></div>

        <label for="np-exp">תוקף</label>
        <input type="date" id="np-exp" value="${esc(f.expires)}">
        <div class="mini-chips">
          <button type="button" data-days="3">3 ימים</button><button type="button" data-days="7">שבוע</button>
          <button type="button" data-days="30">חודש</button><button type="button" data-days="0">ללא הגבלה</button>
        </div>

        <label class="switch-row" style="margin-top:14px">
          <span class="txt">שליחת הקישור במייל עכשיו<small>המשלם יקבל מייל עם הסכום וכפתור לתשלום</small></span>
          <span class="switch"><input type="checkbox" id="np-send" ${f.send ? 'checked' : ''}><span></span></span>
        </label>

        <button class="btn btn-primary btn-block btn-lg" type="submit">${icon('link', 'sm')} יצירת קישור לתשלום</button>
      </form>`);

    const toDate = days => { const x = new Date(); x.setDate(x.getDate() + days); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };
    $$('#np-cur button').forEach(b => { b.onclick = () => { f.currency = b.dataset.v; $$('#np-cur button').forEach(x => x.setAttribute('aria-pressed', String(x === b))); }; });
    $$('[data-days]', d).forEach(b => { b.onclick = () => { $('#np-exp').value = Number(b.dataset.days) ? toDate(Number(b.dataset.days)) : ''; }; });
    $$('#np-mode button').forEach(b => { b.onclick = () => { f.mode = b.dataset.v; $$('#np-mode button').forEach(x => x.setAttribute('aria-pressed', String(x === b))); drawTarget(); }; });

    function drawTarget() {
      const box = $('#np-target');
      if (f.mode === 'email') {
        box.innerHTML = `<input id="np-email" type="email" dir="ltr" placeholder="name@example.com" value="${esc(f.email)}" autocomplete="off">
          <div class="hint">כדי לשלם הוא יצטרך להתחבר לחשבון reem.bi עם המייל הזה (או לפתוח חשבון חדש איתו).</div>`;
        $('#np-email').oninput = e => { f.email = e.target.value; };
        return;
      }
      if (f.user) {
        box.innerHTML = `<div class="selected-chips" style="margin:0"><span>${esc(f.user.name || f.user.email)} · <span class="ltr">${esc(f.user.email)}</span><button type="button" aria-label="הסרה">×</button></span></div>
          <div class="hint">כדי לשלם הוא יתבקש להתחבר לחשבון reem.bi שלו.</div>`;
        $('button', box).onclick = () => { f.user = null; drawTarget(); };
        return;
      }
      box.innerHTML = `<div class="picker"><label class="search">${icon('search')}<input id="np-find" type="search" placeholder="חיפוש משתמש לפי שם או מייל…" autocomplete="off"></label>
        <div class="picker-results" id="np-results" hidden></div></div>`;
      const results = $('#np-results');
      $('#np-find').oninput = debounce(async e => {
        const q = e.target.value.trim();
        if (!q) { results.hidden = true; return; }
        const { users } = await api('/api/admin/users?' + new URLSearchParams({ q }));
        const list = users.slice(0, 8);
        results.hidden = false;
        results.innerHTML = list.map(u => `<button type="button" data-id="${esc(u.id)}">${avatar(u)}<span style="min-width:0"><b>${esc(u.name || u.email)}</b><div class="hint ltr" style="margin:0">${esc(u.email)}</div></span></button>`).join('') || '<div class="empty" style="padding:14px">לא נמצאו משתמשים — אפשר לבחור "לא רשום (מייל)"</div>';
        $$('button', results).forEach(b => { b.onclick = () => { const u = list.find(x => x.id === b.dataset.id); f.user = { id: u.id, email: u.email, name: u.name }; drawTarget(); }; });
      }, 200);
      $('#np-find').onblur = () => setTimeout(() => { results.hidden = true; }, 200);
    }
    drawTarget();
    setTimeout(() => { const el = $('#np-amount'); if (el) el.focus(); }, 250);

    $('#np-form').onsubmit = async e => {
      e.preventDefault();
      f.amount = $('#np-amount').value;
      f.description = $('#np-desc').value;
      if (!(Number(String(f.amount).replace(/,/g, '')) > 0)) return toast('⚠️ הזינו סכום');
      if (!f.description.trim()) return toast('⚠️ כתבו עבור מה התשלום');
      if (f.mode === 'user' && !f.user) return toast('⚠️ בחרו משתמש');
      if (f.mode === 'email' && !f.email.trim()) return toast('⚠️ הזינו מייל');
      const exp = $('#np-exp').value ? Math.floor(new Date($('#np-exp').value + 'T23:59:59').getTime() / 1000) : null;
      const r = await act(e.submitter, () => api('/api/admin/pay', {
        amount: f.amount, currency: f.currency, description: f.description,
        user_id: f.mode === 'user' ? f.user.id : null, email: f.mode === 'email' ? f.email : null,
        expires_at: exp, send_email: $('#np-send').checked,
      }));
      if (!r) return;
      if (currentTab === 'pay') renderPay($('#view'));
      showCreated(r.request, r.emailed);
    };
  }

  function showCreated(r, emailed) {
    openDrawer(`
      <div class="drawer-head"><div class="txt"><b>הקישור מוכן ✓</b></div><button class="icon-btn" data-close aria-label="סגירה">${icon('x')}</button></div>
      <div class="drawer-body">
        <div class="center" style="padding:6px 0 16px">
          <div class="big-icon" style="margin:0 auto 10px">✓</div>
          <div style="font-size:30px;font-weight:800" class="ltr">${esc(r.amount_text)}</div>
          <div style="font-weight:700">${esc(r.description)}</div>
          <div class="hint">${esc(r.user_name || '')} <span class="ltr">${esc(r.email)}</span></div>
          ${emailed ? '<div class="alert ok" style="margin-top:12px">הקישור נשלח גם במייל ✓</div>' : ''}
        </div>
        ${payLinkBox(r)}
        <div class="row" style="margin-top:14px">
          <button class="btn btn-outline" id="pd-another">${icon('plus', 'sm')} בקשה נוספת</button>
          <button class="btn btn-ghost" data-close>סגירה</button>
        </div>
      </div>`);
    bindLinkBox(r);
    $('#pd-another').onclick = () => newPayDrawer();
  }

  // ================================================================ wall

  async function renderWall(view) {
    const { messages } = await api('/api/admin/wall');
    view.innerHTML = `
      <div class="page-head"><div><h1>קיר הודעות</h1><div class="sub">מה שחברים כתבו בטרמינל באתר הראשי</div></div></div>
      <section class="panel">
        ${messages.length ? `<ul class="row-list">${messages.map(m => `
          <li>
            <div class="grow">
              <div style="white-space:normal">${esc(m.message)}</div>
              <div class="s">${esc(m.name)} · <span class="ltr">${esc(m.email)}</span> · ${esc(siteName(m.site_id))} · ${ago(m.created_at)}</div>
            </div>
            <button class="icon-btn" data-del="${m.id}" aria-label="מחיקה">${icon('trash', 'sm')}</button>
          </li>`).join('')}</ul>` : '<div class="empty">אין הודעות</div>'}
      </section>`;
    $$('[data-del]', view).forEach(b => {
      b.onclick = async () => {
        if (!confirm('למחוק את ההודעה?')) return;
        const r = await act(b, () => api('/api/admin/wall/' + b.dataset.del, null, 'DELETE'), 'נמחקה');
        if (r) renderWall(view);
      };
    });
  }

  // ================================================================ boot

  (async function boot() {
    fillIcons();
    try {
      state.me = (await api('/api/me')).user;
    } catch {
      location.href = signInUrl();
      return;
    }
    if (!state.me.is_admin) {
      $('#view').innerHTML = '<div class="panel center" style="max-width:420px;margin:40px auto"><h2 style="justify-content:center">אין הרשאת מנהל</h2><p class="hint">החשבון הזה לא מוגדר כמנהל.</p><a class="btn btn-outline" href="/">לחשבון שלי</a></div>';
      return;
    }
    $('#side-me').innerHTML = `${avatar(state.me)}<div class="who"><b>${esc(state.me.name)}</b><span>${esc(state.me.email)}</span></div>`;
    const [sites, stats] = await Promise.all([api('/api/admin/sites'), api('/api/admin/stats')]);
    state.sites = sites.sites;
    state.stats = stats;
    route();
  })();
})();
