import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'npm:@supabase/supabase-js@2'

const BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN')!
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const APP_URL = Deno.env.get('APP_URL') || 'https://gifttest.vercel.app'

// ── Telegram API helpers ───────────────────────────────────────────────────────

function tgFetch(method: string, body: object) {
  return fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function send(chatId: number, text: string, extra?: object) {
  return tgFetch('sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', ...extra })
}

function editMsg(chatId: number, messageId: number, text: string, extra?: object) {
  return tgFetch('editMessageText', {
    chat_id: chatId,
    message_id: messageId,
    text,
    parse_mode: 'HTML',
    ...extra,
  })
}

function answerCb(id: string, text?: string) {
  return tgFetch('answerCallbackQuery', { callback_query_id: id, text })
}

// ── Keyboard builders ─────────────────────────────────────────────────────────

function mainMenu() {
  return {
    inline_keyboard: [
      [
        { text: '📋 השוברים שלי',  callback_data: 'vouchers' },
        { text: '➕ הוסף שובר',    callback_data: 'add' },
      ],
      [
        { text: '⏰ פגים בקרוב',   callback_data: 'expiring' },
        { text: '📉 יתרה נמוכה',   callback_data: 'low' },
      ],
      [
        { text: '🌐 פתח אפליקציה', url: APP_URL },
      ],
    ],
  }
}

function voucherListKeyboard(vouchers: { id: string; store_name: string; balance: number }[]) {
  const rows = vouchers.map(v => [{
    text: `${v.store_name} — ₪${v.balance}`,
    callback_data: `view:${v.id}`,
  }])
  rows.push([{ text: '🔙 תפריט ראשי', callback_data: 'menu' }])
  return { inline_keyboard: rows }
}

function voucherActionsKeyboard(voucherId: string) {
  return {
    inline_keyboard: [
      [
        { text: '🔑 קוד + ברקוד',    callback_data: `barcode:${voucherId}` },
        { text: '✏️ עדכן יתרה',      callback_data: `upd:${voucherId}` },
      ],
      [
        { text: '📦 העבר לארכיון',   callback_data: `archive:${voucherId}` },
        { text: '🔙 רשימת שוברים',   callback_data: 'vouchers' },
      ],
    ],
  }
}

function backToVoucherKeyboard(voucherId: string) {
  return {
    inline_keyboard: [[
      { text: '🔙 חזרה לשובר',  callback_data: `view:${voucherId}` },
      { text: '📋 כל השוברים',  callback_data: 'vouchers' },
    ]],
  }
}

// ── Share-token for barcode link ──────────────────────────────────────────────

async function makeShareToken(sb: ReturnType<typeof createClient>, voucherId: string, userId: string) {
  const token = Array.from(crypto.getRandomValues(new Uint8Array(24)))
    .map((b: number) => b.toString(16).padStart(2, '0'))
    .join('')
  const expires_at = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
  const { error } = await sb.from('shared_voucher_tokens').insert({
    token, voucher_id: voucherId, created_by: userId, expires_at,
  })
  if (error) throw new Error(error.message)
  return token
}

// ── Wallet resolver ───────────────────────────────────────────────────────────

async function resolveWallet(sb: ReturnType<typeof createClient>, userId: string): Promise<string | null> {
  const { data: m } = await sb
    .from('wallet_members')
    .select('wallet_id')
    .eq('user_id', userId)
    .order('created_at')
    .limit(1)
    .single()
  if (m?.wallet_id) return m.wallet_id

  const { data: w } = await sb
    .from('wallets')
    .select('id')
    .eq('owner_id', userId)
    .order('created_at')
    .limit(1)
    .single()
  return w?.id ?? null
}

