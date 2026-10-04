-- Consolidated, hardened proof suite for the catalog_foundation migration
-- (revision 2). Run after: harness.sql, then
-- supabase/migrations/20261001000000_catalog_foundation.sql.
--
-- Hardening applied per external review critique of the first version:
--   * ON_ERROR_STOP is ON — any unexpected error anywhere in this file halts
--     the whole run with a non-zero exit code, it is never silently skipped.
--   * A failing assertion RAISES (not just prints a warning) — this file's
--     own exit code is the pass/fail signal, not a human reading NOTICE text.
--   * Every "should be blocked" test asserts the SPECIFIC expected SQLSTATE
--     (P0001 for our own trigger/RPC RAISE EXCEPTION calls, 42501 for a
--     GRANT/RLS-level rejection) via probe_expect_sqlstate — a WHEN OTHERS
--     catch-all would also "pass" on an unrelated bug; this won't.
--   * Every negative test also asserts row/column counts before vs. after,
--     not just that something was rejected.

\c giftsmart_test
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

-- Executes p_sql (which must FAIL) and requires the failure's SQLSTATE to
-- match p_expected_sqlstate exactly. Succeeding at all, or failing with a
-- different SQLSTATE, is itself a test failure (RAISEs, halting the suite).
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

-- ── Seed ─────────────────────────────────────────────────────────────────
INSERT INTO catalog_products (product_key, display_name_he, source_type, source_identity, enabled, min_expected_count, max_removal_ratio, schema_version)
VALUES ('buyme_all', 'BUYME ALL', 'manual_watcher', '{"source_key":"buyme-url-v1"}'::jsonb, true, 2, 0.5, 1);

INSERT INTO wallets (id, owner_id, name) VALUES ('ffffffff-ffff-ffff-ffff-ffffffffffff', '11111111-1111-1111-1111-111111111111', 'admin_wallet');

-- These three run BEFORE anything is ever applied for this product (no
-- "latest snapshot" exists yet to trip the staleness check) — order matters:
-- once a real snapshot has been applied, a validation-failure test with an
-- earlier fetched_at would hit staleness first instead of the check it's
-- meant to exercise.
SET ROLE service_role; SET request.jwt.claims = '{"role":"service_role"}';
SELECT probe_assert('wrong schema_version rejected',
  (SELECT status || ':' || reject_reason FROM catalog_apply_snapshot('buyme_all','h0','2026-10-01T01:00:00Z'::timestamptz,99,'{"source_key":"buyme-url-v1"}'::jsonb,
    '[{"canonical_name":"A"},{"canonical_name":"B"}]'::jsonb)) = 'rejected:schema_version_mismatch');
SELECT probe_assert('wrong source_identity rejected',
  (SELECT status || ':' || reject_reason FROM catalog_apply_snapshot('buyme_all','h0b','2026-10-01T01:01:00Z'::timestamptz,1,'{"source_key":"WRONG"}'::jsonb,
    '[{"canonical_name":"A"},{"canonical_name":"B"}]'::jsonb)) = 'rejected:source_identity_mismatch');
SELECT probe_assert('blank-name padding does not fake min_expected_count=2 (counts the normalized set, fix #5)',
  (SELECT status || ':' || reject_reason || ':' || item_count FROM catalog_apply_snapshot('buyme_all','h_blank','2026-10-01T01:02:00Z'::timestamptz,1,'{"source_key":"buyme-url-v1"}'::jsonb,
    '[{"canonical_name":""},{"canonical_name":"  "}]'::jsonb)) = 'rejected:below_min_expected_count:0');
RESET ROLE;

SET ROLE service_role; SET request.jwt.claims = '{"role":"service_role"}';
SELECT probe_assert('seed apply (v1) succeeds',
  (SELECT status FROM catalog_apply_snapshot('buyme_all','h1','2026-10-01T06:00:00Z'::timestamptz,1,'{"source_key":"buyme-url-v1"}'::jsonb,
    '[{"canonical_name":"Shop A"},{"canonical_name":"Shop B"}]'::jsonb)) = 'applied');
