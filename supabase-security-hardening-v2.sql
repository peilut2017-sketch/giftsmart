-- ═══════════════════════════════════════════════════════════════════════════
-- Security & Activity-Log Hardening v2
-- Run in Supabase Dashboard → SQL Editor (after all previous supabase-*.sql).
--
-- Fixes from the security/UX audit:
--   1. profiles.is_admin was client-writable  → privilege escalation to admin
--   2. anyone could INSERT themselves into any wallet → read all its codes
--   3. coupon codes world-readable + redeem_coupon trusted caller-supplied
--      user id + admin_create_coupon had no admin check
--   4. find_profile_by_email callable unauthenticated (email/UUID oracle)
--   5. gift tokens kept exposing the code after claim; balance not clamped
--   6. shared/gift balance updates: no actor attribution and no used-amount
--      in activity_log (owner couldn't tell who used the voucher / how much)
--   7. misc: search_path, decrypted_vouchers grants, notify_admin_telegram
--      jsonb body re-fix, realtime for support replies, CSPRNG telegram link
--      codes, welcome-email dedup flag, email rate-limit log table
-- ═══════════════════════════════════════════════════════════════════════════


-- ── 1. profiles: block client writes to privileged columns ───────────────────
-- The UPDATE policy allowed any column, including is_admin (added in
-- supabase-admin-flag.sql). Column-level grants limit PostgREST writes to the
-- fields the app actually edits; everything else goes through SECURITY DEFINER
-- RPCs which are unaffected by these grants.

DROP POLICY IF EXISTS "Users can update own profile" ON profiles;
CREATE POLICY "Users can update own profile"
  ON profiles FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

REVOKE UPDATE ON profiles FROM anon, authenticated;
REVOKE INSERT ON profiles FROM anon, authenticated;

DO $$
DECLARE
  v_cols TEXT;
BEGIN
  -- Grant only columns that exist in this database (some are added by optional
  -- migrations), so this file runs cleanly on any migration state.
  SELECT string_agg(quote_ident(column_name), ', ')
  INTO   v_cols
  FROM   information_schema.columns
  WHERE  table_schema = 'public' AND table_name = 'profiles'
  AND    column_name IN (
           'name', 'phone', 'avatar_url',
           'show_voucher_value', 'marketplace_payment_methods'
         );
  IF v_cols IS NOT NULL THEN
    EXECUTE format('GRANT UPDATE (%s) ON profiles TO authenticated', v_cols);
  END IF;

  SELECT string_agg(quote_ident(column_name), ', ')
  INTO   v_cols
  FROM   information_schema.columns
  WHERE  table_schema = 'public' AND table_name = 'profiles'
  AND    column_name IN ('id', 'email', 'name', 'phone', 'avatar_url');
  IF v_cols IS NOT NULL THEN
    EXECUTE format('GRANT INSERT (%s) ON profiles TO authenticated', v_cols);
  END IF;
END;
$$;


-- ── 2. wallet_members: joining is only allowed into your OWN wallet ──────────
-- The old "Users can join wallets" policy checked who joins but not where,
-- so any user could add themselves to any wallet_id and read all its vouchers.
-- Legitimate flows are unaffected: owners add members via the
-- "Owners can manage members" FOR ALL policy, and the client's self-heal path
-- only ever inserts the user into a wallet they own.

DROP POLICY IF EXISTS "Users can join wallets" ON wallet_members;
DROP POLICY IF EXISTS "Users can join own wallet" ON wallet_members;  -- re-run safe
CREATE POLICY "Users can join own wallet"
  ON wallet_members FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    AND wallet_id IN (SELECT id FROM wallets WHERE owner_id = auth.uid())
  );


-- ── 3. Coupons: hide codes, fix redeem_coupon, gate admin_create_coupon ─────
DROP POLICY IF EXISTS "read active coupons" ON coupons;
DROP POLICY IF EXISTS "admins read coupons" ON coupons;
CREATE POLICY "admins read coupons"
  ON coupons FOR SELECT
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true));

