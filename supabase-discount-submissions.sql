-- =============================================
-- Discount Deal Submissions — Supabase Migration
-- =============================================

-- ============ TABLE ============
CREATE TABLE IF NOT EXISTS discount_deal_submissions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  user_email      TEXT,
  club_name       TEXT NOT NULL,
  business_name   TEXT NOT NULL,
  title           TEXT NOT NULL,
  description     TEXT,
  discount_type   TEXT NOT NULL DEFAULT 'percent'
                  CHECK (discount_type IN ('percent','fixed','free_item','other')),
  discount_value  NUMERIC,
  promo_code      TEXT,
  external_link   TEXT,
  tags            TEXT[] NOT NULL DEFAULT '{}',
  start_date      DATE,
  expiration_date DATE,
  status          TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','approved','rejected')),
  admin_notes     TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE discount_deal_submissions ENABLE ROW LEVEL SECURITY;

-- Users: insert own + read own
DROP POLICY IF EXISTS "user insert own submission" ON discount_deal_submissions;
CREATE POLICY "user insert own submission"
  ON discount_deal_submissions FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "user read own submissions" ON discount_deal_submissions;
CREATE POLICY "user read own submissions"
  ON discount_deal_submissions FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Trigger
CREATE OR REPLACE TRIGGER discount_submissions_updated_at
  BEFORE UPDATE ON discount_deal_submissions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE INDEX IF NOT EXISTS idx_deal_submissions_user   ON discount_deal_submissions(user_id);
CREATE INDEX IF NOT EXISTS idx_deal_submissions_status ON discount_deal_submissions(status);

