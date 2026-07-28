-- Repairs admin_upsert_deal / submit_discount_deal.
--
-- Background: supabase-deal-image.sql was meant to add a p_image_url parameter to both
-- functions, but it used CREATE OR REPLACE — which only replaces a function with an
-- identical argument list. Adding a parameter therefore creates a SECOND overload
-- rather than replacing the original. On this database that file appears to have only
-- partially taken effect: submit_discount_deal ended up with the image parameter (user
-- submissions with images work), while admin_upsert_deal did not — so the frontend,
-- which always sends p_image_url, had no matching function and PostgREST returned
-- PGRST202 ("Could not find the function ... in the schema cache").
--
-- An earlier revision of this file only DROPped the stale signatures, which removed the
-- 13-argument admin_upsert_deal without creating the 14-argument replacement. This
-- version drops every known overload and then recreates both functions in their correct
-- final form, so it fixes the database regardless of which state it is currently in.
--
-- Idempotent: safe to run repeatedly.

-- ── 0. Columns the functions below depend on ────────────────────────────────────
ALTER TABLE discount_deals            ADD COLUMN IF NOT EXISTS image_url TEXT;
ALTER TABLE discount_deal_submissions ADD COLUMN IF NOT EXISTS image_url TEXT;

-- ── 1. Remove every known overload so exactly one of each remains afterwards ────
DROP FUNCTION IF EXISTS admin_upsert_deal(
  UUID, UUID, UUID, TEXT, TEXT, TEXT, NUMERIC, TEXT, TEXT, TEXT[], DATE, DATE, BOOLEAN
);
DROP FUNCTION IF EXISTS admin_upsert_deal(
  UUID, UUID, UUID, TEXT, TEXT, TEXT, NUMERIC, TEXT, TEXT, TEXT[], DATE, DATE, BOOLEAN, TEXT
);
DROP FUNCTION IF EXISTS submit_discount_deal(
  TEXT, TEXT, TEXT, TEXT, TEXT, NUMERIC, TEXT, TEXT, TEXT[], DATE, DATE
);
DROP FUNCTION IF EXISTS submit_discount_deal(
  TEXT, TEXT, TEXT, TEXT, TEXT, NUMERIC, TEXT, TEXT, TEXT[], DATE, DATE, TEXT
);

-- ── 2. Admin: create/update a live deal ─────────────────────────────────────────
CREATE FUNCTION admin_upsert_deal(
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
    COALESCE(p_tags, '{}'), p_start_date, p_expiration_date, p_is_active, p_image_url
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

GRANT EXECUTE ON FUNCTION admin_upsert_deal(
  UUID, UUID, UUID, TEXT, TEXT, TEXT, NUMERIC, TEXT, TEXT, TEXT[], DATE, DATE, BOOLEAN, TEXT
) TO authenticated;

-- ── 3. User: submit a deal for moderation ───────────────────────────────────────
CREATE FUNCTION submit_discount_deal(
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

GRANT EXECUTE ON FUNCTION submit_discount_deal(
  TEXT, TEXT, TEXT, TEXT, TEXT, NUMERIC, TEXT, TEXT, TEXT[], DATE, DATE, TEXT
) TO authenticated;

-- ── 4. Force PostgREST to pick the new definitions up immediately ───────────────
SELECT pg_notify('pgrst', 'reload schema');

-- ── 5. Verify: each name should return exactly ONE row ──────────────────────────
--
--   SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args
--   FROM pg_proc p
--   JOIN pg_namespace n ON n.oid = p.pronamespace
--   WHERE n.nspname = 'public'
--     AND p.proname IN ('admin_upsert_deal', 'submit_discount_deal')
--   ORDER BY p.proname;
