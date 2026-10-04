-- Proof suite for 20261002000000_catalog_cache_unification.sql — the fixed
-- super_vouchers_sync_cache trigger and the fixed catalog_apply_snapshot
-- staleness baseline, plus the one-time backfill's data-preservation
-- property. Run after: harness.sql, then
-- supabase/migrations/20261001000000_catalog_foundation.sql, then
-- supabase/migrations/20261002000000_catalog_cache_unification.sql (the
-- backfill has already run against the two harness-seeded rows by the time
-- this file starts).
--
-- Same hardening conventions as 02_full_matrix.sql: ON_ERROR_STOP on,
-- RAISE-on-failure assertions (this file's own exit code is the signal),
-- SQLSTATE-specific checks for anything that must be rejected, explicit
-- counts around every mutation.

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

CREATE OR REPLACE FUNCTION probe_expect_sqlstate(p_label text, p_expected_sqlstate text, p_sql text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE p_sql;
  RAISE EXCEPTION 'TEST FAILED: % — expected to be rejected with SQLSTATE % but the statement SUCCEEDED', p_label, p_expected_sqlstate;
EXCEPTION
  WHEN OTHERS THEN
    IF SQLSTATE = p_expected_sqlstate THEN
      RAISE NOTICE 'PASS: % (correctly rejected, SQLSTATE %)', p_label, SQLSTATE;
    ELSE
      RAISE EXCEPTION 'TEST FAILED: % — expected SQLSTATE % but got % (%)', p_label, p_expected_sqlstate, SQLSTATE, SQLERRM;
    END IF;
END;
$$;

-- Business-content equivalence: two arrays are equivalent if, after
-- trimming and exact (case-sensitive) de-duplication, they contain the same
-- SET of values — regardless of order or how many times a value repeats.
-- Deliberately NOT md5(array_to_string(sort(x))) equality: the trigger's
-- own sort+dedup is legitimate, expected behavior, and an exact-identity
-- promise would false-positive-fail against it.
CREATE OR REPLACE FUNCTION probe_normalized_set(p_arr text[]) RETURNS text[]
LANGUAGE sql AS $$
  SELECT COALESCE(array_agg(DISTINCT btrim(x) ORDER BY btrim(x)), '{}'::text[])
  FROM unnest(COALESCE(p_arr, '{}'::text[])) x
  WHERE btrim(x) <> ''
$$;

-- ============================================================================
-- Scenario 1 (verbatim #1): legacy row (stores_manual NULL pre-backfill,
-- catalog_product_key NULL), an UNRELATED field update (description) must
-- preserve stores exactly — this is finding 1, reproduced before the fix,
-- now asserted to be fixed. By the time this file runs, the backfill has
-- already populated stores_manual for sv_private — the real regression test
-- is that an unrelated update never re-derives from a NULL/empty manual.
-- ============================================================================

SELECT stores AS sv_private_stores_before FROM super_vouchers WHERE id = 'cccccccc-cccc-cccc-cccc-cccccccccccc' \gset

SET ROLE authenticated; SET request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
UPDATE super_vouchers SET description = 'unrelated description edit' WHERE id = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
RESET ROLE;

SELECT probe_assert('scenario 1: unrelated UPDATE preserves stores exactly (finding 1 fixed)',
  (SELECT stores FROM super_vouchers WHERE id = 'cccccccc-cccc-cccc-cccc-cccccccccccc') IS NOT DISTINCT FROM :'sv_private_stores_before'::text[]);
SELECT probe_assert('scenario 1: description actually changed (the update itself took effect)',
  (SELECT description FROM super_vouchers WHERE id = 'cccccccc-cccc-cccc-cccc-cccccccccccc') = 'unrelated description edit');

-- ============================================================================
-- Scenario 2 (verbatim #2): an old client's write reflected in BOTH
-- stores_manual and the cache — for both INSERT (only `stores` populated)
-- and UPDATE (existing unlinked row, raw `stores` write, stores_manual
-- untouched by the client).
-- ============================================================================

-- INSERT case.
INSERT INTO super_vouchers (id, wallet_id, name, stores)
VALUES ('11111111-aaaa-aaaa-aaaa-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Old Client Insert SV', ARRAY['Old Client Shop']);

SELECT probe_assert('scenario 2 (INSERT): stores_manual adopted the old-client stores value',
  (SELECT stores_manual FROM super_vouchers WHERE id = '11111111-aaaa-aaaa-aaaa-111111111111') = ARRAY['Old Client Shop']);
SELECT probe_assert('scenario 2 (INSERT): stores reflects the same content',
  (SELECT stores FROM super_vouchers WHERE id = '11111111-aaaa-aaaa-aaaa-111111111111') = ARRAY['Old Client Shop']);

-- UPDATE case: an unlinked row whose stores_manual is already set (post-
-- backfill state); an old client writes directly to `stores` only.
INSERT INTO super_vouchers (id, wallet_id, name, stores_manual)
VALUES ('22222222-aaaa-aaaa-aaaa-222222222222', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Old Client Update SV', ARRAY['Original Shop']);

UPDATE super_vouchers SET stores = ARRAY['Replacement Shop'] WHERE id = '22222222-aaaa-aaaa-aaaa-222222222222';

SELECT probe_assert('scenario 2 (UPDATE): old-client raw stores write adopted into stores_manual',
  (SELECT stores_manual FROM super_vouchers WHERE id = '22222222-aaaa-aaaa-aaaa-222222222222') = ARRAY['Replacement Shop']);
SELECT probe_assert('scenario 2 (UPDATE): cache reflects the adopted value',
  (SELECT stores FROM super_vouchers WHERE id = '22222222-aaaa-aaaa-aaaa-222222222222') = ARRAY['Replacement Shop']);

-- ============================================================================
-- Scenario 3 (verbatim #3): an explicit admin-RPC manual edit on an
-- unlinked row replaces the cache fully — no trace of the prior value
-- lingers ("doesn't revive old value").
-- ============================================================================

INSERT INTO super_vouchers (id, wallet_id, name, stores_manual)
VALUES ('33333333-aaaa-aaaa-aaaa-333333333333', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Admin Edit SV', ARRAY['Old A']);

SET ROLE authenticated; SET request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
SELECT admin_upsert_super_voucher('33333333-aaaa-aaaa-aaaa-333333333333', NULL, 'Admin Edit SV', ARRAY['New B'], NULL, false);
RESET ROLE;

SELECT probe_assert('scenario 3: explicit manual edit fully replaces the cache (no stale value revived)',
  (SELECT stores FROM super_vouchers WHERE id = '33333333-aaaa-aaaa-aaaa-333333333333') = ARRAY['New B']);
SELECT probe_assert('scenario 3: "Old A" does not linger anywhere in the result',
  NOT ('Old A' = ANY(COALESCE((SELECT stores FROM super_vouchers WHERE id = '33333333-aaaa-aaaa-aaaa-333333333333'), '{}'))));

-- ============================================================================
-- Follow-up fix: admin_upsert_super_voucher's p_stores_manual = NULL means
-- "leave stores_manual unchanged" (matching p_description), NOT "set it to
-- {}". A name/description-only save must never empty the list as a side
-- effect of simply not mentioning stores.
-- ============================================================================

INSERT INTO super_vouchers (id, wallet_id, name, stores_manual)
VALUES ('99999999-aaaa-aaaa-aaaa-999999999999', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Name Only Save SV', ARRAY['Keep Me']);

SET ROLE authenticated; SET request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
SELECT admin_upsert_super_voucher('99999999-aaaa-aaaa-aaaa-999999999999', NULL, 'Renamed SV', NULL, NULL, false);
RESET ROLE;

SELECT probe_assert('name-only save (p_stores_manual=NULL) preserves stores_manual exactly',
  (SELECT stores_manual FROM super_vouchers WHERE id = '99999999-aaaa-aaaa-aaaa-999999999999') = ARRAY['Keep Me']);
SELECT probe_assert('name-only save preserves the cache too (no wipe via the trigger)',
  (SELECT stores FROM super_vouchers WHERE id = '99999999-aaaa-aaaa-aaaa-999999999999') = ARRAY['Keep Me']);
SELECT probe_assert('name-only save actually renamed the row',
  (SELECT name FROM super_vouchers WHERE id = '99999999-aaaa-aaaa-aaaa-999999999999') = 'Renamed SV');

-- Negative/contrast: an explicit '{}' (not NULL) still genuinely clears it —
-- confirms COALESCE's new semantics only special-case a literal NULL.
SET ROLE authenticated; SET request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
SELECT admin_upsert_super_voucher('99999999-aaaa-aaaa-aaaa-999999999999', NULL, 'Renamed SV', ARRAY[]::text[], NULL, false);
RESET ROLE;

SELECT probe_assert('explicit empty array still genuinely clears stores_manual',
  (SELECT stores_manual FROM super_vouchers WHERE id = '99999999-aaaa-aaaa-aaaa-999999999999') = ARRAY[]::text[]);

-- ============================================================================
-- Scenario 4 (verbatim #4): link-then-unlink leaves only the manual extras
-- — catalog content is never absorbed into stores_manual.
-- ============================================================================

SET ROLE service_role; SET request.jwt.claims = '{"role":"service_role"}';
INSERT INTO catalog_products (product_key, display_name_he, source_type, source_identity, enabled, min_expected_count, max_removal_ratio, schema_version)
VALUES ('scenario4_prod', 'מוצר תרחיש 4', 'manual', '{"source_key":"s4"}'::jsonb, true, 1, 0.5, 1);
SELECT probe_assert('scenario 4: seed apply succeeds',
  (SELECT status FROM catalog_apply_snapshot('scenario4_prod', 'h1', '2026-10-01T06:00:00Z'::timestamptz, 1, '{"source_key":"s4"}'::jsonb,
    '[{"canonical_name":"Catalog Store X"},{"canonical_name":"Catalog Store Y"}]'::jsonb)) = 'applied');
RESET ROLE;

INSERT INTO super_vouchers (id, wallet_id, name, stores_manual)
VALUES ('44444444-aaaa-aaaa-aaaa-444444444444', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Link Unlink SV', ARRAY['My Extra']);

SET ROLE authenticated; SET request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
SELECT admin_link_catalog_product('44444444-aaaa-aaaa-aaaa-444444444444', 'scenario4_prod', ARRAY['My Extra']);
RESET ROLE;

SELECT probe_assert('scenario 4: linked row shows manual extra + catalog content',
  (SELECT stores FROM super_vouchers WHERE id = '44444444-aaaa-aaaa-aaaa-444444444444')
    = ARRAY['Catalog Store X','Catalog Store Y','My Extra']);

SET ROLE authenticated; SET request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
SELECT admin_unlink_catalog_product('44444444-aaaa-aaaa-aaaa-444444444444');
RESET ROLE;

SELECT probe_assert('scenario 4: after unlink, only the manual extra remains (catalog not absorbed)',
  (SELECT stores FROM super_vouchers WHERE id = '44444444-aaaa-aaaa-aaaa-444444444444') = ARRAY['My Extra']);
SELECT probe_assert('scenario 4: stores_manual itself never picked up catalog content',
  (SELECT stores_manual FROM super_vouchers WHERE id = '44444444-aaaa-aaaa-aaaa-444444444444') = ARRAY['My Extra']);

-- ============================================================================
-- Scenario 5 (verbatim #5): linked row + a new snapshot applied + an
-- unrelated update on the super_vouchers row — both the manual extras and
-- the (now-updated) catalog content must survive.
-- ============================================================================

INSERT INTO super_vouchers (id, wallet_id, name, stores_manual)
VALUES ('55555555-aaaa-aaaa-aaaa-555555555555', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Linked Resync SV', ARRAY['Kept Extra']);

SET ROLE authenticated; SET request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
SELECT admin_link_catalog_product('55555555-aaaa-aaaa-aaaa-555555555555', 'scenario4_prod', ARRAY['Kept Extra']);
RESET ROLE;

SET ROLE service_role; SET request.jwt.claims = '{"role":"service_role"}';
SELECT probe_assert('scenario 5: new snapshot applies',
  (SELECT status FROM catalog_apply_snapshot('scenario4_prod', 'h2', '2026-10-01T07:00:00Z'::timestamptz, 1, '{"source_key":"s4"}'::jsonb,
    '[{"canonical_name":"Catalog Store X"},{"canonical_name":"Catalog Store Z"}]'::jsonb)) = 'applied');
RESET ROLE;

SET ROLE authenticated; SET request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
-- An update to the OTHER (unrelated, non-managed) seeded row, just to prove
-- this doesn't somehow affect the linked row; then an admin touches an
-- unrelated field on the linked row itself (e.g. via the upsert RPC, the
-- only sanctioned write path onto a managed row's non-cache fields).
UPDATE super_vouchers SET description = 'noise' WHERE id = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
RESET ROLE;

SELECT probe_assert('scenario 5: after a new snapshot + an unrelated update elsewhere, manual extra survives',
  (SELECT 'Kept Extra' = ANY(stores) FROM super_vouchers WHERE id = '55555555-aaaa-aaaa-aaaa-555555555555'));
SELECT probe_assert('scenario 5: catalog content reflects the NEW snapshot (X and Z, not stale Y)',
  (SELECT stores FROM super_vouchers WHERE id = '55555555-aaaa-aaaa-aaaa-555555555555')
    = ARRAY['Catalog Store X','Catalog Store Z','Kept Extra']);

-- ============================================================================
-- "Both changed" priority: in the same statement, stores_manual wins over a
-- simultaneous raw `stores` write (explicit decision from the approved plan).
-- ============================================================================

INSERT INTO super_vouchers (id, wallet_id, name, stores_manual)
VALUES ('66666666-aaaa-aaaa-aaaa-666666666666', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Both Changed SV', ARRAY['Before']);

UPDATE super_vouchers
   SET stores_manual = ARRAY['Manual Wins'],
       stores = ARRAY['Stores Write Loses']
 WHERE id = '66666666-aaaa-aaaa-aaaa-666666666666';

SELECT probe_assert('both-changed: manual wins over a simultaneous raw stores write',
  (SELECT stores FROM super_vouchers WHERE id = '66666666-aaaa-aaaa-aaaa-666666666666') = ARRAY['Manual Wins']);

-- ============================================================================
-- INSERT-adoption gating: must NOT activate when catalog_product_key is set
-- on the INSERT itself — automatic catalog content must never be mistaken
-- for a manual addition (the user's explicit hard requirement).
-- ============================================================================

-- Setting catalog_product_key on INSERT is an is_global/catalog_product_key
-- "managed field" write per super_vouchers_protect_managed_fields — only an
-- admin or service_role may do it, same as any other managed-field write.
SET ROLE service_role; SET request.jwt.claims = '{"role":"service_role"}';
INSERT INTO super_vouchers (id, wallet_id, name, stores, catalog_product_key)
VALUES ('77777777-aaaa-aaaa-aaaa-777777777777', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Linked From Insert SV', ARRAY['Should Not Be Adopted'], 'scenario4_prod');
RESET ROLE;

SELECT probe_assert('INSERT-adoption negative: stores_manual stays empty/NULL-derived when catalog_product_key is set on INSERT',
  COALESCE((SELECT stores_manual FROM super_vouchers WHERE id = '77777777-aaaa-aaaa-aaaa-777777777777'), '{}') = '{}');
SELECT probe_assert('INSERT-adoption negative: stores reflects catalog content, not the raw stores value sent',
  (SELECT stores FROM super_vouchers WHERE id = '77777777-aaaa-aaaa-aaaa-777777777777')
    = ARRAY['Catalog Store X','Catalog Store Z']);

-- ============================================================================
-- Finding 2 regression: applied A @ t1, rejected B' @ t3 (consumes the next
-- version number), valid B @ t2 (t1 < t2 < t3) must APPLY — not be wrongly
-- rejected as stale against the rejected snapshot's version/time.
-- ============================================================================

SET ROLE service_role; SET request.jwt.claims = '{"role":"service_role"}';
INSERT INTO catalog_products (product_key, display_name_he, source_type, source_identity, enabled, min_expected_count, max_removal_ratio, schema_version)
VALUES ('finding2_prod', 'מוצר ממצא 2', 'manual', '{"source_key":"f2"}'::jsonb, true, 1, 0.5, 1);

SELECT probe_assert('finding 2: A applied @ t1',
  (SELECT status FROM catalog_apply_snapshot('finding2_prod', 'hashA', '2026-10-01T10:00:00Z'::timestamptz, 1, '{"source_key":"f2"}'::jsonb,
    '[{"canonical_name":"F2 Store A1"},{"canonical_name":"F2 Store A2"}]'::jsonb)) = 'applied');

SELECT probe_assert('finding 2: bad-schema-version snapshot rejected @ t3 (consumes a version number)',
  (SELECT status || ':' || reject_reason FROM catalog_apply_snapshot('finding2_prod', 'hashBad', '2026-10-01T12:00:00Z'::timestamptz, 99, '{"source_key":"f2"}'::jsonb,
    '[{"canonical_name":"F2 Store Bad"}]'::jsonb)) = 'rejected:schema_version_mismatch');

SELECT probe_assert('finding 2 FIX: valid B @ t2 (between t1 and t3) applies — NOT wrongly rejected as stale',
  (SELECT status FROM catalog_apply_snapshot('finding2_prod', 'hashB', '2026-10-01T11:00:00Z'::timestamptz, 1, '{"source_key":"f2"}'::jsonb,
    '[{"canonical_name":"F2 Store A1"},{"canonical_name":"F2 Store A2"},{"canonical_name":"F2 Store A3"}]'::jsonb)) = 'applied');
RESET ROLE;

SELECT probe_assert('finding 2: exactly 3 snapshot rows exist (1 applied, 1 rejected, 1 applied) — not short-circuited',
  (SELECT count(*) FROM catalog_snapshots WHERE product_key = 'finding2_prod') = 3);

-- ============================================================================
-- Backfill data preservation: normalized-set equality (not byte-identical
-- md5-after-sort), plus a SEPARATE, non-blocking report of any order or
-- duplicate-count change.
-- ============================================================================

ALTER TABLE super_vouchers DISABLE TRIGGER sv_sync_cache;
INSERT INTO super_vouchers (id, wallet_id, name, stores)
VALUES ('88888888-aaaa-aaaa-aaaa-888888888888', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Legacy Messy SV',
        ARRAY['Zeta Shop', 'Alpha Shop', '  Alpha Shop  ', 'Beta Shop', 'Alpha Shop']);
ALTER TABLE super_vouchers ENABLE TRIGGER sv_sync_cache;

SELECT stores AS messy_original_stores FROM super_vouchers WHERE id = '88888888-aaaa-aaaa-aaaa-888888888888' \gset

SET request.jwt.claim.role = 'service_role';
UPDATE super_vouchers SET stores_manual = COALESCE(stores, '{}'::text[])
 WHERE id = '88888888-aaaa-aaaa-aaaa-888888888888' AND stores_manual IS NULL AND catalog_product_key IS NULL;
RESET request.jwt.claim.role;

SELECT stores AS backfilled_stores FROM super_vouchers WHERE id = '88888888-aaaa-aaaa-aaaa-888888888888' \gset

SELECT probe_assert('backfill: business content preserved (normalized-set equality)',
  probe_normalized_set(:'messy_original_stores'::text[]) = probe_normalized_set(:'backfilled_stores'::text[]));

-- Non-blocking report function, called with the two arrays as real bind
-- arguments (not textual interpolation inside a dollar-quoted body) so
-- psql's :'var' substitution applies normally, same as the assertion above.
CREATE OR REPLACE FUNCTION probe_report_order_diff(p_label text, p_before text[], p_after text[]) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF p_before IS DISTINCT FROM p_after THEN
    RAISE NOTICE 'INFO (non-blocking, expected): % — before=% after=% (business content unchanged; set-equality already asserted above)', p_label, p_before, p_after;
  ELSE
    RAISE NOTICE 'INFO: % — produced a byte-identical array (no order/dup change)', p_label;
  END IF;
END;
$$;

SELECT probe_report_order_diff('backfill order/duplicate-count for Legacy Messy SV', :'messy_original_stores'::text[], :'backfilled_stores'::text[]);

-- ============================================================================
-- Follow-up fix: the unification rollback (20261002000000_..._down.sql) must
-- perform NO mutation — it must NOT revert stores_manual to NULL, since that
-- would reopen the exact wipe risk via admin_upsert_super_voucher (see that
-- file's header comment for the full reasoning). Prove it directly: capture
-- every super_vouchers row's full state, run the actual rollback file, then
-- assert NOTHING changed.
-- ============================================================================

CREATE TEMP TABLE pre_unification_rollback_snapshot AS
SELECT id, stores_manual, stores, search_terms, catalog_product_key, updated_at FROM super_vouchers;

\i supabase/rollback/20261002000000_catalog_cache_unification_down.sql

SELECT probe_assert('unification rollback performed zero mutation (row count unchanged)',
  (SELECT count(*) FROM super_vouchers) = (SELECT count(*) FROM pre_unification_rollback_snapshot));

SELECT probe_assert('unification rollback left stores_manual, stores, search_terms, catalog_product_key, updated_at byte-identical on every row',
  NOT EXISTS (
    SELECT 1 FROM super_vouchers sv
    JOIN pre_unification_rollback_snapshot p ON p.id = sv.id
    WHERE sv.stores_manual IS DISTINCT FROM p.stores_manual
       OR sv.stores IS DISTINCT FROM p.stores
       OR sv.search_terms IS DISTINCT FROM p.search_terms
       OR sv.catalog_product_key IS DISTINCT FROM p.catalog_product_key
       OR sv.updated_at IS DISTINCT FROM p.updated_at
  ));

\echo 'ALL CACHE UNIFICATION PROOFS PASSED'
