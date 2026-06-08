-- Page view tracking for admin analytics.
-- Apply in: Supabase Dashboard → SQL Editor
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS page_views (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  page       TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS page_views_page_created ON page_views(page, created_at DESC);
CREATE INDEX IF NOT EXISTS page_views_created ON page_views(created_at DESC);

-- RLS: users can insert their own; only admins can read all
ALTER TABLE page_views ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_insert_own_page_views"
  ON page_views FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "admins_read_page_views"
  ON page_views FOR SELECT
  TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = TRUE));

-- RPC: lightweight insert (anon user_id allowed for non-auth pages)
CREATE OR REPLACE FUNCTION track_page_view(p_page TEXT)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO page_views(user_id, page)
  VALUES (auth.uid(), p_page);
EXCEPTION WHEN OTHERS THEN NULL; -- never fail the page load
END;
$$;
GRANT EXECUTE ON FUNCTION track_page_view(TEXT) TO authenticated;

-- RPC: admin summary grouped by page with time filter
CREATE OR REPLACE FUNCTION admin_get_page_views(
  p_from TIMESTAMPTZ DEFAULT (NOW() - INTERVAL '7 days'),
  p_to   TIMESTAMPTZ DEFAULT NOW()
)
RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = TRUE) THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  RETURN (
    SELECT json_agg(row_to_json(r) ORDER BY r.views DESC)
    FROM (
      SELECT
        page,
        COUNT(*)                                    AS views,
        COUNT(DISTINCT user_id)                     AS unique_users
      FROM page_views
      WHERE created_at BETWEEN p_from AND p_to
      GROUP BY page
    ) r
  );
END;
$$;
GRANT EXECUTE ON FUNCTION admin_get_page_views(TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated;

SELECT pg_notify('pgrst', 'reload schema');
