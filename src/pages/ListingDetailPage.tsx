import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useMarketplace } from '../contexts/MarketplaceContext'
import { useAuth } from '../contexts/AuthContext'
import { formatDate } from '../utils/helpers'
import {
  ArrowRight, Star, Clock, ShoppingBag, X, Loader2, Flag,
  Phone, Mail, CheckCircle, AlertTriangle, MessageCircle, ExternalLink,
} from 'lucide-react'
import type { MarketplaceListing, PaymentMethod } from '../types'
import { PAYMENT_METHOD_LABELS } from '../types'
import ChatModal from '../components/ChatModal'
import { useBodyScrollLock } from '../hooks/useBodyScrollLock'
import toast from 'react-hot-toast'

// ─── Payment link builder ─────────────────────────────────────────────────────
function buildPaymentLink(method: PaymentMethod, amount: number, description: string): string | null {
  const cleanPhone = method.value.replace(/[\s\-().+]/g, '')
  const encodedDesc = encodeURIComponent(description)

  switch (method.type) {
    case 'bit':
      // Bit (Bank Hapoalim) — deep link to payment page
      return `https://bitpay.page.link/?phone=${cleanPhone}&amount=${amount}&description=${encodedDesc}`
    case 'paypal': {
      // PayPal.me — use email prefix or full handle
      const handle = method.value.includes('@')
        ? method.value.split('@')[0]
        : method.value
      return `https://www.paypal.com/paypalme/${encodeURIComponent(handle)}/${amount}`
    }
    case 'paybox':
      return `https://payboxapp.page.link/pay?action=charge&phone=${cleanPhone}&amount=${amount}&description=${encodedDesc}`
    case 'cashcash':
      return `https://link.cashcash.co.il/?phone=${cleanPhone}&amount=${amount}&description=${encodedDesc}`
    default:
      return null
  }
}

const METHOD_COLORS: Record<PaymentMethod['type'], string> = {
  paypal:   'bg-blue-500',
  bit:      'bg-purple-600',
  paybox:   'bg-orange-500',
  cashcash: 'bg-teal-500',
  other:    'bg-gray-500',
}

