import { useNavigate } from 'react-router-dom'
import { Home, Archive, BarChart2, Settings, Shield, ShoppingBag } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { useMarketplace } from '../contexts/MarketplaceContext'

export default function BottomNav() {
  const nav = useNavigate()
  const path = window.location.pathname
  const { isAdmin } = useAuth()
  const { unreadChatCount } = useMarketplace()

  const items = [
    { icon: Home,        label: 'ארנק',       path: '/' },
    { icon: ShoppingBag, label: 'שוק',        path: '/market' },
    { icon: Archive,     label: 'ארכיון',     path: '/archive' },
    { icon: BarChart2,   label: 'סטטיסטיקות', path: '/stats' },
    { icon: Settings,    label: 'הגדרות',     path: '/settings' },
    ...(isAdmin ? [{ icon: Shield, label: 'מנהל', path: '/admin' }] : []),
  ]

  return (
    <nav className="bottom-nav" aria-label="ניווט ראשי">
      <div className="flex items-center justify-around w-full h-full px-1" role="list">
        {items.map(item => {
          const active = path === item.path
          return (
            <button
              key={item.path}
              role="listitem"
              onClick={() => nav(item.path)}
              aria-label={item.label}
              aria-current={active ? 'page' : undefined}
              {...(item.path === '/market' ? { 'data-guide': 'market-nav' } : {})}
              className="relative flex flex-col items-center justify-center gap-0.5 py-1.5 px-3 min-w-[44px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-400 focus-visible:ring-inset"
            >
              {/* Active pill background */}
              {active && (
                <span
                  className="absolute inset-x-1 top-0.5 bottom-0.5 rounded-xl"
                  style={{ background: 'var(--c-primary-light)' }}
                  aria-hidden="true"
                />
              )}

              {/* Icon */}
              <span className="relative">
                <item.icon
                  className="w-[22px] h-[22px] relative z-10"
                  style={{
                    color: active ? 'var(--c-primary)' : 'var(--c-text3)',
                    strokeWidth: active ? 2.2 : 1.7,
                  }}
                  aria-hidden="true"
                />
                {item.path === '/market' && unreadChatCount > 0 && (
                  <span className="absolute -top-1.5 -right-1.5 min-w-[16px] h-4 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center px-0.5 leading-none pointer-events-none z-20">
                    {unreadChatCount > 99 ? '99+' : unreadChatCount}
                  </span>
                )}
              </span>

              {/* Label */}
              <span
                className="text-[10px] font-medium relative z-10 whitespace-nowrap"
                style={{ color: active ? 'var(--c-primary)' : 'var(--c-text3)' }}
              >
                {item.label}
              </span>
            </button>
          )
        })}
      </div>
    </nav>
  )
}
