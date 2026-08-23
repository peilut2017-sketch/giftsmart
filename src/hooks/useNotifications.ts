import { useEffect } from 'react'
import type { Voucher } from '../types'
import { supabase } from '../lib/supabase'
import { sendExpiryReminderEmail } from '../lib/emailService'
import { translate } from '../lib/i18n'

const NOTIF_KEY = 'last_expiry_notification'
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000 // 24 hours

export interface NotifChannels {
  push: boolean
  email: boolean
  telegram: boolean
}

export function getNotifChannels(userId?: string): NotifChannels {
  if (!userId) return { push: true, email: false, telegram: true }
  try {
    const raw = localStorage.getItem(`notif_channels_${userId}`)
    if (!raw) return { push: true, email: false, telegram: true }
    return { push: true, email: false, telegram: true, ...JSON.parse(raw) }
  } catch {
    return { push: true, email: false, telegram: true }
  }
}

export function saveNotifChannels(userId: string, channels: NotifChannels) {
  localStorage.setItem(`notif_channels_${userId}`, JSON.stringify(channels))
}

async function showNotification(title: string, options: NotificationOptions) {
  try {
    const reg = await navigator.serviceWorker.ready
    await reg.showNotification(title, options)
  } catch {
    new Notification(title, options)
  }
}

async function sendTelegram(userId: string, message: string) {
  try {
    await supabase.functions.invoke('telegram-send', { body: { user_id: userId, message } })
  } catch {
    // Telegram is best-effort — never block the main flow
  }
}

export function useExpiryNotifications(
  vouchers: Voucher[],
  isPro: boolean,
  userId?: string,
  userEmail?: string,
  userName?: string,
) {
  useEffect(() => {
    if (!isPro) return
    if (!('Notification' in window)) return

    async function checkAndNotify() {
      if (vouchers.length === 0) return

      const last = localStorage.getItem(NOTIF_KEY)
      if (last && Date.now() - parseInt(last) < CHECK_INTERVAL_MS) return

      const expiryWindowDays = parseInt(localStorage.getItem(`reminder_days_${userId}`) || '14')
      const nowTime = Date.now()
      const expiring: Voucher[] = []
      for (const v of vouchers) {
        if (!v.expiry_date) continue
        const daysLeft = Math.ceil((new Date(v.expiry_date).getTime() - nowTime) / (1000 * 60 * 60 * 24))
        if (daysLeft >= 0 && daysLeft <= expiryWindowDays) expiring.push(v)
      }

      if (expiring.length === 0) return

      localStorage.setItem(NOTIF_KEY, Date.now().toString())

      const channels = getNotifChannels(userId)

      const urgent = expiring.filter(v =>
        Math.ceil((new Date(v.expiry_date!).getTime() - nowTime) / (1000 * 60 * 60 * 24)) <= 3
      )

      const title = urgent.length > 0
        ? (urgent.length === 1
            ? translate('notif.expiry.title.urgent.one')
            : translate('notif.expiry.title.urgent.many', { n: urgent.length }))
        : (expiring.length === 1
            ? translate('notif.expiry.title.window.one', { days: expiryWindowDays })
            : translate('notif.expiry.title.window.many', { n: expiring.length, days: expiryWindowDays }))

      const body = expiring
        .sort((a, b) => new Date(a.expiry_date!).getTime() - new Date(b.expiry_date!).getTime())
        .slice(0, 5)
        .map(v => {
          const d = Math.ceil((new Date(v.expiry_date!).getTime() - nowTime) / (1000 * 60 * 60 * 24))
          const when = d === 0 ? translate('notif.day.today') : d === 1 ? translate('notif.day.tomorrow') : translate('notif.day.days', { d })
          return `${v.store_name} — ${when}`
        })
        .join('\n')

      // Push notification
      if (channels.push) {
        let permission = Notification.permission
        if (permission === 'default') {
          permission = await Notification.requestPermission()
        }
        if (permission === 'granted') {
          const baseOptions: NotificationOptions = {
            icon: '/web-app-manifest-192x192.png',
            badge: '/web-app-manifest-192x192.png',
            tag: 'expiry-warning',
            data: { url: '/' },
          }
          await showNotification(title, { ...baseOptions, body, requireInteraction: urgent.length > 0 })
        }
      }

      // Email notification
      if (channels.email && userEmail) {
        try {
          const vouchers_list = expiring
            .sort((a, b) => new Date(a.expiry_date!).getTime() - new Date(b.expiry_date!).getTime())
            .slice(0, 10)
            .map(v => {
              const d = Math.ceil((new Date(v.expiry_date!).getTime() - nowTime) / (1000 * 60 * 60 * 24))
              return `• ${v.store_name} — יתרה ₪${v.balance}${v.expiry_date ? `, תוקף: ${new Date(v.expiry_date).toLocaleDateString('he-IL')}` : ''} (${d === 0 ? 'היום' : d === 1 ? 'מחר' : `עוד ${d} ימים`})`
            })
            .join('\n')
          await sendExpiryReminderEmail({
            to_email: userEmail,
            to_name: userName || userEmail,
            count: expiring.length,
            vouchers_list,
          })
        } catch {
          // email is best-effort
        }
      }

      // Telegram notification
      if (channels.telegram && userId) {
        const lines = expiring
          .sort((a, b) => new Date(a.expiry_date!).getTime() - new Date(b.expiry_date!).getTime())
          .slice(0, 5)
          .map(v => {
            const d = Math.ceil((new Date(v.expiry_date!).getTime() - nowTime) / (1000 * 60 * 60 * 24))
            const icon = d <= 3 ? '🔴' : '⚠️'
            return `${icon} <b>${v.store_name}</b> — ₪${v.balance} | ${d === 0 ? 'היום!' : d === 1 ? 'מחר' : `עוד ${d} ימים`}`
          })
          .join('\n')

        const tgTitle = urgent.length > 0 ? '🚨 <b>שוברים שפגים בקרוב!</b>' : '⏰ <b>תזכורת: שוברים שפגים בקרוב</b>'
        await sendTelegram(userId, `${tgTitle}\n\n${lines}`)
      }
    }

    checkAndNotify()
  }, [vouchers, isPro, userId, userEmail, userName])
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
}