// ── Conversation handler (multi-step flows) ───────────────────────────────────

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
    await send(chatId, '❌ הפעולה בוטלה.', { reply_markup: mainMenu() })
    return
  }

  // ── Add voucher ──────────────────────────────────────────────────────────────
  if (state === 'add_store') {
    await sb.from('telegram_sessions')
      .update({ state: 'add_amount', data: { ...data, store_name: text } })
      .eq('chat_id', chatId)
    await send(chatId, `✅ חנות: <b>${text}</b>\n\nמה הסכום המקורי? (₪)`)
    return
  }

  if (state === 'add_amount') {
    const amount = parseFloat(text)
    if (isNaN(amount) || amount <= 0) {
      await send(chatId, '⚠️ נא הזן סכום תקין. דוגמה: 200')
      return
    }
    await sb.from('telegram_sessions')
      .update({ state: 'add_code', data: { ...data, amount, balance: amount } })
      .eq('chat_id', chatId)
    await send(chatId, `✅ סכום: ₪${amount}\n\nמה קוד השובר?`)
    return
  }

  if (state === 'add_code') {
    await sb.from('telegram_sessions')
      .update({ state: 'add_expiry', data: { ...data, code: text } })
      .eq('chat_id', chatId)
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
      user_id: userId, wallet_id: walletId,
      store_name: data.store_name, amount: data.amount, balance: data.balance,
      code: data.code, expiry_date: expiryDate,
      categories: [], tags: [], is_archived: false, is_shared: false,
    })
    await sb.from('telegram_sessions').delete().eq('chat_id', chatId)

    if (error) {
      await send(chatId, '❌ שגיאה בהוספת השובר. נסה שוב.', { reply_markup: mainMenu() })
    } else {
      const expiryText = expiryDate ? `\n📅 תוקף: ${text}` : ''
      await send(
        chatId,
        `✅ <b>השובר נוסף!</b>\n\n🎁 ${data.store_name}\n💰 יתרה: ₪${data.balance}\n🔑 קוד: <code>${data.code}</code>${expiryText}`,
        { reply_markup: mainMenu() }
      )
    }
    return
  }

  // ── Update balance ───────────────────────────────────────────────────────────
  if (state === 'upd_balance') {
    const amount = parseFloat(text)
    if (isNaN(amount) || amount < 0) {
      await send(chatId, '⚠️ נא הזן סכום תקין. דוגמה: 50')
      return
    }
    const voucherId = data.voucher_id as string
    const currentBalance = data.current_balance as number
    const newBalance = Math.max(0, currentBalance - amount)

    await sb.from('vouchers').update({ balance: newBalance }).eq('id', voucherId)
    await sb.from('telegram_sessions').delete().eq('chat_id', chatId)

    const warn = newBalance === 0 ? '\n\n⚠️ יתרה אפסה — ניתן לארכב.' : ''
    await send(chatId, `✅ יתרה עודכנה!\n💰 יתרה חדשה: ₪${newBalance}${warn}`,
      { reply_markup: backToVoucherKeyboard(voucherId) })
    return
  }
}

// ── Callback query handler ────────────────────────────────────────────────────

