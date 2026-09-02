-- 0008_user_auth.sql
-- Sign-in authentication: per-user accounts via Supabase Auth.

-- 1) Add user_id to items (nullable initially so existing rows survive).
alter table public.items
  add column if not exists user_id uuid references auth.users(id) on delete cascade;

create index if not exists items_user_idx
  on public.items (user_id, created_at desc);

-- 2) profiles table (1:1 with auth.users).
create table if not exists public.profiles (
  user_id           uuid primary key references auth.users(id) on delete cascade,
  display_name      text,
  color_rules       jsonb not null default '[]'::jsonb,
  auto_remind_events boolean not null default true,
  military_time     boolean not null default false,
  auto_delete       boolean not null default false,
  auto_delete_days  int    not null default 30,
  provider          text   not null default 'nvidia',
  updated_at        timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists "profiles read own"  on public.profiles;
drop policy if exists "profiles write own" on public.profiles;
drop policy if exists "profiles update own" on public.profiles;
drop policy if exists "profiles delete own" on public.profiles;

create policy "profiles read own"
  on public.profiles for select using ( user_id = auth.uid() );
create policy "profiles write own"
  on public.profiles for insert with check ( user_id = auth.uid() );
create policy "profiles update own"
  on public.profiles for update
  using ( user_id = auth.uid() )
  with check ( user_id = auth.uid() );
create policy "profiles delete own"
  on public.profiles for delete using ( user_id = auth.uid() );

-- 3) Auto-create a profile row on sign-up.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
as $$
begin
  insert into public.profiles (user_id, display_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1))
  )
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 4) Replace items RLS with user_id-based policies.
drop policy if exists "items read own space"   on public.items;
drop policy if exists "items write own space"  on public.items;
drop policy if exists "items update own space" on public.items;
drop policy if exists "items delete own space" on public.items;

create policy "items read own"
  on public.items for select using ( user_id = auth.uid() );
create policy "items write own"
  on public.items for insert with check ( user_id = auth.uid() );
create policy "items update own"
  on public.items for update
  using ( user_id = auth.uid() )
  with check ( user_id = auth.uid() );
create policy "items delete own"
  on public.items for delete using ( user_id = auth.uid() );

-- 5) Item cap trigger: now scoped per user.
create or replace function public.enforce_item_cap()
returns trigger
language plpgsql
as $$
begin
  if (select count(*) from public.items where user_id = new.user_id) >= 500 then
    raise exception 'item limit reached';
  end if;
  return new;
end;
$$;

drop trigger if exists items_cap on public.items;
create trigger items_cap before insert on public.items
  for each row execute function public.enforce_item_cap();

-- 6) Backfill: any rows whose space_token was not claimed are deleted.
--    We cannot keep them as orphans because user_id has a FK to auth.users,
--    and Supabase does not let SQL create auth.users rows. Items whose
--    owner never claimed the token are abandoned. Acceptable data loss
--    for v1; export/import gives users a backup path.
delete from public.items where user_id is null;

alter table public.items alter column user_id set not null;

-- 7) Drop the legacy token surface. Spaces and items.space_token are gone.
--    Drop the column first so the FK from items->spaces does not block `drop table spaces`.
alter table public.items drop column if exists space_token;
drop table if exists public.spaces;