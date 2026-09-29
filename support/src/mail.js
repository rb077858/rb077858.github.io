// Transactional email through Resend (same account as login.reembir.com).
// Without RESEND_API_KEY every email is only logged — handy for local development.

export const escapeHtml = s =>
  String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const nl2br = s => escapeHtml(s).replace(/\n/g, '<br>');

function fmtTime(ms, tz = 'Asia/Jerusalem') {
  try {
    return new Intl.DateTimeFormat('he-IL', { timeZone: tz, dateStyle: 'short', timeStyle: 'short' }).format(new Date(ms));
  } catch {
    return new Date(ms).toISOString().slice(0, 16).replace('T', ' ');
  }
}

/** One chat bubble row, email-safe (tables + inline styles). */
function bubble(m, brand) {
  const mine = m.sender_type === 'visitor';
  const whisper = m.kind === 'whisper';
  const bg = whisper ? '#fff6d6' : mine ? '#eef2f0' : brand;
  const color = whisper ? '#5c4a00' : mine ? '#14201a' : '#ffffff';
  const who = escapeHtml(m.sender_name || (mine ? 'מבקר' : 'נציג'));
  const body = m.kind === 'file'
    ? `📎 <a href="${escapeHtml(m.file_url || '#')}" style="color:${color};">${escapeHtml(m.body || 'קובץ')}</a>`
    : nl2br(m.body);
  return `<tr><td style="padding:4px 0;" align="${mine ? 'right' : 'left'}">
    <div style="font-size:11px;color:#7a8f84;padding:0 4px 2px;">${who}${whisper ? ' · 🤫 הערה פנימית' : ''} · ${escapeHtml(fmtTime(m.created_at))}</div>
    <div style="display:inline-block;max-width:420px;background:${bg};color:${color};border-radius:14px;padding:10px 14px;font-size:14px;line-height:1.6;text-align:right;">${body}</div>
  </td></tr>`;
}

function layout({ brand = '#00a862', siteName = 'reem.bi', dir = 'rtl', preheader = '', title, intro = '', messages = [], button, link, outro = '', footer }) {
  const align = dir === 'rtl' ? 'right' : 'left';
  const msgs = messages.length
    ? `<tr><td style="padding:6px 0 20px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" dir="${dir}">${messages.map(m => bubble(m, brand)).join('')}</table></td></tr>`
    : '';
  const btn = button && link
    ? `<tr><td align="center" style="padding:4px 0 24px;">
         <a href="${escapeHtml(link)}" style="display:inline-block;background:${brand};color:#ffffff;text-decoration:none;font-weight:bold;font-size:15px;padding:13px 28px;border-radius:12px;">${escapeHtml(button)}</a>
       </td></tr>`
    : '';
  return `<!doctype html>
<html lang="${dir === 'rtl' ? 'he' : 'en'}" dir="${dir}">
<body style="margin:0;padding:0;background:#f1f4f2;font-family:Arial,Helvetica,sans-serif;">
  <span style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(preheader)}</span>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f4f2;padding:32px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:18px;overflow:hidden;text-align:${align};" dir="${dir}">
        <tr><td style="height:6px;background:${brand};font-size:0;line-height:0;">&nbsp;</td></tr>
        <tr><td style="padding:28px 28px 0;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            <tr><td style="font-size:13px;font-weight:bold;color:${brand};letter-spacing:.3px;padding-bottom:14px;">💬 ${escapeHtml(siteName)}</td></tr>
            <tr><td style="font-size:21px;font-weight:bold;color:#14201a;padding-bottom:10px;">${escapeHtml(title)}</td></tr>
            ${intro ? `<tr><td style="font-size:15px;line-height:1.7;color:#4a5a52;padding-bottom:18px;">${intro}</td></tr>` : ''}
            ${msgs}
            ${btn}
            ${outro ? `<tr><td style="font-size:13px;line-height:1.6;color:#7a8f84;padding-bottom:26px;">${outro}</td></tr>` : ''}
          </table>
        </td></tr>
      </table>
      <p style="font-size:12px;color:#9aaba2;margin-top:16px;">${footer ?? 'נשלח אוטומטית ממערכת הצ׳אט של reem.bi'}</p>
    </td></tr>
  </table>
</body>
</html>`;
}

