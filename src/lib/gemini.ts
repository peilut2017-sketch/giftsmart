// Voucher analysis via Supabase Edge Function (analyze-voucher).
// The Gemini API key lives in Supabase Secrets — never exposed to the browser.
import { supabase } from './supabase'
import type { ExtractedVoucher } from '../utils/smsExtractor'

// ── Image preparation (runs client-side) ──────────────────────────────────────

/**
 * Convert any image File to a JPEG via canvas.
 * Handles HEIC (iPhone), WebP, PNG, etc.
 * Resizes to max 1600px — keeps well under Gemini's inline-data limit.
 */
export function prepareImage(file: File): Promise<{ base64: string; mimeType: 'image/jpeg' }> {
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
      reject(new Error(`Cannot decode image — try saving as JPEG or PNG (type: ${file.type || 'unknown'})`))
    }

    img.src = objectUrl
  })
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function normalise(raw: Record<string, unknown>): ExtractedVoucher {
  function str(v: unknown) { return typeof v === 'string' && v ? v : undefined }
  function num(v: unknown) { return typeof v === 'number' && v > 0 ? v : undefined }
  return {
    store_name:  str(raw.store_name),
    code:        str(raw.code),
    cvv:         str(raw.cvv),
    amount:      num(raw.amount),
    balance:     num(raw.balance),
    expiry_date: str(raw.expiry_date),
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/** Always true — the edge function is always deployed; key availability is server-side. */
export function isGeminiAvailable(): boolean {
  return true
}

/**
 * Send an image to the analyze-voucher Edge Function.
 * The image is converted to JPEG client-side before upload.
 */
export async function analyzeVoucherImage(file: File): Promise<ExtractedVoucher> {
  const { base64, mimeType } = await prepareImage(file)
  const { data, error } = await supabase.functions.invoke('analyze-voucher', {
    body: { image_base64: base64, mime_type: mimeType },
  })
  if (error) throw new Error(error.message)
  if (data?.error) throw new Error(data.error)
  return normalise(data as Record<string, unknown>)
}

/**
 * Send SMS / free text to the analyze-voucher Edge Function.
 */
export async function analyzeVoucherText(text: string): Promise<ExtractedVoucher> {
  const { data, error } = await supabase.functions.invoke('analyze-voucher', {
    body: { text },
  })
  if (error) throw new Error(error.message)
  if (data?.error) throw new Error(data.error)
  return normalise(data as Record<string, unknown>)
}
