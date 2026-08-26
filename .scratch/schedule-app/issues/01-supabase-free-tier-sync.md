Type: research
Status: resolved

## Question

What does the Supabase free tier actually allow for an accountless, space-token-synced app? Resolve: (1) free-tier hard limits — DB size, row count, edge-function invocations, realtime connection limits; (2) how to structure data so each "space" is isolated by a token with no user accounts (tables, row-level security policies keyed on a space token rather than auth.uid); (3) whether realtime sync works for browser clients without auth; (4) any CORS/region caveats for direct browser→Supabase access. Deliver a concrete recommended schema sketch (tables, columns, RLS policy) and the free-tier ceiling we must design within.

## Answer

Verdict: the free (Nano) tier is viable for this app. Use the publishable `anon` key from the browser, key RLS on a `space_token` column (not `auth.uid()`), and drive sync through Realtime Postgres Changes (no Auth needed). Design within a 500 MB DB cap and ~200 concurrent Realtime connections.

Sources: Supabase Platform limits (`compute-and-disk`, `realtime/limits`, `functions/limits`), API security (`securing-your-api`, `api-keys`), RLS (`postgres/row-level-security`), Realtime auth (`realtime` repo).

### 1. Free-tier hard limits (the ceiling we design within)

| Resource | Free (Nano) limit | Source |
| --- | --- | --- |
| Max DB size (recommended) | **500 MB** | compute-and-disk |
| Row count | No explicit row cap; the 500 MB disk is the real ceiling. A schedule/todo app stays tiny for a long time. | compute-and-disk |
| DB max connections | 60 (pooler clients 200) | compute-and-disk |
| Compute / memory | Shared CPU, up to 0.5 GB RAM; **subject to change** | compute-and-disk |
| Edge Function concurrency / invocations | No published free request quota; 100 functions/project; 150s wall-clock, 256 MB mem, 2s CPU per request | functions/limits |
| Realtime concurrent connections | **200** | realtime/limits |
| Realtime messages/sec | 100 | realtime/limits |
| Realtime channel joins/sec | 100 | realtime/limits |
| Realtime channels/connection | 100 | realtime/limits |
| Realtime Postgres-change payload | 1,024 KB (truncates old/new to ≤64-byte fields over limit) | realtime/limits |
| Public Realtime connection duration | Limited to **24 hours** unless upgraded with Auth | api-keys |

Design takeaways:
- 500 MB DB is the hard wall — add the guest per-space item cap (~500) + idle expiry already decided in the map; that keeps total rows/fat well under it.
- 200 concurrent Realtime connections is the sync ceiling. With short-lived browser sessions and client-side reconnect/backoff, this is fine for a personal+demo app. Do NOT open a permanent socket per space.
- Edge Functions are effectively unlimited on free but slow (cold starts, 150s cap). We only need them if we later add server-side rate-limiting or token minting — not required for v1.

### 2. Accountless, space-token-isolated data model

No Supabase Auth users. Every client uses the **publishable key** (`sb_publishable_…`, legacy `anon`), which maps to the Postgres `anon` role. Isolation is enforced entirely by RLS on a `space_token` column.

Table sketch (Postgres / Supabase `public` schema):

```sql
-- One row per space. The token is the only secret.
create table public.spaces (
  id          uuid primary key default gen_random_uuid(),
  space_token text not null unique,           -- random, unguessable (e.g. 32-byte base64url)
  title       text,
  created_at  timestamptz not null default now(),
  last_active timestamptz not null default now(),
  is_owner    boolean not null default false  -- David's space; exempt from expiry/caps
);

create index spaces_token_idx on public.spaces using btree (space_token);

-- One row per item (schedule entry / todo / reminder).
create table public.items (
  id          uuid primary key default gen_random_uuid(),
  space_id    uuid not null references public.spaces(id) on delete cascade,
  kind        text not null,                  -- 'schedule' | 'todo' | 'reminder'
  body        jsonb not null,                 -- flexible payload (time, text, done, due, etc.)
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index items_space_id_idx on public.items using btree (space_id);
```

RLS policy sketch — keyed on `space_token`, not `auth.uid()`:

