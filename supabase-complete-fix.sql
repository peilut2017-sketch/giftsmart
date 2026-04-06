-- =============================================
-- COMPLETE FIX — הרץ קובץ זה בלבד ב-Supabase SQL Editor
-- מתקן את כל בעיות ה-RLS, פונקציות הארנק, ונתונים קיימים
-- =============================================

-- ── 1. פונקציית עזר: get_my_wallet_ids ──────────────────────────────────────
-- נדרשת ע"י מדיניות ה-RLS של כל הטבלאות
CREATE OR REPLACE FUNCTION get_my_wallet_ids()
RETURNS SETOF UUID LANGUAGE SQL SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT wallet_id FROM wallet_members WHERE user_id = auth.uid()
$$;

-- ── 2. פונקציה אטומית: get_or_create_user_wallet ────────────────────────────
-- מחזירה wallet_id קיים או יוצרת חדש. עוקפת RLS לחלוטין (בטוח — פועלת רק על auth.uid()).
CREATE OR REPLACE FUNCTION get_or_create_user_wallet()
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_wallet_id UUID;
  v_email     TEXT;
BEGIN
  SELECT wallet_id INTO v_wallet_id
  FROM wallet_members
  WHERE user_id = auth.uid()
  ORDER BY created_at
  LIMIT 1;

  IF FOUND THEN
    RETURN v_wallet_id;
  END IF;

  SELECT email INTO v_email FROM profiles WHERE id = auth.uid();
  IF v_email IS NULL THEN
    SELECT email INTO v_email FROM auth.users WHERE id = auth.uid();
  END IF;

  INSERT INTO wallets (name, owner_id)
  VALUES ('ארנק השוברים שלי', auth.uid())
  RETURNING id INTO v_wallet_id;

  INSERT INTO wallet_members (wallet_id, user_id, email, role)
  VALUES (v_wallet_id, auth.uid(), COALESCE(v_email, ''), 'owner');

  RETURN v_wallet_id;
END;
$$;

GRANT EXECUTE ON FUNCTION get_or_create_user_wallet() TO authenticated;

-- ── 3. תיקון RLS — wallet_members ──────────────────────────────────────────
DROP POLICY IF EXISTS "Members can view wallet memberships" ON wallet_members;
CREATE POLICY "Members can view wallet memberships"
  ON wallet_members FOR SELECT
  USING (user_id = auth.uid() OR wallet_id IN (SELECT get_my_wallet_ids()));

DROP POLICY IF EXISTS "Owners can manage members" ON wallet_members;
CREATE POLICY "Owners can manage members"
  ON wallet_members FOR ALL
  USING (wallet_id IN (SELECT id FROM wallets WHERE owner_id = auth.uid()));

DROP POLICY IF EXISTS "Users can join wallets" ON wallet_members;
CREATE POLICY "Users can join wallets"
  ON wallet_members FOR INSERT
  WITH CHECK (user_id = auth.uid());

-- ── 4. תיקון RLS — vouchers (כולל fallback לפי user_id) ────────────────────
DROP POLICY IF EXISTS "Wallet members can view vouchers" ON vouchers;
DROP POLICY IF EXISTS "Users can view own vouchers" ON vouchers;
-- פוליסה ראשית: לפי wallet
CREATE POLICY "Wallet members can view vouchers"
  ON vouchers FOR SELECT
  USING (wallet_id IN (SELECT get_my_wallet_ids()));
-- פוליסה fallback: לפי user_id (לשוברים ישנים שלא הועברו לארנק)
CREATE POLICY "Users can view own vouchers"
  ON vouchers FOR SELECT
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Wallet members can insert vouchers" ON vouchers;
CREATE POLICY "Wallet members can insert vouchers"
  ON vouchers FOR INSERT
  WITH CHECK (wallet_id IN (SELECT get_my_wallet_ids()));

DROP POLICY IF EXISTS "Wallet members can update vouchers" ON vouchers;
CREATE POLICY "Wallet members can update vouchers"
  ON vouchers FOR UPDATE
  USING (wallet_id IN (SELECT get_my_wallet_ids())
      OR user_id = auth.uid());

