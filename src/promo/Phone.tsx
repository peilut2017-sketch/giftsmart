import type { CSSProperties, ReactNode } from 'react'
import { Bell, Check, ChevronLeft, Home, Search, ScanBarcode, Settings, Store, Sun, TriangleAlert, Wifi, X, BatteryFull, Signal } from 'lucide-react'
import { BRAND, EXPIRY_DAYS_LEFT, EXPIRY_ID, FOCUS_ID, SEARCH_TEXT, SPEND, VOUCHERS } from './config'
import type { DemoVoucher } from './config'
import { APP_H, APP_K, APP_W, FLY_END, HEADER_SLOT, PHONE, phoneState } from './layout'
import Mark from './Mark'
import { SPR, clamp, ease, ep, lerp, prog, spring } from './timeline'
import { Barcode, StoreAvatar } from './ui'

/**
 * The phone and everything on its screen (scenes 2–7). The app UI is laid out
 * in real iPhone points (390×836) using the app's own tokens and component
 * shapes (VoucherCard, BottomNav, InStoreMode), then scaled into the frame.
 */

const fmt = (n: number) => `₪${Math.round(n).toLocaleString('he-IL')}`
const ltr: CSSProperties = { direction: 'ltr', unicodeBidi: 'isolate', fontFeatureSettings: '"tnum"' }

// ── Timeline marks (design seconds) ─────────────────────────────────────────
const T = {
  uiIn: 6.85,
  scrollDown: [9.0, 9.9] as const,
  hl: [10.3, 10.85, 11.4] as const,
  hlOut: 11.95,
  scrollUp: [11.95, 12.35] as const,
  focus: 12.3,
  typeAt: 12.5,
  typeStep: 0.13,
  filter: 13.1,
  moveUp: [13.2, 13.7] as const,
  expand: [13.8, 14.32] as const,
  detailIn: 14.1,
  barcode: 14.5,
  sheetIn: 17.2,
  amountAt: 17.62,
  tap: 18.22,
  sheetOut: 18.5,
  spendChip: 18.62,
  count: [18.85, 19.75] as const,
  saved: 19.55,
  collapse: [20.95, 21.4] as const,
  restore: 21.3,
  totalCount: [21.55, 22.2] as const,
  expiryChip: 21.95,
  notifIn: 22.25,
  notifOut: 24.3,
}

const LIST_TOP = 330
const CARD_H = 100
const CARD_GAP = 10
const FOCUS_Y = 170
const DETAIL_TOP = 100

const focus = VOUCHERS.find(v => v.id === FOCUS_ID)!
const initialTotal = VOUCHERS.reduce((s, v) => s + v.balance, 0)

function focusBalance(t: number) {
  return lerp(focus.balance, focus.balance - SPEND, ep(t, T.count[0], T.count[1], ease.out))
}

// ── Pieces ──────────────────────────────────────────────────────────────────

function StatusBar({ dark = false }: { dark?: boolean }) {
  const c = dark ? '#fff' : BRAND.text
  return (
    <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 44, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 30px', color: c, fontSize: 15, fontWeight: 700, zIndex: 50 }}>
      <span style={ltr}>9:41</span>
      <span style={{ display: 'flex', gap: 5, alignItems: 'center', direction: 'ltr' }}>
        <Signal size={15} strokeWidth={2.6} /><Wifi size={15} strokeWidth={2.6} /><BatteryFull size={20} strokeWidth={2} />
      </span>
    </div>
  )
}

