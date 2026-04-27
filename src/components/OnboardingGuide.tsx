import { useState, useEffect, useCallback } from 'react'
import { X, ChevronRight, ChevronLeft, Archive, Trash2, Edit2, Shield } from 'lucide-react'

const STORAGE_KEY = 'onboarding_seen_v2'
const TOOLTIP_W = 310

interface Step {
  id: string
  title: string
  body: React.ReactNode
  target?: string
  padding?: number
  /** preferred tooltip side — auto falls back by viewport position */
  tipSide?: 'top' | 'bottom'
}

// ── Swipe demo ──────────────────────────────────────────────────────────────
function SwipeDemo() {
  return (
    <div className="relative mt-3 h-12 rounded-xl overflow-hidden select-none" style={{ background: 'var(--c-bg)' }}>
      {/* Left: edit */}
      <div className="absolute inset-y-0 right-0 w-14 bg-blue-500 flex items-center justify-center gap-1">
        <Edit2 className="w-4 h-4 text-white" />
      </div>
      {/* Right: archive + delete */}
      <div className="absolute inset-y-0 left-0 flex" style={{ width: 100 }}>
        <div className="flex-1 bg-amber-500 flex items-center justify-center">
          <Archive className="w-4 h-4 text-white" />
        </div>
        <div className="flex-1 bg-red-500 flex items-center justify-center">
          <Trash2 className="w-4 h-4 text-white" />
        </div>
      </div>
      {/* Card */}
      <div
        className="absolute inset-0 flex items-center px-3 gap-2.5"
        style={{ background: 'var(--c-surface)', animation: 'swipe-card-demo 3.2s ease-in-out infinite' }}
      >
        <div className="w-7 h-7 rounded-lg flex-shrink-0" style={{ background: 'var(--c-primary-light)' }} />
        <div className="flex-1 min-w-0">
          <div className="h-2 rounded-full w-20 mb-1" style={{ background: 'var(--c-bg)' }} />
          <div className="h-1.5 rounded-full w-12" style={{ background: 'var(--c-bg)' }} />
        </div>
        <div className="text-sm font-bold" style={{ color: 'var(--c-text)' }}>₪150</div>
      </div>
    </div>
  )
}

// ── Long-press demo ──────────────────────────────────────────────────────────
function LongPressDemo() {
  return (
    <div className="flex items-center gap-3 mt-3 justify-center">
      <div className="w-12 h-12 rounded-full flex items-center justify-center shadow-md" style={{ background: 'linear-gradient(135deg, #22c55e, #059669)' }}>
        <svg viewBox="0 0 28 28" className="w-6 h-6" fill="none">
          <rect x="6" y="6" width="16" height="16" rx="3" transform="rotate(45 14 14)" stroke="white" strokeWidth="2" fill="none"/>
          <line x1="14" y1="9" x2="14" y2="19" stroke="white" strokeWidth="2" strokeLinecap="round"/>
          <line x1="9" y1="14" x2="19" y2="14" stroke="white" strokeWidth="2" strokeLinecap="round"/>
        </svg>
      </div>
      <div className="text-right text-sm" style={{ color: 'var(--c-text2)' }}>
        <div>לחיצה קצרה → תפריט מהיר</div>
        <div className="font-bold mt-0.5" style={{ color: 'var(--c-primary)' }}>לחיצה ארוכה → הוסף שובר</div>
      </div>
    </div>
  )
}

