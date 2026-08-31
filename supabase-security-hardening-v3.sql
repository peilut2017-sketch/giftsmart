-- ============================================================================
-- Security hardening v3
-- ============================================================================
-- Apply this in the Supabase SQL Editor (there is no migration runner). It is
-- idempotent — safe to run more than once. It closes a set of access-control
-- holes found in a security review:
--
--   1. voucher_shares was client-writable with only shared_by = auth.uid()
--      checked — any user could INSERT a share row pointing at ANY voucher and
--      then read its code + CVV through get_vouchers_shared_with_me. This also
--      neutralised can_access_voucher() everywhere it is used.
--   2. shared_tokens_update lacked a can_access_voucher() WITH CHECK, re-opening
--      the exact IDOR that supabase-fix-share-token-idor.sql closed for INSERT.
--   3. marketplace_listings / marketplace_purchases were directly UPDATE-able by
--      the seller/buyer with no WITH CHECK, letting a seller repoint a listing
--      at a victim's voucher (code theft + destruction) and a buyer self-complete
--      a purchase. All real writes already go through SECURITY DEFINER RPCs.
--   4. A family of admin_* SECURITY DEFINER functions had NO is_admin check and
--      the default PUBLIC execute grant — callable by anon. Banners, balance
--      operators, support replies and several data-leaking reads.
--   5. The 'banners' storage policies were named "Admin …" but only checked
--      bucket_id, so anyone (anon included) could upload/delete banner images.
--   6. The hardened 3-arg balance functions were added as NEW overloads; the
--      un-hardened 2-arg originals were still installed and were what the app's
--      default (no store) code path actually called.
--   7. claim_gift was TOCTOU (check-then-update, no row lock) so one gift link
--      could be claimed into two wallets; and the recipient's copy inherited a
--      still-encrypted CVV.
--   8. vouchers was never added to the realtime publication, so cross-device
--      sync silently did nothing.
-- ============================================================================

-- ── 0. Shared admin guard ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.assert_admin()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = true
  ) THEN
    RAISE EXCEPTION 'admin_only';
  END IF;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.assert_admin() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.assert_admin() TO authenticated;


-- ============================================================================
-- 1. voucher_shares — validate voucher ownership on write
-- ============================================================================
-- The recipient-view SELECT policy is fine. Replace the FOR ALL owner policy
-- with one that also checks the caller is a member of the voucher's wallet, so
-- an attacker can't INSERT a share row against someone else's voucher. Wallet
-- membership (not can_access_voucher) is used to avoid depending on the very
-- table being written.
DROP POLICY IF EXISTS "Owner can manage voucher shares" ON voucher_shares;
CREATE POLICY "Owner can manage voucher shares" ON voucher_shares
  USING (
    shared_by = auth.uid()
    AND voucher_id IN (
      SELECT id FROM vouchers WHERE wallet_id IN (SELECT get_my_wallet_ids())
    )
  )
  WITH CHECK (
    shared_by = auth.uid()
    AND voucher_id IN (
      SELECT id FROM vouchers WHERE wallet_id IN (SELECT get_my_wallet_ids())
    )
  );


-- ============================================================================
-- 2. shared_voucher_tokens — add can_access_voucher() to the UPDATE WITH CHECK
-- ============================================================================
DROP POLICY IF EXISTS "shared_tokens_update" ON shared_voucher_tokens;
CREATE POLICY "shared_tokens_update" ON shared_voucher_tokens
  FOR UPDATE TO authenticated
  USING (created_by = auth.uid())
  WITH CHECK (created_by = auth.uid() AND can_access_voucher(voucher_id));


-- ============================================================================
-- 3. marketplace — remove direct client UPDATE (all writes go through RPCs)
-- ============================================================================
-- With RLS enabled and no UPDATE policy, direct table UPDATEs are denied while
-- the SECURITY DEFINER RPCs (list_voucher_for_sale, update_listing_price,
-- remove_from_sale, buyer_confirm_payment, seller_confirm_payment,
-- cancel_purchase) continue to work. The frontend only ever SELECTs these
-- tables directly, so nothing legitimate breaks.
DROP POLICY IF EXISTS "Seller can update listing"        ON marketplace_listings;
DROP POLICY IF EXISTS "Buyer or seller can update purchase" ON marketplace_purchases;


-- ============================================================================
-- 4. Admin-only functions — add the is_admin guard, revoke PUBLIC/anon execute
-- ============================================================================

