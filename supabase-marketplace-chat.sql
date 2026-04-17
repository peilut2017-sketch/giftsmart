-- ─────────────────────────────────────────────────────────────────────────────
-- Marketplace Chat Messages
-- ─────────────────────────────────────────────────────────────────────────────
-- Chat between buyers and sellers about a specific listing.
-- Works BEFORE any purchase (negotiation) and AFTER (coordination).
-- msg_type: 'text' | 'price_offer'
-- offer_status: 'pending' | 'accepted' | 'rejected'  (only for price_offer)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS marketplace_messages (
  id            UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  listing_id    UUID        NOT NULL REFERENCES marketplace_listings(id) ON DELETE CASCADE,
  sender_id     UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  receiver_id   UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  body          TEXT        NOT NULL,
  msg_type      TEXT        NOT NULL DEFAULT 'text'     CHECK (msg_type IN ('text','price_offer')),
  offer_amount  NUMERIC(10,2),
  offer_status  TEXT                                    CHECK (offer_status IN ('pending','accepted','rejected')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mkt_messages_listing  ON marketplace_messages (listing_id, created_at);
CREATE INDEX IF NOT EXISTS idx_mkt_messages_receiver ON marketplace_messages (receiver_id, created_at);

ALTER TABLE marketplace_messages ENABLE ROW LEVEL SECURITY;

-- Participants can see their own messages
CREATE POLICY "mm_select" ON marketplace_messages
  FOR SELECT USING (auth.uid() = sender_id OR auth.uid() = receiver_id);

-- Anyone can send (as long as sender_id = themselves)
CREATE POLICY "mm_insert" ON marketplace_messages
  FOR INSERT WITH CHECK (auth.uid() = sender_id);

-- Only receiver can update offer_status (accept / reject)
CREATE POLICY "mm_update" ON marketplace_messages
  FOR UPDATE USING (auth.uid() = receiver_id AND msg_type = 'price_offer')
  WITH CHECK  (auth.uid() = receiver_id);

-- ─── RPC: send a message ──────────────────────────────────────────────────────
-- Validates that:
--   • The listing exists and is active (or pending_payment)
--   • The sender is either the listing seller or a valid buyer
--   • price_offer may only be sent by the seller
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
  SELECT * INTO v_listing
  FROM marketplace_listings
  WHERE id = p_listing_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'listing_not_found';
  END IF;

  IF v_listing.status NOT IN ('active','pending_payment') THEN
    RAISE EXCEPTION 'listing_not_available';
  END IF;

  -- Must involve the seller
  IF auth.uid() <> v_listing.seller_id AND p_receiver_id <> v_listing.seller_id THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  -- Cannot message yourself (cannot buy own listing)
  IF auth.uid() = p_receiver_id THEN
    RAISE EXCEPTION 'cannot_message_yourself';
  END IF;

  -- Only seller can send price offers
  IF p_msg_type = 'price_offer' AND auth.uid() <> v_listing.seller_id THEN
    RAISE EXCEPTION 'only_seller_can_offer_price';
  END IF;

  IF p_msg_type = 'price_offer' AND (p_offer_amount IS NULL OR p_offer_amount <= 0) THEN
    RAISE EXCEPTION 'invalid_offer_amount';
  END IF;

  INSERT INTO marketplace_messages
    (listing_id, sender_id, receiver_id, body, msg_type, offer_amount, offer_status)
  VALUES (
    p_listing_id,
    auth.uid(),
    p_receiver_id,
    p_body,
    p_msg_type,
    CASE WHEN p_msg_type = 'price_offer' THEN p_offer_amount ELSE NULL END,
    CASE WHEN p_msg_type = 'price_offer' THEN 'pending'       ELSE NULL END
  )
  RETURNING * INTO v_msg;

  RETURN v_msg;
END;
$$;

-- ─── RPC: get chat between current user and another user for a listing ────────
CREATE OR REPLACE FUNCTION get_listing_chat(
  p_listing_id    UUID,
  p_other_user_id UUID
)
RETURNS TABLE (
  id            UUID,
  listing_id    UUID,
  sender_id     UUID,
  receiver_id   UUID,
  body          TEXT,
  msg_type      TEXT,
  offer_amount  NUMERIC,
  offer_status  TEXT,
  created_at    TIMESTAMPTZ,
  sender_name   TEXT,
  sender_email  TEXT,
  is_mine       BOOLEAN
)
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RETURN QUERY
  SELECT
    mm.id,
    mm.listing_id,
    mm.sender_id,
    mm.receiver_id,
    mm.body,
    mm.msg_type,
    mm.offer_amount,
    mm.offer_status,
    mm.created_at,
    p.name   AS sender_name,
    p.email  AS sender_email,
    (mm.sender_id = auth.uid()) AS is_mine
  FROM marketplace_messages mm
  JOIN profiles p ON p.id = mm.sender_id
  WHERE mm.listing_id = p_listing_id
    AND (
      (mm.sender_id = auth.uid() AND mm.receiver_id = p_other_user_id)
      OR
      (mm.sender_id = p_other_user_id AND mm.receiver_id = auth.uid())
    )
  ORDER BY mm.created_at ASC;
END;
$$;

-- ─── RPC: respond to a price offer (buyer accepts / rejects) ─────────────────
CREATE OR REPLACE FUNCTION respond_to_price_offer(
  p_message_id UUID,
  p_response   TEXT   -- 'accepted' | 'rejected'
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_msg marketplace_messages;
BEGIN
  SELECT * INTO v_msg FROM marketplace_messages WHERE id = p_message_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'message_not_found'; END IF;
  IF v_msg.receiver_id <> auth.uid() THEN RAISE EXCEPTION 'not_authorized'; END IF;
  IF v_msg.msg_type <> 'price_offer' THEN RAISE EXCEPTION 'not_a_price_offer'; END IF;
  IF v_msg.offer_status <> 'pending' THEN RAISE EXCEPTION 'already_responded'; END IF;
  IF p_response NOT IN ('accepted','rejected') THEN RAISE EXCEPTION 'invalid_response'; END IF;

  UPDATE marketplace_messages
  SET offer_status = p_response
  WHERE id = p_message_id;

  -- If accepted → update listing asking_price
  IF p_response = 'accepted' THEN
    UPDATE marketplace_listings
    SET asking_price = v_msg.offer_amount, updated_at = NOW()
    WHERE id = v_msg.listing_id;
  END IF;
END;
$$;

-- ─── RPC: list all conversations for a listing (seller only) ─────────────────
-- Returns one row per buyer who has chatted with the seller about this listing.
CREATE OR REPLACE FUNCTION get_listing_conversations(p_listing_id UUID)
RETURNS TABLE (
  other_user_id    UUID,
  other_user_name  TEXT,
  other_user_email TEXT,
  last_body        TEXT,
  last_at          TIMESTAMPTZ,
  message_count    BIGINT
)
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  -- Only the seller of this listing may call this
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
      ) AS cnt
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
    r.cnt
  FROM ranked r
  JOIN profiles p ON p.id = r.other_id
  WHERE r.rn = 1
  ORDER BY r.created_at DESC;
END;
$$;