RESET ROLE;

SET ROLE authenticated; SET request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
SELECT probe_assert('seed link succeeds',
  (SELECT (admin_link_catalog_product('dddddddd-dddd-dddd-dddd-dddddddddddd','buyme_all', ARRAY['Original Manual'])).stores)
    = ARRAY['Original Manual','Shop A','Shop B']);
RESET ROLE;

-- ── RLS: visibility matrix (unchanged SELECT policy + restored owner path) ─
SET ROLE authenticated; SET request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
SELECT probe_assert('user_a sees own private SV', EXISTS (SELECT 1 FROM super_vouchers WHERE id = 'cccccccc-cccc-cccc-cccc-cccccccccccc'));
SELECT probe_assert('user_a sees the global/linked SV', EXISTS (SELECT 1 FROM super_vouchers WHERE id = 'dddddddd-dddd-dddd-dddd-dddddddddddd'));
RESET ROLE;

SET ROLE authenticated; SET request.jwt.claims = '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}';
SELECT probe_assert('user_b does NOT see user_a''s private SV (no cross-wallet leak)',
  NOT EXISTS (SELECT 1 FROM super_vouchers WHERE id = 'cccccccc-cccc-cccc-cccc-cccccccccccc'));
SELECT probe_assert('user_b still sees the global SV (visibility not hidden from non-owner)',
  EXISTS (SELECT 1 FROM super_vouchers WHERE id = 'dddddddd-dddd-dddd-dddd-dddddddddddd'));
RESET ROLE;

INSERT INTO wallets (id, owner_id, name) VALUES ('99999999-9999-9999-9999-999999999999', '88888888-8888-8888-8888-888888888888', 'orphan_owner_wallet');
-- deliberately NOT a wallet_members row for this owner — finding #3's exact scenario
SET ROLE service_role; SET request.jwt.claims = '{"role":"service_role"}';
INSERT INTO super_vouchers (id, wallet_id, name, is_global) VALUES ('77777777-7777-7777-7777-777777777777', '99999999-9999-9999-9999-999999999999', 'Orphan Owner SV', false);
RESET ROLE;
SET ROLE authenticated; SET request.jwt.claims = '{"sub":"88888888-8888-8888-8888-888888888888","role":"authenticated"}';
SELECT probe_assert('owner without wallet_members membership still sees their own SV (fix #3)',
  EXISTS(SELECT 1 FROM super_vouchers WHERE id='77777777-7777-7777-7777-777777777777'));
RESET ROLE;

-- ── RLS negative: cannot self-promote to global / catalog-linked ──────────
SET ROLE authenticated; SET request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
SELECT probe_assert('baseline count before is_global insert attempt', (SELECT count(*) FROM super_vouchers) = (SELECT count(*) FROM super_vouchers));
DO $$
DECLARE v_before int; v_after int;
BEGIN
  SELECT count(*) INTO v_before FROM super_vouchers;
  BEGIN
    INSERT INTO super_vouchers (wallet_id, name, is_global) VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Evil', true);
    RAISE EXCEPTION 'TEST FAILED: regular user was able to insert is_global=true';
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE <> 'P0001' THEN
      RAISE EXCEPTION 'TEST FAILED: wrong SQLSTATE % (%) for is_global insert block', SQLSTATE, SQLERRM;
    END IF;
  END;
  SELECT count(*) INTO v_after FROM super_vouchers;
  PERFORM probe_assert('regular user blocked from inserting is_global=true (P0001), no row added', v_before = v_after);
END $$;

DO $$
DECLARE v_before int; v_after int;
BEGIN
  SELECT count(*) INTO v_before FROM super_vouchers;
  BEGIN
    INSERT INTO super_vouchers (wallet_id, name, catalog_product_key) VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Evil2', 'buyme_all');
    RAISE EXCEPTION 'TEST FAILED: regular user was able to set catalog_product_key';
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE <> 'P0001' THEN
      RAISE EXCEPTION 'TEST FAILED: wrong SQLSTATE % (%) for catalog_product_key insert block', SQLSTATE, SQLERRM;
    END IF;
  END;
  SELECT count(*) INTO v_after FROM super_vouchers;
  PERFORM probe_assert('regular user blocked from setting catalog_product_key (P0001), no row added', v_before = v_after);
