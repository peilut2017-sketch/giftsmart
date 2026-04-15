-- ─────────────────────────────────────────────────────────────────────────────
-- Marketplace Chat — Read Receipts + Realtime
-- Run this AFTER supabase-marketplace-chat.sql
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Add is_read / read_at columns
ALTER TABLE marketplace_messages
  ADD COLUMN IF NOT EXISTS is_read  BOOLEAN     NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS read_at  TIMESTAMPTZ;

-- Index to quickly count/fetch unread messages per recipient
CREATE INDEX IF NOT EXISTS idx_mkt_messages_unread
  ON marketplace_messages (receiver_id, is_read, created_at)
  WHERE is_read = FALSE;

-- 2. Enable Realtime for the table so the JS client receives live events
--    (run once; harmless if already added)
ALTER PUBLICATION supabase_realtime ADD TABLE marketplace_messages;

-- 3. RPC: mark all messages from a specific sender as read
--    Called by the receiver when they open the chat window.
CREATE OR REPLACE FUNCTION mark_chat_messages_read(
  p_listing_id UUID,
  p_sender_id  UUID
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE marketplace_messages
  SET    is_read = TRUE,
         read_at = NOW()
  WHERE  listing_id  = p_listing_id
    AND  sender_id   = p_sender_id
    AND  receiver_id = auth.uid()
    AND  is_read     = FALSE;
END;
$$;

-- 4. RPC: get total unread count for the current user (used to seed the badge on app load)
CREATE OR REPLACE FUNCTION get_unread_chat_count()
RETURNS BIGINT
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_count BIGINT;
BEGIN
  SELECT COUNT(*)
  INTO   v_count
  FROM   marketplace_messages
  WHERE  receiver_id = auth.uid()
    AND  is_read     = FALSE;
  RETURN v_count;
END;
$$;

-- 5. Redefine get_listing_chat to include is_read
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
  is_mine       BOOLEAN,
  is_read       BOOLEAN
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
    (mm.sender_id = auth.uid()) AS is_mine,
    mm.is_read
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