-- redeem_coupon: drop every overload (there are two signatures in older
-- migrations), then recreate WITHOUT the caller-supplied p_user_id.
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM   pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE  p.proname = 'redeem_coupon' AND n.nspname = 'public'
  LOOP
    EXECUTE format('DROP FUNCTION IF EXISTS %s CASCADE', r.sig);
  END LOOP;
END;
$$;

CREATE FUNCTION redeem_coupon(p_code text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id    uuid := auth.uid();
  v_coupon     coupons%rowtype;
  v_user_email text;
  v_period_end timestamptz;
  v_base       timestamptz;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'NOT_AUTHENTICATED');
  END IF;

  p_code := upper(trim(p_code));

  SELECT * INTO v_coupon FROM coupons WHERE code = p_code AND is_active = true;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_CODE');
  END IF;

  IF v_coupon.valid_until IS NOT NULL AND v_coupon.valid_until < now() THEN
    RETURN jsonb_build_object('success', false, 'error', 'EXPIRED');
  END IF;

  IF v_coupon.max_uses IS NOT NULL AND v_coupon.uses_count >= v_coupon.max_uses THEN
    RETURN jsonb_build_object('success', false, 'error', 'EXHAUSTED');
  END IF;

  IF EXISTS (SELECT 1 FROM coupon_redemptions WHERE coupon_id = v_coupon.id AND user_id = v_user_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'ALREADY_USED');
  END IF;

  SELECT email INTO v_user_email FROM auth.users WHERE id = v_user_id;

  IF v_coupon.restricted_to_email IS NOT NULL
     AND lower(v_user_email) != lower(v_coupon.restricted_to_email) THEN
    RETURN jsonb_build_object('success', false, 'error', 'NOT_ELIGIBLE');
  END IF;

  IF v_coupon.first_time_only THEN
    IF EXISTS (SELECT 1 FROM subscriptions WHERE user_id = v_user_id AND plan = 'pro') THEN
      RETURN jsonb_build_object('success', false, 'error', 'NOT_FIRST_TIME');
    END IF;
  END IF;

  -- time_free coupons: grant Pro access directly
  IF v_coupon.discount_type IN ('months_free', 'days_free') THEN
    SELECT current_period_end INTO v_base
      FROM subscriptions
     WHERE user_id = v_user_id AND plan = 'pro' AND status = 'active'
       AND (current_period_end IS NULL OR current_period_end > now());

    v_period_end := CASE v_coupon.discount_type
      WHEN 'months_free' THEN
        coalesce(v_base, now()) + (v_coupon.discount_value || ' months')::interval
      WHEN 'days_free' THEN
        coalesce(v_base, now()) + (v_coupon.discount_value || ' days')::interval
    END;

    INSERT INTO subscriptions (user_id, plan, status, current_period_end)
    VALUES (v_user_id, 'pro', 'active', v_period_end)
    ON CONFLICT (user_id) DO UPDATE
      SET plan = 'pro', status = 'active', current_period_end = v_period_end, updated_at = now();

    INSERT INTO coupon_redemptions (coupon_id, user_id, user_email)
    VALUES (v_coupon.id, v_user_id, v_user_email);

    UPDATE coupons SET uses_count = uses_count + 1 WHERE id = v_coupon.id;

    RETURN jsonb_build_object(
      'success',        true,
      'grant_type',     'time',
      'discount_type',  v_coupon.discount_type,
      'value',          v_coupon.discount_value,
      'valid_until',    v_period_end
    );
  END IF;

  -- percent / fixed: validate only, record redemption, return discount info
  IF v_coupon.discount_type IN ('percent', 'fixed') THEN
    INSERT INTO coupon_redemptions (coupon_id, user_id, user_email)
    VALUES (v_coupon.id, v_user_id, v_user_email);

    UPDATE coupons SET uses_count = uses_count + 1 WHERE id = v_coupon.id;

    RETURN jsonb_build_object(
      'success',            true,
      'grant_type',         'discount',
      'discount_type',      v_coupon.discount_type,
      'value',              v_coupon.discount_value,
      'stripe_coupon_code', v_coupon.stripe_coupon_code
    );
  END IF;

  RETURN jsonb_build_object('success', false, 'error', 'INVALID_CODE');
