-- Update get_gift_by_token to return link and balance_check_url
-- so recipients can access the store website and balance-check page

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
    g.id                  AS gift_id,
    g.sender_name,
    g.message,
    g.send_at,
    g.claimed_at,
    v.store_name,
    v.balance,
    v.amount,
    v.code,
    v.expiry_date,
    v.notes,
    v.link,
    sv.balance_check_url
  FROM voucher_gifts g
  JOIN vouchers v ON v.id = g.voucher_id
  LEFT JOIN super_vouchers sv ON sv.id = v.super_voucher_id
  WHERE g.token = p_token
    AND g.send_at <= now();
END;
$$;

GRANT EXECUTE ON FUNCTION get_gift_by_token TO anon, authenticated;
