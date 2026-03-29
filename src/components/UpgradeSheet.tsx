import { X, Zap, Infinity as InfinityIcon, Download, Bell, Clock, Share2 } from 'lucide-react'
import { useSubscription } from '../contexts/SubscriptionContext'

const STRIPE_PAYMENT_LINK = import.meta.env.VITE_STRIPE_PAYMENT_LINK || '#'

const FEATURES = [
  { icon: <InfinityIcon className="w-5 h-5 text-amber-500" />, text: 'שוברים ללא הגבלה', sub: 'חינמי: עד 25' },
  { icon: <Share2 className="w-5 h-5 text-amber-500" />, text: 'שיתוף ללא הגבלה', sub: 'חינמי: עד 5 שוברים' },
  { icon: <InfinityIcon className="w-5 h-5 text-amber-500" />, text: 'סריקות תמונה ללא הגבלה', sub: 'חינמי: 3 לחודש' },
  { icon: <Download className="w-5 h-5 text-amber-500" />, text: 'ייצוא Excel / PDF', sub: 'חינמי: לא זמין' },
  { icon: <Clock className="w-5 h-5 text-amber-500" />, text: 'היסטוריית פעילות מלאה', sub: 'חינמי: 7 ימים' },
  { icon: <Bell className="w-5 h-5 text-amber-500" />, text: 'התראות פקיעת תוקף', sub: 'חינמי: לא זמין' },
]

export default function UpgradeSheet() {
  const { upgradeSheetOpen, closeUpgradeSheet, upgradeReason } = useSubscription()

  if (!upgradeSheetOpen) return null

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 z-40"
        onClick={closeUpgradeSheet}
      />

      {/* Sheet */}
      <div className="fixed bottom-0 left-0 right-0 z-50 bg-white rounded-t-3xl shadow-2xl max-w-2xl mx-auto animate-slide-up">
        {/* Header */}
        <div className="relative bg-gradient-to-br from-amber-400 to-orange-500 rounded-t-3xl px-6 pt-6 pb-8 text-white text-center">
          <button
            onClick={closeUpgradeSheet}
            className="absolute top-4 left-4 p-1.5 rounded-full bg-white/20 hover:bg-white/30"
            aria-label="סגור"
          >
            <X className="w-4 h-4" />
          </button>

          <div className="inline-flex items-center justify-center w-14 h-14 bg-white/20 rounded-2xl mb-3">
            <Zap className="w-7 h-7 text-white" fill="white" />
          </div>
          <h2 className="text-2xl font-extrabold">GiftSmart Pro</h2>
          {upgradeReason && (
            <p className="text-sm text-white/80 mt-1">{upgradeReason}</p>
          )}
          <div className="mt-3">
            <span className="text-4xl font-black">₪9</span>
            <span className="text-white/80 text-sm"> / חודש</span>
          </div>
          <p className="text-xs text-white/70 mt-1">ביטול בכל עת • ללא התחייבות</p>
        </div>

        {/* Features */}
        <div className="px-6 py-5 space-y-3">
          {FEATURES.map((f, i) => (
            <div key={i} className="flex items-center gap-3">
              <div className="flex-shrink-0 w-9 h-9 rounded-xl bg-amber-50 flex items-center justify-center">
                {f.icon}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-gray-800">{f.text}</p>
                <p className="text-xs text-gray-400">{f.sub}</p>
              </div>
            </div>
          ))}
        </div>

        {/* CTA */}
        <div className="px-6 pb-8 pt-2 space-y-3">
          <a
            href={STRIPE_PAYMENT_LINK}
            target="_blank"
            rel="noopener noreferrer"
            className="block w-full bg-gradient-to-r from-amber-400 to-orange-500 text-white text-center font-bold text-lg py-4 rounded-2xl shadow-lg active:scale-95 transition-transform"
            onClick={closeUpgradeSheet}
          >
            שדרג עכשיו — ₪9/חודש
          </a>
          <button
            onClick={closeUpgradeSheet}
            className="block w-full text-center text-sm text-gray-400 py-2"
          >
            אולי אחר כך
          </button>
        </div>
      </div>
    </>
  )
}
