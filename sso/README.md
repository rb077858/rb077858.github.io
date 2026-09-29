# login.reembir.com — התחברות אחת לכל הפרויקטים

מערכת התחברות מרכזית (SSO) לכל האתרים של reem.bi — כמו "התחברות עם Google", רק שלך.
רצה בחינם לגמרי על **Cloudflare Workers + D1**, והמיילים יוצאים מ-`no-reply@reembir.com` דרך **Resend** (חינם עד 3,000 מיילים בחודש).

- **דרכי התחברות:** Google · מייל + סיסמה · קישור קסם למייל (לוחצים ונכנסים מחוברים)
- **איפוס סיסמה ואימות מייל** במייל
- **דשבורד ניהול** ב-`login.reembir.com/admin`: משתמשים, גישה לכל אתר (פעיל / ממתין / חסום), תוכניות פרימיום עם תאריך תפוגה, הרשאות מיוחדות למשתמש, אתרים, והודעות מהקיר
- **דף חשבון** ב-`login.reembir.com`: פרופיל, סיסמה, האתרים שלי, התנתקות מכל המכשירים

## איך זה עובד

```
reembir.com/neverlost  ──(1) "התחברות"──►  login.reembir.com  (Google / סיסמה / קישור במייל)
        ▲                                         │
        └──(2) חוזר עם קוד חד-פעמי ◄──────────────┘
        (3) האתר מחליף את הקוד בטוקן ומקבל: מי המשתמש + התוכנית וההרשאות שלו באתר הזה
```

זה Authorization Code + PKCE (אותו מנגנון של "התחברות עם Google"), כך שאתר סטטי ב-GitHub Pages יכול להשתמש בו בלי שרת משלו.
מי שכבר מחובר ב-login.reembir.com נכנס לכל אתר נוסף בלחיצה אחת.

## הוספת ההתחברות לפרויקט חדש

1. בדשבורד → **אתרים ותוכניות** → **+ אתר חדש**: מזהה (למשל `my-app`), שם, וכתובת חזרה (למשל `https://reembir.com/my-app/`).
2. בפרויקט:

```html
<script src="https://login.reembir.com/sdk.js"></script>
<script>
  const auth = ReemAuth.init({ clientId: 'my-app' });

  auth.onChange(user => {
    if (user) {
      // user.email, user.name, user.avatar
      // user.plan      → { id, name }  התוכנית של המשתמש באתר הזה
      // user.features  → ההרשאות מהתוכנית, למשל { limit: 50 }
    } else {
      // לא מחובר
    }
  });

  loginButton.onclick = () => auth.login();
  logoutButton.onclick = () => auth.logout();
</script>
```

עוד ב-SDK: `auth.refresh()` (טעינה מחדש של התוכנית), `auth.api(path, {body})` (קריאה ל-API בשם המשתמש), `auth.getFirebaseToken()` (לפרויקטים ששומרים נתונים ב-Firebase), `auth.accountUrl()`.

> ההרשאות (`features`) נבדקות בצד הלקוח. לפרויקט עם שרת/Firestore, אכפו אותן גם בצד השרת (למשל ב-Firestore rules).

---

## התקנה (פעם אחת, בערך 20 דקות, בלי טרמינל)

