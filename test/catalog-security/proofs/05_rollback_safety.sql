-- Proof that the full-feature rollback (supabase/rollback/
-- 20261001000000_catalog_foundation_down.sql) is only used with its two
-- required properties actually demonstrated, not merely claimed in a
-- comment:
--   1. Every row/column it is about to destroy is captured first, intact,
--      in a *_rollback_backup table.
--   2. The pre-migration write-RLS permission gap on super_vouchers (an
--      ordinary wallet owner's raw UPDATE can set is_global = true with no
--      admin check) is CLOSED before this rollback runs, and genuinely
--      REOPENS after it runs — a real, asserted consequence, not a
--      theoretical one.
--
-- Prerequisites, in order: harness.sql, then
-- supabase/migrations/20261001000000_catalog_foundation.sql, then
-- supabase/migrations/20261002000000_catalog_cache_unification.sql — i.e.
-- this runs the full rollback against the full, current, round-3 state,
-- the only state it will ever actually be run against for real.
--
-- Run from the repo root (relative \i path below depends on it), e.g.:
--   psql -d giftsmart_test -f test/catalog-security/harness.sql
--   psql -d giftsmart_test -f supabase/migrations/20261001000000_catalog_foundation.sql
--   psql -d giftsmart_test -f supabase/migrations/20261002000000_catalog_cache_unification.sql
--   psql -d giftsmart_test -f test/catalog-security/proofs/05_rollback_safety.sql

\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION probe_assert(p_label text, p_ok boolean) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF p_ok THEN
    RAISE NOTICE 'PASS: %', p_label;
  ELSE
    RAISE EXCEPTION 'TEST FAILED: %', p_label;
  END IF;
END;
$$;

-- Attempts p_sql (expected to be a single UPDATE/etc. statement) and ALWAYS
-- leaves zero persisted side effect, regardless of whether it succeeds: on
-- success it deliberately raises its own distinguishable marker exception
-- so the handler's implicit savepoint rollback undoes the write, then
-- reports success; on failure it reports failure. Lets this file prove the
-- permission gap's open/closed state by attempting the EXACT write, for
-- real, under the real 'authenticated' role — never by reading policy
-- definitions — without ever risking that attempt actually landing.
CREATE OR REPLACE FUNCTION probe_dry_run(p_sql text) RETURNS boolean
LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE p_sql;
  RAISE EXCEPTION USING ERRCODE = 'GS099', MESSAGE = 'probe_dry_run_marker_write_succeeded';
EXCEPTION
  WHEN SQLSTATE 'GS099' THEN
    RETURN true;
  WHEN OTHERS THEN
    RETURN false;
END;
$$;

-- ── Seed meaningful "new" data, so the backup-preservation check below is
--    proving something real, not an empty table. ──────────────────────────
SET ROLE service_role; SET request.jwt.claims = '{"role":"service_role"}';
INSERT INTO catalog_products (product_key, display_name_he, source_type, source_identity, enabled, min_expected_count, max_removal_ratio, schema_version)
VALUES ('rollback_proof_prod', 'מוצר הוכחת רולבק', 'manual', '{"source_key":"rp1"}'::jsonb, true, 1, 0.5, 1);
SELECT probe_assert('seed apply succeeds',
  (SELECT status FROM catalog_apply_snapshot('rollback_proof_prod', 'h1', '2026-10-01T06:00:00Z'::timestamptz, 1, '{"source_key":"rp1"}'::jsonb,
    '[{"canonical_name":"Rollback Store A"},{"canonical_name":"Rollback Store B"}]'::jsonb)) = 'applied');
RESET ROLE;

SET ROLE authenticated; SET request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
SELECT probe_assert('seed link succeeds',
  (SELECT (admin_link_catalog_product('dddddddd-dddd-dddd-dddd-dddddddddddd','rollback_proof_prod', ARRAY['Extra Manual'])).catalog_product_key)
    = 'rollback_proof_prod');
RESET ROLE;

-- ── Capture BEFORE-rollback facts for later comparison ────────────────────
SELECT count(*) AS before_sv_count FROM super_vouchers \gset
SELECT count(*) AS before_products_count FROM catalog_products \gset
SELECT count(*) AS before_snapshots_count FROM catalog_snapshots \gset
SELECT count(*) AS before_items_count FROM catalog_items \gset
SELECT count(*) AS before_audit_count FROM catalog_audit \gset
SELECT stores_manual AS before_private_manual FROM super_vouchers WHERE id = 'cccccccc-cccc-cccc-cccc-cccccccccccc' \gset
SELECT catalog_product_key AS before_global_product_key FROM super_vouchers WHERE id = 'dddddddd-dddd-dddd-dddd-dddddddddddd' \gset

