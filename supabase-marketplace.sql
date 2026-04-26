-- =============================================
-- Marketplace / שוק — Supabase Migration
-- =============================================

-- ============ PROFILES: add payment methods column ============
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS marketplace_payment_methods JSONB DEFAULT '[]';
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS show_voucher_value BOOLEAN DEFAULT TRUE;
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS is_admin BOOLEAN DEFAULT FALSE;

-- ============ MARKETPLACE LISTINGS ============
CREATE TABLE IF NOT EXISTS marketplace_listings (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  voucher_id    UUID REFERENCES vouchers(id) ON DELETE CASCADE NOT NULL,
  seller_id     UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  asking_price  NUMERIC(10,2) NOT NULL,
  description   TEXT,
  status        TEXT NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active','pending_payment','sold','cancelled')),
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE marketplace_listings ENABLE ROW LEVEL SECURITY;

-- Everyone can read active listings
DROP POLICY IF EXISTS "Anyone can read active listings" ON marketplace_listings;
CREATE POLICY "Anyone can read active listings"
  ON marketplace_listings FOR SELECT
  TO authenticated
  USING (TRUE);

-- Only seller can insert
DROP POLICY IF EXISTS "Seller can insert listing" ON marketplace_listings;
CREATE POLICY "Seller can insert listing"
  ON marketplace_listings FOR INSERT
  TO authenticated
  WITH CHECK (seller_id = auth.uid());

-- Only seller can update their listing
DROP POLICY IF EXISTS "Seller can update listing" ON marketplace_listings;
CREATE POLICY "Seller can update listing"
  ON marketplace_listings FOR UPDATE
  TO authenticated
  USING (seller_id = auth.uid());

-- Only seller can delete their listing
DROP POLICY IF EXISTS "Seller can delete listing" ON marketplace_listings;
CREATE POLICY "Seller can delete listing"
  ON marketplace_listings FOR DELETE
  TO authenticated
  USING (seller_id = auth.uid());

-- Updated_at trigger
CREATE OR REPLACE TRIGGER marketplace_listings_updated_at
  BEFORE UPDATE ON marketplace_listings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============ MARKETPLACE PURCHASES ============
CREATE TABLE IF NOT EXISTS marketplace_purchases (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id              UUID REFERENCES marketplace_listings(id) NOT NULL,
  buyer_id                UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  seller_id               UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  payment_method_used     TEXT,
  buyer_confirmed_at      TIMESTAMPTZ,
  seller_confirmed_at     TIMESTAMPTZ,
  voucher_transferred_at  TIMESTAMPTZ,
  status                  TEXT NOT NULL DEFAULT 'pending_buyer_payment'
                            CHECK (status IN (
                              'pending_buyer_payment',
                              'buyer_confirmed',
                              'completed',
                              'cancelled'
                            )),
  created_at              TIMESTAMPTZ DEFAULT NOW(),
  updated_at              TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE marketplace_purchases ENABLE ROW LEVEL SECURITY;

-- Buyer and seller can read their own purchases
DROP POLICY IF EXISTS "Buyer or seller can read purchases" ON marketplace_purchases;
CREATE POLICY "Buyer or seller can read purchases"
  ON marketplace_purchases FOR SELECT
  TO authenticated
  USING (buyer_id = auth.uid() OR seller_id = auth.uid());

-- Buyer can insert (initiate purchase)
DROP POLICY IF EXISTS "Buyer can insert purchase" ON marketplace_purchases;
CREATE POLICY "Buyer can insert purchase"
  ON marketplace_purchases FOR INSERT
  TO authenticated
  WITH CHECK (buyer_id = auth.uid());

-- Buyer or seller can update (confirm payment steps)
DROP POLICY IF EXISTS "Buyer or seller can update purchase" ON marketplace_purchases;
CREATE POLICY "Buyer or seller can update purchase"
  ON marketplace_purchases FOR UPDATE
  TO authenticated
  USING (buyer_id = auth.uid() OR seller_id = auth.uid());

-- Updated_at trigger
CREATE OR REPLACE TRIGGER marketplace_purchases_updated_at
  BEFORE UPDATE ON marketplace_purchases
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============ USER RATINGS ============
CREATE TABLE IF NOT EXISTS user_ratings (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rater_id        UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  rated_user_id   UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  purchase_id     UUID REFERENCES marketplace_purchases(id) ON DELETE CASCADE NOT NULL,
  rating          INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment         TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(rater_id, purchase_id)
);

ALTER TABLE user_ratings ENABLE ROW LEVEL SECURITY;

-- Everyone can read ratings
DROP POLICY IF EXISTS "Anyone can read ratings" ON user_ratings;
CREATE POLICY "Anyone can read ratings"
  ON user_ratings FOR SELECT
  TO authenticated
  USING (TRUE);

-- Only rater can insert
DROP POLICY IF EXISTS "Rater can insert rating" ON user_ratings;
CREATE POLICY "Rater can insert rating"
  ON user_ratings FOR INSERT
  TO authenticated
  WITH CHECK (rater_id = auth.uid());

-- Rater can update their own rating
DROP POLICY IF EXISTS "Rater can update rating" ON user_ratings;
CREATE POLICY "Rater can update rating"
  ON user_ratings FOR UPDATE
  TO authenticated
  USING (rater_id = auth.uid());

-- ============ USER REPORTS ============
CREATE TABLE IF NOT EXISTS user_reports (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id       UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  reported_user_id  UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  purchase_id       UUID REFERENCES marketplace_purchases(id) ON DELETE SET NULL,
  listing_id        UUID REFERENCES marketplace_listings(id) ON DELETE SET NULL,
  reason            TEXT NOT NULL,
  details           TEXT,
  status            TEXT DEFAULT 'pending'
                      CHECK (status IN ('pending','reviewed','resolved')),
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE user_reports ENABLE ROW LEVEL SECURITY;

-- Reporter can read their own reports
DROP POLICY IF EXISTS "Reporter can read own reports" ON user_reports;
CREATE POLICY "Reporter can read own reports"
  ON user_reports FOR SELECT
  TO authenticated
  USING (reporter_id = auth.uid());

-- Anyone authenticated can insert a report
DROP POLICY IF EXISTS "Anyone can insert report" ON user_reports;
CREATE POLICY "Anyone can insert report"
  ON user_reports FOR INSERT
  TO authenticated
  WITH CHECK (reporter_id = auth.uid());

-- ============ RPC: list_voucher_for_sale ============
CREATE OR REPLACE FUNCTION list_voucher_for_sale(
  p_voucher_id    UUID,
  p_asking_price  NUMERIC,
  p_description   TEXT DEFAULT NULL
)
RETURNS marketplace_listings
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_listing marketplace_listings;
BEGIN
  -- Validate caller owns the voucher
  IF NOT EXISTS (
    SELECT 1 FROM vouchers WHERE id = p_voucher_id AND user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'unauthorized: voucher not owned by caller';
  END IF;

  -- Validate voucher is not already listed
  IF EXISTS (
    SELECT 1 FROM marketplace_listings
    WHERE voucher_id = p_voucher_id AND status IN ('active','pending_payment')
  ) THEN
    RAISE EXCEPTION 'already_listed: voucher is already for sale';
  END IF;

  -- Lock the voucher
  UPDATE vouchers
  SET is_locked = true, lock_reason = 'for_sale', updated_at = NOW()
  WHERE id = p_voucher_id;

  -- Create listing
  INSERT INTO marketplace_listings (voucher_id, seller_id, asking_price, description)
  VALUES (p_voucher_id, auth.uid(), p_asking_price, p_description)
  RETURNING * INTO v_listing;

  RETURN v_listing;
END;
$$;

-- ============ RPC: remove_from_sale ============
CREATE OR REPLACE FUNCTION remove_from_sale(p_listing_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_voucher_id UUID;
  v_status TEXT;
BEGIN
  SELECT voucher_id, status INTO v_voucher_id, v_status
  FROM marketplace_listings
  WHERE id = p_listing_id AND seller_id = auth.uid();

  IF v_voucher_id IS NULL THEN
    RAISE EXCEPTION 'unauthorized or not found';
  END IF;

  IF v_status = 'sold' THEN
    RAISE EXCEPTION 'cannot_remove: listing already sold';
  END IF;

  -- Cancel any pending purchase
  UPDATE marketplace_purchases
  SET status = 'cancelled', updated_at = NOW()
  WHERE listing_id = p_listing_id AND status IN ('pending_buyer_payment','buyer_confirmed');

  -- Cancel listing
  UPDATE marketplace_listings
  SET status = 'cancelled', updated_at = NOW()
  WHERE id = p_listing_id;

  -- Unlock voucher
  UPDATE vouchers
  SET is_locked = false, lock_reason = NULL, updated_at = NOW()
  WHERE id = v_voucher_id;
END;
$$;

-- ============ RPC: buyer_confirm_payment ============
CREATE OR REPLACE FUNCTION buyer_confirm_payment(
  p_listing_id          UUID,
  p_payment_method_used TEXT
)
RETURNS marketplace_purchases
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_listing  marketplace_listings;
  v_purchase marketplace_purchases;
BEGIN
  SELECT * INTO v_listing
  FROM marketplace_listings
  WHERE id = p_listing_id AND status = 'active';

  IF v_listing.id IS NULL THEN
    RAISE EXCEPTION 'listing_not_found_or_not_active';
  END IF;

  IF v_listing.seller_id = auth.uid() THEN
    RAISE EXCEPTION 'cannot_buy_own_listing';
  END IF;

  -- Check if buyer already has a pending purchase for this listing
  IF EXISTS (
    SELECT 1 FROM marketplace_purchases
    WHERE listing_id = p_listing_id AND buyer_id = auth.uid()
      AND status IN ('pending_buyer_payment','buyer_confirmed')
  ) THEN
    RAISE EXCEPTION 'already_purchased';
  END IF;

  -- Create purchase record
  INSERT INTO marketplace_purchases (
    listing_id, buyer_id, seller_id,
    payment_method_used, buyer_confirmed_at, status
  )
  VALUES (
    p_listing_id, auth.uid(), v_listing.seller_id,
    p_payment_method_used, NOW(), 'buyer_confirmed'
  )
  RETURNING * INTO v_purchase;

  -- Update listing status
  UPDATE marketplace_listings
  SET status = 'pending_payment', updated_at = NOW()
  WHERE id = p_listing_id;

  RETURN v_purchase;
END;
$$;

-- ============ RPC: seller_confirm_payment ============
CREATE OR REPLACE FUNCTION seller_confirm_payment(p_purchase_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_purchase        marketplace_purchases;
  v_listing         marketplace_listings;
  v_voucher         vouchers;
  v_buyer_wallet_id UUID;
BEGIN
  SELECT * INTO v_purchase
  FROM marketplace_purchases
  WHERE id = p_purchase_id AND seller_id = auth.uid();

  IF v_purchase.id IS NULL THEN
    RAISE EXCEPTION 'unauthorized or purchase not found';
  END IF;

  IF v_purchase.status != 'buyer_confirmed' THEN
    RAISE EXCEPTION 'invalid_status: expected buyer_confirmed, got %', v_purchase.status;
  END IF;

  SELECT * INTO v_listing FROM marketplace_listings WHERE id = v_purchase.listing_id;
  SELECT * INTO v_voucher FROM vouchers WHERE id = v_listing.voucher_id;

  -- Get buyer's wallet (primary wallet: owner_id = buyer)
  SELECT id INTO v_buyer_wallet_id
  FROM wallets
  WHERE owner_id = v_purchase.buyer_id
  LIMIT 1;

  IF v_buyer_wallet_id IS NULL THEN
    RAISE EXCEPTION 'buyer_wallet_not_found';
  END IF;

  -- Copy voucher to buyer's wallet
  INSERT INTO vouchers (
    user_id, wallet_id, store_name, store_id, super_voucher_id,
    amount, balance, code, cvv, expiry_date,
    categories, tags, notes, link, source,
    is_archived, is_shared, is_gift, is_locked
  )
  VALUES (
    v_purchase.buyer_id, v_buyer_wallet_id,
    v_voucher.store_name, v_voucher.store_id, NULL,
    v_voucher.amount, v_voucher.balance,
    v_voucher.code, v_voucher.cvv, v_voucher.expiry_date,
    v_voucher.categories, v_voucher.tags,
    v_voucher.notes, v_voucher.link, 'marketplace',
    FALSE, FALSE, FALSE, FALSE
  );

  -- Archive original from seller and remove lock
  UPDATE vouchers
  SET is_archived = TRUE, is_locked = FALSE, lock_reason = NULL, updated_at = NOW()
  WHERE id = v_listing.voucher_id;

  -- Mark listing as sold
  UPDATE marketplace_listings
  SET status = 'sold', updated_at = NOW()
  WHERE id = v_listing.id;

  -- Mark purchase as completed
  UPDATE marketplace_purchases
  SET status = 'completed',
      seller_confirmed_at = NOW(),
      voucher_transferred_at = NOW(),
      updated_at = NOW()
  WHERE id = p_purchase_id;
END;
$$;

-- ============ RPC: cancel_purchase ============
CREATE OR REPLACE FUNCTION cancel_purchase(p_purchase_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_purchase marketplace_purchases;
BEGIN
  SELECT * INTO v_purchase
  FROM marketplace_purchases
  WHERE id = p_purchase_id
    AND (buyer_id = auth.uid() OR seller_id = auth.uid());

  IF v_purchase.id IS NULL THEN
    RAISE EXCEPTION 'unauthorized or not found';
  END IF;

  IF v_purchase.status = 'completed' THEN
    RAISE EXCEPTION 'cannot_cancel_completed';
  END IF;

  UPDATE marketplace_purchases
  SET status = 'cancelled', updated_at = NOW()
  WHERE id = p_purchase_id;

  -- Reset listing to active
  UPDATE marketplace_listings
  SET status = 'active', updated_at = NOW()
  WHERE id = v_purchase.listing_id AND status = 'pending_payment';
END;
$$;

-- ============ RPC: rate_user ============
CREATE OR REPLACE FUNCTION rate_user(
  p_purchase_id   UUID,
  p_rated_user_id UUID,
  p_rating        INTEGER,
  p_comment       TEXT DEFAULT NULL
)
RETURNS user_ratings
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_rating user_ratings;
BEGIN
  -- Validate purchase is completed and caller is a party
  IF NOT EXISTS (
    SELECT 1 FROM marketplace_purchases
    WHERE id = p_purchase_id
      AND status = 'completed'
      AND (buyer_id = auth.uid() OR seller_id = auth.uid())
  ) THEN
    RAISE EXCEPTION 'unauthorized or purchase not completed';
  END IF;

  IF p_rated_user_id = auth.uid() THEN
    RAISE EXCEPTION 'cannot_rate_self';
  END IF;

  INSERT INTO user_ratings (rater_id, rated_user_id, purchase_id, rating, comment)
  VALUES (auth.uid(), p_rated_user_id, p_purchase_id, p_rating, p_comment)
  ON CONFLICT (rater_id, purchase_id)
  DO UPDATE SET rating = p_rating, comment = p_comment
  RETURNING * INTO v_rating;

  RETURN v_rating;
END;
$$;

-- ============ RPC: report_user ============
CREATE OR REPLACE FUNCTION report_user(
  p_reported_user_id  UUID,
  p_reason            TEXT,
  p_details           TEXT DEFAULT NULL,
  p_purchase_id       UUID DEFAULT NULL,
  p_listing_id        UUID DEFAULT NULL
)
RETURNS user_reports
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_report user_reports;
BEGIN
  IF p_reported_user_id = auth.uid() THEN
    RAISE EXCEPTION 'cannot_report_self';
  END IF;

  INSERT INTO user_reports (
    reporter_id, reported_user_id, purchase_id, listing_id, reason, details
  )
  VALUES (
    auth.uid(), p_reported_user_id, p_purchase_id, p_listing_id, p_reason, p_details
  )
  RETURNING * INTO v_report;

  RETURN v_report;
END;
$$;

-- ============ RPC: get_marketplace_listings ============
-- Returns all active listings with seller profile + voucher info + avg rating
CREATE OR REPLACE FUNCTION get_marketplace_listings(
  p_search        TEXT DEFAULT NULL,
  p_min_balance   NUMERIC DEFAULT NULL,
  p_max_price     NUMERIC DEFAULT NULL
)
RETURNS TABLE (
  id              UUID,
  voucher_id      UUID,
  seller_id       UUID,
  asking_price    NUMERIC,
  description     TEXT,
  status          TEXT,
  created_at      TIMESTAMPTZ,
  store_name      TEXT,
  balance         NUMERIC,
  expiry_date     DATE,
  seller_name     TEXT,
  seller_email    TEXT,
  avg_rating      NUMERIC,
  rating_count    BIGINT,
  seller_payment_methods JSONB
)
LANGUAGE plpgsql SECURITY DEFINER STABLE AS $$
BEGIN
  RETURN QUERY
  SELECT
    ml.id,
    ml.voucher_id,
    ml.seller_id,
    ml.asking_price,
    ml.description,
    ml.status,
    ml.created_at,
    v.store_name,
    v.balance,
    v.expiry_date,
    p.name AS seller_name,
    p.email AS seller_email,
    COALESCE(AVG(ur.rating), 0)::NUMERIC AS avg_rating,
    COUNT(ur.id) AS rating_count,
    COALESCE(p.marketplace_payment_methods, '[]'::JSONB) AS seller_payment_methods
  FROM marketplace_listings ml
  JOIN vouchers v ON v.id = ml.voucher_id
  JOIN profiles p ON p.id = ml.seller_id
  LEFT JOIN user_ratings ur ON ur.rated_user_id = ml.seller_id
  WHERE ml.status = 'active'
    AND ml.seller_id != auth.uid()
    AND (p_search IS NULL OR v.store_name ILIKE '%' || p_search || '%')
    AND (p_min_balance IS NULL OR v.balance >= p_min_balance)
    AND (p_max_price IS NULL OR ml.asking_price <= p_max_price)
  GROUP BY ml.id, v.store_name, v.balance, v.expiry_date,
           p.name, p.email, p.marketplace_payment_methods
  ORDER BY ml.created_at DESC;
END;
$$;

-- ============ RPC: get_my_listings ============
CREATE OR REPLACE FUNCTION get_my_listings()
RETURNS TABLE (
  id              UUID,
  voucher_id      UUID,
  seller_id       UUID,
  asking_price    NUMERIC,
  description     TEXT,
  status          TEXT,
  created_at      TIMESTAMPTZ,
  store_name      TEXT,
  balance         NUMERIC,
  expiry_date     DATE,
  -- purchase info if pending
  purchase_id     UUID,
  purchase_status TEXT,
  buyer_name      TEXT,
  buyer_email     TEXT,
  payment_method_used TEXT
)
LANGUAGE plpgsql SECURITY DEFINER STABLE AS $$
BEGIN
  RETURN QUERY
  SELECT
    ml.id,
    ml.voucher_id,
    ml.seller_id,
    ml.asking_price,
    ml.description,
    ml.status,
    ml.created_at,
    v.store_name,
    v.balance,
    v.expiry_date,
    mp.id AS purchase_id,
    mp.status AS purchase_status,
    bp.name AS buyer_name,
    bp.email AS buyer_email,
    mp.payment_method_used
  FROM marketplace_listings ml
  JOIN vouchers v ON v.id = ml.voucher_id
  LEFT JOIN marketplace_purchases mp ON mp.listing_id = ml.id
    AND mp.status IN ('pending_buyer_payment','buyer_confirmed')
  LEFT JOIN profiles bp ON bp.id = mp.buyer_id
  WHERE ml.seller_id = auth.uid()
  ORDER BY ml.created_at DESC;
END;
$$;

-- ============ RPC: get_my_purchases ============
CREATE OR REPLACE FUNCTION get_my_purchases()
RETURNS TABLE (
  purchase_id         UUID,
  listing_id          UUID,
  status              TEXT,
  payment_method_used TEXT,
  buyer_confirmed_at  TIMESTAMPTZ,
  seller_confirmed_at TIMESTAMPTZ,
  created_at          TIMESTAMPTZ,
  store_name          TEXT,
  balance             NUMERIC,
  expiry_date         DATE,
  asking_price        NUMERIC,
  seller_id           UUID,
  seller_name         TEXT,
  seller_email        TEXT,
  my_rating           INTEGER
)
LANGUAGE plpgsql SECURITY DEFINER STABLE AS $$
BEGIN
  RETURN QUERY
  SELECT
    mp.id AS purchase_id,
    mp.listing_id,
    mp.status,
    mp.payment_method_used,
    mp.buyer_confirmed_at,
    mp.seller_confirmed_at,
    mp.created_at,
    v.store_name,
    v.balance,
    v.expiry_date,
    ml.asking_price,
    ml.seller_id,
    sp.name AS seller_name,
    sp.email AS seller_email,
    ur.rating AS my_rating
  FROM marketplace_purchases mp
  JOIN marketplace_listings ml ON ml.id = mp.listing_id
  JOIN vouchers v ON v.id = ml.voucher_id
  JOIN profiles sp ON sp.id = mp.seller_id
  LEFT JOIN user_ratings ur ON ur.purchase_id = mp.id AND ur.rater_id = auth.uid()
  WHERE mp.buyer_id = auth.uid()
  ORDER BY mp.created_at DESC;
END;
$$;

-- ============ Admin: read all reports ============
CREATE OR REPLACE FUNCTION admin_get_reports()
RETURNS TABLE (
  id                UUID,
  reporter_email    TEXT,
  reported_email    TEXT,
  reason            TEXT,
  details           TEXT,
  status            TEXT,
  created_at        TIMESTAMPTZ,
  purchase_id       UUID,
  listing_id        UUID
)
LANGUAGE plpgsql SECURITY DEFINER STABLE AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = TRUE) THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  RETURN QUERY
  SELECT
    ur.id,
    COALESCE(rp.email, '(משתמש נמחק)')  AS reporter_email,
    COALESCE(rd.email, '(משתמש נמחק)')  AS reported_email,
    ur.reason,
    ur.details,
    ur.status,
    ur.created_at,
    ur.purchase_id,
    ur.listing_id
  FROM user_reports ur
  LEFT JOIN profiles rp ON rp.id = ur.reporter_id
  LEFT JOIN profiles rd ON rd.id = ur.reported_user_id
  ORDER BY ur.created_at DESC;
END;
$$;
GRANT EXECUTE ON FUNCTION admin_get_reports TO authenticated;

CREATE OR REPLACE FUNCTION admin_update_report_status(p_report_id UUID, p_status TEXT)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = TRUE) THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;
  UPDATE user_reports SET status = p_status WHERE id = p_report_id;
END;
$$;
GRANT EXECUTE ON FUNCTION admin_update_report_status TO authenticated;

-- Enable realtime for marketplace tables
ALTER PUBLICATION supabase_realtime ADD TABLE marketplace_purchases;
ALTER PUBLICATION supabase_realtime ADD TABLE marketplace_listings;

-- Notify schema cache reload
SELECT pg_notify('pgrst', 'reload schema');
