const STORAGE_KEY = 'gs_nav_glass_opacity'
// Matches the Liquid Glass spec's reference alpha for the nav bar's light-mode background.
export const DEFAULT_NAV_GLASS_OPACITY = 0.16

export function getNavGlassOpacity(): number {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw == null) return DEFAULT_NAV_GLASS_OPACITY
    const val = parseFloat(raw)
    return Number.isFinite(val) ? Math.min(1, Math.max(0.15, val)) : DEFAULT_NAV_GLASS_OPACITY
  } catch {
    return DEFAULT_NAV_GLASS_OPACITY
  }
}

/** Persists the value and applies it immediately via the --nav-glass-opacity CSS var on :root. */
export function setNavGlassOpacity(value: number) {
  const clamped = Math.min(1, Math.max(0.15, value))
  localStorage.setItem(STORAGE_KEY, String(clamped))
  applyNavGlassOpacity(clamped)
}

export function applyNavGlassOpacity(value: number = getNavGlassOpacity()) {
  document.documentElement.style.setProperty('--nav-glass-opacity', String(value))
}
