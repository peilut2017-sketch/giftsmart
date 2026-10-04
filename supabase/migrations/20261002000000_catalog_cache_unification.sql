-- ============================================================================
-- Catalog cache unification — no permanent old/new split. Fixes two
-- regressions found in a follow-up review of the round-2 migration
-- (20261001000000_catalog_foundation.sql) and migrates every existing
-- super_vouchers row onto the single unified cache model.
--
-- Finding 1 (data loss): the round-2 super_vouchers_sync_cache trigger
--   unconditionally recomputed `stores` from stores_manual/catalog_product_key
--   on every write, with no legacy-row awareness. Any unrelated UPDATE to a
--   legacy row (stores_manual still NULL) silently emptied its real `stores`
--   content; the same was true of an INSERT from an old client that only
--   ever supplies `stores`. Reproduced locally before writing this fix:
--   updating `description` on a seeded private row turned `stores` from
--   {"Shop X"} into {}.
--
-- Finding 2 (poisoned staleness baseline): catalog_apply_snapshot's v_latest
--   was "ORDER BY snapshot_version DESC LIMIT 1" with no status='applied'
--   filter, so a REJECTED snapshot (which still consumes the next version
--   number) could become "latest" and wrongly block a genuinely newer valid
--   snapshot as stale_snapshot. Reproduced locally: applied A @10:00 →
--   rejected (bad schema_version) @12:00, taking "latest" by version number
--   → valid B @11:00 wrongly rejected as stale.
--
-- This migration: (a) replaces the trigger function body with an OLD/NEW
-- case-aware version that never recomputes from a NULL stores_manual when
-- nothing relevant changed, (b) fixes catalog_apply_snapshot to track
-- "next version number" (over all history) and "last applied" (status=
-- 'applied' only) as two separate queries, (c) backfills stores_manual for
-- every existing unlinked row BEFORE any product gets linked, with an
-- ID-keyed snapshot table so a later guarded rollback can tell an untouched
-- row apart from one legitimately edited since.
--
-- Explicit decisions carried over from the approved plan:
--   * When both stores_manual and stores change in the same write, manual
--     wins (manual is the one the caller edited on purpose).
--   * NOT NULL on stores_manual is deliberately NOT added here — it would
--     risk emptying a list an old client writes via `stores` before the
--     trigger has a chance to adopt it into manual on that same statement.
--   * Old-client stores-only writes are adopted into stores_manual ONLY for
--     a row that is not linked to a catalog product (catalog_product_key IS
--     NULL) — never for a linked row, so automatically-derived catalog
--     content can never be mistaken for a manual addition.
--   * "Last applied" / staleness comparisons use status='applied' only — a
--     rejected snapshot never moves the reference point.
-- ============================================================================

-- ── 1. Fixed trigger: OLD/NEW case-aware, never derives from a NULL manual
--      list when nothing relevant changed. ────────────────────────────────