-- ============ RPC: submit (any authenticated user) ============
CREATE OR REPLACE FUNCTION submit_discount_deal(
  p_club_name       TEXT,
  p_business_name   TEXT,
  p_title           TEXT,
  p_description     TEXT     DEFAULT NULL,
  p_discount_type   TEXT     DEFAULT 'percent',
  p_discount_value  NUMERIC  DEFAULT NULL,
  p_promo_code      TEXT     DEFAULT NULL,
  p_external_link   TEXT     DEFAULT NULL,
  p_tags            TEXT[]   DEFAULT '{}',
  p_start_date      DATE     DEFAULT NULL,
  p_expiration_date DATE     DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id    UUID := gen_random_uuid();
  v_email TEXT;
BEGIN
  SELECT email INTO v_email FROM auth.users WHERE id = auth.uid();
  INSERT INTO discount_deal_submissions(
    id, user_id, user_email,
    club_name, business_name, title, description,
    discount_type, discount_value, promo_code, external_link,
    tags, start_date, expiration_date
  ) VALUES (
    v_id, auth.uid(), v_email,
    p_club_name, p_business_name, p_title, p_description,
    p_discount_type, p_discount_value, p_promo_code, p_external_link,
    p_tags, p_start_date, p_expiration_date
  );
  RETURN v_id;
END;
$$;

-- ============ RPC: admin — get all submissions ============
CREATE OR REPLACE FUNCTION admin_get_submissions(p_status TEXT DEFAULT NULL)
RETURNS TABLE (
  id UUID, user_id UUID, user_email TEXT,
  club_name TEXT, business_name TEXT, title TEXT, description TEXT,
  discount_type TEXT, discount_value NUMERIC, promo_code TEXT, external_link TEXT,
  tags TEXT[], start_date DATE, expiration_date DATE,
  status TEXT, admin_notes TEXT, created_at TIMESTAMPTZ
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    id, user_id, user_email,
    club_name, business_name, title, description,
    discount_type, discount_value, promo_code, external_link,
    tags, start_date, expiration_date,
    status, admin_notes, created_at
  FROM discount_deal_submissions
  WHERE (p_status IS NULL OR status = p_status)
  ORDER BY
    CASE status WHEN 'pending' THEN 0 WHEN 'rejected' THEN 1 ELSE 2 END,
    created_at DESC;
$$;

-- ============ RPC: admin — approve (auto-match or create club+business then create deal) ============
CREATE OR REPLACE FUNCTION admin_approve_submission(
  p_id          UUID,
  p_club_id     UUID    DEFAULT NULL,
  p_business_id UUID    DEFAULT NULL,
  p_admin_notes TEXT    DEFAULT NULL
)
RETURNS UUID  -- returns the new deal id
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin   BOOLEAN;
  v_sub     discount_deal_submissions%ROWTYPE;
  v_club_id UUID;
  v_biz_id  UUID;
  v_deal_id UUID;
BEGIN
  SELECT is_admin INTO v_admin FROM profiles WHERE id = auth.uid();
  IF NOT COALESCE(v_admin, FALSE) THEN RAISE EXCEPTION 'not_admin'; END IF;

  SELECT * INTO v_sub FROM discount_deal_submissions WHERE id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'submission_not_found'; END IF;

  -- Resolve club: use provided id, else find by name, else create
  IF p_club_id IS NOT NULL THEN
    v_club_id := p_club_id;
  ELSE
    SELECT id INTO v_club_id FROM discount_clubs
    WHERE lower(trim(name)) = lower(trim(v_sub.club_name))
    LIMIT 1;
    IF v_club_id IS NULL THEN
      INSERT INTO discount_clubs(name, type)
      VALUES (v_sub.club_name, 'loyalty_club')
      RETURNING id INTO v_club_id;
    END IF;
  END IF;

  -- Resolve business: use provided id, else find by name, else create
  IF p_business_id IS NOT NULL THEN
    v_biz_id := p_business_id;
  ELSE
    SELECT id INTO v_biz_id FROM discount_businesses
    WHERE lower(trim(name)) = lower(trim(v_sub.business_name))
    LIMIT 1;
    IF v_biz_id IS NULL THEN
      INSERT INTO discount_businesses(name, tags)
      VALUES (v_sub.business_name, v_sub.tags)
      RETURNING id INTO v_biz_id;
    END IF;
  END IF;

  -- Create the deal
  v_deal_id := gen_random_uuid();
  INSERT INTO discount_deals(
    id, club_id, business_id, title, description,
    discount_type, discount_value, promo_code, external_link,
    tags, start_date, expiration_date, is_active
  ) VALUES (
    v_deal_id, v_club_id, v_biz_id, v_sub.title, v_sub.description,
    v_sub.discount_type, v_sub.discount_value, v_sub.promo_code, v_sub.external_link,
    v_sub.tags, v_sub.start_date, v_sub.expiration_date, TRUE
  );

  -- Mark approved
  UPDATE discount_deal_submissions
  SET status = 'approved', admin_notes = p_admin_notes, updated_at = NOW()
  WHERE id = p_id;

  RETURN v_deal_id;
END;
$$;

-- ============ RPC: admin — reject ============
CREATE OR REPLACE FUNCTION admin_reject_submission(
  p_id          UUID,
  p_admin_notes TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_admin BOOLEAN;
BEGIN
  SELECT is_admin INTO v_admin FROM profiles WHERE id = auth.uid();
  IF NOT COALESCE(v_admin, FALSE) THEN RAISE EXCEPTION 'not_admin'; END IF;
  UPDATE discount_deal_submissions
  SET status = 'rejected', admin_notes = p_admin_notes, updated_at = NOW()
  WHERE id = p_id;
END;
$$;

-- ============ RPC: admin — delete ============
CREATE OR REPLACE FUNCTION admin_delete_submission(p_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_admin BOOLEAN;
BEGIN
  SELECT is_admin INTO v_admin FROM profiles WHERE id = auth.uid();
  IF NOT COALESCE(v_admin, FALSE) THEN RAISE EXCEPTION 'not_admin'; END IF;
  DELETE FROM discount_deal_submissions WHERE id = p_id;
END;
$$;

-- ============ RPC: user — get own submissions ============
CREATE OR REPLACE FUNCTION get_my_submissions()
RETURNS TABLE (
  id UUID, club_name TEXT, business_name TEXT, title TEXT,
  status TEXT, admin_notes TEXT, created_at TIMESTAMPTZ
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id, club_name, business_name, title, status, admin_notes, created_at
  FROM discount_deal_submissions
  WHERE user_id = auth.uid()
  ORDER BY created_at DESC;
$$;

-- ============ RPC: admin — update submission before approving ============
CREATE OR REPLACE FUNCTION admin_update_submission(
  p_id              UUID,
  p_club_name       TEXT,
  p_business_name   TEXT,
  p_title           TEXT,
  p_description     TEXT     DEFAULT NULL,
  p_discount_type   TEXT     DEFAULT 'percent',
  p_discount_value  NUMERIC  DEFAULT NULL,
  p_promo_code      TEXT     DEFAULT NULL,
  p_external_link   TEXT     DEFAULT NULL,
  p_tags            TEXT[]   DEFAULT '{}',
  p_start_date      DATE     DEFAULT NULL,
  p_expiration_date DATE     DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_admin BOOLEAN;
BEGIN
  SELECT is_admin INTO v_admin FROM profiles WHERE id = auth.uid();
  IF NOT COALESCE(v_admin, FALSE) THEN RAISE EXCEPTION 'not_admin'; END IF;
  UPDATE discount_deal_submissions
  SET
    club_name       = p_club_name,
    business_name   = p_business_name,
    title           = p_title,
    description     = p_description,
    discount_type   = p_discount_type,
    discount_value  = p_discount_value,
    promo_code      = p_promo_code,
    external_link   = p_external_link,
    tags            = p_tags,
    start_date      = p_start_date,
    expiration_date = p_expiration_date,
    updated_at      = NOW()
  WHERE id = p_id;
END;
$$;
