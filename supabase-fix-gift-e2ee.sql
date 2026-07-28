-- =============================================================================
-- FIX: gifting an E2EE (vault-encrypted) voucher hands the recipient ciphertext
-- =============================================================================
--
-- PROBLEM
--   Share links solved this long ago: supabase-e2ee-share.sql added
--   shared_voucher_tokens.code_override, the sender's client decrypts the code
--   with their vault key and stores the plaintext on the token row, and the
--   public page reads that instead of vouchers.code.
--
--   The gift flow never got the same treatment. createGift() stores no override,
--   so:
--     • get_gift_by_token() returns v.code — the "e2ee:<iv>:<ct>" ciphertext.
--     • claim_gift() copies v_original.code verbatim into the recipient's new
--       voucher, and does not set is_e2ee (which DEFAULTs to false). The
--       recipient therefore ends up owning a voucher whose code is ciphertext
--       encrypted with the SENDER's vault key, flagged as plaintext. They can
--       never decrypt it — the gift is permanently unusable, not just unreadable.
--
-- FIX
--   Mirror the share-link design: add code_override to voucher_gifts, prefer it
--   over vouchers.code when displaying, and copy it (not the ciphertext) on
--   claim. The claimed copy stays is_e2ee = false, which is now correct because
--   the code it holds really is plaintext.
--
--   The frontend change in the same commit adds the vault-unlocked guard and
--   passes the decrypted code, exactly as handleCreateShareLink already does.
--
-- Idempotent: safe to run more than once.
-- =============================================================================


-- ── 1. Column holding the decrypted code for E2EE gifts ───────────────────────
-- Mirrors shared_voucher_tokens.code_override. Only ever populated for E2EE
-- vouchers; the row is deleted when the gift is cancelled.
ALTER TABLE voucher_gifts ADD COLUMN IF NOT EXISTS code_override TEXT;


-- ── 2. get_gift_by_token: prefer the override ─────────────────────────────────
-- Column list is unchanged from the deployed definition
-- (supabase-fix-gift-access.sql), so the return type is identical and
-- CREATE OR REPLACE is safe here — no 42P13. Body reproduced verbatim apart
-- from the COALESCE on `code`; in particular it keeps the expiry_date::text cast
-- and does NOT reintroduce the send_at <= now() filter that made immediate gifts
-- inaccessible under client/server clock skew.
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
    g.id                                  AS gift_id,
    g.sender_name,
    g.message,
    g.send_at,
    g.claimed_at,
    v.store_name,
    v.balance,
    v.amount,
    COALESCE(g.code_override, v.code)     AS code,
    v.expiry_date::text                   AS expiry_date,
    v.notes,
    v.link,
    sv.balance_check_url
  FROM voucher_gifts g
  JOIN vouchers v ON v.id = g.voucher_id
  LEFT JOIN super_vouchers sv ON sv.id = v.super_voucher_id
  WHERE g.token = p_token;
END;
$$;

GRANT EXECUTE ON FUNCTION get_gift_by_token TO anon, authenticated;


-- ── 3. claim_gift: copy the plaintext, not the ciphertext ─────────────────────
--
-- !! READ BEFORE RUNNING !!
-- Two different claim_gift bodies exist in this repo: supabase-gift-logging.sql
-- (adds is_gift + the gift_received activity_log entry) and
-- supabase-premium-flag.sql (no activity_log). The version below is based on the
-- gift-logging one, which is a strict superset — it contains everything the
-- premium-flag version does plus the logging. If your database is running
-- something else, this would silently drop that behaviour, so dump it first and
-- compare:
--
--   SELECT pg_get_functiondef(oid) FROM pg_proc WHERE proname = 'claim_gift';
--
-- Only the two COALESCE(...) lines below differ from the gift-logging version.
CREATE OR REPLACE FUNCTION claim_gift(p_token TEXT)
RETURNS JSONB
SECURITY DEFINER LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_gift           voucher_gifts;
  v_original       vouchers;
  v_wallet_id      UUID;
  v_new_voucher_id UUID;
