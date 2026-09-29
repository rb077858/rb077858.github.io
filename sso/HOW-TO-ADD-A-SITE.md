# איך מוסיפים את ההתחברות לפרויקט או לאתר חדש

שני שלבים: רושמים את האתר בדשבורד, ומדביקים קוד קצר בפרויקט.

> 💡 רוצה ש-Claude יעשה את זה בשבילך? הדבק בשיחה חדשה (שמחוברת למאגר של הפרויקט) את הפרומפט מ-[`ADD-SITE-PROMPT.md`](ADD-SITE-PROMPT.md).

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

### תוכניות (אופציונלי)
אחרי השמירה פתח את האתר ברשימה ← **תוכניות** ← הוסף שורות:

| מזהה | שם | הרשאות (JSON) |
|---|---|---|
| `my-app:free` | Free | `{"limit": 10}` |
| `my-app:pro` | Pro | `{"limit": 100, "export": true}` |

אחר כך, בהגדרות האתר, בחר ב-**תוכנית ברירת מחדל** את `my-app:free`. את ה-JSON אתה ממציא לפי מה שהפרויקט צריך, והקוד שלך קורא אותו.

💡 בכרטיס של כל אתר יש כפתור **"קוד הטמעה"** שמראה את הקוד המוכן עם ה-client_id שלו.

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
