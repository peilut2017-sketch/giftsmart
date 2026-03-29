-- ── Broadcast Tables ─────────────────────────────────────────────────────────
-- Run this after supabase-coupons-messages.sql

-- Push broadcasts (admin → all users via Realtime)
create table if not exists push_broadcasts (
  id          uuid default gen_random_uuid() primary key,
  title       text not null,
  body        text not null,
  created_by  uuid references auth.users(id),
  created_at  timestamptz default now()
);

alter table push_broadcasts enable row level security;

create policy "authenticated read push broadcasts"
  on push_broadcasts for select to authenticated using (true);

create policy "service manages push broadcasts"
  on push_broadcasts for all using (auth.role() = 'service_role');

-- Message broadcasts (admin → all users, shown in SettingsPage)
create table if not exists admin_broadcasts (
  id         uuid default gen_random_uuid() primary key,
  subject    text not null,
  body       text not null,
  created_at timestamptz default now()
);

alter table admin_broadcasts enable row level security;

create policy "authenticated read admin broadcasts"
  on admin_broadcasts for select to authenticated using (true);

create policy "service manages admin broadcasts"
  on admin_broadcasts for all using (auth.role() = 'service_role');

-- ── Indexes ───────────────────────────────────────────────────────────────────

create index if not exists push_broadcasts_created_at_idx  on push_broadcasts (created_at desc);
create index if not exists admin_broadcasts_created_at_idx on admin_broadcasts (created_at desc);

-- ── Enable Realtime ───────────────────────────────────────────────────────────
-- Run in Supabase Dashboard → Database → Replication, or:
alter publication supabase_realtime add table push_broadcasts;
alter publication supabase_realtime add table admin_broadcasts;
alter publication supabase_realtime add table support_messages;

-- ── Admin RPCs ────────────────────────────────────────────────────────────────

-- Create push broadcast (admin only via service role or direct)
create or replace function admin_create_push_broadcast(p_title text, p_body text)
returns push_broadcasts
language sql
security definer
as $$
  insert into push_broadcasts (title, body, created_by)
  values (p_title, p_body, auth.uid())
  returning *;
$$;

-- Create message broadcast (admin only)
create or replace function admin_create_broadcast(p_subject text, p_body text)
returns admin_broadcasts
language sql
security definer
as $$
  insert into admin_broadcasts (subject, body)
  values (p_subject, p_body)
  returning *;
$$;

-- Get message broadcasts list (most recent first)
create or replace function admin_get_broadcasts()
returns setof admin_broadcasts
language sql
security definer
as $$
  select * from admin_broadcasts order by created_at desc limit 50;
$$;

-- Delete a message broadcast
create or replace function admin_delete_broadcast(p_id uuid)
returns void
language sql
security definer
as $$
  delete from admin_broadcasts where id = p_id;
$$;