const strip = html => html.replace(/<br>/g, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ');

function transcriptText(messages) {
  return messages.map(m => `[${fmtTime(m.created_at)}] ${m.sender_name || m.sender_type}: ${m.body}`).join('\n');
}

// ---------- templates ----------

export const templates = {
  invite: ({ inviter, link, brand, siteName }) => ({
    subject: `הוזמנת להצטרף לצוות התמיכה של ${siteName}`,
    html: layout({
      brand, siteName, preheader: 'בחרו סיסמה ותתחילו לענות ללקוחות',
      title: 'ברוכים הבאים לצוות! 👋',
      intro: `${escapeHtml(inviter)} הזמין/ה אותך להצטרף כנציג/ה במערכת הצ׳אט. לחצו על הכפתור כדי לבחור סיסמה ולהתחבר. הקישור תקף ל-7 ימים.`,
      button: 'הצטרפות לצוות', link,
    }),
  }),

  reset: ({ link, brand, siteName, firstAdmin }) => ({
    subject: firstAdmin ? 'הגדרת חשבון המנהל' : 'איפוס סיסמה',
    html: layout({
      brand, siteName,
      title: firstAdmin ? 'בואו נקים את מערכת הצ׳אט 🚀' : 'בחירת סיסמה חדשה',
      intro: firstAdmin
        ? 'זה החשבון הראשון במערכת — הוא יהיה המנהל. לחצו כדי לבחור סיסמה. הקישור תקף לשעה.'
        : 'קיבלנו בקשה לאפס את הסיסמה שלך. הקישור תקף לשעה אחת.',
      button: firstAdmin ? 'הגדרת סיסמה' : 'בחירת סיסמה חדשה', link,
      outro: 'לא ביקשתם? אפשר להתעלם מהמייל.',
    }),
  }),

  newChat: ({ conv, visitor, messages, link, brand, siteName, reason }) => ({
    subject: `💬 ${reason === 'unanswered' ? 'שיחה ממתינה למענה' : 'שיחה חדשה'} — ${visitor.name || 'מבקר'} (#${conv.id})`,
    html: layout({
      brand, siteName, preheader: messages[0]?.body || '',
      title: reason === 'unanswered' ? `שיחה #${conv.id} מחכה כבר כמה דקות` : `שיחה חדשה #${conv.id}`,
      intro: `<b>${escapeHtml(visitor.name || 'מבקר')}</b>${visitor.email ? ` · ${escapeHtml(visitor.email)}` : ''}${conv.topic ? ` · ${escapeHtml(conv.topic)}` : ''}<br>
              <span style="font-size:13px;color:#7a8f84;">${escapeHtml(conv.page_url || '')}</span>`,
      messages, button: 'מענה בצ׳אט', link,
      outro: 'קיבלת את המייל כי אף נציג לא היה מחובר. אפשר לכבות התראות בפרופיל שלך.',
    }),
  }),

  offline: ({ conv, visitor, messages, link, brand, siteName }) => ({
    subject: `✉️ הודעה חדשה מ${visitor.name || 'מבקר'} (#${conv.id})`,
    replyTo: visitor.email || undefined,
    html: layout({
      brand, siteName, preheader: messages[0]?.body || '',
      title: 'התקבלה הודעה כשהצוות לא היה זמין',
      intro: `<b>${escapeHtml(visitor.name || 'מבקר')}</b>${visitor.email ? ` · <a href="mailto:${escapeHtml(visitor.email)}">${escapeHtml(visitor.email)}</a>` : ''}${visitor.phone ? ` · ${escapeHtml(visitor.phone)}` : ''}`,
      messages, button: 'פתיחה במערכת', link,
      outro: visitor.email ? 'אפשר להשיב ישירות למייל הזה — התשובה תגיע ללקוח.' : '',
    }),
  }),

  whisper: ({ from, conv, text, link, brand, siteName }) => ({
    subject: `🤫 ${from} כתב/ה לך הערה בשיחה #${conv.id}`,
    html: layout({
      brand, siteName, preheader: text,
      title: `הערה פנימית משיחה #${conv.id}`,
      intro: `${escapeHtml(from)} תייג/ה אותך. הלקוח לא רואה את ההודעה הזו.`,
      messages: [{ sender_type: 'agent', kind: 'whisper', sender_name: from, body: text, created_at: Date.now() }],
      button: 'מעבר לשיחה', link,
    }),
  }),

  assigned: ({ by, conv, visitor, link, brand, siteName }) => ({
    subject: `📥 שיחה #${conv.id} הועברה אליך`,
    html: layout({
      brand, siteName, title: `שיחה #${conv.id} הועברה אליך`,
      intro: `${escapeHtml(by)} העביר/ה אליך את השיחה עם <b>${escapeHtml(visitor.name || 'מבקר')}</b>.`,
      button: 'מעבר לשיחה', link,
    }),
  }),

  visitorReply: ({ agentName, messages, link, brand, siteName, lang }) => {
    const he = lang !== 'en';
    return {
      subject: he ? `קיבלת תשובה מ${siteName}` : `You have a new reply from ${siteName}`,
      html: layout({
        brand, siteName, dir: he ? 'rtl' : 'ltr',
        title: he ? `${agentName} ענה/תה לך 💬` : `${agentName} replied 💬`,
        intro: he ? 'נראה שיצאת מהאתר לפני שהתשובה הגיעה, אז שלחנו אותה גם לכאן:' : 'Looks like you left before our reply arrived, so here it is:',
        messages, button: he ? 'המשך השיחה' : 'Continue the conversation', link,
        footer: siteName,
      }),
    };
  },

  transcript: ({ conv, messages, brand, siteName, lang }) => {
    const he = lang !== 'en';
    return {
      subject: he ? `תמליל השיחה שלך עם ${siteName} (#${conv.id})` : `Your conversation with ${siteName} (#${conv.id})`,
      html: layout({
        brand, siteName, dir: he ? 'rtl' : 'ltr',
        title: he ? 'תמליל השיחה' : 'Conversation transcript',
        intro: `${he ? 'שיחה' : 'Conversation'} #${conv.id} · ${escapeHtml(fmtTime(conv.created_at))}`,
        messages,
        outro: he ? 'תודה שפניתם אלינו!' : 'Thanks for reaching out!',
        footer: siteName,
      }),
      text: transcriptText(messages),
    };
  },
};

/**
 * Sends one email. Returns {dev:true, preview} when Resend isn't configured
 * so the admin UI can still show invite / reset links during setup.
 */
export async function sendMail(env, { to, subject, html, text, replyTo, from }) {
  if (!env.RESEND_API_KEY) {
    console.log(`[DEV EMAIL] to=${to} subject=${subject}`);
    return { dev: true };
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      from: from || env.MAIL_FROM || 'reem.bi Support <support@reembir.com>',
      to: Array.isArray(to) ? to : [to],
      subject,
      html,
      text: text || strip(html),
      ...(replyTo ? { reply_to: replyTo } : {}),
    }),
  });
  if (!res.ok) {
    const detail = await res.text();
    console.error('Resend error', res.status, detail);
    throw new Error('email_failed');
  }
  return { ok: true };
}
