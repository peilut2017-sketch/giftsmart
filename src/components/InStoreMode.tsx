import { useState, useMemo, useEffect, useRef } from 'react'
import { X, Search, ShoppingCart, Check, QrCode, ArrowUpLeft } from 'lucide-react'
import JsBarcode from 'jsbarcode'
import QRCodeLib from 'qrcode'
import type { Voucher, SuperVoucher } from '../types'
import toast from 'react-hot-toast'

interface Props {
  vouchers: Voucher[]
  superVouchers: SuperVoucher[]
  onUpdate: (id: string, balance: number, storeUsed?: string | null) => Promise<void>
  onNavigate: (id: string) => void
  onClose: () => void
}

function sortGroup(vs: Voucher[]) {
  return [...vs].sort((a, b) => {
    if (a.balance === 0 && b.balance !== 0) return 1
    if (a.balance !== 0 && b.balance === 0) return -1
    if (!a.expiry_date && !b.expiry_date) return a.balance - b.balance
    if (!a.expiry_date) return 1
    if (!b.expiry_date) return -1
    const d = new Date(a.expiry_date).getTime() - new Date(b.expiry_date).getTime()
    return d !== 0 ? d : a.balance - b.balance
  })
}

function isAlphanumericCode(code: string) {
  return /[a-zA-Z]/.test(code)
}

function BarcodeDisplay({ code }: { code: string }) {
  const barcodeRef = useRef<SVGSVGElement>(null)
  const qrRef = useRef<HTMLCanvasElement>(null)
  const isAlpha = isAlphanumericCode(code)

  useEffect(() => {
    if (!code) return
    if (!isAlpha && barcodeRef.current) {
      try {
        JsBarcode(barcodeRef.current, code, {
          format: 'CODE128',
          width: 2,
          height: 60,
          displayValue: false,
          margin: 8,
        })
      } catch {}
    }
    if (isAlpha && qrRef.current) {
      QRCodeLib.toCanvas(qrRef.current, code, {
        width: 180,
        margin: 2,
        color: { dark: '#1e293b', light: '#ffffff' },
      }).catch(() => {})
    }
  }, [code, isAlpha])

  return (
    <div className="flex justify-center py-2">
      {!isAlpha
        ? <svg ref={barcodeRef} className="max-w-full" />
        : <canvas ref={qrRef} className="rounded-lg" />}
    </div>
  )
}

