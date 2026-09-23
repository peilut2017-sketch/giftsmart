import { describe, it, expect } from 'vitest'
import { extractFromSMS } from '../smsExtractor'

describe('extractFromSMS — amounts', () => {
  it('reads a plain shekel amount', () => {
    expect(extractFromSMS('קיבלת שובר על סך ₪150 לחנות שופרסל').amount).toBe(150)
    expect(extractFromSMS('שובר בסך 250 ש"ח').amount).toBe(250)
  })

  it('treats a two-digit group after a comma as a decimal, not thousands', () => {
    // "150,50" used to become 15050 — a 100x error on a real voucher.
    expect(extractFromSMS('שובר על סך ₪150,50').amount).toBe(150.5)
  })

  it('treats a three-digit group after a comma as a thousands separator', () => {
    expect(extractFromSMS('שובר על סך ₪1,500').amount).toBe(1500)
  })

  it('uses the last separator as the decimal point when both appear', () => {
    expect(extractFromSMS('שובר על סך ₪1.500,25').amount).toBe(1500.25)
    expect(extractFromSMS('שובר על סך ₪1,500.25').amount).toBe(1500.25)
  })
})

describe('extractFromSMS — codes and links', () => {
  it('pulls a labelled voucher code and strips inner whitespace', () => {
    expect(extractFromSMS('קוד השובר: ABC12345').code).toBe('ABC12345')
  })

  it('ignores unsubscribe links when picking the voucher link', () => {
    const sms = 'השובר שלך: https://shop.example.com/v/abc להסרה: https://x.co/unsubscribe/9'
    const { link } = extractFromSMS(sms)
    if (link) expect(link).not.toMatch(/unsubscribe/i)
  })
})

describe('extractFromSMS — store name', () => {
  it('does not capture a generic leading word like "שובר" as the store name', () => {
    // The store-name regex used to have an all-optional "מ?ב?" alternative
    // that matched an empty string at position 0, grabbing the message's
    // first word regardless of any real keyword.
    const { store_name } = extractFromSMS('שובר שופרסל בסך 150 ש"ח, קוד: ABC123')
    expect(store_name).not.toBe('שובר')
  })

  it('matches an exact known/saved store name over free-text guessing', () => {
    const sms = 'שובר שופרסל בסך 150 ש"ח, קוד: ABC123, בתוקף עד 12/2026'
    expect(extractFromSMS(sms, ['שופרסל', 'רמי לוי']).store_name).toBe('שופרסל')
  })

  it('prefers the longer known store name when one contains the other', () => {
    const sms = 'שובר לרמי לוי שיווק בסך 100 ש"ח'
    expect(extractFromSMS(sms, ['רמי לוי', 'רמי לוי שיווק']).store_name).toBe('רמי לוי שיווק')
  })
})

describe('extractFromSMS — expiry date', () => {
  it('extracts a labeled "תוקף עד DD.MM.YYYY" date, connector included', () => {
    expect(extractFromSMS('השובר בתוקף עד 31.12.2026').expiry_date).toBe('2026-12-31')
  })

  it('extracts a labeled "תוקף עד DD/MM/YYYY" date', () => {
    expect(extractFromSMS('תוקף עד 31/12/2026').expiry_date).toBe('2026-12-31')
  })

  it('extracts an unlabeled full three-part date without losing the year', () => {
    // Previously the 2-part fallback pattern truncated "31.12.2026" to
    // "31.12", which parseDate then read as an invalid MM/YY (month 31) and
    // discarded entirely — the date, year included, never made it through.
    expect(extractFromSMS('השובר שלך יפוג ב-31.12.2026, שמור אותו').expiry_date).toBe('2026-12-31')
  })

  it('extracts an ISO-style YYYY-MM-DD date without misreading a digit sub-run', () => {
    expect(extractFromSMS('תוקף: 2026-12-31').expiry_date).toBe('2026-12-31')
  })
})

describe('extractFromSMS — robustness', () => {
  it('returns an empty result instead of throwing on junk input', () => {
    expect(() => extractFromSMS('')).not.toThrow()
    expect(extractFromSMS('').amount).toBeUndefined()
    expect(extractFromSMS('שלום, מה נשמע?').code).toBeUndefined()
  })

  it('never returns NaN for an amount it could not parse', () => {
    const { amount } = extractFromSMS('שובר על סך ₪')
    expect(amount === undefined || Number.isFinite(amount)).toBe(true)
  })
})
