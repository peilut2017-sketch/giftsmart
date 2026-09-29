/**
 * Real GiftSmart screenshots (fake demo data), captured from the actual app by
 * scripts/promo-screens/capture.mjs. Re-run that script to refresh them after a
 * UI change — the promo picks up the new images and highlight boxes automatically.
 */
import manifest from './screens/manifest'

const files = import.meta.glob('./screens/*.webp', { eager: true, query: '?url', import: 'default' }) as Record<string, string>

export type ScreenName = keyof typeof manifest.screens
export type BoxName = keyof typeof manifest.boxes
export interface Box { x: number; y: number; w: number; h: number }

export const SCREEN_URL = Object.fromEntries(
  Object.keys(manifest.screens).map(k => [k, files[`./screens/${k}.webp`]]),
) as Record<ScreenName, string>

export const SCREEN_TOP = manifest.top as Record<ScreenName, string>
export const BOXES = manifest.boxes as Record<BoxName, Box>
/** Captured viewport in points (the app area below the phone's status bar). */
export const VIEW = manifest.viewport

export const center = (b: Box) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 })

/** Resolves once every screenshot is decoded (the exporter waits on this). */
export function preloadScreens(): Promise<void> {
  return Promise.all(
    Object.values(SCREEN_URL).map(src => {
      const img = new Image()
      img.src = src
      return img.decode().catch(() => undefined)
    }),
  ).then(() => undefined)
}
