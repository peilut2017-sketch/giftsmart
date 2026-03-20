-- =============================================
-- Security Hardening Migration
--
-- WHAT THIS DOES:
--   1. Enforces RLS on decrypted_vouchers view (security_invoker = true)
--   2. Removes the public "scraping" read policy on shared_voucher_tokens
--   3. Drops the voucher_snapshot column (replaced by live RPC)
--   4. Creates get_shared_voucher_live() RPC for secure public voucher sharing
--
-- HOW TO RUN:
--   Go to Supabase Dashboard → SQL Editor → paste and run entire file
--
-- DATA IMPACT:
--   - vouchers table: UNTOUCHED — all voucher data is safe
--   - shared_voucher_tokens.voucher_snapshot: column is dropped (snapshot data lost,
--     but existing share links continue to work via live RPC)
--   - All RLS policies on vouchers: UNTOUCHED — wallet-based access preserved
-- =============================================


-- =============================================
-- STEP 1: Enforce RLS on the decrypted_vouchers view
-- =============================================
-- Without security_invoker=true the view runs as its owner (postgres = superuser)
-- which bypasses RLS entirely. This makes the existing wallet-based RLS policies
-- actually take effect when users query through the view.
--
-- NOTE: decrypted_vouchers is auto-managed by pgsodium. If pgsodium ever
-- regenerates the view (e.g. after a SECURITY LABEL change), re-run this line.
ALTER VIEW decrypted_vouchers SET (security_invoker = true);


-- =============================================
-- STEP 2: Remove the public read policy on shared_voucher_tokens
-- =============================================
-- The old policy allowed any anonymous user to SELECT * and scrape all tokens.
-- The new get_shared_voucher_live() RPC replaces the need for direct public reads.
DROP POLICY IF EXISTS "Anyone can read shared tokens" ON shared_voucher_tokens;


-- =============================================
-- STEP 3: Drop the voucher_snapshot column
-- =============================================
-- Snapshots are no longer needed — the RPC returns live data from decrypted_vouchers.
-- Existing share links are unaffected: the RPC looks up voucher_id from the token row.
ALTER TABLE shared_voucher_tokens DROP COLUMN IF EXISTS voucher_snapshot;


-- =============================================
-- STEP 4: Create the secure live-sharing RPC
-- =============================================
-- SECURITY DEFINER: runs as the function owner (bypasses RLS) so an anonymous
-- visitor can read exactly ONE voucher — only if they hold the exact token.
-- SET search_path: prevents search_path injection attacks in SECURITY DEFINER fns.
--
-- Return values:
--   • Normal row   → voucher found, token valid
--   • is_expired=true row → token exists but has expired (preserves UX error message)
--   • No rows      → token not found
CREATE OR REPLACE FUNCTION get_shared_voucher_live(p_token TEXT)
RETURNS TABLE (
  store_name   TEXT,
  balance      NUMERIC,
  amount       NUMERIC,
  code         TEXT,
  expiry_date  DATE,
  notes        TEXT,
  is_expired   BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_voucher_id UUID;
  v_expires_at TIMESTAMPTZ;
BEGIN
  -- Look up the token record
  SELECT svt.voucher_id, svt.expires_at
  INTO   v_voucher_id, v_expires_at
  FROM   shared_voucher_tokens svt
  WHERE  svt.token = p_token;

  -- Token not found → return empty (frontend shows "לינק לא תקין")
  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- Token expired → return a sentinel row (frontend shows "פג תוקף הלינק")
  IF v_expires_at IS NOT NULL AND v_expires_at < NOW() THEN
    RETURN QUERY
      SELECT
        NULL::TEXT,    -- store_name
        NULL::NUMERIC, -- balance
        NULL::NUMERIC, -- amount
        NULL::TEXT,    -- code
        NULL::DATE,    -- expiry_date
        NULL::TEXT,    -- notes
        TRUE;          -- is_expired
    RETURN;
  END IF;

  -- Token valid → return live voucher data from the decrypted view
  RETURN QUERY
    SELECT
      dv.store_name,
      dv.balance::NUMERIC,
      dv.amount::NUMERIC,
      dv.code,
      dv.expiry_date,
      dv.notes,
      FALSE AS is_expired
    FROM decrypted_vouchers dv
    WHERE dv.id = v_voucher_id;
END;
$$;

-- Allow unauthenticated (anon) and authenticated users to call the function
GRANT EXECUTE ON FUNCTION get_shared_voucher_live(TEXT) TO anon, authenticated;


-- =============================================
-- STEP 5: Reload PostgREST schema cache
-- =============================================
SELECT pg_notify('pgrst', 'reload schema');
