import { useState, useEffect, useRef, useCallback } from 'react'
import { X, Send, Tag, Check, XCircle, Loader2, MessageCircle } from 'lucide-react'
import { useMarketplace } from '../contexts/MarketplaceContext'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import type { MarketplaceMessage } from '../types'
import toast from 'react-hot-toast'

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
  onPriceUpdated,
}: ChatModalProps) {
  const { user } = useAuth()
  const { sendMessage, sendPriceOffer, fetchChat, respondToPriceOffer } = useMarketplace()

  const [messages, setMessages] = useState<MarketplaceMessage[]>([])
  const [loading, setLoading] = useState(true)
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [showOfferInput, setShowOfferInput] = useState(false)
  const [offerAmount, setOfferAmount] = useState('')
  const [respondingTo, setRespondingTo] = useState<string | null>(null)

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const loadMessages = useCallback(async () => {
    try {
      const msgs = await fetchChat(listingId, otherUserId)
      setMessages(msgs)
    } catch {
      toast.error('שגיאה בטעינת ההודעות')
    } finally {
      setLoading(false)
    }
  }, [listingId, otherUserId, fetchChat])

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
          // Only add if relevant to this chat
          if (
            (msg.sender_id === user.id && msg.receiver_id === otherUserId) ||
            (msg.sender_id === otherUserId && msg.receiver_id === user.id)
          ) {
            setMessages(prev => [...prev, { ...msg, is_mine: msg.sender_id === user.id }])
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
    setSending(true)
    try {
      await sendMessage(listingId, otherUserId, trimmed)
      setText('')
      inputRef.current?.focus()
    } catch (err: any) {
      const msg = err?.message || ''
      if (msg.includes('listing_not_available')) toast.error('המודעה כבר אינה זמינה')
      else toast.error('שגיאה בשליחת ההודעה')
    } finally {
      setSending(false)
    }
  }

  async function handleSendOffer() {
    const amount = parseFloat(offerAmount)
    if (!amount || amount <= 0) { toast.error('הזן מחיר תקין'); return }
    if (amount >= currentAskingPrice) { toast.error('המחיר המוצע חייב להיות נמוך מהמחיר הנוכחי'); return }
    setSending(true)
    try {
      await sendPriceOffer(listingId, otherUserId, amount, `הצעת מחיר: ₪${amount}`)
      setOfferAmount('')
      setShowOfferInput(false)
    } catch (err: any) {
      const msg = err?.message || ''
      if (msg.includes('only_seller_can_offer_price')) toast.error('רק המוכר יכול להציע מחיר')
      else toast.error('שגיאה בשליחת ההצעה')
    } finally {
      setSending(false)
    }
  }

  async function handleRespond(messageId: string, response: 'accepted' | 'rejected') {
    setRespondingTo(messageId)
    try {
      await respondToPriceOffer(messageId, response)
      if (response === 'accepted') {
        const msg = messages.find(m => m.id === messageId)
        if (msg?.offer_amount) onPriceUpdated?.(msg.offer_amount)
        toast.success(`קיבלת את ההצעה! המחיר עודכן ל-₪${msg?.offer_amount}`)
      } else {
        toast('דחית את ההצעה', { icon: '✋' })
      }
      await loadMessages()
    } catch {
      toast.error('שגיאה בטיפול בהצעה')
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

  const otherDisplayName = otherUserName || 'משתמש'

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-end justify-center overflow-hidden" onClick={onClose}>
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
            <p className="text-xs text-gray-500 truncate">{storeName} · מחיר נוכחי: ₪{currentAskingPrice}</p>
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
                  ? 'הקונה ישלח הודעה בקרוב'
                  : 'שלח הודעה למוכר כדי לשאול שאלות או להתמקח על המחיר'}
              </p>
            </div>
          ) : (
            messages.map(msg => (
              <MessageBubble
                key={msg.id}
                msg={msg}
                isSeller={isSeller}
                onRespond={handleRespond}
                respondingTo={respondingTo}
              />
            ))
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* ── Offer input (seller) ── */}
        {showOfferInput && isSeller && (
          <div className="px-4 py-3 bg-green-50 border-t border-green-100 shrink-0">
            <p className="text-xs font-medium text-green-700 mb-2">הצע מחיר חדש (נמוך מ-₪{currentAskingPrice})</p>
            <div className="flex gap-2">
              <input
                type="number"
                inputMode="decimal"
                value={offerAmount}
                onChange={e => setOfferAmount(e.target.value)}
                placeholder={`עד ₪${currentAskingPrice - 1}`}
                className="flex-1 border rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-400"
                autoFocus
              />
              <button
                onClick={handleSendOffer}
                disabled={sending || !offerAmount}
                className="px-4 py-2 bg-green-600 text-white rounded-xl text-sm font-semibold disabled:opacity-50"
              >
                {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : 'שלח'}
              </button>
              <button
                onClick={() => { setShowOfferInput(false); setOfferAmount('') }}
                className="px-3 py-2 border border-gray-200 rounded-xl text-sm text-gray-500"
              >
                ביטול
              </button>
            </div>
          </div>
        )}

        {/* ── Footer input ── */}
        <div className="px-4 py-3 border-t bg-white shrink-0 space-y-2">
          {/* Price offer button (seller only) */}
          {isSeller && !showOfferInput && (
            <button
              onClick={() => setShowOfferInput(true)}
              className="flex items-center gap-1.5 text-xs font-medium text-green-700 bg-green-50 border border-green-200 px-3 py-1.5 rounded-full hover:bg-green-100 transition-colors"
            >
              <Tag className="w-3.5 h-3.5" />
              הורד מחיר
            </button>
          )}
          <div className="flex gap-2 items-end">
            <textarea
              ref={inputRef}
              value={text}
              onChange={e => setText(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="כתוב הודעה..."
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
  isSeller,
  onRespond,
  respondingTo,
}: {
  msg: MarketplaceMessage
  isSeller: boolean
  onRespond: (id: string, r: 'accepted' | 'rejected') => void
  respondingTo: string | null
}) {
  const isMe = msg.is_mine
  const isPriceOffer = msg.msg_type === 'price_offer'

  if (isPriceOffer) {
    return (
      <div className={`flex ${isMe ? 'justify-start' : 'justify-end'}`}>
        <div className="max-w-[75%] bg-white border-2 border-green-300 rounded-2xl p-3 space-y-2 shadow-sm">
          <div className="flex items-center gap-2">
            <Tag className="w-4 h-4 text-green-600" />
            <span className="text-sm font-semibold text-green-800">הצעת מחיר</span>
          </div>
          <p className="text-2xl font-bold text-green-600">₪{msg.offer_amount}</p>
          <p className="text-xs text-gray-400">{formatTime(msg.created_at)}</p>

          {/* Offer status */}
          {msg.offer_status === 'accepted' && (
            <div className="flex items-center gap-1 text-green-600 text-xs font-medium">
              <Check className="w-3.5 h-3.5" /> התקבל
            </div>
          )}
          {msg.offer_status === 'rejected' && (
            <div className="flex items-center gap-1 text-red-500 text-xs font-medium">
              <XCircle className="w-3.5 h-3.5" /> נדחה
            </div>
          )}

          {/* Buyer can accept/reject pending offers */}
          {msg.offer_status === 'pending' && !isMe && !isSeller && (
            <div className="flex gap-2 pt-1">
              <button
                onClick={() => onRespond(msg.id, 'accepted')}
                disabled={respondingTo === msg.id}
                className="flex-1 py-1.5 bg-green-600 text-white rounded-xl text-xs font-semibold disabled:opacity-50"
              >
                {respondingTo === msg.id ? <Loader2 className="w-3 h-3 animate-spin mx-auto" /> : 'קבל'}
              </button>
              <button
                onClick={() => onRespond(msg.id, 'rejected')}
                disabled={respondingTo === msg.id}
                className="flex-1 py-1.5 border border-red-200 text-red-500 rounded-xl text-xs font-semibold disabled:opacity-50"
              >
                דחה
              </button>
            </div>
          )}
          {msg.offer_status === 'pending' && !isMe && isSeller && (
            <p className="text-xs text-amber-600">ממתין לתגובת הקונה</p>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className={`flex ${isMe ? 'justify-start' : 'justify-end'}`}>
      <div
        className={`max-w-[75%] rounded-2xl px-4 py-2.5 space-y-0.5 ${
          isMe
            ? 'bg-gray-100 text-gray-900 rounded-tr-sm'
            : 'bg-green-600 text-white rounded-tl-sm'
        }`}
      >
        <p className="text-sm leading-relaxed whitespace-pre-wrap">{msg.body}</p>
        <p className={`text-xs ${isMe ? 'text-gray-400' : 'text-green-200'}`}>{formatTime(msg.created_at)}</p>
      </div>
    </div>
  )
}

function formatTime(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })
}
