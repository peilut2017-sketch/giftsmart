-- Allow users to report discount deals (wrong info, expired, etc.)
-- Reuses the existing user_reports table with two new columns:
--   deal_id UUID  — references discount_deals
--   source  TEXT  — 'marketplace' (default) or 'discount'
--
-- Run once in: Supabase Dashboard → SQL Editor
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Extend user_reports ────────────────────────────────────────────────────
ALTER TABLE user_reports
  ADD COLUMN IF NOT EXISTS deal_id UUID REFERENCES discount_deals(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source  TEXT NOT NULL DEFAULT 'marketplace';

-- Back-fill existing rows
UPDATE user_reports SET source = 'marketplace' WHERE source IS NULL OR source = '';

-- ── 2. RPC: submit a deal report ─────────────────────────────────────────────
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

-- ── 3. Update admin_get_reports to expose deal_id + source ───────────────────
DROP FUNCTION IF EXISTS admin_get_reports();

CREATE OR REPLACE FUNCTION admin_get_reports()
RETURNS TABLE (
  report_id      UUID,
  reporter_email TEXT,
  reported_email TEXT,
  reason         TEXT,
  details        TEXT,
  status         TEXT,
  created_at     TIMESTAMPTZ,
  purchase_id    UUID,
  listing_id     UUID,
  deal_id        UUID,
  source         TEXT
)
LANGUAGE plpgsql SECURITY DEFINER STABLE AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = TRUE) THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;
  RETURN QUERY
  SELECT
    ur.id                                        AS report_id,
    COALESCE(rp.email, '(משתמש נמחק)')          AS reporter_email,
    COALESCE(rd.email, '(לא רלוונטי)')          AS reported_email,
    ur.reason,
    ur.details,
    ur.status,
    ur.created_at,
    ur.purchase_id,
    ur.listing_id,
    ur.deal_id,
    COALESCE(ur.source, 'marketplace')           AS source
  FROM user_reports ur
  LEFT JOIN profiles rp ON rp.id = ur.reporter_id
  LEFT JOIN profiles rd ON rd.id = ur.reported_user_id
  ORDER BY ur.created_at DESC;
END;
$$;
GRANT EXECUTE ON FUNCTION admin_get_reports TO authenticated;

-- ── 4. Update Telegram trigger to handle discount reports ────────────────────
CREATE OR REPLACE FUNCTION _tg_admin_new_report()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_reporter_email text;
  v_reported_email text;
  v_deal_title     text;
  v_msg            text;
BEGIN
  SELECT email INTO v_reporter_email FROM profiles WHERE id = NEW.reporter_id;

  IF NEW.source = 'discount' AND NEW.deal_id IS NOT NULL THEN
    SELECT title INTO v_deal_title FROM discount_deals WHERE id = NEW.deal_id;
    v_msg :=
      '🏷 <b>דיווח על הנחה</b>' || E'\n\n' ||
      '📣 מדווח: '   || COALESCE(v_reporter_email, '—')  || E'\n' ||
      '🎁 הנחה: '    || COALESCE(v_deal_title, NEW.deal_id::text) || E'\n' ||
      '📌 סיבה: '    || COALESCE(NEW.reason, '—')         || E'\n' ||
      CASE WHEN NEW.details IS NOT NULL AND NEW.details <> ''
           THEN '💬 ' || left(NEW.details, 120)           || E'\n'
           ELSE '' END ||
      '🕐 ' || to_char(now() AT TIME ZONE 'Asia/Jerusalem', 'DD/MM/YYYY HH24:MI');
  ELSE
    SELECT email INTO v_reported_email FROM profiles WHERE id = NEW.reported_user_id;
    v_msg :=
      '🚩 <b>דיווח חדש על משתמש</b>' || E'\n\n' ||
      '📣 מדווח: '    || COALESCE(v_reporter_email, '—')  || E'\n' ||
      '🎯 מדווח על: ' || COALESCE(v_reported_email, '—') || E'\n' ||
      '📌 סיבה: '    || COALESCE(NEW.reason, '—')         || E'\n' ||
      CASE WHEN NEW.details IS NOT NULL AND NEW.details <> ''
           THEN '💬 ' || left(NEW.details, 100)           || E'\n'
           ELSE '' END ||
      '🕐 ' || to_char(now() AT TIME ZONE 'Asia/Jerusalem', 'DD/MM/YYYY HH24:MI');
  END IF;

  PERFORM notify_admin_telegram(v_msg);
  RETURN NEW;
END;
$$;

-- Reload PostgREST schema cache
SELECT pg_notify('pgrst', 'reload schema');
