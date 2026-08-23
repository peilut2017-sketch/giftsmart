-- Marketplace payment methods: move the last direct table write behind an RPC.
-- The frontend used supabase.from('profiles').update({marketplace_payment_methods})
-- directly, against the project rule that all mutations go through
-- SECURITY DEFINER RPCs. Run this in the Supabase SQL Editor.

CREATE OR REPLACE FUNCTION set_payment_methods(p_methods jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  -- Only an array of {type, value} objects is a valid payload
  IF jsonb_typeof(p_methods) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'invalid_payload';
  END IF;

  UPDATE profiles
     SET marketplace_payment_methods = p_methods
   WHERE id = auth.uid();
END;
$$;

REVOKE ALL ON FUNCTION set_payment_methods(jsonb) FROM anon, public;
GRANT EXECUTE ON FUNCTION set_payment_methods(jsonb) TO authenticated;
