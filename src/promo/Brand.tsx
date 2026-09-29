import { BRAND } from './config'
import { CENTER, FLY_AT, FLY_END, HEADER_SLOT, MARK_AT, appToStage } from './layout'
import Mark from './Mark'
import { ease, ep, lerp, prog, spring } from './timeline'

/** Scene 2: the pile collapses into the mark, a shockwave, then the mark flies into the app header. */

export default function Brand({ t }: { t: number }) {
  if (t < MARK_AT - 0.2 || t > FLY_END + 0.05) return null
  const pop = spring(t, MARK_AT, { stiffness: 240, damping: 14 })
  const draw = ep(t, MARK_AT, MARK_AT + 0.95, ease.soft)
  const fly = ep(t, FLY_AT, FLY_END, ease.inOut)
  const slot = appToStage(HEADER_SLOT.x, HEADER_SLOT.y, t)
  const baseSize = 240
  const size = lerp(baseSize, HEADER_SLOT.size * slot.k, fly)
  const float = Math.sin((t - MARK_AT) * 2.2) * 8 * (1 - fly)
  const x = lerp(CENTER.x, slot.x, fly)
  // Arc the flight slightly upward so it reads as a deliberate move, not a slide.
  const y = lerp(CENTER.y, slot.y, fly) - Math.sin(fly * Math.PI) * 90 + float

  const ring = (at: number, maxR: number, alpha: number) => {
    const p = prog(t, at, at + 0.9)
    if (p <= 0 || p >= 1) return null
    const r = lerp(40, maxR, ease.out(p))
    return (
      <div
        style={{
          position: 'absolute', left: CENTER.x - r, top: CENTER.y - r, width: r * 2, height: r * 2,
          borderRadius: '50%', border: `${lerp(10, 1, p)}px solid ${BRAND.green}`, opacity: alpha * (1 - p),
        }}
      />
    )
  }
  // Soft light burst behind the mark
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
          position: 'absolute', left: x, top: y, zIndex: 40,
          transform: `translate(-50%,-50%) scale(${pop}) rotate(${lerp(-24, 0, Math.min(1, pop))}deg)`,
          width: size, height: size,
          filter: `drop-shadow(0 ${lerp(24, 2, fly)}px ${lerp(40, 4, fly)}px rgba(34,197,94,${lerp(0.35, 0, fly)}))`,
        }}
      >
        <Mark size={size} draw={draw} />
      </div>
    </>
  )
}
