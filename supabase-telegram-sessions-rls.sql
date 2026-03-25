-- Enable RLS on telegram_sessions
-- This table has no user_id — it's accessed only by the Edge Function
-- via service_role key (which bypasses RLS).
-- No policies = zero access via PostgREST for any authenticated/anon user.
ALTER TABLE public.telegram_sessions ENABLE ROW LEVEL SECURITY;
