import { useNavigate } from 'react-router-dom'
import { ChevronRight, Check, AlertCircle, Info } from 'lucide-react'

const LAST_UPDATED = 'אוגוסט 2026'

export default function AccessibilityPage() {
  const navigate = useNavigate()

  return (
    <div className="flex-1 bg-gray-50" dir="rtl">
      {/* Header */}
      <div className="bg-white border-b sticky top-0 z-30 px-4 py-4">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate(-1)}
            aria-label="חזור לדף הקודם"
            className="p-2 -mr-2 rounded-xl hover:bg-gray-100 transition-colors"
          >
            <ChevronRight className="w-5 h-5 text-gray-600" aria-hidden="true" />
          </button>
          <h1 className="text-xl font-bold text-gray-900">הצהרת נגישות</h1>
        </div>
      </div>

      <div className="p-4 pb-28 max-w-2xl mx-auto space-y-6">

        {/* Intro */}
        <div className="bg-white rounded-3xl shadow-sm p-5">
          <h2 className="text-base font-bold text-gray-800 mb-2">אודות הנגישות באתר GiftSmart</h2>
          <p className="text-sm text-gray-600 leading-relaxed">
            GiftSmart מחויבת לנגישות שירותי האינטרנט לאנשים עם מוגבלויות.
            אנו פועלים להנגשת האתר בהתאם לתקן הישראלי <strong>ת"י 5568</strong> ולהנחיות
            הבינלאומיות <strong>WCAG 2.1 ברמת AA</strong>.
          </p>
          <p className="text-sm text-gray-500 mt-2">
            הצהרה זו עודכנה לאחרונה: <time dateTime="2026-08">{LAST_UPDATED}</time>
          </p>
        </div>

        {/* What was done */}
        <div className="bg-white rounded-3xl shadow-sm p-5">
          <h2 className="text-base font-bold text-gray-800 mb-3">התאמות שבוצעו</h2>
          <ul className="space-y-2.5" role="list">
            {[
              'הוספת תגית <main> ו-skip link לדלג לתוכן הראשי',
              'כותרות היררכיות (h1–h2) בכל עמוד',
              'תוויות נגישות (aria-label) לכל כפתורי האיקון',
              'חיבור שדות טפסים לתוויות (label + htmlFor)',
              'ניהול פוקוס ו-focus trap בחלונות דו-שיח',
              'תמיכה בסגירת דיאלוג עם מקש Escape',
              'כפתור נגישות צף עם אפשרויות: גודל טקסט, ניגודיות גבוהה, עצירת אנימציות',
              'תמיכה ב-prefers-reduced-motion',
              'כבוד ל-RTL מלא בכל הרכיבים',
              'אינדיקטור פוקוס מוגבר בניווט מקלדת (מצב "הדגשת פוקוס")',
              'סמנטיקה של nav, h1, main ו-aria-live לאזורים דינמיים',
            ].map(item => (
              <li key={item} className="flex items-start gap-2.5 text-sm text-gray-700">
                <Check className="w-4 h-4 text-green-500 mt-0.5 flex-shrink-0" aria-hidden="true" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* Known issues */}
        <div className="bg-white rounded-3xl shadow-sm p-5">
          <h2 className="text-base font-bold text-gray-800 mb-3">אזורים שטרם הונגשו במלואם</h2>
          <ul className="space-y-4" role="list">
            <li className="flex items-start gap-2.5 text-sm text-gray-700">
              <AlertCircle className="w-4 h-4 text-orange-400 mt-0.5 flex-shrink-0" aria-hidden="true" />
              <div>
                <strong>סורק QR/ברקוד במצלמה:</strong>
                <p className="mt-1 text-gray-600 leading-relaxed">
                  בשל מגבלות טכנולוגיות של רכיב הסריקה, ייתכן קושי בשימוש בקורא מסך.
                  חלופה נגישה: ניתן להזין את קוד השובר והפרטים באופן ידני בכל עת דרך כפתור
                  "הוספה ידנית", וכן לצפות בפרטי הקוד בטקסט קריא בתוך דף השובר.
                </p>
              </div>
            </li>
            <li className="flex items-start gap-2.5 text-sm text-gray-700">
              <AlertCircle className="w-4 h-4 text-orange-400 mt-0.5 flex-shrink-0" aria-hidden="true" />
              <span><strong>ניגודיות טקסט אפור קטן (text-gray-400):</strong> חלק מטקסטי העזר האפורים עשויים להיות מתחת ליחס 4.5:1 — בבדיקה ותיקון.</span>
            </li>
            <li className="flex items-start gap-2.5 text-sm text-gray-700">
              <AlertCircle className="w-4 h-4 text-orange-400 mt-0.5 flex-shrink-0" aria-hidden="true" />
              <span><strong>תרשימי סטטיסטיקות:</strong> גרפים ותרשימים טרם כוללים תיאור טקסטואלי חלופי מלא.</span>
            </li>
          </ul>
        </div>

        {/* Conformance */}
        <div className="bg-white rounded-3xl shadow-sm p-5">
          <h2 className="text-base font-bold text-gray-800 mb-2">רמת התאימות</h2>
          <div className="flex items-center gap-2 mb-2">
            <Info className="w-4 h-4 text-blue-500" aria-hidden="true" />
            <p className="text-sm text-gray-700">
              האתר עומד <strong>באופן חלקי</strong> בדרישות WCAG 2.1 רמת AA.
            </p>
          </div>
          <p className="text-xs text-gray-500">
            אנו עובדים באופן שוטף על שיפור הנגישות ומתכוונים להגיע לתאימות מלאה.
          </p>
        </div>

        {/* Accessibility coordinator */}
        <div className="bg-white rounded-3xl shadow-sm p-5">
          <h2 className="text-base font-bold text-gray-800 mb-3">רכז נגישות</h2>
          <p className="text-sm text-gray-600 mb-3">
            נתקלת בבעיית נגישות? פנה אלינו:
          </p>
          <div className="space-y-2 text-sm">
            <div className="flex items-center gap-2">
              <span className="text-gray-500 w-12">שם:</span>
              <span className="text-gray-800">רכז הנגישות של GiftSmart</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-gray-500 w-12">מייל:</span>
              <a
                href="mailto:accessibility@giftsmart.co.il"
                className="text-blue-600 hover:underline"
                dir="ltr"
              >
                accessibility@giftsmart.co.il
              </a>
            </div>
          </div>
          <p className="text-xs text-gray-500 mt-3">
            נשתדל להשיב לכל פנייה בתוך 48 שעות.
          </p>
        </div>

        {/* Standards reference */}
        <div className="bg-blue-50 rounded-3xl p-4">
          <p className="text-xs text-blue-700 leading-relaxed">
            הצהרה זו נכתבה בהתאם לדרישות תקנות שיווי זכויות לאנשים עם מוגבלות (התאמות נגישות לשירות),
            התשע"ג-2013, ובהתאם לתקן ישראלי ת"י 5568 המבוסס על WCAG 2.1.
          </p>
        </div>

        {/* Closing commitment */}
        <div className="bg-green-50 rounded-3xl p-5">
          <p className="text-sm text-green-800 leading-relaxed">
            אנו ממשיכים במאמצים לשפר את נגישות השירות כחלק ממחויבותנו לאפשר לכלל האוכלוסייה,
            כולל אנשים עם מוגבלויות, לקבל את השירות הנגיש ביותר.
            אם נתקלתם בקושי, נשמח לשמוע על כך.
          </p>
        </div>

      </div>
    </div>
  )
}
