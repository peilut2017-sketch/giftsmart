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
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
