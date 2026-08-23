/**
 * send-push — Generic Web Push sender
 *
 * Service-role only. Body:
 *   { user_ids: string[], title: string, body: string, url?: string, tag?: string }
 *
 * Sends the payload to every push subscription of the given users, and prunes
 * subscriptions the push service reports as gone (404/410).
 *
 * Required secrets: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT
 * (see supabase-web-push.sql for full setup instructions).
 */

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'npm:@supabase/supabase-js@2'
import webpush from 'npm:web-push@3.6.7'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

webpush.setVapidDetails(
  Deno.env.get('VAPID_SUBJECT') || 'mailto:support@giftsmart.app',
  Deno.env.get('VAPID_PUBLIC_KEY')!,
  Deno.env.get('VAPID_PRIVATE_KEY')!,
)

interface PushRequest {
  user_ids: string[]
  title: string
  body: string
  url?: string
  tag?: string
}

export async function sendToUsers(
  sb: ReturnType<typeof createClient>,
  req: PushRequest,
): Promise<{ sent: number; pruned: number }> {
  const { data: subs } = await sb
    .from('push_subscriptions')
    .select('endpoint, p256dh, auth, user_id')
    .in('user_id', req.user_ids)

  if (!subs?.length) return { sent: 0, pruned: 0 }

  const payload = JSON.stringify({
    title: req.title,
    body: req.body,
    url: req.url || '/',
    tag: req.tag,
  })

  let sent = 0
  let pruned = 0

  await Promise.all(subs.map(async (s) => {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        payload,
      )
      sent++
    } catch (err) {
      const status = (err as { statusCode?: number })?.statusCode
      // The push service says this subscription no longer exists — drop it
      if (status === 404 || status === 410) {
        await sb.from('push_subscriptions').delete().eq('endpoint', s.endpoint)
        pruned++
      }
    }
  }))

  return { sent, pruned }
}

serve(async (req) => {
  const auth = req.headers.get('Authorization') || ''
  if (auth !== `Bearer ${SUPABASE_SERVICE_KEY}`) {
    return new Response('Forbidden', { status: 403 })
  }

  let body: PushRequest
  try {
    body = await req.json()
  } catch {
    return new Response('Bad Request', { status: 400 })
  }
  if (!Array.isArray(body.user_ids) || !body.user_ids.length || !body.title || !body.body) {
    return new Response('Bad Request', { status: 400 })
  }

  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
  const result = await sendToUsers(sb, body)

  return new Response(JSON.stringify(result), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
})
