import { useNavigate } from 'react-router-dom'
import { ChevronRight, Check, AlertCircle, Info } from 'lucide-react'

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
            הצהרה זו עודכנה לאחרונה: <time dateTime="2026-03-25">מרץ 2026</time>
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
          <ul className="space-y-2.5" role="list">
            {[
              {
                issue: 'סורק QR/ברקוד במצלמה',
                reason: 'מוגבלות טכנית של ספריית הסריקה (Html5Qrcode) — אין תמיכה מלאה בקוראי מסך.',
              },
              {
                issue: 'ניגודיות טקסט אפור קטן (text-gray-400)',
                reason: 'חלק מטקסטי העזר האפורים עשויים להיות מתחת ליחס 4.5:1 — בבדיקה ותיקון.',
              },
              {
                issue: 'תרשימי סטטיסטיקות',
                reason: 'גרפים ותרשימים טרם כוללים תיאור טקסטואלי חלופי מלא.',
              },
            ].map(({ issue, reason }) => (
              <li key={issue} className="flex items-start gap-2.5 text-sm text-gray-700">
                <AlertCircle className="w-4 h-4 text-orange-400 mt-0.5 flex-shrink-0" aria-hidden="true" />
                <span><strong>{issue}:</strong> {reason}</span>
              </li>
            ))}
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
            <div className="flex items-center gap-2">
              <span className="text-gray-500 w-12">טלפון:</span>
              <a href="tel:+972-XX-XXXXXXX" className="text-blue-600 hover:underline" dir="ltr">
                XX-XXXXXXX
              </a>
            </div>
          </div>
          <p className="text-xs text-gray-400 mt-3">
            * יש לעדכן את פרטי רכז הנגישות בהתאם לפרטי הארגון בפועל.
          </p>
        </div>

        {/* Standards reference */}
        <div className="bg-blue-50 rounded-3xl p-4">
          <p className="text-xs text-blue-700 leading-relaxed">
            הצהרה זו נכתבה בהתאם לדרישות תקנות שיווי זכויות לאנשים עם מוגבלות (התאמות נגישות לשירות),
            התשע"ג-2013, ובהתאם לתקן ישראלי ת"י 5568 המבוסס על WCAG 2.1.
          </p>
        </div>

      </div>
    </div>
  )
}
