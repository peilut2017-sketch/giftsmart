import { useState, useEffect } from 'react'
import { X, Shield } from 'lucide-react'

interface Props {
  userId: string
}

const FEATURES = [
  { icon: '🎁', title: 'ניהול שוברים וגיפט קארדים', desc: 'הוסף, ערוך ועקוב אחרי כל השוברים שלך במקום אחד' },
  { icon: '📷', title: 'סריקת ברקוד / QR', desc: 'סרוק שובר ישירות עם המצלמה בלי להקליד ידנית' },
  { icon: '📨', title: 'חילוץ מ-SMS ומייל', desc: 'הדבק הודעת SMS — הפרטים יחולצו אוטומטית' },
  { icon: '📊', title: 'סטטיסטיקות ויתרות', desc: 'ראה כמה שוברים יש לך, כמה נוצל ומה עומד לפוג' },
  { icon: '🔔', title: 'תזכורות לפני תפוגה', desc: 'קבל מייל בזמן לפני שהשובר יפוג' },
  { icon: '🤝', title: 'ארנק משותף', desc: 'שתף את הארנק עם בני משפחה — כולם רואים ומעדכנים' },
]

export default function WelcomeModal({ userId }: Props) {
  const storageKey = `welcome_seen_${userId}`
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (!localStorage.getItem(storageKey)) {
      setVisible(true)
    }
  }, [storageKey])

  function dismiss() {
    localStorage.setItem(storageKey, '1')
    setVisible(false)
  }

  if (!visible) return null

  return (
    <div className="fixed inset-0 bg-black/60 z-[80] flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="bg-white w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl max-h-[90dvh] flex flex-col animate-slide-up">
        {/* Header */}
        <div className="relative p-6 pb-4 text-center bg-gradient-to-br from-green-50 to-emerald-50 rounded-t-3xl sm:rounded-t-3xl">
          <button
            onClick={dismiss}
            className="absolute top-4 left-4 p-2 rounded-full hover:bg-white/60 transition-colors"
          >
            <X className="w-5 h-5 text-gray-500" />
          </button>
          <div className="text-4xl mb-2">🎁</div>
          <h2 className="text-xl font-bold text-gray-900">ברוך הבא לארנק שוברים!</h2>
          <p className="text-sm text-gray-500 mt-1">הנה מה שאפשר לעשות עם האפליקציה</p>
        </div>

        {/* Features */}
        <div className="overflow-y-auto flex-1 p-4 space-y-3">
          {FEATURES.map((f, i) => (
            <div key={i} className="flex items-start gap-3 p-3 bg-gray-50 rounded-2xl">
              <span className="text-2xl leading-none mt-0.5">{f.icon}</span>
              <div>
                <p className="text-sm font-semibold text-gray-800">{f.title}</p>
                <p className="text-xs text-gray-500 mt-0.5">{f.desc}</p>
              </div>
            </div>
          ))}

          {/* Security note */}
          <div className="flex items-start gap-3 p-4 bg-green-50 border border-green-100 rounded-2xl">
            <Shield className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-green-800">הנתונים שלך מאובטחים לחלוטין</p>
              <p className="text-xs text-green-700 mt-0.5">
                כל הנתונים מאוחסנים ב-Supabase עם הצפנה מלאה. הסיסמאות שלך אינן נשמרות אצלנו — רק חשבון Google או אימייל מאומת.
              </p>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t safe-area-bottom">
          <button
            onClick={dismiss}
            className="w-full bg-gradient-to-r from-green-500 to-emerald-600 text-white py-3.5 rounded-2xl font-semibold shadow-md"
          >
            בואו נתחיל! 🚀
          </button>
        </div>
      </div>
    </div>
  )
}
