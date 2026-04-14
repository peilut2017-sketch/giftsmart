import { useEffect, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useVouchers, type ActivityLogEntry, type VoucherShare, type PendingGift } from '../contexts/VoucherContext'
import { useAuth } from '../contexts/AuthContext'
import { useSubscription } from '../contexts/SubscriptionContext'
import { useMarketplace } from '../contexts/MarketplaceContext'
import { sendVoucherSharedEmail, sendVoucherShareInviteEmail, sendGiftEmail } from '../lib/emailService'
import { isAlphanumeric, formatCurrency, formatDate, getExpiryLabel, getExpiryStatus } from '../utils/helpers'
import { sendUsageNotification } from '../hooks/useNotifications'
import { supabase } from '../lib/supabase'
import JsBarcode from 'jsbarcode'
import QRCode from 'qrcode'
import { ArrowRight, Copy, ExternalLink, AlertTriangle, Star, Eye, EyeOff, Archive, Check, Share2, Link2, Trash2, X, Clock, PlusCircle, Pencil, PackageCheck, Undo2, MinusCircle, UserPlus, Users, ChevronDown, ChevronUp, Edit2, Gift, Calendar, Mail, LinkIcon, Lock, Unlock, ShoppingBag, Loader2 } from 'lucide-react'
import VoucherForm from '../components/VoucherForm'
import toast from 'react-hot-toast'
import ConfirmDialog from '../components/ConfirmDialog'

const QUICK_AMOUNTS = [50, 100]