async function handleCallback(
  sb: ReturnType<typeof createClient>,
  chatId: number,
  userId: string,
  walletId: string,
  cbData: string,
  cbId: string,
  msgId: number,
) {
  // main menu
  if (cbData === 'menu') {
    await editMsg(chatId, msgId, '📱 <b>תפריט ראשי</b>\n\nבחר פעולה:', { reply_markup: mainMenu() })
    await answerCb(cbId)
    return
  }

  // voucher list
  if (cbData === 'vouchers') {
    const { data: vouchers } = await sb
      .from('vouchers')
      .select('id, store_name, balance')
      .eq('wallet_id', walletId)
      .eq('is_archived', false)
      .order('store_name')

    if (!vouchers?.length) {
      await editMsg(chatId, msgId, '📭 אין שוברים פעילים.', {
        reply_markup: { inline_keyboard: [
          [{ text: '➕ הוסף שובר', callback_data: 'add' }],
          [{ text: '🔙 תפריט',     callback_data: 'menu' }],
        ]},
      })
      await answerCb(cbId)
      return
    }

    const total = vouchers.reduce((s, v) => s + v.balance, 0)
    await editMsg(
      chatId, msgId,
      `📋 <b>השוברים שלך (${vouchers.length})</b>\nסה"כ: ₪${total}\n\nבחר שובר:`,
      { reply_markup: voucherListKeyboard(vouchers) }
    )
    await answerCb(cbId)
    return
  }

  // view single voucher
  if (cbData.startsWith('view:')) {
    const voucherId = cbData.slice(5)
    const { data: v } = await sb
      .from('vouchers')
      .select('id, store_name, balance, amount, expiry_date')
      .eq('id', voucherId)
      .eq('wallet_id', walletId)
      .single()

    if (!v) { await answerCb(cbId, '❌ שובר לא נמצא'); return }

    const expiry = v.expiry_date
      ? `\n📅 תוקף: ${new Date(v.expiry_date).toLocaleDateString('he-IL')}`
      : ''
    const pct = v.amount > 0 ? Math.round((v.balance / v.amount) * 100) : 100
    const bar = '█'.repeat(Math.round(pct / 10)) + '░'.repeat(10 - Math.round(pct / 10))

    await editMsg(
      chatId, msgId,
      `🎁 <b>${v.store_name}</b>\n💰 יתרה: ₪${v.balance} / ₪${v.amount}\n${bar} ${pct}%${expiry}`,
      { reply_markup: voucherActionsKeyboard(voucherId) }
    )
    await answerCb(cbId)
    return
  }

  // barcode link (share token → /s/:token)
  if (cbData.startsWith('barcode:')) {
    const voucherId = cbData.slice(8)
    try {
      const token = await makeShareToken(sb, voucherId, userId)
      const url = `${APP_URL}/s/${token}`
      await send(chatId,
        `🔑 <b>קוד + ברקוד</b>\n\n<a href="${url}">לחץ כאן לצפייה בקוד ובברקוד</a>\n\n<i>הלינק תקף ל-24 שעות</i>`,
        { reply_markup: backToVoucherKeyboard(voucherId) }
      )
    } catch {
      await send(chatId, '❌ שגיאה ביצירת לינק. נסה שוב.')
    }
    await answerCb(cbId)
    return
  }

  // update balance — start flow
  if (cbData.startsWith('upd:')) {
    const voucherId = cbData.slice(4)
    const { data: v } = await sb
      .from('vouchers')
      .select('store_name, balance')
      .eq('id', voucherId)
      .single()

    if (!v) { await answerCb(cbId, '❌ שובר לא נמצא'); return }

    await sb.from('telegram_sessions').upsert({
      chat_id: chatId,
      state: 'upd_balance',
      data: { voucher_id: voucherId, current_balance: v.balance },
    })
    await send(chatId,
      `✏️ <b>עדכון יתרה — ${v.store_name}</b>\n\nיתרה נוכחית: ₪${v.balance}\n\nכמה הוצאת? (שלח סכום בשקלים)\nשלח /cancel לביטול`
    )
    await answerCb(cbId)
    return
  }

  // archive
  if (cbData.startsWith('archive:')) {
    const voucherId = cbData.slice(8)
    const [{ data: v }] = await Promise.all([
      sb.from('vouchers').select('store_name').eq('id', voucherId).single(),
      sb.from('vouchers').update({ is_archived: true }).eq('id', voucherId),
    ])
    await editMsg(chatId, msgId,
      `📦 <b>${v?.store_name}</b> הועבר לארכיון.`,
      { reply_markup: { inline_keyboard: [[{ text: '📋 כל השוברים', callback_data: 'vouchers' }]] } }
    )
    await answerCb(cbId, '✅ הועבר לארכיון')
    return
  }

  // add voucher — start flow
  if (cbData === 'add') {
    await sb.from('telegram_sessions').upsert({ chat_id: chatId, state: 'add_store', data: {} })
    await send(chatId, `➕ <b>הוספת שובר חדש</b>\n\n(שלח /cancel לביטול)\n\nמה שם החנות?`)
    await answerCb(cbId)
    return
  }

  // expiring vouchers
  if (cbData === 'expiring') {
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() + 30)
    const { data: vouchers } = await sb
      .from('vouchers')
      .select('id, store_name, balance, expiry_date')
      .eq('wallet_id', walletId)
      .eq('is_archived', false)
      .not('expiry_date', 'is', null)
      .lte('expiry_date', cutoff.toISOString().split('T')[0])
      .gte('expiry_date', new Date().toISOString().split('T')[0])
      .order('expiry_date')

    if (!vouchers?.length) {
      await editMsg(chatId, msgId, '✅ אין שוברים שפגים ב-30 הימים הקרובים!', {
        reply_markup: { inline_keyboard: [[{ text: '🔙 תפריט', callback_data: 'menu' }]] },
      })
      await answerCb(cbId)
      return
    }

    const lines = vouchers.map(v => {
      const days = Math.ceil((new Date(v.expiry_date!).getTime() - Date.now()) / 86400000)
      return `${days <= 7 ? '🔴' : '⚠️'} <b>${v.store_name}</b> — ₪${v.balance} | עוד ${days} ימים`
    }).join('\n')

    await editMsg(chatId, msgId, `⏰ <b>פגים בקרוב (${vouchers.length})</b>\n\n${lines}\n\nבחר שובר:`, {
      reply_markup: {
        inline_keyboard: [
          ...vouchers.map(v => [{ text: `${v.store_name} — ₪${v.balance}`, callback_data: `view:${v.id}` }]),
          [{ text: '🔙 תפריט', callback_data: 'menu' }],
        ],
      },
    })
    await answerCb(cbId)
    return
  }

  // low balance
  if (cbData === 'low') {
    const LOW = 50
    const { data: vouchers } = await sb
      .from('vouchers')
      .select('id, store_name, balance')
      .eq('wallet_id', walletId)
      .eq('is_archived', false)
      .lt('balance', LOW)
      .gt('balance', 0)
      .order('balance')

    if (!vouchers?.length) {
      await editMsg(chatId, msgId, `✅ אין שוברים עם יתרה מתחת ל-₪${LOW}`, {
        reply_markup: { inline_keyboard: [[{ text: '🔙 תפריט', callback_data: 'menu' }]] },
      })
      await answerCb(cbId)
      return
    }

    const lines = vouchers.map(v => `💸 <b>${v.store_name}</b> — ₪${v.balance}`).join('\n')
    await editMsg(chatId, msgId, `📉 <b>יתרה נמוכה (${vouchers.length})</b>\n\n${lines}\n\nבחר שובר:`, {
      reply_markup: {
        inline_keyboard: [
          ...vouchers.map(v => [{ text: `${v.store_name} — ₪${v.balance}`, callback_data: `view:${v.id}` }]),
          [{ text: '🔙 תפריט', callback_data: 'menu' }],
        ],
      },
    })
    await answerCb(cbId)
    return
  }

  await answerCb(cbId)
}

