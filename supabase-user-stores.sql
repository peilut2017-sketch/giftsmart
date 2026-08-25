-- ============================================================================
-- Per-user store suggestions
-- ============================================================================
-- Problem: every store a user typed into the add-voucher form was inserted into
-- the global `stores` table and suggested to ALL users — including typos and
-- junk names. From now on:
--   * Rows with created_by IS NULL are "global" (the seeded catalog + anything
--     that existed before this migration) and are suggested to everyone.
--   * New user-added stores carry created_by = the adding user, and are
--     suggested only back to that user.
--   * Super-voucher (רב-שובר) names are unaffected — the form merges them into
--     the suggestions from the super_vouchers table, not from `stores`.
--
-- NOTE: stores added by users BEFORE this migration cannot be told apart from
-- the seeded catalog, so they stay global. Junk entries can be deleted manually
-- in the Table Editor (stores table).
--
-- Also included: delete_vault_wraps_by_method — used when disabling biometric
-- to remove PRF vault doors from ALL devices, so "vault health" stops listing
-- fingerprint as an active unlock method.
--
-- Run this whole file in the Supabase SQL Editor.
-- ============================================================================

-- 1) Ownership column (existing rows stay NULL = global)
ALTER TABLE public.stores
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_stores_created_by ON public.stores(created_by);

-- 2) Reset RLS policies on stores: reads return global rows + your own rows;
--    writes go through the add_store() RPC only.
DO $$
DECLARE p record;
BEGIN
  FOR p IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'stores'
  LOOP
    EXECUTE format('DROP POLICY %I ON public.stores', p.policyname);
  END LOOP;
END $$;

ALTER TABLE public.stores ENABLE ROW LEVEL SECURITY;

CREATE POLICY stores_select_own_or_global ON public.stores
  FOR SELECT TO authenticated
  USING (created_by IS NULL OR created_by = auth.uid());

-- 3) Adding a store: returns an existing visible row with the same name
--    (case-insensitive) instead of duplicating; otherwise inserts a row owned
--    by the calling user.
CREATE OR REPLACE FUNCTION public.add_store(p_name text)
RETURNS public.stores
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_name text := btrim(coalesce(p_name, ''));
  v_row  public.stores;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;
  IF length(v_name) < 1 OR length(v_name) > 80 THEN
    RAISE EXCEPTION 'invalid_name';
  END IF;

  SELECT * INTO v_row FROM stores
   WHERE lower(name) = lower(v_name)
     AND (created_by IS NULL OR created_by = auth.uid())
   ORDER BY (created_by IS NULL) DESC
   LIMIT 1;
  IF FOUND THEN
    RETURN v_row;
  END IF;

  INSERT INTO stores (name, created_by)
  VALUES (v_name, auth.uid())
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;
GRANT EXECUTE ON FUNCTION public.add_store(text) TO authenticated;

-- 4) Vault doors: bulk-remove all wraps of one method (used when biometric is
--    disabled — PRF wraps may exist per device). Refuses to remove the last
--    remaining unlock method of an active vault, same as delete_vault_wrap.
CREATE OR REPLACE FUNCTION public.delete_vault_wraps_by_method(p_method text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_remaining int;
  v_has_vault boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;
  SELECT (vault_check IS NOT NULL) INTO v_has_vault FROM profiles WHERE id = auth.uid();
  SELECT count(*) INTO v_remaining FROM vault_wraps
   WHERE user_id = auth.uid() AND method <> p_method;
  IF v_has_vault AND v_remaining = 0 THEN
    RAISE EXCEPTION 'last_wrap' USING HINT = 'Cannot remove the last unlock method of an active vault';
  END IF;
  DELETE FROM vault_wraps WHERE user_id = auth.uid() AND method = p_method;
END;
$$;
GRANT EXECUTE ON FUNCTION public.delete_vault_wraps_by_method(text) TO authenticated;
