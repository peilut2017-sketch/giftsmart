-- ── Self-serve account deletion ──────────────────────────────────────────────
-- Both app stores REQUIRE that a user can delete their account (and its data)
-- from inside the app: Apple guideline 5.1.1(v) and Google Play's account
-- deletion policy. Until now "מחק חשבון" only opened a support ticket.
--
-- Mirrors admin_delete_user, scoped to the caller. Deleting the auth.users row
-- cascades to profiles, wallets, wallet_members, subscriptions, and every
-- table with ON DELETE CASCADE on the user id.
--
-- Run in the Supabase SQL Editor.

CREATE OR REPLACE FUNCTION delete_own_account()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  -- Admins must not self-delete by accident from the app flow
  IF EXISTS (SELECT 1 FROM profiles WHERE id = v_uid AND is_admin = true) THEN
    RAISE EXCEPTION 'admin_cannot_self_delete';
  END IF;

  -- Vouchers first (wallet FK may lack CASCADE)
  DELETE FROM vouchers
  WHERE wallet_id IN (SELECT id FROM wallets WHERE owner_id = v_uid);

  -- Cascades to profiles, wallets, wallet_members and the rest
  DELETE FROM auth.users WHERE id = v_uid;
END;
$$;

REVOKE ALL ON FUNCTION delete_own_account() FROM anon, public;
GRANT EXECUTE ON FUNCTION delete_own_account() TO authenticated;
