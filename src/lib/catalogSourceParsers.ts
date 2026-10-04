// Pure, portable parsers for the three initial AUTO catalog sources (BUYME
// ALL, Swish Plus, Gifta). No network access, no Deno/Node-specific APIs —
// these take raw fetched text and return a result, so they can be unit
// tested here and reused as-is inside the eventual ingest-catalog producer.
//
// Not wired into any live fetch path yet — that producer does not exist.
// Built from one real sample response per source plus a documented field
// contract, not from a live, repeated crawl. The HTML/quote escaping layer
// Swish uses has NOT been proven against a full live page — only against
// one verbatim (truncated) real fragment and constructed escape-pattern
// fixtures; see src/lib/__tests__/catalogSourceParsers.test.ts for exactly
// what each test does and does not prove.

export interface ParsedCatalogItem {
  canonical_name: string
  aliases: string[]
  source_item_id?: string
}

// A parser never silently conflates "this isn't a response from the source
// I expect, or I couldn't make sense of it" with "a genuinely empty list" —
// those need different handling downstream (don't sync vs. let the existing
// SQL-side min_expected_count/max_removal_ratio guards judge content
// quality). ok:false must never be produced by content being merely small;
// only by the structural/identity conditions documented on each parser.
export type ParseResult =
  | { ok: true; items: ParsedCatalogItem[] }
  | { ok: false; reason: string }

export interface IngestPlan {
  shouldApply: boolean
  items?: ParsedCatalogItem[]
  skippedReason?: string
}

// What the not-yet-built producer must do with a parser's result: on
// ok:false, never call catalog_apply_snapshot at all for that attempt — no
// snapshot row gets created, no version number is consumed, and whatever
// was last successfully applied is left completely untouched. Expressed as
// a pure decision function so this boundary is directly testable without
// needing the producer's real fetch logic, which does not exist yet.
export function planIngestFromParseResult(result: ParseResult): IngestPlan {
  if (!result.ok) {
    return { shouldApply: false, skippedReason: result.reason }
  }
  return { shouldApply: true, items: result.items }
}

// ── BUYME ALL ────────────────────────────────────────────────────────────
// GET https://buyme.co.il/brands/13438757/options — valid JSON.
// { supplier: { id, name, ... }, brands: [ { id, title, searchTerms: "[...]" (JSON-string), ... } ] }
// canonical_name = brands[].title (trimmed). aliases = JSON.parse(searchTerms)
// — itself a JSON-encoded string, not a native array, so a second parse is
// required; some entries may be malformed, so that parse is guarded.
//
// ok:false conditions (source not recognized / parse failed), exactly two:
//   - no brands array at all
//   - supplier.id is present but does not match expectedSupplierId
// A brands array that is merely empty, or empty after filtering blank
// titles, is ok:true with items:[] — that is a content-quality question for
// the SQL-side min_expected_count check, not a parsing failure.
export function parseBuymeAll(rawJson: string, expectedSupplierId = 13438757): ParseResult {
  let data: unknown
  try {
    data = JSON.parse(rawJson)
  } catch {
    return { ok: false, reason: 'invalid_json' }
  }
  if (typeof data !== 'object' || data === null) {
    return { ok: false, reason: 'not_an_object' }
  }
  const root = data as Record<string, unknown>

  const supplier = root.supplier
  if (typeof supplier === 'object' && supplier !== null) {
    const supplierId = (supplier as Record<string, unknown>).id
    if (supplierId !== undefined && supplierId !== expectedSupplierId) {
      return { ok: false, reason: 'unexpected_supplier_id' }
    }
  }

  if (!Array.isArray(root.brands)) {
    return { ok: false, reason: 'missing_brands_array' }
  }

  const seenIds = new Set<string>()
  const items: ParsedCatalogItem[] = []
  for (const brand of root.brands) {
    if (typeof brand !== 'object' || brand === null) continue
    const b = brand as Record<string, unknown>
    const title = typeof b.title === 'string' ? b.title.trim() : ''
    if (!title) continue

    const sourceItemId = typeof b.id === 'number' || typeof b.id === 'string' ? String(b.id) : undefined
    if (sourceItemId !== undefined) {
      if (seenIds.has(sourceItemId)) continue // duplicate id — keep the first occurrence only
      seenIds.add(sourceItemId)
    }

    let aliases: string[] = []
    if (typeof b.searchTerms === 'string') {
      try {
        const parsed = JSON.parse(b.searchTerms)
        if (Array.isArray(parsed)) {
          aliases = parsed.filter((a): a is string => typeof a === 'string').map(a => a.trim()).filter(Boolean)
        }
      } catch {
        // malformed searchTerms on this one brand — keep the brand, drop its aliases
      }
    }

    items.push({ canonical_name: title, aliases, source_item_id: sourceItemId })
  }
  return { ok: true, items }
}

