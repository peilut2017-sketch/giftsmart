import { useState, useMemo, useEffect } from 'react'
import { AnimatePresence } from 'framer-motion'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useVouchers } from '../contexts/VoucherContext'
import { useAuth } from '../contexts/AuthContext'
import { useSubscription } from '../contexts/SubscriptionContext'
import { useDiscounts } from '../contexts/DiscountsContext'
import { useT } from '../lib/i18n'
import VoucherForm from '../components/VoucherForm'
import DealCard from '../components/DealCard'
import Icon from '../components/ui/Icon'
import type { Voucher } from '../types'
import { DEFAULT_CATEGORIES } from '../types'
import { formatCurrency, getExpiryStatus, getExpiryLabel, getStoreInitials, getCategoryColor } from '../utils/helpers'
import toast from 'react-hot-toast'
import { usePageView } from '../hooks/usePageView'
import { useCountUp } from '../hooks/useCountUp'
import { useNotificationsFeed } from '../hooks/useNotificationsFeed'
import ConfirmDialog from '../components/ConfirmDialog'

const RECENT_COUNT = 4
const TOP_CATEGORIES_COUNT = 8

/**
 * Redesigned dashboard: balance + utilization gauge, category glance, a short
 * "recent" list. The full sortable/filterable/multi-select voucher list that used
 * to live here moved to SearchPage — this screen is now a glance, not a workbench.
 */
