# איך מוסיפים את ההתחברות לפרויקט או לאתר חדש

> 💡 **הדרך הקלה:** בשיחה חדשה עם Claude שמחוברת לפרויקט כתוב: "לשילוב מערכת ההתחברות שלי באתר קרא: https://raw.githubusercontent.com/rb077858/rb077858.github.io/main/sso/INTEGRATE.md". הוא יעשה הכול ויגיד לך מה לרשום בדשבורד.
שני שלבים: רושמים את האתר בדשבורד, ומדביקים קוד קצר בפרויקט.


---

## שלב 1: רישום האתר בדשבורד

1. היכנס ל-**https://login.reembir.com/admin** ← לשונית **אתרים** ← **+ אתר חדש**.
2. מלא:

| שדה | מה לכתוב | דוגמה |
|---|---|---|
| **מזהה (client_id)** | שם קצר באנגלית, אותיות קטנות, ספרות ומקף. אי אפשר לשנות אחר כך | `my-app` |
| **שם** | השם שמופיע במסך ההתחברות ("כדי להמשיך ל-…") | `My App` |
| **כתובת האתר** | לאן לחזור מדף החשבון | `https://reembir.com/my-app/` |
| **תיאור** | שורה קצרה במסך "המשך ל-…" | `ניהול משימות` |
| **כתובות חזרה מותרות** | כל כתובת שממנה מתחברים, בשורה נפרדת | ראה למטה |
| **מי יכול להיכנס** | **פתוח**: כל מי שנרשם נכנס. **באישור**: כל בקשה מחכה לאישור שלך. **בהזמנה**: רק מי שנתת לו גישה ידנית | `פתוח` |

3. לחץ **יצירת אתר**.

### כתובות חזרה: החלק החשוב
זו הכתובת של הדף שבו נמצא כפתור ההתחברות. בלעדיה תקבל שגיאה "כתובת החזרה לא מאושרת".
- **כתובת שמסתיימת ב-`/`** מאשרת את כל הדפים שמתחתיה. `https://reembir.com/my-app/` מכסה גם את `https://reembir.com/my-app/settings.html`.
- **אם האתר נגיש מכמה כתובות,** רשום את כולן:
  ```
  https://reembir.com/my-app/
  https://rb077858.github.io/my-app/
  ```
- **דומיין אחר** (לא reembir.com) עובד גם כן, למשל `https://my-other-site.com/`.
- **לבדיקות במחשב** אפשר להוסיף `http://localhost:5500/` (מותר רק ל-localhost בלי https).

### תוכניות ומחירים (אופציונלי)
אחרי היצירה תגיע לדף של האתר ← לשונית **תוכניות ומחירים** ← הוסף תוכניות:

| מזהה | שם | מחיר לחודש | הרשאות (JSON, תחת "מתקדם") |
|---|---|---|---|
| `my-app:free` | Free | ריק | `{"limit": 10}` |
| `my-app:pro` | Pro | 19 | `{"limit": 100, "export": true}` |

- תוכנית **עם מחיר** נמכרת כמנוי חודשי דרך ה-PayPal המרכזי. התוכנית ב-PayPal נוצרת לבד, והאתר מציג אותה עם `auth.billing` (ראה [`INTEGRATE.md`](INTEGRATE.md)).
- **"תוכנית למשתמשים חדשים"** (למעלה באותה לשונית): בדרך כלל החינמית.
- **קודי קופון ומנויים:** בלשוניות **קופונים** ו**מנויים** של האתר.
- את ה-JSON אתה ממציא לפי מה שהפרויקט צריך, והקוד שלך קורא אותו.

💡 בלשונית **הגדרות** של כל אתר יש כפתור **"קוד הטמעה"** שמראה את הקוד המוכן עם ה-client_id שלו.

---

## שלב 2: הקוד בפרויקט

זו דוגמה מלאה לדף. העתק ושנה את `my-app` למזהה שלך:

