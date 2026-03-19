-- =============================================
-- Admin helper functions — run in Supabase SQL Editor
-- =============================================

-- 1. Count all registered users (bypasses RLS)
CREATE OR REPLACE FUNCTION get_registered_users_count()
RETURNS INTEGER
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COUNT(*)::INTEGER FROM profiles;
$$;
GRANT EXECUTE ON FUNCTION get_registered_users_count() TO authenticated;

-- 2. List all registered users (admin use)
CREATE OR REPLACE FUNCTION get_all_users()
RETURNS TABLE(id UUID, email TEXT, name TEXT, created_at TIMESTAMPTZ)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id, email, name, created_at FROM profiles ORDER BY created_at DESC;
$$;
GRANT EXECUTE ON FUNCTION get_all_users() TO authenticated;

-- 3. System-wide voucher stats
CREATE OR REPLACE FUNCTION get_system_stats()
RETURNS JSON
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT json_build_object(
    'total_vouchers',   (SELECT COUNT(*) FROM vouchers WHERE is_archived = false),
    'total_archived',   (SELECT COUNT(*) FROM vouchers WHERE is_archived = true),
    'total_balance',    (SELECT COALESCE(SUM(balance), 0) FROM vouchers WHERE is_archived = false),
    'total_wallets',    (SELECT COUNT(*) FROM wallets),
    'total_users',      (SELECT COUNT(*) FROM profiles)
  );
$$;
GRANT EXECUTE ON FUNCTION get_system_stats() TO authenticated;
