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

// ── HTML Templates ──────────────────────────────────────────────────────────

function inviteHtml(p: { to_name: string; from_name: string; wallet_name: string; app_url: string }) {
  return `<!DOCTYPE html><html dir="rtl" lang="he"><body style="font-family:Arial,sans-serif;background:#f5f5f5;padding:20px;direction:rtl;text-align:right">
  <div style="max-width:480px;margin:0 auto;background:#fff;border-radius:16px;padding:32px;box-shadow:0 2px 8px rgba(0,0,0,.08);direction:rtl;text-align:right">
    <h2 style="color:#16a34a;margin-top:0;text-align:right">🎁 הוזמנת לארנק שוברים</h2>
    <p style="text-align:right">שלום ${p.to_name},</p>
    <p style="text-align:right"><strong>${p.from_name}</strong> הזמין/ה אותך להצטרף לארנק <strong>"${p.wallet_name}"</strong>.</p>
    <p style="text-align:right">כעת תוכל/י לראות ולנהל שוברים משותפים.</p>
    <div style="text-align:right">
      <a href="${p.app_url}" style="display:inline-block;margin-top:16px;padding:12px 28px;background:#16a34a;color:#fff;border-radius:12px;text-decoration:none;font-weight:bold">
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
    <p style="text-align:right">שלום ${p.to_name},</p>
    <p style="text-align:right"><strong>${p.from_name}</strong> שיתף/ה איתך שובר של <strong>${p.store_name}</strong>.</p>
    <p style="text-align:right">כנס/י לאפליקציה ותמצא/י את השובר בלשונית <strong>"שותף איתי"</strong>.</p>
    <div style="text-align:right">
      <a href="${p.app_url}" style="display:inline-block;margin-top:16px;padding:12px 28px;background:#7c3aed;color:#fff;border-radius:12px;text-decoration:none;font-weight:bold">
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
    <p style="text-align:right"><strong>${p.from_name}</strong> רצה/ה לשתף איתך שובר של <strong>${p.store_name}</strong>.</p>
    <p style="text-align:right">הצטרף/י לאפליקציה — השובר יופיע אוטומטית בלשונית "שותף איתי" לאחר הרישום.</p>
    <div style="text-align:right">
      <a href="${p.app_url}" style="display:inline-block;margin-top:16px;padding:12px 28px;background:#7c3aed;color:#fff;border-radius:12px;text-decoration:none;font-weight:bold">
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
    .map(line => `<li style="margin:6px 0;text-align:right">${line.replace(/^•\s*/, '')}</li>`)
    .join('')

  return `<!DOCTYPE html><html dir="rtl" lang="he"><body style="font-family:Arial,sans-serif;background:#f5f5f5;padding:20px;direction:rtl;text-align:right">
  <div style="max-width:480px;margin:0 auto;background:#fff;border-radius:16px;padding:32px;box-shadow:0 2px 8px rgba(0,0,0,.08);direction:rtl;text-align:right">
    <h2 style="color:#ea580c;margin-top:0;text-align:right">⏰ תזכורת: שוברים עומדים לפוג</h2>
    <p style="text-align:right">שלום ${p.to_name},</p>
    <p style="text-align:right">יש לך <strong>${p.count} שוברים</strong> שעומדים לפוג בקרוב:</p>
    <ul style="background:#fff7ed;border-radius:12px;padding:16px 24px;color:#374151;direction:rtl;text-align:right">${rows}</ul>
    <p style="color:#6b7280;font-size:14px;text-align:right">מהר לפני שיפוג התוקף!</p>
    <div style="text-align:right">
      <a href="${p.app_url}" style="display:inline-block;margin-top:16px;padding:12px 28px;background:#ea580c;color:#fff;border-radius:12px;text-decoration:none;font-weight:bold">
        פתח ארנק שוברים
      </a>
    </div>
  </div>
</body></html>`
}

// ── Main ─────────────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    // Verify JWT — only logged-in users can send emails
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return json({ error: 'Unauthorized' }, 401)

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    )
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return json({ error: 'Unauthorized' }, 401)

    const { type, params } = await req.json()
    // Prefer app_url from request params (set by frontend), fall back to env / giftsmart.site
    const appUrl: string = params?.app_url || Deno.env.get('APP_URL') || 'https://giftsmart.site'

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
        subject: `${from_name} הזמין/ה אותך לארנק: ${wallet_name}`,
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
        subject: `${from_name} שיתף/ה איתך שובר: ${store_name}`,
        html: shareHtml({ to_name, from_name, store_name, app_url: appUrl }),
      })
    } else if (type === 'share_invite') {
      const { to_email, from_name, store_name } = params
      await transporter.sendMail({
        from,
        to: to_email,
        subject: `${from_name} הזמין/ה אותך לשתף שובר: ${store_name}`,
        html: shareInviteHtml({ from_name, store_name, app_url: appUrl }),
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
