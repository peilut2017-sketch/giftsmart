-- Add balance_check_url column to super_vouchers table
-- Run this once in Supabase SQL editor

ALTER TABLE super_vouchers
  ADD COLUMN IF NOT EXISTS balance_check_url TEXT;
