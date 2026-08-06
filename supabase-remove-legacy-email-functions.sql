-- Cleanup: remove the legacy SQL email implementation (Resend / pg_net).
--
-- These six functions were a second, divergent copy of the email templates the
-- app actually sends through the send-email Edge Function (SES/Gmail). Nothing
-- calls them — not the frontend, not any trigger — and unlike the Edge Function
-- they never HTML-escaped their inputs and fell back to a localhost link.
-- Run in Supabase Dashboard → SQL Editor.

DROP FUNCTION IF EXISTS send_wallet_invite_to_new_user(text, text, text);
DROP FUNCTION IF EXISTS send_voucher_share_invite_email(text, text, text);
DROP FUNCTION IF EXISTS send_voucher_shared_email(text, text, text, text);
DROP FUNCTION IF EXISTS send_invite_email(text, text, text, text);
DROP FUNCTION IF EXISTS send_expiry_reminder_email(text, text, int, text);
DROP FUNCTION IF EXISTS send_email_http(text, text, text);

SELECT pg_notify('pgrst', 'reload schema');
