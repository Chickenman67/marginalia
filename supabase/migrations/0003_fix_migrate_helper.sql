-- Fix Task 2 defects in migrate_legacy_token without touching 0002 (already applied).

-- Defect 1: 0002's backfill set a random secret on every legacy row, so the
-- `secret = ''` guard never matched and the helper's body never ran. Legacy rows
-- are identified by the `space-` prefix instead, so they can still be migrated.
create or replace function public.migrate_legacy_token(
  old_token text, new_id text, new_secret text
) returns void
language plpgsql as $$
begin
  if not exists (select 1 from public.spaces where token = old_token and token like 'space-%') then
    return; -- not a legacy token or unknown
  end if;
  update public.items set space_token = new_id where space_token = old_token;
  update public.spaces set token = new_id, secret = new_secret where token = old_token;
end;
$$;

-- Defect 2: functions are granted EXECUTE to PUBLIC by default, letting an
-- anon/authenticated caller invoke migrate_legacy_token and hijack a space.
-- Revoke from PUBLIC; the Edge Function calls it via service_role which retains
-- EXECUTE, so the legitimate path is unaffected.
revoke execute on function public.migrate_legacy_token(text, text, text) from public;

-- Robustness: honor the global constraint "secret = everything after first dot".
-- Base64url secrets contain no dots, so behavior is unchanged but now correct.
create or replace function public.req_space_secret() returns text
language sql stable as $$
  select substring(current_setting('request.headers', true)::json->>'x-space-token'
                    from strpos(current_setting('request.headers', true)::json->>'x-space-token', '.') + 1);
$$;