// ── Swish Plus ───────────────────────────────────────────────────────────
// https://swish.co.il/home/fashion-and-style-giftcard/product-105379 — the
// relevant data is a JSON structure double-encoded as an escaped string
// inside the HTML (quotes appear as the two literal characters \", at
// least in the one real fragment seen). A regex that stops at the first
// backslash (the previous version of this parser) breaks silently the
// moment any value contains ITS OWN legitimate backslash escape — e.g.
// & for "&" — dropping the record (storeName) or emptying its aliases
// (searchKeyWords) with no error. Fixed by properly undoing the ONE known
// escaping layer first (turning the embedded text back into real JSON
// text), then JSON.parse-ing it and walking the result structurally for
// objects shaped like a chainsByWallet entry — never by slicing raw text
// up to the next storeName occurrence.
//
// ok:false conditions, exactly two:
//   - the recovered text does not parse as JSON at all
//   - JSON parses, but zero objects end up with categoryNumber === expectedCategoryNumber
// (this covers both "no chain-shaped objects at all" and "some exist but
// none for this product" — both mean "nothing usable for this product".)
export function parseSwishPlusHtml(rawHtml: string, expectedCategoryNumber = 105379): ParseResult {
  // Real page shape (checked against the live page 2026-10-04): a Next.js
  // flight payload, i.e. many self.__next_f.push([1,"<JS string>"]) chunks
  // inside a full HTML document. Decode those string literals, join them (a
  // value can be split across chunks) and pull out each "chainsByWallet"
  // array. With no such chunks, fall back to the bare escaped-fragment path.
  let candidates: ChainCandidate[]
  const flight = decodeNextFlightText(rawHtml)
  if (flight !== null) {
    if (flight.error) return { ok: false, reason: flight.error }
    const arrays = extractChainsByWalletArrays(flight.text)
    if (arrays === undefined) return { ok: false, reason: 'embedded_json_unparsable' }
    candidates = collectChainCandidates(arrays)
  } else {
    const recovered = unescapeOuterLayer(rawHtml)
    const data = tryParseEmbeddedJson(recovered)
    if (data === undefined) {
      return { ok: false, reason: 'embedded_json_unparsable' }
    }
    candidates = collectChainCandidates(data)
  }

  const seenIds = new Set<string>()
  const items: ParsedCatalogItem[] = []
  for (const chain of candidates) {
    if (chain.categoryNumber !== expectedCategoryNumber) continue
    const storeName = typeof chain.storeName === 'string' ? chain.storeName.trim() : ''
    if (!storeName) continue

    const chainId = typeof chain.chainId === 'number' || typeof chain.chainId === 'string' ? String(chain.chainId) : undefined
    if (chainId !== undefined) {
      if (seenIds.has(chainId)) continue // duplicate chainId — keep the first occurrence only
      seenIds.add(chainId)
    }

    let aliases: string[] = []
    if (typeof chain.searchKeyWords === 'string') {
      aliases = chain.searchKeyWords.split(';').map(a => a.trim()).filter(Boolean)
    }

    items.push({ canonical_name: storeName, aliases, source_item_id: chainId })
  }

  if (items.length === 0) {
    return { ok: false, reason: 'no_matching_category_objects_found' }
  }
  return { ok: true, items }
}

