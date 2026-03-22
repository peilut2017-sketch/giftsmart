-- ─── Telegram Integration Tables ─────────────────────────────────────────────

-- Links a Telegram chat_id to an app user
CREATE TABLE IF NOT EXISTS telegram_users (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  chat_id    bigint UNIQUE NOT NULL,
  username   text,
  linked_at  timestamptz DEFAULT now()
);

ALTER TABLE telegram_users ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own telegram link"
  ON telegram_users FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Users can delete own telegram link"
  ON telegram_users FOR DELETE
  USING (user_id = auth.uid());

-- One-time codes used to link Telegram account from the app
CREATE TABLE IF NOT EXISTS telegram_link_codes (
  code        text PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  expires_at  timestamptz NOT NULL DEFAULT (now() + interval '10 minutes'),
  used        boolean DEFAULT false
);

ALTER TABLE telegram_link_codes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can insert own link codes"
  ON telegram_link_codes FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can read own link codes"
  ON telegram_link_codes FOR SELECT
  USING (user_id = auth.uid());

-- Conversation state for multi-step flows (e.g. /add)
CREATE TABLE IF NOT EXISTS telegram_sessions (
  chat_id     bigint PRIMARY KEY,
  state       text NOT NULL,
  data        jsonb DEFAULT '{}',
  updated_at  timestamptz DEFAULT now()
);

-- No RLS needed on sessions — accessed only by service role via Edge Function
