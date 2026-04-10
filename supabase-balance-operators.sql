-- Balance check operators: reusable links for voucher balance checking

CREATE TABLE IF NOT EXISTS public.balance_check_operators (
  id         UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  name       TEXT        NOT NULL,
  url        TEXT        NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.balance_check_operators ENABLE ROW LEVEL SECURITY;

-- Any authenticated user can read operators (used in VoucherForm)
DROP POLICY IF EXISTS "Authenticated read operators" ON public.balance_check_operators;
CREATE POLICY "Authenticated read operators" ON public.balance_check_operators
  FOR SELECT USING (auth.role() = 'authenticated');

-- Public RPC: get all operators (for VoucherForm)
CREATE OR REPLACE FUNCTION public.get_balance_operators()
RETURNS SETOF public.balance_check_operators
LANGUAGE sql SECURITY DEFINER AS $$
  SELECT * FROM public.balance_check_operators ORDER BY name ASC;
$$;

-- Admin RPC: create operator
CREATE OR REPLACE FUNCTION public.admin_create_operator(p_name TEXT, p_url TEXT)
RETURNS public.balance_check_operators
LANGUAGE sql SECURITY DEFINER AS $$
  INSERT INTO public.balance_check_operators (name, url)
  VALUES (p_name, p_url)
  RETURNING *;
$$;

-- Admin RPC: update operator
CREATE OR REPLACE FUNCTION public.admin_update_operator(p_id UUID, p_name TEXT, p_url TEXT)
RETURNS void
LANGUAGE sql SECURITY DEFINER AS $$
  UPDATE public.balance_check_operators SET name = p_name, url = p_url WHERE id = p_id;
$$;

-- Admin RPC: delete operator
CREATE OR REPLACE FUNCTION public.admin_delete_operator(p_id UUID)
RETURNS void
LANGUAGE sql SECURITY DEFINER AS $$
  DELETE FROM public.balance_check_operators WHERE id = p_id;
$$;
