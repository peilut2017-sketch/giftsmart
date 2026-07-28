-- Recent deals for the Home page "הנחות אחרונות" widget and the Notifications
-- page's "new discounts in your clubs" section (which needs created_at to place
-- each deal correctly in the merged chronological feed).
-- Same shape as get_my_deals() but ordered strictly by newest-created, since
-- get_my_deals() ranks by is_my_club/discount_value first (best-match ordering),
-- which isn't "recency".

-- DROP first: Postgres won't let CREATE OR REPLACE change a RETURNS TABLE's
-- column list in place (adding created_at below).
DROP FUNCTION IF EXISTS get_recent_deals(INT);

CREATE FUNCTION get_recent_deals(
  p_limit INT DEFAULT 3
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
  is_upcoming      BOOLEAN,
  created_at       TIMESTAMPTZ
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
    (d.start_date > CURRENT_DATE)      AS is_upcoming,
    d.created_at
  FROM discount_deals d
  JOIN discount_clubs      cl ON cl.id = d.club_id
  JOIN discount_businesses b  ON b.id  = d.business_id
  LEFT JOIN user_clubs     uc ON uc.club_id = d.club_id
                              AND uc.user_id = auth.uid()
  WHERE d.is_active = TRUE
    AND (d.expiration_date IS NULL OR d.expiration_date >= CURRENT_DATE)
  ORDER BY d.created_at DESC
  LIMIT p_limit;
$$;
