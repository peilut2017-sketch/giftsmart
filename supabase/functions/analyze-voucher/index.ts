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
//   { store_name, code, cvv, amount, balance, expiry_date, categories, link, candidates } | { error: string }

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// All available category IDs — used to constrain AI category suggestions
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

Extraction priority order — work through the text in this order:
1. STORE / VOUCHER NAME (store_name): Look first for an explicit voucher or brand name.
   - Prefer the name of the issuing brand or store (e.g. "רמי לוי", "זארה", "קפה גרג").
   - Israeli super-vouchers: use exact name — BuyMe | תו הזהב | תו פלוס | נופשונית | Fun Online | גיפט קארד ישראל
   - Prefer Hebrew for Israeli brands.
   - If multiple brand names appear, pick the most prominent one (e.g. the issuer, not a partner).

2. AMOUNT (amount): Face value in ILS as a plain number.
   - Look for ₪, ש"ח, שח, שקל, NIS near a number.
   - Ignore small fees or partial amounts if a clear total exists.

3. VOUCHER CODE (code): The main redeemable code.
   - Codes are typically: all-digit strings (8–19 chars), alphanumeric combos (4–20 chars), or mixed with hyphens/dashes.
   - Strip surrounding spaces; keep internal hyphens.
   - Exclude Israeli phone numbers (05x / 07x / landlines starting 02–09).
   - Exclude amounts, dates, and CVV/PIN values already captured.
   - If two plausible codes exist, put the longer/primary one in "code" and both in candidates.code.

4. EXPIRY DATE (expiry_date): Always output as YYYY-MM-DD.
   - "12/26" → "2026-12-31"  |  "31/12/2026" → "2026-12-31"  |  "12/2026" → "2026-12-31"
   - If multiple dates appear in the text:
     a. Prefer the one explicitly labeled as תוקף / תפוגה / valid until / expires / expiry.
     b. If no label distinguishes them, take the LAST (latest) date in the text.
   - If multiple dates are plausible expiry candidates, list them all in candidates.expiry_date (as YYYY-MM-DD strings) and pick the most likely one for expiry_date.

5. CATEGORIES (categories): Array of 1–3 category IDs that best describe this voucher.
   Available IDs: fashion, food, electronics, beauty, home, sport, travel, entertainment, kids, health, books, restaurant, supermarket, gift, other
   - Base the choice on the store name and voucher content.
   - Example: "זארה" → ["fashion"]  |  "רמי לוי" → ["supermarket", "food"]  |  "BuyMe" → ["gift"]
   - Return null if completely unclear.

6. LINK (link): The first URL in the text that is NOT an unsubscribe / opt-out / removal link.
   - Unsubscribe patterns to exclude: unsubscribe, optout, opt-out, remove, הסרה, הסר
   - If no valid link found → null.

7. CVV / PIN (cvv): Security code, 3–4 digits, only if explicitly labeled. Otherwise null.

8. BALANCE (balance): Remaining balance if shown separately from face value. Otherwise null.

CANDIDATES — populate only when genuinely ambiguous:
- candidates.code: list if 2+ plausible codes exist
- candidates.expiry_date: list if 2+ plausible expiry dates exist (all as YYYY-MM-DD)
- candidates.store_name: list if 2+ plausible store names exist
- candidates.amount: list if 2+ plausible amounts exist
- candidates.categories: list alternative category sets (each element is an array of IDs)
- Omit a candidates field entirely when there is no ambiguity.
- Missing/unclear fields → null (never empty string or empty array)
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

function normaliseDateArray(arr: unknown): string[] {
  if (!Array.isArray(arr)) return []
  return arr.map(d => normaliseDate(d as string)).filter((d): d is string => d !== null)
}

function validCategories(arr: unknown): string[] {
  if (!Array.isArray(arr)) return []
  return (arr as unknown[]).filter(c => typeof c === 'string' && CATEGORY_IDS.includes(c)) as string[]
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

  // Normalise candidates block
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

  // Normalise and return
  return ok({
    error: null,
    store_name:   (extracted.store_name  as string  | null) || null,
    code:         (extracted.code        as string  | null) || null,
    cvv:          (extracted.cvv         as string  | null) || null,
    amount:       typeof extracted.amount  === 'number' && extracted.amount  > 0 ? extracted.amount  : null,
    balance:      typeof extracted.balance === 'number' && extracted.balance > 0 ? extracted.balance : null,
    expiry_date:  normaliseDate(extracted.expiry_date as string | null),
    categories:   validCategories(extracted.categories).length > 0 ? validCategories(extracted.categories) : null,
    link:         typeof extracted.link === 'string' && extracted.link.startsWith('http') ? extracted.link : null,
    candidates:   Object.keys(candidates).length > 0 ? candidates : null,
  })
})
