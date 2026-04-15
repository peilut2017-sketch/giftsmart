import { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react'
import type { ReactNode } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from './AuthContext'
import type { MarketplaceListing, MarketplacePurchase, MarketplaceMessage, ListingConversation } from '../types'
import toast from 'react-hot-toast'

interface MarketplaceContextValue {
  // Data
  listings: MarketplaceListing[]          // all active marketplace listings (not mine)
  myListings: MarketplaceListing[]        // my listings as seller
  myPurchases: MarketplacePurchase[]      // my purchases as buyer
  loadingListings: boolean
  loadingMyListings: boolean
  loadingMyPurchases: boolean

  // Actions
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
  sendMessage: (listingId: string, receiverId: string, body: string) => Promise<void>
  sendPriceOffer: (listingId: string, receiverId: string, offerAmount: number, body: string) => Promise<void>
  fetchChat: (listingId: string, otherUserId: string) => Promise<MarketplaceMessage[]>
  respondToPriceOffer: (messageId: string, response: 'accepted' | 'rejected') => Promise<void>
  getListingConversations: (listingId: string) => Promise<ListingConversation[]>
  markMessagesRead: (listingId: string, senderUserId: string) => Promise<void>

  // Unread badge
  unreadChatCount: number
  markChatRead: () => void
  registerActiveChat: (chatKey: string) => void
  unregisterActiveChat: (chatKey: string) => void
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

  // TTL cache — avoids refetching data that's still fresh (60 s)
  const CACHE_TTL_MS = 60_000
  const fetchedAt = useRef<{ listings: number; myListings: number; myPurchases: number }>({
    listings: 0, myListings: 0, myPurchases: 0,
  })

  // Unread chat badge
  const [unreadChatCount, setUnreadChatCount] = useState(0)
  // Tracks which chat windows are currently open (key = `${listingId}:${otherUserId}`)
  const activeChats = useRef<Set<string>>(new Set())
  const markChatRead = useCallback(() => setUnreadChatCount(0), [])
  const registerActiveChat = useCallback((chatKey: string) => {
    activeChats.current.add(chatKey)
    setUnreadChatCount(0)
  }, [])
  const unregisterActiveChat = useCallback((chatKey: string) => {
    activeChats.current.delete(chatKey)
  }, [])

  const fetchListings = useCallback(async (search?: string, minBalance?: number, maxPrice?: number) => {
    if (!user) return
    const isDefaultQuery = !search && !minBalance && !maxPrice
    const now = Date.now()
    // Skip refetch if fresh data already loaded (default query only)
    if (isDefaultQuery && fetchedAt.current.listings && now - fetchedAt.current.listings < CACHE_TTL_MS) return
    setLoadingListings(true)
    try {
      const { data, error } = await supabase.rpc('get_marketplace_listings', {
        p_search: search || null,
        p_min_balance: minBalance || null,
        p_max_price: maxPrice || null,
      })
      if (error) throw error
      setListings((data as MarketplaceListing[]) || [])
      if (isDefaultQuery) fetchedAt.current.listings = Date.now()
    } catch (err) {
      console.error('[marketplace] fetchListings error', err)
    } finally {
      setLoadingListings(false)
    }
  }, [user])

  const fetchMyListings = useCallback(async () => {
    if (!user) return
    const now = Date.now()
    if (fetchedAt.current.myListings && now - fetchedAt.current.myListings < CACHE_TTL_MS) return
    setLoadingMyListings(true)
    try {
      const { data, error } = await supabase.rpc('get_my_listings')
      if (error) throw error
      setMyListings((data as MarketplaceListing[]) || [])
      fetchedAt.current.myListings = Date.now()
    } catch (err) {
      console.error('[marketplace] fetchMyListings error', err)
    } finally {
      setLoadingMyListings(false)
    }
  }, [user])

  const fetchMyPurchases = useCallback(async () => {
    if (!user) return
    const now = Date.now()
    if (fetchedAt.current.myPurchases && now - fetchedAt.current.myPurchases < CACHE_TTL_MS) return
    setLoadingMyPurchases(true)
    try {
      const { data, error } = await supabase.rpc('get_my_purchases')
      if (error) throw error
      setMyPurchases((data as MarketplacePurchase[]) || [])
      fetchedAt.current.myPurchases = Date.now()
    } catch (err) {
      console.error('[marketplace] fetchMyPurchases error', err)
    } finally {
      setLoadingMyPurchases(false)
    }
  }, [user])

  const listForSale = useCallback(async (voucherId: string, askingPrice: number, description?: string) => {
    const { data, error } = await supabase.rpc('list_voucher_for_sale', {
      p_voucher_id: voucherId,
      p_asking_price: askingPrice,
      p_description: description || null,
    })
    if (error) throw error
    fetchedAt.current.myListings = 0  // invalidate cache
    await fetchMyListings()
    return data as MarketplaceListing
  }, [fetchMyListings])

  const removeFromSale = useCallback(async (listingId: string) => {
    const { error } = await supabase.rpc('remove_from_sale', { p_listing_id: listingId })
    if (error) throw error
    fetchedAt.current.myListings = 0
    await fetchMyListings()
  }, [fetchMyListings])

  const confirmPaymentSent = useCallback(async (listingId: string, paymentMethod: string) => {
    const { error } = await supabase.rpc('buyer_confirm_payment', {
      p_listing_id: listingId,
      p_payment_method_used: paymentMethod,
    })
    if (error) throw error
    fetchedAt.current.listings = 0; fetchedAt.current.myPurchases = 0
    await Promise.all([fetchListings(), fetchMyPurchases()])
  }, [fetchListings, fetchMyPurchases])

  const confirmPaymentReceived = useCallback(async (purchaseId: string) => {
    const { error } = await supabase.rpc('seller_confirm_payment', { p_purchase_id: purchaseId })
    if (error) throw error
    fetchedAt.current.myListings = 0
    await fetchMyListings()
  }, [fetchMyListings])

  const cancelPurchase = useCallback(async (purchaseId: string) => {
    const { error } = await supabase.rpc('cancel_purchase', { p_purchase_id: purchaseId })
    if (error) throw error
    fetchedAt.current.myPurchases = 0; fetchedAt.current.myListings = 0
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

  // ── Chat ──────────────────────────────────────────────────────────────────

  const sendMessage = useCallback(async (listingId: string, receiverId: string, body: string) => {
    const { error } = await supabase.rpc('send_marketplace_message', {
      p_listing_id: listingId,
      p_receiver_id: receiverId,
      p_body: body,
      p_msg_type: 'text',
      p_offer_amount: null,
    })
    if (error) throw error
  }, [])

  const sendPriceOffer = useCallback(async (listingId: string, receiverId: string, offerAmount: number, body: string) => {
    const { error } = await supabase.rpc('send_marketplace_message', {
      p_listing_id: listingId,
      p_receiver_id: receiverId,
      p_body: body,
      p_msg_type: 'price_offer',
      p_offer_amount: offerAmount,
    })
    if (error) throw error
  }, [])

  const fetchChat = useCallback(async (listingId: string, otherUserId: string): Promise<MarketplaceMessage[]> => {
    const { data, error } = await supabase.rpc('get_listing_chat', {
      p_listing_id: listingId,
      p_other_user_id: otherUserId,
    })
    if (error) throw error
    return (data as MarketplaceMessage[]) || []
  }, [])

  const respondToPriceOffer = useCallback(async (messageId: string, response: 'accepted' | 'rejected') => {
    const { error } = await supabase.rpc('respond_to_price_offer', {
      p_message_id: messageId,
      p_response: response,
    })
    if (error) throw error
  }, [])

  const getListingConversations = useCallback(async (listingId: string): Promise<ListingConversation[]> => {
    const { data, error } = await supabase.rpc('get_listing_conversations', {
      p_listing_id: listingId,
    })
    if (error) throw error
    return (data as ListingConversation[]) || []
  }, [])

  const markMessagesRead = useCallback(async (listingId: string, senderUserId: string) => {
    const { error } = await supabase.rpc('mark_chat_messages_read', {
      p_listing_id: listingId,
      p_sender_id: senderUserId,
    })
    if (error) console.error('[marketplace] markMessagesRead error', error)
  }, [])

  // Seed the unread count from DB on login (needed if badge should persist across sessions)
  useEffect(() => {
    if (!user) { setUnreadChatCount(0); return }
    supabase.rpc('get_unread_chat_count').then(({ data }) => {
      if (typeof data === 'number') setUnreadChatCount(data)
    })
  }, [user])

  // Realtime: global inbox — new chat messages addressed to current user
  useEffect(() => {
    if (!user) return

    const channel = supabase
      .channel(`chat-inbox-${user.id}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'marketplace_messages',
          filter: `receiver_id=eq.${user.id}`,
        },
        (payload) => {
          const msg = payload.new as {
            body: string
            msg_type: string
            listing_id: string
            sender_id: string
          }
          const chatKey = `${msg.listing_id}:${msg.sender_id}`

          // Only count/notify if that ChatModal is NOT currently open
          if (!activeChats.current.has(chatKey)) {
            setUnreadChatCount(c => c + 1)

            // Push notification
            if (Notification.permission === 'granted') {
              const body = msg.msg_type === 'price_offer' ? 'הצעת מחיר חדשה התקבלה' : msg.body
              new Notification('הודעה חדשה בשוק', { body, icon: '/pwa-192x192.png' })
            }
          }
        },
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [user])

  // Realtime: notify seller when buyer confirms payment
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
          const updated = payload.new as { status: string; listing_id: string }
          if (updated.status === 'buyer_confirmed') {
            toast('קונה אישר ששלח תשלום! בדוק את הרשימות שלך.', {
              icon: '💰',
              duration: 6000,
            })
            fetchMyListings()
          }
        },
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [user, fetchMyListings])

  // Realtime: notify buyer when seller confirms (voucher transferred)
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
            toast('המוכר אישר את התשלום! השובר הועבר לארנק שלך.', {
              icon: '🎉',
              duration: 6000,
            })
            fetchMyPurchases()
          }
        },
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [user, fetchMyPurchases])

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
        sendMessage,
        sendPriceOffer,
        fetchChat,
        respondToPriceOffer,
        getListingConversations,
        markMessagesRead,
        unreadChatCount,
        markChatRead,
        registerActiveChat,
        unregisterActiveChat,
      }}
    >
      {children}
    </MarketplaceContext.Provider>
  )
}
