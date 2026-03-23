-- ============================================================
-- Voucher-level user sharing
-- Run in Supabase SQL Editor (requires supabase-send-email-setup.sql first)
-- ============================================================

-- ── Fix: deduplicate wallets, then add UNIQUE constraint ─────
-- For each owner with multiple wallets:
--   1. Pick the primary wallet (oldest created_at, or the one with most vouchers)
--   2. Re-point vouchers / wallet_members / categories / activity_log to primary
--   3. Delete the duplicate wallet rows
--   4. Add UNIQUE(owner_id) so this never happens again
DO $$
DECLARE
  dup RECORD;
  primary_wallet_id UUID;
BEGIN
  -- Loop over every owner_id that appears more than once
  FOR dup IN
    SELECT owner_id
    FROM wallets
    GROUP BY owner_id
    HAVING COUNT(*) > 1
  LOOP
    -- Choose primary: wallet with the most vouchers; tie-break by oldest created_at
    SELECT w.id INTO primary_wallet_id
    FROM wallets w
    LEFT JOIN (
      SELECT wallet_id, COUNT(*) AS cnt FROM vouchers GROUP BY wallet_id
    ) vc ON vc.wallet_id = w.id
    WHERE w.owner_id = dup.owner_id
    ORDER BY COALESCE(vc.cnt, 0) DESC, w.created_at ASC
    LIMIT 1;

    -- Re-point vouchers
    UPDATE vouchers
    SET wallet_id = primary_wallet_id
    WHERE wallet_id IN (
      SELECT id FROM wallets WHERE owner_id = dup.owner_id AND id <> primary_wallet_id
    );

    -- Re-point wallet_members (skip if already exists for primary)
    UPDATE wallet_members
    SET wallet_id = primary_wallet_id
    WHERE wallet_id IN (
      SELECT id FROM wallets WHERE owner_id = dup.owner_id AND id <> primary_wallet_id
    )
    AND NOT EXISTS (
      SELECT 1 FROM wallet_members wm2
      WHERE wm2.wallet_id = primary_wallet_id AND wm2.user_id = wallet_members.user_id
    );

    -- Re-point categories
    UPDATE categories
    SET wallet_id = primary_wallet_id
    WHERE wallet_id IN (
      SELECT id FROM wallets WHERE owner_id = dup.owner_id AND id <> primary_wallet_id
    );

    -- Re-point activity_log (if column exists)
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'activity_log' AND column_name = 'wallet_id') THEN
      EXECUTE '
        UPDATE activity_log
        SET wallet_id = $1
        WHERE wallet_id IN (
          SELECT id FROM wallets WHERE owner_id = $2 AND id <> $1
        )
      ' USING primary_wallet_id, dup.owner_id;
    END IF;

    -- Re-point super_vouchers (if wallet_id column exists)
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'super_vouchers' AND column_name = 'wallet_id') THEN
      EXECUTE '
        UPDATE super_vouchers
        SET wallet_id = $1
        WHERE wallet_id IN (
          SELECT id FROM wallets WHERE owner_id = $2 AND id <> $1
        )
      ' USING primary_wallet_id, dup.owner_id;
    END IF;

    -- Delete duplicate wallets (cascades leftover wallet_members rows)
    DELETE FROM wallets
    WHERE owner_id = dup.owner_id AND id <> primary_wallet_id;

  END LOOP;

  -- Now safe to add the constraint
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'wallets_owner_id_unique' AND conrelid = 'wallets'::regclass
  ) THEN
    ALTER TABLE wallets ADD CONSTRAINT wallets_owner_id_unique UNIQUE (owner_id);
  END IF;
END $$;

-- ── voucher_shares table ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS voucher_shares (
  id                  UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  voucher_id          UUID        NOT NULL REFERENCES vouchers(id)   ON DELETE CASCADE,
  shared_by           UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  shared_with_email   TEXT        NOT NULL,
  shared_with_user_id UUID        REFERENCES auth.users(id)          ON DELETE CASCADE,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(voucher_id, shared_with_email)
);
ALTER TABLE voucher_shares ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Owner can manage voucher shares"   ON voucher_shares;
DROP POLICY IF EXISTS "Shared user can view their shares" ON voucher_shares;

-- Voucher owner manages shares
CREATE POLICY "Owner can manage voucher shares" ON voucher_shares
  USING  (shared_by = auth.uid())
  WITH CHECK (shared_by = auth.uid());

-- Recipient can see shares addressed to them
CREATE POLICY "Shared user can view their shares" ON voucher_shares
  FOR SELECT USING (shared_with_user_id = auth.uid());

