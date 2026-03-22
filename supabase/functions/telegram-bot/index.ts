import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'npm:@supabase/supabase-js@2'

const BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN')!
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const APP_URL = Deno.env.get('APP_URL') || 'https://gifttest.vercel.app'

// ── Telegram helpers ──────────────────────────────────────────────────────────

function tgFetch(method: string, body: object) {
  return fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function send(chatId: number, text: string, extra?: object) {
  return tgFetch('sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    ...extra,
  })
}

// ── Conversation handler ──────────────────────────────────────────────────────

async function handleConversation(
  sb: ReturnType<typeof createClient>,
  chatId: number,
  userId: string,
  walletId: string,
  text: string,
  session: { state: string; data: Record<string, unknown> }
) {
  const { state, data } = session

  if (text === '/cancel') {
    await sb.from('telegram_sessions').delete().eq('chat_id', chatId)
    await send(chatId, '❌ הפעולה בוטלה.')
    return
  }

  if (state === 'add_store') {
    const updated = { ...data, store_name: text }
    await sb.from('telegram_sessions').update({ state: 'add_amount', data: updated }).eq('chat_id', chatId)
    await send(chatId, `✅ חנות: <b>${text}</b>\n\nמה הסכום המקורי של השובר? (₪)`)
    return
  }

  if (state === 'add_amount') {
    const amount = parseFloat(text)
    if (isNaN(amount) || amount <= 0) {
      await send(chatId, '⚠️ נא הזן סכום תקין (מספר חיובי)\nדוגמה: 200')
      return
    }
    const updated = { ...data, amount, balance: amount }
    await sb.from('telegram_sessions').update({ state: 'add_code', data: updated }).eq('chat_id', chatId)
    await send(chatId, `✅ סכום: ₪${amount}\n\nמה קוד השובר?`)
    return
  }

  if (state === 'add_code') {
    const updated = { ...data, code: text }
    await sb.from('telegram_sessions').update({ state: 'add_expiry', data: updated }).eq('chat_id', chatId)
    await send(chatId, `✅ קוד: <code>${text}</code>\n\nמה תאריך התפוגה? (DD/MM/YYYY)\nאו שלח /skip אם אין תאריך`)
    return
  }

  if (state === 'add_expiry') {
    let expiryDate: string | null = null

    if (text !== '/skip') {
      const parts = text.split('/')
      if (parts.length !== 3 || parts[2].length < 4) {
        await send(chatId, '⚠️ פורמט לא תקין. נסה שוב (DD/MM/YYYY) או שלח /skip')
        return
      }
      expiryDate = `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`
    }

    const { error } = await sb.from('vouchers').insert({
      user_id: userId,
      wallet_id: walletId,
      store_name: data.store_name,
      amount: data.amount,
      balance: data.balance,
      code: data.code,
      expiry_date: expiryDate,
      categories: [],
      tags: [],
      is_archived: false,
      is_shared: false,
    })

    await sb.from('telegram_sessions').delete().eq('chat_id', chatId)

    if (error) {
      await send(chatId, '❌ שגיאה בהוספת השובר. נסה שוב.')
    } else {
      const expiryText = expiryDate ? `\n📅 תוקף: ${text}` : ''
      await send(
        chatId,
        `✅ <b>השובר נוסף!</b>\n\n🎁 ${data.store_name}\n💰 יתרה: ₪${data.balance}\n🔑 קוד: <code>${data.code}</code>${expiryText}\n\n<a href="${APP_URL}">פתח אפליקציה</a>`
      )
    }
  }
}

// ── Help text ─────────────────────────────────────────────────────────────────

const HELP = `📋 <b>פקודות זמינות:</b>

/vouchers — רשימת כל השוברים
/get [חנות] — קוד שובר לפי שם חנות
/update [חנות] [סכום] — עדכון יתרה לאחר שימוש
/add — הוסף שובר חדש (שיחה מודרכת)
/expiring — שוברים שפגים ב-30 יום הקרובים
/low — שוברים עם יתרה נמוכה (מתחת ל-₪50)
/cancel — בטל פעולה נוכחית`

