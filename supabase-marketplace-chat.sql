-- ─────────────────────────────────────────────────────────────────────────────
-- Marketplace Chat — messages between buyers and sellers
-- Run this AFTER supabase-marketplace.sql
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── Table ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS marketplace_messages (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id UUID        NOT NULL REFERENCES marketplace_listings(id) ON DELETE CASCADE,
  buyer_id   UUID        NOT NULL REFERENCES auth.users(id),
  sender_id  UUID        NOT NULL REFERENCES auth.users(id),
  message    TEXT        NOT NULL
               CHECK (char_length(trim(message)) > 0 AND char_length(message) <= 1000),
  is_system  BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_marketplace_messages_conv
  ON marketplace_messages (listing_id, buyer_id, created_at);

-- Full identity needed for realtime filtering
ALTER TABLE marketplace_messages REPLICA IDENTITY FULL;

-- Enable realtime
ALTER PUBLICATION supabase_realtime ADD TABLE marketplace_messages;

-- ─── Row Level Security ──────────────────────────────────────────────────────
ALTER TABLE marketplace_messages ENABLE ROW LEVEL SECURITY;

-- Buyer reads their own conversation messages
CREATE POLICY "msg_buyer_read" ON marketplace_messages
  FOR SELECT USING (buyer_id = auth.uid());

-- Seller reads all messages for their listings
CREATE POLICY "msg_seller_read" ON marketplace_messages
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM marketplace_listings l
      WHERE l.id = listing_id AND l.seller_id = auth.uid()
    )
  );

-- Inserts are done via SECURITY DEFINER RPCs below

-- ─── get_chat_messages ───────────────────────────────────────────────────────
-- Returns all messages for a listing/buyer conversation.
-- Caller must be the buyer (p_buyer_id = auth.uid()) or the listing seller.
CREATE OR REPLACE FUNCTION get_chat_messages(p_listing_id UUID, p_buyer_id UUID)
RETURNS TABLE (
  id           UUID,
  listing_id   UUID,
  buyer_id     UUID,
  sender_id    UUID,
  message      TEXT,
  is_system    BOOLEAN,
  created_at   TIMESTAMPTZ,
  sender_name  TEXT,
  is_me        BOOLEAN
) LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  -- Authorization: caller must be the buyer or the listing seller
  IF p_buyer_id != auth.uid() THEN
    IF NOT EXISTS (
      SELECT 1 FROM marketplace_listings
      WHERE id = p_listing_id AND seller_id = auth.uid()
    ) THEN
      RAISE EXCEPTION 'unauthorized';
    END IF;
  END IF;

  RETURN QUERY
  SELECT
    m.id,
    m.listing_id,
    m.buyer_id,
    m.sender_id,
    m.message,
    m.is_system,
    m.created_at,
    COALESCE(pr.name, pr.email)::TEXT AS sender_name,
    (m.sender_id = auth.uid()) AS is_me
  FROM marketplace_messages m
  LEFT JOIN profiles pr ON pr.id = m.sender_id
  WHERE m.listing_id = p_listing_id
    AND m.buyer_id = p_buyer_id
  ORDER BY m.created_at ASC;
END;
$$;

-- ─── send_chat_message ───────────────────────────────────────────────────────
-- Buyer sends: p_buyer_id = NULL (uses auth.uid())
-- Seller replies: p_buyer_id = the buyer they're replying to
CREATE OR REPLACE FUNCTION send_chat_message(
  p_listing_id UUID,
  p_message    TEXT,
  p_buyer_id   UUID DEFAULT NULL
) RETURNS marketplace_messages LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_listing  marketplace_listings%ROWTYPE;
  v_buyer_id UUID;
  v_msg      marketplace_messages%ROWTYPE;
