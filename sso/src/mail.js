// Transactional email through Resend (free tier: 3,000 emails/month, 100/day).
// Without RESEND_API_KEY the email is only logged — handy for local development.

const escapeHtml = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function layout({ title, intro, button, link, outro }) {
  return `<!doctype html>
<html lang="he" dir="rtl">
<body style="margin:0;padding:0;background:#f3f5f4;font-family:Arial,Helvetica,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f5f4;padding:32px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border-radius:16px;padding:32px 28px;text-align:right;">
        <tr><td style="font-family:'Courier New',monospace;font-size:20px;font-weight:bold;color:#0b3d25;padding-bottom:20px;">reem<span style="color:#7a8f84;">.bi</span></td></tr>
        <tr><td style="font-size:20px;font-weight:bold;color:#14201a;padding-bottom:12px;">${escapeHtml(title)}</td></tr>
        <tr><td style="font-size:15px;line-height:1.7;color:#4a5a52;padding-bottom:24px;">${escapeHtml(intro)}</td></tr>
        <tr><td align="center" style="padding-bottom:24px;">
          <a href="${escapeHtml(link)}" style="display:inline-block;background:#00a862;color:#ffffff;text-decoration:none;font-weight:bold;font-size:16px;padding:14px 28px;border-radius:10px;">${escapeHtml(button)}</a>
        </td></tr>
        <tr><td style="font-size:13px;line-height:1.6;color:#7a8f84;">${escapeHtml(outro)}</td></tr>
        <tr><td style="font-size:12px;line-height:1.6;color:#9aaba2;padding-top:18px;word-break:break-all;" dir="ltr">${escapeHtml(link)}</td></tr>
      </table>
      <p style="font-size:12px;color:#9aaba2;margin-top:16px;">נשלח אוטומטית מ-login.reembir.com — אין להשיב למייל זה.</p>
    </td></tr>
  </table>
</body>
</html>`;
}

const TEMPLATES = {
  magic: link => ({
    subject: 'קישור ההתחברות שלך',
    title: 'התחברות בלחיצה אחת',
    intro: 'לחצו על הכפתור כדי להתחבר. הקישור תקף ל-15 דקות וניתן להשתמש בו פעם אחת בלבד.',
    button: 'התחבר עכשיו',
    outro: 'לא ביקשתם להתחבר? אפשר פשוט להתעלם מהמייל הזה.',
    link,
  }),
  reset: link => ({
    subject: 'איפוס סיסמה',
    title: 'בחירת סיסמה חדשה',
    intro: 'קיבלנו בקשה לאפס את הסיסמה של החשבון שלך. הקישור תקף לשעה אחת.',
    button: 'בחירת סיסמה חדשה',
    outro: 'לא ביקשתם לאפס? אפשר להתעלם מהמייל — הסיסמה הנוכחית לא תשתנה.',
    link,
  }),
  verify: link => ({
    subject: 'אימות כתובת המייל',
    title: 'ברוכים הבאים!',
    intro: 'נשאר רק לאמת את כתובת המייל שלך כדי לסיים את ההרשמה.',
    button: 'אימות המייל',
    outro: 'לא נרשמתם? אפשר להתעלם מהמייל הזה.',
    link,
  }),
};

export async function sendTemplate(env, to, type, link) {
  const t = TEMPLATES[type](link);
  const html = layout(t);
  const text = `${t.title}\n\n${t.intro}\n\n${link}\n\n${t.outro}`;

  if (!env.RESEND_API_KEY) {
    console.log(`[DEV EMAIL] to=${to} type=${type} link=${link}`);
    return;
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      from: env.MAIL_FROM || 'reem.bi <no-reply@reembir.com>',
      to: [to],
      subject: t.subject,
      html,
      text,
    }),
  });
  if (!res.ok) {
    console.error('Resend error', res.status, await res.text());
    throw new Error('email_failed');
  }
}

