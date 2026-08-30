import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { initPostHog } from './lib/posthog'
import { applyNavGlassOpacity } from './lib/navGlass'

initPostHog()
applyNavGlassOpacity()

// Prevent iOS Safari pinch-zoom (gesturestart/gesturechange are Safari-specific events)
document.addEventListener('gesturestart', e => e.preventDefault(), { passive: false })
document.addEventListener('gesturechange', e => e.preventDefault(), { passive: false })

// Capture the install prompt at module scope — Chrome fires beforeinstallprompt
// once, typically before React mounts, so a listener registered inside a
// component effect misses it and the install banner never appears.
window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault()
  ;(window as any).__gsInstallPrompt = e
  window.dispatchEvent(new Event('gs-install-ready'))
})

// Register Service Worker for PWA
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // SW registration failed - not critical
    })
  })
  // The SW calls skipWaiting()+clients.claim(), so a new deploy's SW seizes an
  // open tab immediately. The already-loaded HTML still references the OLD hashed
  // chunks; a later lazy import() would then 404 against the new cache. Reload
  // once when control passes to a new SW so HTML and chunks stay consistent.
  // Guard: on a first-ever visit there is no controller yet, and the initial
  // claim must NOT trigger a reload.
  const hadController = !!navigator.serviceWorker.controller
  let reloadedForSW = false
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloadedForSW) return
    reloadedForSW = true
    window.location.reload()
  })
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
