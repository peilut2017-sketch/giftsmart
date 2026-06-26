import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'npm:@supabase/supabase-js@2'
import nodemailer from 'npm:nodemailer@6'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Called by Supabase cron (pg_cron or scheduled Edge Function trigger).
// Finds voucher_gifts where send_at <= NOW() AND email_sent_at IS NULL
// and sends the gift email, then marks email_sent_at.
//
// Set up in Supabase Dashboard → Database → Cron jobs:
//   schedule: 0 * * * *   (every hour)
//   command:  SELECT net.http_post(
//               url := 'https://<project>.supabase.co/functions/v1/check-pending-gifts',
//               headers := '{"Authorization":"Bearer <SERVICE_ROLE_KEY>"}',
//               body := '{}'
//             );

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  // Auth: service-role key only
  const authHeader = req.headers.get('Authorization') || ''
  const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_KEY') || ''
  if (!SERVICE_KEY || authHeader !== `Bearer ${SERVICE_KEY}`) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: CORS })
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_KEY')!
  )

  const { data: gifts, error } = await supabase
    .from('voucher_gifts')
    .select('*, vouchers(store_name, balance)')
    .lte('send_at', new Date().toISOString())
    .is('email_sent_at', null)
    .is('claimed_at', null)

  if (error) {
    console.error('check-pending-gifts query error:', error)
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: CORS })
  }

  if (!gifts?.length) {
    return new Response(JSON.stringify({ sent: 0 }), { status: 200, headers: CORS })
  }

  const appUrl = Deno.env.get('APP_URL') || 'https://gifttest.vercel.app'

  // Try SES first; if it fails (e.g. still in sandbox) fall back to Gmail
  async function sendMail(mailOptions: Record<string, unknown>) {
    const sesUser = Deno.env.get('SES_SMTP_USER')
    const sesPass = Deno.env.get('SES_SMTP_PASS')
    if (sesUser && sesPass) {
      try {
        const ses = nodemailer.createTransport({
          host: Deno.env.get('SES_SMTP_HOST') ?? 'email-smtp.us-east-1.amazonaws.com',
          port: Number(Deno.env.get('SES_SMTP_PORT') ?? 587),
          secure: false,
          auth: { user: sesUser, pass: sesPass },
        })
        await ses.sendMail({
          ...mailOptions,
          from: `"ארנק שוברים" <${Deno.env.get('SES_FROM_EMAIL') ?? sesUser}>`,
        })
        return
      } catch (sesErr) {
        console.warn('SES failed, falling back to Gmail:', sesErr)
      }
    }
    // Gmail fallback
    const gmail = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: Deno.env.get('GMAIL_USER')!,
        pass: Deno.env.get('GMAIL_APP_PASSWORD')!,
      },
    })
    await gmail.sendMail({
      ...mailOptions,
      from: `"ארנק שוברים" <${Deno.env.get('GMAIL_USER')}>`,
    })
  }

  let sent = 0
  for (const gift of gifts) {
    const storeName = (gift.vouchers as { store_name: string; balance: number } | null)?.store_name ?? 'שובר'
    const balance   = (gift.vouchers as { store_name: string; balance: number } | null)?.balance ?? 0
    const giftLink  = `${appUrl}/gift/${gift.token}`
    const senderName = gift.sender_name || 'מישהו'

    const msgBlock = gift.message
      ? `<div style="background:#f0fdf4;border:1px solid #86efac;border-radius:12px;padding:14px 18px;margin:16px 0;direction:rtl;text-align:right">
           <p style="color:#166534;font-style:italic;margin:0">"${gift.message}"</p>
         </div>`
      : ''

    const html = `<!DOCTYPE html><html dir="rtl" lang="he"><body style="font-family:Arial,sans-serif;background:#f5f5f5;padding:20px;direction:rtl;text-align:right">
  <div style="max-width:480px;margin:0 auto;background:#fff;border-radius:16px;padding:32px;box-shadow:0 2px 8px rgba(0,0,0,.08);direction:rtl;text-align:right">
    <h2 style="color:#16a34a;margin-top:0;text-align:right">🎁 קיבלת מתנה!</h2>
    <p style="text-align:right"><strong>${senderName}</strong> שלח/ה לך שובר מתנה של <strong>${storeName}</strong>.</p>
    <div style="background:#f0fdf4;border:2px solid #86efac;border-radius:14px;padding:20px;margin:16px 0;text-align:center">
      <p style="font-size:32px;font-weight:bold;color:#15803d;margin:0">₪${balance}</p>
      <p style="color:#166534;margin:6px 0 0;font-size:14px">${storeName}</p>
    </div>
    ${msgBlock}
    <div style="text-align:center;margin-top:24px">
      <a href="${giftLink}" style="display:inline-block;padding:14px 36px;background:#16a34a;color:#fff;border-radius:12px;text-decoration:none;font-weight:bold;font-size:16px">
        קבל/י את המתנה
      </a>
    </div>
    <p style="color:#9ca3af;font-size:12px;text-align:center;margin-top:20px">
      נשלח דרך <a href="${appUrl}" style="color:#16a34a;text-decoration:none">GiftSmart</a>
    </p>
  </div>
</body></html>`

    try {
      await sendMail({
        to: gift.recipient_email,
        subject: `🎁 ${senderName} שלח/ה לך מתנה: ${storeName}`,
        html,
      })
      await supabase
        .from('voucher_gifts')
        .update({ email_sent_at: new Date().toISOString() })
        .eq('id', gift.id)
      sent++
    } catch (err) {
      console.error(`Failed to send gift email for gift ${gift.id}:`, err)
    }
  }

  return new Response(JSON.stringify({ sent }), { status: 200, headers: CORS })
})
