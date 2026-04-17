import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import type { ReactNode } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from './AuthContext'
import type { MarketplaceListing, MarketplacePurchase, MarketplaceMessage } from '../types'
import toast from 'react-hot-toast'

interface MarketplaceContextValue {
  // Data
  listings: MarketplaceListing[]
  myListings: MarketplaceListing[]
  myPurchases: MarketplacePurchase[]
  loadingListings: boolean
  loadingMyListings: boolean
  loadingMyPurchases: boolean

  // Marketplace actions
  fetchListings: (search?: string, minBalance?: number, maxPrice?: number) => Promise<void>
  fetchMyListings: () => Promise<void>
  fetchMyPurchases: () => Promise<void>
  listForSale: (voucherId: string, askingPrice: number, description?: string) => Promise<MarketplaceListing>
  removeFromSale: (listingId: string) => Promise<void>
  confirmPaymentSent: (listingId: string, paymentMethod: string) => Promise<void>
  confirmPaymentReceived: (purchaseId: string) => Promise<void>
  cancelPurchase: (purchaseId: string) => Promise<void>
  rateUser: (purchaseId: string, ratedUserId: string, rating: number, comment?: string) => Promise<void>
  reportUser: (reportedUserId: string, reason: string, details?: string, purchaseId?: string, listingId?: string) => Promise<void>

  // Chat
  chatMessages: Record<string, MarketplaceMessage[]>   // key = "listingId:buyerId"
  fetchChatMessages: (listingId: string, buyerId?: string) => Promise<void>
  sendChatMessage: (listingId: string, message: string, buyerId?: string) => Promise<void>
  updateListingPrice: (listingId: string, newPrice: number) => Promise<void>
}

const MarketplaceContext = createContext<MarketplaceContextValue | null>(null)

export function useMarketplace() {
  const ctx = useContext(MarketplaceContext)
  if (!ctx) throw new Error('useMarketplace must be used within MarketplaceProvider')
  return ctx
}

