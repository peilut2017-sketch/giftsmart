import { useState, useEffect, useRef, useCallback } from 'react'
import { X, Send, Tag, Check, CheckCheck, XCircle, Loader2, MessageCircle } from 'lucide-react'
import { useMarketplace } from '../contexts/MarketplaceContext'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import type { MarketplaceMessage } from '../types'
import { useBodyScrollLock } from '../hooks/useBodyScrollLock'
import toast from 'react-hot-toast'
import { useT } from '../lib/i18n'

interface ChatModalProps {
  listingId: string
  otherUserId: string
  otherUserName: string
  isSeller: boolean           // true = current user is the seller
  currentAskingPrice: number  // for price offer validation
  storeName: string
  onClose: () => void
  onPriceUpdated?: (newPrice: number) => void
}

export default function ChatModal({
  listingId,
  otherUserId,
  otherUserName,
  isSeller,
  currentAskingPrice,
  storeName,
  onClose,
}: ChatModalProps) {
  const { t } = useT()
  const { user } = useAuth()
  const { sendMessage, sendPriceOffer, fetchChat, respondToPriceOffer,
          registerActiveChat, unregisterActiveChat, markMessagesRead } = useMarketplace()
  useBodyScrollLock()

  const [messages, setMessages] = useState<MarketplaceMessage[]>([])
  const [loading, setLoading] = useState(true)
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [showOfferInput, setShowOfferInput] = useState(false)
  const [offerAmount, setOfferAmount] = useState('')
  const [respondingTo, setRespondingTo] = useState<string | null>(null)

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // Register this chat as active so the global inbox listener skips counting/pushing.
  // Also request notification permission — best moment since user is actively chatting.
  useEffect(() => {
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      Notification.requestPermission()
    }
    const key = `${listingId}:${otherUserId}`
    registerActiveChat(key)
    return () => unregisterActiveChat(key)
  }, [listingId, otherUserId, registerActiveChat, unregisterActiveChat])

  const loadMessages = useCallback(async () => {
    try {
      const msgs = await fetchChat(listingId, otherUserId)
      setMessages(msgs)
      // Mark the other user's messages as read now that we've loaded them
      markMessagesRead(listingId, otherUserId)
    } catch {
      toast.error(t('chat.load.error'))
    } finally {
      setLoading(false)
    }
  }, [listingId, otherUserId, fetchChat, markMessagesRead])

  useEffect(() => {
    loadMessages()
  }, [loadMessages])

  // Scroll to bottom when messages update
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Realtime subscription for new messages
  useEffect(() => {
    if (!user) return
    const channel = supabase
      .channel(`chat-${listingId}-${user.id}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'marketplace_messages',
          filter: `listing_id=eq.${listingId}`,
        },
        (payload) => {
          const msg = payload.new as MarketplaceMessage & { sender_id: string; receiver_id: string }
          // Only handle messages relevant to this conversation
          if (
            (msg.sender_id === user.id && msg.receiver_id === otherUserId) ||
            (msg.sender_id === otherUserId && msg.receiver_id === user.id)
          ) {
            setMessages(prev => {
              if (msg.sender_id === user.id) {
                // Replace the optimistic temp message (same body, sent by me) with the real one
                const tempIdx = prev.findIndex(
                  m => m.id.startsWith('temp-') && m.body === msg.body && m.is_mine,
                )
                if (tempIdx >= 0) {
                  const updated = [...prev]
                  updated[tempIdx] = { ...msg, is_mine: true }
                  return updated
                }
              } else {
                // Incoming message from the other user — mark as read immediately
                markMessagesRead(listingId, otherUserId)
              }
              return [...prev, { ...msg, is_mine: msg.sender_id === user.id }]
            })
          }
        },
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'marketplace_messages',
          filter: `listing_id=eq.${listingId}`,
        },
        () => {
          // Reload on offer status changes
          loadMessages()
        },
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [user, listingId, otherUserId, loadMessages])

  async function handleSend() {
    const trimmed = text.trim()
    if (!trimmed || sending) return

    // Optimistic update — show message immediately before server confirms
    const tempId = `temp-${Date.now()}`
    const optimistic: MarketplaceMessage = {
      id: tempId,
      listing_id: listingId,
      sender_id: user!.id,
      receiver_id: otherUserId,
      body: trimmed,
      msg_type: 'text',
      offer_amount: null,
      offer_status: null,
      created_at: new Date().toISOString(),
      is_mine: true,
    }
    setMessages(prev => [...prev, optimistic])
    setText('')
    setSending(true)

    try {
      await sendMessage(listingId, otherUserId, trimmed)
      inputRef.current?.focus()
    } catch (err: any) {
      // Roll back optimistic message and restore the typed text
      setMessages(prev => prev.filter(m => m.id !== tempId))
      setText(trimmed)
      const msg = err?.message || ''
      if (msg.includes('listing_not_available')) toast.error(t('chat.listing.unavailable'))
      else toast.error(t('chat.send.error'))
    } finally {
      setSending(false)
    }
  }

  async function handleSendOffer() {
    const amount = parseFloat(offerAmount)
    if (!amount || amount <= 0) { toast.error(t('chat.offer.invalid.price')); return }
    if (amount >= currentAskingPrice) { toast.error(t('chat.offer.must.be.lower')); return }
    setSending(true)
    try {
      await sendPriceOffer(listingId, otherUserId, amount, `${t('chat.offer.label')}: ₪${amount}`)
      setOfferAmount('')
      setShowOfferInput(false)
    } catch (err: any) {
      const msg = err?.message || ''
      if (msg.includes('offer_not_lower_than_asking_price')) toast.error(t('chat.offer.must.be.lower'))
      else toast.error(t('chat.offer.send.error'))
    } finally {
      setSending(false)
    }
  }

  async function handleRespond(messageId: string, response: 'accepted' | 'rejected') {
    setRespondingTo(messageId)
    try {
      await respondToPriceOffer(messageId, response)
      if (response === 'accepted') {
        const offerMsg = messages.find(m => m.id === messageId)
        toast.success(
          isSeller
            ? `${t('chat.offer.accepted.seller')}: ₪${offerMsg?.offer_amount}`
            : `${t('chat.offer.accepted.buyer')}: ₪${offerMsg?.offer_amount}`,
        )
      } else {
        toast(t('chat.offer.rejected'), { icon: '✋' })
      }
      await loadMessages()
    } catch {
      toast.error(t('chat.offer.respond.error'))
    } finally {
      setRespondingTo(null)
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const otherDisplayName = otherUserName || t('chat.default.user')

  return (
    <div className="fixed inset-0 bg-black/60 z-[100] flex items-end justify-center overflow-hidden" onClick={onClose}>
      <div
        className="bg-white rounded-t-3xl w-full max-w-2xl flex flex-col"
        style={{ height: '85dvh' }}
        onClick={e => e.stopPropagation()}
        dir="rtl"
      >
        {/* ── Header ── */}
        <div className="flex items-center gap-3 px-5 py-4 border-b shrink-0">
          <div className="w-9 h-9 bg-gradient-to-br from-green-400 to-teal-500 rounded-full flex items-center justify-center text-white font-bold text-sm shrink-0">
            {otherDisplayName[0]?.toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-gray-900 truncate">{otherDisplayName}</p>
            <p className="text-xs text-gray-500 truncate">{storeName} · {t('chat.current.price')}: ₪{currentAskingPrice}</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-full hover:bg-gray-100 shrink-0">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* ── Messages ── */}
        <div className="modal-scroll flex-1 overflow-y-auto min-h-0 px-4 py-3 space-y-3">
          {loading ? (
            <div className="flex justify-center py-10">
              <Loader2 className="w-6 h-6 animate-spin text-green-500" />
            </div>
          ) : messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center text-gray-400 space-y-2">
              <MessageCircle className="w-10 h-10 opacity-30" />
              <p className="text-sm">
                {isSeller
                  ? t('chat.empty.seller')
                  : t('chat.empty.buyer')}
              </p>
            </div>
          ) : (
            messages.map(msg => (
              <MessageBubble
                key={msg.id}
                msg={msg}
                onRespond={handleRespond}
                respondingTo={respondingTo}
              />
            ))
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* ── Offer input (seller & buyer) ── */}
        {showOfferInput && (
          <div className="px-4 py-3 bg-green-50 border-t border-green-100 shrink-0">
            <p className="text-xs font-medium text-green-700 mb-2">
              {isSeller ? `${t('chat.offer.new.price')} (${t('chat.offer.below')} ₪${currentAskingPrice})` : `${t('chat.offer.propose')} (${t('chat.offer.below')} ₪${currentAskingPrice})`}
            </p>
            <div className="flex gap-2">
              <input
                type="number"
                inputMode="decimal"
                value={offerAmount}
                onChange={e => setOfferAmount(e.target.value)}
                placeholder={`${t('chat.offer.up.to')} ₪${currentAskingPrice - 1}`}
                className="flex-1 border rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-400"
                autoFocus
              />
              <button
                onClick={handleSendOffer}
                disabled={sending || !offerAmount}
                className="px-4 py-2 bg-green-600 text-white rounded-xl text-sm font-semibold disabled:opacity-50"
              >
                {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : t('chat.send')}
              </button>
              <button
                onClick={() => { setShowOfferInput(false); setOfferAmount('') }}
                className="px-3 py-2 border border-gray-200 rounded-xl text-sm text-gray-500"
              >
                {t('chat.cancel')}
              </button>
            </div>
          </div>
        )}

        {/* ── Footer input ── */}
        <div className="px-4 py-3 border-t bg-white shrink-0 space-y-2">
          {/* Price offer button (seller & buyer) */}
          {!showOfferInput && (
            <button
              onClick={() => setShowOfferInput(true)}
              className="flex items-center gap-1.5 text-xs font-medium text-green-700 bg-green-50 border border-green-200 px-3 py-1.5 rounded-full hover:bg-green-100 transition-colors"
            >
              <Tag className="w-3.5 h-3.5" />
              {isSeller ? t('chat.lower.price') : t('chat.offer.price')}
            </button>
          )}
          <div className="flex gap-2 items-end">
            <textarea
              ref={inputRef}
              value={text}
              onChange={e => setText(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={t('chat.input.placeholder')}
              rows={1}
              className="flex-1 border rounded-2xl px-4 py-2.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-green-400 max-h-24 overflow-y-auto leading-5"
              style={{ minHeight: '40px' }}
            />
            <button
              onClick={handleSend}
              disabled={sending || !text.trim()}
              className="w-10 h-10 bg-green-600 text-white rounded-full flex items-center justify-center disabled:opacity-40 hover:bg-green-700 transition-colors shrink-0"
            >
              {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Message bubble ───────────────────────────────────────────────────────────
function MessageBubble({
  msg,
  onRespond,
  respondingTo,
}: {
  msg: MarketplaceMessage
  onRespond: (id: string, r: 'accepted' | 'rejected') => void
  respondingTo: string | null
}) {
  const { t } = useT()
  const isMe = msg.is_mine
  const isPriceOffer = msg.msg_type === 'price_offer'

  if (isPriceOffer) {
    return (
      <div className={`flex ${isMe ? 'justify-start' : 'justify-end'}`}>
        <div className="max-w-[75%] bg-white border-2 border-green-300 rounded-2xl p-3 space-y-2 shadow-sm">
          <div className="flex items-center gap-2">
            <Tag className="w-4 h-4 text-green-600" />
            <span className="text-sm font-semibold text-green-800">{t('chat.offer.label')}</span>
          </div>
          <p className="text-2xl font-bold text-green-600">₪{msg.offer_amount}</p>
          <p className="text-xs text-gray-400">{formatTime(msg.created_at)}</p>

          {/* Offer status */}
          {msg.offer_status === 'accepted' && (
            <div className="flex items-center gap-1 text-green-600 text-xs font-medium">
              <Check className="w-3.5 h-3.5" /> {t('chat.offer.status.accepted')}
            </div>
          )}
          {msg.offer_status === 'rejected' && (
            <div className="flex items-center gap-1 text-red-500 text-xs font-medium">
              <XCircle className="w-3.5 h-3.5" /> {t('chat.offer.status.rejected')}
            </div>
          )}

          {/* Recipient can accept/reject pending offers (works for both buyer and seller) */}
          {msg.offer_status === 'pending' && !isMe && (
            <div className="flex gap-2 pt-1">
              <button
                onClick={() => onRespond(msg.id, 'accepted')}
                disabled={respondingTo === msg.id}
                className="flex-1 py-1.5 bg-green-600 text-white rounded-xl text-xs font-semibold disabled:opacity-50"
              >
                {respondingTo === msg.id ? <Loader2 className="w-3 h-3 animate-spin mx-auto" /> : t('chat.offer.accept')}
              </button>
              <button
                onClick={() => onRespond(msg.id, 'rejected')}
                disabled={respondingTo === msg.id}
                className="flex-1 py-1.5 border border-red-200 text-red-500 rounded-xl text-xs font-semibold disabled:opacity-50"
              >
                {t('chat.offer.reject')}
              </button>
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className={`flex ${isMe ? 'justify-start' : 'justify-end'}`}>
      <div
        className={`max-w-[75%] rounded-2xl px-4 py-2.5 ${
          isMe
            ? 'bg-gray-100 text-gray-900 rounded-tr-sm'
            : 'bg-green-600 text-white rounded-tl-sm'
        }`}
      >
        <p className="text-sm leading-relaxed whitespace-pre-wrap mb-0.5">{msg.body}</p>
        {/* Timestamp + read receipt */}
        <div className="flex items-center gap-1" dir="ltr">
          <span className={`text-xs ${isMe ? 'text-gray-400' : 'text-green-200'}`}>
            {formatTime(msg.created_at)}
          </span>
          {isMe && (
            msg.is_read
              ? <CheckCheck className="w-3.5 h-3.5 text-blue-400 shrink-0" />
              : <Check className="w-3.5 h-3.5 text-gray-300 shrink-0" />
          )}
        </div>
      </div>
    </div>
  )
}

function formatTime(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })
}
