import { useState, useMemo, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useVouchers } from '../contexts/VoucherContext'
import { useAuth } from '../contexts/AuthContext'
import { useSubscription } from '../contexts/SubscriptionContext'
import { useE2EE } from '../contexts/E2EEContext'
import { useT } from '../lib/i18n'
import VoucherForm from '../components/VoucherForm'
import Icon from '../components/ui/Icon'
import type { Voucher } from '../types'
import { DEFAULT_CATEGORIES } from '../types'
import { formatCurrency, getExpiryStatus, getExpiryLabel, getStoreInitials, getCategoryColor } from '../utils/helpers'
import toast from 'react-hot-toast'
import { usePageView } from '../hooks/usePageView'
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
  const { vouchers, loading, walletError, isOnline, walletName, addVoucher, archiveExpired } = useVouchers()
  const { limits, openUpgradeSheet } = useSubscription()
  const { hasVault, hint, isVaultUnlocked, unlockVault, lockVault } = useE2EE()

  const [showVaultModal, setShowVaultModal] = useState(false)
  const [vaultPassInput, setVaultPassInput] = useState('')
  const [vaultUnlocking, setVaultUnlocking] = useState(false)
  const [vaultError, setVaultError] = useState('')

  async function handleVaultUnlock() {
    if (!vaultPassInput) return
    setVaultUnlocking(true)
    setVaultError('')
    const ok = await unlockVault(vaultPassInput)
    setVaultUnlocking(false)
    if (ok) { setShowVaultModal(false); setVaultPassInput('') }
    else setVaultError(t('vault.wrong.password'))
  }

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
  const reminderDays = parseInt(localStorage.getItem(`reminder_days_${user?.id}`) || '14')
  const [calendarModalDays, setCalendarModalDays] = useState(reminderDays)

  function openGoogleCalendar(id: string, storeName: string, expiryDate: string, days: number) {
    const expiry = new Date(expiryDate)
    const eventDay = new Date(expiry)
    eventDay.setDate(expiry.getDate() - days)
    const fmt = (d: Date) => d.toISOString().replace(/-/g, '').split('T')[0]
    const start = fmt(eventDay)
    const end = fmt(new Date(eventDay.getTime() + 86_400_000))
    const appUrl = import.meta.env.VITE_APP_URL || window.location.origin
    const params = new URLSearchParams({
      action: 'TEMPLATE',
      text: `תזכורת: שובר ${storeName} פג בקרוב`,
      dates: `${start}/${end}`,
      details: `שובר ${storeName} פג תוקפו ב-${expiry.toLocaleDateString('he-IL')} — עוד ${days} ימים!\n\nפתח את השובר: ${appUrl}/voucher/${id}`,
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
        setCalendarVoucher({ id: newVoucher.id, storeName: vData.store_name, expiryDate: vData.expiry_date })
      }
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
      message: `להעביר ${expiredCount} שוברים פגי תוקף לארכיון?`,
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

  const topCategories = useMemo(() => {
    const counts = new Map<string, number>()
    vouchers.forEach(v => v.categories.forEach(c => counts.set(c, (counts.get(c) || 0) + 1)))
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, TOP_CATEGORIES_COUNT)
      .map(([id, count]) => {
        const known = DEFAULT_CATEGORIES.find(c => c.id === id)
        return { id, name: known?.name ?? id, emoji: known?.emoji ?? '🏷️', count }
      })
  }, [vouchers])

  const recent = useMemo(
    () => [...vouchers].sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()).slice(0, RECENT_COUNT),
    [vouchers]
  )

  // Gauge arc geometry (matches the redesign's semi-circle gauge)
  const GAUGE_CIRC = 314 // ≈ π * r(100)
  const gaugeDash = (utilization / 100) * GAUGE_CIRC

  return (
    <div className="flex-1 bg-bg">
      {confirm && (
        <ConfirmDialog title={confirm.title} message={confirm.message} danger onConfirm={confirm.onConfirm} onCancel={() => setConfirm(null)} />
      )}

      {/* ── Google Calendar prompt ── */}
      {calendarVoucher && (
        <div className="fixed inset-0 bg-black/50 z-[90] flex items-end justify-center" onClick={() => setCalendarVoucher(null)}>
          <div className="bg-surface rounded-t-3xl w-full max-w-2xl p-5 pb-8" onClick={e => e.stopPropagation()} dir="rtl">
            <div className="flex justify-center mb-3"><div className="w-10 h-1 bg-border rounded-full" /></div>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-2xl bg-blue-50 flex items-center justify-center text-xl">📅</div>
              <div>
                <p className="font-bold text-text text-sm">{t('voucher.calendar.title')}</p>
                <p className="text-xs text-text3 mt-0.5">שובר: <strong>{calendarVoucher.storeName}</strong></p>
              </div>
            </div>
            <div className="flex items-center gap-3 mb-4 bg-bg rounded-2xl px-4 py-3">
              <span className="text-sm text-text2 flex-1">{t('voucher.calendar.days.label')}</span>
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => setCalendarModalDays(d => Math.max(1, d - 1))} className="w-7 h-7 rounded-full bg-border text-text font-bold text-sm">−</button>
                <input
                  type="number" min={1} max={365} value={calendarModalDays}
                  onChange={e => setCalendarModalDays(Math.max(1, Math.min(365, parseInt(e.target.value) || 1)))}
                  className="w-14 text-center text-sm font-semibold border border-border rounded-xl py-1 bg-surface text-text outline-none"
                />
                <button type="button" onClick={() => setCalendarModalDays(d => Math.min(365, d + 1))} className="w-7 h-7 rounded-full bg-border text-text font-bold text-sm">+</button>
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={() => openGoogleCalendar(calendarVoucher.id, calendarVoucher.storeName, calendarVoucher.expiryDate, calendarModalDays)} className="flex-1 py-3 bg-blue-600 text-white rounded-2xl font-semibold text-sm flex items-center justify-center gap-2">
                📅 {t('voucher.calendar.cta')}
              </button>
              <button onClick={() => setCalendarVoucher(null)} className="px-5 py-3 bg-bg text-text2 rounded-2xl font-medium text-sm">{t('voucher.calendar.skip')}</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Vault unlock modal ── */}
      {showVaultModal && (
        <div className="fixed inset-0 bg-black/50 z-[80] flex items-center justify-center p-6" onClick={() => { setShowVaultModal(false); setVaultPassInput(''); setVaultError('') }}>
          <div className="bg-surface rounded-3xl p-6 w-full max-w-sm shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-2xl bg-indigo-100 flex items-center justify-center">
                <Icon name="shield" size={20} color="#6366f1" />
              </div>
              <div>
                <p className="font-bold text-text text-sm">{t('vault.open.title')}</p>
                <p className="text-xs text-text3">{t('vault.open.subtitle')}</p>
              </div>
            </div>
            {hint && (
              <p className="text-xs text-indigo-500 mb-3 text-center flex items-center justify-center gap-1">
                <Icon name="lightbulb" size={14} /> {t('vault.hint')}: <span className="font-medium">{hint}</span>
              </p>
            )}
            <form onSubmit={e => { e.preventDefault(); handleVaultUnlock() }}>
              <input
                type="password" value={vaultPassInput} onChange={e => setVaultPassInput(e.target.value)}
                placeholder={t('vault.password.placeholder')}
                className="w-full px-4 py-3 border border-border rounded-2xl text-base mb-2 bg-surface text-text outline-none focus:ring-2 focus:ring-indigo-300"
                dir="ltr" autoFocus autoComplete="current-password" name="vault-password"
              />
              {vaultError && <p className="text-xs text-error mb-2">{vaultError}</p>}
              <div className="flex gap-2 mt-1">
                <button type="submit" disabled={vaultUnlocking || !vaultPassInput} className="flex-1 py-2.5 bg-indigo-600 text-white rounded-2xl text-sm font-semibold disabled:opacity-50">
                  {vaultUnlocking ? '...' : t('vault.open.button')}
                </button>
                <button type="button" onClick={() => { setShowVaultModal(false); setVaultPassInput(''); setVaultError('') }} className="flex-1 py-2.5 bg-bg text-text2 rounded-2xl text-sm">
                  {t('app.cancel')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Header ── */}
      <div className="flex items-center justify-between px-5 pt-5 pb-1">
        <Icon name="notifications" size={24} color="var(--c-text2)" />
        <div className="text-center">
          <div className="text-[19px] font-extrabold text-text">{walletName || t('wallet.main')}</div>
          <div className="text-[13px] text-text3 mt-0.5 flex items-center gap-1.5 justify-center">
            {!isOnline && <Icon name="wifi_off" size={13} />}
            {t('home.your.wallet')}
          </div>
        </div>
        <button
          onClick={() => hasVault && (isVaultUnlocked ? lockVault() : setShowVaultModal(true))}
          className={`w-10 h-10 rounded-full flex items-center justify-center ${!hasVault ? 'invisible' : ''}`}
          style={{ background: isVaultUnlocked ? 'var(--c-primary-light)' : 'var(--c-bg)' }}
          aria-label={isVaultUnlocked ? t('e2ee.lock') : t('e2ee.unlock')}
        >
          <Icon name="shield" size={18} color={isVaultUnlocked ? 'var(--c-primary)' : 'var(--c-text3)'} />
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
        <div className="text-[44px] font-black text-text tracking-tight leading-none">{formatCurrency(totalBalance)}</div>
      </div>

      <div className="relative h-[130px] mt-1.5">
        <svg viewBox="0 0 240 130" className="absolute top-0 left-1/2 -translate-x-1/2 w-[220px] h-[120px]">
          <path d="M20,120 A100,100 0 0 1 220,120" fill="none" stroke="var(--c-border)" strokeWidth="14" strokeLinecap="round" />
          <path
            d="M20,120 A100,100 0 0 1 220,120" fill="none" stroke="var(--c-primary)" strokeWidth="14" strokeLinecap="round"
            strokeDasharray={`${gaugeDash} ${GAUGE_CIRC * 2}`}
          />
        </svg>
        <div className="absolute inset-x-0 bottom-3 text-center">
          <div className="text-2xl font-extrabold text-text">{utilization}%</div>
          <div className="text-[11px] text-text3 font-medium">{t('home.utilization')}</div>
        </div>
      </div>

      {/* ── Categories glance ── */}
      {topCategories.length > 0 && (
        <div className="px-5 mt-4">
          <div className="flex items-center justify-between mb-3">
            <span className="text-[15px] font-extrabold text-text">{t('search.categories')}</span>
            <button onClick={() => navigate('/search')} className="text-[13px] font-bold text-primary">{t('home.see.all')}</button>
          </div>
          <div className="grid grid-cols-4 gap-3">
            {topCategories.map(c => (
              <button key={c.id} onClick={() => navigate('/search', { state: { presetCategory: c.id } })} className="flex flex-col items-center gap-1.5">
                <div className="w-full aspect-square rounded-2xl flex items-center justify-center text-2xl" style={{ background: `${getCategoryColor(c.id)}22` }}>
                  {c.emoji}
                </div>
                <div className="text-xs font-bold text-text truncate w-full text-center">{c.name}</div>
                <div className="text-[11px] text-text3 -mt-1">{c.count}</div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Recent vouchers ── */}
      <div className="px-5 mt-6 pb-32">
        <div className="flex items-center justify-between mb-3">
          <span className="text-[15px] font-extrabold text-text">{t('home.recent')}</span>
          <button onClick={() => navigate('/search')} className="text-[13px] font-bold text-primary">{t('home.see.all')}</button>
        </div>

        {walletError && (
          <div className="mb-4 bg-error/10 border border-error/30 rounded-2xl p-4 text-sm text-error">
            <p className="font-semibold mb-1">{t('home.wallet.error')}</p>
          </div>
        )}

        {loading ? (
          <div className="flex flex-col gap-3">{[1, 2].map(i => <div key={i} className="h-20 gs-skeleton rounded-card" />)}</div>
        ) : recent.length === 0 ? (
          <div className="text-center py-16">
            <Icon name="redeem" size={56} color="var(--c-border)" />
            <p className="text-text2 font-medium mt-4">{t('search.empty.default')}</p>
            <p className="text-sm text-text3 mt-1">{t('home.empty.hint')}</p>
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
                    style={{ background: getCategoryColor(v.categories[0] || 'other') }}
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
                          <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
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

      {showForm && (
        <VoucherForm
          onClose={() => setShowForm(false)}
          onSave={handleSave}
        />
      )}
    </div>
  )
}
