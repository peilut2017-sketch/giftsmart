-- Fix: E2EE vault metadata (salt + check) is stored only in localStorage,
-- so encrypted vouchers created on one device cannot be decrypted on another.
--
-- Solution: store vault_salt and vault_check per user in Supabase so any
-- device can derive the same vault key from the same login password.
-- The salt does NOT need to be secret — its purpose is to prevent
-- precomputed rainbow-table attacks; security depends on password strength.
--
-- Run once in: Supabase Dashboard → SQL Editor
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS vault_salt  TEXT,
  ADD COLUMN IF NOT EXISTS vault_check TEXT;

-- Save / update vault metadata for the calling user
CREATE OR REPLACE FUNCTION public.upsert_vault_meta(p_salt TEXT, p_check TEXT)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE profiles SET vault_salt = p_salt, vault_check = p_check WHERE id = auth.uid();
END;
$$;
GRANT EXECUTE ON FUNCTION public.upsert_vault_meta(TEXT, TEXT) TO authenticated;

-- Read vault metadata for the calling user (used on new / cleared devices)
CREATE OR REPLACE FUNCTION public.get_vault_meta()
RETURNS TABLE(vault_salt TEXT, vault_check TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN QUERY
    SELECT p.vault_salt, p.vault_check
    FROM   profiles p
    WHERE  p.id = auth.uid();
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_vault_meta() TO authenticated;

SELECT pg_notify('pgrst', 'reload schema');
