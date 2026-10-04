-- ============================================================================
-- LOCAL TEST HARNESS — not part of the application schema, not deployed
-- anywhere. Mirrors just enough of the live GiftSmart schema + Supabase's
-- documented auth.uid()/auth.role()/role-switching behavior to let us prove
-- RLS/RPC/trigger properties against a REAL PostgreSQL 16 instance, since no
-- Docker/Supabase-CLI stack is available in this sandbox.
--
-- auth.uid()/auth.role() bodies below are reproduced from Supabase's public
-- auth schema definitions (documented, non-secret) so request.jwt.claims
-- behaves the same way it does in production.
-- ============================================================================

DROP DATABASE IF EXISTS giftsmart_test;
CREATE DATABASE giftsmart_test;

\c giftsmart_test

CREATE EXTENSION IF NOT EXISTS pgcrypto; -- gen_random_uuid()

-- ── Roles (mirrors Supabase: anon / authenticated / service_role) ──────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
  END IF;
END $$;

GRANT anon TO postgres;
GRANT authenticated TO postgres;
GRANT service_role TO postgres;

-- ── auth schema stub ────────────────────────────────────────────────────────
CREATE SCHEMA IF NOT EXISTS auth;

CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE
AS $$
  SELECT
    COALESCE(
      NULLIF(current_setting('request.jwt.claim.sub', true), ''),
      (NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
    )::uuid
$$;

CREATE OR REPLACE FUNCTION auth.role() RETURNS text
LANGUAGE sql STABLE
AS $$
  SELECT
    COALESCE(
      NULLIF(current_setting('request.jwt.claim.role', true), ''),
      (NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
    )::text
$$;

GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.role() TO anon, authenticated, service_role;

-- ── Minimal application schema (mirrors production shapes we depend on) ────
CREATE TABLE public.profiles (
  id        uuid PRIMARY KEY,
  is_admin  boolean NOT NULL DEFAULT false
);

CREATE TABLE public.wallets (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id  uuid NOT NULL,
  name      text NOT NULL DEFAULT 'wallet'
);

CREATE TABLE public.wallet_members (
  wallet_id uuid NOT NULL REFERENCES public.wallets(id) ON DELETE CASCADE,
  user_id   uuid NOT NULL,
  PRIMARY KEY (wallet_id, user_id)
);

CREATE OR REPLACE FUNCTION public.get_my_wallet_ids()
RETURNS SETOF uuid LANGUAGE sql SECURITY DEFINER STABLE SET search_path = ''
AS $$
  SELECT wallet_id FROM public.wallet_members WHERE user_id = auth.uid()
$$;
REVOKE ALL ON FUNCTION public.get_my_wallet_ids() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_wallet_ids() TO authenticated;

CREATE TABLE public.super_vouchers (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id           uuid NOT NULL REFERENCES public.wallets(id) ON DELETE CASCADE,
  name                text NOT NULL,
  description         text,
  stores              text[] DEFAULT '{}',
  logo_url            text,
  is_global           boolean DEFAULT false,
  balance_check_url   text,
  created_at          timestamptz DEFAULT now(),
  updated_at          timestamptz DEFAULT now()
);

CREATE TABLE public.vouchers (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid NOT NULL,
  wallet_id         uuid NOT NULL REFERENCES public.wallets(id) ON DELETE CASCADE,
  super_voucher_id  uuid REFERENCES public.super_vouchers(id) ON DELETE SET NULL,
  store_name        text NOT NULL
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallet_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.super_vouchers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vouchers ENABLE ROW LEVEL SECURITY;

-- Baseline grants mirroring Supabase's default ALTER DEFAULT PRIVILEGES
-- (table-level DML granted broadly; RLS is the real gate).
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles, public.wallets, public.wallet_members, public.super_vouchers, public.vouchers
  TO anon, authenticated;
GRANT ALL ON public.profiles, public.wallets, public.wallet_members, public.super_vouchers, public.vouchers
  TO service_role;

-- Production-equivalent baseline policies (pre-existing, before our migration)
CREATE POLICY "profiles_select_own" ON public.profiles FOR SELECT USING (id = auth.uid());
-- NOTE: production already REVOKEs UPDATE/INSERT on profiles from anon/authenticated
-- (supabase-security-hardening-v2.sql) — reproduced here as a REVOKE, not a policy.
REVOKE INSERT, UPDATE ON public.profiles FROM anon, authenticated;

CREATE POLICY "wallets_select_members" ON public.wallets FOR SELECT
  USING (id IN (SELECT public.get_my_wallet_ids()) OR owner_id = auth.uid());

CREATE POLICY "wallet_members_select" ON public.wallet_members FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "sv_select" ON public.super_vouchers FOR SELECT
  USING (wallet_id IN (SELECT public.get_my_wallet_ids()) OR is_global = true);

-- The policy our migration must DROP and replace (today's real production shape):
CREATE POLICY "Wallet owners can manage super vouchers" ON public.super_vouchers FOR ALL
  USING (wallet_id IN (SELECT id FROM public.wallets WHERE owner_id = auth.uid()));

CREATE POLICY "vouchers_select" ON public.vouchers FOR SELECT
  USING (wallet_id IN (SELECT public.get_my_wallet_ids()));

-- ── Seed data ────────────────────────────────────────────────────────────────
-- user_admin : the one admin account
-- user_a     : owns wallet_a (regular user)
-- user_b     : owns wallet_b (regular user, used to prove no cross-wallet leakage)
INSERT INTO public.profiles (id, is_admin) VALUES
  ('11111111-1111-1111-1111-111111111111', true),
  ('22222222-2222-2222-2222-222222222222', false),
  ('33333333-3333-3333-3333-333333333333', false);

INSERT INTO public.wallets (id, owner_id, name) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '22222222-2222-2222-2222-222222222222', 'wallet_a'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '33333333-3333-3333-3333-333333333333', 'wallet_b');

INSERT INTO public.wallet_members (wallet_id, user_id) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '22222222-2222-2222-2222-222222222222'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '33333333-3333-3333-3333-333333333333');

-- sv_private: belongs to wallet_a only, not global
-- sv_global : belongs to wallet_a (FK requires a wallet_id) but is_global=true,
--             so it must be visible to user_b too via the is_global clause
INSERT INTO public.super_vouchers (id, wallet_id, name, stores, is_global) VALUES
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Private SV', ARRAY['Shop X'], false),
  ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'BUYME ALL', ARRAY['Shop Y','Shop Z'], true);

INSERT INTO public.vouchers (id, user_id, wallet_id, super_voucher_id, store_name) VALUES
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', '22222222-2222-2222-2222-222222222222', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'Private SV');
