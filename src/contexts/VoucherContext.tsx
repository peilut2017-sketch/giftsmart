import { createContext, useContext, useEffect, useState, useCallback, useRef, type ReactNode } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from './AuthContext'
import type { Voucher, SuperVoucher, Category, Store } from '../types'
import { DEFAULT_CATEGORIES } from '../types'
import { sendInviteEmail } from '../lib/emailService'

interface VoucherContextType {
  vouchers: Voucher[]
  archivedVouchers: Voucher[]
  superVouchers: SuperVoucher[]
  categories: Category[]
  stores: Store[]
  walletId: string | null
  walletName: string
  walletError: string | null
  loading: boolean
  isOnline: boolean
  addVoucher: (v: Omit<Voucher, 'id' | 'user_id' | 'wallet_id' | 'created_at' | 'updated_at'>) => Promise<Voucher | null>
  updateVoucher: (id: string, data: Partial<Voucher>) => Promise<void>
  deleteVoucher: (id: string) => Promise<void>
  archiveVoucher: (id: string) => Promise<void>
  unarchiveVoucher: (id: string) => Promise<void>
  archiveExpired: () => Promise<void>
  syncToCloud: () => Promise<void>
  addStore: (name: string) => Promise<Store>
  addSuperVoucher: (sv: Omit<SuperVoucher, 'id' | 'wallet_id' | 'created_at' | 'updated_at'>) => Promise<void>
  updateSuperVoucher: (id: string, data: Partial<SuperVoucher>) => Promise<void>
  deleteSuperVoucher: (id: string) => Promise<void>
  addCategory: (name: string, emoji?: string) => Promise<void>
  inviteMember: (email: string) => Promise<void>
  removeMember: (userId: string) => Promise<void>
  updateWalletName: (name: string) => Promise<void>
  refreshVouchers: () => Promise<void>
  createShareToken: (voucherId: string, expiresInDays?: number) => Promise<string>
  deleteShareToken: (token: string) => Promise<void>
  getShareTokens: (voucherId: string) => Promise<Array<{ token: string; expires_at: string | null; view_count: number; created_at: string }>>
  getActivityLog: (limit?: number) => Promise<ActivityLogEntry[]>
  getVoucherActivityLog: (voucherId: string) => Promise<ActivityLogEntry[]>
}

export interface ActivityLogEntry {
  id: string
  action: 'add' | 'edit' | 'balance_update' | 'archive' | 'unarchive' | 'delete'
  voucher_id: string | null
  voucher_name: string
  details: Record<string, any>
  created_at: string
}

const VoucherContext = createContext<VoucherContextType | undefined>(undefined)

