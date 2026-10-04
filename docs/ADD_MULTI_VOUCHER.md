# Adding a managed multi-voucher (רב-שובר) catalog product

How to wire a new auto-updating business list (BUYME ALL, Swish Plus, Gifta, or
a future one) into search, without touching application code. Everything here
assumes `supabase/migrations/20261001000000_catalog_foundation.sql` is applied.
Rollback script lives in `supabase/rollback/` (not under `supabase/migrations/`
— see that file's header for why).

## Model

- `super_vouchers` is unchanged as the thing a wallet owns and a voucher links
  to (`vouchers.super_voucher_id`). Its `stores` column is now a **mirror**,
  structurally recomputed by a trigger (`super_vouchers_sync_cache`) on every
  insert/update of the row, from whichever path wrote it — never edit it
  directly, and nothing needs to remember to recompute it.
- `stores_manual` is the only thing an admin edits by hand (via the admin UI,
  which calls `admin_upsert_super_voucher`).
- `catalog_product_key` links a `super_vouchers` row to one row in
  `catalog_products`. Linking is a deliberate, audited, one-row-at-a-time
  action via `admin_link_catalog_product` (see below) — never automatic,
  never by name-matching, and it does NOT auto-carry the row's old `stores`
  list into `stores_manual` — you explicitly decide what manual extras (if
  any) survive the link, after reviewing the diff.
- `stores` (shown to users, used for search) = `stores_manual` ∪ the linked
  product's `catalog_items.canonical_name`.
- `search_terms` = the same union plus `catalog_items.aliases` (e.g. "Golf" /
  "גולף"). SearchPage and InStoreMode search `search_terms`; CheckoutPage
  shows only `stores` (real businesses) to users, never aliases.
- A wallet that owns a global (`is_global=true`) or catalog-linked row **cannot
  be deleted** — the delete is blocked outright (`wallets_block_managed_delete`
  trigger), not silently orphaning the row. Unlink/un-globalize first if you
  actually need to delete that wallet.

## Add a new product

1. Insert one row into `catalog_products` (`service_role`, i.e. the Supabase
   SQL Editor — this table has no client-facing write path on purpose).
   `source_identity` must carry a stable `source_key` — this is checked on
   every ingest, so pick something that won't change day to day (a URL slug,
   not a timestamp):
   ```sql
   INSERT INTO catalog_products (product_key, display_name_he, display_name_en, source_type, source_identity, enabled, min_expected_count, max_removal_ratio, schema_version)
   VALUES ('buyme_all', 'BUYME ALL', 'BUYME ALL', 'manual_watcher', '{"source_key":"buyme-all-official-list","verified_at":"2026-...","note":"..."}'::jsonb, true, 500, 0.2, 1);
   ```
   `enabled` must be `true` for `catalog_apply_snapshot` to accept anything at
   all from this product — there is no separate "dry run" mode. This is safe
   to do immediately: nothing is visible or linked to any user yet. Review the
   result of the first apply (`catalog_snapshots`/`catalog_audit` for this
   `product_key`) and set `enabled = false` again if it's wrong — zero
   user-facing impact either way, since linking is a separate, later step.
2. Write or point an external watcher at the standard snapshot shape and have
   it `POST` to the `ingest-catalog` Edge Function (once deployed — see
   "Not yet wired" below) with header `X-Ingest-Secret: <INGEST_SECRET>`:
   ```json
   {
     "schema_version": 1,
     "product_key": "buyme_all",
     "fetched_at": "2026-10-01T06:00:00Z",
     "source_identity": { "source_key": "buyme-all-official-list" },
     "items": [
       { "canonical_name": "שם העסק", "name_he": "...", "name_en": "...", "aliases": ["כינוי", "Alias"] }
     ]
   }
   ```
   `schema_version` and `source_identity.source_key` must match what's
   registered on `catalog_products` for this `product_key` exactly, or the
   apply is rejected (`schema_version_mismatch` / `source_identity_mismatch`)
   — this stops a misconfigured or wrong watcher from writing into the wrong
   product.
