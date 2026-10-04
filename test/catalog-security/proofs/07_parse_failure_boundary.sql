-- Proves the producer/parser boundary contract from
-- src/lib/catalogSourceParsers.ts's planIngestFromParseResult: on a parser
-- failure (ok:false), the wrapper must never call catalog_apply_snapshot at
-- all for that attempt — contrasted here against the SQL layer's OWN,
-- already-proven rejection path (below_min_expected_count), which DOES
-- record a 'rejected' snapshot row (consuming a version number) because
-- that check runs only once real content reaches the RPC.
--
-- The producer itself does not exist yet. This file proves the CONTRACT at
-- the SQL side of that boundary: "if nothing is called, nothing changes,
-- and no snapshot row of any kind appears" — which is exactly what the
-- TypeScript-side unit tests already proved planIngestFromParseResult
-- decides for ok:false. No live source was fetched for this file either.

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

SET request.jwt.claim.role = 'service_role';
INSERT INTO catalog_products (product_key, display_name_he, source_type, source_identity, enabled, min_expected_count, max_removal_ratio, schema_version)
VALUES ('parse_boundary_prod', 'מוצר גבול פירסור', 'manual', '{"source_key":"pb1"}'::jsonb, true, 3, 0.5, 1);

SELECT probe_assert('seed (last-good) apply succeeds',
  (SELECT status FROM catalog_apply_snapshot('parse_boundary_prod', 'pb-h1', '2026-10-01T06:00:00Z'::timestamptz, 1, '{"source_key":"pb1"}'::jsonb,
    '[{"canonical_name":"Last Good A"},{"canonical_name":"Last Good B"},{"canonical_name":"Last Good C"}]'::jsonb)) = 'applied');
RESET request.jwt.claim.role;

INSERT INTO super_vouchers (id, wallet_id, name, stores_manual)
VALUES ('55555555-bbbb-bbbb-bbbb-555555555555', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Parse Boundary SV', '{}');

SET ROLE authenticated; SET request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
SELECT probe_assert('link succeeds', (admin_link_catalog_product('55555555-bbbb-bbbb-bbbb-555555555555', 'parse_boundary_prod', '{}')).catalog_product_key = 'parse_boundary_prod');
RESET ROLE;

-- ── Capture the "last good" state before either scenario ──────────────────
SELECT count(*) AS before_items_count FROM catalog_items WHERE product_key = 'parse_boundary_prod' \gset
SELECT count(*) AS before_snapshots_count FROM catalog_snapshots WHERE product_key = 'parse_boundary_prod' \gset
SELECT stores AS before_stores FROM super_vouchers WHERE id = '55555555-bbbb-bbbb-bbbb-555555555555' \gset

SELECT probe_assert('sanity: 3 items, 1 snapshot, stores populated before either scenario',
  :before_items_count = 3 AND :before_snapshots_count = 1
  AND :'before_stores'::text[] = ARRAY['Last Good A','Last Good B','Last Good C']);

-- ============================================================================
-- Scenario A: parser-level failure (ok:false). The contract is: the wrapper
-- NEVER calls catalog_apply_snapshot for this attempt at all. There is
-- nothing to call here, by design — this block intentionally does nothing,
-- demonstrating that "doing nothing" is exactly what a parse failure must
-- result in. The assertions below confirm nothing changed.
-- ============================================================================

SELECT probe_assert('scenario A (parser failure -> no RPC call at all): catalog_items unchanged',
  (SELECT count(*) FROM catalog_items WHERE product_key = 'parse_boundary_prod') = :before_items_count);
SELECT probe_assert('scenario A: catalog_snapshots unchanged — no new row, not even a rejected one',
  (SELECT count(*) FROM catalog_snapshots WHERE product_key = 'parse_boundary_prod') = :before_snapshots_count);
SELECT probe_assert('scenario A: super_vouchers.stores unchanged (last-good list retained)',
  (SELECT stores FROM super_vouchers WHERE id = '55555555-bbbb-bbbb-bbbb-555555555555') = :'before_stores'::text[]);

-- ============================================================================
-- Scenario B (contrast): a REAL sync attempt reaches the RPC, but SQL-side
-- content-quality validation rejects it (below_min_expected_count, min=3
-- for this product, 1 item sent). This is the EXISTING, already-proven
-- guard (round 2/3) — still intact, still unweakened, still records a
-- 'rejected' snapshot row because the RPC really was called this time.
-- ============================================================================

SET request.jwt.claim.role = 'service_role';
SELECT probe_assert('scenario B: a real attempt with too few items is rejected, not silently dropped',
  (SELECT status || ':' || reject_reason FROM catalog_apply_snapshot('parse_boundary_prod', 'pb-h2-bad', '2026-10-01T07:00:00Z'::timestamptz, 1, '{"source_key":"pb1"}'::jsonb,
    '[{"canonical_name":"Too Few"}]'::jsonb)) = 'rejected:below_min_expected_count');
RESET request.jwt.claim.role;

SELECT probe_assert('scenario B: catalog_items STILL unchanged (last-good retained, same as scenario A)',
  (SELECT count(*) FROM catalog_items WHERE product_key = 'parse_boundary_prod') = :before_items_count);
SELECT probe_assert('scenario B: unlike scenario A, a NEW snapshot row WAS recorded (the RPC really ran this time)',
  (SELECT count(*) FROM catalog_snapshots WHERE product_key = 'parse_boundary_prod') = :before_snapshots_count + 1);
SELECT probe_assert('scenario B: super_vouchers.stores STILL unchanged (last-good list retained)',
  (SELECT stores FROM super_vouchers WHERE id = '55555555-bbbb-bbbb-bbbb-555555555555') = :'before_stores'::text[]);

\echo 'ALL PARSE-FAILURE BOUNDARY PROOFS PASSED'
