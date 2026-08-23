import { useT } from '../../lib/i18n'
import type { MarketplacePurchase } from '../../types'
import Icon from '../ui/Icon'

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

export default MyPurchaseRow
