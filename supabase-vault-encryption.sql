-- =============================================
-- Supabase Vault — Transparent Column Encryption
-- Encrypts: vouchers.code, vouchers.cvv
--
-- HOW TO RUN:
--   1. Go to Supabase Dashboard → SQL Editor
--   2. Paste and run the entire file
--   3. Existing rows are encrypted automatically
--   4. The app reads from the `decrypted_vouchers` view
--
-- HOW IT WORKS:
--   pgsodium (built into Supabase) applies AES-256-GCM
--   encryption at the Postgres level using SECURITY LABEL.
--   A `decrypted_vouchers` view is created automatically
--   that decrypts code/cvv transparently on every read.
--   The raw `vouchers` table stores only ciphertext.
-- =============================================

-- 1. Create a symmetric encryption key (stored securely in pgsodium.key)
--    Skip if you already have a key — check: SELECT id FROM pgsodium.valid_key WHERE name = 'voucher_field_key';
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pgsodium.valid_key WHERE name = 'voucher_field_key') THEN
    PERFORM pgsodium.create_key(
      'aead-det',               -- algorithm: deterministic AEAD (AES-256-GCM, searchable)
      'voucher_field_key',      -- human-readable name
      NULL,                     -- raw key (NULL = auto-generate)
      NULL,                     -- parent key id
      'Voucher code/cvv encryption key'
    );
  END IF;
END
$$;

-- 2. Add the columns required by pgsodium transparent encryption
ALTER TABLE vouchers
  ADD COLUMN IF NOT EXISTS encryption_key_id UUID,
  ADD COLUMN IF NOT EXISTS _code_nonce       BYTEA,
  ADD COLUMN IF NOT EXISTS _cvv_nonce        BYTEA;

-- 3. Backfill the key id for all existing rows
UPDATE vouchers
SET encryption_key_id = (
  SELECT id FROM pgsodium.valid_key WHERE name = 'voucher_field_key' LIMIT 1
)
WHERE encryption_key_id IS NULL;

-- 4. Set the key as the default for new rows
ALTER TABLE vouchers
  ALTER COLUMN encryption_key_id
  SET DEFAULT (SELECT id FROM pgsodium.valid_key WHERE name = 'voucher_field_key' LIMIT 1);

-- 5. Apply transparent encryption to sensitive columns.
--    pgsodium automatically creates/replaces the `decrypted_vouchers` view
--    and sets up INSTEAD OF INSERT/UPDATE triggers so the app can
--    read and write through the view using plaintext values.
SECURITY LABEL FOR pgsodium ON COLUMN vouchers.code
  IS 'ENCRYPT WITH KEY COLUMN encryption_key_id ASSOCIATED (id, wallet_id) NONCE _code_nonce';

SECURITY LABEL FOR pgsodium ON COLUMN vouchers.cvv
  IS 'ENCRYPT WITH KEY COLUMN encryption_key_id ASSOCIATED (id, wallet_id) NONCE _cvv_nonce';

-- 6. Grant the anon/authenticated roles access to the decrypted view
--    (the view inherits RLS from the underlying `vouchers` table)
GRANT SELECT, INSERT, UPDATE ON decrypted_vouchers TO anon, authenticated;

-- 7. Re-encrypt existing rows by updating them through the view.
--    This writes ciphertext back to the underlying table.
--    The view's INSTEAD OF UPDATE trigger will encrypt each value.
UPDATE decrypted_vouchers SET code = code, cvv = cvv;

-- 8. Reload PostgREST schema cache
SELECT pg_notify('pgrst', 'reload schema');

-- =============================================
-- VERIFICATION
-- After running, verify encryption is working:
--
--   -- This should return PLAINTEXT (via the view):
--   SELECT id, code, cvv FROM decrypted_vouchers LIMIT 3;
--
--   -- This should return CIPHERTEXT (raw table, code is bytea/encrypted):
--   SELECT id, code FROM vouchers LIMIT 3;
-- =============================================
