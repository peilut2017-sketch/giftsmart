-- ============================================================================
-- Anonymous ("guest") accounts + safe merge into existing accounts
-- ============================================================================
-- Enables the app flow: first launch signs the user in anonymously (Supabase
-- Anonymous Auth), everything is stored server-side under that auth.users row,
-- and when the user later registers or logs into an existing account the guest
-- data is preserved.
--
-- PREREQUISITE (dashboard, one click):
--   Authentication → Sign In / Up → Anonymous sign-ins → Enable
--
-- Contents:
--   1. handle_new_user() tolerant of NULL email (anonymous users have none —
--      without this, profiles.email NOT NULL makes the trigger fail and BLOCKS
--      anonymous sign-in entirely).
--   2. merge_tickets table — one-time secrets proving "I am the device that
--      owned anonymous account X".
--   3. create_merge_ticket() — callable only by anonymous users, returns the
--      secret the device stores until after login.
--   4. claim_merge_ticket(secret) — callable only by registered users; runs in
--      ONE transaction: moves the guest's vouchers/super-vouchers/categories/
--      stores into the claimant's wallet (conservative duplicate skip), then
--      deletes the orphaned anonymous auth user (cascades clean everything
--      else, including skipped duplicates).
--   5. user_id indexes for per-user lookups (IF NOT EXISTS — no duplicates).
--
-- Run the whole file in the Supabase SQL Editor.
-- ============================================================================

