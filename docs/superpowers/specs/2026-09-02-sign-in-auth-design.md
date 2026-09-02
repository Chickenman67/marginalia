# Sign-In Authentication — Design

**Date:** 2026-09-02
**Status:** Approved (user review)

## Problem

The app currently has no real authentication. The identity model is a random
`id.secret` space token persisted in `localStorage`, generated client-side
(`src/store.ts:8`). Access to a user's data is controlled by sending that
token in an `x-space-token` header on every Supabase request, with RLS
policies that match on the token (`supabase/migrations/0001_init.sql:41`).

This has three problems the app owner wants fixed:

1. **No real accounts.** The "user" is just whoever happens to have the
   token. There is no way to recover access if the token is lost, no way to
   share a device without sharing a list, and no way to sign in from a new
   device without first copying the token from an existing one.
2. **Token-only security.** A leaked token (browser extension, shared link,
   copy-paste into chat) gives the recipient full read/write access. There is
   no password, no second factor, nothing else.
3. **Awkward multi-device flow.** Joining your list on a new device requires
   pasting a long opaque string instead of typing a password or clicking a
   social button.

The app owner wants a real sign-in flow: email + password, "Continue with
Google", "Continue with GitHub". The space token is replaced with a Supabase
Auth user identity. RLS keys on `auth.uid()`, not on a custom header.

## Goals

- Replace the space-token identity with a Supabase Auth user account.
- Support three sign-in methods: email + password, Google OAuth, GitHub
  OAuth.
- Keep the existing app UX (schedule / todos / due / dictation / AI parsing /
  reminders / settings) unchanged after sign-in.
- Provide a one-time path for existing token users to attach their old data
  to a new account.
- Drop the `localStorage` demo mode. The app is a real authenticated app;
  the demo story goes away (the app owner chose "sign-in required" over
  "keep local demo").
- Stay on free tiers only.

## Non-goals (YAGNI)

- No role-based access, no teams, no shared spaces. One user = one private
  list. (Sharing a list still works via export/import, not via inviting
  another user.)
- No email/username recovery beyond Supabase's built-in password reset email.
- No MFA, no passkeys, no SSO. Standard Supabase Auth only.
- No change to AI parsing (`parse` / `polish` Edge Functions remain),
  reminders, or the dictation flow.
- No migration of items from a signed-out browser. Items created before
  sign-in without a claimed token are abandoned.

---

## Section 1 — Architecture overview

The app becomes a per-user authenticated app. Identity is a Supabase Auth
user (`auth.users.id` = `auth.uid()`). Every data row gets a
`user_id uuid references auth.users(id)` column. RLS policies on every table
require `user_id = auth.uid()`. The browser holds a Supabase session in
`localStorage` (managed by `@supabase/supabase-js`); every request includes
`Authorization: Bearer <jwt>` automatically — no more `x-space-token`.

The space token (`id.secret` pair) goes away entirely. Its job — "how do we
know whose data this is" — is taken over by the JWT. The "demo mode"
(`localStorage` fallback when `VITE_SUPABASE_URL` is empty) also goes away,
because there is no anon user anymore and the app owner chose to require
sign-in.

**First-run flow:** the app loads. If no session, it renders `<AuthScreen>`
(sign-in / sign-up form, social buttons). On session, it renders the normal
app shell. Sign-out returns to `<AuthScreen>`.

**Bootstrap dependency change:** `src/main.ts` no longer calls `loadItems()`
until a session exists. All UI mounts are gated by `auth.onAuthStateChange`.

**Edge Function auth:** `parse` and `polish` switch from verifying
`x-space-token` to verifying the JWT. `migrate-token` is removed (its job
is replaced by `claim-space`, see Section 2.4).

## Section 2 — Database schema (Supabase migrations)

New migration `supabase/migrations/0008_user_auth.sql` (additive, runs
once). Steps in order; each step leaves the schema valid for the next.

### 2.1 Add `items.user_id`

```
alter table public.items
  add column user_id uuid references auth.users(id) on delete cascade;

create index if not exists items_user_idx
  on public.items (user_id, created_at desc);
```

Column is nullable at this step so existing rows remain valid until the
backfill assigns them.

### 2.2 New `profiles` table (1:1 with `auth.users`)

