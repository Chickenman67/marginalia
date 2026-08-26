drop function if exists public.migrate_legacy_token(text, text, text);

create function public.migrate_legacy_token(
  old_token text, new_id text, new_secret text
) returns boolean
language plpgsql as $$
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
