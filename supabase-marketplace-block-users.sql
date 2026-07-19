-- ─────────────────────────────────────────────────────────────────────────────
-- Block users from the marketplace — independent of marketplace_mode
--
-- Previously, blocking only existed as "access requests" tied to selective
-- mode (marketplace_access_requests). When marketplace_mode = 'enabled'
-- (open to everyone), there was no way to keep a specific bad actor out —
-- neither the frontend gate (MarketplacePage) nor any RPC checked for it.
--
-- This adds a dedicated marketplace_blocked flag on profiles, enforced:
--   - client-side (MarketplacePage redirects blocked users regardless of mode)
--   - server-side, inside the mutating RPCs themselves, so it can't be
--     bypassed by calling the API directly:
--       · list_voucher_for_sale   (supabase-marketplace.sql)
--       · send_marketplace_message (supabase-marketplace-v3.sql)
--       · buyer_confirm_payment    (supabase-marketplace-v3.sql)
--     Those two files have been updated in place with the same check — the
--     copies below exist only so this one file can be run standalone now.
--
-- Run once in: Supabase Dashboard → SQL Editor
-- ─────────────────────────────────────────────────────────────────────────────


-- ── 1. Schema ──────────────────────────────────────────────────────────────

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS marketplace_blocked boolean NOT NULL DEFAULT false;


-- ── 2. Self-check (any authenticated user can read their own status) ─────────

CREATE OR REPLACE FUNCTION get_my_marketplace_block_status()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT COALESCE((SELECT marketplace_blocked FROM profiles WHERE id = auth.uid()), false);
$$;
GRANT EXECUTE ON FUNCTION get_my_marketplace_block_status TO authenticated;


-- ── 3. Admin: set / clear a block ─────────────────────────────────────────────

CREATE OR REPLACE FUNCTION admin_set_marketplace_blocked(p_user_id UUID, p_blocked BOOLEAN)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  UPDATE profiles SET marketplace_blocked = p_blocked WHERE id = p_user_id;
END;
$$;
GRANT EXECUTE ON FUNCTION admin_set_marketplace_blocked TO authenticated;


-- ── 4. Admin: list currently-blocked users ────────────────────────────────────

CREATE OR REPLACE FUNCTION admin_get_marketplace_blocked_users()
RETURNS TABLE (user_id UUID)
LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  RETURN QUERY SELECT p.id FROM profiles p WHERE p.marketplace_blocked = true;
END;
$$;
GRANT EXECUTE ON FUNCTION admin_get_marketplace_blocked_users TO authenticated;


-- ── 5. Enforce inside the mutating marketplace RPCs (server-side, can't be
--      bypassed by calling the API directly) — canonical versions now also
--      live in supabase-marketplace.sql / supabase-marketplace-v3.sql ────────

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
  IF EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND marketplace_blocked = true) THEN
    RAISE EXCEPTION 'marketplace_blocked';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM vouchers WHERE id = p_voucher_id AND user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'unauthorized: voucher not owned by caller';
  END IF;

  IF EXISTS (
    SELECT 1 FROM marketplace_listings
    WHERE voucher_id = p_voucher_id AND status IN ('active','pending_payment')
  ) THEN
    RAISE EXCEPTION 'already_listed: voucher is already for sale';
  END IF;

  UPDATE vouchers
  SET is_locked = true, lock_reason = 'for_sale', updated_at = NOW()
  WHERE id = p_voucher_id;

  INSERT INTO marketplace_listings (voucher_id, seller_id, asking_price, description)
  VALUES (p_voucher_id, auth.uid(), p_asking_price, p_description)
  RETURNING * INTO v_listing;

  RETURN v_listing;
END;
$$;

CREATE OR REPLACE FUNCTION send_marketplace_message(
  p_listing_id    UUID,
  p_receiver_id   UUID,
  p_body          TEXT,
  p_msg_type      TEXT    DEFAULT 'text',
  p_offer_amount  NUMERIC DEFAULT NULL
)
RETURNS marketplace_messages
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_listing  marketplace_listings;
  v_msg      marketplace_messages;
BEGIN
  IF EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND marketplace_blocked = true) THEN
    RAISE EXCEPTION 'marketplace_blocked';
  END IF;

  SELECT * INTO v_listing FROM marketplace_listings WHERE id = p_listing_id;

  IF NOT FOUND THEN RAISE EXCEPTION 'listing_not_found'; END IF;

  IF v_listing.status NOT IN ('active','pending_payment') THEN
    RAISE EXCEPTION 'listing_not_available';
  END IF;

  IF auth.uid() <> v_listing.seller_id AND p_receiver_id <> v_listing.seller_id THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  IF auth.uid() = p_receiver_id THEN
    RAISE EXCEPTION 'cannot_message_yourself';
  END IF;

  IF p_msg_type = 'price_offer' AND (p_offer_amount IS NULL OR p_offer_amount <= 0) THEN
    RAISE EXCEPTION 'invalid_offer_amount';
  END IF;

  IF p_msg_type = 'price_offer' AND auth.uid() <> v_listing.seller_id
      AND p_offer_amount >= v_listing.asking_price THEN
    RAISE EXCEPTION 'offer_not_lower_than_asking_price';
  END IF;

  INSERT INTO marketplace_messages
    (listing_id, sender_id, receiver_id, body, msg_type, offer_amount, offer_status)
  VALUES (
    p_listing_id, auth.uid(), p_receiver_id, p_body, p_msg_type,
    CASE WHEN p_msg_type = 'price_offer' THEN p_offer_amount ELSE NULL END,
    CASE WHEN p_msg_type = 'price_offer' THEN 'pending'       ELSE NULL END
  )
  RETURNING * INTO v_msg;

  RETURN v_msg;
END;
$$;

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
  IF EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND marketplace_blocked = true) THEN
    RAISE EXCEPTION 'marketplace_blocked';
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

  UPDATE marketplace_listings
  SET status            = 'pending_payment',
      reserved_buyer_id = CASE WHEN reserved_buyer_id = auth.uid() THEN NULL ELSE reserved_buyer_id END,
      reserved_price    = CASE WHEN reserved_buyer_id = auth.uid() THEN NULL ELSE reserved_price    END,
      updated_at        = NOW()
  WHERE id = p_listing_id;

  RETURN v_purchase;
END;
$$;


SELECT pg_notify('pgrst', 'reload schema');
