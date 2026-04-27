-- Allow E2EE vouchers to be shared with decrypted code stored only in the token record.
-- The main vouchers table keeps its encrypted ciphertext; only this ephemeral token row
-- holds the plaintext, and it is deleted when the share link is revoked.
ALTER TABLE shared_voucher_tokens
  ADD COLUMN IF NOT EXISTS code_override TEXT;
