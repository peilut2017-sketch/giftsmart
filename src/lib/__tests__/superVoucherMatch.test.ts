import { describe, it, expect } from 'vitest'
import { findSuperVoucherByName } from '../superVoucherMatch'

const gz = { name: 'גיפטזון / GiftZone', catalog_product_key: 'giftzone' }
const list = [{ name: 'buyme all', catalog_product_key: 'buyme_all' }, gz, { name: 'Other / Thing', catalog_product_key: null }]

describe('findSuperVoucherByName', () => {
  it('matches the full name case-insensitively (previous behavior)', () => {
    expect(findSuperVoucherByName(list, 'BuyMe All')).toBe(list[0])
    expect(findSuperVoucherByName(list, 'גיפטזון / giftzone')).toBe(gz)
  })
  it('maps only the old Giftzone name to the giftzone product', () => {
    expect(findSuperVoucherByName(list, 'גיפטזון')).toBe(gz)
    expect(findSuperVoucherByName(list, ' גיפטזון ')).toBe(gz)
  })
  it('does not generalize to other bilingual names, parts, aliases or empty input', () => {
    expect(findSuperVoucherByName(list, 'Other')).toBeUndefined()
    expect(findSuperVoucherByName(list, 'giftzone')).toBeUndefined()
    expect(findSuperVoucherByName(list, 'גיפט')).toBeUndefined()
    expect(findSuperVoucherByName(list, '')).toBeUndefined()
  })
  it('refuses when the product key is missing or not unique', () => {
    expect(findSuperVoucherByName([{ name: 'גיפטזון / GiftZone' }], 'גיפטזון')).toBeUndefined()
    expect(findSuperVoucherByName([gz, { name: 'copy', catalog_product_key: 'giftzone' }], 'גיפטזון')).toBeUndefined()
  })
})
