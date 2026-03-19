-- =============================================
-- Email via pg_net + Resend API (no Edge Function needed)
-- Run in Supabase SQL Editor:
--
-- STEP 1: Run this entire file
-- STEP 2: Insert your API key:
--   INSERT INTO app_settings (key, value) VALUES
--     ('resend_api_key', 're_YOUR_KEY_HERE'),
--     ('from_email',     'ארנק שוברים <onboarding@resend.dev>');
--
-- Get a free Resend key at https://resend.com (3000 emails/month free)
-- =============================================

-- Settings table (stores API keys — RLS blocks public access)
CREATE TABLE IF NOT EXISTS app_settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "No public access" ON app_settings;
CREATE POLICY "No public access" ON app_settings USING (false);

-- ── Low-level HTTP POST via pg_net ──────────────────────────────────────────

CREATE OR REPLACE FUNCTION send_email_http(
  p_to      TEXT,
  p_subject TEXT,
  p_html    TEXT
)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_api_key TEXT;
  v_from    TEXT;
  v_id      BIGINT;
BEGIN
  SELECT value INTO v_api_key FROM app_settings WHERE key = 'resend_api_key';
  SELECT value INTO v_from    FROM app_settings WHERE key = 'from_email';

  IF v_api_key IS NULL THEN
    RAISE EXCEPTION 'resend_api_key not configured — run the setup INSERT in supabase-send-email-setup.sql';
  END IF;

  v_from := COALESCE(v_from, 'ארנק שוברים <onboarding@resend.dev>');

  SELECT net.http_post(
    url     := 'https://api.resend.com/emails',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || v_api_key,
      'Content-Type',  'application/json'
    ),
    body    := jsonb_build_object(
      'from',    v_from,
      'to',      jsonb_build_array(p_to),
      'subject', p_subject,
      'html',    p_html
    )
  ) INTO v_id;

  RETURN v_id;
END;
$$;
GRANT EXECUTE ON FUNCTION send_email_http TO authenticated;

-- ── Expiry reminder ─────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION send_expiry_reminder_email(
  p_to_email      TEXT,
  p_to_name       TEXT,
  p_count         INTEGER,
  p_vouchers_list TEXT,
  p_app_url       TEXT DEFAULT ''
)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_html       TEXT;
  v_list_items TEXT;
  v_app_url    TEXT;
BEGIN
  v_app_url := CASE WHEN p_app_url = ''
    THEN (SELECT value FROM app_settings WHERE key = 'app_url')
    ELSE p_app_url END;
  v_app_url := COALESCE(v_app_url, 'https://localhost:5173');

  SELECT string_agg(
    '<li style="margin:6px 0">' || trim(replace(line, '• ', '')) || '</li>', ''
  ) INTO v_list_items
  FROM unnest(string_to_array(p_vouchers_list, E'\n')) AS line
  WHERE trim(line) <> '';

  v_html :=
    '<!DOCTYPE html><html dir="rtl" lang="he">'
    || '<body style="font-family:Arial,sans-serif;background:#f5f5f5;padding:20px">'
    || '<div style="max-width:480px;margin:0 auto;background:#fff;border-radius:16px;padding:32px;box-shadow:0 2px 8px rgba(0,0,0,.08)">'
    || '<h2 style="color:#d97706;margin-top:0">⏰ תזכורת: שוברים פגי תוקף</h2>'
    || '<p>שלום ' || p_to_name || ',</p>'
    || '<p>יש לך <strong>' || p_count || ' שוברים</strong> שעומדים לפוג בקרוב:</p>'
    || '<ul style="background:#fefce8;border-radius:12px;padding:16px 24px;color:#374151">'
    || COALESCE(v_list_items, '')
    || '</ul>'
    || '<p style="color:#6b7280;font-size:14px">מהר לפני שיפוג התוקף!</p>'
    || '<a href="' || v_app_url || '" style="display:inline-block;margin-top:16px;padding:12px 28px;background:#d97706;color:#fff;border-radius:12px;text-decoration:none;font-weight:bold">פתח ארנק שוברים</a>'
    || '</div></body></html>';

  RETURN send_email_http(
    p_to      := p_to_email,
    p_subject := '⏰ תזכורת: ' || p_count || ' שוברים עומדים לפוג בקרוב',
    p_html    := v_html
  );
END;
$$;
GRANT EXECUTE ON FUNCTION send_expiry_reminder_email TO authenticated;

-- ── Invite email ────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION send_invite_email(
  p_to_email    TEXT,
  p_to_name     TEXT,
  p_from_name   TEXT,
  p_wallet_name TEXT,
  p_app_url     TEXT DEFAULT ''
)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_html    TEXT;
  v_app_url TEXT;
BEGIN
  v_app_url := CASE WHEN p_app_url = ''
    THEN (SELECT value FROM app_settings WHERE key = 'app_url')
    ELSE p_app_url END;
  v_app_url := COALESCE(v_app_url, 'https://localhost:5173');

  v_html :=
    '<!DOCTYPE html><html dir="rtl" lang="he">'
    || '<body style="font-family:Arial,sans-serif;background:#f5f5f5;padding:20px">'
    || '<div style="max-width:480px;margin:0 auto;background:#fff;border-radius:16px;padding:32px;box-shadow:0 2px 8px rgba(0,0,0,.08)">'
    || '<h2 style="color:#16a34a;margin-top:0">🎁 הוזמנת לארנק שוברים</h2>'
    || '<p>שלום ' || p_to_name || ',</p>'
    || '<p><strong>' || p_from_name || '</strong> הזמין/ה אותך להצטרף לארנק <strong>"' || p_wallet_name || '"</strong>.</p>'
    || '<p>כעת תוכל/י לראות ולנהל שוברים משותפים.</p>'
    || '<a href="' || v_app_url || '" style="display:inline-block;margin-top:16px;padding:12px 28px;background:#16a34a;color:#fff;border-radius:12px;text-decoration:none;font-weight:bold">פתח ארנק שוברים</a>'
    || '</div></body></html>';

  RETURN send_email_http(
    p_to      := p_to_email,
    p_subject := p_from_name || ' הזמין/ה אותך לארנק: ' || p_wallet_name,
    p_html    := v_html
  );
END;
$$;
GRANT EXECUTE ON FUNCTION send_invite_email TO authenticated;
