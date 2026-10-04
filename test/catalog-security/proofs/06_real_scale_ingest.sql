-- Real-scale ingestion proof. Uses the actual parsed name lists from the
-- three initial AUTO sources (BUYME ALL: 1320, Swish Plus: 1005, Gifta: 149 —
-- fetched 2026-10-02, handed over as data, not invented), checked in as
-- fixtures under /home/user/giftsmart/test/catalog-security/fixtures/. Proves catalog_apply_snapshot
-- and the cache-sync trigger behave correctly at real-world volume, not just
-- the 2-3 item toy fixtures used elsewhere in this suite.
--
-- Run after: harness.sql, then both migrations (same as every other proof
-- file in this directory). Requires pg_read_file (superuser) since it reads
-- the fixture files directly from disk — a real local-only convenience, not
-- something available to anon/authenticated/service_role in production.

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
VALUES
  ('realscale_buyme_all', 'BUYME ALL', 'buyme', '{"source_key":"buyme-brands-13438757"}'::jsonb, true, 500, 0.3, 1),
  ('realscale_swish_plus', 'נופשונית', 'swish', '{"source_key":"swish-product-105379"}'::jsonb, true, 500, 0.3, 1),
  ('realscale_gifta', 'גיפתה', 'realscale_gifta', '{"source_key":"gifta-rashatot-mechabdot"}'::jsonb, true, 50, 0.3, 1);

\timing on
SELECT probe_assert('BUYME ALL real-scale apply: 1320 items',
  (SELECT item_count FROM catalog_apply_snapshot('realscale_buyme_all', 'realscale-buyme-1', now(), 1, '{"source_key":"buyme-brands-13438757"}'::jsonb,
    pg_read_file('/home/user/giftsmart/test/catalog-security/fixtures/buyme_items.json')::jsonb)) = 1320);
SELECT probe_assert('Swish Plus real-scale apply: 1005 items',
  (SELECT item_count FROM catalog_apply_snapshot('realscale_swish_plus', 'realscale-swish-1', now(), 1, '{"source_key":"swish-product-105379"}'::jsonb,
    pg_read_file('/home/user/giftsmart/test/catalog-security/fixtures/swish_plus_items.json')::jsonb)) = 1005);
SELECT probe_assert('Gifta real-scale apply: 149 items',
  (SELECT item_count FROM catalog_apply_snapshot('realscale_gifta', 'realscale-gifta-1', now(), 1, '{"source_key":"gifta-rashatot-mechabdot"}'::jsonb,
    pg_read_file('/home/user/giftsmart/test/catalog-security/fixtures/gifta_items.json')::jsonb)) = 149);
\timing off
RESET request.jwt.claim.role;

