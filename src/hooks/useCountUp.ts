import { useLayoutEffect, useRef } from 'react'
import type { RefObject } from 'react'

/** Under the 300ms UI budget — a balance change should read as one beat, not a show. */
const DURATION = 280

/**
 * Animated number that writes straight to the element's textContent — no React
 * re-render per frame (the old implementation re-rendered the whole page at 60fps).
 * Retargets from the value currently on screen, so a second change mid-animation
 * continues smoothly instead of snapping back to a stale origin.
 *
 * Usage: `const ref = useCountUp(balance, v => formatCurrency(Math.round(v)))`
 * then `<span ref={ref}>{formatCurrency(balance)}</span>` (children render the
 * final value for SSR/first paint; the hook takes over on changes).
 */
export function useCountUp<T extends HTMLElement>(
  target: number,
  format: (v: number) => string,
): RefObject<T | null> {
  const ref = useRef<T | null>(null)
  const valueRef = useRef(target)
  const rafRef = useRef<number | null>(null)
  const formatRef = useRef(format)
  // Committed in an effect (not during render) so inline arrow callers stay fresh
  // without restarting the animation.
  useLayoutEffect(() => {
    formatRef.current = format
  })

  useLayoutEffect(() => {
    const el = ref.current
    const from = valueRef.current
    const reduced = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    if (!el || reduced || from === target) {
      valueRef.current = target
      if (el) el.textContent = formatRef.current(target)
      return
    }
    // Layout effect: rewrite the text before paint so the re-rendered children
    // (which already show the final value) never flash for a frame.
    el.textContent = formatRef.current(from)
    const start = performance.now()
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / DURATION)
      const eased = 1 - Math.pow(1 - p, 3)
      const v = from + (target - from) * eased
      valueRef.current = v
      el.textContent = formatRef.current(v)
      if (p < 1) rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
    }
  }, [target])

  return ref
}
