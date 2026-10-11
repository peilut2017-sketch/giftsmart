/**
 * Shared-element page transitions ("a card grows into its detail screen") built on the
 * browser's View Transitions API, with the router-agnostic manual technique: wrap the
 * navigation in `document.startViewTransition`, name the tapped element before the old
 * state is captured and its counterpart on the new page before the new state is captured,
 * and the browser morphs one into the other.
 *
 * How elements find each other (plain data attributes, no registry):
 *   data-vt-id="v:<voucherId>" | "l:<listingId>" | "s:<settingsPath>"   → the card / row
 *   data-vt-hero="<same id>"                                            → its detail-page counterpart
 *
 * Where the API is missing (Firefox < 144, older iOS) or the user prefers reduced motion,
 * every call here just navigates, and AnimatedRoutes' own framer transition runs as before.
 *
 * Do NOT put `view-transition-name` on an ancestor of a backdrop-filter element (the
 * bottom nav, for one): a named element is a backdrop root, so the blur inside it would
 * stop seeing the page behind. Names are only ever set here, on cards and heroes, and are
 * removed again when the transition ends.
 */

const NAME = 'vt-hero'

/** Max time to wait for the router to commit the new page before capturing it anyway. */
const COMMIT_TIMEOUT_MS = 800

let active = false

/** True from the moment a view-transition navigation starts until it finishes. AnimatedRoutes
    reads this while rendering to switch off its own slide/fade, which would otherwise play
    inside the browser's snapshots. */
export function isViewTransitionActive(): boolean {
  return active
}

export function viewTransitionsSupported(): boolean {
  if (typeof document === 'undefined') return false
  if (typeof document.startViewTransition !== 'function') return false
  return !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
}

export function findCard(id: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-vt-id="${CSS.escape(id)}"]`)
}

export function findHero(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-vt-hero]')
}

// Timers, never requestAnimationFrame: while the browser waits for the update callback
// it suspends rendering, and Chromium runs zero rAF callbacks in that window — a rAF-based
// wait would simply burn its whole timeout (measured: 0 ticks in 300ms vs 19 timer ticks).
// The same applies to framer-motion's frame loop, which is why AnimatedRoutes gives the
// outgoing page an exit with nothing to animate during a view transition.
const TICK_MS = 16

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function until(done: () => boolean, timeoutMs: number): Promise<void> {
  const start = performance.now()
  while (!done() && performance.now() - start < timeoutMs) await sleep(TICK_MS)
}

/** An element that is off-screen can't morph convincingly — it would fly in from nowhere —
    so those fall back to the plain page crossfade. */
function onScreen(el: Element): boolean {
  const r = el.getBoundingClientRect()
  return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < window.innerHeight && r.right > 0 && r.left < window.innerWidth
}

interface Spec {
  /** Element on the CURRENT page that should morph (named before the old state is captured). */
  from: HTMLElement | null
  /** Looks up its counterpart on the NEW page, once the router has rendered it. */
  findTo: () => HTMLElement | null
}

export function runViewTransition(update: () => void, spec: Spec): void {
  if (active || !viewTransitionsSupported()) { update(); return }

  const from = spec.from && onScreen(spec.from) ? spec.from : null
  const startHref = window.location.href
  let to: HTMLElement | null = null
  const cleanup = () => {
    active = false
    if (from) from.style.viewTransitionName = ''
    if (to) to.style.viewTransitionName = ''
  }

  active = true
  if (from) from.style.viewTransitionName = NAME

  try {
    const transition = document.startViewTransition(async () => {
      update()
      // The router commits in a React transition, and the outgoing page leaves with an
      // exit that has nothing to animate — wait until the old page is really gone (or, with nothing to
      // morph, until the URL changed) so the NEW state never contains both pages.
      await until(() => (from ? !from.isConnected : window.location.href !== startHref), COMMIT_TIMEOUT_MS)
      if (from) from.style.viewTransitionName = ''
      const target = spec.findTo()
      if (target && onScreen(target)) { target.style.viewTransitionName = NAME; to = target }
      // Let layout effects and the new page's first paint-affecting work settle.
      await sleep(2 * TICK_MS)
    })
    transition.finished.catch(() => { /* skipped transitions are fine */ }).finally(cleanup)
  } catch {
    cleanup()
    update()
  }
}
