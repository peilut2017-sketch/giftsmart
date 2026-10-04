import { BRAND, SPEND } from './config'
import { CENTER, FLY_AT, FLY_END, MARK_AT, SPLASH_ICON, STATUS_H, appToStage } from './layout'
import { LogoMark } from './Logo'
import { BOXES, center } from './screens'
import { SPR, ease, ep, lerp, prog, spring } from './timeline'

/** Scene 2: the pile collapses into the real logo, a shockwave, then it lands on the app's splash screen. */
export default function Brand({ t }: { t: number }) {
  if (t < MARK_AT - 0.2 || t > FLY_END + 0.05) return null
  const pop = spring(t, MARK_AT, { stiffness: 240, damping: 14 })
  const reveal = ep(t, MARK_AT - 0.05, MARK_AT + 0.55, ease.out)
  const fly = ep(t, FLY_AT, FLY_END, ease.inOut)
  const slot = appToStage(SPLASH_ICON.x, SPLASH_ICON.y, t)
  const baseSize = 280
  const size = lerp(baseSize, SPLASH_ICON.size * slot.k, fly)
  const float = Math.sin((t - MARK_AT) * 2.2) * 8 * (1 - fly)
  const x = lerp(CENTER.x, slot.x, fly)
  const y = lerp(CENTER.y, slot.y, fly) - Math.sin(fly * Math.PI) * 60 + float

  const ring = (at: number, maxR: number, alpha: number) => {
    const p = prog(t, at, at + 0.9)
    if (p <= 0 || p >= 1) return null
    const r = lerp(40, maxR, ease.out(p))
    return (
      <div style={{ position: 'absolute', left: CENTER.x - r, top: CENTER.y - r, width: r * 2, height: r * 2, borderRadius: '50%', border: `${lerp(10, 1, p)}px solid ${BRAND.green}`, opacity: alpha * (1 - p) }} />
    )
  }
  const glow = ep(t, MARK_AT - 0.1, MARK_AT + 0.3) * (1 - ep(t, FLY_AT - 0.2, FLY_AT + 0.4))

  return (
    <>
      <div
        style={{
          position: 'absolute', left: CENTER.x - 420, top: CENTER.y - 420, width: 840, height: 840, borderRadius: '50%',
          background: `radial-gradient(circle, ${BRAND.green}40 0%, ${BRAND.green}12 38%, transparent 68%)`,
          opacity: glow, transform: `scale(${lerp(0.6, 1, glow)})`,
        }}
      />
      {ring(MARK_AT, 560, 0.55)}
      {ring(MARK_AT + 0.14, 420, 0.3)}
      <div
        style={{
          position: 'absolute', left: x - size / 2, top: y - size / 2, width: size, height: size, zIndex: 40,
          transform: `scale(${pop}) rotate(${lerp(-18, 0, Math.min(1, pop))}deg)`,
          filter: `drop-shadow(0 ${lerp(24, 2, fly)}px ${lerp(40, 4, fly)}px rgba(34,197,94,${lerp(0.35, 0, fly)}))`,
        }}
      >
        <LogoMark size={size} reveal={reveal} />
      </div>
    </>
  )
}

/** Scene 5 callout beside the phone: the balance counting down after a partial use. */
export function BalanceCallout({ t }: { t: number }) {
  const IN = 18.6, OUT = 20.7
  if (t < IN || t > OUT + 0.5) return null
  const s = spring(t, IN, SPR.pop)
  const o = ep(t, OUT, OUT + 0.4, ease.inOut)
  const from = 240, to = from - SPEND
  const v = lerp(from, to, ep(t, IN + 0.35, IN + 1.25, ease.out))
  const b = BOXES.after_balance
  const anchor = appToStage(b.x, center(b).y + STATUS_H, t)
  const chip = spring(t, IN + 0.2, SPR.pop)
  return (
    <div
      style={{
        position: 'absolute', left: anchor.x - 250, top: anchor.y + 120, zIndex: 45,
        transform: `translate(${(1 - s) * -30}px, ${o * -20}px) scale(${lerp(0.85, 1, Math.min(1.05, s))})`, opacity: Math.min(1, s * 1.4) * (1 - o),
        background: 'rgba(255,255,255,.9)', backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)',
        borderRadius: 32, padding: '22px 30px', boxShadow: '0 24px 60px -16px rgba(15,28,26,.35), 0 0 0 1px rgba(15,28,26,.06)',
        direction: 'ltr', textAlign: 'center', minWidth: 260,
      }}
    >
      <div style={{ display: 'inline-block', fontSize: 30, fontWeight: 800, color: BRAND.urgent, background: BRAND.urgentBg, borderRadius: 999, padding: '4px 16px', transform: `scale(${chip})` }}>
        −₪{SPEND}
      </div>
      <div style={{ fontSize: 84, fontWeight: 900, letterSpacing: '-0.04em', lineHeight: 1.05, color: BRAND.text, marginTop: 8, fontFeatureSettings: '"tnum"' }}>
        ₪{Math.round(v)}
      </div>
      <div style={{ fontSize: 26, fontWeight: 600, color: BRAND.greenDeep, direction: 'rtl' }}>יתרה נשמרה</div>
    </div>
  )
}