// Undoes ONE layer of "embed this JSON text as a string by escaping its
// quotes and backslashes" — the layer the one real fragment seen exhibits
// (\" for a literal quote). A single left-to-right pass, not independent
// global replaces, because \\" is only unambiguous when read in order:
// an escaped backslash followed by a bare quote is NOT the same thing as
// an escaped quote. Any OTHER backslash sequence (\uXXXX, \n, \/, ...) is
// left completely untouched here — those belong to the INNER JSON layer,
// and JSON.parse (called on the result) decodes them correctly on its own.
// Exported for direct unit testing of the escaping behavior in isolation.
export function unescapeOuterLayer(s: string): string {
  let out = ''
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (c === '\\' && i + 1 < s.length) {
      const next = s[i + 1]
      if (next === '"') { out += '"'; i++; continue }
      if (next === '\\') { out += '\\'; i++; continue }
      // Not an outer-layer escape (e.g. the start of &) — emit the
      // backslash as-is and let the normal loop continue from the next
      // character, so the rest of the sequence passes through untouched.
      out += c
      continue
    }
    out += c
  }
  return out
}

// Returns null when the document has no __next_f push chunks at all. error
// is set when a chunk exists but cannot be decoded: skipping it could drop
// part of the list, so that is a parse failure, not a smaller list.
export function decodeNextFlightText(html: string): { text: string; error?: string } | null {
  const re = /self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)/g
  let text = ''
  let found = 0
  for (const m of html.matchAll(re)) {
    found++
    try {
      text += JSON.parse(m[1]) as string
    } catch {
      return { text: '', error: 'next_flight_chunk_undecodable' }
    }
  }
  return found === 0 ? null : { text }
}

// Finds every "chainsByWallet":[ ... ] array in decoded flight text and
// JSON.parses it with string-aware bracket matching. undefined = an array was
// found but is not valid JSON; [] = none exist.
export function extractChainsByWalletArrays(text: string): unknown[] | undefined {
  const marker = '"chainsByWallet":'
  const out: unknown[] = []
  let from = 0
  for (;;) {
    const at = text.indexOf(marker, from)
    if (at === -1) break
    const start = at + marker.length
    if (text[start] !== '[') { from = start; continue }
    let depth = 0
    let inStr = false
    let end = -1
    for (let i = start; i < text.length; i++) {
      const c = text[i]
      if (inStr) {
        if (c === '\\') i++
        else if (c === '"') inStr = false
      } else if (c === '"') inStr = true
      else if (c === '[') depth++
      else if (c === ']') { depth--; if (depth === 0) { end = i; break } }
    }
    if (end === -1) return undefined
    try {
      out.push(JSON.parse(text.slice(start, end + 1)))
    } catch {
      return undefined
    }
    from = end + 1
  }
  return out
}

function tryParseEmbeddedJson(recovered: string): unknown {
  const trimmed = recovered.trim()
  const attempts = [trimmed]
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
    attempts.push(`{${trimmed}}`)
  }
  for (const attempt of attempts) {
    try {
      return JSON.parse(attempt)
    } catch {
      // try the next attempt, if any
    }
  }
  return undefined
}

interface ChainCandidate {
  storeName?: unknown
  categoryNumber?: unknown
  chainId?: unknown
  searchKeyWords?: unknown
}

