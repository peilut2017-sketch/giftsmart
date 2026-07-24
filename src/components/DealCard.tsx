import { useEffect, useRef, useState } from 'react'
import { useDiscounts } from '../contexts/DiscountsContext'
import { useT } from '../lib/i18n'
import Icon from './ui/Icon'
import BottomSheet from './ui/BottomSheet'
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

function BusinessAvatar({ name, logoUrl, size = 'md' }: { name: string; logoUrl?: string; size?: 'sm' | 'md' | 'lg' }) {
  const color = hashColor(name)
  const cls = size === 'sm' ? 'w-9 h-9 text-base' : size === 'lg' ? 'w-14 h-14 text-2xl' : 'w-11 h-11 text-lg'
  if (logoUrl) {
    return (
      <img
        src={logoUrl}
        alt={name}
        loading="lazy"
        className={`${cls} rounded-2xl object-cover shrink-0 border border-border`}
        onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
      />
    )
  }
  return (
    <div
      className={`${cls} rounded-2xl flex items-center justify-center font-bold shrink-0`}
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
    <span className="inline-flex items-center gap-1 bg-primary-light text-primary text-xs font-bold px-2.5 py-1 rounded-full shrink-0">
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

// ── Detail Sheet ─────────────────────────────────────────────────────────────
const REPORT_REASONS = [
  { key: 'wrong',   labelKey: 'deal.report.reason.wrong'   },
  { key: 'expired', labelKey: 'deal.report.reason.expired' },
  { key: 'items',   labelKey: 'deal.report.reason.items'   },
  { key: 'other',   labelKey: 'deal.report.reason.other'   },
] as const

function DealDetailSheet({ deal, onClose }: { deal: DiscountDeal; onClose: () => void }) {
  const { copyPromoCode, incrementDealViewCount, toggleLike, likedDealIds } = useDiscounts()
  const { t } = useT()
  const trackedRef = useRef(false)
  const isLiked = likedDealIds.has(deal.deal_id)
  const [showReport, setShowReport] = useState(false)
  const [reportReason, setReportReason] = useState('')
  const [reportDetails, setReportDetails] = useState('')
  const [reportLoading, setReportLoading] = useState(false)
  const [reportSent, setReportSent] = useState(false)

  async function handleSubmitReport() {
    if (!reportReason) return
    setReportLoading(true)
    try {
      const { supabase } = await import('../lib/supabase')
      const { error } = await supabase.rpc('submit_deal_report', {
        p_deal_id: deal.deal_id,
        p_reason: reportReason,
        p_details: reportDetails || null,
      })
      if (error) throw error
      setReportSent(true)
    } catch {
      alert(t('app.error'))
    } finally {
      setReportLoading(false)
    }
  }

  // Count the view only when the sheet opens (user actually viewed the deal)
  useEffect(() => {
    if (!trackedRef.current) {
      trackedRef.current = true
      incrementDealViewCount(deal.deal_id)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <BottomSheet open onClose={onClose} className="max-h-[90dvh]">
      <div className="flex items-start gap-3 -mx-5 px-5 pb-3 border-b border-border">
        <BusinessAvatar name={deal.business_name} logoUrl={deal.business_logo} size="lg" />
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="font-bold text-base text-text">{deal.business_name}</div>
              <div className="flex items-center gap-1 mt-0.5">
                {deal.club_logo ? (
                  <img src={deal.club_logo} alt={deal.club_name} loading="lazy" className="w-4 h-4 rounded object-cover" />
                ) : (
                  <Icon name="sell" size={12} color="var(--c-text3)" />
                )}
                <span className="text-xs text-text3">{deal.club_name}</span>
              </div>
            </div>
            <button
              onClick={() => toggleLike(deal.deal_id)}
              className={`p-2 rounded-full transition-colors ${isLiked ? 'text-error bg-error/10' : 'text-text3 bg-bg'}`}
              aria-label={isLiked ? t('discounts.unlike') : t('discounts.like')}
            >
              <Icon name="favorite" size={16} filled={isLiked} />
            </button>
          </div>
          <div className="flex flex-wrap gap-1.5 mt-2">
            <DiscountBadge deal={deal} />
            {deal.is_my_club && (
              <span className="bg-primary text-white text-[10px] font-bold px-2 py-0.5 rounded-full leading-tight">
                {t('discounts.best_match')}
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="space-y-4 pt-4">
        {deal.image_url && (
          <div className="rounded-2xl overflow-hidden border border-border">
            <img src={deal.image_url} alt={deal.title} className="w-full object-cover max-h-52" loading="lazy" />
          </div>
        )}

        <div className="font-semibold text-text text-sm leading-snug">{deal.title}</div>

        {deal.promo_code && (
          <div className="flex items-center justify-between bg-bg rounded-xl px-3 py-2.5 gap-2">
            <div>
              <p className="text-[10px] text-text3 mb-0.5">{t('discounts.promo.code')}</p>
              <span className="font-mono text-base font-bold text-text tracking-wider select-all">{deal.promo_code}</span>
            </div>
            <button
              onClick={() => copyPromoCode(deal.promo_code!)}
              className="flex items-center gap-1.5 text-xs font-semibold text-primary bg-primary-light px-3 py-2 rounded-lg active:scale-95 transition-transform"
            >
              <Icon name="content_copy" size={14} />
              {t('discounts.copy_code')}
            </button>
          </div>
        )}

        {deal.description && (
          <div>
            <p className="text-xs font-semibold text-text3 mb-1">{t('discounts.details.label')}</p>
            <p className="text-sm text-text2 leading-relaxed">{deal.description}</p>
          </div>
        )}

        {(deal.start_date || deal.expiration_date) && (
          <div className="flex gap-4">
            {deal.start_date && deal.is_upcoming && (
              <div>
                <p className="text-[10px] text-text3 mb-0.5">{t('discounts.start.date')}</p>
                <p className="text-xs font-semibold text-warning">{formatShortDate(deal.start_date)}</p>
              </div>
            )}
            {deal.expiration_date && (
              <div>
                <p className="text-[10px] text-text3 mb-0.5">{t('discounts.valid.until')}</p>
                <p className="text-xs font-semibold text-text2">{formatShortDate(deal.expiration_date)}</p>
              </div>
            )}
          </div>
        )}

        {deal.tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {deal.tags.map(tag => (
              <span key={tag} className="text-[10px] bg-bg text-text3 px-2 py-0.5 rounded-full">{tag}</span>
            ))}
          </div>
        )}

        {(deal.view_count ?? 0) > 0 && (
          <div className="flex items-center gap-1 text-text3 text-xs">
            <Icon name="visibility" size={14} />
            <span>{deal.view_count} {t('discounts.views')}</span>
          </div>
        )}

        {isSafeUrl(deal.external_link) && (
          <a
            href={deal.external_link}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-2 text-sm font-semibold text-primary border border-primary/30 rounded-xl py-3 active:bg-primary-light transition-colors"
          >
            <Icon name="open_in_new" size={16} />
            {t('discounts.open_deal')}
          </a>
        )}

        {reportSent ? (
          <p className="text-xs text-center text-primary py-2">{t('deal.report.sent')}</p>
        ) : showReport ? (
          <div className="border border-error/20 rounded-2xl p-4 space-y-3 bg-error/5">
            <p className="text-xs font-bold text-error">{t('deal.report.title')}</p>
            <div className="flex flex-wrap gap-2">
              {REPORT_REASONS.map(r => (
                <button
                  key={r.key}
                  onClick={() => setReportReason(r.key)}
                  className={`text-xs px-3 py-1.5 rounded-full border font-medium transition-all ${
                    reportReason === r.key
                      ? 'border-error bg-error/10 text-error'
                      : 'border-border bg-surface text-text2'
                  }`}
                >
                  {t(r.labelKey)}
                </button>
              ))}
            </div>
            <textarea
              value={reportDetails}
              onChange={e => setReportDetails(e.target.value)}
              placeholder={t('deal.report.details.placeholder')}
              rows={2}
              className="w-full text-xs px-3 py-2 border border-border rounded-xl bg-surface text-text2 focus:outline-none focus:ring-2 focus:ring-error/30 resize-none"
              dir="rtl"
            />
            <div className="flex gap-2">
              <button
                onClick={handleSubmitReport}
                disabled={!reportReason || reportLoading}
                className="flex-1 py-2 text-xs font-semibold bg-error text-white rounded-xl disabled:opacity-50 active:scale-95 transition-transform"
              >
                {reportLoading ? '…' : t('deal.report.submit')}
              </button>
              <button
                onClick={() => { setShowReport(false); setReportReason(''); setReportDetails('') }}
                className="px-4 py-2 text-xs text-text3 bg-bg rounded-xl"
              >
                {t('app.cancel')}
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setShowReport(true)}
            className="flex items-center justify-center gap-1.5 w-full py-2 text-xs text-text3"
          >
            <Icon name="flag" size={14} />
            {t('deal.report.button')}
          </button>
        )}
      </div>
    </BottomSheet>
  )
}

// ── Compact Card (list view) ─────────────────────────────────────────────────
interface Props {
  deal: DiscountDeal
  initiallyExpanded?: boolean
}

export default function DealCard({ deal, initiallyExpanded = false }: Props) {
  const { toggleLike, likedDealIds } = useDiscounts()
  const { t } = useT()
  const [showDetail, setShowDetail] = useState(initiallyExpanded)
  const isLiked = likedDealIds.has(deal.deal_id)

  return (
    <>
      <div
        id={`deal-${deal.deal_id}`}
        className="bg-surface rounded-card shadow-card border border-border px-4 py-3 flex items-center gap-3 cursor-pointer active:scale-[0.98] transition-transform"
        onClick={() => setShowDetail(true)}
        role="button"
        tabIndex={0}
        onKeyDown={e => e.key === 'Enter' && setShowDetail(true)}
        aria-label={`${deal.business_name} — ${deal.title}`}
      >
        <BusinessAvatar name={deal.business_name} logoUrl={deal.business_logo} size="sm" />

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1 mb-0.5">
            {deal.club_logo ? (
              <img src={deal.club_logo} alt={deal.club_name} loading="lazy" className="w-3 h-3 rounded object-cover" />
            ) : (
              <Icon name="sell" size={10} color="var(--c-text3)" />
            )}
            <span className="text-[10px] text-text3">{deal.club_name}</span>
          </div>
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="font-semibold text-sm text-text truncate max-w-[110px]">{deal.business_name}</span>
            <span className="text-xs text-text3 truncate flex-1">{deal.title}</span>
          </div>
        </div>

        <div className="flex flex-col items-end gap-1.5 shrink-0">
          <DiscountBadge deal={deal} />
          {deal.is_my_club && (
            <span className="bg-primary text-white text-[9px] font-bold px-1.5 py-0.5 rounded-full leading-tight">
              ✓ {t('discounts.best_match')}
            </span>
          )}
        </div>

        <button
          onClick={e => { e.stopPropagation(); toggleLike(deal.deal_id) }}
          className={`p-1.5 rounded-full transition-colors shrink-0 ${isLiked ? 'text-error' : 'text-text3'}`}
          aria-label={isLiked ? t('discounts.unlike') : t('discounts.like')}
        >
          <Icon name="favorite" size={16} filled={isLiked} />
        </button>
      </div>

      {showDetail && (
        <DealDetailSheet deal={deal} onClose={() => setShowDetail(false)} />
      )}
    </>
  )
}
