-- ScheduleApp schema (Supabase free tier)
-- Run with the Supabase CLI: supabase db push, or paste into the SQL editor.

create table if not exists public.spaces (
  token text primary key,
  last_active_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists public.items (
  id text primary key,
  space_token text not null references public.spaces(token) on delete cascade,
  kind text not null check (kind in ('todo','event')),
  title text not null,
  datetime timestamptz,
  all_day boolean not null default false,
  reminder timestamptz,
  status text not null default 'pending' check (status in ('pending','done')),
  created_at timestamptz not null default now()
);

create index if not exists items_space_idx on public.items (space_token, created_at);

-- Row Level Security keyed on space_token (no user accounts / auth.uid).
alter table public.items enable row level security;
alter table public.spaces enable row level security;

-- Helper: caller proves ownership of a space by passing x-space-token in the request.
-- Supabase's anon key is public; we treat the token itself as the secret.
create or replace function public.space_token_match(space text)
returns boolean
language sql
stable
as $$
  select exists (
    select 1 from public.spaces s
    where s.token = space
  )
$$;

create policy "items read own space"
  on public.items for select
  using ( space_token = current_setting('request.headers', true)::json->>'x-space-token' );

create policy "items write own space"
  on public.items for insert
  with check ( space_token = current_setting('request.headers', true)::json->>'x-space-token' );

create policy "items update own space"
  on public.items for update
  using ( space_token = current_setting('request.headers', true)::json->>'x-space-token' )
  with check ( space_token = current_setting('request.headers', true)::json->>'x-space-token' );

create policy "items delete own space"
  on public.items for delete
  using ( space_token = current_setting('request.headers', true)::json->>'x-space-token' );

create policy "spaces read own"
  on public.spaces for select
  using ( token = current_setting('request.headers', true)::json->>'x-space-token' );

create policy "spaces upsert own"
  on public.spaces for insert
  with check ( token = current_setting('request.headers', true)::json->>'x-space-token' );

create policy "spaces update own"
  on public.spaces for update
  using ( token = current_setting('request.headers', true)::json->>'x-space-token' )
  with check ( token = current_setting('request.headers', true)::json->>'x-space-token' );

-- Guest guard rails: cap items per space and expire stale guest spaces.
-- Enforced in the Edge Function / app layer; DB guard below caps row count cheaply.
create or replace function public.enforce_item_cap()
returns trigger
language plpgsql
as $$
begin
  if (select count(*) from public.items where space_token = new.space_token) >= 500 then
    raise exception 'space item limit reached';
  end if;
  return new;
end;
$$;

drop trigger if exists items_cap on public.items;
create trigger items_cap before insert on public.items
  for each row execute function public.enforce_item_cap();
