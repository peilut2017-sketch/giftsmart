-- Add view_count column to discount_deals table
-- Tracks how many times each deal has been viewed

ALTER TABLE discount_deals ADD COLUMN IF NOT EXISTS view_count integer DEFAULT 0 NOT NULL;

-- RPC to atomically increment the view count for a deal
CREATE OR REPLACE FUNCTION increment_deal_view_count(p_deal_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE discount_deals
  SET view_count = view_count + 1
  WHERE id = p_deal_id;
END;
$$;

-- Make sure get_my_deals returns the view_count column
-- (update this RPC to include view_count in its SELECT if needed)
