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

  async function api(path, body, method) {
    const res = await fetch(path, {
      method: method || (body ? 'POST' : 'GET'),
      headers: body ? { 'content-type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (res.status === 401) location.href = '/';
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
  ];
  let currentTab = null;

  function renderNav() {
    const pending = state.stats ? state.stats.pending.length : 0;
    const badge = t => (t.id === 'overview' && pending ? `<span class="count">${pending}</span>` : '');
    $('#side-nav').innerHTML = TABS.map(t => `<button class="nav-item" data-tab="${t.id}" ${t.id === currentTab ? 'aria-current="page"' : ''}>${icon(t.icon)}${t.label}${badge(t)}</button>`).join('');
    $('#bottom-nav').innerHTML = TABS.map(t => `<button data-tab="${t.id}" ${t.id === currentTab ? 'aria-current="page"' : ''}>${icon(t.icon)}<span>${t.label}</span>${badge(t)}</button>`).join('');
    $$('[data-tab]').forEach(b => { b.onclick = () => go(b.dataset.tab); });
  }

  function go(tab, extra) {
    const target = extra ? `${tab}/${extra}` : tab;
    if (location.hash === '#' + target) route(true);
    else location.hash = target;
  }

  async function route(force) {
    const [tab, arg] = location.hash.slice(1).split('/');
    const t = TABS.find(x => x.id === tab) || TABS[0];
    if (t.id !== currentTab || (force === true && !arg)) {
      currentTab = t.id;
      renderNav();
      $('#mobile-title').textContent = t.label;
      document.title = `${t.label} · ניהול reem.bi`;
      $('#view').innerHTML = '<div class="loading"><span class="spinner"></span></div>';
      window.scrollTo(0, 0);
      try {
        await t.render($('#view'));
      } catch (err) {
        $('#view').innerHTML = `<div class="empty">⚠️ ${esc(err.message)}</div>`;
      }
    }
    if (t.id === 'users' && arg) openUser(decodeURIComponent(arg));
    else closeDrawer(true);
  }
  window.addEventListener('hashchange', () => route());

  // ================================================================ overview

  async function renderOverview(view) {
    const s = state.stats = await api('/api/admin/stats');
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
      <div class="stats">
        <button class="stat" data-go="users"><div class="n">${s.users}</div><div class="l">משתמשים</div></button>
        <div class="stat"><div class="n">${s.new_users}</div><div class="l">הצטרפו השבוע</div></div>
        <div class="stat"><div class="n">${s.active_users}</div><div class="l">נכנסו השבוע</div></div>
        <button class="stat ${s.pending.length ? 'alert-stat' : ''}" data-filter="pending"><div class="n">${s.pending.length}</div><div class="l">ממתינים לאישור</div></button>
        <button class="stat" data-go="email"><div class="n">${s.emails_today}</div><div class="l">מיילים ב-24 שעות (מתוך 100)</div></button>
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
        <h2>אתרים <button class="link-btn" data-go="sites">ניהול אתרים</button></h2>
        <ul class="row-list">${state.sites.map(site => `
          <li>
            <div class="grow"><div class="t">${esc(site.name)}</div><div class="s">${esc(MODES[site.access_mode].split(' — ')[0])} · ${site.users} משתמשים</div></div>
            <div class="u-tags">${site.plans.map(p => `<span class="badge">${esc(p.name)} · ${p.users}</span>`).join('')}</div>
          </li>`).join('')}</ul>
      </section>`;

    $('#ov-new-user').onclick = newUserDrawer;
    $('#ov-mail').onclick = () => go('email');
    $$('[data-go]', view).forEach(b => { b.onclick = () => go(b.dataset.go); });
    $$('[data-filter]', view).forEach(b => { b.onclick = () => { state.users.filter = b.dataset.filter; go('users'); }; });
    $$('[data-user]', view).forEach(li => { li.onclick = () => go('users', li.dataset.user); });
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
    if (!silent && location.hash.split('/').length > 1) history.back();
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

  function renderUser({ user, access, sessions }) {
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

        <div class="sec-title">גישה לאתרים ותוכניות</div>
        ${access.map(a => accessCard(a, user)).join('') || '<div class="card-s hint" style="margin:0">עוד אין גישה לאף אתר.</div>'}
        ${missing.length ? `<form class="row" id="add-access" style="margin-top:10px">
          <select name="site" style="flex:1;width:auto">${missing.map(s => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('')}</select>
          <button class="btn btn-outline" type="submit">${icon('plus', 'sm')} מתן גישה</button></form>` : ''}

        <div class="sec-title">פרטים</div>
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
      </div>`;
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
    const domain = log.domain;

    view.innerHTML = `
      <div class="page-head">
        <div><h1>מיילים</h1><div class="sub">שליחה מכל כתובת @${esc(domain)} — למשתמשים, לקבוצות או לכל כתובת</div></div>
      </div>
      ${log.configured ? '' : `<div class="alert warn" style="margin:0 0 16px">שליחת מיילים עוד לא מוגדרת (חסר <b>RESEND_API_KEY</b>) — המיילים לא יישלחו באמת.</div>`}

      <div class="compose">
        <form class="panel" id="mail-form" style="margin:0" novalidate>
          <label style="margin-top:0">מאת</label>
          <div class="form-grid" style="gap:0 10px">
            <div class="from-row"><input id="m-local" value="${esc(c.from_local)}" aria-label="קידומת הכתובת" autocomplete="off" spellcheck="false"><span class="domain">@${esc(domain)}</span></div>
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
      if (!confirm(`לשלוח את "${c.subject}"\nמ-${c.from_local}@${domain}\nל-${count} נמענים?`)) return;
      const r = await act($('#m-send'), () => api('/api/admin/email/send', { ...c, to: composeTo(c) }));
      if (!r) return;
      store('mail:from', c.from_local);
      store('mail:name', c.from_name);
      toast(r.status === 'partial' ? `⚠️ נשלחו ${r.sent} מתוך ${r.total}: ${r.error}` : `✓ נשלח ל-${r.sent} ${r.sent === 1 ? 'נמען' : 'נמענים'}${r.dev ? ' (מצב פיתוח)' : ''}`);
      state.compose = { ...blankCompose(), from_local: c.from_local, from_name: c.from_name };
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
          <div><label>כתובת האתר</label><input name="url" dir="ltr" value="${esc(site.url || '')}" placeholder="https://reembir.com/my-project/"></div>
          <div><label>תיאור (מוצג במסך ההתחברות)</label><input name="description" value="${esc(site.description || '')}"></div>
        </div>
        <label>כתובות חזרה מותרות — שורה לכל כתובת</label>
        <textarea name="redirect_uris" class="json" rows="2">${esc((site.redirect_uris || []).join('\n'))}</textarea>
        <div class="hint">כתובת שמסתיימת ב-/ מאשרת את כל הדפים שמתחתיה.</div>
        <div class="form-grid">
          <div><label>מי יכול להיכנס</label><select name="access_mode">${Object.entries(MODES).map(([k, l]) => `<option value="${k}" ${site.access_mode === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
          <div><label>תוכנית ברירת מחדל</label><select name="default_plan"><option value="">ללא</option>${(site.plans || []).map(p => `<option value="${esc(p.id)}" ${site.default_plan === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></div>
        </div>
        <div class="row" style="margin-top:14px">
          <button class="btn btn-primary btn-sm" type="submit">${isNew ? 'יצירת אתר' : 'שמירה'}</button>
          ${isNew ? '<button type="button" class="btn btn-ghost btn-sm" data-cancel>ביטול</button>' : '<button type="button" class="btn btn-ghost btn-sm" data-snippet>קוד הטמעה</button><span style="flex:1"></span><button type="button" class="btn btn-danger btn-sm" data-delete>מחיקת אתר</button>'}
        </div>
        ${isNew ? '' : `<pre class="snippet" hidden>${snippet(site)}</pre>`}
      </form>
      ${isNew ? '' : `
        <div class="sec-title">תוכניות</div>
        ${site.plans.map(p => planRow(site, p)).join('')}
        ${planRow(site, null)}
        <div class="hint">ההרשאות הן JSON שהאתר קורא, למשל <span class="ltr mono">{"tag_limit": 50}</span> (‎-1 = ללא הגבלה).</div>`}`;
  }

  function planRow(site, p) {
    return `<div class="plan-row" data-site="${esc(site.id)}" data-plan="${esc(p ? p.id : '')}">
      ${p ? `<span class="mono ltr" title="${esc(p.id)}">${esc(p.id)} <span class="hint">(${p.users})</span></span>` : `<input name="pid" class="mono" dir="ltr" placeholder="${esc(site.id)}:pro">`}
      <input name="pname" value="${esc(p ? p.name : '')}" placeholder="שם התוכנית">
      <input name="pfeatures" class="mono p-feat" dir="ltr" value="${esc(p ? JSON.stringify(p.features) : '')}" placeholder='{"limit": 50}'>
      <input name="psort" type="number" value="${p ? p.sort : site.plans.length}" aria-label="סדר">
      <span class="row" style="flex-wrap:nowrap;gap:4px">
        <button type="button" class="btn ${p ? 'btn-outline' : 'btn-primary'} btn-sm" data-save-plan>${p ? 'שמירה' : '+ הוספה'}</button>
        ${p ? `<button type="button" class="icon-btn" data-del-plan aria-label="מחיקה" style="width:34px;height:34px">${icon('trash', 'sm')}</button>` : ''}
      </span>
    </div>`;
  }

  async function renderSites(view, openId) {
    state.sites = (await api('/api/admin/sites')).sites;
    view.innerHTML = `
      <div class="page-head">
        <div><h1>אתרים ותוכניות</h1><div class="sub">כל פרויקט שמתחבר דרך login.reembir.com</div></div>
        <div class="actions"><button class="btn btn-primary" id="s-new">${icon('plus', 'sm')} אתר חדש</button></div>
      </div>
      <div id="s-new-box"></div>
      ${state.sites.map(s => `
        <details class="site" data-id="${esc(s.id)}" ${s.id === openId ? 'open' : ''}>
          <summary>
            <b>${esc(s.name)}</b>
            <span class="badge">${s.users} משתמשים</span>
            ${s.pending ? `<span class="badge warn">${s.pending} ממתינים</span>` : ''}
            <span class="badge">${esc(MODES[s.access_mode].split(' — ')[0])}</span>
            ${icon('down')}
          </summary>
          <div class="site-body">${siteForm(s, false)}</div>
        </details>`).join('') || '<div class="empty">אין אתרים</div>'}`;

    $('#s-new').onclick = () => {
      const box = $('#s-new-box');
      if (box.innerHTML) return;
      box.innerHTML = `<div class="panel"><h2>אתר חדש</h2>${siteForm({ access_mode: 'open', redirect_uris: [], plans: [] }, true)}</div>`;
      bindSites(view);
      $('input[name=id]', box).focus();
    };
    bindSites(view);
  }

  function bindSites(view) {
    $$('.site-form', view).forEach(form => {
      const isNew = !form.dataset.site;
      form.onsubmit = async e => {
        e.preventDefault();
        const id = isNew ? form.id.value.trim() : form.dataset.site;
        const r = await act(e.submitter, () => api('/api/admin/sites/' + encodeURIComponent(id), {
          name: form.name.value,
          url: form.url.value,
          description: form.description.value,
          redirect_uris: form.redirect_uris.value.split('\n').map(s => s.trim()).filter(Boolean),
          access_mode: form.access_mode.value,
          default_plan: form.default_plan.value || null,
        }, 'PUT'), 'האתר נשמר ✓');
        if (r) renderSites(view, id);
      };
      const cancel = $('[data-cancel]', form);
      if (cancel) cancel.onclick = () => { $('#s-new-box').innerHTML = ''; };
      const snip = $('[data-snippet]', form);
      if (snip) snip.onclick = () => { const pre = $('.snippet', form); pre.hidden = !pre.hidden; };
      const del = $('[data-delete]', form);
      if (del) del.onclick = async e => {
        if (prompt(`מחיקת האתר תמחק את כל הגישות והתוכניות שלו.\nהקלידו "${form.dataset.site}" לאישור:`) !== form.dataset.site) return;
        const r = await act(e.currentTarget, () => api('/api/admin/sites/' + form.dataset.site, null, 'DELETE'), 'האתר נמחק');
        if (r) renderSites(view);
      };
    });

    $$('.plan-row', view).forEach(row => {
      const siteId = row.dataset.site;
      $('[data-save-plan]', row).onclick = async e => {
        const id = row.dataset.plan || $('[name=pid]', row).value.trim();
        if (!id) return toast('⚠️ חסר מזהה לתוכנית');
        let features = {};
        const raw = $('[name=pfeatures]', row).value.trim();
        if (raw) { try { features = JSON.parse(raw); } catch { return toast('⚠️ ההרשאות לא בפורמט JSON תקין'); } }
        const r = await act(e.currentTarget, () => api('/api/admin/plans/' + encodeURIComponent(id), {
          site_id: siteId, name: $('[name=pname]', row).value || id, features, sort: $('[name=psort]', row).value,
        }, 'PUT'), 'התוכנית נשמרה ✓');
        if (r) renderSites(view, siteId);
      };
      const delPlan = $('[data-del-plan]', row);
      if (delPlan) delPlan.onclick = async e => {
        if (!confirm('למחוק את התוכנית? מי שעליה יחזור לתוכנית ברירת המחדל.')) return;
        const r = await act(e.currentTarget, () => api('/api/admin/plans/' + encodeURIComponent(row.dataset.plan), null, 'DELETE'), 'נמחקה');
        if (r) renderSites(view, siteId);
      };
    });
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
          <span class="badge">${r.user_id ? 'משתמש רשום' : 'אימות בקוד למייל'}</span></div>
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
          <div class="hint">כשהוא יפתח את הקישור, יישלח למייל הזה קוד בן 6 ספרות, ורק אחרי האימות הוא יוכל לשלם.</div>`;
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
      location.href = '/';
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
