import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { Pause, Play, RotateCcw } from 'lucide-react'
import { BRAND } from './config'
import { STAGE_H, STAGE_W } from './layout'
import { DURATION, TIME_SCALE, ep } from './timeline'
import Captions from './Captions'
import Chaos from './Chaos'
import Brand from './Brand'
import Phone from './Phone'
import { HeroBack, HeroFront, HeroWash } from './Hero'

/**
 * /promo/ — the Gift Smart vertical ad (1080×1920 logical stage).
 *
 * URL options:
 *   ?autoplay=true   start immediately (default)   ?autoplay=false  wait for Play
 *   ?loop=true       loop forever
 *   ?t=12.5          freeze on a single frame (seconds)
 *   ?ui=0            hide the player controls (for screen recording)
 *   ?export=1        stage at 1:1, no controls — used by scripts/promo-export.mjs
 *
 * Keyboard: Space = play/pause, R = replay, ←/→ = ±1s.
 */

declare global {
  interface Window {
    __promo?: { duration: number; fps: number; seek: (s: number) => void; ready: Promise<void> }
  }
}

function Background({ t }: { t: number }) {
  const brand = ep(t, 4.4, 5.6)
  return (
    <div style={{ position: 'absolute', inset: 0, background: BRAND.bg }}>
      {/* faint dot grid, fading toward the edges */}
      <div
        style={{
          position: 'absolute', inset: 0, opacity: 0.55,
          backgroundImage: 'radial-gradient(rgba(15,28,26,.09) 1.6px, transparent 1.6px)',
          backgroundSize: '44px 44px',
          maskImage: 'radial-gradient(70% 55% at 50% 55%, #000 0%, transparent 100%)',
          WebkitMaskImage: 'radial-gradient(70% 55% at 50% 55%, #000 0%, transparent 100%)',
          transform: `translateY(${-(t * 6) % 44}px)`,
        }}
      />
      {/* drifting brand light */}
      <div style={{ position: 'absolute', width: 900, height: 900, borderRadius: '50%', left: 540 - 450 + Math.sin(t * 0.35) * 120, top: 380 + Math.cos(t * 0.3) * 80, background: `radial-gradient(circle, ${BRAND.green}${brand > 0 ? '26' : '14'} 0%, transparent 65%)`, filter: 'blur(20px)' }} />
      <div style={{ position: 'absolute', width: 700, height: 700, borderRadius: '50%', left: 540 - 350 + Math.cos(t * 0.28) * 200, top: 1250 + Math.sin(t * 0.33) * 90, background: `radial-gradient(circle, ${BRAND.purple}10 0%, transparent 65%)`, filter: 'blur(20px)' }} />
    </div>
  )
}

/** The full frame at design time `t` — a pure function of time. */
function Frame({ t }: { t: number }) {
  return (
    <>
      <Background t={t} />
      <HeroWash t={t} />
      <HeroBack t={t} />
      <Chaos t={t} />
      <Phone t={t} />
      <Brand t={t} />
      <HeroFront t={t} />
      <div style={{ position: 'absolute', inset: 0, zIndex: 50, pointerEvents: 'none' }}>
        <Captions t={t} />
      </div>
    </>
  )
}

