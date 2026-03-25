-- Enable RLS on telegram_sessions
ALTER TABLE public.telegram_sessions ENABLE ROW LEVEL SECURITY;

-- Users can only access their own telegram sessions
-- Assumes telegram_sessions has a user_id column referencing auth.users
CREATE POLICY "Users can read own telegram sessions"
  ON public.telegram_sessions
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own telegram sessions"
  ON public.telegram_sessions
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own telegram sessions"
  ON public.telegram_sessions
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own telegram sessions"
  ON public.telegram_sessions
  FOR DELETE
  USING (auth.uid() = user_id);
