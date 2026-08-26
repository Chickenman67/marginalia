-- Fix FK-ordering bug in migrate_legacy_token (Task 5).
-- The FK items.space_token REFERENCES spaces(token) is NOT DEFERRABLE, so neither
-- single-statement order works: updating items first points them at new_id while
-- spaces still holds old_token; updating spaces first orphans items still pointing
-- at old_token. Both raise the same FK violation.
--
-- Real fix: make the FK DEFERRABLE (INITIALLY IMMEDIATE — unchanged behavior outside
-- transactions) and defer it for the duration of the re-key inside the helper, so
-- both rows move consistently within one transaction.

alter table public.items drop constraint if exists items_space_token_fkey;
alter table public.items add constraint items_space_token_fkey
  foreign key (space_token) references public.spaces(token) on delete cascade
  deferrable initially immediate;

create or replace function public.migrate_legacy_token(
  old_token text, new_id text, new_secret text
) returns void
language plpgsql as $$
begin
  if not exists (select 1 from public.spaces where token = old_token and token like 'space-%') then
    return; -- not a legacy token or unknown
  end if;
  set constraints public.items_space_token_fkey deferred;
  update public.spaces set token = new_id, secret = new_secret where token = old_token;
  update public.items set space_token = new_id where space_token = old_token;
end;
$$;
