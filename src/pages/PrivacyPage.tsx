import { useNavigate } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'

const LAST_UPDATED = '28 באפריל 2026'

export default function PrivacyPage() {
  const navigate = useNavigate()

  return (
    <div className="flex-1" style={{ background: 'var(--c-bg)' }}>
      {/* Header */}
      <div style={{ background: 'var(--c-surface)', borderBottom: '1px solid var(--c-border)', padding: '16px 20px', position: 'sticky', top: 0, zIndex: 20 }}>
        <div className="flex items-center gap-3 max-w-2xl mx-auto">
          <button onClick={() => navigate(-1)} className="p-2 rounded-full hover:bg-gray-100 transition-colors">
            <ArrowRight className="w-5 h-5" style={{ color: 'var(--c-text2)' }} />
          </button>
          <div>
            <h1 className="text-lg font-bold" style={{ color: 'var(--c-text)' }}>מדיניות פרטיות</h1>
            <p className="text-xs" style={{ color: 'var(--c-text3)' }}>עודכן לאחרונה: {LAST_UPDATED}</p>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-2xl mx-auto px-5 py-6 pb-28 space-y-8" dir="rtl">

        <section>
          <p style={{ color: 'var(--c-text2)', lineHeight: 1.8, fontSize: 14 }}>
            GiftSmart ("האפליקציה", "אנו", "השירות") מחויבת לשמירה על פרטיותך. מדיניות זו מסבירה
            אילו מידע אנו אוספים, כיצד אנו משתמשים בו, כיצד אנו מגינים עליו, ומהן זכויותיך.
            השימוש באפליקציה מהווה הסכמה למדיניות זו.
          </p>
        </section>

        <Section title="1. המידע שאנו אוספים">
          <SubSection title="א. פרטי חשבון">
            <ul>
              <li><strong>כתובת דוא"ל</strong> — נדרשת לצורך הרישום, ההתחברות ושליחת התראות.</li>
              <li><strong>שם תצוגה</strong> — שם שתבחר להציג בפרופיל שלך.</li>
              <li><strong>מספר טלפון</strong> — אופציונלי, לצורך תכונות שיתוף ושוק.</li>
              <li><strong>סיסמה</strong> — מאוחסנת בהצפנה על ידי Supabase; איננו רואים אותה.</li>
            </ul>
          </SubSection>
          <SubSection title="ב. נתוני שוברים">
            <ul>
              <li>שם חנות, יתרה, קוד שובר, CVV/PIN, תאריך פקיעה, קישור, הערות וקטגוריות.</li>
              <li>קודי שובר ו-CVV ניתנים להצפנה מקצה לקצה (E2EE) — במצב זה השרת שומר גרסה מוצפנת בלבד, שרק המשתמש המחזיק בסיסמת הכספת יכול לפענח.</li>
            </ul>
          </SubSection>
          <SubSection title="ג. יומן פעילות">
            <p>אנו מתעדים פעולות כגון: הוספה, עריכה, עדכון יתרה, ארכוב, מחיקה, שיתוף, שליחת מתנה וכן שינויים בהגדרות אבטחה — לצרכי תמיכה, אבטחה ואיתור תקלות. הרשומות כוללות חותמת זמן וסוג הפעולה.</p>
          </SubSection>
          <SubSection title="ד. נתוני שיתוף ושוק">
            <ul>
              <li>כתובות דוא"ל של מוזמנים לשיתוף ארנק.</li>
              <li>כתובות דוא"ל של נמעני מתנות.</li>
              <li>שיטות תשלום בשוק (PayPal, Bit, Paybox, Cashcash, Lavi) — דוא"ל או טלפון.</li>
              <li>דירוגים ודיווחים בשוק.</li>
            </ul>
          </SubSection>
          <SubSection title="ה. מידע טכני מקומי">
            <ul>
              <li><strong>localStorage</strong>: מטמון שוברים, פעולות ממתינות (offline), הגדרות נגישות, מזהי מלחת הצפנה (salt), רמז לסיסמת כספת, מזהה Biometric (WebAuthn).</li>
              <li><strong>sessionStorage</strong>: מטמון פרופיל משתמש, סיסמת כספת זמנית (נמחקת בסגירת הלשונית).</li>
              <li>מידע זה נשמר על המכשיר שלך בלבד ואינו מועלה לשרת.</li>
            </ul>
          </SubSection>
        </Section>

        <Section title="2. כיצד אנו משתמשים במידע">
          <ul>
            <li>הפעלת השירות: ניהול שוברים, עדכון יתרות, שיתוף, שוק.</li>
            <li>שליחת תזכורות דוא"ל לפני תפוגת שוברים (לפי הגדרת המשתמש).</li>
            <li>שליחת הודעות שיתוף, הזמנה לארנק ומתנה.</li>
            <li>תמיכה טכנית — בעת פנייה לתמיכה, הודעתך נשמרת עם פרטי הפנייה.</li>
            <li>שיפור השירות — ניתוח אנונימי של שימוש.</li>
            <li><strong>אנו לא משתמשים במידע לפרסום ממוקד ולא מוכרים אותו לצד שלישי כלשהו.</strong></li>
          </ul>
        </Section>

        <Section title="3. שירותי צד שלישי">
          <table>
            <thead>
              <tr><th>שירות</th><th>מטרה</th><th>מה מועבר</th></tr>
            </thead>
            <tbody>
              <tr>
                <td><strong>Supabase</strong></td>
                <td>מסד נתונים, אימות, Real-time</td>
                <td>כלל הנתונים המפורטים לעיל</td>
              </tr>
              <tr>
                <td><strong>Google OAuth</strong></td>
                <td>התחברות עם Google</td>
                <td>דוא"ל ושם Google (לפי הרשאה)</td>
              </tr>
              <tr>
                <td><strong>שירות דוא"ל</strong></td>
                <td>שליחת מיילים</td>
                <td>כתובת דוא"ל + תוכן ההודעה</td>
              </tr>
              <tr>
                <td><strong>Telegram Bot</strong></td>
                <td>קבלת התראות ב-Telegram</td>
                <td>קוד חיבור חד-פעמי (6 ספרות, תוקף 10 דקות)</td>
              </tr>
              <tr>
                <td><strong>Web Crypto API</strong></td>
                <td>הצפנת E2EE (מקומי)</td>
                <td>פועל על המכשיר בלבד — אין העברה</td>
              </tr>
              <tr>
                <td><strong>WebAuthn / Biometric</strong></td>
                <td>כניסה ביומטרית</td>
                <td>פועל על המכשיר בלבד — אין העברה</td>
              </tr>
            </tbody>
          </table>
          <p className="mt-3">Supabase פועלת בתשתית AWS ועומדת בתקנות GDPR. מדיניות הפרטיות שלה זמינה בכתובת <a href="https://supabase.com/privacy" target="_blank" rel="noreferrer" className="text-green-600 underline">supabase.com/privacy</a>.</p>
        </Section>

        <Section title="4. הצפנה מקצה לקצה (E2EE)">
          <ul>
            <li>המשתמש רשאי להצפין קודי שובר ו-CVV על המכשיר לפני שמירה בשרת.</li>
            <li>ההצפנה מתבצעת באמצעות AES-GCM-256 עם מפתח גזור מסיסמת המשתמש (PBKDF2).</li>
            <li>הסיסמה <strong>אינה</strong> נשמרת בשרת. אם תשכח את הסיסמה, לא ניתן לשחזר את הנתונים המוצפנים.</li>
            <li>בעת שיתוף שובר מוצפן, הקוד המפוענח נשמר זמנית בשרת לאותה רשומת שיתוף בלבד, ונמחק עם סיום השיתוף.</li>
          </ul>
        </Section>

        <Section title="5. אבטחת מידע">
          <ul>
            <li>כל התקשורת מוצפנת ב-TLS (HTTPS).</li>
            <li>הסיסמאות מאוחסנות כ-hash (bcrypt) על ידי Supabase — אנו לא רואים אותן.</li>
            <li>גישה לנתונים מוגנת על ידי Row Level Security (RLS) — כל משתמש ניגש לנתוניו בלבד.</li>
            <li>המידע המקומי (localStorage/sessionStorage) מוגן על ידי אבטחת הדפדפן.</li>
            <li>ביומטריה (WebAuthn) פועלת מקומית על המכשיר ואינה נשלחת לשרתינו.</li>
          </ul>
        </Section>

        <Section title="6. שמירת מידע">
          <ul>
            <li><strong>נתוני חשבון ושוברים</strong> — נשמרים כל עוד החשבון פעיל.</li>
            <li><strong>יומן פעילות</strong> — נשמר עד 12 חודשים.</li>
            <li><strong>הודעות תמיכה</strong> — נשמרות עד 24 חודשים לאחר סגירת הפנייה.</li>
            <li><strong>מטמון מקומי</strong> — נמחק אוטומטית בעת התנתקות.</li>
            <li><strong>קודי Telegram</strong> — תוקף 10 דקות ונמחקים לאחר מכן.</li>
          </ul>
        </Section>

        <Section title="7. זכויות המשתמש">
          <ul>
            <li><strong>עיון</strong> — ניתן לצפות בכל נתוני החשבון והשוברים ישירות באפליקציה.</li>
            <li><strong>תיקון</strong> — ניתן לערוך שם, טלפון, ושוברים בכל עת.</li>
            <li><strong>מחיקה</strong> — לבקשת מחיקת חשבון ונתונים, פנה לתמיכה מתוך הגדרות → תמיכה. הנתונים יימחקו תוך 30 יום.</li>
            <li><strong>ניידות נתונים</strong> — ניתן לפנות לתמיכה לקבלת ייצוא נתוניך בפורמט JSON.</li>
            <li><strong>ביטול הסכמה להתראות</strong> — ניתן לבטל תזכורות דוא"ל בכל עת מהגדרות → התראות.</li>
          </ul>
        </Section>

        <Section title="8. פרטיות ילדים">
          <p>השירות אינו מיועד לילדים מתחת לגיל 13. אם נודע לנו שאספנו מידע ממשתמש מתחת לגיל זה, נמחק אותו לאלתר.</p>
        </Section>

        <Section title="9. שינויים במדיניות">
          <p>נודיע על שינויים מהותיים במדיניות זו בדוא"ל ו/או בהתראה באפליקציה לפחות 7 ימים מראש. המשך השימוש לאחר כניסת השינוי לתוקף מהווה הסכמה למדיניות המעודכנת.</p>
        </Section>

        <Section title="10. יצירת קשר">
          <p>לשאלות בנוגע לפרטיות, מחיקת נתונים, או ניידות נתונים — פנה אלינו דרך:</p>
          <ul>
            <li>הגדרות → תמיכה (בתוך האפליקציה)</li>
          </ul>
        </Section>

        <p className="text-xs text-center" style={{ color: 'var(--c-text3)' }}>
          מדיניות פרטיות זו נכנסה לתוקף ב-{LAST_UPDATED}.
        </p>
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-base font-bold mb-3" style={{ color: 'var(--c-text)' }}>{title}</h2>
      <div className="text-sm leading-relaxed space-y-2" style={{ color: 'var(--c-text2)' }}>
        {children}
      </div>
    </section>
  )
}

function SubSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-3">
      <h3 className="font-semibold mb-1" style={{ color: 'var(--c-text)' }}>{title}</h3>
      {children}
    </div>
  )
}
