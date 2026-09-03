import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0'

// ─── CORS — allow Vercel frontend ────────────────────────────────────────────
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

// Max AI scans per user per rolling hour (cost protection — see rate limit below)
const HOURLY_SCAN_LIMIT = 30

// ─── Category IDs used in the app ────────────────────────────────────────────
const VALID_CATEGORIES = new Set([
  'fashion', 'food', 'electronics', 'beauty', 'home',
  'sport', 'travel', 'entertainment', 'kids', 'health',
  'books', 'restaurant', 'supermarket', 'gift', 'other',
])

// ─── Prompt sent to Gemini ────────────────────────────────────────────────────
const PROMPT = `You are an expert OCR system specializing in Israeli gift cards, vouchers, and store credits.
Analyze the provided content and extract voucher details.

You MUST return ONLY a valid JSON object. No markdown. No backticks. No explanation. Just the JSON.

JSON format:
{
  "store_name": string or null,
  "code": string or null,
  "cvv": string or null,
  "amount": number or null,
  "currency": string or null,
  "balance": number or null,
  "expiry_date": string or null,
  "categories": array of strings or null,
  "link": string or null,
  "candidates": object or null
}

Rules:
- store_name: the issuing brand or store. Hebrew preferred for Israeli brands.
  Super-vouchers use EXACT names: BuyMe | תו הזהב | תו פלוס | נופשונית | Fun Online | גיפט קארד ישראל
- code: the main redemption code, 4-20 alphanumeric chars, keep hyphens, no spaces.
  Exclude phone numbers, dates, prices.
- cvv: only if explicitly labeled as CVV/PIN/קוד אבטחה, 3-4 digits.
- amount: face value as a plain number. currency = ILS for ₪/שח/שקל/NIS, USD for $, EUR for €.
- expiry_date: always YYYY-MM-DD. "12/26"→"2026-12-31". "31/12/2026"→"2026-12-31".
  Multiple dates: prefer one labeled תוקף/expires/valid until; otherwise take the LAST date.
- categories: 1-3 IDs from: fashion, food, electronics, beauty, home, sport, travel,
  entertainment, kids, health, books, restaurant, supermarket, gift, other
- link: first URL that is NOT unsubscribe/opt-out/remove/הסרה. null if none.
- candidates: if 2+ plausible values exist for any field, list them here.
  Example: { "code": ["ABC123", "DEF456"], "expiry_date": ["2026-06-01", "2026-12-31"] }
- Unknown/unclear fields → null. Never use empty string or empty array.`

// ─── Helpers ──────────────────────────────────────────────────────────────────

function jsonResponse(payload: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  })
}

function errorResponse(message: string): Response {
  // Always 200 so supabase-js puts body in `data` (not a FunctionsHttpError)
  return jsonResponse({ error: message })
}

function parseGeminiJson(raw: string): Record<string, unknown> {
  // Strip markdown fences if Gemini adds them despite instructions
  const cleaned = raw
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim()
  try {
    return JSON.parse(cleaned)
  } catch {
    // Try to extract the first {...} block
    const match = cleaned.match(/\{[\s\S]*\}/)
    if (match) return JSON.parse(match[0])
    throw new Error(`Gemini returned non-JSON: ${cleaned.slice(0, 300)}`)
  }
}

function toISODate(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw) return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw
  const ms = Date.parse(raw)
  return Number.isNaN(ms) ? null : new Date(ms).toISOString().slice(0, 10)
}

function filterCategories(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return (raw as unknown[]).filter(
    (c): c is string => typeof c === 'string' && VALID_CATEGORIES.has(c),
  )
}

// ─── JWT verification ─────────────────────────────────────────────────────────
async function requireAuth(req: Request): Promise<string | null> {
  const authHeader = req.headers.get('Authorization') ?? ''
  if (!authHeader.startsWith('Bearer ')) return null
  const token = authHeader.slice(7)

  const supabaseUrl  = Deno.env.get('SUPABASE_URL')
  const supabaseAnon = Deno.env.get('SUPABASE_ANON_KEY')
  if (!supabaseUrl || !supabaseAnon) return null

  const client = createClient(supabaseUrl, supabaseAnon)
  const { data, error } = await client.auth.getUser(token)
  if (error || !data.user) return null
  return data.user.id
}

