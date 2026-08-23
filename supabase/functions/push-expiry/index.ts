/**
 * push-expiry — Daily voucher-expiry reminders via Web Push
 *
 * The server-side counterpart of the in-app expiry badge: reaches users whose
 * app is CLOSED. Triggered by a Supabase Cron job once per day (see
 * supabase-web-push.sql for the cron.schedule call).
 *
 * Per user: honors their configured reminder window (user_settings.reminder_days,
 * default 14) and their push channel preference (notif_channels.push). To avoid
 * daily nagging across the whole window, a voucher triggers a push only when it
 * crosses a threshold: the user's window edge, 7, 3, 1, or 0 days left.
 *
 * Required secrets: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT.
 */

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'npm:@supabase/supabase-js@2'
import webpush from 'npm:web-push@3.6.7'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const APP_URL = Deno.env.get('APP_URL') || 'https://gifttest.vercel.app'

webpush.setVapidDetails(
  Deno.env.get('VAPID_SUBJECT') || 'mailto:support@giftsmart.app',
  Deno.env.get('VAPID_PUBLIC_KEY')!,
  Deno.env.get('VAPID_PRIVATE_KEY')!,
)

function daysLeft(expiry: string): number {
  const midnight = new Date()
  midnight.setHours(0, 0, 0, 0)
  const exp = new Date(expiry)
  exp.setHours(0, 0, 0, 0)
  return Math.round((exp.getTime() - midnight.getTime()) / 86400000)
}

serve(async (req) => {
  const auth = req.headers.get('Authorization') || ''
  if (auth !== `Bearer ${SUPABASE_SERVICE_KEY}`) {
    return new Response('Forbidden', { status: 403 })
  }

  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

  // Users who can actually receive a push
  const { data: subs, error } = await sb
    .from('push_subscriptions')
    .select('endpoint, p256dh, auth, user_id')

  if (error || !subs?.length) {
    return new Response(JSON.stringify({ sent: 0 }), { status: 200 })
  }

  const subsByUser = new Map<string, typeof subs>()
  for (const s of subs) {
    const list = subsByUser.get(s.user_id) ?? []
    list.push(s)
    subsByUser.set(s.user_id, list)
  }
  const userIds = [...subsByUser.keys()]

  // Per-user settings (window + channel opt-out)
  const { data: settings } = await sb
    .from('user_settings')
    .select('user_id, reminder_days, notif_channels')
    .in('user_id', userIds)
  const settingsByUser = new Map((settings ?? []).map(s => [s.user_id, s]))

  let sent = 0
  let pruned = 0

  for (const userId of userIds) {
    const cfg = settingsByUser.get(userId)
    if (cfg?.notif_channels && cfg.notif_channels.push === false) continue
    const windowDays = Math.max(1, Math.min(90, cfg?.reminder_days ?? 14))

    const { data: wm } = await sb
      .from('wallet_members')
      .select('wallet_id')
      .eq('user_id', userId)
      .limit(1)
      .single()
    if (!wm?.wallet_id) continue

    const horizon = new Date(Date.now() + windowDays * 86400000).toISOString().split('T')[0]
    const today = new Date().toISOString().split('T')[0]

    const { data: vouchers } = await sb
      .from('vouchers')
      .select('id, store_name, balance, expiry_date')
      .eq('wallet_id', wm.wallet_id)
      .eq('is_archived', false)
      .not('expiry_date', 'is', null)
      .lte('expiry_date', horizon)
      .gte('expiry_date', today)
      .order('expiry_date')
    if (!vouchers?.length) continue

    // Push only on threshold days — not every day of the window
    const thresholds = new Set([windowDays, 7, 3, 1, 0])
    const dueToday = vouchers.filter(v => thresholds.has(daysLeft(v.expiry_date!)))
    if (!dueToday.length) continue

    const first = dueToday[0]
    const d = daysLeft(first.expiry_date!)
    const title = d === 0 ? 'שובר פג היום!' : d <= 3 ? 'שובר עומד לפוג!' : 'תזכורת תוקף'
    const body = dueToday.length === 1
      ? `${first.store_name} — ₪${first.balance} · ${d === 0 ? 'פג היום' : `עוד ${d} ימים`}`
      : `${first.store_name} ועוד ${dueToday.length - 1} שוברים עומדים לפוג בקרוב`
    const url = dueToday.length === 1 ? `${APP_URL}/checkout/${first.id}` : `${APP_URL}/notifications`
    const payload = JSON.stringify({ title, body, url, tag: 'expiry' })

    for (const s of subsByUser.get(userId)!) {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          payload,
        )
        sent++
      } catch (err) {
        const status = (err as { statusCode?: number })?.statusCode
        if (status === 404 || status === 410) {
          await sb.from('push_subscriptions').delete().eq('endpoint', s.endpoint)
          pruned++
        }
      }
    }
  }

  return new Response(JSON.stringify({ sent, pruned }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
})
