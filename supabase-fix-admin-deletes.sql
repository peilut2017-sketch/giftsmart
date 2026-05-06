-- Fix: ensure admin_delete_report and admin_delete_coupon RPCs exist with proper grants

CREATE OR REPLACE FUNCTION admin_delete_report(p_report_id UUID)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = TRUE) THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;
  DELETE FROM user_reports WHERE id = p_report_id;
END;
$$;
GRANT EXECUTE ON FUNCTION admin_delete_report TO authenticated;

CREATE OR REPLACE FUNCTION admin_delete_coupon(p_id UUID)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = TRUE) THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;
  DELETE FROM coupons WHERE id = p_id;
END;
$$;
GRANT EXECUTE ON FUNCTION admin_delete_coupon TO authenticated;

SELECT pg_notify('pgrst', 'reload schema');
