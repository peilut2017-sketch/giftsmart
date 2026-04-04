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
  limits: PlanLimits
  upgradeSheetOpen: boolean
  upgradeReason: string
  openUpgradeSheet: (reason?: string) => void
  closeUpgradeSheet: () => void
  refreshPlan: () => Promise<void>
}

const SubscriptionContext = createContext<SubscriptionContextType | undefined>(undefined)

export function SubscriptionProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const [plan, setPlan] = useState<Plan>('free')
  const [premiumEnabled, setPremiumEnabled] = useState(true)
  const [upgradeSheetOpen, setUpgradeSheetOpen] = useState(false)
  const [upgradeReason, setUpgradeReason] = useState('')

  // Fetch the admin-controlled premium flag once on mount
  useEffect(() => {
    Promise.resolve(supabase.rpc('get_premium_enabled')).then(({ data }) => {
      if (data === false) setPremiumEnabled(false)
    }).catch(() => {})
  }, [])

  useEffect(() => {
    if (!user) { setPlan('free'); return }
    ;(async () => {
      try {
        const { data } = await supabase
          .from('subscriptions')
          .select('plan, status, current_period_end')
          .eq('user_id', user.id)
          .single()
        if (
          data?.plan === 'pro' &&
          data.status === 'active' &&
          (!data.current_period_end || new Date(data.current_period_end) > new Date())
        ) {
          setPlan('pro')
        } else {
          setPlan('free')
        }
      } catch {
        setPlan('free')
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
    Promise.resolve(supabase.rpc('get_premium_enabled')).then(({ data }) => {
      setPremiumEnabled(data !== false)
    }).catch(() => {})
    if (!user) { setPlan('free'); return }
    try {
      const { data } = await supabase
        .from('subscriptions')
        .select('plan, status, current_period_end')
        .eq('user_id', user.id)
        .single()
      if (
        data?.plan === 'pro' &&
        data.status === 'active' &&
        (!data.current_period_end || new Date(data.current_period_end) > new Date())
      ) {
        setPlan('pro')
      } else {
        setPlan('free')
      }
    } catch {
      setPlan('free')
    }
  }

  return (
    <SubscriptionContext.Provider value={{
      plan, isPro, limits,
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
