import { useEffect, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useVouchers } from '../contexts/VoucherContext'
import { useE2EE } from '../contexts/E2EEContext'
import { formatCurrency, formatDate, getExpiryStatus, isAlphanumeric } from '../utils/helpers'
import { useT } from '../lib/i18n'
import { ArrowRight, Share2, Pencil, Check, ExternalLink, Lock } from 'lucide-react'
import JsBarcode from 'jsbarcode'
import QRCode from 'qrcode'
import toast from 'react-hot-toast'
import type { Voucher } from '../types'
import VoucherForm from '../components/VoucherForm'

export default function VoucherPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { t } = useT()
  const { vouchers, archivedVouchers, updateVoucher } = useVouchers()
  const { decryptedMap, isVaultUnlocked } = useE2EE()
  const [copied, setCopied] = useState(false)
  const [showEdit, setShowEdit] = useState(false)

  const barcodeRef = useRef<SVGSVGElement>(null)
  const qrRef = useRef<HTMLCanvasElement>(null)

  const allVouchers = [...vouchers, ...archivedVouchers]
  const voucher = allVouchers.find(v => v.id === id)

  // Resolve potentially-encrypted code
  const decrypted = voucher?.is_e2ee ? decryptedMap.get(voucher.id) : null
  const displayCode = voucher?.is_e2ee
    ? (decrypted?.code ?? null)
    : (voucher?.code ?? null)
  const displayCvv = voucher?.is_e2ee
    ? (decrypted?.cvv ?? null)
    : (voucher?.cvv ?? null)

  // Render barcode or QR once code is known
  useEffect(() => {
    if (!displayCode) return
    const isAlpha = isAlphanumeric(displayCode)
    if (!isAlpha && barcodeRef.current) {
      try {
        JsBarcode(barcodeRef.current, displayCode, {
          format: 'CODE128',
          width: 2,
          height: 72,
          displayValue: false,
          margin: 8,
        })
      } catch {}
    }
    if (isAlpha && qrRef.current) {
      QRCode.toCanvas(qrRef.current, displayCode, {
        width: 200,
        margin: 2,
        color: { dark: '#1e293b', light: '#ffffff' },
      }).catch(() => {})
    }
  }, [displayCode])

  async function copyCode() {
    if (!displayCode) return
    try {
      await navigator.clipboard.writeText(displayCode)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
      toast.success(t('copied'))
    } catch {
      toast.error('שגיאה בהעתקה')
    }
  }

  async function handleShare() {
    const text = displayCode
      ? `${voucher!.store_name}: ${displayCode}`
      : voucher!.store_name
    if (navigator.share) {
      try {
        await navigator.share({ title: voucher!.store_name, text })
      } catch {}
    } else {
      await copyCode()
    }
  }

  async function handleSave(vData: any) {
    if (!voucher) return
    const usedAmount = voucher.balance - vData.balance
    const { _storeUsed, ...voucherData } = vData
    await updateVoucher(voucher.id, voucherData as Partial<Voucher>, _storeUsed ?? null)
    toast.success(t('voucher.updated'))
    if (usedAmount > 0 && vData.balance <= 0 && !vData.item_name) {
      toast(t('voucher.redeemed.title'), { icon: '✅' })
    }
  }

  const expiryStatus = getExpiryStatus(voucher?.expiry_date)
  const expiryColor = {
    expired: 'text-red-600',
    critical: 'text-red-500',
    warning: 'text-amber-500',
    ok: 'text-green-600',
    none: 'text-gray-400',
  }[expiryStatus]

  if (!voucher) {
    return (
      <div className="min-h-dvh flex flex-col items-center justify-center gap-4 p-6" dir="rtl">
        <p className="text-gray-500 text-sm">שובר לא נמצא</p>
        <button onClick={() => navigate('/')} className="text-green-600 text-sm font-medium">חזור לרשימה</button>
      </div>
    )
  }

  const isEncryptedLocked = voucher.is_e2ee && !isVaultUnlocked

  return (
    <div className="min-h-dvh bg-gray-50 dark:bg-gray-950" dir="rtl">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-white dark:bg-gray-900 border-b border-gray-100 dark:border-gray-800 px-4 py-3 flex items-center gap-3">
        <button onClick={() => navigate(-1)} className="p-2 -mr-2 text-gray-500 hover:text-gray-800">
          <ArrowRight className="w-5 h-5" />
        </button>
        <h1 className="font-bold text-gray-900 dark:text-white text-base flex-1 truncate">{voucher.store_name}</h1>
        {voucher.is_archived && (
          <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">ארכיון</span>
        )}
        <div className="flex items-center gap-1">
          <button
            onClick={handleShare}
            className="p-2 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
            aria-label="שתף שובר"
          >
            <Share2 className="w-4.5 h-4.5" />
          </button>
          <button
            onClick={() => setShowEdit(true)}
            className="p-2 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
            aria-label="ערוך שובר"
          >
            <Pencil className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="max-w-lg mx-auto p-4 space-y-4">
        {/* Balance card */}
        <div className="bg-white dark:bg-gray-900 rounded-3xl p-5 shadow-sm">
          <p className="text-xs text-gray-400 mb-1">יתרה נוכחית</p>
          <p className="text-3xl font-bold text-gray-900 dark:text-white">{formatCurrency(voucher.balance)}</p>
          {voucher.amount !== voucher.balance && (
            <p className="text-xs text-gray-400 mt-0.5">מתוך {formatCurrency(voucher.amount)}</p>
          )}
          {voucher.expiry_date && (
            <p className={`text-xs mt-2 font-medium ${expiryColor}`}>
              {expiryStatus === 'expired' ? 'פג תוקף' : `תוקף: ${formatDate(voucher.expiry_date)}`}
            </p>
          )}
        </div>

        {/* Code / barcode — tap the code to copy */}
        <div className="bg-white dark:bg-gray-900 rounded-3xl p-5 shadow-sm">
          {isEncryptedLocked ? (
            <div className="flex flex-col items-center gap-2 py-4 text-indigo-400">
              <Lock className="w-8 h-8" />
              <p className="text-sm">הכספת נעולה — פתח אותה כדי לראות את הקוד</p>
            </div>
          ) : displayCode ? (
            <>
              {isAlphanumeric(displayCode) ? (
                <div className="flex justify-center mb-4">
                  <canvas ref={qrRef} className="rounded-xl" />
                </div>
              ) : (
                <div className="flex justify-center mb-4 overflow-hidden rounded-xl bg-white">
                  <svg ref={barcodeRef} className="max-w-full" />
                </div>
              )}
              {/* Tap the code to copy */}
              <button
                onClick={copyCode}
                className="w-full flex items-center justify-center gap-2 bg-gray-50 dark:bg-gray-800 rounded-2xl px-4 py-3 active:scale-[0.97] transition-transform"
                aria-label="לחץ להעתקת הקוד"
              >
                {copied
                  ? <Check className="w-4 h-4 text-green-500 shrink-0" />
                  : null
                }
                <span className="font-mono text-base font-semibold tracking-widest text-gray-800 dark:text-white select-all">
                  {displayCode}
                </span>
              </button>
              <p className="text-[10px] text-center text-gray-400 mt-1.5">
                {copied ? '✓ הועתק' : 'לחץ להעתקה'}
              </p>
              {displayCvv && (
                <p className="text-xs text-center text-gray-400 mt-2">CVV: <span className="font-mono font-semibold text-gray-600 dark:text-gray-300">{displayCvv}</span></p>
              )}
            </>
          ) : null}
        </div>

        {/* Details */}
        <div className="bg-white dark:bg-gray-900 rounded-3xl p-5 shadow-sm space-y-3">
          {voucher.categories?.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {voucher.categories.map(c => (
                <span key={c} className="text-xs bg-green-50 text-green-700 px-2.5 py-0.5 rounded-full">{c}</span>
              ))}
            </div>
          )}
          {voucher.notes && (
            <p className="text-sm text-gray-600 dark:text-gray-300 leading-relaxed">{voucher.notes}</p>
          )}
          {voucher.link && (
            <a
              href={voucher.link}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 text-sm text-blue-600 hover:underline"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              {voucher.link}
            </a>
          )}
          <div className="pt-2 border-t border-gray-100 dark:border-gray-800 space-y-1.5 text-xs text-gray-400">
            <div className="flex justify-between">
              <span>נוסף</span>
              <span>{formatDate(voucher.created_at)}</span>
            </div>
            {voucher.actual_cost && (
              <div className="flex justify-between">
                <span>כמה עלה לי</span>
                <span>{formatCurrency(voucher.actual_cost)}</span>
              </div>
            )}
            {voucher.source && (
              <div className="flex justify-between">
                <span>מקור</span>
                <span>{voucher.source}</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Edit modal */}
      {showEdit && (
        <VoucherForm
          voucher={voucher}
          onClose={() => setShowEdit(false)}
          onSave={handleSave}
        />
      )}
    </div>
  )
}