export default function InStoreMode({ vouchers, superVouchers, onUpdate, onNavigate, onClose }: Props) {
  const [search, setSearch] = useState('')
  const [payments, setPayments] = useState<Record<string, string>>({})
  const [transactionTotal, setTransactionTotal] = useState(0)
  const [updating, setUpdating] = useState<string | null>(null)
  const [expandedBarcode, setExpandedBarcode] = useState<string | null>(null)

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim()
    return vouchers.filter(v => {
      if (v.is_archived) return false
      if (!q) return true
      const sv = superVouchers.find(s => s.id === v.super_voucher_id)
      return (
        v.store_name.toLowerCase().includes(q) ||
        (sv != null && sv.stores.some(s => s.toLowerCase().includes(q)))
      )
    })
  }, [vouchers, superVouchers, search])

  const directVouchers = sortGroup(filtered.filter(v => !v.super_voucher_id))
  const superGroupVouchers = sortGroup(filtered.filter(v => !!v.super_voucher_id))

  const directTotal = directVouchers.filter(v => v.balance > 0).reduce((s, v) => s + v.balance, 0)
  const superTotal = superGroupVouchers.filter(v => v.balance > 0).reduce((s, v) => s + v.balance, 0)

  async function handleUpdate(v: Voucher) {
    const amt = parseFloat(payments[v.id] || '0')
    if (!amt || amt <= 0) { toast.error('הזן סכום תקין'); return }
    if (amt > v.balance) { toast.error('הסכום גדול מהיתרה'); return }
    setUpdating(v.id)
    try {
      const newBal = Math.max(0, v.balance - amt)
      await onUpdate(v.id, newBal, search.trim() || null)
      setTransactionTotal(t => t + amt)
      setPayments(p => ({ ...p, [v.id]: '' }))
      toast.success(`יתרת ${v.store_name} עודכנה`)
    } catch {
      toast.error('שגיאה בעדכון')
    } finally {
      setUpdating(null)
    }
  }

  function toggleBarcode(id: string) {
    setExpandedBarcode(prev => prev === id ? null : id)
  }

  return (
    <div className="fixed inset-0 z-[70] flex flex-col bg-white" dir="rtl">
      {/* Header */}
      <div
        style={{ background: 'linear-gradient(160deg, #065f46 0%, #059669 60%, #0d9488 100%)' }}
        className="px-4 pt-5 pb-4 shrink-0"
      >
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="text-lg font-bold text-white">אני בחנות</h2>
            <p className="text-xs text-green-200">בחר שוברים לשימוש</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-full bg-white/10">
            <X className="w-5 h-5 text-white" />
          </button>
        </div>

        {/* Totals */}
        <div className="flex gap-2 mb-3">
          <div className="flex-1 bg-white/10 rounded-2xl px-3 py-2">
            <div className="text-xs text-green-200 mb-0.5">ישיר</div>
            <div className="text-base font-bold text-white">₪{directTotal.toLocaleString('he-IL')}</div>
          </div>
          <div className="flex-1 bg-white/10 rounded-2xl px-3 py-2">
            <div className="text-xs text-green-200 mb-0.5">שובר-על</div>
            <div className="text-base font-bold text-white">₪{superTotal.toLocaleString('he-IL')}</div>
          </div>
          <div className="flex-1 rounded-2xl px-3 py-2" style={{ background: 'rgba(251,191,36,0.25)', border: '1px solid rgba(251,191,36,0.3)' }}>
            <div className="text-xs text-amber-200 mb-0.5">עסקה זו</div>
            <div className="text-base font-bold text-amber-100">₪{transactionTotal.toLocaleString('he-IL')}</div>
          </div>
        </div>

        {/* Search */}
        <div className="flex items-center gap-2 rounded-2xl px-3 py-2" style={{ background: 'rgba(255,255,255,0.15)' }}>
          <Search className="w-4 h-4 shrink-0" style={{ color: 'rgba(255,255,255,0.6)' }} />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="חפש חנות..."
            className="flex-1 bg-transparent text-sm focus:outline-none"
            style={{ color: '#fff' }}
          />
          {search && (
            <button onClick={() => setSearch('')}>
              <X className="w-3.5 h-3.5" style={{ color: 'rgba(255,255,255,0.6)' }} />
            </button>
          )}
        </div>
      </div>

      {/* Voucher list */}
      <div className="flex-1 overflow-y-auto p-4 space-y-2 pb-8">
        {directVouchers.length === 0 && superGroupVouchers.length === 0 ? (
          <div className="text-center py-12 text-gray-400">
            <ShoppingCart className="w-10 h-10 mx-auto opacity-30 mb-2" />
            <p className="font-medium text-sm">
              {search ? 'לא נמצאו שוברים לחנות זו' : 'אין שוברים'}
            </p>
          </div>
        ) : (
          <>
            {directVouchers.length > 0 && superGroupVouchers.length > 0 && (
              <p className="text-xs text-gray-400 font-medium px-1">שוברים ישירים</p>
            )}
            {directVouchers.map(v => (
              <VoucherRow
                key={v.id}
                voucher={v}
                payment={payments[v.id] || ''}
                barcodeOpen={expandedBarcode === v.id}
                onPaymentChange={val => setPayments(p => ({ ...p, [v.id]: val }))}
                onFill={() => setPayments(p => ({ ...p, [v.id]: v.balance.toString() }))}
                onUpdate={() => handleUpdate(v)}
                onToggleBarcode={() => toggleBarcode(v.id)}
                onNavigate={() => onNavigate(v.id)}
                updating={updating === v.id}
              />
            ))}
            {superGroupVouchers.length > 0 && (
              <p className="text-xs text-gray-400 font-medium px-1 pt-2">שוברי-על</p>
            )}
            {superGroupVouchers.map(v => (
              <VoucherRow
                key={v.id}
                voucher={v}
                payment={payments[v.id] || ''}
                barcodeOpen={expandedBarcode === v.id}
                onPaymentChange={val => setPayments(p => ({ ...p, [v.id]: val }))}
                onFill={() => setPayments(p => ({ ...p, [v.id]: v.balance.toString() }))}
                onUpdate={() => handleUpdate(v)}
                onToggleBarcode={() => toggleBarcode(v.id)}
                onNavigate={() => onNavigate(v.id)}
                updating={updating === v.id}
              />
            ))}
          </>
        )}
      </div>
    </div>
  )
}

