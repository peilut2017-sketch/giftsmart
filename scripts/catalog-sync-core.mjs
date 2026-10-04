// Fetch -> parse -> POST for the managed catalog sources. Pure of process/env
// so it can be tested with fake fetch/post functions.
//
// Safety rules (the SQL guards in catalog_apply_snapshot stay the final
// judge and are not weakened here):
//  - a source whose fetch fails, looks like a bot-challenge page, or fails to
//    parse is SKIPPED: nothing is posted, so the last applied list stays.
//  - one source failing never blocks the others.
//  - manual additions (stores_manual) are untouched: this only posts the
//    source's own list to ingest-catalog.
import { parseBuymeAll, parseSwishPlusHtml, parseGiftaHtml, parseStyleRestaurants, planIngestFromParseResult } from '../src/lib/catalogSourceParsers.ts'
import { parseGiftzone } from '../src/lib/giftzoneParser.ts'

export const SOURCES = [
  {
    id: 'buyme',
    productKey: 'buyme_all',
    sourceKey: 'buyme-brands-13438757',
    url: 'https://buyme.co.il/brands/13438757/options',
    parse: parseBuymeAll,
  },
  {
    // Same JSON feed as BUYME ALL, different supplier. The supplier id is
    // checked by the parser, so a wrong or swapped feed is rejected.
    id: 'buyme_mix',
    productKey: 'buyme_mix',
    sourceKey: 'buyme-brands-13438880',
    url: 'https://buyme.co.il/brands/13438880/options',
    parse: (raw) => parseBuymeAll(raw, 13438880),
  },
  {
    // Official WordPress REST collection behind food.style.co.il. Fetched
    // page by page (100 per page) and merged into one JSON array.
    id: 'style',
    productKey: 'style_restaurants',
    sourceKey: 'style-restaurants-wp-rest',
    url: 'https://food.style.co.il/wp-json/wp/v2/rest?per_page=100&_fields=id,status,title',
    pageParam: 'page',
    pageSize: 100,
    maxPages: 5,
    parse: parseStyleRestaurants,
  },
  {
    id: 'swish',
    productKey: 'swish_plus',
    sourceKey: 'swish-product-105379',
    url: 'https://swish.co.il/home/fashion-and-style-giftcard/product-105379',
    parse: parseSwishPlusHtml,
  },
  {
    // Union of the two official Swish Perfect pages (consumer 56478 and
    // business 103980), deduped by exact name. All parts must fetch and parse,
    // otherwise nothing is posted. The union does not prove that every name is
    // honored for every holder; the app shows a caveat under Perfect cards.
    id: 'swish_perfect',
    productKey: 'perfect_union',
    sourceKey: 'swish-perfect-union-56478-103980',
    parts: [
      { url: 'https://swish.co.il/home/all-gifts-giftcard/product-56478', parse: (raw) => parseSwishPlusHtml(raw, 56478) },
      { url: 'https://swish.co.il/business/all-gifts-giftcard/product-103980', parse: (raw) => parseSwishPlusHtml(raw, 103980) },
    ],
  },
  {
    // Official GiftZone page (htzone.co.il zone 4). The full list is embedded
    // in the page HTML; the parser rejects any page of another zone.
    id: 'giftzone',
    productKey: 'giftzone',
    sourceKey: 'htzone-voucher-zone-4',
    url: 'https://www.htzone.co.il/voucher-zone/4',
    parse: parseGiftzone,
  },
  {
    id: 'gifta',
    productKey: 'gifta',
    sourceKey: 'gifta-rashatot-mechabdot',
    url: 'https://gifta.co.il/%D7%A8%D7%A9%D7%AA%D7%95%D7%AA-%D7%9E%D7%9B%D7%91%D7%93%D7%95%D7%AA/',
    parse: parseGiftaHtml,
  },
]

const CHALLENGE_MARKERS = ['One moment, please', 'Just a moment', 'cf-browser-verification', 'Attention Required']

export function looksLikeChallengePage(text) {
  const head = text.slice(0, 4000)
  return CHALLENGE_MARKERS.some(m => head.includes(m))
}

