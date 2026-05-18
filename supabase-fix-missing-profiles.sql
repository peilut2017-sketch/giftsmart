-- Fix: some auth.users rows have no matching profiles row.
--
-- Root cause: the handle_new_user trigger either didn't exist yet,
-- or failed (e.g. due to a notify_admin_telegram error without a proper
-- EXCEPTION block) when those users first registered.
--
-- Steps:
--   1. Backfill every auth.users row that is missing a profiles row.
--   2. Harden handle_new_user so future registrations never silently fail.
--
-- Run once in: Supabase Dashboard → SQL Editor
-- ─────────────────────────────────────────────────────────────────────────────


-- ── 1. Backfill missing profiles ─────────────────────────────────────────────

INSERT INTO public.profiles (id, email, name, created_at)
SELECT
  u.id,
  u.email,
  COALESCE(
    NULLIF(TRIM(u.raw_user_meta_data->>'name'), ''),
    NULLIF(TRIM(u.raw_user_meta_data->>'full_name'), ''),
    split_part(u.email, '@', 1)
  ),
  u.created_at
FROM auth.users u
WHERE NOT EXISTS (
  SELECT 1 FROM public.profiles p WHERE p.id = u.id
);

-- Show how many rows were inserted
DO $$
DECLARE
  v_count int;
BEGIN
  SELECT COUNT(*) INTO v_count
  FROM auth.users u
  WHERE NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = u.id);

  IF v_count = 0 THEN
    RAISE NOTICE 'Backfill complete — no remaining gaps.';
  ELSE
    RAISE WARNING 'Still % auth.users rows without a profiles row!', v_count;
  END IF;
END;
$$;


-- ── 2. Harden handle_new_user ─────────────────────────────────────────────────
--
-- Wrap the entire body in BEGIN…EXCEPTION so that even if the INSERT into
-- profiles fails (e.g. duplicate key on a retry), it never rolls back the
-- auth.users INSERT and never blocks the user from registering.

CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  BEGIN
    INSERT INTO public.profiles (id, email, name, created_at)
    VALUES (
      NEW.id,
      NEW.email,
      COALESCE(
        NULLIF(TRIM(NEW.raw_user_meta_data->>'name'), ''),
        NULLIF(TRIM(NEW.raw_user_meta_data->>'full_name'), ''),
        split_part(NEW.email, '@', 1)
      ),
      NEW.created_at
    )
    ON CONFLICT (id) DO NOTHING;   -- idempotent: skip if profile already exists
  EXCEPTION WHEN OTHERS THEN
    -- Log but never propagate — registration must always succeed
    RAISE WARNING 'handle_new_user: failed to create profile for %: %', NEW.id, SQLERRM;
  END;
  RETURN NEW;
END;
$$;

-- Re-create the trigger (drop first to reset any broken state)
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();


-- ── 3. Verify ─────────────────────────────────────────────────────────────────

SELECT
  (SELECT COUNT(*) FROM auth.users)    AS auth_users_total,
  (SELECT COUNT(*) FROM public.profiles) AS profiles_total,
  (SELECT COUNT(*) FROM auth.users u
   WHERE NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = u.id)
  )                                      AS still_missing;