-- ── Banners ──────────────────────────────────────────────────────────────────
-- Remove the ambiguous 1-arg variant; the 3-arg version (with defaults) covers
-- every existing call site.
DROP FUNCTION IF EXISTS public.admin_add_banner(TEXT);

CREATE OR REPLACE FUNCTION public.admin_get_banners()
RETURNS SETOF public.login_banners
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM assert_admin();
  RETURN QUERY SELECT * FROM public.login_banners ORDER BY display_order ASC, created_at ASC;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_add_banner(
  p_image_url        TEXT,
  p_display_duration INT DEFAULT 5,
  p_skip_allowed     BOOLEAN DEFAULT true
)
RETURNS public.login_banners
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.login_banners;
BEGIN
  PERFORM assert_admin();
  INSERT INTO public.login_banners (image_url, is_active, display_duration, skip_allowed, display_order)
  VALUES (
    p_image_url, false, p_display_duration, p_skip_allowed,
    (SELECT COALESCE(MAX(display_order), 0) + 1 FROM public.login_banners)
  )
  RETURNING * INTO r;
  RETURN r;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_toggle_banner(p_id UUID, p_active BOOLEAN)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM assert_admin();
  UPDATE public.login_banners SET is_active = p_active WHERE id = p_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_delete_banner(p_id UUID)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM assert_admin();
  DELETE FROM public.login_banners WHERE id = p_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_update_banner_settings(
  p_id               UUID,
  p_display_duration INT,
  p_skip_allowed     BOOLEAN
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM assert_admin();
  UPDATE public.login_banners
  SET display_duration = p_display_duration, skip_allowed = p_skip_allowed
  WHERE id = p_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_reorder_banners(p_ids UUID[])
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE i INT;
BEGIN
  PERFORM assert_admin();
  FOR i IN 1..array_length(p_ids, 1) LOOP
    UPDATE public.login_banners SET display_order = i WHERE id = p_ids[i];
  END LOOP;
END;
$$;

-- ── Balance-check operators ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_create_operator(p_name TEXT, p_url TEXT)
RETURNS public.balance_check_operators
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.balance_check_operators;
BEGIN
  PERFORM assert_admin();
  INSERT INTO public.balance_check_operators (name, url) VALUES (p_name, p_url) RETURNING * INTO r;
  RETURN r;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_update_operator(p_id UUID, p_name TEXT, p_url TEXT)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM assert_admin();
  UPDATE public.balance_check_operators SET name = p_name, url = p_url WHERE id = p_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_delete_operator(p_id UUID)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM assert_admin();
  DELETE FROM public.balance_check_operators WHERE id = p_id;
END;
$$;

-- ── Support threads ───────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_reply_message(p_id UUID, p_reply TEXT)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM assert_admin();
  INSERT INTO public.support_message_replies (message_id, sender, body)
  VALUES (p_id, 'admin', p_reply);
  UPDATE public.support_messages
  SET admin_reply = p_reply, replied_at = now(), status = 'replied'
  WHERE id = p_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_get_message_replies(p_message_id UUID)
RETURNS SETOF public.support_message_replies
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM assert_admin();
  RETURN QUERY
    SELECT * FROM public.support_message_replies
    WHERE message_id = p_message_id
    ORDER BY created_at ASC;
END;
$$;

-- ── Verified-seller list (leaks seller emails) ────────────────────────────────
CREATE OR REPLACE FUNCTION admin_get_verified_sellers()
RETURNS TABLE (
  user_id UUID, name TEXT, email TEXT, is_verified BOOLEAN,
  total_sales BIGINT, avg_rating NUMERIC
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM assert_admin();
  RETURN QUERY
    SELECT
      p.id, p.name, p.email, p.is_verified_seller,
      COUNT(DISTINCT pur.id)::BIGINT AS total_sales,
      ROUND(COALESCE(AVG(r.rating), 0)::NUMERIC, 1) AS avg_rating
    FROM profiles p
    LEFT JOIN marketplace_purchases pur ON pur.seller_id = p.id AND pur.status = 'completed'
    LEFT JOIN user_ratings r ON r.rated_user_id = p.id
    GROUP BY p.id, p.name, p.email, p.is_verified_seller
    HAVING COUNT(DISTINCT pur.id) > 0
    ORDER BY total_sales DESC;
END;
$$;

-- ── Deal submissions (leaks submitter emails) ─────────────────────────────────
CREATE OR REPLACE FUNCTION admin_get_submissions(p_status TEXT DEFAULT NULL)
RETURNS TABLE (
  id UUID, user_id UUID, user_email TEXT,
  club_name TEXT, business_name TEXT, title TEXT, description TEXT,
  discount_type TEXT, discount_value NUMERIC, promo_code TEXT, external_link TEXT,
  tags TEXT[], start_date DATE, expiration_date DATE,
  status TEXT, admin_notes TEXT, created_at TIMESTAMPTZ
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM assert_admin();
  RETURN QUERY
    SELECT
      s.id, s.user_id, s.user_email,
      s.club_name, s.business_name, s.title, s.description,
      s.discount_type, s.discount_value, s.promo_code, s.external_link,
      s.tags, s.start_date, s.expiration_date,
      s.status, s.admin_notes, s.created_at
    FROM discount_deal_submissions s
    WHERE (p_status IS NULL OR s.status = p_status)
    ORDER BY
      CASE s.status WHEN 'pending' THEN 0 WHEN 'rejected' THEN 1 ELSE 2 END,
      s.created_at DESC;
END;
$$;

-- ── Full discount catalogue (paid content: promo codes, inactive rows) ────────
CREATE OR REPLACE FUNCTION admin_get_all_clubs()
RETURNS TABLE (id UUID, name TEXT, logo_url TEXT, type TEXT, is_active BOOLEAN, created_at TIMESTAMPTZ)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM assert_admin();
  RETURN QUERY
    SELECT c.id, c.name, c.logo_url, c.type, c.is_active, c.created_at
    FROM discount_clubs c ORDER BY c.type, c.name;
END;
$$;

CREATE OR REPLACE FUNCTION admin_get_all_businesses()
RETURNS TABLE (id UUID, name TEXT, logo_url TEXT, website TEXT, tags TEXT[], store_id UUID, created_at TIMESTAMPTZ)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM assert_admin();
  RETURN QUERY
    SELECT b.id, b.name, b.logo_url, b.website, b.tags, b.store_id, b.created_at
    FROM discount_businesses b ORDER BY b.name;
END;
$$;

CREATE OR REPLACE FUNCTION admin_get_all_deals()
RETURNS TABLE (
  id UUID, club_id UUID, club_name TEXT, business_id UUID, business_name TEXT,
  title TEXT, description TEXT, discount_type TEXT, discount_value NUMERIC,
  promo_code TEXT, external_link TEXT, tags TEXT[],
  start_date DATE, expiration_date DATE, is_active BOOLEAN, created_at TIMESTAMPTZ
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM assert_admin();
  RETURN QUERY
    SELECT
      d.id, d.club_id, cl.name, d.business_id, b.name,
      d.title, d.description, d.discount_type, d.discount_value,
      d.promo_code, d.external_link, d.tags,
      d.start_date, d.expiration_date, d.is_active, d.created_at
    FROM discount_deals d
    JOIN discount_clubs cl     ON cl.id = d.club_id
    JOIN discount_businesses b ON b.id = d.business_id
    ORDER BY d.created_at DESC;
END;
$$;

-- Revoke the default PUBLIC execute so anon can never reach these, then grant to
-- authenticated (the in-body assert_admin() does the real gate).
DO $$
DECLARE fn TEXT;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'admin_get_banners()',
    'admin_add_banner(text,int,boolean)',
    'admin_toggle_banner(uuid,boolean)',
    'admin_delete_banner(uuid)',
    'admin_update_banner_settings(uuid,int,boolean)',
    'admin_reorder_banners(uuid[])',
    'admin_create_operator(text,text)',
    'admin_update_operator(uuid,text,text)',
    'admin_delete_operator(uuid)',
    'admin_reply_message(uuid,text)',
    'admin_get_message_replies(uuid)',
    'admin_get_verified_sellers()',
    'admin_get_submissions(text)',
    'admin_get_all_clubs()',
    'admin_get_all_businesses()',
    'admin_get_all_deals()'
  ] LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%s FROM PUBLIC, anon;', fn);
    EXECUTE format('GRANT  EXECUTE ON FUNCTION public.%s TO authenticated;', fn);
  END LOOP;
END;
$$;


-- ============================================================================
-- 5. banners storage bucket — restrict writes to admins
-- ============================================================================
DROP POLICY IF EXISTS "Admin upload banners storage" ON storage.objects;
DROP POLICY IF EXISTS "Admin delete banners storage" ON storage.objects;

CREATE POLICY "Admin upload banners storage"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'banners'
    AND EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = true)
  );

CREATE POLICY "Admin delete banners storage"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'banners'
    AND EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = true)
  );


