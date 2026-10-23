/*!
 * reem.bi Login SDK — one account for every reem.bi project.
 *
 *   <script src="https://login.reembir.com/sdk.js"></script>
 *   <script>
 *     const auth = ReemAuth.init({ clientId: 'my-site' });
 *     auth.onChange(user => { ... });   // user = null, or { id, email, name, avatar, access: { plan, features, ... } }
 *     loginButton.onclick = () => auth.login();
 *     logoutButton.onclick = () => auth.logout();
 *   </script>
 *
 * The site must be registered (with its redirect URL) in the admin dashboard at login.reembir.com/admin.
 */
(function () {
  'use strict';

  var script = document.currentScript;
  var DEFAULT_ISSUER = script && script.src ? new URL(script.src).origin : 'https://login.reembir.com';

  function b64url(bytes) {
    var s = '';
    var arr = new Uint8Array(bytes);
    for (var i = 0; i < arr.length; i++) s += String.fromCharCode(arr[i]);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function randomString(n) {
    return b64url(crypto.getRandomValues(new Uint8Array(n || 32)));
  }
  function sha256(str) {
    return crypto.subtle.digest('SHA-256', new TextEncoder().encode(str)).then(b64url);
  }
  function store(key, value) {
    try {
      if (value === undefined) return JSON.parse(localStorage.getItem(key) || 'null');
      if (value === null) localStorage.removeItem(key);
      else localStorage.setItem(key, JSON.stringify(value));
    } catch (e) { return null; }
  }

  function Client(opts) {
    if (!opts || !opts.clientId) throw new Error('ReemAuth.init: clientId is required');
    this.clientId = opts.clientId;
    this.issuer = (opts.issuer || DEFAULT_ISSUER).replace(/\/+$/, '');
    this.redirectUri = opts.redirectUri || location.origin + location.pathname;
    this.key = 'reemauth:' + this.clientId;
    this.user = undefined; // undefined = still loading, null = signed out
    this.error = null;
    this._listeners = [];
    var cached = store(this.key);
    this._token = cached && cached.token && cached.expires > Date.now() ? cached.token : null;
    this._cachedUser = this._token ? cached.user : null;
    this.billing = new Billing(this);
    this.ready = this._init();
  }

  function framed() {
    try { return window.self !== window.top; } catch (e) { return true; }
  }

  Client.prototype._save = function (user) {
    if (this._token) store(this.key, { token: this._token, expires: this._expires || Date.now() + 29 * 864e5, user: user });
    else store(this.key, null);
  };

  Client.prototype._set = function (user) {
    this.user = user;
    for (var i = 0; i < this._listeners.length; i++) {
      try { this._listeners[i](user); } catch (e) { console.error(e); }
    }
  };

  /** Subscribe to sign-in state. Called right away if the state is already known. Returns an unsubscribe function. */
  Client.prototype.onChange = function (cb) {
    var self = this;
    this._listeners.push(cb);
    if (this.user !== undefined) cb(this.user);
    return function () { self._listeners = self._listeners.filter(function (l) { return l !== cb; }); };
  };

  Client.prototype._init = function () {
    var self = this;
    var params = new URLSearchParams(location.search);

    if (params.has('code') && params.has('state')) return this._callback(params);
    if (params.get('error') && params.has('state')) {
      this.error = params.get('error');
      this._cleanUrl();
    }

    // Show the cached user immediately, then confirm with the server in the background.
    if (this._token && this._cachedUser) {
      this._set(this._cachedUser);
      this.refresh();
      return Promise.resolve(this._cachedUser);
    }
    if (this._token) return this.refresh();
    // Inside the reem.bi admin (a site's admin screen embedded there): sign in through the page around us.
    if (framed()) return this._fromParent().then(function (u) { if (!u) self._set(null); return u; });
    this._set(null);
    return Promise.resolve(null);
  };

  // When this page is embedded in login.reembir.com/admin, the admin page hands over a short-lived
  // token for this site (the login page itself can't be shown inside a frame).
  Client.prototype._fromParent = function () {
    var self = this;
    if (!framed()) return Promise.resolve(null);
    return new Promise(function (resolve) {
      var done = false;
      function finish(v) { if (done) return; done = true; window.removeEventListener('message', onMsg); resolve(v); }
      function onMsg(e) {
        var d = e.data;
        if (e.origin !== self.issuer || e.source !== window.parent || !d || d.type !== 'reemauth:token' || d.clientId !== self.clientId) return;
        finish(d.token ? d : null);
      }
      window.addEventListener('message', onMsg);
      try { window.parent.postMessage({ type: 'reemauth:token-request', clientId: self.clientId }, self.issuer); } catch (e) { finish(null); }
      setTimeout(function () { finish(null); }, 1500);
    }).then(function (d) {
      if (!d) return null;
      self._token = d.token;
      self._expires = Date.now() + (d.expires_in || 3600) * 1000;
      return self.refresh();
    });
  };

  Client.prototype._cleanUrl = function (target) {
    var url = new URL(target || location.href);
    ['code', 'state', 'error'].forEach(function (k) { url.searchParams.delete(k); });
    history.replaceState(history.state, '', url.pathname + url.search + url.hash);
  };

  Client.prototype._callback = function (params) {
    var self = this;
    var state = params.get('state');
    var pending = store('reemauth:pkce:' + state);
    store('reemauth:pkce:' + state, null);
    this._cleanUrl(pending && pending.returnTo);

    if (!pending) {
      // The login finished in another browser/tab (e.g. a magic link opened from the mail app).
      // The session on login.reembir.com is already there, so just run the flow again — it's instant.
      if (sessionStorage.getItem('reemauth:retry') !== '1') {
        sessionStorage.setItem('reemauth:retry', '1');
        this.login();
        return new Promise(function () {});
      }
      sessionStorage.removeItem('reemauth:retry');
      this._set(null);
      return Promise.resolve(null);
    }
    sessionStorage.removeItem('reemauth:retry');

    return fetch(this.issuer + '/api/token', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        client_id: this.clientId,
        code: params.get('code'),
        code_verifier: pending.verifier,
        redirect_uri: pending.redirectUri,
      }),
    }).then(function (res) {
      return res.json().then(function (data) {
        if (!res.ok) throw new Error(data.message || 'login_failed');
        self._token = data.access_token;
        self._expires = Date.now() + data.expires_in * 1000;
        var user = self._shape(data);
        self._save(user);
        self._set(user);
        return user;
      });
    }).catch(function (err) {
      console.error('[ReemAuth]', err);
      self.error = err.message;
      self._set(null);
      return null;
    });
  };

  Client.prototype._shape = function (data) {
    var u = data.user;
    return {
      id: u.id,
      email: u.email,
      name: u.name,
      avatar: u.avatar,
      access: data.access,
      plan: data.access && data.access.plan,
      features: (data.access && data.access.features) || {},
    };
  };

  /** Re-fetch the user (plan changes made in the dashboard show up here). */
  Client.prototype.refresh = function () {
    var self = this;
    if (!this._token) { this._set(null); return Promise.resolve(null); }
    return fetch(this.issuer + '/api/userinfo', { headers: { authorization: 'Bearer ' + this._token } })
      .then(function (res) {
        if (res.status === 401 || res.status === 403) {
          return res.json().then(function (d) {
            self.error = res.status === 403 ? d.error : null;
            self._token = null;
            self._save(null);
            self._set(null);
            return null;
          });
        }
        if (!res.ok) throw new Error('userinfo ' + res.status);
        return res.json().then(function (data) {
          var user = self._shape(data);
          self._save(user);
          if (JSON.stringify(user) !== JSON.stringify(self.user)) self._set(user);
          return user;
        });
      })
      .catch(function (err) {
        // Offline / server hiccup: keep whatever we had.
        console.warn('[ReemAuth] refresh failed', err);
        if (self.user === undefined) self._set(self._cachedUser || null);
        return self.user;
      });
  };

  /** Send the user to login.reembir.com; they come back to this page signed in. */
  Client.prototype.login = function (options) {
    var self = this;
    options = options || {};
    if (framed() && !options._noParent) {
      return this._fromParent().then(function (u) { return u || self.login(Object.assign({}, options, { _noParent: true })); });
    }
    var verifier = randomString(48);
    var state = randomString(16);
    var returnTo = options.returnTo || location.href;
    store('reemauth:pkce:' + state, { verifier: verifier, returnTo: returnTo, redirectUri: this.redirectUri, t: Date.now() });
    return sha256(verifier).then(function (challenge) {
      var q = new URLSearchParams({
        client_id: self.clientId,
        redirect_uri: self.redirectUri,
        state: state,
        code_challenge: challenge,
        code_challenge_method: 'S256',
      });
      if (options.prompt) q.set('prompt', options.prompt);
      location.assign(self.issuer + '/?' + q.toString());
    });
  };

  Client.prototype.logout = function () {
    var token = this._token;
    this._token = null;
    this._save(null);
    this._set(null);
    if (!token) return Promise.resolve();
    return fetch(this.issuer + '/api/token/revoke', { method: 'POST', headers: { authorization: 'Bearer ' + token } })
      .catch(function () {});
  };

  Client.prototype.getToken = function () { return this._token; };

  /** Link to the account page (profile, password, connected sites). */
  Client.prototype.accountUrl = function () { return this.issuer + '/'; };

  /** Call a login.reembir.com API endpoint as the signed-in user. */
  Client.prototype.api = function (path, options) {
    options = options || {};
    var headers = Object.assign({}, options.headers || {});
    if (this._token) headers.authorization = 'Bearer ' + this._token;
    var body = options.body;
    if (body && typeof body === 'object') {
      headers['content-type'] = 'application/json';
      body = JSON.stringify(body);
    }
    return fetch(this.issuer + path, { method: options.method || (body ? 'POST' : 'GET'), headers: headers, body: body })
      .then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (data) {
          if (!res.ok) {
            var err = new Error(data.message || 'request_failed');
            err.code = data.error;
            err.status = res.status;
            throw err;
          }
          return data;
        });
      });
  };

  Client.prototype._apply = function (data) {
    var user = this._shape(data);
    this._save(user);
    this._set(user);
    return user;
  };

  // ---------- billing (monthly plans through the central PayPal account) ----------
  //
  //   const { plans, free } = await auth.billing.catalog();      // the plans this site sells
  //   auth.billing.button(container, plan.paypal_plan_id, { onSuccess: user => …, onError: err => … });
  //   await auth.billing.checkCoupon('SUMMER50');                // → { type, label, offers: { planId: { first_price, paypal_plan_id, … } } }
  //   await auth.billing.redeem('GIFT3');                        // gift codes: the plan is given right away
  //   await auth.billing.cancel();                               // keeps working until the paid month ends
  //   user.access.subscription                                    // { status, plan_id, paid_until } or null
  function Billing(client) { this.client = client; this._catalog = null; this._paypal = null; }

  Billing.prototype.catalog = function () {
    var c = this.client;
    if (!this._catalog) {
      var self = this;
      this._catalog = fetch(c.issuer + '/api/billing/catalog?client_id=' + encodeURIComponent(c.clientId))
        .then(function (res) { return res.json().then(function (d) { if (!res.ok) throw new Error(d.message || 'catalog'); return d; }); })
        .catch(function (e) { self._catalog = null; throw e; });
    }
    return this._catalog;
  };

  Billing.prototype.status = function () {
    return this.client.api('/api/billing/me').then(function (d) { return d.subscription; });
  };

  Billing.prototype.checkCoupon = function (code) {
    return this.client.api('/api/billing/coupon', { body: { code: code } });
  };

  Billing.prototype.redeem = function (code) {
    var c = this.client;
    return c.api('/api/billing/redeem', { body: { code: code } }).then(function (d) { return c._apply(d); });
  };

  Billing.prototype.cancel = function () {
    var c = this.client;
    return c.api('/api/billing/cancel', { body: {} }).then(function (d) { return c._apply(d); });
  };

  Billing.prototype._loadPayPal = function (cat, currency) {
    if (this._paypal) return this._paypal;
    var self = this;
    this._paypal = new Promise(function (resolve, reject) {
      if (!cat.paypal) return reject(new Error('התשלומים עוד לא הופעלו'));
      var s = document.createElement('script');
      s.src = 'https://www.paypal.com/sdk/js?' + new URLSearchParams({
        'client-id': cat.paypal.client_id, vault: 'true', intent: 'subscription', currency: currency || cat.currency, components: 'buttons',
      });
      s.onload = function () { resolve(window.paypal); };
      s.onerror = function () { self._paypal = null; reject(new Error('PayPal לא נטען')); };
      document.head.appendChild(s);
    });
    return this._paypal;
  };

  /** A PayPal subscribe button for one plan (plan.paypal_plan_id, or a coupon offer's paypal_plan_id). */
  Billing.prototype.button = function (container, paypalPlanId, opts) {
    var self = this;
    var c = this.client;
    opts = opts || {};
    return this.catalog().then(function (cat) { return self._loadPayPal(cat, opts.currency); }).then(function (paypal) {
      return paypal.Buttons({
        style: Object.assign({ layout: 'vertical', shape: 'rect', label: 'subscribe', height: 44, tagline: false }, opts.style || {}),
        createSubscription: function (data, actions) {
          if (!c.user) { c.login(); throw new Error('login'); }
          return actions.subscription.create({
            plan_id: paypalPlanId,
            custom_id: c.clientId + ':' + c.user.id,
            application_context: { shipping_preference: 'NO_SHIPPING', user_action: 'SUBSCRIBE_NOW' },
          });
        },
        onApprove: function (data) {
          return c.api('/api/billing/activate', { body: { subscription_id: data.subscriptionID } })
            .then(function (d) { var user = c._apply(d); if (opts.onSuccess) opts.onSuccess(user); })
            .catch(function (err) { if (opts.onError) opts.onError(err); });
        },
        onError: function (err) { if (opts.onError) opts.onError(err); },
      }).render(container);
    });
  };

  /**
   * Email the signed-in user (from the site's sender address, through reem.bi's Resend account).
   *   await auth.emailMe({ subject, text, html, attachments: [{ filename, content: base64 }] })
   * Up to 30 a day per user and site.
   */
  Client.prototype.emailMe = function (message) {
    return this.api('/api/email/me', { body: message });
  };

  /** For sites that store data in Firebase: a token for signInWithCustomToken(). */
  Client.prototype.getFirebaseToken = function () {
    return this.api('/api/firebase-token', { method: 'POST' }).then(function (d) { return d.token; });
  };

  window.ReemAuth = {
    init: function (opts) { return new Client(opts); },
  };
})();
