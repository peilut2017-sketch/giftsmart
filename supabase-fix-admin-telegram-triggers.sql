-- Fix 1: Admin Telegram notification for discount deal submissions
--   submit_discount_deal() inserts into discount_deal_submissions —
--   the existing trigger was on user_deal_suggestions (different table).
--
-- Fix 2: Admin Telegram notification when a user replies to a support thread
--   user_reply_message() inserts into support_message_replies with sender='user' —
--   no trigger existed for this.

-- ── 1. Discount deal submission ──────────────────────────────────────────────

CREATE OR REPLACE FUNCTION _tg_admin_new_deal_submission()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM notify_admin_telegram(
    '🎁 <b>הגשת הנחה חדשה ממשתמש</b>'              || E'\n\n' ||
    '🏪 ' || NEW.business_name                        || E'\n' ||
    '🏷 מועדון: ' || NEW.club_name                    || E'\n' ||
    '📌 ' || NEW.title                                || E'\n' ||
    CASE WHEN NEW.discount_type = 'percent' AND NEW.discount_value IS NOT NULL
         THEN '💰 ' || NEW.discount_value::text || '%' || E'\n'
         WHEN NEW.discount_type = 'fixed' AND NEW.discount_value IS NOT NULL
         THEN '💰 ₪' || NEW.discount_value::text || E'\n'
         ELSE '' END ||
    CASE WHEN NEW.promo_code IS NOT NULL
         THEN '🎟 קוד: <code>' || NEW.promo_code || '</code>' || E'\n'
         ELSE '' END ||
    CASE WHEN NEW.user_email IS NOT NULL
         THEN '👤 ' || NEW.user_email || E'\n'
         ELSE '' END ||
    '🕐 ' || to_char(now() AT TIME ZONE 'Asia/Jerusalem', 'DD/MM/YYYY HH24:MI')
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_admin_new_deal_submission ON discount_deal_submissions;
CREATE TRIGGER trg_admin_new_deal_submission
  AFTER INSERT ON discount_deal_submissions
  FOR EACH ROW EXECUTE FUNCTION _tg_admin_new_deal_submission();


-- ── 2. User reply to support thread ─────────────────────────────────────────

CREATE OR REPLACE FUNCTION _tg_admin_user_support_reply()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_subject   text;
  v_user_email text;
BEGIN
  -- Only notify on user replies, not admin replies
  IF NEW.sender <> 'user' THEN RETURN NEW; END IF;

  SELECT sm.subject, sm.user_email
    INTO v_subject, v_user_email
    FROM support_messages sm
   WHERE sm.id = NEW.message_id;

  PERFORM notify_admin_telegram(
    '💬 <b>תשובה חדשה מהמשתמש</b>'                         || E'\n\n' ||
    '📌 נושא: ' || COALESCE(v_subject, '—')                  || E'\n' ||
    '👤 ' || COALESCE(v_user_email, '—')                     || E'\n' ||
    '💬 ' || left(COALESCE(NEW.body, ''), 120)               || E'\n' ||
    '🕐 ' || to_char(now() AT TIME ZONE 'Asia/Jerusalem', 'DD/MM/YYYY HH24:MI')
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_admin_user_support_reply ON support_message_replies;
CREATE TRIGGER trg_admin_user_support_reply
  AFTER INSERT ON support_message_replies
  FOR EACH ROW EXECUTE FUNCTION _tg_admin_user_support_reply();


SELECT pg_notify('pgrst', 'reload schema');
