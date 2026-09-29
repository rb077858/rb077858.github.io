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
