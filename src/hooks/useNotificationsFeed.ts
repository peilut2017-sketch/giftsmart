import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useVouchers } from '../contexts/VoucherContext'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import { getExpiryStatus, getExpiryLabel, formatCurrency } from '../utils/helpers'
import { useT } from '../lib/i18n'
import type { DiscountDeal } from '../types'

const LOW_BALANCE_THRESHOLD = 0.15
const CACHE_TTL_MS = 60_000

export type NotificationType = 'system' | 'expiry' | 'utilization' | 'discount' | 'support'

export interface NotificationItem {
  id: string
  type: NotificationType
  icon: string
  iconColor: string
  iconBg: string
  title: string
  desc: string
  timestamp: string
  path?: string
  deal?: DiscountDeal
}

// Module-level cache so Home (just checking for a badge) and the Notifications page
// (rendering the full list) don't each fire their own round of network requests —
// whichever mounts first within the TTL window fetches, the other reuses it.
let rawCache: { items: NotificationItem[]; at: number } | null = null
let inflight: Promise<NotificationItem[]> | null = null

function seenKey(userId: string) { return `notif_seen_${userId}` }
function dismissedKey(userId: string) { return `notif_dismissed_${userId}` }

function readIdSet(key: string): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(key) || '[]')) } catch { return new Set() }
}
function writeIdSet(key: string, ids: Set<string>) {
  localStorage.setItem(key, JSON.stringify([...ids]))
}

async function fetchRaw(): Promise<NotificationItem[]> {
  const [pushRes, broadcastRes, supportRes, dealsRes] = await Promise.all([
    supabase.from('push_broadcasts').select('id, title, body, created_at').order('created_at', { ascending: false }).limit(20),
    supabase.from('admin_broadcasts').select('id, subject, body, created_at').order('created_at', { ascending: false }).limit(20),
    supabase.from('support_messages').select('id, subject, admin_reply, replied_at').not('admin_reply', 'is', null).order('replied_at', { ascending: false }).limit(20),
    supabase.rpc('get_recent_deals', { p_limit: 30 }),
  ])

  const items: NotificationItem[] = []

  for (const p of (pushRes.data || []) as any[]) {
    items.push({
      id: `push-${p.id}`, type: 'system', icon: 'notifications_active', iconColor: '#3b82f6', iconBg: 'rgba(59,130,246,0.1)',
      title: p.title, desc: p.body, timestamp: p.created_at,
    })
  }
  for (const b of (broadcastRes.data || []) as any[]) {
    items.push({
      id: `bc-${b.id}`, type: 'system', icon: 'notifications_active', iconColor: '#3b82f6', iconBg: 'rgba(59,130,246,0.1)',
      title: b.subject, desc: b.body, timestamp: b.created_at,
    })
  }
  for (const m of (supportRes.data || []) as any[]) {
    items.push({
      id: `support-${m.id}`, type: 'support', icon: 'chat', iconColor: 'var(--c-primary)', iconBg: 'var(--c-primary-light)',
      title: m.subject, desc: m.admin_reply, timestamp: m.replied_at, path: '/settings/about',
    })
  }
  const deals = ((dealsRes.data || []) as DiscountDeal[]).filter(d => d.is_my_club)
  for (const deal of deals) {
    items.push({
      id: `deal-${deal.deal_id}`, type: 'discount', icon: 'percent', iconColor: '#a855f7', iconBg: 'rgba(168,85,247,0.1)',
      title: deal.business_name, desc: deal.title, timestamp: deal.created_at || new Date(0).toISOString(), deal,
    })
  }

  return items
}

export function useNotificationsFeed() {
  const { user } = useAuth()
  const { vouchers } = useVouchers()
  const { t } = useT()

  const [rawItems, setRawItems] = useState<NotificationItem[]>(rawCache?.items ?? [])
  const [loading, setLoading] = useState(!rawCache)
  const [dismissed, setDismissed] = useState<Set<string>>(() => user ? readIdSet(dismissedKey(user.id)) : new Set())
  // Captured once on load — which ids were unseen *before* this visit. Kept stable
  // for the lifetime of this hook instance so highlighted items don't un-highlight
  // themselves mid-visit as markAllSeen() persists the new seen-state underneath.
  const initialUnseenRef = useRef<Set<string> | null>(null)

  useEffect(() => {
    if (!user) return

    async function load() {
      if (rawCache && Date.now() - rawCache.at < CACHE_TTL_MS) {
        setRawItems(rawCache.items)
        setLoading(false)
        return
      }
      if (!inflight) inflight = fetchRaw().finally(() => { inflight = null })
      try {
        const items = await inflight
        rawCache = { items, at: Date.now() }
        setRawItems(items)
      } catch (err) {
        console.error('[notifications] fetch error', err)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [user]) // eslint-disable-line react-hooks/exhaustive-deps

  const computedItems = useMemo(() => {
    const now = Date.now()
    const utilization: NotificationItem[] = []
    const expiry: NotificationItem[] = []
    for (const v of vouchers) {
      const ts = v.updated_at || v.created_at || new Date(now).toISOString()
      if (v.amount > 0 && v.balance > 0 && v.balance / v.amount <= LOW_BALANCE_THRESHOLD) {
        const pct = Math.round((v.balance / v.amount) * 100)
        utilization.push({
          id: `util-${v.id}`, type: 'utilization', icon: 'bolt', iconColor: 'var(--c-warning)', iconBg: 'rgba(217,119,6,0.1)',
          title: v.store_name, desc: t('notifications.utilization.desc', { pct, balance: formatCurrency(v.balance) }),
          timestamp: ts, path: `/checkout/${v.id}`,
        })
      }
      if (v.expiry_date && ['expired', 'critical', 'warning'].includes(getExpiryStatus(v.expiry_date))) {
        expiry.push({
          id: `expiry-${v.id}`, type: 'expiry', icon: 'event_busy', iconColor: 'var(--c-error)', iconBg: 'rgba(220,38,38,0.1)',
          title: v.store_name, desc: getExpiryLabel(v.expiry_date), timestamp: ts, path: `/checkout/${v.id}`,
        })
      }
    }
    return [...rawItems, ...utilization, ...expiry]
      .filter(i => !dismissed.has(i.id))
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
  }, [rawItems, vouchers, dismissed, t])

  // Snapshot "unseen at load" once per (user, item-set) — not on every render.
  if (user && initialUnseenRef.current === null && !loading) {
    const seen = readIdSet(seenKey(user.id))
    initialUnseenRef.current = new Set(computedItems.filter(i => !seen.has(i.id)).map(i => i.id))
  }
  const initialUnseen = initialUnseenRef.current ?? new Set<string>()

  const items = useMemo(
    () => computedItems.map(i => ({ ...i, unseen: initialUnseen.has(i.id) })),
    [computedItems, initialUnseen]
  )

  const unseenCount = items.filter(i => i.unseen).length

  const markAllSeen = useCallback(() => {
    if (!user || computedItems.length === 0) return
    const seen = readIdSet(seenKey(user.id))
    computedItems.forEach(i => seen.add(i.id))
    writeIdSet(seenKey(user.id), seen)
  }, [user, computedItems])

  const dismiss = useCallback((id: string) => {
    if (!user) return
    setDismissed(prev => {
      const next = new Set(prev)
      next.add(id)
      writeIdSet(dismissedKey(user.id), next)
      return next
    })
  }, [user])

  return { items, loading, unseenCount, markAllSeen, dismiss }
}
