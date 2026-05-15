-- ─────────────────────────────────────────────────────────────────────────────
-- Fix user registration failures
--
-- PROBLEM:
--   1. _tg_admin_new_user trigger on profiles calls notify_admin_telegram(),
--      which queries app_settings. If app_settings doesn't exist (or pg_net
--      is unavailable), the trigger raises an exception that rolls back the
--      entire auth.users INSERT — blocking ALL new registrations (email + OAuth).
--
--   2. handle_new_user() stored only the email prefix as name; the frontend
--      now passes name via raw_user_meta_data so we read it here.
--
-- HOW TO RUN:
--   Supabase Dashboard → SQL Editor → paste and run
-- ─────────────────────────────────────────────────────────────────────────────


-- ── 1. Fix handle_new_user: use name from auth metadata when available ────────
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO profiles (id, email, name)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(
      NULLIF(TRIM(NEW.raw_user_meta_data->>'name'), ''),
      split_part(NEW.email, '@', 1)
    )
  );
  RETURN NEW;
END;
$$;


-- ── 2. Fix notify_admin_telegram: wrap in EXCEPTION so it never blocks callers
CREATE OR REPLACE FUNCTION notify_admin_telegram(message text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_token  text;
  v_chat   RECORD;
BEGIN
  BEGIN
    SELECT value INTO v_token FROM app_settings WHERE key = 'telegram_bot_token';
    IF v_token IS NULL OR v_token = '' THEN RETURN; END IF;

    FOR v_chat IN
      SELECT tu.chat_id
      FROM   telegram_users tu
      JOIN   profiles p ON p.id = tu.user_id
      WHERE  p.is_admin = true
    LOOP
      PERFORM net.http_post(
        url     := 'https://api.telegram.org/bot' || v_token || '/sendMessage',
        headers := '{"Content-Type": "application/json"}'::jsonb,
        body    := jsonb_build_object(
                     'chat_id',    v_chat.chat_id,
                     'text',       message,
                     'parse_mode', 'HTML'
                   )::text
      );
    END LOOP;
  EXCEPTION WHEN OTHERS THEN
    -- Telegram notifications are best-effort; never propagate errors to callers
    NULL;
  END;
END;
$$;


-- ── 3. Reload PostgREST schema cache ──────────────────────────────────────────
SELECT pg_notify('pgrst', 'reload schema');
