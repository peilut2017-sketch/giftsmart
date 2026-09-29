import type { CSSProperties } from 'react'
import markUrl from './assets/logo-mark.png'
import wordmarkUrl from './assets/logo-wordmark.png'

/** Wordmark aspect ratio (from public/logo.png). */
export const WORDMARK_RATIO = 766 / 128

/**
 * The real GiftSmart mark (the official artwork, not a redraw).
 * `reveal` (0..1) opens it with a soft circular wipe, since a raster logo
 * can't be stroke-drawn.
 */
export function LogoMark({ size, reveal = 1, style }: { size: number; reveal?: number; style?: CSSProperties }) {
  const r = Math.max(0, Math.min(1, reveal))
  return (
    <img
      src={markUrl}
      alt=""
      draggable={false}
      style={{
        width: size, height: size, display: 'block',
        clipPath: r < 1 ? `circle(${r * 75}% at 50% 50%)` : undefined,
        ...style,
      }}
    />
  )
}

/** The real "GiftSmart" wordmark lettering from the official lockup. */
export function Wordmark({ width, style }: { width: number; style?: CSSProperties }) {
  return <img src={wordmarkUrl} alt="GiftSmart" draggable={false} style={{ width, height: width / WORDMARK_RATIO, display: 'block', ...style }} />
}

