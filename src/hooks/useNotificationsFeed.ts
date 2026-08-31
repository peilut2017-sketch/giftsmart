import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useVouchers } from '../contexts/VoucherContext'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import { getExpiryStatus, getExpiryLabel, formatCurrency } from '../utils/helpers'
import { useT } from '../lib/i18n'
import type { DiscountDeal } from '../types'

const LOW_BALANCE_THRESHOLD = 0.15
const CACHE_TTL_MS = 60_000

export type NotificationType = 'system' | 'expiry' | 'utilization' | 'discount' | 'support' | 'shared_update'

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
// Keyed by userId: it holds per-user private rows (support replies, shared-balance
// updates), so on a sign-out→different-login in the same tab within the TTL the
// cache must NOT be reused for the new user.
let rawCache: { userId: string; items: NotificationItem[]; at: number } | null = null
let inflight: Promise<NotificationItem[]> | null = null

function cacheFor(userId: string | undefined) {
  return userId && rawCache && rawCache.userId === userId ? rawCache : null
}

function seenKey(userId: string) { return `notif_seen_${userId}` }
function dismissedKey(userId: string) { return `notif_dismissed_${userId}` }

function readIdSet(key: string): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(key) || '[]')) } catch { return new Set() }
}
function writeIdSet(key: string, ids: Set<string>) {
  localStorage.setItem(key, JSON.stringify([...ids]))
}

async function fetchRaw(): Promise<NotificationItem[]> {
  const [pushRes, broadcastRes, supportRes, dealsRes, sharedRes] = await Promise.all([
    supabase.from('push_broadcasts').select('id, title, body, created_at').order('created_at', { ascending: false }).limit(20),
    supabase.from('admin_broadcasts').select('id, subject, body, created_at').order('created_at', { ascending: false }).limit(20),
    supabase.from('support_messages').select('id, subject, admin_reply, replied_at').not('admin_reply', 'is', null).order('replied_at', { ascending: false }).limit(20),
    supabase.rpc('get_recent_deals', { p_limit: 30 }),
    // Balance updates made by share partners / shared links / gift links.
    // Previously these existed only as a live realtime toast — anyone not in
    // the app at that exact moment never saw them.
    supabase.from('shared_balance_updates').select('id, voucher_id, store_name, old_balance, new_balance, store_used, created_at').order('created_at', { ascending: false }).limit(20),
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
  type SharedUpdateRow = { id: string; voucher_id: string; store_name: string; old_balance: number; new_balance: number; store_used: string | null; created_at: string }
  for (const u of (sharedRes.data || []) as SharedUpdateRow[]) {
    const used = Math.max(0, Number(u.old_balance) - Number(u.new_balance))
    const usedPart = used > 0 ? `₪${used.toLocaleString('he-IL')}` : `₪${Number(u.new_balance).toLocaleString('he-IL')}`
    items.push({
      id: `shared-${u.id}`, type: 'shared_update', icon: 'group', iconColor: '#0ea5e9', iconBg: 'rgba(14,165,233,0.1)',
      title: u.store_name,
      desc: `${used > 0 ? `שימוש של ${usedPart} ע"י שותף` : `יתרה עודכנה ל-${usedPart} ע"י שותף`}${u.store_used ? ` · ${u.store_used}` : ''} · יתרה: ₪${Number(u.new_balance).toLocaleString('he-IL')}`,
      timestamp: u.created_at, path: `/checkout/${u.voucher_id}`,
    })
  }

  return items
}

export function useNotificationsFeed() {
  const { user } = useAuth()
  const { vouchers } = useVouchers()
  const { t } = useT()

  const [rawItems, setRawItems] = useState<NotificationItem[]>(cacheFor(user?.id)?.items ?? [])
  const [loading, setLoading] = useState(!cacheFor(user?.id))
  const [loadError, setLoadError] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const [dismissed, setDismissed] = useState<Set<string>>(() => user ? readIdSet(dismissedKey(user.id)) : new Set())
  // Captured once on load — which ids were unseen *before* this visit. Kept stable
  // for the lifetime of this hook instance so highlighted items don't un-highlight
  // themselves mid-visit as markAllSeen() persists the new seen-state underneath.
  const initialUnseenRef = useRef<Set<string> | null>(null)

  useEffect(() => {
    if (!user) return

    const uid = user.id
    async function load() {
      const fresh = cacheFor(uid)
      if (fresh && Date.now() - fresh.at < CACHE_TTL_MS) {
        setRawItems(fresh.items)
        setLoading(false)
        return
      }
      // A different user's inflight fetch must not be reused
      if (!inflight || (rawCache && rawCache.userId !== uid)) {
        inflight = fetchRaw().finally(() => { inflight = null })
      }
      try {
        const items = await inflight
        rawCache = { userId: uid, items, at: Date.now() }
        setRawItems(items)
        setLoadError(false)
      } catch (err) {
        console.error('[notifications] fetch error', err)
        setLoadError(true)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [user, reloadKey])  

  const refresh = useCallback(() => {
    rawCache = null
    setLoading(true)
    setLoadError(false)
    setReloadKey(k => k + 1)
  }, [])

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

  // Manual "mark all as read": persists like markAllSeen but also clears the
  // stable unseen snapshot so highlights drop immediately, not on next visit.
  const [, bumpUnseen] = useState(0)
  const markAllRead = useCallback(() => {
    if (!user) return
    const seen = readIdSet(seenKey(user.id))
    computedItems.forEach(i => seen.add(i.id))
    writeIdSet(seenKey(user.id), seen)
    initialUnseenRef.current = new Set()
    bumpUnseen(n => n + 1)
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

  const undoDismiss = useCallback((id: string) => {
    if (!user) return
    setDismissed(prev => {
      const next = new Set(prev)
      next.delete(id)
      writeIdSet(dismissedKey(user.id), next)
      return next
    })
  }, [user])

  return { items, loading, loadError, refresh, unseenCount, markAllSeen, markAllRead, dismiss, undoDismiss }
}
