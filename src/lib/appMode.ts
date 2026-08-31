/**
 * "App mode" = running as the installed Android app (TWA), the native iOS shell
 * (Capacitor), or an installed/standalone PWA — the contexts where guest
 * (anonymous) usage is allowed. The regular website keeps its normal login wall.
 *
 * Detection is by presentation only (native shell / display-mode / TWA referrer).
 * Never by IP, device fingerprinting or hardware identifiers — identity itself
 * always comes from the Supabase Auth session.
 *
 * IMPORTANT: the TWA-referrer latch lives in **sessionStorage**, not
 * localStorage. On Android the TWA and Chrome share the same localStorage
 * origin, so a localStorage latch leaked "app mode" into every regular browser
 * tab forever — which made the website try (and fail) a guest session instead
 * of showing the landing page. sessionStorage is per browsing context, so the
 * TWA keeps its latch across in-app navigations without contaminating browser
 * tabs. Every other signal below is evaluated live on each call.
 */
const APP_MODE_KEY = 'gs_app_mode'
const EXPLICIT_SIGNOUT_KEY = 'gs_explicit_signout'

/** An explicit sign-out means "show me the login screen" — app mode must not
    immediately re-create a guest session over it. */
export function markExplicitSignOut() {
  try { sessionStorage.setItem(EXPLICIT_SIGNOUT_KEY, '1') } catch { /* storage unavailable */ }
}
export function hasExplicitSignOut(): boolean {
  try { return sessionStorage.getItem(EXPLICIT_SIGNOUT_KEY) === '1' } catch { return false }
}
export function clearExplicitSignOut() {
  try { sessionStorage.removeItem(EXPLICIT_SIGNOUT_KEY) } catch { /* storage unavailable */ }
}

export function isAppMode(): boolean {
  try {
    // One-time cleanup of the old leaky localStorage latch (see note above), so
    // existing browser users who were wrongly flagged as app-mode recover.
    try { localStorage.removeItem(APP_MODE_KEY) } catch { /* ignore */ }

    // Native shell (Capacitor iOS/Android) — definitive.
    const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean; isNative?: boolean } }).Capacitor
    if (cap?.isNativePlatform?.() || cap?.isNative) return true

    // Installed / standalone PWA — a live, per-context signal (a normal browser
    // tab reports display-mode: browser and standalone: false).
    const standalone =
      window.matchMedia?.('(display-mode: standalone)').matches ||
      window.matchMedia?.('(display-mode: fullscreen)').matches ||
      window.matchMedia?.('(display-mode: minimal-ui)').matches ||
      (window.navigator as unknown as { standalone?: boolean }).standalone === true
    if (standalone) return true

    // TWA: the android-app:// referrer is only present on the entry navigation,
    // so latch it in sessionStorage (per browsing context — does NOT leak to a
    // separate Chrome browser tab the way a localStorage latch did).
    if (document.referrer.startsWith('android-app://')) {
      sessionStorage.setItem(APP_MODE_KEY, '1')
      return true
    }
    if (sessionStorage.getItem(APP_MODE_KEY) === '1') return true
  } catch { /* storage unavailable — fall through to false */ }
  return false
}
