import { useNavigate } from 'react-router-dom'
import { Home, Archive, BarChart2, Settings, Shield } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'

const ADMIN_EMAIL = import.meta.env.VITE_ADMIN_EMAIL || 'admin@example.com'

export default function BottomNav() {
  const nav = useNavigate()
  const path = window.location.pathname
  const { user } = useAuth()
  const isAdmin = user?.email === ADMIN_EMAIL

  const items = [
    { icon: Home, label: 'ארנק', path: '/' },
    { icon: Archive, label: 'ארכיון', path: '/archive' },
    { icon: BarChart2, label: 'סטטיסטיקות', path: '/stats' },
    { icon: Settings, label: 'הגדרות', path: '/settings' },
    ...(isAdmin ? [{ icon: Shield, label: 'מנהל', path: '/admin' }] : []),
  ]

  return (
    <nav className="bottom-nav">
      <div className="flex items-center w-full">
        {items.map(item => {
          const active = path === item.path
          return (
            <button
              key={item.path}
              onClick={() => nav(item.path)}
              className={`flex-1 flex flex-col items-center gap-1 py-3 transition-colors ${
                active ? 'text-green-600' : 'text-gray-400 hover:text-gray-600'
              }`}
            >
              <item.icon className={`w-5 h-5 ${active ? 'stroke-[2.5]' : ''}`} />
              <span className="text-xs font-medium">{item.label}</span>
              {active && <div className="w-1 h-1 bg-green-500 rounded-full" />}
            </button>
          )
        })}
      </div>
    </nav>
  )
}
