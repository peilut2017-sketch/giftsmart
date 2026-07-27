import { createContext, useContext, useState, useCallback, useRef } from 'react'
import type { ReactNode } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from './AuthContext'
import type { DiscountClub, DiscountDeal } from '../types'
import toast from 'react-hot-toast'

const CACHE_TTL_MS = 5 * 60_000 // 5 minutes

interface DiscountsContextValue {
  // Data
  deals: DiscountDeal[]
  recentDeals: DiscountDeal[]
  clubs: DiscountClub[]
  userClubIds: string[]
  likedDealIds: Set<string>
  loading: boolean

  // Filters
  searchQuery: string
  activeTags: string[]
  myOnly: boolean

  // Actions
  fetchDeals: (search?: string, tags?: string[], myOnly?: boolean) => Promise<void>
  fetchRecentDeals: () => Promise<void>
  fetchClubs: () => Promise<void>
  setUserClubs: (clubIds: string[]) => Promise<void>
  setSearchQuery: (q: string) => void
  setActiveTags: (tags: string[]) => void
  setMyOnly: (v: boolean) => void
  copyPromoCode: (code: string) => void
  incrementDealViewCount: (dealId: string) => void
  toggleLike: (dealId: string) => Promise<void>
}

const DiscountsContext = createContext<DiscountsContextValue | null>(null)

export function useDiscounts() {
  const ctx = useContext(DiscountsContext)
  if (!ctx) throw new Error('useDiscounts must be used within DiscountsProvider')
  return ctx
}

