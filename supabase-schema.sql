-- =============================================
-- Voucher Wallet App — Supabase Schema
-- =============================================

-- Enable RLS (Row Level Security)
-- Run this in Supabase SQL editor

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

CREATE POLICY "Members can view wallet memberships"
  ON wallet_members FOR SELECT
  USING (user_id = auth.uid() OR wallet_id IN (
    SELECT wallet_id FROM wallet_members WHERE user_id = auth.uid()
  ));

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
  USING (wallet_id IN (
    SELECT wallet_id FROM wallet_members WHERE user_id = auth.uid()
  ));

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
  USING (wallet_id IS NULL OR wallet_id IN (
    SELECT wallet_id FROM wallet_members WHERE user_id = auth.uid()
  ));

CREATE POLICY "Wallet members can insert categories"
  ON categories FOR INSERT
  WITH CHECK (wallet_id IN (
    SELECT wallet_id FROM wallet_members WHERE user_id = auth.uid()
  ));

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
  is_archived BOOLEAN DEFAULT FALSE,
  is_shared BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE vouchers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Wallet members can view vouchers"
  ON vouchers FOR SELECT
  USING (wallet_id IN (
    SELECT wallet_id FROM wallet_members WHERE user_id = auth.uid()
  ));

CREATE POLICY "Wallet members can insert vouchers"
  ON vouchers FOR INSERT
  WITH CHECK (wallet_id IN (
    SELECT wallet_id FROM wallet_members WHERE user_id = auth.uid()
  ));

CREATE POLICY "Wallet members can update vouchers"
  ON vouchers FOR UPDATE
  USING (wallet_id IN (
    SELECT wallet_id FROM wallet_members WHERE user_id = auth.uid()
  ));

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

-- Enable Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE vouchers;
ALTER PUBLICATION supabase_realtime ADD TABLE wallet_members;

-- ============ SEED DEFAULT SUPER VOUCHERS ============
-- These will be inserted per-wallet by the app, but here's a reference:
-- INSERT INTO super_vouchers (wallet_id, name, stores) VALUES
-- (wallet_id, 'BuyMe', ARRAY['שופרסל', 'רמי לוי', 'ספייסר', ...]);
