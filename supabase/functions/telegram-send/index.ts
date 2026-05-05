/**
 * telegram-send — On-demand Telegram notification sender
 *
 * Called from the frontend via supabase.functions.invoke('telegram-send', ...)
 * to mirror browser push notifications to the user's linked Telegram account.
 *
 * Body: { user_id: string, message: string }
 */

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'npm:@supabase/supabase-js@2'

const BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN')!
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    const { user_id, message } = await req.json()
    if (!user_id || !message) {
      return new Response(JSON.stringify({ error: 'user_id and message are required' }), {
        status: 400, headers: { ...CORS, 'Content-Type': 'application/json' },
      })
    }

    const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

    const { data: tgUser } = await sb
      .from('telegram_users')
      .select('chat_id')
      .eq('user_id', user_id)
      .single()

    if (!tgUser?.chat_id) {
      return new Response(JSON.stringify({ sent: false, reason: 'not_linked' }), {
        status: 200, headers: { ...CORS, 'Content-Type': 'application/json' },
      })
    }

    const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: tgUser.chat_id, text: message, parse_mode: 'HTML' }),
    })

    const ok = res.ok
    return new Response(JSON.stringify({ sent: ok }), {
      status: 200, headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }
})
