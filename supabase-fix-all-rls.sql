-- =============================================
-- FIX: Replace ALL direct wallet_members subqueries with get_my_wallet_ids()
-- Run this in Supabase SQL Editor
-- =============================================

-- Step 1: Ensure the SECURITY DEFINER function exists
CREATE OR REPLACE FUNCTION get_my_wallet_ids()
RETURNS SETOF UUID LANGUAGE SQL SECURITY DEFINER STABLE AS $$
  SELECT wallet_id FROM wallet_members WHERE user_id = auth.uid()
$$;

-- Step 2: Fix wallet_members self-referencing policy
DROP POLICY IF EXISTS "Members can view wallet memberships" ON wallet_members;
CREATE POLICY "Members can view wallet memberships"
  ON wallet_members FOR SELECT
  USING (user_id = auth.uid() OR wallet_id IN (SELECT get_my_wallet_ids()));

-- Step 3: Fix super_vouchers policies
DROP POLICY IF EXISTS "Wallet members can view super vouchers" ON super_vouchers;
CREATE POLICY "Wallet members can view super vouchers"
  ON super_vouchers FOR SELECT
  USING (wallet_id IN (SELECT get_my_wallet_ids()));

-- Step 4: Fix categories policies
DROP POLICY IF EXISTS "Wallet members can read categories" ON categories;
CREATE POLICY "Wallet members can read categories"
  ON categories FOR SELECT
  USING (wallet_id IS NULL OR wallet_id IN (SELECT get_my_wallet_ids()));

DROP POLICY IF EXISTS "Wallet members can insert categories" ON categories;
CREATE POLICY "Wallet members can insert categories"
  ON categories FOR INSERT
  WITH CHECK (wallet_id IN (SELECT get_my_wallet_ids()));

-- Step 5: Fix vouchers policies
DROP POLICY IF EXISTS "Wallet members can view vouchers" ON vouchers;
CREATE POLICY "Wallet members can view vouchers"
  ON vouchers FOR SELECT
  USING (wallet_id IN (SELECT get_my_wallet_ids()));

DROP POLICY IF EXISTS "Wallet members can insert vouchers" ON vouchers;
CREATE POLICY "Wallet members can insert vouchers"
  ON vouchers FOR INSERT
  WITH CHECK (wallet_id IN (SELECT get_my_wallet_ids()));

DROP POLICY IF EXISTS "Wallet members can update vouchers" ON vouchers;
CREATE POLICY "Wallet members can update vouchers"
  ON vouchers FOR UPDATE
  USING (wallet_id IN (SELECT get_my_wallet_ids()));
