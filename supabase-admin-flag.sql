-- Migration: replace email-based admin check with is_admin flag on profiles
-- Run this once in Supabase Dashboard → SQL Editor

-- 1. Add the column (safe to run multiple times)
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT FALSE;

-- 2. Grant admin to your account
--    Replace the email below with your actual admin email if different.
UPDATE profiles
  SET is_admin = TRUE
  WHERE email ILIKE 'nv0556778810@gmail.com';

-- 3. (Optional) Also cover OAuth users whose email lives in auth.users but not profiles
UPDATE profiles
  SET is_admin = TRUE
  WHERE id IN (
    SELECT id FROM auth.users WHERE email ILIKE 'nv0556778810@gmail.com'
  );

-- Done. The frontend now reads profile.is_admin — no email in client code.
