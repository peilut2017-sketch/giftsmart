-- Adds image_url support to discount deals and submissions.
-- Apply in: Supabase Dashboard → SQL Editor
-- Also create a storage bucket named 'discount-images' (public read) in Storage settings.
-- ─────────────────────────────────────────────────────────────────────────────

-- Add image_url column to discount_deals
ALTER TABLE discount_deals
  ADD COLUMN IF NOT EXISTS image_url TEXT;

-- Add image_url column to discount_deal_submissions
ALTER TABLE discount_deal_submissions
  ADD COLUMN IF NOT EXISTS image_url TEXT;

-- Update the view/function that surfaces deals to include image_url
-- (re-creating get_discount_deals to include the new field)
CREATE OR REPLACE FUNCTION get_discount_deals(
  p_search        TEXT    DEFAULT NULL,
  p_tags          TEXT[]  DEFAULT NULL,
  p_my_clubs_only BOOLEAN DEFAULT FALSE,
  p_limit         INT     DEFAULT 100,
  p_offset        INT     DEFAULT 0
)
RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_result  JSON;
BEGIN
  SELECT json_agg(row_to_json(r)) INTO v_result
  FROM (
    SELECT
      dd.id                AS deal_id,
      dc.id                AS club_id,
      dc.name              AS club_name,
      dc.logo_url          AS club_logo,
      db.id                AS business_id,
      db.name              AS business_name,
      db.logo_url          AS business_logo,
      db.website           AS business_website,
      COALESCE(db.tags, '{}') AS business_tags,
      dd.title,
      dd.description,
      dd.discount_type,
      dd.discount_value,
      dd.promo_code,
      dd.external_link,
      COALESCE(dd.tags, '{}') AS tags,
      dd.start_date,
      dd.expiration_date,
      dd.image_url,
      dd.view_count,
      CASE WHEN dd.start_date > NOW() THEN TRUE ELSE FALSE END AS is_upcoming,
      EXISTS (
        SELECT 1 FROM user_clubs uc
        WHERE uc.user_id = v_user_id AND uc.club_id = dc.id
      ) AS is_my_club,
      EXISTS (
        SELECT 1 FROM deal_likes dl
        WHERE dl.user_id = v_user_id AND dl.deal_id = dd.id
      ) AS is_liked
    FROM discount_deals dd
    JOIN discount_clubs dc ON dc.id = dd.club_id
    JOIN discount_businesses db ON db.id = dd.business_id
    WHERE dd.is_active = TRUE
      AND (dd.expiration_date IS NULL OR dd.expiration_date >= CURRENT_DATE)
      AND (p_search IS NULL OR
           dd.title ILIKE '%' || p_search || '%' OR
           db.name  ILIKE '%' || p_search || '%')
      AND (p_tags IS NULL OR dd.tags && p_tags OR db.tags && p_tags)
      AND (NOT p_my_clubs_only OR EXISTS (
        SELECT 1 FROM user_clubs uc2
        WHERE uc2.user_id = v_user_id AND uc2.club_id = dc.id
      ))
    ORDER BY is_my_club DESC, dd.created_at DESC
    LIMIT p_limit OFFSET p_offset
  ) r;
  RETURN COALESCE(v_result, '[]'::json);
END;
$$;

-- Update submit_discount_deal to accept optional image_url
CREATE OR REPLACE FUNCTION submit_discount_deal(
  p_club_name       TEXT,
  p_business_name   TEXT,
  p_title           TEXT,
  p_description     TEXT    DEFAULT NULL,
  p_discount_type   TEXT    DEFAULT 'other',
  p_discount_value  NUMERIC DEFAULT NULL,
  p_promo_code      TEXT    DEFAULT NULL,
  p_external_link   TEXT    DEFAULT NULL,
  p_tags            TEXT[]  DEFAULT '{}',
  p_start_date      DATE    DEFAULT NULL,
  p_expiration_date DATE    DEFAULT NULL,
  p_image_url       TEXT    DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_id      UUID;
BEGIN
  INSERT INTO discount_deal_submissions (
    user_id, club_name, business_name, title, description,
    discount_type, discount_value, promo_code, external_link,
    tags, start_date, expiration_date, image_url, status
  ) VALUES (
    v_user_id, p_club_name, p_business_name, p_title, p_description,
    p_discount_type, p_discount_value, p_promo_code, p_external_link,
    COALESCE(p_tags, '{}'), p_start_date, p_expiration_date, p_image_url, 'pending'
  ) RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

-- Update admin_upsert_deal to accept optional image_url
CREATE OR REPLACE FUNCTION admin_upsert_deal(
  p_id              UUID      DEFAULT NULL,
  p_club_id         UUID      DEFAULT NULL,
  p_business_id     UUID      DEFAULT NULL,
  p_title           TEXT      DEFAULT NULL,
  p_description     TEXT      DEFAULT NULL,
  p_discount_type   TEXT      DEFAULT 'percent',
  p_discount_value  NUMERIC   DEFAULT NULL,
  p_promo_code      TEXT      DEFAULT NULL,
  p_external_link   TEXT      DEFAULT NULL,
  p_tags            TEXT[]    DEFAULT '{}',
  p_start_date      DATE      DEFAULT NULL,
  p_expiration_date DATE      DEFAULT NULL,
  p_is_active       BOOLEAN   DEFAULT TRUE,
  p_image_url       TEXT      DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_admin BOOLEAN;
  v_id    UUID;
BEGIN
  SELECT is_admin INTO v_admin FROM profiles WHERE id = auth.uid();
  IF NOT COALESCE(v_admin, FALSE) THEN RAISE EXCEPTION 'not_admin'; END IF;

  v_id := COALESCE(p_id, gen_random_uuid());

  INSERT INTO discount_deals(
    id, club_id, business_id, title, description,
    discount_type, discount_value, promo_code, external_link,
    tags, start_date, expiration_date, is_active, image_url
  ) VALUES (
    v_id, p_club_id, p_business_id, p_title, p_description,
    p_discount_type, p_discount_value, p_promo_code, p_external_link,
    p_tags, p_start_date, p_expiration_date, p_is_active, p_image_url
  )
  ON CONFLICT (id) DO UPDATE SET
    club_id         = EXCLUDED.club_id,
    business_id     = EXCLUDED.business_id,
    title           = EXCLUDED.title,
    description     = EXCLUDED.description,
    discount_type   = EXCLUDED.discount_type,
    discount_value  = EXCLUDED.discount_value,
    promo_code      = EXCLUDED.promo_code,
    external_link   = EXCLUDED.external_link,
    tags            = EXCLUDED.tags,
    start_date      = EXCLUDED.start_date,
    expiration_date = EXCLUDED.expiration_date,
    is_active       = EXCLUDED.is_active,
    image_url       = EXCLUDED.image_url,
    updated_at      = NOW();

  RETURN v_id;
END;
$$;
GRANT EXECUTE ON FUNCTION admin_upsert_deal(UUID,UUID,UUID,TEXT,TEXT,TEXT,NUMERIC,TEXT,TEXT,TEXT[],DATE,DATE,BOOLEAN,TEXT) TO authenticated;

SELECT pg_notify('pgrst', 'reload schema');