function Header({ t }: { t: number }) {
  const logoOn = t >= FLY_END ? 1 : 0
  const settle = spring(t, FLY_END, SPR.pop)
  const wordmark = ep(t, FLY_END - 0.05, FLY_END + 0.45)
  const bellHit = t >= T.notifIn - 0.15 ? Math.sin((t - T.notifIn + 0.15) * 30) * 16 * Math.exp(-(t - T.notifIn + 0.15) * 5) : 0
  const dot = spring(t, T.notifIn - 0.15, SPR.pop)
  return (
    <div style={{ position: 'absolute', top: 44, left: 0, right: 0, height: 56, display: 'flex', alignItems: 'center', padding: '0 16px', gap: 10, zIndex: 20 }}>
      <div style={{ width: HEADER_SLOT.size, height: HEADER_SLOT.size, opacity: logoOn, transform: `scale(${lerp(1.25, 1, Math.min(1, settle))})` }}>
        <Mark size={HEADER_SLOT.size} />
      </div>
      <div style={{ fontSize: 21, fontWeight: 800, letterSpacing: '-0.02em', color: BRAND.text, opacity: wordmark, transform: `translateX(${lerp(12, 0, wordmark)}px)`, direction: 'ltr' }}>
        GiftSmart
      </div>
      <div style={{ marginInlineStart: 'auto', position: 'relative', width: 38, height: 38, borderRadius: 19, background: BRAND.surface, boxShadow: '0 1px 3px rgba(0,0,0,.06)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: BRAND.text2, opacity: wordmark }}>
        <div style={{ transform: `rotate(${bellHit}deg)`, transformOrigin: '50% 10%', display: 'flex' }}><Bell size={18} strokeWidth={2.2} /></div>
        {t >= T.notifIn - 0.15 && t < 24.9 && (
          <div style={{ position: 'absolute', top: 7, right: 8, width: 9, height: 9, borderRadius: 5, background: BRAND.urgent, border: '2px solid #fff', transform: `scale(${dot})` }} />
        )}
      </div>
    </div>
  )
}

function SearchBar({ t }: { t: number }) {
  const focusP = ep(t, T.focus, T.focus + 0.25) * (1 - ep(t, T.collapse[0], T.collapse[0] + 0.3))
  const typed = Math.max(0, Math.min(SEARCH_TEXT.length, Math.floor((t - T.typeAt) / T.typeStep) + 1))
  const cleared = t >= T.collapse[0] + 0.1
  const text = t >= T.typeAt && !cleared ? SEARCH_TEXT.slice(0, typed) : ''
  const caretOn = focusP > 0.5 && Math.floor(t * 2.4) % 2 === 0 && t < T.expand[0]
  return (
    <div
      style={{
        height: 44, borderRadius: 14, background: BRAND.surface, display: 'flex', alignItems: 'center', gap: 8, padding: '0 14px',
        border: `1.5px solid ${focusP > 0 ? `rgba(34,197,94,${0.25 + focusP * 0.75})` : BRAND.border}`,
        boxShadow: `0 0 0 ${focusP * 4}px rgba(34,197,94,.15)`,
      }}
    >
      <Search size={18} color={focusP > 0.5 ? BRAND.greenDeep : BRAND.text3} strokeWidth={2.3} />
      {text ? (
        <span style={{ fontSize: 16, fontWeight: 700, color: BRAND.text, ...ltr }}>{text}</span>
      ) : (
        <span style={{ fontSize: 15, color: BRAND.text3 }}>חיפוש שובר, חנות או קוד</span>
      )}
      {caretOn && <span style={{ width: 2, height: 20, background: BRAND.green, borderRadius: 1, marginInlineStart: -4 }} />}
    </div>
  )
}

function TotalCard({ t }: { t: number }) {
  const first = lerp(0, initialTotal, ep(t, 7.25, 8.4, ease.out))
  const after = lerp(0, SPEND, ep(t, T.totalCount[0], T.totalCount[1], ease.out))
  const total = t < T.totalCount[0] ? first : initialTotal - after
  return (
    <div
      style={{
        height: 112, borderRadius: 20, padding: '16px 18px', position: 'relative', overflow: 'hidden', color: '#fff',
        background: `linear-gradient(135deg, ${BRAND.green} 0%, ${BRAND.greenDark} 100%)`,
        boxShadow: '0 10px 24px -10px rgba(22,163,74,.55)',
      }}
    >
      <div style={{ position: 'absolute', width: 180, height: 180, borderRadius: 90, background: 'rgba(255,255,255,.12)', left: -50, top: -70 }} />
      <div style={{ position: 'absolute', width: 120, height: 120, borderRadius: 60, background: 'rgba(255,255,255,.08)', left: 60, bottom: -70 }} />
      <div style={{ fontSize: 14, opacity: 0.9, fontWeight: 500 }}>סה״כ יתרה בארנק</div>
      <div style={{ fontSize: 38, fontWeight: 900, letterSpacing: '-0.02em', marginTop: 2, ...ltr, textAlign: 'right' }}>{fmt(total)}</div>
      <div style={{ fontSize: 13, opacity: 0.9, marginTop: 2 }}>{VOUCHERS.length} שוברים פעילים</div>
    </div>
  )
}

function highlightStyle(h: number, radius = 10): CSSProperties {
  if (h <= 0) return {}
  return { boxShadow: `0 0 0 ${2 + h * 3}px rgba(34,197,94,${0.55 * h}), 0 0 ${18 * h}px rgba(34,197,94,${0.35 * h})`, borderRadius: radius, background: `rgba(220,252,231,${0.9 * h})` }
}

/** Visual twin of the app's VoucherCard (card mode) with animation hooks. */
function VoucherRow({ v, t, hl = [0, 0, 0] }: { v: DemoVoucher; t: number; hl?: [number, number, number] }) {
  const isFocus = v.id === FOCUS_ID
  const balance = isFocus ? focusBalance(t) : v.balance
  const amount = v.amount
  const pct = amount > 0 ? balance / amount : 1
  const isExpiry = v.id === EXPIRY_ID
  const warn = isExpiry ? ep(t, T.expiryChip, T.expiryChip + 0.3) * (1 - ep(t, 24.9, 25.3)) : 0
  const pulse = warn > 0 ? (((t - T.expiryChip) % 0.9) / 0.9) : 0
  const chipColor = warn > 0.5 ? BRAND.urgent : BRAND.text3
  const chipBg = warn > 0.5 ? BRAND.urgentBg : BRAND.appBg
  return (
    <div
      style={{
        height: CARD_H, borderRadius: 18, background: BRAND.surface, display: 'flex', overflow: 'hidden', position: 'relative',
        boxShadow: warn > 0 ? `0 0 0 ${1.5 * warn}px rgba(222,19,19,.35), 0 1px 3px rgba(0,0,0,.05), 0 4px 16px rgba(0,0,0,.07)` : '0 1px 3px rgba(0,0,0,.05), 0 4px 16px rgba(0,0,0,.07)',
      }}
    >
      <div style={{ width: 5, background: v.color, flexShrink: 0 }} />
      <div style={{ flex: 1, padding: '14px 14px 12px', minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <StoreAvatar name={v.store} color={v.color} size={44} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 800, fontSize: 16, color: BRAND.text }}>{v.store}</div>
            <div style={{ fontSize: 12, color: BRAND.text3 }}>{v.category}</div>
          </div>
          <div style={{ textAlign: 'left', padding: '2px 6px', margin: '-2px -6px', ...highlightStyle(hl[0]) }}>
            <div style={{ fontWeight: 800, fontSize: 22, letterSpacing: '-0.5px', lineHeight: 1, color: BRAND.text, ...ltr }}>{fmt(balance)}</div>
            {Math.round(balance) !== amount && (
              <div style={{ fontSize: 11, color: BRAND.text3, textDecoration: 'line-through', marginTop: 3, ...ltr }}>{fmt(amount)}</div>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 10 }}>
          <div style={{ position: 'relative' }}>
            {warn > 0 && (
              <div style={{ position: 'absolute', inset: 0, borderRadius: 999, boxShadow: `0 0 0 ${pulse * 8}px rgba(222,19,19,${0.3 * (1 - pulse)})` }} />
            )}
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, fontWeight: 600, padding: '3px 9px', borderRadius: 999, color: chipColor, background: chipBg, ...highlightStyle(hl[1], 999) }}>
              {warn > 0.5 && <TriangleAlert size={12} strokeWidth={2.5} />}
              {warn > 0.5 ? `נותרו ${EXPIRY_DAYS_LEFT} ימים` : v.expiry}
            </span>
          </div>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, color: BRAND.text2, padding: '3px 8px', borderRadius: 8, background: BRAND.appBg, ...highlightStyle(hl[2], 8) }}>
            <ScanBarcode size={13} strokeWidth={2.2} />
            <span style={ltr}>••••{v.code.slice(-4)}</span>
          </span>
        </div>
      </div>
      {/* balance bar — only once part of the voucher was used (same rule as the app) */}
      {pct < 0.999 && (
        <div style={{ position: 'absolute', left: 14, right: 19, bottom: 5, height: 3, borderRadius: 2, background: BRAND.appBg, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: '100%', background: v.color, transform: `scaleX(${pct})`, transformOrigin: 'right', borderRadius: 2 }} />
        </div>
      )}
    </div>
  )
}

