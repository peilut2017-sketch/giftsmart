-- =============================================================================
-- SECURITY FIX (Critical): voucher-code theft via unvalidated voucher_id
-- =============================================================================
--
-- VULNERABILITY
--   shared_voucher_tokens' policy was:
--       CREATE POLICY "Owner can manage shared tokens"
--         ON shared_voucher_tokens FOR ALL USING (created_by = auth.uid());
--   and voucher_gifts' insert policy was:
--       FOR INSERT WITH CHECK (sender_user_id = auth.uid())
--
--   Both validate WHO is inserting but never that the inserter may access the
--   referenced voucher_id. The frontend inserts these rows directly (not via RPC),
--   so the write path is exposed through PostgREST. Meanwhile
--   get_shared_voucher_live() / get_gift_by_token() are SECURITY DEFINER — they
--   bypass RLS by design and return the voucher's `code`.
--
--   Exploit chain (no special access required):
--     1. Attacker registers a normal account.
--     2. SELECT voucher_id FROM marketplace_listings  — permitted by the existing
--        "Anyone can read active listings ... USING (TRUE)" policy, which hands
--        over other users' voucher UUIDs.
--     3. INSERT a share token with an attacker-chosen token and the victim's
--        voucher_id (created_by = self, so the old policy accepted it).
--     4. get_shared_voucher_live('<that token>') returns store_name, balance,
--        amount, code, expiry_date, notes.
--   Result: any registered user could steal the code of any voucher listed on
--   the marketplace.
--
-- THE FIX
--   Require that the caller can already legitimately read the voucher. That is
--   exactly the set of users who can see its code in the app today, so this
--   closes the hole without removing any existing capability.
--
-- COMPATIBILITY — deliberately preserved (verified against the codebase):
--   • Wallet members (not just the creator) may share. vouchers' own RLS is
--     wallet-based ("Wallet members can view vouchers" USING wallet_id IN
--     get_my_wallet_ids()), so a user_id = auth.uid() check here would have
--     broken sharing for family members of a shared wallet.
--   • Users a voucher was explicitly shared with may re-share it. CheckoutPage
--     renders a share-link UI for shared-with-me vouchers, backed by
--     voucher_shares, which is cross-user and NOT wallet-scoped. They already
--     hold the code, so allowing this grants nothing new.
--   • deleteShareToken / getShareTokens keep working — SELECT/UPDATE/DELETE stay
--     scoped to created_by, matching the previous FOR ALL policy.
--   • increment_share_view_count() and claim_gift() are SECURITY DEFINER and
--     bypass RLS entirely, so anonymous view counting and gift claiming are
--     unaffected.
--
-- Idempotent: safe to run more than once.
-- =============================================================================


-- ── 1. One helper encoding "may this user read this voucher?" ─────────────────
-- SECURITY DEFINER + STABLE, matching the existing get_my_wallet_ids() pattern,
-- so evaluating it inside a policy cannot re-enter RLS and recurse.
CREATE OR REPLACE FUNCTION can_access_voucher(p_voucher_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    -- (a) the voucher lives in a wallet the caller belongs to
    SELECT 1
    FROM vouchers v
    JOIN wallet_members wm ON wm.wallet_id = v.wallet_id
    WHERE v.id = p_voucher_id
      AND wm.user_id = auth.uid()
  ) OR EXISTS (
    -- (b) the voucher was explicitly shared with the caller
    SELECT 1
    FROM voucher_shares vs
    WHERE vs.voucher_id = p_voucher_id
      AND vs.shared_with_user_id = auth.uid()
  );
$$;

GRANT EXECUTE ON FUNCTION can_access_voucher(UUID) TO authenticated;


-- ── 2. shared_voucher_tokens ──────────────────────────────────────────────────
-- Replace the single FOR ALL policy with explicit per-command policies so the
-- INSERT path can carry the extra ownership requirement while SELECT/UPDATE/
-- DELETE keep their previous, working behaviour.
DROP POLICY IF EXISTS "Owner can manage shared tokens" ON shared_voucher_tokens;
DROP POLICY IF EXISTS "Anyone can read shared tokens"  ON shared_voucher_tokens;  -- public scraping policy, if still present
DROP POLICY IF EXISTS "shared_tokens_select" ON shared_voucher_tokens;
DROP POLICY IF EXISTS "shared_tokens_insert" ON shared_voucher_tokens;
DROP POLICY IF EXISTS "shared_tokens_update" ON shared_voucher_tokens;
DROP POLICY IF EXISTS "shared_tokens_delete" ON shared_voucher_tokens;

CREATE POLICY "shared_tokens_select" ON shared_voucher_tokens
  FOR SELECT TO authenticated
  USING (created_by = auth.uid());

CREATE POLICY "shared_tokens_insert" ON shared_voucher_tokens
  FOR INSERT TO authenticated
  WITH CHECK (
    created_by = auth.uid()
    AND can_access_voucher(voucher_id)
  );

CREATE POLICY "shared_tokens_update" ON shared_voucher_tokens
  FOR UPDATE TO authenticated
  USING (created_by = auth.uid())
  WITH CHECK (created_by = auth.uid());

