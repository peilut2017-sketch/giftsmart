// Supabase Edge Function — analyze-voucher
// Uses OPENAI_API_KEY from Supabase Secrets (never exposed to the browser).
//
// Set the secret:
//   supabase secrets set OPENAI_API_KEY=sk-...
//
// Request body (JSON):
//   { image_base64: string, mime_type?: string }   → image / OCR analysis
//   { text: string }                               → SMS / free-text analysis
//
// Response:
//   { store_name, code, cvv, amount, balance, expiry_date, categories, link, candidates } | { error: string }

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Predefined category IDs that constrain AI suggestions
const CATEGORY_IDS = [
  'fashion', 'food', 'electronics', 'beauty', 'home',
  'sport', 'travel', 'entertainment', 'kids', 'health',
  'books', 'restaurant', 'supermarket', 'gift', 'other',
]

const EXTRACTION_SCHEMA = `
Return ONLY a valid JSON object — no markdown, no explanation, no surrounding text.
Fields:
{
  "store_name": string | null,
  "code": string | null,
  "cvv": string | null,
  "amount": number | null,
  "currency": string | null,
  "balance": number | null,
  "expiry_date": string | null,
  "categories": string[] | null,
  "link": string | null,
  "candidates": {
    "store_name"?: string[],
    "code"?: string[],
    "expiry_date"?: string[],
    "amount"?: number[],
    "categories"?: string[][]
  } | null
}

Extraction priority order:
1. STORE / VOUCHER NAME (store_name): Official brand or store name. Prefer Hebrew for Israeli brands.
   Israeli super-vouchers — use exact: BuyMe | תו הזהב | תו פלוס | נופשונית | Fun Online | גיפט קארד ישראל
   If multiple names appear, pick the issuer.

2. AMOUNT (amount): Face value as a plain number. Also set currency (ILS / USD / EUR / etc.).
   Look for ₪, ש"ח, שח, שקל, NIS (→ ILS), $ (→ USD), € (→ EUR).

3. VOUCHER CODE (code): Main redeemable code — alphanumeric 4-20 chars, hyphens allowed.
   Exclude phone numbers, dates, amounts, and CVV values.
   If two plausible codes exist, put primary in "code" and both in candidates.code.

4. EXPIRY DATE (expiry_date): Always YYYY-MM-DD.
   "12/26" → "2026-12-31" | "31/12/2026" → "2026-12-31" | "12/2026" → "2026-12-31"
   Multiple dates: prefer one labeled תוקף / valid until / expires; else take the LAST (latest) date.
   List all plausible expiry dates in candidates.expiry_date.

5. CATEGORIES (categories): 1-3 IDs from:
   fashion, food, electronics, beauty, home, sport, travel, entertainment, kids, health, books, restaurant, supermarket, gift, other
   Base on store name and content. Return null if unclear.

6. LINK (link): First URL not related to unsubscribe/opt-out/removal (patterns: unsubscribe, optout, opt-out, remove, הסרה, הסר). Null if none.

7. CVV / PIN (cvv): 3-4 digit security code only if explicitly labeled. Otherwise null.

8. BALANCE (balance): Remaining balance if separately shown; otherwise null.

CANDIDATES: populate only when genuinely ambiguous (2+ plausible values for a field).
Missing/unclear fields → null (never empty string or empty array).
`

const SYSTEM_PROMPT =
  'You are an expert at reading Israeli gift cards, vouchers, receipts, SMS messages, and emails. ' +
  'Extract voucher details accurately.\n' + EXTRACTION_SCHEMA

// ── Helpers ───────────────────────────────────────────────────────────────────

function extractJson(raw: string): Record<string, unknown> {
  const cleaned = raw.replace(/^```(?:json)?\s*/m, '').replace(/\s*```$/m, '').trim()
  try {
    return JSON.parse(cleaned)
  } catch {
    const m = cleaned.match(/\{[\s\S]*\}/)
    if (m) return JSON.parse(m[0])
    throw new Error(`Non-JSON response: ${cleaned.slice(0, 200)}`)
  }
}

function normaliseDate(d: string | null | undefined): string | null {
  if (!d) return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return d
  const ts = Date.parse(d)
  return isNaN(ts) ? null : new Date(ts).toISOString().split('T')[0]
}

function normaliseDateArray(arr: unknown): string[] {
  if (!Array.isArray(arr)) return []
  return arr.map(d => normaliseDate(d as string)).filter((d): d is string => d !== null)
}

function validCategories(arr: unknown): string[] {
  if (!Array.isArray(arr)) return []
  return (arr as unknown[]).filter(c => typeof c === 'string' && CATEGORY_IDS.includes(c)) as string[]
}

// ── JWT auth ──────────────────────────────────────────────────────────────────

async function verifyUser(req: Request): Promise<{ id: string } | null> {
  const auth = req.headers.get('Authorization')
  if (!auth?.startsWith('Bearer ')) return null
  const token = auth.slice(7)
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_ANON_KEY') ?? '',
  )
  const { data: { user }, error } = await supabase.auth.getUser(token)
  if (error || !user) return null
  return { id: user.id }
}