-- ── share_voucher_with_email ──────────────────────────────────
-- Returns: 'shared' | 'already_shared' | 'not_found'
CREATE OR REPLACE FUNCTION share_voucher_with_email(
  p_voucher_id UUID,
  p_email      TEXT
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_inserted BOOLEAN;
BEGIN
  -- Verify caller owns this voucher
  IF NOT EXISTS (
    SELECT 1 FROM vouchers v
    JOIN wallet_members wm ON wm.wallet_id = v.wallet_id
      AND wm.user_id = auth.uid()
      AND wm.role = 'owner'
    WHERE v.id = p_voucher_id
  ) THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  -- Look up profile by email
  SELECT id INTO v_user_id FROM profiles WHERE email = p_email;
  IF NOT FOUND THEN
    RETURN 'not_found';
  END IF;

  -- Insert; detect duplicate
  INSERT INTO voucher_shares (voucher_id, shared_by, shared_with_email, shared_with_user_id)
    VALUES (p_voucher_id, auth.uid(), p_email, v_user_id)
    ON CONFLICT (voucher_id, shared_with_email) DO NOTHING;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  IF v_inserted = 0 THEN
    RETURN 'already_shared';
  END IF;

  RETURN 'shared';
END;
$$;
GRANT EXECUTE ON FUNCTION share_voucher_with_email TO authenticated;

-- ── unshare_voucher ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION unshare_voucher(
  p_voucher_id UUID,
  p_email      TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM voucher_shares
  WHERE voucher_id = p_voucher_id
    AND shared_with_email = p_email
    AND shared_by = auth.uid();
END;
$$;
GRANT EXECUTE ON FUNCTION unshare_voucher TO authenticated;

-- ── get_vouchers_shared_with_me ───────────────────────────────
CREATE OR REPLACE FUNCTION get_vouchers_shared_with_me()
RETURNS TABLE (
  id               UUID,
  wallet_id        UUID,
  user_id          UUID,
  store_name       TEXT,
  store_id         UUID,
  super_voucher_id UUID,
  amount           NUMERIC,
  balance          NUMERIC,
  code             TEXT,
  cvv              TEXT,
  expiry_date      DATE,
  categories       TEXT[],
  tags             TEXT[],
  notes            TEXT,
  link             TEXT,
  is_archived      BOOLEAN,
  is_shared        BOOLEAN,
  created_at       TIMESTAMPTZ,
  updated_at       TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
    SELECT
      v.id, v.wallet_id, v.user_id, v.store_name, v.store_id,
      v.super_voucher_id, v.amount, v.balance, v.code, v.cvv,
      v.expiry_date, v.categories, v.tags, v.notes, v.link,
      v.is_archived, v.is_shared, v.created_at, v.updated_at
    FROM vouchers v
    JOIN voucher_shares vs ON vs.voucher_id = v.id
    WHERE vs.shared_with_user_id = auth.uid()
      AND NOT v.is_archived;
END;
$$;
GRANT EXECUTE ON FUNCTION get_vouchers_shared_with_me TO authenticated;

-- ── get_voucher_shares ────────────────────────────────────────
-- Returns share list for a voucher the caller owns
CREATE OR REPLACE FUNCTION get_voucher_shares(p_voucher_id UUID)
RETURNS TABLE (
  id                  UUID,
  shared_with_email   TEXT,
  shared_with_user_id UUID,
  created_at          TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM vouchers v
    JOIN wallet_members wm ON wm.wallet_id = v.wallet_id
      AND wm.user_id = auth.uid()
      AND wm.role = 'owner'
    WHERE v.id = p_voucher_id
  ) THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  RETURN QUERY
    SELECT vs.id, vs.shared_with_email, vs.shared_with_user_id, vs.created_at
    FROM voucher_shares vs
    WHERE vs.voucher_id = p_voucher_id
    ORDER BY vs.created_at;
END;
$$;
GRANT EXECUTE ON FUNCTION get_voucher_shares TO authenticated;

-- ── update_shared_voucher_balance ─────────────────────────────
-- Lets a share recipient update the balance
CREATE OR REPLACE FUNCTION update_shared_voucher_balance(
  p_voucher_id  UUID,
  p_new_balance NUMERIC
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM voucher_shares
    WHERE voucher_id = p_voucher_id AND shared_with_user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  UPDATE vouchers SET balance = p_new_balance, updated_at = NOW()
  WHERE id = p_voucher_id;
END;
$$;
GRANT EXECUTE ON FUNCTION update_shared_voucher_balance TO authenticated;

-- ── send_voucher_shared_email ─────────────────────────────────
-- Notifies existing user that a voucher was shared with them
CREATE OR REPLACE FUNCTION send_voucher_shared_email(
  p_to_email   TEXT,
  p_to_name    TEXT,
  p_from_name  TEXT,
  p_store_name TEXT,
  p_app_url    TEXT DEFAULT ''
)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_html    TEXT;
  v_app_url TEXT;
BEGIN
  v_app_url := CASE WHEN p_app_url = ''
    THEN (SELECT value FROM app_settings WHERE key = 'app_url')
    ELSE p_app_url END;
  v_app_url := COALESCE(v_app_url, 'https://localhost:5173');

  v_html :=
    '<!DOCTYPE html><html dir="rtl" lang="he">'
    || '<body style="font-family:Arial,sans-serif;background:#f5f5f5;padding:20px">'
    || '<div style="max-width:480px;margin:0 auto;background:#fff;border-radius:16px;padding:32px;box-shadow:0 2px 8px rgba(0,0,0,.08)">'
    || '<h2 style="color:#7c3aed;margin-top:0">🎁 שובר שותף איתך</h2>'
    || '<p>שלום ' || p_to_name || ',</p>'
    || '<p><strong>' || p_from_name || '</strong> שיתף/ה איתך שובר של <strong>' || p_store_name || '</strong>.</p>'
    || '<p>כנס/י לאפליקציה ותמצא/י את השובר בלשונית <strong>"שותף איתי"</strong>.</p>'
    || '<a href="' || v_app_url || '" style="display:inline-block;margin-top:16px;padding:12px 28px;background:#7c3aed;color:#fff;border-radius:12px;text-decoration:none;font-weight:bold">פתח ארנק שוברים</a>'
    || '</div></body></html>';

  RETURN send_email_http(
    p_to      := p_to_email,
    p_subject := p_from_name || ' שיתף/ה איתך שובר: ' || p_store_name,
    p_html    := v_html
  );
END;
$$;
GRANT EXECUTE ON FUNCTION send_voucher_shared_email TO authenticated;

-- ── send_voucher_share_invite_email ───────────────────────────
-- Invites an unregistered user to join and see the shared voucher
CREATE OR REPLACE FUNCTION send_voucher_share_invite_email(
  p_to_email   TEXT,
  p_from_name  TEXT,
  p_store_name TEXT,
  p_app_url    TEXT DEFAULT ''
)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_html    TEXT;
  v_app_url TEXT;
BEGIN
  v_app_url := CASE WHEN p_app_url = ''
    THEN (SELECT value FROM app_settings WHERE key = 'app_url')
    ELSE p_app_url END;
  v_app_url := COALESCE(v_app_url, 'https://localhost:5173');

  v_html :=
    '<!DOCTYPE html><html dir="rtl" lang="he">'
    || '<body style="font-family:Arial,sans-serif;background:#f5f5f5;padding:20px">'
    || '<div style="max-width:480px;margin:0 auto;background:#fff;border-radius:16px;padding:32px;box-shadow:0 2px 8px rgba(0,0,0,.08)">'
    || '<h2 style="color:#7c3aed;margin-top:0">🎁 הזמנה לשיתוף שובר</h2>'
    || '<p><strong>' || p_from_name || '</strong> רצה/ה לשתף איתך שובר של <strong>' || p_store_name || '</strong>.</p>'
    || '<p>הצטרף/י לאפליקציה — השובר יופיע אוטומטית בלשונית "שותף איתי" לאחר הרישום.</p>'
    || '<a href="' || v_app_url || '" style="display:inline-block;margin-top:16px;padding:12px 28px;background:#7c3aed;color:#fff;border-radius:12px;text-decoration:none;font-weight:bold">הצטרף/י לארנק שוברים</a>'
    || '</div></body></html>';

  RETURN send_email_http(
    p_to      := p_to_email,
    p_subject := p_from_name || ' הזמין/ה אותך לשתף שובר: ' || p_store_name,
    p_html    := v_html
  );
END;
$$;
GRANT EXECUTE ON FUNCTION send_voucher_share_invite_email TO authenticated;

-- ── send_wallet_invite_to_new_user ────────────────────────────
-- Sends a wallet invite to an email not yet registered
CREATE OR REPLACE FUNCTION send_wallet_invite_to_new_user(
  p_to_email    TEXT,
  p_from_name   TEXT,
  p_wallet_name TEXT,
  p_app_url     TEXT DEFAULT ''
)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN send_invite_email(
    p_to_email    := p_to_email,
    p_to_name     := p_to_email,
    p_from_name   := p_from_name,
    p_wallet_name := p_wallet_name,
    p_app_url     := p_app_url
  );
END;
$$;
GRANT EXECUTE ON FUNCTION send_wallet_invite_to_new_user TO authenticated;
