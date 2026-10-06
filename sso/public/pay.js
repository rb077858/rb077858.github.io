// pay.reembir.com/r/<id> — the payer signs in with reem.bi, then pays with PayPal.
// No sign-in, no payment: the token is never reused from an earlier visit, and the server
// refuses it as soon as the reem.bi sign-in behind it ends (signing out anywhere).
(function () {
  'use strict';

  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const requestId = location.pathname.split('/').filter(Boolean).pop();
  const autoKey = 'pay:auto:' + requestId;
  const fmtDate = t => new Date(t * 1000).toLocaleDateString('he-IL');

  let info = null;
  let auth = null; // reem.bi client

  function msg(text, type) {
    const el = $('pay-msg');
    el.hidden = !text;
    el.className = 'alert ' + (type || 'err');
    el.textContent = text || '';
  }

  function step(html) {
    $('pay-step').innerHTML = html;
    msg('');
  }

  async function call(path, opts = {}) {
    const headers = { ...(opts.body ? { 'content-type': 'application/json' } : {}) };
    if (auth && auth.getToken()) headers.authorization = 'Bearer ' + auth.getToken();
    const res = await fetch(`/api/pay/${encodeURIComponent(requestId)}${path}`, {
      method: opts.method || (opts.body ? 'POST' : 'GET'),
      headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
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

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error('load_failed'));
      document.head.appendChild(s);
    });
  }

  // ------------------------------------------------------------------ views

  function renderHead() {
    $('pay-amount').textContent = info.amount_text;
    $('pay-desc').textContent = info.description;
    const meta = [];
    if (info.status === 'open' && info.expires_at) meta.push('לתשלום עד ' + fmtDate(info.expires_at));
    $('pay-meta').textContent = meta.join(' · ');
    document.title = `תשלום ${info.amount_text} | reem.bi`;
  }

  function showDone(captureId, paidAt) {
    step(`<div class="pay-done">
      <div class="big-icon">✓</div>
      <p class="pay-step-title">התשלום התקבל, תודה!</p>
      <p class="pay-step-text" style="margin:0">אישור תשלום נשלח למייל.</p>
      <ul class="receipt">
        <li><span>סכום</span><span>${esc(info.amount_text)}</span></li>
        <li><span>עבור</span><span dir="auto">${esc(info.description)}</span></li>
        ${paidAt ? `<li><span>תאריך</span><span>${esc(new Date(paidAt * 1000).toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' }))}</span></li>` : ''}
        ${captureId ? `<li><span>אסמכתא</span><span>${esc(captureId)}</span></li>` : ''}
        <li><span>מספר בקשה</span><span>${esc(info.id)}</span></li>
      </ul>
    </div>`);
    $('pay-meta').textContent = '';
  }

  function showClosed(title, text, icon) {
    step(`<div class="pay-done"><div class="big-icon" style="background:var(--surface-2);color:var(--muted)">${icon}</div>
      <p class="pay-step-title">${esc(title)}</p><p class="pay-step-text">${esc(text)}</p>
      <a class="btn btn-outline btn-block" href="mailto:support@reembir.com">פנייה לתמיכה</a></div>`);
  }

  // ---------- sign in with reem.bi (always) ----------

  async function startLoginFlow() {
    step('<div class="loading"><span class="spinner"></span></div>');
    // A token left over from an earlier visit is never reused — every visit signs in again
    // (instant while the reem.bi session is alive, a login screen after signing out).
    if (!/[?&]code=/.test(location.search)) {
      try { localStorage.removeItem('reemauth:pay'); } catch (e) { /* private mode */ }
    }
    try {
      await loadScript(info.login_url + '/sdk.js');
    } catch {
      step('');
      return msg('שירות ההתחברות לא זמין כרגע, נסו שוב בעוד כמה דקות.');
    }
    auth = ReemAuth.init({ clientId: 'pay' });
    const user = await auth.ready;
    if (!user) {
      // Go straight to the login page once per visit; if we came back without a user, show the button.
      if (!auth.error && sessionStorage.getItem(autoKey) !== '1') {
        sessionStorage.setItem(autoKey, '1');
        return auth.login();
      }
      return showSignIn();
    }
    sessionStorage.removeItem(autoKey);
    await verifySession(user);
    // Signed out in another tab or site meanwhile? Check again whenever the page comes back.
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && $('#paypal-buttons')) verifySession(user, true);
    });
  }

  async function verifySession(user, quiet) {
    try {
      await call('/check', { body: {} });
      if (!quiet) showPayment();
    } catch (err) {
      if (err.code === 'wrong_user') return showWrongUser(user);
      if (err.code === 'login_required' || err.status === 401) return signedOut();
      if (!quiet) msg(err.message);
    }
  }

  function signedOut() {
    try { localStorage.removeItem('reemauth:pay'); } catch (e) { /* ignore */ }
    showSignIn('ההתחברות הסתיימה — התחברו שוב כדי לשלם.');
  }

  function showSignIn(note) {
    const who = info.payer_type === 'user'
      ? `הבקשה מיועדת לחשבון reem.bi של <b class="ltr">${esc(info.email_masked)}</b>.`
      : `התחברו (או הירשמו בחינם) עם כתובת המייל <b class="ltr">${esc(info.email_masked)}</b>.`;
    step(`<p class="pay-step-title">התחברו כדי לשלם</p>
      <p class="pay-step-text">${who} תשלום אפשרי רק מחשבון מחובר. אחרי ההתחברות תחזרו לכאן לתשלום.</p>
      <button class="btn btn-primary btn-block btn-lg" id="pay-login" style="margin-top:0">התחברות עם reem.bi</button>`);
    if (note) msg(note, 'warn');
    $('pay-login').onclick = () => auth.login();
  }

  function showWrongUser(user) {
    step(`<p class="pay-step-title">החשבון לא תואם</p>
      <p class="pay-step-text">את/ה מחובר/ת כ-<b>${esc(user.email)}</b>, אבל הבקשה מיועדת ל<b class="ltr">${esc(info.email_masked)}</b>.</p>
      <button class="btn btn-primary btn-block btn-lg" id="pay-switch" style="margin-top:0">התחברות עם החשבון הנכון</button>`);
    $('pay-switch').onclick = async () => {
      await auth.logout();
      auth.login({ prompt: 'select_account' });
    };
  }

  // ---------- PayPal ----------

  async function capture(orderID) {
    const r = await call('/capture', { body: { orderID } });
    showDone(r.capture_id, Math.floor(Date.now() / 1000));
  }

  async function showPayment() {
    step(`<p class="pay-step-title">בחרו איך לשלם</p>
      <p class="pay-step-text">עם חשבון PayPal או בכרטיס אשראי. הסכום ייגבה פעם אחת.</p>
      <div id="paypal-buttons"><div class="loading"><span class="spinner"></span></div></div>`);

    if (info.paypal.mock) {
      $('paypal-buttons').innerHTML = '<div class="alert warn" style="margin:0 0 12px">מצב בדיקה — אין חיוב אמיתי</div><button class="btn btn-primary btn-block btn-lg" id="mock-pay" style="margin:0">תשלום (בדיקה)</button>';
      $('mock-pay').onclick = async e => {
        const btn = e.currentTarget;
        btn.disabled = true;
        try {
          const { orderID } = await call('/order', { body: {} });
          await capture(orderID);
        } catch (err) {
          if (err.code === 'login_required') return signedOut();
          msg(err.message);
          btn.disabled = false;
        }
      };
      return;
    }
    if (!info.paypal.client_id) {
      $('paypal-buttons').innerHTML = '';
      return msg('התשלום עוד לא הוגדר. נסו שוב מאוחר יותר או פנו ל-support@reembir.com');
    }

    const q = new URLSearchParams({
      'client-id': info.paypal.client_id,
      currency: info.currency,
      intent: 'capture',
      components: 'buttons',
      locale: 'he_IL',
      'enable-funding': 'card',
      'disable-funding': 'paylater,venmo',
    });
    try {
      await loadScript('https://www.paypal.com/sdk/js?' + q);
    } catch {
      $('paypal-buttons').innerHTML = '';
      return msg('לא הצלחנו לטעון את PayPal. בדקו את החיבור או חסמי פרסומות, ונסו שוב.');
    }
    $('paypal-buttons').innerHTML = '';
    paypal.Buttons({
      style: { layout: 'vertical', shape: 'rect', label: 'pay', height: 48 },
      createOrder: async () => {
        msg('');
        try {
          return (await call('/order', { body: {} })).orderID;
        } catch (err) {
          if (err.code === 'login_required') signedOut(); else msg(err.message);
          throw err;
        }
      },
      onApprove: async data => {
        try {
          await capture(data.orderID);
        } catch (err) {
          if (err.code === 'login_required') signedOut(); else msg(err.message);
        }
      },
      onError: err => {
        console.error(err);
        msg('התשלום לא הושלם. נסו שוב, או נסו אמצעי תשלום אחר.');
      },
    }).render('#paypal-buttons');
  }

  // ------------------------------------------------------------------ boot

  (async function boot() {
    try {
      info = await call('');
    } catch (err) {
      $('pay-loading').hidden = true;
      $('pay-body').hidden = false;
      $('pay-amount').textContent = '';
      return showClosed('בקשת התשלום לא נמצאה', 'ייתכן שהקישור שגוי או שהבקשה נמחקה.', '?');
    }
    $('pay-loading').hidden = true;
    $('pay-body').hidden = false;
    renderHead();

    if (info.status === 'paid') return showDone(null, info.paid_at);
    if (info.status === 'cancelled') return showClosed('הבקשה בוטלה', 'בקשת התשלום הזו כבר לא פעילה.', '✕');
    if (info.status === 'expired') return showClosed('תוקף הבקשה פג', 'אפשר לבקש קישור חדש.', '⏱');

    startLoginFlow();
  })();
})();
