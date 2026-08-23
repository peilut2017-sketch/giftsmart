import { useState } from 'react'
import { useT } from '../../lib/i18n'
import type { MarketplaceListing } from '../../types'
import Icon from '../ui/Icon'

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

export default MyListingRow
