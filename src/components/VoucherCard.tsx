import { useState, useRef, useEffect, useCallback } from 'react'
import { useSwipeable } from 'react-swipeable'
import type { Voucher } from '../types'
import { formatCurrency, getExpiryStatus, getExpiryLabel } from '../utils/helpers'
import { Edit2, Trash2, Archive, Star, Check, ExternalLink, Gift, Lock, ShoppingBag } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'

// Module-level cache: store name / domain → logo URL (or null if not found)
const logoCache = new Map<string, string | null>()

function domainLogoUrl(link?: string): string | null {
  if (!link) return null
  try {
    const h = new URL(link).hostname.replace(/^www\./, '')
    return `https://logo.clearbit.com/${h}`
  } catch { return null }
}

function StoreLogo({ name, link, color, size }: { name: string; link?: string; color: string; size: number }) {
  const initial = domainLogoUrl(link)
  const [src, setSrc] = useState<string | null>(initial)
  const [triedDomain, setTriedDomain] = useState(!!initial)

  const searchByName = useCallback(() => {
    const key = `n:${name.toLowerCase()}`
    if (logoCache.has(key)) { setSrc(logoCache.get(key) ?? null); return }
    fetch(`https://autocomplete.clearbit.com/v1/companies/suggest?query=${encodeURIComponent(name)}`)
      .then(r => r.json())
      .then((data: { logo?: string }[]) => {
        const url = data?.[0]?.logo ?? null
        logoCache.set(key, url)
        setSrc(url)
      })
      .catch(() => { logoCache.set(key, null) })
  }, [name])

  // No link → search by name on mount
  useEffect(() => {
    if (!initial) searchByName()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function onError() {
    if (triedDomain) {
      // Domain logo failed → fall back to name search
      setTriedDomain(false)
      searchByName()
    } else {
      setSrc(null)
    }
  }

  const radius = Math.round(size * 0.27)
  if (src) {
    return (
      <div style={{ width: size, height: size, borderRadius: radius, overflow: 'hidden', border: `1.5px solid ${color}30`, flexShrink: 0, background: '#fff' }}>
        <img src={src} alt={name} width={size} height={size} style={{ width: '100%', height: '100%', objectFit: 'contain' }} onError={onError} />
      </div>
    )
  }
  return (
    <div style={{ width: size, height: size, borderRadius: radius, background: color + '18', border: `1.5px solid ${color}30`, color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: Math.round(size * 0.4), flexShrink: 0 }}>
      {(name || '?')[0].toUpperCase()}
    </div>
  )
}

interface Props {
  voucher: Voucher
  onClick: () => void
  onEdit: () => void
  onDelete: () => void
  onArchive: () => void
  superVoucherName?: string
  isSelectMode?: boolean
  isSelected?: boolean
  onSelect?: () => void
  rowMode?: boolean
}

function isSafeUrl(url: string | undefined): boolean {
  if (!url) return false
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch { return false }
}

// Category → accent colour (matches DS.jsx palette)
const CAT_COLORS: Record<string, string> = {
  'אופנה':       '#8b5cf6',
  'מזון':        '#f59e0b',
  'אלקטרוניקה':  '#3b82f6',
  'יופי':        '#ec4899',
  'בית':         '#10b981',
  'ספורט':       '#0ea5e9',
  'נסיעות':      '#6366f1',
  'בידור':       '#f43f5e',
  'ילדים':       '#a855f7',
  'בריאות':      '#22c55e',
  'ספרים':       '#78716c',
  'מסעדות':      '#ef4444',
  'סופר':        '#84cc16',
  'מתנה':        '#f97316',
  'אחר':         '#6b7280',
}

function getCatColor(categories: string[]): string {
  for (const c of categories) if (CAT_COLORS[c]) return CAT_COLORS[c]
  return '#16a34a'
}

const REVEAL_EDIT   = 80
const REVEAL_DELETE = 120
const SNAP_THRESHOLD = 50

export default function VoucherCard({
  voucher, onClick, onEdit, onDelete, onArchive,
  superVoucherName, isSelectMode, isSelected, onSelect, rowMode,
}: Props) {
  const [hovered, setHovered] = useState(false)
  const [swipeX, setSwipeX] = useState(0)
  const [snapped, setSnapped] = useState<'edit' | 'delete' | null>(null)
  const [animating, setAnimating] = useState(false)
  const { profile } = useAuth()
  const baseXRef = useRef(0)

  const safeLink   = isSafeUrl(voucher.link) ? voucher.link : undefined
  const expiryStatus = getExpiryStatus(voucher.expiry_date)
  const expiryLabel  = getExpiryLabel(voucher.expiry_date)
  const pct = voucher.amount > 0 ? (voucher.balance / voucher.amount) * 100 : 0

  const showVoucherValue = profile?.show_voucher_value && voucher.value_percent != null && voucher.value_percent > 0 && voucher.value_percent < 100
  const valuePercent = showVoucherValue ? voucher.value_percent!.toFixed(0) : null
  const actualCost   = showVoucherValue && voucher.actual_cost != null ? voucher.actual_cost : null

  const catColor = getCatColor(voucher.categories)

  // Expiry chip colours — shown for every voucher that has a date
  const expiryChip = (() => {
    if (!voucher.expiry_date) return null
    if (expiryStatus === 'expired')  return { color: '#6b7280', bg: '#f3f4f6' }
    if (expiryStatus === 'critical') return { color: '#ef4444', bg: '#fef2f2' }
    if (expiryStatus === 'warning')  return { color: '#d97706', bg: '#fffbeb' }
    return { color: 'var(--c-text3)', bg: 'var(--c-bg)' }
  })()

  function snapTo(x: number, s: 'edit' | 'delete' | null) {
    setAnimating(true); setSwipeX(x); setSnapped(s)
  }
  function closeSwipe() { snapTo(0, null) }
  function handleClick() {
    if (snapped) { closeSwipe(); return }
    if (isSelectMode) onSelect?.()
    else onClick()
  }

  const swipeHandlers = useSwipeable({
    onSwipeStart: () => {
      if (isSelectMode) return
      baseXRef.current = snapped === 'edit' ? REVEAL_EDIT : snapped === 'delete' ? -REVEAL_DELETE : 0
      setAnimating(false)
    },
    onSwiping: ({ deltaX }) => {
      if (isSelectMode) return
      const raw = baseXRef.current + deltaX
      setSwipeX(raw > 0 ? Math.min(REVEAL_EDIT + 16, raw) : Math.max(-(REVEAL_DELETE + 16), raw))
    },
    onSwiped: ({ deltaX }) => {
      if (isSelectMode) return
      const raw = baseXRef.current + deltaX
      if (raw > SNAP_THRESHOLD) snapTo(REVEAL_EDIT, 'edit')
      else if (raw < -SNAP_THRESHOLD) snapTo(-REVEAL_DELETE, 'delete')
      else snapTo(0, null)
    },
    preventScrollOnSwipe: false,
    trackMouse: false,
    delta: 10,
  })

  const slideStyle: React.CSSProperties = {
    transform: `translateX(${swipeX}px)`,
    transition: animating ? 'transform 200ms ease-out' : 'none',
    touchAction: 'pan-y',
  }

  // ─── Swipe backgrounds (shared between row/card) ───────────────────────────
  const SwipeBgs = (
    <>
      <div className="sm:hidden absolute inset-y-0 left-0 flex items-center justify-center bg-blue-500" style={{ width: REVEAL_EDIT }}>
        <button onClick={e => { e.stopPropagation(); closeSwipe(); onEdit() }} className="flex flex-col items-center gap-0.5 text-white" aria-label={`ערוך ${voucher.store_name}`}>
          <Edit2 className="w-4 h-4" />
          <span className="text-xs font-medium">עריכה</span>
        </button>
      </div>
      <div className="sm:hidden absolute inset-y-0 right-0 flex" style={{ width: REVEAL_DELETE }}>
        <div className="flex-1 bg-amber-500 flex items-center justify-center">
          <button onClick={e => { e.stopPropagation(); closeSwipe(); onArchive() }} className="flex flex-col items-center gap-0.5 text-white" aria-label={`ארכיון ${voucher.store_name}`}>
            <Archive className="w-4 h-4" /><span className="text-xs font-medium">ארכיון</span>
          </button>
        </div>
        <div className="flex-1 bg-red-500 flex items-center justify-center">
          <button onClick={e => { e.stopPropagation(); closeSwipe(); onDelete() }} className="flex flex-col items-center gap-0.5 text-white" aria-label={`מחק ${voucher.store_name}`}>
            <Trash2 className="w-4 h-4" /><span className="text-xs font-medium">מחיקה</span>
          </button>
        </div>
      </div>
    </>
  )

  // ─── Desktop hover actions ──────────────────────────────────────────────────
  const HoverActions = hovered && !isSelectMode ? (
    <div className="absolute top-2 left-2 flex gap-1 z-10 animate-fade-in" role="group" aria-label={`פעולות עבור ${voucher.store_name}`}>
      <button onClick={e => { e.stopPropagation(); onEdit() }}    aria-label={`ערוך ${voucher.store_name}`}    className="p-1.5 bg-white rounded-lg shadow text-blue-500 hover:bg-blue-50 transition-colors"><Edit2   className="w-3.5 h-3.5" /></button>
      <button onClick={e => { e.stopPropagation(); onArchive() }} aria-label={`ארכיון ${voucher.store_name}`} className="p-1.5 bg-white rounded-lg shadow text-gray-500 hover:bg-gray-50 transition-colors"><Archive className="w-3.5 h-3.5" /></button>
      <button onClick={e => { e.stopPropagation(); onDelete() }}  aria-label={`מחק ${voucher.store_name}`}    className="p-1.5 bg-white rounded-lg shadow text-red-500 hover:bg-red-50 transition-colors">  <Trash2  className="w-3.5 h-3.5" /></button>
    </div>
  ) : null

  // ─── Status icons ───────────────────────────────────────────────────────────
  const StatusIcons = (
    <div className="flex items-center gap-1.5">
      {voucher.is_locked && voucher.lock_reason === 'for_sale' && (
        <span className="text-amber-500"><ShoppingBag className="w-3.5 h-3.5" /></span>
      )}
      {voucher.is_locked && voucher.lock_reason !== 'for_sale' && (
        <span className="text-orange-500"><Lock className="w-3.5 h-3.5" /></span>
      )}
      {voucher.is_gift && <span className="text-pink-500"><Gift className="w-3.5 h-3.5" /></span>}
      {safeLink && (
        <a href={safeLink} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} className="text-blue-500 hover:opacity-70">
          <ExternalLink className="w-3.5 h-3.5" />
        </a>
      )}
    </div>
  )

  // ─── ROW MODE ──────────────────────────────────────────────────────────────
  if (rowMode) {
    return (
      <div
        className={`relative voucher-card overflow-hidden ${isSelected ? 'ring-2 ring-green-500 ring-offset-1' : ''}`}
        style={{ borderRadius: 'var(--r-card)', boxShadow: 'var(--shadow-card)' }}
      >
        {SwipeBgs}
        <div
          {...swipeHandlers}
          style={{ ...slideStyle, display: 'flex', background: 'var(--c-surface)' }}
          onClick={handleClick}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
        >
          {/* Color strip (RTL start = right) */}
          <div style={{ width: 5, background: catColor, flexShrink: 0 }} />

          <div className="flex items-center gap-3 flex-1 min-w-0 px-3 py-3">
            {isSelectMode && (
              <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-all ${isSelected ? 'bg-green-500 border-green-500' : 'bg-white border-gray-300'}`}>
                {isSelected && <Check className="w-3 h-3 text-white" />}
              </div>
            )}

            {/* Store avatar */}
            <StoreLogo name={superVoucherName || voucher.store_name} link={voucher.link} color={catColor} size={36} />

            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                {superVoucherName && <Star className="w-3 h-3 text-amber-400 fill-amber-400 flex-shrink-0" />}
                <span className="font-semibold text-sm truncate" style={{ color: 'var(--c-text)' }}>
                  {superVoucherName || voucher.store_name}
                </span>
              </div>
              {voucher.categories[0] && (
                <span className="text-xs" style={{ color: 'var(--c-text3)' }}>{voucher.categories[0]}</span>
              )}
            </div>

            {voucher.amount > 0 && (
              <div className="w-14 h-1.5 rounded-full overflow-hidden flex-shrink-0" style={{ background: 'var(--c-bg)' }}>
                <div className="h-full rounded-full" style={{ width: `${Math.min(100, pct)}%`, background: catColor }} />
              </div>
            )}

            <div className="flex items-center gap-2 flex-shrink-0">
              {StatusIcons}
              {expiryChip && expiryLabel && (
                <span className="text-xs font-medium px-2 py-0.5 rounded-full" style={{ color: expiryChip.color, background: expiryChip.bg }}>
                  {expiryLabel}
                </span>
              )}
              <div className="text-left">
                <div className="text-base font-bold" style={{ color: 'var(--c-text)' }}>{formatCurrency(voucher.balance)}</div>
                {valuePercent && (
                  <div className="text-xs" style={{ color: 'var(--c-text3)' }}>ערך {valuePercent}%{actualCost != null ? ` | ${actualCost.toLocaleString('he-IL')}` : ''}</div>
                )}
              </div>
            </div>

            {hovered && !isSelectMode && (
              <div className="flex gap-1" role="group">
                <button onClick={e => { e.stopPropagation(); onEdit() }}    className="p-1.5 bg-white rounded-lg shadow text-blue-500 hover:bg-blue-50"><Edit2   className="w-3.5 h-3.5" /></button>
                <button onClick={e => { e.stopPropagation(); onArchive() }} className="p-1.5 bg-white rounded-lg shadow text-gray-500 hover:bg-gray-50"><Archive className="w-3.5 h-3.5" /></button>
                <button onClick={e => { e.stopPropagation(); onDelete() }}  className="p-1.5 bg-white rounded-lg shadow text-red-500 hover:bg-red-50">  <Trash2  className="w-3.5 h-3.5" /></button>
              </div>
            )}
          </div>
        </div>
      </div>
    )
  }

  // ─── CARD MODE ─────────────────────────────────────────────────────────────
  return (
    <div
      className={`relative voucher-card overflow-hidden ${isSelected ? 'ring-2 ring-green-500 ring-offset-1' : ''}`}
      style={{ borderRadius: 'var(--r-card)', boxShadow: 'var(--shadow-card)' }}
    >
      {SwipeBgs}

      <div
        {...swipeHandlers}
        style={{ ...slideStyle, display: 'flex', background: 'var(--c-surface)' }}
        onClick={handleClick}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        {/* Category color strip (RTL → appears on the right, which is the start) */}
        <div style={{ width: 5, background: catColor, flexShrink: 0 }} />

        {/* Card body */}
        <div className="flex-1 min-w-0" style={{ padding: '14px 14px 12px 14px' }}>

          {/* Select checkbox */}
          {isSelectMode && (
            <div className="absolute top-2 right-2 z-10">
              <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all ${isSelected ? 'bg-green-500 border-green-500' : 'bg-white border-gray-300'}`}>
                {isSelected && <Check className="w-3 h-3 text-white" />}
              </div>
            </div>
          )}

          {HoverActions}

          {/* Top row: avatar + name + balance */}
          <div className="flex items-center gap-3">
            {/* Store avatar */}
            <StoreLogo name={superVoucherName || voucher.store_name} link={voucher.link} color={catColor} size={44} />

            {/* Name */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                {superVoucherName && <Star className="w-3.5 h-3.5 text-amber-400 fill-amber-400 flex-shrink-0" />}
                <span className="font-bold text-base truncate" style={{ color: 'var(--c-text)' }}>
                  {superVoucherName || voucher.store_name}
                </span>
                {voucher.is_locked && voucher.lock_reason === 'for_sale' && (
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full flex-shrink-0"
                    style={{ background: 'var(--c-gold-light)', color: 'var(--c-gold)' }}>
                    למכירה
                  </span>
                )}
              </div>
              {superVoucherName && (
                <p className="text-xs truncate" style={{ color: 'var(--c-text3)' }}>{voucher.store_name}</p>
              )}
              {voucher.categories[0] && !superVoucherName && (
                <span className="text-xs" style={{ color: 'var(--c-text3)' }}>
                  {voucher.categories[0]}{voucher.source ? ` · ${voucher.source}` : ''}
                </span>
              )}
            </div>

            {/* Balance */}
            <div className="text-left flex-shrink-0">
              <div className="font-extrabold" style={{ fontSize: 22, letterSpacing: '-0.5px', lineHeight: 1, color: 'var(--c-text)' }}>
                {formatCurrency(voucher.balance)}
              </div>
              {voucher.amount !== voucher.balance && (
                <div className="text-right mt-0.5" style={{ fontSize: 11, color: 'var(--c-text3)', textDecoration: 'line-through' }}>
                  {formatCurrency(voucher.amount)}
                </div>
              )}
              {valuePercent && (
                <div className="text-xs text-right mt-0.5" style={{ color: 'var(--c-text3)' }}>
                  ערך {valuePercent}%{actualCost != null ? ` | ${actualCost.toLocaleString('he-IL')}` : ''}
                </div>
              )}
            </div>
          </div>

          {/* Progress bar */}
          {voucher.amount > 0 && voucher.amount !== voucher.balance && (
            <div className="mt-3 h-[3px] rounded-full overflow-hidden" style={{ background: 'var(--c-bg)' }}>
              <div
                className="h-full rounded-full transition-all"
                style={{ width: `${Math.min(100, pct)}%`, background: catColor }}
              />
            </div>
          )}

          {/* Bottom row: expiry + status */}
          <div className="flex items-center justify-between mt-2.5">
            <div className="flex items-center gap-1.5 flex-wrap">
              {expiryChip && expiryLabel && (
                <span
                  className="text-xs font-medium px-2 py-0.5 rounded-full"
                  style={{ color: expiryChip.color, background: expiryChip.bg }}
                >
                  {expiryStatus === 'critical' ? '⚠ ' : ''}{expiryLabel}
                </span>
              )}
              {voucher.tags.slice(0, 1).map(t => (
                <span key={t} className="text-xs px-2 py-0.5 rounded-full" style={{ color: 'var(--c-text3)', background: 'var(--c-bg)' }}>
                  {t}
                </span>
              ))}
            </div>

            <div className="flex items-center gap-2">
              {StatusIcons}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
