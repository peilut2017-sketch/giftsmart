-- ─────────────────────────────────────────────────────────────────────────────
-- Stabilize new-user registration / admin user list
--
-- PROBLEM (recurring): multiple older migration files each redefined
-- handle_new_user() with different bodies (supabase-schema.sql,
-- supabase-fix-user-registration.sql, supabase-fix-missing-profiles.sql).
-- Since these are applied manually and out of order, re-running an older
-- file silently regressed the trigger back to a fragile version — causing
-- some new signups to never get a `profiles` row, so they never appeared
-- in the admin panel's user list (which reads only from `profiles`).
--
-- Those two older fix files have been deleted; this file + the canonical
-- definitions now living directly in supabase-schema.sql (handle_new_user)
-- and supabase-admin-functions.sql (get_all_users / get_system_stats) are
-- the only source of truth going forward. Run this once now to apply the
-- fix to the live database; the repo files above already reflect it.
--
-- Run once in: Supabase Dashboard → SQL Editor
-- ─────────────────────────────────────────────────────────────────────────────


-- ── 1. Backfill any auth.users row currently missing a profiles row ──────────

INSERT INTO public.profiles (id, email, name, created_at)
SELECT
  u.id,
  u.email,
  COALESCE(
    NULLIF(TRIM(u.raw_user_meta_data->>'name'), ''),
    NULLIF(TRIM(u.raw_user_meta_data->>'full_name'), ''),
    split_part(u.email, '@', 1)
  ),
  u.created_at
FROM auth.users u
WHERE NOT EXISTS (
  SELECT 1 FROM public.profiles p WHERE p.id = u.id
)
ON CONFLICT (id) DO NOTHING;


-- ── 2. Hardened handle_new_user + trigger (canonical version) ────────────────

CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  BEGIN
    INSERT INTO profiles (id, email, name, created_at)
    VALUES (
      NEW.id,
      NEW.email,
      COALESCE(
        NULLIF(TRIM(NEW.raw_user_meta_data->>'name'), ''),
        NULLIF(TRIM(NEW.raw_user_meta_data->>'full_name'), ''),
        split_part(NEW.email, '@', 1)
      ),
      NEW.created_at
    )
    ON CONFLICT (id) DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'handle_new_user: failed to create profile for %: %', NEW.id, SQLERRM;
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();


-- ── 3. Self-healing backfill function, called by every admin user-listing RPC ─

CREATE OR REPLACE FUNCTION backfill_missing_profiles()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO profiles (id, email, name, created_at)
  SELECT
    u.id,
    u.email,
    COALESCE(
      NULLIF(TRIM(u.raw_user_meta_data->>'name'), ''),
      NULLIF(TRIM(u.raw_user_meta_data->>'full_name'), ''),
      split_part(u.email, '@', 1)
    ),
    u.created_at
  FROM auth.users u
  WHERE NOT EXISTS (SELECT 1 FROM profiles p WHERE p.id = u.id)
  ON CONFLICT (id) DO NOTHING;
END;
$$;

CREATE OR REPLACE FUNCTION get_registered_users_count()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true) THEN
    RAISE EXCEPTION 'permission_denied';
  END IF;
  PERFORM backfill_missing_profiles();
  RETURN (SELECT COUNT(*)::INTEGER FROM profiles);
END;
$$;
GRANT EXECUTE ON FUNCTION get_registered_users_count() TO authenticated;

CREATE OR REPLACE FUNCTION get_all_users()
RETURNS TABLE(id UUID, email TEXT, name TEXT, created_at TIMESTAMPTZ)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true) THEN
    RAISE EXCEPTION 'permission_denied';
  END IF;
  PERFORM backfill_missing_profiles();
  RETURN QUERY
    SELECT p.id, p.email, p.name, p.created_at
    FROM profiles p
    ORDER BY p.created_at DESC;
END;
$$;
GRANT EXECUTE ON FUNCTION get_all_users() TO authenticated;

CREATE OR REPLACE FUNCTION get_system_stats()
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true) THEN
    RAISE EXCEPTION 'permission_denied';
  END IF;
  PERFORM backfill_missing_profiles();
  RETURN (
    SELECT json_build_object(
      'total_vouchers',   (SELECT COUNT(*) FROM vouchers WHERE is_archived = false),
      'total_archived',   (SELECT COUNT(*) FROM vouchers WHERE is_archived = true),
      'total_balance',    (SELECT COALESCE(SUM(balance), 0) FROM vouchers WHERE is_archived = false),
      'total_wallets',    (SELECT COUNT(*) FROM wallets),
      'total_users',      (SELECT COUNT(*) FROM profiles)
    )
  );
END;
$$;
GRANT EXECUTE ON FUNCTION get_system_stats() TO authenticated;


-- ── 4. Verify ──────────────────────────────────────────────────────────────

SELECT
  (SELECT COUNT(*) FROM auth.users)      AS auth_users_total,
  (SELECT COUNT(*) FROM public.profiles) AS profiles_total,
  (SELECT COUNT(*) FROM auth.users u
   WHERE NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = u.id)
  )                                      AS still_missing;

SELECT pg_notify('pgrst', 'reload schema');