// ── Steps ───────────────────────────────────────────────────────────────────
const STEPS: Step[] = [
  {
    id: 'welcome',
    title: 'ברוכים הבאים ל-GiftSmart',
    body: (
      <p>המדריך יסביר בקצרה את כל הפיצ׳רים — כולל הנסתרים שרוב המשתמשים לא מגלים. ניתן לדלג ולהפעיל מחדש מהגדרות.</p>
    ),
  },
  {
    id: 'fab',
    title: 'הכפתור החכם',
    body: (
      <>
        <p>הכפתור הירוק בתחתית הוא נקודת הכניסה הראשית.</p>
        <LongPressDemo />
        <p className="mt-2 text-xs" style={{ color: 'var(--c-text3)' }}>תפריט מהיר: חיפוש · אני בחנות · בחירה מרובה</p>
      </>
    ),
    target: '[data-guide="fab"]',
    padding: 10,
    tipSide: 'top',
  },
  {
    id: 'swipe',
    title: 'החלקת כרטיס — פיצ׳ר נסתר',
    body: (
      <>
        <p>החלק <strong>ימינה</strong> לעריכה, <strong>שמאלה</strong> לארכיון ומחיקה.</p>
        <SwipeDemo />
        <p className="mt-2 text-xs" style={{ color: 'var(--c-text3)' }}>בדסקטופ: ריחוף מציג את הכפתורים</p>
      </>
    ),
  },
  {
    id: 'update-balance',
    title: 'עדכון יתרה',
    body: (
      <p>לחץ על כרטיס שובר כדי לפתוח את דף השימוש. שם תוכל: לעדכן יתרה, לראות ברקוד / QR, לשתף עם אחרים, ולהציע למכירה בשוק.</p>
    ),
    target: '[data-guide="voucher-card"]',
    padding: 8,
    tipSide: 'bottom',
  },
  {
    id: 'filters',
    title: 'סינון וחיפוש',
    body: (
      <p>הטאבים מאפשרים לסנן לפי: הכל, פג בקרוב, משותף. לחץ <strong>סינון</strong> לקטגוריות ומיון. לחץ על אייקון הגריד / שורות לשינוי תצוגה.</p>
    ),
    target: '[data-guide="filter-bar"]',
    padding: 6,
    tipSide: 'bottom',
  },
  {
    id: 'instore',
    title: 'מצב "אני בחנות" — נסתר',
    body: (
      <p>פתח את תפריט הכפתור הירוק ← <strong>אני בחנות</strong>. חפש חנות, ראה את כל השוברים הזמינים, עדכן יתרה, והצג ברקוד — הכל מסך אחד.</p>
    ),
    target: '[data-guide="fab"]',
    padding: 10,
    tipSide: 'top',
  },
  {
    id: 'ocr',
    title: 'SMS · תמונה · QR — נסתר',
    body: (
      <p>בטופס הוספת שובר ← לחץ <strong>הדבק SMS</strong> לחילוץ פרטים אוטומטי, או <strong>סרוק תמונה</strong> לניתוח תמונת שובר עם AI. גם סריקת ברקוד מובנית.</p>
    ),
  },
  {
    id: 'market',
    title: 'שוק שוברים',
    body: (
      <p>בכרטיסייה <strong>שוק</strong> תוכל למכור שוברים שאינך צריך ולקנות מאחרים במחיר מיוחד. מכולל מערכת דירוג ואישור תשלום.</p>
    ),
    target: '[data-guide="market-nav"]',
    padding: 8,
    tipSide: 'top',
  },
  {
    id: 'e2ee',
    title: 'הצפנה מקצה לקצה (E2EE)',
    body: (
      <>
        <p>בטופס הוספת שובר תוכל להפעיל הצפנה מקצה לקצה — הקוד יישמר מוצפן גם בשרת, רק מי שמחזיק בסיסמת הכספת יוכל לקרוא אותו.</p>
        <div className="mt-3 bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-800 space-y-1">
          <p className="flex items-center gap-1.5 font-bold"><Shield className="w-3.5 h-3.5" /> חשוב לדעת:</p>
          <p>• <strong>שכחת הסיסמה = אובדן גישה קבוע לקוד</strong> — אין שחזור בשרת</p>
          <p>• שיתוף קישור לשובר מוצפן חושף את הקוד בשרת</p>
          <p>• הגדר רמז סיסמה בעת ההגדרה כדי שלא לשכוח</p>
          <p>• שנה ואפס כספת בהגדרות ← פרטי חשבון</p>
        </div>
      </>
    ),
  },
  {
    id: 'done',
    title: 'הכל ברור!',
    body: (
      <p>עכשיו אתה מוכן להשתמש ב-GiftSmart במלואו. תוכל להפעיל מחדש את המדריך בכל עת דרך <strong>הגדרות</strong>.</p>
    ),
  },
]

// ── Helpers ──────────────────────────────────────────────────────────────────
function getSpotlightStyle(rect: DOMRect, padding: number): React.CSSProperties {
  return {
    position: 'fixed',
    top: rect.top - padding,
    left: rect.left - padding,
    width: rect.width + padding * 2,
    height: rect.height + padding * 2,
    borderRadius: 14,
    boxShadow: '0 0 0 9999px rgba(0,0,0,0.62)',
    pointerEvents: 'none',
    zIndex: 9999,
    transition: 'all 0.3s ease',
  }
}

function getTooltipStyle(rect: DOMRect | null, tipSide?: 'top' | 'bottom'): React.CSSProperties {
  const margin = 12
  if (!rect) {
    return {
      position: 'fixed',
      top: '50%',
      left: '50%',
      transform: 'translate(-50%, -50%)',
      width: Math.min(TOOLTIP_W, window.innerWidth - margin * 2),
      zIndex: 10000,
    }
  }

  const vH = window.innerHeight
  const vW = window.innerWidth
  // Compute actual width first so left clamping is always in sync
  const actualWidth = Math.min(TOOLTIP_W, vW - margin * 2)
  const idealLeft = rect.left + rect.width / 2 - actualWidth / 2
  const left = Math.max(margin, Math.min(vW - actualWidth - margin, idealLeft))

  const goAbove = tipSide === 'top' || (!tipSide && rect.bottom > vH * 0.55)

  if (goAbove) {
    return { position: 'fixed', bottom: vH - rect.top + margin, left, width: actualWidth, zIndex: 10000 }
  }
  return { position: 'fixed', top: rect.bottom + margin, left, width: actualWidth, zIndex: 10000 }
}

