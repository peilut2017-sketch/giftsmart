import { Capacitor } from '@capacitor/core'

/**
 * Tactile feedback, in the same three-level vocabulary the UI already uses:
 *  - `light`     toggles, tab switches, small selections
 *  - `success`   a save or confirmation that completed
 *  - `heavy`     a destructive or irreversible action (delete, archive)
 *  - `warning`   a blocked action or a validation error
 *
 * Where it works: inside the Capacitor iOS shell (@capacitor/haptics → the real Taptic
 * Engine) and on Android Chrome / the TWA (Vibration API). iOS Safari and desktop browsers
 * expose neither, so every call silently no-ops there — callers never need to check.
 */
export type HapticKind = 'light' | 'success' | 'warning' | 'heavy'

/** Vibration API patterns (ms) — Android only. Kept short: long buzzes feel cheap. */
export const VIBRATE_PATTERNS: Record<HapticKind, number[]> = {
  light: [8],
  success: [10, 40, 14],
  warning: [18, 50, 18],
  heavy: [28],
}

type HapticsPlugin = typeof import('@capacitor/haptics')

// The native plugin is only fetched inside the iOS shell, so the web bundle never pays
// for it. A failed import (plugin missing from an older native build) falls back to the
// Vibration API instead of throwing into a click handler.
let nativePlugin: Promise<HapticsPlugin | null> | null = null
function loadNative(): Promise<HapticsPlugin | null> {
  if (!nativePlugin) {
    nativePlugin = Capacitor.isNativePlatform()
      ? import('@capacitor/haptics').catch(() => null)
      : Promise.resolve(null)
  }
  return nativePlugin
}

function vibrate(kind: HapticKind) {
  try { navigator.vibrate?.(VIBRATE_PATTERNS[kind]) } catch { /* unsupported */ }
}

export function haptic(kind: HapticKind = 'light'): void {
  if (!Capacitor.isNativePlatform()) { vibrate(kind); return }
  loadNative().then(mod => {
    if (!mod) { vibrate(kind); return }
    const { Haptics, ImpactStyle, NotificationType } = mod
    const run =
      kind === 'success' ? Haptics.notification({ type: NotificationType.Success })
      : kind === 'warning' ? Haptics.notification({ type: NotificationType.Warning })
      : kind === 'heavy' ? Haptics.impact({ style: ImpactStyle.Heavy })
      : Haptics.impact({ style: ImpactStyle.Light })
    run.catch(() => vibrate(kind))
  })
}
