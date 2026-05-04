export interface ExtractionCandidate {
  code?: string[]
  expiry_date?: string[]
  store_name?: string[]
  amount?: number[]
  categories?: string[][]
}

export interface ExtractedVoucher {
  code?: string
  amount?: number
  balance?: number
  store_name?: string
  expiry_date?: string
  cvv?: string
  categories?: string[]
  link?: string
  candidates?: ExtractionCandidate
}

// Patterns that indicate an unsubscribe / opt-out link — exclude these
const UNSUBSCRIBE_RE = /unsubscribe|optout|opt-out|remove|הסרה|הסר/i

export function extractFromSMS(text: string): ExtractedVoucher {
  const result: ExtractedVoucher = {}

  // Extract amount
  const amountPatterns = [
    /(?:סכום|שובר|ערך|יתרה)[:\s]*(?:של\s*)?₪?\s*(\d+(?:[,\.]\d+)?)/i,
    /₪\s*(\d+(?:[,\.]\d+)?)/,
    /(\d+(?:[,\.]\d+)?)\s*₪/,
    /(\d+(?:[,\.]\d+)?)\s*שקל/i,
    /(\d+(?:[,\.]\d+)?)\s*ש"ח/i,
    /(\d+(?:[,\.]\d+)?)\s*NIS/i,
  ]
  for (const pattern of amountPatterns) {
    const match = text.match(pattern)
    if (match) {
      result.amount = parseFloat(match[1].replace(',', ''))
      break
    }
  }

  // Extract code (various patterns)
  const codePatterns = [
    /(?:קוד|code|voucher|שובר|gift\s*card|גיפט)[:\s#]*([A-Z0-9\-]{4,20})/i,
    /(?:מספר)[:\s]*([A-Z0-9\-]{6,20})/i,
    /\b([A-Z]{2,4}[\-]?[0-9]{4,12})\b/,
    /(?:card\s*number|מספר כרטיס)[:\s]*([0-9\s]{12,19})/i,
    // Broad fallback last — exclude Israeli phone numbers (05x / 07x / 02–09 landlines)
    /\b(?!05\d)(?!07\d)(?!0[2-9]\d{7})([0-9]{8,19})\b/,
  ]
  for (const pattern of codePatterns) {
    const match = text.match(pattern)
    if (match) {
      result.code = match[1].trim().replace(/\s+/g, '')
      break
    }
  }

  // Extract CVV
  const cvvMatch = text.match(/(?:cvv|cvc|קוד אבטחה|pin)[:\s]*(\d{3,4})/i)
  if (cvvMatch) result.cvv = cvvMatch[1]

  // Extract expiry date — if multiple dates found, pick last (latest)
  const expiryPatterns = [
    /(?:תוקף|תאריך תפוגה|valid\s*until|expires?)[:\s]*(\d{1,2}[\/\.\-]\d{2,4})/i,
    /(?:תוקף|valid)[:\s]*(\d{1,2}\/\d{2,4})/i,
    /(\d{1,2}[\/\.]\d{2,4})/,
    /(\d{2}[\/\-]\d{2}[\/\-]\d{2,4})/,
    /(\d{4}[\/\-]\d{2}[\/\-]\d{2})/,
  ]

  // First try labeled expiry
  let foundExpiry = false
  const labeledExpiryRe = /(?:תוקף|תאריך תפוגה|valid\s*until|expires?)[:\s]*(\d{1,2}[\/\.\-][\d\/\.\-]{2,9})/i
  const labeledMatch = text.match(labeledExpiryRe)
  if (labeledMatch) {
    const parsed = parseDate(labeledMatch[1])
    if (parsed) { result.expiry_date = parsed; foundExpiry = true }
  }

  if (!foundExpiry) {
    // Collect all date candidates and pick the last (latest)
    const allDates: string[] = []
    for (const pattern of expiryPatterns) {
      const re = new RegExp(pattern.source, 'gi')
      let m: RegExpExecArray | null
      while ((m = re.exec(text)) !== null) {
        const parsed = parseDate(m[1])
        if (parsed) allDates.push(parsed)
      }
    }
    if (allDates.length > 0) {
      // Sort ascending, pick last
      allDates.sort()
      result.expiry_date = allDates[allDates.length - 1]
      if (allDates.length > 1) {
        result.candidates = { ...result.candidates, expiry_date: [...new Set(allDates)] }
      }
    }
  }

  // Extract store name
  const storePatterns = [
    /(?:חנות|store|מ?ב?|ב?:)\s*([א-ת\w\s]{2,20}?)(?:\s|,|\.|$)/i,
    /ב?-?\s*([א-ת]{3,15}(?:\s[א-ת]{2,10})?)\s*(?:בע"מ|מכבדת|ניתן|לרכישה)/i,
    /שובר\s+ל?([א-ת\w\s]{3,20})/i,
    /(?:BuyMe|buyme)\s*[-–]\s*([^,\n]+)/i,
  ]

  // Check for known super-voucher names
  const superVoucherNames = ['BuyMe', 'תו הזהב', 'נופשונית', 'תו פלוס', 'Fun Online', 'גיפט קארד ישראל']
  for (const name of superVoucherNames) {
    if (text.includes(name)) {
      result.store_name = name
      break
    }
  }

  if (!result.store_name) {
    for (const pattern of storePatterns) {
      const match = text.match(pattern)
      if (match) {
        result.store_name = match[1].trim()
        break
      }
    }
  }

  // Extract first non-unsubscribe URL
  const urlRe = /https?:\/\/[^\s"'>]+/gi
  let urlMatch: RegExpExecArray | null
  while ((urlMatch = urlRe.exec(text)) !== null) {
    const url = urlMatch[0].replace(/[.,;)]+$/, '') // strip trailing punctuation
    if (!UNSUBSCRIBE_RE.test(url)) {
      result.link = url
      break
    }
  }

  return result
}

function parseDate(str: string): string | null {
  try {
    const parts = str.split(/[\/\.\-]/)
    if (parts.length === 2) {
      // MM/YY or MM/YYYY
      const month = parseInt(parts[0])
      let year = parseInt(parts[1])
      if (year < 100) year += 2000
      if (month >= 1 && month <= 12) {
        return `${year}-${String(month).padStart(2, '0')}-01`
      }
    } else if (parts.length === 3) {
      // DD/MM/YYYY or YYYY/MM/DD
      if (parts[0].length === 4) {
        return `${parts[0]}-${parts[1].padStart(2, '0')}-${parts[2].padStart(2, '0')}`
      } else {
        const year = parseInt(parts[2]) < 100 ? 2000 + parseInt(parts[2]) : parseInt(parts[2])
        return `${year}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`
      }
    }
  } catch {}
  return null
}
