-- ============================================================================
-- Security hardening v6 — fixes a bug introduced by v5's length constraints
-- ============================================================================
-- Apply in the Supabase SQL Editor AFTER v5. Idempotent — safe to re-run.
--
-- THE BUG: v5 added `CHECK (char_length(cvv) <= 32)` to vouchers.cvv, sized for
-- a plaintext 3-4 digit CVV. But an E2EE-encrypted field looks like
-- "e2ee:<iv_base64>:<ciphertext_base64>" — even a 1-character plaintext CVV
-- encrypts to ~50 characters. Every encrypted CVV therefore violates the
-- constraint, so:
--   1. Saving a NEW voucher with a CVV while E2EE is on fails outright.
--   2. Postgres re-validates EVERY CHECK constraint on a row against its FULL
--      current contents on every UPDATE, not just the columns being changed —
--      NOT VALID only skips the initial bulk check when the constraint is
--      created, it does not exempt existing rows from future writes. So any
--      voucher that already had an over-limit value in ANY column (most
--      likely an encrypted cvv, since none of these fields had a client-side
--      length limit before v5) now fails on EVERY future update — including a
--      plain balance change from "use voucher" — with no indication why.
--
-- THE FIX: widen every v5 length check to a ceiling generous enough to never
-- collide with real data (nothing here has ever had a client-side cap), while
-- still bounding the abuse case v5 was written for (a client storing
-- megabytes in a single row). cvv specifically moves from 32 to 300 — the
-- same ceiling as notes/description fields, comfortably covering any
-- plaintext or encrypted value a real voucher could hold.
-- ============================================================================

CREATE OR REPLACE FUNCTION public._widen_len_check(p_table text, p_col text, p_max int)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE cname text := format('%s_%s_len_chk', p_table, p_col);
BEGIN
  EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT IF EXISTS %I', p_table, cname);
  EXECUTE format(
    'ALTER TABLE public.%I ADD CONSTRAINT %I CHECK (%I IS NULL OR char_length(%I) <= %s) NOT VALID',
    p_table, cname, p_col, p_col, p_max
  );
EXCEPTION WHEN undefined_table OR undefined_column THEN
  NULL;
END;
$$;

-- vouchers.cvv: the confirmed-broken one — 32 was never enough for an
-- encrypted value. 300 covers any realistic plaintext or ciphertext.
SELECT public._widen_len_check('vouchers', 'cvv', 300);

-- Everything else in v5 also had no client-side cap before today, so any of
-- them could in principle already hold an over-limit value from before this
-- migration existed. None of these needed to be tight in the first place —
-- v5's goal was bounding abuse (a client storing megabytes per row), not
-- tight validation — so they move to a ceiling that still serves that goal
-- without any realistic chance of rejecting real, already-saved data.
SELECT public._widen_len_check('vouchers', 'store_name', 300);
SELECT public._widen_len_check('vouchers', 'code', 500);
SELECT public._widen_len_check('vouchers', 'source', 300);
SELECT public._widen_len_check('vouchers', 'item_name', 300);
SELECT public._widen_len_check('vouchers', 'archive_reason', 500);
SELECT public._widen_len_check('vouchers', 'lock_reason', 500);
SELECT public._widen_len_check('profiles', 'name', 200);
SELECT public._widen_len_check('wallets', 'name', 200);
SELECT public._widen_len_check('stores', 'name', 300);
SELECT public._widen_len_check('categories', 'name', 150);
SELECT public._widen_len_check('super_vouchers', 'name', 300);
SELECT public._widen_len_check('marketplace_listings', 'description', 3000);

DROP FUNCTION IF EXISTS public._widen_len_check(text, text, int);

-- ── Reload PostgREST schema cache ─────────────────────────────────────────────
SELECT pg_notify('pgrst', 'reload schema');

-- ============================================================================
-- After applying, any voucher that was silently failing to save/update because
-- of this should work immediately — no data was lost, the writes were just
-- being rejected before they reached the table.
-- ============================================================================
