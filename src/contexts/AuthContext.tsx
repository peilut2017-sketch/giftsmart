import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import type { User, Session } from '@supabase/supabase-js'
import toast from 'react-hot-toast'
import { supabase } from '../lib/supabase'
import type { Profile } from '../types'
import { identifyUser, resetPostHog, phCapture } from '../lib/posthog'
import { sendWelcomeEmail } from '../lib/emailService'
import { translate } from '../lib/i18n'
import { markExplicitSignOut } from '../lib/appMode'
import { parkGuestVaultKeyForMerge, storeResealIds } from '../lib/e2eeMerge'
import { wipeVaultSessionKeys } from '../lib/vaultBundle'

/** Single source of truth for "who is this" — UI must branch on this, not on
    scattered provider/metadata checks. */
export type AccountState = 'initializing' | 'signedOut' | 'anonymous' | 'registered'

interface AuthContextType {
  user: User | null
  session: Session | null
  profile: Profile | null
  isAdmin: boolean
  loading: boolean
  passwordRecovery: boolean
  /** Guest (Supabase anonymous) account — data lives server-side but has no recoverable identity yet */
  isAnonymous: boolean
  accountState: AccountState
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>
  signInWithBiometric: () => Promise<{ error: Error | null }>
  signUp: (email: string, password: string, name?: string) => Promise<{ error: Error | null }>
  signInWithGoogle: () => Promise<{ error: Error | null }>
  signOut: () => Promise<void>
  updateProfile: (data: Partial<Profile>) => Promise<void>
  resetPassword: (email: string) => Promise<{ error: Error | null }>
  updatePassword: (password: string) => Promise<{ error: Error | null }>
  /** Idempotent, race-safe: reuses an existing session or creates ONE anonymous user */
  ensureAnonymousSession: () => Promise<{ error: Error | null }>
  /** Anonymous → registered in place: same user id, same data, email+password linked */
  upgradeAnonymousAccount: (email: string, password: string, name?: string) => Promise<{ error: Error | null }>
  /** Call BEFORE logging an anonymous user into an EXISTING account — unseals
      guest E2EE fields (their vault dies with the merge) and parks a server-side
      merge ticket so the guest data survives the session switch.
      'locked' = the guest vault must be opened first. */
  beginMergeLogin: () => Promise<'ok' | 'locked' | 'failed'>
}

const MERGE_TICKET_KEY = 'gs_merge_ticket'

// Module-level so concurrent callers share one in-flight sign-in — the race
// that would otherwise mint several anonymous users on first launch.
let anonInFlight: Promise<{ error: Error | null }> | null = null

const AuthContext = createContext<AuthContextType | undefined>(undefined)

// ── Profile cache helpers ────────────────────────────────────────────────────
// Keeps profile in sessionStorage so isAdmin is known synchronously on the
// next page load without waiting for a Supabase round-trip.
const profileCacheKey = (uid: string) => `gs_profile_${uid}`

function readCachedProfile(uid: string): Profile | null {
  try {
    const raw = sessionStorage.getItem(profileCacheKey(uid))
    return raw ? (JSON.parse(raw) as Profile) : null
  } catch { return null }
}

function writeCachedProfile(p: Profile) {
  try { sessionStorage.setItem(profileCacheKey(p.id), JSON.stringify(p)) } catch {}
}

