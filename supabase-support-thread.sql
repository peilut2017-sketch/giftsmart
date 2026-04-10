-- Support thread: allow multiple replies per message from both admin and user

CREATE TABLE IF NOT EXISTS public.support_message_replies (
  id         UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  message_id UUID        NOT NULL REFERENCES public.support_messages(id) ON DELETE CASCADE,
  sender     TEXT        NOT NULL CHECK (sender IN ('user', 'admin')),
  body       TEXT        NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.support_message_replies ENABLE ROW LEVEL SECURITY;

-- Users can read replies on their own messages
DROP POLICY IF EXISTS "Users read own message replies" ON public.support_message_replies;
CREATE POLICY "Users read own message replies" ON public.support_message_replies
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.support_messages sm
      WHERE sm.id = message_id AND sm.user_id = auth.uid()
    )
  );

-- RPC: admin sends a reply (appends to thread, also updates legacy admin_reply field)
CREATE OR REPLACE FUNCTION public.admin_reply_message(p_id UUID, p_reply TEXT)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  -- Insert into thread
  INSERT INTO public.support_message_replies (message_id, sender, body)
  VALUES (p_id, 'admin', p_reply);
  -- Update legacy field and status for backward compat
  UPDATE public.support_messages
  SET admin_reply = p_reply, replied_at = now(), status = 'replied'
  WHERE id = p_id;
END;
$$;

-- RPC: user sends a reply to an existing support message thread
CREATE OR REPLACE FUNCTION public.user_reply_message(p_id UUID, p_body TEXT)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  -- Verify the message belongs to the calling user
  IF NOT EXISTS (
    SELECT 1 FROM public.support_messages WHERE id = p_id AND user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  INSERT INTO public.support_message_replies (message_id, sender, body)
  VALUES (p_id, 'user', p_body);

  -- Mark message as unread again so admin notices the new reply
  UPDATE public.support_messages
  SET status = 'unread'
  WHERE id = p_id;
END;
$$;

-- RPC: get replies for a specific message (user calls this for their own messages)
CREATE OR REPLACE FUNCTION public.get_message_replies(p_message_id UUID)
RETURNS SETOF public.support_message_replies
LANGUAGE sql SECURITY DEFINER AS $$
  SELECT r.* FROM public.support_message_replies r
  JOIN public.support_messages sm ON sm.id = r.message_id
  WHERE r.message_id = p_message_id
    AND sm.user_id = auth.uid()
  ORDER BY r.created_at ASC;
$$;

-- RPC: admin gets replies for any message
CREATE OR REPLACE FUNCTION public.admin_get_message_replies(p_message_id UUID)
RETURNS SETOF public.support_message_replies
LANGUAGE sql SECURITY DEFINER AS $$
  SELECT * FROM public.support_message_replies
  WHERE message_id = p_message_id
  ORDER BY created_at ASC;
$$;
