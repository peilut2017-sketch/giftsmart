/**
 * ingest-catalog — receives one managed multi-voucher catalog snapshot per
 * POST and hands it to the catalog_apply_snapshot() SQL function, which does
 * all real validation/atomicity (min count, removal ratio, idempotency,
 * mirroring stores/search_terms onto linked super_vouchers rows) inside one
 * transaction. This function's job is narrow: authenticate the caller,
 * validate the wire shape, normalize/hash the items, call the RPC, report
 * the result.
 *
 * Auth: a dedicated INGEST_SECRET (NOT the DB service-role key) in the
 * X-Ingest-Secret header, compared in constant time. INGEST_SECRET_NEXT is
 * also accepted so a secret can be rotated without a flag day (both old and
 * new work during the overlap, then drop the old one from secrets).
 *
 * This function is code-only at this stage — not deployed, not linked to
 * any real watcher/cron. Deploying it, setting its secrets, and wiring an
 * actual scheduler are separate, later approvals (see docs/ADD_MULTI_VOUCHER.md).
 *
 * verify_jwt is off for this function (see supabase/config.toml) — same
 * pattern as telegram-bot: there is no end-user JWT to verify here at all,
 * X-Ingest-Secret is the only gate, checked in-function.
 */

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'npm:@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const INGEST_SECRET = Deno.env.get('INGEST_SECRET') || ''
const INGEST_SECRET_NEXT = Deno.env.get('INGEST_SECRET_NEXT') || ''

const MAX_BODY_BYTES = 2 * 1024 * 1024 // 2 MB — generous for ~1,300 names, not open-ended
const MAX_ITEMS = 10_000
const MAX_NAME_LEN = 200
const MAX_ALIASES = 20
const SUPPORTED_SCHEMA_VERSIONS = new Set([1])
const PRODUCT_KEY_RE = /^[a-z0-9_]+$/

function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder()
  const ab = enc.encode(a)
  const bb = enc.encode(b)
  // Compare a fixed, pre-agreed length so the loop itself never branches on
  // where the strings differ (only the final length check does, which is
  // not secret-dependent — both lengths are public once http headers exist).
  const len = Math.max(ab.length, bb.length, 32)
  let diff = ab.length ^ bb.length
  for (let i = 0; i < len; i++) {
    diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0)
  }
  return diff === 0
}

function isAuthorized(req: Request): boolean {
  const provided = req.headers.get('X-Ingest-Secret') || ''
  if (!provided) return false
  const candidates = [INGEST_SECRET, INGEST_SECRET_NEXT].filter(Boolean)
  if (candidates.length === 0) return false // refuse to run wide-open if nothing is configured
  return candidates.some(c => timingSafeEqual(provided, c))
}

type RawItem = {
  canonical_name?: unknown
  name_he?: unknown
  name_en?: unknown
  aliases?: unknown
  source_item_id?: unknown
}

type ValidationError = { ok: false; error: string }
type ValidationOk = {
  ok: true
  items: { canonical_name: string; name_he?: string; name_en?: string; aliases: string[]; source_item_id?: string }[]
}

function normalizeAndValidateItems(raw: unknown): ValidationError | ValidationOk {
  if (!Array.isArray(raw)) return { ok: false, error: 'items_not_an_array' }
  if (raw.length === 0) return { ok: false, error: 'items_empty' }
  if (raw.length > MAX_ITEMS) return { ok: false, error: 'items_too_many' }

  const seen = new Set<string>()
  const items: ValidationOk['items'] = []

  for (const entry of raw as RawItem[]) {
    if (typeof entry !== 'object' || entry === null) return { ok: false, error: 'item_not_an_object' }
    const name = typeof entry.canonical_name === 'string' ? entry.canonical_name.trim() : ''
    if (!name) continue // silently dropped, not rejected — a blank row from the source isn't a business
    if (name.length > MAX_NAME_LEN) return { ok: false, error: 'canonical_name_too_long' }

    const key = name.toLowerCase()
    if (seen.has(key)) continue // dedupe within the same snapshot
    seen.add(key)

    let aliases: string[] = []
    if (entry.aliases !== undefined) {
      if (!Array.isArray(entry.aliases) || !entry.aliases.every(a => typeof a === 'string')) {
        return { ok: false, error: 'aliases_invalid' }
      }
      aliases = (entry.aliases as string[]).map(a => a.trim()).filter(Boolean).slice(0, MAX_ALIASES)
      if (aliases.some(a => a.length > MAX_NAME_LEN)) return { ok: false, error: 'alias_too_long' }
    }

    items.push({
      canonical_name: name,
      name_he: typeof entry.name_he === 'string' ? entry.name_he.trim() : undefined,
      name_en: typeof entry.name_en === 'string' ? entry.name_en.trim() : undefined,
      aliases,
      source_item_id: typeof entry.source_item_id === 'string' ? entry.source_item_id : undefined,
    })
  }

  if (items.length === 0) return { ok: false, error: 'items_empty_after_normalization' }
  return { ok: true, items }
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('')
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type, x-ingest-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  })
}

