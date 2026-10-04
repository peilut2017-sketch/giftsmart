-- ============================================================================
-- Rollback for supabase/migrations/20261001000000_catalog_foundation.sql
--
-- Deliberately kept OUTSIDE supabase/migrations/ (finding #11): this project
-- has no automated migration runner today, but if one is ever adopted,
-- auto-discovering both an "up" and a same-prefixed "down" file in the same
-- migrations directory could apply the rollback immediately as the "next"
-- migration. This file must be run manually and only on purpose.
--
-- This is DESTRUCTIVE of any data created while the new schema was live:
-- catalog_products/snapshots/items/audit rows, any super_vouchers.stores_manual
-- or catalog_product_key link, and the audit trail — all dropped. It restores
-- the pre-migration STRUCTURE exactly (including the pre-migration write-RLS
-- gap on super_vouchers that this migration closed), not a snapshot of data.
-- It does not touch any row's id/wallet_id/name/description/logo_url/
-- balance_check_url, and does not delete any voucher or super_voucher row.
--
-- NOT an automatically-safe path, by explicit requirement: running this is
-- destructive and reopens a closed permission gap, so it is paired with (a)
-- an unconditional self-backup, below, of every row/column this script is
-- about to drop, BEFORE any DROP COLUMN or DROP TABLE runs, and (b) an
-- automated, asserted test — not just this comment — proving both that the
-- self-backup really preserves everything new and that the reopened gap is
-- a real, confirmed, non-silent consequence rather than a theoretical one:
-- see test/catalog-security/proofs/05_rollback_safety.sql, which runs this
-- exact file against a seeded database and asserts on the result.
--
-- The gap that reopens: the pre-migration single "FOR ALL" policy (restored
-- in section 4 below) only checks wallet ownership. Once the per-command
-- split policies, the super_vouchers_protect_managed_fields trigger, and the
-- super_vouchers_sync_cache trigger are all dropped (sections 6/6b restored
-- to nothing), an ordinary wallet owner's own raw UPDATE can set
-- is_global = true (or, before round 3's columns are even dropped,
-- catalog_product_key to any value) on their own private row with no admin
-- check at all — exactly the write round 1 introduced this migration to
-- block. This is an expected, known consequence of fully reverting to the
-- pre-catalog-feature schema, not a bug in this rollback script; re-apply
-- an equivalent protection before resuming normal operation if the gap
-- being closed is still wanted going forward.
--
-- Run manually in order; stop and inspect if any step errors.
--
-- \set ON_ERROR_STOP on below means this: whether this file is invoked via
-- `psql -f` (even without -v ON_ERROR_STOP=1 on the command line) or pasted
-- as one batch into the Supabase SQL Editor, the FIRST error anywhere in it
-- — including the stop-if-already-backed-up check in section 0 — halts
-- every later statement. Nothing partial happens past that point.
-- ============================================================================

\set ON_ERROR_STOP on

-- ── 0. Self-backup — every table/column this script is about to drop,
--      captured BEFORE any destructive statement runs. NEVER overwritten.
--
--      If ANY backup table from a previous run already exists, this STOPS
--      with an error instead of silently recreating it, and creates NONE of
--      the six (checked up front, before any is created, so a conflict on
--      one never leaves the others half-created). Why this matters: on a
--      repeat run, `public.super_vouchers` may already be missing the very
--      columns the first backup was meant to preserve (if the first run's
--      DROP COLUMN already succeeded) — silently overwriting would replace
--      the original, more complete backup with a degraded one. If a backup
--      table already exists, a person must deliberately rename/archive it
--      before re-running this script — that decision is never made for them.
--
--      Each backup table is also access-restricted (REVOKE ALL from PUBLIC/
--      anon/authenticated, matching every other table this feature
--      introduces) — "private permissions", not whatever the schema's
--      default privileges would otherwise grant.
--
--      Kept permanently once created (never dropped by this script); the
--      person running this decides separately, later, whether/when to clean
--      these up. ──────────────────────────────────────────────────────────

DO $$
BEGIN
  IF to_regclass('public.super_vouchers_rollback_backup') IS NOT NULL THEN
    RAISE EXCEPTION 'super_vouchers_rollback_backup already exists — refusing to overwrite a possibly-original backup from an earlier run. Inspect, rename, or archive it manually, then re-run this script.';
  END IF;
  IF to_regclass('public.catalog_products') IS NOT NULL
     AND to_regclass('public.catalog_products_rollback_backup') IS NOT NULL THEN
    RAISE EXCEPTION 'catalog_products_rollback_backup already exists — refusing to overwrite. Inspect, rename, or archive it manually, then re-run this script.';
  END IF;
  IF to_regclass('public.catalog_snapshots') IS NOT NULL
     AND to_regclass('public.catalog_snapshots_rollback_backup') IS NOT NULL THEN
    RAISE EXCEPTION 'catalog_snapshots_rollback_backup already exists — refusing to overwrite. Inspect, rename, or archive it manually, then re-run this script.';
  END IF;
  IF to_regclass('public.catalog_items') IS NOT NULL
     AND to_regclass('public.catalog_items_rollback_backup') IS NOT NULL THEN
    RAISE EXCEPTION 'catalog_items_rollback_backup already exists — refusing to overwrite. Inspect, rename, or archive it manually, then re-run this script.';
  END IF;
  IF to_regclass('public.catalog_audit') IS NOT NULL
     AND to_regclass('public.catalog_audit_rollback_backup') IS NOT NULL THEN
    RAISE EXCEPTION 'catalog_audit_rollback_backup already exists — refusing to overwrite. Inspect, rename, or archive it manually, then re-run this script.';
  END IF;
  -- Only relevant if 20261002000000_catalog_cache_unification.sql was also
  -- applied on top before this full rollback runs; harmless no-op otherwise.
  IF to_regclass('public.catalog_cache_backfill_snapshot') IS NOT NULL
     AND to_regclass('public.catalog_cache_backfill_snapshot_rollback_backup') IS NOT NULL THEN
    RAISE EXCEPTION 'catalog_cache_backfill_snapshot_rollback_backup already exists — refusing to overwrite. Inspect, rename, or archive it manually, then re-run this script.';
  END IF;
END $$;

CREATE TABLE public.super_vouchers_rollback_backup AS
SELECT *, now() AS backed_up_at FROM public.super_vouchers;
REVOKE ALL ON public.super_vouchers_rollback_backup FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.super_vouchers_rollback_backup TO service_role;

DO $$
BEGIN
  IF to_regclass('public.catalog_products') IS NOT NULL THEN
    EXECUTE 'CREATE TABLE public.catalog_products_rollback_backup AS SELECT *, now() AS backed_up_at FROM public.catalog_products';
    EXECUTE 'REVOKE ALL ON public.catalog_products_rollback_backup FROM PUBLIC, anon, authenticated';
    EXECUTE 'GRANT ALL ON public.catalog_products_rollback_backup TO service_role';
  END IF;
  IF to_regclass('public.catalog_snapshots') IS NOT NULL THEN
    EXECUTE 'CREATE TABLE public.catalog_snapshots_rollback_backup AS SELECT *, now() AS backed_up_at FROM public.catalog_snapshots';
    EXECUTE 'REVOKE ALL ON public.catalog_snapshots_rollback_backup FROM PUBLIC, anon, authenticated';
    EXECUTE 'GRANT ALL ON public.catalog_snapshots_rollback_backup TO service_role';
  END IF;
  IF to_regclass('public.catalog_items') IS NOT NULL THEN
    EXECUTE 'CREATE TABLE public.catalog_items_rollback_backup AS SELECT *, now() AS backed_up_at FROM public.catalog_items';
    EXECUTE 'REVOKE ALL ON public.catalog_items_rollback_backup FROM PUBLIC, anon, authenticated';
    EXECUTE 'GRANT ALL ON public.catalog_items_rollback_backup TO service_role';
  END IF;
  IF to_regclass('public.catalog_audit') IS NOT NULL THEN
    EXECUTE 'CREATE TABLE public.catalog_audit_rollback_backup AS SELECT *, now() AS backed_up_at FROM public.catalog_audit';
    EXECUTE 'REVOKE ALL ON public.catalog_audit_rollback_backup FROM PUBLIC, anon, authenticated';
    EXECUTE 'GRANT ALL ON public.catalog_audit_rollback_backup TO service_role';
  END IF;
  IF to_regclass('public.catalog_cache_backfill_snapshot') IS NOT NULL THEN
    EXECUTE 'CREATE TABLE public.catalog_cache_backfill_snapshot_rollback_backup AS SELECT *, now() AS backed_up_at FROM public.catalog_cache_backfill_snapshot';
    EXECUTE 'REVOKE ALL ON public.catalog_cache_backfill_snapshot_rollback_backup FROM PUBLIC, anon, authenticated';
    EXECUTE 'GRANT ALL ON public.catalog_cache_backfill_snapshot_rollback_backup TO service_role';
  END IF;
END $$;

SELECT pg_notify('pgrst', 'reload schema');

-- 10. Catalog apply RPC
DROP FUNCTION IF EXISTS public.catalog_apply_snapshot(text, text, timestamptz, int, jsonb, jsonb);

-- 9. Link/unlink/preview RPCs
DROP FUNCTION IF EXISTS public.admin_unlink_catalog_product(uuid);
DROP FUNCTION IF EXISTS public.admin_link_catalog_product(uuid, text, text[]);
DROP FUNCTION IF EXISTS public.admin_preview_catalog_link(uuid, text);

-- 8. Admin RPCs
DROP FUNCTION IF EXISTS public.admin_delete_super_voucher(uuid);
DROP FUNCTION IF EXISTS public.admin_upsert_super_voucher(uuid, uuid, text, text[], text, boolean, text);

-- 7. Restore table-level grants this migration revoked (match pre-migration state)
GRANT TRUNCATE, REFERENCES, TRIGGER ON public.super_vouchers TO anon, authenticated;

-- 6c. Wallet-delete guard
DROP TRIGGER IF EXISTS wallets_block_managed_delete ON public.wallets;
DROP FUNCTION IF EXISTS public.wallets_block_delete_if_holds_managed_sv();

-- 6b. Cache-sync trigger
DROP TRIGGER IF EXISTS sv_sync_cache ON public.super_vouchers;
DROP FUNCTION IF EXISTS public.super_vouchers_sync_cache();

-- 6. Defense-in-depth trigger
DROP TRIGGER IF EXISTS sv_protect_managed_fields ON public.super_vouchers;
DROP FUNCTION IF EXISTS public.super_vouchers_protect_managed_fields();

-- 5. Identity-immutability trigger
DROP TRIGGER IF EXISTS sv_prevent_identity_change ON public.super_vouchers;
DROP FUNCTION IF EXISTS public.super_vouchers_prevent_identity_change();

-- 4. RLS: restore the original single FOR ALL policy, drop the split ones
--    (including the owner-SELECT policy this migration added back)
DROP POLICY IF EXISTS "sv_select_owner" ON public.super_vouchers;
DROP POLICY IF EXISTS "sv_insert_owner_unmanaged" ON public.super_vouchers;
DROP POLICY IF EXISTS "sv_update_owner_unmanaged" ON public.super_vouchers;
DROP POLICY IF EXISTS "sv_delete_owner_unmanaged" ON public.super_vouchers;

CREATE POLICY "Wallet owners can manage super vouchers"
  ON public.super_vouchers FOR ALL
  USING (wallet_id IN (SELECT id FROM public.wallets WHERE owner_id = auth.uid()));

-- 3. Shared merge helpers
DROP FUNCTION IF EXISTS public.catalog_effective_search_terms(text[], text);
DROP FUNCTION IF EXISTS public.catalog_effective_stores(text[], text);

-- 2. super_vouchers columns (drops the FK implicitly)
ALTER TABLE public.super_vouchers
  DROP COLUMN IF EXISTS catalog_product_key,
  DROP COLUMN IF EXISTS stores_manual,
  DROP COLUMN IF EXISTS stores_catalog_version,
  DROP COLUMN IF EXISTS search_terms;

-- 1. Catalog tables (CASCADE drops their FKs to each other; does not touch
--    super_vouchers/vouchers/wallets, which have no FK pointing INTO these)
DROP TABLE IF EXISTS public.catalog_audit;
DROP TABLE IF EXISTS public.catalog_items;
DROP TABLE IF EXISTS public.catalog_snapshots;
DROP TABLE IF EXISTS public.catalog_products;

-- 0b. Round 3's own additive table (no-op if round 3 was never applied).
-- Its own fixed trigger/RPC function bodies need no separate DROP here:
-- sections 6b/10 above already DROP the functions by name regardless of
-- which round last replaced their body.
DROP TABLE IF EXISTS public.catalog_cache_backfill_snapshot;

SELECT pg_notify('pgrst', 'reload schema');