END;
$$;

REVOKE EXECUTE ON FUNCTION redeem_coupon(text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION redeem_coupon(text) TO authenticated;

-- admin_create_coupon had no admin check at all — any logged-in user could
-- mint themselves a free-Pro coupon and redeem it.
CREATE OR REPLACE FUNCTION admin_create_coupon(
  p_code              text,
  p_name              text,
  p_type              text    DEFAULT 'general',
  p_discount_type     text    DEFAULT 'months_free',
  p_discount_value    int     DEFAULT 1,
  p_max_uses          int     DEFAULT null,
  p_valid_until       timestamptz DEFAULT null,
  p_restricted_email  text    DEFAULT null,
  p_first_time_only   boolean DEFAULT false,
  p_stripe_coupon_code text   DEFAULT null
) RETURNS coupons LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_row coupons;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true) THEN
    RAISE EXCEPTION 'Access denied: admin only';
  END IF;

  INSERT INTO coupons (
    code, name, type, discount_type, discount_value,
    max_uses, valid_until, restricted_to_email,
    first_time_only, stripe_coupon_code, created_by
  ) VALUES (
    upper(trim(p_code)), p_name, p_type, p_discount_type, p_discount_value,
    p_max_uses, p_valid_until, lower(p_restricted_email),
    p_first_time_only, p_stripe_coupon_code, auth.uid()
  ) RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;

