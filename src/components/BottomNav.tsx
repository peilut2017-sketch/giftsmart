import { useRef, useState, useLayoutEffect, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { motion, useMotionValue, useVelocity, useTransform, animate } from 'framer-motion'
import { Home, Archive, BarChart2, Settings, Shield, ShoppingBag } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { useMarketplace } from '../contexts/MarketplaceContext'

const SPRING = { type: 'spring' as const, stiffness: 460, damping: 40, mass: 0.75 }

export default function BottomNav() {
  const navigate   = useNavigate()
  const location   = useLocation()
  const { isAdmin } = useAuth()
  const { unreadChatCount } = useMarketplace()

  const items = [
    { icon: Home,        label: 'ארנק',        path: '/'         },
    { icon: ShoppingBag, label: 'שוק',         path: '/market'   },
    { icon: Archive,     label: 'ארכיון',      path: '/archive'  },
    { icon: BarChart2,   label: 'סטטיסטיקות', path: '/stats'    },
    { icon: Settings,    label: 'הגדרות',      path: '/settings' },
    ...(isAdmin ? [{ icon: Shield, label: 'מנהל', path: '/admin' }] : []),
  ]

  const activeIdx = (() => {
    const p = location.pathname
    const i = items.findIndex(item =>
      item.path === '/' ? p === '/' : p.startsWith(item.path)
    )
    return i === -1 ? 0 : i
  })()

  // ── Refs ──────────────────────────────────────────────────────────────────
  const navRef  = useRef<HTMLDivElement>(null)
  const btnRefs = useRef<(HTMLButtonElement | null)[]>([])

  // ── Pill motion values ────────────────────────────────────────────────────
  const pillX = useMotionValue(0)
  const pillW = useMotionValue(48)
  const vel   = useVelocity(pillX)

  // Leading edge gets squared, trailing edge stays round — the jelly pull
  // Moving right (+vel): right side leads → TR/BR shrink; TL/BL stay round
  // Moving left  (-vel): left  side leads → TL/BL shrink; TR/BR stay round
  const tlr = useTransform(vel, [-2000, -80, 0, 80, 2000], [5, 10, 12, 12, 12])
  const trr = useTransform(vel, [-2000, -80, 0, 80, 2000], [12, 12, 12, 10,  5])
  const blr = useTransform(vel, [-2000, -80, 0, 80, 2000], [5, 10, 12, 12, 12])
  const brr = useTransform(vel, [-2000, -80, 0, 80, 2000], [12, 12, 12, 10,  5])

  // ── Helpers ───────────────────────────────────────────────────────────────
  function getMetrics(idx: number): { x: number; w: number } | null {
    const nav = navRef.current
    const btn = btnRefs.current[idx]
    if (!nav || !btn) return null
    const nr = nav.getBoundingClientRect()
    const br = btn.getBoundingClientRect()
    return { x: br.left - nr.left + 4, w: br.width - 8 }
  }

  function snapTo(idx: number) {
    const m = getMetrics(idx)
    if (!m) return
    animate(pillX, m.x, SPRING)
    animate(pillW, m.w, SPRING)
  }

  // ── Initial placement (after DOM is painted) ──────────────────────────────
  useLayoutEffect(() => {
    requestAnimationFrame(() => {
      const m = getMetrics(activeIdx)
      if (!m) return
      pillX.set(m.x)
      pillW.set(m.w)
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Animate pill when route changes (non-drag navigation) ─────────────────
  const isDragging = useRef(false)
  useEffect(() => {
    if (isDragging.current) return
    snapTo(activeIdx)
  }, [location.pathname]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Drag state ────────────────────────────────────────────────────────────
  const dragOrigin  = useRef({ clientX: 0, pillX: 0 })
  const didDrag     = useRef(false)
  const justDragged = useRef(false)
  const hoverIdx    = useRef(activeIdx)
  const [draggingVisual, setDraggingVisual] = useState(false)

  function closestTab(clientX: number): number {
    const nav = navRef.current
    if (!nav) return activeIdx
    const nr = nav.getBoundingClientRect()
    const px = clientX - nr.left
    let best = 0, minD = Infinity
    btnRefs.current.forEach((btn, i) => {
      if (!btn) return
      const br  = btn.getBoundingClientRect()
      const ctr = br.left - nr.left + br.width / 2
      const d   = Math.abs(ctr - px)
      if (d < minD) { minD = d; best = i }
    })
    return best
  }

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    ;(e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId)
    isDragging.current = false
    didDrag.current    = false
    dragOrigin.current = { clientX: e.clientX, pillX: pillX.get() }
    hoverIdx.current   = activeIdx
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const delta = e.clientX - dragOrigin.current.clientX
    if (!didDrag.current && Math.abs(delta) < 7) return   // dead zone

    if (!didDrag.current) {
      didDrag.current    = true
      isDragging.current = true
      setDraggingVisual(true)
    }

    const nav = navRef.current
    if (!nav) return
    const maxX  = nav.offsetWidth - pillW.get() - 4
    const newX  = Math.max(4, Math.min(maxX, dragOrigin.current.pillX + delta))
    pillX.set(newX)

    const ci = closestTab(e.clientX)
    if (ci !== hoverIdx.current) {
      hoverIdx.current = ci
      const m = getMetrics(ci)
      if (m) animate(pillW, m.w, { duration: 0.12 })
    }
  }

  function onPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    setDraggingVisual(false)
    isDragging.current = false

    if (!didDrag.current) return   // was a tap — let button onClick handle it

    didDrag.current    = false
    justDragged.current = true
    setTimeout(() => { justDragged.current = false }, 80)

    const ci = closestTab(e.clientX)
    navigate(items[ci]?.path ?? '/')
    snapTo(ci)
  }

  function onPointerCancel() {
    setDraggingVisual(false)
    isDragging.current = false
    didDrag.current    = false
    snapTo(activeIdx)
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <nav className="bottom-nav" aria-label="ניווט ראשי">
      <div
        ref={navRef}
        className="relative flex items-center justify-around w-full h-full px-1"
        role="list"
        style={{ touchAction: 'none', cursor: draggingVisual ? 'grabbing' : 'auto' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
      >
        {/* ── Liquid glass pill (single, shared) ───────────────────────── */}
        <motion.div
          aria-hidden="true"
          style={{
            position: 'absolute',
            top: 2,
            bottom: 2,
            left: pillX,
            width: pillW,
            borderTopLeftRadius: tlr,
            borderTopRightRadius: trr,
            borderBottomLeftRadius: blr,
            borderBottomRightRadius: brr,
            background: 'rgba(255,255,255,0.52)',
            backdropFilter: 'blur(16px) saturate(160%)',
            WebkitBackdropFilter: 'blur(16px) saturate(160%)',
            boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.85), 0 1px 6px rgba(0,0,0,0.07)',
            border: '1px solid rgba(255,255,255,0.7)',
            pointerEvents: 'none',
            zIndex: 0,
          }}
        />

        {/* ── Tab buttons ──────────────────────────────────────────────── */}
        {items.map((item, idx) => {
          const active = activeIdx === idx
          return (
            <button
              key={item.path}
              ref={el => { btnRefs.current[idx] = el }}
              role="listitem"
              onClick={() => { if (!justDragged.current) navigate(item.path) }}
              aria-label={item.label}
              aria-current={active ? 'page' : undefined}
              {...(item.path === '/market' ? { 'data-guide': 'market-nav' } : {})}
              className="relative flex flex-col items-center justify-center gap-0.5 py-1.5 px-3 min-w-[44px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-400 focus-visible:ring-inset"
              style={{ zIndex: 1 }}
            >
              <span className="relative">
                <item.icon
                  className="w-[22px] h-[22px]"
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
              <span
                className="text-[10px] font-medium whitespace-nowrap"
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
