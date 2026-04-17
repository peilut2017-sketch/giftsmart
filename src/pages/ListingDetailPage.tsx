import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useMarketplace } from '../contexts/MarketplaceContext'
import { useAuth } from '../contexts/AuthContext'
import { formatDate } from '../utils/helpers'
import {
  ArrowRight, Star, Clock, ShoppingBag, X, Loader2,
  Flag, Phone, Mail, CheckCircle, AlertTriangle,
  MessageCircle, Send, Copy, ExternalLink,
} from 'lucide-react'
import type { MarketplaceListing, PaymentMethod, MarketplaceMessage } from '../types'
import { PAYMENT_METHOD_LABELS } from '../types'
import toast from 'react-hot-toast'

// ─── Payment deep-link helper ─────────────────────────────────────────────────
function getPaymentLink(method: PaymentMethod, amount: number): string | null {
  const val = encodeURIComponent(method.value)
  switch (method.type) {
    case 'paypal':
      // paypal.me username (no @) or email-based checkout
      if (!method.value.includes('@'))
        return `https://www.paypal.me/${val}/${amount}ILS`
      return `https://www.paypal.com/cgi-bin/webscr?cmd=_xclick&business=${val}&amount=${amount}&currency_code=ILS&no_shipping=1`
    case 'bit':
      return `https://bit.app.link/pay?amount=${amount}&phone=${val}`
    case 'paybox':
      return `https://payboxapp.page.link/pay?amount=${amount}&phone=${val}`
    case 'lavi':
      return `https://lavi.co.il/pay?to=${val}&amount=${amount}`
    case 'cashcash':
      return `https://www.cashcash.co.il/send?phone=${val}&amount=${amount}`
    default:
      return null
  }
}

