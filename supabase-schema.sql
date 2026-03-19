-- =============================================
-- Voucher Wallet App — Supabase Schema
-- =============================================

-- ============ DROP ALL POLICIES FIRST ============
DROP POLICY IF EXISTS "Users can read own profile" ON profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON profiles;
DROP POLICY IF EXISTS "Users can insert own profile" ON profiles;
DROP POLICY IF EXISTS "Wallet owners can manage" ON wallets;
DROP POLICY IF EXISTS "Members can view wallet memberships" ON wallet_members;
DROP POLICY IF EXISTS "Owners can manage members" ON wallet_members;
DROP POLICY IF EXISTS "Users can join wallets" ON wallet_members;
DROP POLICY IF EXISTS "Anyone can read stores" ON stores;
DROP POLICY IF EXISTS "Authenticated can insert stores" ON stores;
DROP POLICY IF EXISTS "Wallet members can view super vouchers" ON super_vouchers;
DROP POLICY IF EXISTS "Wallet owners can manage super vouchers" ON super_vouchers;
DROP POLICY IF EXISTS "Wallet members can read categories" ON categories;
DROP POLICY IF EXISTS "Wallet members can insert categories" ON categories;
DROP POLICY IF EXISTS "Wallet members can view vouchers" ON vouchers;
DROP POLICY IF EXISTS "Wallet members can insert vouchers" ON vouchers;
DROP POLICY IF EXISTS "Wallet members can update vouchers" ON vouchers;
DROP POLICY IF EXISTS "Voucher owner can delete" ON vouchers;