// Walks the whole parsed structure looking for every object shaped like a
// chainsByWallet entry (has both storeName and categoryNumber keys),
// regardless of how deeply/where it's nested — more robust to the exact
// containing structure (tagsChains[].chainsByWallet[] per the documented
// contract, or otherwise) than hardcoding that one path, given the full
// page structure has not been directly observed.
function collectChainCandidates(node: unknown, out: ChainCandidate[] = []): ChainCandidate[] {
  if (Array.isArray(node)) {
    for (const item of node) collectChainCandidates(item, out)
  } else if (node !== null && typeof node === 'object') {
    const obj = node as Record<string, unknown>
    if ('storeName' in obj && 'categoryNumber' in obj) {
      out.push(obj as ChainCandidate)
    }
    for (const key of Object.keys(obj)) {
      collectChainCandidates(obj[key], out)
    }
  }
  return out
}

// ── Gifta ────────────────────────────────────────────────────────────────
// https://gifta.co.il/רשתות-מכבדות/ — merchant names are the link text
// inside each <h1 class="elementor-heading-title ..."><a>...</a></h1>. The
// inner content may contain nested markup (e.g. <span>/<strong>) and HTML
// entities (&amp;, &#8217;, numeric refs) — both are stripped/decoded, not
// assumed absent. No stable per-merchant id on this page, so duplicates are
// removed by normalized (trimmed, case-folded) name instead.
//
// ok:false condition, exactly one: no <h1 class="elementor-heading-title...">
// element matches AT ALL (the page's own structure looks different from
// what this parser expects). Headings that match but are all filtered out
// as known noise/promo text result in ok:true with items:[] — again a
// content-quality question for the SQL layer, not a parsing failure, since
// the page's structure itself was still recognized correctly.
const GIFTA_NOISE_LINES = [
  'כי גם לעסק שלך מגיע מתנה',
  'השאר פרטים ונשמח לחזור אליכם בהקדם',
  'מחלקים מתנות?',
]

export function parseGiftaHtml(rawHtml: string): ParseResult {
  const headingRe = /<h1[^>]*class="[^"]*elementor-heading-title[^"]*"[^>]*>\s*<a[^>]*>([\s\S]*?)<\/a>\s*<\/h1>/g
  const matches = [...rawHtml.matchAll(headingRe)]
  if (matches.length === 0) {
    return { ok: false, reason: 'no_elementor_headings_found' }
  }

  const seenNames = new Set<string>()
  const items: ParsedCatalogItem[] = []
  for (const match of matches) {
    const name = normalizeGiftaHeadingText(match[1])
    if (!name) continue
    if (GIFTA_NOISE_LINES.includes(name)) continue
    if (name.includes('מתבשל')) continue

    const key = name.toLowerCase()
    if (seenNames.has(key)) continue // duplicate (by normalized name) — keep the first occurrence only
    seenNames.add(key)

    items.push({ canonical_name: name, aliases: [] })
  }
  return { ok: true, items }
}

function normalizeGiftaHeadingText(innerHtml: string): string {
  const withoutTags = innerHtml.replace(/<[^>]+>/g, '')
  const decoded = decodeHtmlEntities(withoutTags)
  return decoded.replace(/\s+/g, ' ').trim()
}

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&') // last, so &amp;lt; decodes once (to &lt;), not twice
// ALL, Swish Plus, Gifta). No network access, no Deno/Node-specific APIs —
// these take raw fetched text and return a result, so they can be unit
// tested here and reused as-is inside the eventual ingest-catalog producer.
//
// Not wired into any live fetch path yet — that producer does not exist.
// Built from one real sample response per source plus a documented field
// contract, not from a live, repeated crawl. The HTML/quote escaping layer
// Swish uses has NOT been proven against a full live page — only against
// one verbatim (truncated) real fragment and constructed escape-pattern
// fixtures; see src/lib/__tests__/catalogSourceParsers.test.ts for exactly
// what each test does and does not prove.

export interface ParsedCatalogItem {
  canonical_name: string
  aliases: string[]
  source_item_id?: string
}

// A parser never silently conflates "this isn't a response from the source
// I expect, or I couldn't make sense of it" with "a genuinely empty list" —
// those need different handling downstream (don't sync vs. let the existing
// SQL-side min_expected_count/max_removal_ratio guards judge content
// quality). ok:false must never be produced by content being merely small;
// only by the structural/identity conditions documented on each parser.
export type ParseResult =
  | { ok: true; items: ParsedCatalogItem[] }
  | { ok: false; reason: string }

