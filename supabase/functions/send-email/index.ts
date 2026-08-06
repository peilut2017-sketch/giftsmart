import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'npm:@supabase/supabase-js@2'
import nodemailer from 'npm:nodemailer@6'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const BRAND = 'GiftSmart'
const DEFAULT_APP_URL = 'https://giftsmart.site'
// Per-user hourly cap for JWT-authenticated senders (service role is uncapped).
const HOURLY_LIMIT = 20

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}

// ── HTML escaping ────────────────────────────────────────────────────────────

function esc(str: string): string {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
}

// Subjects are plain text, not HTML — never HTML-escape them (recipients used
// to see literal &amp; / &#x27; in subject lines). Just strip header-breaking
// newlines and cap the length.
function subj(str: string): string {
  return String(str).replace(/[\r\n]+/g, ' ').slice(0, 180)
}

// ── HTML Templates (Hebrew, RTL) ─────────────────────────────────────────────

function inviteHtml(p: { to_name: string; from_name: string; wallet_name: string; app_url: string }) {
  return `<!DOCTYPE html><html dir="rtl" lang="he"><body style="font-family:Arial,sans-serif;background:#f5f5f5;padding:20px;direction:rtl;text-align:right">
  <div style="max-width:480px;margin:0 auto;background:#fff;border-radius:16px;padding:32px;box-shadow:0 2px 8px rgba(0,0,0,.08);direction:rtl;text-align:right">
    <h2 style="color:#16a34a;margin-top:0;text-align:right">🎁 הוזמנת לארנק שוברים</h2>
    <p style="text-align:right">שלום ${esc(p.to_name)},</p>
    <p style="text-align:right"><strong>${esc(p.from_name)}</strong> הזמין/ה אותך להצטרף לארנק <strong>"${esc(p.wallet_name)}"</strong>.</p>
    <p style="text-align:right">כעת תוכל/י לראות ולנהל שוברים משותפים.</p>
    <div style="text-align:right">
      <a href="${esc(p.app_url)}" style="display:inline-block;margin-top:16px;padding:12px 28px;background:#16a34a;color:#fff;border-radius:12px;text-decoration:none;font-weight:bold">
        פתח את ${BRAND}
      </a>
    </div>
  </div>
</body></html>`
}

