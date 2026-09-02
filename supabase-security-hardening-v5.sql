-- ============================================================================
-- Security hardening v5 — abuse / cost protection + input bounds
-- ============================================================================
-- Apply in the Supabase SQL Editor. Idempotent. Every step is guarded so a
-- missing table/column on your instance is skipped instead of aborting the run.
--
--   1. ocr_scan_log — backs the per-user rate limit in the analyze-voucher edge
--      function. Each AI scan is a paid Gemini call, and any signed-in account
--      (guests included) could loop the endpoint; the function now caps scans
--      per user per hour (and fails open if this table is absent).
--   2. Length bounds on user-supplied TEXT columns. They were unbounded, so a
--      single client could store megabytes per row (DB bloat + egress on every
--      fetch — the same quota this project was just restricted on). Added as
--      NOT VALID so existing rows never block the migration; only new/updated
--      rows are checked.
-- ============================================================================

-- ── 1. OCR scan log (rate-limit backing store) ────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ocr_scan_log (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id    UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- RPC/service-role only: RLS on, no policies → clients can't read or write it.
ALTER TABLE public.ocr_scan_log ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS ocr_scan_log_user_time_idx ON public.ocr_scan_log (user_id, created_at DESC);


-- ── 2. Input length bounds ───────────────────────────────────────────────────
-- Helper: add a CHECK (char_length(col) <= n) NOT VALID, skipping silently when
-- the table/column is missing or the constraint already exists.
CREATE OR REPLACE FUNCTION public._add_len_check(p_table text, p_col text, p_max int)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE cname text := format('%s_%s_len_chk', p_table, p_col);
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = cname) THEN
    EXECUTE format(
      'ALTER TABLE public.%I ADD CONSTRAINT %I CHECK (%I IS NULL OR char_length(%I) <= %s) NOT VALID',
      p_table, cname, p_col, p_col, p_max
    );
  END IF;
EXCEPTION WHEN undefined_table OR undefined_column THEN
  NULL;
END;
$$;

-- vouchers
SELECT public._add_len_check('vouchers', 'store_name', 120);
SELECT public._add_len_check('vouchers', 'code',       200);
SELECT public._add_len_check('vouchers', 'cvv',        32);
SELECT public._add_len_check('vouchers', 'notes',      2000);
SELECT public._add_len_check('vouchers', 'link',       500);
SELECT public._add_len_check('vouchers', 'source',     200);
SELECT public._add_len_check('vouchers', 'item_name',  200);
SELECT public._add_len_check('vouchers', 'archive_reason', 300);
SELECT public._add_len_check('vouchers', 'lock_reason', 300);
-- profiles / wallets / stores / categories
SELECT public._add_len_check('profiles',   'name',  100);
SELECT public._add_len_check('wallets',    'name',  100);
SELECT public._add_len_check('stores',     'name',  120);
SELECT public._add_len_check('categories', 'name',  60);
-- super vouchers
SELECT public._add_len_check('super_vouchers', 'name',        120);
SELECT public._add_len_check('super_vouchers', 'description', 1000);
-- messaging / support (user-written free text)
SELECT public._add_len_check('marketplace_messages',    'body',    2000);
SELECT public._add_len_check('support_messages',        'subject', 200);
SELECT public._add_len_check('support_messages',        'message', 5000);
SELECT public._add_len_check('support_message_replies', 'body',    5000);
SELECT public._add_len_check('marketplace_listings',    'description', 1000);
SELECT public._add_len_check('voucher_gifts',           'message', 1000);
SELECT public._add_len_check('discount_deal_submissions','description', 2000);
SELECT public._add_len_check('discount_deal_submissions','title', 200);

DROP FUNCTION IF EXISTS public._add_len_check(text, text, int);


-- ── Reload PostgREST schema cache ─────────────────────────────────────────────
SELECT pg_notify('pgrst', 'reload schema');

-- ============================================================================
-- DASHBOARD SETTINGS TO VERIFY (cannot be set from SQL):
--   Storage → buckets `banners` and `discount-images`:
--     • set a file size limit (e.g. 5 MB) and allowed MIME types (image/*)
--   Authentication → Settings:
--     • minimum password length 8+ with letters+digits (the app enforces 8)
--     • enable email confirmations, secure password change
--     • enable a CAPTCHA (Turnstile/hCaptcha) on sign-up/sign-in
--     • keep Anonymous sign-in rate limit modest (default 30/h/IP)
-- ============================================================================