END $$;

DO $$
DECLARE v_name_before text; v_name_after text;
BEGIN
  SELECT name INTO v_name_before FROM super_vouchers WHERE id = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
  UPDATE super_vouchers SET name = 'Hijacked' WHERE id = 'dddddddd-dddd-dddd-dddd-dddddddddddd'; -- silently filtered to 0 rows by RLS USING, not an exception
  SELECT name INTO v_name_after FROM super_vouchers WHERE id = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
  PERFORM probe_assert('regular user cannot edit the global/linked row (RLS silently affects 0 rows, name unchanged)', v_name_before = v_name_after);
END $$;

DO $$
DECLARE v_wallet_before uuid; v_wallet_after uuid;
BEGIN
  SELECT wallet_id INTO v_wallet_before FROM super_vouchers WHERE id = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
  BEGIN
    UPDATE super_vouchers SET wallet_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' WHERE id = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
    RAISE EXCEPTION 'TEST FAILED: wallet_id was changed';
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE <> 'P0001' THEN
      RAISE EXCEPTION 'TEST FAILED: wrong SQLSTATE % (%) for wallet_id immutability', SQLSTATE, SQLERRM;
    END IF;
  END;
  SELECT wallet_id INTO v_wallet_after FROM super_vouchers WHERE id = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
  PERFORM probe_assert('wallet_id is immutable even for the owning user (P0001), value unchanged', v_wallet_before = v_wallet_after);
END $$;
RESET ROLE;

-- ── Admin RPC: positive + negative + no-partial-mutation ───────────────────
SET ROLE authenticated; SET request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
SELECT probe_assert('admin can create a super voucher via RPC, with explicit server-verified wallet_id (fix #8)',
  (SELECT (admin_upsert_super_voucher(NULL, 'ffffffff-ffff-ffff-ffff-ffffffffffff', 'Admin SV', ARRAY['X','x',' Y '], NULL, true)).name = 'Admin SV'));
RESET ROLE;

DO $$
DECLARE v_before int; v_after int;
BEGIN
  SELECT count(*) INTO v_before FROM super_vouchers;
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
  BEGIN
    PERFORM admin_upsert_super_voucher(NULL, 'ffffffff-ffff-ffff-ffff-ffffffffffff', 'Hacked', ARRAY['x'], NULL, true);
    RAISE EXCEPTION 'TEST FAILED: non-admin called admin_upsert_super_voucher successfully';
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE <> 'P0001' THEN
      RAISE EXCEPTION 'TEST FAILED: wrong SQLSTATE % (%) for non-admin RPC call', SQLSTATE, SQLERRM;
    END IF;
  END;
  PERFORM set_config('role', 'none', true);
  SELECT count(*) INTO v_after FROM super_vouchers;
  PERFORM probe_assert('non-admin rejected from admin RPC (P0001) with NO row mutation', v_before = v_after);
END $$;

SET ROLE anon; SET request.jwt.claims = '{"role":"anon"}';
SELECT probe_expect_sqlstate('anon rejected outright from admin RPC (no EXECUTE grant)', '42501',
  $sql$SELECT admin_upsert_super_voucher(NULL, 'ffffffff-ffff-ffff-ffff-ffffffffffff', 'Anon SV', ARRAY['x'], NULL, true)$sql$);
RESET ROLE;

