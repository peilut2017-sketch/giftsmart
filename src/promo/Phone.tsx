import type { CSSProperties, ReactNode } from 'react'
import { BatteryFull, Signal, Wifi } from 'lucide-react'
import { BRAND, NOTIFICATION } from './config'
import { APP_H, APP_K, APP_W, FLY_END, PHONE, SPLASH_ICON, STATUS_H, phoneState } from './layout'
import { LogoMark, Wordmark } from './Logo'
import { BOXES, SCREEN_TOP, SCREEN_URL, VIEW, center } from './screens'
import type { Box, BoxName, ScreenName } from './screens'
import { SPR, clamp, ease, ep, lerp, prog, spring } from './timeline'
import appIcon from './assets/app-icon.png'

/**
 * The phone (scenes 2–7). Its screen plays REAL GiftSmart screenshots (fake demo
 * data) in sequence, with the app's own page transitions. Only three things are
 * drawn on top, and none of them pretend to be app UI: finger taps, highlight
 * rings, and the iOS push notification (whose wording is copied from
 * supabase/functions/push-expiry).
 */

type Trans = 'cut' | 'fade' | 'tab' | 'push' | 'pop'
interface Shot { at: number; screen: ScreenName | 'splash'; trans: Trans }

/** The screen timeline (design seconds). Each shot replaces the previous one at `at`. */
const SHOTS: Shot[] = [
  { at: 0,     screen: 'splash',        trans: 'cut' },
  { at: 6.9,   screen: 'home',          trans: 'fade' },
  { at: 9.2,   screen: 'list',          trans: 'tab' },
  { at: 12.45, screen: 'search_0',      trans: 'cut' },
  { at: 12.62, screen: 'search_1',      trans: 'cut' },
  { at: 12.76, screen: 'search_2',      trans: 'cut' },
  { at: 12.9,  screen: 'search_3',      trans: 'cut' },
  { at: 13.04, screen: 'search_4',      trans: 'cut' },
  { at: 13.55, screen: 'voucher',       trans: 'push' },
  { at: 17.45, screen: 'use_0',         trans: 'fade' },
  { at: 17.75, screen: 'use_8',         trans: 'cut' },
  { at: 17.88, screen: 'use_80',        trans: 'cut' },
  { at: 18.45, screen: 'voucher_after', trans: 'fade' },
  { at: 21.1,  screen: 'list_after',    trans: 'pop' },
  { at: 24.95, screen: 'home_after',    trans: 'fade' },
]

/** Taps (design seconds + a box to tap, or a point in captured-viewport points). */
const TAPS: { at: number; box?: BoxName; pt?: { x: number; y: number } }[] = [
  { at: 8.85,  box: 'nav_vouchers' },
  { at: 12.28, box: 'search_input' },
  { at: 13.3,  box: 'search_zara_card' },
  { at: 17.2,  box: 'voucher_fab' },
  { at: 17.62, box: 'use_amount' },
  { at: 18.22, box: 'use_fab' },
  { at: 20.85, pt: { x: 375, y: 31 } },   // the page's back arrow
]

/** Highlight rings: [box, in, out] (design seconds). */
const RINGS: [BoxName, number, number][] = [
  ['list_zara_balance', 10.3, 11.95],
  ['list_zara_expiry', 10.85, 11.95],
  ['voucher_code', 14.55, 17.05],
  ['after_balance', 18.75, 20.7],
  ['list_after_fox_expiry', 21.9, 24.4],
]

const DUR: Record<Trans, number> = { cut: 0, fade: 0.3, tab: 0.24, push: 0.28, pop: 0.28 }

// ── Pieces ──────────────────────────────────────────────────────────────────

const isDark = (hex: string) => {
  const n = parseInt(hex.slice(1), 16)
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255]
  return 0.299 * r + 0.587 * g + 0.114 * b < 170
}

