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
  clubs: DiscountClub[]
  userClubIds: string[]
  loading: boolean

  // Filters
  searchQuery: string
  activeTags: string[]
  myOnly: boolean

  // Actions
  fetchDeals: (search?: string, tags?: string[], myOnly?: boolean) => Promise<void>
  fetchClubs: () => Promise<void>
  setUserClubs: (clubIds: string[]) => Promise<void>
  setSearchQuery: (q: string) => void
  setActiveTags: (tags: string[]) => void
  setMyOnly: (v: boolean) => void
  copyPromoCode: (code: string) => void
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
  const [clubs, setClubs] = useState<DiscountClub[]>([])
  const [userClubIds, setUserClubIds] = useState<string[]>([])
  const [loading, setLoading] = useState(false)

  const [searchQuery, setSearchQuery] = useState('')
  const [activeTags, setActiveTags] = useState<string[]>([])
  const [myOnly, setMyOnly] = useState(false)

  const fetchedAt = useRef<{ deals: number; clubs: number }>({ deals: 0, clubs: 0 })

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

      // Load this user's saved clubs
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
      const { data, error } = await supabase.rpc('get_my_deals', {
        p_search: search || null,
        p_tags: tags && tags.length > 0 ? tags : null,
        p_limit: 100,
        p_offset: 0,
      })
      if (error) throw error
      const all = (data as DiscountDeal[]) || []
      setDeals(onlyMine ? all.filter(d => d.is_my_club) : all)
      if (isDefault) fetchedAt.current.deals = Date.now()
    } catch (err) {
      console.error('[discounts] fetchDeals error', err)
    } finally {
      setLoading(false)
    }
  }, [])

  const setUserClubs = useCallback(async (clubIds: string[]) => {
    if (!user) return
    try {
      const { error } = await supabase.rpc('set_user_clubs', { p_club_ids: clubIds })
      if (error) throw error
      setUserClubIds(clubIds)
      // Bust deals cache so is_my_club reflects the new selection
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

  return (
    <DiscountsContext.Provider value={{
      deals,
      clubs,
      userClubIds,
      loading,
      searchQuery,
      activeTags,
      myOnly,
      fetchDeals,
      fetchClubs,
      setUserClubs,
      setSearchQuery,
      setActiveTags,
      setMyOnly,
      copyPromoCode,
    }}>
      {children}
    </DiscountsContext.Provider>
  )
}