CREATE POLICY "shared_tokens_delete" ON shared_voucher_tokens
  FOR DELETE TO authenticated
  USING (created_by = auth.uid());


-- ── 3. voucher_gifts ──────────────────────────────────────────────────────────
-- Only the INSERT policy changes; select/delete keep their existing definitions.
DROP POLICY IF EXISTS "gift_sender_insert" ON voucher_gifts;

CREATE POLICY "gift_sender_insert" ON voucher_gifts
  FOR INSERT TO authenticated
  WITH CHECK (
    sender_user_id = auth.uid()
    AND can_access_voucher(voucher_id)
  );


-- ── 4. Fold code_override into get_shared_voucher_live() ──────────────────────
-- Removing the public read policy above (or having already removed it via
-- supabase-security-hardening.sql) means the anonymous /s/:token page can no
-- longer SELECT shared_voucher_tokens directly — which is how it used to fetch
-- `code_override`, the plaintext code stored on the token row when an E2EE
-- voucher is shared. Without this step, E2EE share links would silently show the
-- encrypted ciphertext instead of the real code.
--
-- Resolving the override inside this SECURITY DEFINER function keeps the public
-- page working with no direct table access at all. The signature and return type
-- are unchanged, so CREATE OR REPLACE is sufficient and no client change is
-- required beyond dropping the now-redundant second query.
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
  v_voucher_id    UUID;
  v_expires_at    TIMESTAMPTZ;
  v_code_override TEXT;
BEGIN
  SELECT svt.voucher_id, svt.expires_at, svt.code_override
  INTO   v_voucher_id, v_expires_at, v_code_override
  FROM   shared_voucher_tokens svt
  WHERE  svt.token = p_token;

  -- Token not found → return empty (frontend shows "לינק לא תקין")
  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- Token expired → sentinel row (frontend shows "פג תוקף הלינק")
  IF v_expires_at IS NOT NULL AND v_expires_at < NOW() THEN
    RETURN QUERY SELECT
      NULL::TEXT, NULL::NUMERIC, NULL::NUMERIC,
      NULL::TEXT, NULL::DATE, NULL::TEXT, TRUE;
    RETURN;
  END IF;

  -- Token valid → live voucher data, with the E2EE plaintext override applied
  -- when present. NOTE: if pgsodium encryption is enabled, change "vouchers"
  -- → "decrypted_vouchers" here, as in the original definition.
  RETURN QUERY
    SELECT
      v.store_name,
      v.balance::NUMERIC,
      v.amount::NUMERIC,
      COALESCE(v_code_override, v.code) AS code,
      v.expiry_date,
      v.notes,
      FALSE AS is_expired
    FROM vouchers v
    WHERE v.id = v_voucher_id;
END;
$$;

GRANT EXECUTE ON FUNCTION get_shared_voucher_live(TEXT) TO anon, authenticated;


-- ── 5. Reload PostgREST's schema cache ────────────────────────────────────────
SELECT pg_notify('pgrst', 'reload schema');


-- =============================================================================
-- VERIFICATION
-- =============================================================================
-- (a) Policies are in place — expect 4 rows for shared_voucher_tokens and 3 for
--     voucher_gifts, and NO policy named "Anyone can read shared tokens":
--
--   SELECT tablename, policyname, cmd
--   FROM pg_policies
--   WHERE tablename IN ('shared_voucher_tokens', 'voucher_gifts')
--   ORDER BY tablename, cmd;
--
-- (b) The hole is closed. As a normal (non-admin) user, this INSERT must now
--     fail with "new row violates row-level security policy" when the voucher
--     belongs to somebody else:
--
--   INSERT INTO shared_voucher_tokens (token, voucher_id, created_by)
--   VALUES ('pentest-' || gen_random_uuid(), '<someone-elses-voucher-uuid>', auth.uid());
--
-- (c) Legitimate sharing still works — as the voucher's owner, the same INSERT
--     with your OWN voucher_id must succeed. Test in the app: share a voucher
--     you own, share one from a shared family wallet, and re-share one that was
--     shared with you. All three must still produce a working link.
--
-- =============================================================================
-- ROLLBACK (restores the previous, VULNERABLE behaviour — emergency use only)
-- =============================================================================
--   DROP POLICY IF EXISTS "shared_tokens_select" ON shared_voucher_tokens;
--   DROP POLICY IF EXISTS "shared_tokens_insert" ON shared_voucher_tokens;
--   DROP POLICY IF EXISTS "shared_tokens_update" ON shared_voucher_tokens;
--   DROP POLICY IF EXISTS "shared_tokens_delete" ON shared_voucher_tokens;
--   CREATE POLICY "Owner can manage shared tokens" ON shared_voucher_tokens
--     FOR ALL USING (created_by = auth.uid());
--   DROP POLICY IF EXISTS "gift_sender_insert" ON voucher_gifts;
--   CREATE POLICY "gift_sender_insert" ON voucher_gifts
--     FOR INSERT WITH CHECK (sender_user_id = auth.uid());
--   SELECT pg_notify('pgrst', 'reload schema');
