import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useSubscription } from '../contexts/SubscriptionContext'
import { supabase } from '../lib/supabase'
import toast from 'react-hot-toast'
import Icon from './ui/Icon'
import { SHEET_Z_INDEX } from './ui/BottomSheet'

const STRIPE_PAYMENT_LINK = import.meta.env.VITE_STRIPE_PAYMENT_LINK || '#'

const FEATURES: { icon: string; text: string; sub: string }[] = [
  { icon: 'all_inclusive', text: 'שוברים ללא הגבלה', sub: 'חינמי: עד 25' },
  { icon: 'share', text: 'שיתוף ללא הגבלה', sub: 'חינמי: עד 5 שוברים' },
  { icon: 'all_inclusive', text: 'סריקות תמונה ללא הגבלה', sub: 'חינמי: 3 לחודש' },
  { icon: 'download', text: 'ייצוא Excel / PDF', sub: 'חינמי: לא זמין' },
  { icon: 'history', text: 'היסטוריית פעילות מלאה', sub: 'חינמי: 7 ימים' },
  { icon: 'notifications_active', text: 'התראות פקיעת תוקף', sub: 'חינמי: לא זמין' },
]

const COUPON_ERRORS: Record<string, string> = {
  INVALID_CODE:   'קוד הקופון אינו קיים או אינו פעיל',
  EXPIRED:        'הקופון פג תוקף',
  EXHAUSTED:      'הקופון מוצה (הגיע למגבלת שימושים)',
  ALREADY_USED:   'כבר השתמשת בקופון זה',
  NOT_ELIGIBLE:   'קופון זה מיועד למשתמש אחר',
  NOT_FIRST_TIME: 'קופון זה מיועד למשתמשים חדשים בלבד',
}

const BASE_PRICE = 9

type TimeSuccess = { kind: 'time'; label: string; until: string }
type DiscountApplied = { kind: 'discount'; discount_type: 'percent' | 'fixed'; value: number; discountedPrice: number; stripeCode: string | null }

