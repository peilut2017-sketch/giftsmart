import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  formatCurrency,
  getDaysUntilExpiry,
  getExpiryStatus,
  isAlphanumeric,
  voucherMatchesQuery,
  csvCell,
  getStoreInitials,
  defaultExpiryDate,
} from '../helpers'

// Expiry logic is relative to "now", so freeze it.
const NOW = new Date('2026-06-15T12:00:00Z')
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW) })
afterEach(() => { vi.useRealTimers() })

describe('formatCurrency', () => {
  it('formats whole and fractional amounts without inventing precision', () => {
    expect(formatCurrency(500)).toBe('₪500')
    expect(formatCurrency(1250.5)).toBe('₪1,250.5')
  })

  it('never renders NaN for a missing or malformed balance', () => {
    // Legacy rows reach this with null/undefined/strings; "₪NaN" used to leak to the UI.
    expect(formatCurrency(null)).toBe('₪0')
    expect(formatCurrency(undefined)).toBe('₪0')
    expect(formatCurrency(Number.NaN)).toBe('₪0')
    expect(formatCurrency('abc' as unknown as number)).toBe('₪0')
  })
})

describe('getDaysUntilExpiry / getExpiryStatus', () => {
  it('classifies each band at its boundary', () => {
    // differenceInDays truncates, so a date is only "N days out" once the full
    // N days have passed — midday "now" against a midnight expiry rounds down.
    expect(getDaysUntilExpiry('2026-06-23')).toBe(7)
    expect(getExpiryStatus('2026-06-14')).toBe('expired')   // -1
    expect(getExpiryStatus('2026-06-15')).toBe('critical')  //  0, expires today
    expect(getExpiryStatus('2026-06-23')).toBe('critical')  //  7, last critical day
    expect(getExpiryStatus('2026-06-24')).toBe('warning')   //  8
    expect(getExpiryStatus('2026-06-30')).toBe('warning')   // 14, last warning day
    expect(getExpiryStatus('2026-07-01')).toBe('ok')        // 15
  })

  it('treats a missing or unparseable date as "no expiry", not as expired', () => {
    // Archiving keys off this: returning 'expired' here would archive live vouchers.
    expect(getExpiryStatus(undefined)).toBe('none')
    expect(getExpiryStatus('')).toBe('none')
    expect(getExpiryStatus('not-a-date')).toBe('none')
    expect(getDaysUntilExpiry('not-a-date')).toBeNull()
  })
})

describe('voucherMatchesQuery', () => {
  const voucher = {
    store_name: 'שופרסל',
    code: '7290001234567',
    categories: ['סופר'],
    tags: ['ועד עובדים'],
    notes: 'מתנה מהעבודה',
    source: 'ועד',
    item_name: 'סל קניות',
  }

  it('matches across every searchable field, case-insensitively', () => {
    for (const q of ['שופרסל', '729000', 'סופר', 'ועד עובדים', 'מהעבודה', 'סל קניות']) {
      expect(voucherMatchesQuery(voucher, q)).toBe(true)
    }
    expect(voucherMatchesQuery({ ...voucher, store_name: 'BuyMe' }, 'buyme')).toBe(true)
  })

  it('returns everything for an empty query and nothing for a miss', () => {
    expect(voucherMatchesQuery(voucher, '   ')).toBe(true)
    expect(voucherMatchesQuery(voucher, 'זארה')).toBe(false)
  })

  it('never matches the ciphertext of an encrypted code', () => {
    // v.code is "e2ee:iv:ct" for vault entries — searching it would leak/mismatch.
    const enc = { ...voucher, code: 'e2ee:AAAA:BBBB', is_e2ee: true }
    expect(voucherMatchesQuery(enc, 'e2ee')).toBe(false)
    expect(voucherMatchesQuery(enc, 'AAAA')).toBe(false)
    // …unless the caller supplies the decrypted value.
    expect(voucherMatchesQuery(enc, '729000', { resolveCode: () => '7290001234567' })).toBe(true)
  })

  it('tolerates vouchers with missing optional fields', () => {
    expect(voucherMatchesQuery({ store_name: 'רמי לוי', code: '1' }, 'רמי')).toBe(true)
  })
})

describe('csvCell', () => {
  it('quotes and escapes so a comma or quote cannot shift columns', () => {
    expect(csvCell('a,b')).toBe('"a,b"')
    expect(csvCell('say "hi"')).toBe('"say ""hi"""')
    expect(csvCell(null)).toBe('""')
  })

  it('neutralises spreadsheet formula injection', () => {
    // A store name the user controls must not execute when the export is opened.
    expect(csvCell('=HYPERLINK("http://evil","x")')).toMatch(/^"'=/)
    expect(csvCell('+1')).toBe(`"'+1"`)
    expect(csvCell('-1')).toBe(`"'-1"`)
    expect(csvCell('@SUM(A1)')).toBe(`"'@SUM(A1)"`)
    expect(csvCell('\tx')).toMatch(/^"'\t/)
  })
})

describe('isAlphanumeric', () => {
  it('decides barcode vs QR by whether letters are present', () => {
    expect(isAlphanumeric('7290001234567')).toBe(false)
    expect(isAlphanumeric('BM-8843-QZ7P')).toBe(true)
  })
})

describe('getStoreInitials', () => {
  it('returns a short, non-empty label for any store name', () => {
    expect(getStoreInitials('שופרסל')).toBeTruthy()
    expect(getStoreInitials('H&M')).toBeTruthy()
    expect(getStoreInitials('').length).toBeLessThanOrEqual(2)
  })
})

describe('defaultExpiryDate', () => {
  it('is five years out and ISO-formatted', () => {
    expect(defaultExpiryDate()).toBe('2031-06-15')
  })
})