```html
<!-- כפתורים ומקום להציג את המשתמש -->
<button id="loginBtn">התחברות</button>
<button id="logoutBtn" hidden>התנתקות</button>
<div id="userBox" hidden></div>

<!-- 1. טוענים את הספרייה -->
<script src="https://login.reembir.com/sdk.js"></script>

<script>
  // 2. מתחברים עם המזהה של האתר
  const auth = ReemAuth.init({ clientId: 'my-app' });

  // 3. מגיבים כשמשתמש מתחבר או מתנתק
  auth.onChange(user => {
    const loggedIn = !!user;
    document.getElementById('loginBtn').hidden = loggedIn;
    document.getElementById('logoutBtn').hidden = !loggedIn;
    document.getElementById('userBox').hidden = !loggedIn;

    if (user) {
      document.getElementById('userBox').textContent = 'שלום ' + user.name + ' (' + user.email + ')';

      // התוכנית וההרשאות מהדשבורד:
      console.log(user.plan);      // { id: 'my-app:pro', name: 'Pro' }  או null
      console.log(user.features);  // { limit: 100, export: true }

      if (user.features.export) {
        // להציג כפתור שרק ל-Pro יש
      }
    }
  });

  // 4. כפתורים
  document.getElementById('loginBtn').onclick = () => auth.login();
  document.getElementById('logoutBtn').onclick = () => auth.logout();
</script>
```

זהו. לחיצה על "התחברות" שולחת את המשתמש ל-login.reembir.com, ואחרי ההתחברות הוא חוזר לאותו דף, מחובר. מי שכבר מחובר באתר אחר שלך נכנס בלחיצה אחת.

### מה עוד אפשר לעשות עם `auth`