3. Link the specific existing `super_vouchers` row(s) you intend, one at a
   time, as a logged-in admin (no DB key in the browser — both RPCs check
   `profiles.is_admin` server-side):
   ```sql
   -- preview first: what would be added/removed, from the browser via
   -- supabase.rpc('admin_preview_catalog_link', { p_super_voucher_id, p_product_key })
   select * from admin_preview_catalog_link('<sv-id>', 'buyme_all');
   --  current_stores | catalog_stores | would_add | would_remove

   -- then link, passing exactly the manual extras you decided to keep
   -- (an empty array if none) — this does NOT auto-copy the old `stores`:
   select * from admin_link_catalog_product('<sv-id>', 'buyme_all', ARRAY['Extra Shop We Added By Hand']);
   -- stores/search_terms are computed immediately (the sync-cache trigger
   -- fires on this UPDATE too), not just on the next sync.
   ```
   To reverse: `select * from admin_unlink_catalog_product('<sv-id>')` — clears
   `catalog_product_key`, and `stores` immediately reverts to `stores_manual`
   only (no lingering catalog-derived names).

## Updates after linking

- A later `catalog_apply_snapshot` call recomputes `stores`/`search_terms` for
  every row linked to that product, merging the catalog's current content
  with whatever `stores_manual` holds at that time — additions you made to
  `stores_manual` since linking are never clobbered by a sync.
- Re-posting the exact same (normalized) content is a safe no-op: no new
  snapshot version, same `catalog_items`, but it still "catches up" any row
  that was linked since the last real apply (so you don't have to wait for
  content to actually change just to materialize a freshly-linked row).
- A snapshot whose `fetched_at` is not strictly newer than the last *applied*
  snapshot, while its content differs, is rejected as `stale_snapshot` — an
  out-of-order or retried-late fetch can't silently overwrite newer data.

## Limits enforced by `catalog_apply_snapshot`

- `min_expected_count` / `max_removal_ratio` are checked against the actual
  normalized, de-duplicated item set that will be stored — not the raw
  request's array length, so padding a snapshot with blank names can't fake
  a passing count.
- A rejection (`below_min_expected_count`, `removal_ratio_exceeded`,
  `stale_snapshot`, `schema_version_mismatch`, `source_identity_mismatch`) is
  a normal, successful call that returns `status: "rejected"` with a
  `reject_reason` — not a thrown error — so a watcher's own monitoring should
  check the body, not just whether the call succeeded.

## Not yet wired (deliberately — separate approvals)

- `ingest-catalog` is written but **not deployed**. No `INGEST_SECRET` exists
  anywhere yet.
- No scheduler (pg_cron, GitHub Actions cron, external) calls it. The daily
  cadence described in product requirements has no running job behind it
  until one is explicitly set up and approved.
- No watcher/scraper for any specific source (BUYME ALL, Swish Plus, Gifta)
  exists in this repo.

## Existing-row constraints (do not try to work around these)

- `super_vouchers.id` and `.wallet_id` are immutable by trigger — for
  everyone, including `service_role`. A row is never moved between wallets or
  re-keyed; if a row is wrong, fix its fields, don't try to relocate it.
- Setting `is_global`/`catalog_product_key` is blocked by RLS for
  `authenticated` and re-checked by a trigger for every writer except
  `service_role` — the only paths that can do it are `admin_upsert_super_voucher`
  (`is_global`, for a logged-in admin) and `admin_link_catalog_product` /
  `admin_unlink_catalog_product` (`catalog_product_key`, also for a logged-in
  admin — both SECURITY DEFINER, both check `profiles.is_admin` themselves).
  `service_role` is only ever expected to call `catalog_apply_snapshot`.
- A wallet or user holding a global/managed `super_vouchers` row cannot be
  deleted (see Model section above) — this applies to `delete_own_account()`,
  `admin_delete_user()`, and `admin_clear_user_data()` alike, since all three
  ultimately hit the same `wallets` `DELETE`.
