import { describe, it, expect } from 'vitest'
// @ts-expect-error plain .mjs module without types
import { syncOne, syncAll, SOURCES, looksLikeChallengePage } from '../../../scripts/catalog-sync-core.mjs'
import { parseSwishPlusHtml, decodeNextFlightText, parseGiftaHtml, parseStyleRestaurants } from '../catalogSourceParsers'

// Builds a page in the REAL Swish shape: a full HTML document whose data sits
// in self.__next_f.push([1,"<js string>"]) chunks (checked against the live
// page on 2026-10-04). The flight text is split mid-value across two chunks.
function swishPage(chains: object[], splitAt = 0.5): string {
  const flight = `0:["$","html",null,{"children":[{"categoryNumber":150019,"categoryName":"x"}]}]\n` +
    `1b:{"tagsChains":[{"tagId":0,"chainsByWallet":${JSON.stringify(chains)}}]}\n`
  const cut = Math.floor(flight.length * splitAt)
  const lit = (s: string) => JSON.stringify(s)
  return `<!DOCTYPE html><html><head><title>t</title></head><body><script>self.__next_f.push([1,${lit(flight.slice(0, cut))}])</script>` +
    `<script>self.__next_f.push([1,${lit(flight.slice(cut))}])</script></body></html>`
}
const chain = (id: number, name: string, kw = '') => ({ categoryNumber: 105379, storeName: name, chainId: id, searchKeyWords: kw })

describe('parseSwishPlusHtml on a full next-flight page', () => {
  it('parses names with &, quotes and Hebrew, joined across chunk boundaries', () => {
    const r = parseSwishPlusHtml(swishPage([chain(1, 'H&O', 'h and o;אייץ'), chain(2, 'say "hi"'), chain(3, 'גולף')]))
    expect(r).toEqual({ ok: true, items: [
      { canonical_name: 'H&O', aliases: ['h and o', 'אייץ'], source_item_id: '1' },
      { canonical_name: 'say "hi"', aliases: [], source_item_id: '2' },
      { canonical_name: 'גולף', aliases: [], source_item_id: '3' },
    ] })
  })
  it('ignores category objects that are not chain entries and other categories', () => {
    const other = { categoryNumber: 999, storeName: 'other', chainId: 9 }
    const r = parseSwishPlusHtml(swishPage([chain(1, 'a'), other]))
    expect(r.ok && r.items.map(i => i.canonical_name)).toEqual(['a'])
  })
  it('is a parse failure, not an empty list, when no chain matches', () => {
    expect(parseSwishPlusHtml(swishPage([]))).toEqual({ ok: false, reason: 'no_matching_category_objects_found' })
  })
  it('fails (does not silently shrink) when a chunk cannot be decoded', () => {
    const bad = '<script>self.__next_f.push([1,"bad \\q escape"])</script>'
    expect(decodeNextFlightText(bad)).toEqual({ text: '', error: 'next_flight_chunk_undecodable' })
    expect(parseSwishPlusHtml(bad)).toEqual({ ok: false, reason: 'next_flight_chunk_undecodable' })
  })
  it('fails when the chainsByWallet array is cut off', () => {
    const page = swishPage([chain(1, 'a')]).replace(']}]}', '')
    expect(parseSwishPlusHtml(page).ok).toBe(false)
  })
})

describe('parseGiftaHtml entities', () => {
  it('decodes &amp;lt; once, not twice', () => {
    const html = '<h1 class="elementor-heading-title"><a href="#">A &amp;lt; B</a></h1>'
    expect(parseGiftaHtml(html)).toEqual({ ok: true, items: [{ canonical_name: 'A &lt; B', aliases: [] }] })
  })
})

const okSource = (id: string, items: string[]) => ({
  id, productKey: id + '_k', sourceKey: id + '-s', url: 'https://example.invalid/' + id,
  parse: () => ({ ok: true, items: items.map(n => ({ canonical_name: n, aliases: [] })) }),
})