export function MarketplaceProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const [listings, setListings] = useState<MarketplaceListing[]>([])
  const [myListings, setMyListings] = useState<MarketplaceListing[]>([])
  const [myPurchases, setMyPurchases] = useState<MarketplacePurchase[]>([])
  const [loadingListings, setLoadingListings] = useState(false)
  const [loadingMyListings, setLoadingMyListings] = useState(false)
  const [loadingMyPurchases, setLoadingMyPurchases] = useState(false)
  const [chatMessages, setChatMessages] = useState<Record<string, MarketplaceMessage[]>>({})

  // ── Fetch actions ──────────────────────────────────────────────────────────

  const fetchListings = useCallback(async (search?: string, minBalance?: number, maxPrice?: number) => {
    if (!user) return
    setLoadingListings(true)
    try {
      const { data, error } = await supabase.rpc('get_marketplace_listings', {
        p_search: search || null,
        p_min_balance: minBalance || null,
        p_max_price: maxPrice || null,
      })
      if (error) throw error
      setListings((data as MarketplaceListing[]) || [])
    } catch (err) {
      console.error('[marketplace] fetchListings error', err)
    } finally {
      setLoadingListings(false)
    }
  }, [user])

  const fetchMyListings = useCallback(async () => {
    if (!user) return
    setLoadingMyListings(true)
    try {
      const { data, error } = await supabase.rpc('get_my_listings')
      if (error) throw error
      setMyListings((data as MarketplaceListing[]) || [])
    } catch (err) {
      console.error('[marketplace] fetchMyListings error', err)
    } finally {
      setLoadingMyListings(false)
    }
  }, [user])

  const fetchMyPurchases = useCallback(async () => {
    if (!user) return
    setLoadingMyPurchases(true)
    try {
      const { data, error } = await supabase.rpc('get_my_purchases')
      if (error) throw error
      setMyPurchases((data as MarketplacePurchase[]) || [])
    } catch (err) {
      console.error('[marketplace] fetchMyPurchases error', err)
    } finally {
      setLoadingMyPurchases(false)
    }
  }, [user])

  // ── Marketplace actions ────────────────────────────────────────────────────

  const listForSale = useCallback(async (voucherId: string, askingPrice: number, description?: string) => {
    const { data, error } = await supabase.rpc('list_voucher_for_sale', {
      p_voucher_id: voucherId,
      p_asking_price: askingPrice,
      p_description: description || null,
    })
    if (error) throw error
    await fetchMyListings()
    return data as MarketplaceListing
  }, [fetchMyListings])

  const removeFromSale = useCallback(async (listingId: string) => {
    const { error } = await supabase.rpc('remove_from_sale', { p_listing_id: listingId })
    if (error) throw error
    await fetchMyListings()
  }, [fetchMyListings])

  const confirmPaymentSent = useCallback(async (listingId: string, paymentMethod: string) => {
    const { error } = await supabase.rpc('buyer_confirm_payment', {
      p_listing_id: listingId,
      p_payment_method_used: paymentMethod,
    })
    if (error) throw error
    await Promise.all([fetchListings(), fetchMyPurchases()])
  }, [fetchListings, fetchMyPurchases])

  const confirmPaymentReceived = useCallback(async (purchaseId: string) => {
    const { error } = await supabase.rpc('seller_confirm_payment', { p_purchase_id: purchaseId })
    if (error) throw error
    await fetchMyListings()
  }, [fetchMyListings])

  const cancelPurchase = useCallback(async (purchaseId: string) => {
    const { error } = await supabase.rpc('cancel_purchase', { p_purchase_id: purchaseId })
    if (error) throw error
    await Promise.all([fetchMyPurchases(), fetchMyListings()])
  }, [fetchMyPurchases, fetchMyListings])

  const rateUser = useCallback(async (purchaseId: string, ratedUserId: string, rating: number, comment?: string) => {
    const { error } = await supabase.rpc('rate_user', {
      p_purchase_id: purchaseId,
      p_rated_user_id: ratedUserId,
      p_rating: rating,
      p_comment: comment || null,
    })
    if (error) throw error
    await fetchMyPurchases()
  }, [fetchMyPurchases])

  const reportUser = useCallback(async (
    reportedUserId: string,
    reason: string,
    details?: string,
    purchaseId?: string,
    listingId?: string,
  ) => {
    const { error } = await supabase.rpc('report_user', {
      p_reported_user_id: reportedUserId,
      p_reason: reason,
      p_details: details || null,
      p_purchase_id: purchaseId || null,
      p_listing_id: listingId || null,
    })
    if (error) throw error
  }, [])

  // ── Chat actions ───────────────────────────────────────────────────────────

  const fetchChatMessages = useCallback(async (listingId: string, buyerId?: string) => {
    if (!user) return
    const effectiveBuyerId = buyerId || user.id
    const key = `${listingId}:${effectiveBuyerId}`
    try {
      const { data, error } = await supabase.rpc('get_chat_messages', {
        p_listing_id: listingId,
        p_buyer_id: effectiveBuyerId,
      })
      if (error) throw error
      setChatMessages(prev => ({ ...prev, [key]: (data as MarketplaceMessage[]) || [] }))
    } catch (err) {
      console.error('[marketplace] fetchChatMessages error', err)
    }
  }, [user])

  const sendChatMessage = useCallback(async (listingId: string, message: string, buyerId?: string) => {
    if (!user) return
    const { data, error } = await supabase.rpc('send_chat_message', {
      p_listing_id: listingId,
      p_message: message,
      p_buyer_id: buyerId || null,
    })
    if (error) throw error
    // Append optimistically
    const effectiveBuyerId = buyerId || user.id
    const key = `${listingId}:${effectiveBuyerId}`
    const newMsg = data as MarketplaceMessage
    setChatMessages(prev => ({
      ...prev,
      [key]: [...(prev[key] || []), { ...newMsg, is_me: true }],
    }))
  }, [user])

  const updateListingPrice = useCallback(async (listingId: string, newPrice: number) => {
    const { error } = await supabase.rpc('update_listing_price', {
      p_listing_id: listingId,
      p_new_price: newPrice,
    })
    if (error) throw error
    await fetchMyListings()
  }, [fetchMyListings])

  // ── Realtime: seller notified when buyer confirms payment ──────────────────
  useEffect(() => {
    if (!user) return

    const channel = supabase
      .channel(`marketplace-seller-${user.id}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'marketplace_purchases',
          filter: `seller_id=eq.${user.id}`,
        },
        (payload) => {
          const updated = payload.new as { status: string }
          if (updated.status === 'buyer_confirmed') {
            toast('קונה אישר ששלח תשלום! בדוק את הרשימות שלך.', { icon: '💰', duration: 6000 })
            fetchMyListings()
          }
        },
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [user, fetchMyListings])

  // ── Realtime: buyer notified when seller confirms (voucher transferred) ────
  useEffect(() => {
    if (!user) return

    const channel = supabase
      .channel(`marketplace-buyer-${user.id}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'marketplace_purchases',
          filter: `buyer_id=eq.${user.id}`,
        },
        (payload) => {
          const updated = payload.new as { status: string }
          if (updated.status === 'completed') {
            toast('המוכר אישר את התשלום! השובר הועבר לארנק שלך.', { icon: '🎉', duration: 6000 })
            fetchMyPurchases()
          }
        },
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [user, fetchMyPurchases])

  // ── Realtime: new chat messages ────────────────────────────────────────────
  useEffect(() => {
    if (!user) return

    const channel = supabase
      .channel(`marketplace-chat-${user.id}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'marketplace_messages',
          filter: `buyer_id=eq.${user.id}`,
        },
        (payload) => {
          const msg = payload.new as MarketplaceMessage
          // Only show toast/update if someone else sent it
          if (msg.sender_id !== user.id) {
            const key = `${msg.listing_id}:${msg.buyer_id}`
            setChatMessages(prev => ({
              ...prev,
              [key]: [...(prev[key] || []), { ...msg, is_me: false }],
            }))
            if (!msg.is_system) {
              toast('💬 הגיעה הודעה חדשה מהמוכר!', { duration: 4000 })
            }
          }
        },
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [user])

  return (
    <MarketplaceContext.Provider
      value={{
        listings,
        myListings,
        myPurchases,
        loadingListings,
        loadingMyListings,
        loadingMyPurchases,
        fetchListings,
        fetchMyListings,
        fetchMyPurchases,
        listForSale,
        removeFromSale,
        confirmPaymentSent,
        confirmPaymentReceived,
        cancelPurchase,
        rateUser,
        reportUser,
        chatMessages,
        fetchChatMessages,
        sendChatMessage,
        updateListingPrice,
      }}
    >
      {children}
    </MarketplaceContext.Provider>
  )
}