-- ============================================================================
-- 6. Drop the un-hardened 2-arg balance overloads
-- ============================================================================
-- After this, every call resolves to the 3-arg hardened version (p_store_used
-- DEFAULT NULL), which clamps the balance and writes proper audit rows.
DROP FUNCTION IF EXISTS update_gift_voucher_balance(text, numeric);
DROP FUNCTION IF EXISTS update_voucher_balance_by_token(text, numeric);
DROP FUNCTION IF EXISTS update_shared_voucher_balance(uuid, numeric);


-- ============================================================================
-- 7. claim_gift — atomic single claim + cvv_override
-- ============================================================================
ALTER TABLE voucher_gifts ADD COLUMN IF NOT EXISTS cvv_override TEXT;

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
  -- Read once to answer not_found / own_gift without racing.
  SELECT * INTO v_gift FROM voucher_gifts WHERE token = p_token;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_found');
  END IF;
  IF v_gift.sender_user_id = auth.uid() THEN
    RETURN jsonb_build_object('success', false, 'error', 'own_gift');
  END IF;

  -- Atomic claim: only one caller wins the row. A concurrent second claim finds
  -- no unclaimed row and gets already_claimed instead of a duplicate voucher.
  UPDATE voucher_gifts
  SET claimed_at = NOW(), claimed_by_user_id = auth.uid()
  WHERE token = p_token AND claimed_at IS NULL
  RETURNING * INTO v_gift;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'already_claimed');
  END IF;

  SELECT * INTO v_original FROM vouchers WHERE id = v_gift.voucher_id;

  SELECT wallet_id INTO v_wallet_id
  FROM wallet_members WHERE user_id = auth.uid()
  ORDER BY created_at LIMIT 1;

  IF v_wallet_id IS NULL THEN
    -- Give the claim back so the recipient can retry once they have a wallet.
    UPDATE voucher_gifts SET claimed_at = NULL, claimed_by_user_id = NULL WHERE token = p_token;
    RETURN jsonb_build_object('success', false, 'error', 'no_wallet');
  END IF;

  -- Copy to the recipient. code_override / cvv_override carry the plaintext for
  -- E2EE gifts; is_e2ee stays false precisely because we store plaintext.
  INSERT INTO vouchers (
    user_id, wallet_id, store_name, amount, balance, code, cvv,
    expiry_date, categories, tags, notes, link, is_archived, is_shared, is_gift
  ) VALUES (
    auth.uid(), v_wallet_id,
    v_original.store_name, v_original.amount, v_original.balance,
    COALESCE(v_gift.code_override, v_original.code),
    COALESCE(v_gift.cvv_override, v_original.cvv),
    v_original.expiry_date,
    v_original.categories, v_original.tags,
    v_original.notes, v_original.link,
    false, false, true
  )
  RETURNING id INTO v_new_voucher_id;

  UPDATE vouchers SET
    is_archived = true,
    notes = CASE
      WHEN notes IS NOT NULL AND notes <> ''
        THEN notes || E'\n' || 'מתנה ל: ' || COALESCE(NULLIF(v_gift.recipient_email, ''), 'קישור')
      ELSE 'מתנה ל: ' || COALESCE(NULLIF(v_gift.recipient_email, ''), 'קישור')
    END
  WHERE id = v_gift.voucher_id;

  INSERT INTO activity_log (user_id, wallet_id, action, voucher_id, voucher_name, details)
  VALUES (
    auth.uid(), v_wallet_id, 'gift_received', v_new_voucher_id,
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


-- ============================================================================
-- 8. Enable realtime for vouchers (cross-device sync)
-- ============================================================================
-- REPLICA IDENTITY FULL is required for DELETE events to carry enough of the old
-- row for the client's wallet_id filter to match.
ALTER TABLE vouchers REPLICA IDENTITY FULL;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'vouchers'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE vouchers;
  END IF;
END;
$$;


-- ── Reload PostgREST schema cache ─────────────────────────────────────────────
SELECT pg_notify('pgrst', 'reload schema');

-- ============================================================================
-- FOLLOW-UP (not automated here — needs a careful rewrite of large functions):
--   • get_marketplace_listings / get_listing_by_id still return seller_email and
--     marketplace_payment_methods to every authenticated caller. Consider
--     withholding those until a purchase row links buyer↔seller.
-- ============================================================================
