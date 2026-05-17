import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { User, Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import type { Profile } from '../types'
import { identifyUser, resetPostHog } from '../lib/posthog'

interface AuthContextType {
  user: User | null
  session: Session | null
  profile: Profile | null
  isAdmin: boolean
  loading: boolean
  passwordRecovery: boolean
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>
  signInWithBiometric: () => Promise<{ error: Error | null }>
  signUp: (email: string, password: string, name?: string) => Promise<{ error: Error | null }>
  signInWithGoogle: () => Promise<{ error: Error | null }>
  signOut: () => Promise<void>
  updateProfile: (data: Partial<Profile>) => Promise<void>
  resetPassword: (email: string) => Promise<{ error: Error | null }>
  updatePassword: (password: string) => Promise<{ error: Error | null }>
}

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
      setSession(session)
      setUser(session?.user ?? null)
      if (session?.user) {
        identifyUser(session.user.id, session.user.email)
        const cached = readCachedProfile(session.user.id)
        if (cached) setProfile(cached)
        await fetchProfile(session.user.id)
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
    try {
      const timeout = new Promise<null>(resolve => setTimeout(() => resolve(null), 5000))
      const query = Promise.resolve(supabase.from('profiles').select('*').eq('id', userId).limit(1))
        .then(r => r.data?.[0] ?? null)
        .catch(() => null)
      const data = await Promise.race([query, timeout])
      if (data) {
        setProfile(data)
        writeCachedProfile(data)
      }
    } catch {}
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

  return (
    <AuthContext.Provider value={{ user, session, profile, isAdmin, loading, passwordRecovery, signIn, signInWithBiometric, signUp, signInWithGoogle, signOut, updateProfile, resetPassword, updatePassword }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