function StatusBar({ color }: { color: string }) {
  const fg = isDark(color) ? '#fff' : BRAND.text
  return (
    <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: STATUS_H, background: color, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 30px 0', color: fg, fontSize: 15, fontWeight: 700, zIndex: 50, direction: 'ltr', fontFeatureSettings: '"tnum"' }}>
      <span>9:41</span>
      <span style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
        <Signal size={15} strokeWidth={2.6} /><Wifi size={15} strokeWidth={2.6} /><BatteryFull size={20} strokeWidth={2} />
      </span>
    </div>
  )
}

/** The app's boot screen (GiftSmartSplash: real logo + slim brand bar). The flying mark lands on it. */
function Splash({ t }: { t: number }) {
  const landed = t >= FLY_END ? 1 : 0
  const settle = spring(t, FLY_END, SPR.pop)
  const word = ep(t, FLY_END - 0.05, FLY_END + 0.35)
  const bar = (t * 1.1) % 1
  return (
    <div style={{ position: 'absolute', inset: 0, background: '#f2f4f3' }}>
      <div style={{ position: 'absolute', left: SPLASH_ICON.x - SPLASH_ICON.size / 2, top: SPLASH_ICON.y - SPLASH_ICON.size / 2, opacity: landed, transform: `scale(${lerp(1.12, 1, clamp(settle))})` }}>
        <LogoMark size={SPLASH_ICON.size} />
      </div>
      <div style={{ position: 'absolute', top: SPLASH_ICON.y + SPLASH_ICON.size / 2 + 8, left: 0, right: 0, display: 'flex', justifyContent: 'center', opacity: word, transform: `translateY(${lerp(8, 0, word)}px)` }}>
        <Wordmark width={176} />
      </div>
      <div style={{ position: 'absolute', top: SPLASH_ICON.y + SPLASH_ICON.size / 2 + 62, left: APP_W / 2 - 60, width: 120, height: 4, borderRadius: 2, background: '#dfe6e3', overflow: 'hidden', opacity: word }}>
        <div style={{ position: 'absolute', top: 0, bottom: 0, width: 50, borderRadius: 2, left: lerp(-50, 120, bar), background: `linear-gradient(90deg, ${BRAND.green}, ${BRAND.greenDark})` }} />
      </div>
    </div>
  )
}

function ScreenImage({ name, style }: { name: ScreenName; style?: CSSProperties }) {
  return (
    <img
      src={SCREEN_URL[name]}
      alt=""
      draggable={false}
      style={{ position: 'absolute', left: 0, top: STATUS_H, width: VIEW.width, height: VIEW.height, display: 'block', ...style }}
    />
  )
}

function Layer({ shot, t }: { shot: Shot; t: number }) {
  return shot.screen === 'splash' ? <Splash t={t} /> : <ScreenImage name={shot.screen} />
}

/** Transform for the entering (dir=1) / leaving (dir=-1) page — mirrors AnimatedRoutes.tsx. */
function transStyle(trans: Trans, p: number, entering: boolean): CSSProperties {
  switch (trans) {
    case 'tab':  return entering
      ? { opacity: p, transform: `translateX(${lerp(-24, 0, p)}%)`, filter: `blur(${2 * (1 - p)}px)` }
      : { opacity: 1 - p, transform: `translateX(${lerp(0, 12, p)}%)`, filter: `blur(${2 * p}px)` }
    case 'push': return entering
      ? { opacity: p, transform: `scale(${lerp(0.97, 1, p)})` }
      : { opacity: 1 - p, transform: `scale(${lerp(1, 1.01, p)})` }
    case 'pop':  return entering
      ? { opacity: p, transform: `scale(${lerp(1.01, 1, p)})` }
      : { opacity: 1 - p, transform: `scale(${lerp(1, 0.97, p)})` }
    case 'fade': return entering ? { opacity: p } : { opacity: 1 }
    default:     return {}
  }
}

