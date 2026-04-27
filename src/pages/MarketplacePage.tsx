import { useState, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useMarketplace } from '../contexts/MarketplaceContext'
import { useAuth } from '../contexts/AuthContext'
import { useVouchers } from '../contexts/VoucherContext'
import {
  ShoppingBag, Search, Star, X, CheckCircle, Loader2,
  Tag, Flag, AlertCircle, MessageCircle, ChevronRight, Pencil,
  Bell, Plus, Trash2, SlidersHorizontal, Check, Settings,
} from 'lucide-react'
import { formatDate } from '../utils/helpers'
import type { MarketplaceListing, MarketplacePurchase, ListingConversation, WatchlistItem, PaymentMethod } from '../types'
import { PAYMENT_METHOD_LABELS } from '../types'
import { supabase } from '../lib/supabase'
import ChatModal from '../components/ChatModal'
import { useBodyScrollLock } from '../hooks/useBodyScrollLock'
import toast from 'react-hot-toast'

// ─── Rating Stars ────────────────────────────────────────────────────────────
function StarRating({ value, max = 5, onChange }: { value: number; max?: number; onChange?: (v: number) => void }) {
  return (
    <div className="flex gap-0.5">
      {Array.from({ length: max }).map((_, i) => (
        <button
          key={i}
          type="button"
          disabled={!onChange}
          onClick={() => onChange?.(i + 1)}
          className={`${onChange ? 'cursor-pointer' : 'cursor-default'} focus:outline-none`}
          aria-label={`${i + 1} כוכבים`}
        >
          <Star className={`w-5 h-5 ${i < value ? 'text-yellow-400 fill-yellow-400' : 'text-gray-300'}`} />
        </button>
      ))}
    </div>
  )
}

