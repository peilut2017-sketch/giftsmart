import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { formatCurrency, formatDate, getExpiryStatus, getExpiryLabel } from '../utils/helpers'
import { Copy, AlertTriangle, Wallet } from 'lucide-react'
import toast from 'react-hot-toast'
import { Toaster } from 'react-hot-toast'

interface SharedVoucher {
  store_name: string
  balance: number
  amount: number
  code: string
  cvv?: string
  expiry_date?: string
  notes?: string
}

export default function SharedVoucherPage() {
  const { token } = useParams<{ token: string }>()
  const [voucher, setVoucher] = useState<SharedVoucher | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!token) { setError('לינק לא תקין'); setLoading(false); return }
    loadSharedVoucher()
  }, [token])

  async function loadSharedVoucher() {
    try {
      // Fetch token record
      const { data: tokenRecord, error: tokenError } = await supabase
        .from('shared_voucher_tokens')
        .select('voucher_id, expires_at, view_count')
        .eq('token', token)
        .single()

      if (tokenError || !tokenRecord) { setError('לינק לא נמצא או שפג תוקפו'); setLoading(false); return }

      // Check expiry
      if (tokenRecord.expires_at && new Date(tokenRecord.expires_at) < new Date()) {
        setError('פג תוקף הלינק')
        setLoading(false)
        return
      }

      // Fetch voucher
      const { data: v, error: vError } = await supabase
        .from('vouchers')
        .select('store_name, balance, amount, code, cvv, expiry_date, notes')
        .eq('id', tokenRecord.voucher_id)
        .single()

      if (vError || !v) { setError('השובר לא נמצא'); setLoading(false); return }

      setVoucher(v)

      // Increment view count (fire and forget)
      supabase
        .from('shared_voucher_tokens')
        .update({ view_count: (tokenRecord.view_count || 0) + 1 })
        .eq('token', token)
        .then(() => {})
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

  const expiryStatus = voucher ? getExpiryStatus(voucher.expiry_date) : 'none'
  const expiryLabel = voucher ? getExpiryLabel(voucher.expiry_date) : ''
  const pct = voucher && voucher.amount > 0 ? (voucher.balance / voucher.amount) * 100 : 0
  const barColor = pct > 60 ? 'bg-green-500' : pct > 25 ? 'bg-yellow-400' : 'bg-red-400'

  return (
    <div className="min-h-dvh bg-gradient-to-br from-green-50 via-emerald-50 to-teal-50 flex flex-col items-center justify-center p-4">
      <Toaster position="top-center" toastOptions={{ duration: 2000, style: { borderRadius: '16px', fontSize: '14px' } }} />

      {/* Header */}
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
            expiryStatus === 'warning' ? 'border-yellow-200' : 'border-gray-100'
          }`}>
            {/* Store name + balance */}
            <div className="p-6 pb-4">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h2 className="text-xl font-bold text-gray-800">{voucher.store_name}</h2>
                  {expiryLabel && (
                    <div className={`flex items-center gap-1 mt-1 ${
                      expiryStatus === 'expired' ? 'text-gray-400' :
                      expiryStatus === 'critical' ? 'text-red-600' :
                      expiryStatus === 'warning' ? 'text-yellow-600' :
                      'text-gray-400'
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

              {/* Progress bar */}
              {voucher.amount > 0 && (
                <div className="h-2 bg-gray-100 rounded-full overflow-hidden mb-4">
                  <div className={`h-full rounded-full ${barColor}`} style={{ width: `${Math.min(100, pct)}%` }} />
                </div>
              )}

              {/* Code */}
              <div className="bg-gray-50 rounded-2xl p-4 text-center">
                <p className="text-xs text-gray-400 mb-1">קוד שובר</p>
                <p className="text-2xl font-mono font-bold text-gray-800 tracking-wider mb-3">{voucher.code}</p>
                <button
                  onClick={copyCode}
                  className={`flex items-center gap-2 mx-auto px-5 py-2.5 rounded-2xl text-sm font-semibold transition-all ${
                    copied
                      ? 'bg-green-500 text-white'
                      : 'bg-green-100 text-green-700 hover:bg-green-200'
                  }`}
                >
                  <Copy className="w-4 h-4" />
                  {copied ? 'הועתק!' : 'העתק קוד'}
                </button>
              </div>

              {/* Expiry date */}
              {voucher.expiry_date && (
                <p className="text-xs text-gray-400 text-center mt-3">
                  תוקף עד: {formatDate(voucher.expiry_date)}
                </p>
              )}

              {/* Notes */}
              {voucher.notes && (
                <p className="text-xs text-gray-500 bg-gray-50 rounded-xl p-3 mt-3">{voucher.notes}</p>
              )}
            </div>

            <div className="bg-gray-50 px-6 py-3 text-center">
              <p className="text-xs text-gray-400">שותף דרך ארנק שוברים</p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
