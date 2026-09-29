/**
 * The promo's single source of time.
 *
 * Every visual in the promo is a PURE function of one number: `t` (seconds since
 * the start). Nothing animates on its own clock — no CSS transitions, no Framer
 * springs running in the background. That gives two guarantees:
 *   1. Scenes can never drift out of sync with each other.
 *   2. Any frame can be rendered exactly by seeking to its time, which is what the
 *      MP4 exporter does (scripts/promo-export.mjs).
 *
 * Easing curves mirror the app's own motion tokens (src/lib/motion.ts), so the ad
 * moves the way the product moves.
 */

/**
 * All timings in the code are written on a 30-second "design" timeline.
 * To make the whole promo longer or shorter, change TIME_SCALE only:
 *   1    → 32s   (default)
 *   1.1  → 35.2s (everything 10% slower)
 *   0.9  → 28.8s (snappier)
 */
export const DESIGN_DURATION = 32
export const TIME_SCALE = 1
/** Real length of the promo in seconds. */
export const DURATION = DESIGN_DURATION * TIME_SCALE

/** Scene boundaries on the design timeline (seconds). */
export const SCENES = {
  problem:    { start: 0,  end: 4 },
  transition: { start: 4,  end: 7 },
  wallet:     { start: 7,  end: 12 },
  search:     { start: 12, end: 17 },
  balance:    { start: 17, end: 21 },
  expiry:     { start: 21, end: 25 },
  hero:       { start: 25, end: 32 },
} as const

// ── Basic math ──────────────────────────────────────────────────────────────

export const clamp = (v: number, min = 0, max = 1) => Math.min(max, Math.max(min, v))
export const lerp = (a: number, b: number, p: number) => a + (b - a) * p

/** Linear progress of `t` through [a, b], clamped to 0..1. */
export const prog = (t: number, a: number, b: number) => (b === a ? (t >= b ? 1 : 0) : clamp((t - a) / (b - a)))

/** Maps a progress value through [from..to] of the input range to 0..1 (for sub-ranges). */
export const within = (p: number, from: number, to: number) => clamp((p - from) / (to - from))

// ── Cubic-bezier easing (same solver approach as browsers) ──────────────────

function bezier(x1: number, y1: number, x2: number, y2: number) {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by
  const sx = (u: number) => ((ax * u + bx) * u + cx) * u
  const sy = (u: number) => ((ay * u + by) * u + cy) * u
  const dx = (u: number) => (3 * ax * u + 2 * bx) * u + cx
  return (x: number) => {
    if (x <= 0) return 0
    if (x >= 1) return 1
    let u = x
    for (let i = 0; i < 8; i++) {
      const err = sx(u) - x
      if (Math.abs(err) < 1e-6) break
      const d = dx(u)
      if (Math.abs(d) < 1e-6) break
      u -= err / d
    }
    // Bisection fallback for flat regions
    let lo = 0, hi = 1
    if (Math.abs(sx(u) - x) > 1e-4) {
      u = x
      for (let i = 0; i < 30; i++) {
        const v = sx(u)
        if (Math.abs(v - x) < 1e-6) break
        if (v < x) lo = u; else hi = u
        u = (lo + hi) / 2
      }
    }
    return sy(u)
  }
}

export const ease = {
  linear: (p: number) => p,
  /** Strong ease-out — entrances. = app's --ease-out */
  out: bezier(0.23, 1, 0.32, 1),
  /** Strong ease-in-out — movement between positions. = app's --ease-in-out */
  inOut: bezier(0.77, 0, 0.175, 1),
  /** iOS-like drawer curve. = app's --ease-drawer */
  drawer: bezier(0.32, 0.72, 0, 1),
  /** Accelerating — things being pulled away. */
  in: bezier(0.55, 0, 0.9, 0.3),
  soft: bezier(0.4, 0, 0.2, 1),
}

/** Eased progress of `t` through [a, b]. */
export const ep = (t: number, a: number, b: number, fn: (p: number) => number = ease.out) => fn(prog(t, a, b))

// ── Spring (closed-form damped oscillator, so it is seekable) ───────────────

export interface SpringCfg { stiffness?: number; damping?: number; mass?: number }

/**
 * Value of a spring going from 0 → 1, released at `start`. Returns 0 before start
 * and settles on 1 (with overshoot for under-damped configs). Pure function of t.
 * Defaults ≈ the app's SPRING token (subtle bounce).
 */
export function spring(t: number, start: number, cfg: SpringCfg = {}) {
  const { stiffness = 260, damping = 20, mass = 1 } = cfg
  const x = t - start
  if (x <= 0) return 0
  const w0 = Math.sqrt(stiffness / mass)
  const zeta = damping / (2 * Math.sqrt(stiffness * mass))
  if (zeta < 1) {
    const wd = w0 * Math.sqrt(1 - zeta * zeta)
    return 1 - Math.exp(-zeta * w0 * x) * (Math.cos(wd * x) + (zeta * w0 / wd) * Math.sin(wd * x))
  }
  // Critically / over-damped
  return 1 - Math.exp(-w0 * x) * (1 + w0 * x)
}

/** Presets, named by feel. */
export const SPR = {
  /** App default — subtle bounce. */
  ui: { stiffness: 260, damping: 22 },
  /** Pop-in with visible overshoot. */
  pop: { stiffness: 320, damping: 16 },
  /** Heavier, calmer (phone, sheets). = app's SHEET_SPRING feel */
  sheet: { stiffness: 380, damping: 38, mass: 0.9 },
  /** Soft float. */
  soft: { stiffness: 120, damping: 18 },
} satisfies Record<string, SpringCfg>

// ── Enter/exit helper ───────────────────────────────────────────────────────

/**
 * Presence of an element that appears at `inAt` and leaves at `outAt`.
 * Returns { in: 0..1 (eased), out: 0..1 (eased), on: visible-ish opacity }.
 */
export function presence(t: number, inAt: number, outAt: number, inDur = 0.5, outDur = 0.35) {
  const i = ep(t, inAt, inAt + inDur)
  const o = ep(t, outAt, outAt + outDur, ease.inOut)
  return { in: i, out: o, on: i * (1 - o) }
}

/** Deterministic pseudo-random in [0,1) from an integer seed. */
export function rand(seed: number) {
  const x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453
  return x - Math.floor(x)
}
