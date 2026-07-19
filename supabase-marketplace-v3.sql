-- ─────────────────────────────────────────────────────────────────────────────
-- Marketplace v3 — Run AFTER supabase-marketplace.sql and supabase-marketplace-chat.sql
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── 1. Price reservations on listings ───────────────────────────────────────
-- When a buyer's price offer is accepted (or seller's counter-offer is accepted),
-- the agreed price is reserved for the specific buyer rather than changing the
-- public asking_price — preventing opportunistic purchases by others.
ALTER TABLE marketplace_listings
  ADD COLUMN IF NOT EXISTS reserved_buyer_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reserved_price    NUMERIC(10,2);

-- ─── 2. Store the agreed price on the purchase record ────────────────────────
ALTER TABLE marketplace_purchases
  ADD COLUMN IF NOT EXISTS agreed_price NUMERIC(10,2);

-- ─── 3. Fix get_my_listings: expose buyer_id so the seller can report them ───
CREATE OR REPLACE FUNCTION get_my_listings()
RETURNS TABLE (
  id                  UUID,
  voucher_id          UUID,
  seller_id           UUID,
  asking_price        NUMERIC,
  reserved_price      NUMERIC,
  reserved_buyer_id   UUID,
  description         TEXT,
  status              TEXT,
  created_at          TIMESTAMPTZ,
  store_name          TEXT,
  balance             NUMERIC,
  expiry_date         DATE,
  purchase_id         UUID,
  purchase_status     TEXT,
  buyer_id            UUID,
  buyer_name          TEXT,
  buyer_email         TEXT,
  payment_method_used TEXT
)
LANGUAGE plpgsql SECURITY DEFINER STABLE AS $$
BEGIN
  RETURN QUERY
  SELECT
    ml.id,
    ml.voucher_id,
    ml.seller_id,
    ml.asking_price,
    ml.reserved_price,
    ml.reserved_buyer_id,
    ml.description,
    ml.status,
    ml.created_at,
    v.store_name,
    v.balance,
    v.expiry_date,
    mp.id          AS purchase_id,
    mp.status      AS purchase_status,
    mp.buyer_id    AS buyer_id,
    bp.name        AS buyer_name,
    bp.email       AS buyer_email,
    mp.payment_method_used
  FROM marketplace_listings ml
  JOIN vouchers v ON v.id = ml.voucher_id
  LEFT JOIN marketplace_purchases mp ON mp.listing_id = ml.id
    AND mp.status IN ('pending_buyer_payment','buyer_confirmed')
  LEFT JOIN profiles bp ON bp.id = mp.buyer_id
  WHERE ml.seller_id = auth.uid()
  ORDER BY ml.created_at DESC;
END;
$$;

-- ─── 4. Allow BOTH buyer and seller to send price offers ─────────────────────
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
  -- Blocked users cannot message or send/respond to offers, regardless of marketplace mode
  IF EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND marketplace_blocked = true) THEN
    RAISE EXCEPTION 'marketplace_blocked';
  END IF;

  SELECT * INTO v_listing FROM marketplace_listings WHERE id = p_listing_id;

  IF NOT FOUND THEN RAISE EXCEPTION 'listing_not_found'; END IF;

  IF v_listing.status NOT IN ('active','pending_payment') THEN
    RAISE EXCEPTION 'listing_not_available';
  END IF;

  -- Must involve the seller on one side
  IF auth.uid() <> v_listing.seller_id AND p_receiver_id <> v_listing.seller_id THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  IF auth.uid() = p_receiver_id THEN
    RAISE EXCEPTION 'cannot_message_yourself';
  END IF;

  -- price_offer: both buyer and seller can propose; validate amount
  IF p_msg_type = 'price_offer' AND (p_offer_amount IS NULL OR p_offer_amount <= 0) THEN
    RAISE EXCEPTION 'invalid_offer_amount';
  END IF;

  -- Buyer's offer must be less than the current asking price
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

