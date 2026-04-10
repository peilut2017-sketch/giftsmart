-- Banner enhancements: duration, skip_allowed, display_order

-- Add new columns to login_banners
ALTER TABLE public.login_banners
  ADD COLUMN IF NOT EXISTS display_duration INT NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS skip_allowed     BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS display_order    INT NOT NULL DEFAULT 0;

-- Update get_active_banner (singular) — kept for backward compat, returns first active
CREATE OR REPLACE FUNCTION public.get_active_banner()
RETURNS public.login_banners
LANGUAGE sql SECURITY DEFINER AS $$
  SELECT * FROM public.login_banners
  WHERE is_active = true
  ORDER BY display_order ASC, created_at ASC
  LIMIT 1;
$$;

-- New: get ALL active banners ordered by display_order
CREATE OR REPLACE FUNCTION public.get_active_banners()
RETURNS SETOF public.login_banners
LANGUAGE sql SECURITY DEFINER AS $$
  SELECT * FROM public.login_banners
  WHERE is_active = true
  ORDER BY display_order ASC, created_at ASC;
$$;

-- Admin: get all banners (includes inactive)
CREATE OR REPLACE FUNCTION public.admin_get_banners()
RETURNS SETOF public.login_banners
LANGUAGE sql SECURITY DEFINER AS $$
  SELECT * FROM public.login_banners ORDER BY display_order ASC, created_at ASC;
$$;

-- Admin: add banner with settings
CREATE OR REPLACE FUNCTION public.admin_add_banner(
  p_image_url       TEXT,
  p_display_duration INT DEFAULT 5,
  p_skip_allowed    BOOLEAN DEFAULT true
)
RETURNS public.login_banners
LANGUAGE sql SECURITY DEFINER AS $$
  INSERT INTO public.login_banners (image_url, is_active, display_duration, skip_allowed, display_order)
  VALUES (
    p_image_url,
    false,
    p_display_duration,
    p_skip_allowed,
    (SELECT COALESCE(MAX(display_order), 0) + 1 FROM public.login_banners)
  )
  RETURNING *;
$$;

-- Admin: update banner settings (duration, skip, active)
CREATE OR REPLACE FUNCTION public.admin_update_banner_settings(
  p_id              UUID,
  p_display_duration INT,
  p_skip_allowed    BOOLEAN
)
RETURNS void
LANGUAGE sql SECURITY DEFINER AS $$
  UPDATE public.login_banners
  SET display_duration = p_display_duration,
      skip_allowed     = p_skip_allowed
  WHERE id = p_id;
$$;

-- Admin: reorder banners (accepts array of IDs in desired order)
CREATE OR REPLACE FUNCTION public.admin_reorder_banners(p_ids UUID[])
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  i INT;
BEGIN
  FOR i IN 1..array_length(p_ids, 1) LOOP
    UPDATE public.login_banners SET display_order = i WHERE id = p_ids[i];
  END LOOP;
END;
$$;