// ─── Main handler ─────────────────────────────────────────────────────────────
Deno.serve(async (req: Request): Promise<Response> => {
  // Handle CORS pre-flight
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS })
  }

  if (req.method !== 'POST') {
    return errorResponse('Method not allowed — use POST')
  }

  // Auth check
  const userId = await requireAuth(req)
  if (!userId) {
    return errorResponse('Unauthorized — sign in first')
  }

  // Per-user rate limit. Every call here costs real money (a Gemini request),
  // and any signed-in account — guests included — could loop this endpoint and
  // run up the bill. Mirrors send-email's email_send_log pattern; fails OPEN if
  // the ocr_scan_log migration hasn't been applied so a missed migration never
  // breaks scanning.
  const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
  if (SERVICE_KEY && SUPABASE_URL) {
    try {
      const admin = createClient(SUPABASE_URL, SERVICE_KEY)
      const oneHourAgo = new Date(Date.now() - 3600_000).toISOString()
      const { count, error } = await admin
        .from('ocr_scan_log')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .gte('created_at', oneHourAgo)
      if (!error && (count ?? 0) >= HOURLY_SCAN_LIMIT) {
        return new Response(JSON.stringify({ error: 'rate_limited' }), {
          status: 429, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        })
      }
      await admin.from('ocr_scan_log').insert({ user_id: userId })
    } catch (rlErr) {
      console.warn('rate-limit check skipped:', rlErr)
    }
  }

  // Read API key from Supabase Secrets
  const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY')
  if (!GEMINI_API_KEY) {
    return errorResponse(
      'GEMINI_API_KEY is not set. Go to: Supabase Dashboard → Settings → Edge Functions → Secrets → Add GEMINI_API_KEY',
    )
  }

  // Parse request body
  let body: { image_base64?: string; mime_type?: string; text?: string }
  try {
    body = await req.json()
  } catch {
    return errorResponse('Request body must be valid JSON')
  }

  // Build the Gemini `contents` array
  let parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }>

  if (body.image_base64) {
    // Image mode — OCR from photo
    parts = [
      { text: PROMPT + '\n\nAnalyze this voucher image:' },
      { inlineData: { mimeType: body.mime_type ?? 'image/jpeg', data: body.image_base64 } },
    ]
  } else if (typeof body.text === 'string' && body.text.trim()) {
    // Text mode — SMS / WhatsApp / email paste
    parts = [
      { text: PROMPT + `\n\nExtract from this text:\n\n${body.text.slice(0, 5000)}` },
    ]
  } else {
    return errorResponse('Provide either image_base64 or text in the request body')
  }

  // Call Gemini 1.5 Flash via v1beta
  let geminiResponse: Response
  let geminiBody: unknown
  try {
    geminiResponse = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': GEMINI_API_KEY,   // key in header, not URL query
        },
        body: JSON.stringify({ contents: [{ parts }] }),
      },
    )
    geminiBody = await geminiResponse.json()
  } catch (networkError) {
    return errorResponse(`Network error reaching Gemini: ${String(networkError)}`)
  }

  if (!geminiResponse.ok) {
    const apiMsg =
      (geminiBody as { error?: { message?: string } })?.error?.message ??
      `Gemini HTTP ${geminiResponse.status}`
    return errorResponse(`Gemini API error: ${apiMsg}`)
  }

  // Extract the text content from Gemini's response structure
  const rawText: string =
    (geminiBody as {
      candidates?: { content?: { parts?: { text?: string }[] } }[]
    })?.candidates?.[0]?.content?.parts?.[0]?.text ?? ''

  if (!rawText) {
    return errorResponse('Gemini returned an empty response')
  }

  // Parse extracted JSON
  let extracted: Record<string, unknown>
  try {
    extracted = parseGeminiJson(rawText)
  } catch (parseError) {
    return errorResponse(`Could not parse Gemini output: ${String(parseError)}`)
  }

  // Normalise candidates block
  const rawCandidates = extracted.candidates as Record<string, unknown> | null | undefined
  const candidates: Record<string, unknown> = {}
  if (rawCandidates && typeof rawCandidates === 'object') {
    const strArr = (v: unknown) =>
      Array.isArray(v) ? (v as unknown[]).filter((c): c is string => typeof c === 'string') : []
    const numArr = (v: unknown) =>
      Array.isArray(v) ? (v as unknown[]).filter((c): c is number => typeof c === 'number' && c > 0) : []

    const codeCands = strArr(rawCandidates.code)
    if (codeCands.length > 1) candidates.code = codeCands

    const dateCands = strArr(rawCandidates.expiry_date)
      .map(toISODate)
      .filter((d): d is string => d !== null)
    if (dateCands.length > 1) candidates.expiry_date = dateCands

    const nameCands = strArr(rawCandidates.store_name)
    if (nameCands.length > 1) candidates.store_name = nameCands

    const amtCands = numArr(rawCandidates.amount)
    if (amtCands.length > 1) candidates.amount = amtCands
  }

  // Build final clean response
  const categories = filterCategories(extracted.categories)
  const link =
    typeof extracted.link === 'string' && extracted.link.startsWith('http')
      ? extracted.link
      : null
  const currency =
    typeof extracted.currency === 'string' && extracted.currency
      ? extracted.currency.toUpperCase()
      : null

  return jsonResponse({
    error: null,
    store_name:  typeof extracted.store_name  === 'string' ? extracted.store_name  : null,
    code:        typeof extracted.code        === 'string' ? extracted.code        : null,
    cvv:         typeof extracted.cvv         === 'string' ? extracted.cvv         : null,
    amount:      typeof extracted.amount      === 'number' && extracted.amount  > 0 ? extracted.amount  : null,
    currency,
    balance:     typeof extracted.balance     === 'number' && extracted.balance > 0 ? extracted.balance : null,
    expiry_date: toISODate(extracted.expiry_date),
    categories:  categories.length > 0 ? categories : null,
    link,
    candidates:  Object.keys(candidates).length > 0 ? candidates : null,
  })
})
