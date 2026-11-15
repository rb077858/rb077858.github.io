# מסנן המיילים של reem.bi

Email Worker של Cloudflare שרץ על כל מייל שמגיע ל-`support@reembir.com` ול-`contact@reembir.com`.
OpenAI בודק אם התוכן **מתאים לילד בן 14**:

| תוכן | מה קורה |
|---|---|
| מתאים (שאלות, תלונות, ביקורת חריפה, כעס, סרקזם) | מועבר לתיבה שלך כרגיל |
| לא מתאים (קללות וגסויות, תוכן מיני, אלימות ואיומים, שנאה, הטרדה, פגיעה עצמית, סמים והימורים) | מועבר לאותה תיבה עם `+restricted` לפני ה-@ |
| לא הצלחנו לבדוק (OpenAI לא זמין) | כמו "לא מתאים": מגיע ל-`+restricted`, לא הולך לאיבוד ולא נכנס כאילו הכול בסדר |

שום מייל לא נמחק ולא נדחה. טעות של המודל רק שמה מייל תחת התווית.

## התקנה (פעם אחת)

**1. יצירת ה-Worker מהריפו.** ב-Cloudflare: Workers & Pages ← Create ← Import a repository ← `rb077858.github.io`.
שם: `reem-mail-filter`. **Root directory:** `mailfilter`. אחרי היצירה, ב-Settings ← Build ← Build watch paths הוסף `mailfilter/*`
(כדי שהוא ייבנה רק כשמשהו בתיקייה הזו משתנה).

**2. משתנים.** ב-Worker: Settings ← Variables and secrets ← Add (סוג **Secret**):
- `OPENAI_API_KEY`: מפתח OpenAI. מומלץ מפתח ייעודי בפרויקט נפרד עם תקציב חודשי נמוך.
- `DEST_OK`: כתובת ה-Gmail שלך (`name@gmail.com`, עם `.com`).

אופציונלי: `OPENAI_MODEL` (ברירת מחדל `gpt-5-mini`), `DEST_RESTRICTED` (אם הכתובת עם ה-`+restricted` לא צריכה להיגזר מ-`DEST_OK`).

**3. אימות הכתובת עם ה-`+restricted`.** Email Routing ← Destination addresses ← Add: `name+restricted@gmail.com`.
Cloudflare תשלח אליה מייל אימות (הוא יגיע לתיבה הרגילה שלך). לחץ על הקישור.

**4. הפניית הכתובות ל-Worker.** Email Routing ← Routing rules: ל-`support@` ול-`contact@` שנה Action ל-**Send to a Worker** ← `reem-mail-filter`.

**5. מסנן ב-Gmail.** Settings ← Filters and blocked addresses ← Create a new filter:
בשדה **To** כתוב `name+restricted@gmail.com`, ובפעולה בחר Apply the label (צור תווית "restricted"), ואם תרצה גם Skip the Inbox.

**6. בדיקה.** שלח לכתובת support@ מייל רגיל ומייל עם קללה, ממשתמש אחר. הראשון בתיבה, השני בתווית.
ב-Worker ← Logs רואים כל החלטה (שולח, יעד, החלטה, קטגוריה, לא התוכן).

## חזרה אחורה
Email Routing ← Routing rules ← שנה את הכתובות בחזרה ל-"Send to an email". אין צורך למחוק את ה-Worker.

## איך זה עובד
- נקרא רק תחילת המייל (עד 256KB) ועד 6,000 תווי טקסט נשלחים ל-OpenAI, עם `store: false`. קבצים מצורפים ותמונות **לא נבדקים**, רק שמות הקבצים.
- ההנחיה למודל: `src/index.js` (`INSTRUCTIONS`). אפשר לשנות בה את הכללים. טקסט בתוך המייל נחשב מידע בלבד ולא הוראות.
- בדיקות: `npm test` (עם OpenAI מדומה).
