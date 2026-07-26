import { useEffect, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useVouchers, type ActivityLogEntry, type VoucherShare, type PendingGift } from '../contexts/VoucherContext'
import { useAuth } from '../contexts/AuthContext'
import { useSubscription } from '../contexts/SubscriptionContext'
import { useMarketplace } from '../contexts/MarketplaceContext'
import { sendVoucherSharedEmail, sendVoucherShareInviteEmail, sendGiftEmail } from '../lib/emailService'
import { isAlphanumeric, formatCurrency, formatDate, getExpiryLabel, getExpiryStatus, getStoreInitials, getCategoryColor } from '../utils/helpers'
import { sendUsageNotification } from '../hooks/useNotifications'
import { supabase } from '../lib/supabase'
import JsBarcode from 'jsbarcode'
import QRCode from 'qrcode'
import VoucherForm from '../components/VoucherForm'
import toast from 'react-hot-toast'
import ConfirmDialog from '../components/ConfirmDialog'
import Icon from '../components/ui/Icon'
import Button from '../components/ui/Button'
import BottomSheet from '../components/ui/BottomSheet'
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

// Small inline spinner (Material Symbols has no animated spinner glyph)
function Spinner({ className = '' }: { className?: string }) {
  return <span className={`inline-block w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin ${className}`} />
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
  const [archiveReason, setArchiveReason] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [showEditForm, setShowEditForm] = useState(false)
  const [showMoreMenu, setShowMoreMenu] = useState(false)
  const [showUseSheet, setShowUseSheet] = useState(false)
  const [activityOpen, setActivityOpen] = useState(false)
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
  const [lockToggling, setLockToggling] = useState(false)
  // Sell modal
  const [showSellModal, setShowSellModal] = useState(false)
  const [sellPrice, setSellPrice] = useState('')
  const [sellDescription, setSellDescription] = useState('')
  const [sellLoading, setSellLoading] = useState(false)
  const [removingFromSale, setRemovingFromSale] = useState(false)

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
    setShareTokens(prev => prev.filter(tk => tk.token !== token))
    toast.success(t('checkout.share.link.deleted'))
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

  // Bottom action bar items (contextual — sits above the global nav)
  const barActions: { icon: string; label: string; onClick: () => void; primary?: boolean }[] = [
    { icon: 'history', label: t('checkout.activity.short'), onClick: () => { setActivityOpen(true); setTimeout(() => document.getElementById('activity-section')?.scrollIntoView({ behavior: 'smooth' }), 60) } },
    ...(!isSharedVoucher && !isArchived && !voucher.is_locked ? [{ icon: 'sell', label: t('checkout.sell'), onClick: () => setShowSellModal(true) }] : []),
    ...(!isArchived ? [{ icon: 'ios_share', label: t('checkout.share'), onClick: openShareModal }] : []),
    ...(!isArchived ? [{ icon: 'shopping_bag', label: t('checkout.use.voucher'), onClick: () => setShowUseSheet(true), primary: true }] : []),
  ]

  return (
    <div className="flex-1 bg-bg">
      {/* Confirm dialogs */}
      {confirmArchive && (
        <ConfirmDialog
          title={t('checkout.archive.confirm.title')}
          onConfirm={() => {
            setConfirmArchive(false)
            archiveVoucher(voucher.id, archiveReason || undefined).then(() => { toast.success(t('checkout.archived')); navigate(-1) })
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
      {confirmDelete && (
        <ConfirmDialog
          title={t('checkout.delete.confirm.title')}
          message={t('checkout.delete.confirm.msg')}
          danger
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
        padding: '0 20px 24px', position: 'relative', overflow: 'hidden',
      }}>
        <div style={{ position: 'absolute', top: -30, left: -30, width: 120, height: 120, borderRadius: '50%', background: 'rgba(255,255,255,0.06)', pointerEvents: 'none' }} />

        {/* top bar */}
        <div className="flex items-center justify-between" style={{ padding: '18px 0 20px' }}>
          <button onClick={() => navigate(-1)} className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: 'rgba(255,255,255,0.2)' }}>
            <Icon name="arrow_forward" size={20} color="#fff" />
          </button>
          <div className="text-base font-bold text-white truncate max-w-[55%]">{sv?.name || voucher.store_name}</div>
          <button
            onClick={() => setShowMoreMenu(true)}
            aria-label={t('checkout.menu.title')}
            className="w-9 h-9 rounded-xl flex items-center justify-center"
            style={{ background: 'rgba(255,255,255,0.2)' }}
          >
            <Icon name="more_horiz" size={22} color="#fff" />
          </button>
        </div>

        {/* Store avatar + balance */}
        <div className="flex items-center gap-4">
          <div className="w-16 h-16 rounded-[18px] flex items-center justify-center text-white flex-shrink-0" style={{ background: 'rgba(255,255,255,0.25)', fontSize: 24, fontWeight: 900 }}>
            {getStoreInitials(sv?.name || voucher.store_name)}
          </div>
          <div>
            <div className="text-[13px] font-medium mb-0.5" style={{ color: 'rgba(255,255,255,0.75)' }}>{t('checkout.current.balance')}</div>
            <div className="text-white font-black" style={{ fontSize: 36, letterSpacing: '-1px', lineHeight: 1 }}>{formatCurrency(voucher.balance)}</div>
            {voucher.amount > 0 && voucher.amount !== voucher.balance && (
              <div className="text-xs mt-1" style={{ color: 'rgba(255,255,255,0.6)' }}>
                {t('checkout.original.of')} {formatCurrency(voucher.amount)} {t('checkout.original.label')}
              </div>
            )}
            {sv && <div className="text-xs mt-0.5" style={{ color: 'rgba(255,255,255,0.7)' }}>{voucher.store_name}</div>}
          </div>
        </div>
      </div>

      {/* Lock banner */}
      {voucher.is_locked && (
        <div className="flex items-center gap-2 px-5 py-2.5 border-b" style={{ background: 'var(--c-gold-light)', borderColor: '#f6d680' }}>
          <Icon name="lock" size={16} color="var(--c-gold)" />
          <span className="text-[13px] font-semibold" style={{ color: 'var(--c-gold)' }}>
            {voucher.lock_reason === 'for_sale' ? t('checkout.lock.banner.for.sale') : `${t('checkout.lock.banner.locked')}: ${voucher.lock_reason}`}
          </span>
        </div>
      )}

      <div className="p-4 space-y-4" style={{ paddingBottom: 'calc(var(--nav-h) + 80px)' }}>
        {/* Offline warning for shared */}
        {!isOnline && voucher.is_shared && (
          <div className="bg-warning/10 border border-warning/30 rounded-2xl p-3 flex items-center gap-2 text-sm text-warning">
            <Icon name="warning" size={16} /> {t('checkout.offline.shared')}
          </div>
        )}

        {/* Notes */}
        {voucher.notes && (
          <div className="bg-blue-50 border border-blue-100 rounded-2xl p-3 text-sm text-text2">{voucher.notes}</div>
        )}

        {/* Barcode / QR */}
        <div className="text-center overflow-hidden bg-surface rounded-card shadow-card p-5">
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
              <div className="w-full overflow-hidden flex items-center justify-center mb-4">
                {isAlpha ? <canvas ref={qrRef} className="rounded-xl" /> : <svg ref={barcodeRef} style={{ width: '100%', height: 'auto' }} />}
              </div>
              <div className="font-mono text-lg font-bold tracking-widest text-text mb-3 break-all flex items-center justify-center gap-2">
                {effectiveCode ?? voucher.code}
                {voucher.is_e2ee && isVaultUnlocked && (
                  <button onClick={lockVault} title={t('checkout.e2ee.lock.vault.title')} className="text-indigo-300 hover:text-indigo-500 ml-1">
                    <Icon name="shield" size={16} />
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
              className={`flex items-center gap-2 px-5 py-2.5 rounded-2xl text-sm font-medium transition ${
                voucher?.is_e2ee && !isVaultUnlocked
                  ? 'bg-bg text-text3 cursor-not-allowed opacity-50'
                  : copied ? 'bg-primary-light text-primary-dark' : 'bg-bg text-text2 hover:opacity-80'
              }`}
            >
              <Icon name={copied ? 'check' : 'content_copy'} size={16} />
              {copied ? t('checkout.copied') : t('checkout.copy.code')}
            </button>

            {isSafeUrl(voucher.link) && (
              <a href={voucher.link} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 px-5 py-2.5 rounded-2xl text-sm font-medium bg-blue-50 text-blue-600 hover:bg-blue-100">
                <Icon name="open_in_new" size={16} /> {t('checkout.open.link')}
              </a>
            )}
          </div>
        </div>

        {/* CVV */}
        {voucher.cvv && (
          <div className="bg-yellow-50 border border-yellow-200 rounded-2xl p-4 flex items-center justify-between">
            <span className="text-sm font-medium text-yellow-800">{t('checkout.cvv.label')}</span>
            {voucher.is_e2ee && !isVaultUnlocked ? (
              <span className="text-xs text-indigo-400 flex items-center gap-1">
                <Icon name="shield" size={14} /> {t('checkout.e2ee.encrypted')}
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
                  <Icon name={showCvv ? 'visibility_off' : 'visibility'} size={16} />
                </button>
              </div>
            )}
          </div>
        )}

        {/* Balance Card (display only — quick-deduct moved to Use sheet) */}
        <div className="bg-surface rounded-card shadow-card p-5">
          <div className="flex items-center justify-between mb-4">
            <span className="text-sm text-text2">{t('checkout.current.balance')}</span>
            <div className="text-right">
              <div className="text-3xl font-bold text-text">{formatCurrency(voucher.balance)}</div>
              {profile?.show_voucher_value && voucher.value_percent != null && voucher.value_percent > 0 && voucher.value_percent < 100 && (
                <div className="text-xs text-text3 mt-0.5">{t('checkout.value.label')} {voucher.value_percent.toFixed(0)}%{voucher.actual_cost != null ? ` | ${t('checkout.cost.label')} ${voucher.actual_cost.toLocaleString('he-IL')} ₪` : ''}</div>
              )}
            </div>
          </div>

          {voucher.amount > 0 && (
            <div className="mb-4">
              <div className="flex justify-between text-xs text-text3 mb-1">
                <span>₪0</span>
                <span>{formatCurrency(voucher.amount)}</span>
              </div>
              <div className="h-3 bg-bg rounded-full overflow-hidden">
                <div className="h-full bg-gradient-to-r from-primary-mid to-primary-dark rounded-full transition-all" style={{ width: `${Math.min(100, (voucher.balance / voucher.amount) * 100)}%` }} />
              </div>
            </div>
          )}

          {expiryLabel && (
            <div className={`flex items-center gap-1.5 text-sm ${
              expiryStatus === 'expired' ? 'text-text3' :
              expiryStatus === 'critical' ? 'text-error' :
              expiryStatus === 'warning' ? 'text-warning' : 'text-text2'
            }`}>
              {(expiryStatus === 'critical' || expiryStatus === 'warning') && <Icon name="warning" size={16} />}
              <span>{expiryLabel}</span>
              {voucher.expiry_date && expiryStatus !== 'ok' && <span className="text-xs text-text3">({formatDate(voucher.expiry_date)})</span>}
            </div>
          )}

          {!isArchived && (
            <Button variant="primary" fullWidth className="mt-4" onClick={() => setShowUseSheet(true)}>
              <Icon name="shopping_bag" size={18} /> {t('checkout.use.voucher')}
            </Button>
          )}
        </div>

        {/* Super voucher stores (accordion) */}
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

        {/* Tags */}
        {voucher.tags?.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {voucher.tags.map((tag, i) => (
              <span key={i} className="text-xs bg-bg text-text2 px-3 py-1 rounded-full">#{tag}</span>
            ))}
          </div>
        )}

        {/* Activity Timeline (accordion) */}
        <div id="activity-section" className="bg-surface rounded-card shadow-card p-4">
          <button onClick={() => setActivityOpen(o => !o)} className="w-full flex items-center justify-between">
            <h3 className="text-sm font-semibold text-text flex items-center gap-1.5">
              <Icon name="history" size={16} color="var(--c-text3)" /> {t('checkout.activity.title')}
            </h3>
            <Icon name={activityOpen ? 'keyboard_arrow_up' : 'keyboard_arrow_down'} size={18} color="var(--c-text3)" />
          </button>
          {activityOpen && (
            <div className="mt-4">
              {logLoading ? (
                <div className="flex justify-center py-4"><Spinner className="text-text3" /></div>
              ) : voucherLog.length === 0 ? (
                <p className="text-xs text-text3 text-center py-2">{t('checkout.activity.empty')}</p>
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

                      switch (entry.action) {
                        case 'add':
                          iconName = 'add_circle'; dotColor = 'bg-primary text-white'; label = t('checkout.log.added')
                          if (entry.details?.amount != null) detail = `${t('checkout.log.amount')}: ₪${Number(entry.details.amount).toLocaleString('he-IL')}`
                          break
                        case 'balance_update':
                          iconName = 'remove_circle'; dotColor = 'bg-blue-500 text-white'; label = t('checkout.log.balance.update')
                          if (entry.details?.from != null && entry.details?.to != null) {
                            detail = `₪${Number(entry.details.from).toLocaleString('he-IL')} ← ₪${Number(entry.details.to).toLocaleString('he-IL')}`
                            if (entry.details?.store_used) detail += ` · ${entry.details.store_used}`
                          }
                          break
                        case 'edit':
                          iconName = 'edit'; dotColor = 'bg-indigo-500 text-white'; label = t('checkout.log.edited'); break
                        case 'archive':
                          iconName = 'inventory_2'; dotColor = 'bg-orange-400 text-white'; label = t('checkout.log.archived')
                          if (entry.details?.balance != null) detail = `${t('checkout.log.balance.detail')}: ₪${Number(entry.details.balance).toLocaleString('he-IL')}`
                          break
                        case 'unarchive':
                          iconName = 'undo'; dotColor = 'bg-teal-500 text-white'; label = t('checkout.log.unarchived'); break
                        case 'gift_sent':
                          iconName = 'mail'; dotColor = 'bg-pink-500 text-white'; label = t('checkout.log.gift.sent')
                          if (entry.details?.recipient) detail = `${t('checkout.log.to')}: ${entry.details.recipient}`
                          break
                        case 'gift_link':
                          iconName = 'link'; dotColor = 'bg-pink-400 text-white'; label = t('checkout.log.gift.link'); break
                        case 'gift_received':
                          iconName = 'redeem'; dotColor = 'bg-rose-500 text-white'; label = t('checkout.log.gift.received')
                          if (entry.details?.sender) detail = `${t('checkout.log.from')}: ${entry.details.sender}`
                          break
                        case 'gift_balance_update':
                          iconName = 'remove_circle'; dotColor = 'bg-pink-600 text-white'; label = t('checkout.log.gift.balance.update')
                          if (entry.details?.from != null && entry.details?.to != null) {
                            detail = `₪${Number(entry.details.from).toLocaleString('he-IL')} ← ₪${Number(entry.details.to).toLocaleString('he-IL')}`
                            if (entry.details?.store_used) detail += ` · ${entry.details.store_used}`
                          }
                          break
                        default:
                          iconName = 'schedule'; dotColor = 'bg-text3 text-white'; label = entry.action
                      }

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
      </div>

      {/* ── Contextual bottom action bar ── stacks flush on top of the floating bottom-nav
          card (same width/margins/corner radius, .bottom-nav--squared-top flattens the
          nav's top corners where they meet) so together they read as one continuous
          floating card extended upward, not two separate floating objects. */}
      <div className="bottom-action-bar fixed z-40 flex items-center justify-around px-2 py-2" style={{ bottom: 'var(--nav-h)' }}>
        {barActions.map(a => (
          <button
            key={a.label}
            onClick={a.onClick}
            className={`flex flex-col items-center gap-0.5 px-4 py-1.5 rounded-xl ${a.primary ? 'bg-gradient-to-br from-primary-mid to-primary-dark text-white' : 'text-text2'}`}
          >
            <Icon name={a.icon} size={22} filled={a.primary} />
            <span className="text-[10px] font-bold">{a.label}</span>
          </button>
        ))}
      </div>

      {/* ── More actions sheet ── */}
      <BottomSheet open={showMoreMenu} onClose={() => setShowMoreMenu(false)} title={t('checkout.menu.title')}>
        <div className="flex flex-col">
          {!isSharedVoucher && !isArchived && (
            <MenuRow icon="edit" label={t('checkout.edit')} onClick={() => { setShowMoreMenu(false); setShowEditForm(true) }} />
          )}
          {/* "Sell" lives only in the bottom action bar (barActions below) — having it here too was a duplicate entry point for the same action. */}
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
      </BottomSheet>

      {/* ── Use (quick-deduct) sheet ── */}
      <BottomSheet open={showUseSheet} onClose={() => setShowUseSheet(false)} title={t('checkout.use.voucher')}>
        <input
          type="text" value={customStore} onChange={e => setCustomStore(e.target.value)}
          placeholder={t('checkout.store.used.placeholder')}
          className="w-full px-3 py-2.5 border border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/30 text-sm mb-3 bg-surface text-text"
          dir="rtl"
        />
        <div className="grid grid-cols-4 gap-2 mb-3">
          {QUICK_AMOUNTS.map(amt => (
            <button
              key={amt}
              onClick={() => { updateBalance(voucher.balance - amt, amt, customStore.trim() || null); setCustomStore(''); setShowUseSheet(false) }}
              disabled={voucher.balance < amt}
              className="py-2.5 bg-bg text-text2 rounded-xl text-sm font-medium hover:opacity-80 disabled:opacity-40 transition"
            >
              -{amt}
            </button>
          ))}
          <button
            onClick={() => { const half = voucher.balance / 2; updateBalance(half, half, customStore.trim() || null); setCustomStore(''); setShowUseSheet(false) }}
            className="py-2.5 bg-bg text-text2 rounded-xl text-sm font-medium hover:opacity-80 transition"
          >
            {t('checkout.half')}
          </button>
          <button
            onClick={() => { updateBalance(0, voucher.balance, customStore.trim() || null); setCustomStore(''); setShowUseSheet(false) }}
            className="py-2.5 bg-error/10 text-error rounded-xl text-sm font-medium hover:bg-error/20 transition"
          >
            {t('checkout.full')}
          </button>
        </div>
        <p className="text-xs font-medium text-text2 mb-1.5">{t('checkout.usage.amount')}</p>
        <div className="flex gap-2">
          <input
            type="number" inputMode="decimal" value={customAmount} onChange={e => setCustomAmount(e.target.value)}
            placeholder={t('checkout.usage.amount.placeholder')}
            className="flex-1 min-w-0 px-3 py-2.5 border border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/30 bg-surface text-text"
            style={{ fontSize: '16px' }} dir="ltr"
          />
          <button
            onClick={() => {
              const amount = parseFloat(customAmount)
              if (!isNaN(amount) && amount > 0) {
                updateBalance(voucher.balance - amount, amount, customStore.trim() || null)
                setCustomAmount(''); setCustomStore(''); setShowUseSheet(false)
              }
            }}
            disabled={!customAmount || isNaN(parseFloat(customAmount)) || parseFloat(customAmount) <= 0}
            className="shrink-0 px-4 py-2.5 bg-primary text-white rounded-xl text-sm font-medium disabled:opacity-40 hover:opacity-90 transition"
          >
            {t('checkout.update')}
          </button>
        </div>
        {(() => {
          const amount = parseFloat(customAmount)
          if (isNaN(amount) || amount <= 0) return null
          const newBal = Math.max(0, voucher.balance - amount)
          return <p className={`text-xs mt-2 font-medium ${newBal <= 0 ? 'text-error' : 'text-success'}`}>{t('checkout.new.balance.preview')}: ₪{newBal.toLocaleString('he-IL')}</p>
        })()}
      </BottomSheet>

      {/* ── Sell sheet ── */}
      <BottomSheet
        open={showSellModal}
        onClose={() => setShowSellModal(false)}
        title={t('checkout.sell.modal.title')}
        footer={
          <Button variant="primary" fullWidth loading={sellLoading} disabled={!sellPrice} onClick={handleListForSale}>
            {t('checkout.sell.publish')}
          </Button>
        }
      >
        <div className="space-y-4">
          <div className="bg-bg rounded-2xl p-4 space-y-1">
            <p className="font-semibold text-text">{voucher.store_name}</p>
            <p className="text-sm text-text2">{t('checkout.sell.balance.label')}: ₪{voucher.balance}</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-text2 mb-1">{t('checkout.sell.price.label')}</label>
            <input type="number" inputMode="decimal" value={sellPrice} onChange={e => setSellPrice(e.target.value)} placeholder={t('checkout.sell.price.placeholder')} className="w-full border border-border rounded-xl px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-primary/40 bg-surface text-text" dir="ltr" />
          </div>
          <div>
            <label className="block text-sm font-medium text-text2 mb-1">{t('checkout.sell.desc.label')}</label>
            <textarea value={sellDescription} onChange={e => setSellDescription(e.target.value)} placeholder={t('checkout.sell.desc.placeholder')} className="w-full border border-border rounded-xl px-4 py-3 text-sm resize-none h-20 focus:outline-none focus:ring-2 focus:ring-primary/40 bg-surface text-text" />
          </div>
          <div className="bg-warning/10 border border-warning/30 rounded-xl p-3 text-xs text-warning">{t('checkout.sell.notice')}</div>
        </div>
      </BottomSheet>

      {/* ── Share sheet ── */}
      <BottomSheet open={showShareModal} onClose={() => setShowShareModal(false)} title={t('checkout.share.modal.title')}>
        {/* Tabs */}
        {!isSharedVoucher && (
          <div className="flex gap-1 bg-bg rounded-2xl p-1 mb-4">
            {([
              { key: 'link', icon: 'link', label: t('checkout.share.tab.link') },
              { key: 'user', icon: 'group', label: t('checkout.share.tab.user') },
              { key: 'gift', icon: 'redeem', label: t('checkout.share.tab.gift') },
            ] as const).map(tab => (
              <button
                key={tab.key}
                onClick={() => { setShareTab(tab.key); if (tab.key === 'gift') loadPendingGifts() }}
                className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-medium transition ${shareTab === tab.key ? 'bg-surface text-primary shadow-sm' : 'text-text3'}`}
              >
                <Icon name={tab.icon} size={14} /> {tab.label}
              </button>
            ))}
          </div>
        )}

        {/* Link tab */}
        {shareTab === 'link' && (
          <>
            <p className="text-sm text-text2 mb-3">{t('checkout.share.link.desc')}</p>
            {voucher.is_e2ee && (
              <div className="flex items-start gap-2 bg-warning/10 border border-warning/30 rounded-xl p-3 mb-3 text-xs text-warning">
                <Icon name="shield" size={16} /> <span>{t('checkout.share.e2ee.warning')}</span>
              </div>
            )}
            <div className="grid grid-cols-3 gap-2 mb-4">
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
                <p className="text-xs font-medium text-text2">{t('checkout.share.active.links')}:</p>
                {shareTokens.map(tok => {
                  const url = `${window.location.origin}/s/${tok.token}`
                  const expired = tok.expires_at && new Date(tok.expires_at) < new Date()
                  return (
                    <div key={tok.token} className={`flex items-center gap-2 p-3 rounded-2xl border ${expired ? 'bg-bg border-border opacity-60' : 'bg-surface border-border'}`}>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-mono text-text2 truncate">{url}</p>
                        <p className="text-xs text-text3 mt-0.5">
                          {expired ? `⛔ ${t('checkout.share.link.expired')}` : tok.expires_at ? `${t('checkout.share.link.until')} ${new Date(tok.expires_at).toLocaleDateString('he-IL')}` : t('checkout.share.link.no.limit')}
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
          </>
        )}

        {/* User tab */}
        {shareTab === 'user' && !isSharedVoucher && (
          <div className="space-y-4">
            <p className="text-sm text-text2">{t('checkout.share.user.desc')}</p>
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
                <div className="relative flex-1">
                  <span className="absolute right-3 top-1/2 -translate-y-1/2"><Icon name="person_add" size={16} color="var(--c-text3)" /></span>
                  <input type="email" value={shareEmail} onChange={e => setShareEmail(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleShareWithUser()} placeholder={t('checkout.share.email.placeholder')} className="w-full pr-9 pl-3 py-2.5 border border-border rounded-xl text-base focus:outline-none focus:ring-2 focus:ring-primary/30 bg-surface text-text" dir="ltr" />
                </div>
                <button onClick={handleShareWithUser} disabled={shareEmailLoading || !shareEmail.trim()} className="px-4 py-2.5 bg-primary text-white rounded-xl text-sm font-medium disabled:opacity-50">
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

        {/* Gift tab */}
        {shareTab === 'gift' && !isSharedVoucher && (
          <div className="space-y-4">
            <p className="text-sm text-text2">{t('checkout.gift.desc')}</p>
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
      </BottomSheet>
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
