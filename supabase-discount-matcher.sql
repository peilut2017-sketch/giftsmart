-- =============================================
-- Smart Discount Matcher — Supabase Migration
-- =============================================

-- ============ A. CLUBS (כרטיסי אשראי ומועדוני לקוחות) ============
CREATE TABLE IF NOT EXISTS discount_clubs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL UNIQUE,
  logo_url    TEXT,
  type        TEXT NOT NULL CHECK (type IN ('credit_card', 'loyalty_club')),
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE discount_clubs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "public read discount_clubs" ON discount_clubs;
CREATE POLICY "public read discount_clubs"
  ON discount_clubs FOR SELECT
  USING (TRUE);

-- ============ B. BUSINESSES (עסקים) ============
CREATE TABLE IF NOT EXISTS discount_businesses (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  logo_url    TEXT,
  website     TEXT,
  tags        TEXT[] NOT NULL DEFAULT '{}',
  store_id    UUID REFERENCES stores(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE discount_businesses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "public read discount_businesses" ON discount_businesses;
CREATE POLICY "public read discount_businesses"
  ON discount_businesses FOR SELECT
  USING (TRUE);

-- ============ C. DEALS (עסקאות הנחה) ============
CREATE TABLE IF NOT EXISTS discount_deals (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id         UUID NOT NULL REFERENCES discount_clubs(id) ON DELETE CASCADE,
  business_id     UUID NOT NULL REFERENCES discount_businesses(id) ON DELETE CASCADE,
  title           TEXT NOT NULL,
  description     TEXT,
  discount_type   TEXT NOT NULL CHECK (discount_type IN ('percent', 'fixed', 'free_item', 'other')),
  discount_value  NUMERIC,
  promo_code      TEXT,
  external_link   TEXT,
  tags            TEXT[] NOT NULL DEFAULT '{}',
  start_date      DATE,
  expiration_date DATE,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE discount_deals ENABLE ROW LEVEL SECURITY;

-- Public read: only active, non-expired deals
DROP POLICY IF EXISTS "public read active discount_deals" ON discount_deals;
CREATE POLICY "public read active discount_deals"
  ON discount_deals FOR SELECT
  USING (
    is_active = TRUE
    AND (expiration_date IS NULL OR expiration_date >= CURRENT_DATE)
  );

-- ============ D. USER_CLUBS (מועדוני המשתמש) ============
CREATE TABLE IF NOT EXISTS user_clubs (
  user_id   UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  club_id   UUID NOT NULL REFERENCES discount_clubs(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, club_id)
);

ALTER TABLE user_clubs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user manages own clubs" ON user_clubs;
CREATE POLICY "user manages own clubs"
  ON user_clubs FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ============ INDEXES ============
CREATE INDEX IF NOT EXISTS idx_discount_deals_club_id
  ON discount_deals(club_id);

CREATE INDEX IF NOT EXISTS idx_discount_deals_business_id
  ON discount_deals(business_id);

CREATE INDEX IF NOT EXISTS idx_discount_deals_expiry
  ON discount_deals(expiration_date)
  WHERE expiration_date IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_discount_deals_active
  ON discount_deals(is_active);

CREATE INDEX IF NOT EXISTS idx_user_clubs_user_id
  ON user_clubs(user_id);

CREATE INDEX IF NOT EXISTS idx_discount_businesses_tags
  ON discount_businesses USING gin(tags);

CREATE INDEX IF NOT EXISTS idx_discount_deals_tags
  ON discount_deals USING gin(tags);

-- ============ UPDATED_AT TRIGGER ============
CREATE OR REPLACE TRIGGER discount_deals_updated_at
  BEFORE UPDATE ON discount_deals
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============ E. RPC: שמירת מועדוני המשתמש ============
CREATE OR REPLACE FUNCTION set_user_clubs(p_club_ids UUID[])
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM user_clubs WHERE user_id = auth.uid();
  IF array_length(p_club_ids, 1) > 0 THEN
    INSERT INTO user_clubs(user_id, club_id)
    SELECT auth.uid(), unnest(p_club_ids);
  END IF;
END;
$$;

-- ============ F. RPC: שליפת עסקאות מותאמות אישית ============
CREATE OR REPLACE FUNCTION get_my_deals(
  p_search    TEXT    DEFAULT NULL,
  p_tags      TEXT[]  DEFAULT NULL,
  p_limit     INT     DEFAULT 50,
  p_offset    INT     DEFAULT 0
)
RETURNS TABLE (
  deal_id          UUID,
  club_id          UUID,
  club_name        TEXT,
  club_logo        TEXT,
  business_id      UUID,
  business_name    TEXT,
  business_logo    TEXT,
  business_website TEXT,
  business_tags    TEXT[],
  title            TEXT,
  description      TEXT,
  discount_type    TEXT,
  discount_value   NUMERIC,
  promo_code       TEXT,
  external_link    TEXT,
  tags             TEXT[],
  start_date       DATE,
  expiration_date  DATE,
  is_my_club       BOOLEAN,
  is_upcoming      BOOLEAN
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    d.id                               AS deal_id,
    d.club_id,
    cl.name                            AS club_name,
    cl.logo_url                        AS club_logo,
    b.id                               AS business_id,
    b.name                             AS business_name,
    b.logo_url                         AS business_logo,
    b.website                          AS business_website,
    b.tags                             AS business_tags,
    d.title,
    d.description,
    d.discount_type,
    d.discount_value,
    d.promo_code,
    d.external_link,
    d.tags,
    d.start_date,
    d.expiration_date,
    (uc.user_id IS NOT NULL)           AS is_my_club,
    (d.start_date > CURRENT_DATE)      AS is_upcoming
  FROM discount_deals d
  JOIN discount_clubs      cl ON cl.id = d.club_id
  JOIN discount_businesses b  ON b.id  = d.business_id
  LEFT JOIN user_clubs     uc ON uc.club_id = d.club_id
                              AND uc.user_id = auth.uid()
  WHERE d.is_active = TRUE
    AND (d.expiration_date IS NULL OR d.expiration_date >= CURRENT_DATE)
    AND (
      p_search IS NULL
      OR b.name ILIKE '%' || p_search || '%'
      OR d.title ILIKE '%' || p_search || '%'
    )
    AND (
      p_tags IS NULL
      OR d.tags && p_tags
      OR b.tags && p_tags
    )
  ORDER BY
    (uc.user_id IS NOT NULL) DESC,
    d.discount_value DESC NULLS LAST,
    d.created_at DESC
  LIMIT p_limit
  OFFSET p_offset;
$$;

-- ============ G. RPC: Admin — CRUD מועדונים ============
CREATE OR REPLACE FUNCTION admin_upsert_club(
  p_id         UUID    DEFAULT NULL,
  p_name       TEXT    DEFAULT NULL,
  p_logo_url   TEXT    DEFAULT NULL,
  p_type       TEXT    DEFAULT 'loyalty_club',
  p_is_active  BOOLEAN DEFAULT TRUE
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin BOOLEAN;
  v_id    UUID;
BEGIN
  SELECT is_admin INTO v_admin FROM profiles WHERE id = auth.uid();
  IF NOT COALESCE(v_admin, FALSE) THEN
    RAISE EXCEPTION 'not_admin';
  END IF;

  v_id := COALESCE(p_id, gen_random_uuid());

  INSERT INTO discount_clubs(id, name, logo_url, type, is_active)
  VALUES (v_id, p_name, p_logo_url, p_type, p_is_active)
  ON CONFLICT (id) DO UPDATE SET
    name       = EXCLUDED.name,
    logo_url   = EXCLUDED.logo_url,
    type       = EXCLUDED.type,
    is_active  = EXCLUDED.is_active;

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION admin_delete_club(p_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_admin BOOLEAN;
BEGIN
  SELECT is_admin INTO v_admin FROM profiles WHERE id = auth.uid();
  IF NOT COALESCE(v_admin, FALSE) THEN RAISE EXCEPTION 'not_admin'; END IF;
  DELETE FROM discount_clubs WHERE id = p_id;
END;
$$;

-- ============ H. RPC: Admin — CRUD עסקים ============
CREATE OR REPLACE FUNCTION admin_upsert_business(
  p_id        UUID     DEFAULT NULL,
  p_name      TEXT     DEFAULT NULL,
  p_logo_url  TEXT     DEFAULT NULL,
  p_website   TEXT     DEFAULT NULL,
  p_tags      TEXT[]   DEFAULT '{}',
  p_store_id  UUID     DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin BOOLEAN;
  v_id    UUID;
BEGIN
  SELECT is_admin INTO v_admin FROM profiles WHERE id = auth.uid();
  IF NOT COALESCE(v_admin, FALSE) THEN RAISE EXCEPTION 'not_admin'; END IF;

  v_id := COALESCE(p_id, gen_random_uuid());

  INSERT INTO discount_businesses(id, name, logo_url, website, tags, store_id)
  VALUES (v_id, p_name, p_logo_url, p_website, p_tags, p_store_id)
  ON CONFLICT (id) DO UPDATE SET
    name      = EXCLUDED.name,
    logo_url  = EXCLUDED.logo_url,
    website   = EXCLUDED.website,
    tags      = EXCLUDED.tags,
    store_id  = EXCLUDED.store_id;

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION admin_delete_business(p_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_admin BOOLEAN;
BEGIN
  SELECT is_admin INTO v_admin FROM profiles WHERE id = auth.uid();
  IF NOT COALESCE(v_admin, FALSE) THEN RAISE EXCEPTION 'not_admin'; END IF;
  DELETE FROM discount_businesses WHERE id = p_id;
END;
$$;

-- ============ I. RPC: Admin — CRUD עסקאות ============
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
  p_is_active       BOOLEAN   DEFAULT TRUE
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
    tags, start_date, expiration_date, is_active
  ) VALUES (
    v_id, p_club_id, p_business_id, p_title, p_description,
    p_discount_type, p_discount_value, p_promo_code, p_external_link,
    p_tags, p_start_date, p_expiration_date, p_is_active
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
    updated_at      = NOW();

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION admin_delete_deal(p_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_admin BOOLEAN;
BEGIN
  SELECT is_admin INTO v_admin FROM profiles WHERE id = auth.uid();
  IF NOT COALESCE(v_admin, FALSE) THEN RAISE EXCEPTION 'not_admin'; END IF;
  DELETE FROM discount_deals WHERE id = p_id;
END;
$$;

-- ============ J. RPC: Admin — שליפת כל הנתונים לניהול ============
CREATE OR REPLACE FUNCTION admin_get_all_clubs()
RETURNS TABLE (
  id UUID, name TEXT, logo_url TEXT, type TEXT, is_active BOOLEAN, created_at TIMESTAMPTZ
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT c.id, c.name, c.logo_url, c.type, c.is_active, c.created_at
  FROM discount_clubs c
  ORDER BY c.type, c.name;
$$;

CREATE OR REPLACE FUNCTION admin_get_all_businesses()
RETURNS TABLE (
  id UUID, name TEXT, logo_url TEXT, website TEXT, tags TEXT[], store_id UUID, created_at TIMESTAMPTZ
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT b.id, b.name, b.logo_url, b.website, b.tags, b.store_id, b.created_at
  FROM discount_businesses b
  ORDER BY b.name;
$$;

CREATE OR REPLACE FUNCTION admin_get_all_deals()
RETURNS TABLE (
  id UUID, club_id UUID, club_name TEXT, business_id UUID, business_name TEXT,
  title TEXT, description TEXT, discount_type TEXT, discount_value NUMERIC,
  promo_code TEXT, external_link TEXT, tags TEXT[],
  start_date DATE, expiration_date DATE, is_active BOOLEAN, created_at TIMESTAMPTZ
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    d.id, d.club_id, cl.name, d.business_id, b.name,
    d.title, d.description, d.discount_type, d.discount_value,
    d.promo_code, d.external_link, d.tags,
    d.start_date, d.expiration_date, d.is_active, d.created_at
  FROM discount_deals d
  JOIN discount_clubs      cl ON cl.id = d.club_id
  JOIN discount_businesses b  ON b.id  = d.business_id
  ORDER BY d.created_at DESC;
$$;

-- ============ K. SEED DATA — מועדונים ישראליים נפוצים ============
INSERT INTO discount_clubs (name, type) VALUES
  ('ויזה כאל',            'credit_card'),
  ('מסטרקארד לאומי',       'credit_card'),
  ('אמריקן אקספרס',        'credit_card'),
  ('ויזה ישראכרט',         'credit_card'),
  ('דיינרס',               'credit_card'),
  ('מועדון BuyMe',         'loyalty_club'),
  ('מועדון תל אביב',       'loyalty_club'),
  ('כללית מושלם',          'loyalty_club'),
  ('מועדון YES',           'loyalty_club'),
  ('מועדון פרטנר',         'loyalty_club'),
  ('הוט מובייל',           'loyalty_club'),
  ('מועדון סטימצקי',       'loyalty_club')
ON CONFLICT (name) DO NOTHING;
