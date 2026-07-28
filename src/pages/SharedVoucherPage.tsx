import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { formatCurrency, formatDate, getExpiryStatus, getExpiryLabel, isAlphanumeric } from '../utils/helpers'
import toast from 'react-hot-toast'
import JsBarcode from 'jsbarcode'
import QRCode from 'qrcode'
import { useT } from '../lib/i18n'
import Icon from '../components/ui/Icon'

function isSafeUrl(url: string | undefined | null): boolean {
  if (!url) return false
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch { return false }
}

interface SharedVoucher {
  store_name: string
  balance: number
  amount: number
  code: string
  expiry_date?: string | null
  notes?: string | null
  is_expired?: boolean
  code_override?: string | null
  link?: string | null
  balance_check_url?: string | null
}

export default function SharedVoucherPage() {
  const { t } = useT()
  const { token } = useParams<{ token: string }>()
  const [voucher, setVoucher] = useState<SharedVoucher | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  // Balance update state
  const [showUpdateForm, setShowUpdateForm] = useState(false)
  const [usedAmount, setUsedAmount] = useState('')
  const [storeUsed, setStoreUsed] = useState('')
  const [updating, setUpdating] = useState(false)

  const barcodeRef = useRef<SVGSVGElement>(null)
  const qrRef = useRef<HTMLCanvasElement>(null)
  const usedInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!token) { setError(t('shared.error.invalid_link')); setLoading(false); return }
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
        setError(t('shared.error.not_found'))
        setLoading(false)
        return
      }

      const row = data[0] as SharedVoucher

      if (row.is_expired) {
        setError(t('shared.error.expired'))
        setLoading(false)
        return
      }

      if (!row.code) {
        setError(t('shared.error.no_data'))
        setLoading(false)
        return
      }

      // The E2EE decrypted-code override is applied inside get_shared_voucher_live()
      // itself. It used to be fetched here with a second, direct SELECT on
      // shared_voucher_tokens, which only worked while that table had a public
      // read-everything policy — the same policy that let anyone enumerate every
      // share token, so it had to go (see supabase-fix-share-token-idor.sql).
      setVoucher(row)

      // Increment view count atomically via RPC
      supabase.rpc('increment_share_view_count', { p_token: token }).then(() => {})
    } catch {
      setError(t('shared.error.load'))
    } finally {
      setLoading(false)
    }
  }

  function copyCode() {
    if (!voucher?.code) return
    navigator.clipboard.writeText(voucher.code).then(() => {
      setCopied(true)
      toast.success(t('shared.toast.copied'))
      setTimeout(() => setCopied(false), 2000)
    })
  }

  async function handleUpdateBalance() {
    if (!voucher || !token) return
    const used = parseFloat(usedAmount)
    if (isNaN(used) || used < 0) return toast.error(t('shared.toast.invalid_amount'))
    if (used > voucher.balance) return toast.error(t('shared.toast.exceeds_balance', { balance: voucher.balance }))

    const newBalance = Math.max(0, voucher.balance - used)
    const oldBalance = voucher.balance
    const trimmedStore = storeUsed.trim() || null
    setUpdating(true)

    const { data, error } = await supabase.rpc('update_voucher_balance_by_token', {
      p_token: token,
      p_new_balance: newBalance,
      ...(trimmedStore ? { p_store_used: trimmedStore } : {}),
    })
    setUpdating(false)

    if (error || !data?.success) {
      const msg = (data?.error as string) || error?.message || 'שגיאה'
      if (msg === 'token_expired') toast.error(t('shared.toast.link_expired'))
      else toast.error(t('shared.toast.update_error'))
      return
    }

    setVoucher(v => v ? { ...v, balance: newBalance } : v)
    setUsedAmount('')
    setStoreUsed('')
    setShowUpdateForm(false)

    toast(
      (toastItem) => (
        <span className="flex items-center gap-2">
          <span>{t('shared.toast.balance_updated', { from: formatCurrency(oldBalance), to: formatCurrency(newBalance) })}</span>
          <button
            onClick={async () => {
              toast.dismiss(toastItem.id)
              const { data: undoData } = await supabase.rpc('update_voucher_balance_by_token', {
                p_token: token,
                p_new_balance: oldBalance,
              })
              if (undoData?.success) {
                setVoucher(v => v ? { ...v, balance: oldBalance } : v)
                toast.success(t('shared.toast.undone'))
              }
            }}
            className="text-primary font-semibold underline text-sm"
          >
            {t('shared.btn.cancel')}
          </button>
        </span>
      ),
      { duration: 5000 }
    )
  }

  const expiryStatus = voucher ? getExpiryStatus(voucher.expiry_date ?? undefined) : 'none'
  const expiryLabel = voucher ? getExpiryLabel(voucher.expiry_date ?? undefined) : ''
  const pct = voucher && voucher.amount > 0 ? (voucher.balance / voucher.amount) * 100 : 0
  const barColor = pct > 60 ? 'bg-primary' : pct > 25 ? 'bg-warning' : 'bg-error'
  const isAlpha = voucher ? isAlphanumeric(voucher.code) : false

  return (
    <div className="min-h-dvh flex flex-col items-center justify-center p-4" style={{ background: 'linear-gradient(135deg, var(--c-primary-light), var(--c-bg) 60%)' }}>
      <div className="text-center mb-6">
        <div className="inline-flex items-center justify-center w-14 h-14 bg-gradient-to-br from-primary-mid to-primary-dark rounded-2xl shadow-fab mb-3">
          <Icon name="account_balance_wallet" size={28} color="#fff" />
        </div>
        <h1 className="text-lg font-bold text-text2">{t('shared.heading')}</h1>
      </div>

      <div className="w-full max-w-sm">
        {loading && (
          <div className="bg-surface rounded-[28px] shadow-fab p-8 text-center">
            <div className="w-10 h-10 border-4 border-primary-light border-t-primary rounded-full animate-spin mx-auto" />
            <p className="text-sm text-text3 mt-3">{t('shared.loading')}</p>
          </div>
        )}

        {error && (
          <div className="bg-surface rounded-[28px] shadow-fab p-8 text-center">
            <Icon name="warning" size={48} color="var(--c-error)" className="mx-auto mb-3" />
            <p className="text-text font-semibold">{error}</p>
            <p className="text-sm text-text3 mt-1">{t('shared.error.hint')}</p>
          </div>
        )}

        {voucher && !loading && (
          <div className={`bg-surface rounded-[28px] shadow-fab overflow-hidden border-2 ${
            expiryStatus === 'critical' ? 'border-error/30' :
            expiryStatus === 'warning'  ? 'border-warning/30' : 'border-border'
          }`}>
            <div className="p-6 pb-4">
              {/* Header: store + balance */}
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h2 className="text-xl font-bold text-text">{voucher.store_name}</h2>
                  {expiryLabel && (
                    <div className={`flex items-center gap-1 mt-1 ${
                      expiryStatus === 'expired'  ? 'text-text3' :
                      expiryStatus === 'critical' ? 'text-error' :
                      expiryStatus === 'warning'  ? 'text-warning' : 'text-text3'
                    }`}>
                      {(expiryStatus === 'critical' || expiryStatus === 'warning') && (
                        <Icon name="warning" size={14} />
                      )}
                      <span className="text-xs font-medium">{expiryLabel}</span>
                    </div>
                  )}
                </div>
                <div className="text-left">
                  <div className="text-2xl font-bold text-text">{formatCurrency(voucher.balance)}</div>
                  {voucher.amount !== voucher.balance && voucher.amount > 0 && (
                    <div className="text-xs text-text3">{t('shared.of', { amount: formatCurrency(voucher.amount) })}</div>
                  )}
                </div>
              </div>

              {/* Balance bar */}
              {voucher.amount > 0 && (
                <div className="h-2 bg-bg rounded-full overflow-hidden mb-4">
                  <div className={`h-full rounded-full transition-all duration-300 ${barColor}`} style={{ width: `${Math.min(100, pct)}%` }} />
                </div>
              )}

              {/* Barcode / QR */}
              <div className="bg-bg rounded-2xl p-4 text-center mb-3">
                <div className="flex items-center justify-center mb-3">
                  {isAlpha ? (
                    <canvas ref={qrRef} className="rounded-xl" />
                  ) : (
                    <svg ref={barcodeRef} className="max-w-full" />
                  )}
                </div>
                <p className="text-xs text-text3 mb-1">{t('shared.voucher_code')}</p>
                <p className="text-xl font-mono font-bold text-text tracking-wider mb-3">{voucher.code}</p>
                <button
                  onClick={copyCode}
                  className={`flex items-center gap-2 mx-auto px-5 py-2.5 rounded-2xl text-sm font-semibold transition-all ${
                    copied ? 'bg-primary text-white' : 'bg-primary-light text-primary'
                  }`}
                >
                  <Icon name={copied ? 'check' : 'content_copy'} size={16} />
                  {copied ? t('shared.btn.copied') : t('shared.btn.copy_code')}
                </button>
              </div>

              {voucher.expiry_date && (
                <p className="text-xs text-text3 text-center mt-3">
                  {t('shared.valid_until', { date: formatDate(voucher.expiry_date) })}
                </p>
              )}
              {voucher.notes && (
                <p className="text-xs text-text2 bg-bg rounded-xl p-3 mt-3">{voucher.notes}</p>
              )}

              {/* External links */}
              {(isSafeUrl(voucher.link) || isSafeUrl(voucher.balance_check_url)) && (
                <div className="flex flex-wrap gap-2 mt-3">
                  {isSafeUrl(voucher.link) && (
                    <a
                      href={voucher.link!}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1.5 text-xs font-semibold text-primary bg-primary-light px-3 py-2 rounded-xl"
                    >
                      <Icon name="open_in_new" size={14} />
                      {t('shared.open.link')}
                    </a>
                  )}
                  {isSafeUrl(voucher.balance_check_url) && (
                    <a
                      href={voucher.balance_check_url!}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1.5 text-xs font-semibold text-primary bg-primary-light px-3 py-2 rounded-xl"
                    >
                      <Icon name="open_in_new" size={14} />
                      {t('shared.check.balance')}
                    </a>
                  )}
                </div>
              )}
            </div>

            {/* Balance update section */}
            <div className="border-t border-border">
              {!showUpdateForm ? (
                <button
                  onClick={() => setShowUpdateForm(true)}
                  className="w-full flex items-center justify-center gap-2 px-6 py-4 text-sm font-semibold text-primary"
                >
                  <Icon name="keyboard_arrow_down" size={16} />
                  עדכן יתרה לאחר שימוש
                </button>
              ) : (
                <div className="p-4 space-y-3 bg-primary-light">
                  <p className="text-sm font-semibold text-text2 text-center">עדכון יתרה</p>
                  <div className="flex gap-2">
                    <input
                      ref={usedInputRef}
                      type="number"
                      inputMode="decimal"
                      value={usedAmount}
                      onChange={e => setUsedAmount(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && handleUpdateBalance()}
                      placeholder="סכום שימוש"
                      className="flex-1 text-center text-lg font-bold border border-border rounded-2xl px-4 py-2.5 bg-surface text-text focus:outline-none focus:ring-2 focus:ring-primary/30"
                      dir="ltr"
                    />
                    <button
                      onClick={handleUpdateBalance}
                      disabled={updating || !usedAmount || isNaN(parseFloat(usedAmount)) || parseFloat(usedAmount) <= 0}
                      className="px-5 py-2.5 bg-primary text-white rounded-2xl font-semibold text-sm disabled:opacity-50 flex items-center gap-1.5"
                    >
                      {updating
                        ? <Icon name="progress_activity" size={16} className="animate-spin" />
                        : <Icon name="check" size={16} />}
                      אשר
                    </button>
                  </div>
                  {parseFloat(usedAmount) > 0 && parseFloat(usedAmount) <= voucher.balance && (
                    <input
                      type="text"
                      value={storeUsed}
                      onChange={e => setStoreUsed(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && handleUpdateBalance()}
                      placeholder="באיזה חנות? (אופציונלי)"
                      className="w-full text-sm border border-border rounded-2xl px-4 py-2.5 bg-surface text-text focus:outline-none focus:ring-2 focus:ring-primary/30"
                      dir="rtl"
                    />
                  )}
                  {(() => {
                    const amount = parseFloat(usedAmount)
                    if (isNaN(amount) || amount <= 0 || amount > voucher.balance) return null
                    return (
                      <p className="text-xs text-center text-text3">
                        יתרה חדשה: <strong className="text-primary">{formatCurrency(Math.max(0, voucher.balance - amount))}</strong>
                      </p>
                    )
                  })()}
                  <button
                    onClick={() => { setShowUpdateForm(false); setUsedAmount(''); setStoreUsed('') }}
                    className="w-full text-xs text-text3 py-1"
                  >
                    ביטול
                  </button>
                </div>
              )}
            </div>

            <div className="bg-bg px-6 py-3 text-center border-t border-border">
              <p className="text-xs text-text3">שותף דרך GiftSmart</p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
