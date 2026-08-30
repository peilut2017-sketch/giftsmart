import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { EASE_OUT } from '../lib/motion'
import { createPortal } from 'react-dom'
import { useParams, useNavigate } from 'react-router-dom'
import { useVouchers, type ActivityLogEntry, type VoucherShare, type PendingGift } from '../contexts/VoucherContext'
import { useAuth } from '../contexts/AuthContext'
import { useSubscription } from '../contexts/SubscriptionContext'
import { useMarketplace } from '../contexts/MarketplaceContext'
import { sendVoucherSharedEmail, sendVoucherShareInviteEmail, sendGiftEmail } from '../lib/emailService'
import { isAlphanumeric, formatCurrency, formatDate, getExpiryLabel, getExpiryStatus, getStoreInitials, getCategoryColor } from '../utils/helpers'
import { sendUsageNotification } from '../hooks/useNotifications'
import { useCountUp } from '../hooks/useCountUp'
import { supabase } from '../lib/supabase'
import JsBarcode from 'jsbarcode'
import QRCode from 'qrcode'
import VoucherForm from '../components/VoucherForm'
import toast from 'react-hot-toast'
import ConfirmDialog from '../components/ConfirmDialog'
import Icon from '../components/ui/Icon'
import Button from '../components/ui/Button'
import { useE2EE } from '../contexts/E2EEContext'
import { isEncryptedField } from '../lib/e2ee'
import { useT } from '../lib/i18n'

// Share/gift links use the canonical app domain (VITE_APP_URL) rather than
// window.location.origin — on a preview deploy the origin-based gift link failed
// the send-email domain allowlist and the email 400'd.
const APP_BASE = import.meta.env.VITE_APP_URL || window.location.origin

function isSafeUrl(url: string | undefined): boolean {
  if (!url) return false
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch { return false }
}

type TabKey = 'voucher' | 'use' | 'share' | 'sell' | 'activity'

function drawBarcode(el: SVGSVGElement | null, value: string, opts: { height: number; displayValue: boolean }) {
  if (!el) return
  try {
    JsBarcode(el, value, { format: 'CODE128', width: 2, height: opts.height, displayValue: opts.displayValue, fontSize: 14, margin: opts.displayValue ? 10 : 4 })
  } catch {}
}

function drawQr(el: HTMLCanvasElement | null, value: string, size: number) {
  if (!el) return
  QRCode.toCanvas(el, value, { width: size, margin: 1, color: { dark: '#1e293b', light: '#ffffff' } }).catch(() => {})
}

// Small inline spinner (Material Symbols has no animated spinner glyph)
function Spinner({ className = '' }: { className?: string }) {
  return <span className={`inline-block w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin ${className}`} />
}

function InfoRow({ label, value, onCopy, onOpen, extra, ltr }: { label: string; value: string; onCopy?: () => void; onOpen?: () => void; extra?: React.ReactNode; ltr?: boolean }) {
  if (!value) return null
  return (
    <div className="flex items-center justify-between gap-3 py-3 px-4">
      <div className="min-w-0">
        <div className="text-xs text-text3">{label}</div>
        <div className="text-sm font-medium text-text truncate" dir={ltr ? 'ltr' : undefined}>{value}</div>
      </div>
      <div className="flex items-center gap-1 flex-shrink-0">
        {extra}
        {onOpen && (
          <button onClick={onOpen} className="p-2 text-blue-500 hover:bg-blue-50 rounded-lg"><Icon name="open_in_new" size={16} /></button>
        )}
        {onCopy && (
          <button onClick={onCopy} className="p-2 text-text2 hover:bg-bg rounded-lg"><Icon name="content_copy" size={16} /></button>
        )}
      </div>
    </div>
  )
}

