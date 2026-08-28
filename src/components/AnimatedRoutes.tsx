import { useLayoutEffect, useRef } from 'react'
import { Routes, useLocation } from 'react-router-dom'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { EASE_DRAWER } from '../lib/motion'

// Tab order (RTL layout: rightmost = index 0).
// Market/Discounts/Archive/Admin are no longer top-level nav tabs — they're reached
// from Settings, so they're intentionally absent here and fall through to the
// deep-route (-1) branch below, which gives them a fade/scale push transition
// instead of a horizontal slide. That's the correct behavior for a "pushed" page.
const TAB_ORDER: Record<string, number> = {
  '/':         0,
  '/search':   1,
  '/stats':    2,
  '/settings': 3,
}

function tabIndex(pathname: string): number {
  // Match prefix for nested routes (e.g. /market/listing/x → 1)
  for (const [path, idx] of Object.entries(TAB_ORDER)) {
    if (path !== '/' && pathname.startsWith(path)) return idx
  }
  if (pathname === '/') return 0
  return -1 // non-tab route → deep push
}

type NavMode = 'deep' | 'fwd' | 'back' | 'none'

// Tab-to-tab keeps a directional cue but travels only 24% of the width in 240ms —
// this fires dozens of times a day, so it must whisper, not perform. A subtle 2px
// blur masks the brief moment both pages are visible in the crossfade. All keyframes
// share one transform template (translateX + scale) so interpolation never jumps,
// and full transform strings keep the animation compositable.
const variants = {
  enter: (nav: NavMode) =>
    nav === 'deep' ? { opacity: 0, transform: 'translateX(0%) scale(0.97)', filter: 'blur(0px)' }
    : nav === 'none' ? { opacity: 1, transform: 'translateX(0%) scale(1)', filter: 'blur(0px)' }
    : { opacity: 0, transform: `translateX(${nav === 'fwd' ? '-24%' : '24%'}) scale(1)`, filter: 'blur(2px)' },
  center: {
    opacity: 1,
    transform: 'translateX(0%) scale(1)',
    filter: 'blur(0px)',
    // Clear both once settled: a lingering transform/filter turns this wrapper
    // into a stacking context, which pins every fixed modal opened INSIDE a
    // page (sheets, add-voucher form, confirms) underneath the z-50 BottomNav
    // no matter how high the modal's own z-index is.
    transitionEnd: { transform: 'none', filter: 'none' },
  },
  exit: (nav: NavMode) =>
    nav === 'deep' ? { opacity: 0, transform: 'translateX(0%) scale(1.01)', filter: 'blur(0px)' }
    : nav === 'none' ? { opacity: 1, transform: 'translateX(0%) scale(1)', filter: 'blur(0px)' }
    : { opacity: 0, transform: `translateX(${nav === 'fwd' ? '12%' : '-12%'}) scale(1)`, filter: 'blur(2px)' },
}

interface Props {
  children: React.ReactNode
}

export default function AnimatedRoutes({ children }: Props) {
  const location = useLocation()
  const reducedMotion = useReducedMotion()

  const currentIndex = tabIndex(location.pathname)
  // Committed in an effect, never in the render body: mutating the ref while
  // rendering meant a second tab tap mid-transition re-read an already-advanced
  // "previous" index and slid the entering page in from the wrong side.
  const prevIndexRef = useRef(currentIndex)
  const prevIndex = prevIndexRef.current

  // RTL: higher tab index is further left on screen, so "forward" enters from the left.
  const nav: NavMode =
    currentIndex === -1 || prevIndex === -1 ? 'deep'
    : currentIndex > prevIndex ? 'fwd'
    : currentIndex < prevIndex ? 'back'
    : 'none'

  useLayoutEffect(() => {
    prevIndexRef.current = currentIndex
  }, [location.pathname, currentIndex])

  // The document scroll position (pages scroll the window itself, not an inner
  // container) otherwise carries over from whatever the previous page was scrolled
  // to — e.g. leaving Search halfway down its list and landing on Home already
  // scrolled past the header. That reads as broken/jumpy on top of the slide
  // animation, not like a clean push to a fresh screen. Reset before paint so the
  // entering page always starts at the top, the way native app navigation does.
  useLayoutEffect(() => {
    window.scrollTo(0, 0)
  }, [location.pathname])

  // Framer's own rAF loop ignores the CSS reduced-motion overrides in index.css, so
  // it must be branched here explicitly. A near-instant tween (rather than zero)
  // avoids an outright content pop, per Framer Motion's reduced-motion guidance.
  //
  // A spring here previously let the entering and exiting pages settle at slightly
  // different times, which read as a stutter — a single eased tween keeps both pages
  // in lockstep.
  const transition = reducedMotion
    ? { type: 'tween' as const, duration: 0.01 }
    : { type: 'tween' as const, duration: nav === 'deep' ? 0.28 : 0.24, ease: EASE_DRAWER }

  return (
    // `custom` on AnimatePresence keeps the EXITING page's direction current too —
    // without it the old page replays the direction of the transition it entered with.
    <AnimatePresence mode="popLayout" initial={false} custom={nav}>
      <motion.div
        key={location.pathname}
        custom={nav}
        variants={variants}
        initial="enter"
        animate="center"
        exit="exit"
        transition={transition}
        style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}
      >
        <Routes location={location}>
          {children}
        </Routes>
      </motion.div>
    </AnimatePresence>
  )
}
