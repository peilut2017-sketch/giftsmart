-- ─── Admin Telegram Notifications ─────────────────────────────────────────────
--
-- Sends Telegram messages to all linked admin accounts when key events occur.
-- Requires the pg_net extension (enabled by default on Supabase).
--
-- ONE-TIME SETUP (run once in Supabase SQL Editor):
--   ALTER DATABASE postgres SET app.telegram_bot_token = 'YOUR_BOT_TOKEN';
--   SELECT pg_reload_conf(); -- applies immediately without restart
--
-- ─────────────────────────────────────────────────────────────────────────────


-- ── Shared helper: send message to all admin Telegram accounts ────────────────

CREATE OR REPLACE FUNCTION notify_admin_telegram(message text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_token  text;
  v_chat   RECORD;
BEGIN
  v_token := current_setting('app.telegram_bot_token', true);
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
END;
$$;


-- ── 1. New user registration ──────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION _tg_admin_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  PERFORM notify_admin_telegram(
    '👤 <b>משתמש חדש נרשם</b>' || E'\n\n' ||
    '📧 ' || COALESCE(NEW.email, '—') || E'\n' ||
    '👋 ' || COALESCE(NEW.name,  '—') || E'\n' ||
    '🕐 ' || to_char(now() AT TIME ZONE 'Asia/Jerusalem', 'DD/MM/YYYY HH24:MI')
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_admin_new_user ON profiles;
CREATE TRIGGER trg_admin_new_user
  AFTER INSERT ON profiles
  FOR EACH ROW EXECUTE FUNCTION _tg_admin_new_user();


-- ── 2. New marketplace listing ────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION _tg_admin_new_listing()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_store   text;
  v_email   text;
BEGIN
  SELECT v.store_name, p.email
    INTO v_store, v_email
    FROM vouchers v
    JOIN profiles p ON p.id = NEW.seller_id
   WHERE v.id = NEW.voucher_id;

  PERFORM notify_admin_telegram(
    '🏪 <b>שובר חדש למכירה</b>' || E'\n\n' ||
    '🎁 ' || COALESCE(v_store, '—')              || E'\n' ||
    '💰 ₪' || NEW.asking_price::text              || E'\n' ||
    '👤 '  || COALESCE(v_email, '—')              || E'\n' ||
    CASE WHEN NEW.description IS NOT NULL AND NEW.description <> ''
         THEN '📝 ' || left(NEW.description, 80)  || E'\n'
         ELSE '' END ||
    '🕐 ' || to_char(now() AT TIME ZONE 'Asia/Jerusalem', 'DD/MM/YYYY HH24:MI')
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_admin_new_listing ON marketplace_listings;
CREATE TRIGGER trg_admin_new_listing
  AFTER INSERT ON marketplace_listings
  FOR EACH ROW EXECUTE FUNCTION _tg_admin_new_listing();


-- ── 3. New support / report message ──────────────────────────────────────────

CREATE OR REPLACE FUNCTION _tg_admin_new_support()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_cat_label text;
BEGIN
  v_cat_label := CASE NEW.category
    WHEN 'billing' THEN '💳 חיוב'
    WHEN 'bug'     THEN '🐛 באג'
    WHEN 'feature' THEN '✨ פיצ'||chr(39)||'ר'
    WHEN 'report'  THEN '🚩 דיווח'
    ELSE                '📋 כללי'
  END;

  PERFORM notify_admin_telegram(
    '📩 <b>הודעת תמיכה חדשה</b>' || E'\n\n' ||
    '👤 ' || COALESCE(NEW.user_email, NEW.user_name, '—') || E'\n' ||
    '🏷 '  || v_cat_label                                  || E'\n' ||
    '📌 '  || COALESCE(NEW.subject, '—')                   || E'\n' ||
    '💬 '  || left(COALESCE(NEW.body, ''), 120)            || E'\n' ||
    '🕐 '  || to_char(now() AT TIME ZONE 'Asia/Jerusalem', 'DD/MM/YYYY HH24:MI')
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_admin_new_support ON support_messages;
CREATE TRIGGER trg_admin_new_support
  AFTER INSERT ON support_messages
  FOR EACH ROW EXECUTE FUNCTION _tg_admin_new_support();


-- ── 4. User deal suggestions ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS user_deal_suggestions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  store_name   text NOT NULL,
  description  text NOT NULL,
  promo_code   text,
  status       text NOT NULL DEFAULT 'pending',  -- pending | approved | rejected
  created_at   timestamptz DEFAULT now()
);

ALTER TABLE user_deal_suggestions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can insert own suggestions"
  ON user_deal_suggestions FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can view own suggestions"
  ON user_deal_suggestions FOR SELECT
  USING (user_id = auth.uid());

-- RPC: submit deal suggestion
CREATE OR REPLACE FUNCTION submit_deal_suggestion(
  p_store_name  text,
  p_description text,
  p_promo_code  text DEFAULT NULL
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF length(trim(p_store_name))  < 2 THEN RAISE EXCEPTION 'store_name too short';  END IF;
  IF length(trim(p_description)) < 5 THEN RAISE EXCEPTION 'description too short'; END IF;

  INSERT INTO user_deal_suggestions (user_id, store_name, description, promo_code)
  VALUES (auth.uid(), trim(p_store_name), trim(p_description), nullif(trim(coalesce(p_promo_code,'')), ''));
END;
$$;

CREATE OR REPLACE FUNCTION _tg_admin_new_deal_suggestion()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_email text;
BEGIN
  SELECT email INTO v_email FROM profiles WHERE id = NEW.user_id;

  PERFORM notify_admin_telegram(
    '💡 <b>הצעת הטבה חדשה ממשתמש</b>' || E'\n\n' ||
    '🏪 ' || NEW.store_name                                              || E'\n' ||
    '📝 ' || left(NEW.description, 100)                                  || E'\n' ||
    CASE WHEN NEW.promo_code IS NOT NULL
         THEN '🎟 קוד: <code>' || NEW.promo_code || '</code>' || E'\n'
         ELSE '' END ||
    '👤 ' || COALESCE(v_email, '—')                                      || E'\n' ||
    '🕐 ' || to_char(now() AT TIME ZONE 'Asia/Jerusalem', 'DD/MM/YYYY HH24:MI')
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_admin_new_deal_suggestion ON user_deal_suggestions;
CREATE TRIGGER trg_admin_new_deal_suggestion
  AFTER INSERT ON user_deal_suggestions
  FOR EACH ROW EXECUTE FUNCTION _tg_admin_new_deal_suggestion();
