import { useEffect, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useVouchers, type ActivityLogEntry } from '../contexts/VoucherContext'
import { isAlphanumeric, formatCurrency, formatDate, getExpiryLabel, getExpiryStatus } from '../utils/helpers'
import { sendUsageNotification } from '../hooks/useNotifications'
import JsBarcode from 'jsbarcode'
import QRCode from 'qrcode'
import { ArrowRight, Copy, ExternalLink, AlertTriangle, Star, Eye, EyeOff, Archive, Check, Share2, Link2, Trash2, X, Wallet, Clock, PlusCircle, Pencil, PackageCheck, Undo2, MinusCircle } from 'lucide-react'
import toast from 'react-hot-toast'
import ConfirmDialog from '../components/ConfirmDialog'
import { supabase } from '../lib/supabase'

const QUICK_AMOUNTS = [50, 100]

export default function CheckoutPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { vouchers, archivedVouchers, superVouchers, updateVoucher, archiveVoucher, isOnline, createShareToken, deleteShareToken, getShareTokens, getVoucherActivityLog } = useVouchers()

  const voucher = [...vouchers, ...archivedVouchers].find(v => v.id === id)
  const sv = superVouchers.find(s => s.id === voucher?.super_voucher_id)

  const barcodeRef = useRef<SVGSVGElement>(null)
  const qrRef = useRef<HTMLCanvasElement>(null)
  const [showCvv, setShowCvv] = useState(false)
  const [customAmount, setCustomAmount] = useState('')
  const [copied, setCopied] = useState(false)
  const [wakeLock, setWakeLock] = useState<any>(null)
  const [confirmArchive, setConfirmArchive] = useState(false)
  const [showShareModal, setShowShareModal] = useState(false)
  const [shareTokens, setShareTokens] = useState<Array<{ token: string; expires_at: string | null; view_count: number; created_at: string }>>([])
  const [shareLoading, setShareLoading] = useState(false)
  const [voucherLog, setVoucherLog] = useState<ActivityLogEntry[]>([])
  const [logLoading, setLogLoading] = useState(true)

  // Load voucher activity log
  useEffect(() => {
    if (!voucher?.id) return
    setLogLoading(true)
    getVoucherActivityLog(voucher.id)
      .then(setVoucherLog)
      .catch(() => {})
      .finally(() => setLogLoading(false))
  }, [voucher?.id])

  // WakeLock
  useEffect(() => {
    async function acquireWakeLock() {
      try {
        if ('wakeLock' in navigator) {
          const wl = await (navigator as any).wakeLock.request('screen')
          setWakeLock(wl)
        }
      } catch {}
    }
    acquireWakeLock()
    return () => {
      if (wakeLock) {
        try { wakeLock.release() } catch {}
      }
    }
  }, [])

  // Generate barcode or QR
  useEffect(() => {
    if (!voucher?.code) return
    const isAlpha = isAlphanumeric(voucher.code)

    if (!isAlpha && barcodeRef.current) {
      try {
        JsBarcode(barcodeRef.current, voucher.code, {
          format: 'CODE128',
          width: 2,
          height: 80,
          displayValue: true,
          fontSize: 14,
          margin: 10,
        })
      } catch {}
    }

    if (isAlpha && qrRef.current) {
      QRCode.toCanvas(qrRef.current, voucher.code, {
        width: 220,
        margin: 2,
        color: { dark: '#1e293b', light: '#ffffff' },
      }).catch(() => {})
    }
  }, [voucher?.code])

  async function copyCode() {
    if (!voucher?.code) return
    await navigator.clipboard.writeText(voucher.code).catch(() => {})
    setCopied(true)
    toast.success('קוד הועתק!')
    setTimeout(() => setCopied(false), 2000)
  }

  async function updateBalance(newBalance: number, usedAmount?: number) {
    if (!voucher) return
    if (!isOnline && voucher.is_shared) {
      toast.error('אין חיבור לאינטרנט — לא ניתן לעדכן שובר משותף')
      return
    }
    const clamped = Math.max(0, newBalance)
    await updateVoucher(voucher.id, { balance: clamped })
    if (clamped <= 0) {
      toast.success('יתרה אופסה!')
    } else {
      toast.success('יתרה עודכנה')
    }
    const used = usedAmount ?? (voucher.balance - clamped)
    if (used > 0) {
      sendUsageNotification(voucher.store_name, used, clamped)
    }
  }

  async function openShareModal() {
    if (!voucher) return
    setShareLoading(true)
    setShowShareModal(true)
    const tokens = await getShareTokens(voucher.id)
    setShareTokens(tokens)
    setShareLoading(false)
  }

  async function handleCreateShareLink(days?: number) {
    if (!voucher) return
    setShareLoading(true)
    try {
      const token = await createShareToken(voucher.id, days)
      const url = `${window.location.origin}/s/${token}`
      // Clipboard write is best-effort — failure must not hide the success
      try {
        await navigator.clipboard.writeText(url)
        toast.success('לינק שיתוף הועתק!')
      } catch {
        toast.success('לינק שיתוף נוצר! העתק אותו מרשימת הלינקים.')
      }
      const tokens = await getShareTokens(voucher.id)
      setShareTokens(tokens)
    } catch (err: any) {
      if (err?.message === 'TABLE_MISSING') {
        toast.error('טבלת shared_voucher_tokens חסרה — הרץ את ה-SQL מקובץ supabase-schema.sql', { duration: 6000 })
      } else {
        toast.error('שגיאה ביצירת לינק: ' + (err?.message || ''))
      }
    } finally {
      setShareLoading(false)
    }
  }

  async function handleDeleteShareToken(token: string) {
    await deleteShareToken(token)
    setShareTokens(prev => prev.filter(t => t.token !== token))
    toast.success('לינק נמחק')
  }

  async function saveToGoogleWallet() {
    if (!voucher) return
    const toastId = toast.loading('מכין כרטיס Google Wallet...')
    try {
      const { data, error } = await supabase.functions.invoke('google-wallet', {
        body: {
          storeName: voucher.store_name,
          balance: voucher.balance,
          code: voucher.code,
          expiryDate: voucher.expiry_date || null,
          notes: voucher.notes || null,
        },
      })
      toast.dismiss(toastId)
      if (error || data?.error) {
        const msg: string = data?.message || error?.message || ''
        if (msg.includes('WALLET_NOT_CONFIGURED') || msg.includes('not set')) {
          toast.error('Google Wallet לא מוגדר — ראה הוראות ב-supabase/functions/google-wallet/index.ts', { duration: 7000 })
        } else {
          toast.error('שגיאה: ' + (msg || 'לא ניתן ליצור כרטיס'))
        }
        return
      }
      window.open(data.url, '_blank')
    } catch (err: any) {
      toast.dismiss(toastId)
      toast.error('שגיאה בחיבור ל-Edge Function')
    }
  }

  async function saveToAppleWallet() {
    if (!voucher) return
    const toastId = toast.loading('מכין כרטיס Apple Wallet...')
    try {
      const { data: blob, error } = await supabase.functions.invoke('apple-wallet', {
        body: {
          storeName: voucher.store_name,
          balance: voucher.balance,
          code: voucher.code,
          expiryDate: voucher.expiry_date || null,
          notes: voucher.notes || null,
        },
      })
      toast.dismiss(toastId)
      if (error) {
        const msg: string = error?.message || ''
        if (msg.includes('WALLET_NOT_CONFIGURED') || msg.includes('not set')) {
          toast.error('Apple Wallet לא מוגדר — ראה הוראות ב-supabase/functions/apple-wallet/index.ts', { duration: 7000 })
        } else {
          toast.error('שגיאה: ' + (msg || 'לא ניתן ליצור כרטיס'))
        }
        return
      }
      // Download .pkpass file
      const url = URL.createObjectURL(new Blob([blob], { type: 'application/vnd.apple.pkpass' }))
      const a = document.createElement('a')
      a.href = url
      a.download = `${voucher.store_name}.pkpass`
      a.click()
      URL.revokeObjectURL(url)
      toast.success('קובץ Apple Wallet הורד!')
    } catch (err: any) {
      toast.dismiss(toastId)
      toast.error('שגיאה בחיבור ל-Edge Function')
    }
  }

  if (!voucher) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <p className="text-gray-500">שובר לא נמצא</p>
          <button onClick={() => navigate(-1)} className="mt-4 text-green-600 underline text-sm">חזור</button>
        </div>
      </div>
    )
  }

  const isAlpha = isAlphanumeric(voucher.code)
  const expiryStatus = getExpiryStatus(voucher.expiry_date)
  const expiryLabel = getExpiryLabel(voucher.expiry_date)
  const isArchived = archivedVouchers.some(v => v.id === id)

  return (
    <div className="flex-1 bg-gray-50">
      {confirmArchive && (
        <ConfirmDialog
          title="העברה לארכיון"
          message="להעביר את השובר לארכיון?"
          onConfirm={() => {
            setConfirmArchive(false)
            archiveVoucher(voucher.id).then(() => { toast.success('הועבר לארכיון'); navigate(-1) })
          }}
          onCancel={() => setConfirmArchive(false)}
        />
      )}
      {/* Header */}
      <div className="bg-white border-b sticky top-0 z-20">
        <div className="flex items-center gap-3 px-4 py-3">
          <button onClick={() => navigate(-1)} className="p-2 rounded-full hover:bg-gray-100">
            <ArrowRight className="w-5 h-5" />
          </button>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              {sv && <Star className="w-4 h-4 text-amber-400 fill-amber-400" />}
              <h1 className="font-bold text-gray-900">{sv?.name || voucher.store_name}</h1>
            </div>
            {sv && <p className="text-xs text-gray-500">{voucher.store_name}</p>}
          </div>
          {!isArchived && (
            <button
              onClick={() => setConfirmArchive(true)}
              className="p-2 rounded-full hover:bg-gray-100 text-gray-500"
            >
              <Archive className="w-5 h-5" />
            </button>
          )}
        </div>
      </div>

      <div className="p-4 space-y-4 pb-32">
        {/* Offline warning for shared */}
        {!isOnline && voucher.is_shared && (
          <div className="bg-orange-50 border border-orange-200 rounded-2xl p-3 flex items-center gap-2 text-sm text-orange-700">
            <AlertTriangle className="w-4 h-4 flex-shrink-0" />
            מצב אופליין — לא ניתן לעדכן שובר משותף
          </div>
        )}

        {/* Notes */}
        {voucher.notes && (
          <div className="bg-blue-50 border border-blue-100 rounded-2xl p-3 text-sm text-gray-700">
            {voucher.notes}
          </div>
        )}

        {/* Barcode / QR */}
        <div className="bg-white rounded-3xl shadow-sm p-6 text-center overflow-hidden">
          <div className="w-full overflow-hidden flex items-center justify-center mb-4">
            {isAlpha ? (
              <canvas ref={qrRef} className="rounded-xl" />
            ) : (
              <svg ref={barcodeRef} style={{ width: '100%', height: 'auto' }} />
            )}
          </div>

          <div className="font-mono text-lg font-bold tracking-widest text-gray-800 mb-3 break-all">
            {voucher.code}
          </div>

          <div className="flex items-center justify-center flex-wrap gap-2">
            <button
              onClick={copyCode}
              className={`flex items-center gap-2 px-5 py-2.5 rounded-2xl text-sm font-medium transition-all ${
                copied ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
              {copied ? 'הועתק!' : 'העתק קוד'}
            </button>

            {voucher.code && (
              <a
                href={`https://otp.co.il/${encodeURIComponent(voucher.code)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 px-5 py-2.5 rounded-2xl text-sm font-medium bg-blue-50 text-blue-600 hover:bg-blue-100"
              >
                <ExternalLink className="w-4 h-4" />
                OTP
              </a>
            )}

            {!isArchived && (
              <button
                onClick={openShareModal}
                className="flex items-center gap-2 px-5 py-2.5 rounded-2xl text-sm font-medium bg-purple-50 text-purple-600 hover:bg-purple-100"
              >
                <Share2 className="w-4 h-4" />
                שתף
              </button>
            )}

            <button
              onClick={saveToGoogleWallet}
              className="flex items-center gap-2 px-5 py-2.5 rounded-2xl text-sm font-medium bg-blue-50 text-blue-600 hover:bg-blue-100"
            >
              <Wallet className="w-4 h-4" />
              Google Wallet
            </button>

            <button
              onClick={saveToAppleWallet}
              className="flex items-center gap-2 px-5 py-2.5 rounded-2xl text-sm font-medium bg-gray-900 text-white hover:bg-gray-800"
            >
              <Wallet className="w-4 h-4" />
              Apple Wallet
            </button>
          </div>
        </div>

        {/* CVV */}
        {voucher.cvv && (
          <div className="bg-yellow-50 border border-yellow-200 rounded-2xl p-4 flex items-center justify-between">
            <span className="text-sm font-medium text-yellow-800">CVV / קוד אבטחה</span>
            <div className="flex items-center gap-2">
              <span className="font-mono font-bold text-yellow-900 text-lg">
                {showCvv ? voucher.cvv : '•'.repeat(voucher.cvv.length)}
              </span>
              <button onClick={() => setShowCvv(!showCvv)} className="text-yellow-600">
                {showCvv ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>
        )}

        {/* Balance Card */}
        <div className="bg-white rounded-3xl shadow-sm p-5">
          <div className="flex items-center justify-between mb-4">
            <span className="text-sm text-gray-500">יתרה נוכחית</span>
            <span className="text-3xl font-bold text-gray-900">{formatCurrency(voucher.balance)}</span>
          </div>

          {voucher.amount > 0 && (
            <div className="mb-4">
              <div className="flex justify-between text-xs text-gray-400 mb-1">
                <span>₪0</span>
                <span>{formatCurrency(voucher.amount)}</span>
              </div>
              <div className="h-3 bg-gray-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-green-400 to-emerald-500 rounded-full transition-all"
                  style={{ width: `${Math.min(100, (voucher.balance / voucher.amount) * 100)}%` }}
                />
              </div>
            </div>
          )}

          {/* Expiry */}
          {expiryLabel && (
            <div className={`flex items-center gap-1.5 text-sm mb-4 ${
              expiryStatus === 'expired' ? 'text-gray-400' :
              expiryStatus === 'critical' ? 'text-red-600' :
              expiryStatus === 'warning' ? 'text-yellow-600' :
              'text-gray-500'
            }`}>
              {(expiryStatus === 'critical' || expiryStatus === 'warning') &&
                <AlertTriangle className="w-4 h-4" />
              }
              <span>{expiryLabel}</span>
              {voucher.expiry_date && <span className="text-xs text-gray-400">({formatDate(voucher.expiry_date)})</span>}
            </div>
          )}

          {/* Quick amounts */}
          {!isArchived && (
            <>
              <div className="text-xs font-medium text-gray-500 mb-2">עדכן יתרה — ניכוי מהירה</div>
              <div className="grid grid-cols-4 gap-2 mb-3">
                {QUICK_AMOUNTS.map(amt => (
                  <button
                    key={amt}
                    onClick={() => updateBalance(voucher.balance - amt)}
                    disabled={voucher.balance < amt}
                    className="py-2 bg-gray-100 text-gray-700 rounded-xl text-sm font-medium hover:bg-gray-200 disabled:opacity-40 transition-all"
                  >
                    -{amt}
                  </button>
                ))}
                <button
                  onClick={() => updateBalance(voucher.balance / 2)}
                  className="py-2 bg-gray-100 text-gray-700 rounded-xl text-sm font-medium hover:bg-gray-200 transition-all"
                >
                  מחצית
                </button>
                <button
                  onClick={() => updateBalance(0)}
                  className="py-2 bg-red-50 text-red-600 rounded-xl text-sm font-medium hover:bg-red-100 transition-all"
                >
                  מלא
                </button>
              </div>

              <div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    inputMode="decimal"
                    value={customAmount}
                    onChange={e => setCustomAmount(e.target.value)}
                    placeholder="סכום שימוש..."
                    className="flex-1 px-3 py-2.5 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-green-300"
                    style={{ fontSize: '16px' }}
                    dir="ltr"
                  />
                  <button
                    onClick={() => {
                      const used = parseFloat(customAmount)
                      if (!isNaN(used) && used > 0) {
                        updateBalance(voucher.balance - used, used)
                        setCustomAmount('')
                      }
                    }}
                    disabled={!customAmount || isNaN(parseFloat(customAmount)) || parseFloat(customAmount) <= 0}
                    className="px-5 py-2.5 bg-green-500 text-white rounded-xl text-sm font-medium disabled:opacity-40 hover:bg-green-600 transition-all"
                  >
                    עדכן
                  </button>
                </div>
                {(() => {
                  const used = parseFloat(customAmount) || 0
                  if (used <= 0) return null
                  const newBal = Math.max(0, voucher.balance - used)
                  return (
                    <p className={`text-xs mt-1.5 font-medium ${newBal <= 0 ? 'text-red-500' : 'text-green-600'}`}>
                      יתרה חדשה: ₪{newBal.toLocaleString('he-IL')}
                    </p>
                  )
                })()}
              </div>

              {/* Auto archive at 0 */}
              {voucher.balance <= 0 && !isArchived && (
                <button
                  onClick={() => setConfirmArchive(true)}
                  className="mt-3 w-full flex items-center justify-center gap-2 py-3 bg-gray-100 text-gray-600 rounded-2xl text-sm font-medium hover:bg-gray-200 transition-all"
                >
                  <Archive className="w-4 h-4" />
                  יתרה אופסה — העבר לארכיון
                </button>
              )}
            </>
          )}
        </div>

        {/* Super voucher stores */}
        {sv && sv.stores.length > 0 && (
          <div className="bg-white rounded-3xl shadow-sm p-4">
            <h3 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-1.5">
              <Star className="w-4 h-4 text-amber-400 fill-amber-400" />
              חנויות המכבדות את {sv.name}
            </h3>
            <div className="flex flex-wrap gap-2">
              {sv.stores.map((s, i) => (
                <span key={i} className="text-xs bg-amber-50 text-amber-700 px-3 py-1 rounded-full border border-amber-200">
                  {s}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Tags */}
        {voucher.tags?.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {voucher.tags.map((tag, i) => (
              <span key={i} className="text-xs bg-gray-100 text-gray-600 px-3 py-1 rounded-full">#{tag}</span>
            ))}
          </div>
        )}

        {/* Activity Timeline */}
        <div className="bg-white rounded-3xl shadow-sm p-4">
          <h3 className="text-sm font-semibold text-gray-700 mb-4 flex items-center gap-1.5">
            <Clock className="w-4 h-4 text-gray-400" />
            היסטוריית פעילות
          </h3>
          {logLoading ? (
            <div className="flex justify-center py-4">
              <div className="w-5 h-5 border-2 border-gray-200 border-t-gray-400 rounded-full animate-spin" />
            </div>
          ) : voucherLog.length === 0 ? (
            <p className="text-xs text-gray-400 text-center py-2">אין פעילות רשומה</p>
          ) : (
            <div className="relative">
              {/* Vertical line */}
              <div className="absolute right-[11px] top-3 bottom-3 w-px bg-gray-100" />
              <div className="space-y-4">
                {voucherLog.map((entry) => {
                  const dt = new Date(entry.created_at)
                  const dateStr = dt.toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: '2-digit' })
                  const timeStr = dt.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })

                  let icon: React.ReactNode
                  let dotColor: string
                  let label: string
                  let detail: string | null = null

                  switch (entry.action) {
                    case 'add':
                      icon = <PlusCircle className="w-3.5 h-3.5" />
                      dotColor = 'bg-green-500 text-white'
                      label = 'נוסף לארנק'
                      if (entry.details?.amount != null)
                        detail = `סכום: ₪${Number(entry.details.amount).toLocaleString('he-IL')}`
                      break
                    case 'balance_update':
                      icon = <MinusCircle className="w-3.5 h-3.5" />
                      dotColor = 'bg-blue-500 text-white'
                      label = 'עדכון יתרה'
                      if (entry.details?.from != null && entry.details?.to != null)
                        detail = `₪${Number(entry.details.from).toLocaleString('he-IL')} ← ₪${Number(entry.details.to).toLocaleString('he-IL')}`
                      break
                    case 'edit':
                      icon = <Pencil className="w-3.5 h-3.5" />
                      dotColor = 'bg-indigo-500 text-white'
                      label = 'פרטים עודכנו'
                      break
                    case 'archive':
                      icon = <PackageCheck className="w-3.5 h-3.5" />
                      dotColor = 'bg-orange-400 text-white'
                      label = 'הועבר לארכיון'
                      if (entry.details?.balance != null)
                        detail = `יתרה: ₪${Number(entry.details.balance).toLocaleString('he-IL')}`
                      break
                    case 'unarchive':
                      icon = <Undo2 className="w-3.5 h-3.5" />
                      dotColor = 'bg-teal-500 text-white'
                      label = 'הוחזר לארנק'
                      break
                    default:
                      icon = <Clock className="w-3.5 h-3.5" />
                      dotColor = 'bg-gray-400 text-white'
                      label = entry.action
                  }

                  return (
                    <div key={entry.id} className="flex items-start gap-3 relative">
                      {/* Dot */}
                      <div className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 z-10 ${dotColor}`}>
                        {icon}
                      </div>
                      {/* Content */}
                      <div className="flex-1 min-w-0 pt-0.5">
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="text-sm font-medium text-gray-800">{label}</span>
                          <span className="text-xs text-gray-400 flex-shrink-0">{dateStr} {timeStr}</span>
                        </div>
                        {detail && (
                          <p className="text-xs text-gray-500 mt-0.5">{detail}</p>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Share Modal */}
      {showShareModal && (
        <div className="fixed inset-0 bg-black/50 z-[60] flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={() => setShowShareModal(false)}>
          <div className="bg-white w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl p-5 animate-slide-up" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-bold text-gray-800">שיתוף שובר</h3>
              <button onClick={() => setShowShareModal(false)} className="p-2 rounded-full hover:bg-gray-100">
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-sm text-gray-500 mb-4">
              צור לינק ייחודי לשיתוף השובר. מי שיקבל את הלינק יוכל לראות את הקוד.
            </p>

            {/* Create link buttons */}
            <div className="grid grid-cols-3 gap-2 mb-4">
              {[
                { label: 'יום אחד', days: 1 },
                { label: 'שבוע', days: 7 },
                { label: 'ללא הגבלה', days: undefined },
              ].map(opt => (
                <button
                  key={opt.label}
                  onClick={() => handleCreateShareLink(opt.days)}
                  disabled={shareLoading}
                  className="flex flex-col items-center gap-1 py-3 rounded-2xl bg-purple-50 text-purple-700 text-xs font-medium hover:bg-purple-100 disabled:opacity-50 transition-all"
                >
                  <Link2 className="w-4 h-4" />
                  {opt.label}
                </button>
              ))}
            </div>

            {/* Existing tokens */}
            {shareTokens.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-medium text-gray-500">לינקים פעילים:</p>
                {shareTokens.map(t => {
                  const url = `${window.location.origin}/s/${t.token}`
                  const expired = t.expires_at && new Date(t.expires_at) < new Date()
                  return (
                    <div key={t.token} className={`flex items-center gap-2 p-3 rounded-2xl border ${expired ? 'bg-gray-50 border-gray-100 opacity-60' : 'bg-white border-gray-200'}`}>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-mono text-gray-600 truncate">{url}</p>
                        <p className="text-xs text-gray-400 mt-0.5">
                          {expired ? '⛔ פג תוקף' : t.expires_at ? `עד ${new Date(t.expires_at).toLocaleDateString('he-IL')}` : 'ללא הגבלת זמן'}
                          {' · '}{t.view_count} צפיות
                        </p>
                      </div>
                      <button
                        onClick={async () => { await navigator.clipboard.writeText(url); toast.success('הועתק!') }}
                        className="p-2 text-purple-500 hover:bg-purple-50 rounded-lg"
                      >
                        <Copy className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleDeleteShareToken(t.token)}
                        className="p-2 text-red-400 hover:bg-red-50 rounded-lg"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  )
                })}
              </div>
            )}

            {shareLoading && (
              <div className="text-center py-4">
                <div className="w-6 h-6 border-2 border-purple-200 border-t-purple-500 rounded-full animate-spin mx-auto" />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
