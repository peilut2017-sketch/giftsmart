import { useState, useRef } from 'react'
import { useSwipeable } from 'react-swipeable'
import type { Voucher } from '../types'
import { formatCurrency, getExpiryStatus, getExpiryLabel } from '../utils/helpers'
import { Edit2, Trash2, Archive, AlertTriangle, Star, Check, ExternalLink } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'

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
  } catch {
    return false
  }
}

const REVEAL_EDIT = 80    // px revealed on swipe-right → edit
const REVEAL_DELETE = 120 // px revealed on swipe-left → archive + delete
const SNAP_THRESHOLD = 50

export default function VoucherCard({ voucher, onClick, onEdit, onDelete, onArchive, superVoucherName, isSelectMode, isSelected, onSelect, rowMode }: Props) {
  const [hovered, setHovered] = useState(false)
  const [swipeX, setSwipeX] = useState(0)
  const [snapped, setSnapped] = useState<'edit' | 'delete' | null>(null)
  const [animating, setAnimating] = useState(false)
  const { profile } = useAuth()
  const baseXRef = useRef(0)

  const safeLink = isSafeUrl(voucher.link) ? voucher.link : undefined
  const expiryStatus = getExpiryStatus(voucher.expiry_date)
  const expiryLabel = getExpiryLabel(voucher.expiry_date)
  const pct = voucher.amount > 0 ? (voucher.balance / voucher.amount) * 100 : 0

  const showVoucherValue = profile?.show_voucher_value && voucher.value_percent != null && voucher.value_percent > 0 && voucher.value_percent < 100
  const valueLessPercent = showVoucherValue ? (100 - voucher.value_percent!).toFixed(0) : null

  const cardBgClass =
    expiryStatus === 'critical' ? 'bg-gradient-to-br from-red-50 to-orange-50' :
    expiryStatus === 'warning'  ? 'bg-gradient-to-br from-yellow-50 to-amber-50' :
    'bg-white'

  const cardBorderClass =
    expiryStatus === 'critical' ? 'border-red-200' :
    expiryStatus === 'warning'  ? 'border-yellow-200' :
    'border-gray-100'

  const barColor =
    pct > 60 ? 'bg-green-500' :
    pct > 25 ? 'bg-yellow-400' :
    'bg-red-400'

  function snapTo(x: number, newSnapped: 'edit' | 'delete' | null) {
    setAnimating(true)
    setSwipeX(x)
    setSnapped(newSnapped)
  }

  function closeSwipe() {
    snapTo(0, null)
  }

  function handleClick() {
    if (snapped) { closeSwipe(); return }
    if (isSelectMode) { onSelect?.() } else { onClick() }
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
      const clamped = raw > 0
        ? Math.min(REVEAL_EDIT + 16, raw)
        : Math.max(-(REVEAL_DELETE + 16), raw)
      setSwipeX(clamped)
    },
    onSwiped: ({ deltaX }) => {
      if (isSelectMode) return
      const raw = baseXRef.current + deltaX
      if (raw > SNAP_THRESHOLD) {
        snapTo(REVEAL_EDIT, 'edit')
      } else if (raw < -SNAP_THRESHOLD) {
        snapTo(-REVEAL_DELETE, 'delete')
      } else {
        snapTo(0, null)
      }
    },
    preventScrollOnSwipe: true,
    trackMouse: false,
    delta: 8,
  })

  const slideStyle: React.CSSProperties = {
    transform: `translateX(${swipeX}px)`,
    transition: animating ? 'transform 200ms ease-out' : 'none',
  }

  // ── ROW MODE ───────────────────────────────────────────────────────────────
  if (rowMode) {
    return (
      <div className={`relative voucher-card rounded-2xl border ${cardBorderClass} ${isSelected ? 'ring-2 ring-green-500 ring-offset-1' : ''} shadow-sm overflow-hidden`}>

        {/* Edit — left bg, revealed on swipe-right */}
        <div className="absolute inset-y-0 left-0 flex items-center justify-center bg-blue-500" style={{ width: REVEAL_EDIT }}>
          <button
            onClick={e => { e.stopPropagation(); closeSwipe(); onEdit() }}
            className="flex flex-col items-center gap-0.5 text-white"
            aria-label={`ערוך ${voucher.store_name}`}
          >
            <Edit2 className="w-4 h-4" aria-hidden="true" />
            <span className="text-xs font-medium">עריכה</span>
          </button>
        </div>

        {/* Archive + Delete — right bg, revealed on swipe-left */}
        <div className="absolute inset-y-0 right-0 flex" style={{ width: REVEAL_DELETE }}>
          <div className="flex-1 bg-amber-500 flex items-center justify-center">
            <button
              onClick={e => { e.stopPropagation(); closeSwipe(); onArchive() }}
              className="flex flex-col items-center gap-0.5 text-white"
              aria-label={`ארכיון: ${voucher.store_name}`}
            >
              <Archive className="w-4 h-4" aria-hidden="true" />
              <span className="text-xs font-medium">ארכיון</span>
            </button>
          </div>
          <div className="flex-1 bg-red-500 flex items-center justify-center">
            <button
              onClick={e => { e.stopPropagation(); closeSwipe(); onDelete() }}
              className="flex flex-col items-center gap-0.5 text-white"
              aria-label={`מחק ${voucher.store_name}`}
            >
              <Trash2 className="w-4 h-4" aria-hidden="true" />
              <span className="text-xs font-medium">מחיקה</span>
            </button>
          </div>
        </div>

        {/* Sliding content */}
        <div
          {...swipeHandlers}
          style={slideStyle}
          className={`px-4 py-3 flex items-center gap-3 cursor-pointer ${cardBgClass}`}
          onClick={handleClick}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
        >
          {isSelectMode && (
            <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-all ${isSelected ? 'bg-green-500 border-green-500' : 'bg-white border-gray-300'}`}>
              {isSelected && <Check className="w-3 h-3 text-white" />}
            </div>
          )}

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              {superVoucherName && <Star className="w-3 h-3 text-amber-400 fill-amber-400 flex-shrink-0" />}
              <span className="font-semibold text-gray-800 text-sm truncate">
                {superVoucherName || voucher.store_name}
              </span>
              {superVoucherName && (
                <span className="text-xs text-gray-400 truncate">({voucher.store_name})</span>
              )}
            </div>
            {voucher.categories.length > 0 && (
              <span className="text-xs text-gray-400">{voucher.categories[0]}</span>
            )}
          </div>

          {voucher.amount > 0 && (
            <div className="w-16 h-1.5 bg-gray-100 rounded-full overflow-hidden flex-shrink-0">
              <div className={`h-full rounded-full ${barColor}`} style={{ width: `${Math.min(100, pct)}%` }} />
            </div>
          )}

          <div className="flex items-center gap-1.5 flex-shrink-0">
            {safeLink && (
              <a href={safeLink} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} className="p-1 rounded-full text-blue-500 hover:bg-blue-50" title="פתח קישור">
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            )}
            {(expiryStatus === 'critical' || expiryStatus === 'warning') && (
              <AlertTriangle className={`w-3.5 h-3.5 ${expiryStatus === 'critical' ? 'text-red-500' : 'text-yellow-500'}`} aria-hidden="true" />
            )}
            {expiryLabel && (
              <span className={`text-xs font-medium ${expiryStatus === 'expired' ? 'text-gray-400' : expiryStatus === 'critical' ? 'text-red-600' : expiryStatus === 'warning' ? 'text-yellow-600' : 'text-gray-400'}`}>
                {expiryLabel}
              </span>
            )}
          </div>

          <div className="text-left flex-shrink-0">
            <div className="text-base font-bold text-gray-900">{formatCurrency(voucher.balance)}</div>
            {valueLessPercent && (
              <div className="text-xs text-gray-400">(ערך {valueLessPercent}% פחות)</div>
            )}
          </div>

          {/* Desktop hover actions */}
          {hovered && !isSelectMode && (
            <div className="flex gap-1" role="group" aria-label={`פעולות עבור ${voucher.store_name}`}>
              <button onClick={e => { e.stopPropagation(); onEdit() }} aria-label={`ערוך ${voucher.store_name}`} className="p-1.5 bg-white rounded-lg shadow text-blue-500 hover:bg-blue-50">
                <Edit2 className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
              <button onClick={e => { e.stopPropagation(); onArchive() }} aria-label={`ארכיון: ${voucher.store_name}`} className="p-1.5 bg-white rounded-lg shadow text-gray-500 hover:bg-gray-50">
                <Archive className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
              <button onClick={e => { e.stopPropagation(); onDelete() }} aria-label={`מחק ${voucher.store_name}`} className="p-1.5 bg-white rounded-lg shadow text-red-500 hover:bg-red-50">
                <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
            </div>
          )}
        </div>
      </div>
    )
  }

  // ── CARD MODE ──────────────────────────────────────────────────────────────
  return (
    <div className={`relative voucher-card rounded-2xl border ${cardBorderClass} ${isSelected ? 'ring-2 ring-green-500 ring-offset-1' : ''} shadow-sm overflow-hidden`}>

      {/* Edit — left bg */}
      <div className="absolute inset-y-0 left-0 flex items-center justify-center bg-blue-500" style={{ width: REVEAL_EDIT }}>
        <button
          onClick={e => { e.stopPropagation(); closeSwipe(); onEdit() }}
          className="flex flex-col items-center gap-1 text-white"
          aria-label={`ערוך ${voucher.store_name}`}
        >
          <Edit2 className="w-5 h-5" aria-hidden="true" />
          <span className="text-xs font-medium">עריכה</span>
        </button>
      </div>

      {/* Archive + Delete — right bg */}
      <div className="absolute inset-y-0 right-0 flex" style={{ width: REVEAL_DELETE }}>
        <div className="flex-1 bg-amber-500 flex items-center justify-center">
          <button
            onClick={e => { e.stopPropagation(); closeSwipe(); onArchive() }}
            className="flex flex-col items-center gap-1 text-white"
            aria-label={`ארכיון: ${voucher.store_name}`}
          >
            <Archive className="w-5 h-5" aria-hidden="true" />
            <span className="text-xs font-medium">ארכיון</span>
          </button>
        </div>
        <div className="flex-1 bg-red-500 flex items-center justify-center">
          <button
            onClick={e => { e.stopPropagation(); closeSwipe(); onDelete() }}
            className="flex flex-col items-center gap-1 text-white"
            aria-label={`מחק ${voucher.store_name}`}
          >
            <Trash2 className="w-5 h-5" aria-hidden="true" />
            <span className="text-xs font-medium">מחיקה</span>
          </button>
        </div>
      </div>

      {/* Sliding content */}
      <div
        {...swipeHandlers}
        style={slideStyle}
        className={`relative cursor-pointer ${cardBgClass}`}
        onClick={handleClick}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        {isSelectMode && (
          <div className="absolute top-2 right-2 z-10">
            <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all ${isSelected ? 'bg-green-500 border-green-500' : 'bg-white border-gray-300'}`}>
              {isSelected && <Check className="w-3 h-3 text-white" />}
            </div>
          </div>
        )}

        {/* Desktop hover actions */}
        {hovered && !isSelectMode && (
          <div className="absolute top-2 left-2 flex gap-1 z-10 animate-fade-in" role="group" aria-label={`פעולות עבור ${voucher.store_name}`}>
            <button onClick={e => { e.stopPropagation(); onEdit() }} aria-label={`ערוך ${voucher.store_name}`} className="p-1.5 bg-white rounded-lg shadow text-blue-500 hover:bg-blue-50 transition-colors">
              <Edit2 className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
            <button onClick={e => { e.stopPropagation(); onArchive() }} aria-label={`ארכיון: ${voucher.store_name}`} className="p-1.5 bg-white rounded-lg shadow text-gray-500 hover:bg-gray-50 transition-colors">
              <Archive className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
            <button onClick={e => { e.stopPropagation(); onDelete() }} aria-label={`מחק ${voucher.store_name}`} className="p-1.5 bg-white rounded-lg shadow text-red-500 hover:bg-red-50 transition-colors">
              <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          </div>
        )}

        <div className="p-4">
          <div className="flex items-start justify-between mb-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 mb-0.5">
                {superVoucherName && <Star className="w-3.5 h-3.5 text-amber-400 fill-amber-400 flex-shrink-0" />}
                <h3 className="font-semibold text-gray-800 text-sm truncate">
                  {superVoucherName || voucher.store_name}
                </h3>
              </div>
              {superVoucherName && (
                <p className="text-xs text-gray-500 truncate">{voucher.store_name}</p>
              )}
            </div>
            <div className="flex-shrink-0 me-2">
              <div className="text-lg font-bold text-gray-900">{formatCurrency(voucher.balance)}</div>
              {voucher.amount !== voucher.balance && (
                <div className="text-xs text-gray-400">מתוך {formatCurrency(voucher.amount)}</div>
              )}
              {valueLessPercent && (
                <div className="text-xs text-gray-400">(ערך {valueLessPercent}% פחות)</div>
              )}
            </div>
          </div>

          {voucher.amount > 0 && (
            <div className="mb-3">
              <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${Math.min(100, pct)}%` }} />
              </div>
            </div>
          )}

          <div className="flex items-center justify-between">
            <div className="flex gap-1 flex-wrap">
              {voucher.categories.slice(0, 2).map(cat => (
                <span key={cat} className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">{cat}</span>
              ))}
            </div>
            <div className="flex items-center gap-1.5">
              {voucher.link && (
                <a href={voucher.link} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} className="p-1 rounded-full text-blue-500 hover:bg-blue-50 transition-colors" title="פתח קישור">
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              )}
              {(expiryStatus === 'critical' || expiryStatus === 'warning') && (
                <AlertTriangle className={`w-3.5 h-3.5 ${expiryStatus === 'critical' ? 'text-red-500' : 'text-yellow-500'}`} aria-hidden="true" />
              )}
              {expiryLabel && (
                <span className={`text-xs font-medium ${
                  expiryStatus === 'expired' ? 'text-gray-400' :
                  expiryStatus === 'critical' ? 'text-red-600' :
                  expiryStatus === 'warning' ? 'text-yellow-600' :
                  'text-gray-400'
                }`}>{expiryLabel}</span>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
