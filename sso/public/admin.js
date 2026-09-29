// login.reembir.com/admin — users, per-site access, plans and sites.
(function () {
  'use strict';

  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtDate = t => (t ? new Date(t * 1000).toLocaleDateString('he-IL') : '—');
  const fmtTime = t => (t ? new Date(t * 1000).toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' }) : '—');
  const STATUS = { active: ['פעיל', 'green'], pending: ['ממתין', 'warn'], blocked: ['חסום', 'red'] };
  const MODES = { open: 'פתוח — כל מי שנרשם מקבל גישה', approval: 'באישור — בקשה ממתינה לאישור שלך', invite: 'בהזמנה בלבד — רק מי שהוספת' };

  let sites = [];
  let userOffset = 0;

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
    const t = $('toast');
    t.textContent = text;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
  }

  async function run(fn, okText) {
    try {
      const r = await fn();
      if (okText) toast(okText);
      return r;
    } catch (err) {
      toast('⚠️ ' + err.message);
      throw err;
    }
  }

  function avatar(u, cls = 'sm') {
    return u.avatar
      ? `<span class="avatar ${cls}"><img src="${esc(u.avatar)}" alt="" referrerpolicy="no-referrer"></span>`
      : `<span class="avatar ${cls}">${esc((u.name || u.email || '?').charAt(0))}</span>`;
  }

  const siteName = id => (sites.find(s => s.id === id) || { name: id }).name;
  const planName = id => {
    for (const s of sites) for (const p of s.plans) if (p.id === id) return p.name;
    return id;
  };

  // ------------------------------------------------------------------ tabs

  const TABS = { overview: loadOverview, users: () => loadUsers(true), sites: renderSites, wall: loadWall };
  function openTab(name) {
    document.querySelectorAll('#nav button').forEach(b => b.toggleAttribute('aria-current', b.dataset.tab === name));
    document.querySelectorAll('#nav button[aria-current]').forEach(b => b.setAttribute('aria-current', 'page'));
    for (const t of Object.keys(TABS)) $('tab-' + t).hidden = t !== name;
    history.replaceState(null, '', '#' + name);
    TABS[name]();
  }
  document.querySelectorAll('#nav button').forEach(b => { b.onclick = () => openTab(b.dataset.tab); });

  // ------------------------------------------------------------------ overview

  async function loadOverview() {
    const s = await api('/api/admin/stats');
    $('stats').innerHTML = [
      [s.users, 'משתמשים'],
      [s.new_users, 'חדשים השבוע'],
      [s.active_users, 'התחברו השבוע'],
      [sites.length, 'אתרים מחוברים'],
    ].map(([n, l]) => `<div class="stat"><div class="n">${n}</div><div class="l">${l}</div></div>`).join('');

    $('pending').innerHTML = s.pending.length
      ? `<ul class="list">${s.pending.map(p => `
          <li><span><b>${esc(p.name || p.email)}</b> <span class="meta mono">${esc(p.email)}</span> → ${esc(p.site_name)}</span>
          <span class="row"><button class="btn btn-primary btn-sm" data-approve="${esc(p.user_id)}|${esc(p.site_id)}">אישור</button>
          <button class="btn btn-danger btn-sm" data-deny="${esc(p.user_id)}|${esc(p.site_id)}">דחייה</button></span></li>`).join('')}</ul>`
      : '<div class="empty">אין בקשות ממתינות 🎉</div>';

    $('pending').querySelectorAll('[data-approve],[data-deny]').forEach(btn => {
      btn.onclick = async () => {
        const [uid, sid] = (btn.dataset.approve || btn.dataset.deny).split('|');
        const status = btn.dataset.approve ? 'active' : 'blocked';
        await run(() => api(`/api/admin/users/${uid}/access/${sid}`, { status, plan_id: null, features_override: {} }, 'PUT'), status === 'active' ? 'אושר ✓' : 'נדחה');
        loadOverview();
      };
    });
  }

  // ------------------------------------------------------------------ users

  let searchTimer;
  $('user-search').oninput = () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => loadUsers(true), 250); };
  $('user-site').onchange = () => loadUsers(true);
  $('more-users').onclick = () => loadUsers(false);

  async function loadUsers(reset) {
    if (reset) userOffset = 0;
    const q = new URLSearchParams({ q: $('user-search').value, site: $('user-site').value, offset: userOffset });
    const { users } = await api('/api/admin/users?' + q);
    const rows = users.map(u => {
      const methods = [u.google && 'Google', u.has_password && 'סיסמה'].filter(Boolean).join(' · ') || 'קישור למייל';
      const flags = [
        u.is_admin ? '<span class="badge green">מנהל</span>' : '',
        u.disabled ? '<span class="badge red">מושבת</span>' : '',
        !u.email_verified ? '<span class="badge warn">לא מאומת</span>' : '',
      ].join('');
      const access = u.access.map(a => {
        const [, cls] = STATUS[a.status] || ['', ''];
        return `<span class="badge ${cls}">${esc(siteName(a.site_id))}${a.plan_id ? ' · ' + esc(planName(a.plan_id)) : ''}</span>`;
      }).join('');
      return `<tr data-id="${esc(u.id)}">
        <td><div class="user-cell">${avatar(u)}<div><b>${esc(u.name)}</b> ${flags}<div class="em">${esc(u.email)}</div></div></div></td>
        <td class="meta">${methods}</td>
        <td><div class="tags">${access || '<span class="meta">—</span>'}</div></td>
        <td class="meta">${fmtDate(u.created_at)}</td>
        <td class="meta">${fmtTime(u.last_login_at)}</td></tr>`;
    }).join('');
    if (reset) $('users-body').innerHTML = rows || '<tr><td colspan="5" class="empty">אין משתמשים</td></tr>';
    else $('users-body').insertAdjacentHTML('beforeend', rows);
    userOffset += users.length;
    $('more-users').hidden = users.length < 50;
    $('users-body').querySelectorAll('tr[data-id]').forEach(tr => { tr.onclick = () => openUser(tr.dataset.id); });
  }

  // ------------------------------------------------------------------ user dialog

  const dlg = $('user-dialog');
  $('dlg-close').onclick = () => dlg.close();
  dlg.addEventListener('close', () => { if (!$('tab-users').hidden) loadUsers(true); });

  function planOptions(site, selected) {
    const def = site.plans.find(p => p.id === site.default_plan);
    return `<option value="">ברירת מחדל${def ? ` (${esc(def.name)})` : ''}</option>` +
      site.plans.map(p => `<option value="${esc(p.id)}" ${p.id === selected ? 'selected' : ''}>${esc(p.name)}</option>`).join('');
  }

  function toDateInput(t) {
    if (!t) return '';
    const d = new Date(t * 1000);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  async function openUser(id) {
    const data = await api('/api/admin/users/' + id);
    renderUser(data);
    if (!dlg.open) dlg.showModal();
  }

  function renderUser({ user, access, sessions }) {
    $('dlg-avatar').innerHTML = avatar(user, '');
    $('dlg-name').textContent = user.name;
    $('dlg-email').textContent = user.email;

    const siteSessions = sessions.map(s => `${s.client_id ? esc(siteName(s.client_id)) : 'login.reembir.com'} (${s.n})`).join(', ') || 'אין';
    const missing = sites.filter(s => !access.some(a => a.site_id === s.id));

    $('dlg-body').innerHTML = `
      <form id="u-form">
        <div class="grid2">
          <div><label>שם</label><input name="name" value="${esc(user.name)}"></div>
          <div><label>תפקיד</label><select name="role">
            <option value="user" ${user.role !== 'admin' ? 'selected' : ''}>משתמש</option>
            <option value="admin" ${user.role === 'admin' ? 'selected' : ''}>מנהל</option></select></div>
        </div>
        <label>הערות פנימיות</label><textarea name="notes" rows="2">${esc(user.notes)}</textarea>
        <label class="row" style="gap:8px;font-weight:500;color:var(--text)"><input type="checkbox" name="disabled" style="width:auto" ${user.disabled ? 'checked' : ''}> חשבון מושבת (לא יכול להתחבר לשום אתר)</label>
        <p class="hint">
          נוצר ${fmtDate(user.created_at)} · כניסה אחרונה ${fmtTime(user.last_login_at)} ·
          ${user.email_verified ? 'מייל מאומת' : 'מייל לא מאומת'} ·
          ${[user.google && 'Google', user.has_password && 'סיסמה'].filter(Boolean).join(' + ') || 'קישור למייל'}<br>
          חיבורים פעילים: ${siteSessions}
        </p>
        <div class="row">
          <button class="btn btn-primary btn-sm" type="submit">שמירה</button>
          <button class="btn btn-outline btn-sm" type="button" id="u-logout">ניתוק מכל המכשירים</button>
          <button class="btn btn-outline btn-sm" type="button" id="u-reset">שליחת איפוס סיסמה</button>
          <span class="spacer" style="flex:1"></span>
          <button class="btn btn-danger btn-sm" type="button" id="u-delete">מחיקת משתמש</button>
        </div>
      </form>

      <div class="section-title">גישה לאתרים ותוכניות</div>
      ${access.length ? '' : '<p class="hint">עוד אין גישה לאף אתר.</p>'}
      ${access.map(a => {
        const site = sites.find(s => s.id === a.site_id) || { id: a.site_id, name: a.site_id, plans: [] };
        const expired = a.plan_expires_at && a.plan_expires_at < Date.now() / 1000;
        return `<form class="access-card" data-site="${esc(a.site_id)}">
          <div class="row between"><b>${esc(site.name)}</b>
            <span class="meta">${a.last_used_at ? 'שימוש אחרון ' + fmtTime(a.last_used_at) : ''} ${expired ? '<span class="badge red">התוכנית פגה</span>' : ''}</span></div>
          <div class="grid4">
            <div><label>סטטוס</label><select name="status">
              ${Object.entries(STATUS).map(([k, [l]]) => `<option value="${k}" ${a.status === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
            <div><label>תוכנית</label><select name="plan_id">${planOptions(site, a.plan_id)}</select></div>
            <div><label>בתוקף עד</label><input type="date" name="expires" value="${toDateInput(a.plan_expires_at)}"></div>
          </div>
          <label>הרשאות מיוחדות (JSON, דורס את התוכנית)</label>
          <textarea class="json" name="features" placeholder='{"limit": 10}'>${Object.keys(a.features_override).length ? esc(JSON.stringify(a.features_override)) : ''}</textarea>
          <div class="row" style="margin-top:10px">
            <button class="btn btn-primary btn-sm" type="submit">שמירת גישה</button>
            <button class="btn btn-ghost btn-sm" type="button" data-remove>הסרת גישה</button>
          </div>
        </form>`;
      }).join('')}

      ${missing.length ? `<form class="row" id="add-access" style="margin-top:14px">
        <select name="site" style="width:auto;flex:1">${missing.map(s => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('')}</select>
        <button class="btn btn-outline btn-sm" type="submit">+ מתן גישה</button></form>` : ''}
    `;

    $('u-form').onsubmit = async e => {
      e.preventDefault();
      const f = e.target;
      renderUser(await run(() => api('/api/admin/users/' + user.id, {
        name: f.name.value, role: f.role.value, notes: f.notes.value, disabled: f.disabled.checked,
      }, 'PATCH'), 'נשמר ✓'));
    };
    $('u-logout').onclick = () => run(() => api(`/api/admin/users/${user.id}/logout`, {}), 'המשתמש נותק מכל המכשירים');
    $('u-reset').onclick = async () => {
      const d = await run(() => api(`/api/admin/users/${user.id}/reset`, {}), 'נשלח מייל איפוס');
      if (d.dev_link) prompt('מצב פיתוח — קישור האיפוס:', d.dev_link);
    };
    $('u-delete').onclick = async () => {
      if (!confirm(`למחוק לצמיתות את ${user.email}? כל הגישות וההודעות שלו יימחקו.`)) return;
      await run(() => api('/api/admin/users/' + user.id, null, 'DELETE'), 'המשתמש נמחק');
      dlg.close();
    };

    $('dlg-body').querySelectorAll('.access-card').forEach(form => {
      const siteId = form.dataset.site;
      form.onsubmit = async e => {
        e.preventDefault();
        let features = {};
        if (form.features.value.trim()) {
          try { features = JSON.parse(form.features.value); } catch { return toast('⚠️ JSON לא תקין'); }
        }
        const expires = form.expires.value ? Math.floor(new Date(form.expires.value + 'T23:59:59').getTime() / 1000) : null;
        renderUser(await run(() => api(`/api/admin/users/${user.id}/access/${siteId}`, {
          status: form.status.value, plan_id: form.plan_id.value || null, plan_expires_at: expires, features_override: features,
        }, 'PUT'), 'הגישה עודכנה ✓'));
      };
      form.querySelector('[data-remove]').onclick = async () => {
        if (!confirm('להסיר את הגישה לאתר הזה? (באתר פתוח המשתמש יקבל גישה רגילה שוב בכניסה הבאה — כדי לחסום, בחרו סטטוס "חסום")')) return;
        renderUser(await run(() => api(`/api/admin/users/${user.id}/access/${siteId}`, null, 'DELETE'), 'הוסר'));
      };
    });

    const add = $('add-access');
    if (add) add.onsubmit = async e => {
      e.preventDefault();
      renderUser(await run(() => api(`/api/admin/users/${user.id}/access/${add.site.value}`, { status: 'active', plan_id: null, features_override: {} }, 'PUT'), 'ניתנה גישה ✓'));
    };
  }

  // new user
  const nud = $('new-user-dialog');
  $('new-user-btn').onclick = () => { $('new-user-form').reset(); nud.showModal(); };
  nud.querySelector('[data-close]').onclick = () => nud.close();
  $('new-user-form').onsubmit = async e => {
    e.preventDefault();
    const d = await run(() => api('/api/admin/users', {
      email: $('nu-email').value, name: $('nu-name').value, send_invite: $('nu-invite').checked,
    }), 'המשתמש נוצר ✓');
    if (d.dev_link) prompt('מצב פיתוח — קישור ההתחברות:', d.dev_link);
    nud.close();
    loadUsers(true);
    openUser(d.user.id);
  };

  // ------------------------------------------------------------------ sites & plans

  async function loadSites() {
    sites = (await api('/api/admin/sites')).sites;
    $('user-site').innerHTML = '<option value="">כל האתרים</option>' + sites.map(s => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('');
  }

  function snippet(site) {
    return `&lt;script src="${esc(location.origin)}/sdk.js"&gt;&lt;/script&gt;
&lt;script&gt;
  const auth = ReemAuth.init({ clientId: '${esc(site.id)}' });
  auth.onChange(user =&gt; { /* user?.email, user?.features */ });
  // auth.login()  ·  auth.logout()
&lt;/script&gt;`;
  }

  function siteForm(site, isNew) {
    return `<form class="panel" data-site="${esc(site.id || '')}">
      <div class="row between"><h3>${isNew ? 'אתר חדש' : esc(site.name)} ${isNew ? '' : `<span class="badge">${site.users} משתמשים</span> ${site.pending ? `<span class="badge warn">${site.pending} ממתינים</span>` : ''}`}</h3>
        ${isNew ? '' : '<button type="button" class="btn btn-ghost btn-sm" data-snippet>קוד הטמעה</button>'}</div>
      <pre class="snippet" hidden>${isNew ? '' : snippet(site)}</pre>
      <div class="grid2">
        <div><label>מזהה (client_id)</label><input name="id" class="mono" value="${esc(site.id || '')}" ${isNew ? 'required pattern="[a-z0-9-]{2,40}" placeholder="my-project"' : 'disabled'}></div>
        <div><label>שם</label><input name="name" value="${esc(site.name || '')}" required></div>
        <div><label>כתובת האתר</label><input name="url" class="mono" value="${esc(site.url || '')}" placeholder="https://reembir.com/my-project/"></div>
        <div><label>תיאור קצר (מוצג במסך ההתחברות)</label><input name="description" value="${esc(site.description || '')}"></div>
      </div>
      <label>כתובות חזרה מותרות (שורה לכל כתובת; כתובת שמסתיימת ב-/ מאשרת את כל מה שמתחתיה)</label>
      <textarea name="redirect_uris" class="json" rows="2">${esc((site.redirect_uris || []).join('\n'))}</textarea>
      <div class="grid2">
        <div><label>מי יכול להיכנס</label><select name="access_mode">${Object.entries(MODES).map(([k, l]) => `<option value="${k}" ${site.access_mode === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
        <div><label>תוכנית ברירת מחדל</label><select name="default_plan"><option value="">ללא</option>${(site.plans || []).map(p => `<option value="${esc(p.id)}" ${site.default_plan === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></div>
      </div>
      <div class="row" style="margin-top:14px">
        <button class="btn btn-primary btn-sm" type="submit">${isNew ? 'יצירת אתר' : 'שמירה'}</button>
        ${isNew ? '<button type="button" class="btn btn-ghost btn-sm" data-cancel>ביטול</button>' : '<span style="flex:1"></span><button type="button" class="btn btn-danger btn-sm" data-delete>מחיקת אתר</button>'}
      </div>

      ${isNew ? '' : `
      <div class="section-title">תוכניות</div>
      <div class="table-wrap"><table class="plans-table">
        <thead><tr><th>מזהה</th><th>שם</th><th>הרשאות (JSON)</th><th>סדר</th><th>משתמשים</th><th></th></tr></thead>
        <tbody>
        ${site.plans.map(p => `<tr data-plan="${esc(p.id)}">
          <td class="mono">${esc(p.id)}</td>
          <td><input name="pname" value="${esc(p.name)}"></td>
          <td><input name="pfeatures" class="mono" value="${esc(JSON.stringify(p.features))}"></td>
          <td style="width:70px"><input name="psort" type="number" value="${p.sort}"></td>
          <td class="meta">${p.users}</td>
          <td class="row" style="flex-wrap:nowrap"><button type="button" class="btn btn-outline btn-sm" data-save-plan>שמירה</button><button type="button" class="btn btn-ghost btn-sm" data-del-plan>🗑</button></td></tr>`).join('')}
        <tr data-plan="">
          <td><input name="pid" class="mono" placeholder="${esc(site.id)}:pro"></td>
          <td><input name="pname" placeholder="Pro"></td>
          <td><input name="pfeatures" class="mono" placeholder='{"limit": 50}'></td>
          <td style="width:70px"><input name="psort" type="number" value="${site.plans.length}"></td>
          <td></td>
          <td><button type="button" class="btn btn-primary btn-sm" data-save-plan>+ הוספה</button></td></tr>
        </tbody></table></div>`}
    </form>`;
  }

  function renderSites() {
    $('sites').innerHTML = sites.map(s => siteForm(s, false)).join('') || '<div class="empty">אין אתרים</div>';
    bindSiteForms();
  }

  $('new-site-btn').onclick = () => {
    if ($('sites').querySelector('form[data-site=""]')) return;
    $('sites').insertAdjacentHTML('afterbegin', siteForm({ access_mode: 'open', redirect_uris: [], plans: [] }, true));
    bindSiteForms();
    $('sites').querySelector('form[data-site=""] input[name=id]').focus();
  };

  function bindSiteForms() {
    $('sites').querySelectorAll('form[data-site]').forEach(form => {
      const isNew = !form.dataset.site;
      form.onsubmit = async e => {
        e.preventDefault();
        const id = isNew ? form.id.value.trim() : form.dataset.site;
        const d = await run(() => api('/api/admin/sites/' + encodeURIComponent(id), {
          name: form.name.value,
          url: form.url.value,
          description: form.description.value,
          redirect_uris: form.redirect_uris.value.split('\n').map(s => s.trim()).filter(Boolean),
          access_mode: form.access_mode.value,
          default_plan: form.default_plan.value || null,
        }, 'PUT'), 'האתר נשמר ✓');
        sites = d.sites;
        renderSites();
      };
      const cancel = form.querySelector('[data-cancel]');
      if (cancel) cancel.onclick = () => form.remove();
      const snip = form.querySelector('[data-snippet]');
      if (snip) snip.onclick = () => { const pre = form.querySelector('.snippet'); pre.hidden = !pre.hidden; };
      const del = form.querySelector('[data-delete]');
      if (del) del.onclick = async () => {
        if (prompt(`מחיקת האתר תמחק את כל הגישות והתוכניות שלו. הקלידו "${form.dataset.site}" לאישור:`) !== form.dataset.site) return;
        sites = (await run(() => api('/api/admin/sites/' + form.dataset.site, null, 'DELETE'), 'האתר נמחק')).sites;
        renderSites();
      };

      form.querySelectorAll('tr[data-plan]').forEach(tr => {
        tr.querySelector('[data-save-plan]').onclick = async () => {
          const id = tr.dataset.plan || tr.querySelector('[name=pid]').value.trim();
          let features = {};
          const raw = tr.querySelector('[name=pfeatures]').value.trim();
          if (raw) { try { features = JSON.parse(raw); } catch { return toast('⚠️ JSON לא תקין'); } }
          if (!id) return toast('⚠️ חסר מזהה תוכנית');
          sites = (await run(() => api('/api/admin/plans/' + encodeURIComponent(id), {
            site_id: form.dataset.site,
            name: tr.querySelector('[name=pname]').value || id,
            features,
            sort: tr.querySelector('[name=psort]').value,
          }, 'PUT'), 'התוכנית נשמרה ✓')).sites;
          renderSites();
        };
        const delPlan = tr.querySelector('[data-del-plan]');
        if (delPlan) delPlan.onclick = async () => {
          if (!confirm('למחוק את התוכנית? משתמשים עליה יחזרו לתוכנית ברירת המחדל.')) return;
          sites = (await run(() => api('/api/admin/plans/' + encodeURIComponent(tr.dataset.plan), null, 'DELETE'), 'נמחק')).sites;
          renderSites();
        };
      });
    });
  }

  // ------------------------------------------------------------------ wall

  async function loadWall() {
    const { messages } = await api('/api/admin/wall');
    renderWall(messages);
  }
  function renderWall(messages) {
    $('wall-body').innerHTML = messages.map(m => `<tr style="cursor:default">
      <td><b>${esc(m.name)}</b><div class="meta mono">${esc(m.email)}</div></td>
      <td>${esc(m.message)}</td><td class="meta">${esc(siteName(m.site_id))}</td><td class="meta">${fmtTime(m.created_at)}</td>
      <td><button class="btn btn-ghost btn-sm" data-del="${m.id}">🗑</button></td></tr>`).join('') || '<tr><td colspan="5" class="empty">אין הודעות</td></tr>';
    $('wall-body').querySelectorAll('[data-del]').forEach(b => {
      b.onclick = async () => renderWall((await run(() => api('/api/admin/wall/' + b.dataset.del, null, 'DELETE'), 'נמחק')).messages);
    });
  }

  // ------------------------------------------------------------------ boot

  (async function boot() {
    let me;
    try {
      me = (await api('/api/me')).user;
    } catch {
      location.href = '/';
      return;
    }
    if (!me.is_admin) {
      $('gate').innerHTML = '<div class="panel center" style="max-width:420px;margin:40px auto"><h3>אין הרשאת מנהל</h3><p class="hint">החשבון הזה לא מוגדר כמנהל.</p><a class="btn btn-outline" href="/">לחשבון שלי</a></div>';
      return;
    }
    $('gate').hidden = true;
    await loadSites();
    const tab = location.hash.slice(1);
    openTab(TABS[tab] ? tab : 'overview');
  })();
})();