export default function CheckoutPage() {
  const { t, dir } = useT()
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { user, profile } = useAuth()
  const { vouchers, archivedVouchers, superVouchers, sharedWithMe, updateVoucher, deleteVoucher, archiveVoucher, isOnline, createShareToken, deleteShareToken, getShareTokens, shareVoucherWithUser, getVoucherShares, unshareVoucher, updateSharedVoucherBalance, getVoucherActivityLog, createGift, cancelGift, getPendingGifts, refreshVouchers } = useVouchers()
  const { limits, openUpgradeSheet } = useSubscription()
  const { listForSale, removeFromSale, canUseMarketplace } = useMarketplace()

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
  const codeImgRef = useRef<HTMLDivElement>(null)
  const miniBarcodeRef = useRef<SVGSVGElement>(null)
  const miniQrRef = useRef<HTMLCanvasElement>(null)
  const [barcodeVisible, setBarcodeVisible] = useState(true)
  const [showCvv, setShowCvv] = useState(false)
  const [customAmount, setCustomAmount] = useState('')
  const [customStore, setCustomStore] = useState('')
  const [copied, setCopied] = useState(false)
  const wakeLockRef = useRef<any>(null)
  const [confirmArchive, setConfirmArchive] = useState(false)
  // Generic confirmation for the destructive share/gift actions (unshare, delete
  // link, cancel gift) and for full redemption — all previously one silent tap
  const [confirmAction, setConfirmAction] = useState<{ title: string; message?: string; confirmLabel?: string; onConfirm: () => void } | null>(null)
  const [archiveReason, setArchiveReason] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [showEditForm, setShowEditForm] = useState(false)
  const [showMoreMenu, setShowMoreMenu] = useState(false)
  const [activeTab, setActiveTab] = useState<TabKey>('voucher')
  const [headerScrolled, setHeaderScrolled] = useState(false)
  const [shareTokens, setShareTokens] = useState<Array<{ token: string; expires_at: string | null; view_count: number; created_at: string }>>([])
  const [shareLoading, setShareLoading] = useState(false)
  const [shareTab, setShareTab] = useState<'link' | 'user' | 'gift' | null>(null)
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
  const [lockToggling, setLockToggling] = useState(false)
  // Sell state (now inline in the "מכירה" tab, not a sheet)
  const [sellPrice, setSellPrice] = useState('')
  const [sellDescription, setSellDescription] = useState('')
  const [sellLoading, setSellLoading] = useState(false)
  const [removingFromSale, setRemovingFromSale] = useState(false)

  const balanceRef = useCountUp<HTMLDivElement>(voucher?.balance ?? 0, v => formatCurrency(Math.round(v)))
  const reduceMotion = useReducedMotion()

  // Shared-voucher "share" tab has no accordion trigger to lazy-load its tokens —
  // load them when the tab opens. (Previously this was invoked as a side effect
  // inside render, firing state updates and RPCs during the render pass.)
  useEffect(() => {
    if (activeTab === 'share' && isSharedVoucher) openShareModal()
  }, [activeTab, isSharedVoucher]) // eslint-disable-line react-hooks/exhaustive-deps

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

  // Header background swap on scroll
  useEffect(() => {
    function onScroll() { setHeaderScrolled(window.scrollY > 40) }
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
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

  // Generate barcode or QR — the code itself is not a secret (only the CVV is), so the
  // barcode always prints its digits and the code text is always visible.
  useEffect(() => {
    if (!effectiveCode) return
    const isAlpha = isAlphanumeric(effectiveCode)
    if (isAlpha) drawQr(qrRef.current, effectiveCode, 220)
    else drawBarcode(barcodeRef.current, effectiveCode, { height: 80, displayValue: true })
  }, [effectiveCode, lockConfirmed])

  // Mini scan strip (pinned under the header once the real code scrolls out of view)
  useEffect(() => {
    const el = codeImgRef.current
    if (!el) return
    const observer = new IntersectionObserver(
      ([entry]) => setBarcodeVisible(entry.isIntersecting),
      { rootMargin: '-64px 0px 0px 0px', threshold: 0 },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!effectiveCode || barcodeVisible) return
    const isAlpha = isAlphanumeric(effectiveCode)
    if (isAlpha) drawQr(miniQrRef.current, effectiveCode, 56)
    else drawBarcode(miniBarcodeRef.current, effectiveCode, { height: 28, displayValue: false })
  }, [effectiveCode, barcodeVisible])

  function scrollToCard() {
    const el = codeImgRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    window.scrollTo({ top: window.scrollY + rect.top - 64 - 12, behavior: 'smooth' })
  }

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

  async function copyCvv() {
    if (!voucher) return
    if (voucher.is_e2ee && !isVaultUnlocked) {
      toast.error(t('checkout.copy.vault.locked'))
      return
    }
    const cvvToCopy = voucher.is_e2ee ? plainCvv : voucher.cvv
    if (!cvvToCopy) return
    await navigator.clipboard.writeText(cvvToCopy).catch(() => {})
    toast.success(t('checkout.code.copied'))
  }

  async function updateBalance(newBalance: number, usedAmount?: number, storeUsed?: string | null) {
    if (!voucher) return
    if (!isOnline && isSharedVoucher) {
      toast.error(t('checkout.offline'))
      return
    }
    const clamped = Math.max(0, newBalance)
    if (isSharedVoucher) {
      try {
        await updateSharedVoucherBalance(voucher.id, clamped, storeUsed)
      } catch {
        toast.error(t('checkout.list.error'))
        return
      }
    } else {
      // On failure the context rolls back the optimistic balance and shows its
      // own error toast — just stop here so no success toast appears.
      try {
        await updateVoucher(voucher.id, { balance: clamped }, storeUsed)
      } catch {
        return
      }
      if (!isOnline) {
        toast.success(t('checkout.balance.updated.offline'))
        if (clamped <= 0) openArchiveConfirm(true)
        const used = usedAmount ?? (voucher.balance - clamped)
        if (used > 0) sendUsageNotification(voucher.store_name, used, clamped, storeUsed ?? null, user?.id)
        return
      }
    }
    if (clamped <= 0) {
      toast.success(t('checkout.balance.zeroed'))
      openArchiveConfirm(true)
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
    // E2EE vouchers: require the vault open so the recipient gets the real code.
    // Same guard handleCreateShareLink already applies — without it the gift row
    // carries no plaintext and the recipient receives unusable ciphertext.
    if (voucher.is_e2ee && !isVaultUnlocked) {
      toast.error(t('checkout.share.vault.locked'))
      return
    }
    const sendAt = giftScheduled && giftDate ? new Date(giftDate) : new Date()
    setGiftSending(true)
    setGiftLink(null)
    try {
      const email = giftMode === 'email' ? giftEmail.trim() : null
      const codeOverride = voucher.is_e2ee && effectiveCode ? effectiveCode : undefined
      const token = await createGift(voucher.id, email, giftMessage.trim(), sendAt, codeOverride)
      if (!token) { toast.error(t('checkout.gift.create.error')); return }

      const link = `${APP_BASE}/gift/${token}`

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

  function handleCancelGift(giftId: string) {
    setConfirmAction({
      title: t('checkout.gift.cancel.confirm.title'),
      message: t('checkout.gift.cancel.confirm.msg'),
      onConfirm: async () => {
        setConfirmAction(null)
        await cancelGift(giftId)
        setPendingGifts(prev => prev.filter(g => g.id !== giftId))
        toast.success(t('checkout.gift.cancelled'))
      },
    })
  }

  function handleUnshare(email: string) {
    if (!voucher) return
    setConfirmAction({
      title: t('checkout.unshare.confirm.title'),
      message: t('checkout.unshare.confirm.msg', { email }),
      onConfirm: async () => {
        setConfirmAction(null)
        await unshareVoucher(voucher.id, email)
        setVoucherShares(prev => prev.filter(s => s.shared_with_email !== email))
        toast.success(t('checkout.unshared'))
      },
    })
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
      const url = `${APP_BASE}/s/${token}`
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

  function handleDeleteShareToken(token: string) {
    setConfirmAction({
      title: t('checkout.sharelink.delete.confirm.title'),
      message: t('checkout.sharelink.delete.confirm.msg'),
      onConfirm: async () => {
        setConfirmAction(null)
        await deleteShareToken(token)
        setShareTokens(prev => prev.filter(tk => tk.token !== token))
        toast.success(t('checkout.share.link.deleted'))
      },
    })
  }

  function openArchiveConfirm(isFullRedemption?: boolean) {
    const isZero = isFullRedemption ?? (voucher ? voucher.balance <= 0 : false)
    setArchiveReason(isZero ? t('archive.reason.full') : '')
    setConfirmArchive(true)
  }

  async function handleToggleLock() {
    if (!voucher) return
    setLockToggling(true)
    try {
      const nowLocked = !voucher.is_locked
      await updateVoucher(voucher.id, { is_locked: nowLocked, ...(nowLocked ? {} : { lock_reason: null }) } as any)
      toast.success(nowLocked ? t('checkout.locked.now') : t('checkout.unlocked.now'))
      setShowMoreMenu(false)
      await refreshVouchers()
    } catch {
      toast.error(t('checkout.list.error'))
    } finally {
      setLockToggling(false)
    }
  }

  async function handleListForSale() {
    // The tab is hidden when the marketplace is closed/unapproved, but guard the
    // action too — the mode can change while this screen is open
    if (!canUseMarketplace) { toast.error(t('market.closed.toast')); return }
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
      setSellPrice('')
      setSellDescription('')
      await refreshVouchers()
      setActiveTab('voucher')
    } catch (err: any) {
      const msg = err?.message || ''
      if (msg.includes('already_listed')) toast.error(t('checkout.sell.already.listed'))
      else if (msg.includes('marketplace_closed')) toast.error(t('market.closed.toast'))
      else toast.error(t('checkout.sell.error'))
    } finally {
      setSellLoading(false)
    }
  }

  if (!voucher) {
    return (
      <div className="flex-1 flex items-center justify-center bg-bg">
        <div className="text-center">
          <p className="text-text2">{t('checkout.not.found')}</p>
          <button onClick={() => navigate(-1)} className="mt-4 text-primary underline text-sm">{t('checkout.back')}</button>
        </div>
      </div>
    )
  }

  const isAlpha = isAlphanumeric(effectiveCode ?? voucher.code)
  const expiryStatus = getExpiryStatus(voucher.expiry_date)
  const expiryLabel = getExpiryLabel(voucher.expiry_date)
  const isArchived = archivedVouchers.some(v => v.id === id)
  const isExpired = expiryStatus === 'expired'
  const catColor = getCategoryColor(voucher.categories?.[0] || 'other')

  // Lock gate — show blocking overlay if voucher is locked and not yet confirmed
  if (voucher.is_locked && !lockConfirmed) {
    const isForSale = voucher.lock_reason === 'for_sale'

    return (
      <div className="flex-1 bg-bg flex flex-col">
        <div className="bg-surface border-b border-border sticky top-0 z-20">
          <div className="flex items-center gap-3 px-4 py-3">
            <button onClick={() => navigate(-1)} className="p-2 rounded-full hover:bg-bg">
              <Icon name="arrow_forward" size={22} color="var(--c-text)" />
            </button>
            <h1 className="font-bold text-text">{voucher.store_name}</h1>
          </div>
        </div>

        <div className="flex-1 flex items-center justify-center p-6">
          {isForSale ? (
            <div className="bg-surface rounded-[28px] shadow-card border border-blue-200 p-8 max-w-sm w-full text-center">
              <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <Icon name="sell" size={32} color="#3b82f6" />
              </div>
              <h2 className="text-xl font-bold text-text mb-2">{t('checkout.for.sale.title')}</h2>
              <p className="text-sm text-text2 mb-6">{t('checkout.for.sale.desc')}</p>
              <Button
                variant="danger" fullWidth loading={removingFromSale}
                onClick={async () => {
                  setRemovingFromSale(true)
                  try {
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
              >
                <Icon name="close" size={18} /> {t('checkout.remove.from.sale')}
              </Button>
              <button onClick={() => navigate('/market')} className="w-full mt-3 py-3 text-blue-500 text-sm font-medium">{t('checkout.go.to.market')}</button>
              <button onClick={() => navigate(-1)} className="w-full mt-1 py-3 text-text2 text-sm font-medium">{t('checkout.back')}</button>
            </div>
          ) : (
            <div className="bg-surface rounded-[28px] shadow-card border border-warning/30 p-8 max-w-sm w-full text-center">
              <div className="w-16 h-16 bg-warning/15 rounded-full flex items-center justify-center mx-auto mb-4">
                <Icon name="lock" size={32} color="var(--c-warning)" />
              </div>
              <h2 className="text-xl font-bold text-text mb-2">{t('checkout.locked.title')}</h2>
              {voucher.lock_reason ? (
                <div className="bg-warning/10 border border-warning/30 rounded-2xl p-4 mb-6 text-right">
                  <p className="text-xs text-warning font-medium mb-1">{t('checkout.lock.reason.label')}</p>
                  <p className="text-sm text-text font-medium">{voucher.lock_reason}</p>
                </div>
              ) : (
                <p className="text-sm text-text2 mb-6">{t('checkout.locked.desc')}</p>
              )}
              <p className="text-xs text-text3 mb-6">{t('checkout.locked.hint')}</p>
              <Button variant="primary" fullWidth onClick={() => setLockConfirmed(true)}>
                <Icon name="lock_open" size={18} /> {t('checkout.unlock.voucher')}
              </Button>
              <button onClick={() => navigate(-1)} className="w-full mt-3 py-3 text-text2 text-sm font-medium">{t('checkout.back')}</button>
            </div>
          )}
        </div>
      </div>
    )
  }

  // ── Status badges (max 2 shown) ──
  const badges: { icon: string; label: string }[] = []
  if (!isArchived) {
    if (isExpired) badges.push({ icon: 'event_busy', label: t('checkout.badge.expired') })
    else if (expiryStatus === 'critical' || expiryStatus === 'warning') badges.push({ icon: 'schedule', label: expiryLabel || t('checkout.badge.expiring') })
    else badges.push({ icon: 'check_circle', label: t('checkout.badge.active') })
  }
  if (voucher.is_locked) {
    badges.push(voucher.lock_reason === 'for_sale' ? { icon: 'sell', label: t('checkout.badge.for.sale') } : { icon: 'lock', label: t('checkout.badge.locked') })
  } else if (voucher.is_gift) {
    badges.push({ icon: 'redeem', label: t('checkout.badge.gift') })
  } else if (isSharedVoucher) {
    badges.push({ icon: 'group', label: t('checkout.badge.shared') })
  }
  const visibleBadges = badges.slice(0, 2)

  // ── Tabs (filtered by voucher state) ──
  const tabs: { key: TabKey; icon: string; label: string }[] = [
    { key: 'voucher', icon: 'confirmation_number', label: t('checkout.tab.voucher') },
    ...(!isArchived ? [{ key: 'use' as const, icon: 'shopping_bag', label: t('checkout.tab.use') }] : []),
    ...(!isArchived ? [{ key: 'share' as const, icon: 'ios_share', label: t('checkout.tab.share') }] : []),
    ...(!isSharedVoucher && !isArchived && !voucher.is_locked && canUseMarketplace ? [{ key: 'sell' as const, icon: 'sell', label: t('checkout.tab.sell') }] : []),
    { key: 'activity', icon: 'history', label: t('checkout.tab.activity') },
  ]
  const currentTab: TabKey = tabs.some(x => x.key === activeTab) ? activeTab : 'voucher'
  const tabIndex = Math.max(0, tabs.findIndex(x => x.key === currentTab))

  // ── Status strip (expiry | category — store name is already in the header, skip
  //     whatever's missing, no placeholders) ──
  const statusStripItems: { icon: string; label: string }[] = []
  if (expiryLabel) statusStripItems.push({ icon: 'event', label: expiryLabel })
  if (voucher.categories?.[0]) statusStripItems.push({ icon: 'folder', label: voucher.categories[0] })

  const noPaymentMethod = !(profile?.marketplace_payment_methods?.length)

  // ── Floating action — the one task-focused CTA for the active tab ──
  let fab: { label: string; icon: string; onClick: () => void; disabled?: boolean; loading?: boolean } | null = null
  if (currentTab === 'voucher' && !isArchived) {
    fab = { label: t('checkout.use.voucher'), icon: 'shopping_bag', onClick: () => setActiveTab('use') }
  } else if (currentTab === 'use') {
    // No amount typed → the button is "שימוש מלא" (burn the whole balance).
    // An amount typed → it becomes "עדכן יתרה" for a partial redemption.
    const amount = parseFloat(customAmount)
    const hasAmount = customAmount.trim() !== '' && !isNaN(amount) && amount > 0
    const valid = !hasAmount || amount <= voucher.balance
    fab = {
      label: hasAmount ? t('checkout.update.balance') : t('checkout.full'),
      icon: 'check_circle',
      disabled: !valid || voucher.balance <= 0,
      onClick: () => {
        if (!valid || voucher.balance <= 0) return
        const used = hasAmount ? amount : voucher.balance
        const commit = () => {
          updateBalance(voucher.balance - used, used, customStore.trim() || null)
          setCustomAmount(''); setCustomStore(''); setActiveTab('voucher')
        }
        if (!hasAmount) {
          // Full redemption zeroes the voucher — one FAB tap on an empty form used
          // to do it with no confirmation at all.
          setConfirmAction({
            title: t('checkout.full.confirm.title'),
            message: t('checkout.full.confirm.msg', { balance: voucher.balance.toLocaleString('he-IL') }),
            confirmLabel: t('checkout.full'),
            onConfirm: () => { setConfirmAction(null); commit() },
          })
        } else {
          commit()
        }
      },
    }
  } else if (currentTab === 'sell' && !noPaymentMethod) {
    fab = { label: t('checkout.sell.publish'), icon: 'sell', disabled: !sellPrice, loading: sellLoading, onClick: handleListForSale }
  }

  return (
    <div className="flex-1 bg-bg">
      {/* Confirm dialogs */}
      <AnimatePresence>
        {confirmAction && (
          <ConfirmDialog
            title={confirmAction.title}
            message={confirmAction.message}
            confirmLabel={confirmAction.confirmLabel}
            danger
            onConfirm={confirmAction.onConfirm}
            onCancel={() => setConfirmAction(null)}
          />
        )}
      </AnimatePresence>
      <AnimatePresence>
      {confirmArchive && (
        <ConfirmDialog
          title={t('checkout.archive.confirm.title')}
          onConfirm={() => {
            setConfirmArchive(false)
            archiveVoucher(voucher.id, archiveReason || undefined)
              .then(() => { toast.success(t('checkout.archived')); navigate(-1) })
              .catch(() => {}) // context already rolled back + toasted
          }}
          onCancel={() => { setConfirmArchive(false); setArchiveReason('') }}
        >
          <input
            type="text" value={archiveReason} onChange={e => setArchiveReason(e.target.value)}
            placeholder={t('archive.reason.placeholder')}
            className="w-full px-3 py-2.5 border border-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 mt-1 bg-surface text-text"
            dir="rtl"
          />
        </ConfirmDialog>
      )}
      </AnimatePresence>
      <AnimatePresence>
        {confirmDelete && (
          <ConfirmDialog
            title={t('checkout.delete.confirm.title')}
            message={t('checkout.delete.confirm.msg')}
            danger
            onConfirm={async () => {
              setConfirmDelete(false)
              try { await deleteVoucher(voucher.id) } catch { return } // context restored + toasted
              toast.success(t('checkout.deleted'))
              navigate(-1)
            }}
            onCancel={() => setConfirmDelete(false)}
          />
        )}
      </AnimatePresence>
      <AnimatePresence>
      {showEditForm && (
        <VoucherForm
          voucher={voucher}
          onSave={async (vData) => {
            // _storeUsed is a form-only field — it must be stripped from the row
            // update and passed as the storeUsed arg, or the usage store is lost
            // and a bogus _storeUsed column update is attempted.
            const { _storeUsed, ...voucherData } = vData
            await updateVoucher(voucher.id, voucherData, _storeUsed ?? null)
            toast.success(t('checkout.voucher.updated'))
            setShowEditForm(false)
          }}
          onClose={() => setShowEditForm(false)}
        />
      )}
      </AnimatePresence>

      {/* ── Header (transparent over Hero, solidifies on scroll) + Hero ──
          position:fixed, not sticky — the app's root layout (#root/main/AnimatedRoutes'
          motion.div all chain flex:1 with min-height:0) breaks position:sticky's
          containing-block resolution, so a sticky header here would just scroll away
          with the page instead of pinning. Fixed sidesteps that entirely. Hero needs no
          top margin to compensate since a fixed header takes no space in normal flow —
          its own 64px top padding (below) already keeps its content clear of the header.
          The header itself is portaled straight to <body> (see below) — AnimatedRoutes'
          route-transition wrapper keeps a `transform` on itself the whole time (not just
          mid-animation), which gives position:fixed descendants a containing block equal
          to THAT element instead of the real viewport, so without the portal this header
          visibly shrank/shifted during every transition into or out of this page instead
          of staying pinned. */}
      <>
        {createPortal(
          <>
          <div
            className={`fixed top-0 inset-x-0 z-30 flex items-center justify-between px-3 transition-colors duration-200 ${headerScrolled ? 'bg-surface/95 backdrop-blur-xl shadow-sm border-b border-border' : ''}`}
            style={{ height: 64 }}
          >
            <button onClick={() => navigate(-1)} className="w-9 h-9 rounded-xl flex items-center justify-center transition" style={!headerScrolled ? { background: 'rgba(255,255,255,0.22)' } : undefined}>
              <Icon name="arrow_forward" size={20} color={headerScrolled ? 'var(--c-text)' : '#fff'} />
            </button>
            <div className={`text-base font-bold truncate max-w-[55%] transition-colors ${headerScrolled ? 'text-text' : 'text-white'}`}>{sv?.name || voucher.store_name}</div>
            <button
              onClick={() => setShowMoreMenu(v => !v)}
              aria-label={t('checkout.menu.title')}
              aria-expanded={showMoreMenu}
              aria-haspopup="menu"
              className="w-9 h-9 rounded-xl flex items-center justify-center transition"
              style={!headerScrolled ? { background: 'rgba(255,255,255,0.22)' } : undefined}
            >
              <Icon name="more_horiz" size={22} color={headerScrolled ? 'var(--c-text)' : '#fff'} />
            </button>
          </div>

          {/* Anchored more-menu — drops down from the header dots. The previous
              bottom sheet opened behind the bottom nav and the redeem button. */}
          <AnimatePresence>
            {showMoreMenu && (
              <motion.div
                className="fixed inset-0 z-40"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0, transition: { duration: 0.12 } }}
                transition={{ duration: 0.15 }}
                onClick={() => setShowMoreMenu(false)}
              >
                <motion.div
                  role="menu"
                  className="absolute w-60 bg-surface rounded-2xl shadow-2xl border border-border overflow-hidden"
                  style={{ top: 58, left: 10, transformOrigin: 'top left' }}
                  initial={reduceMotion ? undefined : { scale: 0.95, opacity: 0 }}
                  animate={reduceMotion ? undefined : { scale: 1, opacity: 1 }}
                  exit={reduceMotion ? undefined : { scale: 0.95, opacity: 0, transition: { duration: 0.15, ease: EASE_OUT } }}
                  transition={{ duration: 0.2, ease: EASE_OUT }}
                  dir="rtl"
                  onClick={e => e.stopPropagation()}
                >
                  <div className="flex flex-col px-4">
                    {/* שיתוף/מכירה already have their own tab as the one entry point — listing them
                        here too was a third (and fourth) way into the same place. */}
                    {!isSharedVoucher && !isArchived && (
                      <MenuRow icon="edit" label={t('checkout.edit')} onClick={() => { setShowMoreMenu(false); setShowEditForm(true) }} />
                    )}
                    {voucher.is_e2ee && isVaultUnlocked && (
                      <MenuRow icon="shield" label={t('checkout.e2ee.lock.vault.title')} onClick={() => { setShowMoreMenu(false); lockVault() }} />
                    )}
                    {!isSharedVoucher && !isArchived && (
                      <MenuRow
                        icon={voucher.is_locked ? 'lock_open' : 'lock'}
                        label={voucher.is_locked ? t('checkout.menu.unlock') : t('checkout.menu.lock')}
                        onClick={handleToggleLock}
                        disabled={lockToggling}
                      />
                    )}
                    {!isArchived && (
                      <MenuRow icon="archive" label={t('checkout.archive')} onClick={() => { setShowMoreMenu(false); openArchiveConfirm() }} />
                    )}
                    {!isSharedVoucher && (
                      <MenuRow icon="delete" label={t('checkout.delete')} danger onClick={() => { setShowMoreMenu(false); setConfirmDelete(true) }} />
                    )}
                  </div>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>
          </>,
          document.body,
        )}

        <div style={{
          background: isExpired
            ? 'linear-gradient(160deg, #94a3b8dd 0%, #64748b99 100%)'
            : `linear-gradient(160deg, ${catColor}dd 0%, ${catColor}99 100%)`,
          padding: '64px 20px 28px', position: 'relative', overflow: 'hidden',
        }}>
          <div style={{ position: 'absolute', top: -30, left: -30, width: 120, height: 120, borderRadius: '50%', background: 'rgba(255,255,255,0.06)', pointerEvents: 'none' }} />

          {isArchived && (
            <div className="absolute top-4 flex items-center gap-1 text-[10px] font-bold text-white px-3 py-1 rounded-full" style={{ insetInlineEnd: 16, background: 'rgba(0,0,0,0.35)' }}>
              <Icon name="inventory_2" size={12} color="#fff" /> {t('checkout.badge.archived')}
            </div>
          )}

          <div className="flex items-center gap-4">
            <div className="w-16 h-16 rounded-[18px] flex items-center justify-center text-white flex-shrink-0" style={{ background: 'rgba(255,255,255,0.25)', fontSize: 24, fontWeight: 900 }}>
              {getStoreInitials(sv?.name || voucher.store_name)}
            </div>
            <div className="min-w-0">
              <div className="text-[13px] font-medium mb-0.5" style={{ color: 'rgba(255,255,255,0.75)' }}>{t('checkout.current.balance')}</div>
              <div ref={balanceRef} className="text-white font-black tabular-nums" style={{ fontSize: 44, letterSpacing: '-1px', lineHeight: 1 }}>{formatCurrency(Math.round(voucher.balance))}</div>
              {voucher.amount > 0 && voucher.amount !== voucher.balance && (
                <div className="text-xs mt-1.5" style={{ color: 'rgba(255,255,255,0.6)' }}>
                  {t('checkout.original.of')} {formatCurrency(voucher.amount)} {t('checkout.original.label')}
                </div>
              )}
              {sv && <div className="text-xs mt-0.5" style={{ color: 'rgba(255,255,255,0.7)' }}>{voucher.store_name}</div>}
            </div>
          </div>

          {voucher.amount > 0 && (
            <div className="mt-4">
              <div className="h-2 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.25)' }}>
                <div
                  className="h-full w-full rounded-full origin-right"
                  style={{ transform: `scaleX(${Math.min(100, (voucher.balance / voucher.amount) * 100) / 100})`, background: isExpired ? 'var(--c-error)' : '#fff', transition: 'transform 200ms var(--ease-out)' }}
                />
              </div>
            </div>
          )}

          {visibleBadges.length > 0 && (
            <div className="flex items-center gap-1.5 mt-3 flex-wrap">
              {visibleBadges.map((b, i) => (
                <span key={i} className="inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-full text-white" style={{ background: 'rgba(255,255,255,0.22)' }}>
                  <Icon name={b.icon} size={12} color="#fff" /> {b.label}
                </span>
              ))}
            </div>
          )}
        </div>
      </>

      {/* Lock state is already conveyed by the badge in the Hero above (and, in detail,
          by the gate screen the user passed through to get here) — no separate banner. */}

      {/* Mini scan strip — pinned just under the header once the real barcode/QR scrolls
          out of view, so the voucher stays scannable without scrolling back up. Portaled
          for the same reason as the header above. */}
      {!barcodeVisible && effectiveCode && (!voucher.is_e2ee || isVaultUnlocked) && createPortal(
        <button
          onClick={scrollToCard}
          aria-label={t('checkout.mini.scan.tap')}
          className="fixed inset-x-0 flex items-center justify-center bg-surface/95 backdrop-blur-xl border-b border-border shadow-sm"
          style={{ top: 64, height: 40, zIndex: 25 }}
        >
          {isAlpha ? <canvas ref={miniQrRef} /> : <svg ref={miniBarcodeRef} style={{ height: 28 }} />}
        </button>,
        document.body,
      )}

      <div className="p-4 space-y-4" style={{ paddingBottom: fab ? 'calc(var(--nav-h) + 92px)' : 'calc(var(--nav-h) + 24px)' }}>
        {/* Offline warning for shared */}
        {!isOnline && voucher.is_shared && (
          <div className="bg-warning/10 border border-warning/30 rounded-2xl p-3 flex items-center gap-2 text-sm text-warning">
            <Icon name="warning" size={16} /> {t('checkout.offline.shared')}
          </div>
        )}

        {/* ── Gift Card ── */}
        <div className="text-center overflow-hidden bg-surface rounded-[28px] shadow-card p-5">
          <div className="flex items-center justify-center gap-1.5 text-xs font-semibold text-text3 mb-4">
            <Icon name="redeem" size={14} /> {t('checkout.card.title')}
          </div>

          {voucher.is_e2ee && !isVaultUnlocked && (
            <div className="py-6">
              <Icon name="shield" size={40} color="#818cf8" />
              <p className="text-sm font-semibold text-text mt-3 mb-1">{t('checkout.e2ee.encrypted.label')}</p>
              {hint
                ? <p className="text-xs text-indigo-500 mb-1 flex items-center gap-1 justify-center"><Icon name="lightbulb" size={14} /> {t('checkout.e2ee.hint.label')}: <span className="font-medium">{hint}</span></p>
                : <p className="text-xs text-text3 mb-1">{t('checkout.e2ee.enter.passphrase')}</p>
              }
              {!showVaultUnlock ? (
                <button onClick={() => setShowVaultUnlock(true)} className="px-5 py-2 bg-indigo-600 text-white rounded-xl text-sm font-medium mt-2">
                  {t('checkout.e2ee.open.vault')}
                </button>
              ) : (
                <form
                  className="max-w-xs mx-auto space-y-2 mt-2"
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
                    type="password" value={vaultPassInput} onChange={e => setVaultPassInput(e.target.value)}
                    placeholder={t('checkout.e2ee.passphrase.placeholder')}
                    className="w-full px-4 py-2.5 border border-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300 bg-surface text-text"
                    dir="ltr" autoFocus autoComplete="current-password" name="vault-password"
                  />
                  {vaultError && <p className="text-xs text-error">{vaultError}</p>}
                  <div className="flex gap-2">
                    <button type="submit" disabled={vaultUnlocking || !vaultPassInput} className="flex-1 py-2 bg-indigo-600 text-white rounded-xl text-sm font-semibold disabled:opacity-50">
                      {vaultUnlocking ? '...' : t('checkout.e2ee.open')}
                    </button>
                    <button type="button" onClick={() => { setShowVaultUnlock(false); setVaultPassInput(''); setVaultError('') }} className="flex-1 py-2 bg-bg text-text2 rounded-xl text-sm">
                      {t('checkout.cancel')}
                    </button>
                  </div>
                </form>
              )}
            </div>
          )}

          {(!voucher.is_e2ee || isVaultUnlocked) && (
            <>
              {/* Tapping the code (image or, for QR, the text under it) copies it — no
                  separate "copy code" button needed. */}
              <button
                type="button"
                onClick={copyCode}
                title={t('checkout.tap.to.copy')}
                className="w-full active:opacity-70 transition-opacity"
              >
                <div ref={codeImgRef} className="w-full overflow-hidden flex items-center justify-center mb-4">
                  {isAlpha ? <canvas ref={qrRef} className="rounded-xl" /> : <svg ref={barcodeRef} style={{ width: '100%', height: 'auto' }} />}
                </div>
                {/* A CODE128 barcode already prints its own digits under the bars — showing
                    them again here would just duplicate that. Only QR codes (which never
                    print text themselves) need this line. */}
                {isAlpha && (
                  <span className="font-mono text-2xl font-bold tracking-widest text-text break-all" dir="ltr">
                    {effectiveCode ?? voucher.code}
                  </span>
                )}
              </button>

              <div className="mb-3 flex items-center justify-center gap-2">
                {copied ? (
                  <span className="text-xs font-medium text-primary flex items-center gap-1">
                    <Icon name="check" size={14} /> {t('checkout.copied')}
                  </span>
                ) : (
                  <span className="text-xs text-text3">{t('checkout.tap.to.copy')}</span>
                )}
                {/* Vault re-lock shortcut lives only while the vault is actually unlocked
                    and only where it's needed — here it was showing next to an already-
                    revealed code, i.e. always in this branch. Dropped; the vault icon now
                    only ever appears in its locked states (the "enter passphrase" panel
                    and the encrypted-CVV label below). */}
              </div>

              {voucher.cvv && (
                <div className="flex items-center justify-center gap-2 mb-3 text-sm">
                  <span className="text-text3">{t('checkout.cvv.label')}:</span>
                  {voucher.is_e2ee && !isVaultUnlocked ? (
                    <span className="text-xs text-indigo-400 flex items-center gap-1"><Icon name="shield" size={14} /> {t('checkout.e2ee.encrypted')}</span>
                  ) : (
                    <>
                      <span className="font-mono font-bold text-text" dir="ltr">
                        {(() => {
                          const display = voucher.is_e2ee ? (plainCvv ?? voucher.cvv) : voucher.cvv
                          return showCvv ? display : '•'.repeat(display?.length ?? 3)
                        })()}
                      </span>
                      <button onClick={() => setShowCvv(!showCvv)} aria-label={showCvv ? t('checkout.cvv.hide') : t('checkout.cvv.show')} className="text-text3 hover:text-text2 p-2.5 -m-1">
                        <Icon name={showCvv ? 'visibility_off' : 'visibility'} size={16} />
                      </button>
                      <button onClick={copyCvv} aria-label={t('checkout.cvv.copy')} className="text-text3 hover:text-text2 p-2.5 -m-1">
                        <Icon name="content_copy" size={16} />
                      </button>
                    </>
                  )}
                </div>
              )}
            </>
          )}

          {/* Tapping the code itself now copies it (see the button above) — this was a
              second, separate way to trigger the exact same action. */}
        </div>

        {/* Quick Actions grid was removed — it was the same 3 destinations (שימוש/שיתוף/
            מכירה) as the tab bar below, just styled differently. The tabs are now the one
            entry point; עריכה lives only in the "…" menu. */}

        {/* ── Status strip ── */}
        <div className="flex items-center justify-center gap-2.5 text-xs text-text2 flex-wrap px-1">
          {statusStripItems.map((it, i) => (
            <span key={i} className="flex items-center gap-2.5">
              {i > 0 && <span className="text-border">|</span>}
              <span className="flex items-center gap-1"><Icon name={it.icon} size={14} color="var(--c-text3)" />{it.label}</span>
            </span>
          ))}
        </div>

        {/* ── Segment tabs ── */}
        <div className="grid relative bg-bg rounded-2xl p-1" style={{ gridTemplateColumns: `repeat(${tabs.length}, 1fr)` }}>
          <div
            className="absolute rounded-xl bg-surface shadow-sm"
            style={{
              top: 4, bottom: 4,
              width: `calc(${100 / tabs.length}% - 4px)`,
              // Pinned at the inline-start edge; slides between slots with a
              // transform (one slot = own width + the 4px gap) instead of
              // animating left/right, which forced layout + shadow repaints.
              [dir === 'rtl' ? 'right' : 'left']: 2,
              transform: `translateX(calc(${dir === 'rtl' ? -tabIndex : tabIndex} * (100% + 4px)))`,
              transition: 'transform 200ms var(--ease-out)',
            }}
          />
          {tabs.map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`relative z-10 flex flex-col items-center justify-center gap-0.5 py-2 rounded-xl text-[11px] font-medium transition-colors active:scale-[0.97] ${currentTab === tab.key ? 'text-primary' : 'text-text3'}`}
              style={{ minHeight: 44 }}
            >
              <Icon name={tab.icon} size={18} filled={currentTab === tab.key} />
              {tab.label}
            </button>
          ))}
        </div>

        {/* ── Dynamic tab content ── */}
        {currentTab === 'voucher' && (
          <div className="space-y-4">
            {/* Code and CVV live only in the Gift Card above — repeating them here with
                their own copy/reveal controls just meant two controls for one value. */}
            <div className="bg-surface rounded-card shadow-card divide-y divide-border overflow-hidden">
              {isSafeUrl(voucher.link) && (
                <InfoRow label={t('checkout.link')} value={voucher.link!} onOpen={() => window.open(voucher.link, '_blank', 'noopener,noreferrer')} ltr />
              )}
              {voucher.categories?.length > 0 && (
                <InfoRow label={t('checkout.categories')} value={voucher.categories.join(', ')} />
              )}
              {voucher.source && <InfoRow label={t('checkout.source')} value={voucher.source} />}
              <InfoRow label={t('checkout.date.added')} value={formatDate(voucher.created_at)} />
            </div>

            {voucher.tags?.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {voucher.tags.map((tag, i) => (
                  <span key={i} className="text-xs bg-bg text-text2 px-3 py-1 rounded-full">#{tag}</span>
                ))}
              </div>
            )}

            {voucher.notes && (
              <div className="bg-blue-50 border border-blue-100 rounded-2xl p-3 text-sm text-text2">{voucher.notes}</div>
            )}

            {sv && (sv.stores.length > 0 || sv.balance_check_url) && (
              <div className="bg-surface rounded-card shadow-card p-4">
                <div className="flex items-center justify-between">
                  <button onClick={() => setShowStores(s => !s)} className="flex items-center gap-1.5 text-sm font-semibold text-text">
                    <Icon name="star" size={16} filled color="var(--c-gold)" />
                    {t('checkout.super.stores.label')} {sv.name}
                    <Icon name={showStores ? 'keyboard_arrow_up' : 'keyboard_arrow_down'} size={16} color="var(--c-text3)" />
                  </button>
                  {isSafeUrl(sv.balance_check_url) && (
                    <a href={sv.balance_check_url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-blue-50 text-blue-600 rounded-xl font-medium hover:bg-blue-100">
                      <Icon name="open_in_new" size={14} /> {t('checkout.check.balance')}
                    </a>
                  )}
                </div>
                {showStores && sv.stores.length > 0 && (
                  <div className="flex flex-wrap gap-2 mt-3">
                    {sv.stores.map((s, i) => (
                      <span key={i} className="text-xs bg-gold-light text-gold px-3 py-1 rounded-full border border-gold/30">{s}</span>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {currentTab === 'use' && (
          // Balance is already visible in the Hero above regardless of tab — no need to
          // repeat it here. Store comes before the amount (you know where you are before
          // you know how much you spent there); the only quick-deduct preset kept is
          // "מלא" — arbitrary presets like -50/-100/-200 rarely match a real voucher's
          // balance, "use it all" is the one that's reliably useful.
          <div className="bg-surface rounded-card shadow-card p-4 space-y-4">
            <div>
              <p className="text-xs font-medium text-text2 mb-1.5">{t('checkout.store.used.placeholder')}</p>
              <input
                type="text" value={customStore} onChange={e => setCustomStore(e.target.value)}
                placeholder={t('checkout.store.used.placeholder')}
                className="w-full px-3 py-2.5 border border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/30 text-sm bg-surface text-text"
                dir="rtl"
              />
            </div>

            <div>
              <p className="text-xs font-medium text-text2 mb-1.5">{t('checkout.usage.amount')}</p>
              <input
                type="number" inputMode="decimal" value={customAmount} onChange={e => setCustomAmount(e.target.value)}
                placeholder={t('checkout.usage.amount.placeholder')}
                className="w-full px-3 py-2.5 border border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/30 bg-surface text-text tabular-nums"
                style={{ fontSize: '16px' }} dir="ltr"
              />
              {(() => {
                const amount = parseFloat(customAmount)
                if (isNaN(amount) || amount <= 0) return null
                const newBal = Math.max(0, voucher.balance - amount)
                return <p className={`text-xs mt-2 font-medium ${newBal <= 0 ? 'text-error' : 'text-success'}`}>{t('checkout.new.balance.preview')}: {formatCurrency(newBal)}</p>
              })()}
              {!customAmount.trim() && (
                <p className="text-xs mt-2 text-text3">{t('checkout.full.hint')}</p>
              )}
            </div>
          </div>
        )}

        {currentTab === 'share' && !isSharedVoucher && (
          <div className="space-y-3">
            {voucher.is_e2ee && (
              <div className="flex items-start gap-2 bg-warning/10 border border-warning/30 rounded-xl p-3 text-xs text-warning">
                <Icon name="shield" size={16} /> <span>{t('checkout.share.e2ee.warning')}</span>
              </div>
            )}

            {/* Link card */}
            <div className="bg-surface rounded-card shadow-card p-4">
              <button onClick={() => { const next = shareTab === 'link' ? null : 'link'; setShareTab(next); if (next && shareTokens.length === 0 && !shareLoading) openShareModal() }} className="w-full flex items-center gap-3 text-right">
                <div className="w-10 h-10 rounded-xl bg-primary-light flex items-center justify-center flex-shrink-0"><Icon name="link" size={18} color="var(--c-primary-dark)" /></div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-text">{t('checkout.share.tab.link')}</div>
                  <div className="text-xs text-text3">{t('checkout.share.link.desc')}</div>
                </div>
                <Icon name={shareTab === 'link' ? 'keyboard_arrow_up' : 'keyboard_arrow_down'} size={18} color="var(--c-text3)" />
              </button>
              {shareTab === 'link' && (
                <div className="mt-4">
                  <div className="grid grid-cols-3 gap-2 mb-3">
                    {[
                      { label: t('checkout.share.link.1day'), days: 1 },
                      { label: t('checkout.share.link.1week'), days: 7 },
                      { label: t('checkout.share.link.unlimited'), days: undefined },
                    ].map(opt => (
                      <button key={opt.label} onClick={() => handleCreateShareLink(opt.days)} disabled={shareLoading} className="flex flex-col items-center gap-1 py-3 rounded-2xl bg-primary-light text-primary-dark text-xs font-medium hover:opacity-80 disabled:opacity-50 transition">
                        <Icon name="link" size={16} /> {opt.label}
                      </button>
                    ))}
                  </div>
                  {shareTokens.length > 0 && (
                    <div className="space-y-2">
                      {shareTokens.map(tok => {
                        const url = `${APP_BASE}/s/${tok.token}`
                        const expired = tok.expires_at && new Date(tok.expires_at) < new Date()
                        return (
                          <div key={tok.token} className={`flex items-center gap-2 p-3 rounded-2xl border ${expired ? 'bg-bg border-border opacity-60' : 'bg-bg border-border'}`}>
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-mono text-text2 truncate">{url}</p>
                              <p className="text-xs text-text3 mt-0.5">
                                {expired ? t('checkout.share.link.expired') : tok.expires_at ? `${t('checkout.share.link.until')} ${new Date(tok.expires_at).toLocaleDateString('he-IL')}` : t('checkout.share.link.no.limit')}
                                {' · '}{tok.view_count} {t('checkout.share.link.views')}
                              </p>
                            </div>
                            <button onClick={async () => { await navigator.clipboard.writeText(url); toast.success(t('checkout.copied')) }} className="p-2 text-primary hover:bg-primary-light rounded-lg"><Icon name="content_copy" size={16} /></button>
                            <button onClick={() => handleDeleteShareToken(tok.token)} className="p-2 text-error hover:bg-error/10 rounded-lg"><Icon name="delete" size={16} /></button>
                          </div>
                        )
                      })}
                    </div>
                  )}
                  {shareLoading && <div className="text-center py-4"><Spinner className="text-primary" /></div>}
                </div>
              )}
            </div>

            {/* User card */}
            <div className="bg-surface rounded-card shadow-card p-4">
              <button onClick={() => { const next = shareTab === 'user' ? null : 'user'; setShareTab(next); if (next && !sharesLoaded) openShareModal() }} className="w-full flex items-center gap-3 text-right">
                <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center flex-shrink-0"><Icon name="group" size={18} color="#3b82f6" /></div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-text">{t('checkout.share.tab.user')}</div>
                  <div className="text-xs text-text3">{t('checkout.share.user.desc')}</div>
                </div>
                <Icon name={shareTab === 'user' ? 'keyboard_arrow_up' : 'keyboard_arrow_down'} size={18} color="var(--c-text3)" />
              </button>
              {shareTab === 'user' && (
                <div className="mt-4 space-y-4">
                  {pendingShareEmail && (
                    <div className="bg-warning/10 rounded-2xl p-3 space-y-2">
                      <p className="text-sm text-warning">{t('checkout.share.user.not.found.prefix')} <strong>{pendingShareEmail}</strong> {t('checkout.share.user.not.found.suffix')}</p>
                      <div className="flex gap-2">
                        <button onClick={handleSendVoucherInvite} className="flex-1 bg-warning text-white py-2 rounded-xl text-sm font-medium">{t('checkout.share.send.invite')}</button>
                        <button onClick={() => { setPendingShareEmail(null); setShareEmail('') }} className="flex-1 bg-bg text-text2 py-2 rounded-xl text-sm font-medium">{t('checkout.cancel')}</button>
                      </div>
                    </div>
                  )}
                  {!pendingShareEmail && (
                    <div className="flex gap-2">
                      <div className="relative flex-1 min-w-0">
                        <span className="absolute right-3 top-1/2 -translate-y-1/2"><Icon name="person_add" size={16} color="var(--c-text3)" /></span>
                        <input type="email" value={shareEmail} onChange={e => setShareEmail(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleShareWithUser()} placeholder={t('checkout.share.email.placeholder')} className="w-full min-w-0 pr-9 pl-3 py-2.5 border border-border rounded-xl text-base focus:outline-none focus:ring-2 focus:ring-primary/30 bg-surface text-text" dir="ltr" />
                      </div>
                      <button onClick={handleShareWithUser} disabled={shareEmailLoading || !shareEmail.trim()} className="shrink-0 px-4 py-2.5 bg-primary text-white rounded-xl text-sm font-medium disabled:opacity-50">
                        {shareEmailLoading ? <Spinner /> : t('checkout.share')}
                      </button>
                    </div>
                  )}
                  {sharesLoaded && voucherShares.length > 0 && (
                    <div className="space-y-1">
                      <p className="text-xs font-medium text-text2">{t('checkout.share.shared.with')}:</p>
                      {voucherShares.map(s => (
                        <div key={s.id} className="flex items-center justify-between py-2 border-b border-border last:border-0">
                          <p className="text-sm text-text">{s.shared_with_email}</p>
                          <button onClick={() => handleUnshare(s.shared_with_email)} className="p-1.5 text-error hover:bg-error/10 rounded-lg"><Icon name="delete" size={16} /></button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Gift card */}
            <div className="bg-surface rounded-card shadow-card p-4">
              <button onClick={() => { const next = shareTab === 'gift' ? null : 'gift'; setShareTab(next); if (next) loadPendingGifts() }} className="w-full flex items-center gap-3 text-right">
                <div className="w-10 h-10 rounded-xl bg-rose-50 flex items-center justify-center flex-shrink-0"><Icon name="redeem" size={18} color="#e11d48" /></div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-text">{t('checkout.share.tab.gift')}</div>
                  <div className="text-xs text-text3">{t('checkout.gift.desc')}</div>
                </div>
                <Icon name={shareTab === 'gift' ? 'keyboard_arrow_up' : 'keyboard_arrow_down'} size={18} color="var(--c-text3)" />
              </button>
              {shareTab === 'gift' && (
                <div className="mt-4 space-y-4">
                  <div className="flex bg-bg rounded-2xl p-1">
                    <button onClick={() => { setGiftMode('link'); setGiftLink(null) }} className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-medium rounded-xl transition ${giftMode === 'link' ? 'bg-surface shadow text-primary' : 'text-text3'}`}>
                      <Icon name="link" size={14} /> {t('checkout.gift.create.link')}
                    </button>
                    <button onClick={() => { setGiftMode('email'); setGiftLink(null) }} className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-medium rounded-xl transition ${giftMode === 'email' ? 'bg-surface shadow text-primary' : 'text-text3'}`}>
                      <Icon name="mail" size={14} /> {t('checkout.gift.send.email')}
                    </button>
                  </div>
                  {giftMode === 'email' && (
                    <div className="relative">
                      <span className="absolute right-3 top-1/2 -translate-y-1/2"><Icon name="mail" size={16} color="var(--c-text3)" /></span>
                      <input type="email" value={giftEmail} onChange={e => setGiftEmail(e.target.value)} placeholder={t('checkout.gift.recipient.email')} className="w-full pr-9 pl-3 py-2.5 border border-border rounded-xl text-base focus:outline-none focus:ring-2 focus:ring-primary/30 bg-surface text-text" dir="ltr" />
                    </div>
                  )}
                  <textarea value={giftMessage} onChange={e => setGiftMessage(e.target.value)} placeholder={t('checkout.gift.message.placeholder')} rows={2} className="w-full px-3 py-2.5 border border-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none bg-surface text-text" dir="rtl" />
                  {giftMode === 'email' && (
                    <button onClick={() => setGiftScheduled(s => !s)} className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-medium transition border ${giftScheduled ? 'bg-primary-light border-primary text-primary-dark' : 'bg-bg border-border text-text2'}`}>
                      <Icon name="event" size={14} /> {t('checkout.gift.schedule')}
                    </button>
                  )}
                  {giftMode === 'email' && giftScheduled && (
                    <input type="datetime-local" value={giftDate} onChange={e => setGiftDate(e.target.value)} min={new Date().toISOString().slice(0, 16)} className="w-full px-3 py-2.5 border border-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 bg-surface text-text" dir="ltr" />
                  )}
                  <Button variant="primary" fullWidth loading={giftSending} disabled={giftMode === 'email' && (!giftEmail.trim() || (giftScheduled && !giftDate))} onClick={handleSendGift}>
                    <Icon name={giftMode === 'link' ? 'link' : 'redeem'} size={18} />
                    {giftSending ? t('checkout.gift.creating') : giftMode === 'link' ? t('checkout.gift.create.link.btn') : giftScheduled && giftDate ? t('checkout.gift.schedule.btn') : t('checkout.gift.send.now')}
                  </Button>
                  {giftLink && (
                    <div className="bg-primary-light border border-primary/30 rounded-2xl p-3 space-y-2">
                      <p className="text-xs font-medium text-primary-dark flex items-center gap-1"><Icon name="redeem" size={14} /> {t('checkout.gift.link.label')}:</p>
                      <div className="flex items-center gap-2">
                        <p className="text-xs text-primary-dark font-mono break-all flex-1">{giftLink}</p>
                        <button onClick={() => { navigator.clipboard.writeText(giftLink).catch(() => {}); toast.success(t('checkout.copied')) }} className="flex-shrink-0 p-2 bg-primary/10 hover:bg-primary/20 rounded-xl"><Icon name="content_copy" size={16} color="var(--c-primary-dark)" /></button>
                      </div>
                    </div>
                  )}
                  {giftsLoaded && pendingGifts.length > 0 && (
                    <div className="space-y-1 border-t border-border pt-3">
                      <p className="text-xs font-medium text-text2">{t('checkout.gift.pending.label')}:</p>
                      {pendingGifts.map(g => (
                        <div key={g.id} className="flex items-center justify-between py-2 border-b border-border last:border-0">
                          <div>
                            <p className="text-sm text-text">{g.recipient_email || <span className="text-text3 italic">{t('checkout.gift.link.only')}</span>}</p>
                            <p className="text-xs text-text3">{g.email_sent_at ? t('checkout.gift.sent.label') : `${t('checkout.gift.scheduled.label')}: ${new Date(g.send_at).toLocaleDateString('he-IL')}`}</p>
                          </div>
                          <button onClick={() => handleCancelGift(g.id)} className="p-1.5 text-error hover:bg-error/10 rounded-lg" title={t('checkout.gift.cancel.title')}><Icon name="delete" size={16} /></button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {currentTab === 'share' && isSharedVoucher && (
          <div className="bg-surface rounded-card shadow-card p-4">
            <div className="grid grid-cols-3 gap-2">
              {[
                { label: t('checkout.share.link.1day'), days: 1 },
                { label: t('checkout.share.link.1week'), days: 7 },
                { label: t('checkout.share.link.unlimited'), days: undefined },
              ].map(opt => (
                <button key={opt.label} onClick={() => handleCreateShareLink(opt.days)} disabled={shareLoading} className="flex flex-col items-center gap-1 py-3 rounded-2xl bg-primary-light text-primary-dark text-xs font-medium hover:opacity-80 disabled:opacity-50 transition">
                  <Icon name="link" size={16} /> {opt.label}
                </button>
              ))}
            </div>
            {shareTokens.length > 0 && (
              <div className="space-y-2 mt-3">
                {shareTokens.map(tok => {
                  const url = `${APP_BASE}/s/${tok.token}`
                  return (
                    <div key={tok.token} className="flex items-center gap-2 p-3 rounded-2xl border bg-bg border-border">
                      <p className="flex-1 min-w-0 text-xs font-mono text-text2 truncate">{url}</p>
                      <button onClick={async () => { await navigator.clipboard.writeText(url); toast.success(t('checkout.copied')) }} className="p-2 text-primary hover:bg-primary-light rounded-lg"><Icon name="content_copy" size={16} /></button>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {currentTab === 'sell' && (
          <div className="bg-surface rounded-card shadow-card p-4">
            {noPaymentMethod ? (
              <div className="text-center py-6">
                <div className="w-14 h-14 bg-bg rounded-full flex items-center justify-center mx-auto mb-3">
                  <Icon name="payments" size={26} color="var(--c-text3)" />
                </div>
                <p className="text-sm font-semibold text-text mb-1">{t('checkout.sell.no.payment')}</p>
                <button onClick={() => navigate('/settings')} className="mt-3 px-5 py-2 bg-primary text-white rounded-xl text-sm font-medium">{t('checkout.sell.go.settings')}</button>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="bg-bg rounded-2xl p-4 space-y-1">
                  <p className="font-semibold text-text">{voucher.store_name}</p>
                  <p className="text-sm text-text2">{t('checkout.sell.balance.label')}: {formatCurrency(voucher.balance)}</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-text2 mb-1">{t('checkout.sell.price.label')}</label>
                  <input type="number" inputMode="decimal" value={sellPrice} onChange={e => setSellPrice(e.target.value)} placeholder={t('checkout.sell.price.placeholder')} className="w-full border border-border rounded-xl px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-primary/40 bg-surface text-text" dir="ltr" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-text2 mb-1">{t('checkout.sell.desc.label')}</label>
                  <textarea value={sellDescription} onChange={e => setSellDescription(e.target.value)} placeholder={t('checkout.sell.desc.placeholder')} className="w-full border border-border rounded-xl px-4 py-3 text-sm resize-none h-20 focus:outline-none focus:ring-2 focus:ring-primary/40 bg-surface text-text" />
                </div>
                {sellPrice && !isNaN(parseFloat(sellPrice)) && parseFloat(sellPrice) > 0 && (
                  <p className="text-xs text-text2">{t('checkout.sell.price.label')}: <span className="font-semibold text-text">{formatCurrency(parseFloat(sellPrice))}</span></p>
                )}
                <div className="bg-warning/10 border border-warning/30 rounded-xl p-3 text-xs text-warning">{t('checkout.sell.notice')}</div>
              </div>
            )}
          </div>
        )}

        {currentTab === 'activity' && (
          <div className="bg-surface rounded-card shadow-card p-4">
            {logLoading ? (
              <div className="flex justify-center py-6"><Spinner className="text-text3" /></div>
            ) : voucherLog.length === 0 ? (
              <p className="text-xs text-text3 text-center py-4">{t('checkout.activity.empty')}</p>
            ) : (
              <div className="relative">
                <div className="absolute right-[11px] top-3 bottom-3 w-px bg-border" />
                <div className="space-y-4">
                  {voucherLog.map((entry) => {
                    const dt = new Date(entry.created_at)
                    const dateStr = dt.toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: '2-digit' })
                    const timeStr = dt.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })

                    let iconName: string
                    let dotColor: string
                    let label: string
                    let detail: string | null = null

                    const fmtAmt = (n: unknown) => `₪${Number(n).toLocaleString('he-IL')}`
                    // Shared detail line for any balance change: prefer the explicit
                    // used amount + store, fall back to from←to when only that exists.
                    const balanceDetail = (d: ActivityLogEntry['details'] | undefined): string | null => {
                      if (!d) return null
                      const parts: string[] = []
                      if (d.used != null && Number(d.used) > 0) parts.push(`${t('checkout.log.used.amount')}: ${fmtAmt(d.used)}`)
                      else if (d.from != null && d.to != null) parts.push(`${fmtAmt(d.from)} ← ${fmtAmt(d.to)}`)
                      if (d.to != null && (d.used != null || d.from != null)) parts.push(`${t('checkout.log.balance.detail')}: ${fmtAmt(d.to)}`)
                      if (d.store_used) parts.push(`${t('checkout.log.at.store')} ${d.store_used}`)
                      return parts.length ? parts.join(' · ') : null
                    }
                    // Who performed the action (shared partners / share links)
                    const actorDetail = (d: ActivityLogEntry['details'] | undefined): string | null => {
                      if (!d) return null
                      if (d.source === 'shared_user') return d.actor_name ? `${t('checkout.log.by.partner')}: ${d.actor_name}` : t('checkout.log.by.partner')
                      if (d.source === 'shared_link') return t('checkout.log.by.link')
                      if (d.source === 'gift_link') return t('checkout.log.by.gift.link')
                      return null
                    }

                    switch (entry.action) {
                      case 'add':
                        iconName = 'add_circle'; dotColor = 'bg-primary text-white'; label = t('checkout.log.added')
                        if (entry.details?.amount != null) detail = `${t('checkout.log.amount')}: ${fmtAmt(entry.details.amount)}`
                        break
                      case 'balance_update':
                        iconName = 'do_not_disturb_on'; dotColor = 'bg-blue-500 text-white'; label = t('checkout.log.balance.update')
                        detail = balanceDetail(entry.details)
                        break
                      case 'edit':
                        iconName = 'edit'; dotColor = 'bg-indigo-500 text-white'; label = t('checkout.log.edited')
                        if (entry.details && Object.keys(entry.details).some(k => k !== '_sensitive_updated')) {
                          const fields = Object.keys(entry.details).filter(k => k !== '_sensitive_updated')
                          detail = fields.slice(0, 3).map(f => t(`log.field.${f}`) === `log.field.${f}` ? f : t(`log.field.${f}`)).join(', ')
                        }
                        break
                      case 'archive':
                        iconName = 'inventory_2'; dotColor = 'bg-orange-400 text-white'; label = t('checkout.log.archived')
                        if (entry.details?.balance != null) detail = `${t('checkout.log.balance.detail')}: ${fmtAmt(entry.details.balance)}`
                        break
                      case 'unarchive':
                        iconName = 'undo'; dotColor = 'bg-teal-500 text-white'; label = t('checkout.log.unarchived'); break
                      case 'delete':
                        iconName = 'delete'; dotColor = 'bg-red-500 text-white'; label = t('log.action.delete')
                        if (entry.details?.balance != null) detail = `${t('checkout.log.balance.detail')}: ${fmtAmt(entry.details.balance)}`
                        break
                      case 'gift_sent':
                        iconName = 'mail'; dotColor = 'bg-pink-500 text-white'; label = t('checkout.log.gift.sent')
                        if (entry.details?.recipient) detail = `${t('checkout.log.to')}: ${entry.details.recipient}`
                        break
                      case 'gift_link':
                        iconName = 'link'; dotColor = 'bg-pink-400 text-white'; label = t('checkout.log.gift.link'); break
                      case 'gift_cancelled':
                        iconName = 'cancel'; dotColor = 'bg-pink-300 text-white'; label = t('log.action.gift_cancelled')
                        if (entry.details?.recipient) detail = `${t('checkout.log.to')}: ${entry.details.recipient}`
                        break
                      case 'gift_received':
                        iconName = 'redeem'; dotColor = 'bg-rose-500 text-white'; label = t('checkout.log.gift.received')
                        if (entry.details?.sender) detail = `${t('checkout.log.from')}: ${entry.details.sender}`
                        break
                      case 'gift_balance_update':
                        iconName = 'do_not_disturb_on'; dotColor = 'bg-pink-600 text-white'; label = t('checkout.log.gift.balance.update')
                        detail = balanceDetail(entry.details)
                        break
                      case 'share_link':
                        iconName = 'link'; dotColor = 'bg-cyan-500 text-white'; label = t('log.action.share_link'); break
                      case 'share_link_deleted':
                        iconName = 'link_off'; dotColor = 'bg-cyan-400 text-white'; label = t('log.action.share_link_deleted'); break
                      case 'share_email':
                        iconName = 'group'; dotColor = 'bg-sky-500 text-white'; label = t('log.action.share_email')
                        if (entry.details?.recipient) detail = `${t('checkout.log.to')}: ${entry.details.recipient}`
                        break
                      case 'unshare_email':
                        iconName = 'group_off'; dotColor = 'bg-sky-400 text-white'; label = t('log.action.unshare_email')
                        if (entry.details?.recipient) detail = `${t('checkout.log.to')}: ${entry.details.recipient}`
                        break
                      case 'list_for_sale':
                        iconName = 'sell'; dotColor = 'bg-amber-500 text-white'; label = t('log.action.list_for_sale'); break
                      case 'cancel_sale':
                        iconName = 'remove_shopping_cart'; dotColor = 'bg-amber-400 text-white'; label = t('log.action.cancel_sale'); break
                      default: {
                        // Unknown/system actions: reuse the global log's i18n keys
                        // instead of leaking raw snake_case into the RTL timeline.
                        const key = `log.action.${entry.action}`
                        const translated = t(key)
                        iconName = 'schedule'; dotColor = 'bg-text3 text-white'
                        label = translated === key ? entry.action : translated
                      }
                    }

                    const actor = actorDetail(entry.details)
                    if (actor) detail = detail ? `${detail} · ${actor}` : actor

                    return (
                      <div key={entry.id} className="flex items-start gap-3 relative">
                        <div className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 z-10 ${dotColor}`}>
                          <Icon name={iconName} size={14} />
                        </div>
                        <div className="flex-1 min-w-0 pt-0.5">
                          <div className="flex items-baseline justify-between gap-2">
                            <span className="text-sm font-medium text-text">{label}</span>
                            <span className="text-xs text-text3 flex-shrink-0">{dateStr} {timeStr}</span>
                          </div>
                          {detail && <p className="text-xs text-text2 mt-0.5">{detail}</p>}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Floating action (per-tab task CTA) ── portaled, same reason as the header */}
      {fab && createPortal(
        <button
          onClick={fab.onClick}
          disabled={fab.disabled || fab.loading}
          className="checkout-fab flex items-center justify-center gap-2 font-bold text-white bg-gradient-to-br from-primary-mid to-primary-dark active:scale-[0.97] transition-transform disabled:opacity-50"
        >
          {fab.loading ? <Spinner /> : <Icon name={fab.icon} size={20} />}
          {fab.label}
        </button>,
        document.body,
      )}

    </div>
  )
}

function MenuRow({ icon, label, onClick, danger, disabled }: { icon: string; label: string; onClick: () => void; danger?: boolean; disabled?: boolean }) {
  return (
    <button onClick={onClick} disabled={disabled} className={`flex items-center gap-3 py-3.5 border-b border-border last:border-0 disabled:opacity-50 ${danger ? 'text-error' : 'text-text'}`}>
      <Icon name={icon} size={22} color={danger ? 'var(--c-error)' : 'var(--c-text2)'} />
      <span className="text-[15px] font-medium">{label}</span>
    </button>
  )
}
