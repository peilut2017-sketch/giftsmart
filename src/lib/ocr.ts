// Fully client-side voucher-photo scanning via Tesseract.js — runs entirely
// in the browser (WASM), no server round trip and no per-scan API cost. This
// is the free, unlimited scan path for everyone; gemini.ts's analyzeVoucherImage
// (paid Gemini Vision, via the analyze-voucher Edge Function) is reserved as
// the more accurate "smart scan" for Pro, since local OCR is meaningfully
// weaker on a hard photo (glare, an angle, an unusual font, a busy background).
import { extractFromSMS, type ExtractedVoucher } from '../utils/smsExtractor'

// Resize before OCR — a raw phone photo can be 10+ MB / 4000px+, which is both
// slow to feed through Tesseract and unnecessary: printed voucher text stays
// legible well under that. (Deliberately separate from gemini.ts's own
// prepareImage: that one targets Gemini's inline-data size limit — this one
// targets OCR legibility, which tolerates a somewhat larger image.)
function prepareImageForOcr(file: File): Promise<HTMLCanvasElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const objectUrl = URL.createObjectURL(file)

    img.onload = () => {
      URL.revokeObjectURL(objectUrl)
      const MAX = 2000
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
      resolve(canvas)
    }

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl)
      reject(new Error(`Cannot decode image — try saving as JPEG or PNG (type: ${file.type || 'unknown'})`))
    }

    img.src = objectUrl
  })
}

// The worker (WASM core + heb+eng trained data, a few MB, fetched from a CDN
// the library defaults to — no hosting cost on our side) is created once per
// session and reused across scans rather than rebuilt every time.
let workerPromise: ReturnType<(typeof import('tesseract.js'))['createWorker']> | null = null

async function getWorker() {
  if (!workerPromise) {
    const { createWorker } = await import('tesseract.js')
    workerPromise = createWorker(['heb', 'eng'])
  }
  return workerPromise
}

/**
 * Scan a voucher photo entirely client-side: OCR the image, then run the raw
 * text through the same free-text field extraction already used for pasted
 * SMS/email (store-name matching against the user's saved stores, amount,
 * code, expiry date). No server call, no API cost, no scan limit — unlike
 * gemini.ts's analyzeVoucherImage.
 */
export async function scanVoucherImageLocally(file: File, knownStores?: string[]): Promise<ExtractedVoucher> {
  const canvas = await prepareImageForOcr(file)
  const worker = await getWorker()
  const { data: { text } } = await worker.recognize(canvas)
  return extractFromSMS(text, knownStores)
}
