import { GoogleGenerativeAI } from '@google/generative-ai'
import type { ExtractedVoucher } from '../utils/smsExtractor'

const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY as string | undefined

// ── Prompt ──────────────────────────────────────────────────────────────────

const EXTRACTION_SCHEMA = `
Return ONLY a JSON object (no markdown, no explanation) with these fields:
{
  "store_name": string | null,       // Retailer / brand name (e.g. "זארה", "BuyMe", "Amazon")
  "code": string | null,             // Voucher/gift-card code — alphanumeric, keep hyphens, remove spaces
  "cvv": string | null,              // CVV / PIN / security code (3-4 digits)
  "amount": number | null,           // Original face value in ILS (₪)
  "balance": number | null,          // Remaining balance if explicitly shown, else same as amount
  "expiry_date": string | null,      // ISO 8601 date YYYY-MM-DD; last day of month if only month/year given
  "categories": string[]             // 0-3 tags from: ["מסעדות","אופנה","מזון","בידור","אלקטרוניקה","יופי","ספורט","נסיעות","כללי"]
}

Rules:
- store_name: prefer the merchant's official brand name in Hebrew if it's an Israeli brand
- code: the primary voucher/gift-card code. If multiple codes exist, pick the longest/most prominent
- If a field is absent or unclear, return null (not empty string)
- For Israeli super-vouchers (BuyMe, תו הזהב, תו פלוס, נופשונית, Fun Online, גיפט קארד ישראל) use that exact name as store_name
- expiry_date: if "12/26" → "2026-12-31"; if "31/12/2026" → "2026-12-31"
`

const IMAGE_PROMPT = `You are an expert at reading Israeli gift cards, vouchers, and store credit.
Analyze this image and extract all voucher details.
${EXTRACTION_SCHEMA}`

const TEXT_PROMPT = `You are an expert at parsing Israeli SMS messages, emails, and receipts about gift cards and vouchers.
Analyze this text and extract all voucher details.
${EXTRACTION_SCHEMA}

Text to analyze:
`

// ── Helpers ──────────────────────────────────────────────────────────────────

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      resolve(result.split(',')[1]) // strip "data:image/...;base64,"
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

function parseJsonResponse(raw: string): Partial<ExtractedVoucher & { categories?: string[] }> {
  // Strip any markdown fences Gemini might add despite instructions
  const cleaned = raw.replace(/^```(?:json)?\n?/m, '').replace(/\n?```$/m, '').trim()
  try {
    return JSON.parse(cleaned)
  } catch {
    // Try to find a JSON object inside the response
    const match = cleaned.match(/\{[\s\S]*\}/)
    if (match) return JSON.parse(match[0])
    throw new Error('Could not parse Gemini response as JSON')
  }
}

function normaliseResult(raw: Partial<ExtractedVoucher & { categories?: string[] }>): ExtractedVoucher {
  return {
    store_name: raw.store_name || undefined,
    code: raw.code || undefined,
    cvv: raw.cvv || undefined,
    amount: typeof raw.amount === 'number' && raw.amount > 0 ? raw.amount : undefined,
    balance: typeof raw.balance === 'number' && raw.balance > 0 ? raw.balance : undefined,
    expiry_date: raw.expiry_date ? normaliseDate(raw.expiry_date) : undefined,
  }
}

function normaliseDate(d: string): string | undefined {
  // Accept YYYY-MM-DD or coerce partial dates
  if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return d
  // Try native parsing as last resort
  const ts = Date.parse(d)
  if (!isNaN(ts)) return new Date(ts).toISOString().split('T')[0]
  return undefined
}

// ── Public API ────────────────────────────────────────────────────────────────

export function isGeminiAvailable(): boolean {
  return !!GEMINI_API_KEY
}

/**
 * Analyse a voucher image with Gemini Vision.
 * Returns extracted fields; throws if API call fails.
 */
export async function analyzeVoucherImage(file: File): Promise<ExtractedVoucher> {
  if (!GEMINI_API_KEY) throw new Error('No Gemini API key configured')

  const genAI = new GoogleGenerativeAI(GEMINI_API_KEY)
  const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' })

  const base64 = await fileToBase64(file)
  const imagePart = { inlineData: { data: base64, mimeType: file.type as 'image/jpeg' | 'image/png' | 'image/webp' } }

  const result = await model.generateContent([IMAGE_PROMPT, imagePart])
  const text = result.response.text()
  const parsed = parseJsonResponse(text)
  return normaliseResult(parsed)
}

/**
 * Extract voucher details from SMS / email / free text using Gemini.
 * Returns extracted fields; throws if API call fails.
 */
export async function analyzeVoucherText(text: string): Promise<ExtractedVoucher> {
  if (!GEMINI_API_KEY) throw new Error('No Gemini API key configured')

  const genAI = new GoogleGenerativeAI(GEMINI_API_KEY)
  const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' })

  const result = await model.generateContent(TEXT_PROMPT + text)
  const raw = result.response.text()
  const parsed = parseJsonResponse(raw)
  return normaliseResult(parsed)
}
