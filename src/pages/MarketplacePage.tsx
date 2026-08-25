import { useState, useEffect } from 'react'
import { AnimatePresence } from 'framer-motion'
import { useNavigate, useLocation } from 'react-router-dom'
import { useMarketplace } from '../contexts/MarketplaceContext'
import { useAuth } from '../contexts/AuthContext'
import { useVouchers } from '../contexts/VoucherContext'
import { useT } from '../lib/i18n'
import type { MarketplaceListing, MarketplacePurchase, WatchlistItem, PaymentMethod } from '../types'
import { PAYMENT_METHOD_LABELS } from '../types'
import { supabase } from '../lib/supabase'
import ChatModal from '../components/ChatModal'
import ConfirmDialog from '../components/ConfirmDialog'
import Icon from '../components/ui/Icon'
import toast from 'react-hot-toast'
import { usePageView } from '../hooks/usePageView'
import ErrorRetry from '../components/marketplace/ErrorRetry'
import RateModal from '../components/marketplace/RateModal'
import ReportModal from '../components/marketplace/ReportModal'
import ConversationsModal from '../components/marketplace/ConversationsModal'
import ListingCard from '../components/marketplace/ListingCard'
import MyListingRow from '../components/marketplace/MyListingRow'
import MyPurchaseRow from '../components/marketplace/MyPurchaseRow'
import MarketplaceAccessGate from '../components/marketplace/MarketplaceAccessGate'
import SellerProfileModal from '../components/marketplace/SellerProfileModal'
import type { SellerProfileRow } from '../components/marketplace/shared'

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function MarketplacePage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { isAdmin, user, profile } = useAuth()
  const { logAction } = useVouchers()
  const { t } = useT()
  usePageView('market')
  const {
    listings, myListings, myPurchases,
    loadingListings, loadingMyListings, loadingMyPurchases,
    listingsError, myListingsError, myPurchasesError, invalidateAndRefetch,
    fetchListings, fetchMyListings, fetchMyPurchases,
    removeFromSale, confirmPaymentReceived, cancelPurchase,
    unreadByListing, updateListingPrice,
    marketplaceMode, myAccessStatus,
  } = useMarketplace()

  // Promise-based confirmation so row components' own busy spinners keep working:
  // the returned promise resolves after the user decides AND the action finishes.
  const [confirmState, setConfirmState] = useState<{
    title: string; message?: string; confirmLabel?: string
    action: () => Promise<void> | void; resolve: () => void
  } | null>(null)
  function withConfirm(title: string, message: string | undefined, action: () => Promise<void> | void, confirmLabel?: string): Promise<void> {
    return new Promise(resolve => setConfirmState({ title, message, confirmLabel, action, resolve }))
  }

  const [tab, setTab] = useState<'all' | 'mine' | 'purchases' | 'watchlist'>(() => {
    // Validate router state instead of blind-casting — an unexpected value used to
    // select a tab that matches none of the four render branches (blank screen)
    const raw = (location.state as { initialTab?: string } | null)?.initialTab
    return raw === 'mine' || raw === 'purchases' || raw === 'watchlist' ? raw : 'all'
  })
  const [search, setSearch] = useState('')
  type MarketSortKey = 'discount' | 'balance' | 'expiry' | 'newest'
  const [sortKey, setSortKey] = useState<MarketSortKey>('newest')
  const [showSort, setShowSort] = useState(false)
  const [ratingPurchase, setRatingPurchase] = useState<MarketplacePurchase | null>(null)
  const [reportTarget, setReportTarget] = useState<{
    userId: string; name: string; purchaseId?: string; listingId?: string
  } | null>(null)
  // Watchlist
  const [watchlist, setWatchlist] = useState<WatchlistItem[]>([])
  const [watchlistLoaded, setWatchlistLoaded] = useState(false)
  const [showAddWatch, setShowAddWatch] = useState(false)
  const [watchForm, setWatchForm] = useState({ store_name: '', min_discount_pct: 0, notify_push: true, notify_email: false })
  const [savingWatch, setSavingWatch] = useState(false)
  const [deletingWatch, setDeletingWatch] = useState<string | null>(null)

  // Chat state
  const [chatTarget, setChatTarget] = useState<{
    listingId: string
    otherUserId: string
    otherUserName: string
    isSeller: boolean
    askingPrice: number
    storeName: string
  } | null>(null)

  // Conversations modal (seller picks buyer to chat with)
  const [convsListing, setConvsListing] = useState<MarketplaceListing | null>(null)

  // Seller profile gate
  const [showSellerProfile, setShowSellerProfile] = useState(false)
  const [sellerProfile, setSellerProfile] = useState<SellerProfileRow | null | undefined>(undefined)

  async function checkAndPublish() {
    if (sellerProfile === undefined) {
      const { data } = await supabase.rpc('get_seller_profile')
      const p = (data as SellerProfileRow | null) ?? null
      setSellerProfile(p)
      if (p?.verification_status === 'verified') { navigate('/market/bulk'); return }
      setShowSellerProfile(true)
    } else if (sellerProfile?.verification_status === 'verified') {
      navigate('/market/bulk')
    } else {
      setShowSellerProfile(true)
    }
  }

  // Payment methods
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>(
    () => (profile?.marketplace_payment_methods as PaymentMethod[]) || []
  )
  const [showPaymentSettings, setShowPaymentSettings] = useState(false)
  const [addingPayment, setAddingPayment] = useState(false)
  const [newPaymentType, setNewPaymentType] = useState<PaymentMethod['type']>('bit')
  const [newPaymentValue, setNewPaymentValue] = useState('')
  const [savingPayments, setSavingPayments] = useState(false)

  useEffect(() => {
    if (profile?.marketplace_payment_methods) {
      setPaymentMethods(profile.marketplace_payment_methods as PaymentMethod[])
    }
  }, [profile])

  async function savePaymentMethods(methods: PaymentMethod[]) {
    setSavingPayments(true)
    try {
      // Mutations go through SECURITY DEFINER RPCs (project rule). The direct
      // table update stays only as a fallback for the window before
      // supabase-payment-methods-rpc.sql has been applied.
      const { error } = await supabase.rpc('set_payment_methods', { p_methods: methods })
      if (error) {
        if (!/function|schema cache/i.test(error.message || '')) throw error
        const { error: directErr } = await supabase.from('profiles').update({ marketplace_payment_methods: methods }).eq('id', user!.id)
        if (directErr) throw directErr
      }
      setPaymentMethods(methods)
      toast.success(t('market.payment.updated'))
    } catch {
      toast.error(t('market.payment.save.error'))
    } finally {
      setSavingPayments(false)
    }
  }

  function addPaymentMethod() {
    if (!newPaymentValue.trim()) { toast.error(t('market.payment.enter.value')); return }
    const newMethod: PaymentMethod = { type: newPaymentType, value: newPaymentValue.trim() }
    savePaymentMethods([...paymentMethods, newMethod]).then(() => {
      logAction('system_payment_method_add', 'מערכת', undefined, { type: PAYMENT_METHOD_LABELS[newPaymentType] })
    }).catch(() => {})
    setNewPaymentValue('')
    setAddingPayment(false)
  }

  function removePaymentMethod(index: number) {
    const removed = paymentMethods[index]
    savePaymentMethods(paymentMethods.filter((_, i) => i !== index)).then(() => {
      logAction('system_payment_method_remove', 'מערכת', undefined, { type: PAYMENT_METHOD_LABELS[removed.type] })
    }).catch(() => {})
  }

  // Redirect non-admins when marketplace is fully disabled
  useEffect(() => {
    if (marketplaceMode === 'disabled' && !isAdmin) navigate('/', { replace: true })
  }, [marketplaceMode, isAdmin, navigate])

  // Prefetch all three tabs in parallel on first mount — tab switches will be instant
  useEffect(() => {
    Promise.all([fetchListings(), fetchMyListings(), fetchMyPurchases()])
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // When the user explicitly switches to a tab, ensure its data is up-to-date
  useEffect(() => {
    if (tab === 'all') fetchListings(search || undefined)
    else if (tab === 'mine') {
      fetchMyListings()
      // Prefetch seller profile so the banner renders immediately
      if (sellerProfile === undefined) {
        supabase.rpc('get_seller_profile').then(({ data }) => {
          setSellerProfile((data as SellerProfileRow | null) ?? null)
        })
      }
    }
    // Only the purchases tab needs purchases (the bare `else` used to fire this
    // unrelated fetch when opening the WATCHLIST tab too)
    else if (tab === 'purchases') fetchMyPurchases()
  }, [tab]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (tab !== 'all') return
    const timer = setTimeout(() => fetchListings(search || undefined), 400)
    return () => clearTimeout(timer)
  }, [search]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (tab !== 'watchlist' || watchlistLoaded) return
    supabase.rpc('get_my_watchlist').then(({ data }) => {
      if (data) setWatchlist(data)
      setWatchlistLoaded(true)
    })
  }, [tab, watchlistLoaded])

  async function addWatchItem() {
    if (!watchForm.store_name.trim()) { toast.error(t('market.watch.store.required')); return }
    setSavingWatch(true)
    try {
      const { data, error } = await supabase.rpc('add_watchlist_item', {
        p_store_name: watchForm.store_name.trim(),
        p_min_discount_pct: watchForm.min_discount_pct,
        p_notify_push: watchForm.notify_push,
        p_notify_email: watchForm.notify_email,
      })
      if (error) throw error
      if (data) setWatchlist(prev => [data, ...prev])
      setShowAddWatch(false)
      setWatchForm({ store_name: '', min_discount_pct: 0, notify_push: true, notify_email: false })
      toast.success(t('market.watch.added'))
    } catch (e: unknown) {
      const msg = (e as { message?: string })?.message || ''
      toast.error(msg.includes('pro_required') ? t('market.watch.pro.required') : t('market.watch.add.error'))
    } finally {
      setSavingWatch(false)
    }
  }

  async function deleteWatchItem(id: string) {
    setDeletingWatch(id)
    try {
      await supabase.rpc('delete_watchlist_item', { p_id: id })
      setWatchlist(prev => prev.filter(w => w.id !== id))
    } catch {
      toast.error(t('market.watch.delete.error'))
    } finally {
      setDeletingWatch(null)
    }
  }

  // Selective mode: non-approved users see the access request screen
  if (marketplaceMode === 'selective' && !isAdmin && myAccessStatus !== 'approved') {
    return (
      <div className="flex flex-col min-h-dvh bg-bg">
        <div className="bg-surface border-b border-border px-4 py-4">
          <h1 className="text-xl font-bold text-text flex items-center gap-2">
            <Icon name="shopping_bag" size={20} color="var(--c-primary)" />
            {t('market.title')}
          </h1>
        </div>
        <MarketplaceAccessGate />
      </div>
    )
  }

  return (
    <div className="flex-1 bg-bg" dir="rtl">
      <AnimatePresence>
      {confirmState && (
        <ConfirmDialog
          title={confirmState.title}
          message={confirmState.message}
          confirmLabel={confirmState.confirmLabel}
          danger
          onConfirm={async () => {
            const c = confirmState
            setConfirmState(null)
            try { await c.action() } finally { c.resolve() }
          }}
          onCancel={() => { confirmState.resolve(); setConfirmState(null) }}
        />
      )}
      </AnimatePresence>
      {/* Header */}
      <div className="sticky top-0 z-20 bg-surface border-b border-border">
        <div className="px-5 pt-4">
          <div className="flex justify-between items-center mb-3.5">
            <div>
              <div className="text-[22px] font-extrabold text-text">{t('market.marketplace')}</div>
              {listings.length > 0 && (
                <div className="text-[13px] text-text3 mt-0.5">{listings.length} {t('market.active.deals')}</div>
              )}
            </div>
            {tab === 'all' && (
              <button
                onClick={() => setShowSort(s => !s)}
                className={`flex items-center gap-1.5 rounded-[10px] px-3 py-2 border ${
                  showSort ? 'bg-primary-light border-primary text-primary' : 'bg-bg border-border text-text2'
                }`}
              >
                <Icon name="tune" size={14} />
                <span className="text-[13px] font-medium">
                  {sortKey === 'discount' ? t('market.sort.discount') : sortKey === 'balance' ? t('market.sort.balance') : sortKey === 'expiry' ? t('market.sort.expiry') : t('market.sort.newest')}
                </span>
              </button>
            )}
          </div>
          {showSort && tab === 'all' && (
            <div className="flex gap-2 flex-wrap pb-3">
              {([
                { key: 'newest',   label: t('market.sort.newest.full') },
                { key: 'discount', label: t('market.sort.discount.full') },
                { key: 'balance',  label: t('market.sort.balance.full') },
                { key: 'expiry',   label: t('market.sort.expiry.full') },
              ] as { key: MarketSortKey; label: string }[]).map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => { setSortKey(key); setShowSort(false) }}
                  className={`text-xs px-3 py-1.5 rounded-full font-medium border ${
                    sortKey === key ? 'bg-primary-light text-primary border-primary' : 'bg-bg text-text3 border-transparent'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          )}

          {/* Tabs */}
          <div className="flex">
            {([['all', t('market.tab.market')], ['mine', t('market.tab.mine')], ['purchases', t('market.tab.purchases')], ['watchlist', t('market.tab.watchlist')]] as const).map(([tabKey, label]) => (
              <button
                key={tabKey}
                onClick={() => setTab(tabKey)}
                className={`flex-1 py-2.5 relative text-sm ${tab === tabKey ? 'font-bold text-primary' : 'font-normal text-text3'}`}
              >
                {label}
                {tab === tabKey && (
                  <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-7 h-[3px] rounded-t-[3px] bg-primary" />
                )}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Search */}
      {tab === 'all' && (
        <div className="px-4 py-3 bg-surface border-b border-border">
          <div className="flex items-center gap-2.5 bg-bg rounded-xl px-3">
            <Icon name="search" size={16} color="var(--c-text3)" />
            <input
              type="text"
              className="flex-1 h-10 border-none bg-transparent text-[15px] text-text outline-none"
              placeholder={t('market.search.by.store')}
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            {search && (
              <button onClick={() => setSearch('')} className="p-0.5">
                <Icon name="close" size={15} color="var(--c-text3)" />
              </button>
            )}
          </div>
        </div>
      )}

      <div className="p-4 space-y-3 pb-32">
        {/* ── All listings ── */}
        {tab === 'all' && (() => {
          const sorted = [...listings].sort((a, b) => {
            switch (sortKey) {
              case 'discount': {
                const pctA = a.balance && a.balance > 0 ? (a.balance - a.asking_price) / a.balance : 0
                const pctB = b.balance && b.balance > 0 ? (b.balance - b.asking_price) / b.balance : 0
                return pctB - pctA
              }
              case 'balance': return (b.balance ?? 0) - (a.balance ?? 0)
              case 'expiry': {
                if (!a.expiry_date && !b.expiry_date) return 0
                if (!a.expiry_date) return 1
                if (!b.expiry_date) return -1
                return new Date(a.expiry_date).getTime() - new Date(b.expiry_date).getTime()
              }
              default: return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
            }
          })
          return (
            <>
              {loadingListings && listings.length === 0 ? (
                <div className="flex justify-center py-12">
                  <Icon name="progress_activity" size={24} color="var(--c-primary)" className="animate-spin" />
                </div>
              ) : listingsError && listings.length === 0 ? (
                <ErrorRetry onRetry={() => invalidateAndRefetch('listings')} />
              ) : sorted.length === 0 ? (
                <div className="text-center py-12 text-text3 space-y-2">
                  <Icon name="sell" size={40} color="var(--c-border)" />
                  <p className="font-medium">{t('market.no.listings.now')}</p>
                  {search && <p className="text-sm">{t('market.try.other.search')}</p>}
                </div>
              ) : (
                sorted.map(l => (
                  <ListingCard
                    key={l.id}
                    listing={l}
                    onClick={() => navigate(`/market/listing/${l.id}`)}
                  />
                ))
              )}
            </>
          )
        })()}

        {/* ── My listings ── */}
        {tab === 'mine' && (
          <>
            {/* Seller profile status banner */}
            <button
              onClick={() => { if (sellerProfile === undefined) checkAndPublish(); else setShowSellerProfile(true) }}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-2xl border text-sm text-right ${
                sellerProfile?.verification_status === 'verified'
                  ? 'bg-primary-light border-primary/20 text-primary'
                  : sellerProfile?.verification_status === 'pending'
                  ? 'bg-warning/10 border-warning/30 text-warning'
                  : sellerProfile?.verification_status === 'rejected'
                  ? 'bg-error/10 border-error/30 text-error'
                  : 'bg-bg border-border text-text2'
              }`}
            >
              <Icon name="verified_user" size={20} className="shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-xs">
                  {sellerProfile?.verification_status === 'verified' ? t('mkt.seller.status.verified')
                    : sellerProfile?.verification_status === 'pending' ? t('mkt.seller.status.pending')
                    : sellerProfile?.verification_status === 'rejected' ? t('mkt.seller.status.rejected')
                    : t('mkt.seller.status.none')}
                </p>
                {sellerProfile?.verification_status !== 'verified' && (
                  <p className="text-[10px] opacity-70 mt-0.5">
                    {sellerProfile?.verification_status === 'pending'
                      ? t('mkt.seller.hint.pending')
                      : t('mkt.seller.hint.approval')}
                  </p>
                )}
              </div>
              <Icon name="chevron_left" size={16} className="shrink-0 opacity-50" />
            </button>

            <div className="flex justify-between items-center">
              <button
                onClick={() => setShowPaymentSettings(v => !v)}
                className={`flex items-center gap-1.5 rounded-[10px] px-3 py-[7px] border text-[13px] font-medium ${
                  showPaymentSettings ? 'bg-primary-light border-primary text-primary' : 'bg-bg border-border text-text2'
                }`}
              >
                <Icon name="settings" size={14} />
                {t('market.payment.methods')}
                {paymentMethods.length > 0 && (
                  <span className="bg-primary text-white text-[11px] font-bold rounded-full px-1.5 mr-0.5">
                    {paymentMethods.length}
                  </span>
                )}
              </button>
              <button
                onClick={checkAndPublish}
                className="flex items-center gap-1.5 px-3 py-2 bg-primary text-white text-sm font-medium rounded-xl"
              >
                <Icon name="shopping_bag" size={14} /> {t('market.bulk.publish')}
              </button>
            </div>

            {/* Payment methods panel */}
            {showPaymentSettings && (
              <div className="bg-surface rounded-card shadow-card overflow-hidden">
                <div className="p-4 space-y-3">
                  <p className="text-xs text-text3">{t('market.payment.methods.hint')}</p>

                  {paymentMethods.length === 0 && !addingPayment && (
                    <p className="text-sm text-text3 text-center py-2">{t('market.payment.methods.empty')}</p>
                  )}

                  {paymentMethods.map((m, i) => (
                    <div key={i} className="flex items-center gap-3 p-3 bg-bg rounded-xl">
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center text-white font-bold text-xs shrink-0 ${m.type === 'paypal' ? 'bg-blue-500' : m.type === 'bit' ? 'bg-purple-500' : m.type === 'paybox' ? 'bg-orange-500' : 'bg-teal-500'}`}>
                        {PAYMENT_METHOD_LABELS[m.type][0]}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-text">{PAYMENT_METHOD_LABELS[m.type]}</p>
                        <p className="text-xs text-text3 truncate">{m.value}</p>
                      </div>
                      <button
                        onClick={() => withConfirm(t('market.payment.remove.confirm.title'), undefined, () => removePaymentMethod(i))}
                        className="p-2.5 rounded-lg text-text3 hover:text-error"
                        aria-label={t('market.payment.remove.aria')}
                      >
                        <Icon name="delete" size={18} />
                      </button>
                    </div>
                  ))}

                  {addingPayment && (
                    <div className="space-y-2 border border-primary/20 rounded-xl p-3">
                      <select
                        value={newPaymentType}
                        onChange={e => setNewPaymentType(e.target.value as PaymentMethod['type'])}
                        className="w-full border border-border rounded-xl px-3 py-2 text-sm bg-surface text-text focus:outline-none focus:ring-2 focus:ring-primary/30"
                      >
                        {(Object.entries(PAYMENT_METHOD_LABELS) as [PaymentMethod['type'], string][]).map(([type, label]) => (
                          <option key={type} value={type}>{label}</option>
                        ))}
                      </select>
                      <input
                        type={newPaymentType === 'paypal' ? 'email' : 'tel'}
                        value={newPaymentValue}
                        onChange={e => setNewPaymentValue(e.target.value)}
                        placeholder={newPaymentType === 'paypal' ? t('market.payment.paypal.placeholder') : t('market.payment.phone.placeholder')}
                        className="w-full border border-border rounded-xl px-3 py-2 text-sm bg-surface text-text focus:outline-none focus:ring-2 focus:ring-primary/30"
                        dir="ltr"
                      />
                      <div className="flex gap-2">
                        <button onClick={addPaymentMethod} disabled={savingPayments} className="flex-1 py-2 bg-primary text-white rounded-xl text-sm font-medium flex items-center justify-center gap-1">
                          <Icon name="check" size={16} /> {t('app.add')}
                        </button>
                        <button onClick={() => { setAddingPayment(false); setNewPaymentValue('') }} className="flex-1 py-2 bg-bg text-text2 rounded-xl text-sm font-medium flex items-center justify-center gap-1">
                          <Icon name="close" size={16} /> {t('app.cancel')}
                        </button>
                      </div>
                    </div>
                  )}

                  {!addingPayment && paymentMethods.length < 5 && (
                    <button
                      onClick={() => setAddingPayment(true)}
                      className="w-full flex items-center justify-center gap-2 py-2.5 border-2 border-dashed border-border rounded-xl text-sm text-text3"
                    >
                      <Icon name="add" size={16} />
                      {t('market.payment.add')}
                    </button>
                  )}
                </div>
              </div>
            )}
            {loadingMyListings && myListings.length === 0 ? (
              <div className="flex justify-center py-12">
                <Icon name="progress_activity" size={24} color="var(--c-primary)" className="animate-spin" />
              </div>
            ) : myListingsError && myListings.length === 0 ? (
              <ErrorRetry onRetry={() => invalidateAndRefetch('myListings')} />
            ) : myListings.length === 0 ? (
              <div className="text-center py-12 text-text3 space-y-2">
                <Icon name="shopping_bag" size={40} color="var(--c-border)" />
                <p className="font-medium">{t('market.mine.empty')}</p>
                <p className="text-sm">{t('market.mine.empty.hint')}</p>
              </div>
            ) : (
              myListings.map(l => (
                <MyListingRow
                  key={l.id}
                  listing={l}
                  unreadCount={unreadByListing[l.id] ?? 0}
                  onRemove={() => withConfirm(
                    t('market.remove.confirm.title'),
                    t('market.remove.confirm.msg'),
                    async () => {
                      try { await removeFromSale(l.id); toast.success(t('market.listing.removed')) }
                      catch { toast.error(t('market.listing.remove.error')) }
                    },
                  )}
                  onConfirm={() => withConfirm(
                    t('market.confirm.received.confirm.title'),
                    t('market.confirm.received.confirm.msg'),
                    async () => {
                      try { await confirmPaymentReceived(l.purchase_id!); toast.success(t('market.listing.confirmed')) }
                      catch { toast.error(t('market.listing.confirm.error')) }
                    },
                    t('market.confirm.received'),
                  )}
                  onReport={() => setReportTarget({
                    userId: l.buyer_id || '',
                    name: l.buyer_name || l.buyer_email || t('market.buyer'),
                    purchaseId: l.purchase_id,
                    listingId: l.id,
                  })}
                  onChat={() => setConvsListing(l)}
                  onUpdatePrice={async (price) => {
                    try {
                      await updateListingPrice(l.id, price)
                      await fetchMyListings()
                      toast.success(t('market.price.updated'))
                    } catch {
                      toast.error(t('market.price.update.error'))
                    }
                  }}
                />
              ))
            )}
          </>
        )}

        {/* ── Watchlist ── */}
        {tab === 'watchlist' && (
          <>
            <div className="flex items-center justify-between mb-1">
              <h2 className="font-semibold text-text flex items-center gap-1.5">
                <Icon name="notifications" size={16} color="var(--c-primary)" /> {t('market.watch.title')}
              </h2>
              <button
                onClick={() => setShowAddWatch(v => !v)}
                className="flex items-center gap-1 px-3 py-1.5 bg-primary text-white text-xs font-medium rounded-xl"
              >
                <Icon name="add" size={14} /> {t('app.add')}
              </button>
            </div>

            {showAddWatch && (
              <div className="bg-surface rounded-card border border-border p-4 space-y-3">
                <input
                  type="text"
                  placeholder={t('market.watch.store.placeholder')}
                  value={watchForm.store_name}
                  onChange={e => setWatchForm(f => ({ ...f, store_name: e.target.value }))}
                  className="w-full border border-border rounded-xl px-3 py-2 text-sm bg-surface text-text focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
                <div className="flex items-center gap-2">
                  <label className="text-xs text-text2 shrink-0">{t('market.watch.min.discount')}:</label>
                  <input
                    type="number" inputMode="numeric" min={0} max={99} value={watchForm.min_discount_pct}
                    onChange={e => setWatchForm(f => ({ ...f, min_discount_pct: parseInt(e.target.value) || 0 }))}
                    className="w-20 border border-border rounded-xl px-3 py-1.5 text-sm text-center bg-surface text-text focus:outline-none"
                  />
                  <span className="text-xs text-text3">%</span>
                </div>
                <div className="flex gap-4">
                  <label className="flex items-center gap-1.5 text-xs text-text2 cursor-pointer">
                    <input type="checkbox" checked={watchForm.notify_push}
                      onChange={e => setWatchForm(f => ({ ...f, notify_push: e.target.checked }))}
                      className="rounded" />
                    {t('market.watch.notify.push')}
                  </label>
                  <label className="flex items-center gap-1.5 text-xs text-text2 cursor-pointer">
                    <input type="checkbox" checked={watchForm.notify_email}
                      onChange={e => setWatchForm(f => ({ ...f, notify_email: e.target.checked }))}
                      className="rounded" />
                    {t('market.watch.notify.email')}
                  </label>
                </div>
                <div className="flex gap-2">
                  <button onClick={addWatchItem} disabled={savingWatch}
                    className="flex-1 py-2 bg-primary text-white rounded-xl text-sm font-medium disabled:opacity-50">
                    {savingWatch ? <Icon name="progress_activity" size={16} className="animate-spin mx-auto" /> : t('app.save')}
                  </button>
                  <button onClick={() => setShowAddWatch(false)}
                    className="px-4 py-2 border border-border rounded-xl text-sm text-text3">
                    {t('app.cancel')}
                  </button>
                </div>
              </div>
            )}

            {!watchlistLoaded && (
              <div className="flex justify-center py-10">
                <Icon name="progress_activity" size={20} color="var(--c-primary)" className="animate-spin" />
              </div>
            )}
            {watchlistLoaded && watchlist.length === 0 && !showAddWatch && (
              <div className="text-center py-12 text-text3 space-y-2">
                <Icon name="notifications" size={40} color="var(--c-border)" />
                <p className="font-medium">{t('market.watch.empty')}</p>
                <p className="text-sm">{t('market.watch.empty.hint')}</p>
              </div>
            )}
            {watchlist.map(w => (
              <div key={w.id} className="bg-surface rounded-card border border-border shadow-card p-4 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-text truncate">{w.store_name}</p>
                  <p className="text-xs text-text3 mt-0.5">
                    {t('market.watch.min.discount.label')}: {w.min_discount_pct}% ·
                    {w.notify_push ? ` · ${t('market.watch.push')}` : ''}{w.notify_email ? ` · ${t('market.watch.email')}` : ''}
                  </p>
                </div>
                <button
                  disabled={deletingWatch === w.id}
                  onClick={() => withConfirm(t('market.watch.delete.confirm.title'), undefined, () => deleteWatchItem(w.id))}
                  aria-label={t('app.delete')}
                  className="p-2.5 rounded-xl border border-error/30 text-error disabled:opacity-50"
                >
                  {deletingWatch === w.id ? <Icon name="progress_activity" size={16} className="animate-spin" /> : <Icon name="delete" size={16} />}
                </button>
              </div>
            ))}
          </>
        )}

        {/* ── My purchases ── */}
        {tab === 'purchases' && (
          <>
            {loadingMyPurchases && myPurchases.length === 0 ? (
              <div className="flex justify-center py-12">
                <Icon name="progress_activity" size={24} color="var(--c-primary)" className="animate-spin" />
              </div>
            ) : myPurchasesError && myPurchases.length === 0 ? (
              <ErrorRetry onRetry={() => invalidateAndRefetch('myPurchases')} />
            ) : myPurchases.length === 0 ? (
              <div className="text-center py-12 text-text3 space-y-2">
                <Icon name="shopping_bag" size={40} color="var(--c-border)" />
                <p className="font-medium">{t('market.purchases.empty')}</p>
              </div>
            ) : (
              myPurchases.map(p => (
                <MyPurchaseRow
                  key={p.purchase_id}
                  purchase={p}
                  unreadCount={unreadByListing[p.listing_id] ?? 0}
                  onRate={() => setRatingPurchase(p)}
                  onReport={() => setReportTarget({
                    userId: p.seller_id!,
                    name: p.seller_name || p.seller_email || t('market.seller'),
                    purchaseId: p.purchase_id,
                  })}
                  onCancel={() => withConfirm(
                    t('market.purchase.cancel.confirm.title'),
                    t('market.purchase.cancel.confirm.msg'),
                    async () => {
                      try { await cancelPurchase(p.purchase_id); toast.success(t('market.purchase.cancelled')) }
                      catch { toast.error(t('market.purchase.cancel.error')) }
                    },
                  )}
                  onChat={() => {
                    if (!p.seller_id) return
                    setChatTarget({
                      listingId: p.listing_id,
                      otherUserId: p.seller_id,
                      otherUserName: p.seller_name || p.seller_email?.split('@')[0] || t('market.seller'),
                      isSeller: false,
                      askingPrice: p.asking_price ?? 0,
                      storeName: p.store_name ?? '',
                    })
                  }}
                />
              ))
            )}
          </>
        )}
      </div>

      {/* ── Modals ── */}
      {showSellerProfile && (
        <SellerProfileModal
          existing={sellerProfile ?? null}
          onClose={() => setShowSellerProfile(false)}
          onSaved={p => { setSellerProfile(p); setShowSellerProfile(false) }}
        />
      )}
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

      {/* Conversations picker for seller */}
      {convsListing && !chatTarget && (
        <ConversationsModal
          listing={convsListing}
          onSelectConversation={(buyerId, buyerName) => {
            setConvsListing(null)
            setChatTarget({
              listingId: convsListing.id,
              otherUserId: buyerId,
              otherUserName: buyerName,
              isSeller: true,
              askingPrice: convsListing.asking_price ?? 0,
              storeName: convsListing.store_name ?? '',
            })
          }}
          onClose={() => setConvsListing(null)}
        />
      )}

      {/* Chat */}
      <AnimatePresence>
      {chatTarget && (
        <ChatModal
          listingId={chatTarget.listingId}
          otherUserId={chatTarget.otherUserId}
          otherUserName={chatTarget.otherUserName}
          isSeller={chatTarget.isSeller}
          currentAskingPrice={chatTarget.askingPrice}
          storeName={chatTarget.storeName}
          onClose={() => setChatTarget(null)}
          onPriceUpdated={(newPrice) => {
            setChatTarget(prev => prev ? { ...prev, askingPrice: newPrice } : null)
            // Refresh listings so the updated price is visible
            if (tab === 'mine') fetchMyListings()
            if (tab === 'purchases') fetchMyPurchases()
          }}
        />
      )}
      </AnimatePresence>
    </div>
  )
}
