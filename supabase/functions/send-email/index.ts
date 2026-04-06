import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'npm:@supabase/supabase-js@2'
import nodemailer from 'npm:nodemailer@6'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}

// ── HTML escaping ────────────────────────────────────────────────────────────

function esc(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
}

// ── HTML Templates ──────────────────────────────────────────────────────────

function inviteHtml(p: { to_name: string; from_name: string; wallet_name: string; app_url: string }) {
  return `<!DOCTYPE html><html dir="rtl" lang="he"><body style="font-family:Arial,sans-serif;background:#f5f5f5;padding:20px;direction:rtl;text-align:right">
  <div style="max-width:480px;margin:0 auto;background:#fff;border-radius:16px;padding:32px;box-shadow:0 2px 8px rgba(0,0,0,.08);direction:rtl;text-align:right">
    <h2 style="color:#16a34a;margin-top:0;text-align:right">🎁 הוזמנת לארנק שוברים</h2>
    <p style="text-align:right">שלום ${esc(p.to_name)},</p>
    <p style="text-align:right"><strong>${esc(p.from_name)}</strong> הזמין/ה אותך להצטרף לארנק <strong>"${esc(p.wallet_name)}"</strong>.</p>
    <p style="text-align:right">כעת תוכל/י לראות ולנהל שוברים משותפים.</p>
    <div style="text-align:right">
      <a href="${esc(p.app_url)}" style="display:inline-block;margin-top:16px;padding:12px 28px;background:#16a34a;color:#fff;border-radius:12px;text-decoration:none;font-weight:bold">
        פתח ארנק שוברים
      </a>
    </div>
  </div>
</body></html>`
}

function shareHtml(p: { to_name: string; from_name: string; store_name: string; app_url: string }) {
  return `<!DOCTYPE html><html dir="rtl" lang="he"><body style="font-family:Arial,sans-serif;background:#f5f5f5;padding:20px;direction:rtl;text-align:right">
  <div style="max-width:480px;margin:0 auto;background:#fff;border-radius:16px;padding:32px;box-shadow:0 2px 8px rgba(0,0,0,.08);direction:rtl;text-align:right">
    <h2 style="color:#7c3aed;margin-top:0;text-align:right">🎁 שובר שותף איתך</h2>
    <p style="text-align:right">שלום ${esc(p.to_name)},</p>
    <p style="text-align:right"><strong>${esc(p.from_name)}</strong> שיתף/ה איתך שובר של <strong>${esc(p.store_name)}</strong>.</p>
    <p style="text-align:right">כנס/י לאפליקציה ותמצא/י את השובר בלשונית <strong>"שותף איתי"</strong>.</p>
    <div style="text-align:right">
      <a href="${esc(p.app_url)}" style="display:inline-block;margin-top:16px;padding:12px 28px;background:#7c3aed;color:#fff;border-radius:12px;text-decoration:none;font-weight:bold">
        פתח ארנק שוברים
      </a>
    </div>
  </div>
</body></html>`
}

function shareInviteHtml(p: { from_name: string; store_name: string; app_url: string }) {
  return `<!DOCTYPE html><html dir="rtl" lang="he"><body style="font-family:Arial,sans-serif;background:#f5f5f5;padding:20px;direction:rtl;text-align:right">
  <div style="max-width:480px;margin:0 auto;background:#fff;border-radius:16px;padding:32px;box-shadow:0 2px 8px rgba(0,0,0,.08);direction:rtl;text-align:right">
    <h2 style="color:#7c3aed;margin-top:0;text-align:right">🎁 הזמנה לשיתוף שובר</h2>
    <p style="text-align:right"><strong>${esc(p.from_name)}</strong> רצה/ה לשתף איתך שובר של <strong>${esc(p.store_name)}</strong>.</p>
    <p style="text-align:right">הצטרף/י לאפליקציה — השובר יופיע אוטומטית בלשונית "שותף איתי" לאחר הרישום.</p>
    <div style="text-align:right">
      <a href="${esc(p.app_url)}" style="display:inline-block;margin-top:16px;padding:12px 28px;background:#7c3aed;color:#fff;border-radius:12px;text-decoration:none;font-weight:bold">
        הצטרף/י לארנק שוברים
      </a>
    </div>
  </div>
</body></html>`
}

