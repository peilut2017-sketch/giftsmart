-- ─────────────────────────────────────────────────────────────────────────────
-- Fix missing RPCs and subscriptions table
-- Run this in the Supabase SQL Editor if you're seeing:
--   • 404 on get_my_listings / get_my_purchases
--   • 406 on subscriptions
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── 1. subscriptions table (idempotent) ────────────────────────────────────
CREATE TABLE IF NOT EXISTS subscriptions (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                UUID REFERENCES auth.users NOT NULL UNIQUE,
  plan                   TEXT NOT NULL DEFAULT 'free',
  status                 TEXT NOT NULL DEFAULT 'active',
  stripe_customer_id     TEXT,
  stripe_subscription_id TEXT,
  current_period_end     TIMESTAMPTZ,
  created_at             TIMESTAMPTZ DEFAULT now(),
  updated_at             TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'subscriptions' AND policyname = 'users can read own subscription'
  ) THEN
    CREATE POLICY "users can read own subscription"
      ON subscriptions FOR SELECT USING (user_id = auth.uid());
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'subscriptions' AND policyname = 'service role manages subscriptions'
  ) THEN
    CREATE POLICY "service role manages subscriptions"
      ON subscriptions FOR ALL USING (auth.role() = 'service_role');
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS subscriptions_user_id_idx ON subscriptions (user_id);

-- ─── 2. get_my_listings (latest version with buyer info + reservation) ───────
DROP FUNCTION IF EXISTS get_my_listings();
CREATE FUNCTION get_my_listings()
RETURNS TABLE (
  id                  UUID,
  voucher_id          UUID,
  seller_id           UUID,
  asking_price        NUMERIC,
  reserved_price      NUMERIC,
  reserved_buyer_id   UUID,
  description         TEXT,
  status              TEXT,
  created_at          TIMESTAMPTZ,
  store_name          TEXT,
  balance             NUMERIC,
  expiry_date         DATE,
  purchase_id         UUID,
  purchase_status     TEXT,
  buyer_id            UUID,
  buyer_name          TEXT,
  buyer_email         TEXT,
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
    ml.reserved_price,
    ml.reserved_buyer_id,
    ml.description,
    ml.status,
    ml.created_at,
    v.store_name,
    v.balance,
    v.expiry_date,
    mp.id            AS purchase_id,
    mp.status        AS purchase_status,
    mp.buyer_id      AS buyer_id,
    bp.name          AS buyer_name,
    bp.email         AS buyer_email,
    mp.payment_method_used
  FROM marketplace_listings ml
  JOIN vouchers v ON v.id = ml.voucher_id
  LEFT JOIN marketplace_purchases mp
    ON mp.listing_id = ml.id
    AND mp.status IN ('pending_buyer_payment', 'buyer_confirmed')
  LEFT JOIN profiles bp ON bp.id = mp.buyer_id
  WHERE ml.seller_id = auth.uid()
  ORDER BY ml.created_at DESC;
END;
$$;

-- ─── 3. get_my_purchases ─────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS get_my_purchases();
CREATE FUNCTION get_my_purchases()
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
    mp.id            AS purchase_id,
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
    sp.name          AS seller_name,
    sp.email         AS seller_email,
    ur.rating        AS my_rating
  FROM marketplace_purchases mp
  JOIN marketplace_listings ml ON ml.id = mp.listing_id
  JOIN vouchers v ON v.id = ml.voucher_id
  JOIN profiles sp ON sp.id = mp.seller_id
  LEFT JOIN user_ratings ur
    ON ur.purchase_id = mp.id AND ur.rater_id = auth.uid()
  WHERE mp.buyer_id = auth.uid()
  ORDER BY mp.created_at DESC;
END;
$$;
