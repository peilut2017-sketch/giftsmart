import { ArrowLeft, Globe } from 'lucide-react'
import { BRAND, HERO } from './config'
import { HERO_AT, phoneState } from './layout'
import Mark from './Mark'
import { SPR, ease, ep, lerp, spring } from './timeline'
import { GiftCardFace } from './ui'

/** Scene 7 — hero shot: floating cards behind the phone, logo, tagline, CTA, URL. */

const CARDS = [
  { brand: 'ZARA',  from: '#111827', to: '#374151', value: '₪160', dx: -300, dy: -250, rot: -14, depth: 0.9 },
  { brand: 'BUYME', from: '#fb923c', to: '#ea580c', value: '₪320', dx: 300,  dy: -170, rot: 12,  depth: 1 },
  { brand: 'FOX',   from: '#6366f1', to: '#4338ca', value: '₪175', dx: -305, dy: 250,  rot: 9,   depth: 1 },
  { brand: 'Gift Smart', from: '#22c55e', to: '#15803d', value: '₪855', dx: 300, dy: 300, rot: -10, depth: 0.9 },
]

export function HeroBack({ t }: { t: number }) {
  if (t < HERO_AT) return null
  const p = phoneState(t)
  return (
    <>
      {CARDS.map((c, i) => {
        const s = spring(t, HERO_AT + 0.35 + i * 0.1, SPR.soft)
        const bob = Math.sin(t * 1.1 + i * 1.7) * 12
        const x = p.cx + c.dx * s
        const y = p.cy + c.dy * s + bob
        return (
          <div
            key={i}
            style={{
              position: 'absolute', left: x, top: y, zIndex: 10,
              transform: `translate(-50%,-50%) rotate(${c.rot * s + Math.sin(t * 0.8 + i) * 2}deg) scale(${lerp(0.5, 0.82 * c.depth, s)})`,
              opacity: Math.min(1, s * 1.5),
              filter: c.depth < 1 ? 'blur(0.6px)' : undefined,
            }}
          >
            <GiftCardFace brand={c.brand} from={c.from} to={c.to} value={c.value} width={340} />
          </div>
        )
      })}
    </>
  )
}

export function HeroFront({ t }: { t: number }) {
  if (t < HERO_AT + 0.3) return null
  const m = spring(t, HERO_AT + 0.45, SPR.pop)
  const draw = ep(t, HERO_AT + 0.45, HERO_AT + 1.35, ease.soft)
  const title = ep(t, HERO_AT + 0.7, HERO_AT + 1.35)
  const tag = ep(t, HERO_AT + 1.05, HERO_AT + 1.7)
  const cta = spring(t, HERO_AT + 1.6, SPR.ui)
  const url = ep(t, HERO_AT + 2.0, HERO_AT + 2.6)
  // Final "bounce" of the logo lockup — a small, damped scale impulse
  const bt = t - 28.9
  const bounce = bt > 0 ? 1 + 0.07 * Math.sin(bt * 14) * Math.exp(-bt * 5) : 1
  // Shine sweep across the CTA
  const shine = (t - (HERO_AT + 2.3)) % 2.2
  const shineX = shine >= 0 && shine < 0.9 ? lerp(-140, 560, ease.inOut(shine / 0.9)) : -200
  return (
    <>
      <div style={{ position: 'absolute', top: 200, left: 0, right: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', transform: `scale(${bounce})`, transformOrigin: '50% 40%', zIndex: 30 }}>
        <div style={{ transform: `scale(${m})`, filter: 'drop-shadow(0 12px 24px rgba(34,197,94,.3))' }}>
          <Mark size={128} draw={draw} />
        </div>
        <div style={{ marginTop: 6, fontSize: 118, fontWeight: 900, letterSpacing: '-0.045em', lineHeight: 1.05, color: BRAND.text, direction: 'ltr', opacity: title, transform: `translateY(${lerp(30, 0, title)}px)`, filter: title < 1 ? `blur(${lerp(10, 0, title)}px)` : undefined }}>
          {HERO.title.slice(0, 4)}<span style={{ color: BRAND.green }}>{HERO.title.slice(4)}</span>
        </div>
        <div style={{ marginTop: 10, fontSize: 44, fontWeight: 600, color: BRAND.text2, opacity: tag, transform: `translateY(${lerp(20, 0, tag)}px)` }}>
          {HERO.tagline}
        </div>
      </div>

      <div style={{ position: 'absolute', top: 1418, left: 0, right: 0, display: 'flex', justifyContent: 'center', zIndex: 30 }}>
        <div
          style={{
            position: 'relative', overflow: 'hidden', display: 'flex', alignItems: 'center', gap: 18,
            padding: '30px 62px', borderRadius: 999, color: '#fff', fontSize: 46, fontWeight: 800,
            background: `linear-gradient(135deg, ${BRAND.green} 0%, ${BRAND.greenDark} 100%)`,
            boxShadow: '0 20px 50px -12px rgba(22,163,74,.6), inset 0 1px 0 rgba(255,255,255,.3)',
            opacity: Math.min(1, cta * 1.3), transform: `translateY(${lerp(60, 0, cta)}px) scale(${lerp(0.9, 1, cta)})`,
          }}
        >
          {HERO.cta}
          <ArrowLeft size={44} strokeWidth={2.6} />
          <div style={{ position: 'absolute', top: -20, bottom: -20, left: shineX, width: 110, background: 'linear-gradient(90deg, transparent, rgba(255,255,255,.45), transparent)', transform: 'skewX(-20deg)' }} />
        </div>
      </div>

      <div style={{ position: 'absolute', top: 1575, left: 0, right: 0, display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 12, fontSize: 40, fontWeight: 700, color: BRAND.text2, opacity: url, transform: `translateY(${lerp(16, 0, url)}px)`, direction: 'ltr', zIndex: 30 }}>
        <Globe size={36} strokeWidth={2.2} color={BRAND.greenDeep} />
        {HERO.url}
      </div>
    </>
  )
}

/** Hides the scene-2 caption zone / soft brand wash behind the hero. */
export function HeroWash({ t }: { t: number }) {
  const w = ep(t, HERO_AT, HERO_AT + 1.2)
  if (w <= 0) return null
  return (
    <div style={{ position: 'absolute', inset: 0, opacity: w, background: `radial-gradient(60% 40% at 50% 55%, ${BRAND.green}22 0%, transparent 70%)`, zIndex: 1 }} />
  )
}
