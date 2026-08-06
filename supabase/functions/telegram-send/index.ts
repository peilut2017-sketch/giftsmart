/**
 * telegram-send — On-demand Telegram notification sender
 *
 * Called from the frontend via supabase.functions.invoke('telegram-send', ...)
 * to mirror browser push notifications to the user's linked Telegram account.
 *
 * Body: { message: string }  (user_id is derived from the caller's JWT — a
 * client-supplied user_id is ignored, so users can only message themselves.
 * The service role key may still target any user, for server-side senders.)
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

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    const { user_id, message } = await req.json()
    if (!message) return json({ error: 'message is required' }, 400)

    const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

    // Authorization: the target user is ALWAYS the authenticated caller, unless
    // the caller holds the service-role key (cron / server-side use).
    const authHeader = req.headers.get('Authorization') ?? ''
    const token = authHeader.replace(/^Bearer\s+/i, '')
    let targetUserId: string | null = null

    if (token && token === SUPABASE_SERVICE_KEY) {
      targetUserId = user_id ?? null
    } else if (token) {
      const { data: userData, error } = await sb.auth.getUser(token)
      if (error || !userData?.user) return json({ error: 'unauthorized' }, 401)
      targetUserId = userData.user.id
    }
    if (!targetUserId) return json({ error: 'unauthorized' }, 401)

    const { data: tgUser } = await sb
      .from('telegram_users')
      .select('chat_id')
      .eq('user_id', targetUserId)
      .single()

    if (!tgUser?.chat_id) return json({ sent: false, reason: 'not_linked' })

    const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: tgUser.chat_id, text: message, parse_mode: 'HTML' }),
    })

    return json({ sent: res.ok })
  } catch (err) {
    return json({ error: String(err) }, 500)
  }
})
