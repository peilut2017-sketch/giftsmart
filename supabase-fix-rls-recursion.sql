-- =============================================
-- FIX: infinite recursion in wallet_members RLS policy
-- Run this in Supabase SQL Editor
-- =============================================

-- 1. Create a SECURITY DEFINER function that reads wallet_members bypassing RLS.
--    This breaks the infinite-recursion loop.
CREATE OR REPLACE FUNCTION get_my_wallet_ids()
RETURNS SETOF UUID LANGUAGE SQL SECURITY DEFINER STABLE AS $$
  SELECT wallet_id FROM wallet_members WHERE user_id = auth.uid()
$$;

-- 2. Replace the self-referencing policy with one that uses the function.
DROP POLICY IF EXISTS "Members can view wallet memberships" ON wallet_members;
CREATE POLICY "Members can view wallet memberships"
  ON wallet_members FOR SELECT
  USING (user_id = auth.uid() OR wallet_id IN (SELECT get_my_wallet_ids()));
