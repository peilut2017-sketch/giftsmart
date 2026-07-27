import { BrowserRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom'
import { Analytics } from '@vercel/analytics/react'
import { SpeedInsights } from '@vercel/speed-insights/react'
import AnimatedRoutes from './components/AnimatedRoutes'
import toast, { Toaster } from 'react-hot-toast'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import { VoucherProvider, useVouchers } from './contexts/VoucherContext'
import { SubscriptionProvider, useSubscription } from './contexts/SubscriptionContext'
import { MarketplaceProvider } from './contexts/MarketplaceContext'
import { DiscountsProvider } from './contexts/DiscountsContext'
import { E2EEProvider } from './contexts/E2EEContext'
import { ThemeProvider } from './contexts/ThemeContext'
import { LocaleProvider, useLocale } from './lib/i18n'
import { useExpiryNotifications } from './hooks/useNotifications'
import { supabase } from './lib/supabase'
import UpgradeSheet from './components/UpgradeSheet'
import AuthPage from './pages/AuthPage'
import LandingPage from './pages/LandingPage'
import HomePage from './pages/HomePage'
import BottomNav from './components/BottomNav'
import WelcomeModal from './components/WelcomeModal'
import OfflineBanner from './components/OfflineBanner'
import LoginBanner from './components/LoginBanner'
import PWAInstallBanner from './components/PWAInstallBanner'
import BiometricGate from './components/BiometricGate'
import AccessibilityWidget from './components/AccessibilityWidget'
import RecoveryKeyModal from './components/RecoveryKeyModal'
import VaultMigrationModal from './components/VaultMigrationModal'
import OAuthVaultSetupPrompt from './components/OAuthVaultSetupPrompt'
import { isBiometricEnabled, getBiometricEmail, syncBiometricFromSupabase } from './lib/passkey'
import { GiftSmartSplash } from './components/GiftSmartLogo'
import OnboardingGuide from './components/OnboardingGuide'
import { AlertTriangle } from 'lucide-react'
import { Component, useState, useEffect, useRef, lazy, Suspense } from 'react'
import { useE2EE } from './contexts/E2EEContext'
import type { ReactNode } from 'react'

const CheckoutPage     = lazy(() => import('./pages/CheckoutPage'))
const SearchPage       = lazy(() => import('./pages/SearchPage'))
const VoucherPage      = lazy(() => import('./pages/VoucherPage'))
const ArchivePage      = lazy(() => import('./pages/ArchivePage'))
const StatsPage        = lazy(() => import('./pages/StatsPage'))
const SettingsPage     = lazy(() => import('./pages/SettingsPage'))
const AdminPage        = lazy(() => import('./pages/AdminPage'))
const AccessibilityPage = lazy(() => import('./pages/AccessibilityPage'))
const MarketplacePage  = lazy(() => import('./pages/MarketplacePage'))
const DiscountsPage    = lazy(() => import('./pages/DiscountsPage'))
const ListingDetailPage = lazy(() => import('./pages/ListingDetailPage'))
const BulkListPage     = lazy(() => import('./pages/BulkListPage'))
const PrivacyPage      = lazy(() => import('./pages/PrivacyPage'))
const TermsPage        = lazy(() => import('./pages/TermsPage'))
const SharedVoucherPage = lazy(() => import('./pages/SharedVoucherPage'))
const SettingsAccountPage       = lazy(() => import('./pages/settings/SettingsAccountPage'))
const SettingsWalletPage        = lazy(() => import('./pages/settings/SettingsWalletPage'))
const SettingsNotificationsPage = lazy(() => import('./pages/settings/SettingsNotificationsPage'))
const SettingsPrivacyPage       = lazy(() => import('./pages/settings/SettingsPrivacyPage'))
const SettingsAppearancePage    = lazy(() => import('./pages/settings/SettingsAppearancePage'))
const SettingsBackupPage        = lazy(() => import('./pages/settings/SettingsBackupPage'))
const SettingsAccessibilityPage = lazy(() => import('./pages/settings/SettingsAccessibilityPage'))
const SettingsAboutPage         = lazy(() => import('./pages/settings/SettingsAboutPage'))
const GiftPage         = lazy(() => import('./pages/GiftPage'))

function LoadingDots({ size = 'md' }: { size?: 'sm' | 'md' }) {
  const dotClass = size === 'sm' ? 'w-2 h-2' : 'w-2.5 h-2.5'
  return (
    <div className="flex items-center gap-1.5">
      {[0, 1, 2].map(i => (
        <div
          key={i}
          className={`${dotClass} rounded-full bg-green-500 animate-bounce`}
          style={{ animationDelay: `${i * 0.15}s`, animationDuration: '0.9s' }}
        />
      ))}
    </div>
  )
}

function PageSpinner() {
  return (
    <div className="flex-1 flex items-center justify-center min-h-[200px]">
      <LoadingDots />
    </div>
  )
}


class ErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean; message: string }> {
  constructor(props: { children: ReactNode }) {
    super(props)
    this.state = { hasError: false, message: '' }
  }
  static getDerivedStateFromError(err: unknown) {
    return { hasError: true, message: err instanceof Error ? err.message : String(err) }
  }
  componentDidCatch(err: unknown, info: unknown) {
    console.error('[ErrorBoundary]', err, info)
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex flex-col items-center justify-center gap-4 p-6 text-center" dir="rtl">
          <AlertTriangle className="w-12 h-12 text-amber-500" />
          <h1 className="text-xl font-bold">משהו השתבש</h1>
          <p className="text-sm text-gray-500">{this.state.message}</p>
          <button
            className="mt-2 px-6 py-2 bg-green-600 text-white rounded-full text-sm font-medium"
            onClick={() => window.location.reload()}
          >
            רענן את הדף
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

const A11Y_WIDGET_KEY = 'a11y_widget_enabled'

const SEEN_PUSH_KEY = 'seen_push_broadcast_ids'

// Shows vault-related modals in priority order
function VaultModals() {
  const { pendingRecoveryPhrase, dismissRecoveryPhrase, needsMigration, needsOAuthVaultSetup } = useE2EE()
  const [migrationDismissed, setMigrationDismissed] = useState(false)

  // Recovery key must be acknowledged before anything else
  if (pendingRecoveryPhrase) {
    return <RecoveryKeyModal phrase={pendingRecoveryPhrase} onDone={dismissRecoveryPhrase} />
  }

  // Migration prompt for users who had a separate vault passphrase
  if (needsMigration && !migrationDismissed) {
    return (
      <VaultMigrationModal
        onDone={dismissRecoveryPhrase}
        onSkip={() => setMigrationDismissed(true)}
      />
    )
  }

  // OAuth users (Google etc.) who have no vault yet
  if (needsOAuthVaultSetup) {
    return <OAuthVaultSetupPrompt />
  }

  return null
}

// Builds the in-memory decrypted map whenever the vault opens or vouchers change
function E2EEBridge() {
  const { isVaultUnlocked, buildDecryptedMap } = useE2EE()
  const { vouchers, archivedVouchers } = useVouchers()
  const prevUnlocked = useRef(false)

  useEffect(() => {
    const justUnlocked = isVaultUnlocked && !prevUnlocked.current
    prevUnlocked.current = isVaultUnlocked
    if (!isVaultUnlocked) return
    const all = [...vouchers, ...archivedVouchers].filter(v => v.is_e2ee)
    if (all.length === 0 && !justUnlocked) return
    buildDecryptedMap(all)
  }, [isVaultUnlocked, vouchers, archivedVouchers]) // eslint-disable-line react-hooks/exhaustive-deps

  return null
}

function NotificationBridge() {
  const { vouchers } = useVouchers()
  const { user, profile, isAdmin } = useAuth()
  const { isPro } = useSubscription()
  useExpiryNotifications(vouchers, isPro, user?.id, user?.email ?? undefined, profile?.name ?? undefined)

  // Admin: receive push notification for new support messages from any page
  useEffect(() => {
    if (!isAdmin) return
    const channel = supabase
      .channel('admin-support-global')
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'support_messages',
      }, (payload) => {
        const msg = payload.new as { subject: string; user_email?: string; user_name?: string }
        if (Notification.permission === 'granted') {
          new Notification('📩 הודעת תמיכה חדשה', {
            body: `${msg.user_email || msg.user_name || 'משתמש'}: ${msg.subject}`,
            icon: '/logo.png',
            tag: 'admin-support',
          })
        }
      })
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'support_message_replies',
      }, (payload) => {
        const reply = payload.new as { sender: string; message_id: string }
        if (reply.sender === 'user' && Notification.permission === 'granted') {
          new Notification('💬 תשובה חדשה מהמשתמש', {
            body: 'משתמש השיב להודעת תמיכה',
            icon: '/logo.png',
            tag: 'admin-support-reply',
          })
        }
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [isAdmin])

  // On mount: show any unseen push broadcasts + subscribe to future ones
  useEffect(() => {
    if (!user) return
    let seenIds: Set<string>
    try {
      seenIds = new Set(JSON.parse(localStorage.getItem(SEEN_PUSH_KEY) || '[]'))
    } catch {
      seenIds = new Set()
    }

    function showPush(id: string, title: string, body: string) {
      if (seenIds.has(id)) return
      seenIds.add(id)
      localStorage.setItem(SEEN_PUSH_KEY, JSON.stringify([...seenIds]))
      if (Notification.permission === 'granted') {
        new Notification(title, { body, icon: '/logo.png' })
      }
    }

    // Fetch recent unseen broadcasts
    supabase
      .from('push_broadcasts')
      .select('*')
      .gte('created_at', new Date(Date.now() - 30 * 86400000).toISOString())
      .order('created_at', { ascending: true })
      .then(({ data }) => {
        data?.forEach(b => showPush(b.id, b.title, b.body))
      })

    // Realtime for future broadcasts
    const channel = supabase
      .channel('push-broadcasts')
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'push_broadcasts',
      }, (payload) => {
        const b = payload.new as { id: string; title: string; body: string }
        showPush(b.id, b.title, b.body)
      })
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [user])