export interface IngestPlan {
  shouldApply: boolean
  items?: ParsedCatalogItem[]
  skippedReason?: string
}

// What the not-yet-built producer must do with a parser's result: on
// ok:false, never call catalog_apply_snapshot at all for that attempt — no
// snapshot row gets created, no version number is consumed, and whatever
// was last successfully applied is left completely untouched. Expressed as
// a pure decision function so this boundary is directly testable without
// needing the producer's real fetch logic, which does not exist yet.
export function planIngestFromParseResult(result: ParseResult): IngestPlan {
  if (!result.ok) {
    return { shouldApply: false, skippedReason: result.reason }
  }
  return { shouldApply: true, items: result.items }
}

// ── BUYME ALL ────────────────────────────────────────────────────────────
// GET https://buyme.co.il/brands/13438757/options — valid JSON.
// { supplier: { id, name, ... }, brands: [ { id, title, searchTerms: "[...]" (JSON-string), ... } ] }
// canonical_name = brands[].title (trimmed). aliases = JSON.parse(searchTerms)
// — itself a JSON-encoded string, not a native array, so a second parse is
// required; some entries may be malformed, so that parse is guarded.
//
// ok:false conditions (source not recognized / parse failed), exactly two:
//   - no brands array at all
//   - supplier.id is present but does not match expectedSupplierId
// A brands array that is merely empty, or empty after filtering blank
// titles, is ok:true with items:[] — that is a content-quality question for
// the SQL-side min_expected_count check, not a parsing failure.
export function parseBuymeAll(rawJson: string, expectedSupplierId = 13438757): ParseResult {
  let data: unknown
  try {
    data = JSON.parse(rawJson)
  } catch {
    return { ok: false, reason: 'invalid_json' }
  }
  if (typeof data !== 'object' || data === null) {
    return { ok: false, reason: 'not_an_object' }
  }
  const root = data as Record<string, unknown>

  const supplier = root.supplier
  if (typeof supplier === 'object' && supplier !== null) {
    const supplierId = (supplier as Record<string, unknown>).id
    if (supplierId !== undefined && supplierId !== expectedSupplierId) {
      return { ok: false, reason: 'unexpected_supplier_id' }
    }
  }

  if (!Array.isArray(root.brands)) {
    return { ok: false, reason: 'missing_brands_array' }
  }

  const seenIds = new Set<string>()
  const items: ParsedCatalogItem[] = []
  for (const brand of root.brands) {
    if (typeof brand !== 'object' || brand === null) continue
    const b = brand as Record<string, unknown>
    const title = typeof b.title === 'string' ? b.title.trim() : ''
    if (!title) continue

    const sourceItemId = typeof b.id === 'number' || typeof b.id === 'string' ? String(b.id) : undefined
    if (sourceItemId !== undefined) {
      if (seenIds.has(sourceItemId)) continue // duplicate id — keep the first occurrence only
      seenIds.add(sourceItemId)
    }

    let aliases: string[] = []
    if (typeof b.searchTerms === 'string') {
      try {
        const parsed = JSON.parse(b.searchTerms)
        if (Array.isArray(parsed)) {
          aliases = parsed.filter((a): a is string => typeof a === 'string').map(a => a.trim()).filter(Boolean)
        }
      } catch {
        // malformed searchTerms on this one brand — keep the brand, drop its aliases
      }
    }

    items.push({ canonical_name: title, aliases, source_item_id: sourceItemId })
  }
  return { ok: true, items }
}

