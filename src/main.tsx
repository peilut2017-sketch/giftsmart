import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// Prevent iOS Safari pinch-zoom (keeps layout stable in RTL)
document.addEventListener('gesturestart', e => e.preventDefault(), { passive: false })
document.addEventListener('gesturechange', e => e.preventDefault(), { passive: false })

// Prevent double-tap zoom on iOS
let _lastTap = 0
document.addEventListener('touchend', e => {
  const now = Date.now()
  if (now - _lastTap < 300) e.preventDefault()
  _lastTap = now
}, { passive: false })

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
