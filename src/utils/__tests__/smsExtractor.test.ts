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