CREATE OR REPLACE FUNCTION public.super_vouchers_sync_cache()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- An old client's INSERT that only ever populates `stores` (never
    -- heard of stores_manual) must not lose that content. Gated to an
    -- unlinked row and to a genuinely non-empty NEW.stores, so the
    -- column's own '{}' default on an ordinary omitted-column insert is
    -- never mistaken for "the caller deliberately set an empty list".
    IF NEW.catalog_product_key IS NULL
       AND NEW.stores_manual IS NULL
       AND NEW.stores IS NOT NULL
       AND array_length(NEW.stores, 1) > 0 THEN
      NEW.stores_manual := NEW.stores;
    END IF;
    NEW.stores := public.catalog_effective_stores(NEW.stores_manual, NEW.catalog_product_key);
    NEW.search_terms := public.catalog_effective_search_terms(NEW.stores_manual, NEW.catalog_product_key);
    RETURN NEW;
  END IF;

  -- TG_OP = 'UPDATE' from here on.

  IF NEW.catalog_product_key IS NOT NULL THEN
    -- Linked (still linked, newly linked, or re-linked, and including a
    -- stores_catalog_version bump from catalog_apply_snapshot's bulk
    -- UPDATE): always recompute fresh from the current manual extras plus
    -- the current catalog content. Checked first and unconditionally, so a
    -- linked row's cache is never left stale or driven by a raw `stores`
    -- write.
    NEW.stores := public.catalog_effective_stores(NEW.stores_manual, NEW.catalog_product_key);
    NEW.search_terms := public.catalog_effective_search_terms(NEW.stores_manual, NEW.catalog_product_key);
    RETURN NEW;
  END IF;

  IF OLD.catalog_product_key IS NOT NULL THEN
    -- Just unlinked (NEW.catalog_product_key IS NULL here, since the branch
    -- above already returned otherwise). Must recompute fresh from manual
    -- alone immediately — checked BEFORE the "nothing changed" fallback
    -- below, since nothing else about this row may have changed in the
    -- same statement (admin_unlink_catalog_product only touches
    -- catalog_product_key/stores_catalog_version), which would otherwise
    -- fall through to "preserve OLD" and leave stale catalog content behind.
    NEW.stores := public.catalog_effective_stores(NEW.stores_manual, NULL);
    NEW.search_terms := public.catalog_effective_search_terms(NEW.stores_manual, NULL);
    RETURN NEW;
  END IF;

  -- Never linked, still not linked (OLD.catalog_product_key IS NULL AND
  -- NEW.catalog_product_key IS NULL).

  IF NEW.stores_manual IS DISTINCT FROM OLD.stores_manual THEN
    -- Manual explicitly changed this statement — wins even if `stores` also
    -- changed in the same write (explicit decision: manual wins on both).
    NEW.stores := public.catalog_effective_stores(NEW.stores_manual, NULL);
    NEW.search_terms := public.catalog_effective_search_terms(NEW.stores_manual, NULL);
    RETURN NEW;
  END IF;

  IF NEW.stores IS DISTINCT FROM OLD.stores THEN
    -- Manual untouched, but the raw `stores` column was explicitly written
    -- this statement (an UPDATE's SET clause is the only way NEW.stores can
    -- differ from OLD.stores at this point — a column absent from SET
    -- carries OLD's value into NEW automatically). Same old-client-adoption
    -- semantics as the INSERT branch, now for UPDATE: adopt it into manual.
    NEW.stores_manual := NEW.stores;
    NEW.stores := public.catalog_effective_stores(NEW.stores_manual, NULL);
    NEW.search_terms := public.catalog_effective_search_terms(NEW.stores_manual, NULL);
    RETURN NEW;
  END IF;

  -- Nothing relevant changed. Preserve the existing cache exactly rather
  -- than recomputing: recomputing here would call
  -- catalog_effective_stores(NEW.stores_manual, NULL) with a NEW.stores_manual
  -- that may still be NULL on a legacy row not yet backfilled, which
  -- resolves to '{}' and silently empties real stores content on any
  -- unrelated UPDATE (finding 1, reproduced before this fix).
  NEW.stores := OLD.stores;
  NEW.search_terms := OLD.search_terms;
  RETURN NEW;
END;
$$;
-- Ownership/grants are unchanged from round 2 (REVOKE ALL ... already
-- applied in 20261001000000_catalog_foundation.sql; CREATE OR REPLACE keeps
-- them, and the existing sv_sync_cache trigger keeps pointing at this same
-- function name with no DROP/CREATE TRIGGER needed).

-- ── 2. Fix catalog_apply_snapshot's staleness baseline (finding 2) ────────
-- "Next version number" must still be computed over ALL history (applied or
-- rejected) to avoid colliding with the UNIQUE (product_key, snapshot_version)
-- constraint. "Last applied" — used for the identical-resend short-circuit
-- AND the staleness/ordering check — must be computed separately, filtered
-- to status = 'applied' only, so a rejected snapshot can never become the
-- reference point.

CREATE OR REPLACE FUNCTION public.catalog_apply_snapshot(
  p_product_key      text,
  p_source_hash      text,
  p_fetched_at       timestamptz,
  p_schema_version   int,
  p_source_identity  jsonb,
  p_items            jsonb -- [{"canonical_name","name_he","name_en","aliases":[...]}, ...]
) RETURNS public.catalog_snapshots
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_product          public.catalog_products;
  v_last_version     int;
  v_last_applied     public.catalog_snapshots;
  v_normalized_items jsonb;
  v_count_before     int;
  v_count_new        int;
  v_removed          int;
  v_snapshot         public.catalog_snapshots;
  v_snapshot_version int;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service_role_only';
  END IF;

  -- FOR UPDATE serializes concurrent applies for the SAME product.
  SELECT * INTO v_product FROM public.catalog_products WHERE product_key = p_product_key FOR UPDATE;
  IF NOT FOUND OR v_product.enabled IS NOT TRUE THEN
    RAISE EXCEPTION 'unknown_or_disabled_product';
  END IF;

  -- Next version number: over ALL history, applied or rejected, so a
  -- rejected attempt's version number is never reused (UNIQUE constraint).
  SELECT max(snapshot_version) INTO v_last_version
    FROM public.catalog_snapshots
   WHERE product_key = p_product_key;
  v_snapshot_version := COALESCE(v_last_version, 0) + 1;

  -- Last APPLIED snapshot only — the one and only staleness/idempotency
  -- reference point. A rejected snapshot (e.g. finding 2's bad-schema-
  -- version case) must never become "latest" here, however new its own
  -- version number or fetched_at is.
  SELECT * INTO v_last_applied
    FROM public.catalog_snapshots
   WHERE product_key = p_product_key
     AND status = 'applied'
   ORDER BY snapshot_version DESC
   LIMIT 1;

  -- ── Identical resend: success, no new version, but still backfill any
  --    row that got linked since the last apply (finding #1 from round 2). ──
  IF FOUND AND v_last_applied.source_hash = p_source_hash THEN
    UPDATE public.super_vouchers
       SET stores_catalog_version = v_last_applied.snapshot_version, -- trigger recomputes stores/search_terms as a side effect
           updated_at = now()
     WHERE catalog_product_key = p_product_key
       AND stores_catalog_version IS DISTINCT FROM v_last_applied.snapshot_version;
    RETURN v_last_applied;
  END IF;

  -- ── Stale/out-of-order: different content whose fetched_at is not newer
  --    than the last APPLIED snapshot. Rejected, not silently accepted. ──
  IF FOUND AND p_fetched_at <= v_last_applied.fetched_at THEN
    INSERT INTO public.catalog_snapshots (product_key, snapshot_version, fetched_at, source_hash, item_count, status, reject_reason)
    VALUES (p_product_key, v_snapshot_version, p_fetched_at, p_source_hash, 0, 'rejected', 'stale_snapshot')
    RETURNING * INTO v_snapshot;
    INSERT INTO public.catalog_audit (product_key, snapshot_version, action, reason, performed_by)
    VALUES (p_product_key, v_snapshot_version, 'rejected', 'stale_snapshot', 'ingest-catalog');
    RETURN v_snapshot;
  END IF;

  -- ── Identity/version mismatch — wrong pairing, not an ordinary content
  --    quality issue, but still recorded (not RAISE, per the lesson from
  --    round 2's finding #1: RAISE unwinds its own audit row). ──
  IF p_schema_version IS DISTINCT FROM v_product.schema_version THEN
    INSERT INTO public.catalog_snapshots (product_key, snapshot_version, fetched_at, source_hash, item_count, status, reject_reason)
    VALUES (p_product_key, v_snapshot_version, p_fetched_at, p_source_hash, 0, 'rejected', 'schema_version_mismatch')
    RETURNING * INTO v_snapshot;
    INSERT INTO public.catalog_audit (product_key, snapshot_version, action, reason, performed_by)
    VALUES (p_product_key, v_snapshot_version, 'rejected', 'schema_version_mismatch', 'ingest-catalog');
    RETURN v_snapshot;
  END IF;
  IF (p_source_identity->>'source_key') IS DISTINCT FROM (v_product.source_identity->>'source_key') THEN
    INSERT INTO public.catalog_snapshots (product_key, snapshot_version, fetched_at, source_hash, item_count, status, reject_reason)
    VALUES (p_product_key, v_snapshot_version, p_fetched_at, p_source_hash, 0, 'rejected', 'source_identity_mismatch')
    RETURNING * INTO v_snapshot;
    INSERT INTO public.catalog_audit (product_key, snapshot_version, action, reason, performed_by)
    VALUES (p_product_key, v_snapshot_version, 'rejected', 'source_identity_mismatch', 'ingest-catalog');
    RETURN v_snapshot;
  END IF;

  -- ── Normalize ONCE: trim, drop blanks, dedupe case-insensitively, cap
  --    aliases — and use THIS set (not raw p_items) for every count and for
  --    the actual insert, so a count check can never diverge from what's
  --    really stored (round 2's finding #5). ──
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'canonical_name', x.canonical_name,
           'name_he', x.name_he,
           'name_en', x.name_en,
           'aliases', x.aliases,
           'source_item_id', x.source_item_id
         )), '[]'::jsonb)
    INTO v_normalized_items
  FROM (
    SELECT DISTINCT ON (lower(btrim(it->>'canonical_name')))
      btrim(it->>'canonical_name') AS canonical_name,
      NULLIF(btrim(it->>'name_he'), '') AS name_he,
      NULLIF(btrim(it->>'name_en'), '') AS name_en,
      COALESCE((SELECT array_agg(btrim(a)) FROM jsonb_array_elements_text(COALESCE(it->'aliases', '[]'::jsonb)) a WHERE btrim(a) <> ''), '{}') AS aliases,
      it->>'source_item_id' AS source_item_id,
      ord
    FROM jsonb_array_elements(p_items) WITH ORDINALITY AS t(it, ord)
    WHERE btrim(it->>'canonical_name') <> ''
    ORDER BY lower(btrim(it->>'canonical_name')), ord
  ) x;

  v_count_new := jsonb_array_length(v_normalized_items);
  SELECT count(*) INTO v_count_before FROM public.catalog_items WHERE product_key = p_product_key;

  IF v_count_new < v_product.min_expected_count THEN
    INSERT INTO public.catalog_snapshots (product_key, snapshot_version, fetched_at, source_hash, item_count, status, reject_reason)
    VALUES (p_product_key, v_snapshot_version, p_fetched_at, p_source_hash, v_count_new, 'rejected', 'below_min_expected_count')
    RETURNING * INTO v_snapshot;
    INSERT INTO public.catalog_audit (product_key, snapshot_version, action, count_before, count_after, reason, performed_by)
    VALUES (p_product_key, v_snapshot_version, 'rejected', v_count_before, v_count_new, 'below_min_expected_count', 'ingest-catalog');
    RETURN v_snapshot;
  END IF;

  SELECT count(*) INTO v_removed
  FROM public.catalog_items ci
  WHERE ci.product_key = p_product_key
    AND NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_normalized_items) it
      WHERE it->>'canonical_name' = ci.canonical_name
    );

  IF v_count_before > 0 AND v_removed::numeric / v_count_before > v_product.max_removal_ratio THEN
    INSERT INTO public.catalog_snapshots (product_key, snapshot_version, fetched_at, source_hash, item_count, status, reject_reason)
    VALUES (p_product_key, v_snapshot_version, p_fetched_at, p_source_hash, v_count_new, 'rejected', 'removal_ratio_exceeded')
    RETURNING * INTO v_snapshot;
    INSERT INTO public.catalog_audit (product_key, snapshot_version, action, count_before, count_after, removed_count, reason, performed_by)
    VALUES (p_product_key, v_snapshot_version, 'rejected', v_count_before, v_count_new, v_removed, 'removal_ratio_exceeded', 'ingest-catalog');
    RETURN v_snapshot;
  END IF;

  INSERT INTO public.catalog_snapshots (product_key, snapshot_version, fetched_at, source_hash, item_count, status)
  VALUES (p_product_key, v_snapshot_version, p_fetched_at, p_source_hash, v_count_new, 'applied')
  RETURNING * INTO v_snapshot;

  DELETE FROM public.catalog_items WHERE product_key = p_product_key;
  INSERT INTO public.catalog_items (product_key, canonical_name, name_he, name_en, aliases, source_item_id, snapshot_version)
  SELECT
    p_product_key,
    it->>'canonical_name',
    it->>'name_he',
    it->>'name_en',
    COALESCE((SELECT array_agg(a) FROM jsonb_array_elements_text(it->'aliases') a), '{}'),
    it->>'source_item_id',
    v_snapshot_version
  FROM jsonb_array_elements(v_normalized_items) it;

  -- Recompute the mirrored columns on every super_vouchers row linked to
  -- this product. The actual recompute is the sync-cache trigger's job
  -- (section 1 above) — this UPDATE just needs to touch each linked row.
  UPDATE public.super_vouchers
     SET stores_catalog_version = v_snapshot_version,
         updated_at = now()
   WHERE catalog_product_key = p_product_key;

  INSERT INTO public.catalog_audit (product_key, snapshot_version, action, count_before, count_after, added_count, removed_count, performed_by)
  VALUES (p_product_key, v_snapshot_version, 'applied', v_count_before, v_count_new,
          GREATEST(v_count_new - v_count_before + v_removed, 0), v_removed, 'ingest-catalog');

  RETURN v_snapshot;
