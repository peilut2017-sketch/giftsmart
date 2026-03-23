-- =============================================
-- Atomic wallet setup — fixes "users can't add vouchers" bug
--
-- ROOT CAUSE:
--   wallet_members INSERT can silently fail for new users due to RLS
--   evaluation order. When wallet_members is missing, get_my_wallet_ids()
--   returns an empty set and the vouchers INSERT RLS policy blocks all saves.
--
-- FIX:
--   A SECURITY DEFINER function that creates/fetches the user's wallet
--   and their wallet_members row in a single atomic transaction,
--   bypassing RLS entirely (safe: always operates only on auth.uid()).
--
-- HOW TO RUN:
--   Supabase Dashboard → SQL Editor → paste and run
-- =============================================

CREATE OR REPLACE FUNCTION get_or_create_user_wallet()
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_wallet_id UUID;
  v_email     TEXT;
BEGIN
  -- 1. Try to find an existing membership
  SELECT wallet_id INTO v_wallet_id
  FROM wallet_members
  WHERE user_id = auth.uid()
  ORDER BY created_at
  LIMIT 1;

  IF FOUND THEN
    RETURN v_wallet_id;
  END IF;

  -- 2. Resolve user email (profiles row created by handle_new_user trigger)
  SELECT email INTO v_email
  FROM profiles
  WHERE id = auth.uid();

  -- Fallback: read directly from auth.users if profile isn't ready yet
  IF v_email IS NULL THEN
    SELECT email INTO v_email
    FROM auth.users
    WHERE id = auth.uid();
  END IF;

  -- 3. Create a new wallet
  INSERT INTO wallets (name, owner_id)
  VALUES ('ארנק השוברים שלי', auth.uid())
  RETURNING id INTO v_wallet_id;

  -- 4. Add the user as owner (guaranteed to succeed — no RLS in SECURITY DEFINER)
  INSERT INTO wallet_members (wallet_id, user_id, email, role)
  VALUES (v_wallet_id, auth.uid(), COALESCE(v_email, ''), 'owner');

  RETURN v_wallet_id;
END;
$$;

GRANT EXECUTE ON FUNCTION get_or_create_user_wallet() TO authenticated;

-- Reload PostgREST schema cache
SELECT pg_notify('pgrst', 'reload schema');
