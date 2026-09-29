/**
 * The GiftSmart mark — same geometry as src/components/GiftSmartLogo.tsx
 * (GiftSmartIcon), re-drawn here with a `draw` parameter (0..1) so the strokes
 * can be drawn on frame-by-frame from the master timeline.
 */
export default function Mark({ size, draw = 1, white = false }: { size: number; draw?: number; white?: boolean }) {
  const green = white ? '#fff' : '#22c55e'
  const purple = white ? 'rgba(255,255,255,.75)' : '#9333ea'
  const d = (from: number, to: number) => {
    const p = Math.min(1, Math.max(0, (draw - from) / (to - from)))
    return { pathLength: 1, strokeDasharray: 1, strokeDashoffset: 1 - p }
  }
  const dot = (at: number) => Math.min(1, Math.max(0, (draw - at) / 0.12))
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" fill="none" aria-hidden style={{ overflow: 'visible' }}>
      <rect x="16" y="16" width="68" height="68" rx="12" transform="rotate(45 50 50)" stroke={green} strokeWidth="6" {...d(0, 0.55)} />
      <circle cx="33" cy="33" r={4.5 * dot(0.45)} fill={green} />
      <circle cx="43" cy="33" r={4.5 * dot(0.52)} fill={green} />
      <path d="M30 52 L43 65 L70 38" stroke={green} strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" {...d(0.35, 0.75)} />
      <line x1="70" y1="26" x2="86" y2="12" stroke={purple} strokeWidth="6" strokeLinecap="round" {...d(0.6, 0.8)} />
      <path d="M78 10 L87 10 L87 19" stroke={purple} strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" {...d(0.72, 0.88)} />
      <path d="M62 66 C70 57 80 68 75 77 C71 83 63 81 61 88" stroke={purple} strokeWidth="4.5" strokeLinecap="round" {...d(0.75, 1)} />
    </svg>
  )
}