// ── Swish Plus ───────────────────────────────────────────────────────────
// https://swish.co.il/home/fashion-and-style-giftcard/product-105379 — the
// relevant data is a JSON structure double-encoded as an escaped string
// inside the HTML (quotes appear as the two literal characters \", at
// least in the one real fragment seen). A regex that stops at the first
// backslash (the previous version of this parser) breaks silently the
// moment any value contains ITS OWN legitimate backslash escape — e.g.
// & for "&" — dropping the record (storeName) or emptying its aliases
// (searchKeyWords) with no error. Fixed by properly undoing the ONE known
// escaping layer first (turning the embedded text back into real JSON
// text), then JSON.parse-ing it and walking the result structurally for
// objects shaped like a chainsByWallet entry — never by slicing raw text
// up to the next storeName occurrence.
//
// ok:false conditions, exactly two:
//   - the recovered text does not parse as JSON at all
//   - JSON parses, but zero objects end up with categoryNumber === expectedCategoryNumber
// (this covers both "no chain-shaped objects at all" and "some exist but
// none for this product" — both mean "nothing usable for this product".)
export function parseSwishPlusHtml(rawHtml: string, expectedCategoryNumber = 105379): ParseResult {
  // Real page shape (checked against the live page 2026-10-04): a Next.js
  // flight payload, i.e. many self.__next_f.push([1,"<JS string>"]) chunks
  // inside a full HTML document. Decode those string literals, join them (a
  // value can be split across chunks) and pull out each "chainsByWallet"
  // array. With no such chunks, fall back to the bare escaped-fragment path.
  let candidates: ChainCandidate[]
  const flight = decodeNextFlightText(rawHtml)
  if (flight !== null) {
    if (flight.error) return { ok: false, reason: flight.error }
    const arrays = extractChainsByWalletArrays(flight.text)
    if (arrays === undefined) return { ok: false, reason: 'embedded_json_unparsable' }
    candidates = collectChainCandidates(arrays)
  } else {
    const recovered = unescapeOuterLayer(rawHtml)
    const data = tryParseEmbeddedJson(recovered)
    if (data === undefined) {
      return { ok: false, reason: 'embedded_json_unparsable' }
    }
    candidates = collectChainCandidates(data)
  }

  const seenIds = new Set<string>()
  const items: ParsedCatalogItem[] = []
  for (const chain of candidates) {
    if (chain.categoryNumber !== expectedCategoryNumber) continue
    const storeName = typeof chain.storeName === 'string' ? chain.storeName.trim() : ''
    if (!storeName) continue

    const chainId = typeof chain.chainId === 'number' || typeof chain.chainId === 'string' ? String(chain.chainId) : undefined
    if (chainId !== undefined) {
      if (seenIds.has(chainId)) continue // duplicate chainId — keep the first occurrence only
      seenIds.add(chainId)
    }

    let aliases: string[] = []
    if (typeof chain.searchKeyWords === 'string') {
      aliases = chain.searchKeyWords.split(';').map(a => a.trim()).filter(Boolean)
    }

    items.push({ canonical_name: storeName, aliases, source_item_id: chainId })
  }

  if (items.length === 0) {
    return { ok: false, reason: 'no_matching_category_objects_found' }
  }
  return { ok: true, items }
}

// Undoes ONE layer of "embed this JSON text as a string by escaping its
// quotes and backslashes" — the layer the one real fragment seen exhibits
// (\" for a literal quote). A single left-to-right pass, not independent
// global replaces, because \\" is only unambiguous when read in order:
// an escaped backslash followed by a bare quote is NOT the same thing as
// an escaped quote. Any OTHER backslash sequence (\uXXXX, \n, \/, ...) is
// left completely untouched here — those belong to the INNER JSON layer,
// and JSON.parse (called on the result) decodes them correctly on its own.
// Exported for direct unit testing of the escaping behavior in isolation.
export function unescapeOuterLayer(s: string): string {
  let out = ''
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (c === '\\' && i + 1 < s.length) {
      const next = s[i + 1]
      if (next === '"') { out += '"'; i++; continue }
      if (next === '\\') { out += '\\'; i++; continue }
      // Not an outer-layer escape (e.g. the start of &) — emit the
      // backslash as-is and let the normal loop continue from the next
      // character, so the rest of the sequence passes through untouched.
      out += c
      continue
    }
    out += c
  }
  return out
}

