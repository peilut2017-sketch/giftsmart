-- ── Fix: admin_get_reports was missing GRANT EXECUTE ─────────────────────────
-- Run this in Supabase SQL Editor if the reports tab shows an error.

-- Drop first so we can change the return type (id → report_id)
DROP FUNCTION IF EXISTS admin_get_reports();

CREATE OR REPLACE FUNCTION admin_get_reports()
RETURNS TABLE (
  report_id         UUID,
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
    ur.id             AS report_id,
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
