import { describe, it, expect } from 'vitest'
import { parseGiftzone } from '../giftzoneParser'

describe('giftzone parser', () => {
  it('parses Giftzone embedded list: dedupes tag rows, keeps English as alias, rejects other zones', () => {
    const rows = [
      { id: '1', type_id: '4', name: "ג\\'נספורט", eng_name: 'JanSport', is_active: '1' },
      { id: '1', type_id: '4', name: "ג\\'נספורט", eng_name: 'JanSport', is_active: '1' },
      { id: '2', type_id: '4', name: 'שופרסל', eng_name: '', is_active: '1' },
      { id: '3', type_id: '4', name: 'שופרסל', eng_name: 'Shufersal', is_active: '1' },
      { id: '4', type_id: '4', name: 'סגור', eng_name: 'Closed', is_active: '0' },
    ]
    const html = '<script>var x = 1; business_arr = ' + JSON.stringify({ business: rows, business_filters: { a: [{ text: 'x}' }] } }) + '; draw()</script>'
    const r = parseGiftzone(html)
    expect(r).toEqual({ ok: true, items: [
      { canonical_name: "ג'נספורט", aliases: ['JanSport'], source_item_id: '1' },
      { canonical_name: 'שופרסל', aliases: ['Shufersal'], source_item_id: '2' },
    ] })
    expect(parseGiftzone('<html>nothing</html>')).toMatchObject({ ok: false })
    expect(parseGiftzone(html, '6')).toMatchObject({ ok: false, reason: 'wrong_zone_rows' })
    expect(parseGiftzone('business_arr = {"business":"x"}')).toMatchObject({ ok: false })
  })
})
