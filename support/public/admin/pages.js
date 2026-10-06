/* reem.bi chat — admin dashboard pages: visitors, history, analytics, team, canned, settings. */
'use strict';

(() => {
  const { h, icon, api, S, toast, toastError, modal, confirmModal, popover, popItem, avatar, visitorAvatar, fmtDate, fmtDateTime, ago, dur, flag, countryName, go, isAdmin, agentById, debounce, clear, colorFor } = window.App;

  const pageHead = (title, sub, ...actions) => h('div', { class: 'page-head' },
    h('div', { class: 'grow' }, h('h1', null, title), sub ? h('div', { class: 'sub' }, sub) : null), ...actions);
  const emptyState = (ic, title, text, action) => h('div', { class: 'empty' }, h('div', { class: 'e-ic' }, icon(ic)), h('h3', null, title), h('div', null, text), action ? h('div', { style: { marginTop: '16px' } }, action) : null);
  const stars = n => h('span', { style: { color: '#f59e0b', letterSpacing: '1px' }, title: `${n}/5` }, '★'.repeat(n), h('span', { style: { color: 'var(--line-strong)' } }, '★'.repeat(5 - n)));

  function switchEl(checked, onchange, label) {
    const input = h('input', { type: 'checkbox', checked, onchange: e => onchange(e.target.checked) });
    return h('label', { class: 'switch' }, input, h('span', { class: 'track' }), label || null);
  }
  function seg(options, value, onchange) {
    const el = h('div', { class: 'seg', role: 'radiogroup' });
    const draw = v => clear(el).append(...options.map(([k, label]) => h('button', { class: k === v ? 'on' : '', role: 'radio', 'aria-checked': String(k === v), onclick: () => { draw(k); onchange(k); } }, label)));
    draw(value);
    return el;
  }

  const Pages = {};
  window.Pages = Pages;

  // ===========================================================================
  // Live visitors
  // ===========================================================================
  Pages.visitors = {
    mount(main) {
      this.root = h('div', { class: 'page' }, h('div', { class: 'page-inner' }));
      main.append(this.root);
      this.render();
      clearInterval(this.timer);
      this.timer = setInterval(() => { if (S.route.name === 'visitors') this.render(); else clearInterval(this.timer); }, 15000);
    },
    render() {
      if (!this.root?.isConnected) return;
      const inner = clear(this.root.firstChild);
      // Visitors already in a chat first.
      const list = [...S.visitors.values()].sort((a, b) => (!!b.conv_id - !!a.conv_id) || (a.since || 0) - (b.since || 0));
      const inChat = list.filter(v => v.conv_id).length;
      inner.append(pageHead(h('span', { class: 'row' }, 'מבקרים באתר עכשיו', h('span', { class: 'pulse', style: { marginInlineStart: '6px' } })),
        S.settings.track_visitors ? `${list.length} מבקרים מחוברים${inChat ? ` · ${inChat} בשיחה פתוחה` : ''} · מתעדכן בזמן אמת` : 'מעקב מבקרים כבוי בהגדרות'));
      if (!S.settings.track_visitors) {
        inner.append(h('div', { class: 'card' }, emptyState('eye', 'מעקב המבקרים כבוי', 'הפעילו אותו בהגדרות → התנהגות כדי לראות מי נמצא באתר ולפתוח איתם שיחה יזומה.',
          isAdmin() ? h('button', { class: 'btn primary', onclick: () => go('settings/behavior') }, 'להגדרות') : null)));
        return;
      }
      if (!list.length) {
        inner.append(h('div', { class: 'card' }, emptyState('eye', 'אין כרגע מבקרים באתר', 'ברגע שמישהו ייכנס לדף עם הצ׳אט, הוא יופיע כאן — עם הדף שהוא נמצא בו, מאיפה הגיע ועוד.')));
        return;
      }
      inner.append(h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
        h('thead', null, h('tr', null, ['מבקר', 'מיקום', 'דף נוכחי', 'באתר כבר', 'ביקורים', 'מכשיר', ''].map(t => h('th', null, t)))),
        h('tbody', null, list.map(v => h('tr', { class: v.conv_id ? 'in-chat' : '' },
          h('td', null, h('div', { class: 'row' }, visitorAvatar({ ...v, visitor_id: v.id }, 'sm', true), h('div', null,
            h('div', { style: { fontWeight: 600 } }, v.name || 'מבקר אנונימי'),
            v.email ? h('div', { class: 'muted ltr', style: { fontSize: '12.5px' } }, v.email) : null,
            v.conv_id ? h('span', { class: 'badge brand', style: { marginTop: '4px' } }, icon('msg', 12), `בשיחה פתוחה #${v.conv_id}`,
              agentById(v.conv_agent_id) ? ` · ${agentById(v.conv_agent_id).name}` : ' · ממתינה לנציג') : null))),
          h('td', null, v.country ? `${flag(v.country)} ${v.city || countryName(v.country)}` : '—'),
          h('td', { style: { maxWidth: '320px' } }, h('a', { href: v.current_url, target: '_blank', rel: 'noopener', class: 'ellipsis', style: { display: 'block', color: 'var(--ink)' } }, v.current_title || v.current_url),
            v.referrer ? h('div', { class: 'faint ellipsis ltr', style: { fontSize: '12px' } }, `← ${v.referrer.replace(/^https?:\/\//, '')}`) : null),
          h('td', null, dur(Date.now() - (v.since || Date.now()))),
          h('td', null, v.visits),
          h('td', { class: 'muted' }, `${v.browser} · ${v.os}`),
          h('td', null, v.conv_id
            ? h('button', { class: 'btn sm', onclick: () => go(`c/${v.conv_id}`) }, icon('msg'), 'לשיחה הפתוחה')
            : h('button', { class: 'btn sm primary', onclick: () => this.startChat(v) }, icon('send'), 'פתיחת שיחה'))))))));
    },
    startChat(v) {
      const ta = h('textarea', { class: 'input', rows: 3 }, `היי${v.name ? ` ${v.name.split(' ')[0]}` : ''}! 👋 ראיתי שאת/ה מסתכל/ת על "${v.current_title || 'האתר'}" — אפשר לעזור במשהו?`);
      modal({
        title: 'פתיחת שיחה יזומה',
        body: [h('p', { class: 'muted', style: { marginBottom: '14px' } }, 'ההודעה תקפוץ אצל המבקר בחלון הצ׳אט.'), ta],
        foot: close => [h('button', { class: 'btn', onclick: close }, 'ביטול'), h('button', {
          class: 'btn primary',
          onclick: async () => {
            try { const d = await api(`a/visitors/${v.id}/start`, { method: 'POST', body: { text: ta.value } }); close(); go(`c/${d.conversation.id}`); } catch (e) { toastError(e); }
          },
        }, icon('send'), 'שליחה')],
      });
    },
  };

  // ===========================================================================
  // History
  // ===========================================================================
  Pages.history = {
    f: { q: '', view: 'all', agent: '', tag: '', rating: '', from: '', to: '', visitor: '' },
    mount(main, params) {
      if (params[0] === 'visitor' && params[1]) this.f = { ...this.f, visitor: params[1] };
      else this.f.visitor = '';
      this.list = []; this.more = false;
      this.root = h('div', { class: 'page' }, h('div', { class: 'page-inner' }));
      main.append(this.root);
      this.renderFrame();
      this.load();
    },
    query(extra = {}) {
      const p = new URLSearchParams({ view: this.f.view });
      if (this.f.q) p.set('q', this.f.q);
      if (this.f.agent) p.set('agent', this.f.agent);
      if (this.f.tag) p.set('tag', this.f.tag);
      if (this.f.rating) p.set('rating', this.f.rating === 'offline' ? '' : this.f.rating);
      if (this.f.rating === 'offline') p.set('offline', '1');
      if (this.f.from) p.set('from', new Date(this.f.from).getTime());
      if (this.f.to) p.set('to', new Date(this.f.to).getTime() + 86400000);
      if (this.f.visitor) p.set('visitor', this.f.visitor);
      for (const [k, v] of Object.entries(extra)) p.set(k, v);
      return p;
    },
    async load(more) {
      const p = this.query(more && this.list.length ? { before: this.list[this.list.length - 1].last_message_at } : {});
      this.loading = true; if (!more) this.renderTable();
      try {
        const d = await api(`a/conversations?${p}`);
        this.list = more ? [...this.list, ...d.conversations] : d.conversations;
        this.more = d.more;
      } catch (e) { toastError(e); }
      this.loading = false;
      this.renderTable();
    },
    renderFrame() {
      const inner = clear(this.root.firstChild);
      const set = (k, v) => { this.f[k] = v; this.load(); };
      const q = h('input', { class: 'input', type: 'search', placeholder: 'חיפוש חופשי…', value: this.f.q });
      q.addEventListener('input', debounce(() => set('q', q.value.trim()), 300));
      const sel = (key, options) => h('select', { class: 'select', style: { width: 'auto', minWidth: '140px' }, onchange: e => set(key, e.target.value) },
        options.map(([v, l]) => h('option', { value: v, selected: this.f[key] === v }, l)));
      const date = key => h('input', { class: 'input', type: 'date', value: this.f[key], style: { width: 'auto' }, onchange: e => set(key, e.target.value) });
      inner.append(
        pageHead('היסטוריית שיחות', this.f.visitor ? h('span', null, 'מסונן ללקוח אחד · ', h('a', { href: '#/history' }, 'הצגת הכול')) : 'כל השיחות, עם חיפוש בתוכן ההודעות',
          h('button', { class: 'btn', onclick: () => { location.href = `/api/a/export.csv?${this.query()}`; } }, icon('download'), 'ייצוא ל-CSV')),
        h('div', { class: 'card', style: { padding: '14px', marginBottom: '16px' } },
          h('div', { class: 'row', style: { flexWrap: 'wrap', gap: '10px' } },
            h('div', { class: 'search', style: { flex: '1 1 220px' } }, icon('search'), q),
            seg([['all', 'הכול'], ['open', 'פתוחות'], ['closed', 'סגורות']], this.f.view, v => set('view', v)),
            sel('agent', [['', 'כל הנציגים'], ...S.agents.map(a => [a.id, a.name])]),
            sel('rating', [['', 'כל הדירוגים'], ['good', '★ 4-5'], ['bad', '★ 1-2'], ['none', 'ללא דירוג'], ['offline', 'הודעות מחוץ לשעות']]),
            S.tags.length ? sel('tag', [['', 'כל התגיות'], ...S.tags.map(t => [t, t])]) : null,
            h('div', { class: 'row', style: { gap: '6px' } }, date('from'), h('span', { class: 'faint' }, '–'), date('to')))),
        h('div', { class: 'hist-table' }));
    },
    renderTable() {
      const box = this.root?.querySelector('.hist-table');
      if (!box) return;
      clear(box);
      if (this.loading && !this.list.length) { box.append(h('div', { class: 'center-fill', style: { padding: '60px' } }, h('div', { class: 'spinner' }))); return; }
      if (!this.list.length) { box.append(h('div', { class: 'card' }, emptyState('history', 'לא נמצאו שיחות', 'נסו לשנות את הסינון'))); return; }
      box.append(h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
        h('thead', null, h('tr', null, ['#', 'לקוח', 'הודעה אחרונה', 'נציג', 'סטטוס', 'מענה ראשון', 'דירוג', 'תאריך'].map(t => h('th', null, t)))),
        h('tbody', null, this.list.map(c => {
          const a = agentById(c.assigned_agent_id);
          return h('tr', { class: 'click', onclick: () => go(`c/${c.id}`) },
            h('td', { class: 'faint' }, c.id),
            h('td', null, h('div', { class: 'row' }, visitorAvatar(c, 'sm'), h('div', { style: { minWidth: 0 } }, h('div', { style: { fontWeight: 600 } }, c.visitor_name || 'מבקר', ' ', c.country ? flag(c.country) : ''), c.visitor_email ? h('div', { class: 'muted ltr ellipsis', style: { fontSize: '12.5px' } }, c.visitor_email) : null))),
            h('td', { style: { maxWidth: '300px' } }, h('div', { class: 'ellipsis' }, c.last_message_preview || '—'), c.tags.length ? h('div', { class: 'row', style: { gap: '4px', marginTop: '4px' } }, c.tags.map(t => h('span', { class: 'tag' }, t))) : null),
            h('td', null, a ? h('div', { class: 'row' }, avatar(a, 'xs'), a.name) : h('span', { class: 'faint' }, '—')),
            h('td', null, c.status === 'open' ? h('span', { class: 'badge brand' }, 'פתוחה') : h('span', { class: 'badge' }, 'סגורה'), c.offline ? h('span', { class: 'badge warn', style: { marginInlineStart: '4px' } }, 'אופליין') : null),
            h('td', null, c.first_response_at ? dur(c.first_response_at - c.created_at) : h('span', { class: 'badge danger' }, 'ללא מענה')),
            h('td', null, c.rating ? stars(c.rating) : h('span', { class: 'faint' }, '—')),
            h('td', { class: 'muted', style: { whiteSpace: 'nowrap' } }, fmtDateTime(c.created_at)));
        })))));
      if (this.more) box.append(h('button', { class: 'btn load-more', onclick: () => this.load(true) }, 'טעינת עוד'));
    },
  };
  window.Pages.historyUpsert = conv => {
    const hs = Pages.history;
    const i = hs.list?.findIndex(c => c.id === conv.id);
    if (i >= 0) { hs.list[i] = conv; hs.renderTable(); }
  };

  // ===========================================================================
  // Analytics
  // ===========================================================================
  Pages.analytics = {
    days: 30,
    mount(main) {
      this.root = h('div', { class: 'page' }, h('div', { class: 'page-inner' }));
      main.append(this.root);
      this.load();
    },
    async load() {
      const inner = clear(this.root.firstChild);
      inner.append(this.head(), h('div', { class: 'center-fill', style: { padding: '80px' } }, h('div', { class: 'spinner' })));
      try { this.data = await api(`a/stats?days=${this.days}`); } catch (e) { toastError(e); return; }
      this.render();
    },
    head() {
      return pageHead('דוחות וביצועים', `${this.days} הימים האחרונים`,
        seg([[7, '7 ימים'], [30, '30 יום'], [90, '90 יום'], [365, 'שנה']], this.days, v => { this.days = v; this.load(); }));
    },
    render() {
      const d = this.data;
      const inner = clear(this.root.firstChild);
      const kpi = (label, value, foot, ic, color) => h('div', { class: 'card kpi' },
        h('div', { class: 'k-ic', style: { background: `color-mix(in srgb, ${color} 14%, transparent)`, color } }, icon(ic)),
        h('div', { class: 'k-label' }, label), h('div', { class: 'k-value' }, value), h('div', { class: 'k-foot' }, foot));
      const answered = d.total - d.missed;
      inner.append(
        this.head(),
        h('div', { class: 'grid kpis', style: { marginBottom: '16px' } },
          kpi('שיחות', d.total.toLocaleString('he-IL'), `${d.open} פתוחות כרגע`, 'msg', '#00a862'),
          kpi('קיבלו מענה', d.total ? `${Math.round((answered / d.total) * 100)}%` : '—', `${d.missed} ללא מענה`, 'checks', '#0ea5e9'),
          kpi('זמן מענה ראשון', dur(d.avg_first_response), `חציון: ${dur(d.median_first_response)}`, 'timer', '#8b5cf6'),
          kpi('שביעות רצון', d.csat != null ? `${d.csat}%` : '—', d.rated ? `ממוצע ${d.avg_rating}★ · ${d.rated} דירוגים` : 'אין עדיין דירוגים', 'heart', '#ec4899'),
          kpi('משך שיחה ממוצע', dur(d.avg_duration), 'מפתיחה ועד סגירה', 'clock', '#f59e0b')),
        h('div', { class: 'grid two', style: { marginBottom: '16px' } },
          h('div', { class: 'card' },
            h('div', { class: 'row', style: { marginBottom: '14px' } }, h('div', { class: 'grow' }, h('h3', null, 'שיחות לפי יום')),
              h('div', { class: 'legend' }, h('span', null, h('i', { style: { background: '#00a862' } }), 'קיבלו מענה'), h('span', null, h('i', { style: { background: '#8b5cf6' } }), 'ללא מענה'))),
            this.barChart(d.by_day)),
          h('div', { class: 'card' },
            h('h3', null, 'דירוגי לקוחות'), h('div', { class: 'card-sub' }, d.rated ? `${d.rated} דירוגים · ${d.csat}% מרוצים (4-5 כוכבים)` : 'עוד לא התקבלו דירוגים'),
            [5, 4, 3, 2, 1].map(n => {
              const count = d.ratings[n - 1];
              const pct = d.rated ? (count / d.rated) * 100 : 0;
              return h('div', { class: 'stars-bar', title: `${count} דירוגים (${Math.round(pct)}%)` },
                h('span', null, `${n} ★`), h('div', { class: 'track' }, h('div', { class: 'fill', style: { width: `${pct}%` } })), h('span', { class: 'muted' }, count));
            }))),
        h('div', { class: 'card', style: { marginBottom: '16px' } },
          h('h3', null, 'מתי פונים אליכם?'), h('div', { class: 'card-sub' }, `מספר שיחות לפי יום ושעה (${S.settings.hours.tz})`),
          this.heatmap(d.heat)),
        h('div', { class: 'card' },
          h('h3', null, 'ביצועי נציגים'), h('div', { class: 'card-sub' }, 'לפי שיחות ששובצו לכל נציג בתקופה'),
          d.agents.length ? h('div', { class: 'table-wrap', style: { border: 0 } }, h('table', { class: 'table' },
            h('thead', null, h('tr', null, ['נציג', 'שיחות', 'הודעות', 'זמן מענה ממוצע', 'דירוג ממוצע'].map(t => h('th', null, t)))),
            h('tbody', null, d.agents.map(a => {
              const max = Math.max(...d.agents.map(x => x.chats));
              return h('tr', null,
                h('td', null, h('div', { class: 'row' }, avatar(a, 'sm'), h('b', null, a.name))),
                h('td', null, h('div', { class: 'row' }, h('span', { style: { minWidth: '28px' } }, a.chats), h('div', { class: 'load-bar', style: { flex: 1, marginTop: 0, maxWidth: '160px' } }, h('div', { style: { width: `${(a.chats / max) * 100}%` } })))),
                h('td', null, a.messages),
                h('td', null, dur(a.avg_first_response)),
                h('td', null, a.avg_rating ? h('span', null, `${a.avg_rating} `, h('span', { style: { color: '#f59e0b' } }, '★'), h('span', { class: 'faint' }, ` (${a.rated})`)) : h('span', { class: 'faint' }, '—')));
            })))) : emptyState('users', 'אין עדיין נתונים', 'ברגע שנציגים יענו לשיחות, הביצועים יופיעו כאן')),
      );
    },

    // Stacked daily bars: answered (brand green) + missed (violet — validated against green for CVD).
    barChart(days) {
      const W = 720; const H = 220; const pad = { l: 34, r: 8, t: 10, b: 26 };
      const max = Math.max(4, ...days.map(d => d.total));
      const step = Math.ceil(max / 4);
      const top = step * 4;
      const iw = W - pad.l - pad.r; const ih = H - pad.t - pad.b;
      const bw = iw / days.length;
      const barW = Math.max(2, Math.min(28, bw - 2));
      const y = v => pad.t + ih - (v / top) * ih;
      const NS = 'http://www.w3.org/2000/svg';
      const el = (tag, attrs, text) => { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); if (text != null) e.textContent = text; return e; };
      const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'img', 'aria-label': 'שיחות לפי יום' });
      for (let i = 0; i <= 4; i++) {
        const v = step * i;
        svg.append(el('line', { x1: pad.l, x2: W - pad.r, y1: y(v), y2: y(v), class: 'grid-line' }));
        svg.append(el('text', { x: pad.l - 8, y: y(v) + 4, 'text-anchor': 'end' }, v));
      }
      const tip = h('div', { class: 'pop', style: { position: 'fixed', pointerEvents: 'none', minWidth: 0, padding: '8px 12px', display: 'none', fontSize: '13px' } });
      document.body.append(tip);
      const labelEvery = Math.ceil(days.length / 10);
      // Data flows right-to-left in RTL: newest day on the left edge? Keep chronological left→right like most Hebrew dashboards.
      days.forEach((d, i) => {
        const x = pad.l + i * bw + (bw - barW) / 2;
        const answered = d.total - d.missed;
        const r = Math.min(4, barW / 2);
        // answered sits on the baseline, missed stacks on top with a 2px surface gap
        if (answered) svg.append(el('path', { d: roundedTop(x, y(answered), barW, y(0) - y(answered), d.missed ? 0 : r), class: 'bar' }));
        if (d.missed) {
          const y0 = y(answered) - (answered ? 2 : 0);
          svg.append(el('path', { d: roundedTop(x, y(d.total), barW, Math.max(1, y0 - y(d.total)), r), class: 'bar missed' }));
        }
        if (i % labelEvery === 0) svg.append(el('text', { x: x + barW / 2, y: H - 8, 'text-anchor': 'middle' }, d.date.slice(8, 10) + '/' + d.date.slice(5, 7)));
        const hit = el('rect', { x: pad.l + i * bw, y: pad.t, width: bw, height: ih, fill: 'transparent' });
        hit.addEventListener('mousemove', e => {
          tip.style.display = 'block';
          clear(tip).append(h('b', null, new Date(d.date).toLocaleDateString('he-IL', { weekday: 'short', day: 'numeric', month: 'short' })),
            h('div', null, `${d.total} שיחות`), h('div', { class: 'muted' }, `${answered} קיבלו מענה · ${d.missed} ללא מענה`));
          tip.style.left = `${Math.min(innerWidth - 200, e.clientX + 12)}px`; tip.style.top = `${e.clientY - 70}px`;
        });
        hit.addEventListener('mouseleave', () => { tip.style.display = 'none'; });
        svg.append(hit);
      });
      const wrap = h('div', { dir: 'ltr' }, svg);
      new MutationObserver((_, obs) => { if (!wrap.isConnected) { tip.remove(); obs.disconnect(); } }).observe(document.body, { childList: true, subtree: true });
      return wrap;

      function roundedTop(x, yTop, w, hgt, r) {
        if (hgt <= 0) return '';
        r = Math.min(r, hgt);
        return `M${x},${yTop + hgt}V${yTop + r}Q${x},${yTop} ${x + r},${yTop}H${x + w - r}Q${x + w},${yTop} ${x + w},${yTop + r}V${yTop + hgt}Z`;
      }
    },

    heatmap(heat) {
      const max = Math.max(1, ...heat.flat());
      const days = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];
      const grid = h('div', { class: 'heat', dir: 'ltr' });
      grid.append(h('span'));
      for (let hr = 0; hr < 24; hr++) grid.append(h('span', { style: { textAlign: 'center' } }, hr % 3 === 0 ? String(hr).padStart(2, '0') : ''));
      heat.forEach((row, d) => {
        grid.append(h('span', { class: 'hl' }, `יום ${days[d]}`));
        row.forEach((n, hr) => {
          const pct = n ? 18 + Math.round((n / max) * 82) : 0;
          grid.append(h('div', {
            class: 'cell', title: `יום ${days[d]} ${String(hr).padStart(2, '0')}:00 — ${n} שיחות`,
            style: n ? { background: `color-mix(in srgb, #00a862 ${pct}%, var(--surface-3))` } : null,
          }));
        });
      });
      return h('div', null, grid, h('div', { class: 'legend', style: { marginTop: '12px', justifyContent: 'flex-end' } }, 'פחות',
        ...[0, 30, 55, 80, 100].map(p => h('i', { style: { background: p ? `color-mix(in srgb, #00a862 ${p}%, var(--surface-3))` : 'var(--surface-3)', margin: 0 } })), 'יותר'));
    },
  };

  // ===========================================================================
  // Team
  // ===========================================================================
  Pages.team = {
    mount(main) {
      this.root = h('div', { class: 'page' }, h('div', { class: 'page-inner' }));
      main.append(this.root);
      this.render();
    },
    render() {
      if (!this.root?.isConnected) return;
      const inner = clear(this.root.firstChild);
      const online = S.agents.filter(a => a.online).length;
      inner.append(
        pageHead('הצוות', `${S.agents.filter(a => !a.disabled).length} נציגים · ${online} זמינים עכשיו`,
          isAdmin() ? h('button', { class: 'btn primary', onclick: () => this.invite() }, icon('plus'), 'הזמנת נציג/ה') : null),
        !S.emailConfigured ? h('div', { class: 'alert info', style: { marginBottom: '16px' } }, 'המיילים עוד לא מוגדרים (RESEND_API_KEY) — אחרי הזמנה יוצג קישור הצטרפות שאפשר להעביר לנציג בעצמכם.') : null,
        h('div', { class: 'team-grid' }, S.agents.map(a => {
          const load = Math.min(100, (a.active_chats / a.max_chats) * 100);
          return h('div', { class: `agent-card ${a.disabled ? 'disabled' : ''}` },
            isAdmin() || a.id === S.me.id ? h('button', { class: 'icon-btn ac-menu', onclick: e => this.menu(e.currentTarget, a) }, icon('more')) : null,
            h('div', { class: 'ac-top' },
              avatar(a, 'lg', a.online ? 'online' : a.connected ? 'away' : ''),
              h('div', { class: 'grow' },
                h('div', { class: 'ac-name' }, h('span', { class: 'ellipsis' }, a.name), a.role === 'admin' ? h('span', { class: 'badge brand' }, 'מנהל') : null),
                h('div', { class: 'ac-mail ltr ellipsis' }, a.email),
                h('div', { class: 'row', style: { marginTop: '6px', gap: '6px', flexWrap: 'wrap' } },
                  a.pending ? h('span', { class: 'badge warn' }, 'ממתין להצטרפות') : a.disabled ? h('span', { class: 'badge danger' }, 'מושבת')
                    : h('span', { class: 'badge' }, a.online ? '🟢 זמין' : a.connected ? '🟡 לא זמין' : `לא מחובר · ${a.last_seen_at ? ago(a.last_seen_at) : 'אף פעם'}`),
                  a.title ? h('span', { class: 'badge' }, a.title) : null))),
            a.role !== 'admin' && window.Tools.permSummary(a.perms).length ? h('div', { class: 'ac-perms' },
              window.Tools.permSummary(a.perms).map(p => h('span', { class: `badge ${p.expired ? 'danger' : 'brand'}`, title: p.expired ? 'ההרשאה פגה' : '' }, p.text))) : null,
            h('div', { class: 'ac-stats' },
              h('div', { class: 'ac-stat' }, h('b', null, a.active_chats), h('span', null, 'שיחות פתוחות')),
              h('div', { class: 'ac-stat' }, h('b', null, a.max_chats), h('span', null, 'מקסימום')),
              h('div', { class: 'ac-stat' }, h('b', null, a.notify_email ? '✓' : '—'), h('span', null, 'התראות מייל'))),
            h('div', { class: 'load-bar', title: `עומס: ${Math.round(load)}%` }, h('div', { style: { width: `${load}%`, background: load >= 100 ? 'var(--danger)' : load > 70 ? 'var(--warn)' : '' } })));
        })));
    },
    menu(anchor, a) {
      const admin = isAdmin();
      popover(anchor, [
        popItem('edit', 'עריכה', () => this.edit(a)),
        admin && a.pending ? popItem('mail', 'שליחת ההזמנה מחדש', async () => {
          try { const d = await api(`a/agents/${a.id}/invite`, { method: 'POST' }); this.showInvite(a, d); } catch (e) { toastError(e); }
        }) : null,
        admin && a.id !== S.me.id ? popItem(a.disabled ? 'refresh' : 'ban', a.disabled ? 'הפעלה מחדש' : 'השבתה', async () => {
          try { await api(`a/agents/${a.id}`, { method: 'PATCH', body: { disabled: !a.disabled } }); toast({ title: a.disabled ? 'הנציג הופעל' : 'הנציג הושבת' }); } catch (e) { toastError(e); }
        }) : null,
        admin && a.id !== S.me.id ? popItem('trash', 'מחיקה', async () => {
          if (!(await confirmModal({ title: `למחוק את ${a.name}?`, text: 'השיחות שלו/ה יחזרו לתור. ההיסטוריה נשמרת.', ok: 'מחיקה', danger: true }))) return;
          try { await api(`a/agents/${a.id}`, { method: 'DELETE' }); toast({ title: 'הנציג נמחק' }); } catch (e) { toastError(e); }
        }, 'danger') : null,
      ], { align: 'end' });
    },
    form(a = {}) {
      return {
        email: h('input', { class: 'input ltr', type: 'email', value: a.email || '', disabled: !!a.id, placeholder: 'agent@example.com' }),
        name: h('input', { class: 'input', value: a.name || '' }),
        title: h('input', { class: 'input', value: a.title || '', placeholder: 'למשל: מכירות' }),
        role: h('select', { class: 'select', disabled: !isAdmin() }, h('option', { value: 'agent', selected: a.role !== 'admin' }, 'נציג/ה'), h('option', { value: 'admin', selected: a.role === 'admin' }, 'מנהל/ת — גישה להגדרות ולצוות')),
        max: h('input', { class: 'input', type: 'number', min: 1, max: 50, value: a.max_chats || 5 }),
        color: h('input', { type: 'color', value: a.color || '#00a862' }),
      };
    },
    fields(f, withColor) {
      return [
        h('div', { class: 'field' }, h('label', { class: 'label' }, 'אימייל'), f.email),
        h('div', { class: 'grid', style: { gridTemplateColumns: '1fr 1fr' } },
          h('div', { class: 'field' }, h('label', { class: 'label' }, 'שם'), f.name),
          h('div', { class: 'field' }, h('label', { class: 'label' }, 'תפקיד (מוצג ללקוחות)'), f.title)),
        h('div', { class: 'grid', style: { gridTemplateColumns: '1fr 1fr' } },
          h('div', { class: 'field' }, h('label', { class: 'label' }, 'הרשאה'), f.role),
          h('div', { class: 'field' }, h('label', { class: 'label' }, 'מקסימום שיחות במקביל'), f.max)),
        withColor ? h('div', { class: 'field' }, h('label', { class: 'label' }, 'צבע'), h('div', { class: 'color-input' }, f.color)) : null,
      ];
    },
    invite() {
      const f = this.form();
      modal({
        title: 'הזמנת נציג/ה חדש/ה',
        body: [h('p', { class: 'muted', style: { marginBottom: '16px' } }, 'נשלח מייל עם קישור לבחירת סיסמה. הקישור תקף ל-7 ימים.'), ...this.fields(f)],
        foot: close => [h('button', { class: 'btn', onclick: close }, 'ביטול'), h('button', {
          class: 'btn primary',
          onclick: async () => {
            try {
              const d = await api('a/agents', { method: 'POST', body: { email: f.email.value, name: f.name.value, title: f.title.value, role: f.role.value, max_chats: f.max.value } });
              close(); this.showInvite(d.agent, d);
            } catch (e) { toastError(e); }
          },
        }, icon('send'), 'שליחת הזמנה')],
      });
    },
    showInvite(a, d) {
      if (!d.invite_link) { toast({ title: `ההזמנה נשלחה ל-${a.email} ✓` }); return; }
      modal({
        title: 'קישור ההצטרפות',
        body: [
          h('p', { class: 'muted', style: { marginBottom: '14px' } }, d.email_failed ? 'שליחת המייל נכשלה.' : 'המיילים עוד לא מוגדרים.', ' העבירו את הקישור ל', h('b', null, a.name), ' (תקף ל-7 ימים):'),
          h('div', { class: 'code' }, d.invite_link, h('button', { class: 'btn sm copy', onclick: () => { navigator.clipboard.writeText(d.invite_link); toast({ title: 'הועתק' }); } }, icon('copy'), 'העתקה')),
        ],
        foot: close => h('button', { class: 'btn primary', onclick: close }, 'סגירה'),
      });
    },
    edit(a) {
      const f = this.form(a);
      const perms = isAdmin() && a.role !== 'admin' ? window.Tools.permsEditor(a.perms) : null;
      modal({
        title: `עריכת ${a.name}`,
        body: [
          ...this.fields(f, true),
          perms ? h('div', { class: 'perm-sec' },
            h('h3', null, 'הרשאות מיוחדות'),
            h('p', { class: 'muted', style: { margin: '2px 0 12px', fontSize: '13px' } }, 'מה הנציג/ה יכול/ה לעשות מעבר לצ׳אט הרגיל. למנהלים יש את כל ההרשאות. אפשר גם לתת הרשאה רק לשיחה אחת — מתפריט השיחה.'),
            perms.el) : null,
        ],
        foot: close => [h('button', { class: 'btn', onclick: close }, 'ביטול'), h('button', {
          class: 'btn primary',
          onclick: async () => {
            try {
              await api(`a/agents/${a.id}`, { method: 'PATCH', body: { name: f.name.value, title: f.title.value, role: f.role.value, max_chats: Number(f.max.value), color: f.color.value, ...(perms ? { perms: perms.value() } : {}) } });
              close(); toast({ title: 'נשמר' });
            } catch (e) { toastError(e); }
          },
        }, 'שמירה')],
      });
    },
  };

  // ===========================================================================
  // Canned responses
  // ===========================================================================
  Pages.canned = {
    mount(main) {
      this.root = h('div', { class: 'page' }, h('div', { class: 'page-inner', style: { maxWidth: '900px' } }));
      main.append(this.root);
      this.render();
    },
    render() {
      if (!this.root?.isConnected) return;
      const inner = clear(this.root.firstChild);
      inner.append(
        pageHead('תשובות מוכנות', h('span', null, 'בחלון השיחה מקלידים ', h('b', { class: 'ltr' }, '/'), ' ואת הקיצור. משתנים: ', h('code', null, '{name}'), ' שם הלקוח · ', h('code', null, '{agent}'), ' השם שלך · ', h('code', null, '{signature}'), ' · ', h('code', null, '{site}')),
          h('button', { class: 'btn primary', onclick: () => this.edit() }, icon('plus'), 'תשובה חדשה')),
        S.canned.length
          ? h('div', { class: 'stack', style: { gap: '10px' } }, S.canned.map(c => h('div', { class: 'card', style: { padding: '16px 18px' } },
            h('div', { class: 'row', style: { alignItems: 'flex-start' } },
              h('span', { class: 's-key', style: { fontFamily: 'ui-monospace,monospace', color: 'var(--brand)', background: 'var(--brand-soft)', padding: '2px 8px', borderRadius: '7px', fontWeight: 600, fontSize: '13px', direction: 'ltr' } }, `/${c.shortcut}`),
              h('div', { class: 'grow' }, h('div', { style: { fontWeight: 600 } }, c.title), h('div', { class: 'muted', style: { whiteSpace: 'pre-wrap', marginTop: '4px' } }, c.body)),
              h('button', { class: 'icon-btn', onclick: () => this.edit(c), 'aria-label': 'עריכה' }, icon('edit')),
              h('button', {
                class: 'icon-btn', 'aria-label': 'מחיקה',
                onclick: async () => { if (await confirmModal({ title: 'למחוק את התשובה?', text: `/${c.shortcut}`, ok: 'מחיקה', danger: true })) { try { S.canned = (await api(`a/canned/${c.id}`, { method: 'DELETE' })).canned; this.render(); } catch (e) { toastError(e); } } },
              }, icon('trash'))))))
          : h('div', { class: 'card' }, emptyState('zap', 'אין עדיין תשובות מוכנות', 'שמרו תשובות שחוזרות על עצמן — ותענו בשתי הקשות.',
            h('button', { class: 'btn primary', onclick: () => this.seed() }, icon('plus'), 'הוספת כמה דוגמאות'))));
    },
    async seed() {
      const samples = [
        ['hi', 'פתיחה', 'היי {name}! 👋 כאן {agent}, איך אפשר לעזור?'],
        ['thanks', 'תודה וסיום', 'שמחתי לעזור, {name}! אם יש עוד משהו — אנחנו כאן. יום נפלא ✨'],
        ['wait', 'רגע בודק', 'שנייה אחת, אני בודק/ת את זה בשבילך…'],
        ['email', 'בקשת מייל', 'אשמח לחזור אלייך עם תשובה מסודרת — לאיזו כתובת מייל לשלוח?'],
      ];
      try { for (const [shortcut, title, body] of samples) S.canned = (await api('a/canned', { method: 'POST', body: { shortcut, title, body } })).canned; this.render(); } catch (e) { toastError(e); }
    },
    edit(c = {}) {
      const sc = h('input', { class: 'input ltr', value: c.shortcut || '', placeholder: 'hi' });
      const title = h('input', { class: 'input', value: c.title || '', placeholder: 'פתיחה' });
      const body = h('textarea', { class: 'input', rows: 5, placeholder: 'היי {name}! איך אפשר לעזור?' }, c.body || '');
      modal({
        title: c.id ? 'עריכת תשובה' : 'תשובה מוכנה חדשה',
        body: [
          h('div', { class: 'grid', style: { gridTemplateColumns: '1fr 2fr' } },
            h('div', { class: 'field' }, h('label', { class: 'label' }, 'קיצור'), sc),
            h('div', { class: 'field' }, h('label', { class: 'label' }, 'כותרת'), title)),
          h('div', { class: 'field' }, h('label', { class: 'label' }, 'טקסט'), body),
        ],
        foot: close => [h('button', { class: 'btn', onclick: close }, 'ביטול'), h('button', {
          class: 'btn primary',
          onclick: async () => {
            try {
              const payload = { shortcut: sc.value, title: title.value, body: body.value };
              S.canned = (await api(c.id ? `a/canned/${c.id}` : 'a/canned', { method: c.id ? 'PATCH' : 'POST', body: payload })).canned;
              close(); this.render();
            } catch (e) { toastError(e); }
          },
        }, 'שמירה')],
      });
    },
  };

  // ===========================================================================
  // Settings
  // ===========================================================================
  const SECTIONS = [
    ['appearance', 'palette', 'עיצוב וטקסטים'],
    ['prechat', 'form', 'טופס פתיחה'],
    ['availability', 'clock', 'זמינות ושעות'],
    ['routing', 'route', 'ניתוב שיחות'],
    ['notifications', 'bell', 'התראות מייל'],
    ['behavior', 'sliders', 'התנהגות'],
    ['payments', 'card', 'תשלומים ושדרוגים'],
    ['translation', 'translate', 'תרגום AI'],
    ['install', 'code', 'התקנה באתר'],
    ['security', 'shield', 'אבטחה'],
  ];
  const DAY_NAMES = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

  Pages.settings = {
    mount(main, params) {
      this.section = SECTIONS.some(s => s[0] === params[0]) ? params[0] : 'appearance';
      this.draft = structuredClone(S.settings);
      this.root = h('div', { class: 'page' }, h('div', { class: 'page-inner' }));
      main.append(this.root);
      this.render();
    },
    get dirty() { return JSON.stringify(this.draft) !== JSON.stringify(S.settings); },
    set(path, value, rerender) {
      const keys = path.split('.');
      let o = this.draft;
      while (keys.length > 1) o = o[keys.shift()];
      o[keys[0]] = value;
      this.renderSaveBar();
      if (rerender) this.renderBody();
      if (this.section === 'appearance') this.renderPreview();
    },
    render() {
      const inner = clear(this.root.firstChild);
      inner.append(
        pageHead('הגדרות', 'השינויים חלים מיד על הצ׳אט בכל האתרים'),
        h('div', { class: 'settings' },
          h('nav', { class: 'settings-nav' }, SECTIONS.map(([k, ic, label]) => h('button', {
            class: this.section === k ? 'on' : '',
            onclick: () => { this.section = k; history.replaceState(null, '', `#/settings/${k}`); this.render(); },
          }, icon(ic), label))),
          h('div', null, h('div', { class: 'set-body' }), h('div', { class: 'save-slot' }))));
      this.renderBody();
      this.renderSaveBar();
    },
    renderSaveBar() {
      const slot = this.root.querySelector('.save-slot');
      if (!slot) return;
      clear(slot);
      if (!this.dirty) return;
      slot.append(h('div', { class: 'save-bar' },
        icon('alert', 18), h('span', { class: 'grow' }, 'יש שינויים שלא נשמרו'),
        h('button', { class: 'btn', onclick: () => { this.draft = structuredClone(S.settings); this.render(); } }, 'ביטול'),
        h('button', { class: 'btn primary', onclick: () => this.save() }, icon('check'), 'שמירת השינויים')));
    },
    async save() {
      try {
        S.settings = (await api('a/settings', { method: 'PUT', body: this.draft })).settings;
        this.draft = structuredClone(S.settings);
        toast({ title: 'ההגדרות נשמרו ✓', text: 'הצ׳אט באתר התעדכן' });
        this.render();
      } catch (e) { toastError(e); }
    },
    row(title, desc, control) {
      return h('div', { class: 'set-row' }, h('div', { class: 'sr-text' }, h('div', { class: 'sr-title' }, title), desc ? h('div', { class: 'sr-desc' }, desc) : null), control);
    },
    input(path, attrs = {}) {
      const val = path.split('.').reduce((o, k) => o?.[k], this.draft);
      const tag = attrs.rows ? 'textarea' : 'input';
      const el = h(tag, { class: `input ${attrs.ltr ? 'ltr' : ''}`, ...attrs, ltr: null, value: val ?? '' });
      if (tag === 'textarea') el.value = val ?? '';
      el.addEventListener('input', () => this.set(path, attrs.type === 'number' ? Number(el.value) : el.value));
      return el;
    },
    renderBody() {
      const body = clear(this.root.querySelector('.set-body'));
      const d = this.draft;
      const card = (title, sub, ...kids) => h('div', { class: 'card set-section' }, h('h3', null, title), sub ? h('div', { class: 'card-sub' }, sub) : null, ...kids);

      if (this.section === 'appearance') {
        const color = path => {
          const val = path.split('.').reduce((o, k) => o[k], d);
          const text = h('input', { class: 'input ltr', value: val, style: { width: '110px' } });
          const pick = h('input', { type: 'color', value: val });
          pick.addEventListener('input', () => { text.value = pick.value; this.set(path, pick.value); });
          text.addEventListener('input', () => { if (/^#[0-9a-f]{6}$/i.test(text.value)) { pick.value = text.value; this.set(path, text.value); } });
          return h('div', { class: 'color-input' }, pick, text);
        };
        const texts = lang => h('div', null,
          ...[['title', 'כותרת'], ['subtitle', 'תת-כותרת'], ['greeting', 'הודעת פתיחה', 3], ['launcher', 'טקסט בכפתור (סגנון "גלולה")'], ['offline_title', 'כותרת כשלא זמינים'], ['offline_text', 'הודעה כשלא זמינים', 2]]
            .map(([k, l, rows]) => h('div', { class: 'field' }, h('label', { class: 'label' }, l), this.input(`texts.${lang}.${k}`, { rows, dir: lang === 'en' ? 'ltr' : 'rtl' }))));
        let tab = this.textTab || 'he';
        const textBox = h('div');
        const drawTexts = () => clear(textBox).append(texts(tab));
        drawTexts();
        body.append(h('div', { class: 'appearance' },
          h('div', null,
            card('מיתוג', 'הצבעים והמיקום של הצ׳אט באתר',
              h('div', { class: 'field' }, h('label', { class: 'label' }, 'שם העסק'), this.input('site_name')),
              h('div', { class: 'grid', style: { gridTemplateColumns: '1fr 1fr' } },
                h('div', { class: 'field' }, h('label', { class: 'label' }, 'צבע ראשי'), color('brand_color')),
                h('div', { class: 'field' }, h('label', { class: 'label' }, 'צבע משני (גרדיאנט)'), color('accent_color'))),
              h('div', { class: 'row', style: { gap: '8px', flexWrap: 'wrap', marginBottom: '16px' } },
                ...[['#00a862', '#0b3d25'], ['#3b82f6', '#1e3a8a'], ['#8b5cf6', '#4c1d95'], ['#ec4899', '#831843'], ['#f97316', '#7c2d12'], ['#0f172a', '#334155'], ['#14b8a6', '#134e4a']]
                  .map(([a, b]) => h('button', { title: a, style: { width: '34px', height: '34px', borderRadius: '10px', background: `linear-gradient(135deg, ${a}, ${b})`, boxShadow: d.brand_color === a ? '0 0 0 3px var(--surface), 0 0 0 5px ' + a : '' }, onclick: () => { this.set('brand_color', a); this.set('accent_color', b); this.renderBody(); } }))),
              this.row('מיקום', null, seg([['right', 'ימין'], ['left', 'שמאל']], d.position, v => this.set('position', v))),
              this.row('סגנון כפתור', null, seg([['bubble', 'עיגול'], ['pill', 'גלולה עם טקסט']], d.launcher_style, v => this.set('launcher_style', v))),
              this.row('שפה', 'אוטומטי = לפי שפת הדף שבו הצ׳אט מוטמע', seg([['auto', 'אוטומטי'], ['he', 'עברית'], ['en', 'English']], d.lang, v => this.set('lang', v))),
              this.row('הצגת הנציגים הזמינים', 'תמונות הנציגים המחוברים בראש החלון', switchEl(d.show_agents, v => this.set('show_agents', v)))),
            card('טקסטים', 'כל טקסט בשתי השפות',
              h('div', { style: { marginBottom: '14px' } }, seg([['he', 'עברית'], ['en', 'English']], tab, v => { tab = v; this.textTab = v; drawTexts(); })),
              textBox)),
          h('div', { class: 'preview-wrap' }, h('div', { class: 'label' }, 'תצוגה מקדימה'), h('div', { class: 'preview' }))));
        this.renderPreview();
      }

      if (this.section === 'prechat') {
        const mode = f => seg([['required', 'חובה'], ['optional', 'רשות'], ['hidden', 'לא לשאול']], d.prechat[f], v => this.set(`prechat.${f}`, v));
        const topics = h('input', { class: 'input', value: d.topics.join(', '), placeholder: 'מכירות, תמיכה טכנית, חשבונות' });
        topics.addEventListener('input', () => this.set('topics', topics.value.split(',').map(s => s.trim()).filter(Boolean)));
        body.append(
          card('טופס לפני תחילת שיחה', 'מה לשאול את הלקוח לפני שהשיחה מתחילה',
            this.row('הצגת טופס', 'כבוי = הלקוח מתחיל לכתוב מיד', switchEl(d.prechat.enabled, v => this.set('prechat.enabled', v, true))),
            d.prechat.enabled ? [this.row('שם', null, mode('name')), this.row('אימייל', 'מומלץ — כך נוכל לשלוח תשובות גם אחרי שהלקוח עוזב', mode('email')), this.row('טלפון', null, mode('phone'))] : null),
          card('נושאים / מחלקות', 'לא חובה. הלקוח יבחר נושא, ותוכלו לסנן לפיו',
            h('div', { class: 'field' }, h('label', { class: 'label' }, 'נושאים (מופרדים בפסיק)'), topics)),
          h('div', { class: 'alert info' }, 'כשאין נציגים זמינים הטופס מבקש תמיד מייל, כדי שתוכלו לחזור ללקוח.'));
      }

      if (this.section === 'availability') {
        body.append(
          card('זמינות', null,
            this.row('מצב', 'אוטומטי = הצ׳אט "מחובר" כשיש לפחות נציג זמין אחד (ובשעות הפעילות)',
              seg([['auto', 'אוטומטי'], ['offline', 'תמיד לא זמינים']], d.availability, v => this.set('availability', v)))),
          card('שעות פעילות', 'מחוץ לשעות האלה הצ׳אט יציג טופס השארת הודעה',
            this.row('הפעלת שעות פעילות', null, switchEl(d.hours.enabled, v => this.set('hours.enabled', v, true))),
            d.hours.enabled ? [
              h('div', { class: 'field', style: { marginTop: '12px' } }, h('label', { class: 'label' }, 'אזור זמן'), this.input('hours.tz', { ltr: true, dir: 'ltr' })),
              h('div', { class: 'hours-grid' },
                ...d.hours.days.flatMap((day, i) => [
                  h('b', null, DAY_NAMES[i]),
                  switchEl(day.on, v => this.set(`hours.days.${i}.on`, v, true)),
                  day.on ? this.input(`hours.days.${i}.from`, { type: 'time', dir: 'ltr' }) : h('span', { class: 'faint' }, 'סגור'),
                  day.on ? this.input(`hours.days.${i}.to`, { type: 'time', dir: 'ltr' }) : h('span'),
                ])),
            ] : null));
      }

      if (this.section === 'routing') {
        body.append(card('שיבוץ שיחות', 'איך שיחה חדשה מגיעה לנציג',
          h('div', { class: 'stack', style: { gap: '12px' } },
            ...[['manual', 'ידני', 'שיחות חדשות מחכות בתור "ממתינות", וכל נציג לוקח שיחה (או שמנהל מעביר).'], ['auto', 'אוטומטי (Round-robin)', 'כל שיחה משובצת לנציג הזמין הכי פנוי, לפי "מקסימום שיחות במקביל" של כל נציג.']]
              .map(([k, t, desc]) => h('label', { class: 'card', style: { cursor: 'pointer', display: 'flex', gap: '12px', borderColor: d.assignment === k ? 'var(--brand)' : '', boxShadow: d.assignment === k ? '0 0 0 3px var(--brand-soft)' : '' } },
                h('input', { type: 'radio', name: 'assign', checked: d.assignment === k, onchange: () => this.set('assignment', k, true), style: { accentColor: 'var(--brand)', marginTop: '4px' } }),
                h('div', null, h('b', null, t), h('div', { class: 'muted' }, desc)))))));
      }

      if (this.section === 'notifications') {
        const test = h('button', {
          class: 'btn', onclick: async () => {
            try { const r = await api('a/test-email', { method: 'POST' }); toast({ title: r.dev ? 'מצב פיתוח — המייל רק נרשם בלוג' : `נשלח מייל בדיקה ל-${S.me.email}` }); } catch (e) { toastError(e); }
          },
        }, icon('send'), 'שליחת מייל בדיקה');
        body.append(
          !S.emailConfigured ? h('div', { class: 'alert', style: { marginBottom: '16px' } }, 'המיילים לא מוגדרים — הוסיפו את הסוד RESEND_API_KEY ל-Worker (ראו README).') : null,
          card('התראות לצוות', 'נשלחות לכל נציג שהפעיל "התראות במייל" בפרופיל',
            this.row('שיחה חדשה כשאף אחד לא מחובר', 'כולל הודעות שהושארו מחוץ לשעות הפעילות', switchEl(d.notify.offline_emails, v => this.set('notify.offline_emails', v))),
            this.row('שיחה שממתינה למענה', 'דקות עד שנשלחת תזכורת לנציגים שלא מחוברים (0 = כבוי)', h('div', { style: { width: '90px' } }, this.input('notify.unanswered_minutes', { type: 'number', min: 0, max: 1440 }))),
            h('div', { class: 'field', style: { marginTop: '14px' } }, h('label', { class: 'label' }, 'כתובות נוספות לקבלת התראות'), this.input('notify.extra_emails', { ltr: true, dir: 'ltr', placeholder: 'boss@example.com, support@example.com' }))),
          card('התראות ללקוחות', null,
            this.row('תשובה שהלקוח לא ראה', 'אם הלקוח עזב את האתר ויש לו מייל — נשלח לו את התשובה אחרי X דקות (0 = כבוי)', h('div', { style: { width: '90px' } }, this.input('notify.visitor_reply_minutes', { type: 'number', min: 0, max: 1440 })))),
          h('div', { class: 'row', style: { gap: '10px' } }, test, h('button', { class: 'btn ghost', onclick: () => this.emailLog() }, icon('history'), 'יומן מיילים')));
      }

      if (this.section === 'behavior') {
        body.append(card('התנהגות הצ׳אט', null,
          this.row('דירוג שירות בסוף שיחה', 'הלקוח מתבקש לדרג 1-5 כוכבים', switchEl(d.rating, v => this.set('rating', v))),
          this.row('שליחת תמליל ללקוח', 'הלקוח יכול לבקש את השיחה במייל', switchEl(d.transcript, v => this.set('transcript', v))),
          this.row('צירוף קבצים ותמונות', 'עד 1.5MB לקובץ', switchEl(d.attachments, v => this.set('attachments', v))),
          this.row('צלילי התראה ללקוח', null, switchEl(d.sound, v => this.set('sound', v))),
          this.row('מעקב מבקרים בזמן אמת', 'רשימת "מבקרים באתר", מסלול הדפים ותצוגה מקדימה של מה שהלקוח מקליד', switchEl(d.track_visitors, v => this.set('track_visitors', v))),
          this.row('סגירה אוטומטית', 'שעות ללא פעילות עד שהשיחה נסגרת (0 = אף פעם)', h('div', { style: { width: '90px' } }, this.input('auto_close_hours', { type: 'number', min: 0, max: 720 })))));
      }

      if (this.section === 'payments') {
        const ok = S.integrations.pay;
        body.append(
          h('div', { class: `alert ${ok ? 'ok' : ''}`, style: { marginBottom: '16px' } }, ok
            ? '✓ מחובר ל-login.reembir.com — נציגים עם הרשאה יכולים לשלוח בקשות תשלום ולשדרג חשבונות מתוך השיחה.'
            : 'עוד לא מחובר ל-login.reembir.com. צריך סוד משותף אחד בשני ה-Workers (הוראות למטה).'),
          card('ברירות מחדל לבקשת תשלום', null,
            this.row('מטבע', null, seg([['ILS', '₪ שקל'], ['USD', '$ דולר'], ['EUR', '€ אירו']], d.payments.currency, v => this.set('payments.currency', v))),
            this.row('תוקף', 'ימים עד שהבקשה פגה (0 = ללא תפוגה). הנציג יכול לשנות בכל בקשה, בגבולות ההרשאה שלו', h('div', { style: { width: '90px' } }, this.input('payments.default_days', { type: 'number', min: 0, max: 365 })))),
          card('איך זה עובד', null,
            h('ul', { class: 'how' },
              h('li', null, 'בשיחה, לוחצים על ', icon('card', 14), ' ליד שדה הכתיבה. הלקוח מקבל בצ׳אט כרטיס עם הסכום וכפתור לתשלום (ואפשר לשלוח גם במייל).'),
              h('li', null, 'כדי לשלם הלקוח חייב להתחבר לחשבון reem.bi — עם המייל שהזנתם, או החשבון שבחרתם.'),
              h('li', null, 'אפשר לצרף שדרוג אוטומטי: חשבון ← אתר ← תוכנית. ברגע שמשלמים, החשבון משודרג לבד. או לשדרג ידנית מכרטיס הלקוח (', icon('rocket', 14), ' שדרוג חשבון).'),
              h('li', null, 'הרשאות לנציגים — בעמוד "צוות" (קבועות / עד תאריך / רק בשיחות שלהם / סכום ותוקף מקסימליים), או לשיחה אחת מתפריט השיחה.'))),
          !ok ? card('חיבור (פעם אחת)', null,
            h('ol', { class: 'how' },
              h('li', null, 'בחרו סיסמה ארוכה ואקראית (למשל מ-', h('a', { href: 'https://1password.com/password-generator', target: '_blank', rel: 'noopener' }, 'מחולל סיסמאות'), ').'),
              h('li', null, 'ב-Cloudflare, ב-Worker ', h('b', null, 'reem-chat'), ': Settings → Variables and Secrets → סוד בשם ', h('code', null, 'SSO_SERVICE_KEY'), ' עם הסיסמה.'),
              h('li', null, 'ב-Worker ', h('b', null, 'reem-sso'), ': סוד בשם ', h('code', null, 'CHAT_SERVICE_KEY'), ' עם אותה סיסמה בדיוק.'),
              h('li', null, 'רעננו את הדף.'))) : null);
      }

      if (this.section === 'translation') {
        const ig = S.integrations;
        const key = h('input', { class: 'input ltr', type: 'password', autocomplete: 'off', placeholder: ig.gemini_key ? `שמור: ${ig.gemini_hint}` : 'AIza…' });
        const saveKey = async remove => {
          try {
            const r = await api('a/gemini', { method: 'PUT', body: { key: remove ? '' : key.value.trim() } });
            S.integrations = r.integrations; key.value = '';
            toast({ title: remove ? 'המפתח נמחק' : 'המפתח נשמר ✓' });
            this.renderBody();
          } catch (e) { toastError(e); }
        };
        const test = h('button', {
          class: 'btn', onclick: async () => {
            test.disabled = true;
            try { const r = await api('a/gemini/test', { method: 'POST' }); toast({ title: 'Gemini עובד ✓', text: `זיהוי שפה: ${r.lang} · תרגום: ${r.sample}`, ms: 8000 }); } catch (e) { toastError(e); }
            test.disabled = false;
          },
        }, icon('play'), 'בדיקה');
        body.append(
          card('תרגום אוטומטי בין הלקוח לנציג', 'עם Gemini של Google',
            this.row('הפעלה', 'כל הודעה של לקוח עוברת לזיהוי שפה. התשובה הראשונה של הנציג מזהה את השפה שלו. שפות שונות → מתרגמים בשני הכיוונים; אותה שפה → אין תרגום ואין AI בשיחה הזו.',
              switchEl(d.translation.enabled, v => this.set('translation.enabled', v))),
            h('div', { class: 'field', style: { marginTop: '14px' } }, h('label', { class: 'label' }, 'מודל'), this.input('translation.model', { ltr: true, dir: 'ltr', placeholder: 'gemini-flash-latest' }),
              h('div', { class: 'hint' }, 'ברירת המחדל gemini-flash-latest מתעדכנת לבד לגרסת ה-Flash האחרונה.'))),
          card('מפתח API של Gemini', null,
            h('div', { class: 'hint', style: { marginBottom: '10px' } }, 'יוצרים מפתח בחינם ב-', h('a', { href: 'https://aistudio.google.com/apikey', target: '_blank', rel: 'noopener' }, 'Google AI Studio'), '. המפתח נשמר בשרת ולא נשלח לנציגים או לדפדפן.'),
            ig.gemini_from_env ? h('div', { class: 'alert info', style: { marginBottom: '10px' } }, 'כרגע בשימוש המפתח מהסוד GEMINI_API_KEY. מפתח שתשמרו כאן יקבל עדיפות.') : null,
            h('div', { class: 'row', style: { gap: '8px' } }, key,
              h('button', { class: 'btn primary', onclick: () => saveKey(false) }, icon('key'), 'שמירה'),
              ig.gemini_key && !ig.gemini_from_env ? h('button', { class: 'btn', onclick: () => saveKey(true) }, icon('trash')) : null,
              ig.gemini_key ? test : null)),
          h('div', { class: 'alert info' }, 'בתוך שיחה: התג 🌐 בראש השיחה מראה את מצב התרגום. נציג עם הרשאת "שליטה בתרגום" (עמוד צוות) יכול להפעיל/לכבות ולבחור שפות ידנית. שפת הלקוח נשמרת גם בכרטיס שלו.'));
      }

      if (this.section === 'install') {
        const snippet = `<script src="${location.origin}/widget.js" async></script>`;
        const api = `<script>
  // לפתוח את הצ'אט מכפתור שלכם:
  document.querySelector('#help-btn').onclick = () => ReemChat.open();

  // משתמש מחובר? להעביר את הפרטים שלו:
  ReemChat.identify({ name: 'ישראל ישראלי', email: 'israel@example.com' });
</script>`;
        const codeBlock = text => h('div', { class: 'code' }, text, h('button', { class: 'btn sm copy', onclick: () => { navigator.clipboard.writeText(text); toast({ title: 'הועתק ללוח' }); } }, icon('copy'), 'העתקה'));
        body.append(
          card('התקנה', 'מדביקים את השורה הזו לפני </body> בכל דף שבו רוצים את הצ׳אט', codeBlock(snippet),
            h('div', { class: 'row', style: { marginTop: '14px', gap: '10px' } },
              h('a', { class: 'btn', href: '/demo/', target: '_blank' }, icon('play'), 'דף הדגמה'))),
          card('אפשרויות מתקדמות', null,
            h('div', { class: 'hint', style: { marginBottom: '10px' } }, 'מאפיינים על תגית ה-script: ', h('code', null, 'data-lang="he|en"'), ' · ', h('code', null, 'data-position="left|right"'), ' · ', h('code', null, 'data-hide-launcher')),
            codeBlock(api),
            h('div', { class: 'hint', style: { marginTop: '10px' } }, 'קישור עם ', h('code', null, '?chat=open'), ' פותח את הצ׳אט אוטומטית.')));
      }

      if (this.section === 'security') {
        const origins = h('textarea', { class: 'input ltr', rows: 4, dir: 'ltr', placeholder: 'https://reembir.com\nhttps://www.reembir.com' }, d.allowed_origins.join('\n'));
        origins.addEventListener('input', () => this.set('allowed_origins', origins.value.split(/[\s,]+/).filter(Boolean)));
        body.append(card('אתרים מורשים', 'רק האתרים האלה יוכלו להציג את הצ׳אט. ריק = כל אתר', origins,
          h('div', { class: 'hint' }, 'כתובת מלאה עם https:// ובלי / בסוף, שורה לכל אתר.')));
      }
    },

    renderPreview() {
      const box = this.root.querySelector('.preview');
      if (!box) return;
      const d = this.draft;
      const t = d.texts[d.lang === 'en' ? 'en' : 'he'];
      const grad = `linear-gradient(135deg, ${d.brand_color}, ${d.accent_color})`;
      const dir = d.lang === 'en' ? 'ltr' : 'rtl';
      clear(box).append(
        h('div', { class: 'w-preview', dir },
          h('div', { class: 'wp-head', style: { background: grad } }, h('h4', null, t.title), h('p', null, h('span', { style: { width: '8px', height: '8px', borderRadius: '50%', background: '#4ade80', display: 'inline-block' } }), t.subtitle)),
          h('div', { class: 'wp-body' },
            h('div', { class: 'wp-bubble' }, t.greeting),
            h('div', { class: 'wp-me' }, h('span', { style: { background: d.brand_color } }, dir === 'rtl' ? 'היי, יש לי שאלה 🙂' : 'Hi, I have a question 🙂')))),
        h('div', { style: { textAlign: d.position === 'left' ? 'left' : 'right' }, dir: 'ltr' },
          h('div', { class: `wp-launcher ${d.launcher_style === 'pill' ? 'pill' : ''}`, style: { background: grad, display: d.launcher_style === 'pill' ? 'inline-flex' : 'inline-grid' } },
            icon('logo'), d.launcher_style === 'pill' ? h('span', null, t.launcher) : null)));
    },

    async emailLog() {
      let d;
      try { d = await api('a/emails'); } catch (e) { return toastError(e); }
      const kinds = { reset: 'איפוס סיסמה', invite: 'הזמנה', newChat: 'שיחה חדשה', offline: 'הודעה אופליין', whisper: 'תיוג', assigned: 'העברה', visitor_reply: 'תשובה ללקוח', transcript: 'תמליל', test: 'בדיקה' };
      modal({
        title: 'יומן מיילים', wide: true,
        body: d.emails.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
          h('thead', null, h('tr', null, ['סוג', 'נמען', 'נושא', 'סטטוס', 'מתי'].map(t => h('th', null, t)))),
          h('tbody', null, d.emails.map(e => h('tr', null,
            h('td', null, kinds[e.kind] || e.kind), h('td', { class: 'ltr' }, e.recipient), h('td', { class: 'ellipsis', style: { maxWidth: '200px' } }, e.subject),
            h('td', null, h('span', { class: `badge ${e.status === 'sent' ? 'brand' : e.status === 'failed' ? 'danger' : ''}` }, { sent: 'נשלח', failed: 'נכשל', dev: 'פיתוח' }[e.status])),
            h('td', { class: 'muted' }, ago(e.created_at))))))) : emptyState('mail', 'עוד לא נשלחו מיילים', ''),
        foot: close => h('button', { class: 'btn', onclick: close }, 'סגירה'),
      });
    },
  };
})();
