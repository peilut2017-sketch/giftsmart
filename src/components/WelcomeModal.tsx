import { useState, useEffect } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { X, Shield, Gift, Camera, MessageSquare, BarChart2, Bell, Users, Rocket } from 'lucide-react'
import { SHEET_SPRING, BACKDROP_FADE } from '../lib/motion'

interface Props {
  userId: string
}

const FEATURES = [
  { icon: Gift,         title: 'ניהול שוברים וגיפט קארדים', desc: 'הוסף, ערוך ועקוב אחרי כל השוברים שלך במקום אחד' },
  { icon: Camera,       title: 'סריקת ברקוד / QR',           desc: 'סרוק שובר ישירות עם המצלמה בלי להקליד ידנית' },
  { icon: MessageSquare,title: 'חילוץ מ-SMS ומייל',          desc: 'הדבק הודעת SMS — הפרטים יחולצו אוטומטית' },
  { icon: BarChart2,    title: 'סטטיסטיקות ויתרות',          desc: 'ראה כמה שוברים יש לך, כמה נוצל ומה עומד לפוג' },
  { icon: Bell,         title: 'תזכורות לפני תפוגה',          desc: 'קבל מייל בזמן לפני שהשובר יפוג' },
  { icon: Users,        title: 'ארנק משותף',                  desc: 'שתף את הארנק עם בני משפחה — כולם רואים ומעדכנים' },
]

export default function WelcomeModal({ userId }: Props) {
  const storageKey = `welcome_seen_${userId}`
  const [visible, setVisible] = useState(false)
  const reduceMotion = useReducedMotion()

  useEffect(() => {
    if (!localStorage.getItem(storageKey)) {
      setVisible(true)
    }
  }, [storageKey])

  function dismiss() {
    localStorage.setItem(storageKey, '1')
    setVisible(false)
    // The onboarding guide waits for this so the two never stack (see OnboardingGuide)
    window.dispatchEvent(new Event('gs-welcome-dismissed'))
  }

  return (
    <AnimatePresence>
      {visible && (
    <motion.div
      data-welcome-modal
      className="fixed inset-0 bg-black/60 z-[80] flex items-end sm:items-center justify-center p-0 sm:p-4"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={BACKDROP_FADE}
    >
      <motion.div
        className="bg-white w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl max-h-[90dvh] flex flex-col"
        initial={reduceMotion ? { opacity: 0 } : { y: '100%' }}
        animate={reduceMotion ? { opacity: 1 } : { y: 0 }}
        exit={reduceMotion ? { opacity: 0 } : { y: '100%' }}
        transition={reduceMotion ? { duration: 0.15 } : SHEET_SPRING}
      >
        {/* Header */}
        <div className="relative p-6 pb-4 text-center bg-gradient-to-br from-green-50 to-emerald-50 rounded-t-3xl sm:rounded-t-3xl">
          <button
            onClick={dismiss}
            className="absolute top-4 left-4 p-2 rounded-full hover:bg-white/60 transition-colors"
          >
            <X className="w-5 h-5 text-gray-500" />
          </button>
          <Gift className="w-12 h-12 mx-auto mb-2 text-green-500" />
          <h2 className="text-xl font-bold text-gray-900">ברוך הבא לארנק שוברים!</h2>
          <p className="text-sm text-gray-500 mt-1">הנה מה שאפשר לעשות עם האפליקציה</p>
        </div>

        {/* Features */}
        <div className="overflow-y-auto flex-1 p-4 space-y-3">
          {FEATURES.map((f, i) => (
            <div key={i} className="flex items-start gap-3 p-3 bg-gray-50 rounded-2xl">
              <f.icon className="w-5 h-5 mt-0.5 flex-shrink-0" style={{ color: 'var(--c-primary)' }} />
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
            className="w-full bg-gradient-to-r from-green-500 to-emerald-600 text-white py-3.5 rounded-2xl font-semibold shadow-md flex items-center justify-center gap-2"
          >
            <Rocket className="w-4 h-4" />
            בואו נתחיל!
          </button>
        </div>
      </motion.div>
    </motion.div>
      )}
    </AnimatePresence>
  )
}