function Screens({ t }: { t: number }) {
  let i = 0
  for (let k = 0; k < SHOTS.length; k++) if (t >= SHOTS[k].at) i = k
  const cur = SHOTS[i]
  const prev = SHOTS[i - 1]
  const d = DUR[cur.trans]
  const p = d > 0 ? ease.drawer(prog(t, cur.at, cur.at + d)) : 1
  const top = (s: Shot) => (s.screen === 'splash' ? '#f2f4f3' : SCREEN_TOP[s.screen])
  const bar = p < 1 && prev ? (p < 0.5 ? top(prev) : top(cur)) : top(cur)
  return (
    <>
      {p < 1 && prev && (
        <div style={{ position: 'absolute', inset: 0, ...transStyle(cur.trans, p, false) }}>
          <Layer shot={prev} t={t} />
        </div>
      )}
      <div style={{ position: 'absolute', inset: 0, ...(p < 1 ? transStyle(cur.trans, p, true) : {}) }}>
        <Layer shot={cur} t={t} />
      </div>
      <StatusBar color={bar} />
    </>
  )
}

/** A finger tap: soft dark disc that presses in, then a ripple. */
function Taps({ t }: { t: number }) {
  return (
    <>
      {TAPS.map((tap, i) => {
        const p = prog(t, tap.at - 0.12, tap.at + 0.42)
        if (p <= 0 || p >= 1) return null
        const pt = tap.pt ?? center(BOXES[tap.box!])
        const down = ep(t, tap.at - 0.12, tap.at, ease.out)
        const up = ep(t, tap.at + 0.08, tap.at + 0.42, ease.out)
        const ripple = ep(t, tap.at, tap.at + 0.42, ease.out)
        return (
          <div key={i} style={{ position: 'absolute', left: pt.x, top: pt.y + STATUS_H, zIndex: 70, pointerEvents: 'none' }}>
            <div style={{ position: 'absolute', width: 64, height: 64, left: -32, top: -32, borderRadius: 32, border: `2px solid rgba(255,255,255,${0.8 * (1 - ripple)})`, transform: `scale(${lerp(0.5, 1.5, ripple)})`, boxShadow: `0 0 0 1px rgba(15,28,26,${0.15 * (1 - ripple)})` }} />
            <div style={{ position: 'absolute', width: 44, height: 44, left: -22, top: -22, borderRadius: 22, background: 'rgba(15,28,26,.28)', border: '2px solid rgba(255,255,255,.85)', transform: `scale(${lerp(1.3, 0.85, down)})`, opacity: down * (1 - up) }} />
          </div>
        )
      })}
    </>
  )
}

function Ring({ b, on, t, from }: { b: Box; on: number; t: number; from: number }) {
  const pulse = (((t - from) % 1.3) / 1.3)
  const r = Math.min(18, b.h / 2 + 4)
  return (
    <div style={{ position: 'absolute', left: b.x, top: b.y + STATUS_H, width: b.w, height: b.h, zIndex: 60, pointerEvents: 'none', opacity: on, transform: `scale(${lerp(1.15, 1, clamp(on))})` }}>
      <div style={{ position: 'absolute', inset: 0, borderRadius: r, border: `2.5px solid ${BRAND.green}`, boxShadow: `0 0 0 4px rgba(34,197,94,.18), 0 0 22px rgba(34,197,94,.45)` }} />
      <div style={{ position: 'absolute', inset: 0, borderRadius: r, border: `2px solid rgba(34,197,94,${0.5 * (1 - pulse)})`, transform: `scale(${1 + pulse * 0.18})` }} />
    </div>
  )
}

function Rings({ t }: { t: number }) {
  return (
    <>
      {RINGS.map(([name, a, z]) => {
        const on = spring(t, a, SPR.ui) * (1 - ep(t, z, z + 0.3))
        return on > 0.01 ? <Ring key={name} b={BOXES[name]} on={on} t={t} from={a} /> : null
      })}
    </>
  )
}

