/*!
 * reem.bi chat widget — https://chat.reembir.com
 *
 *   <script src="https://chat.reembir.com/widget.js" async></script>
 *
 * Optional attributes on the script tag:
 *   data-lang="he|en"         force a language (default: from the admin settings / the page)
 *   data-position="left|right"
 *   data-hide-launcher        hide the floating button (open it yourself with ReemChat.open())
 *
 * JavaScript API (available after load):
 *   ReemChat.open() · ReemChat.close() · ReemChat.toggle()
 *   ReemChat.identify({ name, email, phone })
 *   ReemChat.on('message' | 'open' | 'close' | 'ready', fn)
 */
(function () {
  'use strict';
  if (window.ReemChat && window.ReemChat.__loaded) return;

  var script = document.currentScript || document.querySelector('script[src*="widget.js"]');
  var BASE = (script && script.src ? new URL(script.src) : new URL(location.href)).origin;
  var ATTR = function (n) { return script ? script.getAttribute('data-' + n) : null; };
  var LS_TOKEN = 'reemchat_token';
  var SS_OPEN = 'reemchat_open';

  // ---------------------------------------------------------------------------
  // Text
  // ---------------------------------------------------------------------------
  var I18N = {
    he: {
      dir: 'rtl', placeholder: 'כתבו הודעה…', send: 'שליחה', name: 'שם', email: 'אימייל', phone: 'טלפון',
      optional: 'לא חובה', start: 'התחלת שיחה', leave: 'שליחת הודעה', message: 'במה נוכל לעזור?', topic: 'בחרו נושא',
      online: 'מחוברים עכשיו', away: 'לא זמינים כרגע', seen: 'נקרא', sending: 'שולח…', failed: 'לא נשלח · לחצו לנסות שוב',
      ended: 'השיחה הסתיימה', rateTitle: 'איך היה השירות?', rateThanks: 'תודה על הדירוג! 💚', comment: 'רוצים להוסיף משהו? (לא חובה)',
      submit: 'שליחה', newChat: 'התחלת שיחה חדשה', transcript: 'שליחת תמליל השיחה למייל', endChat: 'סיום השיחה',
      endConfirm: 'לסיים את השיחה?', yes: 'כן, לסיים', no: 'ביטול', soundOn: 'הפעלת צלילים', soundOff: 'השתקת צלילים',
      joined: '{name} הצטרף/ה לשיחה', transferred: 'השיחה הועברה ל{name}', typing: '{name} מקליד/ה', team: 'הצוות',
      offlineSent: 'קיבלנו את ההודעה! נחזור אליכם בהקדם למייל {email}.', offlineSentNoEmail: 'קיבלנו את ההודעה! נחזור אליכם בהקדם.',
      attach: 'צירוף קובץ', emoji: 'אימוג׳י', tooBig: 'הקובץ גדול מדי (עד 1.5MB)', powered: 'צ׳אט מאובטח · reem.bi',
      today: 'היום', yesterday: 'אתמול', reconnecting: 'מתחבר מחדש…', required: 'שדה חובה', badEmail: 'כתובת מייל לא תקינה',
      transcriptSent: 'התמליל נשלח ל-{email} ✓', yourEmail: 'כתובת המייל שלך', close: 'סגירה', menu: 'אפשרויות', open: 'פתיחת הצ׳אט',
      replyTime: 'בדרך כלל עונים תוך כמה דקות', you: 'את/ה', error: 'משהו השתבש, נסו שוב',
    },
    en: {
      dir: 'ltr', placeholder: 'Write a message…', send: 'Send', name: 'Name', email: 'Email', phone: 'Phone',
      optional: 'optional', start: 'Start chat', leave: 'Send message', message: 'How can we help?', topic: 'Choose a topic',
      online: 'Online now', away: 'Away right now', seen: 'Seen', sending: 'Sending…', failed: 'Not sent · tap to retry',
      ended: 'This chat has ended', rateTitle: 'How did we do?', rateThanks: 'Thanks for the feedback! 💚', comment: 'Anything to add? (optional)',
      submit: 'Submit', newChat: 'Start a new chat', transcript: 'Email me the transcript', endChat: 'End chat',
      endConfirm: 'End this chat?', yes: 'Yes, end it', no: 'Cancel', soundOn: 'Turn sounds on', soundOff: 'Mute sounds',
      joined: '{name} joined the chat', transferred: 'You were transferred to {name}', typing: '{name} is typing', team: 'The team',
      offlineSent: "Got it! We'll get back to you at {email} soon.", offlineSentNoEmail: "Got it! We'll get back to you soon.",
      attach: 'Attach a file', emoji: 'Emoji', tooBig: 'File is too large (max 1.5MB)', powered: 'Secure chat · reem.bi',
      today: 'Today', yesterday: 'Yesterday', reconnecting: 'Reconnecting…', required: 'Required', badEmail: 'Invalid email',
      transcriptSent: 'Transcript sent to {email} ✓', yourEmail: 'Your email', close: 'Close', menu: 'Options', open: 'Open chat',
      replyTime: 'We usually reply in a few minutes', you: 'You', error: 'Something went wrong, please try again',
    },
  };

  var EMOJI = ['😀', '😂', '😊', '😍', '🙏', '👍', '👌', '👏', '🎉', '❤️', '💚', '🔥', '🤔', '😅', '😢', '😮', '🙌', '✅', '❌', '⭐', '👋', '💡', '📦', '📞'];

  var ICON = {
    chat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 9.3 9.3 0 0 1-3.8-.8L3 21l1.9-5A8.4 8.4 0 0 1 12 3a8.5 8.5 0 0 1 9 8.5z"/><path d="M8 11h.01M12 11h.01M16 11h.01" stroke-width="2.6"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>',
    down: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>',
    send: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3.4 20.4 21 12 3.4 3.6l-.1 6.5L15 12 3.3 13.9z"/></svg>',
    clip: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.4 11.1-9.2 9.2a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.8-2.8l8.5-8.5"/></svg>',
    smile: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01"/></svg>',
    dots: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>',
    star: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>',
    mail: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 6L2 7"/></svg>',
    bell: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.9 1.9 0 0 0 3.4 0"/></svg>',
    exit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/></svg>',
    file: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>',
    arrow: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
  };

  // ---------------------------------------------------------------------------
  // Styles (inside a shadow root, so the host page can't break them)
  // ---------------------------------------------------------------------------
  var CSS = [
    ':host{all:initial}',
    '*{box-sizing:border-box;margin:0;padding:0;font-family:"Rubik",system-ui,-apple-system,"Segoe UI",Arial,sans-serif}',
    '.root{--brand:#00a862;--accent:#0b3d25;--ink:#14201a;--muted:#6b7b73;--line:#e6ebe8;--bg:#f6f8f7;--card:#fff;position:fixed;bottom:20px;z-index:2147483000;font-size:15px;color:var(--ink);line-height:1.45;-webkit-font-smoothing:antialiased}',
    '.root.right{right:20px}.root.left{left:20px}',
    'button{font:inherit;color:inherit;background:none;border:0;cursor:pointer}',
    'button:focus-visible,input:focus-visible,textarea:focus-visible{outline:2px solid var(--brand);outline-offset:2px}',

    /* launcher */
    '.launcher{position:relative;height:62px;min-width:62px;border-radius:31px;background:linear-gradient(135deg,var(--brand),var(--accent));color:#fff;display:flex;align-items:center;justify-content:center;gap:10px;box-shadow:0 10px 30px -6px color-mix(in srgb,var(--brand) 60%,transparent),0 4px 12px rgba(0,0,0,.15);transition:transform .25s cubic-bezier(.34,1.56,.64,1),box-shadow .25s;animation:pop .5s cubic-bezier(.34,1.56,.64,1) both}',
    '.launcher:hover{transform:scale(1.06) translateY(-2px)}',
    '.launcher .ic{width:28px;height:28px;display:grid;place-items:center;transition:transform .35s cubic-bezier(.34,1.56,.64,1),opacity .2s;position:absolute}',
    '.launcher .ic svg{width:28px;height:28px}',
    '.launcher .ic.x{opacity:0;transform:rotate(-90deg) scale(.5)}',
    '.open .launcher .ic.c{opacity:0;transform:rotate(90deg) scale(.5)}',
    '.open .launcher .ic.x{opacity:1;transform:none}',
    '.launcher.pill{padding:0 22px 0 20px}.launcher.pill .ic{position:static}.launcher.pill .ic.x{display:none}',
    '.launcher .lbl{font-weight:600;font-size:15px;white-space:nowrap}',
    '.open .launcher.pill{padding:0;width:62px}.open .launcher.pill .lbl,.open .launcher.pill .ic.c{display:none}.open .launcher.pill .ic.x{display:grid}',
    '.badge{position:absolute;top:-4px;inset-inline-end:-4px;min-width:22px;height:22px;padding:0 6px;border-radius:11px;background:#ff3b5c;color:#fff;font-size:12px;font-weight:700;display:grid;place-items:center;border:2.5px solid #fff;animation:pop .4s cubic-bezier(.34,1.56,.64,1)}',
    '.hide{display:none!important}',

    /* teaser */
    '.teaser{position:absolute;bottom:76px;width:260px;background:var(--card);border-radius:18px;padding:14px 16px;box-shadow:0 12px 40px -8px rgba(0,0,0,.25);cursor:pointer;animation:rise .5s cubic-bezier(.34,1.56,.64,1) both;font-size:14.5px}',
    '.right .teaser{right:0}.left .teaser{left:0}',
    '.teaser .x{position:absolute;top:-8px;inset-inline-start:-8px;width:24px;height:24px;border-radius:50%;background:#fff;box-shadow:0 2px 8px rgba(0,0,0,.2);display:grid;place-items:center;color:var(--muted)}',
    '.teaser .x svg{width:12px;height:12px}',
    '.teaser .who{display:flex;align-items:center;gap:8px;margin-bottom:6px;font-size:12.5px;color:var(--muted)}',

    /* panel */
    '.panel{position:absolute;bottom:78px;width:390px;height:min(640px,calc(100vh - 110px));background:var(--bg);border-radius:22px;overflow:hidden;display:flex;flex-direction:column;box-shadow:0 24px 70px -12px rgba(8,30,20,.35),0 0 0 1px rgba(0,0,0,.04);transform-origin:bottom right;transform:scale(.9) translateY(16px);opacity:0;pointer-events:none;transition:transform .32s cubic-bezier(.34,1.3,.64,1),opacity .2s}',
    '.right .panel{right:0}.left .panel{left:0;transform-origin:bottom left}',
    '.open .panel{transform:none;opacity:1;pointer-events:auto}',

    /* header */
    '.head{position:relative;background:linear-gradient(135deg,var(--brand) 0%,var(--accent) 100%);color:#fff;padding:18px 18px 22px;flex-shrink:0;overflow:hidden}',
    '.head:before{content:"";position:absolute;width:220px;height:220px;border-radius:50%;background:rgba(255,255,255,.08);top:-120px;inset-inline-end:-60px}',
    '.head:after{content:"";position:absolute;width:140px;height:140px;border-radius:50%;background:rgba(255,255,255,.06);bottom:-90px;inset-inline-start:30px}',
    '.head-row{position:relative;z-index:1;display:flex;align-items:center;gap:12px}',
    '.head h2{font-size:18px;font-weight:700;letter-spacing:-.2px}',
    '.head p{font-size:13px;opacity:.85;margin-top:2px;display:flex;align-items:center;gap:6px}',
    '.dot{width:8px;height:8px;border-radius:50%;background:#4ade80;box-shadow:0 0 0 3px rgba(74,222,128,.3);flex-shrink:0}',
    '.dot.off{background:#fbbf24;box-shadow:0 0 0 3px rgba(251,191,36,.3)}',
    '.head .grow{flex:1;min-width:0}',
    '.hbtn{width:34px;height:34px;border-radius:10px;display:grid;place-items:center;color:#fff;opacity:.9;transition:background .15s}',
    '.hbtn:hover{background:rgba(255,255,255,.15);opacity:1}.hbtn svg{width:20px;height:20px}',
    '.avatars{display:flex;flex-direction:row-reverse;justify-content:flex-end}',
    '.av{width:38px;height:38px;border-radius:50%;display:grid;place-items:center;font-weight:700;font-size:14px;color:#fff;border:2.5px solid rgba(255,255,255,.9);flex-shrink:0;position:relative;text-transform:uppercase}',
    '.avatars .av{margin-inline-start:-10px}.avatars .av:last-child{margin-inline-start:0}',
    '.av.sm{width:28px;height:28px;font-size:11.5px;border-width:2px;border-color:#fff}',
    '.av.team{background:rgba(255,255,255,.2);backdrop-filter:blur(4px)}.av.team svg{width:20px;height:20px}',
    '.conn{position:relative;z-index:1;margin-top:10px;font-size:12px;background:rgba(0,0,0,.18);border-radius:8px;padding:4px 10px;display:inline-block}',

    /* menu */
    '.menu{position:absolute;top:62px;inset-inline-end:14px;z-index:5;background:var(--card);border-radius:14px;box-shadow:0 12px 36px -6px rgba(0,0,0,.25);padding:6px;min-width:230px;animation:rise .2s ease both}',
    '.menu button{display:flex;align-items:center;gap:10px;width:100%;padding:10px 12px;border-radius:9px;font-size:14px;text-align:start;color:var(--ink)}',
    '.menu button:hover{background:var(--bg)}.menu svg{width:18px;height:18px;color:var(--muted)}',
    '.menu .danger,.menu .danger svg{color:#e11d48}',

    /* body */
    '.body{flex:1;overflow-y:auto;overflow-x:hidden;padding:18px 16px 8px;scroll-behavior:smooth;overscroll-behavior:contain}',
    '.body::-webkit-scrollbar{width:6px}.body::-webkit-scrollbar-thumb{background:#cfd8d3;border-radius:3px}',

    /* welcome / form */
    '.card{background:var(--card);border-radius:18px;padding:18px;box-shadow:0 1px 3px rgba(0,0,0,.05),0 6px 20px -8px rgba(0,0,0,.08);animation:rise .4s ease both}',
    '.greet{font-size:15.5px;line-height:1.55;margin-bottom:16px;white-space:pre-wrap}',
    '.greet-title{font-size:19px;font-weight:700;margin-bottom:6px}',
    '.field{margin-bottom:12px}',
    '.field label{display:block;font-size:12.5px;font-weight:600;color:var(--muted);margin-bottom:5px}',
    '.field label i{font-style:normal;font-weight:400;opacity:.8}',
    '.input{width:100%;border:1.5px solid var(--line);border-radius:12px;padding:11px 13px;font-size:15px;background:#fbfcfb;color:var(--ink);transition:border-color .15s,box-shadow .15s,background .15s;resize:none}',
    '.input:focus{outline:0;border-color:var(--brand);background:#fff;box-shadow:0 0 0 4px color-mix(in srgb,var(--brand) 15%,transparent)}',
    '.input.err{border-color:#e11d48}',
    '.errmsg{color:#e11d48;font-size:12px;margin-top:4px}',
    '.chips{display:flex;flex-wrap:wrap;gap:8px}',
    '.chip{border:1.5px solid var(--line);border-radius:20px;padding:7px 14px;font-size:13.5px;background:#fff;transition:all .15s}',
    '.chip:hover{border-color:var(--brand)}.chip.on{background:var(--brand);border-color:var(--brand);color:#fff}',
    '.btn{width:100%;display:flex;align-items:center;justify-content:center;gap:8px;background:linear-gradient(135deg,var(--brand),color-mix(in srgb,var(--brand) 70%,var(--accent)));color:#fff;font-weight:600;font-size:15.5px;padding:13px;border-radius:13px;margin-top:6px;transition:transform .15s,box-shadow .15s,opacity .15s;box-shadow:0 6px 18px -6px color-mix(in srgb,var(--brand) 70%,transparent)}',
    '.btn:hover{transform:translateY(-1px)}.btn:disabled{opacity:.6;cursor:default;transform:none}',
    '.btn svg{width:18px;height:18px}[dir=rtl] .btn svg{transform:scaleX(-1)}',
    '.btn.ghost{background:#fff;color:var(--ink);border:1.5px solid var(--line);box-shadow:none}',

    /* messages */
    '.day{text-align:center;margin:14px 0 10px;font-size:11.5px;color:var(--muted);font-weight:600;letter-spacing:.3px}',
    '.row{display:flex;align-items:flex-end;gap:8px;margin-bottom:3px;animation:msgin .28s cubic-bezier(.34,1.3,.64,1) both}',
    '.row.me{flex-direction:row-reverse}',
    '.row .av.sm{visibility:hidden}.row.last .av.sm{visibility:visible}',
    '.stack{display:flex;flex-direction:column;max-width:78%;min-width:0}',
    '.me .stack{align-items:flex-end}',
    '.sender{font-size:11.5px;color:var(--muted);margin:8px 6px 3px;font-weight:600}',
    '.bubble{padding:10px 14px;border-radius:18px;font-size:14.8px;line-height:1.5;white-space:pre-wrap;word-wrap:break-word;overflow-wrap:anywhere;background:var(--card);box-shadow:0 1px 2px rgba(0,0,0,.06);border-end-start-radius:6px}',
    '.me .bubble{background:linear-gradient(135deg,var(--brand),color-mix(in srgb,var(--brand) 78%,var(--accent)));color:#fff;border-end-start-radius:18px;border-end-end-radius:6px}',
    '.bubble a{color:inherit;text-decoration:underline;text-underline-offset:2px}',
    '.bubble.img{padding:4px;background:var(--card)!important}.bubble.img img{display:block;max-width:220px;max-height:240px;border-radius:14px;cursor:zoom-in}',
    '.bubble.filebox{display:flex;align-items:center;gap:10px;text-decoration:none}.bubble.filebox svg{width:22px;height:22px;flex-shrink:0}',
    '.bubble.emoji-only{background:none!important;box-shadow:none;font-size:34px;padding:0 4px;line-height:1.2}',
    '.meta{font-size:11px;color:var(--muted);margin:3px 8px 6px;display:flex;align-items:center;gap:4px}',
    '.meta svg{width:13px;height:13px;color:var(--brand)}',
    '.meta.fail{color:#e11d48;cursor:pointer}',
    '.pending .bubble{opacity:.65}',
    '.event{text-align:center;margin:12px 0;animation:rise .3s ease both}',
    '.event span{display:inline-flex;align-items:center;gap:6px;font-size:12.5px;color:var(--muted);background:rgba(0,0,0,.04);padding:5px 12px;border-radius:20px}',
    '.typing{display:flex;align-items:flex-end;gap:8px;margin:6px 0 8px}',
    '.typing .bubble{display:flex;gap:4px;padding:14px 16px}',
    '.typing i{width:7px;height:7px;border-radius:50%;background:#9fb0a7;animation:blink 1.3s infinite both}',
    '.typing i:nth-child(2){animation-delay:.18s}.typing i:nth-child(3){animation-delay:.36s}',

    /* ended / rating */
    '.ended{margin:14px 0 6px}',
    '.ended h3{font-size:16px;font-weight:700;text-align:center;margin-bottom:4px}',
    '.ended p{text-align:center;color:var(--muted);font-size:13.5px;margin-bottom:12px}',
    '.stars{display:flex;justify-content:center;gap:6px;margin:8px 0 12px;direction:ltr}',
    '.stars button{width:40px;height:40px;color:#d9e0dc;transition:transform .15s,color .15s}',
    '.stars button svg{width:36px;height:36px}.stars button:hover{transform:scale(1.18)}',
    '.stars button.on{color:#fbbf24}',
    '.success{display:flex;align-items:center;gap:10px;justify-content:center;color:var(--brand);font-weight:600;padding:6px}',

    /* composer */
    '.foot{padding:10px 12px 8px;background:var(--bg);flex-shrink:0}',
    '.composer{display:flex;align-items:flex-end;gap:4px;background:var(--card);border-radius:18px;padding:6px 6px 6px 6px;box-shadow:0 1px 3px rgba(0,0,0,.05),0 4px 16px -8px rgba(0,0,0,.12);border:1.5px solid transparent;transition:border-color .15s}',
    '.composer:focus-within{border-color:color-mix(in srgb,var(--brand) 45%,transparent)}',
    '.composer textarea{flex:1;border:0;outline:0;resize:none;font-size:15px;line-height:1.45;padding:8px 6px;max-height:120px;min-height:22px;background:transparent;color:var(--ink)}',
    '.cbtn{width:36px;height:36px;border-radius:12px;display:grid;place-items:center;color:var(--muted);flex-shrink:0;transition:background .15s,color .15s}',
    '.cbtn:hover{background:var(--bg);color:var(--ink)}.cbtn svg{width:21px;height:21px}',
    '.sendbtn{background:var(--brand);color:#fff;transform:scale(.85);opacity:.4;transition:all .2s cubic-bezier(.34,1.56,.64,1)}',
    '.sendbtn.ready{transform:none;opacity:1}.sendbtn:hover{background:var(--brand);color:#fff;filter:brightness(1.08)}',
    '[dir=rtl] .sendbtn svg{transform:scaleX(-1)}',
    '.emojis{display:grid;grid-template-columns:repeat(8,1fr);gap:2px;background:var(--card);border-radius:14px;padding:8px;margin-bottom:8px;box-shadow:0 4px 16px -6px rgba(0,0,0,.15);animation:rise .2s ease both}',
    '.emojis button{font-size:22px;height:38px;border-radius:9px;transition:background .1s,transform .1s}.emojis button:hover{background:var(--bg);transform:scale(1.15)}',
    '.brandline{text-align:center;font-size:11px;color:#9fb0a7;padding-top:7px;letter-spacing:.2px}',
    '.brandline b{color:var(--muted)}',

    /* toast + lightbox */
    '.toast{position:absolute;bottom:90px;left:50%;transform:translateX(-50%);background:var(--ink);color:#fff;padding:9px 16px;border-radius:12px;font-size:13.5px;z-index:9;animation:rise .25s ease both;white-space:nowrap;max-width:90%;overflow:hidden;text-overflow:ellipsis}',
    '.lightbox{position:fixed;inset:0;background:rgba(0,0,0,.85);display:grid;place-items:center;z-index:10;cursor:zoom-out;animation:fade .2s}',
    '.lightbox img{max-width:92vw;max-height:92vh;border-radius:12px}',
    '.confirm{position:absolute;inset:0;background:rgba(10,25,18,.45);backdrop-filter:blur(3px);z-index:8;display:grid;place-items:center;padding:24px;animation:fade .2s}',
    '.confirm .card{width:100%;text-align:center}.confirm h3{font-size:17px;margin-bottom:14px}',
    '.confirm .btns{display:flex;gap:8px}.confirm .btn{margin:0}',
    '.btn.danger{background:#e11d48;box-shadow:none}',

    '@keyframes pop{from{transform:scale(0)}to{transform:scale(1)}}',
    '@keyframes rise{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}',
    '@keyframes fade{from{opacity:0}to{opacity:1}}',
    '@keyframes msgin{from{opacity:0;transform:translateY(8px) scale(.97)}to{opacity:1;transform:none}}',
    '@keyframes blink{0%,80%,100%{opacity:.35;transform:translateY(0)}40%{opacity:1;transform:translateY(-3px)}}',

    '@media (max-width:480px){',
    ' .root{bottom:14px}.root.right{right:14px}.root.left{left:14px}',
    ' .panel{position:fixed;inset:0;width:100%;height:100%;height:100dvh;border-radius:0;bottom:auto}',
    ' .open .launcher{display:none}',
    ' .head{padding-top:max(18px,env(safe-area-inset-top))}',
    ' .foot{padding-bottom:max(8px,env(safe-area-inset-bottom))}',
    '}',
    '@media (prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}',
  ].join('\n');

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------
  function h(tag, attrs, children) {
    var el = document.createElement(tag);
    if (attrs) for (var k in attrs) {
      var v = attrs[k];
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'html') el.innerHTML = v;
      else if (k === 'text') el.textContent = v;
      else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    [].concat(children || []).forEach(function (c) {
      if (c == null || c === false) return;
      el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return el;
  }

  function linkify(text) {
    var frag = document.createDocumentFragment();
    var re = /(https?:\/\/[^\s<]+[^\s<.,;:!?)\]'"])/g, last = 0, m;
    while ((m = re.exec(text))) {
      if (m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)));
      frag.appendChild(h('a', { href: m[1], target: '_blank', rel: 'noopener noreferrer' }, m[1]));
      last = m.index + m[1].length;
    }
    if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
    return frag;
  }

  function initials(name) {
    var p = String(name || '?').trim().split(/\s+/);
    return ((p[0] || '?')[0] + (p[1] ? p[1][0] : '')).toUpperCase();
  }

  var isEmojiOnly = function (s) { return /^(\p{Extended_Pictographic}|\p{Emoji_Component}|‍|️|\s){1,8}$/u.test(s) && !/\d/.test(s); };
  function store(k, v) { try { if (v === undefined) return localStorage.getItem(k); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { return null; } }
  function sstore(k, v) { try { if (v === undefined) return sessionStorage.getItem(k); if (v === null) sessionStorage.removeItem(k); else sessionStorage.setItem(k, v); } catch (e) { return null; } }

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------
  var S = {
    token: store(LS_TOKEN), visitor: null, settings: null, available: false, agents: [],
    conv: null, messages: [], open: false, unread: 0, typing: null, agentReadAt: 0,
    ws: null, wsTries: 0, connected: false, lang: 'he', menu: false, emoji: false,
    form: { name: '', email: '', phone: '', topic: '', text: '' }, errors: {}, busy: false,
    rated: false, rateValue: 0, sound: store('reemchat_sound') !== '0', listeners: {}, pending: {},
  };
  var T = function (k, vars) {
    var s = (I18N[S.lang] || I18N.he)[k] || k;
    if (vars) for (var v in vars) s = s.replace('{' + v + '}', vars[v]);
    return s;
  };
  var txt = function (k) { return (S.settings && S.settings.texts[S.lang] && S.settings.texts[S.lang][k]) || ''; };
  function emit(ev, data) { (S.listeners[ev] || []).forEach(function (fn) { try { fn(data); } catch (e) { /* ignore */ } }); }

  // ---------------------------------------------------------------------------
  // Network
  // ---------------------------------------------------------------------------
  function api(path, body, isForm) {
    var headers = {};
    if (S.token) headers.authorization = 'Bearer ' + S.token;
    if (!isForm) headers['content-type'] = 'application/json';
    return fetch(BASE + '/api/v/' + path, { method: 'POST', headers: headers, body: isForm ? body : JSON.stringify(body || {}) })
      .then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (d) {
          if (!r.ok) { var e = new Error(d.message || T('error')); e.status = r.status; e.code = d.error; throw e; }
          return d;
        });
      });
  }

  function connect() {
    if (!S.token || S.ws || S.blocked) return;
    var ws;
    try { ws = new WebSocket(BASE.replace(/^http/, 'ws') + '/ws/visitor?t=' + encodeURIComponent(S.token)); } catch (e) { return; }
    S.ws = ws;
    ws.onopen = function () {
      S.connected = true; S.wsTries = 0; render();
      if (S.reconnectSync) { S.reconnectSync = false; refresh(); }
      S.pingTimer = setInterval(function () { try { ws.send('ping'); } catch (e) { /* closed */ } }, 25000);
    };
    ws.onmessage = function (e) { if (e.data !== 'pong') { try { onEvent(JSON.parse(e.data)); } catch (err) { /* ignore */ } } };
    ws.onclose = function (e) {
      clearInterval(S.pingTimer);
      S.ws = null; S.connected = false;
      if (e.code === 4003) { S.blocked = true; teardown(); return; }
      S.reconnectSync = true;
      var delay = Math.min(30000, 1000 * Math.pow(2, S.wsTries++)) + Math.random() * 1000;
      setTimeout(connect, delay);
      render();
    };
  }

  function refresh() {
    return api('init', { token: S.token, url: location.href, title: document.title }).then(function (d) {
      if (d.blocked) { S.blocked = true; teardown(); return; }
      applyInit(d);
      render(true);
    }).catch(function () { /* offline, try later */ });
  }

  function applyInit(d) {
    if (d.token) { S.token = d.token; store(LS_TOKEN, d.token); }
    S.visitor = d.visitor; S.settings = d.settings; S.available = d.available; S.agents = d.agents || [];
    S.conv = d.conversation; S.messages = d.messages || [];
    S.agentReadAt = (d.conversation && d.conversation.agent_read_at) || 0;
    S.form.name = S.form.name || d.visitor.name || ''; S.form.email = S.form.email || d.visitor.email || ''; S.form.phone = S.form.phone || d.visitor.phone || '';
    var seen = +store('reemchat_seen_' + (S.conv && S.conv.id)) || 0;
    S.unread = S.open ? 0 : S.messages.filter(function (m) { return m.sender_type === 'agent' && m.id > seen; }).length;
  }

  function onEvent(ev) {
    if (ev.t === 'message') {
      if (!S.conv || S.conv.id !== ev.convId) { refresh(); return; }
      addMessage(ev.message);
      if (ev.message.sender_type === 'agent') {
        S.typing = null;
        if (!S.open || document.hidden) { S.unread++; ding(); flashTitle(); }
        else markRead();
        emit('message', ev.message);
      }
      render();
    } else if (ev.t === 'typing') {
      S.typing = ev.on ? { name: ev.name } : null;
      clearTimeout(S.typingTimer);
      if (ev.on) S.typingTimer = setTimeout(function () { S.typing = null; render(); }, 8000);
      render();
    } else if (ev.t === 'read') {
      S.agentReadAt = ev.at; render();
    } else if (ev.t === 'closed') {
      if (S.conv && S.conv.id === ev.convId) { S.conv.status = 'closed'; S.rated = false; S.rateValue = 0; }
      render(true);
    } else if (ev.t === 'availability') {
      S.available = ev.available; S.agents = ev.agents || []; render();
    } else if (ev.t === 'settings') {
      S.settings = ev.settings; applyTheme(); render();
    } else if (ev.t === 'open') {
      if (!S.conv || S.conv.status === 'closed') refresh().then(function () { setOpen(true); });
      else setOpen(true);
    } else if (ev.t === 'blocked') {
      S.blocked = true; teardown();
    }
  }

  function addMessage(m) {
    for (var i = 0; i < S.messages.length; i++) {
      var x = S.messages[i];
      if (x.id === m.id || (x._pending && m.meta && m.meta.client_id && x.meta && x.meta.client_id === m.meta.client_id)) { S.messages[i] = m; return; }
    }
    S.messages.push(m);
  }

  function markRead() {
    if (!S.conv) return;
    var lastAgent = S.messages.filter(function (m) { return m.sender_type === 'agent'; }).pop();
    if (lastAgent) store('reemchat_seen_' + S.conv.id, String(lastAgent.id));
    S.unread = 0;
    if (S.ws && S.connected) { try { S.ws.send(JSON.stringify({ t: 'read' })); } catch (e) { /* closed */ } }
  }

  var typingSentAt = 0, typingOn = false, typingStop, typingTrail;
  function sendTyping(text) {
    if (!S.ws || !S.connected || !S.conv || S.conv.status !== 'open') return;
    var now = Date.now();
    clearTimeout(typingStop);
    clearTimeout(typingTrail);
    var push = function () {
      typingSentAt = Date.now(); typingOn = true;
      try { S.ws.send(JSON.stringify({ t: 'typing', on: true, text: text })); } catch (e) { /* closed */ }
    };
    if (text && (now - typingSentAt > 700 || !typingOn)) push();
    else if (text) typingTrail = setTimeout(push, 700 - (now - typingSentAt)); // keep the agent's preview up to date
    if (!text) typingOn = false;
    typingStop = setTimeout(function () {
      typingOn = false;
      try { S.ws.send(JSON.stringify({ t: 'typing', on: false })); } catch (e) { /* closed */ }
    }, text ? 4000 : 0);
  }

  // ---------------------------------------------------------------------------
  // Sound + title flash
  // ---------------------------------------------------------------------------
  var audioCtx;
  function ding() {
    if (!S.sound || !S.settings || !S.settings.sound) return;
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      var t = audioCtx.currentTime;
      [[880, 0], [1320, 0.11]].forEach(function (n) {
        var o = audioCtx.createOscillator(), g = audioCtx.createGain();
        o.type = 'sine'; o.frequency.value = n[0];
        g.gain.setValueAtTime(0.0001, t + n[1]);
        g.gain.exponentialRampToValueAtTime(0.18, t + n[1] + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t + n[1] + 0.35);
        o.connect(g); g.connect(audioCtx.destination); o.start(t + n[1]); o.stop(t + n[1] + 0.4);
      });
    } catch (e) { /* no audio */ }
  }
  var origTitle = document.title, flashTimer;
  function flashTitle() {
    if (!document.hidden || flashTimer) return;
    origTitle = document.title;
    var on = false;
    flashTimer = setInterval(function () {
      on = !on;
      document.title = on ? '💬 (' + S.unread + ') ' + (S.lang === 'he' ? 'הודעה חדשה' : 'New message') : origTitle;
    }, 1200);
  }
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) {
      if (flashTimer) { clearInterval(flashTimer); flashTimer = null; document.title = origTitle; }
      if (S.open) { markRead(); render(); }
    }
  });

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------
  function setOpen(open) {
    if (S.open === open) return;
    S.open = open; S.menu = false; S.emoji = false; S.teaser = false;
    sstore(SS_OPEN, open ? '1' : null);
    if (open) { markRead(); connect(); }
    render(true);
    emit(open ? 'open' : 'close');
    if (open) setTimeout(function () { var el = shadow.querySelector('textarea, input'); if (el && window.innerWidth > 480) el.focus(); }, 320);
  }

  function needsForm() {
    if (S.conv && S.conv.status === 'open') return false;
    if (!S.available) return true;
    var p = S.settings.prechat;
    if (S.settings.topics.length && !S.conv) return true;
    if (!p.enabled) return false;
    return ['name', 'email', 'phone'].some(function (f) { return p[f] === 'required' && !S.visitor[f]; }) ||
      (!S.conv && ['name', 'email', 'phone'].some(function (f) { return p[f] !== 'hidden' && !S.visitor[f]; }));
  }

  function validateForm() {
    var p = S.settings.prechat, e = {}, f = S.form, offline = !S.available;
    ['name', 'email', 'phone'].forEach(function (k) {
      var mode = offline && k === 'email' ? 'required' : offline && k === 'name' && p.name === 'hidden' ? 'optional' : p.enabled ? p[k] : 'hidden';
      if (mode === 'required' && !String(f[k]).trim()) e[k] = T('required');
    });
    if (f.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.trim())) e.email = T('badEmail');
    if (!f.text.trim()) e.text = T('required');
    S.errors = e;
    return !Object.keys(e).length;
  }

  function submitForm() {
    if (S.busy || !validateForm()) { render(); return; }
    var f = S.form;
    var text = f.text.trim();
    f.text = '';
    sendMessage(text, { name: f.name.trim(), email: f.email.trim(), phone: f.phone.trim(), topic: f.topic });
  }

  function sendMessage(text, extra) {
    var cid = Math.random().toString(36).slice(2, 12);
    var startingNew = !S.conv || S.conv.status === 'closed';
    if (startingNew) { S.conv = { id: -1, status: 'open', offline: !S.available }; S.messages = []; }
    var temp = { id: 'tmp-' + cid, _pending: true, sender_type: 'visitor', kind: 'text', body: text, meta: { client_id: cid }, created_at: Date.now() };
    S.messages.push(temp);
    S.busy = true;
    render();
    var body = { text: text, client_id: cid, lang: S.lang };
    if (extra) for (var k in extra) body[k] = extra[k];
    api('messages', body).then(function (d) {
      S.busy = false;
      if (extra) { S.visitor.name = extra.name || S.visitor.name; S.visitor.email = extra.email || S.visitor.email; S.visitor.phone = extra.phone || S.visitor.phone; }
      S.conv = d.conversation; S.messages = d.messages;
      connect();
      render();
    }).catch(function (err) {
      S.busy = false;
      temp._pending = false; temp._failed = true; temp._extra = extra;
      if (startingNew && S.messages.length === 1) { S.conv = null; S.messages = []; S.form.text = text; toast(err.message); }
      render();
    });
  }

  function retry(m) {
    S.messages = S.messages.filter(function (x) { return x !== m; });
    sendMessage(m.body, m._extra);
  }

  function uploadFile(file) {
    if (!file) return;
    if (file.size > 1500000) { toast(T('tooBig')); return; }
    var fd = new FormData();
    fd.append('file', file);
    S.busy = true; render();
    api('files', fd, true).then(function () {
      S.busy = false;
      return refresh();
    }).then(connect).catch(function (e) { S.busy = false; toast(e.message); render(); });
  }

  function rate(value, comment) {
    S.rateValue = value;
    api('rate', { conv_id: S.conv.id, rating: value, comment: comment || '' }).then(function () {
      S.rated = true; S.conv.rating = value; render();
    }).catch(function (e) { toast(e.message); });
  }

  function endChat() {
    S.confirm = false;
    api('close').then(function () { if (S.conv) S.conv.status = 'closed'; render(); }).catch(function (e) { toast(e.message); });
  }

  function newChat() {
    S.conv = null; S.messages = []; S.rated = false; S.rateValue = 0; S.form.text = '';
    render(true);
  }

  function askTranscript() {
    S.menu = false;
    S.transcriptForm = true;
    render();
  }

  function sendTranscript(email) {
    api('transcript', { conv_id: S.conv.id, email: email }).then(function () {
      S.transcriptForm = false; S.visitor.email = S.visitor.email || email;
      toast(T('transcriptSent', { email: email })); render();
    }).catch(function (e) { toast(e.message); });
  }

  var toastTimer;
  function toast(msg) {
    S.toast = msg; render();
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { S.toast = null; render(); }, 3200);
  }

  // ---------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------
  var host, shadow, root;

  function applyTheme() {
    if (!root || !S.settings) return;
    root.style.setProperty('--brand', S.settings.brand_color);
    root.style.setProperty('--accent', S.settings.accent_color);
    var pos = ATTR('position') || S.settings.position;
    root.className = 'root ' + (pos === 'left' ? 'left' : 'right') + (S.open ? ' open' : '');
  }

  function pickLang() {
    var forced = ATTR('lang') || (S.settings && S.settings.lang !== 'auto' ? S.settings.lang : null);
    if (forced === 'he' || forced === 'en') return forced;
    var docLang = (document.documentElement.lang || navigator.language || 'he').toLowerCase();
    return /^(he|iw)/.test(docLang) ? 'he' : 'en';
  }

  function agentAvatar(a, cls) {
    return h('div', { class: 'av ' + (cls || ''), style: 'background:' + ((a && a.color) || 'var(--brand)'), title: a && a.name }, initials(a && a.name));
  }

  function fmtTime(ts) {
    try { return new Intl.DateTimeFormat(S.lang === 'he' ? 'he-IL' : 'en-US', { hour: '2-digit', minute: '2-digit' }).format(new Date(ts)); } catch (e) { return ''; }
  }
  function fmtDay(ts) {
    var d = new Date(ts), today = new Date();
    var y = new Date(); y.setDate(today.getDate() - 1);
    if (d.toDateString() === today.toDateString()) return T('today');
    if (d.toDateString() === y.toDateString()) return T('yesterday');
    try { return new Intl.DateTimeFormat(S.lang === 'he' ? 'he-IL' : 'en-US', { day: 'numeric', month: 'long' }).format(d); } catch (e) { return d.toDateString(); }
  }

  function renderHeader() {
    var assigned = S.conv && S.conv.status === 'open' && S.conv.agent;
    var agents = assigned ? [S.conv.agent] : S.agents;
    var avatars = h('div', { class: 'avatars' }, agents.length
      ? agents.slice(0, 3).map(function (a) { return agentAvatar(a); })
      : [h('div', { class: 'av team', html: ICON.chat })]);
    var title = assigned ? S.conv.agent.name : (S.available ? txt('title') : txt('offline_title'));
    var sub = assigned ? (S.conv.agent.title || T('online')) : (S.available ? txt('subtitle') : T('away'));
    var hasConv = S.conv && S.conv.id > 0;
    return h('div', { class: 'head' }, [
      h('div', { class: 'head-row' }, [
        avatars,
        h('div', { class: 'grow' }, [
          h('h2', { text: title }),
          h('p', null, [h('span', { class: 'dot' + (S.available ? '' : ' off') }), h('span', { text: sub })]),
        ]),
        hasConv || (S.settings.sound) ? h('button', { class: 'hbtn', 'aria-label': T('menu'), html: ICON.dots, onclick: function (e) { e.stopPropagation(); S.menu = !S.menu; render(); } }) : null,
        h('button', { class: 'hbtn', 'aria-label': T('close'), html: ICON.down, onclick: function () { setOpen(false); } }),
      ]),
      !S.connected && S.conv && S.conv.status === 'open' && S.wsTries > 1 ? h('div', { class: 'conn', text: T('reconnecting') }) : null,
    ]);
  }

  function renderMenu() {
    if (!S.menu) return null;
    var hasConv = S.conv && S.conv.id > 0;
    return h('div', { class: 'menu', onclick: function (e) { e.stopPropagation(); } }, [
      hasConv && S.settings.transcript ? h('button', { onclick: askTranscript }, [h('span', { html: ICON.mail }), T('transcript')]) : null,
      S.settings.sound ? h('button', { onclick: function () { S.sound = !S.sound; store('reemchat_sound', S.sound ? '1' : '0'); S.menu = false; render(); } },
        [h('span', { html: ICON.bell }), S.sound ? T('soundOff') : T('soundOn')]) : null,
      hasConv && S.conv.status === 'open' ? h('button', { class: 'danger', onclick: function () { S.menu = false; S.confirm = true; render(); } }, [h('span', { html: ICON.exit }), T('endChat')]) : null,
    ]);
  }

  function field(name, type, mode) {
    if (mode === 'hidden') return null;
    var input = h('input', {
      class: 'input' + (S.errors[name] ? ' err' : ''), type: type, value: S.form[name], name: name,
      autocomplete: name === 'phone' ? 'tel' : name, dir: type === 'email' || type === 'tel' ? 'ltr' : null,
      oninput: function (e) { S.form[name] = e.target.value; if (S.errors[name]) { delete S.errors[name]; e.target.classList.remove('err'); } },
    });
    return h('div', { class: 'field' }, [
      h('label', null, [T(name), mode === 'optional' ? h('i', { text: ' · ' + T('optional') }) : null]),
      input,
      S.errors[name] ? h('div', { class: 'errmsg', text: S.errors[name] }) : null,
    ]);
  }

  function renderForm() {
    var p = S.settings.prechat, offline = !S.available;
    var mode = function (k) {
      if (offline && k === 'email') return S.visitor.email ? 'hidden' : 'required';
      var m = p.enabled ? p[k] : 'hidden';
      if (m === 'hidden' && offline && k === 'name' && !S.visitor.name) return 'optional';
      return S.visitor[k] && m !== 'hidden' && S.conv ? 'hidden' : m;
    };
    var textarea = h('textarea', {
      class: 'input' + (S.errors.text ? ' err' : ''), rows: 3, placeholder: T('message'),
      oninput: function (e) { S.form.text = e.target.value; if (S.errors.text) { delete S.errors.text; e.target.classList.remove('err'); } },
      onkeydown: function (e) { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submitForm(); },
    });
    textarea.value = S.form.text;
    return h('div', { class: 'card' }, [
      offline ? h('div', { class: 'greet-title', text: txt('offline_title') }) : null,
      h('div', { class: 'greet', text: offline ? txt('offline_text') : txt('greeting') }),
      field('name', 'text', mode('name')),
      field('email', 'email', mode('email')),
      field('phone', 'tel', mode('phone')),
      S.settings.topics.length ? h('div', { class: 'field' }, [
        h('label', { text: T('topic') }),
        h('div', { class: 'chips' }, S.settings.topics.map(function (t) {
          return h('button', { class: 'chip' + (S.form.topic === t ? ' on' : ''), type: 'button', onclick: function () { S.form.topic = S.form.topic === t ? '' : t; render(); } }, t);
        })),
      ]) : null,
      h('div', { class: 'field' }, [textarea, S.errors.text ? h('div', { class: 'errmsg', text: S.errors.text }) : null]),
      h('button', { class: 'btn', disabled: S.busy, onclick: submitForm }, [offline ? T('leave') : T('start'), h('span', { html: ICON.arrow })]),
    ]);
  }

  function renderMessage(m, i, list) {
    var mine = m.sender_type === 'visitor';
    var prev = list[i - 1], next = list[i + 1];
    var sameAsPrev = prev && prev.kind !== 'event' && prev.sender_type === m.sender_type && prev.sender_name === m.sender_name && m.created_at - prev.created_at < 5 * 60000;
    var sameAsNext = next && next.kind !== 'event' && next.sender_type === m.sender_type && next.sender_name === m.sender_name && next.created_at - m.created_at < 5 * 60000;
    var bubble;
    if (m.kind === 'file') {
      var url = BASE + (m.meta.url || '');
      if (/^image\//.test(m.meta.mime || '')) {
        bubble = h('div', { class: 'bubble img' }, h('img', { src: url, alt: m.body, loading: 'lazy', onclick: function () { S.lightbox = url; render(); } }));
      } else {
        bubble = h('a', { class: 'bubble filebox', href: url, target: '_blank', rel: 'noopener' }, [h('span', { html: ICON.file }), m.body]);
      }
    } else {
      bubble = h('div', { class: 'bubble' + (isEmojiOnly(m.body) ? ' emoji-only' : '') });
      bubble.appendChild(linkify(m.body));
    }
    var meta = null;
    if (m._failed) meta = h('div', { class: 'meta fail', onclick: function () { retry(m); } }, T('failed'));
    else if (m._pending) meta = h('div', { class: 'meta' }, T('sending'));
    else if (!sameAsNext) {
      var isLastMine = mine && !list.slice(i + 1).some(function (x) { return x.sender_type === 'visitor'; });
      var seen = isLastMine && S.agentReadAt >= m.created_at;
      meta = h('div', { class: 'meta' }, [fmtTime(m.created_at), seen ? h('span', { html: ICON.check }) : null, seen ? T('seen') : null]);
    }
    return h('div', { class: 'row' + (mine ? ' me' : '') + (sameAsNext ? '' : ' last') + (m._pending ? ' pending' : '') }, [
      mine ? null : agentAvatar({ name: m.sender_name, color: m.meta && m.meta.color }, 'sm'),
      h('div', { class: 'stack' }, [
        !mine && !sameAsPrev ? h('div', { class: 'sender', text: m.sender_name || T('team') }) : null,
        bubble,
        meta,
      ]),
    ]);
  }

  function renderEvent(m) {
    var t = m.meta && m.meta.type;
    var text = t === 'joined' ? T('joined', { name: m.meta.name }) : t === 'transferred' ? T('transferred', { name: m.meta.name }) : t === 'closed' ? T('ended') : m.body;
    return h('div', { class: 'event' }, h('span', null, [
      t === 'joined' || t === 'transferred' ? agentAvatar({ name: m.meta.name, color: m.meta.color }, 'sm') : null, text,
    ]));
  }

  function renderThread() {
    var out = [];
    var list = S.messages;
    // Greeting bubble at the top of every conversation
    if (txt('greeting')) {
      out.push(h('div', { class: 'row last' }, [
        h('div', { class: 'av sm', style: 'background:var(--brand)', html: '' }, initials(S.settings.site_name)),
        h('div', { class: 'stack' }, [h('div', { class: 'sender', text: S.settings.site_name }), h('div', { class: 'bubble', text: txt('greeting') })]),
      ]));
    }
    var lastDay = null;
    list.forEach(function (m, i) {
      var day = new Date(m.created_at).toDateString();
      if (day !== lastDay) { out.push(h('div', { class: 'day', text: fmtDay(m.created_at) })); lastDay = day; }
      out.push(m.kind === 'event' ? renderEvent(m) : renderMessage(m, i, list));
    });
    if (S.conv && S.conv.offline && S.conv.status === 'open' && !list.some(function (m) { return m.sender_type === 'agent'; }) && list.length && !list[list.length - 1]._pending) {
      out.push(h('div', { class: 'event' }, h('span', { text: S.visitor.email ? T('offlineSent', { email: S.visitor.email }) : T('offlineSentNoEmail') })));
    }
    if (S.typing) {
      out.push(h('div', { class: 'typing', title: T('typing', { name: S.typing.name }) }, [
        agentAvatar({ name: S.typing.name, color: S.conv && S.conv.agent && S.conv.agent.color }, 'sm'),
        h('div', { class: 'bubble' }, [h('i'), h('i'), h('i')]),
      ]));
    }
    if (S.conv && S.conv.status === 'closed') out.push(renderEnded());
    return out;
  }

  function renderEnded() {
    var comment;
    var showRating = S.settings.rating && !S.conv.rating && !S.rated;
    return h('div', { class: 'card ended' }, [
      h('h3', { text: showRating ? T('rateTitle') : T('ended') }),
      showRating ? h('div', { class: 'stars' }, [1, 2, 3, 4, 5].map(function (n) {
        return h('button', {
          class: n <= S.rateValue ? 'on' : '', html: ICON.star, 'aria-label': n + '/5',
          onclick: function () { S.rateValue = n; render(true); },
        });
      })) : null,
      showRating && S.rateValue ? (comment = h('textarea', { class: 'input', rows: 2, placeholder: T('comment') })) : null,
      showRating && S.rateValue ? h('button', { class: 'btn', onclick: function () { rate(S.rateValue, comment.value); } }, T('submit')) : null,
      !showRating && (S.rated || S.conv.rating) ? h('div', { class: 'success' }, T('rateThanks')) : null,
      h('button', { class: 'btn ghost', style: 'margin-top:10px', onclick: newChat }, T('newChat')),
    ]);
  }

  function renderComposer() {
    var ta = h('textarea', {
      rows: 1, placeholder: T('placeholder'), 'aria-label': T('placeholder'),
      oninput: function (e) {
        autosize(e.target);
        S.draft = e.target.value;
        sendBtn.classList.toggle('ready', !!e.target.value.trim());
        sendTyping(e.target.value);
      },
      onkeydown: function (e) {
        if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); doSend(); }
      },
    });
    ta.value = S.draft || '';
    function doSend() {
      var text = ta.value.trim();
      if (!text) return;
      S.draft = ''; ta.value = ''; S.emoji = false;
      sendTyping('');
      sendMessage(text);
    }
    var sendBtn = h('button', { class: 'cbtn sendbtn' + (ta.value.trim() ? ' ready' : ''), 'aria-label': T('send'), html: ICON.send, onclick: doSend });
    var fileInput = h('input', { type: 'file', class: 'hide', accept: 'image/*,.pdf,.doc,.docx,.txt,.zip,.xls,.xlsx', onchange: function (e) { uploadFile(e.target.files[0]); e.target.value = ''; } });
    setTimeout(function () { autosize(ta); }, 0);
    return h('div', { class: 'foot' }, [
      S.emoji ? h('div', { class: 'emojis' }, EMOJI.map(function (em) {
        return h('button', { onclick: function () { var ta2 = shadow.querySelector('.composer textarea'); S.draft = (ta2.value || '') + em; render(); var t3 = shadow.querySelector('.composer textarea'); t3.focus(); t3.selectionStart = t3.value.length; } }, em);
      })) : null,
      h('div', { class: 'composer' }, [
        ta,
        h('button', { class: 'cbtn', 'aria-label': T('emoji'), html: ICON.smile, onclick: function () { S.draft = ta.value; S.emoji = !S.emoji; render(); } }),
        S.settings.attachments ? h('button', { class: 'cbtn', 'aria-label': T('attach'), html: ICON.clip, disabled: S.busy, onclick: function () { fileInput.click(); } }) : null,
        fileInput,
        sendBtn,
      ]),
      h('div', { class: 'brandline', html: T('powered').replace('reem.bi', '<b>reem.bi</b>') }),
    ]);
  }

  function autosize(el) { el.style.height = 'auto'; el.style.height = Math.min(120, el.scrollHeight) + 'px'; }

  function renderTranscriptForm() {
    var input = h('input', { class: 'input', type: 'email', dir: 'ltr', value: S.visitor.email || '', placeholder: T('yourEmail') });
    return h('div', { class: 'confirm', onclick: function (e) { if (e.target === e.currentTarget) { S.transcriptForm = false; render(); } } },
      h('div', { class: 'card' }, [
        h('h3', { text: T('transcript') }),
        h('div', { class: 'field' }, input),
        h('div', { class: 'btns' }, [
          h('button', { class: 'btn ghost', onclick: function () { S.transcriptForm = false; render(); } }, T('no')),
          h('button', { class: 'btn', onclick: function () { if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.value.trim())) sendTranscript(input.value.trim()); else input.classList.add('err'); } }, T('send')),
        ]),
      ]));
  }

  function renderConfirm() {
    return h('div', { class: 'confirm', onclick: function (e) { if (e.target === e.currentTarget) { S.confirm = false; render(); } } },
      h('div', { class: 'card' }, [
        h('h3', { text: T('endConfirm') }),
        h('div', { class: 'btns' }, [
          h('button', { class: 'btn ghost', onclick: function () { S.confirm = false; render(); } }, T('no')),
          h('button', { class: 'btn danger', onclick: endChat }, T('yes')),
        ]),
      ]));
  }

  var bodyScroll = { top: 0, stick: true };
  function render(forceBottom) {
    if (!root || !S.settings) return;
    S.lang = pickLang();
    applyTheme();
    var dir = I18N[S.lang].dir;
    root.setAttribute('dir', dir);
    root.setAttribute('lang', S.lang);

    var oldBody = shadow.querySelector('.body');
    if (oldBody) { bodyScroll.top = oldBody.scrollTop; bodyScroll.stick = oldBody.scrollHeight - oldBody.scrollTop - oldBody.clientHeight < 80; }
    var active = shadow.activeElement;
    var activeName = active && (active.name || (active.closest && active.closest('.composer') ? 'composer' : active.tagName === 'TEXTAREA' && active.closest('.card') ? 'formtext' : null));
    var selStart = active && active.selectionStart;

    root.innerHTML = '';
    var showForm = needsForm();
    var panel = h('div', { class: 'panel', role: 'dialog', 'aria-label': txt('title'), 'aria-hidden': S.open ? 'false' : 'true', onclick: function () { if (S.menu) { S.menu = false; render(); } } }, [
      renderHeader(),
      renderMenu(),
      h('div', { class: 'body' }, showForm ? [renderForm()] : renderThread()),
      !showForm && S.conv && S.conv.status !== 'closed' ? renderComposer() : !showForm && !S.conv ? renderComposer() : null,
      S.confirm ? renderConfirm() : null,
      S.transcriptForm ? renderTranscriptForm() : null,
      S.toast ? h('div', { class: 'toast', text: S.toast }) : null,
    ]);

    var style = S.settings.launcher_style;
    var launcher = ATTR('hide-launcher') !== null ? null : h('button', {
      class: 'launcher' + (style === 'pill' ? ' pill' : ''), 'aria-label': S.open ? T('close') : T('open'),
      onclick: function () { setOpen(!S.open); },
    }, [
      h('span', { class: 'ic c', html: ICON.chat }),
      style === 'pill' ? h('span', { class: 'lbl', text: txt('launcher') }) : null,
      h('span', { class: 'ic x', html: ICON.close }),
      S.unread && !S.open ? h('span', { class: 'badge', text: String(S.unread > 9 ? '9+' : S.unread) }) : null,
    ]);

    var teaser = S.teaser && !S.open ? h('div', { class: 'teaser', onclick: function () { setOpen(true); } }, [
      h('button', { class: 'x', html: ICON.close, 'aria-label': T('close'), onclick: function (e) { e.stopPropagation(); S.teaser = false; sstore('reemchat_teased', '1'); render(); } }),
      h('div', { class: 'who' }, [S.agents[0] ? agentAvatar(S.agents[0], 'sm') : null, S.agents[0] ? S.agents[0].name : S.settings.site_name]),
      h('div', { text: txt('greeting') }),
    ]) : null;

    root.appendChild(panel);
    if (teaser) root.appendChild(teaser);
    if (launcher) root.appendChild(launcher);
    if (S.lightbox) root.appendChild(h('div', { class: 'lightbox', onclick: function () { S.lightbox = null; render(); } }, h('img', { src: S.lightbox })));

    var body = shadow.querySelector('.body');
    if (body) body.scrollTop = forceBottom || bodyScroll.stick ? body.scrollHeight : bodyScroll.top;
    if (activeName) {
      var el = activeName === 'composer' ? shadow.querySelector('.composer textarea') : activeName === 'formtext' ? shadow.querySelector('.card textarea') : shadow.querySelector('[name="' + activeName + '"]');
      if (el) { el.focus(); try { if (selStart != null) el.selectionStart = el.selectionEnd = selStart; } catch (e) { /* not a text field */ } }
    }
  }

  function teardown() {
    if (host) host.remove();
    if (S.ws) try { S.ws.close(); } catch (e) { /* closed */ }
  }

  // ---------------------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------------------
  function mount() {
    host = document.createElement('div');
    host.id = 'reem-chat';
    document.body.appendChild(host);
    shadow = host.attachShadow({ mode: 'open' });
    shadow.appendChild(h('style', { text: CSS }));
    root = h('div', { class: 'root right' });
    shadow.appendChild(root);
    if (!document.querySelector('link[data-reemchat-font]')) {
      document.head.appendChild(h('link', { rel: 'stylesheet', 'data-reemchat-font': '1', href: 'https://fonts.googleapis.com/css2?family=Rubik:wght@400;500;600;700&display=swap' }));
    }
    document.addEventListener('click', function (e) { if (S.menu && !host.contains(e.target)) { S.menu = false; render(); } });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && S.open) { if (S.lightbox) { S.lightbox = null; render(); } else setOpen(false); } });
  }

  function trackNavigation() {
    var send = function () {
      if (S.ws && S.connected) try { S.ws.send(JSON.stringify({ t: 'page', url: location.href, title: document.title })); } catch (e) { /* closed */ }
    };
    ['pushState', 'replaceState'].forEach(function (fn) {
      var orig = history[fn];
      history[fn] = function () { var r = orig.apply(this, arguments); setTimeout(send, 50); return r; };
    });
    window.addEventListener('popstate', function () { setTimeout(send, 50); });
  }

  function boot() {
    mount();
    api('init', {
      token: S.token, url: location.href, title: document.title, referrer: document.referrer,
      lang: navigator.language, tz: (Intl.DateTimeFormat().resolvedOptions() || {}).timeZone,
    }).then(function (d) {
      if (d.blocked) { teardown(); return; }
      applyInit(d);
      var wantOpen = sstore(SS_OPEN) === '1' || /[?&]chat=open\b/.test(location.search);
      if (S.settings.track || (S.conv && S.conv.status === 'open')) connect();
      trackNavigation();
      render(true);
      if (wantOpen) setOpen(true);
      else if (!S.conv && !sstore('reemchat_teased') && S.available) {
        setTimeout(function () { if (!S.open) { S.teaser = true; sstore('reemchat_teased', '1'); render(); } }, 6000);
      }
      emit('ready');
    }).catch(function (e) { console.warn('[reem chat]', e.message); });
  }

  // Public API
  var queued = (window.ReemChat && window.ReemChat.q) || [];
  window.ReemChat = {
    __loaded: true,
    open: function () { setOpen(true); },
    close: function () { setOpen(false); },
    toggle: function () { setOpen(!S.open); },
    identify: function (info) {
      info = info || {};
      ['name', 'email', 'phone'].forEach(function (k) { if (info[k]) S.form[k] = info[k]; });
      var send = function () { api('profile', info).then(function () { ['name', 'email', 'phone'].forEach(function (k) { if (info[k] && S.visitor) S.visitor[k] = info[k]; }); render(); }).catch(function () { /* ignore */ }); };
      if (S.token) send(); else (S.listeners.ready = S.listeners.ready || []).push(send);
    },
    on: function (ev, fn) { (S.listeners[ev] = S.listeners[ev] || []).push(fn); },
  };
  queued.forEach(function (args) { var fn = window.ReemChat[args[0]]; if (fn) fn.apply(null, [].slice.call(args, 1)); });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