REVOKE EXECUTE ON FUNCTION admin_create_coupon(text, text, text, text, int, int, timestamptz, text, boolean, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION admin_create_coupon(text, text, text, text, int, int, timestamptz, text, boolean, text) TO authenticated;


-- ── 4. find_profile_by_email: authenticated only ──────────────────────────────
REVOKE EXECUTE ON FUNCTION find_profile_by_email(text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION find_profile_by_email(text) TO authenticated;
ALTER  FUNCTION find_profile_by_email(text) SET search_path = public;


-- ── 5. Gift tokens: stop exposing the code after claim; clamp balance ────────

-- 5a. get_gift_by_token — same return shape (safe CREATE OR REPLACE), but the
-- code is nulled once the gift was claimed. The page still renders the
-- "already claimed" state from claimed_at.
CREATE OR REPLACE FUNCTION get_gift_by_token(p_token text)
RETURNS TABLE (
  gift_id           uuid,
  sender_name       text,
  message           text,
  send_at           timestamptz,
  claimed_at        timestamptz,
  store_name        text,
  balance           numeric,
  amount            numeric,
  code              text,
  expiry_date       text,
  notes             text,
  link              text,
  balance_check_url text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    g.id                                  AS gift_id,
    g.sender_name,
    g.message,
    g.send_at,
    g.claimed_at,
    v.store_name,
    v.balance,
    v.amount,
    CASE WHEN g.claimed_at IS NOT NULL THEN NULL
         ELSE COALESCE(g.code_override, v.code) END AS code,
    v.expiry_date::text                   AS expiry_date,
    v.notes,
    v.link,
    sv.balance_check_url
  FROM voucher_gifts g
  JOIN vouchers v ON v.id = g.voucher_id
  LEFT JOIN super_vouchers sv ON sv.id = v.super_voucher_id
  WHERE g.token = p_token;
END;
$$;

GRANT EXECUTE ON FUNCTION get_gift_by_token TO anon, authenticated;

-- 5b. update_gift_voucher_balance — reject claimed gifts, clamp the new
-- balance to [0, current], record wallet_id + used amount + source.
CREATE OR REPLACE FUNCTION update_gift_voucher_balance(
  p_token       TEXT,
  p_new_balance NUMERIC,
  p_store_used  TEXT DEFAULT NULL
)
RETURNS JSONB
SECURITY DEFINER LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_gift        voucher_gifts;
  v_old_balance NUMERIC;
  v_store_name  TEXT;
  v_wallet_id   UUID;
  v_clamped     NUMERIC;
BEGIN
  SELECT * INTO v_gift FROM voucher_gifts WHERE token = p_token;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_found');
  END IF;

  -- After claim the voucher belongs to the recipient's wallet — the link must
  -- no longer be able to change balances.
  IF v_gift.claimed_at IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'gift_claimed');
  END IF;

  SELECT balance, store_name, wallet_id INTO v_old_balance, v_store_name, v_wallet_id
  FROM vouchers WHERE id = v_gift.voucher_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'voucher_not_found');
  END IF;

  -- An anonymous link may spend the balance, never raise it or go negative.
  v_clamped := GREATEST(0, LEAST(p_new_balance, v_old_balance));

  UPDATE vouchers SET balance = v_clamped, updated_at = NOW() WHERE id = v_gift.voucher_id;

  INSERT INTO shared_balance_updates (voucher_id, owner_user_id, store_name, old_balance, new_balance, store_used)
  VALUES (v_gift.voucher_id, v_gift.sender_user_id, v_store_name, v_old_balance, v_clamped, p_store_used);

  INSERT INTO activity_log (user_id, wallet_id, action, voucher_id, voucher_name, details)
  VALUES (
    v_gift.sender_user_id,
    v_wallet_id,
    'gift_balance_update',
    v_gift.voucher_id,
    v_store_name,
    jsonb_build_object(
      'from', v_old_balance,
      'to', v_clamped,
      'used', v_old_balance - v_clamped,
      'source', 'gift_link'
    )
    || CASE WHEN p_store_used IS NOT NULL AND p_store_used <> ''
            THEN jsonb_build_object('store_used', p_store_used)
            ELSE '{}'::jsonb END
  );

  RETURN jsonb_build_object('success', true, 'new_balance', v_clamped);
END;
$$;

GRANT EXECUTE ON FUNCTION update_gift_voucher_balance TO anon, authenticated;


-- ── 6. Shared-voucher balance updates: attribute the actor + used amount ─────

-- 6a. Authenticated share partner. Now logs to BOTH the owner's and the
-- partner's activity log with the correct action, actor name and used amount
-- (the client no longer writes its own — wrongly labelled — log entry).
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
  v_actor_name    TEXT;
  v_clamped       NUMERIC;
  v_details       JSONB;
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

  v_clamped := GREATEST(0, p_new_balance);

  UPDATE vouchers SET balance = v_clamped, updated_at = NOW()
  WHERE id = p_voucher_id;

  SELECT wm.user_id INTO v_owner_user_id
  FROM   wallet_members wm
  WHERE  wm.wallet_id = v_wallet_id AND wm.role = 'owner'
  LIMIT  1;

  SELECT COALESCE(NULLIF(trim(p.name), ''), p.email) INTO v_actor_name
  FROM profiles p WHERE p.id = auth.uid();

  v_details := jsonb_build_object(
    'from', v_old_balance,
    'to', v_clamped,
    'used', GREATEST(0, v_old_balance - v_clamped),
    'source', 'shared_user',
    'actor_user_id', auth.uid(),
    'actor_name', COALESCE(v_actor_name, '')
  )
  || CASE WHEN p_store_used IS NOT NULL AND p_store_used <> ''
          THEN jsonb_build_object('store_used', p_store_used)
          ELSE '{}'::jsonb END;

  -- Owner's log (unless the actor IS the owner)
  IF v_owner_user_id IS NOT NULL AND v_owner_user_id <> auth.uid() THEN
    INSERT INTO activity_log (user_id, wallet_id, action, voucher_id, voucher_name, details)
    VALUES (v_owner_user_id, v_wallet_id, 'balance_update', p_voucher_id, v_store_name, v_details);

    INSERT INTO shared_balance_updates (voucher_id, owner_user_id, store_name, old_balance, new_balance, store_used)
    VALUES (p_voucher_id, v_owner_user_id, v_store_name, v_old_balance, v_clamped, p_store_used);
  END IF;

  -- Actor's own log (so the partner sees their action in their history too)
  INSERT INTO activity_log (user_id, action, voucher_id, voucher_name, details)
  VALUES (auth.uid(), 'balance_update', p_voucher_id, v_store_name,
          v_details || jsonb_build_object('source', 'shared_by_me'));
END;
$$;

GRANT EXECUTE ON FUNCTION update_shared_voucher_balance TO authenticated;

-- 6b. Public share link — anonymous, but now records the used amount.
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
  v_clamped       NUMERIC;
BEGIN
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

  -- An anonymous link may spend the balance, never raise it.
  v_clamped := LEAST(p_new_balance, v_old_balance);

  SELECT wm.user_id INTO v_owner_user_id
  FROM   wallet_members wm
  WHERE  wm.wallet_id = v_wallet_id AND wm.role = 'owner'
  LIMIT  1;

  UPDATE vouchers SET balance = v_clamped, updated_at = NOW() WHERE id = v_voucher_id;

  IF v_owner_user_id IS NOT NULL THEN
    INSERT INTO activity_log (user_id, wallet_id, action, voucher_id, voucher_name, details)
    VALUES (
      v_owner_user_id,
      v_wallet_id,
      'balance_update',
      v_voucher_id,
      v_store_name,
      jsonb_build_object(
        'from', v_old_balance,
        'to', v_clamped,
        'used', GREATEST(0, v_old_balance - v_clamped),
        'source', 'shared_link'
      )
      || CASE WHEN p_store_used IS NOT NULL AND p_store_used <> ''
              THEN jsonb_build_object('store_used', p_store_used)
              ELSE '{}'::jsonb END
    );

    INSERT INTO shared_balance_updates (voucher_id, owner_user_id, store_name, old_balance, new_balance, store_used)
    VALUES (v_voucher_id, v_owner_user_id, v_store_name, v_old_balance, v_clamped, p_store_used);
  END IF;

  RETURN jsonb_build_object(
    'success',     true,
    'old_balance', v_old_balance,
    'new_balance', v_clamped,
    'store_name',  v_store_name
  );
END;
$$;

GRANT EXECUTE ON FUNCTION update_voucher_balance_by_token TO anon, authenticated;


-- ── 7. Misc function hygiene ──────────────────────────────────────────────────
ALTER FUNCTION increment_share_view_count(text) SET search_path = public;

-- decrypted_vouchers (pgsodium view) must never be readable by anon, and must
-- run with the caller's permissions. Both are re-asserted hard here.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.views
             WHERE table_schema = 'public' AND table_name = 'decrypted_vouchers') THEN
    EXECUTE 'REVOKE ALL ON decrypted_vouchers FROM anon';
    EXECUTE 'ALTER VIEW decrypted_vouchers SET (security_invoker = true)';
  END IF;
