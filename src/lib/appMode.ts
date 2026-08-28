/**
 * "App mode" = running as the installed Android app (TWA) or an installed PWA —
 * the contexts where guest (anonymous) usage is allowed. The regular website
 * keeps its normal login wall.
 *
 * Detection is by presentation only (display-mode / TWA referrer). Never by
 * IP, device fingerprinting or hardware identifiers — identity itself always
 * comes from the Supabase Auth session.
 *
 * The result is latched in localStorage: the TWA referrer is only present on
 * the very first navigation, and a later in-app deep link shouldn't demote the
 * user back to website rules.
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
    if (localStorage.getItem(APP_MODE_KEY) === '1') return true
    const standalone =
      window.matchMedia?.('(display-mode: standalone)').matches ||
      (window.navigator as unknown as { standalone?: boolean }).standalone === true
    const fromTwa = document.referrer.startsWith('android-app://')
    if (standalone || fromTwa) {
      localStorage.setItem(APP_MODE_KEY, '1')
      return true
    }
  } catch { /* storage unavailable — fall through to false */ }
  return false
}