function BottomNav({ t }: { t: number }) {
  const inP = spring(t, T.uiIn + 0.25, SPR.ui)
  const hide = ep(t, T.expand[0] - 0.1, T.expand[0] + 0.25, ease.inOut) * (1 - ep(t, T.collapse[1] - 0.1, T.collapse[1] + 0.35))
  const y = lerp(110, 0, inP) + hide * 110
  const items = [
    { icon: <Home size={22} strokeWidth={2.3} />, label: 'בית', on: true },
    { icon: <Search size={22} strokeWidth={2.3} />, label: 'חיפוש' },
    { icon: <Store size={22} strokeWidth={2.3} />, label: 'שוק' },
    { icon: <Settings size={22} strokeWidth={2.3} />, label: 'הגדרות' },
  ]
  return (
    <div
      style={{
        position: 'absolute', left: 16, right: 16, bottom: 18, height: 66, borderRadius: 33, zIndex: 30,
        background: 'rgba(255,255,255,.78)', backdropFilter: 'blur(18px) saturate(1.6)', WebkitBackdropFilter: 'blur(18px) saturate(1.6)',
        border: '1px solid rgba(255,255,255,.6)', boxShadow: '0 12px 40px rgba(0,0,0,.12)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-around', padding: '0 8px',
        transform: `translateY(${y}px)`,
      }}
    >
      {items.map((it, i) => (
        <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, padding: '6px 16px', borderRadius: 22, background: it.on ? BRAND.greenLight : 'transparent', color: it.on ? BRAND.greenDeep : BRAND.text3 }}>
          {it.icon}
          <span style={{ fontSize: 10.5, fontWeight: 700 }}>{it.label}</span>
        </div>
      ))}
    </div>
  )
}