END;
$$;

-- Re-assert the CORRECT notify_admin_telegram (jsonb body). A later migration
-- (supabase-fix-user-registration.sql) accidentally re-introduced the broken
-- ::text cast; whichever ran last won. This locks in the working version.
CREATE OR REPLACE FUNCTION notify_admin_telegram(message text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_token  text;
  v_chat   RECORD;
BEGIN
  BEGIN
    SELECT value INTO v_token FROM app_settings WHERE key = 'telegram_bot_token';
    IF v_token IS NULL OR v_token = '' THEN RETURN; END IF;

    FOR v_chat IN
      SELECT tu.chat_id
      FROM   telegram_users tu
      JOIN   profiles p ON p.id = tu.user_id
      WHERE  p.is_admin = true
    LOOP
      PERFORM net.http_post(
        url     := 'https://api.telegram.org/bot' || v_token || '/sendMessage',
        headers := jsonb_build_object('Content-Type', 'application/json'),
        body    := jsonb_build_object(
                     'chat_id',    v_chat.chat_id,
                     'text',       message,
                     'parse_mode', 'HTML'
                   )
      );
    END LOOP;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
END;
$$;


-- ── 8. Admin support realtime actually working ───────────────────────────────
-- The admin listeners in App.tsx never fired: realtime enforces RLS, and
-- support tables only had owner-scoped policies; support_message_replies was
-- also missing from the realtime publication.
DO $$
BEGIN
  IF to_regclass('public.support_messages') IS NOT NULL THEN
    EXECUTE 'DROP POLICY IF EXISTS "Admins read all support messages" ON support_messages';
    EXECUTE 'CREATE POLICY "Admins read all support messages" ON support_messages FOR SELECT
             USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true))';
  END IF;

  IF to_regclass('public.support_message_replies') IS NOT NULL THEN
    EXECUTE 'DROP POLICY IF EXISTS "Admins read all support replies" ON support_message_replies';
    EXECUTE 'CREATE POLICY "Admins read all support replies" ON support_message_replies FOR SELECT
             USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true))';
    BEGIN
      EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE support_message_replies';
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
  END IF;
