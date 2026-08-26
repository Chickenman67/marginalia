-- Harden space tokens: split lookup id (token) from auth secret.
alter table public.spaces add column if not exists secret text not null default '';

-- Backfill existing (legacy space-xxx) rows with a random secret.
update public.spaces set secret = translate(gen_random_uuid()::text, '-', '')
 where secret = '';

-- Drop old policies that matched token alone.
drop policy if exists "items read own space" on public.items;
drop policy if exists "items write own space" on public.items;
drop policy if exists "items update own space" on public.items;
drop policy if exists "items delete own space" on public.items;
drop policy if exists "spaces read own" on public.spaces;
drop policy if exists "spaces upsert own" on public.spaces;
drop policy if exists "spaces update own" on public.spaces;

-- Helper: extract id (before first '.') and secret (after) from the header token.
create or replace function public.req_space_id() returns text
language sql stable as $$
  select split_part(current_setting('request.headers', true)::json->>'x-space-token', '.', 1);
$$;
create or replace function public.req_space_secret() returns text
language sql stable as $$
  select split_part(current_setting('request.headers', true)::json->>'x-space-token', '.', 2);
$$;

-- items policies: match space_token (id) AND prove secret.
create policy "items read own space" on public.items for select
  using ( space_token = public.req_space_id()
          and exists (select 1 from public.spaces s
                      where s.token = public.req_space_id()
                        and s.secret = public.req_space_secret()) );
create policy "items write own space" on public.items for insert
  with check ( space_token = public.req_space_id()
          and exists (select 1 from public.spaces s
                      where s.token = public.req_space_id()
                        and s.secret = public.req_space_secret()) );
create policy "items update own space" on public.items for update
  using ( space_token = public.req_space_id()
          and exists (select 1 from public.spaces s
                      where s.token = public.req_space_id()
                        and s.secret = public.req_space_secret()) )
  with check ( space_token = public.req_space_id()
          and exists (select 1 from public.spaces s
                      where s.token = public.req_space_id()
                        and s.secret = public.req_space_secret()) );
create policy "items delete own space" on public.items for delete
  using ( space_token = public.req_space_id()
          and exists (select 1 from public.spaces s
                      where s.token = public.req_space_id()
                        and s.secret = public.req_space_secret()) );

-- spaces policies.
create policy "spaces read own" on public.spaces for select
  using ( token = public.req_space_id() and secret = public.req_space_secret() );
create policy "spaces upsert own" on public.spaces for insert
  with check ( token = public.req_space_id() and secret = public.req_space_secret() );
create policy "spaces update own" on public.spaces for update
  using ( token = public.req_space_id() and secret = public.req_space_secret() )
  with check ( token = public.req_space_id() and secret = public.req_space_secret() );

-- One-time migration of a legacy (space-xxx, no secret) token to a new id.secret,
-- re-keying its items. Callable only by service role (Edge Function).
create or replace function public.migrate_legacy_token(
  old_token text, new_id text, new_secret text
) returns void
language plpgsql as $$
begin
  if not exists (select 1 from public.spaces where token = old_token and secret = '') then
    return; -- already migrated or unknown
  end if;
  update public.items set space_token = new_id where space_token = old_token;
  update public.spaces set token = new_id, secret = new_secret where token = old_token;
end;
$$;