```
create table if not exists public.profiles (
  user_id           uuid primary key references auth.users(id) on delete cascade,
  display_name      text,
  color_rules       jsonb not null default '[]'::jsonb,
  auto_remind_events boolean not null default true,
  military_time     boolean not null default false,
  auto_delete       boolean not null default false,
  auto_delete_days  int    not null default 30,
  provider          text   not null default 'nvidia',
  updated_at        timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "profiles read own"
  on public.profiles for select
  using ( user_id = auth.uid() );

create policy "profiles write own"
  on public.profiles for insert
  with check ( user_id = auth.uid() );

create policy "profiles update own"
  on public.profiles for update
  using ( user_id = auth.uid() )
  with check ( user_id = auth.uid() );

create policy "profiles delete own"
  on public.profiles for delete
  using ( user_id = auth.uid() );

-- Auto-create a profile row on sign-up.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
as $$
begin
  insert into public.profiles (user_id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)));
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
```

### 2.3 `items` RLS switch

Replace the four token-based `items` policies with `user_id`-based ones:

```
drop policy if exists "items read own space"   on public.items;
drop policy if exists "items write own space"  on public.items;
drop policy if exists "items update own space" on public.items;
drop policy if exists "items delete own space" on public.items;

create policy "items read own"
  on public.items for select using ( user_id = auth.uid() );
create policy "items write own"
  on public.items for insert with check ( user_id = auth.uid() );
create policy "items update own"
  on public.items for update
  using ( user_id = auth.uid() )
  with check ( user_id = auth.uid() );
create policy "items delete own"
  on public.items for delete using ( user_id = auth.uid() );
```

`enforce_item_cap` trigger changes to scope by `user_id`:

```
create or replace function public.enforce_item_cap()
returns trigger language plpgsql as $$
begin
  if (select count(*) from public.items where user_id = new.user_id) >= 500 then
    raise exception 'item limit reached';
  end if;
  return new;
end;
$$;
```

`spaces` table and `items.space_token` column remain in place at this point
so the claim flow (2.4) can still resolve old tokens. They are dropped at
2.6.

### 2.4 Token-claim Edge Function `claim-space`

A new Edge Function lets a signed-in user claim the data from a pre-auth
token. It is called from a "Claim previous data" form on the auth screen.

Contract:

- **Request** (POST): `{ token: string }` where `token` is the old
  `id.secret` pair.
- **Auth:** standard Supabase JWT in `Authorization` header.
- **Behavior:**
  1. Parse the token into `id` and `secret`.
  2. Look up `public.spaces` by `token = id`; reject 404 if missing.
  3. Reject 403 if `spaces.secret != secret` (proves possession).
  4. `update public.items set user_id = <jwt.sub> where space_token = <id>`.
  5. `delete from public.spaces where token = <id>`.
  6. Return `{ ok: true, count: <rows moved> }`.
- **Errors:** 401 missing/invalid JWT, 404 unknown token, 403 bad secret,
  500 db error.

### 2.5 Make `items.user_id` NOT NULL and index

After the claim flow ships and the app owner has had time to migrate
(operationally: run the claim helper once, or accept the data loss), the
final migration step:

```
update public.items set user_id = (
  -- one-time "ghost" assignment: any unclaimed row gets a sentinel UUID
  -- that the app filters out. Acceptable data loss for v1.
  '00000000-0000-0000-0000-000000000000'::uuid
) where user_id is null;

alter table public.items alter column user_id set not null;
```

The ghost UUID is filtered out client-side so the user never sees it; it
exists only to satisfy the NOT NULL constraint on legacy rows that nobody
claimed.

### 2.6 Drop the token columns and `spaces` table

After the app owner confirms their data has been claimed (or the data-loss
window has passed):

```
drop table if exists public.spaces;
alter table public.items drop column if exists space_token;
```

The `x-space-token` header is dropped from the client in the same release
(see Section 3).

## Section 3 — Client-side code changes

### 3.1 New files

**`src/auth.ts`** — thin wrapper around `@supabase/supabase-js` auth:
- `getSession(): Promise<Session | null>`
- `onAuthChange(cb: (session: Session | null) => void): () => void`
- `signInWithPassword(email, password): Promise<{ ok, message? }>`
- `signUpWithPassword(email, password): Promise<{ ok, message? }>`
- `signInWithGoogle(): Promise<{ ok, message? }>`
- `signInWithGitHub(): Promise<{ ok, message? }>`
- `sendPasswordReset(email): Promise<{ ok, message? }>`
- `signOut(): Promise<void>`

