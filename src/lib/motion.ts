import type { Transition } from 'framer-motion'

/**
 * Motion tokens — Framer Motion mirrors of the CSS custom properties in
 * src/index.css (--ease-out / --ease-in-out / --ease-drawer). Every JS-driven
 * animation should pull its curve/spring from here rather than hand-typing one.
 */

/** Strong ease-out — entrances, exits, press feedback. CSS: var(--ease-out). */
export const EASE_OUT: [number, number, number, number] = [0.23, 1, 0.32, 1]

/** Strong ease-in-out — movement between on-screen positions. CSS: var(--ease-in-out). */
export const EASE_IN_OUT: [number, number, number, number] = [0.77, 0, 0.175, 1]

/** iOS-like drawer curve — sheets and drawers. CSS: var(--ease-drawer). */
export const EASE_DRAWER: [number, number, number, number] = [0.32, 0.72, 0, 1]

/** Default UI spring — subtle bounce, carries velocity when interrupted. */
export const SPRING: Transition = { type: 'spring', duration: 0.5, bounce: 0.2 }

/** Bottom-sheet spring — the reference config from ui/BottomSheet.tsx. */
export const SHEET_SPRING: Transition = { type: 'spring', stiffness: 380, damping: 38, mass: 0.9 }

/** Backdrop / scrim fade behind sheets and dialogs. */
export const BACKDROP_FADE: Transition = { duration: 0.2, ease: 'easeOut' }

/**
 * Flick velocity (px/s) beyond which a drag gesture dismisses regardless of
 * distance travelled (0.11 px/ms). Framer's PanInfo reports velocity in px/s.
 */
export const FLICK_VELOCITY = 110
