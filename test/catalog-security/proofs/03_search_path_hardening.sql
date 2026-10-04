-- Condition #5: confirm (don't assume) that every security-relevant function
-- has search_path locked down, and that `public` is not writable by clients
-- anyway (belt + suspenders — rely on empty search_path regardless).

\c giftsmart_test

\echo '=== schema CREATE privilege on public (must be false for anon/authenticated) ==='
SELECT 'anon'          AS role, has_schema_privilege('anon', 'public', 'CREATE') AS can_create_in_public
UNION ALL
SELECT 'authenticated', has_schema_privilege('authenticated', 'public', 'CREATE');

\echo '=== proconfig (search_path setting) for every function this migration created ==='
SELECT
  p.proname,
  p.prosecdef AS is_security_definer,
  p.proconfig AS raw_config,
  (SELECT setting FROM unnest(COALESCE(p.proconfig, '{}')) setting WHERE setting LIKE 'search_path=%') AS search_path_setting
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    'catalog_effective_stores', 'catalog_effective_search_terms',
    'super_vouchers_prevent_identity_change', 'super_vouchers_protect_managed_fields',
    'admin_upsert_super_voucher', 'admin_delete_super_voucher', 'catalog_apply_snapshot'
  )
ORDER BY p.proname;

\echo '=== any of the above WITHOUT a search_path setting at all? (should be zero rows) ==='
SELECT p.proname
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    'catalog_effective_stores', 'catalog_effective_search_terms',
    'super_vouchers_prevent_identity_change', 'super_vouchers_protect_managed_fields',
    'admin_upsert_super_voucher', 'admin_delete_super_voucher', 'catalog_apply_snapshot'
  )
  AND NOT EXISTS (SELECT 1 FROM unnest(COALESCE(p.proconfig, '{}')) s WHERE s LIKE 'search_path=%');

\echo '=== table grants on the new catalog tables (must show nothing for anon/authenticated) ==='
SELECT grantee, table_name, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND table_name IN ('catalog_products','catalog_snapshots','catalog_items','catalog_audit')
  AND grantee IN ('anon','authenticated')
ORDER BY table_name, grantee;

\echo '=== TRUNCATE/REFERENCES/TRIGGER grants on super_vouchers for anon/authenticated (must show nothing) ==='
SELECT grantee, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema='public' AND table_name='super_vouchers'
  AND grantee IN ('anon','authenticated')
  AND privilege_type IN ('TRUNCATE','REFERENCES','TRIGGER')
ORDER BY grantee, privilege_type;
