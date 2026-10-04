// Entry point for the scheduled workflow. Env: INGEST_URL, INGEST_SECRET.
// Prints one line per source (no secrets, no item contents). Exit code is
// non-zero when any source was skipped or rejected so the failure is visible
// in the Actions UI; sources are independent, so the others still apply.
// Run (Node >= 22.18): node scripts/catalog-sync.mjs [--dry-run]
import { syncAll } from './catalog-sync-core.mjs'

const dryRun = process.argv.includes('--dry-run')
const url = process.env.INGEST_URL
const secret = process.env.INGEST_SECRET
if (!dryRun && (!url || !secret)) {
  console.error('INGEST_URL and INGEST_SECRET are required (or pass --dry-run)')
  process.exit(2)
}

const fetchText = async (u) => {
  const r = await fetch(u, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; GiftSmartCatalogSync/1.0)', 'Accept-Language': 'he,en;q=0.8' },
    redirect: 'follow',
    signal: AbortSignal.timeout(30000),
  })
  return { status: r.status, text: await r.text() }
}

const post = dryRun
  ? async (payload) => ({ status: 200, body: { item_count: payload.items.length, dry_run: true } })
  : async (payload) => {
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Ingest-Secret': secret },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(60000),
      })
      let body = null
      try { body = await r.json() } catch { /* non-JSON error body */ }
      return { status: r.status, body }
    }

const results = await syncAll({ fetchText, post })
for (const r of results) console.log(JSON.stringify(r))
const count = (o) => results.filter(r => r.outcome === o).length
console.log(JSON.stringify({ summary: true, applied: count('applied'), skipped: count('skipped'), rejected: count('rejected'), total: results.length }))
process.exit(results.every(r => r.outcome === 'applied') ? 0 : 1)