DROP POLICY IF EXISTS "Voucher owner can delete" ON vouchers;
CREATE POLICY "Voucher owner can delete"
  ON vouchers FOR DELETE
  USING (user_id = auth.uid()
      OR wallet_id IN (SELECT id FROM wallets WHERE owner_id = auth.uid()));

-- ── 5. תיקון RLS — super_vouchers ──────────────────────────────────────────
ALTER TABLE super_vouchers ADD COLUMN IF NOT EXISTS is_global BOOLEAN DEFAULT FALSE;

DROP POLICY IF EXISTS "Wallet members can view super vouchers" ON super_vouchers;
DROP POLICY IF EXISTS "Anyone can view global super vouchers" ON super_vouchers;
CREATE POLICY "Wallet members can view super vouchers"
  ON super_vouchers FOR SELECT
  USING (wallet_id IN (SELECT get_my_wallet_ids()) OR is_global = true);

DROP POLICY IF EXISTS "Wallet owners can manage super vouchers" ON super_vouchers;
CREATE POLICY "Wallet owners can manage super vouchers"
  ON super_vouchers FOR ALL
  USING (wallet_id IN (SELECT id FROM wallets WHERE owner_id = auth.uid()));

-- ── 6. תיקון RLS — categories ───────────────────────────────────────────────
DROP POLICY IF EXISTS "Wallet members can read categories" ON categories;
CREATE POLICY "Wallet members can read categories"
  ON categories FOR SELECT
  USING (wallet_id IS NULL OR wallet_id IN (SELECT get_my_wallet_ids()));

DROP POLICY IF EXISTS "Wallet members can insert categories" ON categories;
CREATE POLICY "Wallet members can insert categories"
  ON categories FOR INSERT
  WITH CHECK (wallet_id IN (SELECT get_my_wallet_ids()));

-- ── 7. הגדרת ארנקים לכל המשתמשים הקיימים ────────────────────────────────────
-- יוצר ארנק לכל משתמש שעדיין אין לו wallet_members
DO $$
DECLARE
  u RECORD;
  v_wallet_id UUID;
  v_email TEXT;
BEGIN
  FOR u IN
    SELECT au.id, au.email
    FROM auth.users au
    WHERE NOT EXISTS (
      SELECT 1 FROM wallet_members wm WHERE wm.user_id = au.id
    )
  LOOP
    INSERT INTO wallets (name, owner_id)
    VALUES ('ארנק השוברים שלי', u.id)
    RETURNING id INTO v_wallet_id;

    INSERT INTO wallet_members (wallet_id, user_id, email, role)
    VALUES (v_wallet_id, u.id, COALESCE(u.email, ''), 'owner');

    RAISE NOTICE 'Created wallet % for user %', v_wallet_id, u.id;
  END LOOP;
END;
$$;

-- ── 8. העברת שוברים קיימים לארנק הנכון ───────────────────────────────────────
-- מחבר שוברים שיש להם user_id אך wallet_id לא תואם לארנק האמיתי של המשתמש
DO $$
DECLARE
  fixed INT := 0;
BEGIN
  UPDATE vouchers v
  SET wallet_id = wm.wallet_id
  FROM wallet_members wm
  WHERE wm.user_id = v.user_id
    AND v.wallet_id != wm.wallet_id
    AND NOT EXISTS (
      SELECT 1 FROM wallet_members wm2
      WHERE wm2.wallet_id = v.wallet_id AND wm2.user_id = v.user_id
    );
  GET DIAGNOSTICS fixed = ROW_COUNT;
  RAISE NOTICE 'Fixed wallet_id for % vouchers', fixed;
END;
$$;

-- ── 9. בדיקה — מה המצב הנוכחי ───────────────────────────────────────────────
SELECT
  (SELECT COUNT(*) FROM auth.users)         AS total_users,
  (SELECT COUNT(*) FROM wallets)            AS total_wallets,
  (SELECT COUNT(*) FROM wallet_members)     AS total_members,
  (SELECT COUNT(*) FROM vouchers)           AS total_vouchers,
  (SELECT COUNT(*) FROM vouchers WHERE wallet_id IS NULL) AS vouchers_without_wallet;

-- ── 10. רענון cache של PostgREST ────────────────────────────────────────────
SELECT pg_notify('pgrst', 'reload schema');
