Type: task
Status: resolved
Blocked by: 01, 04

## Question

Stand up the actual Supabase project and schema per the research (ticket 01) and domain model (ticket 04): create the project, define tables (spaces, tasks/items, reminders), write RLS policies that isolate rows by space token, and document the project URL/anon key + how to run migrations locally. This is manual setup work that unblocks build; it earns its place by unblocking the decision to build against a real backend. Resolved when the schema exists and a browser client can read/write under a token.

## Answer

Schema + RLS are **drafted and committed** in `supabase/migrations/0001_init.sql` (per ticket 01's research + ticket 04's domain model):
- `spaces(token PK, last_active_at, created_at)` and `items(id PK, space_token FK, kind, title, datetime, all_day, reminder, status, created_at)`.
- **RLS keyed on `space_token`** read from the `x-space-token` request header (no `auth.uid()`), so accountless sync works. Insert/update/delete all scoped to the caller's token.
- **500-item cap** enforced by a DB trigger (`enforce_item_cap`) — the guest guard-rail from the map.

App wiring for sync is done: `src/supabase.ts` creates the Supabase client from `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON`, passes `x-space-token` on every request, upserts the space row (`ensureSpace`) so inserts pass FK+RLS, and subscribes to `postgres_changes` for realtime. Demo mode (localStorage) is used automatically when env vars are absent. `.env.example` documents the two vars.

**Remaining manual step (user action, not agent):** create a free Supabase project, paste `0001_init.sql` into the SQL editor (or `supabase db push`), copy Project URL + anon key into `.env`, and deploy the app. Until then the app runs in demo mode. This is the one-time account action the ticket existed to unblock.
