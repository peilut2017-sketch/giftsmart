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
import BottomNav from './components/BottomNav'
import WelcomeModal from './components/WelcomeModal'

function NotificationBridge() {
  const { vouchers } = useVouchers()
  useExpiryNotifications(vouchers)
  return null
}

function AppRoutes() {
  const { user, loading, passwordRecovery } = useAuth()

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-12 h-12 border-4 border-green-200 border-t-green-500 rounded-full animate-spin" />
          <p className="text-sm text-gray-500">טוען...</p>
        </div>
      </div>
    )
  }

  if (passwordRecovery) {
    return <AuthPage initialMode="newPassword" />
  }

  if (!user) {
    return <AuthPage />
  }

  return (
    <VoucherProvider>
      <NotificationBridge />
      <WelcomeModal userId={user!.id} />
      <div className="flex flex-col min-h-dvh max-w-2xl mx-auto">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/checkout/:id" element={<CheckoutPage />} />
          <Route path="/archive" element={<ArchivePage />} />
          <Route path="/stats" element={<StatsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/admin" element={<AdminPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        <BottomNav />
      </div>
    </VoucherProvider>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
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
