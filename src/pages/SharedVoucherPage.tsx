import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { formatCurrency, formatDate, getExpiryStatus, getExpiryLabel, isAlphanumeric } from '../utils/helpers'
import { Copy, AlertTriangle, Wallet, ChevronDown, Check } from 'lucide-react'
import toast from 'react-hot-toast'
import { Toaster } from 'react-hot-toast'
import JsBarcode from 'jsbarcode'
import QRCode from 'qrcode'

interface SharedVoucher {
  store_name: string
  balance: number
  amount: number
  code: string
  expiry_date?: string | null
  notes?: string | null
  is_expired?: boolean
}

export default function SharedVoucherPage() {
  const { token } = useParams<{ token: string }>()
  const [voucher, setVoucher] = useState<SharedVoucher | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  // Balance update state
  const [showUpdateForm, setShowUpdateForm] = useState(false)
  const [usedAmount, setUsedAmount] = useState('')
  const [updating, setUpdating] = useState(false)

  const barcodeRef = useRef<SVGSVGElement>(null)
  const qrRef = useRef<HTMLCanvasElement>(null)
  const usedInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!token) { setError('לינק לא תקין'); setLoading(false); return }
    loadSharedVoucher()
  }, [token])

  // Render barcode or QR once voucher data is ready
  useEffect(() => {
    if (!voucher?.code) return
    const isAlpha = isAlphanumeric(voucher.code)

    if (!isAlpha && barcodeRef.current) {
      try {
        JsBarcode(barcodeRef.current, voucher.code, {
          format: 'CODE128',
          width: 2,
          height: 72,
          displayValue: false,
          margin: 8,
        })
      } catch {}
    }

    if (isAlpha && qrRef.current) {
      QRCode.toCanvas(qrRef.current, voucher.code, {
        width: 200,
        margin: 2,
        color: { dark: '#1e293b', light: '#ffffff' },
      }).catch(() => {})
    }
  }, [voucher?.code])

  // Focus the input when the update form opens
  useEffect(() => {
    if (showUpdateForm) setTimeout(() => usedInputRef.current?.focus(), 80)
  }, [showUpdateForm])

  async function loadSharedVoucher() {
    try {
      const { data, error: rpcError } = await supabase
        .rpc('get_shared_voucher_live', { p_token: token })

      if (rpcError || !data || data.length === 0) {
        setError('לינק לא נמצא או שפג תוקפו')
        setLoading(false)
        return
      }

      const row = data[0] as SharedVoucher

      if (row.is_expired) {
        setError('פג תוקף הלינק')
        setLoading(false)
        return
      }

      if (!row.code) {
        setError('נתוני השובר אינם זמינים')
        setLoading(false)
        return
      }

      setVoucher(row)

      // Increment view count atomically via RPC
      supabase.rpc('increment_share_view_count', { p_token: token }).then(() => {})
    } catch {
      setError('שגיאה בטעינת השובר')
    } finally {
      setLoading(false)
    }
  }

  function copyCode() {
    if (!voucher?.code) return
    navigator.clipboard.writeText(voucher.code).then(() => {
      setCopied(true)
      toast.success('הקוד הועתק!')
      setTimeout(() => setCopied(false), 2000)
    })
  }

  async function handleUpdateBalance() {
    if (!voucher || !token) return
    const used = parseFloat(usedAmount)
    if (isNaN(used) || used < 0) return toast.error('סכום לא תקין')
    if (used > voucher.balance) return toast.error(`לא ניתן לנצל יותר מהיתרה (₪${voucher.balance})`)

    const newBalance = Math.max(0, voucher.balance - used)
    const oldBalance = voucher.balance
    setUpdating(true)

    const { data, error } = await supabase.rpc('update_voucher_balance_by_token', {
      p_token: token,
      p_new_balance: newBalance,
    })
    setUpdating(false)

    if (error || !data?.success) {
      const msg = (data?.error as string) || error?.message || 'שגיאה'
      if (msg === 'token_expired') toast.error('הלינק פג תוקף')
      else toast.error('שגיאה בעדכון יתרה')
      return
    }

    // Optimistic update
    setVoucher(v => v ? { ...v, balance: newBalance } : v)
    setUsedAmount('')
    setShowUpdateForm(false)

    // Undo toast — restores old balance
    toast(
      (t) => (
        <span className="flex items-center gap-2">
          <span>יתרה עודכנה: {formatCurrency(oldBalance)} ← {formatCurrency(newBalance)}</span>
          <button
            onClick={async () => {
              toast.dismiss(t.id)
              const { data: undoData } = await supabase.rpc('update_voucher_balance_by_token', {
                p_token: token,
                p_new_balance: oldBalance,
              })
              if (undoData?.success) {
                setVoucher(v => v ? { ...v, balance: oldBalance } : v)
                toast.success('הפעולה בוטלה')
              }
            }}
            className="text-blue-600 font-semibold underline text-sm"
          >
            ביטול
          </button>
        </span>
      ),
      { duration: 5000, icon: '✅' }
    )
  }

  const expiryStatus = voucher ? getExpiryStatus(voucher.expiry_date ?? undefined) : 'none'
  const expiryLabel = voucher ? getExpiryLabel(voucher.expiry_date ?? undefined) : ''
  const pct = voucher && voucher.amount > 0 ? (voucher.balance / voucher.amount) * 100 : 0
  const barColor = pct > 60 ? 'bg-green-500' : pct > 25 ? 'bg-yellow-400' : 'bg-red-400'
  const isAlpha = voucher ? isAlphanumeric(voucher.code) : false

  return (
    <div className="min-h-dvh bg-gradient-to-br from-green-50 via-emerald-50 to-teal-50 flex flex-col items-center justify-center p-4">
      <Toaster
        position="top-center"
        toastOptions={{ duration: 2000, style: { borderRadius: '16px', fontSize: '14px' } }}
      />

      <div className="text-center mb-6">
        <div className="inline-flex items-center justify-center w-14 h-14 bg-gradient-to-br from-green-400 to-emerald-600 rounded-2xl shadow-lg mb-3">
          <Wallet className="w-7 h-7 text-white" />
        </div>
        <h1 className="text-lg font-bold text-gray-700">שובר שותף אתך</h1>
      </div>

      <div className="w-full max-w-sm">
        {loading && (
          <div className="bg-white rounded-3xl shadow-xl p-8 text-center">
            <div className="w-10 h-10 border-4 border-green-200 border-t-green-500 rounded-full animate-spin mx-auto" />
            <p className="text-sm text-gray-500 mt-3">טוען שובר...</p>
          </div>
        )}

        {error && (
          <div className="bg-white rounded-3xl shadow-xl p-8 text-center">
            <AlertTriangle className="w-12 h-12 text-red-400 mx-auto mb-3" />
            <p className="text-gray-700 font-semibold">{error}</p>
            <p className="text-sm text-gray-400 mt-1">בדוק את הלינק שקיבלת ונסה שוב</p>
          </div>
        )}

        {voucher && !loading && (
          <div className={`bg-white rounded-3xl shadow-xl overflow-hidden border-2 ${
            expiryStatus === 'critical' ? 'border-red-200' :
            expiryStatus === 'warning'  ? 'border-orange-200' : 'border-gray-100'
          }`}>
            <div className="p-6 pb-4">
              {/* Header: store + balance */}
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h2 className="text-xl font-bold text-gray-800">{voucher.store_name}</h2>
                  {expiryLabel && (
                    <div className={`flex items-center gap-1 mt-1 ${
                      expiryStatus === 'expired'  ? 'text-gray-400' :
                      expiryStatus === 'critical' ? 'text-red-600' :
                      expiryStatus === 'warning'  ? 'text-orange-600' : 'text-gray-400'
                    }`}>
                      {(expiryStatus === 'critical' || expiryStatus === 'warning') && (
                        <AlertTriangle className="w-3.5 h-3.5" />
                      )}
                      <span className="text-xs font-medium">{expiryLabel}</span>
                    </div>
                  )}
                </div>
                <div className="text-left">
                  <div className="text-2xl font-bold text-gray-900">{formatCurrency(voucher.balance)}</div>
                  {voucher.amount !== voucher.balance && voucher.amount > 0 && (
                    <div className="text-xs text-gray-400">מתוך {formatCurrency(voucher.amount)}</div>
                  )}
                </div>
              </div>

              {/* Balance bar */}
              {voucher.amount > 0 && (
                <div className="h-2 bg-gray-100 rounded-full overflow-hidden mb-4">
                  <div className={`h-full rounded-full transition-all duration-300 ${barColor}`} style={{ width: `${Math.min(100, pct)}%` }} />
                </div>
              )}

              {/* Barcode / QR */}
              <div className="bg-gray-50 rounded-2xl p-4 text-center mb-3">
                <div className="flex items-center justify-center mb-3">
                  {isAlpha ? (
                    <canvas ref={qrRef} className="rounded-xl" />
                  ) : (
                    <svg ref={barcodeRef} className="max-w-full" />
                  )}
                </div>
                <p className="text-xs text-gray-400 mb-1">קוד שובר</p>
                <p className="text-xl font-mono font-bold text-gray-800 tracking-wider mb-3">{voucher.code}</p>
                <button
                  onClick={copyCode}
                  className={`flex items-center gap-2 mx-auto px-5 py-2.5 rounded-2xl text-sm font-semibold transition-all ${
                    copied ? 'bg-green-500 text-white' : 'bg-green-100 text-green-700 hover:bg-green-200'
                  }`}
                >
                  <Copy className="w-4 h-4" />
                  {copied ? 'הועתק!' : 'העתק קוד'}
                </button>
              </div>

              {voucher.expiry_date && (
                <p className="text-xs text-gray-400 text-center mt-3">
                  תוקף עד: {formatDate(voucher.expiry_date)}
                </p>
              )}
              {voucher.notes && (
                <p className="text-xs text-gray-500 bg-gray-50 rounded-xl p-3 mt-3">{voucher.notes}</p>
              )}
            </div>

            {/* Balance update section */}
            <div className="border-t border-gray-100">
              {!showUpdateForm ? (
                <button
                  onClick={() => setShowUpdateForm(true)}
                  className="w-full flex items-center justify-center gap-2 px-6 py-4 text-sm font-semibold text-green-700 hover:bg-green-50 transition-colors"
                >
                  <ChevronDown className="w-4 h-4" />
                  עדכן יתרה לאחר שימוש
                </button>
              ) : (
                <div className="p-4 space-y-3 bg-green-50">
                  <p className="text-sm font-semibold text-gray-700 text-center">כמה הוצאת? (₪)</p>
                  <div className="flex gap-2">
                    <input
                      ref={usedInputRef}
                      type="number"
                      inputMode="decimal"
                      min="0"
                      max={voucher.balance}
                      step="0.01"
                      value={usedAmount}
                      onChange={e => setUsedAmount(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && handleUpdateBalance()}
                      placeholder={`עד ${voucher.balance}`}
                      className="flex-1 text-center text-lg font-bold border border-gray-200 rounded-2xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-green-300 bg-white"
                      dir="ltr"
                    />
                    <button
                      onClick={handleUpdateBalance}
                      disabled={updating || !usedAmount}
                      className="px-5 py-2.5 bg-green-600 text-white rounded-2xl font-semibold text-sm disabled:opacity-50 flex items-center gap-1.5"
                    >
                      {updating
                        ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        : <Check className="w-4 h-4" />}
                      אשר
                    </button>
                  </div>
                  {usedAmount && !isNaN(parseFloat(usedAmount)) && parseFloat(usedAmount) > 0 && parseFloat(usedAmount) <= voucher.balance && (
                    <p className="text-xs text-center text-gray-500">
                      יתרה חדשה: <strong className="text-green-700">{formatCurrency(Math.max(0, voucher.balance - parseFloat(usedAmount)))}</strong>
                    </p>
                  )}
                  <button
                    onClick={() => { setShowUpdateForm(false); setUsedAmount('') }}
                    className="w-full text-xs text-gray-400 hover:text-gray-600 py-1"
                  >
                    ביטול
                  </button>
                </div>
              )}
            </div>

            <div className="bg-gray-50 px-6 py-3 text-center border-t border-gray-100">
              <p className="text-xs text-gray-400">שותף דרך GiftSmart</p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
