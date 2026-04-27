-- E2EE (End-to-End Encryption) support for vouchers
-- Run in Supabase SQL editor

-- Add is_e2ee flag to vouchers table
ALTER TABLE vouchers
  ADD COLUMN IF NOT EXISTS is_e2ee boolean NOT NULL DEFAULT false;

-- Index for filtering encrypted vouchers
CREATE INDEX IF NOT EXISTS vouchers_e2ee_idx ON vouchers (user_id) WHERE is_e2ee = true;

-- NOTE: When is_e2ee = true, the `code` and `cvv` columns contain client-side
-- AES-GCM ciphertext in the format "e2ee:<iv_base64>:<ciphertext_base64>".
-- These fields are ALSO encrypted at rest by pgsodium (transparent column encryption).
-- This means two layers of encryption apply: pgsodium (server-side) + AES-GCM (client-side).
-- Only the client holding the vault passphrase can decrypt the inner layer.
