-- ── 1. Premium feature flag ───────────────────────────────────────────────────
-- Stored in app_settings table (key = 'premium_enabled', value = 'true'/'false')
-- Default: 'true' (premium system active). Set to 'false' to give everyone Pro.

-- Ensure default exists
INSERT INTO app_settings (key, value)
VALUES ('premium_enabled', 'true')
ON CONFLICT (key) DO NOTHING;

-- Public-readable function (anon can call)
CREATE OR REPLACE FUNCTION get_premium_enabled()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT COALESCE(
    (SELECT value = 'true' FROM app_settings WHERE key = 'premium_enabled'),
    true
  );
$$;
GRANT EXECUTE ON FUNCTION get_premium_enabled TO anon, authenticated;

-- Admin-only setter (checks is_admin in profiles)
CREATE OR REPLACE FUNCTION admin_set_premium_enabled(p_enabled BOOLEAN)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  INSERT INTO app_settings (key, value)
    VALUES ('premium_enabled', p_enabled::text)
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
END;
$$;
GRANT EXECUTE ON FUNCTION admin_set_premium_enabled TO authenticated;


-- ── 2. Allow gift without recipient email (link-only gifts) ───────────────────
ALTER TABLE voucher_gifts ALTER COLUMN recipient_email DROP NOT NULL;

-- Update claim_gift to handle null recipient_email gracefully
CREATE OR REPLACE FUNCTION claim_gift(p_token TEXT)
RETURNS JSONB
SECURITY DEFINER LANGUAGE plpgsql AS $$
DECLARE
  v_gift       voucher_gifts;
  v_original   vouchers;
  v_wallet_id  UUID;
BEGIN
  SELECT * INTO v_gift FROM voucher_gifts WHERE token = p_token;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_found');
  END IF;
  IF v_gift.claimed_at IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'already_claimed');
  END IF;
  IF v_gift.sender_user_id = auth.uid() THEN
    RETURN jsonb_build_object('success', false, 'error', 'own_gift');
  END IF;

  SELECT * INTO v_original FROM vouchers WHERE id = v_gift.voucher_id;

  SELECT wallet_id INTO v_wallet_id
  FROM wallet_members
  WHERE user_id = auth.uid()
  ORDER BY created_at
  LIMIT 1;

  IF v_wallet_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'no_wallet');
  END IF;

  INSERT INTO vouchers (
    user_id, wallet_id, store_name, amount, balance, code, cvv,
    expiry_date, categories, tags, notes, link, is_archived, is_shared
  ) VALUES (
    auth.uid(), v_wallet_id,
    v_original.store_name, v_original.amount, v_original.balance,
    v_original.code, v_original.cvv, v_original.expiry_date,
    v_original.categories, v_original.tags,
    v_original.notes, v_original.link,
    false, false
  );

  UPDATE vouchers SET
    is_archived = true,
    notes = CASE
      WHEN notes IS NOT NULL AND notes <> ''
        THEN notes || E'\n' || 'מתנה ל: ' || COALESCE(v_gift.recipient_email, 'קישור')
      ELSE 'מתנה ל: ' || COALESCE(v_gift.recipient_email, 'קישור')
    END
  WHERE id = v_gift.voucher_id;

  UPDATE voucher_gifts
  SET claimed_at = NOW(), claimed_by_user_id = auth.uid()
  WHERE token = p_token;

  RETURN jsonb_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION claim_gift TO authenticated;