/** Opened voucher (InStoreMode-style) that morphs out of the card. */
function Detail({ t, open }: { t: number; open: number }) {
  const r = {
    x: lerp(16, 0, open), y: lerp(FOCUS_Y, DETAIL_TOP, open),
    w: lerp(358, APP_W, open), h: lerp(CARD_H, APP_H - DETAIL_TOP, open),
    radius: lerp(18, 30, open),
  }
  const content = ep(t, T.detailIn, T.detailIn + 0.4) * (1 - ep(t, T.collapse[0] - 0.1, T.collapse[0] + 0.15))
  const bc = spring(t, T.barcode, { stiffness: 200, damping: 14 })
  const glow = t >= T.barcode ? (0.55 + 0.45 * Math.sin((t - T.barcode) * 3.2)) * ep(t, T.barcode, T.barcode + 0.4) * (1 - ep(t, T.sheetIn - 0.3, T.sheetIn)) : 0
  const balance = focusBalance(t)
  const pct = balance / focus.amount
  const chip = spring(t, T.spendChip, SPR.pop)
  const chipFloat = ep(t, T.spendChip + 0.35, T.spendChip + 1.0, ease.soft)
  const saved = spring(t, T.saved, SPR.pop) * (1 - ep(t, T.collapse[0] - 0.2, T.collapse[0]))
  const bump = t >= T.count[0] ? 1 + 0.06 * Math.sin(prog(t, T.count[0], T.count[1]) * Math.PI) : 1
  const rowIn = (d: number): CSSProperties => {
    const p = ep(t, T.detailIn + d, T.detailIn + d + 0.45)
    return { opacity: Math.min(p, content), transform: `translateY(${lerp(18, 0, p)}px)` }
  }
  return (
    <div
      style={{
        position: 'absolute', left: r.x, top: r.y, width: r.w, height: r.h, zIndex: 25,
        borderRadius: r.radius, background: BRAND.surface, overflow: 'hidden',
        boxShadow: `0 ${lerp(4, 20, open)}px ${lerp(16, 50, open)}px rgba(15,28,26,${lerp(0.08, 0.16, open)})`,
      }}
    >
      {/* strip fades as it opens */}
      <div style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 5, background: focus.color, opacity: 1 - open }} />
      {/* top row — identical position to the card's, so the morph reads as one object */}
      <div style={{ position: 'absolute', top: 14, left: 14, right: 19, display: 'flex', alignItems: 'center', gap: 12 }}>
        <StoreAvatar name={focus.store} color={focus.color} size={44} />
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 800, fontSize: 16, color: BRAND.text }}>{focus.store}</div>
          <div style={{ fontSize: 12, color: BRAND.text3 }}>{focus.category}</div>
        </div>
        <div style={{ width: 34, height: 34, borderRadius: 17, background: BRAND.appBg, display: 'flex', alignItems: 'center', justifyContent: 'center', color: BRAND.text2, opacity: content }}>
          <X size={17} strokeWidth={2.4} />
        </div>
      </div>
      {/* summary balance of the card state (fades out as the big one comes in) */}
      <div style={{ position: 'absolute', top: 25, left: 14, opacity: 1 - content, fontWeight: 800, fontSize: 22, color: BRAND.text, ...ltr }}>
        {fmt(balance)}
      </div>

      {open > 0.02 && (
        <div style={{ position: 'absolute', top: 76, left: 20, right: 20 }}>
          <div style={{ ...rowIn(0) }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 13, color: BRAND.text3, fontWeight: 600 }}>יתרה נוכחית</span>
              {saved > 0.01 && (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 11.5, fontWeight: 700, color: BRAND.greenDeep, background: BRAND.greenLight, padding: '2px 8px', borderRadius: 999, transform: `scale(${saved})` }}>
                  <Check size={12} strokeWidth={3} /> עודכן
                </span>
              )}
            </div>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, marginTop: 2, position: 'relative' }}>
              <div style={{ fontSize: 50, fontWeight: 900, letterSpacing: '-0.03em', lineHeight: 1.05, color: BRAND.text, transform: `scale(${bump})`, transformOrigin: 'right bottom', ...ltr }}>
                {fmt(balance)}
              </div>
              {Math.round(balance) !== focus.amount && (
                <div style={{ fontSize: 17, color: BRAND.text3, textDecoration: 'line-through', marginBottom: 8, opacity: ep(t, T.count[1] - 0.3, T.count[1] + 0.1), ...ltr }}>{fmt(focus.amount)}</div>
              )}
              {chip > 0.01 && (
                <div style={{
                  position: 'absolute', left: 0, top: 6, fontSize: 20, fontWeight: 800, color: BRAND.urgent, background: BRAND.urgentBg,
                  padding: '4px 12px', borderRadius: 999, ...ltr,
                  opacity: Math.min(1, chip) * (1 - chipFloat), transform: `translateY(${-chipFloat * 40}px) scale(${chip})`,
                }}>
                  −{fmt(SPEND)}
                </div>
              )}
            </div>
            <div style={{ height: 6, borderRadius: 3, background: BRAND.appBg, marginTop: 10, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: '100%', background: `linear-gradient(90deg, ${BRAND.greenDark}, ${BRAND.green})`, borderRadius: 3, transform: `scaleX(${pct})`, transformOrigin: 'right' }} />
            </div>
          </div>

          <div style={{ ...rowIn(0.08), marginTop: 22 }}>
            <div
              style={{
                borderRadius: 20, border: `1.5px solid ${glow > 0 ? `rgba(34,197,94,${0.3 + glow * 0.5})` : BRAND.border}`,
                padding: '18px 16px 14px', textAlign: 'center', background: '#fff',
                transform: `scale(${1 + 0.06 * Math.min(1.2, bc) * (1 - ep(t, T.sheetIn - 0.3, T.sheetIn))})`,
                boxShadow: `0 0 ${36 * glow}px rgba(34,197,94,${0.45 * glow}), 0 2px 10px rgba(0,0,0,.05)`,
              }}
            >
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 700, color: BRAND.greenDeep, background: BRAND.greenLight, padding: '3px 10px', borderRadius: 999, marginBottom: 12 }}>
                <Sun size={13} strokeWidth={2.5} /> מוכן לסריקה בקופה
              </div>
              <div style={{ display: 'flex', justifyContent: 'center' }}>
                <Barcode seed={42} width={300} height={92} />
              </div>
              <div style={{ marginTop: 10, fontSize: 19, fontWeight: 700, letterSpacing: '0.12em', color: BRAND.text, ...ltr }}>{focus.code}</div>
            </div>
          </div>

          <div style={{ ...rowIn(0.16), marginTop: 18, borderRadius: 16, background: BRAND.appBg, padding: '4px 16px' }}>
            {[['תוקף', focus.expiryFull], ['קוד PIN', '••••']].map(([k, val], i) => (
              <div key={k} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', height: 46, borderTop: i ? `1px solid ${BRAND.border}` : undefined }}>
                <span style={{ fontSize: 14, color: BRAND.text2 }}>{k}</span>
                <span style={{ fontSize: 15, fontWeight: 700, color: BRAND.text, ...ltr }}>{val}</span>
              </div>
            ))}
          </div>

          <div style={{ ...rowIn(0.24), marginTop: 18 }}>
            <div style={{ height: 52, borderRadius: 14, background: BRAND.green, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 16, boxShadow: '0 4px 20px rgba(22,163,74,.35)' }}>
              עדכון יתרה
            </div>
            <div style={{ textAlign: 'center', marginTop: 12, fontSize: 14, fontWeight: 600, color: BRAND.text2 }}>סימון כמנוצל</div>
          </div>
        </div>
      )}
    </div>
  )
}

