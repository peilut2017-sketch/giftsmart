import { useState } from 'react'
import { ExternalLink, Copy, ChevronDown, ChevronUp, Tag } from 'lucide-react'
import { useDiscounts } from '../contexts/DiscountsContext'
import { useT } from '../lib/i18n'
import type { DiscountDeal } from '../types'

const STORE_PALETTE = [
  '#8b5cf6', '#f59e0b', '#3b82f6', '#ec4899', '#10b981',
  '#0ea5e9', '#6366f1', '#f43f5e', '#a855f7', '#22c55e',
]

function hashColor(name: string): string {
  let h = 0
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return STORE_PALETTE[h % STORE_PALETTE.length]
}

function BusinessAvatar({ name, logoUrl }: { name: string; logoUrl?: string }) {
  const color = hashColor(name)
  if (logoUrl) {
    return (
      <img
        src={logoUrl}
        alt={name}
        loading="lazy"
        className="w-11 h-11 rounded-2xl object-cover shrink-0 border border-black/5"
        onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
      />
    )
  }
  return (
    <div
      className="w-11 h-11 rounded-2xl flex items-center justify-center text-lg font-bold shrink-0"
      style={{ background: color + '22', color, border: `1.5px solid ${color}40` }}
    >
      {(name || '?')[0].toUpperCase()}
    </div>
  )
}

function DiscountBadge({ deal }: { deal: DiscountDeal }) {
  const { t } = useT()
  let label = ''
  if (deal.discount_type === 'percent' && deal.discount_value) {
    label = t('discounts.percent_off', { value: deal.discount_value })
  } else if (deal.discount_type === 'fixed' && deal.discount_value) {
    label = t('discounts.fixed_off', { value: deal.discount_value })
  } else if (deal.discount_type === 'free_item') {
    label = t('discounts.free_item')
  } else {
    label = deal.title
  }
  return (
    <span className="inline-flex items-center gap-1 bg-green-100 text-green-700 text-xs font-bold px-2.5 py-1 rounded-full shrink-0">
      {label}
    </span>
  )
}

function formatShortDate(dateStr: string): string {
  const d = new Date(dateStr)
  return d.toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric', year: '2-digit' })
}

function isSafeUrl(url: string | undefined): boolean {
  if (!url) return false
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch { return false }
}

interface Props {
  deal: DiscountDeal
}

export default function DealCard({ deal }: Props) {
  const { copyPromoCode } = useDiscounts()
  const { t } = useT()
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 p-4 flex flex-col gap-3">

      {/* Row 1: Business + discount */}
      <div className="flex items-start gap-3">
        <BusinessAvatar name={deal.business_name} logoUrl={deal.business_logo} />

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-sm text-gray-900 dark:text-white truncate max-w-[130px]">
              {deal.business_name}
            </span>
            <DiscountBadge deal={deal} />
          </div>

          {/* Club pill */}
          <div className="flex items-center gap-1 mt-1">
            {deal.club_logo ? (
              <img src={deal.club_logo} alt={deal.club_name} loading="lazy" className="w-4 h-4 rounded object-cover" />
            ) : (
              <Tag className="w-3 h-3 text-gray-400" />
            )}
            <span className="text-xs text-gray-500 dark:text-gray-400">{deal.club_name}</span>
          </div>
        </div>

        {/* Badges column */}
        <div className="flex flex-col items-end gap-1 shrink-0">
          {deal.is_my_club && (
            <span className="bg-emerald-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full leading-tight">
              {t('discounts.best_match')}
            </span>
          )}
          {deal.is_upcoming && deal.start_date && (
            <span className="bg-amber-100 text-amber-700 text-[10px] font-semibold px-2 py-0.5 rounded-full leading-tight whitespace-nowrap">
              {t('discounts.upcoming', { date: formatShortDate(deal.start_date) })}
            </span>
          )}
          {deal.expiration_date && !deal.is_upcoming && (
            <span className="bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 text-[10px] px-2 py-0.5 rounded-full leading-tight whitespace-nowrap">
              {t('discounts.expires', { date: formatShortDate(deal.expiration_date) })}
            </span>
          )}
        </div>
      </div>

      {/* Promo code row */}
      {deal.promo_code && (
        <div className="flex items-center justify-between bg-gray-50 dark:bg-gray-700/50 rounded-xl px-3 py-2 gap-2">
          <span className="font-mono text-sm font-bold text-gray-800 dark:text-gray-100 tracking-wider select-all">
            {deal.promo_code}
          </span>
          <button
            onClick={() => copyPromoCode(deal.promo_code!)}
            className="flex items-center gap-1.5 text-xs font-semibold text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/30 px-3 py-1.5 rounded-lg active:scale-95 transition-transform"
          >
            <Copy className="w-3.5 h-3.5" />
            {t('discounts.copy_code')}
          </button>
        </div>
      )}

      {/* Description (collapsible) */}
      {deal.description && (
        <div>
          <p className={`text-xs text-gray-600 dark:text-gray-300 leading-relaxed ${expanded ? '' : 'line-clamp-2'}`}>
            {deal.description}
          </p>
          {deal.description.length > 90 && (
            <button
              onClick={() => setExpanded(v => !v)}
              className="flex items-center gap-0.5 text-xs text-gray-400 mt-0.5"
            >
              {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              {expanded ? 'פחות' : 'עוד'}
            </button>
          )}
        </div>
      )}

      {/* Tags */}
      {deal.tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {deal.tags.map(tag => (
            <span key={tag} className="text-[10px] bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 px-2 py-0.5 rounded-full">
              {tag}
            </span>
          ))}
        </div>
      )}

      {/* External link */}
      {isSafeUrl(deal.external_link) && (
        <a
          href={deal.external_link}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-center gap-2 text-sm font-semibold text-green-600 dark:text-green-400 border border-green-200 dark:border-green-800 rounded-xl py-2 active:bg-green-50 dark:active:bg-green-900/20 transition-colors"
        >
          <ExternalLink className="w-4 h-4" />
          {t('discounts.open_deal')}
        </a>
      )}
    </div>
  )
}
