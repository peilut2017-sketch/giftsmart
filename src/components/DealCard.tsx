import { useEffect, useRef, useState } from 'react'
import { ExternalLink, Copy, Tag, Eye, Heart, X, Flag } from 'lucide-react'
import { useDiscounts } from '../contexts/DiscountsContext'
import { useT } from '../lib/i18n'
import { useBodyScrollLock } from '../hooks/useBodyScrollLock'
import { supabase } from '../lib/supabase'
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
        className={`${cls} rounded-2xl object-cover shrink-0 border border-black/5`}
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
  useBodyScrollLock()

  async function handleSubmitReport() {
    if (!reportReason) return
    setReportLoading(true)
    try {
      const { error } = await supabase.rpc('submit_deal_report', {
        p_deal_id: deal.deal_id,
        p_reason: reportReason,
        p_details: reportDetails || null,
      })
      if (error) throw error
      setReportSent(true)
    } catch {
      alert('שגיאה בשליחת הדיווח — נסה שוב')
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
    <div
      className="fixed inset-0 bg-black/50 z-[100] flex items-end justify-center"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-gray-900 rounded-t-3xl w-full max-w-2xl flex flex-col max-h-[90dvh]"
        onClick={e => e.stopPropagation()}
        dir="rtl"
      >
        {/* Handle */}
        <div className="flex justify-center pt-3 pb-1 shrink-0">
          <div className="w-10 h-1 bg-gray-200 dark:bg-gray-700 rounded-full" />
        </div>

        {/* Header */}
        <div className="flex items-start gap-3 px-5 pt-2 pb-3 shrink-0">
          <BusinessAvatar name={deal.business_name} logoUrl={deal.business_logo} size="lg" />
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="font-bold text-base text-gray-900 dark:text-white">{deal.business_name}</div>
                <div className="flex items-center gap-1 mt-0.5">
                  {deal.club_logo ? (
                    <img src={deal.club_logo} alt={deal.club_name} loading="lazy" className="w-4 h-4 rounded object-cover" />
                  ) : (
                    <Tag className="w-3 h-3 text-gray-400" />
                  )}
                  <span className="text-xs text-gray-500 dark:text-gray-400">{deal.club_name}</span>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {/* Like button */}
                <button
                  onClick={() => toggleLike(deal.deal_id)}
                  className={`p-2 rounded-full transition-colors ${isLiked ? 'text-red-500 bg-red-50 dark:bg-red-900/30' : 'text-gray-400 hover:text-red-400 bg-gray-100 dark:bg-gray-700'}`}
                  aria-label={isLiked ? t('discounts.unlike') : t('discounts.like')}
                >
                  <Heart className="w-4 h-4" fill={isLiked ? 'currentColor' : 'none'} />
                </button>
                {/* Close */}
                <button
                  onClick={onClose}
                  className="p-2 rounded-full bg-gray-100 dark:bg-gray-700 text-gray-500"
                  aria-label={t('discounts.close_details')}
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5 mt-2">
              <DiscountBadge deal={deal} />
              {deal.is_my_club && (
                <span className="bg-emerald-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full leading-tight">
                  {t('discounts.best_match')}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Scrollable body */}
        <div className="overflow-y-auto flex-1 px-5 pb-6 space-y-4">
          {/* Deal image */}
          {deal.image_url && (
            <div className="rounded-2xl overflow-hidden border border-gray-100 dark:border-gray-700">
              <img
                src={deal.image_url}
                alt={deal.title}
                className="w-full object-cover max-h-52"
                loading="lazy"
              />
            </div>
          )}

          {/* Title */}
          <div className="font-semibold text-gray-800 dark:text-gray-100 text-sm leading-snug">
            {deal.title}
          </div>

          {/* Promo code */}
          {deal.promo_code && (
            <div className="flex items-center justify-between bg-gray-50 dark:bg-gray-700/50 rounded-xl px-3 py-2.5 gap-2">
              <div>
                <p className="text-[10px] text-gray-400 mb-0.5">קוד פרומו</p>
                <span className="font-mono text-base font-bold text-gray-800 dark:text-gray-100 tracking-wider select-all">
                  {deal.promo_code}
                </span>
              </div>
              <button
                onClick={() => copyPromoCode(deal.promo_code!)}
                className="flex items-center gap-1.5 text-xs font-semibold text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/30 px-3 py-2 rounded-lg active:scale-95 transition-transform"
              >
                <Copy className="w-3.5 h-3.5" />
                {t('discounts.copy_code')}
              </button>
            </div>
          )}

          {/* Description */}
          {deal.description && (
            <div>
              <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1">פרטים</p>
              <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">{deal.description}</p>
            </div>
          )}

          {/* Dates */}
          {(deal.start_date || deal.expiration_date) && (
            <div className="flex gap-4">
              {deal.start_date && deal.is_upcoming && (
                <div>
                  <p className="text-[10px] text-gray-400 mb-0.5">תאריך התחלה</p>
                  <p className="text-xs font-semibold text-amber-600">{formatShortDate(deal.start_date)}</p>
                </div>
              )}
              {deal.expiration_date && (
                <div>
                  <p className="text-[10px] text-gray-400 mb-0.5">תוקף עד</p>
                  <p className="text-xs font-semibold text-gray-700 dark:text-gray-300">{formatShortDate(deal.expiration_date)}</p>
                </div>
              )}
            </div>
          )}

          {/* Tags */}
          {deal.tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {deal.tags.map(tag => (
                <span key={tag} className="text-[10px] bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 px-2 py-0.5 rounded-full">
                  {tag}
                </span>
              ))}
            </div>
          )}

          {/* View count */}
          {(deal.view_count ?? 0) > 0 && (
            <div className="flex items-center gap-1 text-gray-400 text-xs">
              <Eye className="w-3.5 h-3.5" />
              <span>{deal.view_count} {t('discounts.views')}</span>
            </div>
          )}

          {/* External link */}
          {isSafeUrl(deal.external_link) && (
            <a
              href={deal.external_link}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-2 text-sm font-semibold text-green-600 dark:text-green-400 border border-green-200 dark:border-green-800 rounded-xl py-3 active:bg-green-50 dark:active:bg-green-900/20 transition-colors"
            >
              <ExternalLink className="w-4 h-4" />
              {t('discounts.open_deal')}
            </a>
          )}

          {/* Report section */}
          {reportSent ? (
            <p className="text-xs text-center text-green-600 dark:text-green-400 py-2">{t('deal.report.sent')}</p>
          ) : showReport ? (
            <div className="border border-red-100 dark:border-red-900/40 rounded-2xl p-4 space-y-3 bg-red-50/50 dark:bg-red-900/10">
              <p className="text-xs font-bold text-red-700 dark:text-red-400">{t('deal.report.title')}</p>
              <div className="flex flex-wrap gap-2">
                {REPORT_REASONS.map(r => (
                  <button
                    key={r.key}
                    onClick={() => setReportReason(r.key)}
                    className={`text-xs px-3 py-1.5 rounded-full border font-medium transition-all ${
                      reportReason === r.key
                        ? 'border-red-500 bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300'
                        : 'border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300'
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
                className="w-full text-xs px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-xl bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-2 focus:ring-red-300 resize-none"
                dir="rtl"
              />
              <div className="flex gap-2">
                <button
                  onClick={handleSubmitReport}
                  disabled={!reportReason || reportLoading}
                  className="flex-1 py-2 text-xs font-semibold bg-red-500 text-white rounded-xl disabled:opacity-50 active:scale-95 transition-transform"
                >
                  {reportLoading ? '...' : t('deal.report.submit')}
                </button>
                <button
                  onClick={() => { setShowReport(false); setReportReason(''); setReportDetails('') }}
                  className="px-4 py-2 text-xs text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-700 rounded-xl"
                >
                  {t('app.cancel')}
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setShowReport(true)}
              className="flex items-center justify-center gap-1.5 w-full py-2 text-xs text-gray-400 dark:text-gray-500 hover:text-red-500 dark:hover:text-red-400 transition-colors"
            >
              <Flag className="w-3.5 h-3.5" />
              {t('deal.report.button')}
            </button>
          )}
        </div>
      </div>
    </div>
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
        className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 px-4 py-3 flex items-center gap-3 cursor-pointer active:scale-[0.98] transition-transform"
        onClick={() => setShowDetail(true)}
        role="button"
        tabIndex={0}
        onKeyDown={e => e.key === 'Enter' && setShowDetail(true)}
        aria-label={`${deal.business_name} — ${deal.title}`}
      >
        <BusinessAvatar name={deal.business_name} logoUrl={deal.business_logo} size="sm" />

        <div className="flex-1 min-w-0">
          {/* Club */}
          <div className="flex items-center gap-1 mb-0.5">
            {deal.club_logo ? (
              <img src={deal.club_logo} alt={deal.club_name} loading="lazy" className="w-3 h-3 rounded object-cover" />
            ) : (
              <Tag className="w-2.5 h-2.5 text-gray-400" />
            )}
            <span className="text-[10px] text-gray-400 dark:text-gray-500">{deal.club_name}</span>
          </div>
          {/* Store + title */}
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="font-semibold text-sm text-gray-900 dark:text-white truncate max-w-[110px]">
              {deal.business_name}
            </span>
            <span className="text-xs text-gray-500 dark:text-gray-400 truncate flex-1">{deal.title}</span>
          </div>
        </div>

        {/* Right side */}
        <div className="flex flex-col items-end gap-1.5 shrink-0">
          <DiscountBadge deal={deal} />
          {deal.is_my_club && (
            <span className="bg-emerald-500 text-white text-[9px] font-bold px-1.5 py-0.5 rounded-full leading-tight">
              ✓ {t('discounts.best_match')}
            </span>
          )}
        </div>

        {/* Like button — stop propagation so clicking heart doesn't open sheet */}
        <button
          onClick={e => { e.stopPropagation(); toggleLike(deal.deal_id) }}
          className={`p-1.5 rounded-full transition-colors shrink-0 ${isLiked ? 'text-red-500' : 'text-gray-300 hover:text-red-400'}`}
          aria-label={isLiked ? t('discounts.unlike') : t('discounts.like')}
        >
          <Heart className="w-4 h-4" fill={isLiked ? 'currentColor' : 'none'} />
        </button>
      </div>

      {showDetail && (
        <DealDetailSheet deal={deal} onClose={() => setShowDetail(false)} />
      )}
    </>
  )
}
