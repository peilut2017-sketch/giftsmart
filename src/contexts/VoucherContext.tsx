import { createContext, useContext, useEffect, useState, useCallback, useRef, type ReactNode } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from './AuthContext'
import type { Voucher, SuperVoucher, Category, Store } from '../types'
import { DEFAULT_CATEGORIES } from '../types'

interface VoucherContextType {
  vouchers: Voucher[]
  archivedVouchers: Voucher[]
  superVouchers: SuperVoucher[]
  categories: Category[]
  stores: Store[]
  walletId: string | null
  walletName: string
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
}

const VoucherContext = createContext<VoucherContextType | undefined>(undefined)

const CACHE_KEY = 'vouchers_cache'
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

  const loadFromCache = useCallback(() => {
    try {
      const cached = localStorage.getItem(CACHE_KEY)
      if (cached) {
        const data = JSON.parse(cached)
        setVouchers(data.active || [])
        setArchivedVouchers(data.archived || [])
      }
    } catch {}
  }, [])

  const saveToCache = useCallback((active: Voucher[], archived: Voucher[]) => {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({ active, archived }))
    } catch {}
  }, [])

  const fetchData = useCallback(async () => {
    if (!user) {
      setLoading(false)
      return
    }

    // Show cache immediately so the UI is never blank/stuck
    loadFromCache()
    setLoading(false)

    if (!navigator.onLine) return

    try {
      let wId: string

      // If we already know the wallet, skip the lookup to avoid RLS recursion issues
      if (walletIdRef.current) {
        wId = walletIdRef.current
      } else {
        // Get or create wallet — wrapped in timeout so a hung query never freezes the app
        type MembershipResult = { data: { wallet_id: string; wallets: any } | null }
        const { data: membership } = await withTimeout<MembershipResult>(
          supabase
            .from('wallet_members')
            .select('wallet_id, wallets(id, name)')
            .eq('user_id', user.id)
            .order('created_at')
            .limit(1)
            .single() as any
        ).catch(() => ({ data: null } as MembershipResult))

        if (!membership) {
          // Create new wallet
          const { data: wallet } = await withTimeout<{ data: any }>(
            supabase.from('wallets').insert({ name: 'ארנק השוברים שלי', owner_id: user.id }).select().single() as any
          ).catch(() => ({ data: null }))
          if (!wallet) return
          wId = wallet.id
          setWalletName(wallet.name)
          await (supabase.from('wallet_members').insert({
            wallet_id: wId,
            user_id: user.id,
            email: user.email,
            role: 'owner',
          }) as any as Promise<any>).catch(() => {})
        } else {
          wId = membership.wallet_id
          const walletData = membership.wallets as any
          if (walletData?.name) setWalletName(walletData.name)
        }

        walletIdRef.current = wId
        setWalletId(wId)
      }

      // Fetch all data in parallel for speed
      type QueryResult = { data: any[] | null }
      const [vRes, svRes, storeRes, catRes] = await Promise.allSettled([
        withTimeout<QueryResult>(supabase.from('vouchers').select('*').eq('wallet_id', wId).order('expiry_date', { ascending: true }) as any),
        withTimeout<QueryResult>(supabase.from('super_vouchers').select('*').eq('wallet_id', wId) as any),
        withTimeout<QueryResult>(supabase.from('stores').select('*').order('name') as any),
        withTimeout<QueryResult>(supabase.from('categories').select('*').or(`wallet_id.eq.${wId},wallet_id.is.null`) as any),
      ])

      if (vRes.status === 'fulfilled' && vRes.value.data) {
        const active = vRes.value.data.filter((v: any) => !v.is_archived)
        const archived = vRes.value.data.filter((v: any) => v.is_archived)
        setVouchers(active)
        setArchivedVouchers(archived)
        saveToCache(active, archived)
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
    if (!wId || !navigator.onLine) return
    try {
      type QueryResult = { data: any[] | null }
      const { data: vData } = await withTimeout<QueryResult>(
        supabase.from('vouchers').select('*').eq('wallet_id', wId).order('expiry_date', { ascending: true }) as any
      ).catch(() => ({ data: null }))
      if (vData) {
        const active = vData.filter((v: any) => !v.is_archived)
        const archived = vData.filter((v: any) => v.is_archived)
        setVouchers(active)
        setArchivedVouchers(archived)
        saveToCache(active, archived)
      }
    } catch (err) {
      console.error('Refresh error:', err)
    }
  }, [saveToCache])

  useEffect(() => {
    if (user) {
      fetchData()
    } else {
      walletIdRef.current = null
      setVouchers([])
      setArchivedVouchers([])
      setWalletId(null)
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
      sv.stores.some(s => s.toLowerCase() === v.store_name.toLowerCase()) ||
      sv.name.toLowerCase() === v.store_name.toLowerCase()
    )
    if (matchingSV) superVoucherId = matchingSV.id

    const payload = {
      ...v,
      user_id: user.id,
      wallet_id: walletId,
      super_voucher_id: superVoucherId,
    }

    const { data, error } = await supabase.from('vouchers').insert(payload).select().single()
    if (error) {
      console.error('Add voucher error:', error)
      throw new Error(error.message)
    }

    const newActive = [...vouchers, data]
    setVouchers(newActive)
    saveToCache(newActive, archivedVouchers)
    return data
  }

  async function updateVoucher(id: string, vData: Partial<Voucher>) {
    if (!isOnline && vouchers.find(v => v.id.startsWith('local-'))) {
      throw new Error('אין חיבור לאינטרנט')
    }
    const updated = { ...vData, updated_at: new Date().toISOString() }
    setVouchers(prev => prev.map(v => v.id === id ? { ...v, ...updated } : v))

    if (!id.startsWith('local-')) {
      await supabase.from('vouchers').update(updated).eq('id', id)
    }
    const newActive = vouchers.map(v => v.id === id ? { ...v, ...updated } : v)
    saveToCache(newActive, archivedVouchers)
  }

  async function deleteVoucher(id: string) {
    setVouchers(prev => prev.filter(v => v.id !== id))
    setArchivedVouchers(prev => prev.filter(v => v.id !== id))
    if (!id.startsWith('local-')) {
      await supabase.from('vouchers').delete().eq('id', id)
    }
    const newActive = vouchers.filter(v => v.id !== id)
    saveToCache(newActive, archivedVouchers.filter(v => v.id !== id))
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
    saveToCache(newActive, newArchived)
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
    saveToCache(newActive, newArchived)
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
    saveToCache(newActive, newArchived)
  }

  async function syncToCloud() {
    if (!user || !walletId) return
    const localVouchers = vouchers.filter(v => v.id.startsWith('local-'))
    for (const v of localVouchers) {
      const { id, ...rest } = v
      const { data } = await supabase.from('vouchers').insert({ ...rest, user_id: user.id, wallet_id: walletId }).select().single()
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
    // Find user by email
    const { data: profile } = await supabase
      .from('profiles')
      .select('id')
      .eq('email', email)
      .single()
    if (!profile) throw new Error('משתמש לא נמצא')
    await supabase.from('wallet_members').insert({
      wallet_id: walletId,
      user_id: profile.id,
      email,
      role: 'member',
    })
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

  return (
    <VoucherContext.Provider value={{
      vouchers, archivedVouchers, superVouchers, categories, stores,
      walletId, walletName, loading, isOnline,
      addVoucher, updateVoucher, deleteVoucher, archiveVoucher, unarchiveVoucher,
      archiveExpired, syncToCloud, addStore, addSuperVoucher, updateSuperVoucher,
      deleteSuperVoucher, addCategory, inviteMember, removeMember,
      updateWalletName, refreshVouchers,
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
