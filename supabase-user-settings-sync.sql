-- Sync notification/reminder settings per user across devices.
-- reminder_days, notif_channels, and calendar_reminder_enabled are stored in
-- localStorage today (per-device). These columns let every device pick up the
-- same values on first load.
--
-- Run once in: Supabase Dashboard → SQL Editor
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS reminder_days               integer DEFAULT 14,
  ADD COLUMN IF NOT EXISTS notif_channels              jsonb   DEFAULT '{"push":true,"email":false,"telegram":true}',
  ADD COLUMN IF NOT EXISTS calendar_reminder_enabled   boolean DEFAULT true;

-- Save all three settings at once for the calling user
CREATE OR REPLACE FUNCTION public.upsert_user_settings(
  p_reminder_days             integer,
  p_notif_channels            jsonb,
  p_calendar_reminder_enabled boolean
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE profiles
  SET reminder_days             = p_reminder_days,
      notif_channels            = p_notif_channels,
      calendar_reminder_enabled = p_calendar_reminder_enabled
  WHERE id = auth.uid();
END;
$$;
GRANT EXECUTE ON FUNCTION public.upsert_user_settings(integer, jsonb, boolean) TO authenticated;

-- Read all three settings for the calling user
CREATE OR REPLACE FUNCTION public.get_user_settings()
RETURNS TABLE(reminder_days integer, notif_channels jsonb, calendar_reminder_enabled boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN QUERY
    SELECT p.reminder_days, p.notif_channels, p.calendar_reminder_enabled
    FROM profiles p
    WHERE p.id = auth.uid();
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_user_settings() TO authenticated;

SELECT pg_notify('pgrst', 'reload schema');
