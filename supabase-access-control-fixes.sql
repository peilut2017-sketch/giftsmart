-- ── Access-control fixes: premium flag + marketplace mode enforcement ────────
-- Fixes three reported holes (run in the Supabase SQL Editor):
--
-- 1. "Premium disabled" still limited users: two server functions read a
--    premium_enabled column from a table named admin_settings, which does not
--    exist — the real flag lives in app_settings (key/value) behind
--    get_premium_enabled(). This file re-asserts the canonical boolean
--    function (dropping any legacy version with a different return type) and
--    points every server check at it.
--
-- 2. Marketplace "disabled": nothing server-side stopped listing/buying —
--    the mode was only a client-side redirect on the market page, while the
--    sell tab on the voucher page and bulk listing wrote straight through.
--
-- 3. Marketplace "selective": same — approval was never enforced server-side,
--    and add_watchlist_item's pro gate raised its exception INSIDE an
--    EXCEPTION WHEN OTHERS handler, which swallowed it, so the gate never
--    fired at all.

-- ── Canonical premium flag ───────────────────────────────────────────────────
-- DROP first: CREATE OR REPLACE cannot change a return type, and a legacy
-- text-returning version of this function is exactly what breaks the client
-- ("data !== false" is true for the string 'false').
DROP FUNCTION IF EXISTS get_premium_enabled();
CREATE FUNCTION get_premium_enabled()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT COALESCE(
    (SELECT value = 'true' FROM app_settings WHERE key = 'premium_enabled'),
    true
  );
$$;
GRANT EXECUTE ON FUNCTION get_premium_enabled TO anon, authenticated;

-- ── Marketplace access helper ────────────────────────────────────────────────
-- One source of truth for "may this user use the marketplace right now":
--   enabled   → everyone
--   disabled  → admins only
--   selective → admins + users whose access request was approved
CREATE OR REPLACE FUNCTION marketplace_access_ok()
RETURNS BOOLEAN
LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$
DECLARE
  v_mode TEXT;
BEGIN
  v_mode := COALESCE(
    (SELECT value FROM app_settings WHERE key = 'marketplace_mode'),
    'enabled'
  );

  IF v_mode = 'enabled' THEN
    RETURN TRUE;
  END IF;

  IF EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true) THEN
    RETURN TRUE;
  END IF;

  IF v_mode = 'selective' THEN
    RETURN EXISTS (
      SELECT 1 FROM marketplace_access_requests
      WHERE user_id = auth.uid() AND status = 'approved'
    );
  END IF;

  -- disabled, non-admin
  RETURN FALSE;
END;
$$;
GRANT EXECUTE ON FUNCTION marketplace_access_ok TO authenticated;