export default function PromoApp() {
  const params = useMemo(() => new URLSearchParams(window.location.search), [])
  const exportMode = params.has('export')
  const showUi = !exportMode && params.get('ui') !== '0'
  const autoplay = params.get('autoplay') !== 'false'
  const loop = params.get('loop') === 'true'
  const fixed = params.get('t')

  const [t, setT] = useState(() => (fixed != null ? Math.min(DURATION, Math.max(0, Number(fixed) || 0)) : 0))
  const [playing, setPlaying] = useState(false)
  const [scale, setScale] = useState(1)
  const [idle, setIdle] = useState(false)
  const origin = useRef({ wall: 0, t: 0 })
  const tRef = useRef(t)
  useLayoutEffect(() => { tRef.current = t }, [t])

  // ── Fit the 1080×1920 stage into the window ──
  useLayoutEffect(() => {
    if (exportMode) return
    const fit = () => setScale(Math.min(window.innerWidth / STAGE_W, window.innerHeight / STAGE_H))
    fit()
    window.addEventListener('resize', fit)
    return () => window.removeEventListener('resize', fit)
  }, [exportMode])

  const play = useCallback((from?: number) => {
    const start = from ?? (tRef.current >= DURATION ? 0 : tRef.current)
    origin.current = { wall: performance.now(), t: start }
    setT(start)
    setPlaying(true)
  }, [])
  const pause = useCallback(() => setPlaying(false), [])
  const replay = useCallback(() => play(0), [play])
  const seek = useCallback((s: number) => {
    const v = Math.min(DURATION, Math.max(0, s))
    origin.current = { wall: performance.now(), t: v }
    setT(v)
  }, [])

  // ── Master clock ──
  useEffect(() => {
    if (!playing) return
    let raf = 0
    const tick = (now: number) => {
      let next = origin.current.t + (now - origin.current.wall) / 1000
      if (next >= DURATION) {
        if (loop) {
          origin.current = { wall: now, t: 0 }
          next = 0
        } else {
          setT(DURATION)
          setPlaying(false)
          return
        }
      }
      setT(next)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing, loop])

  // ── Wait for fonts, then autoplay; expose the seek API for the exporter ──
  useEffect(() => {
    const ready = document.fonts.ready.then(() => undefined)
    window.__promo = {
      duration: DURATION,
      fps: 60,
      ready,
      seek: (s: number) => {
        flushSync(() => {
          setPlaying(false)
          setT(Math.min(DURATION, Math.max(0, s)))
        })
      },
    }
    let timer = 0
    if (autoplay && fixed == null && !exportMode) {
      ready.then(() => { timer = window.setTimeout(() => play(0), 250) })
    }
    return () => { window.clearTimeout(timer); delete window.__promo }
  }, [autoplay, fixed, exportMode, play])

  // ── Keyboard + auto-hiding controls ──
  useEffect(() => {
    if (!showUi) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === ' ') { e.preventDefault(); if (playing) pause(); else play() }
      else if (e.key === 'r' || e.key === 'R') replay()
      else if (e.key === 'ArrowRight') seek(tRef.current + 1)
      else if (e.key === 'ArrowLeft') seek(tRef.current - 1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [showUi, playing, play, pause, replay, seek])

  useEffect(() => {
    if (!showUi) return
    let timer = 0
    const wake = () => {
      setIdle(false)
      window.clearTimeout(timer)
      timer = window.setTimeout(() => setIdle(true), 2200)
    }
    wake()
    window.addEventListener('pointermove', wake)
    window.addEventListener('pointerdown', wake)
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('pointermove', wake)
      window.removeEventListener('pointerdown', wake)
    }
  }, [showUi])

  const designT = t / TIME_SCALE
  const stageStyle = exportMode
    ? { left: 0, top: 0 }
    : {
        left: (window.innerWidth - STAGE_W * scale) / 2,
        top: (window.innerHeight - STAGE_H * scale) / 2,
        transform: `scale(${scale})`,
      }

  return (
    <div className="promo-viewport">
      <div className="promo-stage" id="promo-stage" dir="rtl" lang="he" style={stageStyle}>
        <Frame t={designT} />
      </div>

      {showUi && (
        <div className="promo-controls" data-hidden={idle && playing ? 'true' : 'false'}>
          <button className="promo-btn promo-btn--primary" onClick={replay} aria-label="Replay">
            <RotateCcw size={16} strokeWidth={2.6} /> Replay
          </button>
          <button className="promo-btn" onClick={() => (playing ? pause() : play())} aria-label={playing ? 'Pause' : 'Play'}>
            {playing ? <Pause size={16} strokeWidth={2.6} /> : <Play size={16} strokeWidth={2.6} />}
          </button>
          <input
            className="promo-scrub"
            type="range" min={0} max={DURATION} step={0.01} value={t}
            aria-label="Timeline"
            onChange={e => { pause(); seek(Number(e.target.value)) }}
          />
          <span className="promo-time">{t.toFixed(1)} / {DURATION.toFixed(0)}s</span>
        </div>
      )}
    </div>
  )
}
