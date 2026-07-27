import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useVouchers } from '../contexts/VoucherContext'
import { useSubscription } from '../contexts/SubscriptionContext'
import { useE2EE } from '../contexts/E2EEContext'
import { useTheme } from '../contexts/ThemeContext'
import { usePageView } from '../hooks/usePageView'
import { supabase } from '../lib/supabase'
import toast from 'react-hot-toast'
import { useT } from '../lib/i18n'
import Icon from '../components/ui/Icon'
import { MenuItem, SL } from '../components/settings/SettingsUI'

interface CategoryDef { key: string; icon: string; title: string; desc: string; path: string }

export default function SettingsPage() {
  const navigate = useNavigate()
  const { user, profile, signOut } = useAuth()
  const { isPro, proExpiryDate, openUpgradeSheet } = useSubscription()
  const { vouchers, archivedVouchers } = useVouchers()
  const { hasVault, isVaultUnlocked } = useE2EE()
  const { theme } = useTheme()
  const { t } = useT()
  usePageView('settings')

  const [search, setSearch] = useState('')
  const [deletingAccount, setDeletingAccount] = useState(false)

  const totalBalance = useMemo(() => vouchers.reduce((sum, v) => sum + v.balance, 0), [vouchers])

  const categories: CategoryDef[] = [
    { key: 'account',       icon: 'person',           title: 'חשבון',       desc: 'פרטי משתמש, אימייל, סיסמה',        path: '/settings/account' },
    { key: 'wallet',        icon: 'account_balance_wallet', title: 'הארנק שלי', desc: 'שיתוף, מועדונים, תצוגת ערך', path: '/settings/wallet' },
    { key: 'marketplace',   icon: 'storefront',       title: 'שוק',         desc: 'אמצעי תשלום, מכירות ורכישות',      path: '/market' },
    { key: 'notifications', icon: 'notifications',    title: 'התראות',      desc: 'תזכורות תוקף, ערוצי התראה, טלגרם', path: '/settings/notifications' },
    { key: 'privacy',       icon: 'lock',             title: 'פרטיות',      desc: 'ביומטריה וכספת הצפנה',             path: '/settings/privacy' },
    { key: 'appearance',    icon: 'palette',          title: 'מראה',        desc: 'מצב כהה, שפה, שקיפות ניווט',       path: '/settings/appearance' },
    { key: 'backup',        icon: 'cloud',            title: 'גיבוי',       desc: 'סנכרון לענן, בדיקת חיבור',         path: '/settings/backup' },
    { key: 'accessibility', icon: 'accessibility_new', title: 'נגישות',     desc: 'כפתור נגישות והצהרת נגישות',       path: '/settings/accessibility' },
    { key: 'about',         icon: 'info',             title: 'אודות ותמיכה', desc: 'תמיכה, יומן פעילות, תנאים',      path: '/settings/about' },
  ]

  const filteredCategories = search.trim()
    ? categories.filter(c => c.title.includes(search.trim()) || c.desc.includes(search.trim()))
    : categories

  async function handleDeleteAccount() {
    if (!confirm(t('settings.delete.account.confirm1'))) return
    if (!confirm(t('settings.delete.account.confirm2'))) return
    setDeletingAccount(true)
    try {
      const { error } = await supabase.from('support_messages').insert({
        user_id: user!.id, user_email: user!.email, user_name: profile?.name || null,
        subject: t('settings.delete.account.subject'), body: t('settings.delete.account.body'), category: 'general',
      })
      if (error) throw error
      toast.success(t('settings.delete.account.sent'))
    } catch (e: any) {
      toast.error(e?.message || t('settings.delete.account.error'))
    } finally {
      setDeletingAccount(false)
    }
  }

  return (
    <div className="flex-1 bg-bg">
      <div className="pb-24 space-y-4">
        <h1 className="text-center text-lg font-extrabold text-text pt-5">{t('settings.title')}</h1>

        {/* Search */}
        <div className="px-4">
          <div className="relative">
            <Icon name="search" size={18} color="var(--c-text3)" className="absolute right-3 top-1/2 -translate-y-1/2" />
            <input
              type="text" value={search} onChange={e => setSearch(e.target.value)}
              placeholder="חפש הגדרה..."
              className="w-full pr-10 pl-3 py-2.5 border border-border rounded-2xl text-sm bg-surface text-text focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>
        </div>

        {/* Profile hero card */}
        <div className="px-4">
          <div
            className="rounded-[24px] px-5 py-5 shadow-card"
            style={{ background: 'linear-gradient(160deg, var(--c-primary-dark) 0%, var(--c-primary) 100%)' }}
          >
            <div className="flex items-center gap-4">
              <div className="w-16 h-16 rounded-[20px] bg-white/20 flex items-center justify-center text-[26px] font-extrabold text-white shrink-0">
                {(profile?.name || user?.email || '?').charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-xl font-extrabold text-white">{profile?.name || 'ללא שם'}</div>
                <div className="text-[13px] text-white/70 mt-0.5 truncate">{user?.email}</div>
                <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                  <span className={`text-[11px] font-bold px-2.5 py-0.5 rounded-full text-white ${isPro ? 'bg-white/30' : 'bg-white/20'}`}>
                    {isPro ? 'Pro ★' : 'משתמש רגיל'}
                  </span>
                  {isPro && proExpiryDate && (
                    <span className="text-[10px] text-white/65 font-medium">
                      פעיל עד {new Date(proExpiryDate).toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: 'numeric' })}
                    </span>
                  )}
                </div>
              </div>
              <button onClick={() => navigate('/settings/account')} className="bg-white/15 border-none rounded-[10px] w-9 h-9 flex items-center justify-center shrink-0">
                <Icon name="edit" size={16} color="#fff" />
              </button>
            </div>
            <div className="flex items-center justify-between mt-4 pt-4 border-t border-white/20">
              <span className="text-sm text-white/80">{vouchers.length} שוברים</span>
              <span className="text-lg font-black text-white">₪{totalBalance.toLocaleString('he-IL')}</span>
            </div>
          </div>
        </div>

        {/* Pro upgrade card */}
        {!isPro && (
          <div className="px-4">
            <div
              onClick={() => openUpgradeSheet('שדרג לחוויה מלאה')}
              className="gs-tap rounded-[18px] px-[18px] py-4 cursor-pointer relative overflow-hidden"
              style={{ background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)', boxShadow: '0 4px 24px rgba(0,0,0,0.2)' }}
            >
              <div className="flex items-center gap-3.5">
                <div className="w-[46px] h-[46px] rounded-2xl flex items-center justify-center shrink-0" style={{ background: 'linear-gradient(135deg, var(--c-gold) 0%, #e8b422 100%)' }}>
                  <Icon name="workspace_premium" size={20} filled color="#fff" />
                </div>
                <div className="flex-1">
                  <div className="text-[15px] font-extrabold text-white">שדרג ל-GiftSmart Pro</div>
                  <div className="text-xs text-white/60 mt-0.5">שוברים ללא הגבלה · ₪9 לחודש</div>
                </div>
                <Icon name="chevron_left" size={16} color="rgba(255,255,255,0.5)" />
              </div>
            </div>
          </div>
        )}

        {/* Quick status */}
        <div className="px-4 grid grid-cols-4 gap-2">
          <QuickStatusTile icon="cloud" label="מסונכרן" active />
          <QuickStatusTile icon="lock" label={hasVault ? (isVaultUnlocked ? 'פתוחה' : 'מאובטח') : 'ללא כספת'} active={hasVault} />
          <QuickStatusTile icon="workspace_premium" label={isPro ? 'Premium' : 'רגיל'} active={isPro} />
          <QuickStatusTile icon={theme === 'dark' ? 'dark_mode' : 'light_mode'} label={theme === 'dark' ? 'Dark' : 'Light'} active={theme === 'dark'} />
        </div>

        {/* Category cards */}
        <div className="px-4 space-y-2">
          {filteredCategories.map(c => (
            <button
              key={c.key}
              onClick={() => navigate(c.path)}
              className="w-full flex items-center gap-3 bg-surface rounded-card shadow-card p-4 text-right hover:opacity-90 transition"
            >
              <div className="w-12 h-12 rounded-full bg-primary-light flex items-center justify-center shrink-0">
                <Icon name={c.icon} size={22} color="var(--c-primary)" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[15px] font-semibold text-text">{c.title}</p>
                <p className="text-xs text-text3 mt-0.5">{c.desc}</p>
              </div>
              <Icon name="chevron_left" size={18} color="var(--c-text3)" />
            </button>
          ))}
          {filteredCategories.length === 0 && (
            <p className="text-center text-sm text-text3 py-6">לא נמצאו הגדרות תואמות</p>
          )}
        </div>

        {/* Quick nav shortcuts — navigation, not settings, but Market/Discounts/Archive are
            only reachable via Settings since they were pulled off the bottom nav. */}
        <SL>{t('settings.quick.nav')}</SL>
        <div className="px-4">
          <div className="bg-surface rounded-card shadow-card overflow-hidden">
            <div className="divide-y divide-border">
              <MenuItem
                icon="archive"
                label={t('nav.archive')}
                desc={t('settings.quick.archive.desc')}
                onClick={() => navigate('/archive')}
                right={archivedVouchers.length > 0 ? <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-bg text-text3">{archivedVouchers.length}</span> : undefined}
              />
              <MenuItem icon="storefront" label={t('market.marketplace')} desc={t('settings.quick.market.desc')} onClick={() => navigate('/market')} />
              <MenuItem icon="percent" label={t('nav.discounts')} desc={t('settings.quick.discounts.desc')} onClick={() => navigate('/discounts')} />
            </div>
          </div>
        </div>

        {/* Danger zone — deliberately separated from everything else. */}
        <SL>אזור מסוכן</SL>
        <div className="px-4">
          <div className="bg-error/5 border border-error/20 rounded-card overflow-hidden">
            <div className="divide-y divide-error/20">
              <MenuItem
                icon="delete"
                label={t('settings.delete.account')}
                desc={t('settings.delete.account.desc')}
                onClick={handleDeleteAccount}
                danger
                right={deletingAccount ? <Icon name="progress_activity" size={20} color="var(--c-error)" className="animate-spin" /> : undefined}
              />
              <MenuItem icon="logout" label={t('settings.logout')} desc="יציאה מהחשבון" onClick={() => { if (confirm('להתנתק?')) signOut() }} danger />
            </div>
          </div>
        </div>

        <p className="text-center text-xs text-text3">GiftSmart v1.1.0</p>
      </div>
    </div>
  )
}

function QuickStatusTile({ icon, label, active }: { icon: string; label: string; active?: boolean }) {
  return (
    <div className={`flex flex-col items-center justify-center gap-1 rounded-2xl py-3 ${active ? 'bg-primary-light' : 'bg-surface shadow-card'}`} style={{ minHeight: 72 }}>
      <Icon name={icon} size={20} color={active ? 'var(--c-primary)' : 'var(--c-text3)'} filled={active} />
      <span className={`text-[10px] font-semibold ${active ? 'text-primary' : 'text-text3'}`}>{label}</span>
    </div>
  )
}