export default function CheckoutPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { user, profile } = useAuth()
  const { vouchers, archivedVouchers, superVouchers, sharedWithMe, updateVoucher, deleteVoucher, archiveVoucher, isOnline, createShareToken, deleteShareToken, getShareTokens, shareVoucherWithUser, getVoucherShares, unshareVoucher, updateSharedVoucherBalance, getVoucherActivityLog, createGift, cancelGift, getPendingGifts } = useVouchers()
  const { limits, openUpgradeSheet } = useSubscription()
  const { listForSale, removeFromSale } = useMarketplace()

  const voucher = [...vouchers, ...archivedVouchers, ...sharedWithMe].find(v => v.id === id)
  const isSharedVoucher = sharedWithMe.some(v => v.id === id)
  const sv = superVouchers.find(s => s.id === voucher?.super_voucher_id)

  const barcodeRef = useRef<SVGSVGElement>(null)
  const qrRef = useRef<HTMLCanvasElement>(null)
  const [showCvv, setShowCvv] = useState(false)
  const [customAmount, setCustomAmount] = useState('')
  const [customStore, setCustomStore] = useState('')
  const [copied, setCopied] = useState(false)
  const [wakeLock, setWakeLock] = useState<any>(null)
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
  }, [voucher?.code, lockConfirmed])

  async function copyCode() {
    if (!voucher?.code) return
    await navigator.clipboard.writeText(voucher.code).catch(() => {})
    setCopied(true)
    toast.success('קוד הועתק!')
    setTimeout(() => setCopied(false), 2000)
  }

  async function updateBalance(newBalance: number, usedAmount?: number, storeUsed?: string | null) {
    if (!voucher) return
    if (!isOnline && isSharedVoucher) {
      toast.error('אין חיבור לאינטרנט')
      return
    }
    const clamped = Math.max(0, newBalance)
    if (isSharedVoucher) {
      await updateSharedVoucherBalance(voucher.id, clamped, storeUsed)
    } else {
      await updateVoucher(voucher.id, { balance: clamped }, storeUsed)
      if (!isOnline) {
        toast.success('יתרה עודכנה (תסונכרן בחיבור)')
        if (clamped <= 0) setConfirmArchive(true)
        const used = usedAmount ?? (voucher.balance - clamped)
        if (used > 0) sendUsageNotification(voucher.store_name, used, clamped, storeUsed ?? null)
        return
      }
    }
    if (clamped <= 0) {
      toast.success('יתרה אופסה!')
      setConfirmArchive(true)
    } else {
      toast.success('יתרה עודכנה')
    }
    const used = usedAmount ?? (voucher.balance - clamped)
    if (used > 0) {
      sendUsageNotification(voucher.store_name, used, clamped, storeUsed ?? null)
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
      openUpgradeSheet(`הגעת למגבלת ${limits.maxSharedVouchers} השיתופים בחינמי`)
      return
    }
    setShareEmailLoading(true)
    try {
      const result = await shareVoucherWithUser(voucher.id, shareEmail.trim())
      if (result === 'not_found') {
        setPendingShareEmail(shareEmail.trim())
      } else if (result === 'already_shared') {
        toast('שובר זה כבר שותף עם משתמש זה', { icon: 'ℹ️' })
      } else {
        // Send notification email (non-blocking)
        sendVoucherSharedEmail({
          to_email: shareEmail.trim(),
          to_name: shareEmail.trim(),
          from_name: profile?.name || user?.email || '',
          store_name: voucher.store_name,
        }).catch((err) => console.error('שגיאה בשליחת מייל שיתוף:', err))
        toast.success(`שובר שותף עם ${shareEmail.trim()}`)
        setShareEmail('')
        const shares = await getVoucherShares(voucher.id)
        setVoucherShares(shares)
      }
    } catch (err: any) {
      toast.error(err?.message || 'שגיאה בשיתוף')
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
      toast.success(`הזמנה נשלחה ל-${pendingShareEmail}`)
    } catch {
      toast.error('שגיאה בשליחת הזמנה')
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
      toast.error('לא ניתן לשלוח מתנה לעצמך')
      return
    }
    const sendAt = giftScheduled && giftDate ? new Date(giftDate) : new Date()
    setGiftSending(true)
    setGiftLink(null)
    try {
      const email = giftMode === 'email' ? giftEmail.trim() : null
      const token = await createGift(voucher.id, email, giftMessage.trim(), sendAt)
      if (!token) { toast.error('שגיאה ביצירת המתנה'); return }

      const link = `${window.location.origin}/gift/${token}`

      if (giftMode === 'link') {
        setGiftLink(link)
        await navigator.clipboard.writeText(link).catch(() => {})
        toast.success('🎁 קישור מתנה נוצר והועתק!')
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
            toast.success(`🎁 מתנה נשלחה ל-${giftEmail.trim()}!`)
          } catch (emailErr: any) {
            // Gift was created but email failed — show link as fallback
            setGiftLink(link)
            toast.error('המתנה נוצרה אך שליחת המייל נכשלה — שלח את הקישור ידנית')
            console.error('Gift email error:', emailErr)
          }
        } else {
          toast.success(`🎁 מתנה מתוזמנת ל-${new Date(giftDate).toLocaleDateString('he-IL')}`)
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
      toast.error('שגיאה ביצירת המתנה: ' + (err?.message || ''))
    } finally {
      setGiftSending(false)
    }
  }

  async function handleCancelGift(giftId: string) {
    await cancelGift(giftId)
    setPendingGifts(prev => prev.filter(g => g.id !== giftId))
    toast.success('מתנה בוטלה')
  }

  async function handleUnshare(email: string) {
    if (!voucher) return
    await unshareVoucher(voucher.id, email)
    setVoucherShares(prev => prev.filter(s => s.shared_with_email !== email))
    toast.success('שיתוף הוסר')
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
              <h2 className="text-xl font-bold text-gray-900 mb-2">שובר מוצע למכירה</h2>
              <p className="text-sm text-gray-500 mb-6">שובר זה נעול כי הוצע למכירה בשוק. לא ניתן להשתמש בו עד שיוסר מהמכירה.</p>
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
                      toast.success('הוסר מהמכירה — השובר זמין לשימוש')
                      setLockConfirmed(false)
                      // Refresh voucher state
                      window.location.reload()
                    }
                  } catch {
                    toast.error('שגיאה בהסרה מהמכירה')
                  } finally {
                    setRemovingFromSale(false)
                  }
                }}
                className="w-full flex items-center justify-center gap-2 bg-red-500 text-white py-3.5 rounded-2xl font-semibold shadow-md hover:bg-red-600 transition-all disabled:opacity-50"
              >
                {removingFromSale ? <Loader2 className="w-4 h-4 animate-spin" /> : <X className="w-4 h-4" />}
                הסר ממכירה
              </button>
              <button
                onClick={() => navigate('/market')}
                className="w-full mt-3 py-3 text-blue-500 text-sm font-medium hover:text-blue-700"
              >
                עבור לשוק
              </button>
              <button
                onClick={() => navigate(-1)}
                className="w-full mt-1 py-3 text-gray-500 text-sm font-medium hover:text-gray-700"
              >
                חזור
              </button>
            </div>
          ) : (
            /* Regular lock: allow unlock */
            <div className="bg-white rounded-3xl shadow-lg border border-orange-200 p-8 max-w-sm w-full text-center">
              <div className="w-16 h-16 bg-orange-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <Lock className="w-8 h-8 text-orange-500" />
              </div>
              <h2 className="text-xl font-bold text-gray-900 mb-2">שובר נעול</h2>
              {voucher.lock_reason ? (
                <div className="bg-orange-50 border border-orange-200 rounded-2xl p-4 mb-6 text-right">
                  <p className="text-xs text-orange-600 font-medium mb-1">סיבת נעילה:</p>
                  <p className="text-sm text-orange-800 font-medium">{voucher.lock_reason}</p>
                </div>
              ) : (
                <p className="text-sm text-gray-500 mb-6">שובר זה נעול ומיועד לשימוש עתידי</p>
              )}
              <p className="text-xs text-gray-400 mb-6">לחץ על הכפתור כדי לפתוח את השובר ולהשתמש בו</p>
              <button
                onClick={() => setLockConfirmed(true)}
                className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-orange-400 to-amber-500 text-white py-3.5 rounded-2xl font-semibold shadow-md hover:shadow-lg transition-all"
              >
                <Unlock className="w-4 h-4" />
                פתח שובר
              </button>
              <button
                onClick={() => navigate(-1)}
                className="w-full mt-3 py-3 text-gray-500 text-sm font-medium hover:text-gray-700"
              >
                חזור
              </button>
            </div>
          )}
        </div>
      </div>
    )
  }

  async function handleListForSale() {
    const price = parseFloat(sellPrice)
    if (!price || price <= 0) { toast.error('הזן מחיר תקין'); return }
    // Check payment methods
    const methods = profile?.marketplace_payment_methods || []
    if (methods.length === 0) {
      toast.error('הגדר שיטת תשלום בהגדרות תחילה')
      navigate('/settings')
      return
    }
    setSellLoading(true)
    try {
      await listForSale(voucher!.id, price, sellDescription || undefined)
      toast.success('השובר הוצע למכירה!')
      setShowSellModal(false)
      setSellPrice('')
      setSellDescription('')
      // Reload to reflect locked state
      window.location.reload()
    } catch (err: any) {
      const msg = err?.message || ''
      if (msg.includes('already_listed')) toast.error('שובר זה כבר מוצע למכירה')
      else toast.error('שגיאה בהצעת השובר למכירה')
    } finally {
      setSellLoading(false)
    }
  }

  return (
    <div className="flex-1 bg-gray-50">
      {/* Sell modal */}
      {showSellModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end justify-center" onClick={() => setShowSellModal(false)}>
          <div className="bg-white rounded-t-3xl w-full max-w-2xl p-6 space-y-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h2 className="font-bold text-lg flex items-center gap-2">
                <ShoppingBag className="w-5 h-5 text-green-600" />
                הצע שובר למכירה
              </h2>
              <button onClick={() => setShowSellModal(false)} className="p-2 rounded-full hover:bg-gray-100">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="bg-gray-50 rounded-2xl p-4 space-y-1">
              <p className="font-semibold">{voucher!.store_name}</p>
              <p className="text-sm text-gray-500">יתרה: ₪{voucher!.balance}</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">מחיר מבוקש (₪)</label>
              <input
                type="number"
                inputMode="decimal"
                value={sellPrice}
                onChange={e => setSellPrice(e.target.value)}
                placeholder="לדוגמה: 80"
                className="w-full border rounded-xl px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-green-400"
                dir="ltr"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">תיאור (אופציונלי)</label>
              <textarea
                value={sellDescription}
                onChange={e => setSellDescription(e.target.value)}
                placeholder="מידע נוסף על השובר..."
                className="w-full border rounded-xl px-4 py-3 text-sm resize-none h-20 focus:outline-none focus:ring-2 focus:ring-green-400"
              />
            </div>
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-700">
              השובר יינעל לשימוש אישי עד שיוסר מהמכירה. שיטות התשלום שהגדרת בפרופיל יוצגו לקונים.
            </div>
            <button
              onClick={handleListForSale}
              disabled={sellLoading || !sellPrice}
              className="w-full py-3 bg-green-600 text-white rounded-2xl font-semibold disabled:opacity-50"
            >
              {sellLoading ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : 'פרסם למכירה'}
            </button>
          </div>
        </div>
      )}

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
      {confirmDelete && (
        <ConfirmDialog
          title="מחיקת שובר"
          message="פעולה זו אינה ניתנת לביטול."
          onConfirm={async () => {
            setConfirmDelete(false)
            await deleteVoucher(voucher.id)
            toast.success('שובר נמחק')
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
            toast.success('שובר עודכן')
            setShowEditForm(false)
          }}
          onClose={() => setShowEditForm(false)}
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
          {!isSharedVoucher && !isArchived && (
            <button
              onClick={() => setShowEditForm(true)}
              className="p-2 rounded-full hover:bg-gray-100 text-blue-500"
              aria-label="ערוך שובר"
            >
              <Edit2 className="w-5 h-5" />
            </button>
          )}
          {!isSharedVoucher && !isArchived && !voucher.is_locked && (
            <button
              onClick={() => setShowSellModal(true)}
              className="p-2 rounded-full hover:bg-gray-100 text-green-600"
              aria-label="הצע למכירה"
            >
              <ShoppingBag className="w-5 h-5" />
            </button>
          )}
          {!isArchived && (
            <button
              onClick={() => setConfirmArchive(true)}
              className="p-2 rounded-full hover:bg-gray-100 text-gray-500"
              aria-label="העבר לארכיון"
            >
              <Archive className="w-5 h-5" />
            </button>
          )}
          {!isSharedVoucher && (
            <button
              onClick={() => setConfirmDelete(true)}
              className="p-2 rounded-full hover:bg-gray-100 text-red-500"
              aria-label="מחק שובר"
            >
              <Trash2 className="w-5 h-5" />
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

            {voucher.link && (
              <a
                href={voucher.link}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 px-5 py-2.5 rounded-2xl text-sm font-medium bg-blue-50 text-blue-600 hover:bg-blue-100"
              >
                <ExternalLink className="w-4 h-4" />
                פתח קישור
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
            <div className="text-right">
              <div className="text-3xl font-bold text-gray-900">{formatCurrency(voucher.balance)}</div>
              {profile?.show_voucher_value && voucher.value_percent != null && voucher.value_percent > 0 && voucher.value_percent < 100 && (
                <div className="text-xs text-gray-400 mt-0.5">ערך {voucher.value_percent.toFixed(0)}%{voucher.actual_cost != null ? ` | עלה ${voucher.actual_cost.toLocaleString('he-IL')} ₪` : ''}</div>
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
              {voucher.expiry_date && <span className="text-xs text-gray-400">({formatDate(voucher.expiry_date)})</span>}
            </div>
          )}

          {/* Quick amounts */}
          {!isArchived && (
            <>
              <div className="text-xs font-medium text-gray-500 mb-2">עדכן יתרה — ניכוי מהירה</div>

              {/* Shared store input for all balance updates */}
              <input
                type="text"
                value={customStore}
                onChange={e => setCustomStore(e.target.value)}
                placeholder="באיזה חנות השתמשת? (אופציונלי)"
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
                  מחצית
                </button>
                <button
                  onClick={() => {
                    updateBalance(0, voucher.balance, customStore.trim() || null)
                    setCustomStore('')
                  }}
                  className="py-2 bg-red-50 text-red-600 rounded-xl text-sm font-medium hover:bg-red-100 transition-all"
                >
                  מלא
                </button>
              </div>

              <div>
                <p className="text-xs font-medium text-gray-500 mb-1.5">סכום שימוש</p>
                <div className="flex gap-2 mb-2">
                  <input
                    type="number"
                    inputMode="decimal"
                    value={customAmount}
                    onChange={e => setCustomAmount(e.target.value)}
                    placeholder="סכום שימוש..."
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
                    עדכן
                  </button>
                </div>
                {(() => {
                  const amount = parseFloat(customAmount)
                  if (isNaN(amount) || amount <= 0) return null
                  const newBal = Math.max(0, voucher.balance - amount)
                  return (
                    <p className={`text-xs mt-1.5 font-medium ${newBal <= 0 ? 'text-red-500' : 'text-green-600'}`}>
                      יתרה חדשה: ₪{newBal.toLocaleString('he-IL')}
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
                חנויות המכבדות את {sv.name}
                {showStores ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
              </button>
              {sv.balance_check_url && (
                <a
                  href={sv.balance_check_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-blue-50 text-blue-600 rounded-xl font-medium hover:bg-blue-100"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  בדיקת יתרה
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
                      if (entry.details?.from != null && entry.details?.to != null) {
                        detail = `₪${Number(entry.details.from).toLocaleString('he-IL')} ← ₪${Number(entry.details.to).toLocaleString('he-IL')}`
                        if (entry.details?.store_used) detail += ` · ${entry.details.store_used}`
                      }
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
                    case 'gift_sent':
                      icon = <Mail className="w-3.5 h-3.5" />
                      dotColor = 'bg-pink-500 text-white'
                      label = 'מתנה נשלחה'
                      if (entry.details?.recipient) detail = `ל: ${entry.details.recipient}`
                      break
                    case 'gift_link':
                      icon = <Link2 className="w-3.5 h-3.5" />
                      dotColor = 'bg-pink-400 text-white'
                      label = 'קישור מתנה נוצר'
                      break
                    case 'gift_received':
                      icon = <Gift className="w-3.5 h-3.5" />
                      dotColor = 'bg-rose-500 text-white'
                      label = 'מתנה התקבלה'
                      if (entry.details?.sender) detail = `מ: ${entry.details.sender}`
                      break
                    case 'gift_balance_update':
                      icon = <MinusCircle className="w-3.5 h-3.5" />
                      dotColor = 'bg-pink-600 text-white'
                      label = 'עדכון יתרה (מתנה)'
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
              <h3 className="text-base font-bold text-gray-800">שיתוף שובר</h3>
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
                  <Link2 className="w-3.5 h-3.5" /> בלינק
                </button>
                <button
                  onClick={() => setShareTab('user')}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-medium transition-all ${shareTab === 'user' ? 'bg-white text-purple-700 shadow-sm' : 'text-gray-500'}`}
                >
                  <Users className="w-3.5 h-3.5" /> משתמש
                </button>
                <button
                  onClick={() => { setShareTab('gift'); loadPendingGifts() }}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-medium transition-all ${shareTab === 'gift' ? 'bg-white text-green-700 shadow-sm' : 'text-gray-500'}`}
                >
                  <Gift className="w-3.5 h-3.5" /> שלח מתנה
                </button>
              </div>
            )}

            {/* ── Link tab ── */}
            {shareTab === 'link' && (
              <>
                <p className="text-sm text-gray-500 mb-4">
                  צור לינק ייחודי לשיתוף השובר. מי שיקבל את הלינק יוכל לראות את הקוד.
                </p>

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
              </>
            )}

            {/* ── User tab ── */}
            {shareTab === 'user' && !isSharedVoucher && (
              <div className="space-y-4">
                <p className="text-sm text-gray-500">
                  שתף שובר זה עם משתמש רשום — הם יראו אותו בלשונית "שותף איתי" ויוכלו לעדכן יתרה.
                </p>

                {/* "User not found" confirm */}
                {pendingShareEmail && (
                  <div className="bg-orange-50 rounded-2xl p-3 space-y-2">
                    <p className="text-sm text-orange-700">
                      המשתמש <strong>{pendingShareEmail}</strong> אינו רשום באפליקציה.
                      לשלוח הזמנה?
                    </p>
                    <div className="flex gap-2">
                      <button
                        onClick={handleSendVoucherInvite}
                        className="flex-1 bg-orange-500 text-white py-2 rounded-xl text-sm font-medium"
                      >
                        שלח הזמנה
                      </button>
                      <button
                        onClick={() => { setPendingShareEmail(null); setShareEmail('') }}
                        className="flex-1 bg-gray-100 text-gray-600 py-2 rounded-xl text-sm font-medium"
                      >
                        ביטול
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
                        placeholder="כתובת מייל"
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
                        : 'שתף'}
                    </button>
                  </div>
                )}

                {/* Existing user shares */}
                {sharesLoaded && voucherShares.length > 0 && (
                  <div className="space-y-1">
                    <p className="text-xs font-medium text-gray-500">שותף עם:</p>
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
                  שלח שובר זה כמתנה — הנמען יוכל לצפות ולהוסיפו לארנק שלו. השובר יועבר לארכיון כשייתבע.
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
                    צור קישור
                  </button>
                  <button
                    onClick={() => { setGiftMode('email'); setGiftLink(null) }}
                    className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-medium rounded-xl transition-all ${
                      giftMode === 'email' ? 'bg-white shadow text-green-600' : 'text-gray-500'
                    }`}
                  >
                    <Mail className="w-3.5 h-3.5" />
                    שלח למייל
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
                      placeholder="מייל הנמען"
                      className="w-full pr-9 pl-3 py-2.5 border border-gray-200 rounded-xl text-base focus:outline-none focus:ring-2 focus:ring-green-300"
                      dir="ltr"
                    />
                  </div>
                )}

                {/* Personal message */}
                <textarea
                  value={giftMessage}
                  onChange={e => setGiftMessage(e.target.value)}
                  placeholder="הודעה אישית (אופציונלי)"
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
                      תזמן לתאריך ספציפי
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
                  {giftSending ? 'יוצר...' : giftMode === 'link' ? 'צור קישור מתנה' : giftScheduled && giftDate ? 'תזמן שליחה' : 'שלח מתנה עכשיו'}
                </button>

                {/* Created link display */}
                {giftLink && (
                  <div className="bg-green-50 border border-green-200 rounded-2xl p-3 space-y-2">
                    <p className="text-xs font-medium text-green-700">🎁 קישור המתנה (שתף עם הנמען):</p>
                    <div className="flex items-center gap-2">
                      <p className="text-xs text-green-800 font-mono break-all flex-1">{giftLink}</p>
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(giftLink).catch(() => {})
                          toast.success('הועתק!')
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
                    <p className="text-xs font-medium text-gray-500">מתנות שטרם נתבעו:</p>
                    {pendingGifts.map(g => (
                      <div key={g.id} className="flex items-center justify-between py-2 border-b last:border-0">
                        <div>
                          <p className="text-sm text-gray-700">
                            {g.recipient_email || <span className="text-gray-400 italic">קישור בלבד</span>}
                          </p>
                          <p className="text-xs text-gray-400">
                            {g.email_sent_at ? 'נשלח' : `מתוזמן: ${new Date(g.send_at).toLocaleDateString('he-IL')}`}
                          </p>
                        </div>
                        <button
                          onClick={() => handleCancelGift(g.id)}
                          className="p-1.5 text-red-400 hover:bg-red-50 rounded-lg"
                          title="בטל מתנה"
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
