-- =============================================
-- Add is_global column to super_vouchers
-- Run this in Supabase SQL Editor
-- =============================================

-- 1. Add the column
ALTER TABLE super_vouchers
  ADD COLUMN IF NOT EXISTS is_global BOOLEAN DEFAULT FALSE;

-- 2. Allow all authenticated users to read global super vouchers
DROP POLICY IF EXISTS "Anyone can view global super vouchers" ON super_vouchers;
CREATE POLICY "Anyone can view global super vouchers"
  ON super_vouchers FOR SELECT
  TO authenticated
  USING (is_global = true);