BEGIN
  SELECT * INTO v_gift FROM voucher_gifts WHERE token = p_token;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_found');
  END IF;
  IF v_gift.claimed_at IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'already_claimed');
  END IF;
  IF v_gift.sender_user_id = auth.uid() THEN
    RETURN jsonb_build_object('success', false, 'error', 'own_gift');
  END IF;

  SELECT * INTO v_original FROM vouchers WHERE id = v_gift.voucher_id;

  SELECT wallet_id INTO v_wallet_id
  FROM wallet_members
  WHERE user_id = auth.uid()
  ORDER BY created_at
  LIMIT 1;

  IF v_wallet_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'no_wallet');
  END IF;

  -- Copy voucher to recipient (mark as gift).
  -- code_override carries the plaintext for E2EE gifts; without it the recipient
  -- would receive ciphertext encrypted with the sender's key. is_e2ee is left at
  -- its DEFAULT false, which is correct precisely because we store plaintext.
  INSERT INTO vouchers (
    user_id, wallet_id, store_name, amount, balance, code, cvv,
    expiry_date, categories, tags, notes, link, is_archived, is_shared, is_gift
  ) VALUES (
    auth.uid(), v_wallet_id,
    v_original.store_name, v_original.amount, v_original.balance,
    COALESCE(v_gift.code_override, v_original.code), v_original.cvv,
    v_original.expiry_date,
    v_original.categories, v_original.tags,
    v_original.notes, v_original.link,
    false, false, true
  )
  RETURNING id INTO v_new_voucher_id;

  -- Archive original with gift note
  UPDATE vouchers SET
    is_archived = true,
    notes = CASE
      WHEN notes IS NOT NULL AND notes <> ''
        THEN notes || E'\n' || 'מתנה ל: ' || COALESCE(NULLIF(v_gift.recipient_email, ''), 'קישור')
      ELSE 'מתנה ל: ' || COALESCE(NULLIF(v_gift.recipient_email, ''), 'קישור')
    END
  WHERE id = v_gift.voucher_id;

  -- Mark as claimed
  UPDATE voucher_gifts
  SET claimed_at = NOW(), claimed_by_user_id = auth.uid()
  WHERE token = p_token;

  -- Log gift_received in recipient's activity_log
  INSERT INTO activity_log (user_id, wallet_id, action, voucher_id, voucher_name, details)
  VALUES (
    auth.uid(),
    v_wallet_id,
    'gift_received',
    v_new_voucher_id,
    v_original.store_name,
    jsonb_build_object(
      'sender', COALESCE(v_gift.sender_name, 'שולח לא ידוע'),
      'balance', v_original.balance,
      'message', v_gift.message
    )
  );

  RETURN jsonb_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION claim_gift TO authenticated;


-- ── 4. Reload PostgREST's schema cache ────────────────────────────────────────
SELECT pg_notify('pgrst', 'reload schema');


-- =============================================================================
-- VERIFICATION
-- =============================================================================
-- (a) Column exists:
--   SELECT column_name FROM information_schema.columns
--   WHERE table_name = 'voucher_gifts' AND column_name = 'code_override';
--
-- (b) get_gift_by_token still returns 13 columns:
--   SELECT pg_get_function_result(oid) FROM pg_proc WHERE proname = 'get_gift_by_token';
--
-- (c) End to end, in the app:
--   1. Lock, then unlock your vault. Gift an E2EE voucher via link.
--      (Gifting with the vault locked must now be refused with a clear message.)
--   2. Open the /gift/:token link — the code must be readable, not "e2ee:...".
--   3. Claim it from a different account — the claimed voucher in that account
--      must show the same readable code, and Activity must log "gift_received".
--   4. Gift a NON-E2EE voucher too, to confirm the normal path is untouched.
-- =============================================================================
