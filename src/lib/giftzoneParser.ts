import type { ParseResult, ParsedCatalogItem } from './catalogSourceParsers.ts'

// ── Giftzone (htzone.co.il/voucher-zone/4) ───────────────────────────────
// The page embeds its full list inline as `business_arr = {"business":[...],
// "business_filters":{...}}`. `business` is one row per business x filter tag,
// so the same id repeats; rows are deduped by id and then by exact name.
// canonical_name = Hebrew `name` (the escape \' is unescaped). The official
// English `eng_name` is kept as an alias when it differs, so the list is
// searchable in Hebrew and English. Only rows of the expected zone (type_id)
// that are active are used. ok:false when the embedded object is missing,
// not parseable, has no business array or has rows of a different zone.
function extractEmbeddedObject(html: string, marker: string): string | null {
  const at = html.indexOf(marker)
  if (at < 0) return null
  const start = html.indexOf('{', at)
  if (start < 0) return null
  let depth = 0
  let inStr = false
  let esc = false
  for (let i = start; i < html.length; i++) {
    const c = html[i]
    if (inStr) {
      if (esc) esc = false
      else if (c === '\\') esc = true
      else if (c === '"') inStr = false
      continue
    }
    if (c === '"') inStr = true
    else if (c === '{') depth++
    else if (c === '}') {
      depth--
      if (depth === 0) return html.slice(start, i + 1)
    }
  }
  return null
}
export function parseGiftzone(rawHtml: string, expectedTypeId = '4'): ParseResult {
  const obj = extractEmbeddedObject(rawHtml, 'business_arr')
  if (!obj) return { ok: false, reason: 'no_embedded_list' }
  let data: unknown
  try {
    data = JSON.parse(obj)
  } catch {
    return { ok: false, reason: 'invalid_embedded_json' }
  }
  const rows = (data as { business?: unknown }).business
  if (!Array.isArray(rows)) return { ok: false, reason: 'no_business_array' }
  const clean = (v: unknown) => (typeof v === 'string' ? v.replace(/\\'/g, "'").replace(/\s+/g, ' ').trim() : '')
  const seenIds = new Set<string>()
  const byName = new Map<string, ParsedCatalogItem>()
  let wrongZone = 0
  let valid = 0
  for (const r of rows) {
    if (typeof r !== 'object' || r === null) continue
    const o = r as Record<string, unknown>
    if (String(o.type_id) !== expectedTypeId) { wrongZone++; continue }
    const id = String(o.id ?? '')
    const name = clean(o.name)
    if (!id || !name) continue
    valid++
    if (o.is_active !== undefined && String(o.is_active) !== '1') continue
    if (seenIds.has(id)) continue
    seenIds.add(id)
    const eng = clean(o.eng_name)
    const aliases = eng && eng !== name ? [eng] : []
    const prev = byName.get(name)
    if (!prev) byName.set(name, { canonical_name: name, aliases, source_item_id: id })
    else prev.aliases = [...new Set([...prev.aliases, ...aliases])]
  }
  if (wrongZone > 0) return { ok: false, reason: 'wrong_zone_rows' }
  if (valid === 0) return { ok: false, reason: 'no_valid_rows' }
  return { ok: true, items: [...byName.values()] }
}
