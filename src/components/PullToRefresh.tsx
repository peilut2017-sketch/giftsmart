import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { haptic } from '../lib/haptics'
import { EASE_DRAWER } from '../lib/motion'
import { useT } from '../lib/i18n'

/** Finger travel (px) past which letting go triggers a refresh. */
const THRESHOLD = 64
/** The indicator never travels further than this, however far the finger goes. */
const MAX_PULL = 96
/** Where the indicator rests while the refresh is running. */
const HOLD = 56
/** A refresh that returns instantly still shows the spinner this long, so it reads as work done. */
const MIN_SPIN_MS = 600

/** True when a scrollable ancestor (a list inside a sheet, say) has been scrolled down:
    a downward drag there is that list scrolling back up, not a pull-to-refresh. */
function insideScrolledContainer(target: EventTarget | null): boolean {
  let el = target instanceof Element ? target : null
  while (el && el !== document.body) {
    const overflowY = getComputedStyle(el).overflowY
    if ((overflowY === 'auto' || overflowY === 'scroll') && el.scrollHeight > el.clientHeight && el.scrollTop > 0) return true
    el = el.parentElement
  }
  return false
}

/**
 * Pull-to-refresh for pages that scroll the window itself. Render it once inside a page;
 * it draws nothing but a floating indicator and wires the touch gesture, so the page's
 * layout and stacking are untouched (no wrapper, no transform on the content).
 *
 * Touch only: on a desktop there is nothing to pull. The gesture starts only when the
 * page is already at the very top, the drag is mostly vertical (so it never fights the
 * horizontal card swipe), and no modal or scrolled inner list is under the finger.
 * `overscroll-behavior-y: contain` in index.css keeps Chrome's own pull-to-reload out of
 * the way.
 */
export default function PullToRefresh({ onRefresh, disabled = false }: {
  onRefresh: () => Promise<unknown> | void
  disabled?: boolean
}) {
  const { t } = useT()
  const indRef = useRef<HTMLDivElement>(null)
  const arrowRef = useRef<HTMLSpanElement>(null)
  const spinRef = useRef<HTMLSpanElement>(null)
  const refreshRef = useRef(onRefresh)
  useEffect(() => { refreshRef.current = onRefresh })

  useEffect(() => {
    if (disabled) return
    const ind = indRef.current
    const arrow = arrowRef.current
    const spin = spinRef.current
    if (!ind || !arrow || !spin) return

    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    let startX = 0
    let startY = 0
    let tracking = false   // finger is down at the top and might become a pull
    let pulling = false    // it did: vertical, downward, past the dead zone
    let armed = false      // crossed THRESHOLD (haptic fired once)
    let refreshing = false
    let pull = 0

    function paint(y: number, opacity: number, rotate: number, animated: boolean) {
      ind!.style.transition = animated && !reduceMotion
        ? `transform 300ms ${cssEase()}, opacity 200ms ease-out`
        : 'none'
      ind!.style.transform = `translateY(${y}px)`
      ind!.style.opacity = String(opacity)
      arrow!.style.transform = `rotate(${rotate}deg)`
    }

    function hide() { paint(-48, 0, 0, true) }

    function stopTracking() {
      tracking = false
      document.documentElement.style.overscrollBehaviorY = ''
    }

    function onStart(e: TouchEvent) {
      if (refreshing || e.touches.length !== 1) return
      // Only from the very top, and never under a modal or a scroll-locked page.
      if (window.scrollY > 0 || document.body.style.position === 'fixed') return
      const target = e.target as Element | null
      if (target?.closest?.('[role="dialog"], [aria-modal="true"], [data-no-ptr]')) return
      if (insideScrolledContainer(target)) return
      tracking = true
      pulling = false
      armed = false
      // Keep Chrome's own pull-to-reload out of this one gesture (see index.css).
      document.documentElement.style.overscrollBehaviorY = 'contain'
      startX = e.touches[0].clientX
      startY = e.touches[0].clientY
    }

    function onMove(e: TouchEvent) {
      if (!tracking) return
      const dx = e.touches[0].clientX - startX
      const dy = e.touches[0].clientY - startY
      if (!pulling) {
        // Dead zone first; a mostly-horizontal drag is a card swipe, so let it go.
        if (Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy)) { stopTracking(); return }
        if (dy < 8) { if (dy < -8) stopTracking(); return }
        pulling = true
      }
      // Rising friction: the further you drag, the less the indicator follows.
      pull = Math.min(MAX_PULL, dy * 0.5)
      const ready = pull >= THRESHOLD
      if (ready && !armed) { armed = true; haptic('light') }
      if (!ready && armed) armed = false
      paint(pull - 40, Math.min(1, pull / 40), pull * 3.2, false)
      arrow!.style.color = ready ? 'var(--c-primary)' : 'var(--c-text2)'
    }

    async function onEnd() {
      if (!tracking) return
      tracking = false
      document.documentElement.style.overscrollBehaviorY = ''
      if (!pulling) return
      pulling = false
      if (pull < THRESHOLD) { hide(); return }
      refreshing = true
      paint(HOLD - 40, 1, 0, true)
      arrow!.style.display = 'none'
      spin!.style.display = 'block'
      const started = Date.now()
      try { await refreshRef.current() } catch { /* the page shows its own error state */ }
      const wait = Math.max(0, MIN_SPIN_MS - (Date.now() - started))
      await new Promise(r => setTimeout(r, wait))
      haptic('success')
      hide()
      setTimeout(() => {
        spin!.style.display = 'none'
        arrow!.style.display = 'block'
        arrow!.style.color = 'var(--c-text2)'
        refreshing = false
      }, 300)
    }

    window.addEventListener('touchstart', onStart, { passive: true })
    window.addEventListener('touchmove', onMove, { passive: true })
    window.addEventListener('touchend', onEnd, { passive: true })
    window.addEventListener('touchcancel', onEnd, { passive: true })
    return () => {
      document.documentElement.style.overscrollBehaviorY = ''
      window.removeEventListener('touchstart', onStart)
      window.removeEventListener('touchmove', onMove)
      window.removeEventListener('touchend', onEnd)
      window.removeEventListener('touchcancel', onEnd)
    }
  }, [disabled])

  if (disabled) return null
  return createPortal(
    <div
      ref={indRef}
      role="status"
      aria-label={t('ptr.label')}
      className="fixed left-1/2 z-40 w-10 h-10 -ml-5 rounded-full flex items-center justify-center pointer-events-none"
      style={{
        top: 'calc(env(safe-area-inset-top, 0px) + 12px)',
        transform: 'translateY(-48px)',
        opacity: 0,
        background: 'var(--c-surface)',
        boxShadow: 'var(--shadow-card)',
        border: '1px solid var(--c-border)',
      }}
    >
      <span ref={arrowRef} className="block text-lg leading-none font-bold" style={{ color: 'var(--c-text2)' }} aria-hidden="true">↓</span>
      <span ref={spinRef} className="gs-spinner w-5 h-5 border-[3px]" style={{ display: 'none' }} aria-hidden="true" />
    </div>,
    document.body,
  )
}

function cssEase(): string {
  const [a, b, c, d] = EASE_DRAWER
  return `cubic-bezier(${a}, ${b}, ${c}, ${d})`
}