```sql
-- Lock down both tables, then re-grant only to anon (the browser role).
alter table public.spaces enable row level security;
alter table public.items  enable row level security;

revoke all on table public.spaces from anon, authenticated, service_role;
revoke all on table public.items  from anon, authenticated, service_role;

grant select, insert, update, delete on table public.spaces to anon;
grant select, insert, update, delete on table public.items  to anon;

-- Helper: resolve the space for a token. SECURITY DEFINER avoids recursion
-- and keeps the lookup index-only. Pin search_path.
create function public.space_id_for_token(t text)
returns uuid
language sql
security definer
set search_path = ''
stable
as $$
  select id from public.spaces where space_token = t limit 1;
$$;

grant execute on function public.space_id_for_token(text) to anon;

-- The client passes its token in the 'x-space-token' header;
-- RLS reads it via request.headers and checks ownership of the row.
-- SELECT spaces
create policy "anon reads own space"
on public.spaces for select to anon
using ( space_token = current_setting('request.headers', true)::json->>'x-space-token' );

-- SELECT items
create policy "anon reads own items"
on public.items for select to anon
using ( space_id = public.space_id_for_token(
          current_setting('request.headers', true)::json->>'x-space-token' ) );

-- INSERT items (token must match the parent space)
create policy "anon inserts own items"
on public.items for insert to anon
with check ( space_id = public.space_id_for_token(
               current_setting('request.headers', true)::json->>'x-space-token' ) );

-- UPDATE / DELETE items
create policy "anon updates own items"
on public.items for update to anon
using ( space_id = public.space_id_for_token(
          current_setting('request.headers', true)::json->>'x-space-token' ) )
with check ( space_id = public.space_id_for_token(
               current_setting('request.headers', true)::json->>'x-space-token' ) );

create policy "anon deletes own items"
on public.items for delete to anon
using ( space_id = public.space_id_for_token(
          current_setting('request.headers', true)::json->>'x-space-token' ) );
```

Notes (from `postgres/row-level-security` + `securing-your-api`):
- Every exposed table needs BOTH a `grant` and an RLS policy; grants alone are not enough, and new `public` tables auto-grant all privileges to `anon` — revoke first.
- Filter columns (`space_token`, `space_id`) must be indexed or reads become sequential scans.
- The `x-space-token` header is read by RLS via `current_setting('request.headers')`. The publishable key is the other mandatory header (`apikey`).
- Optional abuse guard: a `db_pre_request` function can reject requests missing a valid `x-space-token` (HTTP 403) and rate-limit writes per IP — but it only covers the Data API, not Realtime. Defer to v2.
- `service_role`/secret keys bypass RLS and must NEVER reach the browser (api-keys).

### 3. Does Realtime work for browser clients without Auth?

Yes. Realtime connections use JWT auth, but a **public channel** (`socket.channel("realtime:…").join()`) needs no token and evaluates no RLS. For Postgres Changes (row sync), the browser connects with the publishable `anon` key; the `anon` role receives change events and RLS still filters which rows the socket sees — so a client only gets change events for rows its `anon` policies allow (i.e. its own space, via the `x-space-token`-derived policies). Verified against the Realtime auth reference: all connections require a JWT, and the publishable/anon key supplies one. Caveat: public (non-upgraded) Realtime connections are capped at **24 hours** and must reconnect.

So: subscribe each space to a Postgres Changes channel filtered to that space's `space_id`, using the `anon` key. RLS scopes the events. No user accounts required.

### 4. CORS / region caveats for direct browser→Supabase

- The Supabase Data API and Realtime endpoints send permissive CORS headers for the publishable key, so direct `fetch`/`supabase-js` calls from a browser (any origin incl. `file://`/localhost/your domain) work without you configuring CORS. No manual CORS setup needed.
- Pick ONE region at project creation — it cannot be changed afterward. Choose the one nearest David's location (e.g. `us-east-1`) to minimize latency; a global audience would see slightly higher latency but it's fine for this app.
- The publishable key is safe to ship in client code; protection comes from RLS, not key secrecy. Keep the secret key server-side only.
- Free plan compute is best-effort/shared and "subject to change"; expect occasional cold-start latency on first request after idle.

### Recommended build within the free ceiling
1. Single Supabase project, one region, publishable `anon` key in the client.
2. Tables: `spaces` (token) + `items` (FK space_id), RLS keyed on `space_token` via header + `space_id_for_token()` helper.
3. Sync via Realtime Postgres Changes on `items` per space_id, `anon` key, 24h-reconnect + backoff.
4. Stay under 500 MB DB (guest cap ~500 items + idle expiry), keep sockets short-lived (200 conn ceiling).
5. Defer Edge Functions + `db_pre_request` abuse guard to v2.
