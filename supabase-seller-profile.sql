-- Seller profile system for the marketplace.
-- Sellers must fill a profile and get admin approval before listing vouchers.
-- Apply in: Supabase Dashboard → SQL Editor
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS seller_profiles (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name           TEXT NOT NULL,
  phone               TEXT NOT NULL,
  email               TEXT NOT NULL,
  id_number           TEXT NOT NULL,         -- Israeli ID / passport
  verification_status TEXT NOT NULL DEFAULT 'pending'
                        CHECK (verification_status IN ('pending', 'verified', 'rejected')),
  admin_note          TEXT,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id)
);

CREATE INDEX IF NOT EXISTS seller_profiles_user_id ON seller_profiles(user_id);
CREATE INDEX IF NOT EXISTS seller_profiles_status  ON seller_profiles(verification_status);

ALTER TABLE seller_profiles ENABLE ROW LEVEL SECURITY;

-- Users can read/write only their own profile
CREATE POLICY "seller_read_own"  ON seller_profiles FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "seller_insert_own" ON seller_profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "seller_update_own" ON seller_profiles FOR UPDATE TO authenticated USING (auth.uid() = user_id);

-- Admins can read all
CREATE POLICY "admin_read_all_seller_profiles"
  ON seller_profiles FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = TRUE));

CREATE POLICY "admin_update_seller_profiles"
  ON seller_profiles FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = TRUE));

-- ── RPCs ─────────────────────────────────────────────────────────────────────

-- User: create or update own seller profile
CREATE OR REPLACE FUNCTION upsert_seller_profile(
  p_full_name TEXT,
  p_phone     TEXT,
  p_email     TEXT,
  p_id_number TEXT
)
RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_result  JSON;
BEGIN
  INSERT INTO seller_profiles(user_id, full_name, phone, email, id_number, verification_status, updated_at)
  VALUES (v_user_id, p_full_name, p_phone, p_email, p_id_number, 'pending', NOW())
  ON CONFLICT (user_id) DO UPDATE
    SET full_name           = EXCLUDED.full_name,
        phone               = EXCLUDED.phone,
        email               = EXCLUDED.email,
        id_number           = EXCLUDED.id_number,
        verification_status = CASE
          WHEN seller_profiles.verification_status = 'rejected' THEN 'pending'
          ELSE seller_profiles.verification_status
        END,
        updated_at          = NOW();

  SELECT row_to_json(sp) INTO v_result
  FROM seller_profiles sp
  WHERE sp.user_id = v_user_id;

  RETURN v_result;
END;
$$;
GRANT EXECUTE ON FUNCTION upsert_seller_profile(TEXT,TEXT,TEXT,TEXT) TO authenticated;

-- User: get own seller profile
CREATE OR REPLACE FUNCTION get_seller_profile()
RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public AS $$
DECLARE
  v_result JSON;
BEGIN
  SELECT row_to_json(sp) INTO v_result
  FROM seller_profiles sp
  WHERE sp.user_id = auth.uid();
  RETURN v_result;
END;
$$;
GRANT EXECUTE ON FUNCTION get_seller_profile() TO authenticated;

-- Admin: get all seller profiles with user email
CREATE OR REPLACE FUNCTION admin_get_seller_profiles()
RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = TRUE) THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  RETURN (
    SELECT json_agg(row_to_json(r) ORDER BY r.created_at DESC)
    FROM (
      SELECT
        sp.*,
        p.name    AS profile_name,
        u.email   AS user_email
      FROM seller_profiles sp
      JOIN profiles p ON p.id = sp.user_id
      JOIN auth.users u ON u.id = sp.user_id
    ) r
  );
END;
$$;
GRANT EXECUTE ON FUNCTION admin_get_seller_profiles() TO authenticated;

-- Admin: approve or reject a seller profile
CREATE OR REPLACE FUNCTION admin_update_seller_verification(
  p_user_id UUID,
  p_status  TEXT,        -- 'verified' or 'rejected'
  p_note    TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = TRUE) THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;
  IF p_status NOT IN ('verified', 'rejected') THEN
    RAISE EXCEPTION 'invalid status';
  END IF;
  UPDATE seller_profiles
    SET verification_status = p_status,
        admin_note          = p_note,
        updated_at          = NOW()
  WHERE user_id = p_user_id;
END;
$$;
GRANT EXECUTE ON FUNCTION admin_update_seller_verification(UUID,TEXT,TEXT) TO authenticated;

SELECT pg_notify('pgrst', 'reload schema');
