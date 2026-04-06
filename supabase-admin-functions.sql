-- =============================================
-- Admin helper functions — run in Supabase SQL Editor
-- =============================================

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
  RETURN (SELECT COUNT(*)::INTEGER FROM profiles);
END;
$$;
GRANT EXECUTE ON FUNCTION get_registered_users_count() TO authenticated;

-- 2. List all registered users (admin use)
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
