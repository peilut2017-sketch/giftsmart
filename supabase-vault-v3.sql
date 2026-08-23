-- ─────────────────────────────────────────────────────────────────────────────
-- Vault v3: envelope encryption — one random master key (MK), multiple server-
-- stored "wraps" (doors), each openable only by a secret the user holds:
--   password  — KEK derived client-side from the login password (PBKDF2 600k)
--   recovery  — key derived from the 24-char recovery phrase
--   prf       — WebAuthn PRF output of a passkey (slot_id = credential id)
--   device    — reserved for future device-to-device linking
-- The server never holds any of the unwrapping secrets, so storing every wrap
-- here is safe and is what makes new-device access + real recovery possible.
--
-- Purely additive: nothing existing is modified or deleted. v2 clients keep
-- working unchanged. Run once in: Supabase Dashboard → SQL Editor.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS vault_version int NOT NULL DEFAULT 2;

CREATE TABLE IF NOT EXISTS public.vault_wraps (
  user_id      uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  method       text        NOT NULL CHECK (method IN ('password','recovery','prf','device')),
  slot_id      text        NOT NULL DEFAULT '',
  wrapped_mk   text        NOT NULL,
  kdf          jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  PRIMARY KEY (user_id, method, slot_id)
);

ALTER TABLE public.vault_wraps ENABLE ROW LEVEL SECURITY;
-- No direct policies: all access goes through the SECURITY DEFINER RPCs below,
-- matching the project rule that every mutation is RPC-only.

-- ── Read everything the unlock ladder needs in one round trip ────────────────
CREATE OR REPLACE FUNCTION public.get_vault_bundle()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_meta record;
  v_wraps jsonb;
BEGIN
  SELECT vault_salt, vault_check, vault_version
    INTO v_meta
    FROM profiles WHERE id = auth.uid();

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'method', w.method,
           'slot_id', w.slot_id,
           'wrapped_mk', w.wrapped_mk,
           'kdf', w.kdf
         )), '[]'::jsonb)
    INTO v_wraps
    FROM vault_wraps w WHERE w.user_id = auth.uid();

  RETURN jsonb_build_object(
    'vault_salt',    v_meta.vault_salt,
    'vault_check',   v_meta.vault_check,
    'vault_version', COALESCE(v_meta.vault_version, 2),
    'wraps',         v_wraps
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_vault_bundle() TO authenticated;

-- ── Add / replace one wrap ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.upsert_vault_wrap(
  p_method text, p_slot_id text, p_wrapped_mk text, p_kdf jsonb
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO vault_wraps (user_id, method, slot_id, wrapped_mk, kdf, last_used_at)
  VALUES (auth.uid(), p_method, COALESCE(p_slot_id, ''), p_wrapped_mk, COALESCE(p_kdf, '{}'::jsonb), now())
  ON CONFLICT (user_id, method, slot_id)
  DO UPDATE SET wrapped_mk = EXCLUDED.wrapped_mk,
                kdf        = EXCLUDED.kdf,
                created_at = now(),
                last_used_at = now();
END;
$$;
GRANT EXECUTE ON FUNCTION public.upsert_vault_wrap(text, text, text, jsonb) TO authenticated;

-- ── Remove one wrap — refuses to delete the last door of an active vault ─────
CREATE OR REPLACE FUNCTION public.delete_vault_wrap(p_method text, p_slot_id text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_remaining int;
  v_has_vault boolean;
BEGIN
  SELECT (vault_check IS NOT NULL) INTO v_has_vault FROM profiles WHERE id = auth.uid();
  SELECT count(*) INTO v_remaining FROM vault_wraps
   WHERE user_id = auth.uid()
     AND NOT (method = p_method AND slot_id = COALESCE(p_slot_id, ''));
  IF v_has_vault AND v_remaining = 0 THEN
    RAISE EXCEPTION 'last_wrap' USING HINT = 'Cannot remove the last unlock method of an active vault';
  END IF;
  DELETE FROM vault_wraps
   WHERE user_id = auth.uid() AND method = p_method AND slot_id = COALESCE(p_slot_id, '');
END;
$$;
GRANT EXECUTE ON FUNCTION public.delete_vault_wrap(text, text) TO authenticated;

-- ── Mark the account as migrated to v3 ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_vault_version(p_version int)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE profiles SET vault_version = p_version WHERE id = auth.uid();
END;
$$;
GRANT EXECUTE ON FUNCTION public.set_vault_version(int) TO authenticated;

-- ── Atomic re-key / disable ──────────────────────────────────────────────────
-- The ONLY entry point for flows that rewrite voucher ciphertexts (legacy
-- passphrase migration, optional full key rotation, disabling encryption).
-- Everything — vault meta, wraps, and every voucher row — commits in one
-- transaction, so a mid-flight failure leaves the previous state fully intact.
-- (Replaces the old client-side sequence that committed the new key BEFORE
-- writing the re-encrypted vouchers — a network drop there lost data.)
--
-- p_salt / p_check NULL  → disable: clears vault meta and deletes all wraps.
-- p_wraps: [{method, slot_id, wrapped_mk, kdf}] — replaces ALL existing wraps.
-- p_entries: [{id, code, cvv, is_e2ee}] — voucher rows to update (only rows
--            owned by the caller are touched).
CREATE OR REPLACE FUNCTION public.commit_vault_rekey(
  p_salt text, p_check text, p_version int, p_wraps jsonb, p_entries jsonb
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_updated int := 0;
  w jsonb;
  e jsonb;
BEGIN
  UPDATE profiles
     SET vault_salt = p_salt,
         vault_check = p_check,
         vault_version = COALESCE(p_version, vault_version)
   WHERE id = auth.uid();

  DELETE FROM vault_wraps WHERE user_id = auth.uid();
  FOR w IN SELECT * FROM jsonb_array_elements(COALESCE(p_wraps, '[]'::jsonb)) LOOP
    INSERT INTO vault_wraps (user_id, method, slot_id, wrapped_mk, kdf)
    VALUES (auth.uid(), w->>'method', COALESCE(w->>'slot_id',''), w->>'wrapped_mk', COALESCE(w->'kdf','{}'::jsonb));
  END LOOP;

  FOR e IN SELECT * FROM jsonb_array_elements(COALESCE(p_entries, '[]'::jsonb)) LOOP
    UPDATE vouchers
       SET code = e->>'code',
           cvv  = NULLIF(e->>'cvv', ''),
           is_e2ee = COALESCE((e->>'is_e2ee')::boolean, is_e2ee)
     WHERE id = (e->>'id')::uuid AND user_id = auth.uid();
    IF FOUND THEN v_updated := v_updated + 1; END IF;
  END LOOP;

  RETURN jsonb_build_object('updated', v_updated);
END;
$$;
GRANT EXECUTE ON FUNCTION public.commit_vault_rekey(text, text, int, jsonb, jsonb) TO authenticated;

SELECT pg_notify('pgrst', 'reload schema');