/** iOS-style push. Text mirrors supabase/functions/push-expiry for a 7-days-left voucher. */
const NOTIF_IN = 22.25
const NOTIF_OUT = 24.3
function Notification({ t }: { t: number }) {
  if (t < NOTIF_IN || t > NOTIF_OUT + 0.5) return null
  const inP = spring(t, NOTIF_IN, { stiffness: 260, damping: 19 })
  const outP = ep(t, NOTIF_OUT, NOTIF_OUT + 0.4, ease.in)
  const y = lerp(-130, 50, inP) - outP * 190
  return (
    <div
      style={{
        position: 'absolute', left: 10, right: 10, top: y, zIndex: 80, borderRadius: 24, padding: '12px 14px',
        background: 'rgba(250,251,251,.82)', backdropFilter: 'blur(22px) saturate(1.8)', WebkitBackdropFilter: 'blur(22px) saturate(1.8)',
        border: '1px solid rgba(255,255,255,.7)', boxShadow: '0 16px 40px -8px rgba(15,28,26,.3)',
        display: 'flex', gap: 12, alignItems: 'center', direction: 'rtl',
      }}
    >
      <img src={appIcon} alt="" style={{ width: 40, height: 40, borderRadius: 10, flexShrink: 0, boxShadow: '0 0 0 .5px rgba(0,0,0,.12)' }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5 }}>
          <span style={{ fontWeight: 700, color: BRAND.text2, direction: 'ltr' }}>GiftSmart</span>
          <span style={{ color: BRAND.text3 }}>עכשיו</span>
        </div>
        <div style={{ fontSize: 15, fontWeight: 800, color: BRAND.text, marginTop: 1 }}>{NOTIFICATION.title}</div>
        <div style={{ fontSize: 14, color: BRAND.text2, marginTop: 1 }}>{NOTIFICATION.body}</div>
      </div>
    </div>
  )
}

export default function Phone({ t }: { t: number }): ReactNode {
  const p = phoneState(t)
  if (!p.visible) return null
  return (
    <div
      style={{
        position: 'absolute', left: p.cx - PHONE.w / 2, top: p.cy - PHONE.h / 2, width: PHONE.w, height: PHONE.h,
        transform: `scale(${p.scale})`, zIndex: 20,
      }}
    >
      <div style={{ position: 'absolute', left: 30, right: 30, bottom: -30, height: 60, borderRadius: '50%', background: 'rgba(15,28,26,.22)', filter: 'blur(30px)' }} />
      <div
        style={{
          position: 'absolute', inset: 0, borderRadius: PHONE.radius,
          background: 'linear-gradient(145deg, #2b3432 0%, #0e1413 45%, #1f2725 100%)',
          boxShadow: 'inset 0 0 0 2px rgba(255,255,255,.08), 0 50px 100px -30px rgba(15,28,26,.45), 0 30px 60px -30px rgba(15,28,26,.35)',
        }}
      />
      <div style={{ position: 'absolute', right: -4, top: 250, width: 5, height: 110, borderRadius: 3, background: '#1b2321' }} />
      <div style={{ position: 'absolute', left: -4, top: 210, width: 5, height: 70, borderRadius: 3, background: '#1b2321' }} />
      <div style={{ position: 'absolute', left: -4, top: 300, width: 5, height: 70, borderRadius: 3, background: '#1b2321' }} />
      <div
        style={{
          position: 'absolute', left: PHONE.bezel, top: PHONE.bezel, right: PHONE.bezel, bottom: PHONE.bezel,
          borderRadius: PHONE.screenRadius, overflow: 'hidden', background: '#f2f4f3',
        }}
      >
        <div style={{ position: 'absolute', left: 0, top: 0, width: APP_W, height: APP_H, transform: `scale(${APP_K})`, transformOrigin: '0 0' }}>
          <Screens t={t} />
          <Rings t={t} />
          <Taps t={t} />
          <Notification t={t} />
          <div style={{ position: 'absolute', bottom: 7, left: '50%', width: 134, height: 5, marginLeft: -67, borderRadius: 3, background: 'rgba(15,28,26,.85)', zIndex: 90 }} />
        </div>
        <div style={{ position: 'absolute', top: 14, left: '50%', width: 138, height: 40, marginLeft: -69, borderRadius: 20, background: '#000', zIndex: 95 }} />
        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(115deg, rgba(255,255,255,.10) 0%, rgba(255,255,255,0) 30%)', pointerEvents: 'none', zIndex: 96 }} />
      </div>
    </div>
  )
}