describe('catalog sync core', () => {
  const fixedNow = () => new Date('2026-10-05T03:17:00Z')
  it('posts the documented wire shape for a parsed source', async () => {
    const posted: unknown[] = []
    const r = await syncOne(okSource('a', ['x', 'y']), {
      fetchText: async () => ({ status: 200, text: 'body' }),
      post: async (p: unknown) => { posted.push(p); return { status: 200, body: { item_count: 2 } } },
      now: fixedNow,
    })
    expect(r).toMatchObject({ source: 'a', outcome: 'applied', item_count: 2 })
    expect(posted).toEqual([{ schema_version: 1, product_key: 'a_k', fetched_at: '2026-10-05T03:17:00.000Z',
      source_identity: { source_key: 'a-s' }, items: [{ canonical_name: 'x', aliases: [] }, { canonical_name: 'y', aliases: [] }] }])
  })
  it('never posts on fetch error, non-200, challenge page or parse failure', async () => {
    const post = async () => { throw new Error('must not post') }
    const bad = { ...okSource('b', []), parse: () => ({ ok: false, reason: 'nope' }) }
    expect(await syncOne(okSource('a', ['x']), { fetchText: async () => { throw new Error('net') }, post })).toMatchObject({ outcome: 'skipped', reason: 'fetch_error' })
    expect(await syncOne(okSource('a', ['x']), { fetchText: async () => ({ status: 503, text: '' }), post })).toMatchObject({ outcome: 'skipped', reason: 'http_503' })
    expect(await syncOne(okSource('a', ['x']), { fetchText: async () => ({ status: 200, text: '<title>One moment, please...</title>' }), post })).toMatchObject({ outcome: 'skipped', reason: 'bot_challenge_page' })
    expect(await syncOne(bad, { fetchText: async () => ({ status: 200, text: 'ok' }), post })).toMatchObject({ outcome: 'skipped', reason: 'nope' })
  })
  it('reports a SQL-side rejection and keeps other sources independent', async () => {
    const res = await syncAll({
      fetchText: async (u: string) => (u.endsWith('/a') ? { status: 200, text: 'a' } : { status: 200, text: 'b' }),
      post: async (p: { product_key: string }) => p.product_key === 'a_k'
        ? { status: 422, body: { status: 'rejected', reject_reason: 'below_min_expected_count' } }
        : { status: 200, body: { item_count: 1 } },
    }, [okSource('a', ['x']), okSource('b', ['y'])])
    expect(res.map((r: { source: string; outcome: string; reason?: string }) => [r.source, r.outcome, r.reason])).toEqual([['a', 'rejected', 'below_min_expected_count'], ['b', 'applied', undefined]])
  })
  it('detects challenge pages only near the top of the document', () => {
    expect(looksLikeChallengePage('<title>Just a moment...</title>')).toBe(true)
    expect(looksLikeChallengePage('x'.repeat(5000) + 'Just a moment')).toBe(false)
  })
  it('registers the sources with the source_keys used by the SQL proofs', () => {
    expect(SOURCES.map((s: { sourceKey: string }) => s.sourceKey)).toEqual(['buyme-brands-13438757', 'buyme-brands-13438880', 'style-restaurants-wp-rest', 'swish-product-105379', 'gifta-rashatot-mechabdot'])
  })
  it('parses Style REST posts: decodes entities, dedupes, skips unpublished', () => {
    const raw = JSON.stringify([
      { id: 1, status: 'publish', title: { rendered: 'Pop&#038;Pope' } },
      { id: 2, status: 'publish', title: { rendered: 'JEMS &quot;x&quot; &#8211; y' } },
      { id: 3, status: 'publish', title: { rendered: 'Pop&#038;Pope' } },
      { id: 4, status: 'draft', title: { rendered: 'Hidden' } },
    ])
    const r = parseStyleRestaurants(raw)
    expect(r).toEqual({ ok: true, items: [
      { canonical_name: 'Pop&Pope', aliases: [], source_item_id: '1' },
      { canonical_name: 'JEMS "x" - y', aliases: [], source_item_id: '2' },
    ] })
    expect(parseStyleRestaurants('{"code":"rest_post_invalid_page_number"}')).toMatchObject({ ok: false })
    expect(parseStyleRestaurants('[{"a":1}]')).toMatchObject({ ok: false })
  })
  it('merges paged sources and refuses a silent cut-off', async () => {
    const page = (n: number, c: number) => JSON.stringify(Array.from({ length: c }, (_, i) => ({ id: n * 1000 + i, status: 'publish', title: { rendered: `r${n}-${i}` } })))
    const src = { id: 's', productKey: 'k', sourceKey: 's', url: 'https://x/api?per_page=2', pageParam: 'page', pageSize: 2, maxPages: 3, parse: parseStyleRestaurants }
    const posted: { items: unknown[] }[] = []
    const post = async (p: { items: unknown[] }) => { posted.push(p); return { status: 200, body: { item_count: p.items.length } } }
    const ok = await syncOne(src, { fetchText: async (u: string) => ({ status: 200, text: u.endsWith('page=1') ? page(1, 2) : page(2, 1) }), post })
    expect(ok).toMatchObject({ outcome: 'applied', item_count: 3 })
    const cut = await syncOne(src, { fetchText: async (u: string) => ({ status: 200, text: page(Number(u.slice(-1)), 2) }), post })
    expect(cut).toMatchObject({ outcome: 'skipped', reason: 'fetch_error' })
    const bad = await syncOne(src, { fetchText: async (u: string) => (u.endsWith('page=1') ? { status: 200, text: page(1, 2) } : { status: 400, text: '{}' }), post })
    expect(bad).toMatchObject({ outcome: 'skipped', reason: 'http_400' })
    expect(posted.length).toBe(1)
  })
})