// ─── Rate Modal ───────────────────────────────────────────────────────────────
function RateModal({ purchase, onClose }: { purchase: MarketplacePurchase; onClose: () => void }) {
  const { rateUser } = useMarketplace()
  const [rating, setRating] = useState(purchase.my_rating ?? 0)
  const [comment, setComment] = useState('')
  const [saving, setSaving] = useState(false)
  useBodyScrollLock()

  async function submit() {
    if (rating === 0) { toast.error('בחר דירוג'); return }
    setSaving(true)
    try {
      await rateUser(purchase.purchase_id, purchase.seller_id!, rating, comment || undefined)
      toast.success('הדירוג נשמר')
      onClose()
    } catch {
      toast.error('שגיאה בשמירת הדירוג')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-[100] flex items-end justify-center overflow-hidden" onClick={onClose}>
      <div
        className="bg-white rounded-t-3xl w-full max-w-2xl flex flex-col max-h-[85dvh]"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-6 pb-4 shrink-0">
          <h2 className="font-bold text-lg">דרג את המוכר</h2>
          <button onClick={onClose} className="p-2 rounded-full hover:bg-gray-100"><X className="w-5 h-5" /></button>
        </div>

        {/* Scrollable body */}
        <div className="modal-scroll overflow-y-auto flex-1 min-h-0 px-6 pb-4 space-y-4">
          <p className="text-sm text-gray-500">
            {purchase.seller_name || purchase.seller_email} · {purchase.store_name}
          </p>
          <StarRating value={rating} onChange={setRating} />
          <textarea
            className="w-full border rounded-xl p-3 text-sm resize-none h-24 focus:outline-none focus:ring-2 focus:ring-green-400"
            placeholder="הוסף תגובה (אופציונלי)..."
            value={comment}
            onChange={e => setComment(e.target.value)}
          />
        </div>

        {/* Sticky footer */}
        <div className="px-6 pb-6 pt-3 shrink-0 border-t border-gray-100">
          <button
            onClick={submit}
            disabled={saving || rating === 0}
            className="w-full py-3 bg-green-600 text-white rounded-2xl font-semibold disabled:opacity-50"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : 'שמור דירוג'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Report Modal ─────────────────────────────────────────────────────────────
function ReportModal({
  reportedUserId, reportedName, purchaseId, listingId, onClose,
}: {
  reportedUserId: string
  reportedName: string
  purchaseId?: string
  listingId?: string
  onClose: () => void
}) {
  const { reportUser } = useMarketplace()
  const [reason, setReason] = useState('')
  const [details, setDetails] = useState('')
  const [saving, setSaving] = useState(false)
  useBodyScrollLock()

  const reasons = [
    'תשלום לא התקבל',
    'שובר לא תקין / פג תוקף',
    'הונאה / מרמה',
    'התנהגות פוגעת',
    'מידע כוזב במודעה',
    'אחר',
  ]

  async function submit() {
    if (!reason) { toast.error('בחר סיבה'); return }
    setSaving(true)
    try {
      await reportUser(reportedUserId, reason, details || undefined, purchaseId, listingId)
      toast.success('הדיווח נשלח למנהל')
      onClose()
    } catch {
      toast.error('שגיאה בשליחת הדיווח')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-[100] flex items-end justify-center overflow-hidden" onClick={onClose}>
      <div
        className="bg-white rounded-t-3xl w-full max-w-2xl flex flex-col max-h-[85dvh]"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-6 pb-4 shrink-0">
          <h2 className="font-bold text-lg flex items-center gap-2">
            <Flag className="w-5 h-5 text-red-500" /> דווח על משתמש
          </h2>
          <button onClick={onClose} className="p-2 rounded-full hover:bg-gray-100"><X className="w-5 h-5" /></button>
        </div>

        {/* Scrollable body */}
        <div className="modal-scroll overflow-y-auto flex-1 min-h-0 px-6 pb-4 space-y-3">
          <p className="text-sm text-gray-500">דיווח על: {reportedName}</p>
          <div className="space-y-2">
            {reasons.map(r => (
              <button
                key={r}
                onClick={() => setReason(r)}
                className={`w-full text-right px-4 py-2.5 rounded-xl border text-sm transition-colors ${
                  reason === r ? 'border-red-500 bg-red-50 text-red-700 font-medium' : 'border-gray-200 hover:bg-gray-50'
                }`}
              >
                {r}
              </button>
            ))}
          </div>
          <textarea
            className="w-full border rounded-xl p-3 text-sm resize-none h-20 focus:outline-none focus:ring-2 focus:ring-red-400"
            placeholder="פרטים נוספים (אופציונלי)..."
            value={details}
            onChange={e => setDetails(e.target.value)}
          />
        </div>

        {/* Sticky footer */}
        <div className="px-6 pb-6 pt-3 shrink-0 border-t border-gray-100">
          <button
            onClick={submit}
            disabled={saving || !reason}
            className="w-full py-3 bg-red-600 text-white rounded-2xl font-semibold disabled:opacity-50"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : 'שלח דיווח'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Conversations list modal (seller picks which buyer to chat with) ─────────
function ConversationsModal({
  listing,
  onSelectConversation,
  onClose,
}: {
  listing: MarketplaceListing
  onSelectConversation: (buyerId: string, buyerName: string) => void
  onClose: () => void
}) {
  const { getListingConversations } = useMarketplace()
  const [convs, setConvs] = useState<ListingConversation[]>([])
  const [loading, setLoading] = useState(true)
  useBodyScrollLock()

  useEffect(() => {
    getListingConversations(listing.id)
      .then(data => {
        setConvs(data)
        // If exactly one conversation, jump straight to it
        if (data.length === 1) {
          onSelectConversation(
            data[0].other_user_id,
            data[0].other_user_name || data[0].other_user_email || 'קונה',
          )
        }
      })
      .catch(() => toast.error('שגיאה בטעינת השיחות'))
      .finally(() => setLoading(false))
  }, [])

  return (
    <div className="fixed inset-0 bg-black/50 z-[100] flex items-end justify-center overflow-hidden" onClick={onClose}>
      <div
        className="bg-white rounded-t-3xl w-full max-w-2xl flex flex-col max-h-[85dvh]"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 pt-6 pb-4 shrink-0">
          <div>
            <h2 className="font-bold text-lg">שיחות</h2>
            <p className="text-xs text-gray-500">{listing.store_name}</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-full hover:bg-gray-100"><X className="w-5 h-5" /></button>
        </div>

        <div className="modal-scroll overflow-y-auto flex-1 min-h-0 px-4 pb-6 space-y-2">
          {loading ? (
            <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 animate-spin text-green-500" /></div>
          ) : convs.length === 0 ? (
            <div className="text-center py-10 text-gray-400 space-y-2">
              <MessageCircle className="w-10 h-10 mx-auto opacity-30" />
              <p className="text-sm">אין שיחות עדיין</p>
            </div>
          ) : (
            convs.map(c => {
              const hasUnread = (c.unread_count ?? 0) > 0
              return (
                <button
                  key={c.other_user_id}
                  onClick={() => onSelectConversation(
                    c.other_user_id,
                    c.other_user_name || c.other_user_email || 'קונה',
                  )}
                  className={`w-full flex items-center gap-3 p-3 rounded-xl hover:bg-gray-50 border transition-colors text-right ${
                    hasUnread ? 'border-green-300 bg-green-50' : 'border-gray-100'
                  }`}
                >
                  <div className="relative shrink-0">
                    <div className="w-9 h-9 bg-gradient-to-br from-blue-400 to-indigo-500 rounded-full flex items-center justify-center text-white font-bold text-sm">
                      {(c.other_user_name || c.other_user_email || '?')[0].toUpperCase()}
                    </div>
                    {hasUnread && (
                      <span className="absolute -top-1 -right-1 min-w-[16px] h-4 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center px-0.5">
                        {(c.unread_count ?? 0) > 9 ? '9+' : c.unread_count}
                      </span>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm truncate ${hasUnread ? 'font-bold text-gray-900' : 'font-medium text-gray-900'}`}>
                      {c.other_user_name || c.other_user_email}
                    </p>
                    <p className={`text-xs truncate ${hasUnread ? 'text-gray-700 font-medium' : 'text-gray-400'}`}>
                      {c.last_body}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <span className="text-xs text-gray-400">{c.message_count} הודעות</span>
                    <ChevronRight className="w-4 h-4 text-gray-300" />
                  </div>
                </button>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Discount badge helper ────────────────────────────────────────────────────
function discountPct(balance: number | undefined, askingPrice: number): number {
  if (!balance || balance <= 0 || askingPrice >= balance) return 0
  return Math.round(((balance - askingPrice) / balance) * 100)
}

// ─── Listing Card (marketplace browse) ───────────────────────────────────────
const CARD_PALETTE = ['#8b5cf6','#f59e0b','#3b82f6','#ec4899','#10b981','#0ea5e9','#6366f1','#f43f5e','#a855f7','#ef4444','#84cc16','#f97316']
function listingColor(name: string) {
  let h = 0; for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0
  return CARD_PALETTE[h % CARD_PALETTE.length]
}

function ListingCard({ listing, onClick }: { listing: MarketplaceListing; onClick: () => void }) {
  const expiryDate = listing.expiry_date ? new Date(listing.expiry_date) : null
  const daysLeft = expiryDate ? Math.ceil((expiryDate.getTime() - Date.now()) / 86400000) : null
  const isExpiringSoon = daysLeft !== null && daysLeft >= 0 && daysLeft <= 30
  const isExpired = daysLeft !== null && daysLeft < 0
  const pct = discountPct(listing.balance, listing.asking_price)
  const color = listingColor(listing.store_name ?? '')
  const sellerInitial = (listing.seller_name || listing.seller_email || '?')[0].toUpperCase()
  const sellerLabel = listing.seller_name || listing.seller_email?.split('@')[0] || '?'

  const expiryColor = isExpired ? '#ef4444' : isExpiringSoon ? '#d97706' : '#8da5a2'
  const expiryBg = isExpired ? '#fef2f2' : isExpiringSoon ? '#fffbeb' : '#f2f4f3'
  const expiryLabel = expiryDate
    ? (isExpired ? 'פג תוקף' : daysLeft === 0 ? 'פג היום' : formatDate(listing.expiry_date))
    : ''

  return (
    <button
      onClick={onClick}
      className="w-full text-right gs-tap"
      style={{
        background: 'var(--c-surface)',
        borderRadius: 'var(--r-card)',
        boxShadow: 'var(--shadow-card)',
        overflow: 'hidden',
        position: 'relative',
        border: 'none',
        cursor: 'pointer',
        display: 'block',
      }}
    >
      {/* Top color bar */}
      <div style={{ height: 4, background: `linear-gradient(90deg, ${color}, ${color}88)` }} />

      {/* Discount sticker */}
      {pct > 0 && (
        <div style={{
          position: 'absolute', top: 18, left: 14,
          background: 'var(--c-primary)',
          color: '#fff',
          borderRadius: '50% 50% 50% 0',
          width: 52, height: 52,
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 2px 8px rgba(22,163,74,0.35)',
          transform: 'rotate(-8deg)',
          zIndex: 2,
        }}>
          <span style={{ fontSize: 15, fontWeight: 900, lineHeight: 1 }}>-{pct}%</span>
        </div>
      )}

      <div style={{ padding: pct > 0 ? '14px 14px 14px 72px' : '14px 14px 14px 14px' }}>
        {/* Store + price */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 17, fontWeight: 800, color: 'var(--c-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {listing.store_name}
            </div>
            <div style={{ fontSize: 13, color: 'var(--c-text3)', marginTop: 2 }}>
              שובר · ₪{listing.balance}
            </div>
          </div>
          <div style={{ textAlign: 'left', flexShrink: 0, marginRight: 8 }}>
            <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--c-primary)', lineHeight: 1 }}>
              ₪{listing.asking_price}
            </div>
            <div style={{ fontSize: 11, color: 'var(--c-text3)', textAlign: 'left', marginTop: 2, textDecoration: 'line-through' }}>
              ₪{listing.balance}
            </div>
          </div>
        </div>

        {/* Divider */}
        <div style={{ height: 1, background: 'var(--c-border)', margin: '0 0 10px' }} />

        {/* Seller row */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{
              width: 28, height: 28, borderRadius: '50%',
              background: color + '20', border: `1.5px solid ${color}50`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 12, fontWeight: 800, color: color, flexShrink: 0,
            }}>
              {sellerInitial}
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--c-text)' }}>{sellerLabel}</span>
                {listing.is_verified_seller && (
                  <div style={{ width: 16, height: 16, borderRadius: '50%', background: '#2563eb', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M2 5l2 2 4-4" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  </div>
                )}
              </div>
              {(listing.avg_rating ?? 0) > 0 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 3, marginTop: 1 }}>
                  <Star className="w-3 h-3 text-yellow-400 fill-yellow-400" />
                  <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--c-text2)' }}>{Number(listing.avg_rating).toFixed(1)}</span>
                  <span style={{ fontSize: 11, color: 'var(--c-text3)' }}>({listing.rating_count})</span>
                </div>
              )}
            </div>
          </div>
          {expiryLabel && (
            <span style={{
              fontSize: 11, color: expiryColor, background: expiryBg,
              padding: '3px 8px', borderRadius: 100, fontWeight: 500,
              border: isExpiringSoon || isExpired ? `1px solid ${expiryColor}40` : 'none',
            }}>
              {isExpiringSoon ? '⚠ ' : ''}{expiryLabel}
            </span>
          )}
        </div>
      </div>
    </button>
  )
}

// ─── My Listing Row (seller view) ────────────────────────────────────────────
function MyListingRow({
  listing,
  onRemove,
  onConfirm,
  onReport,
  onChat,
  unreadCount = 0,
  onUpdatePrice,
}: {
  listing: MarketplaceListing
  onRemove: () => void
  onConfirm: () => void
  onReport: () => void
  onChat: () => void
  unreadCount?: number
  onUpdatePrice: (newPrice: number) => Promise<void>
}) {
  const [removing, setRemoving] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [showPriceInput, setShowPriceInput] = useState(false)
  const [newPriceInput, setNewPriceInput] = useState('')
  const [updatingPrice, setUpdatingPrice] = useState(false)

  const statusLabel: Record<string, string> = {
    active: 'פעיל',
    pending_payment: 'ממתין לאישור',
    sold: 'נמכר',
    cancelled: 'בוטל',
  }
  const statusColor: Record<string, string> = {
    active: 'bg-green-100 text-green-700',
    pending_payment: 'bg-yellow-100 text-yellow-700',
    sold: 'bg-gray-100 text-gray-500',
    cancelled: 'bg-red-100 text-red-600',
  }

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-gray-900 truncate">{listing.store_name}</p>
          <p className="text-xs text-gray-500 mt-0.5">יתרה: ₪{listing.balance} · מחיר: ₪{listing.asking_price}</p>
        </div>
        <span className={`text-xs font-medium px-2 py-1 rounded-full shrink-0 ${statusColor[listing.status]}`}>
          {statusLabel[listing.status]}
        </span>
      </div>

      {/* Buyer confirmed payment — needs seller confirmation */}
      {listing.purchase_status === 'buyer_confirmed' && listing.buyer_name && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-3 space-y-2">
          <p className="text-sm font-medium text-yellow-800">
            {listing.buyer_name || listing.buyer_email} שלח/ה תשלום
          </p>
          {listing.payment_method_used && (
            <p className="text-xs text-yellow-700">
              שיטת תשלום: <span className="font-semibold">{listing.payment_method_used}</span>
            </p>
          )}
          <div className="flex gap-2">
            <button
              disabled={confirming}
              onClick={async () => {
                setConfirming(true)
                try { await onConfirm() } finally { setConfirming(false) }
              }}
              className="flex-1 py-2 bg-green-600 text-white rounded-xl text-sm font-semibold disabled:opacity-50"
            >
              {confirming ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : 'אשר קבלת תשלום'}
            </button>
            <button
              onClick={onReport}
              className="p-2 rounded-xl border border-red-200 text-red-500 hover:bg-red-50"
              aria-label="דווח על קונה"
            >
              <Flag className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Update price inline */}
      {listing.status === 'active' && showPriceInput && (
        <div className="flex gap-2">
          <input
            type="number"
            inputMode="decimal"
            value={newPriceInput}
            onChange={e => setNewPriceInput(e.target.value)}
            placeholder={`מחיר נוכחי: ₪${listing.asking_price}`}
            className="flex-1 border rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-400"
            autoFocus
          />
          <button
            disabled={updatingPrice || !newPriceInput}
            onClick={async () => {
              const price = parseFloat(newPriceInput)
              if (!price || price <= 0) { return }
              setUpdatingPrice(true)
              try {
                await onUpdatePrice(price)
                setShowPriceInput(false)
                setNewPriceInput('')
              } finally {
                setUpdatingPrice(false)
              }
            }}
            className="px-3 py-2 bg-green-600 text-white rounded-xl text-sm font-semibold disabled:opacity-50"
          >
            {updatingPrice ? <Loader2 className="w-4 h-4 animate-spin" /> : 'עדכן'}
          </button>
          <button
            onClick={() => { setShowPriceInput(false); setNewPriceInput('') }}
            className="px-3 py-2 border border-gray-200 rounded-xl text-sm text-gray-500"
          >
            ביטול
          </button>
        </div>
      )}

      {/* Action buttons row */}
      <div className="flex gap-2 flex-wrap">
        {/* Chat button — always visible for active/pending listings */}
        {(listing.status === 'active' || listing.status === 'pending_payment') && (
          <button
            onClick={onChat}
            className="relative flex items-center gap-1.5 px-3 py-2 rounded-xl border border-gray-200 text-gray-600 text-sm hover:bg-gray-50 transition-colors"
          >
            <MessageCircle className="w-4 h-4 text-green-600" />
            שיחות
            {unreadCount > 0 && (
              <span className="absolute -top-1.5 -right-1.5 min-w-[16px] h-4 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center px-0.5">
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
          </button>
        )}

        {/* Update price button for active listings */}
        {listing.status === 'active' && !showPriceInput && (
          <button
            onClick={() => setShowPriceInput(true)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-gray-200 text-gray-600 text-sm hover:bg-gray-50 transition-colors"
          >
            <Pencil className="w-3.5 h-3.5" />
            עדכן מחיר
          </button>
        )}

        {/* Remove from sale for active listing with no pending purchase */}
        {listing.status === 'active' && !listing.purchase_status && (
          <button
            disabled={removing}
            onClick={async () => {
              setRemoving(true)
              try { await onRemove() } finally { setRemoving(false) }
            }}
            className="flex-1 py-2 border border-red-200 text-red-500 rounded-xl text-sm font-medium hover:bg-red-50 disabled:opacity-50"
          >
            {removing ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : 'הסר ממכירה'}
          </button>
        )}
      </div>

      {listing.status === 'sold' && (
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <CheckCircle className="w-4 h-4 text-green-500" />
          השובר הועבר לקונה בהצלחה
        </div>
      )}
    </div>
  )
}

// ─── My Purchase Row (buyer view) ────────────────────────────────────────────
function MyPurchaseRow({
  purchase,
  onRate,
  onReport,
  onCancel,
  onChat,
  unreadCount = 0,
}: {
  purchase: MarketplacePurchase
  onRate: () => void
  onReport: () => void
  onCancel: () => void
  onChat: () => void
  unreadCount?: number
}) {
  const statusLabel: Record<string, string> = {
    pending_buyer_payment: 'ממתין לתשלום',
    buyer_confirmed: 'ממתין לאישור מוכר',
    completed: 'הושלם',
    cancelled: 'בוטל',
  }
  const statusColor: Record<string, string> = {
    pending_buyer_payment: 'bg-blue-100 text-blue-700',
    buyer_confirmed: 'bg-yellow-100 text-yellow-700',
    completed: 'bg-green-100 text-green-700',
    cancelled: 'bg-gray-100 text-gray-500',
  }

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-gray-900 truncate">{purchase.store_name}</p>
          <p className="text-xs text-gray-500 mt-0.5">
            ₪{purchase.asking_price} · מוכר: {purchase.seller_name || purchase.seller_email?.split('@')[0]}
          </p>
        </div>
        <span className={`text-xs font-medium px-2 py-1 rounded-full shrink-0 ${statusColor[purchase.status]}`}>
          {statusLabel[purchase.status]}
        </span>
      </div>

      {purchase.status === 'buyer_confirmed' && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-sm text-blue-700">
          <AlertCircle className="w-4 h-4 inline ml-1" />
          ממתין לאישור המוכר — הוא/היא יאשרו ברגע שיבדקו את התשלום
        </div>
      )}

      {purchase.status === 'completed' && (
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <CheckCircle className="w-4 h-4 text-green-500" />
          השובר הועבר לארנק שלך
        </div>
      )}

      <div className="flex gap-2 flex-wrap">
        {/* Chat with seller (before completion) */}
        {purchase.status !== 'cancelled' && purchase.seller_id && (
          <button
            onClick={onChat}
            className="relative flex items-center gap-1.5 px-3 py-2 rounded-xl border border-gray-200 text-gray-600 text-sm hover:bg-gray-50 transition-colors"
          >
            <MessageCircle className="w-4 h-4 text-green-600" />
            שוחח עם המוכר
            {unreadCount > 0 && (
              <span className="absolute -top-1.5 -right-1.5 min-w-[16px] h-4 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center px-0.5">
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
          </button>
        )}

        {purchase.status === 'completed' && (
          <button
            onClick={onRate}
            className="flex-1 py-2 bg-yellow-50 border border-yellow-200 text-yellow-700 rounded-xl text-sm font-medium hover:bg-yellow-100 flex items-center justify-center gap-1"
          >
            <Star className="w-4 h-4" />
            {purchase.my_rating ? `דירגת (${purchase.my_rating}★)` : 'דרג מוכר'}
          </button>
        )}
        {(purchase.status === 'buyer_confirmed' || purchase.status === 'completed') && (
          <button
            onClick={onReport}
            className="p-2 rounded-xl border border-red-200 text-red-500 hover:bg-red-50"
            aria-label="דווח על מוכר"
          >
            <Flag className="w-4 h-4" />
          </button>
        )}
        {purchase.status === 'buyer_confirmed' && (
          <button
            onClick={onCancel}
            className="px-3 py-2 border border-gray-200 text-gray-500 rounded-xl text-sm hover:bg-gray-50"
          >
            בטל
          </button>
        )}
      </div>
    </div>
  )
}

// ─── Access Request Screen ─────────────────────────────────────────────────────
function MarketplaceAccessGate() {
  const { myAccessStatus, requestMarketplaceAccess } = useMarketplace()
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)

  async function handleRequest() {
    setSending(true)
    try {
      await requestMarketplaceAccess(message.trim() || undefined)
      toast.success('הבקשה נשלחה למנהל')
    } catch {
      toast.error('שגיאה בשליחת הבקשה')
    } finally {
      setSending(false)
    }
  }

  if (myAccessStatus === 'pending') {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
        <div className="w-16 h-16 bg-amber-50 rounded-2xl flex items-center justify-center mb-4">
          <ShoppingBag className="w-8 h-8 text-amber-500" />
        </div>
        <h2 className="text-lg font-bold text-gray-800 mb-2">הבקשה בהמתנה</h2>
        <p className="text-sm text-gray-500 max-w-xs">הבקשה שלך נשלחה למנהל ותטופל בקרוב. תקבל גישה ברגע שתאושר.</p>
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
      <div className="w-16 h-16 bg-purple-50 rounded-2xl flex items-center justify-center mb-4">
        <ShoppingBag className="w-8 h-8 text-purple-500" />
      </div>
      <h2 className="text-lg font-bold text-gray-800 mb-1">שוק השוברים</h2>
      {myAccessStatus === 'rejected' && (
        <p className="text-sm text-red-500 mb-3">הבקשה הקודמת שלך נדחתה. ניתן לשלוח בקשה חדשה.</p>
      )}
      <p className="text-sm text-gray-500 mb-6 max-w-xs">
        שוק השוברים מוגבל למשתמשים מורשים. שלח בקשת גישה למנהל.
      </p>
      <textarea
        value={message}
        onChange={e => setMessage(e.target.value)}
        placeholder="הוסף הודעה למנהל (רשות)..."
        rows={3}
        className="w-full max-w-xs border border-gray-200 rounded-xl px-3 py-2 text-sm mb-4 resize-none focus:outline-none focus:ring-2 focus:ring-purple-300"
      />
      <button
        onClick={handleRequest}
        disabled={sending}
        className="flex items-center gap-2 bg-purple-600 text-white px-6 py-2.5 rounded-xl font-semibold text-sm disabled:opacity-50"
      >
        {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
        שלח בקשת גישה
      </button>
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function MarketplacePage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { isAdmin, user, profile } = useAuth()
  const { logAction } = useVouchers()
  const {
    listings, myListings, myPurchases,
    loadingListings, loadingMyListings, loadingMyPurchases,
    fetchListings, fetchMyListings, fetchMyPurchases,
    removeFromSale, confirmPaymentReceived, cancelPurchase,
    unreadByListing, updateListingPrice,
    marketplaceMode, myAccessStatus,
  } = useMarketplace()

  const [tab, setTab] = useState<'all' | 'mine' | 'purchases' | 'watchlist'>(
    (location.state as { initialTab?: string } | null)?.initialTab as 'purchases' | undefined ?? 'all'
  )
  const [search, setSearch] = useState('')
  type MarketSortKey = 'discount' | 'balance' | 'expiry' | 'newest'
  const [sortKey, setSortKey] = useState<MarketSortKey>('newest')
  const [showSort, setShowSort] = useState(false)
  const [ratingPurchase, setRatingPurchase] = useState<MarketplacePurchase | null>(null)
  const [reportTarget, setReportTarget] = useState<{
    userId: string; name: string; purchaseId?: string; listingId?: string
  } | null>(null)
  // Watchlist
  const [watchlist, setWatchlist] = useState<WatchlistItem[]>([])
  const [watchlistLoaded, setWatchlistLoaded] = useState(false)
  const [showAddWatch, setShowAddWatch] = useState(false)
  const [watchForm, setWatchForm] = useState({ store_name: '', min_discount_pct: 0, notify_push: true, notify_email: false })
  const [savingWatch, setSavingWatch] = useState(false)
  const [deletingWatch, setDeletingWatch] = useState<string | null>(null)

  // Chat state
  const [chatTarget, setChatTarget] = useState<{
    listingId: string
    otherUserId: string
    otherUserName: string
    isSeller: boolean
    askingPrice: number
    storeName: string
  } | null>(null)

  // Conversations modal (seller picks buyer to chat with)
  const [convsListing, setConvsListing] = useState<MarketplaceListing | null>(null)

  // Payment methods
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>(
    () => (profile?.marketplace_payment_methods as PaymentMethod[]) || []
  )
  const [showPaymentSettings, setShowPaymentSettings] = useState(false)
  const [addingPayment, setAddingPayment] = useState(false)
  const [newPaymentType, setNewPaymentType] = useState<PaymentMethod['type']>('bit')
  const [newPaymentValue, setNewPaymentValue] = useState('')
  const [savingPayments, setSavingPayments] = useState(false)

  useEffect(() => {
    if (profile?.marketplace_payment_methods) {
      setPaymentMethods(profile.marketplace_payment_methods as PaymentMethod[])
    }
  }, [profile])

  async function savePaymentMethods(methods: PaymentMethod[]) {
    setSavingPayments(true)
    try {
      const { error } = await supabase.from('profiles').update({ marketplace_payment_methods: methods }).eq('id', user!.id)
      if (error) throw error
      setPaymentMethods(methods)
      toast.success('שיטות תשלום עודכנו')
    } catch {
      toast.error('שגיאה בשמירת שיטות תשלום')
    } finally {
      setSavingPayments(false)
    }
  }

  function addPaymentMethod() {
    if (!newPaymentValue.trim()) { toast.error('הזן ערך'); return }
    const newMethod: PaymentMethod = { type: newPaymentType, value: newPaymentValue.trim() }
    savePaymentMethods([...paymentMethods, newMethod]).then(() => {
      logAction('system_payment_method_add', 'מערכת', undefined, { type: PAYMENT_METHOD_LABELS[newPaymentType] })
    }).catch(() => {})
    setNewPaymentValue('')
    setAddingPayment(false)
  }

  function removePaymentMethod(index: number) {
    const removed = paymentMethods[index]
    savePaymentMethods(paymentMethods.filter((_, i) => i !== index)).then(() => {
      logAction('system_payment_method_remove', 'מערכת', undefined, { type: PAYMENT_METHOD_LABELS[removed.type] })
    }).catch(() => {})
  }

  // Redirect non-admins when marketplace is fully disabled
  useEffect(() => {
    if (marketplaceMode === 'disabled' && !isAdmin) navigate('/', { replace: true })
  }, [marketplaceMode, isAdmin, navigate])

  // Prefetch all three tabs in parallel on first mount — tab switches will be instant
  useEffect(() => {
    Promise.all([fetchListings(), fetchMyListings(), fetchMyPurchases()])
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // When the user explicitly switches to a tab, ensure its data is up-to-date
  useEffect(() => {
    if (tab === 'all') fetchListings(search || undefined)
    else if (tab === 'mine') fetchMyListings()
    else fetchMyPurchases()
  }, [tab]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (tab !== 'all') return
    const t = setTimeout(() => fetchListings(search || undefined), 400)
    return () => clearTimeout(t)
  }, [search]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (tab !== 'watchlist' || watchlistLoaded) return
    supabase.rpc('get_my_watchlist').then(({ data }) => {
      if (data) setWatchlist(data)
      setWatchlistLoaded(true)
    })
  }, [tab, watchlistLoaded])

  async function addWatchItem() {
    if (!watchForm.store_name.trim()) { toast.error('הכנס שם חנות'); return }
    setSavingWatch(true)
    try {
      const { data, error } = await supabase.rpc('add_watchlist_item', {
        p_store_name: watchForm.store_name.trim(),
        p_min_discount_pct: watchForm.min_discount_pct,
        p_notify_push: watchForm.notify_push,
        p_notify_email: watchForm.notify_email,
      })
      if (error) throw error
      if (data) setWatchlist(prev => [data, ...prev])
      setShowAddWatch(false)
      setWatchForm({ store_name: '', min_discount_pct: 0, notify_push: true, notify_email: false })
      toast.success('התראה נוספה')
    } catch (e: unknown) {
      const msg = (e as { message?: string })?.message || ''
      toast.error(msg.includes('pro_required') ? 'פונקציה זו זמינה למנויי פרו בלבד' : 'שגיאה בהוספה')
    } finally {
      setSavingWatch(false)
    }
  }

  async function deleteWatchItem(id: string) {
    setDeletingWatch(id)
    try {
      await supabase.rpc('delete_watchlist_item', { p_id: id })
      setWatchlist(prev => prev.filter(w => w.id !== id))
    } catch {
      toast.error('שגיאה במחיקה')
    } finally {
      setDeletingWatch(null)
    }
  }

  // Selective mode: non-approved users see the access request screen
  if (marketplaceMode === 'selective' && !isAdmin && myAccessStatus !== 'approved') {
    return (
      <div className="flex flex-col min-h-dvh bg-gray-50">
        <div className="bg-white border-b px-4 py-4">
          <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
            <ShoppingBag className="w-5 h-5 text-purple-600" />
            שוק השוברים
          </h1>
        </div>
        <MarketplaceAccessGate />
      </div>
    )
  }

  return (
    <div className="flex-1" style={{ background: 'var(--c-bg)' }} dir="rtl">
      {/* Header */}
      <div className="sticky top-0 z-20" style={{ background: 'var(--c-surface)', borderBottom: '1px solid var(--c-border)' }}>
        <div style={{ padding: '16px 20px 0' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <div>
              <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--c-text)' }}>מרקטפלייס</div>
              {listings.length > 0 && (
                <div style={{ fontSize: 13, color: 'var(--c-text3)', marginTop: 2 }}>{listings.length} מבצעים פעילים</div>
              )}
            </div>
            {tab === 'all' && (
              <button
                onClick={() => setShowSort(s => !s)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  background: showSort ? 'var(--c-primary-light)' : 'var(--c-bg)',
                  border: `1.5px solid ${showSort ? 'var(--c-primary)' : 'var(--c-border)'}`,
                  borderRadius: 10, padding: '8px 12px', cursor: 'pointer',
                  color: showSort ? 'var(--c-primary)' : 'var(--c-text2)',
                  fontFamily: 'Heebo, sans-serif', transition: 'all 0.15s',
                }}
              >
                <SlidersHorizontal size={14} />
                <span style={{ fontSize: 13, fontWeight: 500 }}>
                  {sortKey === 'discount' ? 'הנחה' : sortKey === 'balance' ? 'יתרה' : sortKey === 'expiry' ? 'תפוגה' : 'חדש'}
                </span>
              </button>
            )}
          </div>
          {showSort && tab === 'all' && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', paddingBottom: 12 }}>
              {([
                { key: 'newest',   label: '🕐 חדש ביותר' },
                { key: 'discount', label: '💰 הנחה גבוהה' },
                { key: 'balance',  label: '₪ יתרה גבוהה' },
                { key: 'expiry',   label: '📅 פג תוקף בקרוב' },
              ] as { key: MarketSortKey; label: string }[]).map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => { setSortKey(key); setShowSort(false) }}
                  style={{
                    fontSize: 12, padding: '6px 12px', borderRadius: 999, fontWeight: 500,
                    background: sortKey === key ? 'var(--c-primary-light)' : 'var(--c-bg)',
                    color: sortKey === key ? 'var(--c-primary)' : 'var(--c-text3)',
                    border: sortKey === key ? '1px solid var(--c-primary)' : '1px solid transparent',
                    cursor: 'pointer', transition: 'all 0.15s', fontFamily: 'Heebo, sans-serif',
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          )}

          {/* Tabs */}
          <div style={{ display: 'flex', gap: 0 }}>
            {([['all', 'שוק'], ['mine', 'שלי'], ['purchases', 'רכישות'], ['watchlist', 'התראות']] as const).map(([t, label]) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                style={{
                  flex: 1, padding: '10px 0', border: 'none', background: 'none',
                  cursor: 'pointer', position: 'relative', fontFamily: 'Heebo, sans-serif',
                  fontSize: 14, fontWeight: tab === t ? 700 : 400,
                  color: tab === t ? 'var(--c-primary)' : 'var(--c-text3)',
                  transition: 'color 0.2s',
                }}
              >
                {label}
                {tab === t && (
                  <div style={{ position: 'absolute', bottom: 0, left: '50%', transform: 'translateX(-50%)', width: 28, height: 3, borderRadius: '3px 3px 0 0', background: 'var(--c-primary)' }} />
                )}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Search */}
      {tab === 'all' && (
        <div style={{ padding: '12px 16px', background: 'var(--c-surface)', borderBottom: '1px solid var(--c-border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'var(--c-bg)', borderRadius: 12, padding: '0 12px' }}>
            <Search size={16} color="var(--c-text3)" />
            <input
              type="text"
              style={{ flex: 1, height: 40, border: 'none', background: 'transparent', fontSize: 15, color: 'var(--c-text)', fontFamily: 'Heebo, sans-serif', outline: 'none', direction: 'rtl' }}
              placeholder="חפש לפי שם חנות..."
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            {search && (
              <button onClick={() => setSearch('')} style={{ border: 'none', background: 'none', cursor: 'pointer', padding: 2 }}>
                <X size={15} color="var(--c-text3)" />
              </button>
            )}
          </div>
        </div>
      )}

      <div className="p-4 space-y-3 pb-32">
        {/* ── All listings ── */}
        {tab === 'all' && (() => {
          const sorted = [...listings].sort((a, b) => {
            switch (sortKey) {
              case 'discount': {
                const pctA = a.balance && a.balance > 0 ? (a.balance - a.asking_price) / a.balance : 0
                const pctB = b.balance && b.balance > 0 ? (b.balance - b.asking_price) / b.balance : 0
                return pctB - pctA
              }
              case 'balance': return (b.balance ?? 0) - (a.balance ?? 0)
              case 'expiry': {
                if (!a.expiry_date && !b.expiry_date) return 0
                if (!a.expiry_date) return 1
                if (!b.expiry_date) return -1
                return new Date(a.expiry_date).getTime() - new Date(b.expiry_date).getTime()
              }
              default: return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
            }
          })
          return (
            <>
              {loadingListings && listings.length === 0 ? (
                <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-green-500" /></div>
              ) : sorted.length === 0 ? (
                <div className="text-center py-12 text-gray-400 space-y-2">
                  <Tag className="w-10 h-10 mx-auto opacity-40" />
                  <p className="font-medium">אין שוברים למכירה כרגע</p>
                  {search && <p className="text-sm">נסה לחפש מילה אחרת</p>}
                </div>
              ) : (
                sorted.map(l => (
                  <ListingCard
                    key={l.id}
                    listing={l}
                    onClick={() => navigate(`/market/listing/${l.id}`)}
                  />
                ))
              )}
            </>
          )
        })()}

        {/* ── My listings ── */}
        {tab === 'mine' && (
          <>
            <div className="flex justify-between items-center">
              <button
                onClick={() => setShowPaymentSettings(v => !v)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  background: showPaymentSettings ? 'var(--c-primary-light)' : 'var(--c-bg)',
                  border: `1.5px solid ${showPaymentSettings ? 'var(--c-primary)' : 'var(--c-border)'}`,
                  borderRadius: 10, padding: '7px 12px', cursor: 'pointer',
                  color: showPaymentSettings ? 'var(--c-primary)' : 'var(--c-text2)',
                  fontFamily: 'Heebo, sans-serif', fontSize: 13, fontWeight: 500,
                }}
              >
                <Settings size={14} />
                שיטות תשלום
                {paymentMethods.length > 0 && (
                  <span style={{
                    background: 'var(--c-primary)', color: '#fff',
                    fontSize: 11, fontWeight: 700, borderRadius: 999,
                    padding: '1px 6px', marginRight: 2,
                  }}>
                    {paymentMethods.length}
                  </span>
                )}
              </button>
              <button
                onClick={() => navigate('/market/bulk')}
                className="flex items-center gap-1.5 px-3 py-2 bg-green-600 text-white text-sm font-medium rounded-xl"
              >
                <ShoppingBag className="w-3.5 h-3.5" /> פרסם מרובה
              </button>
            </div>

            {/* Payment methods panel */}
            {showPaymentSettings && (
              <div style={{ background: 'var(--c-surface)', borderRadius: 'var(--r-card)', boxShadow: 'var(--shadow-card)', overflow: 'hidden' }}>
                <div className="p-4 space-y-3">
                  <p className="text-xs text-gray-500">שיטות תשלום יוצגו לקונים כאשר ירצו לרכוש ממך שובר</p>

                  {paymentMethods.length === 0 && !addingPayment && (
                    <p className="text-sm text-gray-400 text-center py-2">טרם הגדרת שיטות תשלום</p>
                  )}

                  {paymentMethods.map((m, i) => (
                    <div key={i} className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl">
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center text-white font-bold text-xs shrink-0 ${m.type === 'paypal' ? 'bg-blue-500' : m.type === 'bit' ? 'bg-purple-500' : m.type === 'paybox' ? 'bg-orange-500' : 'bg-teal-500'}`}>
                        {PAYMENT_METHOD_LABELS[m.type][0]}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium">{PAYMENT_METHOD_LABELS[m.type]}</p>
                        <p className="text-xs text-gray-500 truncate">{m.value}</p>
                      </div>
                      <button
                        onClick={() => removePaymentMethod(i)}
                        className="p-1.5 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-500"
                        aria-label="הסר שיטת תשלום"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}

                  {addingPayment && (
                    <div className="space-y-2 border border-green-200 rounded-xl p-3">
                      <select
                        value={newPaymentType}
                        onChange={e => setNewPaymentType(e.target.value as PaymentMethod['type'])}
                        className="w-full border rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-400"
                      >
                        {(Object.entries(PAYMENT_METHOD_LABELS) as [PaymentMethod['type'], string][]).map(([type, label]) => (
                          <option key={type} value={type}>{label}</option>
                        ))}
                      </select>
                      <input
                        type={newPaymentType === 'paypal' ? 'email' : 'tel'}
                        value={newPaymentValue}
                        onChange={e => setNewPaymentValue(e.target.value)}
                        placeholder={newPaymentType === 'paypal' ? 'כתובת PayPal (email)' : 'מספר טלפון'}
                        className="w-full border rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-400"
                        dir="ltr"
                      />
                      <div className="flex gap-2">
                        <button onClick={addPaymentMethod} disabled={savingPayments} className="flex-1 py-2 bg-green-500 text-white rounded-xl text-sm font-medium flex items-center justify-center gap-1">
                          <Check className="w-4 h-4" /> הוסף
                        </button>
                        <button onClick={() => { setAddingPayment(false); setNewPaymentValue('') }} className="flex-1 py-2 bg-gray-100 text-gray-600 rounded-xl text-sm font-medium flex items-center justify-center gap-1">
                          <X className="w-4 h-4" /> ביטול
                        </button>
                      </div>
                    </div>
                  )}

                  {!addingPayment && paymentMethods.length < 5 && (
                    <button
                      onClick={() => setAddingPayment(true)}
                      className="w-full flex items-center justify-center gap-2 py-2.5 border-2 border-dashed border-gray-200 rounded-xl text-sm text-gray-500 hover:border-green-400 hover:text-green-600 transition-colors"
                    >
                      <Plus className="w-4 h-4" />
                      הוסף שיטת תשלום
                    </button>
                  )}
                </div>
              </div>
            )}
            {loadingMyListings && myListings.length === 0 ? (
              <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-green-500" /></div>
            ) : myListings.length === 0 ? (
              <div className="text-center py-12 text-gray-400 space-y-2">
                <ShoppingBag className="w-10 h-10 mx-auto opacity-40" />
                <p className="font-medium">לא הצעת שוברים למכירה</p>
                <p className="text-sm">פתח שובר ולחץ "הצע למכירה"</p>
              </div>
            ) : (
              myListings.map(l => (
                <MyListingRow
                  key={l.id}
                  listing={l}
                  unreadCount={unreadByListing[l.id] ?? 0}
                  onRemove={async () => {
                    try { await removeFromSale(l.id); toast.success('הוסר מהמכירה') }
                    catch { toast.error('שגיאה בהסרה') }
                  }}
                  onConfirm={async () => {
                    try { await confirmPaymentReceived(l.purchase_id!); toast.success('אושר! השובר הועבר לקונה') }
                    catch { toast.error('שגיאה באישור') }
                  }}
                  onReport={() => setReportTarget({
                    userId: l.buyer_id || '',
                    name: l.buyer_name || l.buyer_email || 'קונה',
                    purchaseId: l.purchase_id,
                    listingId: l.id,
                  })}
                  onChat={() => setConvsListing(l)}
                  onUpdatePrice={async (price) => {
                    try {
                      await updateListingPrice(l.id, price)
                      await fetchMyListings()
                      toast.success('המחיר עודכן')
                    } catch {
                      toast.error('שגיאה בעדכון המחיר')
                    }
                  }}
                />
              ))
            )}
          </>
        )}

        {/* ── Watchlist ── */}
        {tab === 'watchlist' && (
          <>
            <div className="flex items-center justify-between mb-1">
              <h2 className="font-semibold text-gray-800 flex items-center gap-1.5">
                <Bell className="w-4 h-4 text-indigo-500" /> התראות מעקב
              </h2>
              <button
                onClick={() => setShowAddWatch(v => !v)}
                className="flex items-center gap-1 px-3 py-1.5 bg-indigo-600 text-white text-xs font-medium rounded-xl"
              >
                <Plus className="w-3.5 h-3.5" /> הוסף
              </button>
            </div>

            {showAddWatch && (
              <div className="bg-white rounded-2xl border border-indigo-100 p-4 space-y-3">
                <input
                  type="text"
                  placeholder="שם חנות (למשל: H&M)"
                  value={watchForm.store_name}
                  onChange={e => setWatchForm(f => ({ ...f, store_name: e.target.value }))}
                  className="w-full border rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                />
                <div className="flex items-center gap-2">
                  <label className="text-xs text-gray-600 shrink-0">אחוז הנחה מינימלי:</label>
                  <input
                    type="number" min={0} max={99} value={watchForm.min_discount_pct}
                    onChange={e => setWatchForm(f => ({ ...f, min_discount_pct: parseInt(e.target.value) || 0 }))}
                    className="w-20 border rounded-xl px-3 py-1.5 text-sm text-center focus:outline-none"
                  />
                  <span className="text-xs text-gray-400">%</span>
                </div>
                <div className="flex gap-4">
                  <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer">
                    <input type="checkbox" checked={watchForm.notify_push}
                      onChange={e => setWatchForm(f => ({ ...f, notify_push: e.target.checked }))}
                      className="rounded" />
                    התראה בדחיפה
                  </label>
                  <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer">
                    <input type="checkbox" checked={watchForm.notify_email}
                      onChange={e => setWatchForm(f => ({ ...f, notify_email: e.target.checked }))}
                      className="rounded" />
                    דוא"ל
                  </label>
                </div>
                <div className="flex gap-2">
                  <button onClick={addWatchItem} disabled={savingWatch}
                    className="flex-1 py-2 bg-indigo-600 text-white rounded-xl text-sm font-medium disabled:opacity-50">
                    {savingWatch ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : 'שמור'}
                  </button>
                  <button onClick={() => setShowAddWatch(false)}
                    className="px-4 py-2 border rounded-xl text-sm text-gray-500">
                    ביטול
                  </button>
                </div>
              </div>
            )}

            {!watchlistLoaded && (
              <div className="flex justify-center py-10"><Loader2 className="w-5 h-5 animate-spin text-indigo-500" /></div>
            )}
            {watchlistLoaded && watchlist.length === 0 && !showAddWatch && (
              <div className="text-center py-12 text-gray-400 space-y-2">
                <Bell className="w-10 h-10 mx-auto opacity-30" />
                <p className="font-medium">אין התראות פעילות</p>
                <p className="text-sm">לחץ "הוסף" כדי לעקוב אחרי חנות</p>
              </div>
            )}
            {watchlist.map(w => (
              <div key={w.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-gray-800 truncate">{w.store_name}</p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    הנחה מינ': {w.min_discount_pct}% ·
                    {w.notify_push ? ' 🔔 דחיפה' : ''}{w.notify_email ? ' 📧 דוא"ל' : ''}
                  </p>
                </div>
                <button
                  disabled={deletingWatch === w.id}
                  onClick={() => deleteWatchItem(w.id)}
                  className="p-2 rounded-xl border border-red-200 text-red-400 hover:bg-red-50 disabled:opacity-50"
                >
                  {deletingWatch === w.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                </button>
              </div>
            ))}
          </>
        )}

        {/* ── My purchases ── */}
        {tab === 'purchases' && (
          <>
            {loadingMyPurchases && myPurchases.length === 0 ? (
              <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-green-500" /></div>
            ) : myPurchases.length === 0 ? (
              <div className="text-center py-12 text-gray-400 space-y-2">
                <ShoppingBag className="w-10 h-10 mx-auto opacity-40" />
                <p className="font-medium">טרם ביצעת רכישות</p>
              </div>
            ) : (
              myPurchases.map(p => (
                <MyPurchaseRow
                  key={p.purchase_id}
                  purchase={p}
                  unreadCount={unreadByListing[p.listing_id] ?? 0}
                  onRate={() => setRatingPurchase(p)}
                  onReport={() => setReportTarget({
                    userId: p.seller_id!,
                    name: p.seller_name || p.seller_email || 'מוכר',
                    purchaseId: p.purchase_id,
                  })}
                  onCancel={async () => {
                    try { await cancelPurchase(p.purchase_id); toast.success('הרכישה בוטלה') }
                    catch { toast.error('שגיאה בביטול') }
                  }}
                  onChat={() => {
                    if (!p.seller_id) return
                    setChatTarget({
                      listingId: p.listing_id,
                      otherUserId: p.seller_id,
                      otherUserName: p.seller_name || p.seller_email?.split('@')[0] || 'מוכר',
                      isSeller: false,
                      askingPrice: p.asking_price ?? 0,
                      storeName: p.store_name ?? '',
                    })
                  }}
                />
              ))
            )}
          </>
        )}
      </div>

      {/* ── Modals ── */}
      {ratingPurchase && (
        <RateModal purchase={ratingPurchase} onClose={() => setRatingPurchase(null)} />
      )}
      {reportTarget && (
        <ReportModal
          reportedUserId={reportTarget.userId}
          reportedName={reportTarget.name}
          purchaseId={reportTarget.purchaseId}
          listingId={reportTarget.listingId}
          onClose={() => setReportTarget(null)}
        />
      )}

      {/* Conversations picker for seller */}
      {convsListing && !chatTarget && (
        <ConversationsModal
          listing={convsListing}
          onSelectConversation={(buyerId, buyerName) => {
            setConvsListing(null)
            setChatTarget({
              listingId: convsListing.id,
              otherUserId: buyerId,
              otherUserName: buyerName,
              isSeller: true,
              askingPrice: convsListing.asking_price ?? 0,
              storeName: convsListing.store_name ?? '',
            })
          }}
          onClose={() => setConvsListing(null)}
        />
      )}

      {/* Chat */}
      {chatTarget && (
        <ChatModal
          listingId={chatTarget.listingId}
          otherUserId={chatTarget.otherUserId}
          otherUserName={chatTarget.otherUserName}
          isSeller={chatTarget.isSeller}
          currentAskingPrice={chatTarget.askingPrice}
          storeName={chatTarget.storeName}
          onClose={() => setChatTarget(null)}
          onPriceUpdated={(newPrice) => {
            setChatTarget(prev => prev ? { ...prev, askingPrice: newPrice } : null)
            // Refresh listings so the updated price is visible
            if (tab === 'mine') fetchMyListings()
            if (tab === 'purchases') fetchMyPurchases()
          }}
        />
      )}
    </div>
  )
}