// Returns null when the document has no __next_f push chunks at all. error
// is set when a chunk exists but cannot be decoded: skipping it could drop
// part of the list, so that is a parse failure, not a smaller list.
export function decodeNextFlightText(html: string): { text: string; error?: string } | null {
  const re = /self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)/g
  let text = ''
  let found = 0
  for (const m of html.matchAll(re)) {
    found++
    try {
      text += JSON.parse(m[1]) as string
    } catch {
      return { text: '', error: 'next_flight_chunk_undecodable' }
    }
  }
  return found === 0 ? null : { text }
}

// Finds every "chainsByWallet":[ ... ] array in decoded flight text and
// JSON.parses it with string-aware bracket matching. undefined = an array was
// found but is not valid JSON; [] = none exist.
export function extractChainsByWalletArrays(text: string): unknown[] | undefined {
  const marker = '"chainsByWallet":'
  const out: unknown[] = []
  let from = 0
  for (;;) {
    const at = text.indexOf(marker, from)
    if (at === -1) break
    const start = at + marker.length
    if (text[start] !== '[') { from = start; continue }
    let depth = 0
    let inStr = false
    let end = -1
    for (let i = start; i < text.length; i++) {
      const c = text[i]
      if (inStr) {
        if (c === '\\') i++
        else if (c === '"') inStr = false
      } else if (c === '"') inStr = true
      else if (c === '[') depth++
      else if (c === ']') { depth--; if (depth === 0) { end = i; break } }
    }
    if (end === -1) return undefined
    try {
      out.push(JSON.parse(text.slice(start, end + 1)))
    } catch {
      return undefined
    }
    from = end + 1
  }
  return out
}

function tryParseEmbeddedJson(recovered: string): unknown {
  const trimmed = recovered.trim()
  const attempts = [trimmed]
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
    attempts.push(`{${trimmed}}`)
  }
  for (const attempt of attempts) {
    try {
      return JSON.parse(attempt)
    } catch {
      // try the next attempt, if any
    }
  }
  return undefined
}

interface ChainCandidate {
  storeName?: unknown
  categoryNumber?: unknown
  chainId?: unknown
  searchKeyWords?: unknown
}

// Walks the whole parsed structure looking for every object shaped like a
// chainsByWallet entry (has both storeName and categoryNumber keys),
// regardless of how deeply/where it's nested — more robust to the exact
// containing structure (tagsChains[].chainsByWallet[] per the documented
// contract, or otherwise) than hardcoding that one path, given the full
// page structure has not been directly observed.
function collectChainCandidates(node: unknown, out: ChainCandidate[] = []): ChainCandidate[] {
  if (Array.isArray(node)) {
    for (const item of node) collectChainCandidates(item, out)
  } else if (node !== null && typeof node === 'object') {
    const obj = node as Record<string, unknown>
    if ('storeName' in obj && 'categoryNumber' in obj) {
      out.push(obj as ChainCandidate)
    }
    for (const key of Object.keys(obj)) {
      collectChainCandidates(obj[key], out)
    }
  }
  return out
}

// ── Gifta ────────────────────────────────────────────────────────────────
// https://gifta.co.il/רשתות-מכבדות/ — merchant names are the link text
// inside each <h1 class="elementor-heading-title ..."><a>...</a></h1>. The
// inner content may contain nested markup (e.g. <span>/<strong>) and HTML
// entities (&amp;, &#8217;, numeric refs) — both are stripped/decoded, not
// assumed absent. No stable per-merchant id on this page, so duplicates are
// removed by normalized (trimmed, case-folded) name instead.
//
// ok:false condition, exactly one: no <h1 class="elementor-heading-title...">
// element matches AT ALL (the page's own structure looks different from
// what this parser expects). Headings that match but are all filtered out
// as known noise/promo text result in ok:true with items:[] — again a
// content-quality question for the SQL layer, not a parsing failure, since
// the page's structure itself was still recognized correctly.
const GIFTA_NOISE_LINES = [
  'כי גם לעסק שלך מגיע מתנה',
  'השאר פרטים ונשמח לחזור אליכם בהקדם',
  'מחלקים מתנות?',
]

