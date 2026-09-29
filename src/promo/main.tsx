import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './promo.css'
import PromoApp from './PromoApp'

// Standalone entry: no app providers, no Supabase, no analytics, no service worker.
createRoot(document.getElementById('promo-root')!).render(
  <StrictMode>
    <PromoApp />
  </StrictMode>,
)
