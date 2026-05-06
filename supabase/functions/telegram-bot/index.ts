import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'npm:@supabase/supabase-js@2'

const BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN')!
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const APP_URL = Deno.env.get('APP_URL') || 'https://gifttest.vercel.app'

function send(chatId: number, text: string, extra?: object) {
  return fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML', ...extra }),
  })
}

serve(async (req) => {
  if (req.method !== 'POST') return new Response('ok')

  const update = await req.json()
  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

  const message = update.message
  if (!message?.text) return new Response('ok')

  const chatId: number = message.chat.id
  const text: string = message.text.trim()
  const username: string = message.from?.username || message.from?.first_name || 'משתמש'

  // /start [code] — link account
  if (text.startsWith('/start')) {
    const code = text.split(' ')[1]

    if (!code) {
      await send(chatId,
        `👋 שלום ${username}!\n\nכדי לקבל התראות מ-GiftSmart:\n1. פתח את האפליקציה\n2. הגדרות → טלגרם → לחץ "קשר"\n3. שלח לכאן: <code>/start [הקוד]</code>`,
        { reply_markup: { inline_keyboard: [[{ text: '🌐 פתח אפליקציה', url: APP_URL }]] } }
      )
      return new Response('ok')
    }

    const { data: linkCode } = await sb
      .from('telegram_link_codes')
      .select('user_id, expires_at, used')
      .eq('code', code)
      .single()

    if (!linkCode || linkCode.used || new Date(linkCode.expires_at) < new Date()) {
      await send(chatId, '❌ הקוד לא תקף או פג תוקף.\nבקש קוד חדש מהאפליקציה (תוקף: 10 דקות).')
      return new Response('ok')
    }

    await sb.from('telegram_link_codes').update({ used: true }).eq('code', code)
    await sb.from('telegram_users').upsert(
      { user_id: linkCode.user_id, chat_id: chatId, username },
      { onConflict: 'chat_id' }
    )

    await send(chatId,
      `✅ <b>החשבון קושר בהצלחה!</b>\n\nשלום ${username}! מעכשיו כל ההתראות מ-GiftSmart יגיעו לכאן.\n\nשלח /disconnect כדי לנתק בכל עת.`,
      { reply_markup: { inline_keyboard: [[{ text: '🌐 פתח אפליקציה', url: APP_URL }]] } }
    )
    return new Response('ok')
  }

  // Check if linked
  const { data: tgUser } = await sb
    .from('telegram_users')
    .select('user_id')
    .eq('chat_id', chatId)
    .single()

  // /disconnect — unlink account
  if (text === '/disconnect') {
    if (!tgUser) {
      await send(chatId, '❌ החשבון אינו מחובר.')
      return new Response('ok')
    }
    await sb.from('telegram_users').delete().eq('chat_id', chatId)
    await send(chatId, '✅ החשבון נותק. לא תקבל יותר התראות כאן.\n\nשלח /start כדי להתחבר שוב.')
    return new Response('ok')
  }

  // /help or unlinked
  if (!tgUser) {
    await send(chatId,
      `👋 שלום!\n\nאתה לא מחובר לחשבון עדיין.\nפתח את האפליקציה → הגדרות → טלגרם.`,
      { reply_markup: { inline_keyboard: [[{ text: '🌐 פתח אפליקציה', url: APP_URL }]] } }
    )
    return new Response('ok')
  }

  // Any other message — explain purpose
  await send(chatId,
    `🔔 <b>GiftSmart התראות</b>\n\nהבוט הזה שולח לך התראות אוטומטיות:\n• שוברים שעומדים לפוג\n• שימוש בשובר\n\nשלח /disconnect כדי לנתק.`,
    { reply_markup: { inline_keyboard: [[{ text: '🌐 פתח אפליקציה', url: APP_URL }]] } }
  )
  return new Response('ok')
})
