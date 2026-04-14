import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMarketplace } from '../contexts/MarketplaceContext'
import { useAuth } from '../contexts/AuthContext'
import { formatDate } from '../utils/helpers'
import { ShoppingBag, Search, Star, X, Clock, CheckCircle, Loader2, Tag, Flag, AlertCircle } from 'lucide-react'
import type { MarketplaceListing, MarketplacePurchase } from '../types'
import toast from 'react-hot-toast'

// ─── Rating Stars ────────────────────────────────────────────────────────────
function StarRating({ value, max = 5, onChange }: { value: number; max?: number; onChange?: (v: number) => void }) {
  return (
    <div className="flex gap-0.5">
      {Array.from({ length: max }).map((_, i) => (
        <button
          key={i}
          type="button"
          disabled={!onChange}
          onClick={() => onChange?.(i + 1)}
          className={`${onChange ? 'cursor-pointer' : 'cursor-default'} focus:outline-none`}
          aria-label={`${i + 1} כוכבים`}
        >
          <Star
            className={`w-5 h-5 ${i < value ? 'text-yellow-400 fill-yellow-400' : 'text-gray-300'}`}
          />
        </button>
      ))}
    </div>
  )
}

// ─── Rate Modal ───────────────────────────────────────────────────────────────
function RateModal({
  purchase,
  onClose,
}: {
  purchase: MarketplacePurchase
  onClose: () => void
}) {
  const { rateUser } = useMarketplace()
  const [rating, setRating] = useState(purchase.my_rating ?? 0)
  const [comment, setComment] = useState('')
  const [saving, setSaving] = useState(false)

  async function submit() {
    if (rating === 0) { toast.error('בחר דירוג'); return }
    setSaving(true)
    try {
      await rateUser(purchase.purchase_id, purchase.seller_id!, rating, comment || undefined)
      toast.success('הדירוג נשמר')
      onClose()
    } catch {
      toast.error('שגיאה בשמירת הדירוג')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-end justify-center" onClick={onClose}>
      <div className="bg-white rounded-t-3xl w-full max-w-2xl p-6 space-y-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="font-bold text-lg">דרג את המוכר</h2>
          <button onClick={onClose} className="p-2 rounded-full hover:bg-gray-100"><X className="w-5 h-5" /></button>
        </div>
        <p className="text-sm text-gray-500">{purchase.seller_name || purchase.seller_email} · {purchase.store_name}</p>
        <StarRating value={rating} onChange={setRating} />
        <textarea
          className="w-full border rounded-xl p-3 text-sm resize-none h-20 focus:outline-none focus:ring-2 focus:ring-green-400"
          placeholder="הוסף תגובה (אופציונלי)..."
          value={comment}
          onChange={e => setComment(e.target.value)}
        />
        <button
          onClick={submit}
          disabled={saving || rating === 0}
          className="w-full py-3 bg-green-600 text-white rounded-2xl font-semibold disabled:opacity-50"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : 'שמור דירוג'}
        </button>
      </div>
    </div>
  )
}

// ─── Report Modal ─────────────────────────────────────────────────────────────
function ReportModal({
  reportedUserId,
  reportedName,
  purchaseId,
  listingId,
  onClose,
}: {
  reportedUserId: string
  reportedName: string
  purchaseId?: string
  listingId?: string
  onClose: () => void
}) {
  const { reportUser } = useMarketplace()
  const [reason, setReason] = useState('')
  const [details, setDetails] = useState('')
  const [saving, setSaving] = useState(false)

  const reasons = [
    'תשלום לא התקבל',
    'שובר לא תקין / פג תוקף',
    'הונאה / מרמה',
    'התנהגות פוגעת',
    'מידע כוזב במודעה',
    'אחר',
  ]

  async function submit() {
    if (!reason) { toast.error('בחר סיבה'); return }
    setSaving(true)
    try {
      await reportUser(reportedUserId, reason, details || undefined, purchaseId, listingId)
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
      <div className="bg-white rounded-t-3xl w-full max-w-2xl p-6 space-y-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="font-bold text-lg flex items-center gap-2"><Flag className="w-5 h-5 text-red-500" /> דווח על משתמש</h2>
          <button onClick={onClose} className="p-2 rounded-full hover:bg-gray-100"><X className="w-5 h-5" /></button>
        </div>
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
        <button
          onClick={submit}
          disabled={saving || !reason}
          className="w-full py-3 bg-red-600 text-white rounded-2xl font-semibold disabled:opacity-50"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : 'שלח דיווח'}
        </button>
      </div>
    </div>
  )
}