// ---------------------------------------------------------------------------
// Free-form emails written in the admin dashboard.
// ---------------------------------------------------------------------------

// Plain text → safe HTML: paragraphs on blank lines, line breaks, clickable links, **bold**.
function textToHtml(text) {
  return String(text || '')
    .trim()
    .split(/\n{2,}/)
    .map(par => {
      const html = escapeHtml(par)
        .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
        .replace(/(https?:\/\/[^\s<]+[^\s<.,;:!?)])/g, '<a href="$1" style="color:#00a862;">$1</a>')
        .replace(/\n/g, '<br>');
      return `<p style="margin:0 0 14px;">${html}</p>`;
    })
    .join('');
}

export function fillPlaceholders(str, r) {
  return String(str || '')
    .replace(/\{\{\s*name\s*\}\}/g, r.name || '')
    .replace(/\{\{\s*email\s*\}\}/g, r.email || '');
}

export function renderCustomEmail({ subject, body, buttonText, buttonUrl }, recipient) {
  const title = fillPlaceholders(subject, recipient);
  const content = textToHtml(fillPlaceholders(body, recipient));
  const button = buttonText && buttonUrl
    ? `<tr><td align="center" style="padding:8px 0 24px;">
         <a href="${escapeHtml(buttonUrl)}" style="display:inline-block;background:#00a862;color:#ffffff;text-decoration:none;font-weight:bold;font-size:16px;padding:14px 28px;border-radius:10px;">${escapeHtml(buttonText)}</a>
       </td></tr>`
    : '';
  const html = `<!doctype html>
<html lang="he" dir="rtl">
<body style="margin:0;padding:0;background:#f3f5f4;font-family:Arial,Helvetica,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f5f4;padding:32px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:16px;padding:32px 28px;text-align:right;">
        <tr><td style="font-family:'Courier New',monospace;font-size:20px;font-weight:bold;color:#0b3d25;padding-bottom:20px;" dir="ltr" align="right">reem<span style="color:#7a8f84;">.bi</span></td></tr>
        <tr><td style="font-size:20px;font-weight:bold;color:#14201a;padding-bottom:14px;">${escapeHtml(title)}</td></tr>
        <tr><td style="font-size:15px;line-height:1.75;color:#34423b;padding-bottom:8px;">${content}</td></tr>
        ${button}
      </table>
      <p style="font-size:12px;color:#9aaba2;margin-top:16px;">נשלח מ-reem.bi</p>
    </td></tr>
  </table>
</body>
</html>`;
  const text = `${title}\n\n${fillPlaceholders(body, recipient)}${buttonText && buttonUrl ? `\n\n${buttonText}: ${buttonUrl}` : ''}`;
  return { subject: title, html, text };
}

/**
 * Sends one separate email per recipient (nobody sees the other addresses),
 * through Resend's batch endpoint (100 per request).
 */
export async function sendCustomBatch(env, { from, replyTo, message, recipients }) {
  const emails = recipients.map(r => {
    const { subject, html, text } = renderCustomEmail(message, r);
    const email = { from, to: [r.email], subject, html, text };
    if (replyTo) email.reply_to = replyTo;
    return email;
  });

  if (!env.RESEND_API_KEY) {
    for (const e of emails) console.log(`[DEV EMAIL] from=${from} to=${e.to[0]} subject=${e.subject}`);
    return { sent: emails.length, dev: true };
  }

  let sent = 0;
  for (let i = 0; i < emails.length; i += 100) {
    const res = await fetch('https://api.resend.com/emails/batch', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify(emails.slice(i, i + 100)),
    });
    if (!res.ok) {
      const detail = await res.text();
      console.error('Resend batch error', res.status, detail);
      let message = detail;
      try { message = JSON.parse(detail).message || detail; } catch { /* keep raw */ }
      const err = new Error(message);
      err.sent = sent;
      throw err;
    }
    sent += Math.min(100, emails.length - i);
  }
  return { sent };
}