export function parseGiftaHtml(rawHtml: string): ParseResult {
  const headingRe = /<h1[^>]*class="[^"]*elementor-heading-title[^"]*"[^>]*>\s*<a[^>]*>([\s\S]*?)<\/a>\s*<\/h1>/g
  const matches = [...rawHtml.matchAll(headingRe)]
  if (matches.length === 0) {
    return { ok: false, reason: 'no_elementor_headings_found' }
  }

  const seenNames = new Set<string>()
  const items: ParsedCatalogItem[] = []
  for (const match of matches) {
    const name = normalizeGiftaHeadingText(match[1])
    if (!name) continue
    if (GIFTA_NOISE_LINES.includes(name)) continue
    if (name.includes('מתבשל')) continue

    const key = name.toLowerCase()
    if (seenNames.has(key)) continue // duplicate (by normalized name) — keep the first occurrence only
    seenNames.add(key)

    items.push({ canonical_name: name, aliases: [] })
  }
  return { ok: true, items }
}

function normalizeGiftaHeadingText(innerHtml: string): string {
  const withoutTags = innerHtml.replace(/<[^>]+>/g, '')
  const decoded = decodeHtmlEntities(withoutTags)
  return decoded.replace(/\s+/g, ' ').trim()
}

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&') // last, so &amp;lt; decodes once (to &lt;), not twice
}

// ── Style restaurants voucher ────────────────────────────────────────────
// https://food.style.co.il/wp-json/wp/v2/rest?per_page=100&page=N — the
// official WordPress REST collection that feeds the restaurant list on
// food.style.co.il (the static HTML shows only a part of it). The producer
// concatenates the pages into ONE JSON array before calling this parser.
// canonical_name = title.rendered with HTML entities decoded. Entries that
// are not published, have no title, or repeat an already seen name are
// skipped. ok:false only when the input is not a JSON array of objects that
// look like WordPress posts (a "rest_post_invalid_page_number" error object,
// a challenge page, etc.).
const HTML_ENTITIES: Record<string, string> = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ', ndash: '-', mdash: '-' }
function decodeEntities(t: string): string {
  return t.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
      if (!Number.isFinite(code)) return m
      const ch = String.fromCodePoint(code)
      return code === 0x2013 || code === 0x2014 ? '-' : ch
    }
    return HTML_ENTITIES[e.toLowerCase()] ?? m
  })
}
export function parseStyleRestaurants(rawJson: string): ParseResult {
  let data: unknown
  try {
    data = JSON.parse(rawJson)
  } catch {
    return { ok: false, reason: 'invalid_json' }
  }
  if (!Array.isArray(data)) return { ok: false, reason: 'not_an_array' }
  const seen = new Set<string>()
  const items: ParsedCatalogItem[] = []
  let postLike = 0
  for (const e of data) {
    if (typeof e !== 'object' || e === null) continue
    const o = e as Record<string, unknown>
    const title = o.title as Record<string, unknown> | undefined
    if (typeof o.id !== 'number' || !title || typeof title.rendered !== 'string') continue
    postLike++
    if (o.status !== undefined && o.status !== 'publish') continue
    const name = decodeEntities(title.rendered).replace(/\s+/g, ' ').trim()
    if (!name || seen.has(name)) continue
    seen.add(name)
    items.push({ canonical_name: name, aliases: [], source_item_id: String(o.id) })
  }
  if (data.length > 0 && postLike === 0) return { ok: false, reason: 'not_wordpress_posts' }
  return { ok: true, items }
}
