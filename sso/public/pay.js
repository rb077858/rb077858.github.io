// pay.reembir.com/r/<id> — identify the payer (reem.bi account or emailed code), then pay with PayPal.
(function () {
  'use strict';

  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const requestId = location.pathname.split('/').filter(Boolean).pop();
  const tokenKey = 'pay:' + requestId;
  const fmtDate = t => new Date(t * 1000).toLocaleDateString('he-IL');

  let info = null;
  let auth = null; // reem.bi client, for requests that belong to a registered user

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
    if (info && info.payer_type === 'user' && auth && auth.getToken()) headers.authorization = 'Bearer ' + auth.getToken();
    const payToken = sessionStorage.getItem(tokenKey);
    if (info && info.payer_type === 'email' && payToken) headers['x-pay-token'] = payToken;
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

  // ---------- registered user: sign in with reem.bi ----------

  async function startUserFlow() {
    step('<div class="loading"><span class="spinner"></span></div>');
    try {
      await loadScript(info.login_url + '/sdk.js');
    } catch {
      step('');
      return msg('שירות ההתחברות לא זמין כרגע, נסו שוב בעוד כמה דקות.');
    }
    auth = ReemAuth.init({ clientId: 'pay' });
    const user = await auth.ready;
    if (!user) return showSignIn();
    try {
      await call('/check', { body: {} });
      showPayment();
    } catch (err) {
      if (err.code === 'wrong_user') return showWrongUser(user);
      if (err.code === 'login_required') return showSignIn();
      msg(err.message);
    }
  }

  function showSignIn() {
    step(`<p class="pay-step-title">התחברו כדי לשלם</p>
      <p class="pay-step-text">הבקשה מיועדת לחשבון reem.bi של <b class="ltr">${esc(info.email_masked)}</b>. אחרי ההתחברות תחזרו לכאן לתשלום.</p>
      <button class="btn btn-primary btn-block btn-lg" id="pay-login" style="margin-top:0">התחברות עם reem.bi</button>`);
    $('pay-login').onclick = () => auth.login();
  }

  function showWrongUser(user) {
    step(`<p class="pay-step-title">החשבון לא תואם</p>
      <p class="pay-step-text">את/ה מחובר/ת כ-<b>${esc(user.email)}</b>, אבל הבקשה מיועדת לחשבון <b>${esc(info.email_masked)}</b>.</p>
      <button class="btn btn-primary btn-block btn-lg" id="pay-switch" style="margin-top:0">התחברות עם החשבון הנכון</button>`);
    $('pay-switch').onclick = async () => {
      await auth.logout();
      auth.login({ prompt: 'select_account' });
    };
  }

  // ---------- email only: 6-digit code ----------

  async function startEmailFlow() {
    if (sessionStorage.getItem(tokenKey)) {
      try {
        await call('/check', { body: {} });
        return showPayment();
      } catch {
        sessionStorage.removeItem(tokenKey);
      }
    }
    step(`<p class="pay-step-title">אימות לפני התשלום</p>
      <p class="pay-step-text">נשלח קוד בן 6 ספרות ל-<b class="ltr">${esc(info.email_masked)}</b>, כדי לוודא שהבקשה הגיעה לאדם הנכון.</p>
      <button class="btn btn-primary btn-block btn-lg" id="pay-send" style="margin-top:0">שלחו לי קוד</button>`);
    $('pay-send').onclick = sendCode;
  }

  async function sendCode(e) {
    const btn = e && e.currentTarget;
    if (btn) btn.disabled = true;
    try {
      const r = await call('/code', { body: {} });
      showCodeInput(r);
    } catch (err) {
      msg(err.message);
      if (btn) btn.disabled = false;
    }
  }

  function showCodeInput(r) {
    step(`<form id="code-form" novalidate>
      <p class="pay-step-title">הזינו את הקוד</p>
      <p class="pay-step-text">שלחנו קוד ל-<b class="ltr">${esc(r.email_masked)}</b>. הוא תקף ל-10 דקות.</p>
      <input id="code" class="code-input" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="••••••" aria-label="קוד אימות">
      ${r.dev_code ? `<div class="alert warn">מצב פיתוח — הקוד: <b class="ltr">${esc(r.dev_code)}</b></div>` : ''}
      <button class="btn btn-primary btn-block btn-lg" type="submit">אימות והמשך לתשלום</button>
      <p class="center" style="margin:14px 0 0"><button type="button" class="link-btn" id="resend">לא הגיע? שלחו שוב</button></p>
    </form>`);
    const input = $('code');
    input.focus();
    input.oninput = () => {
      input.value = input.value.replace(/\D/g, '').slice(0, 6);
      if (input.value.length === 6) $('code-form').requestSubmit();
    };
    $('resend').onclick = async () => {
      try { showCodeInput(await call('/code', { body: {} })); msg('נשלח קוד חדש ✓', 'ok'); } catch (err) { msg(err.message); }
    };
    $('code-form').onsubmit = async ev => {
      ev.preventDefault();
      const btn = ev.submitter || $('code-form').querySelector('[type=submit]');
      btn.disabled = true;
      try {
        const { pay_token } = await call('/verify', { body: { code: input.value } });
        sessionStorage.setItem(tokenKey, pay_token);
        showPayment();
      } catch (err) {
        msg(err.message);
        input.select();
        btn.disabled = false;
      }
    };
  }

  // ---------- PayPal ----------

  async function capture(orderID) {
    const r = await call('/capture', { body: { orderID } });
    sessionStorage.removeItem(tokenKey);
    showDone(r.capture_id, Math.floor(Date.now() / 1000));
  }

  async function showPayment() {
    step(`<p class="pay-step-title">בחרו איך לשלם</p>
      <p class="pay-step-text">עם חשבון PayPal או בכרטיס אשראי. הסכום ייגבה פעם אחת.</p>
      <div id="paypal-buttons"><div class="loading"><span class="spinner"></span></div></div>`);

    if (info.paypal.mock) {
      $('paypal-buttons').innerHTML = '<div class="alert warn" style="margin:0 0 12px">מצב בדיקה — אין חיוב אמיתי</div><button class="btn btn-primary btn-block btn-lg" id="mock-pay" style="margin:0">תשלום (בדיקה)</button>';
      $('mock-pay').onclick = async e => {
        e.currentTarget.disabled = true;
        try {
          const { orderID } = await call('/order', { body: {} });
          await capture(orderID);
        } catch (err) {
          msg(err.message);
          e.currentTarget.disabled = false;
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
          msg(err.message);
          throw err;
        }
      },
      onApprove: async data => {
        try {
          await capture(data.orderID);
        } catch (err) {
          msg(err.message);
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

    if (info.payer_type === 'user') startUserFlow();
    else startEmailFlow();
  })();
})();
