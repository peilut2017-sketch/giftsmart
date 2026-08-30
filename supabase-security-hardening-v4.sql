-- ============================================================================
-- Security hardening v4
-- ============================================================================
-- Apply in the Supabase SQL Editor (idempotent — safe to re-run). Fixes found in
-- a deeper audit round, chosen to be ADDITIVE where the underlying function has
-- several apply-order-dependent versions, so this migration cannot regress
-- whichever version your database currently runs.
--
--   1. marketplace_messages was directly INSERT/UPDATE-able by any user, letting
--      them inject notifications into anyone's inbox (the realtime handler shows
--      the attacker-controlled body as a push) and craft a price_offer/reservation
--      against a victim's listing. All real writes go through SECURITY DEFINER
--      RPCs (send_marketplace_message / respond_to_price_offer), so the direct
--      write policies are removed.
--   2. Account deletion (delete_own_account / admin_delete_user) DELETEs auth.users
--      and relies on cascade, but subscriptions / coupon_redemptions /
--      support_messages reference auth.users with NO cascade → the delete throws
--      for any Pro user, coupon redeemer, or anyone who contacted support, so the
--      account and its PII were never removed (app-store + privacy failure). The
--      FKs are switched to ON DELETE CASCADE (coupons.created_by → SET NULL).
--   3. Two concurrent buyers could each get a live purchase on the same listing
--      (no row lock in buyer_confirm_payment) → the same voucher sold twice. A
--      partial unique index makes a second live purchase per listing impossible
--      at the DB level, independent of the function version.
--   4. The hot marketplace read paths had no indexes.
--   5. increment_deal_view_count was callable by anon with no REVOKE.
-- ============================================================================

-- ── 1. Remove direct client writes to marketplace_messages ───────────────────
-- send_marketplace_message and respond_to_price_offer are SECURITY DEFINER and
-- keep working; only raw PostgREST table writes are blocked.
DROP POLICY IF EXISTS "mm_insert" ON marketplace_messages;
DROP POLICY IF EXISTS "mm_update" ON marketplace_messages;
-- mm_select stays: participants can still read their own threads.


-- ── 2. Account-deletion cascade fixes ────────────────────────────────────────
-- Recreate each FK to auth.users with the right ON DELETE action. The DO block
-- discovers the existing constraint name (auto-generated) before replacing it.
DO $$
DECLARE cname text;
BEGIN
  -- subscriptions.user_id → CASCADE
  SELECT conname INTO cname FROM pg_constraint
   WHERE conrelid = 'public.subscriptions'::regclass AND contype = 'f'
     AND confrelid = 'auth.users'::regclass;
  IF cname IS NOT NULL THEN EXECUTE format('ALTER TABLE public.subscriptions DROP CONSTRAINT %I', cname); END IF;
  ALTER TABLE public.subscriptions
    ADD CONSTRAINT subscriptions_user_id_fkey FOREIGN KEY (user_id)
    REFERENCES auth.users(id) ON DELETE CASCADE;
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

DO $$
DECLARE cname text;
BEGIN
  -- coupon_redemptions.user_id → CASCADE
  SELECT conname INTO cname FROM pg_constraint
   WHERE conrelid = 'public.coupon_redemptions'::regclass AND contype = 'f'
     AND confrelid = 'auth.users'::regclass
     AND conkey = ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid = 'public.coupon_redemptions'::regclass AND attname = 'user_id')];
  IF cname IS NOT NULL THEN EXECUTE format('ALTER TABLE public.coupon_redemptions DROP CONSTRAINT %I', cname); END IF;
  ALTER TABLE public.coupon_redemptions
    ADD CONSTRAINT coupon_redemptions_user_id_fkey FOREIGN KEY (user_id)
    REFERENCES auth.users(id) ON DELETE CASCADE;
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