// ── Main entry point ──────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method !== 'POST') return new Response('ok')

  const update = await req.json()
  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

  // ── Callback query (button press) ─────────────────────────────────────────
  if (update.callback_query) {
    const cq = update.callback_query
    const chatId: number = cq.message.chat.id
    const msgId: number  = cq.message.message_id
    const cbData: string = cq.data
    const cbId: string   = cq.id

    const { data: tgUser } = await sb
      .from('telegram_users').select('user_id').eq('chat_id', chatId).single()

    if (!tgUser) { await answerCb(cbId, '❌ חשבון לא מחובר'); return new Response('ok') }

    const walletId = await resolveWallet(sb, tgUser.user_id)
    if (!walletId) { await answerCb(cbId, '❌ לא נמצא ארנק'); return new Response('ok') }

    await handleCallback(sb, chatId, tgUser.user_id, walletId, cbData, cbId, msgId)
    return new Response('ok')
  }

  // ── Text message ──────────────────────────────────────────────────────────
  const message = update.message
  if (!message?.text) return new Response('ok')

  const chatId: number  = message.chat.id
  const text: string    = message.text.trim()
  const username: string = message.from?.username || message.from?.first_name || 'משתמש'

  // /start [code]
  if (text.startsWith('/start')) {
    const code = text.split(' ')[1]
    if (!code) {
      await send(chatId,
        `👋 שלום ${username}!\n\nכדי לקשר את החשבון:\n1. פתח את האפליקציה\n2. הגדרות → טלגרם → לחץ "קשר"\n3. שלח: <code>/start [הקוד]</code>`,
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
      `✅ <b>החשבון קושר בהצלחה!</b>\n\nשלום ${username}! כעת תוכל לנהל את השוברים שלך כאן.`,
      { reply_markup: mainMenu() }
    )
    return new Response('ok')
  }

  // Verify linked account + fetch session in parallel
  const [{ data: tgUser }, { data: session }] = await Promise.all([
    sb.from('telegram_users').select('user_id').eq('chat_id', chatId).single(),
    sb.from('telegram_sessions').select('state, data').eq('chat_id', chatId).single(),
  ])

  if (!tgUser) {
    await send(chatId,
      `👋 שלום!\n\nאתה לא מחובר לחשבון עדיין.\nפתח את האפליקציה → הגדרות → טלגרם.`,
      { reply_markup: { inline_keyboard: [[{ text: '🌐 פתח אפליקציה', url: APP_URL }]] } }
    )
    return new Response('ok')
  }

  const userId = tgUser.user_id
  const walletId = await resolveWallet(sb, userId)

  if (!walletId) {
    await send(chatId, '❌ לא נמצא ארנק. נסה להיכנס לאפליקציה תחילה.',
      { reply_markup: { inline_keyboard: [[{ text: '🌐 פתח אפליקציה', url: APP_URL }]] } }
    )
    return new Response('ok')
  }

  // Active conversation state → continue flow
  if (session?.state) {
    await handleConversation(sb, chatId, userId, walletId, text, session)
    return new Response('ok')
  }

  // Any other message → show main menu
  await send(chatId, '📱 <b>תפריט ראשי</b>\n\nבחר פעולה:', { reply_markup: mainMenu() })
  return new Response('ok')
})
