import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useVouchers } from '../contexts/VoucherContext'
import { useMarketplace } from '../contexts/MarketplaceContext'
import { useSubscription } from '../contexts/SubscriptionContext'
import { useE2EE } from '../contexts/E2EEContext'
import { useTheme } from '../contexts/ThemeContext'
import { usePageView } from '../hooks/usePageView'
import { useT } from '../lib/i18n'
import Icon from '../components/ui/Icon'
import VaultSetupSheet from '../components/VaultSetupSheet'
import { MenuItem, SL } from '../components/settings/SettingsUI'

interface CategoryDef { key: string; icon: string; title: string; desc: string; path: string; keywords: string }

export default function SettingsPage() {
  const navigate = useNavigate()
  const { user, profile, isAdmin } = useAuth()
  const { isPro, proExpiryDate, openUpgradeSheet } = useSubscription()
  const { vouchers, archivedVouchers, isOnline, pendingOpsCount } = useVouchers()
  const { marketplaceMode } = useMarketplace()
  // 'disabled' hides marketplace entry points entirely (admins keep them);
  // 'selective' keeps them visible — the market page itself shows the request-access gate
  const showMarketEntries = isAdmin || marketplaceMode !== 'disabled'
  const { hasVault, isVaultUnlocked } = useE2EE()
  const { theme, toggleTheme } = useTheme()
  const { t } = useT()
  usePageView('settings')

  const [search, setSearch] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [showVaultSetup, setShowVaultSetup] = useState(false)

  const totalBalance = useMemo(() => vouchers.reduce((sum, v) => sum + v.balance, 0), [vouchers])

  // keywords index the ACTUAL settings inside each sub-page, so searching
  // "ביומטריה" or "טלגרם" finds the right card (the old search matched only the
  // eight visible titles/descs)
  const categories: CategoryDef[] = [
    { key: 'wallet',        icon: 'account_balance_wallet', title: t('hub.cat.wallet'), desc: t('hub.cat.wallet.desc'), path: '/settings/wallet', keywords: 'חברים הזמנה משפחה מועדון אשראי ערך שוק' },
    ...(showMarketEntries ? [{ key: 'marketplace',   icon: 'storefront',       title: t('nav.market'),         desc: t('hub.cat.market.desc'),      path: '/market', keywords: 'ביט פייבוקס פייפאל מכירה קנייה מודעה' }] : []),
    { key: 'notifications', icon: 'notifications',    title: t('settings.notifications'),      desc: t('hub.cat.notifications.desc'), path: '/settings/notifications', keywords: 'טלגרם פוש מייל אימייל תזכורת ימים תוקף' },
    { key: 'privacy',       icon: 'lock',             title: t('privacy.title'),      desc: t('hub.cat.privacy.desc'),             path: '/settings/privacy', keywords: 'ביומטריה טביעת אצבע כספת הצפנה סיסמה קוד שחזור נעילה' },
    { key: 'appearance',    icon: 'palette',          title: t('settings.appearance'),        desc: t('hub.cat.appearance.desc'),       path: '/settings/appearance', keywords: 'כהה בהיר שפה אנגלית עברית שקיפות ערכת נושא' },
    { key: 'backup',        icon: 'cloud',            title: t('backup.title'),       desc: t('hub.cat.backup.desc'),         path: '/settings/backup', keywords: 'סנכרון ענן חיבור אופליין' },
    { key: 'accessibility', icon: 'accessibility_new', title: t('settings.accessibility'),     desc: t('hub.cat.accessibility.desc'),       path: '/settings/accessibility', keywords: 'טקסט גדול ניגודיות אנימציה הצהרה' },
    { key: 'about',         icon: 'info',             title: t('about.title'), desc: t('hub.cat.about.desc'),      path: '/settings/about', keywords: 'תמיכה פנייה יומן היסטוריה תנאים פרטיות מדריך גרסה' },
  ]

  const filteredCategories = search.trim()
    ? categories.filter(c => {
        const q = search.trim()
        return c.title.includes(q) || c.desc.includes(q) || c.keywords.includes(q)
      })
    : categories

  const syncLabel = !isOnline ? t('hub.sync.offline') : pendingOpsCount > 0 ? t('hub.sync.syncing', { count: pendingOpsCount }) : t('hub.sync.synced')

  return (
    <div className="flex-1 bg-bg">
      <div className="pb-24 space-y-4">
        <div className="relative flex items-center justify-center pt-5">
          <h1 className="text-lg font-extrabold text-text">{t('settings.title')}</h1>
          <button
            onClick={() => setSearchOpen(v => !v)}
            className="absolute start-4 w-11 h-11 rounded-full flex items-center justify-center bg-surface shadow-card"
            aria-label={t('hub.search.aria')}
            aria-expanded={searchOpen}
          >
            <Icon name="search" size={19} color="var(--c-text2)" />
          </button>
        </div>

        {/* Search — hidden until the user scrolls down or taps the search icon */}
        {searchOpen && (
          <div className="px-4">
            <div className="relative">
              <Icon name="search" size={18} color="var(--c-text3)" className="absolute right-3 top-1/2 -translate-y-1/2" />
              <input
                type="text" value={search} onChange={e => setSearch(e.target.value)}
                placeholder={t('hub.search.placeholder')}
                autoFocus
                className="w-full ps-10 pe-3 py-2.5 border border-border rounded-2xl text-base bg-surface text-text focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>
          </div>
        )}

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
                <div className="text-xl font-extrabold text-white">{profile?.name || t('hub.no.name')}</div>
                <div className="text-[13px] text-white/70 mt-0.5 truncate">{user?.email}</div>
                <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                  <span className={`text-[11px] font-bold px-2.5 py-0.5 rounded-full text-white ${isPro ? 'bg-white/30' : 'bg-white/20'}`}>
                    {isPro ? 'Pro ★' : t('hub.plan.free')}
                  </span>
                  {isAdmin && (
                    <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2.5 py-0.5 rounded-full text-white bg-white/30">
                      <Icon name="verified_user" size={11} color="#fff" filled />
                      {t('nav.admin')}
                    </span>
                  )}
                  {isPro && proExpiryDate && (
                    <span className="text-[10px] text-white/65 font-medium">
                      {t('hub.pro.active.until', { date: new Date(proExpiryDate).toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: 'numeric' }) })}
                    </span>
                  )}
                </div>
              </div>
              <button onClick={() => navigate('/settings/account')} aria-label={t('settings.edit.profile.aria')} className="bg-white/15 border-none rounded-xl w-11 h-11 flex items-center justify-center shrink-0">
                <Icon name="edit" size={18} color="#fff" />
              </button>
            </div>
            <div className="flex items-center justify-between mt-4 pt-4 border-t border-white/20">
              <span className="text-sm text-white/80">{t('hub.vouchers.count', { count: vouchers.length })}</span>
              <span className="text-lg font-black text-white">₪{totalBalance.toLocaleString('he-IL')}</span>
            </div>

            {/* Admin panel entry — an identity-level capability, so it belongs on the
                profile card rather than buried at the bottom of About/Support. */}
            {isAdmin && (
              <button
                onClick={() => navigate('/admin')}
                className="w-full flex items-center gap-3 mt-4 pt-4 border-t border-white/20 text-right active:opacity-80 transition-opacity"
              >
                <div className="w-9 h-9 rounded-xl bg-white/20 flex items-center justify-center shrink-0">
                  <Icon name="verified_user" size={18} color="#fff" filled />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-bold text-white">{t('settings.admin.link')}</div>
                  <div className="text-[11px] text-white/70 mt-0.5 truncate">{t('settings.admin.link.desc')}</div>
                </div>
                <Icon name="chevron_left" size={18} color="rgba(255,255,255,0.7)" />
              </button>
            )}
          </div>
        </div>

        {/* Pro upgrade card */}
        {!isPro && (
          <div className="px-4">
            <div
              onClick={() => openUpgradeSheet(t('hub.upgrade.reason'))}
              className="gs-tap rounded-[18px] px-[18px] py-4 cursor-pointer relative overflow-hidden"
              style={{ background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)', boxShadow: '0 4px 24px rgba(0,0,0,0.2)' }}
            >
              <div className="flex items-center gap-3.5">
                <div className="w-[46px] h-[46px] rounded-2xl flex items-center justify-center shrink-0" style={{ background: 'linear-gradient(135deg, var(--c-gold) 0%, #e8b422 100%)' }}>
                  <Icon name="workspace_premium" size={20} filled color="#fff" />
                </div>
                <div className="flex-1">
                  <div className="text-[15px] font-extrabold text-white">{t('hub.upgrade.title')}</div>
                  <div className="text-xs text-white/60 mt-0.5">{t('hub.upgrade.desc')}</div>
                </div>
                <Icon name="chevron_left" size={16} color="rgba(255,255,255,0.5)" />
              </div>
            </div>
          </div>
        )}

        {/* Quick status — sync now reflects REALITY (the old tile was hardcoded
            green even fully offline) */}
        <div className="px-4 grid grid-cols-4 gap-2">
          <QuickStatusTile icon={isOnline ? 'cloud' : 'wifi_off'} label={syncLabel} active={isOnline && pendingOpsCount === 0} />
          <QuickStatusTile
            icon="lock"
            label={hasVault ? (isVaultUnlocked ? t('hub.tile.vault.open') : t('hub.tile.vault.secure')) : t('privacy.vault.enable')}
            active={hasVault}
            onClick={hasVault ? () => navigate('/settings/privacy') : () => setShowVaultSetup(true)}
          />
          <QuickStatusTile icon="workspace_premium" label={isPro ? 'Premium' : t('hub.tile.standard')} active={isPro} />
          <QuickStatusTile icon={theme === 'dark' ? 'dark_mode' : 'light_mode'} label={theme === 'dark' ? 'Dark' : 'Light'} active={theme === 'dark'} onClick={toggleTheme} />
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
            <p className="text-center text-sm text-text3 py-6">{t('hub.no.results')}</p>
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
              {showMarketEntries && (
                <MenuItem icon="storefront" label={t('market.marketplace')} desc={t('settings.quick.market.desc')} onClick={() => navigate('/market')} />
              )}
              <MenuItem icon="percent" label={t('nav.discounts')} desc={t('settings.quick.discounts.desc')} onClick={() => navigate('/discounts')} />
            </div>
          </div>
        </div>

        <p className="text-center text-xs text-text3">GiftSmart v1.1.0</p>
      </div>

      <VaultSetupSheet open={showVaultSetup} onClose={() => setShowVaultSetup(false)} />
    </div>
  )
}

function QuickStatusTile({ icon, label, active, onClick }: { icon: string; label: string; active?: boolean; onClick?: () => void }) {
  const Tag = onClick ? 'button' : 'div'
  return (
    <Tag
      onClick={onClick}
      className={`flex flex-col items-center justify-center gap-1 rounded-2xl py-3 ${active ? 'bg-primary-light' : 'bg-surface shadow-card'} ${onClick ? 'active:scale-95 transition-transform' : ''}`}
      style={{ minHeight: 72 }}
    >
      <Icon name={icon} size={20} color={active ? 'var(--c-primary)' : 'var(--c-text3)'} filled={active} />
      <span className={`text-[10px] font-semibold ${active ? 'text-primary' : 'text-text3'}`}>{label}</span>
    </Tag>
  )
}
