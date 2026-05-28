-- Returns pending/unread counts for the admin inbox banner.
-- Designed for cheap on-load fetch: single row, no joins.
--
-- Run once in: Supabase Dashboard → SQL Editor
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION admin_get_inbox_counts()
RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = TRUE) THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  RETURN json_build_object(
    'support_unread',
      (SELECT COUNT(*) FROM support_messages  WHERE status = 'unread'),
    'reports_pending',
      (SELECT COUNT(*) FROM user_reports      WHERE status = 'pending'),
    'submissions_pending',
      (SELECT COUNT(*) FROM discount_deal_submissions WHERE status = 'pending')
  );
END;
$$;
GRANT EXECUTE ON FUNCTION admin_get_inbox_counts() TO authenticated;

SELECT pg_notify('pgrst', 'reload schema');