-- ─── 5. respond_to_price_offer: use reservation instead of global price update
CREATE OR REPLACE FUNCTION respond_to_price_offer(
  p_message_id UUID,
  p_response   TEXT  -- 'accepted' | 'rejected'
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_msg      marketplace_messages;
  v_listing  marketplace_listings;
  v_buyer_id UUID;
BEGIN
  SELECT * INTO v_msg FROM marketplace_messages WHERE id = p_message_id;
  IF NOT FOUND     THEN RAISE EXCEPTION 'message_not_found'; END IF;
  IF v_msg.receiver_id <> auth.uid() THEN RAISE EXCEPTION 'not_authorized'; END IF;
  IF v_msg.msg_type    <> 'price_offer' THEN RAISE EXCEPTION 'not_a_price_offer'; END IF;
  IF v_msg.offer_status <> 'pending'   THEN RAISE EXCEPTION 'already_responded'; END IF;
  IF p_response NOT IN ('accepted','rejected') THEN RAISE EXCEPTION 'invalid_response'; END IF;

  UPDATE marketplace_messages SET offer_status = p_response WHERE id = p_message_id;

  IF p_response = 'accepted' THEN
    SELECT * INTO v_listing FROM marketplace_listings WHERE id = v_msg.listing_id;

    -- Determine who gets the price reservation (always the buyer in the deal)
    v_buyer_id := CASE
      WHEN v_listing.seller_id = v_msg.sender_id THEN auth.uid()   -- seller sent, buyer (me) accepts
      ELSE v_msg.sender_id                                           -- buyer sent, seller (me) accepts
    END;

    UPDATE marketplace_listings
    SET reserved_buyer_id = v_buyer_id,
        reserved_price    = v_msg.offer_amount,
        updated_at        = NOW()
    WHERE id = v_msg.listing_id;
  END IF;
END;
$$;

-- ─── 6. buyer_confirm_payment: use reserved price if applicable ───────────────
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
  -- Blocked users cannot buy, regardless of the marketplace's open/selective mode
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

-- ─── 7. Seller can update listing asking price ────────────────────────────────
CREATE OR REPLACE FUNCTION update_listing_price(
  p_listing_id UUID,
  p_new_price  NUMERIC
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF p_new_price IS NULL OR p_new_price <= 0 THEN
    RAISE EXCEPTION 'invalid_price';
  END IF;

  UPDATE marketplace_listings
  SET asking_price      = p_new_price,
      reserved_buyer_id = NULL,   -- clear any outstanding reservation
      reserved_price    = NULL,
      updated_at        = NOW()
  WHERE id = p_listing_id
    AND seller_id = auth.uid()
    AND status = 'active';

  IF NOT FOUND THEN RAISE EXCEPTION 'not_authorized_or_not_active'; END IF;
END;
$$;

-- ─── 8. Per-listing unread chat counts for the current user ──────────────────
CREATE OR REPLACE FUNCTION get_chat_unread_by_listing()
RETURNS TABLE (listing_id UUID, unread_count BIGINT)
LANGUAGE plpgsql SECURITY DEFINER STABLE AS $$
BEGIN
  RETURN QUERY
  SELECT  m.listing_id,
          COUNT(*) AS unread_count
  FROM    marketplace_messages m
  WHERE   m.receiver_id = auth.uid()
    AND   m.is_read = FALSE
  GROUP BY m.listing_id;
END;
$$;

-- ─── 9. get_listing_conversations: add unread_count per conversation ──────────
CREATE OR REPLACE FUNCTION get_listing_conversations(p_listing_id UUID)
RETURNS TABLE (
  other_user_id    UUID,
  other_user_name  TEXT,
  other_user_email TEXT,
  last_body        TEXT,
  last_at          TIMESTAMPTZ,
  message_count    BIGINT,
  unread_count     BIGINT
)
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM marketplace_listings
    WHERE id = p_listing_id AND seller_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  RETURN QUERY
  WITH ranked AS (
    SELECT
      CASE WHEN mm.sender_id = auth.uid() THEN mm.receiver_id ELSE mm.sender_id END AS other_id,
      mm.body,
      mm.created_at,
      ROW_NUMBER() OVER (
        PARTITION BY CASE WHEN mm.sender_id = auth.uid() THEN mm.receiver_id ELSE mm.sender_id END
        ORDER BY mm.created_at DESC
      ) AS rn,
      COUNT(*) OVER (
        PARTITION BY CASE WHEN mm.sender_id = auth.uid() THEN mm.receiver_id ELSE mm.sender_id END
      ) AS cnt,
      COUNT(*) FILTER (WHERE mm.receiver_id = auth.uid() AND mm.is_read = FALSE) OVER (
        PARTITION BY CASE WHEN mm.sender_id = auth.uid() THEN mm.receiver_id ELSE mm.sender_id END
      ) AS unread
    FROM marketplace_messages mm
    WHERE mm.listing_id = p_listing_id
      AND (mm.sender_id = auth.uid() OR mm.receiver_id = auth.uid())
  )
  SELECT
    r.other_id,
    p.name,
    p.email,
    r.body,
    r.created_at,
    r.cnt,
    r.unread
  FROM ranked r
  JOIN profiles p ON p.id = r.other_id
  WHERE r.rn = 1
  ORDER BY r.unread DESC, r.created_at DESC;
END;
$$;

-- ─── 10. Also expose reserved_price / reserved_buyer_id in get_marketplace_listings
--         so the buyer's BuyModal can show their negotiated price
CREATE OR REPLACE FUNCTION get_marketplace_listings(
  p_search        TEXT    DEFAULT NULL,
  p_min_balance   NUMERIC DEFAULT NULL,
  p_max_price     NUMERIC DEFAULT NULL
)
RETURNS TABLE (
  id                     UUID,
  voucher_id             UUID,
  seller_id              UUID,
  asking_price           NUMERIC,
  reserved_price         NUMERIC,
  reserved_buyer_id      UUID,
  description            TEXT,
  status                 TEXT,
  created_at             TIMESTAMPTZ,
  store_name             TEXT,
  balance                NUMERIC,
  expiry_date            DATE,
  seller_name            TEXT,
  seller_email           TEXT,
  avg_rating             NUMERIC,
  rating_count           BIGINT,
  seller_payment_methods JSONB
)
LANGUAGE plpgsql SECURITY DEFINER STABLE AS $$
BEGIN
  RETURN QUERY
  SELECT
    ml.id,
    ml.voucher_id,
    ml.seller_id,
    ml.asking_price,
    ml.reserved_price,
    ml.reserved_buyer_id,
    ml.description,
    ml.status,
    ml.created_at,
    v.store_name,
    v.balance,
    v.expiry_date,
    p.name  AS seller_name,
    p.email AS seller_email,
    COALESCE(AVG(ur.rating), 0)::NUMERIC AS avg_rating,
    COUNT(ur.id) AS rating_count,
    COALESCE(p.marketplace_payment_methods, '[]'::JSONB) AS seller_payment_methods
  FROM marketplace_listings ml
  JOIN vouchers v ON v.id = ml.voucher_id
  JOIN profiles p ON p.id = ml.seller_id
  LEFT JOIN user_ratings ur ON ur.rated_user_id = ml.seller_id
  WHERE ml.status = 'active'
    AND ml.seller_id != auth.uid()
    AND (p_search      IS NULL OR v.store_name ILIKE '%' || p_search || '%')
    AND (p_min_balance IS NULL OR v.balance >= p_min_balance)
    AND (p_max_price   IS NULL OR ml.asking_price <= p_max_price)
  GROUP BY ml.id, v.store_name, v.balance, v.expiry_date,
           p.name, p.email, p.marketplace_payment_methods
  ORDER BY ml.created_at DESC;
END;
$$;