BEGIN
  SELECT * INTO v_listing FROM marketplace_listings WHERE id = p_listing_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'listing_not_found'; END IF;

  IF v_listing.seller_id = auth.uid() THEN
    -- Seller is sending: require explicit buyer_id
    IF p_buyer_id IS NULL THEN RAISE EXCEPTION 'buyer_id_required'; END IF;
    IF p_buyer_id = auth.uid() THEN RAISE EXCEPTION 'cannot_message_yourself'; END IF;
    v_buyer_id := p_buyer_id;
  ELSE
    -- Buyer is sending
    IF v_listing.seller_id = auth.uid() THEN RAISE EXCEPTION 'cannot_buy_own_listing'; END IF;
    v_buyer_id := auth.uid();
  END IF;

  INSERT INTO marketplace_messages (listing_id, buyer_id, sender_id, message)
  VALUES (p_listing_id, v_buyer_id, auth.uid(), trim(p_message))
  RETURNING * INTO v_msg;

  RETURN v_msg;
END;
$$;

-- ─── update_listing_price ────────────────────────────────────────────────────
-- Seller reduces asking price. Sends a system message to all existing conversations.
CREATE OR REPLACE FUNCTION update_listing_price(p_listing_id UUID, p_new_price NUMERIC)
RETURNS marketplace_listings LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_listing marketplace_listings%ROWTYPE;
BEGIN
  SELECT * INTO v_listing FROM marketplace_listings WHERE id = p_listing_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'listing_not_found'; END IF;
  IF v_listing.seller_id != auth.uid() THEN RAISE EXCEPTION 'unauthorized'; END IF;
  IF v_listing.status != 'active' THEN RAISE EXCEPTION 'listing_not_active'; END IF;
  IF p_new_price <= 0 THEN RAISE EXCEPTION 'price_must_be_positive'; END IF;
  IF p_new_price >= v_listing.asking_price THEN RAISE EXCEPTION 'new_price_must_be_lower'; END IF;

  UPDATE marketplace_listings
  SET asking_price = p_new_price, updated_at = NOW()
  WHERE id = p_listing_id
  RETURNING * INTO v_listing;

  -- Notify each buyer who has chatted about this listing via system message
  INSERT INTO marketplace_messages (listing_id, buyer_id, sender_id, message, is_system)
  SELECT DISTINCT
    p_listing_id,
    m.buyer_id,
    auth.uid(),
    '💰 המוכר הוריד את המחיר ל-₪' || p_new_price::TEXT,
    TRUE
  FROM marketplace_messages m
  WHERE m.listing_id = p_listing_id;

  RETURN v_listing;
END;
$$;

-- ─── get_listing_conversations ───────────────────────────────────────────────
-- For sellers: list of buyers who have sent messages about a listing.
CREATE OR REPLACE FUNCTION get_listing_conversations(p_listing_id UUID)
RETURNS TABLE (
  buyer_id        UUID,
  buyer_name      TEXT,
  last_message    TEXT,
  last_message_at TIMESTAMPTZ,
  msg_count       BIGINT
) LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM marketplace_listings
    WHERE id = p_listing_id AND seller_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  RETURN QUERY
  WITH last_per_buyer AS (
    SELECT DISTINCT ON (m.buyer_id)
      m.buyer_id,
      m.message AS last_message,
      m.created_at AS last_message_at
    FROM marketplace_messages m
    WHERE m.listing_id = p_listing_id
    ORDER BY m.buyer_id, m.created_at DESC
  ),
  counts AS (
    SELECT m.buyer_id, COUNT(*) AS msg_count
    FROM marketplace_messages m
    WHERE m.listing_id = p_listing_id
    GROUP BY m.buyer_id
  )
  SELECT
    lpb.buyer_id,
    COALESCE(pr.name, pr.email)::TEXT AS buyer_name,
    lpb.last_message,
    lpb.last_message_at,
    c.msg_count
  FROM last_per_buyer lpb
  JOIN profiles pr ON pr.id = lpb.buyer_id
  JOIN counts    c  ON c.buyer_id = lpb.buyer_id
  ORDER BY lpb.last_message_at DESC;
END;
$$;