| פקודה | מה היא עושה |
|---|---|
| `auth.login()` | שולחת להתחברות וחוזרת לאותו דף |
| `auth.login({ returnTo: 'https://…/page.html#section' })` | חוזרת לכתובת אחרת אחרי ההתחברות |
| `auth.logout()` | מתנתקת מהאתר הזה בלבד |
| `auth.user` | המשתמש הנוכחי (`null` אם לא מחובר, `undefined` בזמן טעינה) |
| `await auth.ready` | מחכה עד שידוע אם יש משתמש מחובר |
| `auth.refresh()` | טוען מחדש את התוכנית. שינוי בדשבורד מופיע גם בטעינה הבאה של הדף |
| `auth.accountUrl()` | קישור לדף החשבון (שינוי סיסמה, Google וכו') |
| `auth.getToken()` | טוקן לשליחה לשרת משלך (ראה למטה) |
| `auth.api(path, { body })` | קריאה ל-API של login.reembir.com בשם המשתמש |
| `auth.getFirebaseToken()` | טוקן ל-`signInWithCustomToken` בפרויקטים עם Firebase |

---

## מקרים מיוחדים

### פרויקט עם שרת משלו
אם יש לפרויקט שרת (Worker, Node וכו'), אל תסמוך על מה שהדפדפן אומר על המשתמש. שלח מהדפדפן את הטוקן:
```js
fetch('/my-api/save', { headers: { Authorization: 'Bearer ' + auth.getToken() } });
```
השרת בודק מול login.reembir.com מי המשתמש:
```js
const res = await fetch('https://login.reembir.com/api/userinfo', {
  headers: { Authorization: request.headers.get('Authorization') }
});
if (!res.ok) return new Response('לא מחובר', { status: 401 });
const { user, access } = await res.json();   // user.email, access.features.limit ...
```

### שרת שמעדכן תוכניות של משתמשים (מפתח שרת)
כשלפרויקט יש שרת שגובה תשלום בעצמו (למשל מנוי ב-PayPal), השרת יכול לקבוע למשתמש תוכנית עם תאריך תפוגה. כך כל המנויים מופיעים בדשבורד, ואפשר לנהל אותם משם.
1. בדשבורד: **אתרים** ← האתר ← **מפתח שרת** ← **יצירת מפתח**. המפתח (מתחיל ב-`rsk_`) מוצג פעם אחת בלבד.
2. שומרים אותו כסוד בשרת של הפרויקט, למשל `SSO_SITE_KEY` ב-Cloudflare.
3. השרת שולח את המפתח בכותרת `x-site-key`:
```js
// קביעת תוכנית (plan_id: null = חזרה לברירת המחדל; expires_at בשניות, null = בלי תפוגה)
await fetch('https://login.reembir.com/api/site/access', {
  method: 'PUT',
  headers: { 'x-site-key': env.SSO_SITE_KEY, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'user@example.com', plan_id: 'my-app:pro', expires_at: 1767225600 }),
});
// GET /api/site/access?email=…   → התוכנית הנוכחית של משתמש
// GET /api/site/plans            → התוכניות של האתר (עם ה-JSON שלהן)
```
- המפתח עובד **רק על האתר שלו**: אי אפשר לקבוע איתו תוכנית של אתר אחר, ואי אפשר לבטל חסימה של משתמש.
- המשתמש צריך להיות רשום ב-reem.bi (אחרת מתקבלת שגיאה 404).
- אם המפתח דלף: **החלפת מפתח** בדשבורד. הישן מפסיק לעבוד מיד.

### לוח ניהול של האתר בתוך הדשבורד
אתר עם שרת יכול להוסיף לדף שלו בדשבורד (**אתרים** ← האתר ← **סקירה**) סטטיסטיקות, בדיקות הגדרות ופעולות משלו. אתר עם דף ניהול בדפדפן יכול להופיע בלשונית **ניהול האתר**, מחובר אוטומטית (הגדרות ← כתובת ממשק הניהול). הפירוט המלא ב-[`INTEGRATE.md`](INTEGRATE.md), סעיף 5.

**איך זה עובד:** הדשבורד מקבל טוקן קצר (שעה) על האתר בשם המנהל המחובר, וקורא מהדפדפן לכתובות של האתר. הכתובות יחסיות ל**כתובת האתר** שבהגדרות (למשל `https://my-app.reembir.com/` ← `https://my-app.reembir.com/api/admin/manifest`). האתר צריך:
1. לבדוק את הטוקן מול `/api/userinfo` כמו בכל התחברות, ולהחליט בעצמו מי מנהל (למשל רשימת `ADMIN_EMAILS`).
2. לאפשר CORS ל-`https://login.reembir.com` בנתיבים `/api/admin/*`, כולל `OPTIONS` והכותרות `Authorization, Content-Type`.
3. להחזיר ב-`GET api/admin/manifest` תיאור של מה להציג:
```js
{
  version: 1,
  links:   [{ label: 'פתיחת האתר', url: 'https://…' }],
  stats:   [{ label: 'מנויים פעילים', value: 12 }],
  checks:  [{ label: 'OPENAI_API_KEY', ok: true, detail: 'מוגדר' }],
  actions: [{ id: 'paypal-setup', label: '…', description: '…', confirm: 'בטוח?', primary: true }],   // POST api/admin/actions/<id> → { message }
  lists:   [{ title: 'מנויים אחרונים', empty: 'אין', items: [{ title, subtitle, date /* ms */, dateLabel, badge, badgeLevel: 'green' | 'red' | '' }] }],
}
```
כל החלקים לא חובה. אתר שלא עונה על `api/admin/manifest` פשוט לא מקבל חלק נוסף בדף שלו. דוגמה מלאה: `src/index.js` במאגר `rb077858/timlul` (הפונקציה `adminManifest`).

### פרויקט ששומר נתונים ב-Firebase (כמו NeverLost)
1. בדפדפן, אחרי שהמשתמש מחובר:
   ```js
   const token = await auth.getFirebaseToken();
   await signInWithCustomToken(getAuth(), token);
   ```
2. ב-Cloudflare (Worker **reem-sso** ← Settings ← Variables and Secrets) הוסף סוד עם מפתח ה-Service Account של אותו פרויקט Firebase:
   - שם הסוד: `FIREBASE_SA_` ואחריו המזהה באותיות גדולות, כשמקף הופך לקו תחתון. למשל לאתר `my-app` השם הוא `FIREBASE_SA_MY_APP`.
   - אם זה אותו פרויקט Firebase כמו של NeverLost, אין צורך בסוד נוסף (משתמשים ב-`FIREBASE_SERVICE_ACCOUNT`).
3. בחוקי Firestore המייל של המשתמש זמין כ-`request.auth.token.sso_email`. ראה את `firestore.rules` ב-NeverLost כדוגמה.

---

## אם משהו לא עובד

| מה רואים | מה לעשות |
|---|---|
| "כתובת החזרה לא מאושרת" | הכתובת של הדף לא ברשימת כתובות החזרה של האתר. הוסף אותה בדשבורד, עם `/` בסוף |
| "האתר שביקש את ההתחברות לא מוכר" | ה-`clientId` בקוד לא זהה למזהה בדשבורד |
| "אין גישה" | האתר מוגדר "בהזמנה" והמשתמש לא נוסף, או שהוא חסום. תן גישה במשתמשים ← האתר |
| "הבקשה נשלחה" | האתר מוגדר "באישור". אשר אותו בדשבורד ← סקירה |
| `ReemAuth is not defined` | שורת ה-`<script src="https://login.reembir.com/sdk.js">` חסרה, או שהיא מתחת לקוד שמשתמש בה |
