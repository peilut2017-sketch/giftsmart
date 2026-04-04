-- Migration: voucher gift sending
-- Run in Supabase Dashboard → SQL Editor

-- ── 1. Table ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS voucher_gifts (
  id                  UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  voucher_id          UUID        REFERENCES vouchers(id) ON DELETE CASCADE NOT NULL,
  sender_user_id      UUID        NOT NULL,
  sender_name         TEXT,
  recipient_email     TEXT        NOT NULL,
  message             TEXT,
  token               TEXT        UNIQUE NOT NULL,
  send_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  email_sent_at       TIMESTAMPTZ,
  claimed_at          TIMESTAMPTZ,
  claimed_by_user_id  UUID,
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE voucher_gifts ENABLE ROW LEVEL SECURITY;

-- Sender can view their own gifts
CREATE POLICY "gift_sender_select" ON voucher_gifts
  FOR SELECT USING (sender_user_id = auth.uid());

-- Sender can create gifts
CREATE POLICY "gift_sender_insert" ON voucher_gifts
  FOR INSERT WITH CHECK (sender_user_id = auth.uid());

-- Sender can cancel unclaimed gifts
CREATE POLICY "gift_sender_delete" ON voucher_gifts
  FOR DELETE USING (sender_user_id = auth.uid() AND claimed_at IS NULL);


-- ── 2. get_gift_by_token — public (anon) read ─────────────────────────────────

CREATE OR REPLACE FUNCTION get_gift_by_token(p_token TEXT)
RETURNS TABLE(
  gift_id        UUID,
  sender_name    TEXT,
  message        TEXT,
  send_at        TIMESTAMPTZ,
  claimed_at     TIMESTAMPTZ,
  store_name     TEXT,
  balance        NUMERIC,
  amount         NUMERIC,
  code           TEXT,
  expiry_date    TEXT,
  notes          TEXT
)
SECURITY DEFINER LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  SELECT
    g.id,
    g.sender_name,
    g.message,
    g.send_at,
    g.claimed_at,
    v.store_name,
    v.balance,
    v.amount,
    v.code,
    v.expiry_date,
    v.notes
  FROM voucher_gifts g
  JOIN vouchers v ON v.id = g.voucher_id
  WHERE g.token = p_token;
END;
$$;

GRANT EXECUTE ON FUNCTION get_gift_by_token TO anon, authenticated;


-- ── 3. update_gift_voucher_balance — public (anon) write ──────────────────────

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

  RETURN jsonb_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION update_gift_voucher_balance TO anon, authenticated;


-- ── 4. claim_gift — authenticated only ───────────────────────────────────────

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
  -- Cannot claim your own gift
  IF v_gift.sender_user_id = auth.uid() THEN
    RETURN jsonb_build_object('success', false, 'error', 'own_gift');
  END IF;

  SELECT * INTO v_original FROM vouchers WHERE id = v_gift.voucher_id;

  -- Find recipient's wallet (first by creation order)
  SELECT wallet_id INTO v_wallet_id
  FROM wallet_members
  WHERE user_id = auth.uid()
  ORDER BY created_at
  LIMIT 1;

  IF v_wallet_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'no_wallet');
  END IF;

  -- Copy voucher to recipient
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

  RETURN jsonb_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION claim_gift TO authenticated;
