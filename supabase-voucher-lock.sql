-- Migration: Add lock fields to vouchers table
-- Allows users to lock a voucher to prevent accidental use at checkout

ALTER TABLE vouchers
  ADD COLUMN IF NOT EXISTS is_locked BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS lock_reason TEXT;

-- Index for filtering locked vouchers (optional, for performance)
CREATE INDEX IF NOT EXISTS vouchers_is_locked_idx ON vouchers (is_locked) WHERE is_locked = TRUE;