// Paged JSON-array sources: fetch page 1, 2, ... until a page returns fewer
// than pageSize items, then return one merged JSON array. Any non-200, bad
// JSON or non-array page makes the whole fetch fail (nothing is posted).
// Hitting maxPages with full pages is treated as an error, never a silent cut.
async function fetchAllPages(source, fetchText) {
  const all = []
  for (let page = 1; page <= source.maxPages; page++) {
    const res = await fetchText(`${source.url}&${source.pageParam}=${page}`)
    if (res.status !== 200) return { status: res.status, text: res.text }
    if (looksLikeChallengePage(res.text)) return { status: 200, text: res.text }
    let arr
    try { arr = JSON.parse(res.text) } catch { return { status: 200, text: 'invalid' } }
    if (!Array.isArray(arr)) return { status: 200, text: 'invalid' }
    all.push(...arr)
    if (arr.length < source.pageSize) return { status: 200, text: JSON.stringify(all) }
  }
  throw new Error('too_many_pages')
}

// Multi-page union source: every part is fetched and parsed on its own; any
// failure skips the whole source. Items are merged by exact canonical name
// (first occurrence wins, aliases are unioned).
async function syncParts(source, { fetchText, post, now = () => new Date() }) {
  const byName = new Map()
  for (const part of source.parts) {
    let res
    try {
      res = await fetchText(part.url)
    } catch (e) {
      return { source: source.id, outcome: 'skipped', reason: 'fetch_error' }
    }
    if (res.status !== 200) return { source: source.id, outcome: 'skipped', reason: `http_${res.status}` }
    if (looksLikeChallengePage(res.text)) return { source: source.id, outcome: 'skipped', reason: 'bot_challenge_page' }
    const plan = planIngestFromParseResult(part.parse(res.text))
    if (!plan.shouldApply) return { source: source.id, outcome: 'skipped', reason: plan.skippedReason }
    for (const it of plan.items) {
      const prev = byName.get(it.canonical_name)
      if (!prev) byName.set(it.canonical_name, { ...it, aliases: [...it.aliases] })
      else prev.aliases = [...new Set([...prev.aliases, ...it.aliases])]
    }
  }
  const out = await post({
    schema_version: 1,
    product_key: source.productKey,
    fetched_at: now().toISOString(),
    source_identity: { source_key: source.sourceKey },
    items: [...byName.values()].map(({ source_item_id, ...rest }) => rest),
  })
  const applied = out.status === 200
  return {
    source: source.id,
    outcome: applied ? 'applied' : 'rejected',
    http: out.status,
    reason: applied ? undefined : (out.body && (out.body.reject_reason || out.body.error)) || 'unknown',
    item_count: out.body && out.body.item_count,
  }
}

// fetchText(url) -> { status, text }; post(payload) -> { status, body }
export async function syncOne(source, { fetchText, post, now = () => new Date() }) {
  if (source.parts) return syncParts(source, { fetchText, post, now })
  let res
  try {
    res = source.pageParam ? await fetchAllPages(source, fetchText) : await fetchText(source.url)
  } catch (e) {
    return { source: source.id, outcome: 'skipped', reason: 'fetch_error' }
  }
  if (res.status !== 200) return { source: source.id, outcome: 'skipped', reason: `http_${res.status}` }
  if (looksLikeChallengePage(res.text)) return { source: source.id, outcome: 'skipped', reason: 'bot_challenge_page' }

  const plan = planIngestFromParseResult(source.parse(res.text))
  if (!plan.shouldApply) return { source: source.id, outcome: 'skipped', reason: plan.skippedReason }

  const out = await post({
    schema_version: 1,
    product_key: source.productKey,
    fetched_at: now().toISOString(),
    source_identity: { source_key: source.sourceKey },
    items: plan.items,
  })
  const applied = out.status === 200
  return {
    source: source.id,
    outcome: applied ? 'applied' : 'rejected',
    http: out.status,
    reason: applied ? undefined : (out.body && (out.body.reject_reason || out.body.error)) || 'unknown',
    item_count: out.body && out.body.item_count,
  }
}

export async function syncAll(deps, sources = SOURCES) {
  const results = []
  for (const s of sources) results.push(await syncOne(s, deps))
  return results
}
