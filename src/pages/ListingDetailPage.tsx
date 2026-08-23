import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useMarketplace } from '../contexts/MarketplaceContext'
import { useAuth } from '../contexts/AuthContext'
import { useT } from '../lib/i18n'
import { formatDate } from '../utils/helpers'
import type { MarketplaceListing, PaymentMethod } from '../types'
import { PAYMENT_METHOD_LABELS } from '../types'
import ChatModal from '../components/ChatModal'
import Icon from '../components/ui/Icon'
import Button from '../components/ui/Button'
import BottomSheet from '../components/ui/BottomSheet'
import toast from 'react-hot-toast'

// ─── Payment link builder ─────────────────────────────────────────────────────
function buildPaymentLink(method: PaymentMethod, amount: number, description: string): string | null {
  const cleanPhone = method.value.replace(/[\s\-().+]/g, '')
  const encodedDesc = encodeURIComponent(description)

  switch (method.type) {
    case 'paypal': {
      // PayPal.me — use email prefix or full handle
      const handle = method.value.includes('@')
        ? method.value.split('@')[0]
        : method.value
      return `https://www.paypal.com/paypalme/${encodeURIComponent(handle)}/${amount}`
    }
    case 'cashcash':
      return `https://link.cashcash.co.il/?phone=${cleanPhone}&amount=${amount}&description=${encodedDesc}`
    // Bit and PayBox have no public web payment URL — their old deep links were
    // built on Firebase Dynamic Links (*.page.link), shut down in August 2025,
    // so a button would land the buyer on an error page. The copy-number flow
    // (always rendered above the link) is the working path for both.
    case 'bit':
    case 'paybox':
    default:
      return null
  }
}

