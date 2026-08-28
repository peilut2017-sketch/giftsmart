import { createContext, useContext, useEffect, useState, useCallback, useRef, type ReactNode } from 'react'
import toast from 'react-hot-toast'
import { track } from '@vercel/analytics'
import { phCapture } from '../lib/posthog'
import { supabase } from '../lib/supabase'
import { translate } from '../lib/i18n'
import { useAuth } from './AuthContext'
import type { Voucher, SuperVoucher, Category, Store } from '../types'
import { DEFAULT_CATEGORIES } from '../types'
import { sendInviteEmail } from '../lib/emailService'

export interface VoucherShare {
  id: string
  shared_with_email: string
  shared_with_user_id: string | null
  created_at: string
}

interface VoucherContextType {
  vouchers: Voucher[]
  archivedVouchers: Voucher[]
  superVouchers: SuperVoucher[]
  categories: Category[]
  stores: Store[]
  sharedWithMe: Voucher[]
  walletId: string | null
  walletName: string
  walletError: string | null
  loading: boolean
  isOnline: boolean
  pendingOpsCount: number
  addVoucher: (v: Omit<Voucher, 'id' | 'user_id' | 'wallet_id' | 'created_at' | 'updated_at'>) => Promise<Voucher | null>
  updateVoucher: (id: string, data: Partial<Voucher>, storeUsed?: string | null) => Promise<void>
  deleteVoucher: (id: string) => Promise<void>
  archiveVoucher: (id: string, reason?: string) => Promise<void>
  unarchiveVoucher: (id: string) => Promise<void>
  archiveExpired: () => Promise<void>
  syncToCloud: () => Promise<void>
  addStore: (name: string) => Promise<Store>
  addSuperVoucher: (sv: Omit<SuperVoucher, 'id' | 'wallet_id' | 'created_at' | 'updated_at'>) => Promise<void>
  updateSuperVoucher: (id: string, data: Partial<SuperVoucher>) => Promise<void>
  deleteSuperVoucher: (id: string) => Promise<void>
  addCategory: (name: string, emoji?: string) => Promise<void>
  inviteMember: (email: string) => Promise<'added' | 'not_found'>
  removeMember: (userId: string) => Promise<void>
  updateWalletName: (name: string) => Promise<void>
  refreshVouchers: () => Promise<void>
  createShareToken: (voucherId: string, expiresInDays?: number, codeOverride?: string) => Promise<string>
  deleteShareToken: (token: string) => Promise<void>
  getShareTokens: (voucherId: string) => Promise<Array<{ token: string; expires_at: string | null; view_count: number; created_at: string }>>
  shareVoucherWithUser: (voucherId: string, email: string) => Promise<'shared' | 'already_shared' | 'not_found'>
  getVoucherShares: (voucherId: string) => Promise<VoucherShare[]>
  unshareVoucher: (voucherId: string, email: string) => Promise<void>
  updateSharedVoucherBalance: (voucherId: string, newBalance: number, storeUsed?: string | null) => Promise<void>
  getActivityLog: (limit?: number) => Promise<ActivityLogEntry[]>
  getVoucherActivityLog: (voucherId: string) => Promise<ActivityLogEntry[]>
  logAction: (action: ActivityLogEntry['action'], voucherName: string, voucherId?: string, details?: Record<string, any>) => void
  createGift: (voucherId: string, recipientEmail: string | null, message: string, sendAt: Date, codeOverride?: string) => Promise<string | null>
  cancelGift: (giftId: string) => Promise<void>
  getPendingGifts: (voucherId: string) => Promise<PendingGift[]>
}

export interface PendingGift {
  id: string
  recipient_email: string
  message: string | null
  send_at: string
  email_sent_at: string | null
  created_at: string
}

export interface ActivityLogEntry {
  id: string
  action: 'add' | 'edit' | 'balance_update' | 'archive' | 'unarchive' | 'delete'
    | 'gift_sent' | 'gift_link' | 'gift_received' | 'gift_balance_update' | 'gift_cancelled'
    | 'share_link' | 'share_email' | 'share_link_deleted' | 'unshare_email'
    | 'list_for_sale' | 'cancel_sale'
    | 'system_password_change' | 'system_biometric_link' | 'system_telegram_link'
    | 'system_wallet_share' | 'system_payment_method_add' | 'system_payment_method_remove'
    | 'system_voucher_purchase'
  voucher_id: string | null
  voucher_name: string
  details: Record<string, any>
  created_at: string
}

const VoucherContext = createContext<VoucherContextType | undefined>(undefined)

const CACHE_KEY_PREFIX = 'vouchers_cache_'
const PENDING_OPS_KEY_PREFIX = 'pending_ops_'
const VOUCHERS_VIEW = 'vouchers'
const QUERY_TIMEOUT_MS = 8000

type PendingOp =
  | { type: 'update'; id: string; data: Partial<Voucher>; storeUsed?: string | null; voucherName?: string; previousBalance?: number }
  | { type: 'delete'; id: string; voucherName?: string; balance?: number }
  | { type: 'archive'; id: string; voucherName?: string; balance?: number }
  | { type: 'unarchive'; id: string; voucherName?: string; balance?: number }

// Wraps a thenable (Supabase query) with a timeout so a hung query never freezes the app
function withTimeout<T>(thenable: PromiseLike<T>, ms = QUERY_TIMEOUT_MS): Promise<T> {
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error(`Query timeout after ${ms}ms`)), ms)
  )
  return Promise.race([Promise.resolve(thenable), timeout])
}

