-- Fix: notify_admin_telegram was passing body as ::text instead of jsonb,
-- causing a silent type-mismatch error swallowed by the EXCEPTION block.
-- net.http_post expects body as jsonb (same as send_email_http uses).

CREATE OR REPLACE FUNCTION notify_admin_telegram(message text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
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
        headers := jsonb_build_object('Content-Type', 'application/json'),
        body    := jsonb_build_object(        -- ← was wrongly cast ::text before
                     'chat_id',    v_chat.chat_id,
                     'text',       message,
                     'parse_mode', 'HTML'
                   )
      );
    END LOOP;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
END;
$$;

-- Quick smoke-test: prints the admin chat_ids and token preview
-- Run this separately to verify configuration before testing:
--
-- SELECT
--   p.email,
--   p.is_admin,
--   tu.chat_id,
--   left((SELECT value FROM app_settings WHERE key='telegram_bot_token'), 12) || '...' AS token_preview
-- FROM profiles p
-- LEFT JOIN telegram_users tu ON tu.user_id = p.id
-- WHERE p.is_admin = true;

SELECT pg_notify('pgrst', 'reload schema');
