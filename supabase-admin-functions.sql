-- =============================================
-- Admin helper functions — run in Supabase SQL Editor
-- =============================================

-- 0. Self-healing backfill: catches any auth.users row still missing its
--    profiles row (e.g. if handle_new_user's trigger ever regresses again —
--    see supabase-schema.sql). Called at the top of every admin user-listing
--    function below so the admin panel can never silently miss a registered
--    user, independent of whether the signup trigger is currently healthy.
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

-- 1. Count all registered users (bypasses RLS)
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

-- 2. List all registered users (admin use)
-- NOTE: RETURNS TABLE(id, ...) creates a PL/pgSQL OUT parameter named `id`.
-- The admin check below must qualify `profiles.id` — an unqualified `id`
-- is ambiguous against that OUT parameter and raises 42702 at call time.
CREATE OR REPLACE FUNCTION get_all_users()
RETURNS TABLE(id UUID, email TEXT, name TEXT, created_at TIMESTAMPTZ)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND is_admin = true) THEN
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

-- 3. System-wide voucher stats
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
