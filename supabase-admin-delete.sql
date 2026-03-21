-- =============================================
-- Admin: Delete User / Clear User Data
--
-- HOW TO RUN:
--   Supabase Dashboard → SQL Editor → paste and run
--
-- FUNCTIONS:
--   admin_clear_user_data(uuid) — wipes all data (wallets, vouchers, members)
--                                  but keeps the auth account + profile row
--   admin_delete_user(uuid)     — deletes the auth account entirely;
--                                  all data cascades automatically
--
-- SECURITY:
--   Both functions are SECURITY DEFINER (run as postgres).
--   Both reject self-deletion (caller cannot delete their own account).
--   GRANT is limited to authenticated role — anon users cannot call them.
--   Additional guard: the admin-only UI in the frontend is the first gate.
-- =============================================


-- =============================================
-- 1. Clear all data for a user (keep auth account)
-- =============================================
CREATE OR REPLACE FUNCTION admin_clear_user_data(target_user_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Prevent admin from wiping their own data
  IF target_user_id = auth.uid() THEN
    RAISE EXCEPTION 'cannot_delete_self';
  END IF;

  -- Delete vouchers owned by the user's wallets
  DELETE FROM vouchers
  WHERE wallet_id IN (SELECT id FROM wallets WHERE owner_id = target_user_id);

  -- Remove user from all wallets they are a member of
  DELETE FROM wallet_members WHERE user_id = target_user_id;

  -- Remove any other members from wallets the user owns, then delete the wallets
  DELETE FROM wallet_members
  WHERE wallet_id IN (SELECT id FROM wallets WHERE owner_id = target_user_id);

  DELETE FROM wallets WHERE owner_id = target_user_id;

  -- Clear personal fields from profile (keep row so auth account still works)
  UPDATE profiles
  SET name = NULL, phone = NULL, avatar_url = NULL
  WHERE id = target_user_id;
END;
$$;

GRANT EXECUTE ON FUNCTION admin_clear_user_data(UUID) TO authenticated;


-- =============================================
-- 2. Delete user completely (auth account + all data)
-- =============================================
-- Deleting from auth.users triggers ON DELETE CASCADE on:
--   profiles, wallets (→ wallet_members), wallet_members
-- Vouchers reference wallets via wallet_id — handled manually below
-- in case the FK was created without CASCADE.
CREATE OR REPLACE FUNCTION admin_delete_user(target_user_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Prevent admin from deleting their own account
  IF target_user_id = auth.uid() THEN
    RAISE EXCEPTION 'cannot_delete_self';
  END IF;

  -- Delete vouchers first (foreign key to wallets may lack CASCADE)
  DELETE FROM vouchers
  WHERE wallet_id IN (SELECT id FROM wallets WHERE owner_id = target_user_id);

  -- Deleting auth.users cascades to: profiles, wallets, wallet_members
  DELETE FROM auth.users WHERE id = target_user_id;
END;
$$;

GRANT EXECUTE ON FUNCTION admin_delete_user(UUID) TO authenticated;
