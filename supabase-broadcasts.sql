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

-- Create push broadcast (admin only)
create or replace function admin_create_push_broadcast(p_title text, p_body text)
returns push_broadcasts
language plpgsql
security definer
set search_path = public
as $$
declare v_row push_broadcasts;
begin
  if not exists (select 1 from profiles where id = auth.uid() and is_admin = true) then
    raise exception 'permission_denied';
  end if;
  insert into push_broadcasts (title, body, created_by)
  values (p_title, p_body, auth.uid())
  returning * into v_row;
  return v_row;
end;
$$;

-- Create message broadcast (admin only)
create or replace function admin_create_broadcast(p_subject text, p_body text)
returns admin_broadcasts
language plpgsql
security definer
set search_path = public
as $$
declare v_row admin_broadcasts;
begin
  if not exists (select 1 from profiles where id = auth.uid() and is_admin = true) then
    raise exception 'permission_denied';
  end if;
  insert into admin_broadcasts (subject, body)
  values (p_subject, p_body)
  returning * into v_row;
  return v_row;
end;
$$;

-- Get message broadcasts list (most recent first)
create or replace function admin_get_broadcasts()
returns setof admin_broadcasts
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from profiles where id = auth.uid() and is_admin = true) then
    raise exception 'permission_denied';
  end if;
  return query select * from admin_broadcasts order by created_at desc limit 50;
end;
$$;

-- Delete a message broadcast
create or replace function admin_delete_broadcast(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from profiles where id = auth.uid() and is_admin = true) then
    raise exception 'permission_denied';
  end if;
  delete from admin_broadcasts where id = p_id;
end;
$$;
