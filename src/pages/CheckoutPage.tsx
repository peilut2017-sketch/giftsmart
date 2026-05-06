import { useEffect, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useVouchers, type ActivityLogEntry, type VoucherShare, type PendingGift } from '../contexts/VoucherContext'
import { useAuth } from '../contexts/AuthContext'
import { useSubscription } from '../contexts/SubscriptionContext'
import { useMarketplace } from '../contexts/MarketplaceContext'
import { sendVoucherSharedEmail, sendVoucherShareInviteEmail, sendGiftEmail } from '../lib/emailService'
import { isAlphanumeric, formatCurrency, formatDate, getExpiryLabel, getExpiryStatus } from '../utils/helpers'
import { sendUsageNotification } from '../hooks/useNotifications'
import { useBodyScrollLock } from '../hooks/useBodyScrollLock'
import { supabase } from '../lib/supabase'
import JsBarcode from 'jsbarcode'
import QRCode from 'qrcode'
import { ArrowRight, Copy, ExternalLink, AlertTriangle, Star, Eye, EyeOff, Archive, Check, Share2, Link2, Trash2, X, Clock, PlusCircle, Pencil, PackageCheck, Undo2, MinusCircle, UserPlus, Users, ChevronDown, ChevronUp, Edit2, Gift, Calendar, Mail, LinkIcon, Lock, Unlock, ShoppingBag, Loader2, Shield, Lightbulb } from 'lucide-react'
import VoucherForm from '../components/VoucherForm'
import toast from 'react-hot-toast'
import ConfirmDialog from '../components/ConfirmDialog'
import { useE2EE } from '../contexts/E2EEContext'
import { isEncryptedField } from '../lib/e2ee'
import { useT } from '../lib/i18n'

function isSafeUrl(url: string | undefined): boolean {
  if (!url) return false
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch { return false }
}

const QUICK_AMOUNTS = [50, 100]

const CAT_COLORS: Record<string, string> = {
  'אופנה': '#8b5cf6', 'מזון': '#f59e0b', 'אלקטרוניקה': '#3b82f6',
  'יופי': '#ec4899', 'בית': '#10b981', 'ספורט': '#0ea5e9',
  'נסיעות': '#6366f1', 'בידור': '#f43f5e', 'ילדים': '#a855f7',
  'בריאות': '#22c55e', 'ספרים': '#78716c', 'מסעדות': '#ef4444',
  'סופר': '#84cc16', 'מתנה': '#f97316', 'אחר': '#6b7280',
}

