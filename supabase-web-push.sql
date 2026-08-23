-- ─── Web Push subscriptions ──────────────────────────────────────────────────
-- Real server-side push: until now every "notification" was client-side only
-- (new Notification() while a tab is open). This stores each device's push
-- subscription so edge functions can reach users when the app is closed.
--
-- Run this in the Supabase SQL Editor, then:
--
-- 1. Generate VAPID keys once (locally):
--      npx web-push generate-vapid-keys
--
-- 2. Store the secrets (Dashboard → Edge Functions → Secrets):
--      VAPID_PUBLIC_KEY   = <public key>
--      VAPID_PRIVATE_KEY  = <private key>
--      VAPID_SUBJECT      = mailto:peilut2017@gmail.com
--    And in Vercel (frontend env):
--      VITE_VAPID_PUBLIC_KEY = <same public key>
--
-- 3. Deploy the functions:
--      supabase functions deploy send-push
--      supabase functions deploy push-expiry
--
-- 4. Schedule the daily expiry job (SQL Editor; requires pg_cron + pg_net):
--      SELECT cron.schedule('push-expiry', '0 6 * * *',
--        $$SELECT net.http_post(
--          url := '<SUPABASE_URL>/functions/v1/push-expiry',
--          headers := '{"Authorization": "Bearer <SERVICE_ROLE_KEY>"}'::jsonb
--        )$$
--      );
--    (06:00 UTC ≈ 08:00–09:00 בישראל, כל השנה.)

CREATE TABLE IF NOT EXISTS push_subscriptions (
  endpoint     text PRIMARY KEY,
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  p256dh       text NOT NULL,
  auth         text NOT NULL,
  user_agent   text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS push_subscriptions_user_idx ON push_subscriptions(user_id);

-- RLS on, no policies: all access goes through the SECURITY DEFINER RPCs below
-- (and the service-role key in edge functions).
ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION upsert_push_subscription(
  p_endpoint text,
  p_p256dh   text,
  p_auth     text,
  p_user_agent text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  INSERT INTO push_subscriptions (endpoint, user_id, p256dh, auth, user_agent)
  VALUES (p_endpoint, auth.uid(), p_p256dh, p_auth, p_user_agent)
  ON CONFLICT (endpoint) DO UPDATE
     SET user_id = auth.uid(),
         p256dh = EXCLUDED.p256dh,
         auth = EXCLUDED.auth,
         user_agent = EXCLUDED.user_agent,
         last_seen_at = now();
END;
$$;

CREATE OR REPLACE FUNCTION delete_push_subscription(p_endpoint text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  DELETE FROM push_subscriptions
   WHERE endpoint = p_endpoint AND user_id = auth.uid();
END;
$$;

REVOKE ALL ON FUNCTION upsert_push_subscription(text, text, text, text) FROM anon, public;
REVOKE ALL ON FUNCTION delete_push_subscription(text) FROM anon, public;
GRANT EXECUTE ON FUNCTION upsert_push_subscription(text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION delete_push_subscription(text) TO authenticated;
