-- Shared Voucher Balance Updates
-- Run in Supabase Dashboard → SQL Editor
--
-- Enables: anyone with a valid share token can update a voucher's balance.
-- The voucher owner receives a real-time notification.
-- Every update is recorded in activity_log.

-- ── Table ────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS shared_balance_updates (
  id            UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  voucher_id    UUID        REFERENCES vouchers(id) ON DELETE CASCADE NOT NULL,
  owner_user_id UUID        NOT NULL,
  store_name    TEXT        NOT NULL,
  old_balance   NUMERIC     NOT NULL,
  new_balance   NUMERIC     NOT NULL,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE shared_balance_updates ENABLE ROW LEVEL SECURITY;

-- Owner can read their own update notifications
CREATE POLICY "Owner reads own balance updates"
  ON shared_balance_updates FOR SELECT
  USING (owner_user_id = auth.uid());

-- Enable Realtime so the owner receives live notifications
ALTER PUBLICATION supabase_realtime ADD TABLE shared_balance_updates;

-- ── Function ─────────────────────────────────────────────────────────────────
-- Called from the public shared-voucher page (no auth required).
-- Validates token, updates balance, logs the action, notifies owner.

CREATE OR REPLACE FUNCTION update_voucher_balance_by_token(
  p_token       TEXT,
  p_new_balance NUMERIC
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_voucher_id    UUID;
  v_expires_at    TIMESTAMPTZ;
  v_old_balance   NUMERIC;
  v_store_name    TEXT;
  v_wallet_id     UUID;
  v_owner_user_id UUID;
BEGIN
  -- Validate token
  SELECT svt.voucher_id, svt.expires_at
  INTO   v_voucher_id, v_expires_at
  FROM   shared_voucher_tokens svt
  WHERE  svt.token = p_token;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'token_not_found');
  END IF;

  IF v_expires_at IS NOT NULL AND v_expires_at < NOW() THEN
    RETURN jsonb_build_object('success', false, 'error', 'token_expired');
  END IF;

  -- Validate new balance
  IF p_new_balance < 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_balance');
  END IF;

  -- Get current voucher
  SELECT v.balance, v.store_name, v.wallet_id
  INTO   v_old_balance, v_store_name, v_wallet_id
  FROM   vouchers v
  WHERE  v.id = v_voucher_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'voucher_not_found');
  END IF;

  -- Get wallet owner
  SELECT wm.user_id INTO v_owner_user_id
  FROM   wallet_members wm
  WHERE  wm.wallet_id = v_wallet_id AND wm.role = 'owner'
  LIMIT  1;

  -- Update balance
  UPDATE vouchers SET balance = p_new_balance WHERE id = v_voucher_id;

  -- Activity log
  IF v_owner_user_id IS NOT NULL THEN
    INSERT INTO activity_log (user_id, wallet_id, action, voucher_id, voucher_name, details)
    VALUES (
      v_owner_user_id,
      v_wallet_id,
      'balance_update',
      v_voucher_id,
      v_store_name,
      jsonb_build_object(
        'from',   v_old_balance,
        'to',     p_new_balance,
        'source', 'shared_link'
      )
    );

    -- Notify owner
    INSERT INTO shared_balance_updates (voucher_id, owner_user_id, store_name, old_balance, new_balance)
    VALUES (v_voucher_id, v_owner_user_id, v_store_name, v_old_balance, p_new_balance);
  END IF;

  RETURN jsonb_build_object(
    'success',     true,
    'old_balance', v_old_balance,
    'new_balance', p_new_balance,
    'store_name',  v_store_name
  );
END;
$$;

-- Allow unauthenticated callers (shared link is public)
GRANT EXECUTE ON FUNCTION update_voucher_balance_by_token TO anon, authenticated;
