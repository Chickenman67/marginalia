-- Add API key fields to profiles for cross-device sync
alter table public.profiles
  add column if not exists llm_key text,
  add column if not exists llm_provider text not null default 'nvidia';

-- Migrate existing provider column if it exists and is different
update public.profiles set llm_provider = provider where provider is not null;
alter table public.profiles drop column if exists provider;
