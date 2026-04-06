import { useEffect, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { formatCurrency, formatDate, getExpiryStatus, getExpiryLabel, isAlphanumeric } from '../utils/helpers'
import { Copy, AlertTriangle, Gift, ChevronDown, Check, LogIn } from 'lucide-react'
import toast from 'react-hot-toast'
import { Toaster } from 'react-hot-toast'
import JsBarcode from 'jsbarcode'
import QRCode from 'qrcode'

interface GiftData {
  gift_id: string
  sender_name: string | null
  message: string | null
  send_at: string
  claimed_at: string | null
  store_name: string
  balance: number
  amount: number
  code: string
  expiry_date?: string | null
  notes?: string | null
}

export default function GiftPage() {
  const { token } = useParams<{ token: string }>()
  const navigate = useNavigate()
  const { user } = useAuth()

  const [gift, setGift] = useState<GiftData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [claiming, setClaiming] = useState(false)

  // Balance update state
  const [showUpdateForm, setShowUpdateForm] = useState(false)
  const [usedAmount, setUsedAmount] = useState('')
  const [storeUsed, setStoreUsed] = useState('')
  const [updating, setUpdating] = useState(false)

  const barcodeRef = useRef<SVGSVGElement>(null)
  const qrRef = useRef<HTMLCanvasElement>(null)
  const usedInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!token) { setError('לינק לא תקין'); setLoading(false); return }
    loadGift()
  }, [token])

  useEffect(() => {
    if (!gift?.code) return
    const isAlpha = isAlphanumeric(gift.code)
    if (!isAlpha && barcodeRef.current) {
      try {
        JsBarcode(barcodeRef.current, gift.code, {
          format: 'CODE128', width: 2, height: 72, displayValue: false, margin: 8,
        })
      } catch {}
    }
    if (isAlpha && qrRef.current) {
      QRCode.toCanvas(qrRef.current, gift.code, {
        width: 200, margin: 2, color: { dark: '#1e293b', light: '#ffffff' },
      }).catch(() => {})
    }
  }, [gift?.code])

  useEffect(() => {
    if (showUpdateForm) setTimeout(() => usedInputRef.current?.focus(), 80)
  }, [showUpdateForm])

  async function loadGift() {
    try {
      const { data, error: rpcError } = await supabase
        .rpc('get_gift_by_token', { p_token: token })

      if (rpcError) {
        console.error('get_gift_by_token RPC error:', rpcError)
        // Distinguish between "function missing" and "not found"
        const isMissing = rpcError.code === '42883' || rpcError.message?.includes('does not exist')
        setError(isMissing ? 'שגיאת הגדרה — צור קשר עם התמיכה' : 'לינק מתנה לא נמצא')
        setLoading(false)
        return
      }
      if (!data || data.length === 0) {
        setError('לינק מתנה לא נמצא')
        setLoading(false)
        return
      }
      setGift(data[0] as GiftData)
    } catch (err) {
      console.error('loadGift exception:', err)
      setError('שגיאה בטעינת המתנה')
    } finally {
      setLoading(false)
    }
  }

  function copyCode() {
    if (!gift?.code) return
    navigator.clipboard.writeText(gift.code).then(() => {
      setCopied(true)
      toast.success('הקוד הועתק!')
      setTimeout(() => setCopied(false), 2000)
    })
  }

  async function handleClaim() {
    if (!user) {
      // Save return URL and redirect to auth
      sessionStorage.setItem('gift_return', window.location.pathname)
      navigate('/auth')
      return
    }
    setClaiming(true)
    const { data, error } = await supabase.rpc('claim_gift', { p_token: token })
    setClaiming(false)

    if (error || !data?.success) {
      const msg = data?.error as string | undefined
      if (msg === 'already_claimed') toast.error('מתנה זו כבר נתבעה')
      else if (msg === 'own_gift') toast.error('לא ניתן לתבוע מתנה שאתה שלחת')
      else if (msg === 'no_wallet') toast.error('לא נמצא ארנק — צור ארנק בהגדרות ונסה שוב')
      else toast.error('שגיאה בתביעת המתנה')
      return
    }

    // Refresh gift to show claimed state
    setGift(g => g ? { ...g, claimed_at: new Date().toISOString() } : g)
    toast.success('🎉 השובר נוסף לארנק שלך!')
  }

  async function handleUpdateBalance() {
    if (!gift || !token) return
    const used = parseFloat(usedAmount)
    if (isNaN(used) || used < 0) return toast.error('סכום לא תקין')
    if (used > gift.balance) return toast.error(`לא ניתן לנצל יותר מהיתרה (₪${gift.balance})`)

    const newBalance = Math.max(0, gift.balance - used)
    const oldBalance = gift.balance
    const trimmedStore = storeUsed.trim() || null
    setUpdating(true)

    const { data, error } = await supabase.rpc('update_gift_voucher_balance', {
      p_token: token,
      p_new_balance: newBalance,
      ...(trimmedStore ? { p_store_used: trimmedStore } : {}),
    })
    setUpdating(false)

    if (error || !data?.success) {
      toast.error('שגיאה בעדכון יתרה')
      return
    }

    setGift(g => g ? { ...g, balance: newBalance } : g)
    setUsedAmount('')
    setStoreUsed('')
    setShowUpdateForm(false)

    toast(
      (t) => (
        <span className="flex items-center gap-2">
          <span>יתרה עודכנה: {formatCurrency(oldBalance)} ← {formatCurrency(newBalance)}</span>
          <button
            onClick={async () => {
              toast.dismiss(t.id)
              const { data: undoData } = await supabase.rpc('update_gift_voucher_balance', {
                p_token: token, p_new_balance: oldBalance,
              })
              if (undoData?.success) {
                setGift(g => g ? { ...g, balance: oldBalance } : g)
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

  const expiryStatus = gift ? getExpiryStatus(gift.expiry_date ?? undefined) : 'none'
  const expiryLabel  = gift ? getExpiryLabel(gift.expiry_date ?? undefined) : ''
  const pct      = gift && gift.amount > 0 ? (gift.balance / gift.amount) * 100 : 0
  const barColor = pct > 60 ? 'bg-green-500' : pct > 25 ? 'bg-yellow-400' : 'bg-red-400'
  const isAlpha  = gift ? isAlphanumeric(gift.code) : false
  const isClaimed = !!gift?.claimed_at

  return (
    <div className="min-h-dvh bg-gradient-to-br from-green-50 via-emerald-50 to-teal-50 flex flex-col items-center justify-center p-4">
      <Toaster
        position="top-center"
        toastOptions={{ duration: 2000, style: { borderRadius: '16px', fontSize: '14px' } }}
      />

      <div className="text-center mb-6">
        <div className="inline-flex items-center justify-center w-14 h-14 bg-gradient-to-br from-green-400 to-emerald-600 rounded-2xl shadow-lg mb-3">
          <Gift className="w-7 h-7 text-white" />
        </div>
        <h1 className="text-lg font-bold text-gray-700">קיבלת מתנה!</h1>
        {gift?.sender_name && (
          <p className="text-sm text-gray-500 mt-1">מאת {gift.sender_name}</p>
        )}
      </div>

      <div className="w-full max-w-sm">
        {loading && (
          <div className="bg-white rounded-3xl shadow-xl p-8 text-center">
            <div className="w-10 h-10 border-4 border-green-200 border-t-green-500 rounded-full animate-spin mx-auto" />
            <p className="text-sm text-gray-500 mt-3">טוען מתנה...</p>
          </div>
        )}

        {error && (
          <div className="bg-white rounded-3xl shadow-xl p-8 text-center">
            <AlertTriangle className="w-12 h-12 text-red-400 mx-auto mb-3" />
            <p className="text-gray-700 font-semibold">{error}</p>
            <p className="text-sm text-gray-400 mt-1">בדוק את הלינק שקיבלת ונסה שוב</p>
          </div>
        )}

        {gift && !loading && (
          <div className={`bg-white rounded-3xl shadow-xl overflow-hidden border-2 ${
            expiryStatus === 'critical' ? 'border-red-200' :
            expiryStatus === 'warning'  ? 'border-orange-200' : 'border-gray-100'
          }`}>
            <div className="p-6 pb-4">
              {/* Personal message */}
              {gift.message && (
                <div className="bg-green-50 border border-green-100 rounded-2xl px-4 py-3 mb-4 text-center">
                  <p className="text-sm text-green-800 italic">"{gift.message}"</p>
                  {gift.sender_name && (
                    <p className="text-xs text-green-600 mt-1">— {gift.sender_name}</p>
                  )}
                </div>
              )}

              {/* Header: store + balance */}
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h2 className="text-xl font-bold text-gray-800">{gift.store_name}</h2>
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
                  <div className="text-2xl font-bold text-gray-900">{formatCurrency(gift.balance)}</div>
                  {gift.amount !== gift.balance && gift.amount > 0 && (
                    <div className="text-xs text-gray-400">מתוך {formatCurrency(gift.amount)}</div>
                  )}
                </div>
              </div>

              {/* Balance bar */}
              {gift.amount > 0 && (
                <div className="h-2 bg-gray-100 rounded-full overflow-hidden mb-4">
                  <div className={`h-full rounded-full transition-all duration-300 ${barColor}`}
                    style={{ width: `${Math.min(100, pct)}%` }} />
                </div>
              )}

              {/* Barcode / QR */}
              <div className="bg-gray-50 rounded-2xl p-4 text-center mb-3">
                <div className="flex items-center justify-center mb-3">
                  {isAlpha
                    ? <canvas ref={qrRef} className="rounded-xl" />
                    : <svg ref={barcodeRef} className="max-w-full" />
                  }
                </div>
                <p className="text-xs text-gray-400 mb-1">קוד שובר</p>
                <p className="text-xl font-mono font-bold text-gray-800 tracking-wider mb-3">{gift.code}</p>
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

              {gift.expiry_date && (
                <p className="text-xs text-gray-400 text-center mt-3">
                  תוקף עד: {formatDate(gift.expiry_date)}
                </p>
              )}
              {gift.notes && (
                <p className="text-xs text-gray-500 bg-gray-50 rounded-xl p-3 mt-3">{gift.notes}</p>
              )}
            </div>

            {/* Balance update */}
            {!isClaimed && (
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
                    <p className="text-sm font-semibold text-gray-700 text-center">עדכון יתרה</p>
                    <div className="flex gap-2">
                      <input
                        ref={usedInputRef}
                        type="number"
                        inputMode="decimal"
                        value={usedAmount}
                        onChange={e => setUsedAmount(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && handleUpdateBalance()}
                        placeholder="סכום שימוש"
                        className="flex-1 text-center text-lg font-bold border border-gray-200 rounded-2xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-green-300 bg-white"
                        dir="ltr"
                      />
                      <button
                        onClick={handleUpdateBalance}
                        disabled={updating || !usedAmount || isNaN(parseFloat(usedAmount)) || parseFloat(usedAmount) <= 0}
                        className="px-5 py-2.5 bg-green-600 text-white rounded-2xl font-semibold text-sm disabled:opacity-50 flex items-center gap-1.5"
                      >
                        {updating
                          ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                          : <Check className="w-4 h-4" />
                        }
                        אשר
                      </button>
                    </div>
                    {parseFloat(usedAmount) > 0 && parseFloat(usedAmount) <= gift.balance && (
                      <input
                        type="text"
                        value={storeUsed}
                        onChange={e => setStoreUsed(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && handleUpdateBalance()}
                        placeholder="באיזה חנות? (אופציונלי)"
                        className="w-full text-sm border border-gray-200 rounded-2xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-green-300 bg-white"
                        dir="rtl"
                      />
                    )}
                    {(() => {
                      const amount = parseFloat(usedAmount)
                      if (isNaN(amount) || amount <= 0 || amount > gift.balance) return null
                      return (
                        <p className="text-xs text-center text-gray-500">
                          יתרה חדשה: <strong className="text-green-700">{formatCurrency(Math.max(0, gift.balance - amount))}</strong>
                        </p>
                      )
                    })()}
                    <button
                      onClick={() => { setShowUpdateForm(false); setUsedAmount(''); setStoreUsed('') }}
                      className="w-full text-xs text-gray-400 hover:text-gray-600 py-1"
                    >
                      ביטול
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Claim / claimed */}
            <div className="border-t border-gray-100 p-4">
              {isClaimed ? (
                <div className="flex items-center justify-center gap-2 text-green-600 text-sm font-semibold py-1">
                  <Check className="w-4 h-4" />
                  השובר נוסף לארנק שלך
                </div>
              ) : (
                <button
                  onClick={handleClaim}
                  disabled={claiming}
                  className="w-full flex items-center justify-center gap-2 py-3 bg-gradient-to-r from-green-500 to-emerald-600 text-white rounded-2xl font-bold text-sm shadow hover:shadow-md active:scale-95 transition-all disabled:opacity-50"
                >
                  {claiming ? (
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  ) : user ? (
                    <>
                      <Gift className="w-4 h-4" />
                      הוסף לארנק GiftSmart שלי
                    </>
                  ) : (
                    <>
                      <LogIn className="w-4 h-4" />
                      התחבר/י כדי לקבל את המתנה
                    </>
                  )}
                </button>
              )}
            </div>

            <div className="bg-gray-50 px-6 py-3 text-center border-t border-gray-100">
              <p className="text-xs text-gray-400">נשלח דרך GiftSmart</p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
