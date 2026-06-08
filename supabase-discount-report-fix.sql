-- Fix: reported_user_id was NOT NULL but deal reports have no reported user.
-- Make it nullable so discount reports can be submitted without a target user.
--
-- Run in: Supabase Dashboard → SQL Editor
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE user_reports
  ALTER COLUMN reported_user_id DROP NOT NULL;

-- Recreate submit_deal_report (no change needed, but run to confirm it's there)
CREATE OR REPLACE FUNCTION submit_deal_report(
  p_deal_id UUID,
  p_reason  TEXT,
  p_details TEXT DEFAULT NULL
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO user_reports (reporter_id, deal_id, reason, details, source, status)
  VALUES (auth.uid(), p_deal_id, p_reason, p_details, 'discount', 'pending');
END;
$$;
GRANT EXECUTE ON FUNCTION submit_deal_report(UUID, TEXT, TEXT) TO authenticated;

SELECT pg_notify('pgrst', 'reload schema');
