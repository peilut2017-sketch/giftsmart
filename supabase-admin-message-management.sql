-- Admin message management: reply edit/delete, user-read tracking, broadcast views + edit
-- Run in Supabase SQL editor after supabase-support-thread.sql and supabase-broadcasts.sql

-- ── 1. Track when user last read their support thread ────────────────────────

ALTER TABLE public.support_messages
  ADD COLUMN IF NOT EXISTS user_read_at TIMESTAMPTZ;

-- User marks their own thread as read (called when they expand the thread in SettingsPage)
CREATE OR REPLACE FUNCTION public.user_mark_message_read(p_message_id UUID)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.support_messages WHERE id = p_message_id AND user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;
  UPDATE public.support_messages
    SET user_read_at = now()
  WHERE id = p_message_id;
END;
$$;

-- ── 2. Admin edit / delete their own replies ─────────────────────────────────

-- Edit an admin reply body
CREATE OR REPLACE FUNCTION public.admin_edit_reply(p_reply_id UUID, p_body TEXT)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true) THEN
    RAISE EXCEPTION 'permission_denied';
  END IF;
  UPDATE public.support_message_replies
    SET body = p_body
  WHERE id = p_reply_id AND sender = 'admin';
END;
$$;

-- Delete an admin reply
CREATE OR REPLACE FUNCTION public.admin_delete_reply(p_reply_id UUID)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true) THEN
    RAISE EXCEPTION 'permission_denied';
  END IF;
  DELETE FROM public.support_message_replies
  WHERE id = p_reply_id AND sender = 'admin';
END;
$$;

-- ── 3. Broadcast views – who saw which broadcast ─────────────────────────────

CREATE TABLE IF NOT EXISTS public.broadcast_views (
  broadcast_id UUID        NOT NULL REFERENCES public.admin_broadcasts(id) ON DELETE CASCADE,
  user_id      UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  user_email   TEXT,
  viewed_at    TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (broadcast_id, user_id)
);

ALTER TABLE public.broadcast_views ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own broadcast views" ON public.broadcast_views;
CREATE POLICY "Users manage own broadcast views"
  ON public.broadcast_views FOR ALL USING (user_id = auth.uid());

-- User records that they viewed a broadcast (called on first hover in SettingsPage)
CREATE OR REPLACE FUNCTION public.record_broadcast_view(p_broadcast_id UUID)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_email TEXT;
BEGIN
  SELECT email INTO v_email FROM auth.users WHERE id = auth.uid();
  INSERT INTO public.broadcast_views (broadcast_id, user_id, user_email, viewed_at)
  VALUES (p_broadcast_id, auth.uid(), v_email, now())
  ON CONFLICT (broadcast_id, user_id) DO NOTHING;
END;
$$;

-- Admin gets the viewer list for a broadcast
CREATE OR REPLACE FUNCTION public.admin_get_broadcast_views(p_broadcast_id UUID)
RETURNS TABLE(user_email TEXT, viewed_at TIMESTAMPTZ)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true) THEN
    RAISE EXCEPTION 'permission_denied';
  END IF;
  RETURN QUERY
    SELECT bv.user_email, bv.viewed_at
    FROM public.broadcast_views bv
    WHERE bv.broadcast_id = p_broadcast_id
    ORDER BY bv.viewed_at DESC;
END;
$$;

-- ── 4. Admin edit a broadcast ─────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.admin_edit_broadcast(p_id UUID, p_subject TEXT, p_body TEXT)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true) THEN
    RAISE EXCEPTION 'permission_denied';
  END IF;
  UPDATE public.admin_broadcasts
    SET subject = p_subject, body = p_body
  WHERE id = p_id;
END;
$$;
