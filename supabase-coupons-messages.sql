-- Coupons, redemptions, support messages
-- Run in Supabase SQL editor

-- ── Coupons ──────────────────────────────────────────────────────────────────

create table if not exists coupons (
  id               uuid primary key default gen_random_uuid(),
  code             text unique not null,                          -- the code users enter (stored uppercase)
  name             text not null,                                 -- internal label for admin
  type             text not null default 'general',              -- 'general' | 'private'
  discount_type    text not null default 'months_free',          -- 'months_free' (Stripe discounts handled externally)
  discount_value   int  not null default 1,                      -- number of free months
  max_uses         int,                                           -- null = unlimited
  uses_count       int  not null default 0,
  valid_until      timestamptz,                                   -- null = no expiry
  restricted_to_email text,                                      -- private: only this email can use
  first_time_only  boolean not null default false,               -- true = only users who never had Pro
  is_active        boolean not null default true,
  created_by       uuid references auth.users,
  created_at       timestamptz default now()
);

create table if not exists coupon_redemptions (
  id          uuid primary key default gen_random_uuid(),
  coupon_id   uuid references coupons not null,
  user_id     uuid references auth.users not null,
  user_email  text,
  redeemed_at timestamptz default now(),
  unique(coupon_id, user_id)                                     -- one redemption per user per coupon
);

-- ── Support messages ──────────────────────────────────────────────────────────

create table if not exists support_messages (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references auth.users not null,
  user_email  text,
  user_name   text,
  subject     text not null,
  body        text not null,
  category    text not null default 'general',  -- 'billing' | 'bug' | 'feature' | 'general'
  status      text not null default 'unread',   -- 'unread' | 'read' | 'replied'
  admin_reply text,
  replied_at  timestamptz,
  created_at  timestamptz default now()
);

-- ── RLS ───────────────────────────────────────────────────────────────────────

alter table coupons enable row level security;
alter table coupon_redemptions enable row level security;
alter table support_messages enable row level security;

-- Active coupons are readable by everyone (needed for code validation)
create policy "read active coupons"
  on coupons for select using (is_active = true);

-- Only service role writes coupons
create policy "service manages coupons"
  on coupons for all using (auth.role() = 'service_role');

-- Users see their own redemptions
create policy "own redemptions select"
  on coupon_redemptions for select using (user_id = auth.uid());

create policy "service manages redemptions"
  on coupon_redemptions for all using (auth.role() = 'service_role');

-- Users manage their own messages
create policy "own messages"
  on support_messages for all using (user_id = auth.uid());

create policy "service manages messages"
  on support_messages for all using (auth.role() = 'service_role');

-- ── Indexes ───────────────────────────────────────────────────────────────────

create index if not exists coupons_code_idx                 on coupons (code);
create index if not exists coupon_redemptions_user_idx      on coupon_redemptions (user_id);
create index if not exists coupon_redemptions_coupon_idx    on coupon_redemptions (coupon_id);
create index if not exists support_messages_user_idx        on support_messages (user_id);
create index if not exists support_messages_status_idx      on support_messages (status);
create index if not exists support_messages_created_at_idx  on support_messages (created_at desc);

-- ── RPC: redeem coupon ────────────────────────────────────────────────────────

create or replace function redeem_coupon(p_code text, p_user_id uuid default auth.uid())
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_coupon     coupons%rowtype;
  v_user_email text;
  v_period_end timestamptz;
  v_base       timestamptz;