// ─── Report Modal ─────────────────────────────────────────────────────────────
function ReportModal({
  reportedUserId,
  reportedName,
  listingId,
  onClose,
}: {
  reportedUserId: string
  reportedName: string
  listingId: string
  onClose: () => void
}) {
  const { reportUser } = useMarketplace()
  const [reason, setReason] = useState('')
  const [details, setDetails] = useState('')
  const [saving, setSaving] = useState(false)
  useBodyScrollLock()

  const reasons = [
    'מידע כוזב במודעה',
    'שובר לא תקין / פג תוקף',
    'הונאה / מרמה',
    'התנהגות פוגעת',
    'אחר',
  ]

  async function submit() {
    if (!reason) { toast.error('בחר סיבה'); return }
    setSaving(true)
    try {
      await reportUser(reportedUserId, reason, details || undefined, undefined, listingId)
      toast.success('הדיווח נשלח למנהל')
      onClose()
    } catch {
      toast.error('שגיאה בשליחת הדיווח')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-[100] flex items-end justify-center overflow-hidden" onClick={onClose}>
      <div
        className="bg-white rounded-t-3xl w-full max-w-2xl flex flex-col max-h-[85dvh]"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-6 pb-4 shrink-0">
          <h2 className="font-bold text-lg flex items-center gap-2">
            <Flag className="w-5 h-5 text-red-500" /> דווח על מוכר
          </h2>
          <button onClick={onClose} className="p-2 rounded-full hover:bg-gray-100">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="modal-scroll overflow-y-auto flex-1 min-h-0 px-6 pb-4 space-y-3">
          <p className="text-sm text-gray-500">דיווח על: {reportedName}</p>
          <div className="space-y-2">
            {reasons.map(r => (
              <button
                key={r}
                onClick={() => setReason(r)}
                className={`w-full text-right px-4 py-2.5 rounded-xl border text-sm transition-colors ${
                  reason === r ? 'border-red-500 bg-red-50 text-red-700 font-medium' : 'border-gray-200 hover:bg-gray-50'
                }`}
              >
                {r}
              </button>
            ))}
          </div>
          <textarea
            className="w-full border rounded-xl p-3 text-sm resize-none h-20 focus:outline-none focus:ring-2 focus:ring-red-400"
            placeholder="פרטים נוספים (אופציונלי)..."
            value={details}
            onChange={e => setDetails(e.target.value)}
          />
        </div>

        {/* Sticky footer */}
        <div className="px-6 pb-6 pt-3 shrink-0 border-t border-gray-100">
          <button
            onClick={submit}
            disabled={saving || !reason}
            className="w-full py-3 bg-red-600 text-white rounded-2xl font-semibold disabled:opacity-50"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : 'שלח דיווח'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Buy Modal ────────────────────────────────────────────────────────────────
function BuyModal({
  listing,
  onClose,
  onSuccess,
  onChat,
}: {
  listing: MarketplaceListing
  onClose: () => void
  onSuccess: () => void
  onChat: () => void
}) {
  const { confirmPaymentSent } = useMarketplace()
  const [selectedMethod, setSelectedMethod] = useState<PaymentMethod | null>(null)
  const [sending, setSending] = useState(false)
  useBodyScrollLock()

  const methods: PaymentMethod[] = listing.seller_payment_methods || []
  const paymentLink = selectedMethod
    ? buildPaymentLink(
        selectedMethod,
        listing.asking_price!,
        `שובר ${listing.store_name} ₪${listing.balance}`,
      )
    : null

  async function handleConfirm() {
    if (!selectedMethod) { toast.error('בחר שיטת תשלום'); return }
    setSending(true)
    try {
      await confirmPaymentSent(listing.id, PAYMENT_METHOD_LABELS[selectedMethod.type])
      toast.success('אישרת ששלחת תשלום. ממתין לאישור המוכר.')
      onSuccess()
    } catch (err: any) {
      const msg = err?.message || ''
      if (msg.includes('already_purchased')) toast.error('כבר ביצעת רכישה עבור מודעה זו')
      else if (msg.includes('cannot_buy_own_listing')) toast.error('לא ניתן לקנות מודעה משלך')
      else toast.error('שגיאה בביצוע הרכישה')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-[100] flex items-end justify-center overflow-hidden" onClick={onClose}>
      <div
        className="bg-white rounded-t-3xl w-full max-w-2xl flex flex-col max-h-[90dvh]"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-6 pb-4 shrink-0">
          <h2 className="font-bold text-lg">קנה את השובר</h2>
          <button onClick={onClose} className="p-2 rounded-full hover:bg-gray-100">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="modal-scroll overflow-y-auto flex-1 min-h-0 px-6 pb-4 space-y-4">
          {/* Voucher summary */}
          <div className="bg-gray-50 rounded-2xl p-4 space-y-1">
            <p className="font-semibold">{listing.store_name}</p>
            <p className="text-sm text-gray-500">
              יתרה: ₪{listing.balance} · מחיר:{' '}
              <span className="text-green-600 font-bold">₪{listing.asking_price}</span>
            </p>
          </div>

          {/* Chat link */}
          <button
            onClick={() => { onClose(); onChat() }}
            className="w-full flex items-center gap-2 p-3 rounded-xl border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 transition-colors"
          >
            <MessageCircle className="w-4 h-4 text-green-600" />
            <span>שאל שאלה או התמקח על המחיר</span>
          </button>

          <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-sm text-amber-800 flex gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>שלח/י תשלום למוכר ישירות, לאחר מכן חזור/י לכאן ואשר/י.</span>
          </div>

          {/* Payment methods */}
          <div className="space-y-2">
            <p className="text-sm font-semibold text-gray-700">שיטות תשלום של המוכר:</p>
            {methods.length === 0 ? (
              <p className="text-sm text-gray-400">המוכר לא הגדיר שיטות תשלום</p>
            ) : (
              methods.map((m, i) => (
                <button
                  key={i}
                  onClick={() => setSelectedMethod(m)}
                  className={`w-full flex items-center gap-3 p-3 rounded-xl border text-right transition-colors ${
                    selectedMethod === m
                      ? 'border-green-500 bg-green-50'
                      : 'border-gray-200 hover:bg-gray-50'
                  }`}
                >
                  <div
                    className={`w-8 h-8 rounded-full flex items-center justify-center text-white font-bold text-xs shrink-0 ${METHOD_COLORS[m.type]}`}
                  >
                    {PAYMENT_METHOD_LABELS[m.type][0]}
                  </div>
                  <div className="flex-1 text-right">
                    <p className="text-sm font-medium">{PAYMENT_METHOD_LABELS[m.type]}</p>
                    <p className="text-xs text-gray-500">{m.value}</p>
                  </div>
                  {m.type === 'paypal' ? (
                    <Mail className="w-4 h-4 text-gray-400" />
                  ) : (
                    <Phone className="w-4 h-4 text-gray-400" />
                  )}
                  {selectedMethod === m && <CheckCircle className="w-5 h-5 text-green-500" />}
                </button>
              ))
            )}
          </div>

          {/* Selected method details + payment link */}
          {selectedMethod && (
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 space-y-3">
              <div className="space-y-1">
                <p className="text-sm font-semibold text-blue-800">
                  שלח/י ₪{listing.asking_price} דרך {PAYMENT_METHOD_LABELS[selectedMethod.type]} ל:
                </p>
                <p className="font-mono text-base text-blue-900">{selectedMethod.value}</p>
              </div>

              {paymentLink && (
                <a
                  href={paymentLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`flex items-center justify-center gap-2 w-full py-2.5 rounded-xl text-sm font-semibold text-white transition-opacity hover:opacity-90 ${METHOD_COLORS[selectedMethod.type]}`}
                >
                  <ExternalLink className="w-4 h-4" />
                  פתח ב-{PAYMENT_METHOD_LABELS[selectedMethod.type]} ושלח ₪{listing.asking_price}
                </a>
              )}
            </div>
          )}
        </div>

        {/* Sticky footer */}
        <div className="px-6 pb-6 pt-3 shrink-0 border-t border-gray-100">
          <button
            onClick={handleConfirm}
            disabled={sending || !selectedMethod || methods.length === 0}
            className="w-full py-3 bg-green-600 text-white rounded-2xl font-semibold disabled:opacity-50"
          >
            {sending
              ? <Loader2 className="w-4 h-4 animate-spin mx-auto" />
              : 'שלחתי את התשלום — המשך'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function ListingDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { user } = useAuth()
  const { listings, fetchListings } = useMarketplace()

  const [listing, setListing] = useState<MarketplaceListing | null>(null)
  const [loading, setLoading] = useState(true)
  const [showBuy, setShowBuy] = useState(false)
  const [showReport, setShowReport] = useState(false)
  const [showChat, setShowChat] = useState(false)
  const [purchased, setPurchased] = useState(false)
  const [currentPrice, setCurrentPrice] = useState<number | null>(null)

  // Try to find in context first, otherwise fetch directly
  useEffect(() => {
    if (!id) return

    const found = listings.find(l => l.id === id)
    if (found) {
      setListing(found)
      setCurrentPrice(found.asking_price ?? null)
      setLoading(false)
      return
    }

    setLoading(true)
    fetchListings().then(() => {
      setLoading(false)
    })
  }, [id])

  useEffect(() => {
    if (!id || loading) return
    const found = listings.find(l => l.id === id)
    if (found) {
      setListing(found)
      setCurrentPrice(p => p ?? (found.asking_price ?? null))
    }
  }, [listings, id, loading])

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-green-500" />
      </div>
    )
  }

  if (!listing) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-4 p-6 text-center" dir="rtl">
        <ShoppingBag className="w-12 h-12 text-gray-300" />
        <p className="font-medium text-gray-500">המודעה לא נמצאה או הוסרה</p>
        <button onClick={() => navigate('/market')} className="px-6 py-2 bg-green-600 text-white rounded-full text-sm font-medium">
          חזור לשוק
        </button>
      </div>
    )
  }

  const isOwnListing = listing.seller_id === user?.id
  const expiryDate = listing.expiry_date ? new Date(listing.expiry_date) : null
  const daysLeft = expiryDate ? Math.ceil((expiryDate.getTime() - Date.now()) / 86400000) : null
  const displayPrice = currentPrice ?? listing.asking_price

  return (
    <div className="flex-1 bg-gray-50" dir="rtl">
      {/* Header */}
      <div className="bg-white border-b sticky top-0 z-20">
        <div className="flex items-center gap-3 px-4 py-3">
          <button onClick={() => navigate(-1)} className="p-2 rounded-full hover:bg-gray-100">
            <ArrowRight className="w-5 h-5" />
          </button>
          <h1 className="font-bold text-lg flex-1">{listing.store_name}</h1>
          {!isOwnListing && listing.status === 'active' && (
            <button
              onClick={() => setShowChat(true)}
              className="p-2 rounded-full hover:bg-green-50 text-green-600"
              aria-label="שוחח עם המוכר"
            >
              <MessageCircle className="w-5 h-5" />
            </button>
          )}
          <button
            onClick={() => setShowReport(true)}
            className="p-2 rounded-full hover:bg-red-50 text-gray-400 hover:text-red-500"
            aria-label="דווח על מוכר"
          >
            <Flag className="w-5 h-5" />
          </button>
        </div>
      </div>

      <div className="p-4 space-y-4 pb-32">
        {/* Main info card */}
        <div className="bg-white rounded-2xl shadow-sm p-5 space-y-4">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-3xl font-bold text-green-600">₪{displayPrice}</p>
              <p className="text-sm text-gray-500 mt-1">מחיר מבוקש</p>
            </div>
            <div className="text-left">
              <p className="text-xl font-semibold text-gray-800">₪{listing.balance}</p>
              <p className="text-sm text-gray-500">יתרה בשובר</p>
            </div>
          </div>

          {expiryDate && (
            <div className={`flex items-center gap-2 text-sm ${daysLeft && daysLeft < 30 ? 'text-orange-600' : 'text-gray-500'}`}>
              <Clock className="w-4 h-4" />
              <span>
                תוקף עד: {formatDate(listing.expiry_date!)}
                {daysLeft !== null && daysLeft > 0 && ` · עוד ${daysLeft} ימים`}
              </span>
            </div>
          )}

          {listing.description && (
            <p className="text-sm text-gray-600 bg-gray-50 rounded-xl p-3">{listing.description}</p>
          )}
        </div>

        {/* Seller card */}
        <div className="bg-white rounded-2xl shadow-sm p-4">
          <p className="text-xs text-gray-400 font-medium mb-3">על המוכר</p>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-green-400 to-teal-500 rounded-full flex items-center justify-center text-white font-bold">
              {(listing.seller_name || listing.seller_email || '?')[0].toUpperCase()}
            </div>
            <div className="flex-1">
              <p className="font-medium text-gray-800">
                {listing.seller_name || listing.seller_email?.split('@')[0]}
              </p>
              {(listing.avg_rating ?? 0) > 0 ? (
                <div className="flex items-center gap-1 mt-0.5">
                  {[1,2,3,4,5].map(i => (
                    <Star
                      key={i}
                      className={`w-3.5 h-3.5 ${i <= Math.round(listing.avg_rating ?? 0) ? 'text-yellow-400 fill-yellow-400' : 'text-gray-300'}`}
                    />
                  ))}
                  <span className="text-xs text-gray-500 mr-1">
                    {Number(listing.avg_rating).toFixed(1)} ({listing.rating_count} דירוגים)
                  </span>
                </div>
              ) : (
                <p className="text-xs text-gray-400">טרם דורג</p>
              )}
            </div>
            {!isOwnListing && listing.status === 'active' && (
              <button
                onClick={() => setShowChat(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-green-200 text-green-700 text-xs font-medium hover:bg-green-50 transition-colors"
              >
                <MessageCircle className="w-3.5 h-3.5" />
                שוחח
              </button>
            )}
          </div>
        </div>

        {/* Payment methods preview */}
        {(listing.seller_payment_methods?.length ?? 0) > 0 && (
          <div className="bg-white rounded-2xl shadow-sm p-4">
            <p className="text-xs text-gray-400 font-medium mb-3">שיטות תשלום מקובלות</p>
            <div className="flex flex-wrap gap-2">
              {listing.seller_payment_methods!.map((m, i) => (
                <span
                  key={i}
                  className="text-xs font-medium px-3 py-1.5 bg-gray-100 text-gray-700 rounded-full"
                >
                  {PAYMENT_METHOD_LABELS[m.type]}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Purchased state */}
        {purchased && (
          <div className="bg-green-50 border border-green-200 rounded-2xl p-4 text-center space-y-2">
            <CheckCircle className="w-8 h-8 text-green-500 mx-auto" />
            <p className="font-semibold text-green-800">אישרת ששלחת תשלום!</p>
            <p className="text-sm text-green-600">המוכר יאשר את הקבלה בקרוב. עקוב אחר הסטטוס ב"רכישות שלי".</p>
            <button
              onClick={() => navigate('/market')}
              className="mt-1 text-sm text-green-700 underline"
            >
              עבור לרכישות שלי
            </button>
          </div>
        )}
      </div>

      {/* Buy button (sticky bottom) */}
      {!isOwnListing && !purchased && listing.status === 'active' && (
        <div className="fixed bottom-0 left-0 right-0 max-w-2xl mx-auto p-4 bg-white border-t">
          <button
            onClick={() => setShowBuy(true)}
            className="w-full py-3.5 bg-green-600 text-white rounded-2xl font-bold text-base shadow-lg hover:bg-green-700 transition-colors flex items-center justify-center gap-2"
          >
            <ShoppingBag className="w-5 h-5" />
            קנה עכשיו · ₪{displayPrice}
          </button>
        </div>
      )}

      {isOwnListing && (
        <div className="fixed bottom-0 left-0 right-0 max-w-2xl mx-auto p-4 bg-white border-t">
          <p className="text-center text-sm text-gray-500">זו מודעה שלך</p>
        </div>
      )}

      {listing.status !== 'active' && !isOwnListing && (
        <div className="fixed bottom-0 left-0 right-0 max-w-2xl mx-auto p-4 bg-white border-t">
          <p className="text-center text-sm text-gray-400">מודעה זו אינה זמינה לרכישה</p>
        </div>
      )}

      {/* Modals */}
      {showBuy && (
        <BuyModal
          listing={{ ...listing, asking_price: displayPrice }}
          onClose={() => setShowBuy(false)}
          onSuccess={() => {
            setShowBuy(false)
            setPurchased(true)
          }}
          onChat={() => setShowChat(true)}
        />
      )}
      {showReport && (
        <ReportModal
          reportedUserId={listing.seller_id}
          reportedName={listing.seller_name || listing.seller_email || 'מוכר'}
          listingId={listing.id}
          onClose={() => setShowReport(false)}
        />
      )}
      {showChat && !isOwnListing && (
        <ChatModal
          listingId={listing.id}
          otherUserId={listing.seller_id}
          otherUserName={listing.seller_name || listing.seller_email?.split('@')[0] || 'מוכר'}
          isSeller={false}
          currentAskingPrice={displayPrice ?? listing.asking_price ?? 0}
          storeName={listing.store_name ?? ''}
          onClose={() => setShowChat(false)}
          onPriceUpdated={(newPrice) => setCurrentPrice(newPrice)}
        />
      )}
    </div>
  )
}
