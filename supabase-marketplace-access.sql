-- ── Marketplace Access Control ────────────────────────────────────────────────
-- Three modes stored in app_settings:
--   'enabled'   — open to all authenticated users (default)
--   'disabled'  — hidden from everyone (admins can still access via /admin)
--   'selective' — tab visible to all, but non-approved users must request access

-- 1. Insert default mode
INSERT INTO app_settings (key, value)
VALUES ('marketplace_mode', 'enabled')
ON CONFLICT (key) DO NOTHING;

-- 2. Access requests table (one row per user, upserted on re-request)
CREATE TABLE IF NOT EXISTS marketplace_access_requests (
  user_id    UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  user_email TEXT,
  user_name  TEXT,
  message    TEXT,
  status     TEXT NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE marketplace_access_requests ENABLE ROW LEVEL SECURITY;

-- Users can only see/edit their own row
CREATE POLICY "own row" ON marketplace_access_requests
  FOR ALL USING (auth.uid() = user_id);

-- Admins can see all rows via SECURITY DEFINER functions below

-- 3. Public read of marketplace mode (like get_premium_enabled)
CREATE OR REPLACE FUNCTION get_marketplace_mode()
RETURNS TEXT LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT COALESCE(
    (SELECT value FROM app_settings WHERE key = 'marketplace_mode'),
    'enabled'
  );
$$;
GRANT EXECUTE ON FUNCTION get_marketplace_mode TO anon, authenticated;

-- 4. Admin setter
CREATE OR REPLACE FUNCTION admin_set_marketplace_mode(p_mode TEXT)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  IF p_mode NOT IN ('enabled', 'disabled', 'selective') THEN
    RAISE EXCEPTION 'Invalid mode';
  END IF;
  INSERT INTO app_settings (key, value)
    VALUES ('marketplace_mode', p_mode)
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
END;
$$;
GRANT EXECUTE ON FUNCTION admin_set_marketplace_mode TO authenticated;

-- 5. Returns current user's access status
--    'approved' | 'pending' | 'rejected' | 'none'
CREATE OR REPLACE FUNCTION get_my_marketplace_access()
RETURNS TEXT LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT COALESCE(
    (SELECT status FROM marketplace_access_requests WHERE user_id = auth.uid()),
    'none'
  );
$$;
GRANT EXECUTE ON FUNCTION get_my_marketplace_access TO authenticated;

-- 6. Submit or re-submit an access request
CREATE OR REPLACE FUNCTION request_marketplace_access(p_message TEXT DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_email TEXT;
  v_name  TEXT;
BEGIN
  SELECT email, name INTO v_email, v_name FROM profiles WHERE id = auth.uid();
  INSERT INTO marketplace_access_requests (user_id, user_email, user_name, message, status, updated_at)
    VALUES (auth.uid(), v_email, v_name, p_message, 'pending', now())
    ON CONFLICT (user_id) DO UPDATE
      SET message = EXCLUDED.message,
          status  = 'pending',
          updated_at = now();
END;
$$;
GRANT EXECUTE ON FUNCTION request_marketplace_access TO authenticated;

-- 7. Admin: fetch all requests (any status)
CREATE OR REPLACE FUNCTION admin_get_marketplace_requests()
RETURNS TABLE (
  user_id    UUID,
  user_email TEXT,
  user_name  TEXT,
  message    TEXT,
  status     TEXT,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
) LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  RETURN QUERY
    SELECT r.user_id, r.user_email, r.user_name, r.message, r.status, r.created_at, r.updated_at
    FROM marketplace_access_requests r
    ORDER BY
      CASE r.status WHEN 'pending' THEN 0 WHEN 'approved' THEN 1 ELSE 2 END,
      r.updated_at DESC;
END;
$$;
GRANT EXECUTE ON FUNCTION admin_get_marketplace_requests TO authenticated;

-- 8. Admin: approve or reject (upsert — works even if user never submitted a request)
CREATE OR REPLACE FUNCTION admin_set_marketplace_access(p_user_id UUID, p_status TEXT)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_email TEXT;
  v_name  TEXT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  IF p_status NOT IN ('approved', 'rejected') THEN
    RAISE EXCEPTION 'Invalid status';
  END IF;
  SELECT email, name INTO v_email, v_name FROM profiles WHERE id = p_user_id;
  INSERT INTO marketplace_access_requests (user_id, user_email, user_name, message, status, updated_at)
    VALUES (p_user_id, v_email, v_name, NULL, p_status, now())
    ON CONFLICT (user_id) DO UPDATE
      SET status = EXCLUDED.status, updated_at = now();
END;
$$;
GRANT EXECUTE ON FUNCTION admin_set_marketplace_access TO authenticated;
