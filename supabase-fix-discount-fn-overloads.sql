-- Fix: duplicate overloads of the discount RPCs.
--
-- supabase-deal-image.sql added a p_image_url parameter to admin_upsert_deal and
-- submit_discount_deal using CREATE OR REPLACE. But CREATE OR REPLACE only replaces a
-- function with the *same* argument-type list — adding a parameter creates a SECOND,
-- overloaded function instead, leaving the older one in place. Both then live in the
-- schema at once:
--
--   admin_upsert_deal(...13 args)      <- from supabase-discount-matcher.sql
--   admin_upsert_deal(...14 args)      <- from supabase-deal-image.sql (with image)
--   submit_discount_deal(...11 args)   <- from supabase-discount-submissions.sql
--   submit_discount_deal(...12 args)   <- from supabase-deal-image.sql (with image)
--
-- Every parameter of admin_upsert_deal has a DEFAULT, so a call that omits any argument
-- is ambiguous between the two overloads and PostgREST rejects it rather than guessing
-- (PGRST203, "Could not choose the best candidate function"). Dropping the stale
-- versions leaves exactly one candidate for each name.
--
-- Safe to run more than once.

DROP FUNCTION IF EXISTS admin_upsert_deal(
  UUID, UUID, UUID, TEXT, TEXT, TEXT, NUMERIC, TEXT, TEXT, TEXT[], DATE, DATE, BOOLEAN
);

DROP FUNCTION IF EXISTS submit_discount_deal(
  TEXT, TEXT, TEXT, TEXT, TEXT, NUMERIC, TEXT, TEXT, TEXT[], DATE, DATE
);

-- Verify afterwards — each name should now return exactly one row:
--
--   SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args
--   FROM pg_proc p
--   JOIN pg_namespace n ON n.oid = p.pronamespace
--   WHERE n.nspname = 'public'
--     AND p.proname IN ('admin_upsert_deal', 'submit_discount_deal')
--   ORDER BY p.proname;
