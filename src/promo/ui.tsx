import type { CSSProperties, ReactNode } from 'react'
import { rand } from './timeline'

/** Deterministic fake barcode (Code-128-looking bars from a seed). Never a real code. */
export function Barcode({ seed, width, height, color = '#0f1c1a' }: { seed: number; width: number; height: number; color?: string }) {
  const bars: { x: number; w: number }[] = []
  let x = 0
  let i = 0
  // quiet zone is left to the container; build ~100 modules
  while (x < 100) {
    const w = 1 + Math.floor(rand(seed * 97 + i) * 3.2)
    const gap = 1 + Math.floor(rand(seed * 131 + i * 7) * 2.4)
    if (x + w > 100) break
    bars.push({ x, w })
    x += w + gap
    i++
  }
  return (
    <svg width={width} height={height} viewBox="0 0 100 40" preserveAspectRatio="none" aria-hidden>
      {bars.map((b, k) => <rect key={k} x={b.x} y={0} width={b.w} height={40} fill={color} />)}
    </svg>
  )
}

/** A physical-looking gift card face (used in the chaos scene and the hero). */
export function GiftCardFace({
  brand, from, to, value, width, style, dark = true,
}: { brand: string; from: string; to: string; value?: string; width: number; style?: CSSProperties; dark?: boolean }) {
  const h = width * 0.63
  const fg = dark ? '#fff' : '#0f1c1a'
  return (
    <div
      style={{
        width, height: h, borderRadius: width * 0.07,
        background: `linear-gradient(135deg, ${from} 0%, ${to} 100%)`,
        boxShadow: '0 2px 6px rgba(15,28,26,.08), 0 24px 48px -12px rgba(15,28,26,.28)',
        position: 'relative', overflow: 'hidden', color: fg, direction: 'ltr', ...style,
      }}
    >
      {/* sheen */}
      <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(120deg, rgba(255,255,255,.28) 0%, rgba(255,255,255,0) 42%)' }} />
      <div style={{ position: 'absolute', top: width * 0.07, left: width * 0.08, fontWeight: 900, fontSize: width * 0.1, letterSpacing: '-0.02em', unicodeBidi: 'plaintext' }}>
        {brand}
      </div>
      <div style={{ position: 'absolute', top: width * 0.085, right: width * 0.08, fontSize: width * 0.045, fontWeight: 700, opacity: 0.75, letterSpacing: '0.08em' }}>
        GIFT CARD
      </div>
      {/* chip */}
      <div style={{ position: 'absolute', top: h * 0.42, left: width * 0.08, width: width * 0.13, height: width * 0.1, borderRadius: width * 0.02, background: 'linear-gradient(135deg,#fde68a,#d4a73a)', opacity: 0.9 }} />
      {value && (
        <div style={{ position: 'absolute', bottom: width * 0.06, right: width * 0.08, fontWeight: 800, fontSize: width * 0.09 }}>
          {value}
        </div>
      )}
    </div>
  )
}

/** Tiny helper so stage-space absolute positioning reads cleanly. */
export function At({ x, y, children, style }: { x: number; y: number; children: ReactNode; style?: CSSProperties }) {
  return (
    <div style={{ position: 'absolute', left: x, top: y, transform: 'translate(-50%, -50%)', ...style }}>
      {children}
    </div>
  )
}
