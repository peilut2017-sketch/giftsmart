-- Fix sharing functions: case-insensitive email lookup + auth.users fallback
-- Run this in Supabase Dashboard → SQL Editor
--
-- Problems fixed:
-- 1. share_voucher_with_email searched profiles.email with case-sensitive =
--    (same issue as find_profile_by_email — OAuth users have NULL there)
-- 2. After sharing, voucher.is_shared was never set to true
--    (so the "shared" filter tab was always empty)

CREATE OR REPLACE FUNCTION share_voucher_with_email(
  p_voucher_id UUID,
  p_email      TEXT
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_inserted BOOLEAN;
BEGIN
  -- Verify caller owns this voucher
  IF NOT EXISTS (
    SELECT 1 FROM vouchers v
    JOIN wallet_members wm ON wm.wallet_id = v.wallet_id
      AND wm.user_id = auth.uid()
      AND wm.role = 'owner'
    WHERE v.id = p_voucher_id
  ) THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  -- Case-insensitive lookup in profiles first
  SELECT id INTO v_user_id FROM profiles WHERE LOWER(email) = LOWER(p_email) LIMIT 1;

  -- Fallback: auth.users (handles Google/OAuth users where profiles.email is NULL)
  IF v_user_id IS NULL THEN
    SELECT id INTO v_user_id FROM auth.users WHERE LOWER(email) = LOWER(p_email) LIMIT 1;
  END IF;

  IF v_user_id IS NULL THEN
    RETURN 'not_found';
  END IF;

  -- Insert; detect duplicate
  INSERT INTO voucher_shares (voucher_id, shared_by, shared_with_email, shared_with_user_id)
    VALUES (p_voucher_id, auth.uid(), p_email, v_user_id)
    ON CONFLICT (voucher_id, shared_with_email) DO NOTHING;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  IF v_inserted = 0 THEN
    RETURN 'already_shared';
  END IF;

  -- Mark the voucher as shared
  UPDATE vouchers SET is_shared = TRUE WHERE id = p_voucher_id;

  RETURN 'shared';
END;
$$;
GRANT EXECUTE ON FUNCTION share_voucher_with_email TO authenticated;


-- Also fix unshare_voucher to clear is_shared when last share is removed
CREATE OR REPLACE FUNCTION unshare_voucher(
  p_voucher_id UUID,
  p_email      TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM voucher_shares
  WHERE voucher_id = p_voucher_id
    AND shared_with_email = p_email
    AND shared_by = auth.uid();

  -- Clear is_shared flag when no more shares remain
  IF NOT EXISTS (SELECT 1 FROM voucher_shares WHERE voucher_id = p_voucher_id) THEN
    UPDATE vouchers SET is_shared = FALSE WHERE id = p_voucher_id;
  END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION unshare_voucher TO authenticated;