-- ── Property 2a (pre-condition): the gap is CLOSED before rollback. An
--    ordinary owner (user_a) cannot set is_global = true on their own
--    private row via a raw UPDATE. ────────────────────────────────────────
SET ROLE authenticated; SET request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
SELECT probe_assert('pre-rollback: owner cannot set is_global directly (gap closed)',
  NOT probe_dry_run($sql$UPDATE public.super_vouchers SET is_global = true WHERE id = 'cccccccc-cccc-cccc-cccc-cccccccccccc'$sql$));
RESET ROLE;

-- Confirm that dry-run attempt truly left no side effect (belt and
-- suspenders on probe_dry_run's own correctness).
SELECT probe_assert('dry-run probe left no side effect',
  (SELECT is_global FROM super_vouchers WHERE id = 'cccccccc-cccc-cccc-cccc-cccccccccccc') = false);

-- ── Run the ACTUAL rollback file — not a reimplementation of it. ──────────
\i supabase/rollback/20261001000000_catalog_foundation_down.sql

-- ── Property 1: every row this rollback destroyed is preserved, intact, in
--    a *_rollback_backup table. ───────────────────────────────────────────
SELECT probe_assert('super_vouchers_rollback_backup row count matches pre-rollback live count',
  (SELECT count(*) FROM super_vouchers_rollback_backup) = :before_sv_count);
SELECT probe_assert('super_vouchers_rollback_backup preserved sv_private.stores_manual exactly',
  (SELECT stores_manual FROM super_vouchers_rollback_backup WHERE id = 'cccccccc-cccc-cccc-cccc-cccccccccccc')
    IS NOT DISTINCT FROM :'before_private_manual'::text[]);
SELECT probe_assert('super_vouchers_rollback_backup preserved sv_global.catalog_product_key exactly',
  (SELECT catalog_product_key FROM super_vouchers_rollback_backup WHERE id = 'dddddddd-dddd-dddd-dddd-dddddddddddd')
    IS NOT DISTINCT FROM :'before_global_product_key');

SELECT probe_assert('catalog_products_rollback_backup row count matches pre-rollback live count',
  (SELECT count(*) FROM catalog_products_rollback_backup) = :before_products_count);
SELECT probe_assert('catalog_snapshots_rollback_backup row count matches pre-rollback live count',
  (SELECT count(*) FROM catalog_snapshots_rollback_backup) = :before_snapshots_count);
SELECT probe_assert('catalog_items_rollback_backup row count matches pre-rollback live count',
  (SELECT count(*) FROM catalog_items_rollback_backup) = :before_items_count);
SELECT probe_assert('catalog_audit_rollback_backup row count matches pre-rollback live count',
  (SELECT count(*) FROM catalog_audit_rollback_backup) = :before_audit_count);

-- ── Live schema really is reverted (structure, not just data gone) ────────
SELECT probe_assert('super_vouchers.catalog_product_key column dropped',
  to_regclass('public.super_vouchers') IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'super_vouchers' AND column_name = 'catalog_product_key'));
SELECT probe_assert('catalog_products table dropped', to_regclass('public.catalog_products') IS NULL);
SELECT probe_assert('single FOR ALL policy restored',
  EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'super_vouchers' AND policyname = 'Wallet owners can manage super vouchers' AND cmd = 'ALL'));
SELECT probe_assert('split per-command policies gone',
  NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'super_vouchers' AND policyname = 'sv_update_owner_unmanaged'));

-- ── Property 2b: the gap REOPENS after rollback — the exact same write
--    that was blocked above now succeeds, for real, as the same owner. ────
SET ROLE authenticated; SET request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
SELECT probe_assert('post-rollback: owner CAN now set is_global directly (gap reopened, confirmed non-silent consequence)',
  probe_dry_run($sql$UPDATE public.super_vouchers SET is_global = true WHERE id = 'cccccccc-cccc-cccc-cccc-cccccccccccc'$sql$));
RESET ROLE;

-- Confirm that dry-run attempt ALSO left no side effect (it is a probe, not
-- a real exploit) — the row's is_global is still false, the gap's existence
-- was demonstrated without actually leaving the row changed.
SELECT probe_assert('post-rollback dry-run probe also left no side effect',
  (SELECT is_global FROM super_vouchers WHERE id = 'cccccccc-cccc-cccc-cccc-cccccccccccc') = false);

\echo 'ALL ROLLBACK SAFETY PROOFS PASSED'