export default function HomePage() {
  const navigate = useNavigate()
  const { t } = useT()
  usePageView('home')
  const { user } = useAuth()
  const { vouchers, loading, walletError, isOnline, walletName, addVoucher, archiveExpired, refreshVouchers } = useVouchers()
  const { limits, openUpgradeSheet } = useSubscription()
  const { recentDeals, fetchRecentDeals } = useDiscounts()
  const { unseenCount } = useNotificationsFeed()

  useEffect(() => { fetchRecentDeals() }, [fetchRecentDeals])

  const [searchParams, setSearchParams] = useSearchParams()
  const [showForm, setShowForm] = useState(false)

  // The global BottomNav "Add" FAB navigates to /?add=1 from anywhere in the app —
  // the plan limit must be checked here (on arrival), since the nav button itself
  // can't know the voucher count.
  useEffect(() => {
    if (searchParams.get('add') !== '1') return
    setSearchParams({}, { replace: true })
    if (vouchers.length >= limits.maxVouchers) {
      openUpgradeSheet(t('upgrade.limit.reached', { max: limits.maxVouchers }))
      return
    }
    setShowForm(true)
  }, [searchParams]) // eslint-disable-line react-hooks/exhaustive-deps

  // Google Calendar prompt state
  const [calendarVoucher, setCalendarVoucher] = useState<{ id: string; storeName: string; expiryDate: string } | null>(null)
  // Held back while VoucherForm is still open — showing the calendar sheet on top of
  // the form's success screen stacked two modals; it now waits its turn.
  const [pendingCalendar, setPendingCalendar] = useState<{ id: string; storeName: string; expiryDate: string } | null>(null)
  const reminderDays = parseInt(localStorage.getItem(`reminder_days_${user?.id}`) || '14')
  const [calendarModalDays, setCalendarModalDays] = useState(reminderDays)

  useEffect(() => {
    if (!showForm && pendingCalendar) {
      setCalendarVoucher(pendingCalendar)
      setPendingCalendar(null)
    }
  }, [showForm, pendingCalendar])

  function openGoogleCalendar(id: string, storeName: string, expiryDate: string, days: number) {
    // Work on the calendar date components directly, never via toISOString():
    // "YYYY-MM-DD" parses as UTC midnight, and .getDate()/.toISOString() mixed
    // local and UTC, shifting the all-day reminder ±1 day in western timezones —
    // and toISOString() throws outright on an invalid date.
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(expiryDate)
    if (!m) { toast.error(t('app.error')); return }
    const safeDays = Number.isFinite(days) ? days : 14
    const expiry = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
    const eventDay = new Date(expiry)
    eventDay.setDate(expiry.getDate() - safeDays)
    const fmt = (d: Date) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
    const start = fmt(eventDay)
    const end = fmt(new Date(eventDay.getTime() + 86_400_000))
    const appUrl = import.meta.env.VITE_APP_URL || window.location.origin
    const params = new URLSearchParams({
      action: 'TEMPLATE',
      text: t('calendar.event.title', { store: storeName }),
      dates: `${start}/${end}`,
      details: t('calendar.event.details', {
        store: storeName,
        date: expiry.toLocaleDateString('he-IL'),
        days,
        url: `${appUrl}/checkout/${id}`,
      }),
    })
    window.open(`https://calendar.google.com/calendar/render?${params}`, '_blank', 'noopener,noreferrer')
    setCalendarVoucher(null)
  }

  async function handleSave(vData: any) {
    try {
      const newVoucher = await addVoucher(vData)
      toast.success(t('voucher.added'))
      const calendarEnabled = localStorage.getItem(`calendar_reminder_enabled_${user?.id}`) !== 'false'
      if (calendarEnabled && vData.expiry_date && newVoucher) {
        setCalendarModalDays(reminderDays)
        setPendingCalendar({ id: newVoucher.id, storeName: vData.store_name, expiryDate: vData.expiry_date })
      }
      return newVoucher
    } catch (err: any) {
      toast.error(err?.message || t('voucher.save.error'))
      throw err
    }
  }

  const [confirm, setConfirm] = useState<{ title: string; message?: string; onConfirm: () => void } | null>(null)
  const expiredCount = vouchers.filter(v => getExpiryStatus(v.expiry_date) === 'expired').length

  function handleArchiveExpired() {
    setConfirm({
      title: t('confirm.archive.expired.title'),
      message: t('confirm.archive.expired.message', { count: expiredCount }),
      onConfirm: async () => { setConfirm(null); await archiveExpired(); toast.success(t('confirm.archive.expired.success')) },
    })
  }

  // Utilization gauge: % of total face value already spent
  const utilization = useMemo(() => {
    const totalAmount = vouchers.reduce((s, v) => s + (v.amount || 0), 0)
    const totalBalance = vouchers.reduce((s, v) => s + v.balance, 0)
    if (totalAmount <= 0) return 0
    return Math.max(0, Math.min(100, Math.round(((totalAmount - totalBalance) / totalAmount) * 100)))
  }, [vouchers])

  const totalBalance = vouchers.reduce((s, v) => s + v.balance, 0)
  // In-place balance changes count toward the new value instead of teleporting
  const balanceRef = useCountUp<HTMLDivElement>(totalBalance, v => formatCurrency(Math.round(v)))

  const topCategories = useMemo(() => {
    const counts = new Map<string, number>()
    vouchers.forEach(v => v.categories.forEach(c => counts.set(c, (counts.get(c) || 0) + 1)))
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, TOP_CATEGORIES_COUNT)
      .map(([name, count]) => {
        // v.categories stores the category's display name (set in VoucherForm), not its id —
        // DEFAULT_CATEGORIES must be matched by name here, not id.
        const known = DEFAULT_CATEGORIES.find(c => c.name === name)
        return { id: known?.id ?? name, name, icon: known?.icon ?? 'sell', count }
      })
  }, [vouchers])

  const recent = useMemo(
    () => [...vouchers].sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()).slice(0, RECENT_COUNT),
    [vouchers]
  )

  // Gauge: number, arc and label all encode the SAME thing — the % of total face
  // value still available. (Previously the number showed % spent while the arc
  // showed % remaining, two opposite readings of one control.)
  const remainingPct = 100 - utilization
  const pctRef = useCountUp<HTMLDivElement>(remainingPct, v => `${Math.round(v)}%`)
  const GAUGE_CIRC = 314 // ≈ π * r(100)
  const gaugeDash = (remainingPct / 100) * GAUGE_CIRC

  return (
    <div className="flex-1 bg-bg">
      <AnimatePresence>
        {confirm && (
          <ConfirmDialog title={confirm.title} message={confirm.message} danger onConfirm={confirm.onConfirm} onCancel={() => setConfirm(null)} />
        )}
      </AnimatePresence>

      {/* ── Google Calendar prompt ── */}
      {calendarVoucher && (
        <div className="fixed inset-0 bg-black/50 z-[90] flex items-end justify-center" onClick={() => setCalendarVoucher(null)}>
          <div className="bg-surface rounded-t-3xl w-full max-w-2xl p-5 pb-[max(2rem,env(safe-area-inset-bottom))]" onClick={e => e.stopPropagation()} dir="rtl">
            <div className="flex justify-center mb-3"><div className="w-10 h-1 bg-border rounded-full" /></div>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-2xl bg-primary-light flex items-center justify-center">
                <Icon name="calendar_month" size={22} color="var(--c-primary)" />
              </div>
              <div>
                <p className="font-bold text-text text-sm">{t('voucher.calendar.title')}</p>
                <p className="text-xs text-text3 mt-0.5">{t('voucher.label')}: <strong>{calendarVoucher.storeName}</strong></p>
              </div>
            </div>
            <div className="flex items-center gap-3 mb-4 bg-bg rounded-2xl px-4 py-3">
              <span className="text-sm text-text2 flex-1">{t('voucher.calendar.days.label')}</span>
              <div className="flex items-center gap-2">
                <button type="button" aria-label="-" onClick={() => setCalendarModalDays(d => Math.max(1, d - 1))} className="w-10 h-10 rounded-full bg-border text-text font-bold text-base">−</button>
                <input
                  type="number" inputMode="numeric" min={1} max={365} value={calendarModalDays}
                  onChange={e => setCalendarModalDays(Math.max(1, Math.min(365, parseInt(e.target.value) || 1)))}
                  className="w-14 text-center text-base font-semibold border border-border rounded-xl py-1.5 bg-surface text-text outline-none"
                />
                <button type="button" aria-label="+" onClick={() => setCalendarModalDays(d => Math.min(365, d + 1))} className="w-10 h-10 rounded-full bg-border text-text font-bold text-base">+</button>
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={() => openGoogleCalendar(calendarVoucher.id, calendarVoucher.storeName, calendarVoucher.expiryDate, calendarModalDays)} className="flex-1 py-3 bg-primary text-white rounded-2xl font-semibold text-sm flex items-center justify-center gap-2">
                <Icon name="calendar_month" size={18} /> {t('voucher.calendar.cta')}
              </button>
              <button onClick={() => setCalendarVoucher(null)} className="px-5 py-3 bg-bg text-text2 rounded-2xl font-medium text-sm">{t('voucher.calendar.skip')}</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Header ── */}
      <div className="flex items-center justify-between px-5 pt-5 pb-1">
        <button onClick={() => navigate('/notifications')} className="relative w-10 h-10 rounded-full flex items-center justify-center" aria-label={t('notifications.title')}>
          <Icon name="notifications" size={24} color="var(--c-text2)" />
          {unseenCount > 0 && (
            <span className="absolute top-0.5 right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-error text-white text-[10px] font-bold flex items-center justify-center leading-none">
              {unseenCount > 99 ? '99+' : unseenCount}
            </span>
          )}
        </button>
        <div className="text-center">
          <div className="text-[19px] font-extrabold text-text">{walletName || t('wallet.main')}</div>
          <div className="text-[13px] text-text3 mt-0.5 flex items-center gap-1.5 justify-center">
            {!isOnline && <Icon name="wifi_off" size={13} />}
            {t('home.your.wallet')}
          </div>
        </div>
        {/* Quick jump to search — replaced the vault shield here (vault lock/unlock
            still lives in Settings → Privacy, and unlock prompts appear where needed) */}
        <button
          onClick={() => navigate('/search')}
          className="w-10 h-10 rounded-full flex items-center justify-center"
          style={{ background: 'var(--c-bg)' }}
          aria-label={t('nav.search')}
        >
          <Icon name="search" size={18} color="var(--c-text3)" />
        </button>
      </div>

      {expiredCount > 0 && (
        <div className="flex justify-center pb-1">
          <button onClick={handleArchiveExpired} className="flex items-center gap-1.5 bg-urgent-bg text-urgent rounded-full px-3 py-1.5">
            <Icon name="archive" size={14} />
            <span className="text-xs font-semibold">{t('home.expired.label')} ({expiredCount})</span>
          </button>
        </div>
      )}

      {/* ── Balance + gauge ── */}
      <div className="text-center mt-2 mb-1">
        <div ref={balanceRef} className="text-[44px] font-black text-text tracking-tight leading-none">{formatCurrency(totalBalance)}</div>
      </div>

      <div className="relative h-[130px] mt-1.5">
        <svg viewBox="0 0 240 130" className="absolute top-0 left-1/2 -translate-x-1/2 w-[220px] h-[120px]">
          <path d="M20,120 A100,100 0 0 1 220,120" fill="none" stroke="var(--c-border)" strokeWidth="14" strokeLinecap="round" />
          <path
            d="M20,120 A100,100 0 0 1 220,120" fill="none" stroke="var(--c-primary)" strokeWidth="14" strokeLinecap="round"
            strokeDasharray={`${gaugeDash} ${GAUGE_CIRC * 2}`}
            style={{ transition: 'stroke-dasharray 400ms var(--ease-out)' }}
          />
        </svg>
        <div className="absolute inset-x-0 bottom-3 text-center">
          <div ref={pctRef} className="text-2xl font-extrabold text-text">{remainingPct}%</div>
          <div className="text-[11px] text-text3 font-medium">{t('home.gauge.left')}</div>
        </div>
      </div>

      {/* ── Categories glance ── */}
      {topCategories.length > 0 && (
        <div className="px-5 mt-4">
          <div className="flex items-center justify-between mb-3">
            <span className="text-[15px] font-extrabold text-text">{t('search.categories')}</span>
            <button onClick={() => navigate('/search')} className="text-[13px] font-bold text-primary">{t('home.see.all')}</button>
          </div>
          <div className="flex gap-3 overflow-x-auto scrollbar-hide -mx-5 px-5 pb-1">
            {topCategories.map(c => (
              <button key={c.id} onClick={() => navigate('/search', { state: { presetCategory: c.name } })} className="flex flex-col items-center gap-1.5 shrink-0 w-[68px]">
                <div className="w-14 h-14 rounded-2xl flex items-center justify-center" style={{ background: `${getCategoryColor(c.name)}22` }}>
                  <Icon name={c.icon} size={26} color={getCategoryColor(c.name)} />
                </div>
                <div className="text-xs font-bold text-text truncate w-full text-center">{c.name}</div>
                <div className="text-[11px] text-text3 -mt-1">{c.count}</div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Recent vouchers ── */}
      <div className={`px-5 mt-6 ${recentDeals.length > 0 ? 'pb-6' : 'pb-32'}`}>
        <div className="flex items-center justify-between mb-3">
          <span className="text-[15px] font-extrabold text-text">{t('home.recent')}</span>
          <button onClick={() => navigate('/search')} className="text-[13px] font-bold text-primary">{t('home.see.all')}</button>
        </div>

        {walletError && (
          <div className="mb-4 bg-error/10 border border-error/30 rounded-2xl p-4 text-sm">
            <p className="font-semibold text-error mb-1">{t('home.wallet.error')}</p>
            <p className="text-text2 text-xs mb-3">{t('home.wallet.error.hint')}</p>
            <button onClick={() => refreshVouchers()} className="px-4 py-2 bg-error text-white rounded-xl text-xs font-semibold">
              {t('app.retry')}
            </button>
          </div>
        )}

        {loading ? (
          <div className="flex flex-col gap-3">{[1, 2].map(i => <div key={i} className="h-20 gs-skeleton rounded-card" />)}</div>
        ) : recent.length === 0 ? (
          <div className="text-center py-12">
            <Icon name="redeem" size={56} color="var(--c-border)" />
            <p className="text-text2 font-medium mt-4">{t('home.empty.title')}</p>
            <p className="text-sm text-text3 mt-1 mb-5">{t('home.empty.hint')}</p>
            <button
              onClick={() => setShowForm(true)}
              className="inline-flex items-center gap-2 px-6 py-3 rounded-2xl bg-gradient-to-br from-primary-mid to-primary-dark text-white font-bold text-sm shadow-fab active:scale-[0.98] transition-transform"
            >
              <Icon name="add" size={20} /> {t('home.empty.cta')}
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {recent.map((v: Voucher) => {
              const pct = v.amount > 0 ? Math.min(100, Math.round((v.balance / v.amount) * 100)) : 0
              const status = getExpiryStatus(v.expiry_date)
              return (
                <button key={v.id} onClick={() => navigate(`/checkout/${v.id}`)} className="w-full text-right bg-surface rounded-card shadow-card p-3.5 flex gap-3 items-center">
                  <div
                    className="w-[52px] h-[52px] rounded-2xl flex items-center justify-center text-white font-extrabold text-sm flex-shrink-0"
                    style={{ background: getCategoryColor(v.categories[0] || 'אחר') }}
                  >
                    {getStoreInitials(v.store_name)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex justify-between items-baseline">
                      <span className="text-[15px] font-extrabold text-text truncate">{v.store_name}</span>
                      <span className="text-base font-black text-text">{formatCurrency(v.balance)}</span>
                    </div>
                    {v.amount > 0 && (
                      <>
                        <div className="text-[11.5px] font-bold text-success my-1">{pct}% {t('home.remaining')}</div>
                        <div className="h-1.5 rounded-full bg-bg overflow-hidden">
                          <div className="h-full w-full rounded-full bg-primary origin-right" style={{ transform: `scaleX(${Math.min(100, pct) / 100})`, transition: 'transform 200ms var(--ease-out)' }} />
                        </div>
                      </>
                    )}
                    {v.expiry_date && (
                      <div className={`text-[11px] mt-1.5 ${status === 'critical' ? 'text-error font-semibold' : status === 'warning' ? 'text-warning font-semibold' : 'text-text3'}`}>
                        {getExpiryLabel(v.expiry_date)}
                      </div>
                    )}
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </div>

      {/* ── Recent discounts ── */}
      {recentDeals.length > 0 && (
        <div className="px-5 pb-32">
          <div className="flex items-center justify-between mb-3">
            <span className="text-[15px] font-extrabold text-text">{t('home.recent.discounts')}</span>
            <button onClick={() => navigate('/discounts')} className="text-[13px] font-bold text-primary">{t('home.see.all')}</button>
          </div>
          <div className="flex flex-col gap-2">
            {recentDeals.map(deal => <DealCard key={deal.deal_id} deal={deal} />)}
          </div>
        </div>
      )}

      <AnimatePresence>
        {showForm && (
          <VoucherForm
            onClose={() => setShowForm(false)}
            onSave={handleSave}
          />
        )}
      </AnimatePresence>
    </div>
  )
}
