import { useRef, useState, useLayoutEffect, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { motion, useMotionValue, useVelocity, useTransform, animate } from 'framer-motion'
import { useT } from '../lib/i18n'
import Icon from './ui/Icon'

const SPRING = { type: 'spring' as const, stiffness: 460, damping: 40, mass: 0.75 }
const REDUCED_MOTION = { duration: 0 }

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
}

/** Short, light tap feedback (Vibration API — Android Chrome only; iOS Safari doesn't
    expose haptics to web content at all, so this silently no-ops there). */
function tapHaptic() {
  try { navigator.vibrate?.(8) } catch {}
}

/**
 * Redesigned bottom nav: 5 slots — Wallet / Search / Add (raised FAB) / Stats / Profile.
 * Market, Discounts, Archive and Admin are no longer top-level tabs — they're reached
 * from the Settings ("Profile") page. The FAB is a DOM sibling of the draggable pill
 * row (not a nav "tab"), so it never gets swallowed by the row's pointer-capture drag
 * logic — see the note above the FAB button below.
 */
export default function BottomNav() {
  const navigate   = useNavigate()
  const location   = useLocation()
  const { t } = useT()

  const items = [
    { icon: 'account_balance_wallet', label: t('nav.wallet'),  path: '/'         },
    { icon: 'search',                 label: t('nav.search'),  path: '/search'   },
    { icon: 'bar_chart',              label: t('nav.stats'),   path: '/stats'    },
    { icon: 'person',                 label: t('nav.profile'), path: '/settings' },
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

  // Full pill (999 = stadium) at rest; leading edge only pulls in slightly under fast
  // drag velocity, trailing edge stays round — organic without ever reading "squared".
  const tlr = useTransform(vel, [-2000, -80, 0, 80, 2000], [20, 999, 999, 999, 999])
  const trr = useTransform(vel, [-2000, -80, 0, 80, 2000], [999, 999, 999, 999, 20])
  const blr = useTransform(vel, [-2000, -80, 0, 80, 2000], [20, 999, 999, 999, 999])
  const brr = useTransform(vel, [-2000, -80, 0, 80, 2000], [999, 999, 999, 999, 20])

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
    const spring = prefersReducedMotion() ? REDUCED_MOTION : SPRING
    animate(pillX, m.x, spring)
    animate(pillW, m.w, spring)
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

  // ── Scroll direction (nav slides down + reads more opaque while scrolling down) ──
  const [scrolledDown, setScrolledDown] = useState(false)
  useEffect(() => {
    let lastY = window.scrollY
    let ticking = false
    function onScroll() {
      if (ticking) return
      ticking = true
      requestAnimationFrame(() => {
        const y = window.scrollY
        if (Math.abs(y - lastY) > 4) {
          setScrolledDown(y > lastY && y > 40)
          lastY = y
        }
        ticking = false
      })
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

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

    // Always navigate here: setPointerCapture redirects pointerup to this div,
    // which prevents the browser from firing click on the child button on desktop.
    const ci = closestTab(e.clientX)

    didDrag.current = false
    justDragged.current = true
    setTimeout(() => { justDragged.current = false }, 80)

    if (ci !== activeIdx) tapHaptic()
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
  function renderTab(item: typeof items[number], idx: number) {
    const active = activeIdx === idx
    return (
      <button
        key={item.path}
        ref={el => { btnRefs.current[idx] = el }}
        role="listitem"
        onClick={() => { if (!justDragged.current) { tapHaptic(); navigate(item.path) } }}
        aria-label={item.label}
        aria-current={active ? 'page' : undefined}
        className="relative flex flex-col items-center justify-center gap-0.5 py-2.5 px-[18px] min-w-[44px] transition-[opacity,transform] active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset"
        style={{ zIndex: 1, opacity: active ? 1 : 0.7 }}
      >
        <Icon
          name={item.icon}
          size={24}
          filled={active}
          color={active ? 'var(--c-primary)' : 'var(--c-text2)'}
        />
        <span
          className="text-xs font-medium whitespace-nowrap"
          style={{ color: active ? 'var(--c-primary)' : 'var(--c-text2)' }}
        >
          {item.label}
        </span>
      </button>
    )
  }

  return (
    <nav className="bottom-nav" aria-label="ניווט ראשי" data-scrolled={scrolledDown}>
      <div className="relative w-full h-full" style={{ zIndex: 1 }}>
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
          {/* ── Liquid glass pill (single, shared) — colors come from --nav-pill-*
              custom properties so light/dark are handled by CSS, not duplicated here. ── */}
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
              background: 'var(--nav-pill-bg)',
              backdropFilter: 'blur(20px) saturate(160%)',
              WebkitBackdropFilter: 'blur(20px) saturate(160%)',
              boxShadow: 'var(--nav-pill-shadow)',
              border: '1px solid var(--nav-pill-border)',
              pointerEvents: 'none',
              zIndex: 0,
            }}
          />

          {/* ── Tab buttons ──────────────────────────────────────────────── */}
          {/* Rendered in two halves with an inert spacer between them (not a 5th
              `items` entry — see closestTab/pointer-drag note below) so the FAB above
              gets its own reserved slot instead of sitting on the boundary between
              the search and stats buttons, which otherwise crowds both. */}
          {items.slice(0, 2).map((item, idx) => renderTab(item, idx))}
          <div aria-hidden="true" className="min-w-[44px] px-3" style={{ visibility: 'hidden' }} />
          {items.slice(2).map((item, i) => renderTab(item, i + 2))}
        </div>

        {/*
          "Add" FAB — deliberately a DOM sibling of the pointer-drag row above, not
          one of `items`. If it were rendered inside that row, onPointerUp's
          closestTab() would always redirect a tap on the FAB to whichever real tab
          is nearest, since that handler fires on every pointerup within the drag
          container regardless of click target. Landing on `/?add=1` re-uses
          HomePage's existing "open add-voucher form on mount" query-param behavior.
        */}
        <button
          data-guide="fab"
          onClick={() => { tapHaptic(); navigate('/?add=1') }}
          aria-label={t('form.add.voucher')}
          className="absolute left-1/2 -translate-x-1/2 -top-[6px] w-[52px] h-[52px] rounded-[18px] flex items-center justify-center text-white bg-gradient-to-br from-primary-mid to-primary-dark shadow-fab transition-transform active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
          style={{ zIndex: 2 }}
        >
          <Icon name="add" size={28} />
        </button>
      </div>
    </nav>
  )
}
