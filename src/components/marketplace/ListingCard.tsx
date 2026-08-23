import { useT } from '../../lib/i18n'
import { formatDate } from '../../utils/helpers'
import type { MarketplaceListing } from '../../types'
import Icon from '../ui/Icon'

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

export default ListingCard
