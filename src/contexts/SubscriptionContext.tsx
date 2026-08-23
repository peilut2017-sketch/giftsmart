import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from './AuthContext'

export type Plan = 'free' | 'pro'

export interface PlanLimits {
  maxVouchers: number       // 25 | Infinity
  maxSharedVouchers: number // 5  | Infinity
  maxScansPerMonth: number  // 3  | Infinity
  historyDays: number       // 7  | Infinity
  canExport: boolean
  canPushNotify: boolean
}

const FREE_LIMITS: PlanLimits = {
  maxVouchers: 25,
  maxSharedVouchers: 5,
  maxScansPerMonth: 3,
  historyDays: 7,
  canExport: false,
  canPushNotify: false,
}

const PRO_LIMITS: PlanLimits = {
  maxVouchers: Infinity,
  maxSharedVouchers: Infinity,
  maxScansPerMonth: Infinity,
  historyDays: Infinity,
  canExport: true,
  canPushNotify: true,
}

interface SubscriptionContextType {
  plan: Plan
  isPro: boolean
  proExpiryDate: string | null
  limits: PlanLimits
  upgradeSheetOpen: boolean
  upgradeReason: string
  openUpgradeSheet: (reason?: string) => void
  closeUpgradeSheet: () => void
  refreshPlan: () => Promise<void>
}

const SubscriptionContext = createContext<SubscriptionContextType | undefined>(undefined)

/**
 * Robustly interpret get_premium_enabled()'s result. The canonical function
 * returns a boolean, but a legacy deployment can return the TEXT 'false' or a
 * single-row array — and `'false' !== false`, so the old strict check kept the
 * premium system "on" (limits enforced) even after the admin disabled it.
 */
export function parsePremiumFlag(data: unknown): boolean {
  let v: unknown = data
  if (Array.isArray(v)) {
    const row = v[0]
    v = row && typeof row === 'object' ? (row as Record<string, unknown>).get_premium_enabled ?? row : row
  }
  return !(v === false || v === 'false' || v === 'f' || v === 0 || v === '0')
}

export function SubscriptionProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const [plan, setPlan] = useState<Plan>('free')
  const [proExpiryDate, setProExpiryDate] = useState<string | null>(null)
  const [premiumEnabled, setPremiumEnabled] = useState(
    () => localStorage.getItem('gs_premium_enabled') !== 'false'
  )
  const [upgradeSheetOpen, setUpgradeSheetOpen] = useState(false)
  const [upgradeReason, setUpgradeReason] = useState('')

  // Fetch the admin-controlled premium flag on mount and whenever the app
  // regains focus, so an admin toggle reaches already-open sessions without a
  // full reload; persist to localStorage for the next cold start
  useEffect(() => {
    const fetchFlag = () => {
      Promise.resolve(supabase.rpc('get_premium_enabled')).then(({ data, error }) => {
        if (error) return // keep last known value
        const enabled = parsePremiumFlag(data)
        setPremiumEnabled(enabled)
        try { localStorage.setItem('gs_premium_enabled', String(enabled)) } catch {}
      }).catch(() => {})
    }
    fetchFlag()
    window.addEventListener('focus', fetchFlag)
    return () => window.removeEventListener('focus', fetchFlag)
  }, [])

  useEffect(() => {
    if (!user) { setPlan('free'); return }
    ;(async () => {
      try {
        const { data } = await supabase
          .from('subscriptions')
          .select('plan, status, current_period_end')
          .eq('user_id', user.id)
          .maybeSingle()
        if (
          data?.plan === 'pro' &&
          data.status === 'active' &&
          (!data.current_period_end || new Date(data.current_period_end) > new Date())
        ) {
          setPlan('pro')
          setProExpiryDate(data.current_period_end ?? null)
        } else {
          setPlan('free')
          setProExpiryDate(null)
        }
      } catch {
        setPlan('free')
        setProExpiryDate(null)
      }
    })()
  }, [user])

  // If admin disabled premium system → everyone is effectively Pro
  const isPro = !premiumEnabled || plan === 'pro'
  const limits = isPro ? PRO_LIMITS : FREE_LIMITS

  function openUpgradeSheet(reason = '') {
    setUpgradeReason(reason)
    setUpgradeSheetOpen(true)
  }

  async function refreshPlan() {
    try {
      const { data: premData, error: premErr } = await supabase.rpc('get_premium_enabled')
      if (!premErr) setPremiumEnabled(parsePremiumFlag(premData))
    } catch {}
    if (!user) { setPlan('free'); return }
    try {
      const { data } = await supabase
        .from('subscriptions')
        .select('plan, status, current_period_end')
        .eq('user_id', user.id)
        .maybeSingle()
      if (
        data?.plan === 'pro' &&
        data.status === 'active' &&
        (!data.current_period_end || new Date(data.current_period_end) > new Date())
      ) {
        setPlan('pro')
        setProExpiryDate(data.current_period_end ?? null)
      } else {
        setPlan('free')
        setProExpiryDate(null)
      }
    } catch {
      setPlan('free')
      setProExpiryDate(null)
    }
  }

  return (
    <SubscriptionContext.Provider value={{
      plan, isPro, proExpiryDate, limits,
      upgradeSheetOpen, upgradeReason,
      openUpgradeSheet,
      closeUpgradeSheet: () => setUpgradeSheetOpen(false),
      refreshPlan,
    }}>
      {children}
    </SubscriptionContext.Provider>
  )
}

export function useSubscription() {
  const ctx = useContext(SubscriptionContext)
  if (!ctx) throw new Error('useSubscription must be used within SubscriptionProvider')
  return ctx
}
