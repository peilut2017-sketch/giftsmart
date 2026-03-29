import { GoogleGenerativeAI } from '@google/generative-ai'
import type { ExtractedVoucher } from '../utils/smsExtractor'

const GEMINI_API_KEY = (import.meta.env.VITE_GEMINI_API_KEY as string | undefined)?.trim() || undefined

// ── Prompt ────────────────────────────────────────────────────────────────────

const EXTRACTION_SCHEMA = `
Return ONLY a JSON object (no markdown, no explanation) with these exact fields:
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
- code: the main voucher/gift-card code — keep hyphens, strip spaces
- cvv: security code / PIN (3–4 digits only), or null
- amount: face value in ILS (numbers only, no currency symbol)
- balance: remaining balance if shown separately, otherwise same as amount or null
- expiry_date: always YYYY-MM-DD. "12/26" → "2026-12-31". "31/12/2026" → "2026-12-31"
- For Israeli super-vouchers use the exact name: BuyMe | תו הזהב | תו פלוס | נופשונית | Fun Online | גיפט קארד ישראל
- If a field is absent, return null — never an empty string
`

const IMAGE_PROMPT = `You are an expert at reading Israeli gift cards, vouchers, and store credit. Analyze this image carefully and extract all voucher details.\n${EXTRACTION_SCHEMA}`

const TEXT_PROMPT = `You are an expert at parsing Israeli SMS messages, emails, and receipts about gift cards and vouchers. Extract voucher details from the following text.\n${EXTRACTION_SCHEMA}\n\nText:\n`

// ── Image preparation ─────────────────────────────────────────────────────────

/**
 * Convert any image file to a JPEG via canvas.
 * - Handles HEIC (Safari), WebP, PNG, etc.
 * - Resizes to at most 1600px on the longest side (Gemini works best ≤ 2MB).
 * - Always returns mimeType = 'image/jpeg'.
 */
function prepareImage(file: File): Promise<{ base64: string; mimeType: 'image/jpeg' }> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const objectUrl = URL.createObjectURL(file)

    img.onload = () => {
      URL.revokeObjectURL(objectUrl)
      const MAX = 1600
      let { width, height } = img
      if (width > MAX || height > MAX) {
        if (width >= height) { height = Math.round(height * MAX / width); width = MAX }
        else                 { width = Math.round(width  * MAX / height); height = MAX }
      }
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')
      if (!ctx) { reject(new Error('Canvas not available')); return }
      ctx.drawImage(img, 0, 0, width, height)
      const dataUrl = canvas.toDataURL('image/jpeg', 0.88)
      const base64 = dataUrl.split(',')[1]
      if (!base64) { reject(new Error('Canvas toDataURL failed')); return }
      resolve({ base64, mimeType: 'image/jpeg' })
    }

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl)
      reject(new Error(`Cannot decode image (type: ${file.type || 'unknown'})`))
    }

    img.src = objectUrl
  })
}

// ── JSON parsing ──────────────────────────────────────────────────────────────

function parseJsonResponse(raw: string): Partial<ExtractedVoucher> {
  const cleaned = raw.replace(/^```(?:json)?\s*/m, '').replace(/\s*```$/m, '').trim()
  try {
    return JSON.parse(cleaned)
  } catch {
    const m = cleaned.match(/\{[\s\S]*\}/)
    if (m) return JSON.parse(m[0])
    throw new Error(`Gemini returned non-JSON: ${cleaned.slice(0, 120)}`)
  }
}

function normaliseDate(d: string): string | undefined {
  if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return d
  const ts = Date.parse(d)
  return isNaN(ts) ? undefined : new Date(ts).toISOString().split('T')[0]
}

function normalise(raw: Partial<ExtractedVoucher>): ExtractedVoucher {
  return {
    store_name:  raw.store_name  || undefined,
    code:        raw.code        || undefined,
    cvv:         raw.cvv         || undefined,
    amount:      typeof raw.amount  === 'number' && raw.amount  > 0 ? raw.amount  : undefined,
    balance:     typeof raw.balance === 'number' && raw.balance > 0 ? raw.balance : undefined,
    expiry_date: raw.expiry_date ? normaliseDate(raw.expiry_date) : undefined,
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

export function isGeminiAvailable(): boolean {
  return !!GEMINI_API_KEY
}

function getModel() {
  const genAI = new GoogleGenerativeAI(GEMINI_API_KEY!)
  return genAI.getGenerativeModel({ model: 'gemini-2.0-flash' })
}

export async function analyzeVoucherImage(file: File): Promise<ExtractedVoucher> {
  if (!GEMINI_API_KEY) throw new Error('Gemini API key not configured')
  const { base64, mimeType } = await prepareImage(file)
  const model = getModel()
  const result = await model.generateContent([
    IMAGE_PROMPT,
    { inlineData: { data: base64, mimeType } },
  ])
  return normalise(parseJsonResponse(result.response.text()))
}

export async function analyzeVoucherText(text: string): Promise<ExtractedVoucher> {
  if (!GEMINI_API_KEY) throw new Error('Gemini API key not configured')
  const model = getModel()
  const result = await model.generateContent(TEXT_PROMPT + text)
  return normalise(parseJsonResponse(result.response.text()))
}
