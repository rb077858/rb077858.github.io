// login.reembir.com — sign-in, "continue to site", email links and the account page.
(function () {
  'use strict';

  const $ = id => document.getElementById(id);
  const params = new URLSearchParams(location.search);
  const VIEWS = ['loading', 'auth', 'sent', 'continue', 'status', 'reset', 'account'];

  // An authorization request from one of the sites (see sdk.js).
  const AUTHZ_KEYS = ['client_id', 'redirect_uri', 'state', 'code_challenge', 'code_challenge_method', 'prompt'];
  const authz = params.get('client_id') ? Object.fromEntries(AUTHZ_KEYS.map(k => [k, params.get(k) || ''])) : null;
  const authzQuery = authz ? '?' + new URLSearchParams(Object.entries(authz).filter(([, v]) => v)).toString() : '';

  let siteInfo = null;
  let pane = null;
  let config = { google_client_id: '' };

  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function show(name) {
    for (const v of VIEWS) $('view-' + v).hidden = v !== name;
  }

  function msg(el, text, type) {
    el.hidden = !text;
    el.className = 'alert ' + (type || 'err');
    el.textContent = text || '';
  }

  async function api(path, body, method) {
    const res = await fetch(path, {
      method: method || (body ? 'POST' : 'GET'),
      headers: body ? { 'content-type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
      credentials: 'same-origin',
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.message || 'משהו השתבש, נסו שוב');
      err.code = data.error;
      err.status = res.status;
      throw err;
    }
    return data;
  }

  function avatarHtml(user) {
    const initial = esc((user.name || user.email || '?').trim().charAt(0));
    return user.avatar
      ? `<span class="avatar"><img src="${esc(user.avatar)}" alt="" referrerpolicy="no-referrer"></span>`
      : `<span class="avatar">${initial}</span>`;
  }

  function chipHtml(user) {
    return `${avatarHtml(user)}<div class="who"><b>${esc(user.name || user.email)}</b><span>${esc(user.email)}</span></div>`;
  }

  function devLink(el, data) {
    if (data && data.dev_link) {
      el.hidden = false;
      el.innerHTML = `מצב פיתוח (אין שליחת מייל): <a href="${esc(data.dev_link)}">פתחו את הקישור</a>`;
    } else {
      el.hidden = true;
    }
  }

  function statusView({ icon, title, text, actions = [], dev }) {
    $('status-icon').textContent = icon;
    $('status-title').textContent = title;
    $('status-text').textContent = text;
    devLink($('status-dev'), dev);
    const box = $('status-actions');
    box.innerHTML = '';
    for (const a of actions) {
      const el = document.createElement(a.href ? 'a' : 'button');
      el.className = 'btn btn-block ' + (a.primary ? 'btn-primary' : 'btn-outline');
      el.textContent = a.label;
      if (a.href) el.href = a.href;
      if (a.onClick) el.onclick = a.onClick;
      box.appendChild(el);
    }
    show('status');
  }

  function backToSite() {
    if (!authz) return [];
    const url = siteInfo && siteInfo.url ? siteInfo.url : new URL(authz.redirect_uri).origin;
    return [{ label: 'חזרה לאתר', href: url }];
  }

  // ------------------------------------------------------------------
  // Authorization (sending the user back to the site, signed in)
  // ------------------------------------------------------------------

  async function doAuthorize() {
    show('loading');
    let res;
    try {
      res = await api('/api/authorize', authz);
    } catch (err) {
      if (err.status === 401) return showAuth('login');
      return statusView({ icon: '⚠️', title: 'לא הצלחנו להמשיך', text: err.message, actions: backToSite() });
    }

    if (res.status === 'ok') {
      const url = new URL(authz.redirect_uri);
      url.searchParams.set('code', res.code);
      url.searchParams.set('state', authz.state);
      location.replace(url.toString());
      return;
    }
    if (res.status === 'verify_required') {
      return statusView({
        icon: '✉️',
        title: 'צריך לאמת את המייל',
        text: 'שלחנו אליך מייל אימות. לחצו על הקישור שבו כדי להמשיך.',
        actions: [
          { label: 'שלחו שוב', primary: true, onClick: async e => {
            e.target.disabled = true;
            try {
              const d = await api('/api/auth/verify/resend', { next: authzQuery });
              e.target.textContent = 'נשלח ✓';
              devLink($('status-dev'), d);
            } catch (err) { e.target.textContent = err.message; }
          } },
          { label: 'התחברות עם חשבון אחר', onClick: switchAccount },
        ],
      });
    }
    if (res.status === 'pending') {
      return statusView({
        icon: '⏳',
        title: 'הבקשה נשלחה',
        text: `הגישה ל-${res.site} דורשת אישור מנהל. נעדכן אותך ברגע שהבקשה תאושר — אחרי זה פשוט התחברו שוב.`,
        actions: backToSite(),
      });
    }
    statusView({
      icon: '🔒',
      title: 'אין גישה',
      text: `לחשבון הזה אין גישה ל-${res.site}.`,
      actions: [...backToSite(), { label: 'התחברות עם חשבון אחר', onClick: switchAccount }],
    });
  }

  async function switchAccount() {
    await api('/api/auth/logout', {}).catch(() => {});
    showAuth();
  }

  // Called after any successful sign-in on this page.
  function afterLogin(data) {
    if (data.next) {
      sessionStorage.setItem('sso:auto', '1');
      location.replace('/' + data.next);
    } else if (authz) {
      doAuthorize();
    } else {
      loadAccount();
    }
  }

  // ------------------------------------------------------------------
  // Sign-in form
  // ------------------------------------------------------------------

  const PANES = {
    login: { title: 'התחברות', form: 'form-login', email: 'login-email' },
    register: { title: 'הרשמה', form: 'form-register', email: 'reg-email' },
    magic: { title: 'כניסה בלי סיסמה', form: 'form-magic', email: 'magic-email' },
  };

  function formMsg(pane, text, type) {
    msg($(PANES[pane].form).querySelector('[data-msg]'), text, type);
  }

  // Switch between login / register / passwordless, carrying over the typed email.
  function setPane(name) {
    const typed = pane ? $(PANES[pane].email).value : '';
    pane = name;
    for (const [key, p] of Object.entries(PANES)) {
      $(p.form).hidden = key !== name;
      formMsg(key, '');
    }
    $('auth-title').textContent = PANES[name].title;
    const emailInput = $(PANES[name].email);
    if (typed && !emailInput.value) emailInput.value = typed;
    setTimeout(() => (emailInput.value && name === 'login' ? $('login-password') : emailInput).focus(), 30);
  }

  // ------------------------------------------------------------------
  // Sign in with Google (shown only when GOOGLE_CLIENT_ID is configured)
  // ------------------------------------------------------------------

  // Loads Google's script once; resolves to null when Google sign-in isn't configured or can't load.
  let gisPromise = null;
  function loadGoogle() {
    if (!config.google_client_id) return Promise.resolve(null);
    if (!gisPromise) {
      gisPromise = new Promise(resolve => {
        const s = document.createElement('script');
        s.src = 'https://accounts.google.com/gsi/client';
        s.async = true;
        s.onload = () => {
          google.accounts.id.initialize({
            client_id: config.google_client_id,
            callback: onGoogleCredential,
            ux_mode: 'popup',
            context: 'signin',
            cancel_on_tap_outside: true,
          });
          resolve(google);
        };
        s.onerror = () => resolve(null);
        document.head.appendChild(s);
      });
    }
    return gisPromise;
  }

  function renderGoogleButton(el, text) {
    if (!el || el.childElementCount) return;
    const dark = matchMedia('(prefers-color-scheme: dark)').matches;
    const width = Math.round(Math.min(372, Math.max(220, window.innerWidth - 64)));
    google.accounts.id.renderButton(el, { theme: dark ? 'filled_black' : 'outline', size: 'large', shape: 'rectangular', logo_alignment: 'center', locale: 'he', width, text });
  }

  function setupGoogle() {
    const boxes = document.querySelectorAll('#view-auth .google-only');
    loadGoogle().then(g => {
      if (!g) return boxes.forEach(el => { el.hidden = true; });
      renderGoogleButton($('g-login'), 'continue_with');
      renderGoogleButton($('g-register'), 'signup_with');
      boxes.forEach(el => { el.hidden = false; });
    });
  }

  async function onGoogleCredential({ credential }) {
    // On the account page the button links Google to the signed-in account.
    if (!$('view-account').hidden) return linkGoogle(credential);
    const current = pane || 'login';
    formMsg(current, '');
    try {
      afterLogin(await api('/api/auth/google', { credential }));
    } catch (err) {
      formMsg(current, err.message);
    }
  }

  async function linkGoogle(credential) {
    try {
      const r = await api('/api/account/google/link', { credential });
      await loadAccount();
      const other = r.google_email && r.google_email.toLowerCase() !== r.user.email ? ` (${r.google_email})` : '';
      msg($('account-msg'), `חשבון Google${other} קושר ✓ — מעכשיו אפשר להתחבר גם בלחיצה על "המשך עם Google"`, 'ok');
    } catch (err) {
      msg($('account-msg'), err.message);
    }
  }

  function renderGoogleSection(user) {
    const section = document.querySelector('.google-acc');
    loadGoogle().then(g => {
      if (!g && !user.google) { section.hidden = true; return; }
      section.hidden = false;
      $('google-unlink').hidden = !user.google;
      $('g-link').hidden = user.google || !g;
      $('google-status').innerHTML = user.google
        ? '<b>מקושר ✓</b><span>אפשר להתחבר עם Google בלחיצה אחת</span>'
        : '<b>לא מקושר</b><span>קשרו חשבון Google כדי להתחבר בלחיצה אחת, בלי סיסמה</span>';
      if (g && !user.google) renderGoogleButton($('g-link'), 'continue_with');
    });
  }

  $('google-unlink').onclick = async () => {
    const warn = document.querySelector('#current-wrap').hidden
      ? '\nאין לחשבון סיסמה — אחרי הניתוק אפשר להיכנס עם קישור למייל, או להגדיר סיסמה כאן למטה.'
      : '';
    if (!confirm('לנתק את חשבון ה-Google?' + warn)) return;
    try {
      await api('/api/account/google/unlink', {});
      await loadAccount();
      msg($('account-msg'), 'חשבון ה-Google נותק', 'ok');
    } catch (err) {
      msg($('account-msg'), err.message);
    }
  };

  function showAuth(name) {
    if (siteInfo) {
      $('auth-lead').innerHTML = `כדי להמשיך ל-<span class="site-chip">${esc(siteInfo.name)}</span>`;
    }
    show('auth');
    setupGoogle();
    setPane(name || pane || 'login');
  }

  document.querySelectorAll('[data-go]').forEach(b => { b.onclick = () => setPane(b.dataset.go); });

  document.querySelectorAll('.pw-toggle').forEach(t => {
    t.onclick = () => {
      const input = t.previousElementSibling;
      const visible = input.type === 'text';
      input.type = visible ? 'password' : 'text';
      t.setAttribute('aria-pressed', String(!visible));
      t.setAttribute('aria-label', visible ? 'הצגת הסיסמה' : 'הסתרת הסיסמה');
    };
  });

  async function submitting(form, fn) {
    const btn = form.querySelector('[type=submit]');
    btn.disabled = true;
    try { await fn(); } finally { btn.disabled = false; }
  }

  $('form-login').onsubmit = e => {
    e.preventDefault();
    const email = $('login-email').value.trim();
    const password = $('login-password').value;
    if (!email || !password) return formMsg('login', 'נא למלא מייל וסיסמה');
    formMsg('login', '');
    return submitting(e.target, async () => {
      try {
        afterLogin(await api('/api/auth/login', { email, password }));
      } catch (err) {
        formMsg('login', err.message);
      }
    });
  };

  $('form-register').onsubmit = e => {
    e.preventDefault();
    const email = $('reg-email').value.trim();
    const password = $('reg-password').value;
    if (!email || !password) return formMsg('register', 'נא למלא מייל וסיסמה');
    formMsg('register', '');
    return submitting(e.target, async () => {
      try {
        const data = await api('/api/auth/register', { email, password, name: $('reg-name').value, next: authzQuery });
        if (authz) {
          statusView({
            icon: '✉️',
            title: 'כמעט סיימנו',
            text: `שלחנו מייל אימות ל-${email}. לחצו על הקישור שבו ותחזרו לאתר מחוברים.`,
            dev: data,
            actions: backToSite(),
          });
        } else {
          loadAccount();
        }
      } catch (err) {
        formMsg('register', err.message);
        if (err.code === 'email_exists') {
          $('login-email').value = email;
        }
      }
    });
  };

  $('form-magic').onsubmit = e => {
    e.preventDefault();
    const email = $('magic-email').value.trim();
    if (!email) return formMsg('magic', 'נא למלא מייל');
    formMsg('magic', '');
    return submitting(e.target, async () => {
      try {
        const data = await api('/api/auth/magic', { email, next: authzQuery });
        $('sent-text').textContent = `שלחנו קישור כניסה ל-${email}. הקישור תקף ל-15 דקות.`;
        devLink($('dev-link'), data);
        show('sent');
      } catch (err) {
        formMsg('magic', err.message);
      }
    });
  };

  $('forgot-btn').onclick = async () => {
    const email = $('login-email').value.trim();
    if (!email) {
      formMsg('login', 'כתבו את המייל שלכם בשדה למעלה ואז לחצו שוב על "שכחתי סיסמה"', 'warn');
      $('login-email').focus();
      return;
    }
    try {
      const data = await api('/api/auth/forgot', { email, next: authzQuery });
      $('sent-text').textContent = `אם קיים חשבון עם ${email}, שלחנו אליו קישור לבחירת סיסמה חדשה.`;
      devLink($('dev-link'), data);
      show('sent');
    } catch (err) {
      formMsg('login', err.message);
    }
  };

  $('back-btn').onclick = () => showAuth();

  // ------------------------------------------------------------------
  // Continue-as screen
  // ------------------------------------------------------------------

  function showContinue(user) {
    $('continue-site').textContent = siteInfo.name;
    $('continue-desc').textContent = siteInfo.description || 'התחברות עם חשבון reem.bi';
    $('continue-chip').innerHTML = chipHtml(user);
    show('continue');
    $('continue-btn').focus();
  }
  $('continue-btn').onclick = doAuthorize;
  $('switch-btn').onclick = switchAccount;

  // ------------------------------------------------------------------
  // Password reset
  // ------------------------------------------------------------------

  $('form-reset').onsubmit = async e => {
    e.preventDefault();
    try {
      afterLogin(await api('/api/auth/reset', { token: params.get('reset'), password: $('new-password').value }));
    } catch (err) {
      msg($('reset-msg'), err.message);
    }
  };

  // ------------------------------------------------------------------
  // Account page
  // ------------------------------------------------------------------

  const STATUS = { active: ['פעיל', 'green'], pending: ['ממתין לאישור', 'warn'], blocked: ['חסום', 'red'] };

  async function loadAccount() {
    show('loading');
    let data;
    try {
      data = await api('/api/me');
    } catch {
      return showAuth();
    }
    history.replaceState(null, '', '/');
    const { user, sites } = data;
    $('account-chip').innerHTML = chipHtml(user);
    $('admin-link').hidden = !user.is_admin;
    $('verify-banner').hidden = user.email_verified;
    $('profile-name').value = user.name;
    $('current-wrap').hidden = !user.has_password;
    $('pw-title').textContent = user.has_password ? 'שינוי סיסמה' : 'הגדרת סיסמה (אופציונלי)';
    renderGoogleSection(user);

    $('sites-list').innerHTML = sites.length
      ? sites.map(s => {
          const [label, cls] = STATUS[s.status] || [s.status, ''];
          const plan = s.plan ? `<span class="badge">${esc(s.plan.name)}</span>` : '';
          const exp = s.plan_expires_at ? `<span class="meta">עד ${new Date(s.plan_expires_at * 1000).toLocaleDateString('he-IL')}</span>` : '';
          const link = s.url ? `<a href="${esc(s.url)}">${esc(s.name)}</a>` : esc(s.name);
          return `<li><b>${link}</b><span class="row">${exp}${plan}<span class="badge ${cls}">${label}</span></span></li>`;
        }).join('')
      : '<li class="meta">עוד לא התחברת לאף אתר.</li>';
    msg($('account-msg'), '');
    show('account');
  }

  $('form-profile').onsubmit = async e => {
    e.preventDefault();
    try {
      await api('/api/account/profile', { name: $('profile-name').value });
      msg($('account-msg'), 'השם עודכן ✓', 'ok');
      loadAccount();
    } catch (err) { msg($('account-msg'), err.message); }
  };

  $('form-password').onsubmit = async e => {
    e.preventDefault();
    try {
      await api('/api/account/password', { current: $('current-password').value, password: $('set-password').value });
      $('current-password').value = $('set-password').value = '';
      await loadAccount();
      msg($('account-msg'), 'הסיסמה עודכנה ✓ — שאר המכשירים נותקו', 'ok');
    } catch (err) { msg($('account-msg'), err.message); }
  };

  $('resend-verify').onclick = async e => {
    try {
      const d = await api('/api/auth/verify/resend', {});
      e.target.textContent = 'נשלח ✓';
      if (d.dev_link) msg($('account-msg'), 'מצב פיתוח: ' + d.dev_link, 'warn');
    } catch (err) { msg($('account-msg'), err.message); }
  };

  $('logout-btn').onclick = async () => { await api('/api/auth/logout', {}); showAuth(); };
  $('logout-all-btn').onclick = async () => {
    if (!confirm('לנתק את החשבון מכל המכשירים ומכל האתרים?')) return;
    await api('/api/auth/logout', { all: true });
    showAuth();
  };

  // ------------------------------------------------------------------
  // Boot
  // ------------------------------------------------------------------

  async function consumeLink(path, key) {
    show('loading');
    try {
      afterLogin(await api(path, { token: params.get(key) }));
    } catch (err) {
      history.replaceState(null, '', '/');
      statusView({ icon: '⚠️', title: 'הקישור לא עבד', text: err.message, actions: [{ label: 'להתחברות', primary: true, onClick: () => showAuth('login') }] });
    }
  }

  async function boot() {
    config = await api('/api/config').catch(() => config);

    if (params.get('magic')) return consumeLink('/api/auth/magic/verify', 'magic');
    if (params.get('verify')) return consumeLink('/api/auth/verify', 'verify');
    if (params.get('reset')) return show('reset');

    if (!authz) return loadAccount();

    try {
      siteInfo = await api('/api/authorize/info?' + new URLSearchParams({ client_id: authz.client_id, redirect_uri: authz.redirect_uri }));
      siteInfo = { ...siteInfo.site, has_access: siteInfo.has_access };
    } catch (err) {
      return statusView({ icon: '⚠️', title: 'בקשת התחברות לא תקינה', text: err.message });
    }

    let me = null;
    try { me = (await api('/api/me')).user; } catch { /* signed out */ }
    if (!me) return showAuth();

    const justLoggedIn = sessionStorage.getItem('sso:auto') === '1';
    sessionStorage.removeItem('sso:auto');
    if (authz.prompt !== 'select_account' && (justLoggedIn || siteInfo.has_access)) return doAuthorize();
    showContinue(me);
  }

  boot();
})();