// ── Main handler ──────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS })
  }

  // Always return HTTP 200 — errors go in `error` field so supabase.functions.invoke
  // puts the body in `data` instead of creating a FunctionsHttpError that swallows messages.
  const ok = (payload: Record<string, unknown>) =>
    new Response(JSON.stringify(payload), {
      status: 200, headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  const fail = (msg: string) => ok({ error: msg })

  // ── JWT validation ────────────────────────────────────────────────────────
  const user = await verifyUser(req)
  if (!user) return fail('Unauthorized — please sign in')

  // ── API key ───────────────────────────────────────────────────────────────
  const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY')
  if (!OPENAI_API_KEY) {
    return fail('OPENAI_API_KEY secret is not configured — set it via: supabase secrets set OPENAI_API_KEY=sk-...')
  }

  // ── Parse body ────────────────────────────────────────────────────────────
  let body: { image_base64?: string; mime_type?: string; text?: string }
  try {
    body = await req.json()
  } catch {
    return fail('Invalid JSON body')
  }

  // ── Build OpenAI message content ──────────────────────────────────────────
  type ContentPart =
    | { type: 'text'; text: string }
    | { type: 'image_url'; image_url: { url: string; detail: 'high' } }

  let userContent: ContentPart[]

  if (body.image_base64) {
    const mimeType = body.mime_type || 'image/jpeg'
    const dataUrl = `data:${mimeType};base64,${body.image_base64}`
    userContent = [
      { type: 'text', text: 'Analyze this voucher image and extract all details.' },
      { type: 'image_url', image_url: { url: dataUrl, detail: 'high' } },
    ]
  } else if (body.text) {
    userContent = [
      { type: 'text', text: `Extract voucher details from this text:\n\n${body.text.slice(0, 5000)}` },
    ]
  } else {
    return fail('Provide image_base64 or text')
  }

  // ── Call OpenAI GPT-4o-mini ───────────────────────────────────────────────
  let openaiRes: Response
  let openaiData: unknown
  try {
    openaiRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userContent },
        ],
        max_tokens: 800,
        temperature: 0,
      }),
    })
    openaiData = await openaiRes.json()
  } catch (e) {
    return fail(`Network error calling OpenAI: ${String(e)}`)
  }

  if (!openaiRes.ok) {
    const msg =
      (openaiData as { error?: { message?: string } })?.error?.message ||
      `OpenAI returned HTTP ${openaiRes.status}`
    return fail(msg)
  }

  const rawText: string =
    (openaiData as { choices?: { message?: { content?: string } }[] })
      ?.choices?.[0]?.message?.content ?? ''

  let extracted: Record<string, unknown>
  try {
    extracted = extractJson(rawText)
  } catch (e) {
    return fail(`Could not parse OpenAI response: ${String(e)}`)
  }

  // ── Normalise candidates block ────────────────────────────────────────────
  const rawCandidates = extracted.candidates as Record<string, unknown> | null | undefined
  const candidates: Record<string, unknown> = {}
  if (rawCandidates && typeof rawCandidates === 'object') {
    const codeCands = Array.isArray(rawCandidates.code)
      ? (rawCandidates.code as unknown[]).filter(c => typeof c === 'string') as string[]
      : []
    if (codeCands.length > 1) candidates.code = codeCands

    const dateCands = normaliseDateArray(rawCandidates.expiry_date)
    if (dateCands.length > 1) candidates.expiry_date = dateCands

    const nameCands = Array.isArray(rawCandidates.store_name)
      ? (rawCandidates.store_name as unknown[]).filter(c => typeof c === 'string') as string[]
      : []
    if (nameCands.length > 1) candidates.store_name = nameCands

    const amtCands = Array.isArray(rawCandidates.amount)
      ? (rawCandidates.amount as unknown[]).filter(c => typeof c === 'number' && c > 0) as number[]
      : []
    if (amtCands.length > 1) candidates.amount = amtCands

    if (Array.isArray(rawCandidates.categories)) {
      const catSets = (rawCandidates.categories as unknown[])
        .filter(Array.isArray)
        .map(set => validCategories(set))
        .filter(set => set.length > 0)
      if (catSets.length > 1) candidates.categories = catSets
    }
  }

  // ── Normalise and return ──────────────────────────────────────────────────
  const cats = validCategories(extracted.categories)
  const link = typeof extracted.link === 'string' && extracted.link.startsWith('http')
    ? extracted.link
    : null
  const currency = typeof extracted.currency === 'string' && extracted.currency
    ? extracted.currency.toUpperCase()
    : null

  return ok({
    error: null,
    store_name:   (extracted.store_name  as string | null) || null,
    code:         (extracted.code        as string | null) || null,
    cvv:          (extracted.cvv         as string | null) || null,
    amount:       typeof extracted.amount  === 'number' && extracted.amount  > 0 ? extracted.amount  : null,
    currency,
    balance:      typeof extracted.balance === 'number' && extracted.balance > 0 ? extracted.balance : null,
    expiry_date:  normaliseDate(extracted.expiry_date as string | null),
    categories:   cats.length > 0 ? cats : null,
    link,
    candidates:   Object.keys(candidates).length > 0 ? candidates : null,
  })
})