function VoucherRow({ voucher: v, payment, barcodeOpen, onPaymentChange, onFill, onUpdate, onToggleBarcode, onNavigate, updating }: {
  voucher: Voucher
  payment: string
  barcodeOpen: boolean
  onPaymentChange: (val: string) => void
  onFill: () => void
  onUpdate: () => void
  onToggleBarcode: () => void
  onNavigate: () => void
  updating: boolean
}) {
  const isEmpty = v.balance <= 0

  async function copyCode() {
    await navigator.clipboard.writeText(v.code).catch(() => {})
    toast.success('קוד הועתק')
  }

  return (
    <div className={`bg-white rounded-2xl border shadow-sm transition-opacity ${isEmpty ? 'opacity-50' : ''}`}>
      {/* Top row: store info + payment controls */}
      <div className="p-3 flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-gray-900 text-sm truncate">{v.store_name}</p>
          <p className={`text-xs font-bold ${isEmpty ? 'text-gray-400' : 'text-green-600'}`}>
            ₪{v.balance.toLocaleString('he-IL')}
          </p>
          {v.expiry_date && (
            <p className="text-xs text-gray-400">{v.expiry_date.slice(0, 10)}</p>
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <input
            type="number"
            inputMode="decimal"
            value={payment}
            onChange={e => onPaymentChange(e.target.value)}
            placeholder="₪"
            disabled={isEmpty}
            min={0}
            max={v.balance}
            className="w-16 px-2 py-1.5 border border-gray-200 rounded-xl text-sm text-center focus:outline-none focus:ring-2 focus:ring-green-300 disabled:opacity-40"
            dir="ltr"
          />
          <button
            type="button"
            onClick={onFill}
            disabled={isEmpty}
            className="px-2.5 py-1.5 text-xs bg-gray-100 text-gray-600 rounded-xl hover:bg-gray-200 disabled:opacity-40 font-medium"
          >
            מלא
          </button>
          <button
            type="button"
            onClick={onUpdate}
            disabled={isEmpty || updating || !payment}
            className="px-2.5 py-1.5 text-xs bg-green-500 text-white rounded-xl hover:bg-green-600 disabled:opacity-40 font-medium flex items-center justify-center"
          >
            {updating ? '...' : <Check className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {/* Code row */}
      <div className="px-3 pb-2.5 flex items-center gap-2 border-t border-gray-50 pt-2">
        <button
          onClick={copyCode}
          className="flex-1 min-w-0 text-right"
        >
          <span className="font-mono text-xs text-gray-700 tracking-wider bg-gray-50 px-2.5 py-1 rounded-lg inline-block truncate max-w-full">
            {v.code}
          </span>
        </button>
        {v.cvv && (
          <span className="text-xs text-gray-400 shrink-0">CVV: <span className="font-mono font-semibold text-gray-600">{v.cvv}</span></span>
        )}
        <button
          onClick={onToggleBarcode}
          className={`flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium shrink-0 transition-colors ${barcodeOpen ? 'bg-blue-100 text-blue-600' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}
        >
          <QrCode className="w-3 h-3" />
          {barcodeOpen ? 'סגור' : 'ברקוד'}
        </button>
        <button
          onClick={onNavigate}
          className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium bg-gray-100 text-gray-500 hover:bg-gray-200 shrink-0"
          title="עבור לשובר"
        >
          <ArrowUpLeft className="w-3 h-3" />
        </button>
      </div>

      {/* Barcode panel */}
      {barcodeOpen && (
        <div className="border-t border-gray-100 bg-gray-50 rounded-b-2xl overflow-hidden">
          <BarcodeDisplay code={v.code} />
        </div>
      )}
    </div>
  )
}
