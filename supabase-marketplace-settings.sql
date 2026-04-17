-- ─────────────────────────────────────────────────────────────────────────────
-- Marketplace Settings, Auto-Expiry & Verified Seller
-- Run AFTER supabase-marketplace.sql
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── marketplace_settings (singleton) ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS marketplace_settings (
  id                  BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
  free_listing_days   INT     NOT NULL DEFAULT 30,
  pro_listing_days    INT     NOT NULL DEFAULT 60,
  verified_min_rating NUMERIC(3,1) NOT NULL DEFAULT 4.0,
  verified_min_sales  INT     NOT NULL DEFAULT 5,
  watchlist_pro_only  BOOLEAN NOT NULL DEFAULT TRUE
);
INSERT INTO marketplace_settings DEFAULT VALUES ON CONFLICT DO NOTHING;

ALTER TABLE marketplace_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "mktset_read_all"    ON marketplace_settings FOR SELECT USING (true);
CREATE POLICY "mktset_admin_write" ON marketplace_settings FOR UPDATE
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true));

-- ─── expires_at on listings ───────────────────────────────────────────────────
ALTER TABLE marketplace_listings ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

-- ─── verified_seller on profiles ─────────────────────────────────────────────
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS is_verified_seller BOOLEAN NOT NULL DEFAULT FALSE;

-- ─── RPC: get settings ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION get_marketplace_settings()
RETURNS marketplace_settings LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT * FROM marketplace_settings LIMIT 1;
$$;

-- ─── RPC: update settings (admin only) ───────────────────────────────────────
CREATE OR REPLACE FUNCTION update_marketplace_settings(
  p_free_listing_days   INT     DEFAULT NULL,
  p_pro_listing_days    INT     DEFAULT NULL,
  p_verified_min_rating NUMERIC DEFAULT NULL,
  p_verified_min_sales  INT     DEFAULT NULL,
  p_watchlist_pro_only  BOOLEAN DEFAULT NULL
) RETURNS marketplace_settings LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_s marketplace_settings;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true)
  THEN RAISE EXCEPTION 'unauthorized'; END IF;

  UPDATE marketplace_settings SET
    free_listing_days   = COALESCE(p_free_listing_days,   free_listing_days),
    pro_listing_days    = COALESCE(p_pro_listing_days,    pro_listing_days),
    verified_min_rating = COALESCE(p_verified_min_rating, verified_min_rating),
    verified_min_sales  = COALESCE(p_verified_min_sales,  verified_min_sales),
    watchlist_pro_only  = COALESCE(p_watchlist_pro_only,  watchlist_pro_only)
  RETURNING * INTO v_s;
  RETURN v_s;
END;
$$;

-- ─── Trigger: set expires_at when listing is created ─────────────────────────
CREATE OR REPLACE FUNCTION _set_listing_expiry()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_days     INT;
  v_is_pro   BOOLEAN;
BEGIN
  -- Check if seller has an active pro subscription
  SELECT (plan = 'pro' AND status = 'active'
          AND (current_period_end IS NULL OR current_period_end > NOW()))
    INTO v_is_pro
  FROM subscriptions
  WHERE user_id = NEW.seller_id
  LIMIT 1;

  -- If premium system is disabled, treat everyone as pro
  IF NOT FOUND THEN v_is_pro := FALSE; END IF;
  BEGIN
    IF NOT (SELECT premium_enabled FROM admin_settings LIMIT 1) THEN
      v_is_pro := TRUE;
    END IF;
  EXCEPTION WHEN OTHERS THEN NULL; END;

  SELECT CASE WHEN v_is_pro THEN pro_listing_days ELSE free_listing_days END
    INTO v_days FROM marketplace_settings LIMIT 1;

  NEW.expires_at := NOW() + make_interval(days => COALESCE(v_days, 30));
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_listing_expiry ON marketplace_listings;
CREATE TRIGGER set_listing_expiry
  BEFORE INSERT ON marketplace_listings
  FOR EACH ROW EXECUTE FUNCTION _set_listing_expiry();

