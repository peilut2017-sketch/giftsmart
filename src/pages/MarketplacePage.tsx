import { useState, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useMarketplace } from '../contexts/MarketplaceContext'
import { useAuth } from '../contexts/AuthContext'
import { useVouchers } from '../contexts/VoucherContext'
import { useT } from '../lib/i18n'
import { formatDate } from '../utils/helpers'
import type { MarketplaceListing, MarketplacePurchase, ListingConversation, WatchlistItem, PaymentMethod } from '../types'
import { PAYMENT_METHOD_LABELS } from '../types'
import { supabase } from '../lib/supabase'
import ChatModal from '../components/ChatModal'
import Icon from '../components/ui/Icon'
import Button from '../components/ui/Button'
import BottomSheet from '../components/ui/BottomSheet'
import toast from 'react-hot-toast'
import { usePageView } from '../hooks/usePageView'

// ─── Rating Stars ────────────────────────────────────────────────────────────
function StarRating({ value, max = 5, onChange }: { value: number; max?: number; onChange?: (v: number) => void }) {
  const { t } = useT()
  return (
    <div className="flex gap-0.5">
      {Array.from({ length: max }).map((_, i) => (
        <button
          key={i}
          type="button"
          disabled={!onChange}
          onClick={() => onChange?.(i + 1)}
          className={`${onChange ? 'cursor-pointer' : 'cursor-default'} focus:outline-none`}
          aria-label={`${i + 1} ${t('market.stars')}`}
        >
          <Icon name="star" size={20} filled={i < value} color={i < value ? '#facc15' : 'var(--c-border)'} />
        </button>
      ))}
    </div>
  )
}