END;
$$;
-- Grants unchanged from round 2 (service_role only); CREATE OR REPLACE keeps them.

-- ── 3. Backfill snapshot table (ID-keyed, not updated_at-keyed) ───────────
-- Captures, for every row about to be backfilled, what stores_manual and
-- stores looked like immediately before the backfill, and exactly what
-- value the backfill is about to write into stores_manual. The guarded
-- rollback (20261002000000_catalog_cache_unification_down.sql) compares a
-- row's CURRENT stores_manual against written_stores_manual before
-- reverting anything — a row edited since backfill is skipped and reported,
-- never silently clobbered.

-- old_search_terms is captured for symmetry with old_stores/old_stores_manual
-- even though it is always NULL in practice at this point: search_terms is a
-- round-2-introduced column that nothing ever populated for a pre-existing
-- row before this migration's trigger fix runs, same reasoning as
-- old_stores_manual. Capturing it explicitly (rather than assuming NULL)
-- means the guarded rollback below can restore the exact pre-backfill triple
-- (stores_manual, stores, search_terms) without relying on any assumption
-- that doesn't hold for some future row this reasoning missed.
CREATE TABLE IF NOT EXISTS public.catalog_cache_backfill_snapshot (
  id                     uuid PRIMARY KEY REFERENCES public.super_vouchers(id) ON DELETE CASCADE,
  old_stores_manual      text[],
  old_stores             text[],
  old_search_terms       text[],
  written_stores_manual  text[] NOT NULL,
  captured_at            timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON public.catalog_cache_backfill_snapshot FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.catalog_cache_backfill_snapshot TO service_role;

-- ── 4. One-time backfill: stores_manual = stores for every row that has
--      never been touched by the catalog model (stores_manual IS NULL AND
--      catalog_product_key IS NULL). Must run AFTER section 1's trigger fix
--      is in place, so the backfill UPDATE itself is processed by the fixed
--      trigger (manual-changed branch), producing the canonical
--      trimmed/deduped/sorted form in `stores` as a side effect. Must run
--      BEFORE any of the three products (BUYME ALL / Swish Plus / Gifta)
--      is ever linked to a row, per the approved plan — backfill only ever
--      applies to not-yet-linked rows, and nothing here touches a linked row.
--
-- A row whose `stores` is itself NULL (nullable column, no NOT NULL
-- constraint, though never actually produced by the app) is coalesced to
-- '{}' rather than backfilling stores_manual to NULL — otherwise it would
-- still match "stores_manual IS NULL" and still be exposed to finding 1 on
-- its very next unrelated UPDATE.
--
-- super_vouchers_protect_managed_fields (round 2, section 6) guards ANY
-- write to a row that currently has is_global = true, not only a write that
-- changes is_global/catalog_product_key — reproduced locally: this backfill
-- UPDATE fails outright on the seeded is_global row with "only an admin or
-- the catalog pipeline may set is_global or catalog_product_key" when run
-- the same way the Supabase SQL Editor would run it (no request.jwt.claims
-- in that connection, so auth.role() and auth.uid() both read NULL there —
-- neither the service_role exemption nor the is_admin check passes). This
-- backfill never touches is_global or catalog_product_key, so it is exactly
-- the case that trigger's exemption exists for; scope it narrowly to these
-- two statements and drop it immediately after.
SET request.jwt.claim.role = 'service_role';

INSERT INTO public.catalog_cache_backfill_snapshot (id, old_stores_manual, old_stores, old_search_terms, written_stores_manual)
SELECT id, stores_manual, stores, search_terms, COALESCE(stores, '{}'::text[])
FROM public.super_vouchers
WHERE stores_manual IS NULL AND catalog_product_key IS NULL
ON CONFLICT (id) DO NOTHING;

UPDATE public.super_vouchers
   SET stores_manual = COALESCE(stores, '{}'::text[])
 WHERE stores_manual IS NULL AND catalog_product_key IS NULL;

RESET request.jwt.claim.role;

-- ── 5. Reload PostgREST's schema cache ────────────────────────────────────
SELECT pg_notify('pgrst', 'reload schema');