/** "Update balance" bottom sheet (scene 5). */
function SpendSheet({ t }: { t: number }) {
  const inP = spring(t, T.sheetIn, SPR.sheet)
  const outP = ep(t, T.sheetOut, T.sheetOut + 0.35, ease.drawer)
  const open = inP * (1 - outP)
  if (t < T.sheetIn || outP >= 1) return null
  const H = 350
  const typed = t < T.amountAt ? '' : t < T.amountAt + 0.15 ? String(SPEND)[0] : String(SPEND)
  const tapP = prog(t, T.tap, T.tap + 0.32)
  const press = t >= T.tap + 0.06 && t < T.tap + 0.22 ? 0.96 : 1
  return (
    <>
      <div style={{ position: 'absolute', inset: 0, background: `rgba(15,28,26,${0.28 * open})`, zIndex: 40 }} />
      <div
        style={{
          position: 'absolute', left: 0, right: 0, bottom: 0, height: H, zIndex: 41,
          transform: `translateY(${(1 - open) * (H + 20)}px)`,
          background: BRAND.surface, borderRadius: '28px 28px 0 0', padding: '10px 20px 0',
          boxShadow: '0 -10px 40px rgba(0,0,0,.12)',
        }}
      >
        <div style={{ width: 40, height: 5, borderRadius: 3, background: '#d7dedc', margin: '0 auto 16px' }} />
        <div style={{ fontSize: 19, fontWeight: 800, color: BRAND.text }}>עדכון יתרה</div>
        <div style={{ fontSize: 13.5, color: BRAND.text3, marginTop: 2 }}>{focus.store} · יתרה <span style={ltr}>{fmt(focus.balance)}</span></div>
        <div style={{ marginTop: 16, fontSize: 13, fontWeight: 600, color: BRAND.text2 }}>כמה השתמשת?</div>
        <div style={{ marginTop: 6, height: 74, borderRadius: 16, border: `2px solid ${BRAND.green}`, boxShadow: '0 0 0 4px rgba(34,197,94,.14)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, ...ltr }}>
          <span style={{ fontSize: 40, fontWeight: 900, color: typed ? BRAND.text : '#b9c4c2' }}>₪{typed || '0'}</span>
          {Math.floor(t * 2.4) % 2 === 0 && t < T.tap && <span style={{ width: 3, height: 38, background: BRAND.green, borderRadius: 2 }} />}
        </div>
        <div style={{ position: 'relative', marginTop: 18 }}>
          <div style={{ height: 54, borderRadius: 14, background: BRAND.green, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 16.5, transform: `scale(${press})`, boxShadow: '0 4px 20px rgba(22,163,74,.35)' }}>
            עדכון
          </div>
          {tapP > 0 && tapP < 1 && (
            <div style={{
              position: 'absolute', left: '50%', top: '50%', width: 52, height: 52, marginLeft: -26, marginTop: -26, borderRadius: 26,
              background: 'rgba(15,28,26,.22)', border: '2px solid rgba(255,255,255,.7)',
              transform: `scale(${lerp(1.4, 0.8, ease.out(clamp(tapP * 3)))})`,
              opacity: tapP < 0.6 ? 1 : 1 - (tapP - 0.6) / 0.4,
            }} />
          )}
        </div>
      </div>
    </>
  )
}

/** iOS-style push notification (scene 6). */
function Notification({ t }: { t: number }) {
  if (t < T.notifIn || t > T.notifOut + 0.5) return null
  const inP = spring(t, T.notifIn, { stiffness: 260, damping: 19 })
  const outP = ep(t, T.notifOut, T.notifOut + 0.4, ease.in)
  const y = lerp(-130, 52, inP) - outP * 190
  const exp = focusFor(EXPIRY_ID)
  return (
    <div
      style={{
        position: 'absolute', left: 10, right: 10, top: y, zIndex: 60, borderRadius: 24, padding: '13px 14px',
        background: 'rgba(250,251,251,.82)', backdropFilter: 'blur(22px) saturate(1.8)', WebkitBackdropFilter: 'blur(22px) saturate(1.8)',
        border: '1px solid rgba(255,255,255,.7)', boxShadow: '0 16px 40px -8px rgba(15,28,26,.28)',
        display: 'flex', gap: 12, alignItems: 'center',
      }}
    >
      <div style={{ width: 42, height: 42, borderRadius: 11, background: `linear-gradient(135deg, ${BRAND.green}, ${BRAND.greenDark})`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        <Mark size={30} white />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5 }}>
          <span style={{ fontWeight: 700, color: BRAND.text2, direction: 'ltr' }}>GiftSmart</span>
          <span style={{ color: BRAND.text3 }}>עכשיו</span>
        </div>
        <div style={{ fontSize: 15, fontWeight: 800, color: BRAND.text, marginTop: 1 }}>השובר שלך עומד לפוג</div>
        <div style={{ fontSize: 13.5, color: BRAND.text2, marginTop: 1 }}>
          {exp.store} · <span style={ltr}>{fmt(exp.balance)}</span> · נותרו {EXPIRY_DAYS_LEFT} ימים
        </div>
      </div>
      <ChevronLeft size={18} color={BRAND.text3} />
    </div>
  )
}

const focusFor = (id: string) => VOUCHERS.find(v => v.id === id)!

// ── Screen composition ──────────────────────────────────────────────────────

function Screen({ t }: { t: number }) {
  const scroll =
    lerp(0, 112, ep(t, T.scrollDown[0], T.scrollDown[1], ease.inOut)) *
    (1 - ep(t, T.scrollUp[0], T.scrollUp[1], ease.inOut))
  const filterOut = ep(t, T.filter, T.filter + 0.35, ease.inOut) * (1 - ep(t, T.restore, T.restore + 0.45))
  const moveUp = ep(t, T.moveUp[0], T.moveUp[1], ease.inOut) * (1 - ep(t, T.collapse[0], T.collapse[1], ease.inOut))
  const open = ep(t, T.expand[0], T.expand[1], ease.drawer) * (1 - ep(t, T.collapse[0], T.collapse[1], ease.inOut))
  const hlOut = 1 - ep(t, T.hlOut, T.hlOut + 0.3)
  const hl: [number, number, number] = [
    spring(t, T.hl[0], SPR.ui) * hlOut,
    spring(t, T.hl[1], SPR.ui) * hlOut,
    spring(t, T.hl[2], SPR.ui) * hlOut,
  ]

  const enter = (d: number): CSSProperties => {
    const s = spring(t, T.uiIn + d, SPR.ui)
    return { opacity: clamp(s * 1.3), transform: `translateY(${lerp(36, 0, s)}px) scale(${lerp(0.96, 1, clamp(s))})` }
  }

  return (
    <div style={{ position: 'absolute', inset: 0, background: BRAND.appBg, overflow: 'hidden' }}>
      <StatusBar />
      <Header t={t} />

      {/* scrolling content, clipped under the header */}
      <div style={{ position: 'absolute', top: 100, left: 0, right: 0, bottom: 0, overflow: 'hidden' }}>
        <div style={{ position: 'absolute', top: -100, left: 0, right: 0, height: APP_H, transform: `translateY(${-scroll}px)` }}>
          <div style={{ position: 'absolute', top: 112, left: 16, right: 16, ...enter(0) }}>
            <SearchBar t={t} />
          </div>
          <div style={{ position: 'absolute', top: 170, left: 16, right: 16, ...enter(0.08), ...(filterOut > 0 ? { opacity: 1 - filterOut, transform: `translateY(${-10 * filterOut}px) scale(${1 - 0.04 * filterOut})` } : {}) }}>
            <TotalCard t={t} />
          </div>
          <div style={{ position: 'absolute', top: 296, left: 20, right: 20, display: 'flex', justifyContent: 'space-between', alignItems: 'center', ...enter(0.14), ...(filterOut > 0 ? { opacity: 1 - filterOut } : {}) }}>
            <span style={{ fontSize: 17, fontWeight: 800, color: BRAND.text }}>השוברים שלי</span>
            <span style={{ fontSize: 14, fontWeight: 700, color: BRAND.greenDeep }}>הכול</span>
          </div>

          {VOUCHERS.map((v, i) => {
            const isFocus = v.id === FOCUS_ID
            const baseY = LIST_TOP + i * (CARD_H + CARD_GAP)
            const e = enter(0.2 + i * 0.08)
            if (isFocus) {
              const y = lerp(baseY, FOCUS_Y, moveUp)
              return (
                <div key={v.id} style={{ position: 'absolute', top: y, left: 16, right: 16, ...e, opacity: open > 0.001 ? 0 : e.opacity, zIndex: 5 }}>
                  <VoucherRow v={v} t={t} hl={hl} />
                </div>
              )
            }
            const d = i * 0.035
            const f = ep(t, T.filter + d, T.filter + d + 0.32, ease.inOut) * (1 - ep(t, T.restore + d, T.restore + d + 0.45))
            return (
              <div key={v.id} style={{ position: 'absolute', top: baseY, left: 16, right: 16, ...e, ...(f > 0 ? { opacity: 1 - f, transform: `translateY(${18 * f}px) scale(${1 - 0.05 * f})` } : {}) }}>
                <VoucherRow v={v} t={t} />
              </div>
            )
          })}
        </div>
      </div>

      {open > 0.001 && (
        <div style={{ position: 'absolute', inset: 0, zIndex: 25 }}>
          <Detail t={t} open={open} />
        </div>
      )}

      <BottomNav t={t} />
      <SpendSheet t={t} />
      <Notification t={t} />
      {/* home indicator */}
      <div style={{ position: 'absolute', bottom: 7, left: '50%', width: 134, height: 5, marginLeft: -67, borderRadius: 3, background: 'rgba(15,28,26,.85)', zIndex: 70 }} />
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
      {/* soft floor shadow */}
      <div style={{ position: 'absolute', left: 30, right: 30, bottom: -30, height: 60, borderRadius: '50%', background: 'rgba(15,28,26,.22)', filter: 'blur(30px)' }} />
      {/* frame */}
      <div
        style={{
          position: 'absolute', inset: 0, borderRadius: PHONE.radius,
          background: 'linear-gradient(145deg, #2b3432 0%, #0e1413 45%, #1f2725 100%)',
          boxShadow: 'inset 0 0 0 2px rgba(255,255,255,.08), 0 50px 100px -30px rgba(15,28,26,.45), 0 30px 60px -30px rgba(15,28,26,.35)',
        }}
      />
      {/* side buttons */}
      <div style={{ position: 'absolute', right: -4, top: 250, width: 5, height: 110, borderRadius: 3, background: '#1b2321' }} />
      <div style={{ position: 'absolute', left: -4, top: 210, width: 5, height: 70, borderRadius: 3, background: '#1b2321' }} />
      <div style={{ position: 'absolute', left: -4, top: 300, width: 5, height: 70, borderRadius: 3, background: '#1b2321' }} />
      {/* screen */}
      <div
        style={{
          position: 'absolute', left: PHONE.bezel, top: PHONE.bezel, right: PHONE.bezel, bottom: PHONE.bezel,
          borderRadius: PHONE.screenRadius, overflow: 'hidden', background: BRAND.appBg,
        }}
      >
        <div dir="rtl" style={{ position: 'absolute', left: 0, top: 0, width: APP_W, height: APP_H, transform: `scale(${APP_K})`, transformOrigin: '0 0' }}>
          <Screen t={t} />
        </div>
        {/* dynamic island */}
        <div style={{ position: 'absolute', top: 13, left: '50%', width: 124, height: 36, marginLeft: -62, borderRadius: 18, background: '#000', zIndex: 80 }} />
        {/* glass reflection */}
        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(115deg, rgba(255,255,255,.10) 0%, rgba(255,255,255,0) 30%)', pointerEvents: 'none', zIndex: 90 }} />
      </div>
    </div>
  )
}
