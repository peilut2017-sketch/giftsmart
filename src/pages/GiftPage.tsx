import { useEffect, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { formatCurrency, formatDate, getExpiryStatus, getExpiryLabel, isAlphanumeric } from '../utils/helpers'
import toast from 'react-hot-toast'
import JsBarcode from 'jsbarcode'
import QRCode from 'qrcode'
import { useT } from '../lib/i18n'
import Icon from '../components/ui/Icon'
import Button from '../components/ui/Button'

function isSafeUrl(url: string | undefined | null): boolean {
  if (!url) return false
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch { return false }
}

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
  link?: string | null
  balance_check_url?: string | null
}

export default function GiftPage() {
  const { t } = useT()
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
    if (!token) { setError(t('gift.error.invalid_link')); setLoading(false); return }
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
        setError(isMissing ? t('gift.error.config') : t('gift.error.not_found'))
        setLoading(false)
        return
      }
      if (!data || data.length === 0) {
        setError(t('gift.error.not_found'))
        setLoading(false)
        return
      }
      setGift(data[0] as GiftData)
    } catch (err) {
      console.error('loadGift exception:', err)
      setError(t('gift.error.load'))
    } finally {
      setLoading(false)
    }
  }

  function copyCode() {
    if (!gift?.code) return
    navigator.clipboard.writeText(gift.code).then(() => {
      setCopied(true)
      toast.success(t('gift.toast.copied'))
      setTimeout(() => setCopied(false), 2000)
    })
  }

  async function handleClaim() {
    if (!user) {
      // Save return URL and go to the real auth route (/auth doesn't exist — it used
      // to fall through to the marketing landing page, stranding gift recipients).
      // ?mode=register: a recipient claiming a gift almost never has an account yet.
      sessionStorage.setItem('gift_return', window.location.pathname)
      navigate('/login?mode=register')
      return
    }
    setClaiming(true)
    const { data, error } = await supabase.rpc('claim_gift', { p_token: token })
    setClaiming(false)

    if (error || !data?.success) {
      const msg = data?.error as string | undefined
      if (msg === 'already_claimed') toast.error(t('gift.toast.already_claimed'))
      else if (msg === 'own_gift') toast.error(t('gift.toast.own_gift'))
      else if (msg === 'no_wallet') toast.error(t('gift.toast.no_wallet'))
      else toast.error(t('gift.toast.claim_error'))
      return
    }

    // Refresh gift to show claimed state
    setGift(g => g ? { ...g, claimed_at: new Date().toISOString() } : g)
    toast.success(t('gift.toast.claimed'))
  }

  async function handleUpdateBalance() {
    if (!gift || !token) return
    const used = parseFloat(usedAmount)
    if (isNaN(used) || used < 0) return toast.error(t('gift.toast.invalid_amount'))
    if (used > gift.balance) return toast.error(t('gift.toast.exceeds_balance', { balance: gift.balance }))

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
      toast.error(t('gift.toast.update_error'))
      return
    }

    setGift(g => g ? { ...g, balance: newBalance } : g)
    setUsedAmount('')
    setStoreUsed('')
    setShowUpdateForm(false)

    toast(
      (toastItem) => (
        <span className="flex items-center gap-2">
          <span>{t('gift.toast.balance_updated', { from: formatCurrency(oldBalance), to: formatCurrency(newBalance) })}</span>
          <button
            onClick={async () => {
              toast.dismiss(toastItem.id)
              const { data: undoData } = await supabase.rpc('update_gift_voucher_balance', {
                p_token: token, p_new_balance: oldBalance,
              })
              if (undoData?.success) {
                setGift(g => g ? { ...g, balance: oldBalance } : g)
                toast.success(t('gift.toast.undone'))
              }
            }}
            className="text-primary font-semibold underline text-sm"
          >
            {t('gift.btn.cancel')}
          </button>
        </span>
      ),
      { duration: 5000 }
    )
  }

  const expiryStatus = gift ? getExpiryStatus(gift.expiry_date ?? undefined) : 'none'
  const expiryLabel  = gift ? getExpiryLabel(gift.expiry_date ?? undefined) : ''
  const pct      = gift && gift.amount > 0 ? (gift.balance / gift.amount) * 100 : 0
  const barColor = pct > 60 ? 'bg-primary' : pct > 25 ? 'bg-warning' : 'bg-error'
  const isAlpha  = gift ? isAlphanumeric(gift.code) : false
  const isClaimed = !!gift?.claimed_at

  return (
    <div className="min-h-dvh flex flex-col items-center justify-center p-4" style={{ background: 'linear-gradient(135deg, var(--c-primary-light), var(--c-bg) 60%)' }}>
      <div className="text-center mb-6">
        <div className="inline-flex items-center justify-center w-14 h-14 bg-gradient-to-br from-primary-mid to-primary-dark rounded-2xl shadow-fab mb-3">
          <Icon name="redeem" size={28} color="#fff" />
        </div>
        <h1 className="text-lg font-bold text-text2">{t('gift.heading')}</h1>
        {gift?.sender_name && (
          <p className="text-sm text-text3 mt-1">{t('gift.from', { name: gift.sender_name })}</p>
        )}
      </div>

      <div className="w-full max-w-sm">
        {loading && (
          <div className="bg-surface rounded-[28px] shadow-fab p-8 text-center">
            <div className="w-10 h-10 border-4 border-primary-light border-t-primary rounded-full animate-spin mx-auto" />
            <p className="text-sm text-text3 mt-3">{t('gift.loading')}</p>
          </div>
        )}

        {error && (
          <div className="bg-surface rounded-[28px] shadow-fab p-8 text-center">
            <Icon name="warning" size={48} color="var(--c-error)" className="mx-auto mb-3" />
            <p className="text-text font-semibold">{error}</p>
            <p className="text-sm text-text3 mt-1">{t('gift.error.hint')}</p>
          </div>
        )}

        {gift && !loading && (
          <div className={`bg-surface rounded-[28px] shadow-fab overflow-hidden border-2 ${
            expiryStatus === 'critical' ? 'border-error/30' :
            expiryStatus === 'warning'  ? 'border-warning/30' : 'border-border'
          }`}>
            <div className="p-6 pb-4">
              {/* Personal message */}
              {gift.message && (
                <div className="bg-primary-light border border-primary/20 rounded-2xl px-4 py-3 mb-4 text-center">
                  <p className="text-sm text-primary italic">"{gift.message}"</p>
                  {gift.sender_name && (
                    <p className="text-xs text-primary mt-1">— {gift.sender_name}</p>
                  )}
                </div>
              )}

              {/* Header: store + balance */}
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h2 className="text-xl font-bold text-text">{gift.store_name}</h2>
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
                  <div className="text-2xl font-bold text-text">{formatCurrency(gift.balance)}</div>
                  {gift.amount !== gift.balance && gift.amount > 0 && (
                    <div className="text-xs text-text3">{t('gift.of', { amount: formatCurrency(gift.amount) })}</div>
                  )}
                </div>
              </div>

              {/* Balance bar */}
              {gift.amount > 0 && (
                <div className="h-2 bg-bg rounded-full overflow-hidden mb-4">
                  <div className={`h-full w-full origin-right rounded-full ${barColor}`}
                    style={{ transform: `scaleX(${Math.min(100, pct) / 100})`, transition: 'transform 200ms var(--ease-out)' }} />
                </div>
              )}

              {/* Barcode / QR */}
              <div className="bg-bg rounded-2xl p-4 text-center mb-3">
                <div className="flex items-center justify-center mb-3">
                  {isAlpha
                    ? <canvas ref={qrRef} className="rounded-xl" />
                    : <svg ref={barcodeRef} className="max-w-full" />
                  }
                </div>
                <p className="text-xs text-text3 mb-1">{t('gift.voucher_code')}</p>
                <p className="text-xl font-mono font-bold text-text tracking-wider mb-3">{gift.code}</p>
                <button
                  onClick={copyCode}
                  className={`flex items-center gap-2 mx-auto px-5 py-2.5 rounded-2xl text-sm font-semibold transition-colors duration-150 ${
                    copied ? 'bg-primary text-white' : 'bg-primary-light text-primary'
                  }`}
                >
                  <Icon name={copied ? 'check' : 'content_copy'} size={16} />
                  {copied ? t('gift.btn.copied') : t('gift.btn.copy_code')}
                </button>
              </div>

              {gift.expiry_date && (
                <p className="text-xs text-text3 text-center mt-3">
                  {t('gift.valid_until', { date: formatDate(gift.expiry_date) })}
                </p>
              )}
              {gift.notes && (
                <p className="text-xs text-text2 bg-bg rounded-xl p-3 mt-3">{gift.notes}</p>
              )}

              {/* External links */}
              {(isSafeUrl(gift.link) || isSafeUrl(gift.balance_check_url)) && (
                <div className="flex flex-wrap gap-2 mt-3">
                  {isSafeUrl(gift.link) && (
                    <a
                      href={gift.link!}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1.5 text-xs font-semibold text-primary bg-primary-light px-3 py-2 rounded-xl"
                    >
                      <Icon name="open_in_new" size={14} />
                      {t('shared.open.link')}
                    </a>
                  )}
                  {isSafeUrl(gift.balance_check_url) && (
                    <a
                      href={gift.balance_check_url!}
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

            {/* Balance update */}
            {!isClaimed && (
              <div className="border-t border-border">
                {!showUpdateForm ? (
                  <button
                    onClick={() => setShowUpdateForm(true)}
                    className="w-full flex items-center justify-center gap-2 px-6 py-4 text-sm font-semibold text-primary"
                  >
                    <Icon name="keyboard_arrow_down" size={16} />
                    {t('gift.btn.update_balance')}
                  </button>
                ) : (
                  <div className="p-4 space-y-3 bg-primary-light">
                    <p className="text-sm font-semibold text-text2 text-center">{t('gift.update_balance_title')}</p>
                    <div className="flex gap-2">
                      <input
                        ref={usedInputRef}
                        type="number"
                        inputMode="decimal"
                        value={usedAmount}
                        onChange={e => setUsedAmount(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && handleUpdateBalance()}
                        placeholder={t('gift.placeholder.used_amount')}
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
                          : <Icon name="check" size={16} />
                        }
                        {t('gift.btn.confirm')}
                      </button>
                    </div>
                    {parseFloat(usedAmount) > 0 && parseFloat(usedAmount) <= gift.balance && (
                      <input
                        type="text"
                        value={storeUsed}
                        onChange={e => setStoreUsed(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && handleUpdateBalance()}
                        placeholder={t('gift.placeholder.store_used')}
                        className="w-full text-sm border border-border rounded-2xl px-4 py-2.5 bg-surface text-text focus:outline-none focus:ring-2 focus:ring-primary/30"
                        dir="rtl"
                      />
                    )}
                    {(() => {
                      const amount = parseFloat(usedAmount)
                      if (isNaN(amount) || amount <= 0 || amount > gift.balance) return null
                      return (
                        <p className="text-xs text-center text-text3">
                          {t('gift.new_balance_preview')}: <strong className="text-primary">{formatCurrency(Math.max(0, gift.balance - amount))}</strong>
                        </p>
                      )
                    })()}
                    <button
                      onClick={() => { setShowUpdateForm(false); setUsedAmount(''); setStoreUsed('') }}
                      className="w-full text-xs text-text3 py-1"
                    >
                      {t('gift.btn.cancel')}
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Claim / claimed */}
            <div className="border-t border-border p-4">
              {isClaimed ? (
                <div className="flex items-center justify-center gap-2 text-primary text-sm font-semibold py-1">
                  <Icon name="check" size={16} />
                  {t('gift.claimed_label')}
                </div>
              ) : (
                <Button onClick={handleClaim} disabled={claiming} loading={claiming} fullWidth>
                  {user ? (
                    <>
                      <Icon name="redeem" size={16} />
                      {t('gift.btn.add_to_wallet')}
                    </>
                  ) : (
                    <>
                      <Icon name="login" size={16} />
                      {t('gift.btn.login_to_claim')}
                    </>
                  )}
                </Button>
              )}
            </div>

            <div className="bg-bg px-6 py-3 text-center border-t border-border">
              <p className="text-xs text-text3">{t('gift.footer')}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