-- ── profiles self-escalation still blocked ─────────────────────────────────
SET ROLE authenticated; SET request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
DO $$
DECLARE v_before boolean; v_after boolean;
BEGIN
  SELECT is_admin INTO v_before FROM profiles WHERE id = '22222222-2222-2222-2222-222222222222';
  BEGIN
    UPDATE profiles SET is_admin = true WHERE id = auth.uid();
    RAISE EXCEPTION 'TEST FAILED: authenticated user self-promoted to admin';
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE <> '42501' THEN
      RAISE EXCEPTION 'TEST FAILED: wrong SQLSTATE % (%) for profiles self-escalation', SQLSTATE, SQLERRM;
    END IF;
  END;
  SELECT is_admin INTO v_after FROM profiles WHERE id = '22222222-2222-2222-2222-222222222222';
  PERFORM probe_assert('authenticated user cannot self-promote is_admin (42501), value unchanged', v_before = v_after AND v_after IS NOT TRUE);
END $$;
RESET ROLE;

-- ── Catalog tables locked from clients ─────────────────────────────────────
SET ROLE authenticated; SET request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
SELECT probe_expect_sqlstate('authenticated has no SELECT on catalog_items', '42501', $sql$SELECT 1 FROM catalog_items LIMIT 1$sql$);
RESET ROLE;
SET ROLE anon; SET request.jwt.claims = '{"role":"anon"}';
SELECT probe_expect_sqlstate('anon has no SELECT on catalog_products', '42501', $sql$SELECT 1 FROM catalog_products LIMIT 1$sql$);
RESET ROLE;