function evictProfileCache() {
  try {
    for (const k of Object.keys(sessionStorage)) {
      if (k.startsWith('gs_profile_')) sessionStorage.removeItem(k)
    }
  } catch {}
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)
  const [passwordRecovery, setPasswordRecovery] = useState(false)
  const welcomeCheckedRef = useRef(false)
  // Bumped on every auth transition; a slow fetchProfile only applies if its
  // generation is still current, so a fetch for user A can't repopulate the
  // profile (or its cache) after a sign-out / switch to user B already cleared it.
  const authGenRef = useRef(0)

  // Welcome email — sent exactly once per account. should_send_welcome_email()
  // atomically flips a profile flag server-side and returns true only for
  // recently-created accounts, so existing users never get it retroactively
  // and multiple devices can't double-send.
  useEffect(() => {
    if (!user?.email || welcomeCheckedRef.current) return
    welcomeCheckedRef.current = true
    supabase.rpc('should_send_welcome_email').then(({ data }) => {
      if (data === true) {
        sendWelcomeEmail({
          to_email: user.email!,
          to_name: (user.user_metadata?.name as string) || user.email!.split('@')[0],
        }).catch(() => {})
      }
    }, () => {})
  }, [user?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    // Safety timeout: if getSession() hangs (e.g. slow Supabase / token refresh),
    // we must still clear loading so the app doesn't spin forever.
    const safetyTimer = setTimeout(() => setLoading(false), 5000)

    supabase.auth.getSession()
      .then(({ data: { session } }) => {
        setSession(session)
        setUser(session?.user ?? null)
        if (session?.user) {
          // Hydrate from cache synchronously so isAdmin is immediately correct
          const cached = readCachedProfile(session.user.id)
          if (cached) setProfile(cached)
          fetchProfile(session.user.id)
        }
      })
      .catch(() => {
        // network error — treat as logged-out
      })
      .finally(() => {
        clearTimeout(safetyTimer)
        setLoading(false)
      })

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (_event === 'PASSWORD_RECOVERY') {
        setPasswordRecovery(true)
        return
      }
      // New auth generation — invalidates any in-flight fetchProfile from before
      authGenRef.current += 1
      setSession(session)
      setUser(session?.user ?? null)
      if (session?.user) {
        identifyUser(session.user.id, session.user.email)
        const cached = readCachedProfile(session.user.id)
        if (cached) setProfile(cached)
        await fetchProfile(session.user.id)
        // A registered sign-in with a parked merge ticket = a guest logged into
        // an existing account. Claim the ticket so the guest vouchers join it.
        if (!session.user.is_anonymous) await claimPendingMergeTicket(session.user.id)
      } else {
        resetPostHog()
        setProfile(null)
        evictProfileCache()
      }
    })

    return () => {
      clearTimeout(safetyTimer)
      subscription.unsubscribe()
    }
  }, [])

  async function fetchProfile(userId: string) {
    const gen = authGenRef.current
    try {
      const timeout = new Promise<null>(resolve => setTimeout(() => resolve(null), 5000))
      const query = Promise.resolve(supabase.from('profiles').select('*').eq('id', userId).limit(1))
        .then(r => r.data?.[0] ?? null)
        .catch(() => null)
      const data = await Promise.race([query, timeout])
      // Drop a late result whose auth generation has been superseded (sign-out or
      // a different user signed in while this was in flight).
      if (data && gen === authGenRef.current) {
        setProfile(data)
        writeCachedProfile(data)
      }
    } catch {}
  }

  // ── Guest-account plumbing ─────────────────────────────────────────────────

  async function claimPendingMergeTicket(currentUserId: string) {
    let raw: string | null = null
    try { raw = localStorage.getItem(MERGE_TICKET_KEY) } catch { /* storage unavailable */ }
    if (!raw) return
    try {
      const ticket = JSON.parse(raw) as { secret?: string; from?: string }
      // Anonymous → upgraded IN PLACE (same id): no merge needed, drop the ticket.
      if (!ticket.secret || ticket.from === currentUserId) {
        localStorage.removeItem(MERGE_TICKET_KEY)
        return
      }
      const { data, error } = await supabase.rpc('claim_merge_ticket', { p_secret: ticket.secret })
      localStorage.removeItem(MERGE_TICKET_KEY)
      if (error) {
        phCapture('anonymous_data_merge_failed')
        toast.error(translate('guest.merge.failed'), { duration: 8000 })
        return
      }
      phCapture('anonymous_data_merge_completed')
      const result = (Array.isArray(data) ? data[0] : data) ?? {}
      const moved = result.moved ?? 0
      if (moved > 0) toast.success(translate('guest.merge.done', { count: moved }), { duration: 6000 })
      // Persist the moved ids BEFORE dispatching: the re-seal (decrypt with the
      // parked guest key → re-encrypt under this account's vault) must survive
      // an app restart if the vault isn't open yet.
      storeResealIds(result.moved_ids ?? [])
      window.dispatchEvent(new CustomEvent('gs-merge-completed', { detail: { movedIds: result.moved_ids ?? [] } }))
    } catch {
      try { localStorage.removeItem(MERGE_TICKET_KEY) } catch { /* storage unavailable */ }
    }
  }

  async function ensureAnonymousSession(): Promise<{ error: Error | null }> {
    if (anonInFlight) return anonInFlight
    anonInFlight = (async () => {
      try {
        const { data } = await supabase.auth.getSession()
        if (data.session) return { error: null }
        const { data: anon, error } = await supabase.auth.signInAnonymously()
        if (error) return { error }
        if (anon.user) phCapture('anonymous_user_created')
        return { error: null }
      } catch (e) {
        return { error: e instanceof Error ? e : new Error('anonymous_signin_failed') }
      } finally {
        anonInFlight = null
      }
    })()
    return anonInFlight
  }

  async function upgradeAnonymousAccount(email: string, password: string, name?: string) {
    phCapture('account_upgrade_started')
    const cleaned = email.trim().toLowerCase()
    const { error } = await supabase.auth.updateUser({
      email: cleaned,
      password,
      data: { name: name || cleaned.split('@')[0] },
    })
    if (error) {
      if (/already|exists|registered/i.test(error.message || '')) {
        return { error: new Error('email_exists') }
      }
      return { error }
    }
    // Keep the profile row in step (the server trigger also syncs on confirmation)
    try {
      await supabase.from('profiles').update({ email: cleaned, ...(name ? { name } : {}) }).eq('id', user?.id ?? '')
      setProfile(prev => (prev ? { ...prev, email: cleaned, ...(name ? { name } : {}) } : prev))
    } catch { /* profile sync is best-effort; the server trigger covers it on confirmation */ }
    // is_anonymous flips only after the confirmation link is clicked — refresh
    // so the UI picks the change up when it happens mid-session.
    supabase.auth.refreshSession().catch(() => {})
    phCapture('account_upgrade_completed')
    return { error: null }
  }

  async function beginMergeLogin(): Promise<'ok' | 'locked' | 'failed'> {
    if (!user?.is_anonymous) return 'ok' // nothing to merge — proceed normally
    phCapture('existing_account_login_started')
    // Sealed rows move sealed — the server NEVER sees plaintext. The guest
    // vault key is parked on this device so the target account can re-seal
    // them under its own vault right after the merge (see e2eeMerge.ts).
    const prep = await parkGuestVaultKeyForMerge()
    if (prep !== 'ok') return prep === 'locked' ? 'locked' : 'failed'
    const { data, error } = await supabase.rpc('create_merge_ticket')
    const secret = Array.isArray(data) ? data[0] : data
    if (error || !secret) return 'failed'
    try {
      localStorage.setItem(MERGE_TICKET_KEY, JSON.stringify({ secret, from: user.id }))
    } catch { return 'failed' }
    return 'ok'
  }

  async function signIn(email: string, password: string) {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    return { error }
  }

  async function signInWithBiometric() {
    // Try to restore existing session via refresh token (no password needed)
    const { data, error } = await supabase.auth.refreshSession()
    if (!error && data.session) {
      setSession(data.session)
      setUser(data.session.user)
      await fetchProfile(data.session.user.id)
      return { error: null }
    }
    return { error: error ?? new Error('session_expired') }
  }

  async function signInWithGoogle() {
    const appUrl = import.meta.env.VITE_APP_URL
    if (!appUrl && import.meta.env.DEV) {
      console.warn('VITE_APP_URL is not set — OAuth redirect will use window.location.origin')
    }
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: appUrl || window.location.origin },
    })
    return { error }
  }

  async function signUp(email: string, password: string, name?: string) {
    const siteUrl = import.meta.env.VITE_APP_URL || window.location.origin
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { name: name || email.split('@')[0] },
        emailRedirectTo: siteUrl,
      },
    })
    if (error) return { error }
    // identities is empty when the email already exists in Supabase Auth
    if (data.user?.identities?.length === 0) {
      return { error: new Error('כתובת האימייל כבר רשומה במערכת') }
    }
    return { error }
  }

  async function signOut() {
    evictProfileCache()
    // Wipe the vault key material HERE, not only in E2EEContext's `!user` effect:
    // signing out sets user→null, which unmounts E2EEProvider before that effect
    // can run, so the exported AES master key used to survive in sessionStorage
    // (and was readable by the next account signing in on the same tab).
    wipeVaultSessionKeys()
    // Remembered so app-mode doesn't instantly re-create a guest session and
    // trap the user out of the login screen they explicitly asked for.
    markExplicitSignOut()
    await supabase.auth.signOut()
  }

  async function resetPassword(email: string) {
    const siteUrl = import.meta.env.VITE_APP_URL || window.location.origin
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: siteUrl,
    })
    return { error }
  }

  async function updatePassword(password: string) {
    const { error } = await supabase.auth.updateUser({ password })
    if (!error) setPasswordRecovery(false)
    return { error }
  }

  async function updateProfile(data: Partial<Profile>) {
    if (!user) return
    await supabase.from('profiles').update(data).eq('id', user.id)
    setProfile(prev => {
      const next = prev ? { ...prev, ...data } : null
      if (next) writeCachedProfile(next)
      return next
    })
  }

  const isAdmin = profile?.is_admin === true
  const isAnonymous = user?.is_anonymous === true
  const accountState: AccountState =
    loading ? 'initializing' : !user ? 'signedOut' : isAnonymous ? 'anonymous' : 'registered'

  return (
    <AuthContext.Provider value={{ user, session, profile, isAdmin, loading, passwordRecovery, isAnonymous, accountState, signIn, signInWithBiometric, signUp, signInWithGoogle, signOut, updateProfile, resetPassword, updatePassword, ensureAnonymousSession, upgradeAnonymousAccount, beginMergeLogin }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