  // Notify owner when someone updates balance via a shared link
  useEffect(() => {
    if (!user) return
    const channel = supabase
      .channel(`shared-balance-${user.id}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'shared_balance_updates',
        filter: `owner_user_id=eq.${user.id}`,
      }, (payload) => {
        const { store_name, old_balance, new_balance, store_used } = payload.new as {
          store_name: string
          old_balance: number
          new_balance: number
          store_used?: string | null
        }
        const locationSuffix = store_used ? ` · ${store_used}` : ''
        toast(`יתרת "${store_name}" עודכנה: ₪${old_balance} ← ₪${new_balance}${locationSuffix}`, { duration: 6000 })
        if (Notification.permission === 'granted') {
          new Notification('יתרת שובר עודכנה', {
            body: `${store_name}: ₪${old_balance} → ₪${new_balance}${locationSuffix}`,
            icon: '/pwa-192x192.png',
          })
        }
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [user])

  return <UpgradeSheet />
}

function AppRoutes() {
  const { user, loading, passwordRecovery, signOut } = useAuth()
  const navigate = useNavigate()
  const [biometricLocked, setBiometricLocked] = useState(false)
  const [biometricSyncChecking, setBiometricSyncChecking] = useState(false)

  interface BannerData {
    id: string
    image_url: string
    display_duration: number
    skip_allowed: boolean
  }
  const [banners, setBanners] = useState<BannerData[]>([])
  const [bannerIndex, setBannerIndex] = useState(0)

  // After login: redirect back to gift page if user came from one
  useEffect(() => {
    if (!user) return
    const returnTo = sessionStorage.getItem('gift_return')
    if (returnTo) {
      sessionStorage.removeItem('gift_return')
      // Reject open-redirect attempts: only allow simple internal paths
      if (returnTo.startsWith('/') && !returnTo.startsWith('//')) {
        navigate(returnTo, { replace: true })
      }
    }
  }, [user, navigate])

  // After login: fetch all active banners to show in sequence
  useEffect(() => {
    if (!user) { setBanners([]); setBannerIndex(0); return }
    supabase.rpc('get_active_banners').then(({ data }) => {
      if (data && data.length > 0) setBanners(data)
    })
  }, [user?.id])
  const [widgetEnabled, setWidgetEnabled] = useState(
    () => localStorage.getItem(A11Y_WIDGET_KEY) !== 'false'
  )

  // Listen for settings changes from SettingsPage
  useEffect(() => {
    const onStorage = () => {
      setWidgetEnabled(localStorage.getItem(A11Y_WIDGET_KEY) !== 'false')
    }
    window.addEventListener('storage', onStorage)
    // Also poll for same-tab changes via custom event
    window.addEventListener('a11y-widget-toggle', onStorage)
    return () => {
      window.removeEventListener('storage', onStorage)
      window.removeEventListener('a11y-widget-toggle', onStorage)
    }
  }, [])

  useEffect(() => {
    if (!user) return

    function applyBiometricLock() {
      const biometricEmail = getBiometricEmail()
      if (biometricEmail && biometricEmail.toLowerCase() !== (user!.email ?? '').toLowerCase()) return
      const lastTs = parseInt(sessionStorage.getItem('gs_biometric_unlock_ts') || '0')
      if (Date.now() - lastTs > 5 * 60 * 1000) setBiometricLocked(true)
    }

    if (isBiometricEnabled()) {
      // Already in localStorage — lock synchronously, no Supabase round-trip needed
      applyBiometricLock()
    } else {
      // Not in localStorage — check Supabase (synced passkey from another device)
      setBiometricSyncChecking(true)
      ;(async () => {
        try {
          const restored = await syncBiometricFromSupabase()
          if (restored) applyBiometricLock()
        } finally {
          setBiometricSyncChecking(false)
        }
      })()
    }
  }, [user?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  if (loading || biometricSyncChecking) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-8 bg-gray-50">
        <GiftSmartSplash />
        <LoadingDots />
      </div>
    )
  }

  if (passwordRecovery) return <AuthPage initialMode="newPassword" />
  if (!user) {
    const path = window.location.pathname
    if (path === '/privacy') return <PrivacyPage />
    if (path === '/terms') return <TermsPage />
    // Skip landing page if running as installed PWA or navigating directly to /login
    const isPWA =
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as unknown as { standalone?: boolean }).standalone === true
    if (isPWA || path === '/login') return <AuthPage />
    return <LandingPage />
  }

  if (biometricLocked) {
    return (
      <BiometricGate
        onUnlock={() => {
          sessionStorage.setItem('gs_biometric_unlock_ts', String(Date.now()))
          setBiometricLocked(false)
        }}
        onSignOut={() => { signOut(); setBiometricLocked(false) }}
      />
    )
  }

  if (banners.length > 0 && bannerIndex < banners.length) {
    const b = banners[bannerIndex]
    return (
      <LoginBanner
        imageUrl={b.image_url}
        duration={b.display_duration ?? 5}
        skipAllowed={b.skip_allowed ?? true}
        onDismiss={() => setBannerIndex(i => i + 1)}
      />
    )
  }

  return (
    <E2EEProvider>
    <SubscriptionProvider>
    <VoucherProvider>
    <DiscountsProvider>
    <MarketplaceProvider>
      <NotificationBridge />
      <E2EEBridge />
      <VaultModals />
      <WelcomeModal userId={user!.id} />
      {/* Skip to main content — visible on keyboard focus */}
      <a href="#main-content" className="skip-link">דלג לתוכן הראשי</a>
      {/* padding-bottom reserves space so content is never hidden behind the fixed BottomNav */}
      <div className="flex flex-col min-h-dvh w-full max-w-2xl mx-auto" style={{ paddingBottom: 'var(--nav-h)' }}>
        <OfflineBanner />
        <main id="main-content" className="flex-1 flex flex-col">
          <Suspense fallback={<PageSpinner />}>
            <AnimatedRoutes>
              <Route path="/" element={<HomePage />} />
              <Route path="/search" element={<SearchPage />} />
              <Route path="/voucher/:id" element={<VoucherPage />} />
              <Route path="/checkout/:id" element={<CheckoutPage />} />
              <Route path="/archive" element={<ArchivePage />} />
              <Route path="/stats" element={<StatsPage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="/settings/account" element={<SettingsAccountPage />} />
              <Route path="/settings/wallet" element={<SettingsWalletPage />} />
              <Route path="/settings/notifications" element={<SettingsNotificationsPage />} />
              <Route path="/settings/privacy" element={<SettingsPrivacyPage />} />
              <Route path="/settings/appearance" element={<SettingsAppearancePage />} />
              <Route path="/settings/backup" element={<SettingsBackupPage />} />
              <Route path="/settings/accessibility" element={<SettingsAccessibilityPage />} />
              <Route path="/settings/about" element={<SettingsAboutPage />} />
              <Route path="/admin" element={<AdminPage />} />
              <Route path="/accessibility" element={<AccessibilityPage />} />
              <Route path="/market" element={<MarketplacePage />} />
              <Route path="/discounts" element={<DiscountsPage />} />
              <Route path="/market/listing/:id" element={<ListingDetailPage />} />
              <Route path="/market/bulk" element={<BulkListPage />} />
              <Route path="/privacy" element={<PrivacyPage />} />
              <Route path="/terms" element={<TermsPage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </AnimatedRoutes>
          </Suspense>
        </main>
        <PWAInstallBanner />
      </div>
      {/* BottomNav is outside the container so overflow:hidden/transform never traps it */}
      <BottomNav />
      {widgetEnabled && <AccessibilityWidget />}
      <OnboardingGuide />
    </MarketplaceProvider>
    </DiscountsProvider>
    </VoucherProvider>
    </SubscriptionProvider>
    </E2EEProvider>
  )
}


function ToasterWithLocale() {
  const { dir } = useLocale()
  return (
    <Toaster
      position="top-center"
      toastOptions={{
        duration: 2500,
        style: {
          fontFamily: 'Heebo, sans-serif',
          direction: dir,
          borderRadius: '16px',
          fontSize: '14px',
          fontWeight: '500',
        },
      }}
    />
  )
}

export default function App() {
  return (
    <ErrorBoundary>
    <ThemeProvider>
    <LocaleProvider>
    <BrowserRouter>
      <AuthProvider>
        <Suspense fallback={<PageSpinner />}>
          <Routes>
            <Route path="/s/:token" element={<SharedVoucherPage />} />
            <Route path="/gift/:token" element={<GiftPage />} />
            <Route path="/*" element={<AppRoutes />} />
          </Routes>
        </Suspense>
        <ToasterWithLocale />
      </AuthProvider>
      <Analytics />
      <SpeedInsights />
    </BrowserRouter>
    </LocaleProvider>
    </ThemeProvider>
    </ErrorBoundary>
  )
}