// Reads the body as bytes under a hard cap, regardless of whether (or how
// accurately) Content-Length was sent — a missing/absent header used to
// bypass the old Content-Length-only check entirely, since req.json() has no
// size limit of its own.
async function readBodyWithLimit(req: Request, maxBytes: number): Promise<string> {
  if (!req.body) return ''
  const reader = req.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (value) {
      total += value.byteLength
      if (total > maxBytes) {
        await reader.cancel()
        throw new Error('payload_too_large')
      }
      chunks.push(value)
    }
  }
  const joined = new Uint8Array(total)
  let offset = 0
  for (const c of chunks) { joined.set(c, offset); offset += c.byteLength }
  return new TextDecoder().decode(joined)
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  if (!isAuthorized(req)) {
    return json({ error: 'unauthorized' }, 401)
  }

  let bodyText: string
  try {
    bodyText = await readBodyWithLimit(req, MAX_BODY_BYTES)
  } catch {
    return json({ error: 'payload_too_large' }, 413)
  }

  let body: unknown
  try {
    body = JSON.parse(bodyText)
  } catch {
    return json({ error: 'invalid_json' }, 400)
  }

  // A syntactically valid JSON value that isn't a plain object (null, an
  // array, a bare number/string) would otherwise crash on the very next
  // property access instead of returning a controlled 400.
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return json({ error: 'invalid_body_shape' }, 400)
  }
  const payload = body as Record<string, unknown>

  const schemaVersion = payload.schema_version
  if (typeof schemaVersion !== 'number' || !SUPPORTED_SCHEMA_VERSIONS.has(schemaVersion)) {
    return json({ error: 'unsupported_schema_version' }, 400)
  }

  const productKey = payload.product_key
  if (typeof productKey !== 'string' || !PRODUCT_KEY_RE.test(productKey)) {
    return json({ error: 'invalid_product_key' }, 400)
  }

  const fetchedAtRaw = payload.fetched_at
  const fetchedAt = typeof fetchedAtRaw === 'string' ? new Date(fetchedAtRaw) : null
  if (!fetchedAt || Number.isNaN(fetchedAt.getTime())) {
    return json({ error: 'invalid_fetched_at' }, 400)
  }

  const sourceIdentity = payload.source_identity
  if (typeof sourceIdentity !== 'object' || sourceIdentity === null || Array.isArray(sourceIdentity)
      || typeof (sourceIdentity as Record<string, unknown>).source_key !== 'string') {
    return json({ error: 'invalid_source_identity' }, 400)
  }

  const validated = normalizeAndValidateItems(payload.items)
  if (!validated.ok) {
    return json({ error: validated.error }, 400)
  }

  // Hash computed from the NORMALIZED item list, not whatever bytes the
  // caller sent — idempotency keys off actual content, not formatting.
  const canonicalForHash = JSON.stringify(
    [...validated.items].sort((a, b) => a.canonical_name.localeCompare(b.canonical_name))
  )
  const sourceHash = await sha256Hex(canonicalForHash)

  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
  const { data, error } = await sb.rpc('catalog_apply_snapshot', {
    p_product_key: productKey,
    p_source_hash: sourceHash,
    p_fetched_at: fetchedAt.toISOString(),
    p_schema_version: schemaVersion,
    p_source_identity: sourceIdentity,
    p_items: validated.items,
  })

  if (error) {
    // unknown_or_disabled_product / service_role_only are real server errors;
    // surface them plainly rather than masking as a generic 500.
    return json({ error: error.message }, 400)
  }

  const row = Array.isArray(data) ? data[0] : data
  const status = row?.status === 'applied' ? 200 : 422 // 'rejected' is a valid outcome, not a crash — but not a 200 either
  return json({
    status: row?.status,
    reject_reason: row?.reject_reason ?? null,
    item_count: row?.item_count ?? validated.items.length,
    snapshot_version: row?.snapshot_version ?? null,
    source_hash: sourceHash,
  }, status)
})
