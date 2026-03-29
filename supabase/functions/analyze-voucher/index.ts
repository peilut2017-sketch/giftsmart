// Supabase Edge Function — analyze-voucher
// Uses GEMINI_API_KEY from Supabase Secrets (never exposed to the browser).
//
// Set the secret:
//   supabase secrets set GEMINI_API_KEY=AIza...
//
// Request body (JSON):
//   { image_base64: string, mime_type?: string }   → image analysis
//   { text: string }                               → SMS / free-text analysis
//
// Response:
//   { store_name, code, cvv, amount, balance, expiry_date } | { error: string }

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const EXTRACTION_SCHEMA = `
Return ONLY a valid JSON object — no markdown, no explanation, no surrounding text.
Fields:
{
  "store_name": string | null,
  "code": string | null,
  "cvv": string | null,
  "amount": number | null,
  "balance": number | null,
  "expiry_date": string | null
}

Rules:
- store_name: official brand name, prefer Hebrew for Israeli brands
- code: main voucher / gift-card code — keep hyphens, strip spaces
- cvv: security code / PIN (3–4 digits), or null
- amount: face value as a plain number in ILS, or null
- balance: remaining balance if shown separately, otherwise null
- expiry_date: always YYYY-MM-DD. "12/26" → "2026-12-31". "31/12/2026" → "2026-12-31"
- Israeli super-vouchers: use exact name — BuyMe | תו הזהב | תו פלוס | נופשונית | Fun Online | גיפט קארד ישראל
- Missing/unclear fields → null (never empty string)
`

const IMAGE_PROMPT =
  'You are an expert at reading Israeli gift cards, vouchers, and store credit. ' +
  'Analyze this image carefully and extract all voucher details.\n' +
  EXTRACTION_SCHEMA

const TEXT_PROMPT =
  'You are an expert at parsing Israeli SMS messages, emails, and receipts about gift cards and vouchers. ' +
  'Extract all voucher details from the following text.\n' +
  EXTRACTION_SCHEMA +
  '\n\nText:\n'

// ── JSON helpers ──────────────────────────────────────────────────────────────

function extractJson(raw: string): Record<string, unknown> {
  const cleaned = raw.replace(/^```(?:json)?\s*/m, '').replace(/\s*```$/m, '').trim()
  try {
    return JSON.parse(cleaned)
  } catch {
    const m = cleaned.match(/\{[\s\S]*\}/)
    if (m) return JSON.parse(m[0])
    throw new Error(`Non-JSON response from Gemini: ${cleaned.slice(0, 200)}`)
  }
}

function normaliseDate(d: string | null | undefined): string | null {
  if (!d) return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return d
  const ts = Date.parse(d)
  return isNaN(ts) ? null : new Date(ts).toISOString().split('T')[0]
}

// ── Main handler ──────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS })
  }

  // Always return HTTP 200 — errors go in the `error` field so supabase.functions.invoke
  // puts the body in `data` instead of creating a FunctionsHttpError that swallows messages.
  const ok = (payload: Record<string, unknown>) =>
    new Response(JSON.stringify(payload), {
      status: 200, headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  const fail = (msg: string) => ok({ error: msg })

  const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY')
  if (!GEMINI_API_KEY) {
    return fail('GEMINI_API_KEY secret is not configured in Supabase — set it via: supabase secrets set GEMINI_API_KEY=AIza...')
  }

  let body: { image_base64?: string; mime_type?: string; text?: string }
  try {
    body = await req.json()
  } catch {
    return fail('Invalid JSON body')
  }

  // Build Gemini request parts
  let parts: unknown[]
  if (body.image_base64) {
    parts = [
      { text: IMAGE_PROMPT },
      { inlineData: { mimeType: body.mime_type || 'image/jpeg', data: body.image_base64 } },
    ]
  } else if (body.text) {
    parts = [{ text: TEXT_PROMPT + body.text }]
  } else {
    return fail('Provide image_base64 or text')
  }

  // Call Gemini REST API
  let geminiRes: Response
  let geminiData: unknown
  try {
    geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts }] }),
      },
    )
    geminiData = await geminiRes.json()
  } catch (e) {
    return fail(`Network error calling Gemini: ${String(e)}`)
  }

  if (!geminiRes.ok) {
    const msg = (geminiData as { error?: { message?: string } })?.error?.message || `Gemini returned HTTP ${geminiRes.status}`
    return fail(msg)
  }

  const rawText: string =
    (geminiData as { candidates?: { content?: { parts?: { text?: string }[] } }[] })
      ?.candidates?.[0]?.content?.parts?.[0]?.text ?? ''

  let extracted: Record<string, unknown>
  try {
    extracted = extractJson(rawText)
  } catch (e) {
    return fail(`Could not parse Gemini response: ${String(e)}`)
  }

  // Normalise and return
  return ok({
    error: null,
    store_name:  (extracted.store_name  as string  | null) || null,
    code:        (extracted.code        as string  | null) || null,
    cvv:         (extracted.cvv         as string  | null) || null,
    amount:      typeof extracted.amount  === 'number' && extracted.amount  > 0 ? extracted.amount  : null,
    balance:     typeof extracted.balance === 'number' && extracted.balance > 0 ? extracted.balance : null,
    expiry_date: normaliseDate(extracted.expiry_date as string | null),
  })
})
