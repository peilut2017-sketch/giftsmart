-- Fix find_profile_by_email: case-insensitive + fallback to auth.users
-- Run this in Supabase Dashboard → SQL Editor
--
-- Problem: OAuth users (Google login) may have NULL in profiles.email —
-- the old function only searched profiles.email with case-sensitive =.
-- This caused "user not found" even for registered users.

CREATE OR REPLACE FUNCTION find_profile_by_email(search_email TEXT)
RETURNS TABLE(id UUID, name TEXT) LANGUAGE plpgsql SECURITY DEFINER STABLE AS $$
BEGIN
  -- 1. Case-insensitive search in profiles table
  RETURN QUERY
    SELECT p.id, COALESCE(p.name, p.email, search_email) AS name
    FROM profiles p
    WHERE LOWER(p.email) = LOWER(search_email)
    LIMIT 1;
  IF FOUND THEN RETURN; END IF;

  -- 2. Fallback: search auth.users — handles Google/OAuth users where
  --    profiles.email may be NULL (email is only in auth.users)
  RETURN QUERY
    SELECT
      au.id,
      COALESCE(p.name, au.email, search_email) AS name
    FROM auth.users au
    LEFT JOIN profiles p ON p.id = au.id
    WHERE LOWER(au.email) = LOWER(search_email)
    LIMIT 1;
END;
$$;