// Send an immediate push notification when a voucher is used
export async function sendUsageNotification(
  storeName: string,
  usedAmount: number,
  newBalance: number,
  storeUsed?: string | null,
  userId?: string,
) {
  const fullyRedeemed = newBalance <= 0
  const storeLabel = storeUsed ? ` — ${storeUsed}` : ''
  const at = storeUsed ? translate('notif.usage.at', { store: storeUsed }) : ''
  const title = (fullyRedeemed
    ? translate('notif.usage.full.title', { store: storeName })
    : translate('notif.usage.title', { store: storeName })) + storeLabel
  const body = fullyRedeemed
    ? translate('notif.usage.full.body', { amount: usedAmount.toLocaleString('he-IL'), at })
    : translate('notif.usage.body', { amount: usedAmount.toLocaleString('he-IL'), at, balance: newBalance.toLocaleString('he-IL') })

  if ('Notification' in window && Notification.permission === 'granted') {
    const options: NotificationOptions = {
      body,
      icon: '/web-app-manifest-192x192.png',
      badge: '/web-app-manifest-192x192.png',
      tag: 'voucher-usage',
    }
    try {
      const reg = await navigator.serviceWorker.ready
      await reg.showNotification(title, options)
    } catch {
      new Notification(title, options)
    }
  }

  if (userId) {
    const icon = fullyRedeemed ? '🎯' : '💳'
    const tgBody = fullyRedeemed
      ? `${icon} <b>${title}</b>\n\n${body}`
      : `${icon} <b>שימוש בשובר ${storeName}${storeLabel}</b>\n\nהוצאת: ₪${usedAmount.toLocaleString('he-IL')}\nיתרה נותרת: ₪${newBalance.toLocaleString('he-IL')}`
    await sendTelegram(userId, tgBody)
  }
}

export function getNotificationStatus(): 'granted' | 'denied' | 'default' | 'unsupported' {
  if (!('Notification' in window)) return 'unsupported'
  return Notification.permission
}