const CACHE_KEY_PREFIX = 'vouchers_cache_'
const VOUCHERS_VIEW = 'vouchers'
const QUERY_TIMEOUT_MS = 8000

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
  const [walletId, setWalletId] = useState<string | null>(null)
  const walletIdRef = useRef<string | null>(null)
  const [walletName, setWalletName] = useState('ארנק השוברים שלי')
  const [walletError, setWalletError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [isOnline, setIsOnline] = useState(navigator.onLine)

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

  const fetchData = useCallback(async () => {
    if (!user) {
      setLoading(false)
      return
    }

    // Show cache immediately so the UI is never blank/stuck
    loadFromCache(user.id)
    setLoading(false)

    if (!navigator.onLine) return

    try {
      let wId: string

      // If we already know the wallet, skip the lookup
      if (walletIdRef.current) {
        wId = walletIdRef.current
      } else {
        // Use a SECURITY DEFINER RPC that atomically gets-or-creates the wallet
        // and the wallet_members row, bypassing any RLS issues entirely.
        const { data: fetchedWalletId, error: walletError } = await withTimeout<{ data: string | null; error: any }>(
          supabase.rpc('get_or_create_user_wallet') as any
        ).catch(() => ({ data: null, error: new Error('timeout') }))

        if (walletError || !fetchedWalletId) {
          console.error('Wallet setup failed:', walletError)
          const msg = walletError?.message || ''
          if (msg.includes('does not exist') || msg.includes('42883')) {
            setWalletError('הגדרת הארנק חסרה — יש להריץ את supabase-wallet-setup.sql ב-Supabase')
          } else if (msg === 'timeout') {
            setWalletError('תם הזמן בחיבור ל-Supabase — בדוק את ה-URL/KEY ב-env')
          } else {
            setWalletError('שגיאה בטעינת הארנק: ' + (msg || 'לא ידוע'))
          }
          return
        }
        wId = fetchedWalletId

        // Fetch wallet name (best-effort; owner can always SELECT their own wallet)
        const { data: walletRow } = await (supabase.from('wallets').select('name').eq('id', wId).single() as any).catch(() => ({ data: null }))
        if (walletRow?.name) setWalletName(walletRow.name)

        walletIdRef.current = wId
        setWalletId(wId)
      }

      // Fetch all data in parallel for speed
      type QueryResult = { data: any[] | null }
      const [vRes, svRes, storeRes, catRes] = await Promise.allSettled([
        withTimeout<QueryResult>(supabase.from(VOUCHERS_VIEW).select('*').eq('wallet_id', wId).order('expiry_date', { ascending: true }) as any),
        withTimeout<QueryResult>(
          supabase.from('super_vouchers').select('*').or(`wallet_id.eq.${wId},is_global.eq.true`).then(res => {
            // Fallback: if is_global column doesn't exist yet, fetch only wallet SVs
            if (res.error?.code === '42703') {
              return supabase.from('super_vouchers').select('*').eq('wallet_id', wId)
            }
            return res
          }) as any
        ),
        withTimeout<QueryResult>(supabase.from('stores').select('*').order('name') as any),
        withTimeout<QueryResult>(supabase.from('categories').select('*').or(`wallet_id.eq.${wId},wallet_id.is.null`) as any),
      ])

      if (vRes.status === 'fulfilled' && vRes.value.data) {
        const active = vRes.value.data.filter((v: any) => !v.is_archived)
        const archived = vRes.value.data.filter((v: any) => v.is_archived)
        setVouchers(active)
        setArchivedVouchers(archived)
        saveToCache(user.id, active, archived)
      }
      if (svRes.status === 'fulfilled' && svRes.value.data) setSuperVouchers(svRes.value.data)
      if (storeRes.status === 'fulfilled' && storeRes.value.data) setStores(storeRes.value.data)
      if (catRes.status === 'fulfilled' && catRes.value.data && catRes.value.data.length > 0) {
        const customCats = catRes.value.data.filter((c: any) => c.wallet_id === wId)
        setCategories([...DEFAULT_CATEGORIES, ...customCats])
      }

    } catch (err) {
      console.error('Fetch error:', err)
    }
  }, [user, loadFromCache, saveToCache])

  // Lightweight refresh: only re-fetches vouchers using the already-known walletId.
  // Used by the realtime subscription so we never re-query wallet_members after each action.
  const refreshVouchersOnly = useCallback(async () => {
    const wId = walletIdRef.current
    if (!wId || !navigator.onLine || !user) return
    try {
      type QueryResult = { data: any[] | null }
      const { data: vData } = await withTimeout<QueryResult>(
        supabase.from(VOUCHERS_VIEW).select('*').eq('wallet_id', wId).order('expiry_date', { ascending: true }) as any
      ).catch(() => ({ data: null }))
      if (vData) {
        const active = vData.filter((v: any) => !v.is_archived)
        const archived = vData.filter((v: any) => v.is_archived)
        setVouchers(active)
        setArchivedVouchers(archived)
        saveToCache(user.id, active, archived)
      }
    } catch (err) {
      console.error('Refresh error:', err)
    }
  }, [user, saveToCache])

  useEffect(() => {
    if (user) {
      // Reset all state before fetching for the new user to avoid showing stale data
      setVouchers([])
      setArchivedVouchers([])
      setSuperVouchers([])
      setCategories(DEFAULT_CATEGORIES)
      setStores([])
      setWalletId(null)
      walletIdRef.current = null
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

  // Realtime subscription — uses lightweight refresh to avoid re-querying wallet_members
  useEffect(() => {
    if (!walletId || !user) return
    const channel = supabase
      .channel(`wallet-${walletId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'vouchers',
        filter: `wallet_id=eq.${walletId}`,
      }, () => {
        refreshVouchersOnly()
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [walletId, user, refreshVouchersOnly])

  async function addVoucher(v: Omit<Voucher, 'id' | 'user_id' | 'wallet_id' | 'created_at' | 'updated_at'>): Promise<Voucher | null> {
    if (!user || !walletId) throw new Error('נתוני משתמש לא נטענו, נסה שוב')

    // Check for super voucher match
    let superVoucherId: string | undefined
    const matchingSV = superVouchers.find(sv =>
      sv.name.toLowerCase() === v.store_name.toLowerCase()
    )
    if (matchingSV) superVoucherId = matchingSV.id

    const payload: Record<string, any> = {
      ...v,
      user_id: user.id,
      wallet_id: walletId,
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
        throw new Error('הארנק אופס — הרענן ונסה שוב')
      }
      throw new Error(error.message)
    }

    const newActive = [...vouchers, data]
    setVouchers(newActive)
    if (user) saveToCache(user.id, newActive, archivedVouchers)
    logAction('add', data.store_name, data.id, { amount: data.amount, balance: data.balance })
    return data
  }

  async function updateVoucher(id: string, vData: Partial<Voucher>) {
    if (!isOnline && vouchers.find(v => v.id.startsWith('local-'))) {
      throw new Error('אין חיבור לאינטרנט')
    }
    const existing = [...vouchers, ...archivedVouchers].find(v => v.id === id)
    const updated = { ...vData, updated_at: new Date().toISOString() }
    setVouchers(prev => prev.map(v => v.id === id ? { ...v, ...updated } : v))

    if (!id.startsWith('local-')) {
      // Update through the view so pgsodium re-encrypts code/cvv if they changed
      await supabase.from(VOUCHERS_VIEW).update(updated).eq('id', id)
    }
    const newActive = vouchers.map(v => v.id === id ? { ...v, ...updated } : v)
    if (user) saveToCache(user.id, newActive, archivedVouchers)

    if (existing) {
      const keys = Object.keys(vData)
      if (keys.length === 1 && keys[0] === 'balance') {
        logAction('balance_update', existing.store_name, id, {
          from: existing.balance, to: vData.balance,
        })
      } else {
        const changed: Record<string, any> = {}
        keys.forEach(k => { changed[k] = { from: (existing as any)[k], to: (vData as any)[k] } })
        logAction('edit', existing.store_name, id, changed)
      }
    }
  }

  async function deleteVoucher(id: string) {
    const target = [...vouchers, ...archivedVouchers].find(v => v.id === id)
    setVouchers(prev => prev.filter(v => v.id !== id))
    setArchivedVouchers(prev => prev.filter(v => v.id !== id))
    if (!id.startsWith('local-')) {
      await supabase.from('vouchers').delete().eq('id', id)
    }
    const newActive = vouchers.filter(v => v.id !== id)
    if (user) saveToCache(user.id, newActive, archivedVouchers.filter(v => v.id !== id))
    if (target) logAction('delete', target.store_name, id, { balance: target.balance })
  }

  async function archiveVoucher(id: string) {
    const voucher = vouchers.find(v => v.id === id)
    if (!voucher) return
    const archived = { ...voucher, is_archived: true, updated_at: new Date().toISOString() }
    const newActive = vouchers.filter(v => v.id !== id)
    const newArchived = [...archivedVouchers, archived]
    setVouchers(newActive)
    setArchivedVouchers(newArchived)
    if (!id.startsWith('local-')) {
      await supabase.from('vouchers').update({ is_archived: true }).eq('id', id)
    }
    if (user) saveToCache(user.id, newActive, newArchived)
    logAction('archive', voucher.store_name, id, { balance: voucher.balance })
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
      await supabase.from('vouchers').update({ is_archived: false }).eq('id', id)
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
  }

  async function syncToCloud() {
    if (!user || !walletId) return
    const localVouchers = vouchers.filter(v => v.id.startsWith('local-'))
    for (const v of localVouchers) {
      const { id, ...rest } = v
      const { data } = await supabase.from(VOUCHERS_VIEW).insert({ ...rest, user_id: user.id, wallet_id: walletId }).select().single()
      if (data) {
        setVouchers(prev => prev.map(pv => pv.id === id ? data : pv))
      }
    }
  }

  async function addStore(name: string): Promise<Store> {
    const { data } = await supabase.from('stores').insert({ name }).select().single()
    if (data) {
      setStores(prev => [...prev, data])
      return data
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

  async function inviteMember(email: string) {
    if (!walletId) return
    // Use a SECURITY DEFINER RPC to look up the profile — direct SELECT on profiles
    // is blocked by RLS for other users' rows.
    const { data: rows, error: rpcError } = await supabase
      .rpc('find_profile_by_email', { search_email: email })
    const profile = rows?.[0]
    if (rpcError || !profile) throw new Error('משתמש לא נמצא')
    await supabase.from('wallet_members').insert({
      wallet_id: walletId,
      user_id: profile.id,
      email,
      role: 'member',
    })
    // Send invitation email (non-blocking — failure doesn't break the invite)
    sendInviteEmail({
      to_email: email,
      to_name: (profile as any).name || email,
      from_name: user?.email || 'מישהו',
      wallet_name: walletName,
    }).catch(() => {})
  }

  async function removeMember(userId: string) {
    if (!walletId) return
    await supabase.from('wallet_members').delete().eq('wallet_id', walletId).eq('user_id', userId)
  }

  async function updateWalletName(name: string) {
    if (!walletId) return
    await supabase.from('wallets').update({ name }).eq('id', walletId)
    setWalletName(name)
  }

  async function refreshVouchers() {
    await fetchData()
  }

  async function createShareToken(voucherId: string, expiresInDays?: number): Promise<string> {
    if (!user) throw new Error('לא מחובר')
    const token = Array.from(crypto.getRandomValues(new Uint8Array(18)))
      .map(b => b.toString(36).padStart(2, '0'))
      .join('')
      .slice(0, 24)
    const expires_at = expiresInDays
      ? new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000).toISOString()
      : null
    const { error } = await supabase.from('shared_voucher_tokens').insert({
      token,
      voucher_id: voucherId,
      created_by: user.id,
      expires_at,
    })
    if (error) {
      if (error.code === '42P01' || error.message?.includes('schema cache')) throw new Error('TABLE_MISSING')
      throw new Error(error.message)
    }
    return token
  }

  async function deleteShareToken(token: string) {
    await supabase.from('shared_voucher_tokens').delete().eq('token', token)
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
    // Fire and forget — don't block the main operation on logging
    Promise.resolve(supabase.from('activity_log').insert({
      user_id: user.id,
      wallet_id: walletIdRef.current,
      action,
      voucher_id: voucherId || null,
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

  return (
    <VoucherContext.Provider value={{
      vouchers, archivedVouchers, superVouchers, categories, stores,
      walletId, walletName, walletError, loading, isOnline,
      addVoucher, updateVoucher, deleteVoucher, archiveVoucher, unarchiveVoucher,
      archiveExpired, syncToCloud, addStore, addSuperVoucher, updateSuperVoucher,
      deleteSuperVoucher, addCategory, inviteMember, removeMember,
      updateWalletName, refreshVouchers, createShareToken, deleteShareToken, getShareTokens,
      getActivityLog, getVoucherActivityLog,
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