// ── Main component ───────────────────────────────────────────────────────────
export default function OnboardingGuide() {
  const [visible, setVisible] = useState(() => !localStorage.getItem(STORAGE_KEY))
  const [step, setStep] = useState(0)
  const [rect, setRect] = useState<DOMRect | null>(null)

  const current = STEPS[step]

  // Listen for manual re-trigger from Settings
  useEffect(() => {
    function onShow() { setStep(0); setVisible(true) }
    window.addEventListener('show-onboarding', onShow)
    return () => window.removeEventListener('show-onboarding', onShow)
  }, [])

  const measureTarget = useCallback(() => {
    if (!current.target) { setRect(null); return }
    const el = document.querySelector(current.target) as HTMLElement | null
    if (!el) { setRect(null); return }
    // Scroll into view for non-fixed elements
    if (getComputedStyle(el).position !== 'fixed') {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
    setTimeout(() => setRect(el.getBoundingClientRect()), 280)
  }, [current.target])

  useEffect(() => {
    if (!visible) return
    measureTarget()
  }, [visible, step, measureTarget])

  // Re-measure on resize
  useEffect(() => {
    if (!visible) return
    const handler = () => measureTarget()
    window.addEventListener('resize', handler)
    return () => window.removeEventListener('resize', handler)
  }, [visible, measureTarget])

  function dismiss() {
    localStorage.setItem(STORAGE_KEY, '1')
    setVisible(false)
  }

  function next() {
    if (step < STEPS.length - 1) setStep(s => s + 1)
    else dismiss()
  }

  function prev() {
    if (step > 0) setStep(s => s - 1)
  }

  if (!visible) return null

  const spotlightStyle = rect ? getSpotlightStyle(rect, current.padding ?? 8) : null
  const tooltipStyle = getTooltipStyle(rect, current.tipSide)
  const isFirst = step === 0
  const isLast = step === STEPS.length - 1

  return (
    <>
      {/* Dark overlay (only when no spotlight) */}
      {!rect && (
        <div
          className="fixed inset-0 bg-black/62"
          style={{ zIndex: 9998 }}
          onClick={next}
        />
      )}

      {/* Spotlight rect */}
      {spotlightStyle && <div style={spotlightStyle} />}

      {/* Tooltip card */}
      <div
        style={{ ...tooltipStyle, animation: 'guide-in 0.2s ease-out both' }}
        dir="rtl"
        onClick={e => e.stopPropagation()}
      >
        <div
          className="rounded-3xl shadow-2xl overflow-hidden"
          style={{ background: 'var(--c-surface)', border: '1px solid var(--c-border)' }}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 pt-4 pb-2">
            <h3 className="font-bold text-base leading-tight flex-1" style={{ color: 'var(--c-text)' }}>
              {current.title}
            </h3>
            <button
              onClick={dismiss}
              className="p-1.5 rounded-full hover:bg-gray-100 flex-shrink-0"
              aria-label="סגור מדריך"
            >
              <X className="w-4 h-4" style={{ color: 'var(--c-text3)' }} />
            </button>
          </div>

          {/* Body */}
          <div className="px-4 pb-3 text-sm leading-relaxed" style={{ color: 'var(--c-text2)' }}>
            {current.body}
          </div>

          {/* Footer */}
          <div className="flex items-center gap-2 px-4 pb-4">
            {/* Prev */}
            <button
              onClick={prev}
              disabled={isFirst}
              className="p-2 rounded-full disabled:opacity-30 hover:bg-gray-100 transition-colors"
              aria-label="הקודם"
            >
              <ChevronRight className="w-4 h-4" style={{ color: 'var(--c-text2)' }} />
            </button>

            {/* Progress dots */}
            <div className="flex gap-1.5 flex-1 justify-center">
              {STEPS.map((_, i) => (
                <button
                  key={i}
                  onClick={() => setStep(i)}
                  className="rounded-full transition-all"
                  style={{
                    width: i === step ? 18 : 6,
                    height: 6,
                    background: i === step ? 'var(--c-primary)' : 'var(--c-border)',
                  }}
                  aria-label={`שלב ${i + 1}`}
                />
              ))}
            </div>

            {/* Next / Done */}
            <button
              onClick={next}
              className="flex items-center gap-1 px-3 py-1.5 rounded-full text-sm font-semibold text-white transition-all active:scale-95"
              style={{ background: 'var(--c-primary)' }}
            >
              {isLast ? 'סיום' : 'הבא'}
              {!isLast && <ChevronLeft className="w-4 h-4" />}
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
