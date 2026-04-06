-- Store Used Balance Updates
-- Run in Supabase Dashboard → SQL Editor
--
-- Adds optional p_store_used parameter to all balance-update RPC functions.
-- When provided, the store/place of use is recorded in activity_log and
-- included in the real-time notification sent to the voucher owner.


-- ── 0. Drop all overloaded versions of the three functions ───────────────────
-- Uses pg_proc to find every signature and drops them all, bypassing the
-- ambiguity error that occurs when multiple overloads share the same name.

DO $$
DECLARE
  r      RECORD;
  v_drop TEXT;
BEGIN
  FOR r IN
    SELECT p.proname,
           pg_catalog.pg_get_function_identity_arguments(p.oid) AS args
    FROM   pg_catalog.pg_proc p
    JOIN   pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE  p.proname IN (
             'update_voucher_balance_by_token',
             'update_shared_voucher_balance',
             'update_gift_voucher_balance'
           )
    AND    n.nspname = 'public'
  LOOP
    v_drop := format(
      'DROP FUNCTION IF EXISTS public.%I(%s) CASCADE',
      r.proname, r.args
    );
    EXECUTE v_drop;
  END LOOP;
END;
$$;

-- ── 1. update_voucher_balance_by_token (public shared link) ──────────────────

CREATE OR REPLACE FUNCTION update_voucher_balance_by_token(
  p_token       TEXT,
  p_new_balance NUMERIC,
  p_store_used  TEXT DEFAULT NULL
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

  IF p_new_balance < 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_balance');
  END IF;

  SELECT v.balance, v.store_name, v.wallet_id
  INTO   v_old_balance, v_store_name, v_wallet_id
  FROM   vouchers v
  WHERE  v.id = v_voucher_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'voucher_not_found');
  END IF;

  SELECT wm.user_id INTO v_owner_user_id
  FROM   wallet_members wm
  WHERE  wm.wallet_id = v_wallet_id AND wm.role = 'owner'
  LIMIT  1;

  UPDATE vouchers SET balance = p_new_balance WHERE id = v_voucher_id;

  IF v_owner_user_id IS NOT NULL THEN
    INSERT INTO activity_log (user_id, wallet_id, action, voucher_id, voucher_name, details)
    VALUES (
      v_owner_user_id,
      v_wallet_id,
      'balance_update',
      v_voucher_id,
      v_store_name,
      jsonb_build_object('from', v_old_balance, 'to', p_new_balance, 'source', 'shared_link')
      || CASE WHEN p_store_used IS NOT NULL AND p_store_used <> ''
              THEN jsonb_build_object('store_used', p_store_used)
              ELSE '{}'::jsonb END
    );

    INSERT INTO shared_balance_updates (voucher_id, owner_user_id, store_name, old_balance, new_balance, store_used)
    VALUES (v_voucher_id, v_owner_user_id, v_store_name, v_old_balance, p_new_balance, p_store_used);
  END IF;

  RETURN jsonb_build_object(
    'success',     true,
    'old_balance', v_old_balance,
    'new_balance', p_new_balance,
    'store_name',  v_store_name
  );
END;
$$;

GRANT EXECUTE ON FUNCTION update_voucher_balance_by_token TO anon, authenticated;


-- ── 2. update_shared_voucher_balance (authenticated share recipient) ──────────

CREATE OR REPLACE FUNCTION update_shared_voucher_balance(
  p_voucher_id  UUID,
  p_new_balance NUMERIC,
  p_store_used  TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old_balance   NUMERIC;
  v_store_name    TEXT;
  v_wallet_id     UUID;
  v_owner_user_id UUID;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM voucher_shares
    WHERE voucher_id = p_voucher_id AND shared_with_user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  SELECT balance, store_name, wallet_id
  INTO   v_old_balance, v_store_name, v_wallet_id
  FROM   vouchers WHERE id = p_voucher_id;

  UPDATE vouchers SET balance = p_new_balance, updated_at = NOW()
  WHERE id = p_voucher_id;

  -- Get wallet owner for logging
  SELECT wm.user_id INTO v_owner_user_id
  FROM   wallet_members wm
  WHERE  wm.wallet_id = v_wallet_id AND wm.role = 'owner'
  LIMIT  1;

  -- Log to owner's activity_log
  IF v_owner_user_id IS NOT NULL THEN
    INSERT INTO activity_log (user_id, wallet_id, action, voucher_id, voucher_name, details)
    VALUES (
      v_owner_user_id,
      v_wallet_id,
      'balance_update',
      p_voucher_id,
      v_store_name,
      jsonb_build_object('from', v_old_balance, 'to', p_new_balance, 'source', 'shared_user')
      || CASE WHEN p_store_used IS NOT NULL AND p_store_used <> ''
              THEN jsonb_build_object('store_used', p_store_used)
              ELSE '{}'::jsonb END
    );

    INSERT INTO shared_balance_updates (voucher_id, owner_user_id, store_name, old_balance, new_balance, store_used)
    VALUES (p_voucher_id, v_owner_user_id, v_store_name, v_old_balance, p_new_balance, p_store_used);
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION update_shared_voucher_balance TO authenticated;


-- ── 3. update_gift_voucher_balance (gift recipient) ───────────────────────────

CREATE OR REPLACE FUNCTION update_gift_voucher_balance(
  p_token       TEXT,
  p_new_balance NUMERIC,
  p_store_used  TEXT DEFAULT NULL
)
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

  INSERT INTO shared_balance_updates (voucher_id, owner_user_id, store_name, old_balance, new_balance, store_used)
  VALUES (v_gift.voucher_id, v_gift.sender_user_id, v_store_name, v_old_balance, p_new_balance, p_store_used);

  INSERT INTO activity_log (user_id, action, voucher_id, voucher_name, details)
  VALUES (
    v_gift.sender_user_id,
    'gift_balance_update',
    v_gift.voucher_id,
    v_store_name,
    jsonb_build_object('from', v_old_balance, 'to', p_new_balance)
    || CASE WHEN p_store_used IS NOT NULL AND p_store_used <> ''
            THEN jsonb_build_object('store_used', p_store_used)
            ELSE '{}'::jsonb END
  );

  RETURN jsonb_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION update_gift_voucher_balance TO anon, authenticated;


-- ── 4. Add store_used column to shared_balance_updates ────────────────────────
-- Allows the real-time notification to include the place of use.

ALTER TABLE shared_balance_updates
  ADD COLUMN IF NOT EXISTS store_used TEXT DEFAULT NULL;
