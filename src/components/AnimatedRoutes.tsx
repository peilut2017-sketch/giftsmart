import { useRef } from 'react'
import { Routes, useLocation } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'

// Tab order (RTL layout: rightmost = index 0).
// Market/Discounts/Archive/Admin are no longer top-level nav tabs — they're reached
// from Settings, so they're intentionally absent here and fall through to the
// isDeepRoute (-1) branch below, which already gives them a fade/scale transition
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
  return -1 // non-tab route → treat as deep push (vertical)
}

interface Props {
  children: React.ReactNode
}

export default function AnimatedRoutes({ children }: Props) {
  const location = useLocation()
  const prevIndexRef = useRef<number>(tabIndex(location.pathname))

  const currentIndex = tabIndex(location.pathname)
  const prevIndex    = prevIndexRef.current

  // RTL: higher tab index is further left on screen
  // Going to a higher index → new page enters from the left  (negative x)
  // Going to a lower index  → new page enters from the right (positive x)
  const isDeepRoute = currentIndex === -1
  const delta = currentIndex - prevIndex

  // Decide enter/exit direction
  let enterX: string
  let exitX: string

  if (isDeepRoute) {
    // Deep push (checkout, listing detail, etc.) — slide up subtly
    enterX = '0'
    exitX  = '0'
  } else if (delta > 0) {
    // Moving to a tab further left (RTL "forward")
    enterX = '-100%'
    exitX  = '30%'
  } else if (delta < 0) {
    // Moving to a tab further right (RTL "back")
    enterX = '100%'
    exitX  = '-30%'
  } else {
    // Same tab or first render — no slide
    enterX = '0'
    exitX  = '0'
  }

  // Update prev after determining direction
  if (currentIndex !== -1) prevIndexRef.current = currentIndex

  const variants = {
    enter: {
      x: enterX,
      opacity: isDeepRoute ? 0 : 1,
      scale: isDeepRoute ? 0.97 : 1,
    },
    center: {
      x: 0,
      opacity: 1,
      scale: 1,
    },
    exit: {
      x: exitX,
      opacity: isDeepRoute ? 0 : 1,
      scale: isDeepRoute ? 1.01 : 1,
    },
  }

  const reducedMotion = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  // The blanket `@media (prefers-reduced-motion: reduce)` rule in index.css only zeroes
  // CSS transition/animation durations — this spring is driven by Framer Motion's own
  // requestAnimationFrame loop, which that rule can't touch, so route transitions were
  // still fully animated even with the OS preference set. A near-instant tween respects
  // it instead of just skipping the slide/scale (still a hair of motion to avoid an
  // outright content pop, per Framer Motion's own reduced-motion guidance).
  const transition = reducedMotion
    ? { type: 'tween' as const, duration: 0.01 }
    : { type: 'spring' as const, stiffness: 380, damping: 38, mass: 0.9 }

  return (
    <AnimatePresence mode="popLayout" initial={false}>
      <motion.div
        key={location.pathname}
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