export default function UpgradeSheet() {
  const { upgradeSheetOpen, closeUpgradeSheet, upgradeReason, refreshPlan } = useSubscription()
  const [couponCode, setCouponCode] = useState('')
  const [couponLoading, setCouponLoading] = useState(false)
  const [timeSuccess, setTimeSuccess] = useState<TimeSuccess | null>(null)
  const [discountApplied, setDiscountApplied] = useState<DiscountApplied | null>(null)

  if (!upgradeSheetOpen) return null

  async function handleRedeemCoupon() {
    if (!couponCode.trim()) return
    setCouponLoading(true)
    const { data, error } = await supabase.rpc('redeem_coupon', { p_code: couponCode.trim().toUpperCase() })
    setCouponLoading(false)
    if (error) return toast.error('שגיאה: ' + error.message)
    if (!data?.success) {
      return toast.error(COUPON_ERRORS[data?.error] || 'קוד לא תקף')
    }

    if (data.grant_type === 'discount') {
      const value = data.discount_value as number
      const discountedPrice = data.discount_type === 'percent'
        ? Math.max(0, parseFloat((BASE_PRICE * (1 - value / 100)).toFixed(2)))
        : Math.max(0, BASE_PRICE - value)
      setDiscountApplied({ kind: 'discount', discount_type: data.discount_type, value, discountedPrice, stripeCode: data.stripe_coupon_code || null })
      toast.success('קוד הנחה הוחל!')
    } else {
      // grant_type === 'time' (months_free or days_free)
      const until = data.valid_until ? new Date(data.valid_until).toLocaleDateString('he-IL') : ''
      const label = data.days_added
        ? `${data.days_added} יום${data.days_added > 1 ? 'ים' : ''} Pro הופעלו בהצלחה`
        : `${data.months_added} חודש${data.months_added > 1 ? 'ים' : ''} Pro הופעלו בהצלחה`
      setTimeSuccess({ kind: 'time', label, until })
      await refreshPlan()
    }
  }

  // Full-screen success for time-based coupons
  if (timeSuccess) {
    return (
      <AnimatePresence>
        <motion.div
          className="fixed inset-0 bg-black/50"
          style={{ zIndex: SHEET_Z_INDEX }}
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}
          onClick={closeUpgradeSheet}
        >
          <motion.div
            className="absolute bottom-0 inset-x-0 bg-surface rounded-t-[28px] max-w-2xl mx-auto"
            initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
            transition={{ type: 'spring', stiffness: 380, damping: 38, mass: 0.9 }}
            onClick={e => e.stopPropagation()}
          >
            <div className="p-8 flex flex-col items-center gap-4 text-center">
              <div className="w-16 h-16 bg-primary-light rounded-2xl flex items-center justify-center">
                <Icon name="check_circle" size={32} filled color="var(--c-primary)" />
              </div>
              <div>
                <p className="text-xl font-extrabold text-text">ברוך הבא ל-Pro! 🎉</p>
                <p className="text-sm text-text3 mt-1">{timeSuccess.label}</p>
                {timeSuccess.until && (
                  <p className="text-xs text-text3 mt-0.5">תוקף עד {timeSuccess.until}</p>
                )}
              </div>
              <button
                onClick={() => { setTimeSuccess(null); closeUpgradeSheet() }}
                className="w-full bg-primary text-white py-3 rounded-2xl font-bold text-base"
              >
                מצוין!
              </button>
            </div>
          </motion.div>
        </motion.div>
      </AnimatePresence>
    )
  }

  const stripeLink = discountApplied?.stripeCode
    ? `${STRIPE_PAYMENT_LINK}?prefilled_promo_code=${discountApplied.stripeCode}`
    : STRIPE_PAYMENT_LINK

  const ctaLabel = discountApplied
    ? `שדרג עכשיו — ₪${discountApplied.discountedPrice}/חודש`
    : 'שדרג עכשיו — ₪9/חודש'

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 bg-black/50"
        style={{ zIndex: SHEET_Z_INDEX }}
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}
        onClick={closeUpgradeSheet}
      >
        <motion.div
          className="absolute bottom-0 inset-x-0 bg-surface rounded-t-[28px] max-w-2xl mx-auto overflow-y-auto max-h-[92dvh]"
          initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
          transition={{ type: 'spring', stiffness: 380, damping: 38, mass: 0.9 }}
          onClick={e => e.stopPropagation()}
        >
          {/* Header */}
          <div className="relative bg-gradient-to-br from-gold-mid to-gold rounded-t-[28px] px-6 pt-6 pb-8 text-white text-center">
            <button
              onClick={closeUpgradeSheet}
              className="absolute top-4 left-4 p-1.5 rounded-full bg-white/20"
              aria-label="סגור"
            >
              <Icon name="close" size={16} color="#fff" />
            </button>
            <div className="inline-flex items-center justify-center w-14 h-14 bg-white/20 rounded-2xl mb-3">
              <Icon name="bolt" size={28} filled color="#fff" />
            </div>
            <h2 className="text-2xl font-extrabold">GiftSmart Pro</h2>
            {upgradeReason && (
              <p className="text-sm text-white/80 mt-1">{upgradeReason}</p>
            )}
            {discountApplied ? (
              <div className="mt-3">
                <div className="flex items-center justify-center gap-2">
                  <span className="text-2xl font-black line-through opacity-60">₪{BASE_PRICE}</span>
                  <span className="text-4xl font-black">₪{discountApplied.discountedPrice}</span>
                </div>
                <span className="text-white/80 text-sm"> / חודש</span>
                <div className="mt-1 inline-block bg-white/25 rounded-full px-3 py-0.5 text-xs font-bold">
                  {discountApplied.discount_type === 'percent'
                    ? `✓ קוד הנחה — ${discountApplied.value}% הנחה`
                    : `✓ קוד הנחה — ₪${discountApplied.value} הנחה`}
                </div>
              </div>
            ) : (
              <div className="mt-3">
                <span className="text-4xl font-black">₪9</span>
                <span className="text-white/80 text-sm"> / חודש</span>
              </div>
            )}
            <p className="text-xs text-white/70 mt-1">ביטול בכל עת • ללא התחייבות</p>
          </div>

          {/* Features */}
          <div className="px-6 py-5 space-y-3">
            {FEATURES.map((f, i) => (
              <div key={i} className="flex items-center gap-3">
                <div className="flex-shrink-0 w-9 h-9 rounded-xl bg-gold-light flex items-center justify-center">
                  <Icon name={f.icon} size={18} color="var(--c-gold)" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-text">{f.text}</p>
                  <p className="text-xs text-text3">{f.sub}</p>
                </div>
              </div>
            ))}
          </div>

          {/* CTA */}
          <div className="px-6 pb-4 pt-2 space-y-3">
            <a
              href={stripeLink}
              target="_blank"
              rel="noopener noreferrer"
              className="block w-full bg-gradient-to-r from-gold-mid to-gold text-white text-center font-bold text-lg py-4 rounded-2xl shadow-fab active:scale-95 transition-transform"
              onClick={closeUpgradeSheet}
            >
              {ctaLabel}
            </a>

            {/* Coupon code */}
            {!discountApplied && (
              <div className="border border-border rounded-2xl p-3 space-y-2">
                <p className="text-xs font-medium text-text3 flex items-center gap-1.5">
                  <Icon name="sell" size={14} /> יש לך קוד קופון?
                </p>
                <div className="flex gap-2">
                  <input
                    value={couponCode}
                    onChange={e => setCouponCode(e.target.value.toUpperCase())}
                    placeholder="הזן קוד..."
                    className="flex-1 px-3 py-2 border border-border rounded-xl text-sm font-mono bg-surface text-text focus:outline-none focus:ring-2 focus:ring-gold/40 text-left"
                    dir="ltr"
                    onKeyDown={e => e.key === 'Enter' && handleRedeemCoupon()}
                  />
                  <button
                    onClick={handleRedeemCoupon}
                    disabled={couponLoading || !couponCode.trim()}
                    className="px-4 py-2 bg-gold text-white rounded-xl text-sm font-medium disabled:opacity-40 active:scale-95 transition-transform"
                  >
                    {couponLoading ? '...' : 'מימוש'}
                  </button>
                </div>
              </div>
            )}

            {discountApplied && (
              <button
                onClick={() => setDiscountApplied(null)}
                className="block w-full text-center text-xs text-text3 py-1"
              >
                הסר קוד הנחה
              </button>
            )}

            <button
              onClick={closeUpgradeSheet}
              className="block w-full text-center text-sm text-text3 py-2"
            >
              אולי אחר כך
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}
