-- Login Banner: table, storage bucket, and admin functions

-- Storage bucket for banners (run this if using Supabase dashboard or anon key with admin)
INSERT INTO storage.buckets (id, name, public)
VALUES ('banners', 'banners', true)
ON CONFLICT (id) DO NOTHING;

-- Storage policies
CREATE POLICY IF NOT EXISTS "Public read banners storage"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'banners');

CREATE POLICY IF NOT EXISTS "Admin upload banners storage"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'banners');

CREATE POLICY IF NOT EXISTS "Admin delete banners storage"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'banners');

-- login_banners table
CREATE TABLE IF NOT EXISTS public.login_banners (
  id          UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  image_url   TEXT        NOT NULL,
  is_active   BOOLEAN     DEFAULT true,
  created_at  TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.login_banners ENABLE ROW LEVEL SECURITY;

-- Anyone (including unauthenticated) can read active banners
DROP POLICY IF EXISTS "Public read active banners" ON public.login_banners;
CREATE POLICY "Public read active banners" ON public.login_banners
  FOR SELECT USING (true);

-- Admin RPC: get all banners
CREATE OR REPLACE FUNCTION public.admin_get_banners()
RETURNS SETOF public.login_banners
LANGUAGE sql SECURITY DEFINER AS $$
  SELECT * FROM public.login_banners ORDER BY created_at DESC;
$$;

-- Admin RPC: add banner
CREATE OR REPLACE FUNCTION public.admin_add_banner(p_image_url TEXT)
RETURNS public.login_banners
LANGUAGE sql SECURITY DEFINER AS $$
  INSERT INTO public.login_banners (image_url, is_active)
  VALUES (p_image_url, false)
  RETURNING *;
$$;

-- Admin RPC: toggle active
CREATE OR REPLACE FUNCTION public.admin_toggle_banner(p_id UUID, p_active BOOLEAN)
RETURNS void
LANGUAGE sql SECURITY DEFINER AS $$
  UPDATE public.login_banners SET is_active = p_active WHERE id = p_id;
$$;

-- Admin RPC: delete banner
CREATE OR REPLACE FUNCTION public.admin_delete_banner(p_id UUID)
RETURNS void
LANGUAGE sql SECURITY DEFINER AS $$
  DELETE FROM public.login_banners WHERE id = p_id;
$$;

-- Public RPC: get the active banner (newest active one)
CREATE OR REPLACE FUNCTION public.get_active_banner()
RETURNS public.login_banners
LANGUAGE sql SECURITY DEFINER AS $$
  SELECT * FROM public.login_banners WHERE is_active = true ORDER BY created_at DESC LIMIT 1;
$$;
