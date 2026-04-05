-- Migration: add source column to vouchers
-- Run in Supabase Dashboard → SQL Editor

ALTER TABLE vouchers ADD COLUMN IF NOT EXISTS source TEXT;
