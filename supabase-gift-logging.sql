-- Migration: gift logging + is_gift column
-- Run in Supabase Dashboard → SQL Editor

-- ── 1. Add is_gift column to vouchers ────────────────────────────────────────
-- Marks vouchers that were received as gifts so the UI can show a gift icon.

ALTER TABLE vouchers ADD COLUMN IF NOT EXISTS is_gift BOOLEAN DEFAULT false;


-- ── 2. Update claim_gift to set is_gift and log gift_received ─────────────────
-- Also logs a gift_received entry in the recipient's activity_log.

CREATE OR REPLACE FUNCTION claim_gift(p_token TEXT)
RETURNS JSONB
SECURITY DEFINER LANGUAGE plpgsql AS $$
DECLARE
  v_gift        voucher_gifts;
  v_original    vouchers;
  v_wallet_id   UUID;
  v_new_voucher_id UUID;
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

  -- Copy voucher to recipient (mark as gift)
  INSERT INTO vouchers (
    user_id, wallet_id, store_name, amount, balance, code, cvv,
    expiry_date, categories, tags, notes, link, is_archived, is_shared, is_gift
  ) VALUES (
    auth.uid(), v_wallet_id,
    v_original.store_name, v_original.amount, v_original.balance,
    v_original.code, v_original.cvv, v_original.expiry_date,
    v_original.categories, v_original.tags,
    v_original.notes, v_original.link,
    false, false, true
  )
  RETURNING id INTO v_new_voucher_id;

  -- Archive original with gift note
  UPDATE vouchers SET
    is_archived = true,
    notes = CASE
      WHEN notes IS NOT NULL AND notes <> ''
        THEN notes || E'\n' || 'מתנה ל: ' || COALESCE(NULLIF(v_gift.recipient_email, ''), 'קישור')
      ELSE 'מתנה ל: ' || COALESCE(NULLIF(v_gift.recipient_email, ''), 'קישור')
    END
  WHERE id = v_gift.voucher_id;

  -- Mark as claimed
  UPDATE voucher_gifts
  SET claimed_at = NOW(), claimed_by_user_id = auth.uid()
  WHERE token = p_token;

  -- Log gift_received in recipient's activity_log
  INSERT INTO activity_log (user_id, wallet_id, action, voucher_id, voucher_name, details)
  VALUES (
    auth.uid(),
    v_wallet_id,
    'gift_received',
    v_new_voucher_id,
    v_original.store_name,
    jsonb_build_object(
      'sender', COALESCE(v_gift.sender_name, 'שולח לא ידוע'),
      'balance', v_original.balance,
      'message', v_gift.message
    )
  );

  RETURN jsonb_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION claim_gift TO authenticated;


-- ── 3. Update update_gift_voucher_balance to log gift_balance_update ──────────

CREATE OR REPLACE FUNCTION update_gift_voucher_balance(p_token TEXT, p_new_balance NUMERIC)
RETURNS JSONB
SECURITY DEFINER LANGUAGE plpgsql AS $$
DECLARE
  v_gift        voucher_gifts;
  v_old_balance NUMERIC;
  v_store_name  TEXT;
BEGIN
  SELECT * INTO v_gift FROM voucher_gifts WHERE token = p_token;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_found');
  END IF;

  SELECT balance, store_name INTO v_old_balance, v_store_name
  FROM vouchers WHERE id = v_gift.voucher_id;

  UPDATE vouchers SET balance = p_new_balance WHERE id = v_gift.voucher_id;

  -- Notify owner via Realtime
  INSERT INTO shared_balance_updates (voucher_id, owner_user_id, store_name, old_balance, new_balance)
  VALUES (v_gift.voucher_id, v_gift.sender_user_id, v_store_name, v_old_balance, p_new_balance);

  -- Log gift_balance_update in sender's activity_log
  INSERT INTO activity_log (user_id, action, voucher_id, voucher_name, details)
  VALUES (
    v_gift.sender_user_id,
    'gift_balance_update',
    v_gift.voucher_id,
    v_store_name,
    jsonb_build_object('from', v_old_balance, 'to', p_new_balance)
  );

  RETURN jsonb_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION update_gift_voucher_balance TO anon, authenticated;
