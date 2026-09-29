import { ease, ep, lerp, spring } from './timeline'

/** Stage (video frame) logical size. */
export const STAGE_W = 1080
export const STAGE_H = 1920

/** Phone frame geometry in stage px (at scale 1). */
export const PHONE = { w: 500, h: 1040, bezel: 14, radius: 78, screenRadius: 64 }
/** The app UI is laid out in a 390pt-wide space (a real iPhone), then scaled up. */
export const APP_W = 390
export const APP_H = 836
export const APP_K = (PHONE.w - PHONE.bezel * 2) / APP_W // ≈ 1.21

export const PHONE_REST = { cx: 540, cy: 1135 }
export const CENTER = { x: 540, y: 1135 }

export const PHONE_IN = 5.85
export const HERO_AT = 24.95

/** Where the phone is and how big it is at time t (stage space). */
export function phoneState(t: number) {
  if (t < PHONE_IN) return { visible: false, cx: PHONE_REST.cx, cy: PHONE_REST.cy + 1200, scale: 0.9, rot: 0 }
  const s = spring(t, PHONE_IN, { stiffness: 150, damping: 22 })
  const h = ep(t, HERO_AT, HERO_AT + 1.0, ease.inOut)
  const cy = lerp(PHONE_REST.cy + 1150, PHONE_REST.cy, s)
  return {
    visible: true,
    cx: PHONE_REST.cx,
    cy: lerp(cy, 1000, h) + (h > 0 ? Math.sin((t - HERO_AT) * 1.4) * 8 * h : 0),
    scale: lerp(lerp(0.88, 1, s), 0.7, h),
    rot: lerp(6, 0, s),
  }
}

/** Converts a point in app space (390×836) to stage space at time t. */
export function appToStage(x: number, y: number, t: number) {
  const p = phoneState(t)
  const left = p.cx - (PHONE.w / 2) * p.scale
  const top = p.cy - (PHONE.h / 2) * p.scale
  return {
    x: left + (PHONE.bezel + x * APP_K) * p.scale,
    y: top + (PHONE.bezel + y * APP_K) * p.scale,
    k: APP_K * p.scale,
  }
}

/** Scene 2 marks: pile collapses → mark appears → mark flies into the app header. */
export const MARK_AT = 4.56
export const FLY_AT = 6.02
export const FLY_END = 6.78
/** Header logo slot in app coordinates (right side of the header, RTL). */
export const HEADER_SLOT = { x: 374 - 15, y: 44 + 28, size: 30 }