// ─── Listing Card (marketplace browse) ───────────────────────────────────────
function ListingCard({ listing, onClick }: { listing: MarketplaceListing; onClick: () => void }) {
  const expiryDate = listing.expiry_date ? new Date(listing.expiry_date) : null
  const isExpiringSoon = expiryDate ? (expiryDate.getTime() - Date.now()) / 86400000 < 30 : false

  return (
    <button
      onClick={onClick}
      className="w-full text-right bg-white rounded-2xl border border-gray-100 shadow-sm p-4 space-y-3 hover:shadow-md transition-shadow"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-gray-900 truncate">{listing.store_name}</p>
          {listing.description && (
            <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{listing.description}</p>
          )}
        </div>
        <div className="text-left shrink-0">
          <p className="text-lg font-bold text-green-600">₪{listing.asking_price}</p>
          <p className="text-xs text-gray-400">מחיר</p>
        </div>
      </div>

      <div className="flex items-center justify-between text-xs text-gray-500">
        <span>יתרה: <span className="font-semibold text-gray-800">₪{listing.balance}</span></span>
        {expiryDate && (
          <span className={`flex items-center gap-1 ${isExpiringSoon ? 'text-orange-500' : ''}`}>
            <Clock className="w-3 h-3" />
            {formatDate(listing.expiry_date!)}
          </span>
        )}
      </div>

      <div className="flex items-center justify-between border-t pt-2">
        <div className="flex items-center gap-1">
          <div className="w-6 h-6 bg-gradient-to-br from-green-400 to-teal-500 rounded-full flex items-center justify-center text-white text-xs font-bold">
            {(listing.seller_name || listing.seller_email || '?')[0].toUpperCase()}
          </div>
          <span className="text-xs text-gray-600 truncate max-w-[120px]">
            {listing.seller_name || listing.seller_email?.split('@')[0]}
          </span>
        </div>
        {(listing.avg_rating ?? 0) > 0 && (
          <div className="flex items-center gap-1">
            <Star className="w-3.5 h-3.5 text-yellow-400 fill-yellow-400" />
            <span className="text-xs font-medium">{Number(listing.avg_rating).toFixed(1)}</span>
            <span className="text-xs text-gray-400">({listing.rating_count})</span>
          </div>
        )}
      </div>
    </button>
  )
}

// ─── My Listing Row (seller view) ────────────────────────────────────────────
function MyListingRow({
  listing,
  onRemove,
  onConfirm,
  onReport,
}: {
  listing: MarketplaceListing
  onRemove: () => void
  onConfirm: () => void
  onReport: () => void
}) {
  const [removing, setRemoving] = useState(false)
  const [confirming, setConfirming] = useState(false)

  const statusLabel: Record<string, string> = {
    active: 'פעיל',
    pending_payment: 'ממתין לאישור',
    sold: 'נמכר',
    cancelled: 'בוטל',
  }
  const statusColor: Record<string, string> = {
    active: 'bg-green-100 text-green-700',
    pending_payment: 'bg-yellow-100 text-yellow-700',
    sold: 'bg-gray-100 text-gray-500',
    cancelled: 'bg-red-100 text-red-600',
  }

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-gray-900 truncate">{listing.store_name}</p>
          <p className="text-xs text-gray-500 mt-0.5">יתרה: ₪{listing.balance} · מחיר: ₪{listing.asking_price}</p>
        </div>
        <span className={`text-xs font-medium px-2 py-1 rounded-full ${statusColor[listing.status]}`}>
          {statusLabel[listing.status]}
        </span>
      </div>

      {/* Buyer confirmed payment — needs seller confirmation */}
      {listing.purchase_status === 'buyer_confirmed' && listing.buyer_name && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-3 space-y-2">
          <p className="text-sm font-medium text-yellow-800">
            {listing.buyer_name || listing.buyer_email} שלח/ה תשלום
          </p>
          {listing.payment_method_used && (
            <p className="text-xs text-yellow-700">
              שיטת תשלום: <span className="font-semibold">{listing.payment_method_used}</span>
            </p>
          )}
          <div className="flex gap-2">
            <button
              disabled={confirming}
              onClick={async () => {
                setConfirming(true)
                try { await onConfirm() } finally { setConfirming(false) }
              }}
              className="flex-1 py-2 bg-green-600 text-white rounded-xl text-sm font-semibold disabled:opacity-50"
            >
              {confirming ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : 'אשר קבלת תשלום'}
            </button>
            <button
              onClick={onReport}
              className="p-2 rounded-xl border border-red-200 text-red-500 hover:bg-red-50"
              aria-label="דווח על קונה"
            >
              <Flag className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Actions for active listing */}
      {listing.status === 'active' && !listing.purchase_status && (
        <button
          disabled={removing}
          onClick={async () => {
            setRemoving(true)
            try { await onRemove() } finally { setRemoving(false) }
          }}
          className="w-full py-2 border border-red-200 text-red-500 rounded-xl text-sm font-medium hover:bg-red-50 disabled:opacity-50"
        >
          {removing ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : 'הסר ממכירה'}
        </button>
      )}

      {listing.status === 'sold' && (
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <CheckCircle className="w-4 h-4 text-green-500" />
          השובר הועבר לקונה בהצלחה
        </div>
      )}
    </div>
  )
}

