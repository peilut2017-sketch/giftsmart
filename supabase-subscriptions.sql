-- Subscriptions table for GiftSmart freemium model
-- Run in Supabase SQL editor

create table if not exists subscriptions (
  id                     uuid primary key default gen_random_uuid(),
  user_id                uuid references auth.users not null unique,
  plan                   text not null default 'free',   -- 'free' | 'pro'
  status                 text not null default 'active', -- 'active' | 'canceled' | 'past_due'
  stripe_customer_id     text,
  stripe_subscription_id text,
  current_period_end     timestamptz,                    -- null = no expiry (lifetime/manual)
  created_at             timestamptz default now(),
  updated_at             timestamptz default now()
);

-- Only the user can read their own subscription
alter table subscriptions enable row level security;

create policy "users can read own subscription"
  on subscriptions for select
  using (user_id = auth.uid());

-- Only service role can insert/update (done via Stripe webhook Edge Function)
create policy "service role manages subscriptions"
  on subscriptions for all
  using (auth.role() = 'service_role');

-- Helper: returns 'free' or 'pro' for any user
create or replace function get_user_plan(p_user_id uuid default auth.uid())
returns text language sql security definer stable as $$
  select coalesce(
    (
      select plan from subscriptions
      where user_id = p_user_id
        and status = 'active'
        and (current_period_end is null or current_period_end > now())
    ),
    'free'
  )
$$;

-- Index for fast user lookups
create index if not exists subscriptions_user_id_idx on subscriptions (user_id);

-- To manually grant Pro to a user (run as service role):
-- insert into subscriptions (user_id, plan, status)
-- values ('<user-uuid>', 'pro', 'active')
-- on conflict (user_id) do update set plan='pro', status='active', current_period_end=null;