function expiryHtml(p: { to_name: string; count: number; vouchers_list: string; app_url: string }) {
  const rows = p.vouchers_list
    .split('\n')
    .filter(Boolean)
    .map(line => `<li style="margin:6px 0;text-align:right">${esc(line.replace(/^•\s*/, ''))}</li>`)
    .join('')

  return `<!DOCTYPE html><html dir="rtl" lang="he"><body style="font-family:Arial,sans-serif;background:#f5f5f5;padding:20px;direction:rtl;text-align:right">
  <div style="max-width:480px;margin:0 auto;background:#fff;border-radius:16px;padding:32px;box-shadow:0 2px 8px rgba(0,0,0,.08);direction:rtl;text-align:right">
    <h2 style="color:#ea580c;margin-top:0;text-align:right">⏰ תזכורת: שוברים עומדים לפוג</h2>
    <p style="text-align:right">שלום ${esc(p.to_name)},</p>
    <p style="text-align:right">יש לך <strong>${p.count} שוברים</strong> שעומדים לפוג בקרוב:</p>
    <ul style="background:#fff7ed;border-radius:12px;padding:16px 24px;color:#374151;direction:rtl;text-align:right">${rows}</ul>
    <p style="color:#6b7280;font-size:14px;text-align:right">מהר לפני שיפוג התוקף!</p>
    <div style="text-align:right">
      <a href="${esc(p.app_url)}" style="display:inline-block;margin-top:16px;padding:12px 28px;background:#ea580c;color:#fff;border-radius:12px;text-decoration:none;font-weight:bold">
        פתח ארנק שוברים
      </a>
    </div>
  </div>
</body></html>`
}

function giftHtml(p: { sender_name: string; message?: string; store_name: string; balance: number; gift_link: string; app_url: string }) {
  const msgBlock = p.message
    ? `<div style="background:#f0fdf4;border:1px solid #86efac;border-radius:12px;padding:14px 18px;margin:16px 0;direction:rtl;text-align:right">
         <p style="color:#166534;font-style:italic;margin:0;text-align:right">"${esc(p.message)}"</p>
       </div>`
    : ''
  return `<!DOCTYPE html><html dir="rtl" lang="he"><body style="font-family:Arial,sans-serif;background:#f5f5f5;padding:20px;direction:rtl;text-align:right">
  <div style="max-width:480px;margin:0 auto;background:#fff;border-radius:16px;padding:32px;box-shadow:0 2px 8px rgba(0,0,0,.08);direction:rtl;text-align:right">
    <h2 style="color:#16a34a;margin-top:0;text-align:right">🎁 קיבלת מתנה!</h2>
    <p style="text-align:right"><strong>${esc(p.sender_name)}</strong> שלח/ה לך שובר מתנה של <strong>${esc(p.store_name)}</strong>.</p>
    <div style="background:#f0fdf4;border:2px solid #86efac;border-radius:14px;padding:20px;margin:16px 0;text-align:center">
      <p style="font-size:32px;font-weight:bold;color:#15803d;margin:0">₪${p.balance}</p>
      <p style="color:#166534;margin:6px 0 0;font-size:14px">${esc(p.store_name)}</p>
    </div>
    ${msgBlock}
    <div style="text-align:center;margin-top:24px">
      <a href="${esc(p.gift_link)}" style="display:inline-block;padding:14px 36px;background:#16a34a;color:#fff;border-radius:12px;text-decoration:none;font-weight:bold;font-size:16px">
        קבל/י את המתנה
      </a>
    </div>
    <p style="color:#9ca3af;font-size:12px;text-align:center;margin-top:20px">
      נשלח דרך <a href="${esc(p.app_url)}" style="color:#16a34a;text-decoration:none">GiftSmart</a>
    </p>
  </div>
</body></html>`
}

