const CACHE_VERSION = 'v10'
const CACHE_NAME = `voucher-wallet-${CACHE_VERSION}`

// Precache the app shell so the offline navigation fallback below actually has
// something to serve. Without this, the fallback resolved `undefined` on a cold
// install that went offline, and the browser showed its network-error page.
const SHELL_URLS = ['/', '/index.html']

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(SHELL_URLS))
      .catch(() => {})
      .then(() => self.skipWaiting())
  )
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

  const url = new URL(event.request.url)

  // Never touch cross-origin requests (Supabase API, Gemini, analytics, fonts) —
  // hostname check, not a substring, so a URL that merely CONTAINS the string in
  // a query param isn't mishandled.
  if (url.origin !== self.location.origin) return

  // HTML / navigation requests: network-first, fall back to the cached shell.
  if (event.request.mode === 'navigate' || url.pathname.endsWith('.html') || url.pathname === '/') {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const clone = response.clone()
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone))
          return response
        })
        .catch(async () =>
          (await caches.match(event.request)) ||
          (await caches.match('/')) ||
          (await caches.match('/index.html')) ||
          Response.error()
        )
    )
    return
  }

  // Vite build output under /assets/ is content-hashed and immutable → cache-first.
  if (url.pathname.startsWith('/assets/')) {
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

  // Other same-origin static files (root logo/favicon/manifest) are NOT hashed, so
  // stale-while-revalidate: serve cache immediately but refresh it in the
  // background, otherwise a changed logo/icon stayed frozen until CACHE_VERSION.
  if (url.pathname.match(/\.(js|css|png|jpg|jpeg|svg|ico|woff2?|json|webmanifest)$/)) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        const network = fetch(event.request).then((response) => {
          const clone = response.clone()
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone))
          return response
        }).catch(() => cached)
        return cached || network
      })
    )
    return
  }

  // Everything else: network-first
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  )
})

// Handle notification click — open the app
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = event.notification.data?.url || '/'
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      // If app is already open, focus it
      for (const client of clients) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          return client.focus()
        }
      }
      // Otherwise open a new window
      if (self.clients.openWindow) {
        return self.clients.openWindow(url)
      }
    })
  )
})

// Handle push events — payloads come from the send-push / push-expiry
// edge functions as { title, body, url, tag }
self.addEventListener('push', (event) => {
  let data = { title: 'GiftSmart', body: 'יש לך שוברים שעומדים לפוג', url: '/', tag: undefined }
  try {
    if (event.data) data = { ...data, ...event.data.json() }
  } catch {}

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/web-app-manifest-192x192.png',
      badge: '/web-app-manifest-192x192.png',
      // Per-category tag so a marketplace push doesn't overwrite an expiry one
      tag: data.tag || 'giftsmart',
      requireInteraction: true,
      data: { url: data.url },
    })
  )
})
