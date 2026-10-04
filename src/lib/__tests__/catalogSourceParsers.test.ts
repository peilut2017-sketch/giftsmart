import { describe, it, expect } from 'vitest'
import {
  parseBuymeAll,
  parseSwishPlusHtml,
  parseGiftaHtml,
  unescapeOuterLayer,
  planIngestFromParseResult,
} from '../catalogSourceParsers'

// ============================================================================
// BUYME ALL
// ============================================================================

const BUYME_SAMPLE = JSON.stringify({
  supplier: { id: 13438757, name: 'BUYME ALL - מגוון אדיר במתנה אחת' },
  brands: [
    {
      id: 2208,
      title: 'adidas',
      searchTerms: JSON.stringify(['אדידס וריבוק - adidas & reebok', 'אדידס', 'control', '#casualedge#']),
    },
    {
      id: 17574112,
      title: 'ASA Izakaya',
      searchTerms: JSON.stringify(['אסא', 'asa izakaya', '#foodieheaven#']),
    },
    {
      id: 15673923,
      title: 'טרקלין חשמל',
      searchTerms: JSON.stringify(['traklin', 'תרקלין', '#chefspirit#']),
    },
  ],
})

describe('parseBuymeAll', () => {
  it('extracts canonical_name, aliases, and source_item_id for every brand', () => {
    const result = parseBuymeAll(BUYME_SAMPLE)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.items).toHaveLength(3)
    expect(result.items[0]).toEqual({
      canonical_name: 'adidas',
      aliases: ['אדידס וריבוק - adidas & reebok', 'אדידס', 'control', '#casualedge#'],
      source_item_id: '2208',
    })
    expect(result.items[1].canonical_name).toBe('ASA Izakaya')
    expect(result.items[2].canonical_name).toBe('טרקלין חשמל')
  })

  it('reports invalid_json rather than an empty list for garbage input', () => {
    const result = parseBuymeAll('not json')
    expect(result).toEqual({ ok: false, reason: 'invalid_json' })
  })

  it('reports missing_brands_array rather than an empty list when brands is absent', () => {
    const result = parseBuymeAll(JSON.stringify({ supplier: { id: 13438757 } }))
    expect(result).toEqual({ ok: false, reason: 'missing_brands_array' })
  })

  it('reports unexpected_supplier_id for a structurally valid response from a different supplier', () => {
    const otherSupplier = JSON.stringify({
      supplier: { id: 99999, name: 'Some Other Wallet' },
      brands: [{ id: 1, title: 'Some Brand', searchTerms: '[]' }],
    })
    const result = parseBuymeAll(otherSupplier)
    expect(result).toEqual({ ok: false, reason: 'unexpected_supplier_id' })
  })

  it('an empty (but structurally valid) brands array is ok:true with items:[] — not a parse failure', () => {
    const empty = JSON.stringify({ supplier: { id: 13438757 }, brands: [] })
    expect(parseBuymeAll(empty)).toEqual({ ok: true, items: [] })
  })

  it('keeps a brand but drops its aliases when searchTerms is malformed JSON', () => {
    const bad = JSON.stringify({ supplier: { id: 13438757 }, brands: [{ id: 1, title: 'Bad Brand', searchTerms: '[not valid json' }] })
    expect(parseBuymeAll(bad)).toEqual({ ok: true, items: [{ canonical_name: 'Bad Brand', aliases: [], source_item_id: '1' }] })
  })

  it('skips a brand with a blank title', () => {
    const blank = JSON.stringify({ supplier: { id: 13438757 }, brands: [{ id: 1, title: '   ', searchTerms: '[]' }] })
    expect(parseBuymeAll(blank)).toEqual({ ok: true, items: [] })
  })

  it('deduplicates by id, keeping the first occurrence', () => {
    const dup = JSON.stringify({
      supplier: { id: 13438757 },
      brands: [
        { id: 7, title: 'First Spelling', searchTerms: '[]' },
        { id: 7, title: 'Second Spelling (should be dropped)', searchTerms: '[]' },
      ],
    })
    const result = parseBuymeAll(dup)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.items).toEqual([{ canonical_name: 'First Spelling', aliases: [], source_item_id: '7' }])
  })
})