// ─── Rate Modal ───────────────────────────────────────────────────────────────
function RateModal({ purchase, onClose }: { purchase: MarketplacePurchase; onClose: () => void }) {
  const { rateUser } = useMarketplace()
  const { t } = useT()
  const [rating, setRating] = useState(purchase.my_rating ?? 0)
  const [comment, setComment] = useState('')
  const [saving, setSaving] = useState(false)

  async function submit() {
    if (rating === 0) { toast.error(t('market.rate.choose')); return }
    setSaving(true)
    try {
      await rateUser(purchase.purchase_id, purchase.seller_id!, rating, comment || undefined)
      toast.success(t('market.rate.saved'))
      onClose()
    } catch {
      toast.error(t('market.rate.error'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <BottomSheet
      open
      onClose={onClose}
      title={t('market.rate.seller')}
      footer={
        <Button onClick={submit} disabled={saving || rating === 0} loading={saving} fullWidth>
          {t('market.rate.save')}
        </Button>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-text3">
          {purchase.seller_name || purchase.seller_email} · {purchase.store_name}
        </p>
        <StarRating value={rating} onChange={setRating} />
        <textarea
          className="w-full border border-border rounded-xl p-3 text-sm bg-surface text-text resize-none h-24 focus:outline-none focus:ring-2 focus:ring-primary/30"
          placeholder={t('market.rate.comment.placeholder')}
          value={comment}
          onChange={e => setComment(e.target.value)}
        />
      </div>
    </BottomSheet>
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
  const { t } = useT()
  const [reason, setReason] = useState('')
  const [details, setDetails] = useState('')
  const [saving, setSaving] = useState(false)

  const reasons = [
    t('market.report.reason.payment'),
    t('market.report.reason.invalid'),
    t('market.report.reason.fraud'),
    t('market.report.reason.abusive'),
    t('market.report.reason.false'),
    t('market.report.reason.other'),
  ]

  async function submit() {
    if (!reason) { toast.error(t('market.report.choose')); return }
    setSaving(true)
    try {
      await reportUser(reportedUserId, reason, details || undefined, purchaseId, listingId)
      toast.success(t('market.report.sent'))
      onClose()
    } catch {
      toast.error(t('market.report.error'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <BottomSheet
      open
      onClose={onClose}
      title={t('market.report.title')}
      footer={
        <Button onClick={submit} disabled={saving || !reason} loading={saving} variant="danger" fullWidth>
          {t('market.report.submit')}
        </Button>
      }
    >
      <div className="space-y-3">
        <p className="text-sm text-text3">{t('market.report.on')}: {reportedName}</p>
        <div className="space-y-2">
          {reasons.map(r => (
            <button
              key={r}
              onClick={() => setReason(r)}
              className={`w-full text-right px-4 py-2.5 rounded-xl border text-sm transition-colors ${
                reason === r ? 'border-error bg-error/10 text-error font-medium' : 'border-border text-text2'
              }`}
            >
              {r}
            </button>
          ))}
        </div>
        <textarea
          className="w-full border border-border rounded-xl p-3 text-sm bg-surface text-text resize-none h-20 focus:outline-none focus:ring-2 focus:ring-error/30"
          placeholder={t('market.report.details.placeholder')}
          value={details}
          onChange={e => setDetails(e.target.value)}
        />
      </div>
    </BottomSheet>
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
  const { t } = useT()
  const [convs, setConvs] = useState<ListingConversation[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getListingConversations(listing.id)
      .then(data => {
        setConvs(data)
        // If exactly one conversation, jump straight to it
        if (data.length === 1) {
          onSelectConversation(
            data[0].other_user_id,
            data[0].other_user_name || data[0].other_user_email || t('market.buyer'),
          )
        }
      })
      .catch(() => toast.error(t('market.convs.load.error')))
      .finally(() => setLoading(false))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <BottomSheet open onClose={onClose} title={t('market.convs.title')}>
      <p className="text-xs text-text3 -mt-2 mb-3">{listing.store_name}</p>
      <div className="space-y-2">
        {loading ? (
          <div className="flex justify-center py-10">
            <Icon name="progress_activity" size={24} color="var(--c-primary)" className="animate-spin" />
          </div>
        ) : convs.length === 0 ? (
          <div className="text-center py-10 text-text3 space-y-2">
            <Icon name="chat" size={40} color="var(--c-border)" />
            <p className="text-sm">{t('market.convs.empty')}</p>
          </div>
        ) : (
          convs.map(c => {
            const hasUnread = (c.unread_count ?? 0) > 0
            return (
              <button
                key={c.other_user_id}
                onClick={() => onSelectConversation(
                  c.other_user_id,
                  c.other_user_name || c.other_user_email || t('market.buyer'),
                )}
                className={`w-full flex items-center gap-3 p-3 rounded-xl border transition-colors text-right ${
                  hasUnread ? 'border-primary/40 bg-primary-light' : 'border-border'
                }`}
              >
                <div className="relative shrink-0">
                  <div className="w-9 h-9 bg-gradient-to-br from-primary-mid to-primary-dark rounded-full flex items-center justify-center text-white font-bold text-sm">
                    {(c.other_user_name || c.other_user_email || '?')[0].toUpperCase()}
                  </div>
                  {hasUnread && (
                    <span className="absolute -top-1 -right-1 min-w-[16px] h-4 bg-error text-white text-[10px] font-bold rounded-full flex items-center justify-center px-0.5">
                      {(c.unread_count ?? 0) > 9 ? '9+' : c.unread_count}
                    </span>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className={`text-sm truncate ${hasUnread ? 'font-bold text-text' : 'font-medium text-text'}`}>
                    {c.other_user_name || c.other_user_email}
                  </p>
                  <p className={`text-xs truncate ${hasUnread ? 'text-text2 font-medium' : 'text-text3'}`}>
                    {c.last_body}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0">
                  <span className="text-xs text-text3">{c.message_count} {t('market.messages')}</span>
                  <Icon name="chevron_left" size={16} color="var(--c-border)" />
                </div>
              </button>
            )
          })
        )}
      </div>
    </BottomSheet>
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
  const { t } = useT()
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
    ? (isExpired ? t('market.expired') : daysLeft === 0 ? t('market.expires.today') : formatDate(listing.expiry_date))
    : ''

  return (
    <button onClick={onClick} className="w-full text-right gs-tap bg-surface rounded-card shadow-card overflow-hidden relative block border-none cursor-pointer">
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
        <div className="flex justify-between items-start mb-2.5">
          <div className="flex-1 min-w-0">
            <div className="text-[17px] font-extrabold text-text truncate">{listing.store_name}</div>
            <div className="text-[13px] text-text3 mt-0.5">{t('market.voucher')} · ₪{listing.balance}</div>
          </div>
          <div className="text-left shrink-0 mr-2">
            <div className="text-xl font-extrabold text-primary leading-none">₪{listing.asking_price}</div>
            <div className="text-[11px] text-text3 mt-0.5 line-through">₪{listing.balance}</div>
          </div>
        </div>

        <div className="h-px bg-border mb-2.5" />

        {/* Seller row */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div
              className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-extrabold shrink-0"
              style={{ background: color + '20', border: `1.5px solid ${color}50`, color }}
            >
              {sellerInitial}
            </div>
            <div>
              <div className="flex items-center gap-1">
                <span className="text-[13px] font-semibold text-text">{sellerLabel}</span>
                {listing.is_verified_seller && (
                  <div className="w-4 h-4 rounded-full bg-[#2563eb] flex items-center justify-center shrink-0">
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M2 5l2 2 4-4" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  </div>
                )}
              </div>
              {(listing.avg_rating ?? 0) > 0 && (
                <div className="flex items-center gap-0.5 mt-0.5">
                  <Icon name="star" size={12} filled color="#facc15" />
                  <span className="text-[11px] font-semibold text-text2">{Number(listing.avg_rating).toFixed(1)}</span>
                  <span className="text-[11px] text-text3">({listing.rating_count})</span>
                </div>
              )}
            </div>
          </div>
          {expiryLabel && (
            <span
              className="text-[11px] rounded-full px-2 py-0.5 font-medium"
              style={{ color: expiryColor, background: expiryBg, border: isExpiringSoon || isExpired ? `1px solid ${expiryColor}40` : 'none' }}
            >
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
  const { t } = useT()
  const [removing, setRemoving] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [showPriceInput, setShowPriceInput] = useState(false)
  const [newPriceInput, setNewPriceInput] = useState('')
  const [updatingPrice, setUpdatingPrice] = useState(false)

  const statusLabel: Record<string, string> = {
    active: t('market.status.active'),
    pending_payment: t('market.listing.status.pending'),
    sold: t('market.status.sold'),
    cancelled: t('market.status.cancelled'),
  }
  const statusColor: Record<string, string> = {
    active: 'bg-primary-light text-primary',
    pending_payment: 'bg-warning/15 text-warning',
    sold: 'bg-bg text-text3',
    cancelled: 'bg-error/10 text-error',
  }

  return (
    <div className="bg-surface rounded-card border border-border shadow-card p-4 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-text truncate">{listing.store_name}</p>
          <p className="text-xs text-text3 mt-0.5">{t('market.balance.label')}: ₪{listing.balance} · {t('market.price.label')}: ₪{listing.asking_price}</p>
        </div>
        <span className={`text-xs font-medium px-2 py-1 rounded-full shrink-0 ${statusColor[listing.status]}`}>
          {statusLabel[listing.status]}
        </span>
      </div>

      {/* Buyer confirmed payment — needs seller confirmation */}
      {listing.purchase_status === 'buyer_confirmed' && listing.buyer_name && (
        <div className="bg-warning/10 border border-warning/30 rounded-xl p-3 space-y-2">
          <p className="text-sm font-medium text-warning">
            {listing.buyer_name || listing.buyer_email} {t('market.listing.buyer.sent.payment')}
          </p>
          {listing.payment_method_used && (
            <p className="text-xs text-warning">
              {t('market.listing.payment.method')}: <span className="font-semibold">{listing.payment_method_used}</span>
            </p>
          )}
          <div className="flex gap-2">
            <button
              disabled={confirming}
              onClick={async () => {
                setConfirming(true)
                try { await onConfirm() } finally { setConfirming(false) }
              }}
              className="flex-1 py-2 bg-primary text-white rounded-xl text-sm font-semibold disabled:opacity-50"
            >
              {confirming ? <Icon name="progress_activity" size={16} className="animate-spin mx-auto" /> : t('market.confirm.received')}
            </button>
            <button
              onClick={onReport}
              className="p-2 rounded-xl border border-error/30 text-error"
              aria-label={t('market.report.buyer.aria')}
            >
              <Icon name="flag" size={16} />
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
            placeholder={`${t('market.listing.current.price')}: ₪${listing.asking_price}`}
            className="flex-1 border border-border rounded-xl px-3 py-2 text-sm bg-surface text-text focus:outline-none focus:ring-2 focus:ring-primary/30"
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
            className="px-3 py-2 bg-primary text-white rounded-xl text-sm font-semibold disabled:opacity-50"
          >
            {updatingPrice ? <Icon name="progress_activity" size={16} className="animate-spin" /> : t('app.update')}
          </button>
          <button
            onClick={() => { setShowPriceInput(false); setNewPriceInput('') }}
            className="px-3 py-2 border border-border rounded-xl text-sm text-text3"
          >
            {t('app.cancel')}
          </button>
        </div>
      )}

      {/* Action buttons row */}
      <div className="flex gap-2 flex-wrap">
        {/* Chat button — always visible for active/pending listings */}
        {(listing.status === 'active' || listing.status === 'pending_payment') && (
          <button
            onClick={onChat}
            className="relative flex items-center gap-1.5 px-3 py-2 rounded-xl border border-border text-text2 text-sm"
          >
            <Icon name="chat" size={16} color="var(--c-primary)" />
            {t('market.chats')}
            {unreadCount > 0 && (
              <span className="absolute -top-1.5 -right-1.5 min-w-[16px] h-4 bg-error text-white text-[10px] font-bold rounded-full flex items-center justify-center px-0.5">
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
          </button>
        )}

        {/* Update price button for active listings */}
        {listing.status === 'active' && !showPriceInput && (
          <button
            onClick={() => setShowPriceInput(true)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-border text-text2 text-sm"
          >
            <Icon name="edit" size={14} />
            {t('market.update.price')}
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
            className="flex-1 py-2 border border-error/30 text-error rounded-xl text-sm font-medium disabled:opacity-50"
          >
            {removing ? <Icon name="progress_activity" size={16} className="animate-spin mx-auto" /> : t('market.remove')}
          </button>
        )}
      </div>

      {listing.status === 'sold' && (
        <div className="flex items-center gap-2 text-sm text-text3">
          <Icon name="check_circle" size={16} filled color="var(--c-primary)" />
          {t('market.listing.sold.transferred')}
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
  const { t } = useT()

  const statusLabel: Record<string, string> = {
    pending_buyer_payment: t('market.purchase.status.pending'),
    buyer_confirmed: t('market.purchase.status.confirmed'),
    completed: t('market.purchase.status.completed'),
    cancelled: t('market.status.cancelled'),
  }
  const statusColor: Record<string, string> = {
    pending_buyer_payment: 'bg-primary-light text-primary',
    buyer_confirmed: 'bg-warning/15 text-warning',
    completed: 'bg-primary-light text-primary',
    cancelled: 'bg-bg text-text3',
  }

  return (
    <div className="bg-surface rounded-card border border-border shadow-card p-4 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-text truncate">{purchase.store_name}</p>
          <p className="text-xs text-text3 mt-0.5">
            ₪{purchase.asking_price} · {t('market.seller')}: {purchase.seller_name || purchase.seller_email?.split('@')[0]}
          </p>
        </div>
        <span className={`text-xs font-medium px-2 py-1 rounded-full shrink-0 ${statusColor[purchase.status]}`}>
          {statusLabel[purchase.status]}
        </span>
      </div>

      {purchase.status === 'buyer_confirmed' && (
        <div className="bg-primary-light border border-primary/20 rounded-xl p-3 text-sm text-primary flex items-center gap-1.5">
          <Icon name="info" size={16} />
          {t('market.purchase.awaiting.seller')}
        </div>
      )}

      {purchase.status === 'completed' && (
        <div className="flex items-center gap-2 text-sm text-text3">
          <Icon name="check_circle" size={16} filled color="var(--c-primary)" />
          {t('market.purchase.transferred')}
        </div>
      )}

      <div className="flex gap-2 flex-wrap">
        {/* Chat with seller (before completion) */}
        {purchase.status !== 'cancelled' && purchase.seller_id && (
          <button
            onClick={onChat}
            className="relative flex items-center gap-1.5 px-3 py-2 rounded-xl border border-border text-text2 text-sm"
          >
            <Icon name="chat" size={16} color="var(--c-primary)" />
            {t('market.chat.with.seller')}
            {unreadCount > 0 && (
              <span className="absolute -top-1.5 -right-1.5 min-w-[16px] h-4 bg-error text-white text-[10px] font-bold rounded-full flex items-center justify-center px-0.5">
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
          </button>
        )}

        {purchase.status === 'completed' && (
          <button
            onClick={onRate}
            className="flex-1 py-2 bg-warning/10 border border-warning/30 text-warning rounded-xl text-sm font-medium flex items-center justify-center gap-1"
          >
            <Icon name="star" size={16} filled />
            {purchase.my_rating ? `${t('market.rated')} (${purchase.my_rating}★)` : t('market.rate.seller.short')}
          </button>
        )}
        {(purchase.status === 'buyer_confirmed' || purchase.status === 'completed') && (
          <button
            onClick={onReport}
            className="p-2 rounded-xl border border-error/30 text-error"
            aria-label={t('market.report.seller.aria')}
          >
            <Icon name="flag" size={16} />
          </button>
        )}
        {purchase.status === 'buyer_confirmed' && (
          <button
            onClick={onCancel}
            className="px-3 py-2 border border-border text-text3 rounded-xl text-sm"
          >
            {t('market.cancel')}
          </button>
        )}
      </div>
    </div>
  )
}

// ─── Access Request Screen ─────────────────────────────────────────────────────
function MarketplaceAccessGate() {
  const { myAccessStatus, requestMarketplaceAccess } = useMarketplace()
  const { t } = useT()
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)

  async function handleRequest() {
    setSending(true)
    try {
      await requestMarketplaceAccess(message.trim() || undefined)
      toast.success(t('market.access.sent'))
    } catch {
      toast.error(t('market.access.error'))
    } finally {
      setSending(false)
    }
  }

  if (myAccessStatus === 'pending') {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
        <div className="w-16 h-16 bg-warning/10 rounded-2xl flex items-center justify-center mb-4">
          <Icon name="shopping_bag" size={32} color="var(--c-warning)" />
        </div>
        <h2 className="text-lg font-bold text-text mb-2">{t('market.access.pending.title')}</h2>
        <p className="text-sm text-text3 max-w-xs">{t('market.access.pending.body')}</p>
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
      <div className="w-16 h-16 bg-primary-light rounded-2xl flex items-center justify-center mb-4">
        <Icon name="shopping_bag" size={32} color="var(--c-primary)" />
      </div>
      <h2 className="text-lg font-bold text-text mb-1">{t('market.title')}</h2>
      {myAccessStatus === 'rejected' && (
        <p className="text-sm text-error mb-3">{t('market.access.rejected')}</p>
      )}
      <p className="text-sm text-text3 mb-6 max-w-xs">
        {t('market.access.desc')}
      </p>
      <textarea
        value={message}
        onChange={e => setMessage(e.target.value)}
        placeholder={t('market.access.message.placeholder')}
        rows={3}
        className="w-full max-w-xs border border-border rounded-xl px-3 py-2 text-sm bg-surface text-text mb-4 resize-none focus:outline-none focus:ring-2 focus:ring-primary/30"
      />
      <Button onClick={handleRequest} loading={sending}>
        <Icon name="add" size={16} />
        {t('market.access.request')}
      </Button>
    </div>
  )
}

// ─── Seller Profile Modal ─────────────────────────────────────────────────────
interface SellerProfileRow {
  user_id: string
  full_name: string
  phone: string
  email: string
  id_number: string
  verification_status: 'pending' | 'verified' | 'rejected'
  admin_note: string | null
}

function SellerProfileModal({
  existing,
  onClose,
  onSaved,
}: {
  existing: SellerProfileRow | null
  onClose: () => void
  onSaved: (profile: SellerProfileRow) => void
}) {
  const { t } = useT()
  const { user } = useAuth()
  const [fullName, setFullName] = useState(existing?.full_name ?? '')
  const [phone, setPhone] = useState(existing?.phone ?? '')
  const [email, setEmail] = useState(existing?.email ?? user?.email ?? '')
  const [idNumber, setIdNumber] = useState(existing?.id_number ?? '')
  const [saving, setSaving] = useState(false)

  const isPending = existing?.verification_status === 'pending'
  const isRejected = existing?.verification_status === 'rejected'
  const readOnly = isPending

  async function handleSubmit() {
    if (!fullName.trim() || !phone.trim() || !idNumber.trim()) {
      toast.error(t('seller.profile.required')); return
    }
    setSaving(true)
    try {
      const { data, error } = await supabase.rpc('upsert_seller_profile', {
        p_full_name: fullName.trim(),
        p_phone: phone.trim(),
        p_email: email.trim() || null,
        p_id_number: idNumber.trim(),
      })
      if (error) throw error
      toast.success(t('seller.profile.saved'))
      onSaved((data as SellerProfileRow) ?? { user_id: user!.id, full_name: fullName, phone, email, id_number: idNumber, verification_status: 'pending', admin_note: null })
    } catch {
      toast.error(t('seller.profile.error'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <BottomSheet
      open
      onClose={onClose}
      title={t('seller.profile.title')}
      className="max-h-[90dvh]"
      footer={
        readOnly ? (
          <Button variant="secondary" onClick={onClose} fullWidth>{t('app.close')}</Button>
        ) : (
          <Button onClick={handleSubmit} disabled={saving} loading={saving} fullWidth>
            {t('seller.profile.submit')}
          </Button>
        )
      }
    >
      <div className="space-y-4">
        {isPending && (
          <div className="bg-warning/10 border border-warning/30 rounded-2xl p-4 text-sm text-warning">
            <p className="font-semibold mb-1">{t('admin.sellers.status.pending')}</p>
            <p>{t('seller.profile.pending')}</p>
          </div>
        )}

        {isRejected && (
          <div className="bg-error/10 border border-error/30 rounded-2xl p-4 text-sm text-error space-y-1">
            <p className="font-semibold">{t('seller.profile.rejected')}</p>
            {existing?.admin_note && (
              <p>{t('seller.profile.rejected.note')} {existing.admin_note}</p>
            )}
            <p className="text-xs mt-1">ניתן לשנות ולשלוח שוב לאישור</p>
          </div>
        )}

        {!isPending && (
          <p className="text-sm text-text3">{t('seller.profile.subtitle')}</p>
        )}

        <div className="space-y-3">
          <div>
            <label className="text-xs text-text3 mb-1 block">{t('seller.profile.full_name')}</label>
            <input
              className="w-full border border-border rounded-xl px-3 py-2.5 text-sm bg-surface text-text disabled:bg-bg"
              value={fullName} onChange={e => setFullName(e.target.value)} disabled={readOnly}
              placeholder={t('seller.profile.full_name')}
            />
          </div>
          <div>
            <label className="text-xs text-text3 mb-1 block">{t('seller.profile.phone')}</label>
            <input
              type="tel" className="w-full border border-border rounded-xl px-3 py-2.5 text-sm bg-surface text-text disabled:bg-bg"
              value={phone} onChange={e => setPhone(e.target.value)} disabled={readOnly}
              placeholder="05X-XXXXXXX"
            />
          </div>
          <div>
            <label className="text-xs text-text3 mb-1 block">{t('seller.profile.email')}</label>
            <input
              type="email" className="w-full border border-border rounded-xl px-3 py-2.5 text-sm bg-surface text-text disabled:bg-bg"
              value={email} onChange={e => setEmail(e.target.value)} disabled={readOnly}
              placeholder="user@example.com"
            />
          </div>
          <div>
            <label className="text-xs text-text3 mb-1 block">{t('seller.profile.id_number')}</label>
            <input
              className="w-full border border-border rounded-xl px-3 py-2.5 text-sm bg-surface text-text disabled:bg-bg"
              value={idNumber} onChange={e => setIdNumber(e.target.value)} disabled={readOnly}
              placeholder="XXXXXXXXX"
              maxLength={9}
            />
          </div>
        </div>
      </div>
    </BottomSheet>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function MarketplacePage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { isAdmin, user, profile } = useAuth()
  const { logAction } = useVouchers()
  const { t } = useT()
  usePageView('market')
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

  // Seller profile gate
  const [showSellerProfile, setShowSellerProfile] = useState(false)
  const [sellerProfile, setSellerProfile] = useState<SellerProfileRow | null | undefined>(undefined)

  async function checkAndPublish() {
    if (sellerProfile === undefined) {
      const { data } = await supabase.rpc('get_seller_profile')
      const p = (data as SellerProfileRow | null) ?? null
      setSellerProfile(p)
      if (p?.verification_status === 'verified') { navigate('/market/bulk'); return }
      setShowSellerProfile(true)
    } else if (sellerProfile?.verification_status === 'verified') {
      navigate('/market/bulk')
    } else {
      setShowSellerProfile(true)
    }
  }

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
      toast.success(t('market.payment.updated'))
    } catch {
      toast.error(t('market.payment.save.error'))
    } finally {
      setSavingPayments(false)
    }
  }

  function addPaymentMethod() {
    if (!newPaymentValue.trim()) { toast.error(t('market.payment.enter.value')); return }
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
    else if (tab === 'mine') {
      fetchMyListings()
      // Prefetch seller profile so the banner renders immediately
      if (sellerProfile === undefined) {
        supabase.rpc('get_seller_profile').then(({ data }) => {
          setSellerProfile((data as SellerProfileRow | null) ?? null)
        })
      }
    }
    else fetchMyPurchases()
  }, [tab]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (tab !== 'all') return
    const timer = setTimeout(() => fetchListings(search || undefined), 400)
    return () => clearTimeout(timer)
  }, [search]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (tab !== 'watchlist' || watchlistLoaded) return
    supabase.rpc('get_my_watchlist').then(({ data }) => {
      if (data) setWatchlist(data)
      setWatchlistLoaded(true)
    })
  }, [tab, watchlistLoaded])

  async function addWatchItem() {
    if (!watchForm.store_name.trim()) { toast.error(t('market.watch.store.required')); return }
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
      toast.success(t('market.watch.added'))
    } catch (e: unknown) {
      const msg = (e as { message?: string })?.message || ''
      toast.error(msg.includes('pro_required') ? t('market.watch.pro.required') : t('market.watch.add.error'))
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
      toast.error(t('market.watch.delete.error'))
    } finally {
      setDeletingWatch(null)
    }
  }

  // Selective mode: non-approved users see the access request screen
  if (marketplaceMode === 'selective' && !isAdmin && myAccessStatus !== 'approved') {
    return (
      <div className="flex flex-col min-h-dvh bg-bg">
        <div className="bg-surface border-b border-border px-4 py-4">
          <h1 className="text-xl font-bold text-text flex items-center gap-2">
            <Icon name="shopping_bag" size={20} color="var(--c-primary)" />
            {t('market.title')}
          </h1>
        </div>
        <MarketplaceAccessGate />
      </div>
    )
  }

  return (
    <div className="flex-1 bg-bg" dir="rtl">
      {/* Header */}
      <div className="sticky top-0 z-20 bg-surface border-b border-border">
        <div className="px-5 pt-4">
          <div className="flex justify-between items-center mb-3.5">
            <div>
              <div className="text-[22px] font-extrabold text-text">{t('market.marketplace')}</div>
              {listings.length > 0 && (
                <div className="text-[13px] text-text3 mt-0.5">{listings.length} {t('market.active.deals')}</div>
              )}
            </div>
            {tab === 'all' && (
              <button
                onClick={() => setShowSort(s => !s)}
                className={`flex items-center gap-1.5 rounded-[10px] px-3 py-2 border ${
                  showSort ? 'bg-primary-light border-primary text-primary' : 'bg-bg border-border text-text2'
                }`}
              >
                <Icon name="tune" size={14} />
                <span className="text-[13px] font-medium">
                  {sortKey === 'discount' ? t('market.sort.discount') : sortKey === 'balance' ? t('market.sort.balance') : sortKey === 'expiry' ? t('market.sort.expiry') : t('market.sort.newest')}
                </span>
              </button>
            )}
          </div>
          {showSort && tab === 'all' && (
            <div className="flex gap-2 flex-wrap pb-3">
              {([
                { key: 'newest',   label: t('market.sort.newest.full') },
                { key: 'discount', label: t('market.sort.discount.full') },
                { key: 'balance',  label: t('market.sort.balance.full') },
                { key: 'expiry',   label: t('market.sort.expiry.full') },
              ] as { key: MarketSortKey; label: string }[]).map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => { setSortKey(key); setShowSort(false) }}
                  className={`text-xs px-3 py-1.5 rounded-full font-medium border ${
                    sortKey === key ? 'bg-primary-light text-primary border-primary' : 'bg-bg text-text3 border-transparent'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          )}

          {/* Tabs */}
          <div className="flex">
            {([['all', t('market.tab.market')], ['mine', t('market.tab.mine')], ['purchases', t('market.tab.purchases')], ['watchlist', t('market.tab.watchlist')]] as const).map(([tabKey, label]) => (
              <button
                key={tabKey}
                onClick={() => setTab(tabKey)}
                className={`flex-1 py-2.5 relative text-sm ${tab === tabKey ? 'font-bold text-primary' : 'font-normal text-text3'}`}
              >
                {label}
                {tab === tabKey && (
                  <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-7 h-[3px] rounded-t-[3px] bg-primary" />
                )}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Search */}
      {tab === 'all' && (
        <div className="px-4 py-3 bg-surface border-b border-border">
          <div className="flex items-center gap-2.5 bg-bg rounded-xl px-3">
            <Icon name="search" size={16} color="var(--c-text3)" />
            <input
              type="text"
              className="flex-1 h-10 border-none bg-transparent text-[15px] text-text outline-none"
              placeholder={t('market.search.by.store')}
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            {search && (
              <button onClick={() => setSearch('')} className="p-0.5">
                <Icon name="close" size={15} color="var(--c-text3)" />
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
                <div className="flex justify-center py-12">
                  <Icon name="progress_activity" size={24} color="var(--c-primary)" className="animate-spin" />
                </div>
              ) : sorted.length === 0 ? (
                <div className="text-center py-12 text-text3 space-y-2">
                  <Icon name="sell" size={40} color="var(--c-border)" />
                  <p className="font-medium">{t('market.no.listings.now')}</p>
                  {search && <p className="text-sm">{t('market.try.other.search')}</p>}
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
            {/* Seller profile status banner */}
            <button
              onClick={() => { if (sellerProfile === undefined) checkAndPublish(); else setShowSellerProfile(true) }}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-2xl border text-sm text-right ${
                sellerProfile?.verification_status === 'verified'
                  ? 'bg-primary-light border-primary/20 text-primary'
                  : sellerProfile?.verification_status === 'pending'
                  ? 'bg-warning/10 border-warning/30 text-warning'
                  : sellerProfile?.verification_status === 'rejected'
                  ? 'bg-error/10 border-error/30 text-error'
                  : 'bg-bg border-border text-text2'
              }`}
            >
              <Icon name="verified_user" size={20} className="shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-xs">
                  {sellerProfile?.verification_status === 'verified' ? 'פרופיל מוכר מאושר ✓'
                    : sellerProfile?.verification_status === 'pending' ? 'פרופיל ממתין לאישור'
                    : sellerProfile?.verification_status === 'rejected' ? 'פרופיל נדחה — לחץ לעדכון'
                    : 'השלם פרופיל מוכר לפני פרסום'}
                </p>
                {sellerProfile?.verification_status !== 'verified' && (
                  <p className="text-[10px] opacity-70 mt-0.5">
                    {sellerProfile?.verification_status === 'pending'
                      ? 'המנהל יאשר בהקדם'
                      : 'נדרש אישור מנהל לפרסום שוברים'}
                  </p>
                )}
              </div>
              <Icon name="chevron_left" size={16} className="shrink-0 opacity-50" />
            </button>

            <div className="flex justify-between items-center">
              <button
                onClick={() => setShowPaymentSettings(v => !v)}
                className={`flex items-center gap-1.5 rounded-[10px] px-3 py-[7px] border text-[13px] font-medium ${
                  showPaymentSettings ? 'bg-primary-light border-primary text-primary' : 'bg-bg border-border text-text2'
                }`}
              >
                <Icon name="settings" size={14} />
                {t('market.payment.methods')}
                {paymentMethods.length > 0 && (
                  <span className="bg-primary text-white text-[11px] font-bold rounded-full px-1.5 mr-0.5">
                    {paymentMethods.length}
                  </span>
                )}
              </button>
              <button
                onClick={checkAndPublish}
                className="flex items-center gap-1.5 px-3 py-2 bg-primary text-white text-sm font-medium rounded-xl"
              >
                <Icon name="shopping_bag" size={14} /> {t('market.bulk.publish')}
              </button>
            </div>

            {/* Payment methods panel */}
            {showPaymentSettings && (
              <div className="bg-surface rounded-card shadow-card overflow-hidden">
                <div className="p-4 space-y-3">
                  <p className="text-xs text-text3">{t('market.payment.methods.hint')}</p>

                  {paymentMethods.length === 0 && !addingPayment && (
                    <p className="text-sm text-text3 text-center py-2">{t('market.payment.methods.empty')}</p>
                  )}

                  {paymentMethods.map((m, i) => (
                    <div key={i} className="flex items-center gap-3 p-3 bg-bg rounded-xl">
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center text-white font-bold text-xs shrink-0 ${m.type === 'paypal' ? 'bg-blue-500' : m.type === 'bit' ? 'bg-purple-500' : m.type === 'paybox' ? 'bg-orange-500' : 'bg-teal-500'}`}>
                        {PAYMENT_METHOD_LABELS[m.type][0]}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-text">{PAYMENT_METHOD_LABELS[m.type]}</p>
                        <p className="text-xs text-text3 truncate">{m.value}</p>
                      </div>
                      <button
                        onClick={() => removePaymentMethod(i)}
                        className="p-1.5 rounded-lg text-text3 hover:text-error"
                        aria-label={t('market.payment.remove.aria')}
                      >
                        <Icon name="delete" size={16} />
                      </button>
                    </div>
                  ))}

                  {addingPayment && (
                    <div className="space-y-2 border border-primary/20 rounded-xl p-3">
                      <select
                        value={newPaymentType}
                        onChange={e => setNewPaymentType(e.target.value as PaymentMethod['type'])}
                        className="w-full border border-border rounded-xl px-3 py-2 text-sm bg-surface text-text focus:outline-none focus:ring-2 focus:ring-primary/30"
                      >
                        {(Object.entries(PAYMENT_METHOD_LABELS) as [PaymentMethod['type'], string][]).map(([type, label]) => (
                          <option key={type} value={type}>{label}</option>
                        ))}
                      </select>
                      <input
                        type={newPaymentType === 'paypal' ? 'email' : 'tel'}
                        value={newPaymentValue}
                        onChange={e => setNewPaymentValue(e.target.value)}
                        placeholder={newPaymentType === 'paypal' ? t('market.payment.paypal.placeholder') : t('market.payment.phone.placeholder')}
                        className="w-full border border-border rounded-xl px-3 py-2 text-sm bg-surface text-text focus:outline-none focus:ring-2 focus:ring-primary/30"
                        dir="ltr"
                      />
                      <div className="flex gap-2">
                        <button onClick={addPaymentMethod} disabled={savingPayments} className="flex-1 py-2 bg-primary text-white rounded-xl text-sm font-medium flex items-center justify-center gap-1">
                          <Icon name="check" size={16} /> {t('app.add')}
                        </button>
                        <button onClick={() => { setAddingPayment(false); setNewPaymentValue('') }} className="flex-1 py-2 bg-bg text-text2 rounded-xl text-sm font-medium flex items-center justify-center gap-1">
                          <Icon name="close" size={16} /> {t('app.cancel')}
                        </button>
                      </div>
                    </div>
                  )}

                  {!addingPayment && paymentMethods.length < 5 && (
                    <button
                      onClick={() => setAddingPayment(true)}
                      className="w-full flex items-center justify-center gap-2 py-2.5 border-2 border-dashed border-border rounded-xl text-sm text-text3"
                    >
                      <Icon name="add" size={16} />
                      {t('market.payment.add')}
                    </button>
                  )}
                </div>
              </div>
            )}
            {loadingMyListings && myListings.length === 0 ? (
              <div className="flex justify-center py-12">
                <Icon name="progress_activity" size={24} color="var(--c-primary)" className="animate-spin" />
              </div>
            ) : myListings.length === 0 ? (
              <div className="text-center py-12 text-text3 space-y-2">
                <Icon name="shopping_bag" size={40} color="var(--c-border)" />
                <p className="font-medium">{t('market.mine.empty')}</p>
                <p className="text-sm">{t('market.mine.empty.hint')}</p>
              </div>
            ) : (
              myListings.map(l => (
                <MyListingRow
                  key={l.id}
                  listing={l}
                  unreadCount={unreadByListing[l.id] ?? 0}
                  onRemove={async () => {
                    try { await removeFromSale(l.id); toast.success(t('market.listing.removed')) }
                    catch { toast.error(t('market.listing.remove.error')) }
                  }}
                  onConfirm={async () => {
                    try { await confirmPaymentReceived(l.purchase_id!); toast.success(t('market.listing.confirmed')) }
                    catch { toast.error(t('market.listing.confirm.error')) }
                  }}
                  onReport={() => setReportTarget({
                    userId: l.buyer_id || '',
                    name: l.buyer_name || l.buyer_email || t('market.buyer'),
                    purchaseId: l.purchase_id,
                    listingId: l.id,
                  })}
                  onChat={() => setConvsListing(l)}
                  onUpdatePrice={async (price) => {
                    try {
                      await updateListingPrice(l.id, price)
                      await fetchMyListings()
                      toast.success(t('market.price.updated'))
                    } catch {
                      toast.error(t('market.price.update.error'))
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
              <h2 className="font-semibold text-text flex items-center gap-1.5">
                <Icon name="notifications" size={16} color="var(--c-primary)" /> {t('market.watch.title')}
              </h2>
              <button
                onClick={() => setShowAddWatch(v => !v)}
                className="flex items-center gap-1 px-3 py-1.5 bg-primary text-white text-xs font-medium rounded-xl"
              >
                <Icon name="add" size={14} /> {t('app.add')}
              </button>
            </div>

            {showAddWatch && (
              <div className="bg-surface rounded-card border border-border p-4 space-y-3">
                <input
                  type="text"
                  placeholder={t('market.watch.store.placeholder')}
                  value={watchForm.store_name}
                  onChange={e => setWatchForm(f => ({ ...f, store_name: e.target.value }))}
                  className="w-full border border-border rounded-xl px-3 py-2 text-sm bg-surface text-text focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
                <div className="flex items-center gap-2">
                  <label className="text-xs text-text2 shrink-0">{t('market.watch.min.discount')}:</label>
                  <input
                    type="number" inputMode="numeric" min={0} max={99} value={watchForm.min_discount_pct}
                    onChange={e => setWatchForm(f => ({ ...f, min_discount_pct: parseInt(e.target.value) || 0 }))}
                    className="w-20 border border-border rounded-xl px-3 py-1.5 text-sm text-center bg-surface text-text focus:outline-none"
                  />
                  <span className="text-xs text-text3">%</span>
                </div>
                <div className="flex gap-4">
                  <label className="flex items-center gap-1.5 text-xs text-text2 cursor-pointer">
                    <input type="checkbox" checked={watchForm.notify_push}
                      onChange={e => setWatchForm(f => ({ ...f, notify_push: e.target.checked }))}
                      className="rounded" />
                    {t('market.watch.notify.push')}
                  </label>
                  <label className="flex items-center gap-1.5 text-xs text-text2 cursor-pointer">
                    <input type="checkbox" checked={watchForm.notify_email}
                      onChange={e => setWatchForm(f => ({ ...f, notify_email: e.target.checked }))}
                      className="rounded" />
                    {t('market.watch.notify.email')}
                  </label>
                </div>
                <div className="flex gap-2">
                  <button onClick={addWatchItem} disabled={savingWatch}
                    className="flex-1 py-2 bg-primary text-white rounded-xl text-sm font-medium disabled:opacity-50">
                    {savingWatch ? <Icon name="progress_activity" size={16} className="animate-spin mx-auto" /> : t('app.save')}
                  </button>
                  <button onClick={() => setShowAddWatch(false)}
                    className="px-4 py-2 border border-border rounded-xl text-sm text-text3">
                    {t('app.cancel')}
                  </button>
                </div>
              </div>
            )}

            {!watchlistLoaded && (
              <div className="flex justify-center py-10">
                <Icon name="progress_activity" size={20} color="var(--c-primary)" className="animate-spin" />
              </div>
            )}
            {watchlistLoaded && watchlist.length === 0 && !showAddWatch && (
              <div className="text-center py-12 text-text3 space-y-2">
                <Icon name="notifications" size={40} color="var(--c-border)" />
                <p className="font-medium">{t('market.watch.empty')}</p>
                <p className="text-sm">{t('market.watch.empty.hint')}</p>
              </div>
            )}
            {watchlist.map(w => (
              <div key={w.id} className="bg-surface rounded-card border border-border shadow-card p-4 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-text truncate">{w.store_name}</p>
                  <p className="text-xs text-text3 mt-0.5">
                    {t('market.watch.min.discount.label')}: {w.min_discount_pct}% ·
                    {w.notify_push ? ` · ${t('market.watch.push')}` : ''}{w.notify_email ? ` · ${t('market.watch.email')}` : ''}
                  </p>
                </div>
                <button
                  disabled={deletingWatch === w.id}
                  onClick={() => deleteWatchItem(w.id)}
                  className="p-2 rounded-xl border border-error/30 text-error disabled:opacity-50"
                >
                  {deletingWatch === w.id ? <Icon name="progress_activity" size={16} className="animate-spin" /> : <Icon name="delete" size={16} />}
                </button>
              </div>
            ))}
          </>
        )}

        {/* ── My purchases ── */}
        {tab === 'purchases' && (
          <>
            {loadingMyPurchases && myPurchases.length === 0 ? (
              <div className="flex justify-center py-12">
                <Icon name="progress_activity" size={24} color="var(--c-primary)" className="animate-spin" />
              </div>
            ) : myPurchases.length === 0 ? (
              <div className="text-center py-12 text-text3 space-y-2">
                <Icon name="shopping_bag" size={40} color="var(--c-border)" />
                <p className="font-medium">{t('market.purchases.empty')}</p>
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
                    name: p.seller_name || p.seller_email || t('market.seller'),
                    purchaseId: p.purchase_id,
                  })}
                  onCancel={async () => {
                    try { await cancelPurchase(p.purchase_id); toast.success(t('market.purchase.cancelled')) }
                    catch { toast.error(t('market.purchase.cancel.error')) }
                  }}
                  onChat={() => {
                    if (!p.seller_id) return
                    setChatTarget({
                      listingId: p.listing_id,
                      otherUserId: p.seller_id,
                      otherUserName: p.seller_name || p.seller_email?.split('@')[0] || t('market.seller'),
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
      {showSellerProfile && (
        <SellerProfileModal
          existing={sellerProfile ?? null}
          onClose={() => setShowSellerProfile(false)}
          onSaved={p => { setSellerProfile(p); setShowSellerProfile(false) }}
        />
      )}
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
