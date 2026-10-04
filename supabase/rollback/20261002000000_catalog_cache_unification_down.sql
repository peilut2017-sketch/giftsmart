-- ============================================================================
-- Rollback for 20261002000000_catalog_cache_unification.sql
--
-- REVISED: this script performs NO mutation. It does not revert
-- stores_manual to NULL for backfilled rows, and never will.
--
-- Why: the previous version of this script reverted stores_manual to NULL
-- for any row untouched since the backfill. But the FIXED
-- super_vouchers_sync_cache trigger (up-migration section 1) — which stays
-- in place permanently, regardless of whether this rollback runs — treats
-- "stores_manual changed to NULL" as a real manual edit and recomputes
-- `stores` from catalog_effective_stores(NULL, NULL) = '{}'. That means the
-- very next ordinary admin save through admin_upsert_super_voucher — even
-- one that only fixes a typo in the name or description, with nothing to do
-- with stores — would silently empty the row's real content the moment
-- stores_manual got resent as part of that UPDATE. That reintroduces, one
-- layer up, exactly the data-loss risk this entire round existed to fix
-- (finding 1). Reverting stores_manual to NULL is therefore not a safe,
-- inert "undo" of the backfill — it recreates the landmine the backfill
-- was built to defuse.
--
-- The backfilled stores_manual value is never worse than NULL: it is the
-- exact pre-backfill `stores` content (business-content preservation proven
-- by test/catalog-security/proofs/04_cache_unification.sql's normalized-set
-- equality check), it already matches the row's current `stores`, and
-- leaving it in place changes no observable behavior for any row nothing
-- else has touched. There is nothing unsafe to revert here, so this script
-- changes nothing — it exists to document that decision and to let someone
-- inspect, read-only, which rows were backfilled vs. edited since.
--
-- admin_upsert_super_voucher was ALSO hardened directly, independently of
-- this decision, in supabase/migrations/20261001000000_catalog_foundation.sql:
-- p_stores_manual = NULL now means "leave stores_manual unchanged" (matching
-- the existing p_description convention) instead of "set it to {}" — so an
-- ordinary name/description-only save can never wipe stores_manual even
-- through some future caller that omits it entirely. That fix stands on its
-- own regardless of what this rollback does.
-- ============================================================================

\set ON_ERROR_STOP on

-- Read-only report: which rows were backfilled, and whether stores_manual
-- still matches the value the backfill wrote (untouched since) or has
-- legitimately changed since (a later admin edit, a catalog link, an
-- old-client write adopted by the trigger, etc). Purely informational —
-- this SELECT changes nothing.
SELECT
  sv.id,
  sv.name,
  sv.catalog_product_key,
  b.written_stores_manual,
  sv.stores_manual AS current_stores_manual,
  CASE
    WHEN sv.catalog_product_key IS NOT NULL THEN 'now_linked_since_backfill'
    WHEN sv.stores_manual IS NOT DISTINCT FROM b.written_stores_manual THEN 'untouched_since_backfill'
    ELSE 'edited_since_backfill'
  END AS status
FROM public.super_vouchers sv
JOIN public.catalog_cache_backfill_snapshot b ON b.id = sv.id
ORDER BY status, sv.id;

-- No mutation follows. See header comment for why.
