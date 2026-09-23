// Fully client-side voucher-photo scanning via Tesseract.js — runs entirely
// in the browser (WASM), no server round trip and no per-scan API cost. This
// is the free, unlimited scan path for everyone; gemini.ts's analyzeVoucherImage
// (paid Gemini Vision, via the analyze-voucher Edge Function) is reserved as
// the more accurate "smart scan" for Pro, and VoucherForm.tsx also falls back
// to this path if the Gemini call fails for any reason (no API key configured,
// network error, rate limit) — so a working scan is never gated on having an
// AI API connection at all.
import { extractFromSMS, type ExtractedVoucher } from '../utils/smsExtractor'

// Resize before OCR — a raw phone photo can be 10+ MB / 4000px+, which is both
// slow to feed through Tesseract and unnecessary: printed voucher text stays
// legible well under a much smaller size. Also upscales a small/low-res image
// the other way — tiny print (a CVV, a long code) can fall below Tesseract's
// effective recognition resolution otherwise. (Deliberately separate from
// gemini.ts's own prepareImage: that one targets Gemini's inline-data size
// limit — this one targets OCR legibility, a different tradeoff.)
function prepareImageForOcr(file: File): Promise<HTMLCanvasElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const objectUrl = URL.createObjectURL(file)

    img.onload = () => {
      URL.revokeObjectURL(objectUrl)
      const MAX = 2000
      const MIN = 1000
      let { width, height } = img
      const longEdge = Math.max(width, height)
      if (longEdge > MAX) {
        const scale = MAX / longEdge
        width = Math.round(width * scale); height = Math.round(height * scale)
      } else if (longEdge < MIN) {
        const scale = MIN / longEdge
        width = Math.round(width * scale); height = Math.round(height * scale)
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

// Grayscale + percentile-based contrast stretch, in place on the canvas —
// the single biggest lever for OCR accuracy on a real phone photo. A colored/
// patterned card background and uneven lighting confuse Tesseract far more
// than genuine text-shape ambiguity does; flattening to a normalized grayscale
// image removes both. Percentile (not plain min/max) clipping keeps a single
// glare highlight or a dark corner from skewing the whole stretch.
function enhanceForOcr(canvas: HTMLCanvasElement): HTMLCanvasElement {
  const ctx = canvas.getContext('2d')
  if (!ctx) return canvas
  const { width, height } = canvas
  const imageData = ctx.getImageData(0, 0, width, height)
  const { data } = imageData
  const n = width * height
  if (n === 0) return canvas

  const gray = new Uint8ClampedArray(n)
  const hist = new Uint32Array(256)
  for (let i = 0; i < n; i++) {
    const o = i * 4
    const g = 0.299 * data[o] + 0.587 * data[o + 1] + 0.114 * data[o + 2]
    gray[i] = g
    hist[gray[i]]++
  }

  const lowCut = n * 0.02
  const highCut = n * 0.02
  let cum = 0, lo = 0, hi = 255
  for (let v = 0; v < 256; v++) { cum += hist[v]; if (cum >= lowCut) { lo = v; break } }
  cum = 0
  for (let v = 255; v >= 0; v--) { cum += hist[v]; if (cum >= highCut) { hi = v; break } }
  const range = Math.max(1, hi - lo)

  for (let i = 0; i < n; i++) {
    const stretched = Math.max(0, Math.min(255, ((gray[i] - lo) / range) * 255))
    const o = i * 4
    data[o] = data[o + 1] = data[o + 2] = stretched
  }

  ctx.putImageData(imageData, 0, 0)
  return canvas
}

// The worker (WASM core + heb+eng trained data, a few MB, fetched from a CDN
// the library defaults to — no hosting cost on our side) is created once per
// session and reused across scans rather than rebuilt every time.
let workerPromise: ReturnType<(typeof import('tesseract.js'))['createWorker']> | null = null

async function getWorker() {
  if (!workerPromise) {
    workerPromise = (async () => {
      const { createWorker } = await import('tesseract.js')
      const worker = await createWorker(['heb', 'eng'])
      // A DPI hint helps Tesseract's internal scaling heuristics on an image
      // that — unlike a real scanned document — carries no DPI metadata of
      // its own; preserve_interword_spaces keeps the spacing our downstream
      // regex extraction (extractFromSMS) relies on from being collapsed.
      await worker.setParameters({ user_defined_dpi: '300', preserve_interword_spaces: '1' })
      return worker
    })()
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
  const canvas = enhanceForOcr(await prepareImageForOcr(file))
  const worker = await getWorker()
  // rotateAuto corrects a sideways/upside-down photo — a phone photo's EXIF
  // orientation isn't reliably honored once drawn to a canvas.
  const { data: { text } } = await worker.recognize(canvas, { rotateAuto: true })
  return extractFromSMS(text, knownStores)
}