-- ── list_voucher_for_sale: enforce mode/approval ─────────────────────────────
CREATE OR REPLACE FUNCTION list_voucher_for_sale(
  p_voucher_id    UUID,
  p_asking_price  NUMERIC,
  p_description   TEXT DEFAULT NULL
)
RETURNS marketplace_listings
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_listing marketplace_listings;
BEGIN
  IF NOT marketplace_access_ok() THEN
    RAISE EXCEPTION 'marketplace_closed';
  END IF;

  -- Validate caller owns the voucher
  IF NOT EXISTS (
    SELECT 1 FROM vouchers WHERE id = p_voucher_id AND user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'unauthorized: voucher not owned by caller';
  END IF;

  -- Validate voucher is not already listed
  IF EXISTS (
    SELECT 1 FROM marketplace_listings
    WHERE voucher_id = p_voucher_id AND status IN ('active','pending_payment')
  ) THEN
    RAISE EXCEPTION 'already_listed: voucher is already for sale';
  END IF;

  -- Lock the voucher
  UPDATE vouchers
  SET is_locked = true, lock_reason = 'for_sale', updated_at = NOW()
  WHERE id = p_voucher_id;

  -- Create listing
  INSERT INTO marketplace_listings (voucher_id, seller_id, asking_price, description)
  VALUES (p_voucher_id, auth.uid(), p_asking_price, p_description)
  RETURNING * INTO v_listing;

  RETURN v_listing;
END;
$$;

-- ── buyer_confirm_payment: enforce mode/approval ─────────────────────────────
CREATE OR REPLACE FUNCTION buyer_confirm_payment(
  p_listing_id          UUID,
  p_payment_method_used TEXT
)
RETURNS marketplace_purchases
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_listing      marketplace_listings;
  v_purchase     marketplace_purchases;
  v_agreed_price NUMERIC;
BEGIN
  IF NOT marketplace_access_ok() THEN
    RAISE EXCEPTION 'marketplace_closed';
  END IF;

  SELECT * INTO v_listing
  FROM marketplace_listings
  WHERE id = p_listing_id AND status = 'active';

  IF v_listing.id IS NULL THEN RAISE EXCEPTION 'listing_not_found_or_not_active'; END IF;
  IF v_listing.seller_id = auth.uid() THEN RAISE EXCEPTION 'cannot_buy_own_listing'; END IF;

  IF EXISTS (
    SELECT 1 FROM marketplace_purchases
    WHERE listing_id = p_listing_id AND buyer_id = auth.uid()
      AND status IN ('pending_buyer_payment','buyer_confirmed')
  ) THEN
    RAISE EXCEPTION 'already_purchased';
  END IF;

  -- Use reserved price if this buyer has a negotiated deal
  v_agreed_price := CASE
    WHEN v_listing.reserved_buyer_id = auth.uid() AND v_listing.reserved_price IS NOT NULL
    THEN v_listing.reserved_price
    ELSE v_listing.asking_price
  END;

  INSERT INTO marketplace_purchases (
    listing_id, buyer_id, seller_id,
    payment_method_used, buyer_confirmed_at, status, agreed_price
  )
  VALUES (
    p_listing_id, auth.uid(), v_listing.seller_id,
    p_payment_method_used, NOW(), 'buyer_confirmed', v_agreed_price
  )
  RETURNING * INTO v_purchase;

  -- Clear reservation after use; update listing status
  UPDATE marketplace_listings
  SET status            = 'pending_payment',
      reserved_buyer_id = CASE WHEN reserved_buyer_id = auth.uid() THEN NULL ELSE reserved_buyer_id END,
      reserved_price    = CASE WHEN reserved_buyer_id = auth.uid() THEN NULL ELSE reserved_price    END,
      updated_at        = NOW()
  WHERE id = p_listing_id;

  RETURN v_purchase;
END;
$$;

-- ── add_watchlist_item: working pro gate ─────────────────────────────────────
-- The old version raised 'pro_required' inside a BEGIN...EXCEPTION WHEN OTHERS
-- handler — the raise was swallowed by its own handler and the gate never
-- fired. It also read premium_enabled from the nonexistent admin_settings.
CREATE OR REPLACE FUNCTION add_watchlist_item(
  p_store_name       TEXT,
  p_min_discount_pct INT     DEFAULT 0,
  p_notify_push      BOOLEAN DEFAULT TRUE,
  p_notify_email     BOOLEAN DEFAULT FALSE
) RETURNS marketplace_watchlist LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_item   marketplace_watchlist;
  v_is_pro BOOLEAN;
BEGIN
  IF NOT marketplace_access_ok() THEN
    RAISE EXCEPTION 'marketplace_closed';
  END IF;

  IF COALESCE((SELECT watchlist_pro_only FROM marketplace_settings LIMIT 1), TRUE)
     AND get_premium_enabled() THEN
    SELECT EXISTS (
      SELECT 1 FROM subscriptions
      WHERE user_id = auth.uid() AND plan = 'pro' AND status = 'active'
        AND (current_period_end IS NULL OR current_period_end > NOW())
    ) INTO v_is_pro;

    IF NOT v_is_pro THEN
      RAISE EXCEPTION 'pro_required';
    END IF;
  END IF;

  INSERT INTO marketplace_watchlist (user_id, store_name, min_discount_pct, notify_push, notify_email)
  VALUES (auth.uid(), trim(p_store_name), p_min_discount_pct, p_notify_push, p_notify_email)
  ON CONFLICT (user_id, store_name) DO UPDATE SET
    min_discount_pct = EXCLUDED.min_discount_pct,
    notify_push      = EXCLUDED.notify_push,
    notify_email     = EXCLUDED.notify_email
  RETURNING * INTO v_item;

  RETURN v_item;
END;
$$;

-- ── _set_listing_expiry: read the real premium flag ──────────────────────────
CREATE OR REPLACE FUNCTION _set_listing_expiry()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_days   INT;
  v_is_pro BOOLEAN;
BEGIN
  SELECT (plan = 'pro' AND status = 'active'
          AND (current_period_end IS NULL OR current_period_end > NOW()))
    INTO v_is_pro
  FROM subscriptions
  WHERE user_id = NEW.seller_id
  LIMIT 1;

  IF NOT FOUND THEN v_is_pro := FALSE; END IF;

  -- Premium system disabled → everyone gets pro listing duration
  IF NOT get_premium_enabled() THEN
    v_is_pro := TRUE;
  END IF;

  SELECT CASE WHEN v_is_pro THEN pro_listing_days ELSE free_listing_days END
    INTO v_days FROM marketplace_settings LIMIT 1;

  NEW.expires_at := NOW() + make_interval(days => COALESCE(v_days, 30));
  RETURN NEW;
END;
$$;
