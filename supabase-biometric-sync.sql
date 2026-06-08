-- Sync biometric (passkey) credential ID and wrapped vault key per user.
-- The WebAuthn credential itself is synced by Google Password Manager /
-- iCloud Keychain, but the app stores the credential ID and wrapped vault
-- key only in localStorage (per-device).  These columns let a new device
-- restore that metadata from Supabase so the synced passkey can be used
-- immediately without re-registering biometrics.
--
-- Run once in: Supabase Dashboard → SQL Editor
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS biometric_credential_id     text,
  ADD COLUMN IF NOT EXISTS biometric_wrapped_vault_key text;

-- Save credential ID + wrapped vault key for the calling user
CREATE OR REPLACE FUNCTION public.upsert_biometric_meta(
  p_credential_id       text,
  p_wrapped_vault_key   text
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE profiles
  SET biometric_credential_id     = p_credential_id,
      biometric_wrapped_vault_key = p_wrapped_vault_key
  WHERE id = auth.uid();
END;
$$;
GRANT EXECUTE ON FUNCTION public.upsert_biometric_meta(text, text) TO authenticated;

-- Clear biometric metadata (called on disable/logout)
CREATE OR REPLACE FUNCTION public.clear_biometric_meta()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE profiles
  SET biometric_credential_id     = NULL,
      biometric_wrapped_vault_key = NULL
  WHERE id = auth.uid();
END;
$$;
GRANT EXECUTE ON FUNCTION public.clear_biometric_meta() TO authenticated;

-- Read biometric metadata for the calling user
CREATE OR REPLACE FUNCTION public.get_biometric_meta()
RETURNS TABLE(biometric_credential_id text, biometric_wrapped_vault_key text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN QUERY
    SELECT p.biometric_credential_id, p.biometric_wrapped_vault_key
    FROM profiles p
    WHERE p.id = auth.uid();
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_biometric_meta() TO authenticated;

SELECT pg_notify('pgrst', 'reload schema');