export function VoucherProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const [vouchers, setVouchers] = useState<Voucher[]>([])
  const [archivedVouchers, setArchivedVouchers] = useState<Voucher[]>([])
  const [superVouchers, setSuperVouchers] = useState<SuperVoucher[]>([])
  const [categories, setCategories] = useState<Category[]>(DEFAULT_CATEGORIES)
  const [stores, setStores] = useState<Store[]>([])
  const [sharedWithMe, setSharedWithMe] = useState<Voucher[]>([])
  const [walletId, setWalletId] = useState<string | null>(null)
  const walletIdRef = useRef<string | null>(null)
  const vouchersRef = useRef<Voucher[]>([])
  const [walletName, setWalletName] = useState('ארנק השוברים שלי')
  const [walletError, setWalletError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [isOnline, setIsOnline] = useState(navigator.onLine)
  const [pendingOps, setPendingOps] = useState<PendingOp[]>([])
  const pendingOpsRef = useRef<PendingOp[]>([])

  const prevIsOnlineRef = useRef(navigator.onLine)

  // Keep ref in sync so async functions always read the latest vouchers
  useEffect(() => { vouchersRef.current = vouchers }, [vouchers])

  useEffect(() => {
    const handleOnline = () => setIsOnline(true)
    const handleOffline = () => setIsOnline(false)
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  const loadFromCache = useCallback((userId: string) => {
    try {
      const cached = localStorage.getItem(CACHE_KEY_PREFIX + userId)
      if (cached) {
        const data = JSON.parse(cached)
        setVouchers(data.active || [])
        setArchivedVouchers(data.archived || [])
      }
    } catch {}
  }, [])

  const saveToCache = useCallback((userId: string, active: Voucher[], archived: Voucher[]) => {
    try {
      localStorage.setItem(CACHE_KEY_PREFIX + userId, JSON.stringify({ active, archived }))
    } catch {}
  }, [])

  const loadPendingOps = useCallback((userId: string) => {
    try {
      const saved = localStorage.getItem(PENDING_OPS_KEY_PREFIX + userId)
      if (saved) {
        const ops: PendingOp[] = JSON.parse(saved)
        pendingOpsRef.current = ops
        setPendingOps(ops)
      }
    } catch {}
  }, [])

  const savePendingOps = useCallback((userId: string, ops: PendingOp[]) => {
    try {
      localStorage.setItem(PENDING_OPS_KEY_PREFIX + userId, JSON.stringify(ops))
    } catch {}
  }, [])

  const enqueuePendingOp = useCallback((op: PendingOp, userId: string) => {
    const newOps = [...pendingOpsRef.current, op]
    pendingOpsRef.current = newOps
    setPendingOps(newOps)
    savePendingOps(userId, newOps)
  }, [savePendingOps])

  const flushPendingOps = useCallback(async (userId: string) => {
    const ops = [...pendingOpsRef.current]
    if (ops.length === 0) return
    const failed: PendingOp[] = []
    for (const op of ops) {
      try {
        if (op.type === 'update') {
          await supabase.from(VOUCHERS_VIEW).update(op.data).eq('id', op.id)
        } else if (op.type === 'delete') {
          await supabase.from('vouchers').delete().eq('id', op.id)
        } else if (op.type === 'archive') {
          await supabase.from('vouchers').update({ is_archived: true }).eq('id', op.id)
        } else if (op.type === 'unarchive') {
          await supabase.from('vouchers').update({ is_archived: false }).eq('id', op.id)
        }
        // Log the action to activity_log now that we're online
        if (op.voucherName) {
          let action: ActivityLogEntry['action']
          const details: Record<string, any> = {}
          if (op.type === 'update') {
            const keys = Object.keys(op.data).filter(k => k !== 'updated_at')
            if (keys.includes('balance')) {
              action = 'balance_update'
              // previousBalance can be unknown when the voucher wasn't in local
              // state at enqueue time — record what we DO know instead of writing
              // an entry the renderers show as empty.
              if (op.previousBalance !== undefined) {
                details.from = op.previousBalance
                details.used = Math.max(0, (op.previousBalance ?? 0) - (op.data.balance ?? 0))
              }
              details.to = op.data.balance
              if (op.storeUsed) details.store_used = op.storeUsed
            } else {
              action = 'edit'
              const SENSITIVE = new Set(['code', 'cvv'])
              keys.filter(k => !SENSITIVE.has(k)).forEach(k => { details[k] = { to: (op.data as any)[k] } })
              if (keys.some(k => SENSITIVE.has(k))) details['_sensitive_updated'] = true
            }
          } else {
            action = op.type
            if ((op as any).balance !== undefined) details.balance = (op as any).balance
          }
          void Promise.resolve(supabase.from('activity_log').insert({
            user_id: userId,
            wallet_id: walletIdRef.current,
            action,
            voucher_id: op.id.startsWith('local-') ? null : op.id,
            voucher_name: op.voucherName,
            details,
          })).then(() => {}).catch(() => {})
        }
      } catch {
        failed.push(op)
      }
    }
    pendingOpsRef.current = failed
    setPendingOps(failed)
    savePendingOps(userId, failed)
  }, [savePendingOps])

  const fetchData = useCallback(async () => {
    if (!user) {
      setLoading(false)
      return
    }

    // Show cache immediately so the UI is never blank/stuck
    loadFromCache(user.id)
    setLoading(false)
    setWalletError(null)

    if (!navigator.onLine) return

    try {
      let wId: string

      if (walletIdRef.current) {
        wId = walletIdRef.current
      } else {
        // ── Step 1: try the SECURITY DEFINER RPC (atomic get-or-create) ──
        let resolvedId: string | null = null
        const { data: rpcId, error: rpcErr } = await withTimeout<{ data: string | null; error: any }>(
          supabase.rpc('get_or_create_user_wallet') as any
        ).catch(() => ({ data: null, error: new Error('timeout') }))

        if (!rpcErr && rpcId) {
          resolvedId = rpcId
        } else {
          // ── Step 2: RPC missing/failed — try direct wallet_members SELECT ──
          if (import.meta.env.DEV) console.warn('RPC get_or_create_user_wallet failed, trying direct query:', rpcErr?.message)
          const { data: memberRows, error: memberErr } = await (supabase
            .from('wallet_members')
            .select('wallet_id')
            .eq('user_id', user.id)
            .order('created_at')
            .limit(1) as any)

          if (!memberErr && memberRows?.[0]?.wallet_id) {
            resolvedId = memberRows[0].wallet_id
          } else {
            // ── Step 3: no wallet at all — create one via direct insert ──
            if (import.meta.env.DEV) console.warn('No wallet_members row found, creating wallet directly')
            const { data: newWallet, error: walletCreateErr } = await (supabase
              .from('wallets')
              .insert({ name: 'ארנק השוברים שלי', owner_id: user.id })
              .select('id')
              .single() as any)

            if (walletCreateErr || !newWallet?.id) {
              const msg = rpcErr?.message || walletCreateErr?.message || 'לא ידוע'
              if (msg.includes('does not exist') || msg.includes('42883')) {
                setWalletError('הפונקציה get_or_create_user_wallet חסרה — הרץ את supabase-complete-fix.sql ב-Supabase')
              } else {
                setWalletError('שגיאה בהגדרת הארנק: ' + msg + ' — הרץ את supabase-complete-fix.sql ב-Supabase')
              }
              return
            }
            resolvedId = newWallet.id
            // Best-effort: add user to wallet_members
            await Promise.resolve(supabase.from('wallet_members').insert({
              wallet_id: resolvedId,
              user_id: user.id,
              email: user.email ?? '',
              role: 'owner',
            })).catch(() => {})
          }
        }

        if (!resolvedId) {
          setWalletError('לא ניתן לאתחל ארנק — הרץ את supabase-complete-fix.sql ב-Supabase')
          return
        }

        wId = resolvedId
        const { data: walletRow } = await Promise.resolve(supabase.from('wallets').select('name').eq('id', wId).single()).catch(() => ({ data: null }))
        if (walletRow?.name) setWalletName(walletRow.name)
        walletIdRef.current = wId
        setWalletId(wId)
      }

      // ── Fetch vouchers, super-vouchers, stores, categories in parallel ──
      // NOTE: No wallet_id filter on vouchers — RLS (get_my_wallet_ids) returns
      // vouchers from ALL wallets the user is a member of (own + shared wallets).
      type QueryResult = { data: any[] | null; error?: any }
      const [vRes, svRes, storeRes, catRes] = await Promise.allSettled([
        withTimeout<QueryResult>(supabase.from(VOUCHERS_VIEW).select('*').order('expiry_date', { ascending: true }).limit(500) as any),
        withTimeout<QueryResult>(
          (async () => {
            const res = await (supabase.from('super_vouchers').select('*').or(`wallet_id.eq.${wId},is_global.eq.true`).limit(100) as any)
            if (res.error?.code === '42703') {
              return supabase.from('super_vouchers').select('*').eq('wallet_id', wId).limit(100) as any
            }
            return res
          })()
        ),
        withTimeout<QueryResult>(supabase.from('stores').select('id,name,logo_url,website').order('name').limit(500) as any),
        withTimeout<QueryResult>(supabase.from('categories').select('*').or(`wallet_id.eq.${wId},wallet_id.is.null`) as any),
      ])

      if (vRes.status === 'fulfilled') {
        const vData = vRes.value.data
        const vErr = (vRes.value as any).error
        if (vData) {
          const active = vData.filter((v: any) => !v.is_archived)
          const archived = vData.filter((v: any) => v.is_archived)
          // Preserve any local (offline-created) vouchers that haven't been synced yet
          setVouchers(prev => {
            const localUnsynced = prev.filter(v => v.id.startsWith('local-'))
            return [...active, ...localUnsynced]
          })
          setArchivedVouchers(archived)
          saveToCache(user.id, active, archived)

          // ── Fallback: if 0 results and no explicit error, also search by user_id ──
          // (catches pre-wallet-migration data where wallet_id was different)
          if (vData.length === 0 && !vErr) {
            const { data: byUserId } = await Promise.resolve(supabase
              .from(VOUCHERS_VIEW)
              .select('*')
              .eq('user_id', user.id)
              .order('expiry_date', { ascending: true })
              .limit(500)).catch(() => ({ data: null }))
            if (byUserId && byUserId.length > 0) {
              const active2 = byUserId.filter((v: any) => !v.is_archived)
              const archived2 = byUserId.filter((v: any) => v.is_archived)
              setVouchers(prev => {
                const localUnsynced = prev.filter(v => v.id.startsWith('local-'))
                return [...active2, ...localUnsynced]
              })
              setArchivedVouchers(archived2)
              saveToCache(user.id, active2, archived2)
            }
          }
        } else if (vErr) {
          console.error('Vouchers fetch error:', vErr)
          setWalletError('שגיאה בטעינת שוברים: ' + (vErr.message || vErr.code || 'RLS') + ' — הרץ את supabase-complete-fix.sql')
        }
      }
      if (svRes.status === 'fulfilled' && svRes.value.data) setSuperVouchers(svRes.value.data)
      if (storeRes.status === 'fulfilled' && storeRes.value.data) setStores(storeRes.value.data)
      if (catRes.status === 'fulfilled' && catRes.value.data && catRes.value.data.length > 0) {
        const customCats = catRes.value.data.filter((c: any) => c.wallet_id === wId)
        setCategories([...DEFAULT_CATEGORIES, ...customCats])
      }

      // ── Fetch vouchers shared with me by others ──
      Promise.resolve(supabase.rpc('get_vouchers_shared_with_me'))
        .then(({ data }) => { if (data) setSharedWithMe(data as Voucher[]) })
        .catch(() => {})

    } catch (err: any) {
      console.error('Fetch error:', err)
      setWalletError(translate('ctx.load.error', { msg: err?.message || translate('ctx.unknown') }))
    }
  }, [user, loadFromCache, saveToCache])

  // Fetch a single voucher row from the view (decrypts code/cvv) and merge into state
  const mergeSingleVoucher = useCallback(async (id: string) => {
    if (!navigator.onLine || !user) return
    try {
      const { data } = await supabase.from(VOUCHERS_VIEW).select('*').eq('id', id).single() as any
      if (!data) return
      if (data.is_archived) {
        setArchivedVouchers(prev => {
          const exists = prev.some((v: any) => v.id === id)
          const next = exists ? prev.map((v: any) => v.id === id ? data : v) : [...prev, data]
          return next
        })
        setVouchers(prev => prev.filter((v: any) => v.id !== id))
      } else {
        setVouchers(prev => {
          const exists = prev.some((v: any) => v.id === id)
          const next = exists ? prev.map((v: any) => v.id === id ? data : v) : [...prev, data]
          return next
        })
        setArchivedVouchers(prev => prev.filter((v: any) => v.id !== id))
      }
    } catch (err) {
      console.error('mergeSingleVoucher error:', err)
    }
  }, [user])

  const syncToCloud = useCallback(async () => {
    if (!user || !walletIdRef.current) return
    // Read from ref to get the post-fetchData vouchers, not a stale closure snapshot
    const localVouchers = vouchersRef.current.filter(v => v.id.startsWith('local-'))
    for (const v of localVouchers) {
      const { id, ...rest } = v
      const { data } = await supabase.from(VOUCHERS_VIEW).insert({ ...rest, user_id: user.id, wallet_id: walletIdRef.current }).select().single()
      if (data) {
        setVouchers(prev => prev.map(pv => pv.id === id ? data : pv))
        logAction('add', data.store_name, data.id, { amount: data.amount, balance: data.balance })
      }
    }
  }, [user, logAction])

  // Auto-sync when coming back online
  useEffect(() => {
    if (!user) return
    const justCameOnline = isOnline && !prevIsOnlineRef.current
    prevIsOnlineRef.current = isOnline
    if (!justCameOnline) return
    ;(async () => {
      // fetchData first: sets walletIdRef.current (needed by syncToCloud) and preserves local vouchers in state
      await fetchData()
      await syncToCloud()
      await flushPendingOps(user.id)
      fetchData()
    })().catch(console.error)
  }, [isOnline, user, fetchData, syncToCloud, flushPendingOps])

  useEffect(() => {
    if (user) {
      // Reset all state before fetching for the new user to avoid showing stale data
      setVouchers([])
      setArchivedVouchers([])
      setSuperVouchers([])
      setCategories(DEFAULT_CATEGORIES)
      setStores([])
      setSharedWithMe([])
      setWalletId(null)
      walletIdRef.current = null
      loadPendingOps(user.id)
      fetchData()
    } else {
      // Clear all cached voucher data from localStorage on logout to prevent data leakage
      try {
        Object.keys(localStorage)
          .filter(k => k.startsWith(CACHE_KEY_PREFIX))
          .forEach(k => localStorage.removeItem(k))
      } catch {}
      walletIdRef.current = null
      setVouchers([])
      setArchivedVouchers([])
      setSuperVouchers([])
      setCategories(DEFAULT_CATEGORIES)
      setStores([])
      setWalletId(null)
      setWalletName('ארנק השוברים שלי')
      setLoading(false)
    }
  }, [user, fetchData])

  // Realtime subscription — smart single-row merge to avoid full re-fetches
  useEffect(() => {
    if (!walletId || !user) return
    const channel = supabase
      .channel(`wallet-${walletId}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'vouchers',
        filter: `wallet_id=eq.${walletId}`,
      }, (payload: any) => {
        if (payload.new?.id) mergeSingleVoucher(payload.new.id)
      })
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'vouchers',
        filter: `wallet_id=eq.${walletId}`,
      }, (payload: any) => {
        // Fetch from view so code/cvv are decrypted; don't use payload.new directly
        if (payload.new?.id) mergeSingleVoucher(payload.new.id)
      })
      .on('postgres_changes', {
        event: 'DELETE',
        schema: 'public',
        table: 'vouchers',
        filter: `wallet_id=eq.${walletId}`,
      }, (payload: any) => {
        const id = payload.old?.id
        if (!id) return
        setVouchers(prev => prev.filter((v: any) => v.id !== id))
        setArchivedVouchers(prev => prev.filter((v: any) => v.id !== id))
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [walletId, user, mergeSingleVoucher])

  async function addVoucher(v: Omit<Voucher, 'id' | 'user_id' | 'wallet_id' | 'created_at' | 'updated_at'>): Promise<Voucher | null> {
    if (!user) throw new Error(translate('ctx.not.logged.in'))

    // Offline: create a local voucher that will sync when back online
    if (!navigator.onLine) {
      const localId = `local-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
      const localVoucher: Voucher = {
        ...(v as any),
        id: localId,
        user_id: user.id,
        wallet_id: walletIdRef.current || 'local',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }
      const newActive = [...vouchersRef.current, localVoucher]
      setVouchers(newActive)
      saveToCache(user.id, newActive, archivedVouchers)
      return localVoucher
    }

    // If walletId not loaded yet, try to get it now
    let wId = walletId ?? walletIdRef.current
    if (!wId) {
      await fetchData()
      wId = walletIdRef.current
      if (!wId) throw new Error('לא ניתן לאתחל ארנק — הרץ את supabase-complete-fix.sql ב-Supabase')
    }

    // Check for super voucher match
    let superVoucherId: string | undefined
    const matchingSV = superVouchers.find(sv =>
      sv.name.toLowerCase() === v.store_name.toLowerCase()
    )
    if (matchingSV) superVoucherId = matchingSV.id

    const payload: Record<string, any> = {
      ...v,
      user_id: user.id,
      wallet_id: wId,
      super_voucher_id: superVoucherId,
    }
    // Remove undefined values to avoid sending null for columns that may not exist
    Object.keys(payload).forEach(k => payload[k] === undefined && delete payload[k])

    let { data, error } = await supabase.from(VOUCHERS_VIEW).insert(payload).select().single()

    // If schema cache error for a specific column, retry without it
    if (error?.message?.includes("column") && error.message.includes("schema cache")) {
      const colMatch = error.message.match(/column[s]?\s+"?(\w+)"?/i)
      if (colMatch) {
        delete payload[colMatch[1]]
        const retry = await supabase.from(VOUCHERS_VIEW).insert(payload).select().single()
        data = retry.data
        error = retry.error
      }
    }

    if (error) {
      console.error('Add voucher error:', error)
      // RLS rejection usually means the wallet was deleted (e.g. admin reset).
      // Clear wallet state so fetchData() re-creates it on next attempt.
      if (error.code === '42501' || error.message?.includes('row-level security')) {
        walletIdRef.current = null
        setWalletId(null)
        fetchData()
        throw new Error(translate('ctx.wallet.reset.retry'))
      }
      throw new Error(error.message)
    }

    const newActive = [...vouchers, data]
    setVouchers(newActive)
    if (user) saveToCache(user.id, newActive, archivedVouchers)
    logAction('add', data.store_name, data.id, { amount: data.amount, balance: data.balance })
    track('voucher_added', { store_name: data.store_name, amount: data.amount })
    phCapture('voucher_added', { store_name: data.store_name, amount: data.amount })
    return data
  }

  async function updateVoucher(id: string, vData: Partial<Voucher>, storeUsed?: string | null) {
    const existing = [...vouchers, ...archivedVouchers].find(v => v.id === id)
    const updated = { ...vData, updated_at: new Date().toISOString() }
    setVouchers(prev => prev.map(v => v.id === id ? { ...v, ...updated } : v))

    if (!id.startsWith('local-')) {
      if (!navigator.onLine) {
        if (!user) return
        // Queue for later sync — optimistic update already applied above
        enqueuePendingOp({ type: 'update', id, data: updated, storeUsed, voucherName: existing?.store_name, previousBalance: existing?.balance }, user.id)
      } else {
        // Update through the view so pgsodium re-encrypts code/cvv if they changed
        await supabase.from(VOUCHERS_VIEW).update(updated).eq('id', id)
      }
    }
    const newActive = vouchers.map(v => v.id === id ? { ...v, ...updated } : v)
    if (user) saveToCache(user.id, newActive, archivedVouchers)

    if (existing) {
      const keys = Object.keys(vData)
      // A balance change ALWAYS gets its own balance_update entry (with the used
      // amount and the store), even when other fields were edited in the same
      // save — previously any multi-field save silently dropped the store and
      // logged the usage as a generic "edit".
      const balanceChanged = 'balance' in vData && vData.balance !== existing.balance
      if (balanceChanged) {
        const from = existing.balance
        const to = vData.balance as number
        logAction('balance_update', existing.store_name, id, {
          from, to,
          used: Math.max(0, from - to),
          ...(storeUsed ? { store_used: storeUsed } : {}),
        })
      }
      const SENSITIVE = new Set(['code', 'cvv'])
      const changed: Record<string, unknown> = {}
      const exRec = existing as unknown as Record<string, unknown>
      const vdRec = vData as unknown as Record<string, unknown>
      keys
        .filter(k => !SENSITIVE.has(k) && k !== 'balance' && k !== 'updated_at')
        .filter(k => JSON.stringify(exRec[k]) !== JSON.stringify(vdRec[k]))
        .forEach(k => { changed[k] = { from: exRec[k], to: vdRec[k] } })
      if (Object.keys(changed).length > 0 || keys.some(k => SENSITIVE.has(k))) {
        if (keys.some(k => SENSITIVE.has(k))) changed['_sensitive_updated'] = true
        logAction('edit', existing.store_name, id, changed)
      }
    }
  }

  async function deleteVoucher(id: string) {
    const target = [...vouchers, ...archivedVouchers].find(v => v.id === id)
    const newActive = vouchers.filter(v => v.id !== id)
    const newArchived = archivedVouchers.filter(v => v.id !== id)
    setVouchers(newActive)
    setArchivedVouchers(newArchived)
    if (!id.startsWith('local-')) {
      if (!navigator.onLine) {
        if (!user) return
        enqueuePendingOp({ type: 'delete', id, voucherName: target?.store_name, balance: target?.balance }, user.id)
      } else {
        await supabase.from('vouchers').delete().eq('id', id)
      }
    }
    if (user) saveToCache(user.id, newActive, newArchived)
    if (target) logAction('delete', target.store_name, id, { balance: target.balance })
  }

  async function archiveVoucher(id: string, reason?: string) {
    const voucher = vouchers.find(v => v.id === id)
    if (!voucher) return
    const archiveReason = reason?.trim() || null
    const archived = { ...voucher, is_archived: true, archive_reason: archiveReason, updated_at: new Date().toISOString() }
    const newActive = vouchers.filter(v => v.id !== id)
    const newArchived = [...archivedVouchers, archived]
    setVouchers(newActive)
    setArchivedVouchers(newArchived)
    if (!id.startsWith('local-')) {
      if (!navigator.onLine) {
        if (!user) return
        enqueuePendingOp({ type: 'archive', id, voucherName: voucher.store_name, balance: voucher.balance }, user.id)
      } else {
        await supabase.from('vouchers').update({ is_archived: true, archive_reason: archiveReason }).eq('id', id)
      }
    }
    if (user) saveToCache(user.id, newActive, newArchived)
    logAction('archive', voucher.store_name, id, { balance: voucher.balance, reason: archiveReason })
  }

  async function unarchiveVoucher(id: string) {
    const voucher = archivedVouchers.find(v => v.id === id)
    if (!voucher) return
    const unarchived = { ...voucher, is_archived: false, updated_at: new Date().toISOString() }
    const newArchived = archivedVouchers.filter(v => v.id !== id)
    const newActive = [...vouchers, unarchived]
    setVouchers(newActive)
    setArchivedVouchers(newArchived)
    if (!id.startsWith('local-')) {
      if (!navigator.onLine) {
        if (!user) return
        enqueuePendingOp({ type: 'unarchive', id, voucherName: voucher.store_name, balance: voucher.balance }, user.id)
      } else {
        await supabase.from('vouchers').update({ is_archived: false }).eq('id', id)
      }
    }
    if (user) saveToCache(user.id, newActive, newArchived)
    logAction('unarchive', voucher.store_name, id)
  }

  async function archiveExpired() {
    const now = new Date()
    const expired = vouchers.filter(v => v.expiry_date && new Date(v.expiry_date) < now)
    if (expired.length === 0) return
    const ids = expired.map(v => v.id)
    const newActive = vouchers.filter(v => !ids.includes(v.id))
    const newArchived = [...archivedVouchers, ...expired.map(v => ({ ...v, is_archived: true }))]
    setVouchers(newActive)
    setArchivedVouchers(newArchived)
    await supabase.from('vouchers').update({ is_archived: true }).in('id', ids.filter(id => !id.startsWith('local-')))
    if (user) saveToCache(user.id, newActive, newArchived)
    for (const v of expired) {
      logAction('archive', v.store_name, v.id, { balance: v.balance })
    }
  }

  async function addStore(name: string): Promise<Store> {
    // Per-user stores: the RPC inserts the row owned by the calling user (or
    // returns an existing visible row with the same name), so one user's typos
    // no longer become suggestions for everyone. Falls back to the legacy
    // direct insert while supabase-user-stores.sql hasn't been applied yet.
    const { data, error } = await supabase.rpc('add_store', { p_name: name })
    if (!error && data) {
      const row = (Array.isArray(data) ? data[0] : data) as Store
      setStores(prev => (prev.some(s => s.id === row.id) ? prev : [...prev, row]))
      return row
    }
    if (error && /function|schema cache/i.test(error.message || '')) {
      const { data: legacy } = await supabase.from('stores').insert({ name }).select().single()
      if (legacy) {
        setStores(prev => [...prev, legacy])
        return legacy
      }
    }
    const fake: Store = { id: `local-${Date.now()}`, name }
    setStores(prev => [...prev, fake])
    return fake
  }

  async function addSuperVoucher(sv: Omit<SuperVoucher, 'id' | 'wallet_id' | 'created_at' | 'updated_at'>) {
    if (!walletId) return
    const { data } = await supabase.from('super_vouchers').insert({ ...sv, wallet_id: walletId }).select().single()
    if (data) setSuperVouchers(prev => [...prev, data])
  }

  async function updateSuperVoucher(id: string, data: Partial<SuperVoucher>) {
    await supabase.from('super_vouchers').update(data).eq('id', id)
    setSuperVouchers(prev => prev.map(sv => sv.id === id ? { ...sv, ...data } : sv))
  }

  async function deleteSuperVoucher(id: string) {
    await supabase.from('super_vouchers').delete().eq('id', id)
    setSuperVouchers(prev => prev.filter(sv => sv.id !== id))
  }

  async function addCategory(name: string, emoji = '🏷️') {
    if (!walletId) return
    const newCat: Category = { id: `cat-${Date.now()}`, name, emoji, wallet_id: walletId }
    await supabase.from('categories').insert({ ...newCat, wallet_id: walletId })
    setCategories(prev => [...prev, newCat])
  }

  async function inviteMember(email: string): Promise<'added' | 'not_found'> {
    if (!walletId) return 'not_found'
    const { data: rows } = await supabase.rpc('find_profile_by_email', { search_email: email })
    const profile = rows?.[0]
    if (!profile) return 'not_found'
    const { error } = await supabase.from('wallet_members').insert({
      wallet_id: walletId,
      user_id: profile.id,
      email,
      role: 'member',
    })
    if (error && error.code !== '23505') throw error
    sendInviteEmail({
      to_email: email,
      to_name: (profile as any).name || email,
      from_name: user?.email || 'מישהו',
      wallet_name: walletName,
    }).catch(() => {})
    return 'added'
  }

  async function removeMember(userId: string) {
    if (!walletId) return
    await supabase.from('wallet_members').delete().eq('wallet_id', walletId).eq('user_id', userId)
  }

  async function shareVoucherWithUser(voucherId: string, email: string): Promise<'shared' | 'already_shared' | 'not_found'> {
    assertNotGuest()
    const { data, error } = await supabase.rpc('share_voucher_with_email', {
      p_voucher_id: voucherId,
      p_email: email,
    })
    if (error) throw error
    const result = data as 'shared' | 'already_shared' | 'not_found'
    if (result === 'shared') {
      const voucher = vouchersRef.current.find(v => v.id === voucherId)
      setVouchers(prev => prev.map(v => v.id === voucherId ? { ...v, is_shared: true } : v))
      supabase.from('vouchers').update({ is_shared: true }).eq('id', voucherId).then(() => {})
      logAction('share_email', voucher?.store_name ?? 'שובר', voucherId, { recipient: email })
    }
    return result
  }

  async function getVoucherShares(voucherId: string): Promise<VoucherShare[]> {
    const { data } = await supabase.rpc('get_voucher_shares', { p_voucher_id: voucherId })
    return (data || []) as VoucherShare[]
  }

  async function unshareVoucher(voucherId: string, email: string) {
    await supabase.rpc('unshare_voucher', { p_voucher_id: voucherId, p_email: email })
    setSharedWithMe(prev => prev.filter(v => v.id !== voucherId))
    const voucher = vouchersRef.current.find(v => v.id === voucherId)
    logAction('unshare_email', voucher?.store_name ?? 'שובר', voucherId, { recipient: email })
    // If no more shares remain, clear the is_shared flag
    const remaining = await getVoucherShares(voucherId)
    if (remaining.length === 0) {
      setVouchers(prev => prev.map(v => v.id === voucherId ? { ...v, is_shared: false } : v))
      supabase.from('vouchers').update({ is_shared: false }).eq('id', voucherId).then(() => {})
    }
  }

  async function updateSharedVoucherBalance(voucherId: string, newBalance: number, storeUsed?: string | null) {
    const { error } = await supabase.rpc('update_shared_voucher_balance', {
      p_voucher_id: voucherId,
      p_new_balance: newBalance,
      ...(storeUsed ? { p_store_used: storeUsed } : {}),
    })
    if (error) throw error
    setSharedWithMe(prev => prev.map(v => v.id === voucherId ? { ...v, balance: newBalance } : v))
    // No client-side log entry: update_shared_voucher_balance now writes both the
    // owner's and the partner's activity_log rows server-side, with actor
    // attribution and the used amount. (The old client entry was also wrongly
    // labelled gift_balance_update for what is a share, not a gift.)
  }

  async function updateWalletName(name: string) {
    if (!walletId) return
    await supabase.from('wallets').update({ name }).eq('id', walletId)
    setWalletName(name)
  }

  async function refreshVouchers() {
    await fetchData()
  }

  // A guest-data merge finishes right AFTER a login's initial fetch — reload so
  // the merged vouchers appear without a manual refresh. The ref keeps the
  // LATEST closure: user and wallet change during the very login that fires this.
  const mergeRefreshRef = useRef<() => void>(() => {})
  mergeRefreshRef.current = () => { refreshVouchers().catch(() => {}) }
  useEffect(() => {
    const onMerge = () => mergeRefreshRef.current()
    window.addEventListener('gs-merge-completed', onMerge)
    return () => window.removeEventListener('gs-merge-completed', onMerge)
  }, [])

  // Sharing/gifting reach OTHER people — they need a real identity behind them.
  // One centralized gate (instead of scattered per-screen checks): guests get a
  // clear "connect an account first" error.
  function assertNotGuest() {
    if (user?.is_anonymous) {
      toast.error(translate('guest.requires.account'), { duration: 6000 })
      throw new Error('guest_account')
    }
  }

  async function createShareToken(voucherId: string, expiresInDays?: number, codeOverride?: string): Promise<string> {
    if (!user) throw new Error(translate('ctx.not.logged.in'))
    assertNotGuest()
    const token = Array.from(crypto.getRandomValues(new Uint8Array(24)))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('')
    const expires_at = expiresInDays
      ? new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000).toISOString()
      : null
    const row: Record<string, unknown> = {
      token,
      voucher_id: voucherId,
      created_by: user.id,
      expires_at,
    }
    if (codeOverride) row.code_override = codeOverride
    const { error } = await supabase.from('shared_voucher_tokens').insert(row)
    if (error) {
      if (error.code === '42P01' || error.message?.includes('schema cache')) throw new Error('TABLE_MISSING')
      throw new Error(error.message)
    }
    // Mark voucher as shared so it appears in the "shared" filter tab
    const voucher = vouchersRef.current.find(v => v.id === voucherId)
    if (voucher && !voucher.is_shared) {
      setVouchers(prev => prev.map(v => v.id === voucherId ? { ...v, is_shared: true } : v))
      supabase.from('vouchers').update({ is_shared: true }).eq('id', voucherId).then(() => {})
    }
    logAction('share_link', voucher?.store_name ?? 'שובר', voucherId, {
      expires_in_days: expiresInDays ?? null,
    })
    return token
  }

  async function deleteShareToken(token: string) {
    const { data } = await supabase
      .from('shared_voucher_tokens')
      .select('voucher_id')
      .eq('token', token)
      .maybeSingle()
    await supabase.from('shared_voucher_tokens').delete().eq('token', token)
    const voucher = vouchersRef.current.find(v => v.id === data?.voucher_id)
    logAction('share_link_deleted', voucher?.store_name ?? 'שובר', data?.voucher_id ?? undefined)
  }

  async function getShareTokens(voucherId: string) {
    const { data } = await supabase
      .from('shared_voucher_tokens')
      .select('token, expires_at, view_count, created_at')
      .eq('voucher_id', voucherId)
      .order('created_at', { ascending: false })
    return data || []
  }

  async function logAction(
    action: ActivityLogEntry['action'],
    voucherName: string,
    voucherId?: string,
    details: Record<string, any> = {}
  ) {
    if (!user) return
    // voucher_id is a UUID column — offline "local-…" ids would make the whole
    // insert silently fail, which is how entries used to go missing.
    const safeVoucherId = voucherId && !voucherId.startsWith('local-') ? voucherId : null
    // Fire and forget — don't block the main operation on logging
    Promise.resolve(supabase.from('activity_log').insert({
      user_id: user.id,
      wallet_id: walletIdRef.current,
      action,
      voucher_id: safeVoucherId,
      voucher_name: voucherName,
      details,
    })).then(() => {}).catch(() => {})
  }

  async function getActivityLog(limit = 100): Promise<ActivityLogEntry[]> {
    const { data } = await supabase
      .from('activity_log')
      .select('id, action, voucher_id, voucher_name, details, created_at')
      .eq('user_id', user?.id ?? '')
      .order('created_at', { ascending: false })
      .limit(limit)
    return (data || []) as ActivityLogEntry[]
  }

  async function getVoucherActivityLog(voucherId: string): Promise<ActivityLogEntry[]> {
    const { data } = await supabase
      .from('activity_log')
      .select('id, action, voucher_id, voucher_name, details, created_at')
      .eq('user_id', user?.id ?? '')
      .eq('voucher_id', voucherId)
      .order('created_at', { ascending: true })
    return (data || []) as ActivityLogEntry[]
  }

  // ── Gift sending ────────────────────────────────────────────────────────────

  async function createGift(voucherId: string, recipientEmail: string | null, message: string, sendAt: Date, codeOverride?: string): Promise<string | null> {
    if (!user) return null
    assertNotGuest()
    const token = Array.from(crypto.getRandomValues(new Uint8Array(24)))
      .map(b => b.toString(16).padStart(2, '0')).join('')
    // Only pass send_at for scheduled (future) gifts; immediate gifts use the DB's DEFAULT NOW()
    // to avoid client/server clock skew causing the gift link to be inaccessible.
    const isScheduled = sendAt.getTime() > Date.now() + 30_000
    const { error } = await supabase.from('voucher_gifts').insert({
      voucher_id: voucherId,
      sender_user_id: user.id,
      sender_name: user.user_metadata?.name || user.email || '',
      // Use empty string fallback so NOT NULL constraint doesn't block link-only gifts
      recipient_email: recipientEmail || '',
      message: message || null,
      token,
      // E2EE vouchers: the vault-decrypted code travels on the gift row, mirroring
      // shared_voucher_tokens.code_override. Without it the recipient would receive
      // ciphertext encrypted with the sender's key — unusable, not just unreadable.
      ...(codeOverride ? { code_override: codeOverride } : {}),
      ...(isScheduled ? { send_at: sendAt.toISOString() } : {}),
    })
    if (error) { console.error('createGift error:', error); return null }

    // Log the gift action
    const voucherName = [...vouchers, ...archivedVouchers].find(v => v.id === voucherId)?.store_name || ''
    if (recipientEmail) {
      logAction('gift_sent', voucherName, voucherId, { recipient: recipientEmail, message: message || undefined })
    } else {
      logAction('gift_link', voucherName, voucherId, { message: message || undefined })
    }
    return token
  }

  async function cancelGift(giftId: string): Promise<void> {
    const { data } = await supabase
      .from('voucher_gifts')
      .select('voucher_id, recipient_email')
      .eq('id', giftId)
      .maybeSingle()
    await supabase.from('voucher_gifts').delete().eq('id', giftId)
    const voucher = vouchersRef.current.find(v => v.id === data?.voucher_id)
    logAction('gift_cancelled', voucher?.store_name ?? 'שובר', data?.voucher_id ?? undefined, {
      ...(data?.recipient_email ? { recipient: data.recipient_email } : {}),
    })
  }

  async function getPendingGifts(voucherId: string): Promise<PendingGift[]> {
    const { data } = await supabase
      .from('voucher_gifts')
      .select('id, recipient_email, message, send_at, email_sent_at, created_at')
      .eq('voucher_id', voucherId)
      .is('claimed_at', null)
      .order('created_at', { ascending: false })
    return data ?? []
  }

  return (
    <VoucherContext.Provider value={{
      vouchers, archivedVouchers, superVouchers, categories, stores, sharedWithMe,
      walletId, walletName, walletError, loading, isOnline,
      pendingOpsCount: pendingOps.length + vouchers.filter(v => v.id.startsWith('local-')).length,
      addVoucher, updateVoucher, deleteVoucher, archiveVoucher, unarchiveVoucher,
      archiveExpired, syncToCloud, addStore, addSuperVoucher, updateSuperVoucher,
      deleteSuperVoucher, addCategory, inviteMember, removeMember,
      updateWalletName, refreshVouchers, createShareToken, deleteShareToken, getShareTokens,
      shareVoucherWithUser, getVoucherShares, unshareVoucher, updateSharedVoucherBalance,
      getActivityLog, getVoucherActivityLog, logAction,
      createGift, cancelGift, getPendingGifts,
    }}>
      {children}
    </VoucherContext.Provider>
  )
}

export function useVouchers() {
  const ctx = useContext(VoucherContext)
  if (!ctx) throw new Error('useVouchers must be used within VoucherProvider')
  return ctx
}
