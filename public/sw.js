const CACHE_VERSION = 'v3'
const CACHE_NAME = `voucher-wallet-${CACHE_VERSION}`

self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) =>
      Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      )
    ).then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return

  // Never cache Supabase API calls
  if (event.request.url.includes('supabase.co')) return

  const url = new URL(event.request.url)

  // HTML / navigation requests: network-first
  // This ensures new deployments are always picked up immediately
  if (event.request.mode === 'navigate' || url.pathname.endsWith('.html') || url.pathname === '/') {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const clone = response.clone()
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone))
          return response
        })
        .catch(() => caches.match(event.request).then((cached) => cached || caches.match('/')))
    )
    return
  }

  // Static assets with content hash (JS/CSS/images): cache-first
  // Vite adds hashes to filenames, so stale cache is never an issue here
  if (url.pathname.match(/\.(js|css|png|jpg|jpeg|svg|ico|woff2?)$/)) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        if (cached) return cached
        return fetch(event.request).then((response) => {
          const clone = response.clone()
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone))
          return response
        })
      })
    )
    return
  }

  // Everything else: network-first
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  )
})
