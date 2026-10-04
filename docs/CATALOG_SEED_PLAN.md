# Catalog seed and link plan (PROPOSED - nothing here has been run)

Status: no database access was available when this was written, so the current
state of `catalog_products`, `super_vouchers` and the existing "נופשונית"
vouchers is UNKNOWN. Nothing below may be assumed; run the read-only checks
first, then get the owner's approval for the exact rows and links.

## 0. Read-only checks (SQL Editor, SELECT only)

```sql
-- Are the catalog tables there yet (migrations applied)?
SELECT to_regclass('public.catalog_products') AS products, to_regclass('public.catalog_snapshots') AS snapshots;

-- Candidate vouchers to link (do not assume; confirm each id with the owner)
SELECT id, name, wallet_id, is_global, array_length(stores,1) AS stores_count, catalog_product_key
FROM public.super_vouchers
WHERE name ILIKE '%נופשונית%' OR name ILIKE '%swish%' OR name ILIKE '%buyme%' OR name ILIKE '%gifta%' OR name ILIKE '%גיפתה%'
ORDER BY name;
```

## 1. Proposed seed rows (after migrations 20261001 and 20261002 are applied)

Wrapped in a transaction that rolls back by default; change ROLLBACK to COMMIT
only after the owner approves these exact values.

```sql
BEGIN;
INSERT INTO public.catalog_products
  (product_key, display_name_he, display_name_en, source_type, source_identity, enabled, min_expected_count, max_removal_ratio)
VALUES
  ('buyme_all',   'BUYME ALL',  'BUYME ALL',  'buyme', '{"source_key":"buyme-brands-13438757"}',        true,  800, 0.2),
  ('swish_plus',  'Swish Plus', 'Swish Plus', 'swish', '{"source_key":"swish-product-105379"}',          true,  700, 0.2),
  ('gifta',       'גיפתה',      'Gifta',      'gifta', '{"source_key":"gifta-rashatot-mechabdot"}',      false, 100, 0.2);
SELECT product_key, enabled, min_expected_count, max_removal_ratio FROM public.catalog_products ORDER BY 1;
ROLLBACK;  -- replace with COMMIT only after explicit owner approval
```

Reasoning for the numbers (proposals, owner may change them):
- Live sizes seen 2026-10-04: BUYME 1320, Swish 1005, Gifta 149. Minimums sit
  at roughly 60-70% of that, so a broken or half-loaded page is rejected while
  normal churn passes.
- `max_removal_ratio` 0.2 is the column default: one sync may drop at most 20%
  of the current list. The Swish list moved by only 2 names against the fixture.
- Gifta is seeded `enabled=false`: the page sits behind a bot challenge and
  server-side access is unproven. Enable it only after a real run succeeds.

## 2. Linking existing vouchers (per voucher, admin preview first)

Use the Admin page preview (`admin_preview_catalog_link`) to see what would be
added and removed, then link with `admin_link_catalog_product(voucher_id,
product_key, manual_extras)`. `manual_extras` is the list of manual store names
to keep. Link ONLY voucher ids the owner has confirmed from query 0. Display
the source as "Swish Plus" while keeping the existing voucher name and id.