function welcomeHtml(p: { to_name: string; app_url: string }) {
  return `<!DOCTYPE html><html dir="rtl" lang="he"><body style="font-family:Arial,sans-serif;background:#f5f5f5;padding:20px;direction:rtl;text-align:right">
  <div style="max-width:480px;margin:0 auto;background:#fff;border-radius:16px;padding:32px;box-shadow:0 2px 8px rgba(0,0,0,.08);direction:rtl;text-align:right">
    <h2 style="color:#16a34a;margin-top:0;text-align:right">👋 ברוכים הבאים ל-${BRAND}!</h2>
    <p style="text-align:right">שלום ${esc(p.to_name)},</p>
    <p style="text-align:right">שמחים שהצטרפת! הנה מה שאפשר לעשות עכשיו:</p>
    <ul style="background:#f0fdf4;border-radius:12px;padding:16px 24px;color:#374151;direction:rtl;text-align:right;line-height:1.9">
      <li>💳 <strong>הוסיפו שובר ראשון</strong> — סרקו ברקוד או הקלידו ידנית</li>
      <li>🔐 <strong>הפעילו הצפנה</strong> — קודי השוברים נשמרים מוצפנים בכספת</li>
      <li>👨‍👩‍👧 <strong>שתפו עם המשפחה</strong> — יתרות מתעדכנות אצל כולם</li>
      <li>⏰ <strong>קבלו תזכורות</strong> — לפני שהתוקף פג</li>
    </ul>
    <div style="text-align:right">
      <a href="${esc(p.app_url)}" style="display:inline-block;margin-top:16px;padding:12px 28px;background:#16a34a;color:#fff;border-radius:12px;text-decoration:none;font-weight:bold">
        להתחלה — פתחו את ${BRAND}
      </a>
    </div>
    <p style="color:#9ca3af;font-size:12px;text-align:right;margin-top:20px">
      יש שאלה? כתבו לנו דרך <a href="${esc(p.app_url)}/settings/about" style="color:#16a34a">צור קשר</a> באפליקציה.
    </p>
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
        פתח את ${BRAND}
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
        הצטרף/י ל-${BRAND}
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
        פתח את ${BRAND}
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
      <p style="font-size:32px;font-weight:bold;color:#15803d;margin:0">₪${Number(p.balance) || 0}</p>
      <p style="color:#166534;margin:6px 0 0;font-size:14px">${esc(p.store_name)}</p>
    </div>
    ${msgBlock}
    <div style="text-align:center;margin-top:24px">
      <a href="${esc(p.gift_link)}" style="display:inline-block;padding:14px 36px;background:#16a34a;color:#fff;border-radius:12px;text-decoration:none;font-weight:bold;font-size:16px">
        קבל/י את המתנה
      </a>
    </div>
    <p style="color:#9ca3af;font-size:12px;text-align:center;margin-top:20px">
      נשלח דרך <a href="${esc(p.app_url)}" style="color:#16a34a;text-decoration:none">${BRAND}</a>
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
    const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SERVICE_KEY') || ''
    const isServiceRole = SERVICE_KEY && authHeader === `Bearer ${SERVICE_KEY}`

    let callerId: string | null = null
    if (!isServiceRole) {
      const supabase = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_ANON_KEY')!,
        { global: { headers: { Authorization: authHeader } } }
      )
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return json({ error: 'Unauthorized' }, 401)
      callerId = user.id
    }

    const { type, params } = await req.json()

    // The app URL comes from the server environment ONLY. A client-supplied
    // app_url used to be accepted into the gift-link allowlist, which turned the
    // "must point at our own domain" check into a no-op (open phishing relay).
    const appUrl: string = Deno.env.get('APP_URL') || DEFAULT_APP_URL

    // gift_link must start with our own domain to prevent open-redirect phishing.
    if (type === 'gift') {
      const giftLink: string = params?.gift_link || ''
      const allowedBases = [appUrl, DEFAULT_APP_URL]
      const isValid = allowedBases.some(
        base => giftLink.startsWith(base + '/') || giftLink.startsWith(base + '?')
      )
      if (!isValid) {
        return json({ error: 'Invalid gift_link' }, 400)
      }
    }

    // Per-user rate limit (JWT senders only). Fails open if the log table is
    // missing so a skipped migration never blocks real email.
    if (callerId && SERVICE_KEY) {
      try {
        const admin = createClient(Deno.env.get('SUPABASE_URL')!, SERVICE_KEY)
        const oneHourAgo = new Date(Date.now() - 3600_000).toISOString()
        const { count, error } = await admin
          .from('email_send_log')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', callerId)
          .gte('created_at', oneHourAgo)
        if (!error && (count ?? 0) >= HOURLY_LIMIT) {
          return json({ error: 'rate_limited' }, 429)
        }
        await admin.from('email_send_log').insert({
          user_id: callerId,
          email_type: String(type ?? ''),
          recipient: String(params?.to_email ?? ''),
        })
      } catch (rlErr) {
        console.warn('rate-limit check skipped:', rlErr)
      }
    }

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
            from: `"${BRAND}" <${Deno.env.get('SES_FROM_EMAIL') ?? sesUser}>`,
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
        from: `"${BRAND}" <${Deno.env.get('GMAIL_USER')}>`,
      })
    }

    if (type === 'invite') {
      const { to_email, to_name, from_name, wallet_name } = params
      await sendMail({
        to: to_email,
        subject: subj(`${from_name} הזמין/ה אותך לארנק: ${wallet_name}`),
        html: inviteHtml({ to_name, from_name, wallet_name, app_url: appUrl }),
      })
    } else if (type === 'welcome') {
      const { to_email, to_name } = params
      await sendMail({
        to: to_email,
        subject: subj(`👋 ברוכים הבאים ל-${BRAND}!`),
        html: welcomeHtml({ to_name, app_url: appUrl }),
      })
    } else if (type === 'expiry') {
      const { to_email, to_name, count, vouchers_list } = params
      await sendMail({
        to: to_email,
        subject: subj(`⏰ תזכורת: ${count} שוברים עומדים לפוג בקרוב`),
        html: expiryHtml({ to_name, count, vouchers_list, app_url: appUrl }),
      })
    } else if (type === 'share') {
      const { to_email, to_name, from_name, store_name } = params
      await sendMail({
        to: to_email,
        subject: subj(`${from_name} שיתף/ה איתך שובר: ${store_name}`),
        html: shareHtml({ to_name, from_name, store_name, app_url: appUrl }),
      })
    } else if (type === 'share_invite') {
      const { to_email, from_name, store_name } = params
      await sendMail({
        to: to_email,
        subject: subj(`${from_name} הזמין/ה אותך לשתף שובר: ${store_name}`),
        html: shareInviteHtml({ from_name, store_name, app_url: appUrl }),
      })
    } else if (type === 'gift') {
      const { to_email, sender_name, message, store_name, balance, gift_link } = params
      await sendMail({
        to: to_email,
        subject: subj(`🎁 ${sender_name} שלח/ה לך מתנה: ${store_name}`),
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
