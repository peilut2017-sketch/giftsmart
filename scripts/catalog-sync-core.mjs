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
import { parseBuymeAll, parseSwishPlusHtml, parseGiftaHtml, planIngestFromParseResult } from '../src/lib/catalogSourceParsers.ts'

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
    id: 'swish',
    productKey: 'swish_plus',
    sourceKey: 'swish-product-105379',
    url: 'https://swish.co.il/home/fashion-and-style-giftcard/product-105379',
    parse: parseSwishPlusHtml,
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

// fetchText(url) -> { status, text }; post(payload) -> { status, body }
export async function syncOne(source, { fetchText, post, now = () => new Date() }) {
  let res
  try {
    res = await fetchText(source.url)
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
