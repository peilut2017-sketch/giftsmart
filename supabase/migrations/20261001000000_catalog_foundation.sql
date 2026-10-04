-- ============================================================================
-- Catalog foundation — additive only. Adds a managed multi-voucher business
-- catalog (BUYME ALL / Swish Plus / Gifta, extensible to more) without
-- touching existing super_vouchers rows' id/wallet_id, without deleting or
-- recreating rows, and without auto-linking any existing voucher.
--
-- Revision 2 — incorporates an independent code review's confirmed findings
-- (see test/catalog-security/REVIEW_RESPONSE.md for the finding-by-finding
-- trace). Every change below is cross-referenced to the finding it fixes.
--
-- Design notes:
--   * `stores` and `search_terms` are physically-stored, always-recomputed
--     mirror columns on super_vouchers. A BEFORE INSERT/UPDATE trigger
--     (super_vouchers_sync_cache) recomputes them from NEW.stores_manual +
--     NEW.catalog_product_key on every write, from ANY path (RPC or a
--     wallet owner's own direct write to their private row) — finding #9:
--     the old version only computed this inside two RPCs, which was not
--     actually structural. Old cached PWA clients doing a plain select('*')
--     keep working with a fresh, correct `stores` value.
--   * No read RPC: the existing SELECT policy on super_vouchers is
--     untouched, so visibility (own wallet OR is_global) can't regress by
--     reimplementing it elsewhere. Finding #3 restores an owner-SELECT path
--     the old FOR ALL policy used to provide, which the split write
--     policies below do not.
--   * auth.uid()/auth.role() are reliable inside a trigger regardless of
--     invoker/definer or direct/nested-call path; current_user/session_user
--     are NOT and must never be used for identity checks here — empirically
--     verified in test/catalog-security/proofs/01_identity_probe.sql.
-- ============================================================================

-- ── 1. Catalog tables (service_role only — no client access, ever) ─────────

CREATE TABLE IF NOT EXISTS public.catalog_products (
  product_key         text PRIMARY KEY CHECK (product_key ~ '^[a-z0-9_]+$'),
  display_name_he     text NOT NULL,
  display_name_en     text,
  source_type         text NOT NULL,
  source_identity     jsonb NOT NULL DEFAULT '{}'::jsonb,
  enabled             boolean NOT NULL DEFAULT false,
  min_expected_count  int NOT NULL DEFAULT 1,
  max_removal_ratio   numeric NOT NULL DEFAULT 0.2,
  schema_version      int NOT NULL DEFAULT 1,
  notes               text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.catalog_snapshots (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_key     text NOT NULL REFERENCES public.catalog_products(product_key) ON DELETE CASCADE,
  snapshot_version int NOT NULL,
  fetched_at      timestamptz NOT NULL,
  source_hash     text NOT NULL,
  item_count      int NOT NULL,
  status          text NOT NULL CHECK (status IN ('pending', 'applied', 'rejected')),
  reject_reason   text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (product_key, snapshot_version)
);

CREATE TABLE IF NOT EXISTS public.catalog_items (
  product_key     text NOT NULL REFERENCES public.catalog_products(product_key) ON DELETE CASCADE,
  canonical_name  text NOT NULL,
  name_he         text,
  name_en         text,
  aliases         text[] NOT NULL DEFAULT '{}',
  source_item_id  text,
  snapshot_version int NOT NULL,
  PRIMARY KEY (product_key, canonical_name)
);

CREATE TABLE IF NOT EXISTS public.catalog_audit (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_key     text NOT NULL,
  snapshot_version int,
  action          text NOT NULL,
  count_before    int,
  count_after     int,
  added_count     int,
  removed_count   int,
  reason          text,
  performed_at    timestamptz NOT NULL DEFAULT now(),
  performed_by    text
);

ALTER TABLE public.catalog_products  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.catalog_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.catalog_items     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.catalog_audit     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.catalog_products  FORCE ROW LEVEL SECURITY;
ALTER TABLE public.catalog_snapshots FORCE ROW LEVEL SECURITY;
ALTER TABLE public.catalog_items     FORCE ROW LEVEL SECURITY;
ALTER TABLE public.catalog_audit     FORCE ROW LEVEL SECURITY;
-- Deliberately zero policies: RLS + no policy = nobody without BYPASSRLS
-- (i.e. no one but service_role) can read or write these tables at all.

REVOKE ALL ON public.catalog_products, public.catalog_snapshots, public.catalog_items, public.catalog_audit
  FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.catalog_products, public.catalog_snapshots, public.catalog_items, public.catalog_audit
  TO service_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO service_role;

-- ── 2. New super_vouchers columns (additive, nullable, no default behavior change) ──

ALTER TABLE public.super_vouchers
  ADD COLUMN IF NOT EXISTS catalog_product_key text,
  ADD COLUMN IF NOT EXISTS stores_manual text[],
  ADD COLUMN IF NOT EXISTS stores_catalog_version int,
  ADD COLUMN IF NOT EXISTS search_terms text[];

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'super_vouchers_catalog_product_key_fkey'
  ) THEN
    ALTER TABLE public.super_vouchers
      ADD CONSTRAINT super_vouchers_catalog_product_key_fkey
      FOREIGN KEY (catalog_product_key) REFERENCES public.catalog_products(product_key)
      ON DELETE SET NULL;
  END IF;
END $$;

-- ── 3. Shared merge helpers ──────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.catalog_effective_stores(p_manual text[], p_product_key text)
RETURNS text[]
LANGUAGE sql STABLE
SET search_path = ''
AS $$
  SELECT COALESCE(array_agg(DISTINCT s ORDER BY s), '{}'::text[])
  FROM (
    SELECT btrim(unnest(COALESCE(p_manual, '{}'::text[]))) AS s
    UNION
    SELECT btrim(ci.canonical_name) AS s
    FROM public.catalog_items ci
    WHERE p_product_key IS NOT NULL AND ci.product_key = p_product_key
  ) u
  WHERE s IS NOT NULL AND s <> ''
$$;

CREATE OR REPLACE FUNCTION public.catalog_effective_search_terms(p_manual text[], p_product_key text)
RETURNS text[]
LANGUAGE sql STABLE
SET search_path = ''
AS $$
  SELECT COALESCE(array_agg(DISTINCT s ORDER BY s), '{}'::text[])
  FROM (
    SELECT btrim(unnest(COALESCE(p_manual, '{}'::text[]))) AS s
    UNION
    SELECT btrim(ci.canonical_name) AS s
    FROM public.catalog_items ci
    WHERE p_product_key IS NOT NULL AND ci.product_key = p_product_key
    UNION
    SELECT btrim(a) AS s
    FROM public.catalog_items ci, unnest(ci.aliases) AS a
    WHERE p_product_key IS NOT NULL AND ci.product_key = p_product_key
  ) u
  WHERE s IS NOT NULL AND s <> ''
$$;

REVOKE ALL ON FUNCTION public.catalog_effective_stores(text[], text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.catalog_effective_search_terms(text[], text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.catalog_effective_stores(text[], text) TO service_role;
GRANT EXECUTE ON FUNCTION public.catalog_effective_search_terms(text[], text) TO service_role;
-- NOTE: the sync-cache trigger (section 6) is SECURITY DEFINER / owned by
-- the migration role, so it can call these without needing its own GRANT —
-- same reasoning as every other internal helper call in this file.

-- ── 4. RLS: replace the single FOR ALL policy with per-command policies ────
-- PERMISSIVE policies OR together — the old FOR ALL policy MUST be dropped,
-- not left alongside the new ones, or it alone still permits everything.

DROP POLICY IF EXISTS "Wallet owners can manage super vouchers" ON public.super_vouchers;

-- Finding #3: the old FOR ALL policy also granted SELECT to a wallet OWNER
-- who might not (for whatever historical/edge-case reason) be a row in
-- wallet_members for that wallet. The existing "sv_select" policy only
-- covers membership + is_global. Restore the owner path explicitly as its
-- own additive SELECT policy, without touching any write policy.
DROP POLICY IF EXISTS "sv_select_owner" ON public.super_vouchers;
CREATE POLICY "sv_select_owner" ON public.super_vouchers
  FOR SELECT TO authenticated
  USING (wallet_id IN (SELECT id FROM public.wallets WHERE owner_id = auth.uid()));

CREATE POLICY "sv_insert_owner_unmanaged" ON public.super_vouchers
  FOR INSERT TO authenticated
  WITH CHECK (
    wallet_id IN (SELECT id FROM public.wallets WHERE owner_id = auth.uid())
    AND is_global = false
    AND catalog_product_key IS NULL
  );

CREATE POLICY "sv_update_owner_unmanaged" ON public.super_vouchers
  FOR UPDATE TO authenticated
  USING (
    wallet_id IN (SELECT id FROM public.wallets WHERE owner_id = auth.uid())
    AND is_global = false
    AND catalog_product_key IS NULL
  )
  WITH CHECK (
    wallet_id IN (SELECT id FROM public.wallets WHERE owner_id = auth.uid())
    AND is_global = false
    AND catalog_product_key IS NULL
  );

CREATE POLICY "sv_delete_owner_unmanaged" ON public.super_vouchers
  FOR DELETE TO authenticated
  USING (
    wallet_id IN (SELECT id FROM public.wallets WHERE owner_id = auth.uid())
    AND is_global = false
    AND catalog_product_key IS NULL
  );

-- ── 5. Trigger: id/wallet_id are immutable, unconditionally, for everyone ──

CREATE OR REPLACE FUNCTION public.super_vouchers_prevent_identity_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION 'super_vouchers.id is immutable';
  END IF;
  IF NEW.wallet_id IS DISTINCT FROM OLD.wallet_id THEN
    RAISE EXCEPTION 'super_vouchers.wallet_id is immutable';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.super_vouchers_prevent_identity_change() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS sv_prevent_identity_change ON public.super_vouchers;
CREATE TRIGGER sv_prevent_identity_change
  BEFORE UPDATE ON public.super_vouchers
  FOR EACH ROW EXECUTE FUNCTION public.super_vouchers_prevent_identity_change();

-- ── 6. Trigger: defense-in-depth for is_global / catalog_product_key ───────

CREATE OR REPLACE FUNCTION public.super_vouchers_protect_managed_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_is_admin boolean;
BEGIN
  IF auth.role() = 'service_role' THEN
    RETURN NEW;
  END IF;

  IF NEW.is_global = true OR NEW.catalog_product_key IS NOT NULL THEN
    SELECT is_admin INTO v_is_admin FROM public.profiles WHERE id = auth.uid();
    IF v_is_admin IS NOT TRUE THEN
      RAISE EXCEPTION 'only an admin or the catalog pipeline may set is_global or catalog_product_key';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.super_vouchers_protect_managed_fields() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS sv_protect_managed_fields ON public.super_vouchers;
CREATE TRIGGER sv_protect_managed_fields
  BEFORE INSERT OR UPDATE ON public.super_vouchers
  FOR EACH ROW EXECUTE FUNCTION public.super_vouchers_protect_managed_fields();

-- ── 6b. Trigger: structural cache sync (finding #9) ─────────────────────────
-- Recomputes stores/search_terms from NEW.stores_manual + NEW.catalog_product_key
-- on EVERY insert/update, regardless of which path wrote the row — an owner's
-- own direct write to their private row included. The two RPCs below no
-- longer need to (and don't) compute these columns themselves.

CREATE OR REPLACE FUNCTION public.super_vouchers_sync_cache()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  NEW.stores := public.catalog_effective_stores(NEW.stores_manual, NEW.catalog_product_key);
  NEW.search_terms := public.catalog_effective_search_terms(NEW.stores_manual, NEW.catalog_product_key);
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.super_vouchers_sync_cache() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS sv_sync_cache ON public.super_vouchers;
CREATE TRIGGER sv_sync_cache
  BEFORE INSERT OR UPDATE ON public.super_vouchers
  FOR EACH ROW EXECUTE FUNCTION public.super_vouchers_sync_cache();

-- ── 6c. Trigger: block deleting a wallet that holds a global/managed row ───
-- Finding #4 (minimal fix per explicit decision: block, don't re-home).
-- Fires for a cascade-triggered delete too (e.g. via auth.users cascade in
-- delete_own_account()/admin_delete_user()) — any exception here aborts the
-- WHOLE transaction, so the account/wallet delete fails outright rather than
-- silently orphaning a catalog shared by every user. No service_role bypass:
-- unlinking/reassigning must be a deliberate, separate, visible action first.

CREATE OR REPLACE FUNCTION public.wallets_block_delete_if_holds_managed_sv()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.super_vouchers
     WHERE wallet_id = OLD.id AND (is_global = true OR catalog_product_key IS NOT NULL)
  ) THEN
    RAISE EXCEPTION 'wallet_holds_managed_super_voucher'
      USING HINT = 'Unlink or un-globalize this wallet''s super_vouchers row(s) before deleting it.';
  END IF;
  RETURN OLD;
END;
$$;
REVOKE ALL ON FUNCTION public.wallets_block_delete_if_holds_managed_sv() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS wallets_block_managed_delete ON public.wallets;
CREATE TRIGGER wallets_block_managed_delete
  BEFORE DELETE ON public.wallets
  FOR EACH ROW EXECUTE FUNCTION public.wallets_block_delete_if_holds_managed_sv();

-- ── 7. REVOKE unneeded table-level privileges (belt and suspenders) ────────

REVOKE TRUNCATE, REFERENCES, TRIGGER ON public.super_vouchers FROM anon, authenticated;

-- ── 8. Admin write RPCs ──────────────────────────────────────────────────────
-- Explicit column list, no whole-row parameter. UPDATE by existing id only,
-- never delete+recreate. stores/search_terms are NOT set here — the sync-
-- cache trigger (6b) computes them structurally.
--
-- Finding #8: p_wallet_id is now required and server-verified on create —
-- no more "guess the admin's first wallet" (LIMIT 1, no ORDER BY).

CREATE OR REPLACE FUNCTION public.admin_upsert_super_voucher(
  p_id                uuid,
  p_wallet_id         uuid,
  p_name              text,
  p_stores_manual     text[],
  p_balance_check_url text,
  p_is_global         boolean,
  p_description       text DEFAULT NULL
) RETURNS public.super_vouchers
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_row public.super_vouchers;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = true) THEN
    RAISE EXCEPTION 'not_admin';
  END IF;
  IF p_name IS NULL OR btrim(p_name) = '' THEN
    RAISE EXCEPTION 'invalid_name';
  END IF;

  IF p_id IS NULL THEN
    IF p_wallet_id IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.wallets WHERE id = p_wallet_id AND owner_id = auth.uid()
    ) THEN
      RAISE EXCEPTION 'invalid_wallet';
    END IF;
    INSERT INTO public.super_vouchers (wallet_id, name, description, stores_manual, balance_check_url, is_global)
    VALUES (p_wallet_id, p_name, p_description, COALESCE(p_stores_manual, '{}'), p_balance_check_url, COALESCE(p_is_global, false))
    RETURNING * INTO v_row;
  ELSE
    -- p_description is NULL on every existing edit-form call (the UI has no
    -- description field in the edit view) — COALESCE so that keeps meaning
    -- "leave unchanged", not "clear it out". p_wallet_id is ignored on
    -- update: wallet_id is identity-immutable (trigger 5), not editable here.
    --
    -- stores_manual follows the SAME "NULL means leave unchanged" rule as
    -- description — NOT "NULL means set to {}" (the prior behavior here).
    -- The sync-cache trigger treats any change to stores_manual, including
    -- a change TO '{}', as a real manual edit and recomputes `stores`
    -- accordingly; a caller that omits stores_manual because it isn't
    -- touching stores at all (e.g. fixing a typo in the name) must never be
    -- able to blank the row's real content as a side effect of that. To
    -- genuinely clear the manual list, a caller must pass an explicit '{}',
    -- which COALESCE still honors (only a literal NULL falls through).
    UPDATE public.super_vouchers
       SET name              = p_name,
           description       = COALESCE(p_description, description),
           stores_manual     = COALESCE(p_stores_manual, stores_manual),
           balance_check_url = p_balance_check_url,
           is_global         = COALESCE(p_is_global, is_global),
           updated_at        = now()
     WHERE id = p_id
     RETURNING * INTO v_row;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'not_found';
    END IF;
  END IF;

  RETURN v_row;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_upsert_super_voucher(uuid, uuid, text, text[], text, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_upsert_super_voucher(uuid, uuid, text, text[], text, boolean, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_delete_super_voucher(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = true) THEN
    RAISE EXCEPTION 'not_admin';
  END IF;
  DELETE FROM public.super_vouchers WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_delete_super_voucher(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_delete_super_voucher(uuid) TO authenticated;

-- ── 9. Link / unlink RPCs (finding #2) ──────────────────────────────────────
-- Callable by an authenticated admin directly (SECURITY DEFINER + internal
-- is_admin check) — no service-role key in the browser. Linking requires the
-- admin to pass the exact manual-extras list they reviewed (no silent
-- backfill of the old `stores` array); unlinking clears the catalog side
-- immediately via the sync-cache trigger. Both audited.

CREATE OR REPLACE FUNCTION public.admin_preview_catalog_link(p_super_voucher_id uuid, p_product_key text)
RETURNS TABLE(current_stores text[], catalog_stores text[], would_add text[], would_remove text[])
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_current text[];
  v_catalog text[];
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = true) THEN
    RAISE EXCEPTION 'not_admin';
  END IF;
  SELECT stores INTO v_current FROM public.super_vouchers WHERE id = p_super_voucher_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found';
  END IF;
  v_catalog := public.catalog_effective_stores(NULL, p_product_key);
  RETURN QUERY SELECT
    v_current,
    v_catalog,
    (SELECT COALESCE(array_agg(s ORDER BY s), '{}') FROM unnest(v_catalog) s WHERE NOT (s = ANY(COALESCE(v_current, '{}')))),
    (SELECT COALESCE(array_agg(s ORDER BY s), '{}') FROM unnest(COALESCE(v_current, '{}')) s WHERE NOT (s = ANY(v_catalog)));
END;
$$;
REVOKE ALL ON FUNCTION public.admin_preview_catalog_link(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_preview_catalog_link(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_link_catalog_product(
  p_super_voucher_id uuid,
  p_product_key      text,
  p_manual_extras    text[] -- the admin-confirmed set of manual additions to KEEP, from the preview diff. '{}' if none.
) RETURNS public.super_vouchers
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_row public.super_vouchers;
  v_count_before int;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = true) THEN
    RAISE EXCEPTION 'not_admin';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.catalog_products WHERE product_key = p_product_key AND enabled = true) THEN
    RAISE EXCEPTION 'unknown_or_disabled_product';
  END IF;

  SELECT array_length(stores, 1) INTO v_count_before FROM public.super_vouchers WHERE id = p_super_voucher_id;
  IF v_count_before IS NULL THEN v_count_before := 0; END IF;

  UPDATE public.super_vouchers
     SET catalog_product_key = p_product_key,
         stores_manual = COALESCE(p_manual_extras, '{}'),
         updated_at = now()
   WHERE id = p_super_voucher_id
   RETURNING * INTO v_row;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found';
  END IF;

  INSERT INTO public.catalog_audit (product_key, action, count_before, count_after, performed_by)
  VALUES (p_product_key, 'linked', v_count_before, array_length(v_row.stores, 1), 'admin:' || auth.uid()::text);

  RETURN v_row;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_link_catalog_product(uuid, text, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_link_catalog_product(uuid, text, text[]) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_unlink_catalog_product(p_super_voucher_id uuid)
RETURNS public.super_vouchers
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_row public.super_vouchers;
  v_old_product text;
  v_count_before int;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = true) THEN
    RAISE EXCEPTION 'not_admin';
  END IF;

  SELECT catalog_product_key, array_length(stores, 1) INTO v_old_product, v_count_before
    FROM public.super_vouchers WHERE id = p_super_voucher_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found';
  END IF;

  UPDATE public.super_vouchers
     SET catalog_product_key = NULL,
         stores_catalog_version = NULL,
         updated_at = now()
   WHERE id = p_super_voucher_id
   RETURNING * INTO v_row;

  IF v_old_product IS NOT NULL THEN
    INSERT INTO public.catalog_audit (product_key, action, count_before, count_after, performed_by)
    VALUES (v_old_product, 'unlinked', v_count_before, array_length(v_row.stores, 1), 'admin:' || auth.uid()::text);
  END IF;

  RETURN v_row;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_unlink_catalog_product(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_unlink_catalog_product(uuid) TO authenticated;

-- ── 10. Catalog apply RPC (service_role only — called by ingest-catalog) ───
-- Atomic. Findings fixed here: #1 (idempotency keyed to the LATEST snapshot
-- only, not all history; identical resend backfills unsynced linked rows
-- instead of being a true no-op), #5 (counts computed on the normalized/
-- de-duplicated item set, not the raw JSON array length), #6 (schema_version
-- and source_identity enforced against the registered catalog_products row,
-- not just a business count).

CREATE OR REPLACE FUNCTION public.catalog_apply_snapshot(
  p_product_key      text,
  p_source_hash      text,
  p_fetched_at       timestamptz,
  p_schema_version   int,
  p_source_identity  jsonb,
  p_items            jsonb -- [{"canonical_name","name_he","name_en","aliases":[...]}, ...]
) RETURNS public.catalog_snapshots
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_product          public.catalog_products;
  v_latest           public.catalog_snapshots;
  v_normalized_items jsonb;
  v_count_before     int;
  v_count_new        int;
  v_removed          int;
  v_snapshot         public.catalog_snapshots;
  v_snapshot_version int;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service_role_only';
  END IF;

  -- FOR UPDATE serializes concurrent applies for the SAME product.
  SELECT * INTO v_product FROM public.catalog_products WHERE product_key = p_product_key FOR UPDATE;
  IF NOT FOUND OR v_product.enabled IS NOT TRUE THEN
    RAISE EXCEPTION 'unknown_or_disabled_product';
  END IF;

  SELECT * INTO v_latest
    FROM public.catalog_snapshots
   WHERE product_key = p_product_key
   ORDER BY snapshot_version DESC
   LIMIT 1;

  -- ── Identical resend: success, no new version, but still backfill any
  --    row that got linked since the last apply (finding #1). ──
  IF FOUND AND v_latest.status = 'applied' AND v_latest.source_hash = p_source_hash THEN
    UPDATE public.super_vouchers
       SET stores_catalog_version = v_latest.snapshot_version, -- trigger recomputes stores/search_terms as a side effect
           updated_at = now()
     WHERE catalog_product_key = p_product_key
       AND stores_catalog_version IS DISTINCT FROM v_latest.snapshot_version;
    RETURN v_latest;
  END IF;

  -- ── Stale/out-of-order: different content whose fetched_at is not newer
  --    than what's already applied. Rejected, not silently accepted. ──
  IF FOUND AND v_latest.fetched_at IS NOT NULL AND p_fetched_at <= v_latest.fetched_at THEN
    v_snapshot_version := COALESCE(v_latest.snapshot_version, 0) + 1;
    INSERT INTO public.catalog_snapshots (product_key, snapshot_version, fetched_at, source_hash, item_count, status, reject_reason)
    VALUES (p_product_key, v_snapshot_version, p_fetched_at, p_source_hash, 0, 'rejected', 'stale_snapshot')
    RETURNING * INTO v_snapshot;
    INSERT INTO public.catalog_audit (product_key, snapshot_version, action, reason, performed_by)
    VALUES (p_product_key, v_snapshot_version, 'rejected', 'stale_snapshot', 'ingest-catalog');
    RETURN v_snapshot;
  END IF;

  -- ── Identity/version mismatch — wrong pairing, not an ordinary content
  --    quality issue, but still recorded (not RAISE, per the lesson from
  --    finding #1: RAISE unwinds its own audit row). ──
  v_snapshot_version := COALESCE(v_latest.snapshot_version, 0) + 1;
  IF p_schema_version IS DISTINCT FROM v_product.schema_version THEN
    INSERT INTO public.catalog_snapshots (product_key, snapshot_version, fetched_at, source_hash, item_count, status, reject_reason)
    VALUES (p_product_key, v_snapshot_version, p_fetched_at, p_source_hash, 0, 'rejected', 'schema_version_mismatch')
    RETURNING * INTO v_snapshot;
    INSERT INTO public.catalog_audit (product_key, snapshot_version, action, reason, performed_by)
    VALUES (p_product_key, v_snapshot_version, 'rejected', 'schema_version_mismatch', 'ingest-catalog');
    RETURN v_snapshot;
  END IF;
  IF (p_source_identity->>'source_key') IS DISTINCT FROM (v_product.source_identity->>'source_key') THEN
    INSERT INTO public.catalog_snapshots (product_key, snapshot_version, fetched_at, source_hash, item_count, status, reject_reason)
    VALUES (p_product_key, v_snapshot_version, p_fetched_at, p_source_hash, 0, 'rejected', 'source_identity_mismatch')
    RETURNING * INTO v_snapshot;
    INSERT INTO public.catalog_audit (product_key, snapshot_version, action, reason, performed_by)
    VALUES (p_product_key, v_snapshot_version, 'rejected', 'source_identity_mismatch', 'ingest-catalog');
    RETURN v_snapshot;
  END IF;

  -- ── Normalize ONCE: trim, drop blanks, dedupe case-insensitively, cap
  --    aliases — and use THIS set (not raw p_items) for every count and for
  --    the actual insert, so a count check can never diverge from what's
  --    really stored (finding #5). ──
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'canonical_name', x.canonical_name,
           'name_he', x.name_he,
           'name_en', x.name_en,
           'aliases', x.aliases,
           'source_item_id', x.source_item_id
         )), '[]'::jsonb)
    INTO v_normalized_items
  FROM (
    SELECT DISTINCT ON (lower(btrim(it->>'canonical_name')))
      btrim(it->>'canonical_name') AS canonical_name,
      NULLIF(btrim(it->>'name_he'), '') AS name_he,
      NULLIF(btrim(it->>'name_en'), '') AS name_en,
      COALESCE((SELECT array_agg(btrim(a)) FROM jsonb_array_elements_text(COALESCE(it->'aliases', '[]'::jsonb)) a WHERE btrim(a) <> ''), '{}') AS aliases,
      it->>'source_item_id' AS source_item_id,
      ord
    FROM jsonb_array_elements(p_items) WITH ORDINALITY AS t(it, ord)
    WHERE btrim(it->>'canonical_name') <> ''
    ORDER BY lower(btrim(it->>'canonical_name')), ord
  ) x;

  v_count_new := jsonb_array_length(v_normalized_items);
  SELECT count(*) INTO v_count_before FROM public.catalog_items WHERE product_key = p_product_key;

  IF v_count_new < v_product.min_expected_count THEN
    INSERT INTO public.catalog_snapshots (product_key, snapshot_version, fetched_at, source_hash, item_count, status, reject_reason)
    VALUES (p_product_key, v_snapshot_version, p_fetched_at, p_source_hash, v_count_new, 'rejected', 'below_min_expected_count')
    RETURNING * INTO v_snapshot;
    INSERT INTO public.catalog_audit (product_key, snapshot_version, action, count_before, count_after, reason, performed_by)
    VALUES (p_product_key, v_snapshot_version, 'rejected', v_count_before, v_count_new, 'below_min_expected_count', 'ingest-catalog');
    RETURN v_snapshot;
  END IF;

  SELECT count(*) INTO v_removed
  FROM public.catalog_items ci
  WHERE ci.product_key = p_product_key
    AND NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_normalized_items) it
      WHERE it->>'canonical_name' = ci.canonical_name
    );

  IF v_count_before > 0 AND v_removed::numeric / v_count_before > v_product.max_removal_ratio THEN
    INSERT INTO public.catalog_snapshots (product_key, snapshot_version, fetched_at, source_hash, item_count, status, reject_reason)
    VALUES (p_product_key, v_snapshot_version, p_fetched_at, p_source_hash, v_count_new, 'rejected', 'removal_ratio_exceeded')
    RETURNING * INTO v_snapshot;
    INSERT INTO public.catalog_audit (product_key, snapshot_version, action, count_before, count_after, removed_count, reason, performed_by)
    VALUES (p_product_key, v_snapshot_version, 'rejected', v_count_before, v_count_new, v_removed, 'removal_ratio_exceeded', 'ingest-catalog');
    RETURN v_snapshot;
  END IF;

  INSERT INTO public.catalog_snapshots (product_key, snapshot_version, fetched_at, source_hash, item_count, status)
  VALUES (p_product_key, v_snapshot_version, p_fetched_at, p_source_hash, v_count_new, 'applied')
  RETURNING * INTO v_snapshot;

  DELETE FROM public.catalog_items WHERE product_key = p_product_key;
  INSERT INTO public.catalog_items (product_key, canonical_name, name_he, name_en, aliases, source_item_id, snapshot_version)
  SELECT
    p_product_key,
    it->>'canonical_name',
    it->>'name_he',
    it->>'name_en',
    COALESCE((SELECT array_agg(a) FROM jsonb_array_elements_text(it->'aliases') a), '{}'),
    it->>'source_item_id',
    v_snapshot_version
  FROM jsonb_array_elements(v_normalized_items) it;

  -- Recompute the mirrored columns on every super_vouchers row linked to
  -- this product. The actual recompute is the sync-cache trigger's job now
  -- (section 6b) — this UPDATE just needs to touch each linked row.
  UPDATE public.super_vouchers
     SET stores_catalog_version = v_snapshot_version,
         updated_at = now()
   WHERE catalog_product_key = p_product_key;

  INSERT INTO public.catalog_audit (product_key, snapshot_version, action, count_before, count_after, added_count, removed_count, performed_by)
  VALUES (p_product_key, v_snapshot_version, 'applied', v_count_before, v_count_new,
          GREATEST(v_count_new - v_count_before + v_removed, 0), v_removed, 'ingest-catalog');

  RETURN v_snapshot;
END;
$$;
REVOKE ALL ON FUNCTION public.catalog_apply_snapshot(text, text, timestamptz, int, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.catalog_apply_snapshot(text, text, timestamptz, int, jsonb, jsonb) TO service_role;

-- ── 11. Reload PostgREST's schema cache so new RPCs are visible immediately ─
SELECT pg_notify('pgrst', 'reload schema');
