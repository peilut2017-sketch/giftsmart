-- get_listing_by_id — fetch a single marketplace listing regardless of status.
--
-- get_marketplace_listings returns only status='active' rows from OTHER
-- sellers, so a buyer opening their own in-progress purchase (or a seller
-- opening their own listing page) got "מודעה לא נמצאה". This RPC returns one
-- listing by id to any party involved in it — the seller, the reserved buyer,
-- or (for active listings) anyone.
--
-- Run in the Supabase SQL Editor.

CREATE OR REPLACE FUNCTION get_listing_by_id(p_id UUID)
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
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

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
  WHERE ml.id = p_id
    AND (
      ml.status = 'active'
      OR ml.seller_id = auth.uid()
      OR ml.reserved_buyer_id = auth.uid()
      OR EXISTS (
        SELECT 1 FROM marketplace_purchases mp
         WHERE mp.listing_id = ml.id AND mp.buyer_id = auth.uid()
      )
    )
  GROUP BY ml.id, v.store_name, v.balance, v.expiry_date,
           p.name, p.email, p.marketplace_payment_methods;
END;
$$;

REVOKE ALL ON FUNCTION get_listing_by_id(UUID) FROM anon, public;
GRANT EXECUTE ON FUNCTION get_listing_by_id(UUID) TO authenticated;
