-- 0009_due_settings.sql
-- Two settings for the Due tab: whether to include overdue items, and
-- how many days ahead the "This week" window should look. Mirrors the
-- new Settings fields added in src/settings.ts (task 3 of the
-- 2026-09-04 UI polish pass).

alter table public.profiles
  add column if not exists due_include_overdue boolean not null default true;

alter table public.profiles
  add column if not exists due_days_ahead int not null default 7;