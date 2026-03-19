import { useEffect } from 'react'
import type { Voucher } from '../types'

const NOTIF_KEY = 'last_expiry_notification'
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000 // 24 hours

// Days thresholds for staged notifications
const THRESHOLDS = [1, 3, 7, 14]

export function useExpiryNotifications(vouchers: Voucher[]) {
  useEffect(() => {
    if (!('Notification' in window)) return
    if (vouchers.length === 0) return

    async function checkAndNotify() {
      // Throttle: don't re-notify within 24h
      const last = localStorage.getItem(NOTIF_KEY)
      if (last && Date.now() - parseInt(last) < CHECK_INTERVAL_MS) return

      let permission = Notification.permission
      if (permission === 'default') {
        permission = await Notification.requestPermission()
      }
      if (permission !== 'granted') return

      const now = new Date()
      const nowTime = now.getTime()

      // Group vouchers by threshold buckets
      const expiring: Voucher[] = []
      for (const v of vouchers) {
        if (!v.expiry_date) continue
        const exp = new Date(v.expiry_date)
        const daysLeft = Math.ceil((exp.getTime() - nowTime) / (1000 * 60 * 60 * 24))
        if (daysLeft >= 0 && daysLeft <= 14) expiring.push(v)
      }

      if (expiring.length === 0) return

      localStorage.setItem(NOTIF_KEY, Date.now().toString())

      const urgent = expiring.filter(v => {
        const d = Math.ceil((new Date(v.expiry_date!).getTime() - nowTime) / (1000 * 60 * 60 * 24))
        return d <= 3
      })

      const title = urgent.length > 0
        ? `🚨 ${urgent.length} שובר${urgent.length > 1 ? 'ים' : ''} פגים בקרוב!`
        : `⚠️ ${expiring.length} שובר${expiring.length > 1 ? 'ים' : ''} פגים תוך 14 יום`

      const body = expiring
        .sort((a, b) => new Date(a.expiry_date!).getTime() - new Date(b.expiry_date!).getTime())
        .slice(0, 5)
        .map(v => {
          const d = Math.ceil((new Date(v.expiry_date!).getTime() - nowTime) / (1000 * 60 * 60 * 24))
          return `${v.store_name} — ${d === 0 ? 'היום!' : d === 1 ? 'מחר' : `${d} ימים`}`
        })
        .join('\n')

      const notifOptions: NotificationOptions = {
        body,
        icon: '/pwa-192x192.png',
        badge: '/pwa-192x192.png',
        tag: 'expiry-warning',
        requireInteraction: urgent.length > 0,
        data: { url: '/' },
      }

      // Prefer SW notification (works in background on Android/desktop)
      try {
        const reg = await navigator.serviceWorker.ready
        await reg.showNotification(title, notifOptions)
      } catch {
        // Fallback to regular Notification API
        new Notification(title, notifOptions)
      }
    }

    checkAndNotify()
  }, [vouchers])
}

// Request push permission proactively (call from Settings page or first launch)
export async function requestPushPermission(): Promise<NotificationPermission> {
  if (!('Notification' in window)) return 'denied'
  if (Notification.permission !== 'default') return Notification.permission
  return await Notification.requestPermission()
}

// Force a notification check (ignores throttle)
export async function forceNotificationCheck(vouchers: Voucher[]) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return
  localStorage.removeItem(NOTIF_KEY)
  // Re-trigger by re-invoking — just clear the key, the hook will pick it up on next render
}

// Get the notification status for UI display
export function getNotificationStatus(): 'granted' | 'denied' | 'default' | 'unsupported' {
  if (!('Notification' in window)) return 'unsupported'
  return Notification.permission
}