-- ── 1. Profile trigger: tolerate anonymous users (no email) ─────────────────
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO profiles (id, email, name)
  VALUES (
    NEW.id,
    COALESCE(NEW.email, ''),
    COALESCE(
      NULLIF(TRIM(NEW.raw_user_meta_data->>'name'), ''),
      NULLIF(split_part(COALESCE(NEW.email, ''), '@', 1), ''),
      'אורח'
    )
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Never block the auth.users INSERT — a missing profile row is recoverable,
  -- a failed registration is not.
  RETURN NEW;
END;
$$;

-- Keep profiles.email consistent when an anonymous user links a real email
-- (auth.users.email changes on confirmation).
CREATE OR REPLACE FUNCTION handle_user_email_updated()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.email IS DISTINCT FROM OLD.email AND NEW.email IS NOT NULL THEN
    UPDATE profiles SET email = NEW.email,
      name = CASE WHEN name IS NULL OR name = '' OR name = 'אורח'
                  THEN split_part(NEW.email, '@', 1) ELSE name END
      WHERE id = NEW.id;
    UPDATE wallet_members SET email = NEW.email WHERE user_id = NEW.id;
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_email_updated ON auth.users;
CREATE TRIGGER on_auth_user_email_updated
  AFTER UPDATE OF email ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_user_email_updated();

-- ── 2. Merge tickets ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.merge_tickets (
  secret     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_user  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '30 minutes'
);
-- RPC-only access: RLS on, no policies.
ALTER TABLE public.merge_tickets ENABLE ROW LEVEL SECURITY;

-- ── 3. create_merge_ticket ──────────────────────────────────────────────────
-- Only an ANONYMOUS user may create a ticket for their own data. This limits
-- the blast radius: a leaked secret can only ever move guest data, never a
-- registered account's data.
CREATE OR REPLACE FUNCTION public.create_merge_ticket()
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_secret uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;
  IF COALESCE((auth.jwt()->>'is_anonymous')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'not_anonymous';
  END IF;

  -- One live ticket per user
  DELETE FROM merge_tickets WHERE from_user = auth.uid();
  INSERT INTO merge_tickets (from_user) VALUES (auth.uid()) RETURNING secret INTO v_secret;
  RETURN v_secret;
END;
$$;
REVOKE ALL ON FUNCTION public.create_merge_ticket() FROM anon, public;
GRANT EXECUTE ON FUNCTION public.create_merge_ticket() TO authenticated;

-- ── 4. claim_merge_ticket ───────────────────────────────────────────────────
-- Runs as ONE transaction: either the merge completes or nothing changes.
CREATE OR REPLACE FUNCTION public.claim_merge_ticket(p_secret uuid)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_claimant     uuid := auth.uid();
  v_from         uuid;
  v_from_anon    boolean;
  v_target_wallet uuid;
  v_moved        int := 0;
  v_skipped      int := 0;
  v_moved_ids    uuid[] := '{}';
  v_email        text;
BEGIN
  IF v_claimant IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;
  IF COALESCE((auth.jwt()->>'is_anonymous')::boolean, false) IS TRUE THEN
    RAISE EXCEPTION 'claimant_anonymous';
  END IF;

  SELECT from_user INTO v_from
  FROM merge_tickets
  WHERE secret = p_secret AND expires_at > now();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ticket_invalid';
  END IF;
  IF v_from = v_claimant THEN
    -- Same account (anonymous → upgraded in place): nothing to merge.
    DELETE FROM merge_tickets WHERE secret = p_secret;
    RETURN json_build_object('moved', 0, 'skipped', 0);
  END IF;

  -- Ownership proof for the source side: only an (anonymous) guest could have
  -- created the ticket, and it must still be anonymous now.
  SELECT is_anonymous INTO v_from_anon FROM auth.users WHERE id = v_from;
  IF v_from_anon IS DISTINCT FROM true THEN
    DELETE FROM merge_tickets WHERE secret = p_secret;
    RAISE EXCEPTION 'source_not_anonymous';
  END IF;

  -- E2EE safety: sealed rows are encrypted under the guest vault, which dies
  -- with the anonymous user below — merging them would make them permanently
  -- unreadable. The client unseals them first (e2eeMerge.ts); refuse otherwise.
  IF EXISTS (
    SELECT 1 FROM vouchers v
    JOIN wallets w ON w.id = v.wallet_id
    WHERE w.owner_id = v_from AND v.is_e2ee = true
  ) THEN
    RAISE EXCEPTION 'e2ee_pending';
  END IF;

  -- Target wallet: the claimant's primary wallet (create if missing).
  SELECT wallet_id INTO v_target_wallet
  FROM wallet_members WHERE user_id = v_claimant ORDER BY created_at LIMIT 1;
  IF v_target_wallet IS NULL THEN
    SELECT COALESCE(NULLIF(p.email, ''), u.email) INTO v_email
    FROM profiles p JOIN auth.users u ON u.id = p.id WHERE p.id = v_claimant;
    INSERT INTO wallets (name, owner_id) VALUES ('ארנק השוברים שלי', v_claimant)
    RETURNING id INTO v_target_wallet;
    INSERT INTO wallet_members (wallet_id, user_id, email, role)
    VALUES (v_target_wallet, v_claimant, COALESCE(v_email, ''), 'owner');
  END IF;

  -- Conservative duplicate rule: skip a guest voucher only when the target
  -- wallet already holds a voucher with the SAME store name (case-insensitive),
  -- SAME non-empty code, SAME original amount and SAME balance. Anything less
  -- certain is kept as a second record — losing data is worse than a duplicate.
  WITH guest_wallets AS (
    SELECT id FROM wallets WHERE owner_id = v_from
  ), dupes AS (
    SELECT g.id
    FROM vouchers g
    WHERE g.wallet_id IN (SELECT id FROM guest_wallets)
      AND g.code <> ''
      AND g.code NOT LIKE 'e2ee:%'
      AND EXISTS (
        SELECT 1 FROM vouchers t
        WHERE t.wallet_id = v_target_wallet
          AND lower(t.store_name) = lower(g.store_name)
          AND t.code = g.code
          AND t.amount = g.amount
          AND t.balance = g.balance
      )
  ), moved AS (
    UPDATE vouchers v
    SET wallet_id = v_target_wallet, user_id = v_claimant
    WHERE v.wallet_id IN (SELECT id FROM guest_wallets)
      AND v.id NOT IN (SELECT id FROM dupes)
    RETURNING v.id
  )
  SELECT (SELECT coalesce(array_agg(id), '{}') FROM moved), (SELECT count(*) FROM dupes)
  INTO v_moved_ids, v_skipped;
  v_moved := coalesce(array_length(v_moved_ids, 1), 0);

  -- Super-vouchers move as-is (name collisions are kept — no data loss).
  UPDATE super_vouchers SET wallet_id = v_target_wallet
  WHERE wallet_id IN (SELECT id FROM wallets WHERE owner_id = v_from);

  -- Custom categories: move ones the target doesn't already have by name.
  UPDATE categories c SET wallet_id = v_target_wallet
  WHERE c.wallet_id IN (SELECT id FROM wallets WHERE owner_id = v_from)
    AND NOT EXISTS (
      SELECT 1 FROM categories tc
      WHERE tc.wallet_id = v_target_wallet AND lower(tc.name) = lower(c.name)
    );

  -- Personal store suggestions follow the user.
  UPDATE stores SET created_by = v_claimant WHERE created_by = v_from;

  DELETE FROM merge_tickets WHERE secret = p_secret;

  -- Remove the emptied anonymous user; FK cascades clean profiles, wallets,
  -- wallet_members and the duplicate vouchers that stayed behind.
  DELETE FROM auth.users WHERE id = v_from;

  -- moved_ids lets the client re-seal (re-encrypt) exactly these rows under
  -- the claimant's own vault right after the merge.
  RETURN json_build_object('moved', v_moved, 'skipped', v_skipped, 'moved_ids', to_jsonb(v_moved_ids));
END;
$$;
REVOKE ALL ON FUNCTION public.claim_merge_ticket(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.claim_merge_ticket(uuid) TO authenticated;

-- ── 5. Indexes for per-user access paths (skip if already present) ──────────
CREATE INDEX IF NOT EXISTS idx_vouchers_wallet_id ON public.vouchers(wallet_id);
CREATE INDEX IF NOT EXISTS idx_vouchers_user_id   ON public.vouchers(user_id);
CREATE INDEX IF NOT EXISTS idx_wallet_members_user ON public.wallet_members(user_id);
CREATE INDEX IF NOT EXISTS idx_merge_tickets_from ON public.merge_tickets(from_user);
