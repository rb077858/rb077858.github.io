/* reem.bi chat — admin dashboard: what an agent can do for a customer's reem.bi account (payment
   requests, packs, gifts, personal coupons, plan upgrades), AI translation and agent permissions. */
'use strict';

(() => {
  const { h, icon, api, S, toast, toastError, modal, confirmModal, popover, fmtDateTime, clear, isAdmin, agentById, langName, debounce } = window.App;

  const CURRENCIES = [['ILS', '₪ שקל'], ['USD', '$ דולר'], ['EUR', '€ אירו']];
  const PAY_STATUS = { open: ['ממתין לתשלום', 'warn'], paid: ['שולם ✓', 'brand'], cancelled: ['בוטל', ''], expired: ['פג תוקף', ''] };
  const PERM_INFO = {
    pay: ['card', 'בקשות תשלום', 'שליחת בקשת תשלום ללקוח מתוך הצ׳אט'],
    pack: ['box', 'שליחת חבילות', 'שליחת חבילה לרכישה (למשל דקות נוספות). אחרי התשלום החבילה נוספת לחשבון לבד'],
    gift: ['gift', 'מתנות ללקוח', 'מתנה בחינם לחשבון של הלקוח באתר, למשל דקות. מופיעה בדשבורד בדף המשתמש'],
    coupon: ['tag', 'קופונים אישיים', 'קוד הנחה, חודשים חינם או תוכנית במתנה, לשימוש אחד, בתוקף 30 יום'],
    upgrade: ['rocket', 'שדרוג תוכניות', 'שדרוג אוטומטי אחרי תשלום, ושדרוג ידני של חשבון לקוח (כולל חיפוש משתמשים)'],
    translate: ['translate', 'שליטה בתרגום', 'הפעלה וכיבוי של תרגום ה-AI בשיחה ובחירת השפות'],
  };
  const SITE_PERMS = ['pack', 'gift', 'coupon', 'upgrade'];
  const COUPON_TYPES = [['percent', 'הנחה באחוזים'], ['amount', 'הנחה בסכום'], ['trial', 'חודשים חינם'], ['gift', 'תוכנית במתנה']];
  const UNITS = { minutes: 'דקות' };

  const data = () => S.conv.data;
  const can = () => data().can || {};

  const field = (label, control, hint) => h('div', { class: 'field' }, h('label', { class: 'label' }, label), control, hint ? h('div', { class: 'hint' }, hint) : null);
  function seg(options, value, onchange) {
    const el = h('div', { class: 'seg', role: 'radiogroup' });
    const draw = v => clear(el).append(...options.map(([k, label]) => h('button', { type: 'button', class: k === v ? 'on' : '', role: 'radio', 'aria-checked': String(k === v), onclick: () => { draw(k); onchange(k); } }, label)));
    draw(value);
    return el;
  }
  const pad = n => String(n).padStart(2, '0');
  const toLocalInput = ms => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  const toDateInput = ms => toLocalInput(ms).slice(0, 10);

  // ===========================================================================
  // Payment request card (in the thread)
  // ===========================================================================

  function payCard(m) {
    const p = m.meta || {};
    let st = p.status || 'open';
    if (st === 'open' && p.expires_at && p.expires_at < Date.now()) st = 'expired';
    const [label, cls] = PAY_STATUS[st] || [st, ''];
    const canCancel = st === 'open' && (m.agent_id === S.me.id || can().pay);
    const up = p.upgrade;
    return h('div', { class: `paycard ${st}` },
      h('div', { class: 'pc-top' }, icon('card', 16), 'בקשת תשלום', h('span', { class: `badge ${cls}` }, label)),
      h('div', { class: 'pc-amount' }, p.amount_text),
      h('div', { class: 'pc-desc' }, p.description || m.body),
      h('div', { class: 'pc-meta' },
        p.payer ? h('div', null, 'משלם/ת: ', h('span', { class: 'ltr' }, p.payer)) : null,
        st === 'open' ? h('div', null, p.until_close ? 'בתוקף עד סיום השיחה' : p.expires_at ? `בתוקף עד ${fmtDateTime(p.expires_at)}` : 'ללא תאריך תפוגה') : null,
        st === 'paid' && p.paid_at ? h('div', null, `שולם ${fmtDateTime(p.paid_at)}`) : null,
        p.pack ? h('div', null, `📦 חבילה: ${p.pack.pack_name} · ${p.pack.site_name}`,
          p.upgrade_result ? (p.upgrade_result.ok ? ' — נוספה לחשבון ✓' : h('b', { class: 'pc-fail' }, ` — נכשל: ${p.upgrade_result.error || ''}`)) : null) : null,
        up ? h('div', null, `🚀 שדרוג אוטומטי: ${up.site_name} · ${up.plan_name || 'ברירת מחדל'}${up.days ? ` · ${up.days} ימים` : ''}`,
          p.upgrade_result ? (p.upgrade_result.ok ? ' — בוצע ✓' : h('b', { class: 'pc-fail' }, ` — נכשל: ${p.upgrade_result.error || ''}`)) : null) : null,
        p.emailed ? h('div', null, '✉️ נשלח גם במייל') : null),
      h('div', { class: 'pc-actions' },
        h('button', { class: 'btn sm', onclick: () => { navigator.clipboard.writeText(p.link); toast({ title: 'הקישור הועתק' }); } }, icon('copy'), 'קישור'),
        st === 'open' ? h('button', { class: 'btn sm', title: 'בדיקת הסטטוס מול מערכת התשלומים', onclick: () => payAction(p.pay_id, 'refresh') }, icon('refresh')) : null,
        canCancel ? h('button', { class: 'btn sm', onclick: () => payAction(p.pay_id, 'cancel') }, icon('x'), 'ביטול') : null));
  }

  async function payAction(id, action) {
    if (action === 'cancel' && !(await confirmModal({ title: 'לבטל את בקשת התשלום?', text: 'הקישור יפסיק לעבוד, והלקוח יראה שהבקשה בוטלה.', ok: 'ביטול הבקשה', danger: true }))) return;
    try {
      const d = await api(`a/pay/${encodeURIComponent(id)}/${action}`, { method: 'POST' });
      if (action === 'refresh') toast({ title: `סטטוס: ${(PAY_STATUS[d.status] || [d.status])[0]}` });
    } catch (e) { toastError(e); }
  }

  // ===========================================================================
  // reem.bi accounts & plans (login.reembir.com)
  // ===========================================================================

  let catalog = null;
  async function getCatalog() {
    if (!catalog) catalog = api(`a/sso/catalog${S.conv?.data ? `?conv=${data().conversation.id}` : ''}`).catch(e => { catalog = null; throw e; });
    return catalog;
  }
  // The sites an agent may act on with a permission (empty list = all).
  const allowedSites = (cat, perm) => cat.sites.filter(x => !perm?.sites?.length || perm.sites.includes(x.id));

  /** Search box for reem.bi accounts. Starts with the customer's email when there is one. */
  function userPicker(onPick, { initial } = {}) {
    let picked = null;
    let last = [];
    const input = h('input', { class: 'input', type: 'search', placeholder: 'חיפוש חשבון לפי מייל או שם…', value: initial || '' });
    const list = h('div', { class: 'user-results' });
    const draw = users => {
      last = users;
      clear(list).append(...(users.length
        ? users.map(u => h('button', {
          type: 'button', class: `user-row ${picked?.id === u.id ? 'on' : ''}`,
          onclick: () => { picked = u; onPick(u); draw(last); },
        },
        h('div', { class: 'grow' },
          h('div', { class: 'ur-name' }, u.name || u.email, u.disabled ? h('span', { class: 'badge danger' }, 'מושבת') : null, !u.email_verified ? h('span', { class: 'badge warn' }, 'מייל לא מאומת') : null),
          h('div', { class: 'faint ltr', style: { textAlign: 'right' } }, u.email),
          u.access?.length ? h('div', { class: 'ur-access' }, u.access.map(a => h('span', { class: 'badge' }, `${a.site_name}${a.plan_name ? ` · ${a.plan_name}` : ''}`))) : null),
        picked?.id === u.id ? icon('check', 18) : null))
        : [h('div', { class: 'faint', style: { padding: '10px 4px', fontSize: '13px' } },
          input.value.trim() ? 'לא נמצא חשבון. הלקוח צריך קודם להירשם ל-reem.bi (login.reembir.com) עם המייל שלו.' : 'הקלידו כדי לחפש')]));
    };
    const search = async () => {
      const q = input.value.trim();
      if (!q) return draw([]);
      try {
        const d = await api(`a/sso/users?q=${encodeURIComponent(q)}&conv=${data().conversation.id}`);
        draw(d.users);
        const exact = d.users.filter(u => u.email === q.toLowerCase());
        if (!picked && exact.length === 1) { picked = exact[0]; onPick(picked); draw(d.users); }
      } catch (e) { toastError(e); }
    };
    input.addEventListener('input', debounce(search, 300));
    if (initial) search(); else draw([]);
    return h('div', { class: 'user-picker' }, input, list);
  }

  function planFields(cat, { days = 30, perm } = {}) {
    const c = S.conv?.data?.conversation;
    const site = h('select', { class: 'select' }, h('option', { value: '' }, 'בחרו אתר…'),
      allowedSites(cat, perm).map(x => h('option', { value: x.id, selected: x.id === c?.site_id }, x.name)));
    const plan = h('select', { class: 'select' });
    if (perm?.max_days) days = Math.min(days, perm.max_days);
    const daysIn = h('input', { class: 'input', type: 'number', min: perm?.max_days ? 1 : 0, max: perm?.max_days || 3650, value: days });
    const drawPlans = () => clear(plan).append(perm?.plans?.length ? null : h('option', { value: '' }, 'ברירת המחדל של האתר'),
      ...cat.plans.filter(p => p.site_id === site.value && (!perm?.plans?.length || perm.plans.includes(p.id))).map(p => h('option', { value: p.id }, p.name)));
    site.addEventListener('change', () => {
      drawPlans();
      // Most of the time you upgrade to a paid plan — pick the first non-default one.
      const paid = cat.plans.filter(p => p.site_id === site.value);
      if (paid.length > 1) plan.value = paid[1].id;
    });
    drawPlans();
    return {
      el: h('div', { class: 'grid plan-grid' }, field('אתר', site), field('תוכנית', plan), field('ימים', daysIn, perm?.max_days ? `עד ${perm.max_days}` : '0 = ללא הגבלה')),
      value: () => ({ site_id: site.value, plan_id: plan.value || null, days: Math.max(0, Number(daysIn.value) || 0) }),
    };
  }

  async function upgradeModal() {
    const { conversation: c, visitor: v } = data();
    let cat;
    try { cat = await getCatalog(); } catch (e) { return toastError(e); }
    let user = null;
    const pf = planFields(cat, { perm: can().upgrade });
    modal({
      title: 'שדרוג חשבון ידני',
      body: [
        h('p', { class: 'muted', style: { marginBottom: '14px' } }, 'למשל אחרי שראיתם שהתשלום התקבל. אם יש ללקוח כבר את אותה תוכנית בתוקף — הימים יתווספו לה.'),
        accountField(u => { user = u; }),
        pf.el,
      ],
      foot: close => [
        h('button', { class: 'btn', onclick: close }, 'ביטול'),
        h('button', {
          class: 'btn primary',
          onclick: async e => {
            const val = pf.value();
            if (!user) return toastError(new Error('בחרו את חשבון הלקוח'));
            if (!val.site_id) return toastError(new Error('בחרו אתר'));
            e.currentTarget.disabled = true;
            try {
              const d = await api('a/sso/access', { method: 'POST', body: { ...val, user_id: user.id, conv_id: c.id } });
              close();
              toast({ title: 'החשבון שודרג ✓', text: `${d.result.user_email} · ${d.result.site_name} · ${d.result.plan_name}` });
            } catch (err) { toastError(err); e.currentTarget.disabled = false; }
          },
        }, icon('rocket'), 'שדרוג'),
      ],
    });
  }

  // ===========================================================================
  // New payment request
  // ===========================================================================

  async function payModal() {
    const { conversation: c, visitor: v } = data();
    const perm = can().pay || {};
    const canUp = !!can().upgrade;
    const def = S.settings.payments || { currency: 'ILS', default_days: 3 };
    let days = def.default_days || 0;
    if (perm.max_days && (!days || days > perm.max_days)) days = perm.max_days;

    const f = {
      amount: h('input', { class: 'input ltr', type: 'number', min: 1, step: '0.01', placeholder: '0.00' }),
      currency: h('select', { class: 'select' }, CURRENCIES.map(([k, l]) => h('option', { value: k, selected: k === def.currency }, l))),
      desc: h('input', { class: 'input', maxlength: 200, placeholder: 'עבור מה? למשל: שדרוג לתוכנית Pro לשנה' }),
      email: h('input', { class: 'input ltr', type: 'email', value: v.email || '', placeholder: 'customer@example.com' }),
      date: h('input', { class: 'input ltr', type: 'datetime-local', value: toLocalInput(Date.now() + (days || 3) * 864e5) }),
      sendEmail: h('input', { type: 'checkbox' }),
      upOn: h('input', { type: 'checkbox' }),
    };
    if (perm.max_days) f.date.max = toLocalInput(Date.now() + perm.max_days * 864e5);
    const st = { payer: 'email', user: null, validity: days ? 'date' : 'none', plan: null };

    const payerBox = h('div');
    const validityBox = h('div');
    const upgradeBox = h('div');

    const drawPayer = () => {
      st.user = null;
      clear(payerBox).append(st.payer === 'email'
        ? field('המייל של הלקוח', f.email, 'כדי לשלם הלקוח יצטרך להתחבר (או להירשם) ל-reem.bi עם המייל הזה.')
        : field('חשבון reem.bi של הלקוח', userPicker(u => { st.user = u; drawUpgrade(); }, { initial: v.email })));
      drawUpgrade();
    };
    const drawValidity = () => clear(validityBox).append(st.validity === 'date' ? field('בתוקף עד', f.date) : null);
    const drawUpgrade = async () => {
      clear(upgradeBox);
      if (!canUp || st.payer !== 'account') return;
      const toggle = h('label', { class: 'switch field' }, f.upOn, h('span', { class: 'track' }), 'אחרי התשלום — לשדרג את החשבון אוטומטית');
      f.upOn.onchange = drawUpgrade;
      upgradeBox.append(toggle);
      if (!f.upOn.checked) return;
      try {
        const cat = await getCatalog();
        if (!f.upOn.checked || st.payer !== 'account') return;
        st.plan ||= planFields(cat, { perm: can().upgrade });
        upgradeBox.append(st.plan.el);
      } catch (e) { toastError(e); }
    };
    drawPayer(); drawValidity();

    const limits = [perm.max_amount ? `עד ${perm.max_amount} לבקשה` : null, perm.max_days ? `תוקף של עד ${perm.max_days} ימים` : null].filter(Boolean);
    modal({
      title: 'בקשת תשלום',
      body: [
        h('p', { class: 'muted', style: { marginBottom: '14px' } }, 'הלקוח יקבל בצ׳אט כרטיס עם הסכום וכפתור לתשלום מאובטח (PayPal / כרטיס אשראי). כשישלם — תקבלו התראה כאן.'),
        limits.length ? h('div', { class: 'alert info', style: { marginBottom: '14px' } }, `ההרשאה שלך: ${limits.join(' · ')}`) : null,
        h('div', { class: 'grid', style: { gridTemplateColumns: '1fr 130px' } }, field('סכום', f.amount), field('מטבע', f.currency)),
        field('תיאור', f.desc),
        canUp ? field('מי משלם', seg([['email', 'לפי מייל'], ['account', 'חשבון reem.bi מסוים']], st.payer, x => { st.payer = x; drawPayer(); })) : null,
        payerBox,
        field('תוקף הבקשה', seg([['date', 'עד תאריך'], ['close', 'עד סיום השיחה'], ...(perm.max_days ? [] : [['none', 'ללא תפוגה']])], st.validity, x => { st.validity = x; drawValidity(); })),
        validityBox,
        upgradeBox,
        h('label', { class: 'switch field' }, f.sendEmail, h('span', { class: 'track' }), 'לשלוח את הבקשה גם במייל'),
      ],
      foot: close => [
        h('button', { class: 'btn', onclick: close }, 'ביטול'),
        h('button', {
          class: 'btn primary',
          onclick: async e => {
            const body = {
              amount: f.amount.value, currency: f.currency.value, description: f.desc.value.trim(),
              send_email: f.sendEmail.checked, until_close: st.validity === 'close',
              expires_at: st.validity === 'date' && f.date.value ? new Date(f.date.value).getTime() : null,
            };
            if (!(Number(body.amount) > 0)) return toastError(new Error('הזינו סכום'));
            if (!body.description) return toastError(new Error('כתבו עבור מה התשלום'));
            if (st.payer === 'account') {
              if (!st.user) return toastError(new Error('בחרו את חשבון הלקוח'));
              body.user_id = st.user.id;
              if (f.upOn.checked && st.plan) {
                body.upgrade = st.plan.value();
                if (!body.upgrade.site_id) return toastError(new Error('בחרו לאיזה אתר לשדרג'));
              }
            } else {
              body.email = f.email.value.trim();
              if (!body.email) return toastError(new Error('הזינו את המייל של הלקוח'));
            }
            e.currentTarget.disabled = true;
            try {
              await api(`a/conversations/${c.id}/pay`, { method: 'POST', body });
              close();
              toast({ title: 'בקשת התשלום נשלחה בצ׳אט ✓' });
            } catch (err) { toastError(err); e.currentTarget.disabled = false; }
          },
        }, icon('send'), 'שליחה ללקוח'),
      ],
    });
    setTimeout(() => f.amount.focus(), 80);
  }

  // ===========================================================================
  // Customer actions: one menu (composer ⚡ button and the side panel)
  // ===========================================================================

  const ACTIONS = [
    ['pay', 'card', 'בקשת תשלום', 'סכום חופשי', () => payModal()],
    ['pack', 'box', 'חבילה לרכישה', 'למשל דקות נוספות', () => packModal()],
    ['gift', 'gift', 'מתנה', 'בחינם, לחשבון', () => giftModal()],
    ['coupon', 'tag', 'קופון אישי', 'הנחה או חודשים חינם', () => couponModal()],
    ['upgrade', 'rocket', 'שדרוג חשבון', 'תוכנית וימים', () => upgradeModal()],
  ];
  const hasActions = () => S.integrations.pay && ACTIONS.some(([k]) => can()[k]);

  function actionsMenu() {
    const c = data().conversation;
    const list = ACTIONS.filter(([k]) => can()[k]);
    let closeMenu = null;
    modal({
      title: 'פעולות ללקוח',
      body: [
        accountLine(),
        h('div', { class: 'act-grid' }, list.map(([k, ic, label, sub, fn]) => h('button', {
          class: 'act-tile', disabled: c.status !== 'open' && k !== 'upgrade',
          onclick: () => { closeMenu?.(); setTimeout(fn, 60); },
        }, h('span', { class: 'ic' }, icon(ic, 18)), h('span', null, label, h('small', null, sub))))),
      ],
      foot: close => { closeMenu = close; return [h('button', { class: 'btn', onclick: close }, 'סגירה')]; },
    });
  }

  /** "Verified reem.bi account: dana@… · תמלול" — the account the actions go to. */
  function accountLine() {
    const { conversation: c, visitor: v } = data();
    if (!v.account_id) {
      return h('div', { class: 'alert info', style: { marginBottom: '12px' } }, 'הלקוח לא מחובר לחשבון reem.bi באתר. בכל פעולה תבחרו את החשבון שלו לפי מייל.');
    }
    return h('div', { class: 'acc-card' }, icon('badgeCheck', 20),
      h('div', { class: 'grow' }, h('b', null, v.account_name || v.name || 'חשבון reem.bi', h('span', { class: 'badge brand' }, 'מאומת')),
        h('div', { class: 'ltr faint' }, v.account_email), c.site_name ? h('div', { class: 'faint' }, `כתב/ה מ${c.site_name}`) : null));
  }

  /** The customer's account: the verified one, or a search (also to pick another). */
  function accountField(onPick) {
    const v = data().visitor;
    const box = h('div');
    const search = () => clear(box).append(userPicker(u => onPick(u), { initial: v.account_email || v.email }));
    if (v.account_id) {
      onPick({ id: v.account_id, email: v.account_email });
      clear(box).append(h('div', { class: 'row', style: { gap: '8px', alignItems: 'center' } },
        h('span', { class: 'badge brand' }, icon('badgeCheck', 12), 'מאומת'), h('span', { class: 'ltr grow ellipsis' }, v.account_email),
        h('button', { type: 'button', class: 'link-btn', onclick: () => { onPick(null); search(); } }, 'חשבון אחר')));
    } else search();
    return field('חשבון הלקוח', box);
  }

  function siteSelect(cat, perm, onchange) {
    const c = data().conversation;
    const sites = allowedSites(cat, perm);
    const sel = h('select', { class: 'select' }, sites.map(x => h('option', { value: x.id, selected: x.id === c.site_id }, x.name)));
    sel.addEventListener('change', () => onchange && onchange(sel.value));
    return sel;
  }

  async function giftModal() {
    const c = data().conversation;
    const perm = can().gift || {};
    let cat;
    try { cat = await getCatalog(); } catch (e) { return toastError(e); }
    let user = null;
    const site = siteSelect(cat, perm, () => drawKeys());
    const key = h('select', { class: 'select' });
    const custom = h('input', { class: 'input ltr hidden', placeholder: 'שם השדה, למשל credits' });
    const amount = h('input', { class: 'input', type: 'number', min: 1, step: 'any', max: perm.max_amount || undefined, placeholder: perm.max_amount ? `עד ${perm.max_amount}` : '' });
    const note = h('input', { class: 'input', maxlength: 80, placeholder: 'למשל: פיצוי על תקלה (רק לצוות)' });
    const presets = h('div', { class: 'chips-pick' });
    function drawKeys() {
      const keys = cat.bonus_keys?.[site.value] || [];
      clear(key).append(...keys.map(k => h('option', { value: k }, UNITS[k] || k)), h('option', { value: '' }, 'אחר…'));
      custom.classList.toggle('hidden', !!keys.length);
      // The site's packs as quick picks ("100 דקות"), as a gift.
      const packs = (cat.packs || []).filter(p => p.site_id === site.value);
      clear(presets).append(...packs.flatMap(p => Object.entries(p.features || {}).filter(([, v]) => typeof v === 'number' && (!perm.max_amount || v <= perm.max_amount))
        .map(([k, v]) => h('button', { type: 'button', onclick: () => { key.value = keys.includes(k) ? k : ''; custom.classList.toggle('hidden', keys.includes(k)); if (!keys.includes(k)) custom.value = k; amount.value = v; } }, `${v} ${UNITS[k] || k}`))));
    }
    key.addEventListener('change', () => custom.classList.toggle('hidden', !!key.value));
    drawKeys();
    if (!site.options.length) return toastError(new Error('אין אתר שמותר לך לתת בו מתנות'));
    modal({
      title: 'מתנה ללקוח',
      body: [
        h('p', { class: 'muted', style: { marginBottom: '12px' } }, 'נכנס לחשבון של הלקוח מיד, בחינם. הלקוח יקבל בצ׳אט הודעה על המתנה, והיא תופיע בדשבורד בדף שלו.'),
        accountField(u => { user = u; }),
        field('אתר', site),
        presets,
        h('div', { class: 'amount-row' }, field('מה', h('div', null, key, custom)), field('כמה', amount, perm.max_amount ? `מותר לך עד ${perm.max_amount}` : null)),
        field('סיבה', note),
      ],
      foot: close => [
        h('button', { class: 'btn', onclick: close }, 'ביטול'),
        h('button', {
          class: 'btn primary',
          onclick: async e => {
            const k = key.value || custom.value.trim();
            const n = Number(amount.value);
            if (!user) return toastError(new Error('בחרו את חשבון הלקוח'));
            if (!k || !(n > 0)) return toastError(new Error('מה המתנה וכמה?'));
            e.currentTarget.disabled = true;
            try {
              const d = await api(`a/conversations/${c.id}/gift`, { method: 'POST', body: { user_id: user.id, site_id: site.value, features: { [k]: n }, note: note.value.trim() } });
              close();
              toast({ title: 'המתנה ניתנה ✓', text: `${d.result.label} ב${d.result.site_name}` });
            } catch (err) { toastError(err); e.currentTarget.disabled = false; }
          },
        }, icon('gift'), 'מתנה'),
      ],
    });
  }

  async function couponModal() {
    const c = data().conversation;
    const perm = can().coupon || {};
    let cat;
    try { cat = await getCatalog(); } catch (e) { return toastError(e); }
    const types = COUPON_TYPES.filter(([k]) => !perm.types?.length || perm.types.includes(k));
    const st = { type: types[0]?.[0], plans: [] };
    const site = siteSelect(cat, perm, () => draw());
    const value = h('input', { class: 'input', type: 'number', min: 1, step: 'any' });
    const months = h('input', { class: 'input', type: 'number', min: 0, max: perm.max_months || 24, value: 1 });
    const box = h('div');
    function draw() {
      const plans = cat.plans.filter(p => p.site_id === site.value && (st.type === 'gift' || p.price > 0));
      st.plans = st.plans.filter(id => plans.some(p => p.id === id));
      clear(box).append(
        field('סוג', seg(types, st.type, x => { st.type = x; draw(); })),
        st.type === 'percent' || st.type === 'amount'
          ? h('div', { class: 'amount-row' }, field(st.type === 'percent' ? 'אחוז הנחה' : 'הנחה בחודש', value, st.type === 'percent' && perm.max_percent ? `עד ${perm.max_percent}%` : null),
            field('לכמה חודשים', months, perm.max_months ? `עד ${perm.max_months}` : '0 = לתמיד'))
          : field(st.type === 'trial' ? 'כמה חודשים חינם' : 'כמה חודשים', months, perm.max_months ? `עד ${perm.max_months}` : null),
        field(st.type === 'gift' ? 'איזו תוכנית' : 'לאילו תוכניות (ריק = כולן)', h('div', { class: 'chips-pick' }, plans.map(p => h('button', {
          type: 'button', class: st.plans.includes(p.id) ? 'on' : '',
          onclick: () => { st.plans = st.type === 'gift' ? [p.id] : st.plans.includes(p.id) ? st.plans.filter(x => x !== p.id) : [...st.plans, p.id]; draw(); },
        }, p.name)))));
    }
    if (!site.options.length || !types.length) return toastError(new Error('אין לך הרשאה לקופונים באף אתר'));
    draw();
    modal({
      title: 'קופון אישי',
      body: [h('p', { class: 'muted', style: { marginBottom: '12px' } }, 'נוצר קוד לשימוש אחד, בתוקף 30 יום, והלקוח מקבל אותו בצ׳אט עם קישור שמחיל אותו באתר.'), field('אתר', site), box],
      foot: close => [
        h('button', { class: 'btn', onclick: close }, 'ביטול'),
        h('button', {
          class: 'btn primary',
          onclick: async e => {
            e.currentTarget.disabled = true;
            try {
              const d = await api(`a/conversations/${c.id}/coupon`, { method: 'POST', body: { site_id: site.value, type: st.type, value: Number(value.value) || 0, months: Number(months.value) || 0, plan_ids: st.plans } });
              close();
              toast({ title: `הקוד ${d.result.code} נשלח ללקוח ✓`, text: d.result.label });
            } catch (err) { toastError(err); e.currentTarget.disabled = false; }
          },
        }, icon('tag'), 'יצירה ושליחה'),
      ],
    });
  }

  async function packModal() {
    const c = data().conversation;
    const perm = can().pack || {};
    let cat;
    try { cat = await getCatalog(); } catch (e) { return toastError(e); }
    let user = null;
    const sites = allowedSites(cat, perm).map(x => x.id);
    const packs = (cat.packs || []).filter(p => sites.includes(p.site_id));
    if (!packs.length) return toastError(new Error('אין חבילות שנמכרות באתרים שמותרים לך'));
    const siteName = id => (cat.sites.find(x => x.id === id) || { name: id }).name;
    const money = (v, cur) => ({ ILS: '₪', USD: '$', EUR: '€' }[cur] || '') + v;
    let pick = (packs.find(p => p.site_id === c.site_id) || packs[0]).id;
    const list = h('div', { class: 'act-grid' });
    const draw = () => clear(list).append(...packs.map(p => h('button', { type: 'button', class: 'act-tile', style: p.id === pick ? { borderColor: 'var(--brand)', boxShadow: '0 0 0 2px color-mix(in srgb, var(--brand) 30%, transparent)' } : null, onclick: () => { pick = p.id; draw(); } },
      h('span', { class: 'ic' }, icon('box', 18)), h('span', null, p.name, h('small', null, `${money(p.price, p.currency)} · ${siteName(p.site_id)}`)))));
    draw();
    const sendEmail = h('input', { type: 'checkbox' });
    modal({
      title: 'חבילה לרכישה',
      body: [
        h('p', { class: 'muted', style: { marginBottom: '12px' } }, 'הלקוח מקבל בצ׳אט כרטיס תשלום במחיר החבילה. ברגע שישלם, החבילה נוספת לחשבון שלו לבד.'),
        accountField(u => { user = u; }), list,
        h('label', { class: 'switch field' }, sendEmail, h('span', { class: 'track' }), 'לשלוח גם במייל'),
      ],
      foot: close => [
        h('button', { class: 'btn', onclick: close }, 'ביטול'),
        h('button', {
          class: 'btn primary',
          onclick: async e => {
            if (!user) return toastError(new Error('בחרו את חשבון הלקוח'));
            e.currentTarget.disabled = true;
            try {
              await api(`a/conversations/${c.id}/pack`, { method: 'POST', body: { pack_id: pick, user_id: user.id, send_email: sendEmail.checked } });
              close();
              toast({ title: 'החבילה נשלחה ללקוח ✓' });
            } catch (err) { toastError(err); e.currentTarget.disabled = false; }
          },
        }, icon('send'), 'שליחה ללקוח'),
      ],
    });
  }

  // ===========================================================================
  // AI translation
  // ===========================================================================

  function translateChip(c) {
    const enabled = S.settings?.translation?.enabled && S.integrations.gemini_key;
    if (!enabled && !c.translate) return null;
    const on = c.translate === 'on';
    const label = on ? `${langName(c.visitor_lang)} ⇄ ${langName(c.agent_lang)}`
      : c.translate === 'off' ? (c.translate_manual ? 'תרגום כבוי' : 'אותה שפה · בלי תרגום')
        : c.visitor_lang ? `הלקוח כותב ב${langName(c.visitor_lang)}` : 'תרגום אוטומטי';
    return h('button', { class: `tr-chip ${on ? 'on' : ''}`, title: 'תרגום AI', onclick: e => translateMenu(e.currentTarget) }, icon('translate', 15), h('span', { class: 'ellipsis' }, label));
  }

  function statusText(c) {
    if (c.translate === 'on') return `התרגום פעיל: הודעות הלקוח מתורגמות ל${langName(c.agent_lang)}, והתשובות שלך נשלחות אליו ב${langName(c.visitor_lang)}.`;
    if (c.translate === 'off') return c.translate_manual ? 'התרגום כובה ידנית בשיחה הזו.' : 'הלקוח והנציג כותבים באותה שפה — אין צורך בתרגום, וה-AI לא מעורב בשיחה הזו.';
    return c.visitor_lang
      ? `הלקוח כותב ב${langName(c.visitor_lang)}. אחרי התשובה הראשונה שלך נזהה את השפה שלך — ואם היא שונה, התרגום יופעל אוטומטית.`
      : 'מזהים את שפת הלקוח מההודעות שלו. אחרי התשובה הראשונה שלך — אם השפות שונות, התרגום יופעל אוטומטית.';
  }

  function translateMenu(anchor) {
    const c = data().conversation;
    if (!can().translate) {
      popover(anchor, h('div', { style: { padding: '12px', maxWidth: '300px', fontSize: '13.5px', lineHeight: '1.6' } }, statusText(c),
        h('div', { class: 'faint', style: { marginTop: '8px' } }, 'אין לך הרשאה לשנות את הגדרות התרגום.')), { align: 'end' });
      return;
    }
    translateModal();
  }

  function langSelect(val) {
    const codes = Object.keys(S.langs || {});
    if (val && !codes.includes(val)) codes.unshift(val);
    return h('select', { class: 'select' }, h('option', { value: '' }, '— לא ידועה —'),
      codes.map(k => h('option', { value: k, selected: k === val }, `${langName(k)} (${k})`)));
  }

  function translateModal() {
    const c = data().conversation;
    const vl = langSelect(c.visitor_lang);
    const al = langSelect(c.agent_lang);
    let mode = c.translate_manual ? (c.translate || 'auto') : 'auto';
    const ready = S.settings?.translation?.enabled && S.integrations.gemini_key;
    modal({
      title: 'תרגום השיחה',
      body: [
        !ready ? h('div', { class: 'alert', style: { marginBottom: '14px' } }, 'תרגום ה-AI כבוי או שאין מפתח Gemini. מנהל/ת יכול/ה להפעיל אותו ב: הגדרות ← תרגום AI.') : null,
        h('p', { class: 'muted', style: { marginBottom: '14px' } }, statusText(c)),
        field('מצב', seg([['auto', 'אוטומטי'], ['on', 'תרגום פעיל'], ['off', 'כבוי']], mode, x => { mode = x; })),
        h('div', { class: 'grid', style: { gridTemplateColumns: '1fr 1fr' } }, field('שפת הלקוח', vl), field('השפה שלי', al)),
        h('div', { class: 'hint' }, 'אוטומטי = לפי זיהוי השפות. "תרגום פעיל" מתרגם בין השפות שבחרתם גם אם הזיהוי חשב אחרת.'),
      ],
      foot: close => [
        h('button', { class: 'btn', onclick: close }, 'ביטול'),
        h('button', {
          class: 'btn primary',
          onclick: async () => {
            try {
              const d = await api(`a/conversations/${c.id}/translate`, { method: 'POST', body: { mode, visitor_lang: vl.value, agent_lang: al.value } });
              data().conversation = d.conversation;
              window.App.renderThreadHead();
              window.App.renderSide();
              close();
              toast({ title: 'הגדרות התרגום עודכנו' });
            } catch (e) { toastError(e); }
          },
        }, 'שמירה'),
      ],
    });
  }

  // ===========================================================================
  // Side panel: language, actions, permissions in this chat
  // ===========================================================================

  function sideTools(c, v) {
    const k = can();
    const lang = v.spoken_lang || c.visitor_lang;
    let langEl;
    if (k.translate) {
      langEl = langSelect(lang);
      langEl.classList.add('inline-select');
      langEl.addEventListener('change', async () => {
        try {
          const mode = c.translate_manual ? (c.translate || 'auto') : 'auto';
          const d = await api(`a/conversations/${c.id}/translate`, { method: 'POST', body: { mode, visitor_lang: langEl.value } });
          data().conversation = d.conversation;
          v.spoken_lang = langEl.value;
          window.App.renderThreadHead();
        } catch (e) { toastError(e); window.App.renderSide(); }
      });
    } else {
      langEl = h('span', null, lang ? langName(lang) : 'עוד לא זוהתה');
    }

    const actions = S.integrations.pay ? ACTIONS.filter(([key]) => k[key]).map(([key, ic, label, , fn]) =>
      h('button', { class: 'btn sm', disabled: c.status !== 'open' && key !== 'upgrade', onclick: fn }, icon(ic), label)) : [];

    const grants = data().grants || [];
    const byAgent = {};
    for (const g of grants) (byAgent[g.agent_id] ||= []).push(PERM_INFO[g.perm]?.[1] || g.perm);
    const mine = !isAdmin() ? Object.entries(k).filter(([, p]) => p).map(([key, p]) => `${PERM_INFO[key][1]}${p.scope === 'chat' ? ' (לשיחה הזו)' : ''}`) : [];

    return h('div', { class: 'side-sec' },
      h('h4', null, icon('globe', 14), 'חשבון, שפה ופעולות'),
      v.account_id || c.site_name ? h('div', { class: 'acc-card' }, icon(v.account_id ? 'badgeCheck' : 'globe', 18),
        h('div', { class: 'grow' },
          v.account_id ? h('b', null, 'חשבון reem.bi', h('span', { class: 'badge brand' }, 'מאומת')) : h('b', null, 'לא מחובר/ת לחשבון'),
          v.account_id ? h('div', { class: 'ltr faint' }, v.account_email) : null,
          c.site_name ? h('div', { class: 'faint' }, `כתב/ה מ${c.site_name}`) : null)) : null,
      h('div', { class: 'kv' }, icon('translate'), h('div', { class: 'row', style: { gap: '6px' } }, h('span', { class: 'faint' }, 'שפת הלקוח:'), langEl)),
      actions.length ? h('div', { class: 'row side-actions' }, actions) : null,
      mine.length ? h('div', { class: 'hint' }, `ההרשאות שלך כאן: ${mine.join(', ')}`) : null,
      Object.keys(byAgent).length || (isAdmin() && c.status === 'open') ? h('div', { class: 'grants' },
        ...Object.entries(byAgent).map(([id, names]) => h('div', { class: 'hint' }, `🔓 ${agentById(id)?.name || 'נציג'} — לשיחה הזו: ${names.join(', ')}`)),
        isAdmin() && c.status === 'open' ? h('button', { class: 'link-btn', onclick: grantsModal }, icon('shield', 13), 'הרשאות זמניות לשיחה הזו') : null) : null);
  }

  // ===========================================================================
  // Permissions editor (team page + per-chat grants)
  // ===========================================================================

  /** perms: { pay: { on, scope, until, max_amount, max_days }, ... }. chat = per-chat grant (no scope/expiry). */
  function permsEditor(perms, { chat } = {}) {
    const st = JSON.parse(JSON.stringify(perms || {}));
    const root = h('div', { class: 'perm-list' });
    const row = (label, control) => h('div', { class: 'perm-row' }, h('span', null, label), control);
    const draw = () => clear(root).append(...Object.entries(PERM_INFO).map(([key, [ic, title, desc]]) => {
      const p = st[key];
      const sw = h('input', {
        type: 'checkbox', checked: !!p?.on,
        onchange: e => { st[key] = { scope: 'any', until: null, ...(st[key] || {}), on: e.target.checked }; draw(); },
      });
      const opts = [];
      if (p?.on) {
        if (!chat) {
          opts.push(row('באילו שיחות', seg([['any', 'כל השיחות'], ['mine', 'רק שיחות שמשויכות אליו/ה']], p.scope || 'any', x => { p.scope = x; })));
          const until = h('input', { class: 'input ltr', type: 'date', value: p.until ? toDateInput(p.until) : '' });
          until.addEventListener('change', () => { p.until = until.value ? new Date(`${until.value}T23:59:59`).getTime() : null; draw(); });
          opts.push(row('עד מתי', h('div', { class: 'row', style: { gap: '8px' } }, until,
            p.until && p.until < Date.now() ? h('span', { class: 'badge danger' }, 'פג') : h('span', { class: 'faint' }, p.until ? '' : 'ריק = ללא הגבלה'))));
        }
        const num = (prop, ph = 'ללא הגבלה', max) => {
          const el = h('input', { class: 'input', type: 'number', min: 0, max, value: p[prop] || '', placeholder: ph });
          el.addEventListener('input', () => { p[prop] = Number(el.value) || null; });
          return el;
        };
        // Pick from a list; nothing picked = all of them.
        const pickList = (prop, items, allLabel) => {
          const box = h('div', { class: 'chips-pick' });
          const drawPick = () => clear(box).append(
            h('button', { type: 'button', class: !p[prop]?.length ? 'on' : '', onclick: () => { p[prop] = []; drawPick(); } }, allLabel),
            ...items.map(([id, label]) => h('button', {
              type: 'button', class: p[prop]?.includes(id) ? 'on' : '',
              onclick: () => { const cur = p[prop] || []; p[prop] = cur.includes(id) ? cur.filter(x => x !== id) : [...cur, id]; drawPick(); },
            }, label)));
          drawPick();
          return box;
        };
        if (key === 'pay') opts.push(row('סכום מקסימלי לבקשה', num('max_amount')), row('תוקף מקסימלי לבקשה (ימים)', num('max_days', 'ללא הגבלה', 365)));
        if (SITE_PERMS.includes(key)) {
          const sitesBox = h('div', { class: 'faint' }, 'טוען אתרים…');
          opts.push(row('באילו אתרים', sitesBox));
          getCatalog().then(cat => {
            sitesBox.replaceWith(pickList('sites', cat.sites.map(x => [x.id, x.name]), 'כל האתרים'));
            if (key === 'upgrade') planBox.replaceWith(pickList('plans', cat.plans.map(x => [x.id, `${x.name} · ${(cat.sites.find(s2 => s2.id === x.site_id) || {}).name || x.site_id}`]), 'כל התוכניות'));
          }).catch(() => { sitesBox.textContent = 'לא ניתן לטעון את רשימת האתרים'; });
        }
        let planBox = h('div', { class: 'faint' }, '…');
        if (key === 'upgrade') opts.push(row('אילו תוכניות', planBox), row('ימים לכל היותר', num('max_days', 'ללא הגבלה (גם לתמיד)', 3650)));
        if (key === 'gift') opts.push(row('כמה לכל היותר בכל מתנה', num('max_amount', 'ללא הגבלה')));
        if (key === 'coupon') {
          opts.push(row('אילו סוגים', pickList('types', COUPON_TYPES, 'כל הסוגים')),
            row('הנחה מקסימלית (%)', num('max_percent', 'ללא הגבלה', 100)), row('חודשים לכל היותר', num('max_months', 'ללא הגבלה (גם לתמיד)', 24)));
        }
      }
      return h('div', { class: `perm ${p?.on ? 'on' : ''}` },
        h('label', { class: 'switch perm-head' }, sw, h('span', { class: 'track' }), h('span', { class: 'perm-ic' }, icon(ic, 16)),
          h('div', null, h('b', null, title), h('div', { class: 'faint' }, desc))),
        opts.length ? h('div', { class: 'perm-opts' }, opts) : null);
    }));
    draw();
    return { el: root, value: () => st };
  }

  /** Short labels for a team card: ["בקשות תשלום (שלו) עד 1.1.27", …] */
  function permSummary(perms) {
    return Object.entries(perms || {}).filter(([k, p]) => p?.on && PERM_INFO[k]).map(([k, p]) => {
      const expired = p.until && p.until < Date.now();
      const limits = [
        p.sites?.length ? `${p.sites.length} אתרים` : '', k === 'gift' && p.max_amount ? `עד ${p.max_amount}` : '',
        k === 'coupon' && p.max_percent ? `עד ${p.max_percent}%` : '', p.max_days && k !== 'pay' ? `עד ${p.max_days} ימים` : '',
      ].filter(Boolean).join(', ');
      return { text: `${PERM_INFO[k][1]}${p.scope === 'mine' ? ' · בשיחות שלו/ה' : ''}${limits ? ` · ${limits}` : ''}${p.until ? ` · עד ${new Date(p.until).toLocaleDateString('he-IL')}` : ''}`, expired };
    });
  }

  function grantsModal() {
    const c = data().conversation;
    const agents = S.agents.filter(a => !a.disabled && !a.pending && a.role !== 'admin');
    if (!agents.length) return toast({ title: 'אין נציגים (שאינם מנהלים) לתת להם הרשאה', kind: 'error', ic: 'alert' });
    const sel = h('select', { class: 'select' }, agents.map(a => h('option', { value: a.id, selected: a.id === c.assigned_agent_id }, a.name)));
    const box = h('div');
    let editor;
    const load = () => {
      const perms = {};
      for (const g of (data().grants || []).filter(x => x.agent_id === sel.value)) perms[g.perm] = { on: true, ...g.config };
      editor = permsEditor(perms, { chat: true });
      clear(box).append(editor.el);
    };
    sel.addEventListener('change', load);
    load();
    modal({
      title: `הרשאות זמניות · שיחה #${c.id}`,
      body: [
        h('p', { class: 'muted', style: { marginBottom: '14px' } }, 'ההרשאות תקפות רק בשיחה הזו, ומתבטלות אוטומטית כשהיא נסגרת. הרשאות קבועות נותנים במסך "צוות".'),
        field('נציג/ה', sel),
        box,
      ],
      foot: close => [
        h('button', { class: 'btn', onclick: close }, 'ביטול'),
        h('button', {
          class: 'btn primary',
          onclick: async () => {
            try {
              const d = await api(`a/conversations/${c.id}/grants`, { method: 'POST', body: { agent_id: sel.value, perms: editor.value() } });
              data().grants = d.grants;
              window.App.renderSide();
              close();
              toast({ title: 'ההרשאות נשמרו' });
            } catch (e) { toastError(e); }
          },
        }, 'שמירה'),
      ],
    });
  }

  window.Tools = { payCard, payModal, upgradeModal, giftModal, couponModal, packModal, actionsMenu, hasActions, translateChip, translateModal, sideTools, grantsModal, permsEditor, permSummary, PERM_INFO, seg };
})();