END;
$$;


-- ── 9. Telegram link codes: CSPRNG, generated server-side ────────────────────
-- The client used Math.random() 6-digit codes (guessable). Codes are now
-- 12 hex chars from gen_random_bytes, minted by an RPC.
CREATE OR REPLACE FUNCTION create_telegram_link_code()
RETURNS text LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_code text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;
  v_code := upper(encode(gen_random_bytes(6), 'hex'));
  DELETE FROM telegram_link_codes WHERE user_id = auth.uid();
  INSERT INTO telegram_link_codes (code, user_id, expires_at)
  VALUES (v_code, auth.uid(), now() + interval '10 minutes');
  RETURN v_code;
END;
$$;

REVOKE EXECUTE ON FUNCTION create_telegram_link_code() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION create_telegram_link_code() TO authenticated;

-- Client no longer needs to INSERT link codes directly.
DROP POLICY IF EXISTS "Users can insert own link codes" ON telegram_link_codes;


-- ── 10. Welcome email: one-shot flag ─────────────────────────────────────────
-- Returns true exactly once per user, and only for accounts created recently
-- (so existing users don't suddenly get a welcome email on their next login).
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS welcome_email_sent BOOLEAN DEFAULT FALSE;

CREATE OR REPLACE FUNCTION should_send_welcome_email()
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_recent boolean;
BEGIN
  IF auth.uid() IS NULL THEN RETURN false; END IF;
  UPDATE profiles
  SET    welcome_email_sent = TRUE
  WHERE  id = auth.uid() AND welcome_email_sent IS DISTINCT FROM TRUE
  RETURNING (created_at > now() - interval '3 days') INTO v_recent;
  RETURN COALESCE(v_recent, false);
END;
$$;

REVOKE EXECUTE ON FUNCTION should_send_welcome_email() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION should_send_welcome_email() TO authenticated;


-- ── 11. Email rate-limit log (used by the send-email Edge Function) ──────────
-- RLS enabled with no policies: only the service role (Edge Function) touches it.
CREATE TABLE IF NOT EXISTS email_send_log (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id    UUID,
  email_type TEXT,
  recipient  TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE email_send_log ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS email_send_log_user_idx ON email_send_log (user_id, created_at DESC);


SELECT pg_notify('pgrst', 'reload schema');
