-- Add archive_reason column to vouchers table
-- This allows users to optionally record why a voucher was archived

ALTER TABLE vouchers ADD COLUMN IF NOT EXISTS archive_reason text DEFAULT NULL;

-- Update get_shared_voucher_live to also return link and balance_check_url from the super voucher
CREATE OR REPLACE FUNCTION get_shared_voucher_live(p_token text)
RETURNS TABLE (
  store_name        text,
  balance           numeric,
  amount            numeric,
  code              text,
  expiry_date       date,
  notes             text,
  is_expired        boolean,
  link              text,
  balance_check_url text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_token_row record;
  v_voucher   record;
BEGIN
  SELECT * INTO v_token_row
  FROM shared_voucher_tokens
  WHERE token = p_token;

  IF NOT FOUND THEN RETURN; END IF;

  IF v_token_row.expires_at IS NOT NULL AND v_token_row.expires_at < now() THEN
    RETURN QUERY SELECT
      NULL::text, NULL::numeric, NULL::numeric, NULL::text,
      NULL::date, NULL::text, true, NULL::text, NULL::text;
    RETURN;
  END IF;

  SELECT
    v.store_name,
    v.balance,
    v.amount,
    v.code,
    v.expiry_date::date,
    v.notes,
    false,
    v.link,
    sv.balance_check_url
  INTO v_voucher
  FROM vouchers v
  LEFT JOIN super_vouchers sv ON sv.id = v.super_voucher_id
  WHERE v.id = v_token_row.voucher_id;

  IF NOT FOUND THEN RETURN; END IF;

  RETURN QUERY SELECT
    v_voucher.store_name,
    v_voucher.balance,
    v_voucher.amount,
    v_voucher.code,
    v_voucher.expiry_date,
    v_voucher.notes,
    false,
    v_voucher.link,
    v_voucher.balance_check_url;
END;
$$;
