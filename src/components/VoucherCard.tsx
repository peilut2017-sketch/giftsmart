import { useState } from 'react'
import type { Voucher } from '../types'
import { formatCurrency, getExpiryStatus, getExpiryLabel } from '../utils/helpers'
import { Edit2, Trash2, Archive, AlertTriangle, Star, Check } from 'lucide-react'

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
}

export default function VoucherCard({ voucher, onClick, onEdit, onDelete, onArchive, superVoucherName, isSelectMode, isSelected, onSelect }: Props) {
  const [hovered, setHovered] = useState(false)
  const expiryStatus = getExpiryStatus(voucher.expiry_date)
  const expiryLabel = getExpiryLabel(voucher.expiry_date)
  const pct = voucher.amount > 0 ? (voucher.balance / voucher.amount) * 100 : 0

  const cardBg =
    expiryStatus === 'critical' ? 'bg-gradient-to-br from-red-50 to-orange-50 border-red-200' :
    expiryStatus === 'warning' ? 'bg-gradient-to-br from-yellow-50 to-amber-50 border-yellow-200' :
    'bg-white border-gray-100'

  const barColor =
    pct > 60 ? 'bg-green-500' :
    pct > 25 ? 'bg-yellow-400' :
    'bg-red-400'

  function handleClick() {
    if (isSelectMode) {
      onSelect?.()
    } else {
      onClick()
    }
  }

  return (
    <div
      className={`relative voucher-card rounded-2xl border ${cardBg} ${isSelected ? 'ring-2 ring-green-500 ring-offset-1' : ''} shadow-sm overflow-hidden cursor-pointer transition-all`}
      onClick={handleClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Select checkbox (select mode) */}
      {isSelectMode && (
        <div className="absolute top-2 right-2 z-10">
          <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all ${isSelected ? 'bg-green-500 border-green-500' : 'bg-white border-gray-300'}`}>
            {isSelected && <Check className="w-3 h-3 text-white" />}
          </div>
        </div>
      )}

      {/* Hover actions (non-select mode) */}
      {hovered && !isSelectMode && (
        <div className="absolute top-2 left-2 flex gap-1 z-10 animate-fade-in">
          <button
            onClick={e => { e.stopPropagation(); onEdit() }}
            className="p-1.5 bg-white rounded-lg shadow text-blue-500 hover:bg-blue-50 transition-colors"
            title="עריכה"
          >
            <Edit2 className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={e => { e.stopPropagation(); onArchive() }}
            className="p-1.5 bg-white rounded-lg shadow text-gray-500 hover:bg-gray-50 transition-colors"
            title="ארכיון"
          >
            <Archive className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={e => { e.stopPropagation(); onDelete() }}
            className="p-1.5 bg-white rounded-lg shadow text-red-500 hover:bg-red-50 transition-colors"
            title="מחיקה"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      <div className="p-4">
        {/* Header */}
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
          <div className="text-left flex-shrink-0">
            <div className="text-lg font-bold text-gray-900">{formatCurrency(voucher.balance)}</div>
            {voucher.amount !== voucher.balance && (
              <div className="text-xs text-gray-400">מתוך {formatCurrency(voucher.amount)}</div>
            )}
          </div>
        </div>

        {/* Progress bar */}
        {voucher.amount > 0 && (
          <div className="mb-3">
            <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${barColor}`}
                style={{ width: `${Math.min(100, pct)}%` }}
              />
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between">
          <div className="flex gap-1 flex-wrap">
            {voucher.categories.slice(0, 2).map(cat => (
              <span key={cat} className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
                {cat}
              </span>
            ))}
          </div>
          <div className="flex items-center gap-1">
            {(expiryStatus === 'critical' || expiryStatus === 'warning') && (
              <AlertTriangle className={`w-3.5 h-3.5 ${expiryStatus === 'critical' ? 'text-red-500' : 'text-yellow-500'}`} />
            )}
            {expiryLabel && (
              <span className={`text-xs font-medium ${
                expiryStatus === 'expired' ? 'text-gray-400' :
                expiryStatus === 'critical' ? 'text-red-600' :
                expiryStatus === 'warning' ? 'text-yellow-600' :
                'text-gray-400'
              }`}>
                {expiryLabel}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
