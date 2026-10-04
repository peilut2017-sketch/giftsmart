-- Empirical probe: what does a trigger actually see (current_user, session_user,
-- auth.uid(), auth.role()) under each caller, and does that differ depending on
-- whether the trigger function itself is SECURITY DEFINER or SECURITY INVOKER,
-- and whether it fires directly vs. via a SECURITY DEFINER wrapper function?
-- No assumption is used downstream until this has run and been inspected.

\c giftsmart_test

CREATE TABLE IF NOT EXISTS probe_log (
  seq          serial PRIMARY KEY,
  caller_label text,
  trig_kind    text,     -- 'invoker' or 'definer'
  path         text,     -- 'direct_dml' or 'via_definer_fn'
  cur_user     text,
  sess_user    text,
  auth_uid     uuid,
  auth_role    text
);

CREATE TABLE IF NOT EXISTS probe_target (id int PRIMARY KEY, val text);

-- Trigger function variant 1: SECURITY INVOKER (default)
-- First run of this probe used an UNQUALIFIED "probe_log" here (no SET
-- search_path on this function at all, relying on inheriting the caller's
-- session search_path). That failed with "relation probe_log does not exist"
-- specifically on the via_definer_fn path: a SECURITY DEFINER caller's own
-- SET search_path='' turned out to apply to this trigger's execution too,
-- even though the trigger function itself never set search_path and is
-- SECURITY INVOKER. Direct anon/authenticated calls (no enclosing definer
-- function) worked fine with the unqualified name. That inconsistency is
-- itself the finding — recorded here, not smoothed over — and is why every
-- function that matters for security, trigger functions included, needs its
-- own explicit search_path, not an inherited one. Qualified below so the
-- rest of the probe can still run to completion.
CREATE OR REPLACE FUNCTION probe_trig_invoker() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO public.probe_log (caller_label, trig_kind, path, cur_user, sess_user, auth_uid, auth_role)
  VALUES (current_setting('probe.label', true), 'invoker', current_setting('probe.path', true),
          current_user, session_user, auth.uid(), auth.role());
  RETURN NEW;
END;
$$;

-- Trigger function variant 2: SECURITY DEFINER, owned by postgres (table owner)
CREATE OR REPLACE FUNCTION probe_trig_definer() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.probe_log (caller_label, trig_kind, path, cur_user, sess_user, auth_uid, auth_role)
  VALUES (current_setting('probe.label', true), 'definer', current_setting('probe.path', true),
          current_user, session_user, auth.uid(), auth.role());
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS t_invoker ON probe_target;
DROP TRIGGER IF EXISTS t_definer ON probe_target;
CREATE TRIGGER t_invoker BEFORE INSERT ON probe_target FOR EACH ROW EXECUTE FUNCTION probe_trig_invoker();
-- (one trigger kind at a time; we swap between runs further down)

GRANT INSERT, SELECT, DELETE ON probe_target TO anon, authenticated, service_role;
GRANT SELECT, INSERT ON probe_log TO anon, authenticated, service_role;
GRANT USAGE, SELECT ON SEQUENCE probe_log_seq_seq TO anon, authenticated, service_role;
-- Note: service_role has BYPASSRLS, which skips RLS *policy* checks only —
-- it still needs an ordinary table GRANT to touch the table at all. Found
-- this the hard way on the first run (permission denied for table
-- probe_target under service_role) before adding this GRANT.

-- A SECURITY DEFINER "RPC" wrapper, representing our planned admin RPC, that
-- itself performs the INSERT (so the trigger fires *underneath* a definer call).
CREATE OR REPLACE FUNCTION probe_rpc_wrapper(p_id int, p_val text) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- NOTE: this unqualified "probe_target" reference failed with search_path=''
  -- on first run (relation does not exist) — fixed by qualifying with public.,
  -- which is exactly the hardening condition #5 asks for. Left as a recorded
  -- empirical data point, not a hypothetical.
  INSERT INTO public.probe_target (id, val) VALUES (p_id, p_val);
END;
$$;
REVOKE ALL ON FUNCTION probe_rpc_wrapper(int, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION probe_rpc_wrapper(int, text) TO authenticated;

-- ── Round 1: trigger = SECURITY INVOKER ─────────────────────────────────────
SET ROLE anon;
SET request.jwt.claims = '{"role":"anon"}';
SET probe.label = 'anon_direct';
SET probe.path  = 'direct_dml';
INSERT INTO probe_target VALUES (1, 'x');
RESET ROLE;

SET ROLE authenticated;
SET request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
SET probe.label = 'authenticated_direct';
SET probe.path  = 'direct_dml';
INSERT INTO probe_target VALUES (2, 'x');
RESET ROLE;

SET ROLE authenticated;
SET request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
SET probe.label = 'authenticated_via_definer_rpc';
SET probe.path  = 'via_definer_fn';
SELECT probe_rpc_wrapper(3, 'x');
RESET ROLE;

SET ROLE service_role;
SET request.jwt.claims = '{"role":"service_role"}';
SET probe.label = 'service_role_direct';
SET probe.path  = 'direct_dml';
INSERT INTO probe_target VALUES (4, 'x');
RESET ROLE;

-- ── Round 2: swap in the SECURITY DEFINER trigger, repeat ──────────────────
DROP TRIGGER IF EXISTS t_invoker ON probe_target;
CREATE TRIGGER t_definer BEFORE INSERT ON probe_target FOR EACH ROW EXECUTE FUNCTION probe_trig_definer();

SET ROLE anon;
SET request.jwt.claims = '{"role":"anon"}';
SET probe.label = 'anon_direct';
SET probe.path  = 'direct_dml';
INSERT INTO probe_target VALUES (11, 'x');
RESET ROLE;

SET ROLE authenticated;
SET request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
SET probe.label = 'authenticated_direct';
SET probe.path  = 'direct_dml';
INSERT INTO probe_target VALUES (12, 'x');
RESET ROLE;

SET ROLE authenticated;
SET request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
SET probe.label = 'authenticated_via_definer_rpc';
SET probe.path  = 'via_definer_fn';
SELECT probe_rpc_wrapper(13, 'x');
RESET ROLE;

SET ROLE service_role;
SET request.jwt.claims = '{"role":"service_role"}';
SET probe.label = 'service_role_direct';
SET probe.path  = 'direct_dml';
INSERT INTO probe_target VALUES (14, 'x');
RESET ROLE;

-- Also: what does current_user look like for the OUTER statement itself
-- (not the trigger), under each role, for comparison.
SELECT trig_kind, path, caller_label, cur_user, sess_user, auth_uid, auth_role
FROM probe_log ORDER BY seq;
