-- Deal Likes: allows users to mark discounts as "liked" (אהובים)
-- Liked deals appear at the top of the user's "My Deals" tab

CREATE TABLE IF NOT EXISTS deal_likes (
  user_id   uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  deal_id   uuid NOT NULL REFERENCES discount_deals(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  PRIMARY KEY (user_id, deal_id)
);

ALTER TABLE deal_likes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own likes" ON deal_likes;
CREATE POLICY "Users manage own likes" ON deal_likes
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Toggle like: returns true if now liked, false if unliked
CREATE OR REPLACE FUNCTION toggle_deal_like(p_deal_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_exists boolean;
BEGIN
  SELECT EXISTS(
    SELECT 1 FROM deal_likes WHERE user_id = auth.uid() AND deal_id = p_deal_id
  ) INTO v_exists;

  IF v_exists THEN
    DELETE FROM deal_likes WHERE user_id = auth.uid() AND deal_id = p_deal_id;
    RETURN false;
  ELSE
    INSERT INTO deal_likes (user_id, deal_id) VALUES (auth.uid(), p_deal_id);
    RETURN true;
  END IF;
END;
$$;

-- Return all liked deal ids for the current user
CREATE OR REPLACE FUNCTION get_my_liked_deals()
RETURNS TABLE(deal_id uuid) LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY SELECT dl.deal_id FROM deal_likes dl WHERE dl.user_id = auth.uid();
END;
$$;

SELECT pg_notify('pgrst', 'reload schema');