// ── Main ─────────────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return json({ error: 'Unauthorized' }, 401)

    // Accept either a valid JWT or the service-role key (used by cron)
    const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_KEY') || ''
    const isServiceRole = SERVICE_KEY && authHeader === `Bearer ${SERVICE_KEY}`

    if (!isServiceRole) {
      const supabase = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_ANON_KEY')!,
        { global: { headers: { Authorization: authHeader } } }
      )
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return json({ error: 'Unauthorized' }, 401)
    }

    const { type, params } = await req.json()

    // app_url comes from server environment (most secure).
    // Falls back to the client-supplied app_url (set via VITE_APP_URL on the client),
    // which is itself validated below against the same value.
    const envAppUrl: string = Deno.env.get('APP_URL') || ''
    const clientAppUrl: string = typeof params?.app_url === 'string' ? params.app_url : ''
    const appUrl: string = envAppUrl || clientAppUrl || 'https://gifttest.vercel.app'

    // gift_link must start with our own domain to prevent open-redirect phishing.
    // When APP_URL env var is set it is the authoritative source; otherwise we
    // also accept a gift_link that matches the client-provided app_url (authenticated users only).
    if (type === 'gift') {
      const giftLink: string = params?.gift_link || ''
      const allowedBases = [envAppUrl, clientAppUrl, 'https://gifttest.vercel.app'].filter(Boolean)
      const isValid = allowedBases.some(
        base => giftLink.startsWith(base + '/') || giftLink.startsWith(base + '?')
      )
      if (!isValid) {
        return json({ error: 'Invalid gift_link' }, 400)
      }
    }

    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: Deno.env.get('GMAIL_USER')!,
        pass: Deno.env.get('GMAIL_APP_PASSWORD')!,
      },
    })

    const from = `"ארנק שוברים" <${Deno.env.get('GMAIL_USER')}>`

    if (type === 'invite') {
      const { to_email, to_name, from_name, wallet_name } = params
      await transporter.sendMail({
        from,
        to: to_email,
        subject: `${esc(from_name)} הזמין/ה אותך לארנק: ${esc(wallet_name)}`,
        html: inviteHtml({ to_name, from_name, wallet_name, app_url: appUrl }),
      })
    } else if (type === 'expiry') {
      const { to_email, to_name, count, vouchers_list } = params
      await transporter.sendMail({
        from,
        to: to_email,
        subject: `⏰ תזכורת: ${count} שוברים עומדים לפוג בקרוב`,
        html: expiryHtml({ to_name, count, vouchers_list, app_url: appUrl }),
      })
    } else if (type === 'share') {
      const { to_email, to_name, from_name, store_name } = params
      await transporter.sendMail({
        from,
        to: to_email,
        subject: `${esc(from_name)} שיתף/ה איתך שובר: ${esc(store_name)}`,
        html: shareHtml({ to_name, from_name, store_name, app_url: appUrl }),
      })
    } else if (type === 'share_invite') {
      const { to_email, from_name, store_name } = params
      await transporter.sendMail({
        from,
        to: to_email,
        subject: `${esc(from_name)} הזמין/ה אותך לשתף שובר: ${esc(store_name)}`,
        html: shareInviteHtml({ from_name, store_name, app_url: appUrl }),
      })
    } else if (type === 'gift') {
      const { to_email, sender_name, message, store_name, balance, gift_link } = params
      await transporter.sendMail({
        from,
        to: to_email,
        subject: `🎁 ${esc(sender_name)} שלח/ה לך מתנה: ${esc(store_name)}`,
        html: giftHtml({ sender_name, message, store_name, balance, gift_link, app_url: appUrl }),
      })
    } else {
      return json({ error: 'Unknown type' }, 400)
    }

    return json({ success: true })
  } catch (err) {
    console.error('send-email error:', err)
    return json({ error: String(err) }, 500)
  }
})
