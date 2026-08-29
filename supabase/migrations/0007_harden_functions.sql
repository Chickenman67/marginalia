-- 0007: harden security-critical functions + durable per-space rate limiting.

-- F1: pin search_path on the RLS/trigger helpers so a mutable search_path
-- cannot be hijacked by a function-resolution attack.
create or replace function public.req_space_id() returns text
language sql stable
set search_path = pg_catalog, public
as $$
  select split_part(current_setting('request.headers', true)::json->>'x-space-token', '.', 1);
$$;

create or replace function public.req_space_secret() returns text
language sql stable
set search_path = pg_catalog, public
as $$
  select split_part(current_setting('request.headers', true)::json->>'x-space-token', '.', 2);
$$;

create or replace function public.enforce_item_cap()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if (select count(*) from public.items where space_token = new.space_token) >= 500 then
    raise exception 'space item limit reached';
  end if;
  return new;
end;
$$;

create or replace function public.migrate_legacy_token(
  old_token text, new_id text, new_secret text
) returns boolean
language plpgsql
set search_path = pg_catalog, public
as $$
declare matched boolean;
begin
  if not exists (select 1 from public.spaces where token = old_token and token like 'space-%') then
    return false;
  end if;
  set constraints public.items_space_token_fkey deferred;
  update public.spaces set token = new_id, secret = new_secret where token = old_token;
  update public.items set space_token = new_id where space_token = old_token;
  return true;
end;
$$;
-- Only service_role may call migrate_legacy_token (grant preserved from 0006);
-- owners retain EXECUTE, so no extra grant needed here.

-- F4: durable, per-space rate limiting. The Edge Functions call
-- public.check_rate_limit via service_role; the table is never exposed to
-- anon/authenticated.
create table if not exists public.rate_limits (
  space_token text primary key,
  window_start timestamptz not null default now(),
  hits int not null default 0
);
revoke all on public.rate_limits from anon, authenticated, public;
-- Access is fully gated by the check_rate_limit EXECUTE grant (service_role
-- only); the rls_auto_enable event trigger would otherwise force-enable RLS
-- with no policy, so disable it here for reproducibility.
alter table public.rate_limits disable row level security;

create or replace function public.check_rate_limit(p_space text, p_max int, p_window_sec int)
returns boolean
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  new_hits int;
begin
  insert into public.rate_limits (space_token, window_start, hits)
    values (p_space, now(), 1)
  on conflict (space_token) do update
    set hits = case
                 when rate_limits.window_start < now() - (p_window_sec::text || ' seconds')::interval
                 then 1 else rate_limits.hits + 1 end,
        window_start = case
                 when rate_limits.window_start < now() - (p_window_sec::text || ' seconds')::interval
                 then now() else rate_limits.window_start end
  returning hits into new_hits;
  return new_hits <= p_max;
end;
$$;
revoke execute on function public.check_rate_limit(text, int, int) from anon, authenticated, public;

-- F6: rls_auto_enable is an event trigger (not RPC-callable), but silence the
-- linter by removing public execute grants on it.
revoke execute on function public.rls_auto_enable() from anon, authenticated, public;
