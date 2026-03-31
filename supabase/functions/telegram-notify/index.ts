/**
 * telegram-notify — Daily expiry alerts via Telegram
 *
 * Triggered by a Supabase Cron job (pg_cron) once per day:
 *   SELECT cron.schedule('telegram-notify', '0 9 * * *',
 *     $$SELECT net.http_post(
 *       url := '<SUPABASE_URL>/functions/v1/telegram-notify',
 *       headers := '{"Authorization": "Bearer <SERVICE_ROLE_KEY>"}'::jsonb
 *     )$$
 *   );
 */

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'npm:@supabase/supabase-js@2'

const BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN')!
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

function send(chatId: number, text: string) {
  return fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
  })
}

serve(async (req) => {
  // Allow only service-role calls (exact match)
  const auth = req.headers.get('Authorization') || ''
  if (auth !== `Bearer ${SUPABASE_SERVICE_KEY}`) {
    return new Response('Forbidden', { status: 403 })
  }

  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

  // Fetch all linked Telegram users
  const { data: tgUsers, error } = await sb
    .from('telegram_users')
    .select('chat_id, user_id')

  if (error || !tgUsers?.length) {
    return new Response(JSON.stringify({ sent: 0 }), { status: 200 })
  }

  const APP_URL = Deno.env.get('APP_URL') || 'https://gifttest.vercel.app'
  const today = new Date().toISOString().split('T')[0]
  const in30 = new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0]
  const in7  = new Date(Date.now() +  7 * 86400000).toISOString().split('T')[0]

  let sent = 0

  for (const { chat_id, user_id } of tgUsers) {
    // Get wallet
    const { data: wm } = await sb
      .from('wallet_members')
      .select('wallet_id')
      .eq('user_id', user_id)
      .limit(1)
      .single()

    if (!wm?.wallet_id) continue

    const { data: vouchers } = await sb
      .from('vouchers')
      .select('store_name, balance, expiry_date')
      .eq('wallet_id', wm.wallet_id)
      .eq('is_archived', false)
      .not('expiry_date', 'is', null)
      .lte('expiry_date', in30)
      .gte('expiry_date', today)
      .order('expiry_date')

    if (!vouchers?.length) continue

    const urgent   = vouchers.filter(v => v.expiry_date! <= in7)
    const upcoming = vouchers.filter(v => v.expiry_date! >  in7)

    const lines = [
      ...urgent.map(v => {
        const days = Math.ceil((new Date(v.expiry_date!).getTime() - Date.now()) / 86400000)
        return `🔴 <b>${v.store_name}</b> — ₪${v.balance} | עוד ${days} ימים`
      }),
      ...upcoming.map(v => {
        const days = Math.ceil((new Date(v.expiry_date!).getTime() - Date.now()) / 86400000)
        return `⚠️ <b>${v.store_name}</b> — ₪${v.balance} | עוד ${days} ימים`
      }),
    ].join('\n')

    const title = urgent.length
      ? `🚨 <b>שוברים שפגים בקרוב!</b>`
      : `⏰ <b>תזכורת: שוברים שפגים ב-30 יום</b>`

    await send(
      chat_id,
      `${title}\n\n${lines}\n\n<a href="${APP_URL}">פתח ארנק שוברים</a>`
    )
    sent++
  }

  return new Response(JSON.stringify({ sent }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
})
