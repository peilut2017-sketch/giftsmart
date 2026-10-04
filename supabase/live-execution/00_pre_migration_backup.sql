-- ============================================================================
-- STEP 1 of the live execution plan. Run this FIRST, alone, before either
-- migration file, directly in the Supabase SQL Editor.
--
-- Captures the full current state of public.super_vouchers — the ONLY
-- pre-existing table either migration file modifies — before any change.
-- Nothing else needs backing up: catalog_products/snapshots/items/audit and
-- catalog_cache_backfill_snapshot don't exist yet at this point, so there is
-- no pre-existing data in them to lose.
--
-- This backup is independent of, and in addition to, the automatic
-- self-backup already built into the full-feature rollback script
-- (supabase/rollback/20261001000000_catalog_foundation_down.sql) — that one
-- only ever runs if/when that rollback is actually invoked, which is a
-- separate, later, explicit decision. This one is a durable, standalone
-- snapshot taken purely as a precaution before the forward migration, and
-- it persists regardless of what happens next.
--
-- Idempotent-safe: refuses to overwrite a backup from an earlier attempt,
-- same reasoning as the full-rollback's own self-backup (round 4 fix).
-- ============================================================================

DO $$
BEGIN
  IF to_regclass('public.pre_catalog_migration_backup') IS NOT NULL THEN
    RAISE EXCEPTION 'pre_catalog_migration_backup already exists — refusing to overwrite a possibly-original backup from an earlier attempt. Inspect, rename, or archive it manually first, then re-run this script.';
  END IF;
END $$;

CREATE TABLE public.pre_catalog_migration_backup AS
SELECT *, now() AS backed_up_at FROM public.super_vouchers;

REVOKE ALL ON public.pre_catalog_migration_backup FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.pre_catalog_migration_backup TO service_role;

-- Verify the backup immediately, before trusting it or proceeding to the
-- migration files. These two numbers MUST match — if they don't, STOP, do
-- not proceed, and investigate before doing anything else.
SELECT
  (SELECT count(*) FROM public.super_vouchers) AS live_count,
  (SELECT count(*) FROM public.pre_catalog_migration_backup) AS backup_count,
  (SELECT count(*) FROM public.super_vouchers) = (SELECT count(*) FROM public.pre_catalog_migration_backup) AS counts_match;