// ── Main ──────────────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method !== 'POST') return new Response('ok')

  const update = await req.json()
  const message = update.message
  if (!message?.text) return new Response('ok')

  const chatId: number = message.chat.id
  const text: string = message.text.trim()
  const username: string = message.from?.username || message.from?.first_name || 'משתמש'

  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

  // ── /start [code] — link account ──────────────────────────────────────────
  if (text.startsWith('/start')) {
    const code = text.split(' ')[1]

    if (!code) {
      await send(chatId, `👋 שלום ${username}!\n\nכדי לקשר את החשבון שלך:\n1. פתח את האפליקציה\n2. עבור להגדרות → טלגרם\n3. לחץ "קשר לטלגרם" וקבל קוד\n4. שלח: /start [הקוד]`)
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
    await sb.from('telegram_users').upsert({ user_id: linkCode.user_id, chat_id: chatId, username })

    await send(chatId, `✅ <b>החשבון קושר בהצלחה!</b>\n\nשלום ${username}! כעת תוכל לנהל את השוברים שלך מכאן.\n\n${HELP}`)
    return new Response('ok')
  }

  // Check if linked
  const { data: tgUser } = await sb
    .from('telegram_users')
    .select('user_id')
    .eq('chat_id', chatId)
    .single()

  if (!tgUser) {
    await send(chatId, `👋 שלום!\n\nאתה לא מחובר לחשבון עדיין.\nפתח את האפליקציה → הגדרות → טלגרם כדי להתחבר.`)
    return new Response('ok')
  }

  const userId = tgUser.user_id

  // Get user's wallet — order by created_at to match the web app's wallet selection
  const { data: walletMember } = await sb
    .from('wallet_members')
    .select('wallet_id')
    .eq('user_id', userId)
    .order('created_at')
    .limit(1)
    .single()

  const walletId = walletMember?.wallet_id

  if (!walletId) {
    await send(chatId, '❌ לא נמצא ארנק שוברים. נסה להיכנס לאפליקציה תחילה.')
    return new Response('ok')
  }

  // Check for active conversation state
  const { data: session } = await sb
    .from('telegram_sessions')
    .select('state, data')
    .eq('chat_id', chatId)
    .single()

  if (session?.state && !text.startsWith('/vouchers') && !text.startsWith('/get ') &&
      !text.startsWith('/update ') && text !== '/expiring' && text !== '/low' && text !== '/help') {
    await handleConversation(sb, chatId, userId, walletId, text, session)
    return new Response('ok')
  }

  // ── Commands ──────────────────────────────────────────────────────────────

  if (text === '/vouchers') {
    const { data: vouchers } = await sb
      .from('vouchers')
      .select('store_name, balance, expiry_date')
      .eq('wallet_id', walletId)
      .eq('is_archived', false)
      .order('balance', { ascending: false })

    if (!vouchers?.length) {
      await send(chatId, '📭 אין שוברים פעילים בארנק שלך.\n\nלהוספת שובר: /add')
      return new Response('ok')
    }

    const total = vouchers.reduce((s, v) => s + v.balance, 0)
    const lines = vouchers.map(v => {
      const expiry = v.expiry_date
        ? ` | ${new Date(v.expiry_date).toLocaleDateString('he-IL')}`
        : ''
      return `🎁 <b>${v.store_name}</b> — ₪${v.balance}${expiry}`
    }).join('\n')

    await send(chatId, `📋 <b>השוברים שלך (${vouchers.length})</b>\nסה"כ: ₪${total}\n\n${lines}`)
    return new Response('ok')
  }

  if (text.startsWith('/get ')) {
    const storeName = text.slice(5).trim()
    const { data: vouchers } = await sb
      .from('vouchers')
      .select('store_name, balance, code, cvv, expiry_date')
      .eq('wallet_id', walletId)
      .eq('is_archived', false)
      .ilike('store_name', `%${storeName}%`)

    if (!vouchers?.length) {
      await send(chatId, `❌ לא נמצא שובר עבור "${storeName}"\n\nנסה /vouchers לרשימה מלאה`)
      return new Response('ok')
    }

    const v = vouchers[0]
    const expiry = v.expiry_date
      ? `\n📅 תוקף: ${new Date(v.expiry_date).toLocaleDateString('he-IL')}`
      : ''
    const cvv = v.cvv ? `\n🔐 CVV: <code>${v.cvv}</code>` : ''

    await send(chatId, `🎁 <b>${v.store_name}</b>\n💰 יתרה: ₪${v.balance}\n🔑 קוד: <code>${v.code}</code>${cvv}${expiry}`)
    return new Response('ok')
  }

  if (text.startsWith('/update ')) {
    const parts = text.slice(8).trim().split(' ')
    const amount = parseFloat(parts[parts.length - 1])
    const storeName = parts.slice(0, -1).join(' ')

    if (isNaN(amount) || amount <= 0 || !storeName) {
      await send(chatId, '⚠️ שימוש: /update [שם חנות] [סכום ששימשת]\nדוגמה: /update שופרסל 50')
      return new Response('ok')
    }

    const { data: vouchers } = await sb
      .from('vouchers')
      .select('id, store_name, balance')
      .eq('wallet_id', walletId)
      .eq('is_archived', false)
      .ilike('store_name', `%${storeName}%`)

    if (!vouchers?.length) {
      await send(chatId, `❌ לא נמצא שובר עבור "${storeName}"`)
      return new Response('ok')
    }

    const v = vouchers[0]
    const newBalance = Math.max(0, v.balance - amount)
    await sb.from('vouchers').update({ balance: newBalance }).eq('id', v.id)

    const status = newBalance === 0 ? '\n\n⚠️ יתרה אפסה — ניתן לארכב את השובר' : ''
    await send(chatId, `✅ יתרה עודכנה!\n\n🎁 ${v.store_name}\n💰 יתרה חדשה: ₪${newBalance}${status}`)
    return new Response('ok')
  }

  if (text === '/expiring') {
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() + 30)

    const { data: vouchers } = await sb
      .from('vouchers')
      .select('store_name, balance, expiry_date')
      .eq('wallet_id', walletId)
      .eq('is_archived', false)
      .not('expiry_date', 'is', null)
      .lte('expiry_date', cutoff.toISOString().split('T')[0])
      .gte('expiry_date', new Date().toISOString().split('T')[0])
      .order('expiry_date')

    if (!vouchers?.length) {
      await send(chatId, '✅ אין שוברים שפגים ב-30 הימים הקרובים!')
      return new Response('ok')
    }

    const lines = vouchers.map(v => {
      const days = Math.ceil((new Date(v.expiry_date!).getTime() - Date.now()) / 86400000)
      const urgency = days <= 7 ? '🔴' : '⚠️'
      return `${urgency} <b>${v.store_name}</b> — ₪${v.balance} | עוד ${days} ימים`
    }).join('\n')

    await send(chatId, `⏰ <b>פגים בקרוב (${vouchers.length})</b>\n\n${lines}`)
    return new Response('ok')
  }

  if (text === '/low') {
    const LOW = 50
    const { data: vouchers } = await sb
      .from('vouchers')
      .select('store_name, balance')
      .eq('wallet_id', walletId)
      .eq('is_archived', false)
      .lt('balance', LOW)
      .gt('balance', 0)
      .order('balance')

    if (!vouchers?.length) {
      await send(chatId, `✅ אין שוברים עם יתרה מתחת ל-₪${LOW}`)
      return new Response('ok')
    }

    const lines = vouchers.map(v => `💸 <b>${v.store_name}</b> — ₪${v.balance}`).join('\n')
    await send(chatId, `📉 <b>יתרה נמוכה (${vouchers.length})</b>\n\n${lines}`)
    return new Response('ok')
  }

  if (text === '/add') {
    await sb.from('telegram_sessions').upsert({ chat_id: chatId, state: 'add_store', data: {} })
    await send(chatId, `➕ <b>הוספת שובר חדש</b>\n\n(שלח /cancel בכל שלב לביטול)\n\nמה שם החנות?`)
    return new Response('ok')
  }

  // Default
  await send(chatId, HELP)
  return new Response('ok')
})