-- ─── RPC: expire_marketplace_listings (called by pg_cron daily) ──────────────
CREATE OR REPLACE FUNCTION expire_marketplace_listings()
RETURNS INT LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE expired_count INT;
BEGIN
  WITH expired AS (
    UPDATE marketplace_listings
    SET status = 'cancelled', updated_at = NOW()
    WHERE status = 'active'
      AND expires_at IS NOT NULL
      AND expires_at < NOW()
    RETURNING voucher_id
  )
  UPDATE vouchers
    SET is_locked = FALSE, lock_reason = NULL
  WHERE id IN (SELECT voucher_id FROM expired);

  GET DIAGNOSTICS expired_count = ROW_COUNT;
  RETURN expired_count;
END;
$$;

-- Schedule daily at 02:00 UTC (requires pg_cron extension enabled in Supabase):
-- SELECT cron.schedule('expire-marketplace-listings', '0 2 * * *',
--   $$SELECT expire_marketplace_listings()$$);

-- ─── Trigger: re-evaluate verified seller after each completed sale ───────────
CREATE OR REPLACE FUNCTION _recheck_verified_seller()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_settings  marketplace_settings;
  v_avg       NUMERIC;
  v_sales     INT;
BEGIN
  IF NEW.status <> 'completed' OR OLD.status = 'completed' THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_settings FROM marketplace_settings LIMIT 1;

  -- Calculate seller's avg rating and total sales
  SELECT
    COALESCE(AVG(r.rating), 0),
    COUNT(DISTINCT p.id)
  INTO v_avg, v_sales
  FROM marketplace_purchases p
  LEFT JOIN user_ratings r ON r.purchase_id = p.id AND r.rated_user_id = p.seller_id
  WHERE p.seller_id = NEW.seller_id AND p.status = 'completed';

  UPDATE profiles
  SET is_verified_seller = (
    v_sales >= v_settings.verified_min_sales AND
    v_avg   >= v_settings.verified_min_rating
  )
  WHERE id = NEW.seller_id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS recheck_verified_seller ON marketplace_purchases;
CREATE TRIGGER recheck_verified_seller
  AFTER UPDATE ON marketplace_purchases
  FOR EACH ROW EXECUTE FUNCTION _recheck_verified_seller();

-- ─── RPC: admin_get_verified_sellers ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION admin_get_verified_sellers()
RETURNS TABLE (
  user_id        UUID,
  name           TEXT,
  email          TEXT,
  is_verified    BOOLEAN,
  total_sales    BIGINT,
  avg_rating     NUMERIC
) LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT
    p.id,
    p.name,
    p.email,
    p.is_verified_seller,
    COUNT(DISTINCT pur.id)::BIGINT AS total_sales,
    ROUND(COALESCE(AVG(r.rating), 0)::NUMERIC, 1) AS avg_rating
  FROM profiles p
  LEFT JOIN marketplace_purchases pur ON pur.seller_id = p.id AND pur.status = 'completed'
  LEFT JOIN user_ratings r ON r.rated_user_id = p.id
  GROUP BY p.id, p.name, p.email, p.is_verified_seller
  HAVING COUNT(DISTINCT pur.id) > 0
  ORDER BY total_sales DESC;
$$;

-- ─── RPC: override get_marketplace_listings to include is_verified_seller ────
CREATE OR REPLACE FUNCTION get_marketplace_listings(
  p_search        TEXT DEFAULT NULL,
  p_min_balance   NUMERIC DEFAULT NULL,
  p_max_price     NUMERIC DEFAULT NULL
)
RETURNS TABLE (
  id                     UUID,
  voucher_id             UUID,
  seller_id              UUID,
  asking_price           NUMERIC,
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
  seller_payment_methods JSONB,
  is_verified_seller     BOOLEAN
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
    COALESCE(p.marketplace_payment_methods, '[]'::JSONB) AS seller_payment_methods,
    COALESCE(p.is_verified_seller, FALSE) AS is_verified_seller
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
           p.name, p.email, p.marketplace_payment_methods, p.is_verified_seller
  ORDER BY ml.created_at DESC;
END;
$$;

-- ─── RPC: admin force-set verified status ────────────────────────────────────
CREATE OR REPLACE FUNCTION admin_set_verified_seller(p_user_id UUID, p_verified BOOLEAN)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true)
  THEN RAISE EXCEPTION 'unauthorized'; END IF;
  UPDATE profiles SET is_verified_seller = p_verified WHERE id = p_user_id;
END;
$$;