// ─── My Purchase Row (buyer view) ────────────────────────────────────────────
function MyPurchaseRow({
  purchase,
  onRate,
  onReport,
  onCancel,
}: {
  purchase: MarketplacePurchase
  onRate: () => void
  onReport: () => void
  onCancel: () => void
}) {
  const statusLabel: Record<string, string> = {
    pending_buyer_payment: 'ממתין לתשלום',
    buyer_confirmed: 'ממתין לאישור מוכר',
    completed: 'הושלם',
    cancelled: 'בוטל',
  }
  const statusColor: Record<string, string> = {
    pending_buyer_payment: 'bg-blue-100 text-blue-700',
    buyer_confirmed: 'bg-yellow-100 text-yellow-700',
    completed: 'bg-green-100 text-green-700',
    cancelled: 'bg-gray-100 text-gray-500',
  }

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-gray-900 truncate">{purchase.store_name}</p>
          <p className="text-xs text-gray-500 mt-0.5">
            ₪{purchase.asking_price} · מוכר: {purchase.seller_name || purchase.seller_email?.split('@')[0]}
          </p>
        </div>
        <span className={`text-xs font-medium px-2 py-1 rounded-full shrink-0 ${statusColor[purchase.status]}`}>
          {statusLabel[purchase.status]}
        </span>
      </div>

      {purchase.status === 'buyer_confirmed' && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-sm text-blue-700">
          <AlertCircle className="w-4 h-4 inline ml-1" />
          ממתין לאישור המוכר — הוא/היא יאשרו ברגע שיבדקו את התשלום
        </div>
      )}

      {purchase.status === 'completed' && (
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <CheckCircle className="w-4 h-4 text-green-500" />
          השובר הועבר לארנק שלך
        </div>
      )}

      <div className="flex gap-2 flex-wrap">
        {purchase.status === 'completed' && (
          <button
            onClick={onRate}
            className="flex-1 py-2 bg-yellow-50 border border-yellow-200 text-yellow-700 rounded-xl text-sm font-medium hover:bg-yellow-100 flex items-center justify-center gap-1"
          >
            <Star className="w-4 h-4" />
            {purchase.my_rating ? `דירגת (${purchase.my_rating}★)` : 'דרג מוכר'}
          </button>
        )}
        {(purchase.status === 'buyer_confirmed' || purchase.status === 'completed') && (
          <button
            onClick={onReport}
            className="p-2 rounded-xl border border-red-200 text-red-500 hover:bg-red-50"
            aria-label="דווח על מוכר"
          >
            <Flag className="w-4 h-4" />
          </button>
        )}
        {purchase.status === 'buyer_confirmed' && (
          <button
            onClick={onCancel}
            className="px-3 py-2 border border-gray-200 text-gray-500 rounded-xl text-sm hover:bg-gray-50"
          >
            בטל
          </button>
        )}
      </div>
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function MarketplacePage() {
  const navigate = useNavigate()
  useAuth()
  const {
    listings, myListings, myPurchases,
    loadingListings, loadingMyListings, loadingMyPurchases,
    fetchListings, fetchMyListings, fetchMyPurchases,
    removeFromSale, confirmPaymentReceived, cancelPurchase,
  } = useMarketplace()

  const [tab, setTab] = useState<'all' | 'mine' | 'purchases'>('all')
  const [search, setSearch] = useState('')
  const [ratingPurchase, setRatingPurchase] = useState<MarketplacePurchase | null>(null)
  const [reportTarget, setReportTarget] = useState<{
    userId: string
    name: string
    purchaseId?: string
    listingId?: string
  } | null>(null)

  // Load data when tab changes
  useEffect(() => {
    if (tab === 'all') fetchListings(search || undefined)
    else if (tab === 'mine') fetchMyListings()
    else fetchMyPurchases()
  }, [tab])

  // Re-fetch when search changes (debounced)
  useEffect(() => {
    if (tab !== 'all') return
    const t = setTimeout(() => fetchListings(search || undefined), 400)
    return () => clearTimeout(t)
  }, [search])

  return (
    <div className="flex-1 bg-gray-50" dir="rtl">
      {/* Header */}
      <div className="bg-white border-b sticky top-0 z-20">
        <div className="flex items-center gap-3 px-4 py-3">
          <ShoppingBag className="w-6 h-6 text-green-600" />
          <h1 className="font-bold text-xl text-gray-900 flex-1">שוק שוברים</h1>
        </div>
        {/* Tabs */}
        <div className="flex border-t">
          {([['all', 'כל השוברים'], ['mine', 'הרשימות שלי'], ['purchases', 'רכישות שלי']] as const).map(([t, label]) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex-1 py-2.5 text-sm font-medium transition-colors ${tab === t ? 'text-green-600 border-b-2 border-green-600' : 'text-gray-500 hover:text-gray-700'}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Search (all tab only) */}
      {tab === 'all' && (
        <div className="px-4 pt-4">
          <div className="relative">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              className="w-full border rounded-2xl pr-10 pl-4 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-green-400"
              placeholder="חפש לפי שם חנות..."
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            {search && (
              <button onClick={() => setSearch('')} className="absolute left-3 top-1/2 -translate-y-1/2">
                <X className="w-4 h-4 text-gray-400" />
              </button>
            )}
          </div>
        </div>
      )}

      <div className="p-4 space-y-3 pb-32">
        {/* ── All listings ── */}
        {tab === 'all' && (
          <>
            {loadingListings ? (
              <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-green-500" /></div>
            ) : listings.length === 0 ? (
              <div className="text-center py-12 text-gray-400 space-y-2">
                <Tag className="w-10 h-10 mx-auto opacity-40" />
                <p className="font-medium">אין שוברים למכירה כרגע</p>
                {search && <p className="text-sm">נסה לחפש מילה אחרת</p>}
              </div>
            ) : (
              listings.map(l => (
                <ListingCard
                  key={l.id}
                  listing={l}
                  onClick={() => navigate(`/market/listing/${l.id}`)}
                />
              ))
            )}
          </>
        )}

        {/* ── My listings ── */}
        {tab === 'mine' && (
          <>
            {loadingMyListings ? (
              <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-green-500" /></div>
            ) : myListings.length === 0 ? (
              <div className="text-center py-12 text-gray-400 space-y-2">
                <ShoppingBag className="w-10 h-10 mx-auto opacity-40" />
                <p className="font-medium">לא הצעת שוברים למכירה</p>
                <p className="text-sm">פתח שובר ולחץ "הצע למכירה"</p>
              </div>
            ) : (
              myListings.map(l => (
                <MyListingRow
                  key={l.id}
                  listing={l}
                  onRemove={async () => {
                    try {
                      await removeFromSale(l.id)
                      toast.success('הוסר מהמכירה')
                    } catch {
                      toast.error('שגיאה בהסרה')
                    }
                  }}
                  onConfirm={async () => {
                    try {
                      await confirmPaymentReceived(l.purchase_id!)
                      toast.success('אושר! השובר הועבר לקונה')
                    } catch {
                      toast.error('שגיאה באישור')
                    }
                  }}
                  onReport={() => setReportTarget({
                    userId: l.purchase_id ? (l.buyer_email || '') : '',
                    name: l.buyer_name || l.buyer_email || 'קונה',
                    purchaseId: l.purchase_id,
                    listingId: l.id,
                  })}
                />
              ))
            )}
          </>
        )}

        {/* ── My purchases ── */}
        {tab === 'purchases' && (
          <>
            {loadingMyPurchases ? (
              <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-green-500" /></div>
            ) : myPurchases.length === 0 ? (
              <div className="text-center py-12 text-gray-400 space-y-2">
                <ShoppingBag className="w-10 h-10 mx-auto opacity-40" />
                <p className="font-medium">טרם ביצעת רכישות</p>
              </div>
            ) : (
              myPurchases.map(p => (
                <MyPurchaseRow
                  key={p.purchase_id}
                  purchase={p}
                  onRate={() => setRatingPurchase(p)}
                  onReport={() => setReportTarget({
                    userId: p.seller_id!,
                    name: p.seller_name || p.seller_email || 'מוכר',
                    purchaseId: p.purchase_id,
                  })}
                  onCancel={async () => {
                    try {
                      await cancelPurchase(p.purchase_id)
                      toast.success('הרכישה בוטלה')
                    } catch {
                      toast.error('שגיאה בביטול')
                    }
                  }}
                />
              ))
            )}
          </>
        )}
      </div>

      {/* Modals */}
      {ratingPurchase && (
        <RateModal purchase={ratingPurchase} onClose={() => setRatingPurchase(null)} />
      )}
      {reportTarget && (
        <ReportModal
          reportedUserId={reportTarget.userId}
          reportedName={reportTarget.name}
          purchaseId={reportTarget.purchaseId}
          listingId={reportTarget.listingId}
          onClose={() => setReportTarget(null)}
        />
      )}
    </div>
  )
}