-- ============ PROFILES ============
CREATE TABLE IF NOT EXISTS profiles (
  id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  email TEXT NOT NULL,
  name TEXT,
  phone TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own profile"
  ON profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users can update own profile"
  ON profiles FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "Users can insert own profile"
  ON profiles FOR INSERT WITH CHECK (auth.uid() = id);

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO profiles (id, email, name)
  VALUES (NEW.id, NEW.email, split_part(NEW.email, '@', 1));
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- ============ WALLETS ============
CREATE TABLE IF NOT EXISTS wallets (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL DEFAULT 'ארנק שוברים',
  owner_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE wallets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Wallet owners can manage"
  ON wallets FOR ALL USING (auth.uid() = owner_id);

-- ============ WALLET MEMBERS ============
CREATE TABLE IF NOT EXISTS wallet_members (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  wallet_id UUID REFERENCES wallets(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  email TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'member')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(wallet_id, user_id)
);

ALTER TABLE wallet_members ENABLE ROW LEVEL SECURITY;

-- Security-definer helper: returns wallet IDs for the current user without triggering RLS
CREATE OR REPLACE FUNCTION get_my_wallet_ids()
RETURNS SETOF UUID LANGUAGE SQL SECURITY DEFINER STABLE AS $$
  SELECT wallet_id FROM wallet_members WHERE user_id = auth.uid()
$$;

CREATE POLICY "Members can view wallet memberships"
  ON wallet_members FOR SELECT
  USING (user_id = auth.uid() OR wallet_id IN (SELECT get_my_wallet_ids()));

CREATE POLICY "Owners can manage members"
  ON wallet_members FOR ALL
  USING (wallet_id IN (SELECT id FROM wallets WHERE owner_id = auth.uid()));

CREATE POLICY "Users can join wallets"
  ON wallet_members FOR INSERT
  WITH CHECK (user_id = auth.uid());

-- ============ STORES ============
CREATE TABLE IF NOT EXISTS stores (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  logo_url TEXT,
  website TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE stores ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read stores"
  ON stores FOR SELECT TO authenticated USING (TRUE);
CREATE POLICY "Authenticated can insert stores"
  ON stores FOR INSERT TO authenticated WITH CHECK (TRUE);

-- ============ SUPER VOUCHERS ============
CREATE TABLE IF NOT EXISTS super_vouchers (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  wallet_id UUID REFERENCES wallets(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  stores TEXT[] DEFAULT '{}',
  logo_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE super_vouchers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Wallet members can view super vouchers"
  ON super_vouchers FOR SELECT
  USING (wallet_id IN (SELECT get_my_wallet_ids()));

CREATE POLICY "Wallet owners can manage super vouchers"
  ON super_vouchers FOR ALL
  USING (wallet_id IN (SELECT id FROM wallets WHERE owner_id = auth.uid()));

-- ============ CATEGORIES ============
CREATE TABLE IF NOT EXISTS categories (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  emoji TEXT DEFAULT '🏷️',
  wallet_id UUID REFERENCES wallets(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Wallet members can read categories"
  ON categories FOR SELECT
  USING (wallet_id IS NULL OR wallet_id IN (SELECT get_my_wallet_ids()));

CREATE POLICY "Wallet members can insert categories"
  ON categories FOR INSERT
  WITH CHECK (wallet_id IN (SELECT get_my_wallet_ids()));

-- ============ VOUCHERS ============
CREATE TABLE IF NOT EXISTS vouchers (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  wallet_id UUID REFERENCES wallets(id) ON DELETE CASCADE NOT NULL,
  super_voucher_id UUID REFERENCES super_vouchers(id) ON DELETE SET NULL,
  store_name TEXT NOT NULL,
  store_id UUID REFERENCES stores(id) ON DELETE SET NULL,
  amount DECIMAL(10,2) NOT NULL DEFAULT 0,
  balance DECIMAL(10,2) NOT NULL DEFAULT 0,
  code TEXT NOT NULL,
  cvv TEXT,
  expiry_date DATE,
  categories TEXT[] DEFAULT '{}',
  tags TEXT[] DEFAULT '{}',
  notes TEXT,
  link TEXT,
  is_archived BOOLEAN DEFAULT FALSE,
  is_shared BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE vouchers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Wallet members can view vouchers"
  ON vouchers FOR SELECT
  USING (wallet_id IN (SELECT get_my_wallet_ids()));

CREATE POLICY "Wallet members can insert vouchers"
  ON vouchers FOR INSERT
  WITH CHECK (wallet_id IN (SELECT get_my_wallet_ids()));

CREATE POLICY "Wallet members can update vouchers"
  ON vouchers FOR UPDATE
  USING (wallet_id IN (SELECT get_my_wallet_ids()));

CREATE POLICY "Voucher owner can delete"
  ON vouchers FOR DELETE
  USING (user_id = auth.uid() OR wallet_id IN (
    SELECT id FROM wallets WHERE owner_id = auth.uid()
  ));

-- Update timestamp trigger
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER vouchers_updated_at
  BEFORE UPDATE ON vouchers
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Realtime already enabled for vouchers and wallet_members

-- ============ SHARED VOUCHER TOKENS ============
CREATE TABLE IF NOT EXISTS shared_voucher_tokens (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  token TEXT NOT NULL UNIQUE,
  voucher_id UUID REFERENCES vouchers(id) ON DELETE CASCADE NOT NULL,
  created_by UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  expires_at TIMESTAMPTZ,
  view_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE shared_voucher_tokens ENABLE ROW LEVEL SECURITY;

-- Owner can manage their shared tokens
CREATE POLICY "Owner can manage shared tokens"
  ON shared_voucher_tokens FOR ALL
  USING (created_by = auth.uid());

-- Anyone can read shared tokens (for public voucher view)
CREATE POLICY "Anyone can read shared tokens"
  ON shared_voucher_tokens FOR SELECT
  USING (TRUE);

-- ============ MIGRATIONS ============
-- Add link column if not exists (run on existing databases)
ALTER TABLE vouchers ADD COLUMN IF NOT EXISTS link TEXT;

-- ============ ACTIVITY LOG ============
CREATE TABLE IF NOT EXISTS activity_log (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  wallet_id UUID REFERENCES wallets(id) ON DELETE SET NULL,
  action TEXT NOT NULL, -- 'add' | 'edit' | 'balance_update' | 'archive' | 'unarchive' | 'delete'
  voucher_id UUID,
  voucher_name TEXT NOT NULL,
  details JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS activity_log_user_idx ON activity_log(user_id, created_at DESC);

ALTER TABLE activity_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage own activity log" ON activity_log;
CREATE POLICY "Users can manage own activity log"
  ON activity_log FOR ALL
  USING (user_id = auth.uid());

-- Add voucher_snapshot column to shared_voucher_tokens (run on existing databases)
ALTER TABLE shared_voucher_tokens ADD COLUMN IF NOT EXISTS voucher_snapshot JSONB DEFAULT '{}';
