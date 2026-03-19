import { useEffect } from 'react'
import type { Voucher } from '../types'

const NOTIF_KEY = 'last_expiry_notification'
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000 // 24 hours

export function useExpiryNotifications(vouchers: Voucher[]) {
  useEffect(() => {
    if (!('Notification' in window)) return
    if (vouchers.length === 0) return

    async function checkAndNotify() {
      // Throttle: don't re-notify within 24h
      const last = localStorage.getItem(NOTIF_KEY)
      if (last && Date.now() - parseInt(last) < CHECK_INTERVAL_MS) return

      const permission = await Notification.requestPermission()
      if (permission !== 'granted') return

      const now = new Date()
      const in7Days = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)

      const critical = vouchers.filter(v => {
        if (!v.expiry_date) return false
        const exp = new Date(v.expiry_date)
        return exp >= now && exp <= in7Days
      })

      if (critical.length === 0) return

      localStorage.setItem(NOTIF_KEY, Date.now().toString())

      if (critical.length === 1) {
        new Notification('⚠️ שובר עומד לפוג', {
          body: `${critical[0].store_name} — פג תוך 7 ימים`,
          icon: '/pwa-192x192.png',
          tag: 'expiry-warning',
        })
      } else {
        new Notification(`⚠️ ${critical.length} שוברים עומדים לפוג`, {
          body: critical.map(v => v.store_name).join(', '),
          icon: '/pwa-192x192.png',
          tag: 'expiry-warning',
        })
      }
    }

    checkAndNotify()
  }, [vouchers])
}
