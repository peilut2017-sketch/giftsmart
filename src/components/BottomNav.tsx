import { useNavigate } from 'react-router-dom'
import { Home, Archive, BarChart2, Settings, Shield } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'

export default function BottomNav() {
  const nav = useNavigate()
  const path = window.location.pathname
  const { isAdmin } = useAuth()

  const items = [
    { icon: Home, label: 'ארנק', path: '/' },
    { icon: Archive, label: 'ארכיון', path: '/archive' },
    { icon: BarChart2, label: 'סטטיסטיקות', path: '/stats' },
    { icon: Settings, label: 'הגדרות', path: '/settings' },
    ...(isAdmin ? [{ icon: Shield, label: 'מנהל', path: '/admin' }] : []),
  ]

  return (
    <nav className="bottom-nav" aria-label="ניווט ראשי">
      <div className="flex items-center w-full" role="list">
        {items.map(item => {
          const active = path === item.path
          return (
            <button
              key={item.path}
              role="listitem"
              onClick={() => nav(item.path)}
              aria-label={item.label}
              aria-current={active ? 'page' : undefined}
              className={`flex-1 flex flex-col items-center gap-1 py-3 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-400 focus-visible:ring-inset ${
                active ? 'text-green-600' : 'text-gray-400 hover:text-gray-600'
              }`}
            >
              <item.icon className={`w-5 h-5 ${active ? 'stroke-[2.5]' : ''}`} aria-hidden="true" />
              <span className="text-xs font-medium">{item.label}</span>
              {active && <div className="w-1 h-1 bg-green-500 rounded-full" aria-hidden="true" />}
            </button>
          )
        })}
      </div>
    </nav>
  )
}
