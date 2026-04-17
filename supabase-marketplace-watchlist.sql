-- ─────────────────────────────────────────────────────────────────────────────
-- Marketplace Watchlist & Alerts
-- Run AFTER supabase-marketplace-settings.sql
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── watchlist table ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS marketplace_watchlist (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  store_name       TEXT        NOT NULL,
  min_discount_pct INT         NOT NULL DEFAULT 0 CHECK (min_discount_pct >= 0 AND min_discount_pct <= 99),
  notify_push      BOOLEAN     NOT NULL DEFAULT TRUE,
  notify_email     BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, store_name)
);

ALTER TABLE marketplace_watchlist ENABLE ROW LEVEL SECURITY;
CREATE POLICY "watchlist_own" ON marketplace_watchlist
  FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- ─── marketplace_notifications (in-app + email queue) ────────────────────────
CREATE TABLE IF NOT EXISTS marketplace_notifications (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type        TEXT        NOT NULL DEFAULT 'watchlist_match',
  title       TEXT        NOT NULL,
  body        TEXT        NOT NULL,
  listing_id  UUID        REFERENCES marketplace_listings(id) ON DELETE SET NULL,
  is_read     BOOLEAN     NOT NULL DEFAULT FALSE,
  email_sent  BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mkt_notif_user
  ON marketplace_notifications (user_id, is_read, created_at DESC);

ALTER TABLE marketplace_notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "notif_own" ON marketplace_notifications
  FOR ALL USING (user_id = auth.uid());

-- Realtime
ALTER TABLE marketplace_notifications REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE marketplace_notifications;

-- ─── RPC helpers ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION get_my_watchlist()
RETURNS SETOF marketplace_watchlist LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT * FROM marketplace_watchlist WHERE user_id = auth.uid() ORDER BY created_at DESC;
$$;

CREATE OR REPLACE FUNCTION add_watchlist_item(
  p_store_name       TEXT,
  p_min_discount_pct INT     DEFAULT 0,
  p_notify_push      BOOLEAN DEFAULT TRUE,
  p_notify_email     BOOLEAN DEFAULT FALSE
) RETURNS marketplace_watchlist LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_item marketplace_watchlist;
BEGIN
  -- Gate: watchlist_pro_only → check subscription
  IF (SELECT watchlist_pro_only FROM marketplace_settings LIMIT 1) THEN
    IF NOT EXISTS (
      SELECT 1 FROM subscriptions
      WHERE user_id = auth.uid() AND plan = 'pro' AND status = 'active'
        AND (current_period_end IS NULL OR current_period_end > NOW())
    ) THEN
      -- Also allow if premium is disabled system-wide
      BEGIN
        IF (SELECT premium_enabled FROM admin_settings LIMIT 1) THEN
          RAISE EXCEPTION 'pro_required';
        END IF;
      EXCEPTION WHEN OTHERS THEN NULL; END;
    END IF;
  END IF;

  INSERT INTO marketplace_watchlist (user_id, store_name, min_discount_pct, notify_push, notify_email)
  VALUES (auth.uid(), trim(p_store_name), p_min_discount_pct, p_notify_push, p_notify_email)
  ON CONFLICT (user_id, store_name) DO UPDATE SET
    min_discount_pct = EXCLUDED.min_discount_pct,
    notify_push      = EXCLUDED.notify_push,
    notify_email     = EXCLUDED.notify_email
  RETURNING * INTO v_item;

  RETURN v_item;
END;
$$;

CREATE OR REPLACE FUNCTION delete_watchlist_item(p_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  DELETE FROM marketplace_watchlist WHERE id = p_id AND user_id = auth.uid();
END;
$$;

CREATE OR REPLACE FUNCTION get_my_marketplace_notifications(p_limit INT DEFAULT 20)
RETURNS SETOF marketplace_notifications LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT * FROM marketplace_notifications
  WHERE user_id = auth.uid()
  ORDER BY created_at DESC
  LIMIT p_limit;
$$;

CREATE OR REPLACE FUNCTION mark_notifications_read()
RETURNS VOID LANGUAGE sql SECURITY DEFINER AS $$
  UPDATE marketplace_notifications SET is_read = TRUE
  WHERE user_id = auth.uid() AND is_read = FALSE;
$$;

-- ─── Trigger: notify watchlist users when new listing is created ──────────────
CREATE OR REPLACE FUNCTION _notify_watchlist_on_listing()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_balance     NUMERIC;
  v_discount    INT;
  v_store_name  TEXT;
  v_watcher     RECORD;
  v_title       TEXT;
  v_body        TEXT;
BEGIN
  IF NEW.status <> 'active' THEN RETURN NEW; END IF;

  -- Get balance from voucher
  SELECT balance, store_name INTO v_balance, v_store_name
  FROM vouchers WHERE id = NEW.voucher_id;

  -- Calculate discount %
  IF v_balance IS NULL OR v_balance = 0 THEN RETURN NEW; END IF;
  v_discount := ROUND(((v_balance - NEW.asking_price) / v_balance) * 100)::INT;

  v_title := '🛍 שובר חדש: ' || COALESCE(v_store_name, NEW.voucher_id::TEXT);
  v_body  := '₪' || v_balance || ' ב-₪' || NEW.asking_price
             || CASE WHEN v_discount > 0 THEN ' (חיסכון ' || v_discount || '%)' ELSE '' END;

  -- Insert notification for each matching watcher
  FOR v_watcher IN
    SELECT w.user_id, w.notify_push, w.notify_email
    FROM marketplace_watchlist w
    WHERE lower(trim(w.store_name)) = lower(trim(v_store_name))
      AND w.min_discount_pct <= v_discount
      AND w.user_id <> NEW.seller_id
  LOOP
    INSERT INTO marketplace_notifications
      (user_id, type, title, body, listing_id)
    VALUES
      (v_watcher.user_id, 'watchlist_match', v_title, v_body, NEW.id);
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS notify_watchlist_on_listing ON marketplace_listings;
CREATE TRIGGER notify_watchlist_on_listing
  AFTER INSERT ON marketplace_listings
  FOR EACH ROW EXECUTE FUNCTION _notify_watchlist_on_listing();