// ============================================================================
// Swish Plus
// ============================================================================

describe('unescapeOuterLayer', () => {
  it('turns \\" into a bare quote', () => {
    expect(unescapeOuterLayer('\\"a\\":\\"b\\"')).toBe('"a":"b"')
  })

  it('turns \\\\ into a single backslash, leaving a following bare quote alone', () => {
    // Raw input here is the 3 characters: \ \ "  (an escaped backslash,
    // then a bare, already-unescaped quote) — must recover \"  (one
    // backslash followed by a quote), not swallow or double anything.
    const raw = '\\' + '\\' + '"'
    expect(unescapeOuterLayer(raw)).toBe('\\"')
  })

  it('leaves a \\uXXXX escape completely untouched (it belongs to the inner JSON layer)', () => {
    expect(unescapeOuterLayer('\\"name\\":\\"Foo \\u0026 Bar\\"')).toBe('"name":"Foo \\u0026 Bar"')
  })
})

describe('parseSwishPlusHtml', () => {
  it('extracts storeName, chainId, and splits searchKeyWords on ; from a clean escaped fragment', () => {
    const clean = JSON.stringify({
      tagsChains: [
        {
          chainsByWallet: [
            { categoryNumber: 105379, storeName: 'מלון דברה בראון', chainId: 1004970, searchKeyWords: null },
          ],
        },
        {
          chainsByWallet: [
            {
              categoryNumber: 105379,
              storeName: 'VERT לגון נתניה',
              chainId: 1005080,
              searchKeyWords: 'ורט נתניה;וורט נתניה;וורט לגון נתניה',
            },
          ],
        },
      ],
    }).replace(/"/g, '\\"')

    const result = parseSwishPlusHtml(clean)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.items).toHaveLength(2)
    expect(result.items[0]).toEqual({ canonical_name: 'מלון דברה בראון', aliases: [], source_item_id: '1004970' })
    expect(result.items[1]).toEqual({
      canonical_name: 'VERT לגון נתניה',
      aliases: ['ורט נתניה', 'וורט נתניה', 'וורט לגון נתניה'],
      source_item_id: '1005080',
    })
  })

  // The three escape patterns asked for, each isolated in its own minimal,
  // well-formed fixture (constructed to exercise exactly one pattern, not
  // claimed as a live fetch):

  it('escape pattern 1/3 — \\u0026 inside storeName and searchKeyWords survives correctly', () => {
    const withUnicodeEscape = JSON.stringify({
      tagsChains: [{ chainsByWallet: [{
        categoryNumber: 105379,
        storeName: 'H&M',
        chainId: 1,
        searchKeyWords: 'fashion&style;h&m kids',
      }] }],
    }).replace(/"/g, '\\"')

    const result = parseSwishPlusHtml(withUnicodeEscape)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.items).toEqual([{ canonical_name: 'H&M', aliases: ['fashion&style', 'h&m kids'], source_item_id: '1' }])
  })

  it('escape pattern 2/3 — an escaped quote inside a value is recovered correctly', () => {
    // Inner JSON value containing a literal quote: Joe's "Diner" — standard
    // JSON-escapes it as \"Diner\" inside the string. The outer layer then
    // escapes THAT backslash-quote pair's own quote character too, since
    // quotes are escaped wherever they occur.
    const innerJson = JSON.stringify({
      tagsChains: [{ chainsByWallet: [{
        categoryNumber: 105379,
        storeName: 'Joe\'s "Diner"',
        chainId: 2,
      }] }],
    })
    const outerEscaped = innerJson.replace(/\\/g, '\\\\').replace(/"/g, '\\"')

    const result = parseSwishPlusHtml(outerEscaped)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.items).toEqual([{ canonical_name: 'Joe\'s "Diner"', aliases: [], source_item_id: '2' }])
  })

  it('escape pattern 3/3 — a double backslash (an escaped literal backslash) is recovered correctly', () => {
    const innerJson = JSON.stringify({
      tagsChains: [{ chainsByWallet: [{
        categoryNumber: 105379,
        storeName: 'Back\\Slash Co',
        chainId: 3,
      }] }],
    })
    const outerEscaped = innerJson.replace(/\\/g, '\\\\').replace(/"/g, '\\"')

    const result = parseSwishPlusHtml(outerEscaped)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.items).toEqual([{ canonical_name: 'Back\\Slash Co', aliases: [], source_item_id: '3' }])
  })

  it('excludes an object whose categoryNumber does not match, and one with categoryNumber missing', () => {
    const mixed = JSON.stringify({
      tagsChains: [
        { chainsByWallet: [{ categoryNumber: 999999, storeName: 'Wrong Category', chainId: 10 }] },
        { chainsByWallet: [{ storeName: 'No Category At All', chainId: 11 }] },
        { chainsByWallet: [{ categoryNumber: 105379, storeName: 'Right Category', chainId: 12 }] },
      ],
    }).replace(/"/g, '\\"')

    const result = parseSwishPlusHtml(mixed)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.items).toEqual([{ canonical_name: 'Right Category', aliases: [], source_item_id: '12' }])
  })

  it('deduplicates by chainId, keeping the first occurrence', () => {
    const dup = JSON.stringify({
      tagsChains: [
        { chainsByWallet: [{ categoryNumber: 105379, storeName: 'First Spelling', chainId: 42 }] },
        { chainsByWallet: [{ categoryNumber: 105379, storeName: 'Second Spelling (should be dropped)', chainId: 42 }] },
      ],
    }).replace(/"/g, '\\"')

    const result = parseSwishPlusHtml(dup)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.items).toEqual([{ canonical_name: 'First Spelling', aliases: [], source_item_id: '42' }])
  })

  it('reports no_matching_category_objects_found (not []) when nothing matches the expected category', () => {
    const wrongCategoryOnly = JSON.stringify({
      tagsChains: [{ chainsByWallet: [{ categoryNumber: 1, storeName: 'Irrelevant', chainId: 1 }] }],
    }).replace(/"/g, '\\"')
    expect(parseSwishPlusHtml(wrongCategoryOnly)).toEqual({ ok: false, reason: 'no_matching_category_objects_found' })
  })

  it('reports embedded_json_unparsable (not []) for text with no parseable structure at all', () => {
    expect(parseSwishPlusHtml('<html><body>no data here</body></html>')).toEqual({ ok: false, reason: 'embedded_json_unparsable' })
  })

  // Real, verbatim fragment as fetched 2026-10-02 — NOT reconstructed, and
  // genuinely truncated at both ends (it was itself a mid-stream excerpt).
  // This is used specifically to prove the parser reports a real failure
  // on real-but-incomplete data instead of silently returning [] — it does
  // NOT prove the parser works against a full, live page, which remains
  // unverified (this session cannot reach swish.co.il at all; see the
  // session's own egress-proxy log from the earlier round).
  it('reports embedded_json_unparsable (not []) on the real but truncated verbatim fragment', () => {
    const verbatimTruncatedFragment = String.raw`03c/p>\",\"userTypes\":0,\"isOutOfStock\":false,\"isHaveOnlyOneChain\":false,\"tagsChains\":[{\"tagId\":0,\"tagName\":\"אירוח ונופש\",\"tagSort\":0,\"chainsByWallet\":[{\"categoryNumber\":105379,\"storeName\":\"מלון דברה בראון\",\"chainId\":1004970,\"searchKeyWords\":null,\"subBranchRegions\":\"2\",\"logo\":\"https://pics.k4a.co.il/share/NewUploads/BusinessLogo/5734d23e2eae4fb6b3c0590610cca303.png\",\"alt\":\"מלון דברה בראון\",\"tagName\":\"אירוח ונופש\",\"mustToKnow\":\"<p style=\\\"text-align:right\\\"><typing-node><div><br /></div>\",\"whatWillUGet\":\"Swish Plus\",\"remarkVar\":null,\"webSite\":\"https://brownhotels.com/he/debrah\",\"description\":null,\"tagSort\":0,\"branchesByChainID\":null}]},{\"tagId\":0,\"tagName\":\"אירוח ונופש\",\"tagSort\":0,\"chainsByWallet\":[{\"categoryNumber\":105379,\"storeName\":\"VERT לגון נתניה\",\"chainId\":1005080,\"searchKeyWords\":\"ורט נתניה;וורט נתניה;וורט לגון נתניה\",\"subBranchRegions\":\"2\",\"logo\":\"https://pics.k4a.co.il/share/NewUploads/BusinessLogo/cf5dec9c-4051-4a96-afa6-5f5e4`

    const result = parseSwishPlusHtml(verbatimTruncatedFragment)
    expect(result).toEqual({ ok: false, reason: 'embedded_json_unparsable' })
  })
})

// ============================================================================
// Gifta
// ============================================================================

describe('parseGiftaHtml', () => {
  const GIFTA_SAMPLE = `
<h1 class="elementor-heading-title elementor-size-default"><a href="https://gifta.co.il/golf-and-co/">גולף אנד קו</a></h1>
<h1 class="elementor-heading-title elementor-size-default"><a href="https://gifta.co.il/golf/">גולף</a></h1>
<h1 class="elementor-heading-title elementor-size-default"><a href="https://gifta.co.il/keiten/">כיתן</a></h1>
`

  it('extracts every merchant name from the h1/a headings', () => {
    const result = parseGiftaHtml(GIFTA_SAMPLE)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.items.map(i => i.canonical_name)).toEqual(['גולף אנד קו', 'גולף', 'כיתן'])
  })

  it('filters out known noise lines', () => {
    const withNoise = GIFTA_SAMPLE + `
<h1 class="elementor-heading-title elementor-size-default"><a href="#">כי גם לעסק שלך מגיע מתנה</a></h1>
<h1 class="elementor-heading-title elementor-size-default"><a href="#">השאר פרטים ונשמח לחזור אליכם בהקדם</a></h1>
<h1 class="elementor-heading-title elementor-size-default"><a href="#">מחלקים מתנות?</a></h1>
<h1 class="elementor-heading-title elementor-size-default"><a href="#">המבצע עדיין מתבשל</a></h1>
`
    const result = parseGiftaHtml(withNoise)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.items).toHaveLength(3)
  })

  it('strips nested markup (span/strong) and decodes HTML entities', () => {
    const withMarkupAndEntities = `
<h1 class="elementor-heading-title elementor-size-default"><a href="#"><span>Marks & Spencer</span></a></h1>
<h1 class="elementor-heading-title elementor-size-default"><a href="#"><strong>בן & ג&#8217;רי</strong></a></h1>
<h1 class="elementor-heading-title elementor-size-default"><a href="#">Café &amp; Bar</a></h1>
`
    const result = parseGiftaHtml(withMarkupAndEntities)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.items.map(i => i.canonical_name)).toEqual(['Marks & Spencer', 'בן & ג’רי', 'Café & Bar'])
  })

  it('deduplicates by normalized (case-folded, trimmed) name, keeping the first occurrence', () => {
    const dup = `
<h1 class="elementor-heading-title elementor-size-default"><a href="#">Golf</a></h1>
<h1 class="elementor-heading-title elementor-size-default"><a href="#">  GOLF  </a></h1>
`
    const result = parseGiftaHtml(dup)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.items).toEqual([{ canonical_name: 'Golf', aliases: [] }])
  })

  it('reports no_elementor_headings_found (not []) when the page structure does not match at all', () => {
    expect(parseGiftaHtml('<html><body>empty</body></html>')).toEqual({ ok: false, reason: 'no_elementor_headings_found' })
  })
})

// ============================================================================
// Producer/ingest-wrapper boundary (the real producer does not exist yet;
// this proves the DECISION contract it must follow once built)
// ============================================================================

describe('planIngestFromParseResult', () => {
  it('on ok:false, the plan says do not apply (no sync attempt — the caller must not call catalog_apply_snapshot at all)', () => {
    const plan = planIngestFromParseResult({ ok: false, reason: 'invalid_json' })
    expect(plan).toEqual({ shouldApply: false, skippedReason: 'invalid_json' })
  })

  it('on ok:true, the plan says apply with exactly the parsed items', () => {
    const items = [{ canonical_name: 'X', aliases: [] }]
    const plan = planIngestFromParseResult({ ok: true, items })
    expect(plan).toEqual({ shouldApply: true, items })
  })
})
