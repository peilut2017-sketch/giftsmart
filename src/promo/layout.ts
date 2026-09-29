import { BOXES, VIEW, center } from './screens'
import { ease, ep, lerp, spring } from './timeline'

/** Stage (video frame) logical size. */
export const STAGE_W = 1080
export const STAGE_H = 1920

/** iPhone status bar height (pt) drawn above the captured app viewport. */
export const STATUS_H = 44
/** App space = a real iPhone screen in points: status bar + captured app viewport. */
export const APP_W = VIEW.width                 // 390
export const APP_H = STATUS_H + VIEW.height      // 844

/** Phone frame geometry in stage px (at scale 1). */
const BEZEL = 15
const SCREEN_W = 530
export const APP_K = SCREEN_W / APP_W            // ≈ 1.21 stage px per pt
export const PHONE = { w: SCREEN_W + BEZEL * 2, h: Math.round(APP_H * APP_K) + BEZEL * 2, bezel: BEZEL, radius: 86, screenRadius: 71 }

export const PHONE_REST = { cx: 540, cy: 1168 }
export const CENTER = { x: 540, y: 1135 }

// ── Master marks shared by several layers (design seconds) ──────────────────
export const PHONE_IN = 5.85
/** Scene 2: pile collapses → real logo appears → flies onto the app's splash screen. */
export const MARK_AT = 4.56
export const FLY_AT = 5.95
export const FLY_END = 6.62
/** Camera push-in on the QR code in scene 4. */
export const QR_ZOOM = { in: [14.45, 15.1] as const, out: [16.75, 17.2] as const, amount: 1.13 }
export const HERO_AT = 24.95

/** Where the splash screen's logo sits, in app points (see Phone.tsx › Splash). */
export const SPLASH_ICON = { x: APP_W / 2, y: APP_H / 2 - 30, size: 150 }

function baseState(t: number) {
  if (t < PHONE_IN) return { visible: false, cx: PHONE_REST.cx, cy: PHONE_REST.cy + 1200, scale: 0.9 }
  const s = spring(t, PHONE_IN, { stiffness: 150, damping: 22 })
  const h = ep(t, HERO_AT, HERO_AT + 1.0, ease.inOut)
  const cy = lerp(PHONE_REST.cy + 1150, PHONE_REST.cy, s)
  return {
    visible: true,
    cx: PHONE_REST.cx,
    cy: lerp(cy, 1000, h) + (h > 0 ? Math.sin((t - HERO_AT) * 1.4) * 8 * h : 0),
    scale: lerp(lerp(0.88, 1, s), 0.62, h),
  }
}

function toStage(x: number, y: number, p: { cx: number; cy: number; scale: number }) {
  const left = p.cx - (PHONE.w / 2) * p.scale
  const top = p.cy - (PHONE.h / 2) * p.scale
  return { x: left + (PHONE.bezel + x * APP_K) * p.scale, y: top + (PHONE.bezel + y * APP_K) * p.scale, k: APP_K * p.scale }
}

/** Where the phone is and how big it is at time t (stage space), including the QR push-in. */
export function phoneState(t: number) {
  const b = baseState(t)
  const z = 1 + (QR_ZOOM.amount - 1) *
    ep(t, QR_ZOOM.in[0], QR_ZOOM.in[1], ease.inOut) * (1 - ep(t, QR_ZOOM.out[0], QR_ZOOM.out[1], ease.inOut))
  if (z === 1) return b
  const q = center(BOXES.voucher_code)
  const P = toStage(q.x, q.y + STATUS_H, b)
  return { ...b, cx: P.x + (b.cx - P.x) * z, cy: P.y + (b.cy - P.y) * z, scale: b.scale * z }
}

/** Converts a point in app space (390×844 pt) to stage space at time t. */
export function appToStage(x: number, y: number, t: number) {
  return toStage(x, y, phoneState(t))
}
