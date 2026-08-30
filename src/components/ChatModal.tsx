import { useState, useEffect, useRef, useCallback } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { BACKDROP_FADE, SHEET_SPRING } from '../lib/motion'
import { useMarketplace } from '../contexts/MarketplaceContext'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import type { MarketplaceMessage } from '../types'
import { useBodyScrollLock } from '../hooks/useBodyScrollLock'
import { useKeyboardInset } from '../hooks/useKeyboardInset'
import { useModalHistory } from '../hooks/useModalHistory'
import toast from 'react-hot-toast'
import { useT } from '../lib/i18n'
import Icon from './ui/Icon'
import ConfirmDialog from './ConfirmDialog'
import { SHEET_Z_INDEX } from './ui/BottomSheet'

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
  const { t } = useT()
  const { user } = useAuth()
  const reduceMotion = useReducedMotion()
  const { sendMessage, sendPriceOffer, fetchChat, respondToPriceOffer,
          registerActiveChat, unregisterActiveChat, markMessagesRead } = useMarketplace()
  useBodyScrollLock()
  // Keyboard overlap (iOS: fixed elements don't track the visual viewport) —
  // applied as bottom padding so the composer rides above the keyboard
  const keyboardInset = useKeyboardInset()

  const [messages, setMessages] = useState<MarketplaceMessage[]>([])
  const [loading, setLoading] = useState(true)
  const [text, setText] = useState('')
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false)

  // Android Back closes the chat (guarding a typed draft) instead of leaving the page.
  // The hook reads the latest callback each render, so `text` here is current.
  useModalHistory(true, () => {
    if (text.trim()) setShowDiscardConfirm(true)
    else onClose()
  })
  const [sending, setSending] = useState(false)
  const [showOfferInput, setShowOfferInput] = useState(false)
  const [offerAmount, setOfferAmount] = useState('')
  const [respondingTo, setRespondingTo] = useState<string | null>(null)

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // Register this chat as active so the global inbox listener skips counting/pushing.
  useEffect(() => {
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
    if (sending) return // sync guard against a double-tap creating two offers
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
        // Tell the host page the negotiated price — this prop existed but was never
        // called, so the listing kept showing the OLD price until a manual reload.
        if (offerMsg?.offer_amount != null) onPriceUpdated?.(offerMsg.offer_amount)
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
    // No inner AnimatePresence around an unconditional child — it can't animate its
    // own unmount. Call sites wrap `{open && <ChatModal/>}` in <AnimatePresence> so
    // the exit below actually plays.
    <motion.div
        className="fixed inset-0 bg-black/60 flex items-end justify-center overflow-hidden"
        style={{ zIndex: SHEET_Z_INDEX }}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={BACKDROP_FADE}
        onClick={() => {
          // A typed-but-unsent message shouldn't be destroyed by a stray backdrop tap
          if (text.trim()) { setShowDiscardConfirm(true); return }
          onClose()
        }}
      >
        <motion.div
          className="bg-surface rounded-t-[28px] w-full max-w-2xl flex flex-col pb-[env(safe-area-inset-bottom)]"
          // Keyboard inset lifts the composer above the on-screen keyboard —
          // iOS never resizes the layout viewport for fixed/dvh elements
          style={{ height: '85dvh', paddingBottom: keyboardInset || undefined }}
          initial={reduceMotion ? { opacity: 0 } : { y: '100%' }}
          animate={reduceMotion ? { opacity: 1 } : { y: 0 }}
          exit={reduceMotion ? { opacity: 0 } : { y: '100%' }}
          transition={reduceMotion ? { duration: 0.15 } : SHEET_SPRING}
          onClick={e => e.stopPropagation()}
          dir="rtl"
        >
          {/* ── Header ── */}
          <div className="flex items-center gap-3 px-5 py-4 border-b border-border shrink-0">
            <div className="w-9 h-9 bg-gradient-to-br from-primary-mid to-primary-dark rounded-full flex items-center justify-center text-white font-bold text-sm shrink-0">
              {otherDisplayName[0]?.toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-text truncate">{otherDisplayName}</p>
              <p className="text-xs text-text3 truncate">{storeName} · {t('chat.current.price')}: ₪{currentAskingPrice}</p>
            </div>
            <button
              onClick={() => { if (text.trim()) setShowDiscardConfirm(true); else onClose() }}
              aria-label={t('app.close')}
              className="p-2.5 rounded-full bg-bg text-text2 shrink-0"
            >
              <Icon name="close" size={20} />
            </button>
          </div>

          {/* ── Messages ── */}
          <div className="flex-1 overflow-y-auto min-h-0 px-4 py-3 space-y-3">
            {loading ? (
              <div className="flex justify-center py-10">
                <Icon name="progress_activity" size={24} color="var(--c-primary)" className="animate-spin" />
              </div>
            ) : messages.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-center text-text3 space-y-2">
                <Icon name="chat" size={40} color="var(--c-border)" />
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
            <div className="px-4 py-3 bg-primary-light border-t border-primary/20 shrink-0">
              <p className="text-xs font-medium text-primary mb-2">
                {isSeller ? `${t('chat.offer.new.price')} (${t('chat.offer.below')} ₪${currentAskingPrice})` : `${t('chat.offer.propose')} (${t('chat.offer.below')} ₪${currentAskingPrice})`}
              </p>
              <div className="flex gap-2">
                <input
                  type="number"
                  inputMode="decimal"
                  value={offerAmount}
                  onChange={e => setOfferAmount(e.target.value)}
                  placeholder={`${t('chat.offer.up.to')} ₪${currentAskingPrice - 1}`}
                  className="flex-1 border border-border rounded-xl px-3 py-2 text-sm bg-surface text-text focus:outline-none focus:ring-2 focus:ring-primary/30"
                  autoFocus
                />
                <button
                  onClick={handleSendOffer}
                  disabled={sending || !offerAmount}
                  className="px-4 py-2 bg-primary text-white rounded-xl text-sm font-semibold disabled:opacity-50"
                >
                  {sending ? <Icon name="progress_activity" size={16} className="animate-spin" /> : t('chat.send')}
                </button>
                <button
                  onClick={() => { setShowOfferInput(false); setOfferAmount('') }}
                  className="px-3 py-2 border border-border rounded-xl text-sm text-text3"
                >
                  {t('chat.cancel')}
                </button>
              </div>
            </div>
          )}

          {/* ── Footer input ── */}
          <div className="px-4 py-3 border-t border-border bg-surface shrink-0 space-y-2">
            {/* Price offer button (seller & buyer) */}
            {!showOfferInput && (
              <button
                onClick={() => setShowOfferInput(true)}
                className="flex items-center gap-1.5 text-xs font-medium text-primary bg-primary-light border border-primary/20 px-3 py-1.5 rounded-full"
              >
                <Icon name="sell" size={14} />
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
                className="flex-1 border border-border rounded-2xl px-4 py-2.5 text-base bg-bg text-text resize-none focus:outline-none focus:ring-2 focus:ring-primary/30 max-h-24 overflow-y-auto leading-6"
                style={{ minHeight: '44px' }}
              />
              <button
                onClick={handleSend}
                disabled={sending || !text.trim()}
                aria-label={t('chat.send.aria')}
                className="w-11 h-11 bg-primary text-white rounded-full flex items-center justify-center disabled:opacity-40 shrink-0"
              >
                {sending ? <Icon name="progress_activity" size={16} className="animate-spin" /> : <Icon name="send" size={16} />}
              </button>
            </div>
          </div>
        </motion.div>

        <AnimatePresence>
          {showDiscardConfirm && (
            <ConfirmDialog
              title={t('chat.discard.confirm.title')}
              message={t('chat.discard.confirm.msg')}
              danger
              onConfirm={() => { setShowDiscardConfirm(false); onClose() }}
              onCancel={() => setShowDiscardConfirm(false)}
            />
          )}
        </AnimatePresence>
    </motion.div>
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
        <div className="max-w-[75%] bg-surface border-2 border-primary/30 rounded-2xl p-3 space-y-2 shadow-card">
          <div className="flex items-center gap-2">
            <Icon name="sell" size={16} color="var(--c-primary)" />
            <span className="text-sm font-semibold text-primary">{t('chat.offer.label')}</span>
          </div>
          <p className="text-2xl font-bold text-primary">₪{msg.offer_amount}</p>
          <p className="text-xs text-text3">{formatTime(msg.created_at)}</p>

          {/* Offer status */}
          {msg.offer_status === 'accepted' && (
            <div className="flex items-center gap-1 text-primary text-xs font-medium">
              <Icon name="check" size={14} /> {t('chat.offer.status.accepted')}
            </div>
          )}
          {msg.offer_status === 'rejected' && (
            <div className="flex items-center gap-1 text-error text-xs font-medium">
              <Icon name="cancel" size={14} /> {t('chat.offer.status.rejected')}
            </div>
          )}

          {/* Recipient can accept/reject pending offers (works for both buyer and seller) */}
          {msg.offer_status === 'pending' && !isMe && (
            <div className="flex gap-2 pt-1">
              <button
                onClick={() => onRespond(msg.id, 'accepted')}
                disabled={respondingTo === msg.id}
                className="flex-1 py-1.5 bg-primary text-white rounded-xl text-xs font-semibold disabled:opacity-50"
              >
                {respondingTo === msg.id ? <Icon name="progress_activity" size={12} className="animate-spin mx-auto" /> : t('chat.offer.accept')}
              </button>
              <button
                onClick={() => onRespond(msg.id, 'rejected')}
                disabled={respondingTo === msg.id}
                className="flex-1 py-1.5 border border-error/30 text-error rounded-xl text-xs font-semibold disabled:opacity-50"
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
            ? 'bg-bg text-text rounded-tr-sm'
            : 'bg-primary text-white rounded-tl-sm'
        }`}
      >
        <p className="text-sm leading-relaxed whitespace-pre-wrap mb-0.5">{msg.body}</p>
        {/* Timestamp + read receipt */}
        <div className="flex items-center gap-1" dir="ltr">
          <span className={`text-xs ${isMe ? 'text-text3' : 'text-white/70'}`}>
            {formatTime(msg.created_at)}
          </span>
          {isMe && (
            msg.is_read
              ? <Icon name="done_all" size={14} color="#60a5fa" className="shrink-0" />
              : <Icon name="check" size={14} color="var(--c-border)" className="shrink-0" />
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
