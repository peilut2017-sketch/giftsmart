import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import { VoucherProvider, useVouchers } from './contexts/VoucherContext'
import { useExpiryNotifications } from './hooks/useNotifications'
import AuthPage from './pages/AuthPage'
import HomePage from './pages/HomePage'
import CheckoutPage from './pages/CheckoutPage'
import ArchivePage from './pages/ArchivePage'
import StatsPage from './pages/StatsPage'
import SettingsPage from './pages/SettingsPage'
import AdminPage from './pages/AdminPage'
import SharedVoucherPage from './pages/SharedVoucherPage'
import AccessibilityPage from './pages/AccessibilityPage'
import BottomNav from './components/BottomNav'
import WelcomeModal from './components/WelcomeModal'
import BiometricGate from './components/BiometricGate'
import AccessibilityWidget from './components/AccessibilityWidget'
import { isBiometricEnabled } from './lib/passkey'
import { GiftSmartSplash } from './components/GiftSmartLogo'
import { useState, useEffect } from 'react'

const A11Y_WIDGET_KEY = 'a11y_widget_enabled'

function NotificationBridge() {
  const { vouchers } = useVouchers()
  useExpiryNotifications(vouchers)
  return null
}

function AppRoutes() {
  const { user, loading, passwordRecovery, signOut } = useAuth()
  const [biometricLocked, setBiometricLocked] = useState(false)
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

  return (
    <VoucherProvider>
      <NotificationBridge />
      <WelcomeModal userId={user!.id} />
      {/* Skip to main content — visible on keyboard focus */}
      <a href="#main-content" className="skip-link">דלג לתוכן הראשי</a>
      <div className="flex flex-col min-h-dvh w-full max-w-2xl mx-auto overflow-x-hidden">
        <main id="main-content" className="flex-1 flex flex-col">
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/checkout/:id" element={<CheckoutPage />} />
            <Route path="/archive" element={<ArchivePage />} />
            <Route path="/stats" element={<StatsPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/admin" element={<AdminPage />} />
            <Route path="/accessibility" element={<AccessibilityPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
        <BottomNav />
      </div>
      {widgetEnabled && <AccessibilityWidget />}
    </VoucherProvider>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/s/:token" element={<SharedVoucherPage />} />
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
  )
}