begin
  -- Normalise code
  p_code := upper(trim(p_code));

  -- Fetch active coupon
  select * into v_coupon from coupons where code = p_code and is_active = true;
  if not found then
    return jsonb_build_object('success', false, 'error', 'INVALID_CODE');
  end if;

  -- Expiry check
  if v_coupon.valid_until is not null and v_coupon.valid_until < now() then
    return jsonb_build_object('success', false, 'error', 'EXPIRED');
  end if;

  -- Uses exhausted
  if v_coupon.max_uses is not null and v_coupon.uses_count >= v_coupon.max_uses then
    return jsonb_build_object('success', false, 'error', 'EXHAUSTED');
  end if;

  -- Already used by this user
  if exists (select 1 from coupon_redemptions where coupon_id = v_coupon.id and user_id = p_user_id) then
    return jsonb_build_object('success', false, 'error', 'ALREADY_USED');
  end if;

  -- Fetch user email
  select email into v_user_email from auth.users where id = p_user_id;

  -- Private coupon email check
  if v_coupon.restricted_to_email is not null
     and lower(v_user_email) != lower(v_coupon.restricted_to_email) then
    return jsonb_build_object('success', false, 'error', 'NOT_ELIGIBLE');
  end if;

  -- First-time-only check
  if v_coupon.first_time_only then
    if exists (select 1 from subscriptions where user_id = p_user_id and plan = 'pro') then
      return jsonb_build_object('success', false, 'error', 'NOT_FIRST_TIME');
    end if;
  end if;

  -- Apply months_free: extend existing Pro period or start from now
  select current_period_end into v_base
    from subscriptions
   where user_id = p_user_id and plan = 'pro' and status = 'active'
     and (current_period_end is null or current_period_end > now());

  v_period_end := coalesce(v_base, now())
                  + (v_coupon.discount_value || ' months')::interval;

  insert into subscriptions (user_id, plan, status, current_period_end)
  values (p_user_id, 'pro', 'active', v_period_end)
  on conflict (user_id) do update
    set plan = 'pro', status = 'active', current_period_end = v_period_end, updated_at = now();

  -- Record redemption
  insert into coupon_redemptions (coupon_id, user_id, user_email)
  values (v_coupon.id, p_user_id, v_user_email);

  -- Increment uses
  update coupons set uses_count = uses_count + 1 where id = v_coupon.id;

  return jsonb_build_object(
    'success',      true,
    'months_added', v_coupon.discount_value,
    'valid_until',  v_period_end
  );
end;
$$;

-- ── Admin RPCs ────────────────────────────────────────────────────────────────

-- Pro subscriber count
create or replace function admin_get_pro_count()
returns int language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from profiles where id = auth.uid() and is_admin = true) then
    raise exception 'permission_denied';
  end if;
  return (select count(*)::int from subscriptions
           where plan = 'pro' and status = 'active'
             and (current_period_end is null or current_period_end > now()));
end;
$$;

-- All coupons
create or replace function admin_get_coupons()
returns setof coupons language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from profiles where id = auth.uid() and is_admin = true) then
    raise exception 'permission_denied';
  end if;
  return query select * from coupons order by created_at desc;
end;
$$;

-- Create coupon
create or replace function admin_create_coupon(
  p_code             text,
  p_name             text,
  p_type             text    default 'general',
  p_discount_value   int     default 1,
  p_max_uses         int     default null,
  p_valid_until      timestamptz default null,
  p_restricted_email text    default null,
  p_first_time_only  boolean default false
) returns coupons language plpgsql security definer set search_path = public as $$
declare v_row coupons;
begin
  if not exists (select 1 from profiles where id = auth.uid() and is_admin = true) then
    raise exception 'permission_denied';
  end if;
  insert into coupons (code, name, type, discount_type, discount_value,
                       max_uses, valid_until, restricted_to_email, first_time_only, created_by)
  values (upper(trim(p_code)), p_name, p_type, 'months_free', p_discount_value,
          p_max_uses, p_valid_until, lower(p_restricted_email), p_first_time_only, auth.uid())
  returning * into v_row;
  return v_row;
end;
$$;

-- Toggle coupon active
create or replace function admin_toggle_coupon(p_id uuid, p_active boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from profiles where id = auth.uid() and is_admin = true) then
    raise exception 'permission_denied';
  end if;
  update coupons set is_active = p_active where id = p_id;
end;
$$;

-- Delete coupon
create or replace function admin_delete_coupon(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from profiles where id = auth.uid() and is_admin = true) then
    raise exception 'permission_denied';
  end if;
  delete from coupons where id = p_id;
end;
$$;
GRANT EXECUTE ON FUNCTION admin_delete_coupon TO authenticated;

-- All support messages (newest first)
create or replace function admin_get_messages()
returns setof support_messages language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from profiles where id = auth.uid() and is_admin = true) then
    raise exception 'permission_denied';
  end if;
  return query
    select * from support_messages order by
      case status when 'unread' then 0 when 'read' then 1 else 2 end,
      created_at desc
    limit 500;
end;
$$;

-- Mark message as read
create or replace function admin_mark_message_read(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from profiles where id = auth.uid() and is_admin = true) then
    raise exception 'permission_denied';
  end if;
  update support_messages set status = 'read'
   where id = p_id and status = 'unread';
end;
$$;

-- Reply to message
create or replace function admin_reply_message(p_id uuid, p_reply text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from profiles where id = auth.uid() and is_admin = true) then
    raise exception 'permission_denied';
  end if;
  update support_messages
     set admin_reply = p_reply, status = 'replied', replied_at = now()
   where id = p_id;
end;
$$;