// ─── Report Modal ─────────────────────────────────────────────────────────────
function ReportModal({
  reportedUserId, reportedName, listingId, onClose,
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

  const reasons = ['מידע כוזב במודעה', 'שובר לא תקין / פג תוקף', 'הונאה / מרמה', 'התנהגות פוגעת', 'אחר']

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
    <div className="fixed inset-0 bg-black/50 z-50 flex items-end justify-center" onClick={onClose}>
      <div
        className="bg-white rounded-t-3xl w-full max-w-2xl flex flex-col max-h-[calc(85dvh-4rem)] mb-16"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-6 pb-4 shrink-0">
          <h2 className="font-bold text-lg flex items-center gap-2">
            <Flag className="w-5 h-5 text-red-500" /> דווח על מוכר
          </h2>
          <button onClick={onClose} className="p-2 rounded-full hover:bg-gray-100"><X className="w-5 h-5" /></button>
        </div>
        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 space-y-3 pb-4">
          <p className="text-sm text-gray-500">דיווח על: {reportedName}</p>
          <div className="space-y-2">
            {reasons.map(r => (
              <button
                key={r}
                onClick={() => setReason(r)}
                className={`w-full text-right px-4 py-2.5 rounded-xl border text-sm transition-colors ${reason === r ? 'border-red-500 bg-red-50 text-red-700 font-medium' : 'border-gray-200 hover:bg-gray-50'}`}
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
        {/* Footer */}
        <div className="px-6 py-4 shrink-0 border-t border-gray-100">
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
  listing, onClose, onSuccess,
}: {
  listing: MarketplaceListing
  onClose: () => void
  onSuccess: () => void
}) {
  const { confirmPaymentSent } = useMarketplace()
  const [selectedMethod, setSelectedMethod] = useState<PaymentMethod | null>(null)
  const [sending, setSending] = useState(false)

  const methods: PaymentMethod[] = listing.seller_payment_methods || []

  async function handleConfirm() {
    if (!selectedMethod) { toast.error('בחר שיטת תשלום'); return }
    setSending(true)
    try {
      await confirmPaymentSent(listing.id, PAYMENT_METHOD_LABELS[selectedMethod.type])
      toast.success('אישרת ששלחת תשלום. ממתין לאישור המוכר.')
      onSuccess()
    } catch (err: unknown) {
      const msg = (err as { message?: string })?.message || ''
      if (msg.includes('already_purchased')) toast.error('כבר ביצעת רכישה עבור מודעה זו')
      else if (msg.includes('cannot_buy_own_listing')) toast.error('לא ניתן לקנות מודעה משלך')
      else toast.error('שגיאה בביצוע הרכישה')
    } finally {
      setSending(false)
    }
  }

  const payLink = selectedMethod ? getPaymentLink(selectedMethod, listing.asking_price ?? 0) : null
  const isPhoneBased = selectedMethod && selectedMethod.type !== 'paypal'

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-end justify-center" onClick={onClose}>
      <div
        className="bg-white rounded-t-3xl w-full max-w-2xl flex flex-col max-h-[calc(85dvh-4rem)] mb-16"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-6 pb-4 shrink-0">
          <h2 className="font-bold text-lg">קנה את השובר</h2>
          <button onClick={onClose} className="p-2 rounded-full hover:bg-gray-100"><X className="w-5 h-5" /></button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 space-y-4 pb-4">
          {/* Voucher summary */}
          <div className="bg-gray-50 rounded-2xl p-4 space-y-1">
            <p className="font-semibold">{listing.store_name}</p>
            <p className="text-sm text-gray-500">
              יתרה: ₪{listing.balance} · מחיר:{' '}
              <span className="text-green-600 font-bold">₪{listing.asking_price}</span>
            </p>
          </div>

          <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-sm text-amber-800 flex gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>שלח/י תשלום למוכר ישירות, לאחר מכן חזור/י לכאן ואשר/י.</span>
          </div>

          {/* Payment method selector */}
          <div className="space-y-2">
            <p className="text-sm font-semibold text-gray-700">שיטות תשלום של המוכר:</p>
            {methods.length === 0 ? (
              <p className="text-sm text-gray-400">המוכר לא הגדיר שיטות תשלום</p>
            ) : (
              methods.map((m, i) => {
                const colorMap: Record<string, string> = {
                  paypal: 'bg-blue-500', bit: 'bg-purple-500',
                  paybox: 'bg-orange-500', lavi: 'bg-emerald-500',
                  cashcash: 'bg-teal-500', other: 'bg-gray-500',
                }
                return (
                  <button
                    key={i}
                    onClick={() => setSelectedMethod(m)}
                    className={`w-full flex items-center gap-3 p-3 rounded-xl border text-right transition-colors ${selectedMethod === m ? 'border-green-500 bg-green-50' : 'border-gray-200 hover:bg-gray-50'}`}
                  >
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-white font-bold text-xs ${colorMap[m.type] ?? 'bg-gray-400'}`}>
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
                )
              })
            )}
          </div>

          {/* Payment instructions + deep link */}
          {selectedMethod && (
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 space-y-3">
              <p className="text-sm font-semibold text-blue-800">
                שלח/י ₪{listing.asking_price} דרך {PAYMENT_METHOD_LABELS[selectedMethod.type]} ל:
              </p>
              <p className="font-mono text-base text-blue-900 font-bold">{selectedMethod.value}</p>
              <div className="flex gap-2 flex-wrap">
                {/* Copy button */}
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(selectedMethod.value)
                    toast.success('הועתק!')
                  }}
                  className="flex items-center gap-1.5 px-3 py-2 bg-white border border-blue-200 text-blue-700 rounded-xl text-xs font-medium hover:bg-blue-50"
                >
                  <Copy className="w-3.5 h-3.5" />
                  העתק
                </button>
                {/* Phone dial link for phone-based methods */}
                {isPhoneBased && (
                  <a
                    href={`tel:${selectedMethod.value.replace(/\D/g, '')}`}
                    className="flex items-center gap-1.5 px-3 py-2 bg-white border border-blue-200 text-blue-700 rounded-xl text-xs font-medium hover:bg-blue-50"
                  >
                    <Phone className="w-3.5 h-3.5" />
                    חייג
                  </a>
                )}
                {/* App deep link */}
                {payLink && (
                  <a
                    href={payLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5 px-3 py-2 bg-blue-600 text-white rounded-xl text-xs font-medium hover:bg-blue-700"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    פתח {PAYMENT_METHOD_LABELS[selectedMethod.type]}
                  </a>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 shrink-0 border-t border-gray-100">
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

// ─── Chat Section (buyer ↔ seller pre-purchase) ───────────────────────────────
function ChatSection({
  listing,
}: {
  listing: MarketplaceListing
}) {
  const { user } = useAuth()
  const { chatMessages, fetchChatMessages, sendChatMessage } = useMarketplace()
  const [expanded, setExpanded] = useState(false)
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  const chatKey = `${listing.id}:${user?.id}`
  const messages: MarketplaceMessage[] = chatMessages[chatKey] || []

  useEffect(() => {
    if (expanded && user) fetchChatMessages(listing.id)
  }, [expanded, listing.id, user])   // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (expanded) bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length, expanded])

  async function handleSend() {
    const trimmed = text.trim()
    if (!trimmed || sending) return
    setSending(true)
    try {
      await sendChatMessage(listing.id, trimmed)
      setText('')
    } catch {
      toast.error('שגיאה בשליחת ההודעה')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
      <button
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center justify-between p-4 hover:bg-gray-50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <MessageCircle className="w-4 h-4 text-green-600" />
          <span className="text-sm font-medium text-gray-800">שאל/י את המוכר</span>
          {messages.length > 0 && (
            <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">
              {messages.length}
            </span>
          )}
        </div>
        <span className="text-gray-400 text-xs">{expanded ? '▲' : '▼'}</span>
      </button>

      {expanded && (
        <>
          {messages.length > 0 && (
            <div className="px-3 pb-2 space-y-2 max-h-52 overflow-y-auto border-t border-gray-50">
              <div className="pt-3" />
              {messages.map(msg => (
                <div key={msg.id} className={`flex ${msg.is_me ? 'justify-start' : 'justify-end'}`}>
                  {msg.is_system ? (
                    <div className="w-full text-center py-1">
                      <span className="text-xs text-gray-400 bg-gray-100 px-3 py-1 rounded-full">
                        {msg.message}
                      </span>
                    </div>
                  ) : (
                    <div
                      className={`max-w-[78%] rounded-2xl px-3 py-2 text-sm ${
                        msg.is_me
                          ? 'bg-green-600 text-white rounded-bl-sm'
                          : 'bg-gray-100 text-gray-800 rounded-br-sm'
                      }`}
                    >
                      {msg.message}
                    </div>
                  )}
                </div>
              ))}
              <div ref={bottomRef} />
            </div>
          )}

          <div className="p-3 flex gap-2 border-t border-gray-100">
            <input
              type="text"
              value={text}
              onChange={e => setText(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && !e.shiftKey && handleSend()}
              placeholder="שאל/י שאלה לפני הרכישה..."
              className="flex-1 border rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-400"
              dir="rtl"
            />
            <button
              onClick={handleSend}
              disabled={!text.trim() || sending}
              className="p-2.5 bg-green-600 text-white rounded-xl disabled:opacity-50"
            >
              {sending
                ? <Loader2 className="w-4 h-4 animate-spin" />
                : <Send className="w-4 h-4" />}
            </button>
          </div>
        </>
      )}
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
  const [purchased, setPurchased] = useState(false)

  useEffect(() => {
    if (!id) return
    const found = listings.find(l => l.id === id)
    if (found) { setListing(found); setLoading(false); return }
    setLoading(true)
    fetchListings().then(() => setLoading(false))
  }, [id])   // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!id || loading) return
    const found = listings.find(l => l.id === id)
    if (found) setListing(found)
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
        <button
          onClick={() => navigate('/market')}
          className="px-6 py-2 bg-green-600 text-white rounded-full text-sm font-medium"
        >
          חזור לשוק
        </button>
      </div>
    )
  }

  const isOwnListing = listing.seller_id === user?.id
  const expiryDate = listing.expiry_date ? new Date(listing.expiry_date) : null
  const daysLeft = expiryDate ? Math.ceil((expiryDate.getTime() - Date.now()) / 86400000) : null

  return (
    <div className="flex-1 bg-gray-50" dir="rtl">
      {/* Header */}
      <div className="bg-white border-b sticky top-0 z-20">
        <div className="flex items-center gap-3 px-4 py-3">
          <button onClick={() => navigate(-1)} className="p-2 rounded-full hover:bg-gray-100">
            <ArrowRight className="w-5 h-5" />
          </button>
          <h1 className="font-bold text-lg flex-1">{listing.store_name}</h1>
          <button
            onClick={() => setShowReport(true)}
            className="p-2 rounded-full hover:bg-red-50 text-gray-400 hover:text-red-500"
            aria-label="דווח על מוכר"
          >
            <Flag className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Content — pb-32 to clear the sticky buy button + nav */}
      <div className="p-4 space-y-4 pb-36">
        {/* Main info card */}
        <div className="bg-white rounded-2xl shadow-sm p-5 space-y-4">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-3xl font-bold text-green-600">₪{listing.asking_price}</p>
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
          </div>
        </div>

        {/* Payment methods preview */}
        {(listing.seller_payment_methods?.length ?? 0) > 0 && (
          <div className="bg-white rounded-2xl shadow-sm p-4">
            <p className="text-xs text-gray-400 font-medium mb-3">שיטות תשלום מקובלות</p>
            <div className="flex flex-wrap gap-2">
              {listing.seller_payment_methods!.map((m, i) => (
                <span key={i} className="text-xs font-medium px-3 py-1.5 bg-gray-100 text-gray-700 rounded-full">
                  {PAYMENT_METHOD_LABELS[m.type]}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Chat with seller (buyers only) */}
        {!isOwnListing && listing.status === 'active' && !purchased && (
          <ChatSection listing={listing} />
        )}

        {/* Purchased state */}
        {purchased && (
          <div className="bg-green-50 border border-green-200 rounded-2xl p-4 text-center space-y-2">
            <CheckCircle className="w-8 h-8 text-green-500 mx-auto" />
            <p className="font-semibold text-green-800">אישרת ששלחת תשלום!</p>
            <p className="text-sm text-green-600">המוכר יאשר את הקבלה בקרוב. עקוב ב"רכישות שלי".</p>
            <button onClick={() => navigate('/market')} className="mt-1 text-sm text-green-700 underline">
              עבור לרכישות שלי
            </button>
          </div>
        )}
      </div>

      {/* Sticky buy button — sits above bottom nav (bottom-16) */}
      {!isOwnListing && !purchased && listing.status === 'active' && (
        <div className="fixed bottom-16 left-0 right-0 max-w-2xl mx-auto p-4 bg-white border-t">
          <button
            onClick={() => setShowBuy(true)}
            className="w-full py-3.5 bg-green-600 text-white rounded-2xl font-bold text-base shadow-lg hover:bg-green-700 transition-colors flex items-center justify-center gap-2"
          >
            <ShoppingBag className="w-5 h-5" />
            קנה עכשיו · ₪{listing.asking_price}
          </button>
        </div>
      )}

      {isOwnListing && (
        <div className="fixed bottom-16 left-0 right-0 max-w-2xl mx-auto p-4 bg-white border-t">
          <p className="text-center text-sm text-gray-500">זו מודעה שלך</p>
        </div>
      )}

      {listing.status !== 'active' && !isOwnListing && !purchased && (
        <div className="fixed bottom-16 left-0 right-0 max-w-2xl mx-auto p-4 bg-white border-t">
          <p className="text-center text-sm text-gray-400">מודעה זו אינה זמינה לרכישה</p>
        </div>
      )}

      {/* Modals */}
      {showBuy && (
        <BuyModal
          listing={listing}
          onClose={() => setShowBuy(false)}
          onSuccess={() => { setShowBuy(false); setPurchased(true) }}
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
    </div>
  )
}
