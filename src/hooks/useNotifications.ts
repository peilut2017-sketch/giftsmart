import { useEffect } from 'react'
import type { Voucher } from '../types'

const NOTIF_KEY = 'last_expiry_notification'
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000 // 24 hours
const EXPIRY_WINDOW_DAYS = 30

async function showNotification(title: string, options: NotificationOptions) {
  try {
    const reg = await navigator.serviceWorker.ready
    await reg.showNotification(title, options)
  } catch {
    new Notification(title, options)
  }
}

export function useExpiryNotifications(vouchers: Voucher[], isPro: boolean) {
  useEffect(() => {
    if (!isPro) return
    if (!('Notification' in window)) return

    async function checkAndNotify() {
      // Don't run while vouchers are still loading (empty array = loading state)
      // This prevents the false "no expiring vouchers" notification on first render.
      if (vouchers.length === 0) return

      // Throttle: don't re-notify within 24h
      const last = localStorage.getItem(NOTIF_KEY)
      if (last && Date.now() - parseInt(last) < CHECK_INTERVAL_MS) return

      let permission = Notification.permission
      if (permission === 'default') {
        permission = await Notification.requestPermission()
      }
      if (permission !== 'granted') return

      const nowTime = Date.now()
      const expiring: Voucher[] = []
      for (const v of vouchers) {
        if (!v.expiry_date) continue
        const daysLeft = Math.ceil((new Date(v.expiry_date).getTime() - nowTime) / (1000 * 60 * 60 * 24))
        if (daysLeft >= 0 && daysLeft <= EXPIRY_WINDOW_DAYS) expiring.push(v)
      }

      // Only throttle and notify if there are actually expiring vouchers.
      // Silently skip (no notification) when nothing is expiring — avoid noise.
      if (expiring.length === 0) return

      localStorage.setItem(NOTIF_KEY, Date.now().toString())

      const baseOptions: NotificationOptions = {
        icon: '/pwa-192x192.png',
        badge: '/pwa-192x192.png',
        tag: 'expiry-warning',
        data: { url: '/' },
      }

      const urgent = expiring.filter(v =>
        Math.ceil((new Date(v.expiry_date!).getTime() - nowTime) / (1000 * 60 * 60 * 24)) <= 3
      )

      const title = urgent.length > 0
        ? `🚨 ${urgent.length} שובר${urgent.length > 1 ? 'ים' : ''} פגים בקרוב!`
        : `⚠️ ${expiring.length} שובר${expiring.length > 1 ? 'ים' : ''} פגים תוך ${EXPIRY_WINDOW_DAYS} יום`

      const body = expiring
        .sort((a, b) => new Date(a.expiry_date!).getTime() - new Date(b.expiry_date!).getTime())
        .slice(0, 5)
        .map(v => {
          const d = Math.ceil((new Date(v.expiry_date!).getTime() - nowTime) / (1000 * 60 * 60 * 24))
          return `${v.store_name} — ${d === 0 ? 'היום!' : d === 1 ? 'מחר' : `${d} ימים`}`
        })
        .join('\n')

      await showNotification(title, { ...baseOptions, body, requireInteraction: urgent.length > 0 })
    }

    checkAndNotify()
  }, [vouchers, isPro])
}

// Request push permission proactively (call from Settings page or first launch)
export async function requestPushPermission(): Promise<NotificationPermission> {
  if (!('Notification' in window)) return 'denied'
  if (Notification.permission !== 'default') return Notification.permission
  return await Notification.requestPermission()
}

// Force a notification check (ignores throttle)
export async function forceNotificationCheck(_vouchers?: Voucher[]) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return
  localStorage.removeItem(NOTIF_KEY)
  // Re-trigger by re-invoking — just clear the key, the hook will pick it up on next render
}

// Send an immediate push notification when a voucher is used
export async function sendUsageNotification(storeName: string, usedAmount: number, newBalance: number) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return

  const fullyRedeemed = newBalance <= 0
  const title = fullyRedeemed
    ? `✅ שובר ${storeName} נוצל במלואו`
    : `💳 שימוש בשובר ${storeName}`
  const body = fullyRedeemed
    ? `השתמשת ב-₪${usedAmount.toLocaleString('he-IL')} — השובר נוצל`
    : `השתמשת ב-₪${usedAmount.toLocaleString('he-IL')} | יתרה נותרת: ₪${newBalance.toLocaleString('he-IL')}`

  const options: NotificationOptions = {
    body,
    icon: '/pwa-192x192.png',
    badge: '/pwa-192x192.png',
    tag: 'voucher-usage',
  }

  try {
    const reg = await navigator.serviceWorker.ready
    await reg.showNotification(title, options)
  } catch {
    new Notification(title, options)
  }
}

// Get the notification status for UI display
export function getNotificationStatus(): 'granted' | 'denied' | 'default' | 'unsupported' {
  if (!('Notification' in window)) return 'unsupported'
  return Notification.permission
}