export default function CheckoutPage() {
  const { t } = useT()
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { user, profile } = useAuth()
  const { vouchers, archivedVouchers, superVouchers, sharedWithMe, updateVoucher, deleteVoucher, archiveVoucher, isOnline, createShareToken, deleteShareToken, getShareTokens, shareVoucherWithUser, getVoucherShares, unshareVoucher, updateSharedVoucherBalance, getVoucherActivityLog, createGift, cancelGift, getPendingGifts, refreshVouchers } = useVouchers()
  const { limits, openUpgradeSheet } = useSubscription()
  const { listForSale, removeFromSale } = useMarketplace()

  const voucher = [...vouchers, ...archivedVouchers, ...sharedWithMe].find(v => v.id === id)
  const isSharedVoucher = sharedWithMe.some(v => v.id === id)
  const sv = superVouchers.find(s => s.id === voucher?.super_voucher_id)

  const { hint, isVaultUnlocked, unlockVault, lockVault, decrypt } = useE2EE()
  const [plainCode, setPlainCode] = useState<string | null>(null)
  const [plainCvv,  setPlainCvv]  = useState<string | null>(null)
  const [vaultPassInput, setVaultPassInput] = useState('')
  const [vaultUnlocking, setVaultUnlocking] = useState(false)
  const [vaultError, setVaultError] = useState('')
  const [showVaultUnlock, setShowVaultUnlock] = useState(false)

  const barcodeRef = useRef<SVGSVGElement>(null)
  const qrRef = useRef<HTMLCanvasElement>(null)
  const [showCvv, setShowCvv] = useState(false)
  const [customAmount, setCustomAmount] = useState('')
  const [customStore, setCustomStore] = useState('')
  const [copied, setCopied] = useState(false)
  const wakeLockRef = useRef<any>(null)
  const [confirmArchive, setConfirmArchive] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [showEditForm, setShowEditForm] = useState(false)
  const [showShareModal, setShowShareModal] = useState(false)
  const [shareTokens, setShareTokens] = useState<Array<{ token: string; expires_at: string | null; view_count: number; created_at: string }>>([])
  const [shareLoading, setShareLoading] = useState(false)
  const [shareTab, setShareTab] = useState<'link' | 'user' | 'gift'>('link')
  const [shareEmail, setShareEmail] = useState('')
  const [shareEmailLoading, setShareEmailLoading] = useState(false)
  const [voucherShares, setVoucherShares] = useState<VoucherShare[]>([])
  const [sharesLoaded, setSharesLoaded] = useState(false)
  const [pendingShareEmail, setPendingShareEmail] = useState<string | null>(null)

  // Gift state
  const [giftMode, setGiftMode] = useState<'email' | 'link'>('link')
  const [giftEmail, setGiftEmail] = useState('')
  const [giftMessage, setGiftMessage] = useState('')
  const [giftScheduled, setGiftScheduled] = useState(false)
  const [giftDate, setGiftDate] = useState('')
  const [giftSending, setGiftSending] = useState(false)
  const [giftLink, setGiftLink] = useState<string | null>(null)
  const [pendingGifts, setPendingGifts] = useState<PendingGift[]>([])
  const [giftsLoaded, setGiftsLoaded] = useState(false)
  const [voucherLog, setVoucherLog] = useState<ActivityLogEntry[]>([])
  const [logLoading, setLogLoading] = useState(true)
  const [showStores, setShowStores] = useState(false)
  const [lockConfirmed, setLockConfirmed] = useState(false)
  // Sell modal
  const [showSellModal, setShowSellModal] = useState(false)
  const [sellPrice, setSellPrice] = useState('')
  const [sellDescription, setSellDescription] = useState('')
  const [sellLoading, setSellLoading] = useState(false)
  const [removingFromSale, setRemovingFromSale] = useState(false)

  // Lock body scroll when sell modal is open
  useBodyScrollLock(showSellModal)

  // Load voucher activity log
  useEffect(() => {
    if (!voucher?.id) return
    let cancelled = false
    setLogLoading(true)
    getVoucherActivityLog(voucher.id)
      .then(data => { if (!cancelled) setVoucherLog(data) })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLogLoading(false) })
    return () => { cancelled = true }
  }, [voucher?.id])

  // WakeLock
  useEffect(() => {
    async function acquireWakeLock() {
      try {
        if ('wakeLock' in navigator) {
          wakeLockRef.current = await (navigator as any).wakeLock.request('screen')
        }
      } catch {}
    }
    acquireWakeLock()
    return () => {
      try { wakeLockRef.current?.release() } catch {}
      wakeLockRef.current = null
    }
  }, [])

  // Decrypt E2EE fields when vault unlocks
  useEffect(() => {
    if (!voucher?.is_e2ee) { setPlainCode(null); setPlainCvv(null); return }
    if (!isVaultUnlocked) { setPlainCode(null); setPlainCvv(null); return }
    async function dec() {
      try {
        if (isEncryptedField(voucher!.code)) setPlainCode(await decrypt(voucher!.code))
        else setPlainCode(voucher!.code)
        if (voucher!.cvv && isEncryptedField(voucher!.cvv)) setPlainCvv(await decrypt(voucher!.cvv))
        else setPlainCvv(voucher!.cvv || null)
      } catch { setPlainCode(null); setPlainCvv(null) }
    }
    dec()
  }, [voucher?.code, voucher?.cvv, isVaultUnlocked]) // eslint-disable-line react-hooks/exhaustive-deps

  // Effective code for display and barcode rendering
  const effectiveCode = voucher?.is_e2ee ? (plainCode ?? null) : (voucher?.code ?? null)

  // Generate barcode or QR
  useEffect(() => {
    if (!effectiveCode) return
    const isAlpha = isAlphanumeric(effectiveCode)

    if (!isAlpha && barcodeRef.current) {
      try {
        JsBarcode(barcodeRef.current, effectiveCode, {
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
      QRCode.toCanvas(qrRef.current, effectiveCode, {
        width: 220,
        margin: 2,
        color: { dark: '#1e293b', light: '#ffffff' },
      }).catch(() => {})
    }
  }, [effectiveCode, lockConfirmed])

  async function copyCode() {
    if (voucher?.is_e2ee && !isVaultUnlocked) {
      toast.error(t('checkout.copy.vault.locked'))
      return
    }
    const codeToCopy = effectiveCode ?? voucher?.code
    if (!codeToCopy) return
    await navigator.clipboard.writeText(codeToCopy).catch(() => {})
    setCopied(true)
    toast.success(t('checkout.code.copied'))
    setTimeout(() => setCopied(false), 2000)
  }

  async function updateBalance(newBalance: number, usedAmount?: number, storeUsed?: string | null) {
    if (!voucher) return
    if (!isOnline && isSharedVoucher) {
      toast.error(t('checkout.offline'))
      return
    }
    const clamped = Math.max(0, newBalance)
    if (isSharedVoucher) {
      await updateSharedVoucherBalance(voucher.id, clamped, storeUsed)
    } else {
      await updateVoucher(voucher.id, { balance: clamped }, storeUsed)
      if (!isOnline) {
        toast.success(t('checkout.balance.updated.offline'))
        if (clamped <= 0) setConfirmArchive(true)
        const used = usedAmount ?? (voucher.balance - clamped)
        if (used > 0) sendUsageNotification(voucher.store_name, used, clamped, storeUsed ?? null, user?.id)
        return
      }
    }
    if (clamped <= 0) {
      toast.success(t('checkout.balance.zeroed'))
      setConfirmArchive(true)
    } else {
      toast.success(t('checkout.balance.updated'))
    }
    const used = usedAmount ?? (voucher.balance - clamped)
    if (used > 0) {
      sendUsageNotification(voucher.store_name, used, clamped, storeUsed ?? null, user?.id)
    }
  }

  async function openShareModal() {
    if (!voucher) return
    setShareLoading(true)
    setShowShareModal(true)
    setShareTab('link')
    setShareEmail('')
    setPendingShareEmail(null)
    setGiftsLoaded(false)
    const tokens = await getShareTokens(voucher.id)
    setShareTokens(tokens)
    setShareLoading(false)
    if (!isSharedVoucher) {
      getVoucherShares(voucher.id).then(shares => {
        setVoucherShares(shares)
        setSharesLoaded(true)
      }).catch(() => setSharesLoaded(true))
    }
  }

  async function handleShareWithUser() {
    if (!voucher || !shareEmail.trim()) return
    if (voucherShares.length >= limits.maxSharedVouchers) {
      openUpgradeSheet(t('checkout.share.limit', { max: limits.maxSharedVouchers }))
      return
    }
    setShareEmailLoading(true)
    try {
      const result = await shareVoucherWithUser(voucher.id, shareEmail.trim())
      if (result === 'not_found') {
        setPendingShareEmail(shareEmail.trim())
      } else if (result === 'already_shared') {
        toast(t('checkout.already.shared'), { icon: 'ℹ️' })
      } else {
        // Send notification email (non-blocking)
        sendVoucherSharedEmail({
          to_email: shareEmail.trim(),
          to_name: shareEmail.trim(),
          from_name: profile?.name || user?.email || '',
          store_name: voucher.store_name,
        }).catch((err) => console.error('share email error:', err))
        toast.success(t('checkout.shared.with', { email: shareEmail.trim() }))
        setShareEmail('')
        const shares = await getVoucherShares(voucher.id)
        setVoucherShares(shares)
      }
    } catch (err: any) {
      toast.error(err?.message || t('checkout.share.error'))
    } finally {
      setShareEmailLoading(false)
    }
  }

  async function handleSendVoucherInvite() {
    if (!voucher || !pendingShareEmail) return
    try {
      await sendVoucherShareInviteEmail({
        to_email: pendingShareEmail,
        from_name: profile?.name || user?.email || '',
        store_name: voucher.store_name,
      })
      toast.success(t('checkout.invite.sent', { email: pendingShareEmail }))
    } catch {
      toast.error(t('checkout.invite.error'))
    } finally {
      setPendingShareEmail(null)
      setShareEmail('')
    }
  }

  async function loadPendingGifts() {
    if (!voucher || giftsLoaded) return
    const gifts = await getPendingGifts(voucher.id)
    setPendingGifts(gifts)
    setGiftsLoaded(true)
  }

  async function handleSendGift() {
    if (!voucher) return
    if (giftMode === 'email' && !giftEmail.trim()) return
    // Block sending gift to yourself
    if (giftMode === 'email' && giftEmail.trim().toLowerCase() === user?.email?.toLowerCase()) {
      toast.error(t('checkout.gift.self.error'))
      return
    }
    const sendAt = giftScheduled && giftDate ? new Date(giftDate) : new Date()
    setGiftSending(true)
    setGiftLink(null)
    try {
      const email = giftMode === 'email' ? giftEmail.trim() : null
      const token = await createGift(voucher.id, email, giftMessage.trim(), sendAt)
      if (!token) { toast.error(t('checkout.gift.create.error')); return }

      const link = `${window.location.origin}/gift/${token}`

      if (giftMode === 'link') {
        setGiftLink(link)
        await navigator.clipboard.writeText(link).catch(() => {})
        toast.success(t('checkout.gift.link.created'))
      } else {
        const sendNow = !giftScheduled || !giftDate || sendAt <= new Date()
        if (sendNow) {
          try {
            await sendGiftEmail({
              to_email: giftEmail.trim(),
              sender_name: profile?.name || user?.email || '',
              message: giftMessage.trim() || undefined,
              store_name: voucher.store_name,
              balance: voucher.balance,
              gift_link: link,
            })
            toast.success(t('checkout.gift.sent', { email: giftEmail.trim() }))
          } catch (emailErr: any) {
            // Gift was created but email failed — show link as fallback
            setGiftLink(link)
            toast.error(t('checkout.gift.email.failed'))
            console.error('Gift email error:', emailErr)
          }
        } else {
          toast.success(t('checkout.gift.scheduled', { date: new Date(giftDate).toLocaleDateString('he-IL') }))
        }
        setGiftEmail('')
      }

      setGiftMessage('')
      setGiftScheduled(false)
      setGiftDate('')
      setGiftsLoaded(false)
      const gifts = await getPendingGifts(voucher.id)
      setPendingGifts(gifts)
      setGiftsLoaded(true)
    } catch (err: any) {
      toast.error(t('checkout.gift.create.error') + (err?.message ? ': ' + err.message : ''))
    } finally {
      setGiftSending(false)
    }
  }

  async function handleCancelGift(giftId: string) {
    await cancelGift(giftId)
    setPendingGifts(prev => prev.filter(g => g.id !== giftId))
    toast.success(t('checkout.gift.cancelled'))
  }

  async function handleUnshare(email: string) {
    if (!voucher) return
    await unshareVoucher(voucher.id, email)
    setVoucherShares(prev => prev.filter(s => s.shared_with_email !== email))
    toast.success(t('checkout.unshared'))
  }

  async function handleCreateShareLink(days?: number) {
    if (!voucher) return
    // E2EE vouchers: require vault open so recipient sees the real code
    if (voucher.is_e2ee && !isVaultUnlocked) {
      toast.error(t('checkout.share.vault.locked'))
      return
    }
    setShareLoading(true)
    try {
      const codeOverride = voucher.is_e2ee && effectiveCode ? effectiveCode : undefined
      const token = await createShareToken(voucher.id, days, codeOverride)
      const url = `${window.location.origin}/s/${token}`
      // Clipboard write is best-effort — failure must not hide the success
      try {
        await navigator.clipboard.writeText(url)
        toast.success(t('checkout.share.link.copied'))
      } catch {
        toast.success(t('checkout.share.link.created'))
      }
      const tokens = await getShareTokens(voucher.id)
      setShareTokens(tokens)
    } catch (err: any) {
      if (err?.message === 'TABLE_MISSING') {
        toast.error(t('checkout.share.table.missing'), { duration: 6000 })
      } else {
        toast.error(t('checkout.share.link.error') + (err?.message ? ': ' + err.message : ''))
      }
    } finally {
      setShareLoading(false)
    }
  }

  async function handleDeleteShareToken(token: string) {
    await deleteShareToken(token)
    setShareTokens(prev => prev.filter(t => t.token !== token))
    toast.success(t('checkout.share.link.deleted'))
  }


  if (!voucher) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <p className="text-gray-500">{t('checkout.not.found')}</p>
          <button onClick={() => navigate(-1)} className="mt-4 text-green-600 underline text-sm">{t('checkout.back')}</button>
        </div>
      </div>
    )
  }

  const isAlpha = isAlphanumeric(effectiveCode ?? voucher.code)
  const expiryStatus = getExpiryStatus(voucher.expiry_date)
  const expiryLabel = getExpiryLabel(voucher.expiry_date)
  const isArchived = archivedVouchers.some(v => v.id === id)
  const catColor = CAT_COLORS[voucher.categories?.[0] || ''] || '#16a34a'

  // Lock gate — show blocking overlay if voucher is locked and not yet confirmed
  if (voucher.is_locked && !lockConfirmed) {
    const isForSale = voucher.lock_reason === 'for_sale'

    return (
      <div className="flex-1 bg-gray-50 flex flex-col">
        {/* Minimal header */}
        <div className="bg-white border-b sticky top-0 z-20">
          <div className="flex items-center gap-3 px-4 py-3">
            <button onClick={() => navigate(-1)} className="p-2 rounded-full hover:bg-gray-100">
              <ArrowRight className="w-5 h-5" />
            </button>
            <h1 className="font-bold text-gray-900">{voucher.store_name}</h1>
          </div>
        </div>

        {/* Lock screen */}
        <div className="flex-1 flex items-center justify-center p-6">
          {isForSale ? (
            /* For-sale lock: can't use, but can remove from sale */
            <div className="bg-white rounded-3xl shadow-lg border border-blue-200 p-8 max-w-sm w-full text-center">
              <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <ShoppingBag className="w-8 h-8 text-blue-500" />
              </div>
              <h2 className="text-xl font-bold text-gray-900 mb-2">{t('checkout.for.sale.title')}</h2>
              <p className="text-sm text-gray-500 mb-6">{t('checkout.for.sale.desc')}</p>
              <button
                disabled={removingFromSale}
                onClick={async () => {
                  setRemovingFromSale(true)
                  try {
                    // Find listing by voucher_id
                    const { data } = await supabase
                      .from('marketplace_listings')
                      .select('id')
                      .eq('voucher_id', voucher.id)
                      .in('status', ['active', 'pending_payment'])
                      .limit(1)
                      .single()
                    if (data?.id) {
                      await removeFromSale(data.id)
                      toast.success(t('checkout.removed.from.sale'))
                      setLockConfirmed(false)
                      await refreshVouchers()
                    }
                  } catch {
                    toast.error(t('checkout.remove.sale.error'))
                  } finally {
                    setRemovingFromSale(false)
                  }
                }}
                className="w-full flex items-center justify-center gap-2 bg-red-500 text-white py-3.5 rounded-2xl font-semibold shadow-md hover:bg-red-600 transition-all disabled:opacity-50"
              >
                {removingFromSale ? <Loader2 className="w-4 h-4 animate-spin" /> : <X className="w-4 h-4" />}
                {t('checkout.remove.from.sale')}
              </button>
              <button
                onClick={() => navigate('/market')}
                className="w-full mt-3 py-3 text-blue-500 text-sm font-medium hover:text-blue-700"
              >
                {t('checkout.go.to.market')}
              </button>
              <button
                onClick={() => navigate(-1)}
                className="w-full mt-1 py-3 text-gray-500 text-sm font-medium hover:text-gray-700"
              >
                {t('checkout.back')}
              </button>
            </div>
          ) : (
            /* Regular lock: allow unlock */
            <div className="bg-white rounded-3xl shadow-lg border border-orange-200 p-8 max-w-sm w-full text-center">
              <div className="w-16 h-16 bg-orange-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <Lock className="w-8 h-8 text-orange-500" />
              </div>
              <h2 className="text-xl font-bold text-gray-900 mb-2">{t('checkout.locked.title')}</h2>
              {voucher.lock_reason ? (
                <div className="bg-orange-50 border border-orange-200 rounded-2xl p-4 mb-6 text-right">
                  <p className="text-xs text-orange-600 font-medium mb-1">{t('checkout.lock.reason.label')}</p>
                  <p className="text-sm text-orange-800 font-medium">{voucher.lock_reason}</p>
                </div>
              ) : (
                <p className="text-sm text-gray-500 mb-6">{t('checkout.locked.desc')}</p>
              )}
              <p className="text-xs text-gray-400 mb-6">{t('checkout.locked.hint')}</p>
              <button
                onClick={() => setLockConfirmed(true)}
                className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-orange-400 to-amber-500 text-white py-3.5 rounded-2xl font-semibold shadow-md hover:shadow-lg transition-all"
              >
                <Unlock className="w-4 h-4" />
                {t('checkout.unlock.voucher')}
              </button>
              <button
                onClick={() => navigate(-1)}
                className="w-full mt-3 py-3 text-gray-500 text-sm font-medium hover:text-gray-700"
              >
                {t('checkout.back')}
              </button>
            </div>
          )}
        </div>
      </div>
    )
  }

  async function handleListForSale() {
    const price = parseFloat(sellPrice)
    if (!price || price <= 0) { toast.error(t('checkout.sell.invalid.price')); return }
    // Check payment methods
    const methods = profile?.marketplace_payment_methods || []
    if (methods.length === 0) {
      toast.error(t('checkout.sell.no.payment.method'))
      navigate('/settings')
      return
    }
    setSellLoading(true)
    try {
      await listForSale(voucher!.id, price, sellDescription || undefined)
      toast.success(t('checkout.sell.listed'))
      setShowSellModal(false)
      setSellPrice('')
      setSellDescription('')
      await refreshVouchers()
    } catch (err: any) {
      const msg = err?.message || ''
      if (msg.includes('already_listed')) toast.error(t('checkout.sell.already.listed'))
      else toast.error(t('checkout.sell.error'))
    } finally {
      setSellLoading(false)
    }
  }

  return (
    <div className="flex-1" style={{ background: 'var(--c-bg)' }}>
      {/* Sell modal */}
      {showSellModal && (
        <div className="fixed inset-0 bg-black/50 z-[100] flex items-end justify-center overflow-hidden" onClick={() => setShowSellModal(false)}>
          <div className="bg-white rounded-t-3xl w-full max-w-2xl flex flex-col max-h-[85dvh]" onClick={e => e.stopPropagation()}>
            {/* Header — קבוע */}
            <div className="flex items-center justify-between px-6 pt-6 pb-4 shrink-0">
              <h2 className="font-bold text-lg flex items-center gap-2">
                <ShoppingBag className="w-5 h-5 text-green-600" />
                {t('checkout.sell.modal.title')}
              </h2>
              <button onClick={() => setShowSellModal(false)} className="p-2 rounded-full hover:bg-gray-100">
                <X className="w-5 h-5" />
              </button>
            </div>
            {/* Content — גלילה */}
            <div className="modal-scroll flex-1 overflow-y-auto min-h-0 px-6 space-y-4 pb-4">
              <div className="bg-gray-50 rounded-2xl p-4 space-y-1">
                <p className="font-semibold">{voucher!.store_name}</p>
                <p className="text-sm text-gray-500">{t('checkout.sell.balance.label')}: ₪{voucher!.balance}</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t('checkout.sell.price.label')}</label>
                <input
                  type="number"
                  inputMode="decimal"
                  value={sellPrice}
                  onChange={e => setSellPrice(e.target.value)}
                  placeholder={t('checkout.sell.price.placeholder')}
                  className="w-full border rounded-xl px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-green-400"
                  dir="ltr"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t('checkout.sell.desc.label')}</label>
                <textarea
                  value={sellDescription}
                  onChange={e => setSellDescription(e.target.value)}
                  placeholder={t('checkout.sell.desc.placeholder')}
                  className="w-full border rounded-xl px-4 py-3 text-sm resize-none h-20 focus:outline-none focus:ring-2 focus:ring-green-400"
                />
              </div>
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-700">
                {t('checkout.sell.notice')}
              </div>
            </div>
            {/* Footer — כפתור קבוע */}
            <div className="px-6 py-4 shrink-0 border-t border-gray-100">
              <button
                onClick={handleListForSale}
                disabled={sellLoading || !sellPrice}
                className="w-full py-3 bg-green-600 text-white rounded-2xl font-semibold disabled:opacity-50"
              >
                {sellLoading ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : t('checkout.sell.publish')}
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmArchive && (
        <ConfirmDialog
          title={t('checkout.archive.confirm.title')}
          message={t('checkout.archive.confirm.msg')}
          onConfirm={() => {
            setConfirmArchive(false)
            archiveVoucher(voucher.id).then(() => { toast.success(t('checkout.archived')); navigate(-1) })
          }}
          onCancel={() => setConfirmArchive(false)}
        />
      )}
      {confirmDelete && (
        <ConfirmDialog
          title={t('checkout.delete.confirm.title')}
          message={t('checkout.delete.confirm.msg')}
          onConfirm={async () => {
            setConfirmDelete(false)
            await deleteVoucher(voucher.id)
            toast.success(t('checkout.deleted'))
            navigate(-1)
          }}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
      {showEditForm && (
        <VoucherForm
          voucher={voucher}
          onSave={async (vData) => {
            await updateVoucher(voucher.id, vData)
            toast.success(t('checkout.voucher.updated'))
            setShowEditForm(false)
          }}
          onClose={() => setShowEditForm(false)}
        />
      )}
      {/* ── Gradient Hero Header ── */}
      <div style={{
        background: `linear-gradient(160deg, ${catColor}dd 0%, ${catColor}99 100%)`,
        padding: '0 20px 24px',
        position: 'relative',
        overflow: 'hidden',
      }}>
        {/* decorative circles */}
        <div style={{ position: 'absolute', top: -30, left: -30, width: 120, height: 120, borderRadius: '50%', background: 'rgba(255,255,255,0.06)', pointerEvents: 'none' }} />

        {/* top bar */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 0 20px' }}>
          <button onClick={() => navigate(-1)} style={{ width: 36, height: 36, borderRadius: 10, background: 'rgba(255,255,255,0.2)', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <ArrowRight className="w-5 h-5" style={{ color: '#fff' }} />
          </button>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#fff' }}>{sv?.name || voucher.store_name}</div>
          <div style={{ display: 'flex', gap: 6 }}>
            {!isSharedVoucher && !isArchived && (
              <button onClick={() => setShowEditForm(true)} style={{ width: 36, height: 36, borderRadius: 10, background: 'rgba(255,255,255,0.2)', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Edit2 className="w-4 h-4" style={{ color: '#fff' }} />
              </button>
            )}
            {!isSharedVoucher && !isArchived && !voucher.is_locked && (
              <button onClick={() => setShowSellModal(true)} style={{ width: 36, height: 36, borderRadius: 10, background: 'rgba(255,255,255,0.2)', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <ShoppingBag className="w-4 h-4" style={{ color: '#fff' }} />
              </button>
            )}
            {!isArchived && (
              <button onClick={() => setConfirmArchive(true)} style={{ width: 36, height: 36, borderRadius: 10, background: 'rgba(255,255,255,0.2)', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Archive className="w-4 h-4" style={{ color: '#fff' }} />
              </button>
            )}
            {!isSharedVoucher && (
              <button onClick={() => setConfirmDelete(true)} style={{ width: 36, height: 36, borderRadius: 10, background: 'rgba(255,255,255,0.2)', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Trash2 className="w-4 h-4" style={{ color: 'rgba(255,100,100,0.9)' }} />
              </button>
            )}
          </div>
        </div>

        {/* Store avatar + balance */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{ width: 64, height: 64, borderRadius: 18, background: 'rgba(255,255,255,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28, fontWeight: 900, color: '#fff', flexShrink: 0 }}>
            {(sv?.name || voucher.store_name).charAt(0)}
          </div>
          <div>
            <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.75)', marginBottom: 3, fontWeight: 500 }}>{t('checkout.current.balance')}</div>
            <div style={{ fontSize: 36, fontWeight: 900, color: '#fff', letterSpacing: '-1px', lineHeight: 1 }}>
              {formatCurrency(voucher.balance)}
            </div>
            {voucher.amount > 0 && voucher.amount !== voucher.balance && (
              <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)', marginTop: 4 }}>
                {t('checkout.original.of')} {formatCurrency(voucher.amount)} {t('checkout.original.label')}
              </div>
            )}
            {sv && <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.7)', marginTop: 2 }}>{voucher.store_name}</div>}
          </div>
        </div>
      </div>

      {/* Lock banner */}
      {voucher.is_locked && (
        <div style={{ background: 'var(--c-gold-light)', borderBottom: '1px solid #f6d680', padding: '10px 20px', display: 'flex', alignItems: 'center', gap: 8 }}>
          <Lock className="w-4 h-4" style={{ color: 'var(--c-gold)', flexShrink: 0 }} />
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--c-gold)' }}>
            {voucher.lock_reason === 'for_sale' ? t('checkout.lock.banner.for.sale') : `${t('checkout.lock.banner.locked')}: ${voucher.lock_reason}`}
          </span>
        </div>
      )}

      <div className="p-4 space-y-4 pb-32">
        {/* Offline warning for shared */}
        {!isOnline && voucher.is_shared && (
          <div className="bg-orange-50 border border-orange-200 rounded-2xl p-3 flex items-center gap-2 text-sm text-orange-700">
            <AlertTriangle className="w-4 h-4 flex-shrink-0" />
            {t('checkout.offline.shared')}
          </div>
        )}

        {/* Notes */}
        {voucher.notes && (
          <div className="bg-blue-50 border border-blue-100 rounded-2xl p-3 text-sm text-gray-700">
            {voucher.notes}
          </div>
        )}

        {/* Barcode / QR */}
        <div className="text-center overflow-hidden" style={{ background: 'var(--c-surface)', borderRadius: 'var(--r-card)', boxShadow: 'var(--shadow-card)', padding: 20 }}>
          {/* E2EE locked state */}
          {voucher.is_e2ee && !isVaultUnlocked && (
            <div className="py-6">
              <Shield className="w-10 h-10 text-indigo-400 mx-auto mb-3" />
              <p className="text-sm font-semibold text-gray-700 mb-1">{t('checkout.e2ee.encrypted.label')}</p>
              {hint
                ? <p className="text-xs text-indigo-500 mb-1 flex items-center gap-1"><Lightbulb className="w-3.5 h-3.5" /> {t('checkout.e2ee.hint.label')}: <span className="font-medium">{hint}</span></p>
                : <p className="text-xs text-gray-400 mb-1">{t('checkout.e2ee.enter.passphrase')}</p>
              }
              {!showVaultUnlock ? (
                <button
                  onClick={() => setShowVaultUnlock(true)}
                  className="px-5 py-2 bg-indigo-600 text-white rounded-xl text-sm font-medium"
                >
                  {t('checkout.e2ee.open.vault')}
                </button>
              ) : (
                <form
                  className="max-w-xs mx-auto space-y-2"
                  onSubmit={async e => {
                    e.preventDefault()
                    setVaultUnlocking(true); setVaultError('')
                    const ok = await unlockVault(vaultPassInput)
                    setVaultUnlocking(false)
                    if (!ok) setVaultError(t('checkout.e2ee.wrong.password'))
                    else { setShowVaultUnlock(false); setVaultPassInput('') }
                  }}
                >
                  <input
                    type="password"
                    value={vaultPassInput}
                    onChange={e => setVaultPassInput(e.target.value)}
                    placeholder={t('checkout.e2ee.passphrase.placeholder')}
                    className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
                    dir="ltr"
                    autoFocus
                    autoComplete="current-password"
                    name="vault-password"
                  />
                  {vaultError && <p className="text-xs text-red-500">{vaultError}</p>}
                  <div className="flex gap-2">
                    <button
                      type="submit"
                      disabled={vaultUnlocking || !vaultPassInput}
                      className="flex-1 py-2 bg-indigo-600 text-white rounded-xl text-sm font-semibold disabled:opacity-50"
                    >
                      {vaultUnlocking ? '...' : t('checkout.e2ee.open')}
                    </button>
                    <button
                      type="button"
                      onClick={() => { setShowVaultUnlock(false); setVaultPassInput(''); setVaultError('') }}
                      className="flex-1 py-2 bg-gray-100 text-gray-600 rounded-xl text-sm"
                    >
                      {t('checkout.cancel')}
                    </button>
                  </div>
                </form>
              )}
            </div>
          )}

          {/* Normal code display (unlocked or non-E2EE) */}
          {(!voucher.is_e2ee || isVaultUnlocked) && (
            <>
          <div className="w-full overflow-hidden flex items-center justify-center mb-4">
            {isAlpha ? (
              <canvas ref={qrRef} className="rounded-xl" />
            ) : (
              <svg ref={barcodeRef} style={{ width: '100%', height: 'auto' }} />
            )}
          </div>
          <div className="font-mono text-lg font-bold tracking-widest text-gray-800 mb-3 break-all flex items-center justify-center gap-2">
            {effectiveCode ?? voucher.code}
            {voucher.is_e2ee && isVaultUnlocked && (
              <button onClick={lockVault} title={t('checkout.e2ee.lock.vault.title')} className="text-indigo-300 hover:text-indigo-500 ml-1">
                <Shield className="w-4 h-4" />
              </button>
            )}
          </div>
            </>
          )}

          <div className="flex items-center justify-center flex-wrap gap-2">
            <button
              onClick={copyCode}
              disabled={!!(voucher?.is_e2ee && !isVaultUnlocked)}
              title={voucher?.is_e2ee && !isVaultUnlocked ? t('checkout.copy.vault.locked.title') : undefined}
              className={`flex items-center gap-2 px-5 py-2.5 rounded-2xl text-sm font-medium transition-all ${
                voucher?.is_e2ee && !isVaultUnlocked
                  ? 'bg-gray-100 text-gray-400 cursor-not-allowed opacity-50'
                  : copied ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
              {copied ? t('checkout.copied') : t('checkout.copy.code')}
            </button>

            {isSafeUrl(voucher.link) && (
              <a
                href={voucher.link}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 px-5 py-2.5 rounded-2xl text-sm font-medium bg-blue-50 text-blue-600 hover:bg-blue-100"
              >
                <ExternalLink className="w-4 h-4" />
                {t('checkout.open.link')}
              </a>
            )}

            {!isArchived && (
              <button
                onClick={openShareModal}
                className="flex items-center gap-2 px-5 py-2.5 rounded-2xl text-sm font-medium bg-purple-50 text-purple-600 hover:bg-purple-100"
              >
                <Share2 className="w-4 h-4" />
                {t('checkout.share')}
              </button>
            )}

          </div>
        </div>

        {/* CVV */}
        {voucher.cvv && (
          <div className="bg-yellow-50 border border-yellow-200 rounded-2xl p-4 flex items-center justify-between">
            <span className="text-sm font-medium text-yellow-800">{t('checkout.cvv.label')}</span>
            {voucher.is_e2ee && !isVaultUnlocked ? (
              <span className="text-xs text-indigo-400 flex items-center gap-1">
                <Shield className="w-3.5 h-3.5" /> {t('checkout.e2ee.encrypted')}
              </span>
            ) : (
              <div className="flex items-center gap-2">
                <span className="font-mono font-bold text-yellow-900 text-lg">
                  {(() => {
                    const display = voucher.is_e2ee ? (plainCvv ?? voucher.cvv) : voucher.cvv
                    return showCvv ? display : '•'.repeat(display?.length ?? 4)
                  })()}
                </span>
                <button onClick={() => setShowCvv(!showCvv)} className="text-yellow-600">
                  {showCvv ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            )}
          </div>
        )}

        {/* Balance Card */}
        <div style={{ background: 'var(--c-surface)', borderRadius: 'var(--r-card)', boxShadow: 'var(--shadow-card)', padding: 20 }}>
          <div className="flex items-center justify-between mb-4">
            <span className="text-sm text-gray-500">{t('checkout.current.balance')}</span>
            <div className="text-right">
              <div className="text-3xl font-bold text-gray-900">{formatCurrency(voucher.balance)}</div>
              {profile?.show_voucher_value && voucher.value_percent != null && voucher.value_percent > 0 && voucher.value_percent < 100 && (
                <div className="text-xs text-gray-400 mt-0.5">{t('checkout.value.label')} {voucher.value_percent.toFixed(0)}%{voucher.actual_cost != null ? ` | ${t('checkout.cost.label')} ${voucher.actual_cost.toLocaleString('he-IL')} ₪` : ''}</div>
              )}
            </div>
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
              {voucher.expiry_date && expiryStatus !== 'ok' && <span className="text-xs text-gray-400">({formatDate(voucher.expiry_date)})</span>}
            </div>
          )}

          {/* Quick amounts */}
          {!isArchived && (
            <>
              <div className="text-xs font-medium text-gray-500 mb-2">{t('checkout.quick.deduct.label')}</div>

              {/* Shared store input for all balance updates */}
              <input
                type="text"
                value={customStore}
                onChange={e => setCustomStore(e.target.value)}
                placeholder={t('checkout.store.used.placeholder')}
                className="w-full px-3 py-2 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-green-300 text-sm mb-3"
                dir="rtl"
              />

              <div className="grid grid-cols-4 gap-2 mb-3">
                {QUICK_AMOUNTS.map(amt => (
                  <button
                    key={amt}
                    onClick={() => {
                      updateBalance(voucher.balance - amt, amt, customStore.trim() || null)
                      setCustomStore('')
                    }}
                    disabled={voucher.balance < amt}
                    className="py-2 bg-gray-100 text-gray-700 rounded-xl text-sm font-medium hover:bg-gray-200 disabled:opacity-40 transition-all"
                  >
                    -{amt}
                  </button>
                ))}
                <button
                  onClick={() => {
                    const half = voucher.balance / 2
                    updateBalance(half, half, customStore.trim() || null)
                    setCustomStore('')
                  }}
                  className="py-2 bg-gray-100 text-gray-700 rounded-xl text-sm font-medium hover:bg-gray-200 transition-all"
                >
                  {t('checkout.half')}
                </button>
                <button
                  onClick={() => {
                    updateBalance(0, voucher.balance, customStore.trim() || null)
                    setCustomStore('')
                  }}
                  className="py-2 bg-red-50 text-red-600 rounded-xl text-sm font-medium hover:bg-red-100 transition-all"
                >
                  {t('checkout.full')}
                </button>
              </div>

              <div>
                <p className="text-xs font-medium text-gray-500 mb-1.5">{t('checkout.usage.amount')}</p>
                <div className="flex gap-2 mb-2">
                  <input
                    type="number"
                    inputMode="decimal"
                    value={customAmount}
                    onChange={e => setCustomAmount(e.target.value)}
                    placeholder={t('checkout.usage.amount.placeholder')}
                    className="flex-1 min-w-0 px-3 py-2 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-green-300"
                    style={{ fontSize: '16px' }}
                    dir="ltr"
                  />
                  <button
                    onClick={() => {
                      const amount = parseFloat(customAmount)
                      if (!isNaN(amount) && amount > 0) {
                        updateBalance(voucher.balance - amount, amount, customStore.trim() || null)
                        setCustomAmount('')
                        setCustomStore('')
                      }
                    }}
                    disabled={!customAmount || isNaN(parseFloat(customAmount)) || parseFloat(customAmount) <= 0}
                    className="shrink-0 px-3 py-2 bg-green-500 text-white rounded-xl text-sm font-medium disabled:opacity-40 hover:bg-green-600 transition-all"
                  >
                    {t('checkout.update')}
                  </button>
                </div>
                {(() => {
                  const amount = parseFloat(customAmount)
                  if (isNaN(amount) || amount <= 0) return null
                  const newBal = Math.max(0, voucher.balance - amount)
                  return (
                    <p className={`text-xs mt-1.5 font-medium ${newBal <= 0 ? 'text-red-500' : 'text-green-600'}`}>
                      {t('checkout.new.balance.preview')}: ₪{newBal.toLocaleString('he-IL')}
                    </p>
                  )
                })()}
              </div>

            </>
          )}
        </div>

        {/* Super voucher stores */}
        {sv && (sv.stores.length > 0 || sv.balance_check_url) && (
          <div className="bg-white rounded-3xl shadow-sm p-4">
            <div className="flex items-center justify-between">
              <button
                onClick={() => setShowStores(s => !s)}
                className="flex items-center gap-1.5 text-sm font-semibold text-gray-700"
              >
                <Star className="w-4 h-4 text-amber-400 fill-amber-400" />
                {t('checkout.super.stores.label')} {sv.name}
                {showStores ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
              </button>
              {isSafeUrl(sv.balance_check_url) && (
                <a
                  href={sv.balance_check_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-blue-50 text-blue-600 rounded-xl font-medium hover:bg-blue-100"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  {t('checkout.check.balance')}
                </a>
              )}
            </div>
            {showStores && sv.stores.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-3">
                {sv.stores.map((s, i) => (
                  <span key={i} className="text-xs bg-amber-50 text-amber-700 px-3 py-1 rounded-full border border-amber-200">
                    {s}
                  </span>
                ))}
              </div>
            )}
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
            {t('checkout.activity.title')}
          </h3>
          {logLoading ? (
            <div className="flex justify-center py-4">
              <div className="w-5 h-5 border-2 border-gray-200 border-t-gray-400 rounded-full animate-spin" />
            </div>
          ) : voucherLog.length === 0 ? (
            <p className="text-xs text-gray-400 text-center py-2">{t('checkout.activity.empty')}</p>
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
                      label = t('checkout.log.added')
                      if (entry.details?.amount != null)
                        detail = `${t('checkout.log.amount')}: ₪${Number(entry.details.amount).toLocaleString('he-IL')}`
                      break
                    case 'balance_update':
                      icon = <MinusCircle className="w-3.5 h-3.5" />
                      dotColor = 'bg-blue-500 text-white'
                      label = t('checkout.log.balance.update')
                      if (entry.details?.from != null && entry.details?.to != null) {
                        detail = `₪${Number(entry.details.from).toLocaleString('he-IL')} ← ₪${Number(entry.details.to).toLocaleString('he-IL')}`
                        if (entry.details?.store_used) detail += ` · ${entry.details.store_used}`
                      }
                      break
                    case 'edit':
                      icon = <Pencil className="w-3.5 h-3.5" />
                      dotColor = 'bg-indigo-500 text-white'
                      label = t('checkout.log.edited')
                      break
                    case 'archive':
                      icon = <PackageCheck className="w-3.5 h-3.5" />
                      dotColor = 'bg-orange-400 text-white'
                      label = t('checkout.log.archived')
                      if (entry.details?.balance != null)
                        detail = `${t('checkout.log.balance.detail')}: ₪${Number(entry.details.balance).toLocaleString('he-IL')}`
                      break
                    case 'unarchive':
                      icon = <Undo2 className="w-3.5 h-3.5" />
                      dotColor = 'bg-teal-500 text-white'
                      label = t('checkout.log.unarchived')
                      break
                    case 'gift_sent':
                      icon = <Mail className="w-3.5 h-3.5" />
                      dotColor = 'bg-pink-500 text-white'
                      label = t('checkout.log.gift.sent')
                      if (entry.details?.recipient) detail = `${t('checkout.log.to')}: ${entry.details.recipient}`
                      break
                    case 'gift_link':
                      icon = <Link2 className="w-3.5 h-3.5" />
                      dotColor = 'bg-pink-400 text-white'
                      label = t('checkout.log.gift.link')
                      break
                    case 'gift_received':
                      icon = <Gift className="w-3.5 h-3.5" />
                      dotColor = 'bg-rose-500 text-white'
                      label = t('checkout.log.gift.received')
                      if (entry.details?.sender) detail = `${t('checkout.log.from')}: ${entry.details.sender}`
                      break
                    case 'gift_balance_update':
                      icon = <MinusCircle className="w-3.5 h-3.5" />
                      dotColor = 'bg-pink-600 text-white'
                      label = t('checkout.log.gift.balance.update')
                      if (entry.details?.from != null && entry.details?.to != null) {
                        detail = `₪${Number(entry.details.from).toLocaleString('he-IL')} ← ₪${Number(entry.details.to).toLocaleString('he-IL')}`
                        if (entry.details?.store_used) detail += ` · ${entry.details.store_used}`
                      }
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
          <div className="bg-white w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl p-5 animate-slide-up max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-bold text-gray-800">{t('checkout.share.modal.title')}</h3>
              <button onClick={() => setShowShareModal(false)} className="p-2 rounded-full hover:bg-gray-100">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Tabs */}
            {!isSharedVoucher && (
              <div className="flex gap-1 bg-gray-100 rounded-2xl p-1 mb-4">
                <button
                  onClick={() => setShareTab('link')}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-medium transition-all ${shareTab === 'link' ? 'bg-white text-purple-700 shadow-sm' : 'text-gray-500'}`}
                >
                  <Link2 className="w-3.5 h-3.5" /> {t('checkout.share.tab.link')}
                </button>
                <button
                  onClick={() => setShareTab('user')}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-medium transition-all ${shareTab === 'user' ? 'bg-white text-purple-700 shadow-sm' : 'text-gray-500'}`}
                >
                  <Users className="w-3.5 h-3.5" /> {t('checkout.share.tab.user')}
                </button>
                <button
                  onClick={() => { setShareTab('gift'); loadPendingGifts() }}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-medium transition-all ${shareTab === 'gift' ? 'bg-white text-green-700 shadow-sm' : 'text-gray-500'}`}
                >
                  <Gift className="w-3.5 h-3.5" /> {t('checkout.share.tab.gift')}
                </button>
              </div>
            )}

            {/* ── Link tab ── */}
            {shareTab === 'link' && (
              <>
                <p className="text-sm text-gray-500 mb-3">
                  {t('checkout.share.link.desc')}
                </p>
                {voucher.is_e2ee && (
                  <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-xl p-3 mb-3 text-xs text-amber-800">
                    <Shield className="w-4 h-4 flex-shrink-0 mt-0.5 text-amber-500" />
                    <span>{t('checkout.share.e2ee.warning')}</span>
                  </div>
                )}

                <div className="grid grid-cols-3 gap-2 mb-4">
                  {[
                    { label: t('checkout.share.link.1day'), days: 1 },
                    { label: t('checkout.share.link.1week'), days: 7 },
                    { label: t('checkout.share.link.unlimited'), days: undefined },
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

                {shareTokens.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs font-medium text-gray-500">{t('checkout.share.active.links')}:</p>
                    {shareTokens.map(tok => {
                      const url = `${window.location.origin}/s/${tok.token}`
                      const expired = tok.expires_at && new Date(tok.expires_at) < new Date()
                      return (
                        <div key={tok.token} className={`flex items-center gap-2 p-3 rounded-2xl border ${expired ? 'bg-gray-50 border-gray-100 opacity-60' : 'bg-white border-gray-200'}`}>
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-mono text-gray-600 truncate">{url}</p>
                            <p className="text-xs text-gray-400 mt-0.5">
                              {expired ? `⛔ ${t('checkout.share.link.expired')}` : tok.expires_at ? `${t('checkout.share.link.until')} ${new Date(tok.expires_at).toLocaleDateString('he-IL')}` : t('checkout.share.link.no.limit')}
                              {' · '}{tok.view_count} {t('checkout.share.link.views')}
                            </p>
                          </div>
                          <button
                            onClick={async () => { await navigator.clipboard.writeText(url); toast.success(t('checkout.copied')) }}
                            className="p-2 text-purple-500 hover:bg-purple-50 rounded-lg"
                          >
                            <Copy className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => handleDeleteShareToken(tok.token)}
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
              </>
            )}

            {/* ── User tab ── */}
            {shareTab === 'user' && !isSharedVoucher && (
              <div className="space-y-4">
                <p className="text-sm text-gray-500">
                  {t('checkout.share.user.desc')}
                </p>

                {/* "User not found" confirm */}
                {pendingShareEmail && (
                  <div className="bg-orange-50 rounded-2xl p-3 space-y-2">
                    <p className="text-sm text-orange-700">
                      {t('checkout.share.user.not.found.prefix')} <strong>{pendingShareEmail}</strong> {t('checkout.share.user.not.found.suffix')}
                    </p>
                    <div className="flex gap-2">
                      <button
                        onClick={handleSendVoucherInvite}
                        className="flex-1 bg-orange-500 text-white py-2 rounded-xl text-sm font-medium"
                      >
                        {t('checkout.share.send.invite')}
                      </button>
                      <button
                        onClick={() => { setPendingShareEmail(null); setShareEmail('') }}
                        className="flex-1 bg-gray-100 text-gray-600 py-2 rounded-xl text-sm font-medium"
                      >
                        {t('checkout.cancel')}
                      </button>
                    </div>
                  </div>
                )}

                {!pendingShareEmail && (
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <UserPlus className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                      <input
                        type="email"
                        value={shareEmail}
                        onChange={e => setShareEmail(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && handleShareWithUser()}
                        placeholder={t('checkout.share.email.placeholder')}
                        className="w-full pr-9 pl-3 py-2.5 border border-gray-200 rounded-xl text-base focus:outline-none focus:ring-2 focus:ring-purple-300"
                        dir="ltr"
                      />
                    </div>
                    <button
                      onClick={handleShareWithUser}
                      disabled={shareEmailLoading || !shareEmail.trim()}
                      className="px-4 py-2.5 bg-purple-600 text-white rounded-xl text-sm font-medium disabled:opacity-50"
                    >
                      {shareEmailLoading
                        ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        : t('checkout.share')}
                    </button>
                  </div>
                )}

                {/* Existing user shares */}
                {sharesLoaded && voucherShares.length > 0 && (
                  <div className="space-y-1">
                    <p className="text-xs font-medium text-gray-500">{t('checkout.share.shared.with')}:</p>
                    {voucherShares.map(s => (
                      <div key={s.id} className="flex items-center justify-between py-2 border-b last:border-0">
                        <p className="text-sm text-gray-700">{s.shared_with_email}</p>
                        <button
                          onClick={() => handleUnshare(s.shared_with_email)}
                          className="p-1.5 text-red-400 hover:bg-red-50 rounded-lg"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* ── Gift tab ── */}
            {shareTab === 'gift' && !isSharedVoucher && (
              <div className="space-y-4">
                <p className="text-sm text-gray-500">
                  {t('checkout.gift.desc')}
                </p>

                {/* Mode toggle */}
                <div className="flex bg-gray-100 rounded-2xl p-1">
                  <button
                    onClick={() => { setGiftMode('link'); setGiftLink(null) }}
                    className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-medium rounded-xl transition-all ${
                      giftMode === 'link' ? 'bg-white shadow text-green-600' : 'text-gray-500'
                    }`}
                  >
                    <LinkIcon className="w-3.5 h-3.5" />
                    {t('checkout.gift.create.link')}
                  </button>
                  <button
                    onClick={() => { setGiftMode('email'); setGiftLink(null) }}
                    className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-medium rounded-xl transition-all ${
                      giftMode === 'email' ? 'bg-white shadow text-green-600' : 'text-gray-500'
                    }`}
                  >
                    <Mail className="w-3.5 h-3.5" />
                    {t('checkout.gift.send.email')}
                  </button>
                </div>

                {/* Recipient email (email mode only) */}
                {giftMode === 'email' && (
                  <div className="relative">
                    <Mail className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                    <input
                      type="email"
                      value={giftEmail}
                      onChange={e => setGiftEmail(e.target.value)}
                      placeholder={t('checkout.gift.recipient.email')}
                      className="w-full pr-9 pl-3 py-2.5 border border-gray-200 rounded-xl text-base focus:outline-none focus:ring-2 focus:ring-green-300"
                      dir="ltr"
                    />
                  </div>
                )}

                {/* Personal message */}
                <textarea
                  value={giftMessage}
                  onChange={e => setGiftMessage(e.target.value)}
                  placeholder={t('checkout.gift.message.placeholder')}
                  rows={2}
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-green-300 resize-none"
                  dir="rtl"
                />

                {/* Schedule toggle (email mode only) */}
                {giftMode === 'email' && (
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setGiftScheduled(s => !s)}
                      className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-medium transition-all border ${
                        giftScheduled ? 'bg-green-50 border-green-300 text-green-700' : 'bg-gray-50 border-gray-200 text-gray-500'
                      }`}
                    >
                      <Calendar className="w-3.5 h-3.5" />
                      {t('checkout.gift.schedule')}
                    </button>
                  </div>
                )}

                {giftMode === 'email' && giftScheduled && (
                  <input
                    type="datetime-local"
                    value={giftDate}
                    onChange={e => setGiftDate(e.target.value)}
                    min={new Date().toISOString().slice(0, 16)}
                    className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-green-300"
                    dir="ltr"
                  />
                )}

                {/* Action button */}
                <button
                  onClick={handleSendGift}
                  disabled={giftSending || (giftMode === 'email' && (!giftEmail.trim() || (giftScheduled && !giftDate)))}
                  className="w-full flex items-center justify-center gap-2 py-3 bg-gradient-to-r from-green-500 to-emerald-600 text-white rounded-2xl font-bold text-sm disabled:opacity-50 shadow hover:shadow-md active:scale-95 transition-all"
                >
                  {giftSending
                    ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    : giftMode === 'link' ? <LinkIcon className="w-4 h-4" /> : <Gift className="w-4 h-4" />
                  }
                  {giftSending ? t('checkout.gift.creating') : giftMode === 'link' ? t('checkout.gift.create.link.btn') : giftScheduled && giftDate ? t('checkout.gift.schedule.btn') : t('checkout.gift.send.now')}
                </button>

                {/* Created link display */}
                {giftLink && (
                  <div className="bg-green-50 border border-green-200 rounded-2xl p-3 space-y-2">
                    <p className="text-xs font-medium text-green-700 flex items-center gap-1"><Gift className="w-3.5 h-3.5" /> {t('checkout.gift.link.label')}:</p>
                    <div className="flex items-center gap-2">
                      <p className="text-xs text-green-800 font-mono break-all flex-1">{giftLink}</p>
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(giftLink).catch(() => {})
                          toast.success(t('checkout.copied'))
                        }}
                        className="flex-shrink-0 p-2 bg-green-100 hover:bg-green-200 rounded-xl transition-colors"
                      >
                        <Copy className="w-4 h-4 text-green-700" />
                      </button>
                    </div>
                  </div>
                )}

                {/* Pending gifts list */}
                {giftsLoaded && pendingGifts.length > 0 && (
                  <div className="space-y-1 border-t pt-3">
                    <p className="text-xs font-medium text-gray-500">{t('checkout.gift.pending.label')}:</p>
                    {pendingGifts.map(g => (
                      <div key={g.id} className="flex items-center justify-between py-2 border-b last:border-0">
                        <div>
                          <p className="text-sm text-gray-700">
                            {g.recipient_email || <span className="text-gray-400 italic">{t('checkout.gift.link.only')}</span>}
                          </p>
                          <p className="text-xs text-gray-400">
                            {g.email_sent_at ? t('checkout.gift.sent.label') : `${t('checkout.gift.scheduled.label')}: ${new Date(g.send_at).toLocaleDateString('he-IL')}`}
                          </p>
                        </div>
                        <button
                          onClick={() => handleCancelGift(g.id)}
                          className="p-1.5 text-red-400 hover:bg-red-50 rounded-lg"
                          title={t('checkout.gift.cancel.title')}
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