All return a normalized `{ ok, message }` so the UI can show errors
uniformly. Social sign-in opens a popup; on `popup_closed_by_user` we
return `{ ok: false, message: "Sign-in popup was closed." }`.

**`src/ui/authScreen.ts`** — the sign-in / sign-up form. Three states:
"sign in", "sign up", "forgot password". Buttons: Continue with Google,
Continue with GitHub, Email + password submit, "Claim previous data"
(shows a token input that calls `claim-space`). Posts to the helpers
above; on success `onAuthChange` fires and the screen unmounts.

### 3.2 Changed files

- **`src/main.ts`** — replace the boot path: wait for `getSession()` /
  `onAuthChange`'s first non-null session before calling `loadItems()` /
  `subscribeRealtime()`. While `session === null`, mount `<AuthScreen>` and
  skip the rest.
- **`src/supabase.ts`** — drop the `x-space-token` global header. Default
  Supabase client (which auto-attaches the JWT) replaces it. Remove
  `ensureSpace`, `migrateLegacyToken`. `subscribeToSpace` filter becomes
  `user_id=eq.${user.id}`. Edge function calls (`parsePhrase`,
  `polishPhrase`) no longer pass `x-space-token`. New helper
  `fetchProfile(userId)` reads `public.profiles`; new helper
  `updateProfile(patch)` writes it.
- **`src/store.ts`** — delete `genTokenPair`, `combineToken`, `splitToken`,
  `isLegacyToken`, `getSpaceToken`, `getSpaceId`, `getSpaceSecret`,
  `setSpaceToken`. `isDemoMode` branch and the `marginalia.items`
  localStorage write are removed. `setItems` / `getItems` / `importItems`
  keep their signatures; in the non-demo path, `insertItem` stamps
  `user_id = session.user.id` before insert.
- **`src/ui/header.ts`** — remove `getSpaceToken`, `setSpaceToken`,
  `splitToken`, `combineToken`, `genTokenPair`. Drop the `#tokenModal`
  "Your space" UI. Replace `#spaceChip` with a user menu (email + dropdown:
  Settings, Sign out). Drop `#copyToken`, `#downloadToken`, `downloadToken`.
  The first-run "open the token modal" branch is gone.
- **`src/settings.ts`** — `getSettings()` reads from `profiles` (via
  `fetchProfile`) merged with `localStorage.llmKey`. `updateSettings()`
  patches `profiles` and updates the in-memory cache. The settings modal
  is otherwise unchanged in shape.
- **`src/backup.ts`** — `downloadToken` removed. `toCSV` / `toText` /
  `parseFile` / `applyImport` unchanged. `applyImport` in the non-demo
  branch stamps `user_id` from session instead of `space_token`.
- **`src/config.ts`** — `STORAGE_KEYS.spaceToken` deleted. `llmKey` and
  `provider` remain. `isDemoMode` is removed (no demo mode anymore).
- **`index.html`** — remove the `#tokenModal` block. Add `<div id="authRoot">`
  for `<AuthScreen>`. The rest stays.
- **`src/style.css`** — add styles for the auth screen: centered card,
  social buttons stacked, error banner, "Claim previous data" disclosure.

### 3.3 Unchanged files

`src/types.ts`, `src/reminders.ts`, `src/speech.ts`, `src/whisper.ts`,
`src/ui/calendar.ts`, `src/ui/filterPanel.ts`, `src/ui/views.ts`,
`src/ui/input.ts`. The AI failure banner in `input.ts` continues to work
because the user is always identified now.

### 3.4 Files removed

- `src/ui/tokenModal.ts` (if it exists; otherwise just the markup in
  `index.html` and the handler block in `header.ts`).
- `tests/unit/tokens.test.ts` (its subject — the token helpers — is
  deleted).
- `supabase/functions/migrate-token/index.ts` (obsolete).

### 3.5 Environment / hosting

The deployed static site needs the Supabase project's **Site URL** and
**redirect URLs** configured in the Supabase dashboard for OAuth
(Google / GitHub). Google / GitHub sign-in opens a popup that returns to
the same origin, so no special redirect handling is needed in code; only
the dashboard config.

`.env` keeps `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON`. There is no longer
a "demo mode without env vars" path — `.env` becomes required for the
app to function. The README is updated to call this out.

## Section 4 — Data flow, error handling, testing

### 4.1 Boot flow (signed-in)