DO $$
DECLARE cname text;
BEGIN
  -- support_messages.user_id → CASCADE
  SELECT conname INTO cname FROM pg_constraint
   WHERE conrelid = 'public.support_messages'::regclass AND contype = 'f'
     AND confrelid = 'auth.users'::regclass
     AND conkey = ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid = 'public.support_messages'::regclass AND attname = 'user_id')];
  IF cname IS NOT NULL THEN EXECUTE format('ALTER TABLE public.support_messages DROP CONSTRAINT %I', cname); END IF;
  ALTER TABLE public.support_messages
    ADD CONSTRAINT support_messages_user_id_fkey FOREIGN KEY (user_id)
    REFERENCES auth.users(id) ON DELETE CASCADE;
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

DO $$
DECLARE cname text;
BEGIN
  -- coupons.created_by → SET NULL (keep the coupon, drop the creator link)
  SELECT conname INTO cname FROM pg_constraint
   WHERE conrelid = 'public.coupons'::regclass AND contype = 'f'
     AND confrelid = 'auth.users'::regclass
     AND conkey = ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid = 'public.coupons'::regclass AND attname = 'created_by')];
  IF cname IS NOT NULL THEN EXECUTE format('ALTER TABLE public.coupons DROP CONSTRAINT %I', cname); END IF;
  ALTER TABLE public.coupons
    ADD CONSTRAINT coupons_created_by_fkey FOREIGN KEY (created_by)
    REFERENCES auth.users(id) ON DELETE SET NULL;
EXCEPTION WHEN undefined_table THEN NULL;
END $$;


-- ── 3. One live purchase per listing (prevents double-sell) ──────────────────
-- With at most one purchase in a live status per listing, two concurrent buyers
-- can't both reach 'buyer_confirmed', and the seller can never confirm a second
-- delivery of the same voucher.
CREATE UNIQUE INDEX IF NOT EXISTS marketplace_purchases_one_live_per_listing
  ON marketplace_purchases (listing_id)
  WHERE status IN ('pending_buyer_payment', 'buyer_confirmed');


-- ── 4. Marketplace read-path indexes ─────────────────────────────────────────
CREATE INDEX IF NOT EXISTS marketplace_listings_status_idx     ON marketplace_listings (status);
CREATE INDEX IF NOT EXISTS marketplace_listings_seller_id_idx  ON marketplace_listings (seller_id);
CREATE INDEX IF NOT EXISTS marketplace_purchases_buyer_id_idx  ON marketplace_purchases (buyer_id);
CREATE INDEX IF NOT EXISTS marketplace_purchases_seller_id_idx ON marketplace_purchases (seller_id);
CREATE INDEX IF NOT EXISTS marketplace_purchases_listing_id_idx ON marketplace_purchases (listing_id);
CREATE INDEX IF NOT EXISTS user_ratings_rated_user_id_idx      ON user_ratings (rated_user_id);


-- ── 5. Deal view-count: block anon inflation ─────────────────────────────────
REVOKE EXECUTE ON FUNCTION increment_deal_view_count(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION increment_deal_view_count(uuid) TO authenticated;


-- ── Reload PostgREST schema cache ─────────────────────────────────────────────
SELECT pg_notify('pgrst', 'reload schema');

-- ============================================================================
-- REVIEW & APPLY MANUALLY (apply-order-sensitive; verify against your live
-- function bodies with `SELECT pg_get_functiondef(oid) …` first):
--
--   • Coupon over-redemption race: the final redeem_coupon (in
--     supabase-security-hardening-v2.sql) checks uses_count >= max_uses and later
--     increments without a row lock. Add `FOR UPDATE` to its opening
--     `SELECT * INTO v_coupon FROM coupons WHERE code = p_code AND is_active`
--     to serialize concurrent redemptions of the same limited coupon.
--
--   • Seller KYC gate: whether unverified sellers may list is a PRODUCT decision
--     (a hard gate would block every seller until an admin verifies them). If you
--     want it enforced, add a check on seller_profiles.verification_status='verified'
--     inside list_voucher_for_sale, or a BEFORE INSERT trigger on
--     marketplace_listings — NOT applied here to avoid locking out all sellers.
--
--   • get_marketplace_listings / get_listing_by_id still return seller_email and
--     marketplace_payment_methods to every authenticated caller (v3 follow-up).
--     Withhold them until a purchase row links buyer↔seller.
-- ============================================================================