INSERT INTO super_vouchers (id, wallet_id, name, stores_manual)
VALUES
  ('11111111-bbbb-bbbb-bbbb-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'BUYME ALL', '{}'),
  ('22222222-bbbb-bbbb-bbbb-222222222222', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'נופשונית', '{}'),
  ('33333333-bbbb-bbbb-bbbb-333333333333', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'גיפתה', '{}');

SET ROLE authenticated; SET request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
SELECT probe_assert('link BUYME ALL succeeds', (admin_link_catalog_product('11111111-bbbb-bbbb-bbbb-111111111111', 'realscale_buyme_all', '{}')).catalog_product_key = 'realscale_buyme_all');
SELECT probe_assert('link Swish Plus succeeds', (admin_link_catalog_product('22222222-bbbb-bbbb-bbbb-222222222222', 'realscale_swish_plus', '{}')).catalog_product_key = 'realscale_swish_plus');
SELECT probe_assert('link Gifta succeeds', (admin_link_catalog_product('33333333-bbbb-bbbb-bbbb-333333333333', 'realscale_gifta', '{}')).catalog_product_key = 'realscale_gifta');
RESET ROLE;

SELECT probe_assert('BUYME ALL: stores/search_terms both have exactly 1320 entries',
  (SELECT array_length(stores,1) FROM super_vouchers WHERE id = '11111111-bbbb-bbbb-bbbb-111111111111') = 1320
  AND (SELECT array_length(search_terms,1) FROM super_vouchers WHERE id = '11111111-bbbb-bbbb-bbbb-111111111111') = 1320);
SELECT probe_assert('Swish Plus: stores/search_terms both have exactly 1005 entries',
  (SELECT array_length(stores,1) FROM super_vouchers WHERE id = '22222222-bbbb-bbbb-bbbb-222222222222') = 1005
  AND (SELECT array_length(search_terms,1) FROM super_vouchers WHERE id = '22222222-bbbb-bbbb-bbbb-222222222222') = 1005);
SELECT probe_assert('Gifta: stores/search_terms both have exactly 149 entries',
  (SELECT array_length(stores,1) FROM super_vouchers WHERE id = '33333333-bbbb-bbbb-bbbb-333333333333') = 149
  AND (SELECT array_length(search_terms,1) FROM super_vouchers WHERE id = '33333333-bbbb-bbbb-bbbb-333333333333') = 149);

-- Hebrew search for "גולף" must match real entries across all three linked vouchers.
SELECT probe_assert('"גולף" search matches real BUYME ALL entries',
  (SELECT count(*) FROM super_vouchers WHERE id = '11111111-bbbb-bbbb-bbbb-111111111111' AND EXISTS (SELECT 1 FROM unnest(stores) s WHERE s LIKE '%גולף%')) = 1);
SELECT probe_assert('"גולף" search matches real Gifta entries (including exact "גולף")',
  (SELECT 'גולף' = ANY(stores) FROM super_vouchers WHERE id = '33333333-bbbb-bbbb-bbbb-333333333333'));
SELECT probe_assert('"גולף" search matches real Swish Plus entries (including exact "גולף")',
  (SELECT 'גולף' = ANY(stores) FROM super_vouchers WHERE id = '22222222-bbbb-bbbb-bbbb-222222222222'));

-- Manual test addition (the kind of thing an admin adds by hand) must
-- survive both an identical resend and a genuinely new, real-content sync.
SET ROLE authenticated; SET request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
SELECT probe_assert('admin adds a manual test item to the Gifta-linked voucher',
  (admin_link_catalog_product('33333333-bbbb-bbbb-bbbb-333333333333', 'realscale_gifta', ARRAY['TEST_MANUAL_ADDITION'])).stores_manual = ARRAY['TEST_MANUAL_ADDITION']);
RESET ROLE;

SET request.jwt.claim.role = 'service_role';
SELECT probe_assert('identical resend of the same 149-item snapshot is a true no-op (same version, same count)',
  (SELECT status = 'applied' AND item_count = 149 AND snapshot_version = 1
     FROM catalog_apply_snapshot('realscale_gifta', 'realscale-gifta-1', now(), 1, '{"source_key":"gifta-rashatot-mechabdot"}'::jsonb,
       pg_read_file('/home/user/giftsmart/test/catalog-security/fixtures/gifta_items.json')::jsonb)));

WITH removed AS (
  SELECT jsonb_agg(x) AS items FROM (
    SELECT * FROM jsonb_array_elements(pg_read_file('/home/user/giftsmart/test/catalog-security/fixtures/gifta_items.json')::jsonb) x
    WHERE x->>'canonical_name' <> 'גולף'
  ) t(x)
)
SELECT probe_assert('next real sync (one item removed) applies as a new version with the reduced count',
  (SELECT status = 'applied' AND item_count = 148 AND snapshot_version = 2
     FROM catalog_apply_snapshot('realscale_gifta', 'realscale-gifta-2', now() + interval '1 hour', 1, '{"source_key":"gifta-rashatot-mechabdot"}'::jsonb,
       (SELECT items FROM removed))));
RESET request.jwt.claim.role;

SELECT probe_assert('manual test addition survived the real sync',
  (SELECT 'TEST_MANUAL_ADDITION' = ANY(stores) FROM super_vouchers WHERE id = '33333333-bbbb-bbbb-bbbb-333333333333'));
SELECT probe_assert('the removed real item ("גולף") is actually gone from the cache',
  (SELECT NOT ('גולף' = ANY(stores)) FROM super_vouchers WHERE id = '33333333-bbbb-bbbb-bbbb-333333333333'));
SELECT probe_assert('a different, still-present real item ("גולף אנד קו") remains',
  (SELECT 'גולף אנד קו' = ANY(stores) FROM super_vouchers WHERE id = '33333333-bbbb-bbbb-bbbb-333333333333'));
SELECT probe_assert('final count is 148 real items + 1 manual = 149',
  (SELECT array_length(stores,1) FROM super_vouchers WHERE id = '33333333-bbbb-bbbb-bbbb-333333333333') = 149);

\echo 'ALL REAL-SCALE INGEST PROOFS PASSED'