1. `main.ts` calls `await getSession()` → returns `Session`.
2. `fetchProfile(user.id)` populates the in-memory settings cache from
   `profiles`.
3. `mountHeader()` (showing user.email + dropdown) and `mountInput()` /
   `mountViews()` run.
4. `subscribeRealtime()` opens a channel filtered on
   `user_id=eq.${user.id}` — only that user's rows arrive.
5. `loadItems()` fetches via `select * from items where user_id =
   auth.uid()`. RLS enforces it server-side, so even a buggy client can't
   read another user's data.

### 4.2 Boot flow (signed-out)

1. `getSession()` returns `null`.
2. `mountAuthScreen()` renders the sign-in / sign-up form into
   `#authRoot`.
3. The rest of the app is not mounted. The header / dock / main
   elements in `index.html` are hidden via CSS until session exists.
4. On `signInWithPassword` / OAuth success, `onAuthStateChange` fires →
   auth screen unmounts, normal boot runs.

### 4.3 Sign-out flow

`signOut()` clears the session. `onAuthStateChange` fires with `null` →
app unmounts, auth screen renders.

### 4.4 Error handling

- **Auth errors** (wrong password, email already in use, OAuth popup
  blocked) → the helper returns `{ ok: false, message }`; the auth screen
  shows the message in a `.key-status bad` banner. No silent fallbacks.
- **JWT expired mid-session** → `@supabase/supabase-js` auto-refreshes; if
  refresh fails, the next request returns 401, the realtime channel
  closes, and the app shows a "Session expired — sign in again" toast and
  re-mounts the auth screen.
- **Network down** → existing behavior: writes queue in memory and the UI
  shows the items locally; the realtime re-subscribe retries on
  reconnect. No data loss because Supabase queues writes.
- **Item cap hit** (500 items/user) → insert returns a Postgres
  exception; the UI shows "Item limit reached — delete or export old
  items." trigger message.

### 4.5 Testing

1. **Sign-up with email/password:** new user lands on an empty app.
   Creating a todo, signing out, signing back in → the todo is still
   there.
2. **Google OAuth:** button → popup → permission grant → returns to the
   app → loads with an empty list.
3. **GitHub OAuth:** same as Google.
4. **Wrong password:** red error banner, no session, app stays on auth
   screen.
5. **RLS isolation:** open two browsers signed in as different users; each
   only sees its own items. Verifiable via `psql`:
   `set request.jwt.claims to '{"sub":"<other-user-id>"}'; select * from
   items;` returns nothing.
6. **Realtime:** add an item in browser A; it appears in browser B within
   1 s.
7. **Token claim flow:** in a local DB seeded with an old `space-xxx`
   token and 3 items, sign in fresh and paste the token in "Claim
   previous data" → all 3 items appear in the new account; `spaces` row
   is gone.
8. **Item cap:** insert 500 items, attempt a 501st → friendly error.
9. **Sign-out:** items vanish, auth screen reappears.
10. **JWT expiry:** set a short token lifetime in the Supabase dashboard
    (test only); force expiry → toast + auth screen.
11. **Existing unit tests** (`tests/unit/*.test.ts`): all remaining tests
    (views, store list, store import, star, star click, filter panel,
    backup) should still pass. None of them touch the space token
    directly. `tokens.test.ts` is deleted.

## Files touched (planned)

### Database
- `supabase/migrations/0008_user_auth.sql` (new) — Sections 2.1–2.6.
- `supabase/functions/claim-space/index.ts` (new) — Section 2.4.

### Edge Functions (auth swap)
- `supabase/functions/parse/index.ts` — drop `x-space-token` check; verify
  JWT.
- `supabase/functions/polish/index.ts` — same.
- `supabase/functions/migrate-token/index.ts` — deleted.

### Client (add)
- `src/auth.ts`
- `src/ui/authScreen.ts`

### Client (change)
- `src/main.ts`
- `src/supabase.ts`
- `src/store.ts`
- `src/ui/header.ts`
- `src/settings.ts`
- `src/backup.ts`
- `src/config.ts`
- `index.html`
- `src/style.css`
- `README.md` — note the loss of demo mode and the `.env` requirement.

### Client (delete)
- `src/ui/tokenModal.ts` (if separate)
- `tests/unit/tokens.test.ts`

### Host config
- Supabase dashboard: configure OAuth providers (Google, GitHub), Site
  URL, redirect URLs.
