-- Coupon system v2: days_free, percent, fixed discount types
-- Run in Supabase SQL editor AFTER supabase-coupons-messages.sql

-- Add stripe_coupon_code column (for percent/fixed — passed to Stripe checkout)
ALTER TABLE coupons ADD COLUMN IF NOT EXISTS stripe_coupon_code text;

-- discount_type now supports: 'months_free' | 'days_free' | 'percent' | 'fixed'
-- discount_value meaning per type:
--   months_free → number of months of free Pro
--   days_free   → number of days of free Pro
--   percent     → percentage discount (e.g. 50 = 50% off → ₪4.5/month)
--   fixed       → fixed amount off in ₪ (e.g. 3 → ₪6/month instead of ₪9)

-- Update admin_create_coupon to accept discount_type + stripe_coupon_code
CREATE OR REPLACE FUNCTION admin_create_coupon(
  p_code              text,
  p_name              text,
  p_type              text    DEFAULT 'general',
  p_discount_type     text    DEFAULT 'months_free',
  p_discount_value    int     DEFAULT 1,
  p_max_uses          int     DEFAULT null,
  p_valid_until       timestamptz DEFAULT null,
  p_restricted_email  text    DEFAULT null,
  p_first_time_only   boolean DEFAULT false,
  p_stripe_coupon_code text   DEFAULT null
) RETURNS coupons LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_row coupons;
BEGIN
  INSERT INTO coupons (
    code, name, type, discount_type, discount_value,
    max_uses, valid_until, restricted_to_email,
    first_time_only, stripe_coupon_code, created_by
  ) VALUES (
    upper(trim(p_code)), p_name, p_type, p_discount_type, p_discount_value,
    p_max_uses, p_valid_until, lower(p_restricted_email),
    p_first_time_only, p_stripe_coupon_code, auth.uid()
  ) RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;

-- Update redeem_coupon to handle days_free + return discount info for percent/fixed
CREATE OR REPLACE FUNCTION redeem_coupon(p_code text, p_user_id uuid DEFAULT auth.uid())
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_coupon     coupons%rowtype;
  v_user_email text;
  v_period_end timestamptz;
  v_base       timestamptz;
BEGIN
  p_code := upper(trim(p_code));

  SELECT * INTO v_coupon FROM coupons WHERE code = p_code AND is_active = true;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_CODE');
  END IF;

  IF v_coupon.valid_until IS NOT NULL AND v_coupon.valid_until < now() THEN
    RETURN jsonb_build_object('success', false, 'error', 'EXPIRED');
  END IF;

  IF v_coupon.max_uses IS NOT NULL AND v_coupon.uses_count >= v_coupon.max_uses THEN
    RETURN jsonb_build_object('success', false, 'error', 'EXHAUSTED');
  END IF;

  IF EXISTS (SELECT 1 FROM coupon_redemptions WHERE coupon_id = v_coupon.id AND user_id = p_user_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'ALREADY_USED');
  END IF;

  SELECT email INTO v_user_email FROM auth.users WHERE id = p_user_id;

  IF v_coupon.restricted_to_email IS NOT NULL
     AND lower(v_user_email) != lower(v_coupon.restricted_to_email) THEN
    RETURN jsonb_build_object('success', false, 'error', 'NOT_ELIGIBLE');
  END IF;

  IF v_coupon.first_time_only THEN
    IF EXISTS (SELECT 1 FROM subscriptions WHERE user_id = p_user_id AND plan = 'pro') THEN
      RETURN jsonb_build_object('success', false, 'error', 'NOT_FIRST_TIME');
    END IF;
  END IF;

  -- ── time_free coupons: grant Pro access directly ──────────────────────────
  IF v_coupon.discount_type IN ('months_free', 'days_free') THEN
    SELECT current_period_end INTO v_base
      FROM subscriptions
     WHERE user_id = p_user_id AND plan = 'pro' AND status = 'active'
       AND (current_period_end IS NULL OR current_period_end > now());

    v_period_end := CASE v_coupon.discount_type
      WHEN 'months_free' THEN
        coalesce(v_base, now()) + (v_coupon.discount_value || ' months')::interval
      WHEN 'days_free' THEN
        coalesce(v_base, now()) + (v_coupon.discount_value || ' days')::interval
    END;

    INSERT INTO subscriptions (user_id, plan, status, current_period_end)
    VALUES (p_user_id, 'pro', 'active', v_period_end)
    ON CONFLICT (user_id) DO UPDATE
      SET plan = 'pro', status = 'active', current_period_end = v_period_end, updated_at = now();

    INSERT INTO coupon_redemptions (coupon_id, user_id, user_email)
    VALUES (v_coupon.id, p_user_id, v_user_email);

    UPDATE coupons SET uses_count = uses_count + 1 WHERE id = v_coupon.id;

    RETURN jsonb_build_object(
      'success',        true,
      'grant_type',     'time',
      'discount_type',  v_coupon.discount_type,
      'value',          v_coupon.discount_value,
      'valid_until',    v_period_end
    );
  END IF;

  -- ── percent / fixed: validate only, record redemption, return discount info ─
  -- (actual payment goes through Stripe with the stripe_coupon_code)
  IF v_coupon.discount_type IN ('percent', 'fixed') THEN
    INSERT INTO coupon_redemptions (coupon_id, user_id, user_email)
    VALUES (v_coupon.id, p_user_id, v_user_email);

    UPDATE coupons SET uses_count = uses_count + 1 WHERE id = v_coupon.id;

    RETURN jsonb_build_object(
      'success',            true,
      'grant_type',         'discount',
      'discount_type',      v_coupon.discount_type,
      'value',              v_coupon.discount_value,
      'stripe_coupon_code', v_coupon.stripe_coupon_code
    );
  END IF;

  RETURN jsonb_build_object('success', false, 'error', 'INVALID_CODE');
END;
$$;
