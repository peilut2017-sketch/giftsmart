import { BrowserRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom'
import AnimatedRoutes from './components/AnimatedRoutes'
import toast, { Toaster } from 'react-hot-toast'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import { VoucherProvider, useVouchers } from './contexts/VoucherContext'
import { SubscriptionProvider, useSubscription } from './contexts/SubscriptionContext'
import { MarketplaceProvider } from './contexts/MarketplaceContext'
import { useExpiryNotifications } from './hooks/useNotifications'
import { supabase } from './lib/supabase'
import UpgradeSheet from './components/UpgradeSheet'
import AuthPage from './pages/AuthPage'
import HomePage from './pages/HomePage'
import CheckoutPage from './pages/CheckoutPage'
import ArchivePage from './pages/ArchivePage'
import StatsPage from './pages/StatsPage'
import SettingsPage from './pages/SettingsPage'
import AdminPage from './pages/AdminPage'
import SharedVoucherPage from './pages/SharedVoucherPage'
import GiftPage from './pages/GiftPage'
import AccessibilityPage from './pages/AccessibilityPage'
import MarketplacePage from './pages/MarketplacePage'
import ListingDetailPage from './pages/ListingDetailPage'
import BulkListPage from './pages/BulkListPage'
import BottomNav from './components/BottomNav'
import WelcomeModal from './components/WelcomeModal'
import OfflineBanner from './components/OfflineBanner'
import LoginBanner from './components/LoginBanner'
import BiometricGate from './components/BiometricGate'
import AccessibilityWidget from './components/AccessibilityWidget'
import { isBiometricEnabled } from './lib/passkey'
import { GiftSmartSplash } from './components/GiftSmartLogo'
import OnboardingGuide from './components/OnboardingGuide'
import { Component, useState, useEffect } from 'react'
import type { ReactNode } from 'react'

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
          <p className="text-4xl">⚠️</p>
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

function NotificationBridge() {
  const { vouchers } = useVouchers()
  const { user } = useAuth()
  const { isPro } = useSubscription()
  useExpiryNotifications(vouchers, isPro)

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
        toast(`🔔 יתרת "${store_name}" עודכנה: ₪${old_balance} ← ₪${new_balance}${locationSuffix}`, { duration: 6000 })
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
      navigate(returnTo, { replace: true })
    }
  }, [user])

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
    if (user && isBiometricEnabled()) {
      setBiometricLocked(true)
    }
  }, [user])

  if (loading) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-8 bg-gray-50">
        <GiftSmartSplash />
        <div className="w-8 h-8 border-3 border-green-200 border-t-green-500 rounded-full animate-spin" style={{ borderWidth: 3 }} />
      </div>
    )
  }

  if (passwordRecovery) return <AuthPage initialMode="newPassword" />
  if (!user) return <AuthPage />

  if (biometricLocked) {
    return (
      <BiometricGate
        onUnlock={() => setBiometricLocked(false)}
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
    <SubscriptionProvider>
    <VoucherProvider>
    <MarketplaceProvider>
      <NotificationBridge />
      <WelcomeModal userId={user!.id} />
      {/* Skip to main content — visible on keyboard focus */}
      <a href="#main-content" className="skip-link">דלג לתוכן הראשי</a>
      <div className="flex flex-col min-h-dvh w-full max-w-2xl mx-auto overflow-x-hidden">
        <OfflineBanner />
        <main id="main-content" className="flex-1 flex flex-col">
          <AnimatedRoutes>
            <Route path="/" element={<HomePage />} />
            <Route path="/checkout/:id" element={<CheckoutPage />} />
            <Route path="/archive" element={<ArchivePage />} />
            <Route path="/stats" element={<StatsPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/admin" element={<AdminPage />} />
            <Route path="/accessibility" element={<AccessibilityPage />} />
            <Route path="/market" element={<MarketplacePage />} />
            <Route path="/market/listing/:id" element={<ListingDetailPage />} />
            <Route path="/market/bulk" element={<BulkListPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </AnimatedRoutes>
        </main>
        <BottomNav />
      </div>
      {widgetEnabled && <AccessibilityWidget />}
      <OnboardingGuide />
    </MarketplaceProvider>
    </VoucherProvider>
    </SubscriptionProvider>
  )
}

export default function App() {
  return (
    <ErrorBoundary>
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/s/:token" element={<SharedVoucherPage />} />
          <Route path="/gift/:token" element={<GiftPage />} />
          <Route path="/*" element={<AppRoutes />} />
        </Routes>
        <Toaster
          position="top-center"
          toastOptions={{
            duration: 2500,
            style: {
              fontFamily: 'Heebo, sans-serif',
              direction: 'rtl',
              borderRadius: '16px',
              fontSize: '14px',
              fontWeight: '500',
            },
          }}
        />
      </AuthProvider>
    </BrowserRouter>
    </ErrorBoundary>
  )
}
