import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock'
import { useModalHistory } from '../../hooks/useModalHistory'
import { BACKDROP_FADE, SHEET_SPRING } from '../../lib/motion'
import Icon from './Icon'

/** Single shared z-index for every sheet/modal in the redesigned UI — avoids the ad-hoc z-40/z-[80]/z-[90] scattering in the legacy components. */
export const SHEET_Z_INDEX = 100

interface BottomSheetProps {
  open: boolean
  onClose: () => void
  title?: string
  children: ReactNode
  footer?: ReactNode
  /** Disables backdrop-click / Escape dismissal for flows that must be explicitly acknowledged (e.g. recovery-key display). */
  dismissible?: boolean
  className?: string
}

/**
 * Shared bottom-sheet primitive (Framer Motion enter+exit, focus trap, Escape-to-close,
 * backdrop click-to-close, body-scroll lock). The reference sheet implementation — the
 * legacy CSS-only slide-up overlays were all migrated to Framer enter+exit using the
 * same SHEET_SPRING/BACKDROP_FADE tokens (src/lib/motion.ts).
 */
export default function BottomSheet({
  open,
  onClose,
  title,
  children,
  footer,
  dismissible = true,
  className = '',
}: BottomSheetProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const reduceMotion = useReducedMotion()
  useBodyScrollLock(open)
  // Android/browser Back closes the sheet instead of leaving the flow.
  // Non-dismissible sheets (blocking vault setup) keep Back untouched.
  useModalHistory(open && dismissible, onClose)

  useEffect(() => {
    if (!open || !dismissible) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, dismissible, onClose])

  useEffect(() => {
    if (!open) return
    const el = panelRef.current
    if (!el) return
    const focusable = el.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')
    focusable[0]?.focus()
    const onTab = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (e.shiftKey) {
        if (document.activeElement === first) { e.preventDefault(); last?.focus() }
      } else {
        if (document.activeElement === last) { e.preventDefault(); first?.focus() }
      }
    }
    el.addEventListener('keydown', onTab)
    return () => el.removeEventListener('keydown', onTab)
  }, [open])

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 bg-black/50"
          style={{ zIndex: SHEET_Z_INDEX }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={BACKDROP_FADE}
          onClick={dismissible ? onClose : undefined}
        >
          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={title ? 'sheet-title' : undefined}
            className={`absolute bottom-0 inset-x-0 bg-surface rounded-t-[28px] max-h-[92dvh] overflow-y-auto pb-[env(safe-area-inset-bottom)] ${className}`}
            // Reduced motion keeps the comprehension fade but drops the slide.
            initial={reduceMotion ? { opacity: 0 } : { y: '100%' }}
            animate={reduceMotion ? { opacity: 1 } : { y: 0 }}
            exit={reduceMotion ? { opacity: 0 } : { y: '100%' }}
            transition={reduceMotion ? { duration: 0.15 } : SHEET_SPRING}
            onClick={e => e.stopPropagation()}
          >
            <div className="w-10 h-1.5 bg-border rounded-full mx-auto mt-2.5 mb-1" />
            {(title || dismissible) && (
              <div className="flex items-center justify-between px-5 pt-2 pb-1">
                {title ? <h2 id="sheet-title" className="text-lg font-extrabold text-text">{title}</h2> : <span />}
                {dismissible && (
                  <button
                    onClick={onClose}
                    aria-label="סגור"
                    className="w-9 h-9 rounded-full flex items-center justify-center bg-bg text-text2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
                  >
                    <Icon name="close" size={20} />
                  </button>
                )}
              </div>
            )}
            <div className="px-5 pb-5">{children}</div>
            {footer && <div className="px-5 pb-5 pt-2 border-t border-border">{footer}</div>}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