### 1. מסד נתונים (D1)
1. [dash.cloudflare.com](https://dash.cloudflare.com) → **Storage & Databases → D1 → Create database** → שם: `reem-sso`.
2. העתיקו את ה-**Database ID** ועדכנו אותו ב-`sso/wrangler.toml` בשורה `database_id` (אפשר לערוך ישירות ב-GitHub).
3. בתוך מסד הנתונים → לשונית **Console** → הדביקו את כל התוכן של `sso/schema.sql` → **Execute**.

### 2. חיבור ה-Worker ל-GitHub (פריסה אוטומטית)
1. **Workers & Pages → Create → Import a repository** → בחרו את `rb077858/rb077858.github.io`.
2. **Root directory:** `sso` · **Deploy command:** `npx wrangler deploy` · שם ה-Worker: `reem-sso`.
3. מעכשיו כל push ל-`main` שנוגע ב-`sso/` נפרס אוטומטית.
4. הדומיין `login.reembir.com` מתחבר לבד (מוגדר ב-`wrangler.toml`), כי reembir.com כבר מנוהל ב-Cloudflare.

### 3. משתנים סודיים
ב-Worker → **Settings → Variables and Secrets** → הוסיפו (סוג Secret):

| שם | ערך |
|---|---|
| `ADMIN_EMAILS` | המייל שלך (אפשר כמה, מופרדים בפסיק). חשבון עם המייל הזה הופך למנהל אחרי שהמייל מאומת |
| `RESEND_API_KEY` | משלב 4 |
| `GOOGLE_CLIENT_ID` | משלב 5 |
| `FIREBASE_SERVICE_ACCOUNT` | משלב 6 (בשביל NeverLost) |

### 4. שליחת מיילים מ-no-reply@reembir.com (Resend, חינם)
1. נרשמים ב-[resend.com](https://resend.com) → **Domains → Add domain** → `reembir.com`.
2. לוחצים **Auto configure** (מתחבר ל-Cloudflare ומוסיף את רשומות ה-DNS לבד), או מעתיקים את הרשומות ידנית ל-Cloudflare DNS.
3. אחרי שהדומיין **Verified** → **API Keys → Create** (הרשאת Sending) → שומרים כ-`RESEND_API_KEY`.

עד שזה מוגדר, המערכת עובדת אבל לא שולחת מיילים (קישורי הקסם והאיפוס לא יגיעו).

### 5. התחברות עם Google
1. [console.cloud.google.com](https://console.cloud.google.com) (אפשר בפרויקט של Firebase, `lost-items-28167`) → **APIs & Services → OAuth consent screen** → מגדירים שם אפליקציה (External).
2. **Credentials → Create credentials → OAuth client ID** → סוג **Web application**.
3. **Authorized JavaScript origins:** `https://login.reembir.com`
4. את ה-**Client ID** שומרים כ-`GOOGLE_CLIENT_ID`. (אין צורך ב-Client secret.)

### 6. NeverLost (Firebase)
NeverLost שומר את התגים ב-Firestore, אז שרת ההתחברות מנפיק לו טוקן Firebase:
1. Firebase Console → ⚙️ **Project settings → Service accounts → Generate new private key**.
2. את **כל תוכן** קובץ ה-JSON שומרים כ-`FIREBASE_SERVICE_ACCOUNT`.
3. אחר כך מעדכנים את חוקי Firestore לפי `firestore.rules` שבמאגר של NeverLost (רק אחרי שהסוד הוגדר).

### 7. בדיקה
1. היכנסו ל-`https://login.reembir.com` → התחברו עם המייל שב-`ADMIN_EMAILS`.
2. יופיע כפתור **🛠 ניהול** → הדשבורד.
3. העבירו את משתמשי ה-Pro מהגיליון הישן: חפשו משתמש → NeverLost → תוכנית Pro/Unlimited → תאריך תפוגה.

---

## פיתוח מקומי

```bash
cd sso
npm install
cp .dev.vars.example .dev.vars     # DEV=1 → קישורי המייל מוצגים על המסך במקום להישלח
npm run db:local
npm run dev                        # http://127.0.0.1:8787
```

## מבנה

| קובץ | מה יש בו |
|---|---|
| `src/index.js` | כל ה-API: התחברות, זרימת ההרשאה לאתרים, חשבון, דשבורד |
| `src/jwt.js` | אימות טוקן של Google, הנפקת טוקן Firebase |
| `src/mail.js` | תבניות המיילים ושליחה דרך Resend |
| `schema.sql` | טבלאות + האתרים והתוכניות הקיימים |
| `public/` | דף ההתחברות/חשבון, הדשבורד, ו-`sdk.js` |

**אבטחה:** סיסמאות ב-PBKDF2-SHA256 (100K סבבים) · טוקנים נשמרים רק כ-hash · קישורי מייל חד-פעמיים עם תפוגה · הגבלת ניסיונות · PKCE · הגנת CSRF · אתר מקבל גישה רק אחרי אימות מייל.

**מגבלות חינמיות:** Workers — 100K בקשות ביום · D1 — 5GB, 5M קריאות ביום · Resend — 100 מיילים ביום.