export function DiscountsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()

  const [deals, setDeals] = useState<DiscountDeal[]>([])
  const [recentDeals, setRecentDeals] = useState<DiscountDeal[]>([])
  const [clubs, setClubs] = useState<DiscountClub[]>([])
  const [userClubIds, setUserClubIds] = useState<string[]>([])
  const [likedDealIds, setLikedDealIds] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(false)

  const [searchQuery, setSearchQuery] = useState('')
  const [activeTags, setActiveTags] = useState<string[]>([])
  const [myOnly, setMyOnly] = useState(false)

  const fetchedAt = useRef<{ deals: number; clubs: number; likes: number; recentDeals: number }>({ deals: 0, clubs: 0, likes: 0, recentDeals: 0 })

  const fetchLikedDeals = useCallback(async () => {
    if (!user) return
    const now = Date.now()
    if (fetchedAt.current.likes && now - fetchedAt.current.likes < CACHE_TTL_MS) return
    try {
      const { data } = await supabase.rpc('get_my_liked_deals')
      if (data) {
        setLikedDealIds(new Set((data as { deal_id: string }[]).map(r => r.deal_id)))
        fetchedAt.current.likes = Date.now()
      }
    } catch (err) {
      console.error('[discounts] fetchLikedDeals error', err)
    }
  }, [user])

  const fetchClubs = useCallback(async () => {
    const now = Date.now()
    if (fetchedAt.current.clubs && now - fetchedAt.current.clubs < CACHE_TTL_MS) return
    try {
      const { data, error } = await supabase
        .from('discount_clubs')
        .select('*')
        .eq('is_active', true)
        .order('type')
        .order('name')
      if (error) throw error
      setClubs((data as DiscountClub[]) || [])
      fetchedAt.current.clubs = Date.now()

      if (user) {
        const { data: uc } = await supabase
          .from('user_clubs')
          .select('club_id')
          .eq('user_id', user.id)
        setUserClubIds((uc || []).map((r: { club_id: string }) => r.club_id))
      }
    } catch (err) {
      console.error('[discounts] fetchClubs error', err)
    }
  }, [user])

  const fetchDeals = useCallback(async (
    search?: string,
    tags?: string[],
    onlyMine?: boolean,
  ) => {
    const isDefault = !search && (!tags || tags.length === 0)
    const now = Date.now()
    if (isDefault && fetchedAt.current.deals && now - fetchedAt.current.deals < CACHE_TTL_MS) return

    setLoading(true)
    try {
      const [dealsResult] = await Promise.all([
        supabase.rpc('get_my_deals', {
          p_search: search || null,
          p_tags: tags && tags.length > 0 ? tags : null,
          p_limit: 100,
          p_offset: 0,
        }),
        fetchLikedDeals(),
      ])

      const { data, error } = dealsResult
      if (error) throw error
      let all = (data as DiscountDeal[]) || []

      // Merge real view_count from DB
      if (all.length > 0) {
        const { data: vcData } = await supabase
          .from('discount_deals')
          .select('id, view_count')
          .in('id', all.map(d => d.deal_id))
        if (vcData) {
          const vcMap = new Map<string, number>(
            vcData.map((r: { id: string; view_count: number }) => [r.id, r.view_count ?? 0])
          )
          all = all.map(d => ({ ...d, view_count: vcMap.get(d.deal_id) ?? d.view_count ?? 0 }))
        }
      }

      setDeals(onlyMine ? all.filter(d => d.is_my_club) : all)
      if (isDefault) fetchedAt.current.deals = Date.now()
    } catch (err) {
      console.error('[discounts] fetchDeals error', err)
    } finally {
      setLoading(false)
    }
  }, [fetchLikedDeals])

  // Home page "recent discounts" widget — newest-created deals, independent of the
  // best-match ordering fetchDeals() uses for the full Discounts page.
  const fetchRecentDeals = useCallback(async () => {
    const now = Date.now()
    if (fetchedAt.current.recentDeals && now - fetchedAt.current.recentDeals < CACHE_TTL_MS) return
    try {
      const [{ data, error }] = await Promise.all([
        supabase.rpc('get_recent_deals', { p_limit: 3 }),
        fetchLikedDeals(),
      ])
      if (error) throw error
      setRecentDeals((data as DiscountDeal[]) || [])
      fetchedAt.current.recentDeals = Date.now()
    } catch (err) {
      console.error('[discounts] fetchRecentDeals error', err)
    }
  }, [fetchLikedDeals])

  const setUserClubs = useCallback(async (clubIds: string[]) => {
    if (!user) return
    try {
      const { error } = await supabase.rpc('set_user_clubs', { p_club_ids: clubIds })
      if (error) throw error
      setUserClubIds(clubIds)
      fetchedAt.current.deals = 0
    } catch (err) {
      console.error('[discounts] setUserClubs error', err)
      throw err
    }
  }, [user])

  const copyPromoCode = useCallback((code: string) => {
    navigator.clipboard.writeText(code).then(() => {
      toast('הקוד הועתק! 📋', { duration: 2000 })
    }).catch(() => {
      toast.error('לא ניתן להעתיק')
    })
  }, [])

  const incrementDealViewCount = useCallback((dealId: string) => {
    supabase.rpc('increment_deal_view_count', { p_deal_id: dealId }).then(() => {})
    setDeals(prev => prev.map(d => d.deal_id === dealId ? { ...d, view_count: (d.view_count ?? 0) + 1 } : d))
  }, [])

  const toggleLike = useCallback(async (dealId: string) => {
    if (!user) return
    const isCurrentlyLiked = likedDealIds.has(dealId)

    // Optimistic update
    setLikedDealIds(prev => {
      const next = new Set(prev)
      if (isCurrentlyLiked) next.delete(dealId)
      else next.add(dealId)
      return next
    })

    try {
      await supabase.rpc('toggle_deal_like', { p_deal_id: dealId })
    } catch (err) {
      // Rollback on error
      setLikedDealIds(prev => {
        const next = new Set(prev)
        if (isCurrentlyLiked) next.add(dealId)
        else next.delete(dealId)
        return next
      })
      console.error('[discounts] toggleLike error', err)
    }
  }, [user, likedDealIds])

  return (
    <DiscountsContext.Provider value={{
      deals,
      recentDeals,
      clubs,
      userClubIds,
      likedDealIds,
      loading,
      searchQuery,
      activeTags,
      myOnly,
      fetchDeals,
      fetchRecentDeals,
      fetchClubs,
      setUserClubs,
      setSearchQuery,
      setActiveTags,
      setMyOnly,
      copyPromoCode,
      incrementDealViewCount,
      toggleLike,
    }}>
      {children}
    </DiscountsContext.Provider>
  )
}