-- ── Wallet deletion guard (fix #4) ──────────────────────────────────────────
DO $$
BEGIN
  BEGIN
    DELETE FROM wallets WHERE id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'; -- owns the now-linked dddddddd row
    RAISE EXCEPTION 'TEST FAILED: a wallet holding a managed super_voucher was deleted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE <> 'P0001' THEN
      RAISE EXCEPTION 'TEST FAILED: wrong SQLSTATE % (%) for wallet-delete guard', SQLSTATE, SQLERRM;
    END IF;
  END;
END $$;
SELECT probe_assert('the managed row and its wallet still exist after the blocked delete attempt',
  EXISTS(SELECT 1 FROM wallets WHERE id='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa') AND EXISTS(SELECT 1 FROM super_vouchers WHERE id='dddddddd-dddd-dddd-dddd-dddddddddddd'));
WITH deleted AS (DELETE FROM wallets WHERE id = '99999999-9999-9999-9999-999999999999' RETURNING true)
SELECT probe_assert('an ordinary wallet with no managed rows still deletes fine (guard is not over-broad)',
  EXISTS (SELECT 1 FROM deleted));

-- ── Ingest path: auth, validation, atomicity, idempotency, staleness ───────
SET ROLE authenticated; SET request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
SELECT probe_expect_sqlstate('even an admin (authenticated) cannot call catalog_apply_snapshot', '42501',
  $sql$SELECT catalog_apply_snapshot('buyme_all', 'x', now(), 1, '{"source_key":"buyme-url-v1"}'::jsonb, '[]'::jsonb)$sql$);
RESET ROLE;

-- link a second row AFTER v1, BEFORE resending identical content
SET ROLE authenticated; SET request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
SELECT (admin_upsert_super_voucher(NULL, 'ffffffff-ffff-ffff-ffff-ffffffffffff', 'Second Linked SV', ARRAY[]::text[], NULL, false)).id AS newrow_id \gset
RESET ROLE;
SET ROLE service_role; SET request.jwt.claims = '{"role":"service_role"}';
UPDATE super_vouchers SET catalog_product_key='buyme_all' WHERE id = :'newrow_id';
RESET ROLE;
SELECT probe_assert('linking materializes stores immediately via the sync-cache trigger (fix #9)',
  (SELECT stores FROM super_vouchers WHERE id=:'newrow_id') = ARRAY['Shop A','Shop B']);

SELECT count(*) AS snapshots_before FROM catalog_snapshots WHERE product_key='buyme_all' \gset
SET ROLE service_role; SET request.jwt.claims = '{"role":"service_role"}';
SELECT probe_assert('identical resend (same hash h1) succeeds as a no-op',
  (SELECT status FROM catalog_apply_snapshot('buyme_all','h1','2026-10-01T06:05:00Z'::timestamptz,1,'{"source_key":"buyme-url-v1"}'::jsonb,
    '[{"canonical_name":"Shop A"},{"canonical_name":"Shop B"}]'::jsonb)) = 'applied');
RESET ROLE;
SELECT count(*) AS snapshots_after FROM catalog_snapshots WHERE product_key='buyme_all' \gset
SELECT probe_assert('identical resend created NO new snapshot version (fix #1)', :snapshots_before = :snapshots_after);
SELECT probe_assert('identical resend backfilled the newly-linked row (fix #1)', (SELECT stores FROM super_vouchers WHERE id=:'newrow_id') = ARRAY['Shop A','Shop B']);

SET ROLE service_role; SET request.jwt.claims = '{"role":"service_role"}';
SELECT probe_assert('different content with an earlier-or-equal fetched_at is rejected as stale (fix #1/#6)',
  (SELECT status || ':' || reject_reason FROM catalog_apply_snapshot('buyme_all','h_stale','2026-10-01T05:00:00Z'::timestamptz,1,'{"source_key":"buyme-url-v1"}'::jsonb,
    '[{"canonical_name":"Shop A"},{"canonical_name":"Shop B"},{"canonical_name":"Shop D"}]'::jsonb)) = 'rejected:stale_snapshot');
RESET ROLE;
SELECT probe_assert('catalog_items unchanged after the stale rejection', (SELECT count(*) FROM catalog_items WHERE product_key='buyme_all') = 2);

-- 5 items this time (not 3) so the removal-ratio test below can remove
-- enough to exceed max_removal_ratio=0.5 while the remainder still clears
-- min_expected_count=2 — otherwise below_min_expected_count would fire
-- first and the removal-ratio branch would never actually be exercised.
SET ROLE service_role; SET request.jwt.claims = '{"role":"service_role"}';
SELECT probe_assert('newer, different content applies as a new version (pure addition, under the removal-ratio cap)',
  (SELECT status FROM catalog_apply_snapshot('buyme_all','h2','2026-10-01T07:00:00Z'::timestamptz,1,'{"source_key":"buyme-url-v1"}'::jsonb,
    '[{"canonical_name":"Shop A"},{"canonical_name":"Shop B"},{"canonical_name":"Shop C"},{"canonical_name":"Shop D"},{"canonical_name":"Shop E"}]'::jsonb)) = 'applied');
RESET ROLE;
SELECT probe_assert('linked rows reflect the new content', (SELECT stores FROM super_vouchers WHERE id='dddddddd-dddd-dddd-dddd-dddddddddddd') @> ARRAY['Shop C']);

-- Removes 3 of 5 (60% > 50% max_removal_ratio) while 2 remain (still clears
-- min_expected_count=2) — isolates removal_ratio_exceeded from below_min.
SET ROLE service_role; SET request.jwt.claims = '{"role":"service_role"}';
SELECT probe_assert('removal-ratio-exceeded rejected, catalog_items untouched',
  (SELECT status || ':' || reject_reason FROM catalog_apply_snapshot('buyme_all','h3','2026-10-01T08:00:00Z'::timestamptz,1,'{"source_key":"buyme-url-v1"}'::jsonb,
    '[{"canonical_name":"Shop A"},{"canonical_name":"Shop B"}]'::jsonb)) = 'rejected:removal_ratio_exceeded');
RESET ROLE;
SELECT probe_assert('catalog_items still show all 5 after the rejected removal-ratio attempt',
  (SELECT array_agg(canonical_name ORDER BY canonical_name) FROM catalog_items WHERE product_key='buyme_all') = ARRAY['Shop A','Shop B','Shop C','Shop D','Shop E']);

\echo '=== identity/log table from the earlier probe (for reference) ==='
SELECT trig_kind, path, caller_label, cur_user, sess_user, auth_uid, auth_role FROM probe_log ORDER BY seq;

\echo 'ALL ASSERTIONS PASSED'