const METHOD_COLORS: Record<PaymentMethod['type'], string> = {
  paypal:   'bg-blue-500',
  bit:      'bg-purple-600',
  paybox:   'bg-orange-500',
  cashcash: 'bg-teal-500',
  lavi:     'bg-emerald-500',
  other:    'bg-text3',
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
  const { t } = useT()
  const [reason, setReason] = useState('')
  const [details, setDetails] = useState('')
  const [saving, setSaving] = useState(false)

  const reasons = [
    t('listing.report.reason.false_info'),
    t('listing.report.reason.invalid_voucher'),
    t('listing.report.reason.fraud'),
    t('listing.report.reason.offensive'),
    t('listing.report.reason.other'),
  ]

  async function submit() {
    if (!reason) { toast.error(t('listing.report.select_reason')); return }
    setSaving(true)
    try {
      await reportUser(reportedUserId, reason, details || undefined, undefined, listingId)
      toast.success(t('listing.report.sent'))
      onClose()
    } catch {
      toast.error(t('listing.report.error'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <BottomSheet
      open
      onClose={onClose}
      title={t('listing.report.title')}
      footer={
        <Button onClick={submit} disabled={saving || !reason} loading={saving} variant="danger" fullWidth>
          {t('listing.report.submit')}
        </Button>
      }
    >
      <div className="space-y-3">
        <p className="text-sm text-text3">{t('listing.report.about')}: {reportedName}</p>
        <div className="space-y-2">
          {reasons.map(r => (
            <button
              key={r}
              onClick={() => setReason(r)}
              className={`w-full text-right px-4 py-2.5 rounded-xl border text-sm transition-colors ${
                reason === r ? 'border-error bg-error/10 text-error font-medium' : 'border-border text-text2'
              }`}
            >
              {r}
            </button>
          ))}
        </div>
        <textarea
          className="w-full border border-border rounded-xl p-3 text-sm bg-surface text-text resize-none h-20 focus:outline-none focus:ring-2 focus:ring-error/30"
          placeholder={t('listing.report.details_placeholder')}
          value={details}
          onChange={e => setDetails(e.target.value)}
        />
      </div>
    </BottomSheet>
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
  const { t } = useT()
  const [selectedMethod, setSelectedMethod] = useState<PaymentMethod | null>(null)
  const [sending, setSending] = useState(false)
  const [copied, setCopied] = useState(false)

  // Reset copied state when payment method changes
  useEffect(() => { setCopied(false) }, [selectedMethod])

  const methods: PaymentMethod[] = listing.seller_payment_methods || []
  const paymentLink = selectedMethod
    ? buildPaymentLink(
        selectedMethod,
        listing.asking_price!,
        `שובר ${listing.store_name} ₪${listing.balance}`,
      )
    : null

  async function handleConfirm() {
    if (!selectedMethod) { toast.error(t('listing.buy.select_method')); return }
    setSending(true)
    try {
      await confirmPaymentSent(listing.id, PAYMENT_METHOD_LABELS[selectedMethod.type])
      toast.success(t('listing.buy.payment_sent'))
      onSuccess()
    } catch (err: any) {
      const msg = err?.message || ''
      if (msg.includes('already_purchased')) toast.error(t('listing.buy.already_purchased'))
      else if (msg.includes('cannot_buy_own_listing')) toast.error(t('listing.buy.own_listing'))
      else toast.error(t('listing.buy.error'))
    } finally {
      setSending(false)
    }
  }

  return (
    <BottomSheet
      open
      onClose={onClose}
      title={t('listing.buy.title')}
      className="max-h-[90dvh]"
      footer={
        <Button onClick={handleConfirm} disabled={sending || !selectedMethod || methods.length === 0} loading={sending} fullWidth>
          {t('listing.buy.confirm_button')}
        </Button>
      }
    >
      <div className="space-y-4">
        {/* Voucher summary */}
        <div className="bg-bg rounded-2xl p-4 space-y-1">
          <p className="font-semibold text-text">{listing.store_name}</p>
          <p className="text-sm text-text3">
            {t('listing.buy.balance_label')}: ₪{listing.balance} · {t('listing.buy.price_label')}:{' '}
            <span className="text-primary font-bold">₪{listing.asking_price}</span>
          </p>
        </div>

        {/* Chat link */}
        <button
          onClick={() => { onClose(); onChat() }}
          className="w-full flex items-center gap-2 p-3 rounded-xl border border-border text-sm text-text2"
        >
          <Icon name="chat" size={16} color="var(--c-primary)" />
          <span>{t('listing.buy.chat_prompt')}</span>
        </button>

        <div className="bg-warning/10 border border-warning/30 rounded-xl p-3 text-sm text-warning flex gap-2">
          <Icon name="warning" size={16} className="shrink-0 mt-0.5" />
          <span>{t('listing.buy.warning')}</span>
        </div>

        {/* Payment methods */}
        <div className="space-y-2">
          <p className="text-sm font-semibold text-text2">{t('listing.buy.methods_label')}</p>
          {methods.length === 0 ? (
            <p className="text-sm text-text3">{t('listing.buy.no_methods')}</p>
          ) : (
            methods.map((m, i) => (
              <button
                key={i}
                onClick={() => setSelectedMethod(m)}
                className={`w-full flex items-center gap-3 p-3 rounded-xl border text-right transition-colors ${
                  selectedMethod === m ? 'border-primary bg-primary-light' : 'border-border'
                }`}
              >
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-white font-bold text-xs shrink-0 ${METHOD_COLORS[m.type]}`}>
                  {PAYMENT_METHOD_LABELS[m.type][0]}
                </div>
                <div className="flex-1 text-right">
                  <p className="text-sm font-medium text-text">{PAYMENT_METHOD_LABELS[m.type]}</p>
                  <p className="text-xs text-text3">{m.value}</p>
                </div>
                <Icon name={m.type === 'paypal' ? 'mail' : 'call'} size={16} color="var(--c-text3)" />
                {selectedMethod === m && <Icon name="check_circle" size={20} filled color="var(--c-primary)" />}
              </button>
            ))
          )}
        </div>

        {/* Selected method details + payment link */}
        {selectedMethod && (
          <div className="bg-primary-light border border-primary/20 rounded-xl p-4 space-y-3">
            <div className="space-y-1">
              <p className="text-sm font-semibold text-primary">
                {t('listing.buy.send_instruction', { amount: listing.asking_price!, method: PAYMENT_METHOD_LABELS[selectedMethod.type] })}
              </p>
              <div className="flex items-center gap-2">
                <p className="font-mono text-base text-text flex-1 break-all">{selectedMethod.value}</p>
                <button
                  onClick={async () => {
                    // Guarded: an unhandled clipboard rejection used to show the
                    // success checkmark anyway
                    try {
                      await navigator.clipboard.writeText(selectedMethod.value)
                      setCopied(true)
                      setTimeout(() => setCopied(false), 2000)
                    } catch {
                      toast.error(t('app.error'))
                    }
                  }}
                  className="p-2.5 rounded-lg bg-surface text-primary shrink-0"
                  aria-label={t('listing.buy.copy_aria')}
                >
                  <Icon name={copied ? 'check_circle' : 'content_copy'} size={16} filled={copied} />
                </button>
              </div>
            </div>

            {paymentLink ? (
              <a
                href={paymentLink}
                target="_blank"
                rel="noopener noreferrer"
                className={`flex items-center justify-center gap-2 w-full py-2.5 rounded-xl text-sm font-semibold text-white transition-opacity hover:opacity-90 ${METHOD_COLORS[selectedMethod.type]}`}
              >
                <Icon name="open_in_new" size={16} />
                {t('listing.buy.open_app', { method: PAYMENT_METHOD_LABELS[selectedMethod.type], amount: listing.asking_price! })}
              </a>
            ) : (
              <p className="text-xs text-text2">
                {t('listing.buy.manual_instruction', { method: PAYMENT_METHOD_LABELS[selectedMethod.type] })}
              </p>
            )}
          </div>
        )}
      </div>
    </BottomSheet>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function ListingDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { user } = useAuth()
  const { listings, fetchListings } = useMarketplace()
  const { t } = useT()

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
        <Icon name="progress_activity" size={32} color="var(--c-primary)" className="animate-spin" />
      </div>
    )
  }

  if (!listing) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-4 p-6 text-center" dir="rtl">
        <Icon name="shopping_bag" size={48} color="var(--c-border)" />
        <p className="font-medium text-text3">{t('listing.not_found')}</p>
        <Button size="sm" onClick={() => navigate('/market')}>{t('listing.back_to_market')}</Button>
      </div>
    )
  }

  const isOwnListing = listing.seller_id === user?.id
  const expiryDate = listing.expiry_date ? new Date(listing.expiry_date) : null
  const daysLeft = expiryDate ? Math.ceil((expiryDate.getTime() - Date.now()) / 86400000) : null
  const myReservedPrice =
    listing.reserved_buyer_id === user?.id && listing.reserved_price != null
      ? listing.reserved_price : null
  const displayPrice = myReservedPrice ?? currentPrice ?? listing.asking_price

  return (
    <div className="flex-1 bg-bg" dir="rtl">
      {/* Header */}
      <div className="bg-surface border-b border-border sticky top-0 z-20">
        <div className="flex items-center gap-3 px-4 py-3">
          <button onClick={() => navigate(-1)} className="p-2 rounded-full bg-bg text-text2">
            <Icon name="arrow_forward" size={20} />
          </button>
          <h1 className="font-bold text-lg flex-1 text-text">{listing.store_name}</h1>
          {!isOwnListing && listing.status === 'active' && (
            <button
              onClick={() => setShowChat(true)}
              className="p-2 rounded-full bg-primary-light text-primary"
              aria-label={t('listing.chat_aria')}
            >
              <Icon name="chat" size={20} />
            </button>
          )}
          <button
            onClick={() => setShowReport(true)}
            className="p-2 rounded-full bg-bg text-text3"
            aria-label={t('listing.report_aria')}
          >
            <Icon name="flag" size={20} />
          </button>
        </div>
      </div>

      <div className="p-4 space-y-4 pb-40">
        {/* Main info card */}
        <div className="bg-surface rounded-card shadow-card p-5 space-y-4">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-3xl font-bold text-primary">₪{displayPrice}</p>
              {myReservedPrice != null ? (
                <div className="flex items-center gap-1 mt-1">
                  <Icon name="sell" size={14} color="var(--c-primary)" />
                  <p className="text-sm text-primary font-medium">{t('listing.reserved_price')}</p>
                  {listing.asking_price !== myReservedPrice && (
                    <p className="text-xs text-text3 line-through">₪{listing.asking_price}</p>
                  )}
                </div>
              ) : (
                <p className="text-sm text-text3 mt-1">{t('listing.asking_price')}</p>
              )}
            </div>
            <div className="text-left space-y-1">
              <p className="text-xl font-semibold text-text">₪{listing.balance}</p>
              <p className="text-sm text-text3">{t('listing.voucher_balance')}</p>
              {(() => {
                const b = listing.balance ?? 0
                const p = displayPrice ?? 0
                const pct = b > 0 && p < b ? Math.round(((b - p) / b) * 100) : 0
                return pct > 0 ? (
                  <span className={`block text-center text-xs font-bold px-2 py-0.5 rounded-full ${
                    pct >= 30 ? 'bg-primary text-white' : pct >= 15 ? 'bg-warning text-white' : 'bg-bg text-text2'
                  }`}>
                    {t('listing.save_pct', { pct: String(pct) })}
                  </span>
                ) : null
              })()}
            </div>
          </div>

          {expiryDate && (
            <div className={`flex items-center gap-2 text-sm ${daysLeft && daysLeft < 30 ? 'text-warning' : 'text-text3'}`}>
              <Icon name="schedule" size={16} />
              <span>
                {t('listing.valid_until')}: {formatDate(listing.expiry_date!)}
                {daysLeft !== null && daysLeft > 0 && ` · ${t('listing.days_left', { days: String(daysLeft) })}`}
              </span>
            </div>
          )}

          {listing.description && (
            <p className="text-sm text-text2 bg-bg rounded-xl p-3">{listing.description}</p>
          )}
        </div>

        {/* Seller card */}
        <div className="bg-surface rounded-card shadow-card p-4">
          <p className="text-xs text-text3 font-medium mb-3">{t('listing.about_seller')}</p>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-primary-mid to-primary-dark rounded-full flex items-center justify-center text-white font-bold">
              {(listing.seller_name || listing.seller_email || '?')[0].toUpperCase()}
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-1.5">
                <p className="font-medium text-text">
                  {listing.seller_name || listing.seller_email?.split('@')[0]}
                </p>
                {listing.is_verified_seller && (
                  <Icon name="verified" size={16} filled color="var(--c-primary)" className="shrink-0" />
                )}
              </div>
              {(listing.avg_rating ?? 0) > 0 ? (
                <div className="flex items-center gap-1 mt-0.5">
                  {[1,2,3,4,5].map(i => (
                    <Icon
                      key={i}
                      name="star"
                      size={14}
                      filled={i <= Math.round(listing.avg_rating ?? 0)}
                      color={i <= Math.round(listing.avg_rating ?? 0) ? '#facc15' : 'var(--c-border)'}
                    />
                  ))}
                  <span className="text-xs text-text3 mr-1">
                    {Number(listing.avg_rating).toFixed(1)} ({listing.rating_count} {t('listing.ratings')})
                  </span>
                </div>
              ) : (
                <p className="text-xs text-text3">{t('listing.not_rated')}</p>
              )}
            </div>
            {!isOwnListing && listing.status === 'active' && (
              <button
                onClick={() => setShowChat(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-primary/30 text-primary text-xs font-medium"
              >
                <Icon name="chat" size={14} />
                {t('listing.chat_button')}
              </button>
            )}
          </div>
        </div>

        {/* Payment methods preview */}
        {(listing.seller_payment_methods?.length ?? 0) > 0 && (
          <div className="bg-surface rounded-card shadow-card p-4">
            <p className="text-xs text-text3 font-medium mb-3">{t('listing.payment_methods')}</p>
            <div className="flex flex-wrap gap-2">
              {listing.seller_payment_methods!.map((m, i) => (
                <span key={i} className="text-xs font-medium px-3 py-1.5 bg-bg text-text2 rounded-full">
                  {PAYMENT_METHOD_LABELS[m.type]}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Purchased state */}
        {purchased && (
          <div className="bg-primary-light border border-primary/20 rounded-2xl p-4 text-center space-y-2">
            <Icon name="check_circle" size={32} filled color="var(--c-primary)" className="mx-auto" />
            <p className="font-semibold text-primary">{t('listing.purchased.title')}</p>
            <p className="text-sm text-primary">{t('listing.purchased.body')}</p>
            <button
              onClick={() => navigate('/market', { state: { initialTab: 'purchases' } })}
              className="mt-1 text-sm text-primary underline"
            >
              {t('listing.purchased.go')}
            </button>
          </div>
        )}
      </div>

      {/* Buy button (sticky bottom — positioned above BottomNav) */}
      {!isOwnListing && !purchased && listing.status === 'active' && (
        <div
          className="fixed left-0 right-0 max-w-2xl mx-auto p-4 bg-surface border-t border-border z-40"
          style={{ bottom: 'var(--nav-h)' }}
        >
          <Button onClick={() => setShowBuy(true)} fullWidth size="lg">
            <Icon name="shopping_bag" size={20} />
            {t('listing.buy_now_price', { price: String(displayPrice) })}
          </Button>
        </div>
      )}

      {isOwnListing && (
        <div
          className="fixed left-0 right-0 max-w-2xl mx-auto p-4 bg-surface border-t border-border z-40"
          style={{ bottom: 'var(--nav-h)' }}
        >
          <p className="text-center text-sm text-text3">{t('listing.own_listing')}</p>
        </div>
      )}

      {listing.status !== 'active' && !isOwnListing && (
        <div
          className="fixed left-0 right-0 max-w-2xl mx-auto p-4 bg-surface border-t border-border z-40"
          style={{ bottom: 'var(--nav-h)' }}
        >
          <p className="text-center text-sm text-text3">{t('listing.unavailable')}</p>
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
