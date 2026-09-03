# Sign-In Authentication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the space-token identity model with Supabase Auth (email/password + Google + GitHub). Every `items` row is owned by `auth.users(id)`. RLS keys on `user_id`, not on the old `x-space-token` header.

**Architecture:** Add `items.user_id` and a new `profiles` table (1:1 with `auth.users`); switch `items` RLS to `user_id = auth.uid()`; add a `claim-space` Edge Function so existing token users can attach their old data to a new account. The browser now talks to Supabase with the default JWT-Authorization flow; the `x-space-token` header is gone. A new `AuthScreen` is the first thing the app shows; once a session exists, the normal app shell mounts.

**Tech Stack:** Supabase (Postgres + Auth + Edge Functions), `@supabase/supabase-js` v2, TypeScript, Vite, vitest. Free tier only.

## Global Constraints

- Free tier only. No paid APIs. (From AGENTS.md.)
- Stay on Supabase project ref `PROJECT_REF` (us-east-1). (From AGENTS.md.)
- Supabase CLI is already configured. Migration files go under `supabase/migrations/`.
- Edge Functions live under `supabase/functions/<name>/index.ts` and are deployed with `supabase functions deploy <name> --project-ref PROJECT_REF --no-verify-jwt false` (the function verifies the JWT itself).
- Client code uses `@supabase/supabase-js` v2 APIs (`signInWithPassword`, `signInWithOAuth`, `onAuthStateChange`, `auth.getUser(jwt)`).
- The migration `0008_user_auth.sql` is additive; existing data is preserved until the claim flow runs (or the user accepts data loss).
- After this plan, no `x-space-token` header is sent anywhere; no `space-` prefixed tokens exist client-side; no `localStorage` "demo mode" branch remains.
- Settings previously in `localStorage` (`autoRemindEvents`, `militaryTime`, `autoDelete`, `autoDeleteDays`, `colorRules`, `provider`) move to the `profiles` table. `llmKey` stays in `localStorage` because it is the user's own key, not a server-side setting.
- Item cap stays at 500, scoped per `user_id` (was per `space_token`).
- The styles in `src/style.css` follow the existing visual language (Fraunces + Inter, the same green/cream palette). No new color tokens.

---

## File Structure

### New files
- `supabase/migrations/0008_user_auth.sql` — schema changes: add `items.user_id`, create `profiles` + RLS, replace `items` RLS, update `enforce_item_cap` trigger, backfill `user_id`, drop `spaces` and `items.space_token`.
- `supabase/functions/claim-space/index.ts` — Edge Function that moves a pre-auth token's items to the signed-in user.
- `src/auth.ts` — thin wrapper around `@supabase/supabase-js` auth API.
- `src/ui/authScreen.ts` — sign-in / sign-up / forgot-password form with social buttons + claim-previous-data disclosure.
- `tests/unit/auth.test.ts` — unit tests for the `auth.ts` wrapper (mocked client).
- `tests/unit/header-user-menu.test.ts` — unit test that the header renders the user menu (no token UI).

### Changed files
- `src/main.ts` — gate boot on session; mount auth screen if no session.
- `src/supabase.ts` — drop `x-space-token` header; remove `ensureSpace` and `migrateLegacyToken`; switch realtime filter to `user_id`; add `fetchProfile` / `updateProfile`; switch Edge Function calls to JWT-only auth.
- `src/store.ts` — remove all token helpers; remove demo-mode branch; stamp `user_id` on insert.
- `src/ui/header.ts` — remove token UI; replace `#spaceChip` with user menu (email + dropdown: Settings, Sign out); drop `#copyToken`, `#downloadToken`, `downloadToken`.
- `src/settings.ts` — read from `profiles` (with cache), fall back to `localStorage.llmKey`; write through `updateProfile`.
- `src/backup.ts` — drop `downloadToken`; `applyImport` stamps `user_id` from session.
- `src/config.ts` — drop `STORAGE_KEYS.spaceToken`; drop `isDemoMode`.
- `index.html` — remove `#tokenModal`; add `<div id="authRoot">` and `<div id="appRoot" hidden>`; keep rest.
- `src/style.css` — add auth screen styles; add user-menu dropdown styles.
- `supabase/functions/parse/index.ts` — drop `x-space-token` check; verify JWT.
- `supabase/functions/polish/index.ts` — drop `x-space-token` check; verify JWT.
- `README.md` — note the loss of demo mode and the `.env` requirement.

### Deleted files
- `tests/unit/tokens.test.ts` — its subject is gone.
- `supabase/functions/migrate-token/index.ts` — replaced by `claim-space`.

---

## Task 1: Database migration — add `items.user_id`, `profiles`, switch RLS

**Files:**
- Create: `supabase/migrations/0008_user_auth.sql`
- Read: `supabase/migrations/0001_init.sql`, `supabase/migrations/0002_harden_tokens.sql`

**Interfaces:**
- Produces: `public.profiles` table, `items.user_id` column, `handle_new_user` trigger, updated RLS on `items`.

- [ ] **Step 1: Write the migration file**

Create `supabase/migrations/0008_user_auth.sql` with these contents (do not paraphrase — copy verbatim):

```sql
-- 0008_user_auth.sql
-- Sign-in authentication: per-user accounts via Supabase Auth.

-- 1) Add user_id to items (nullable initially so existing rows survive).
alter table public.items
  add column if not exists user_id uuid references auth.users(id) on delete cascade;

create index if not exists items_user_idx
  on public.items (user_id, created_at desc);

-- 2) profiles table (1:1 with auth.users).
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

drop policy if exists "profiles read own"  on public.profiles;
drop policy if exists "profiles write own" on public.profiles;
drop policy if exists "profiles update own" on public.profiles;
drop policy if exists "profiles delete own" on public.profiles;

create policy "profiles read own"
  on public.profiles for select using ( user_id = auth.uid() );
create policy "profiles write own"
  on public.profiles for insert with check ( user_id = auth.uid() );
create policy "profiles update own"
  on public.profiles for update
  using ( user_id = auth.uid() )
  with check ( user_id = auth.uid() );
create policy "profiles delete own"
  on public.profiles for delete using ( user_id = auth.uid() );

-- 3) Auto-create a profile row on sign-up.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
as $$
begin
  insert into public.profiles (user_id, display_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1))
  )
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 4) Replace items RLS with user_id-based policies.
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

-- 5) Item cap trigger: now scoped per user.
create or replace function public.enforce_item_cap()
returns trigger
language plpgsql
as $$
begin
  if (select count(*) from public.items where user_id = new.user_id) >= 500 then
    raise exception 'item limit reached';
  end if;
  return new;
end;
$$;

drop trigger if exists items_cap on public.items;
create trigger items_cap before insert on public.items
  for each row execute function public.enforce_item_cap();

-- 6) Backfill: any rows whose space_token was not claimed are deleted.
--    We cannot keep them as orphans because user_id has a FK to auth.users,
--    and Supabase does not let SQL create auth.users rows. Items whose
--    owner never claimed the token are abandoned. Acceptable data loss
--    for v1; export/import gives users a backup path.
delete from public.items where user_id is null;

alter table public.items alter column user_id set not null;

-- 7) Drop the legacy token surface. Spaces and items.space_token are gone.
drop table if exists public.spaces;
alter table public.items drop column if exists space_token;
```

- [ ] **Step 2: Apply the migration to the local Supabase project**

Run: `supabase db push --project-ref PROJECT_REF`
Expected: migration applies cleanly. If the CLI prompts for confirmation, accept.

- [ ] **Step 3: Verify the new tables and policies exist**

Run: `supabase db remote psql --project-ref PROJECT_REF -c "\d public.items"` and `... -c "\d public.profiles"`.
Expected: `items` shows `user_id uuid not null` and the four new RLS policies. `profiles` shows its columns and the four RLS policies. The `spaces` table is gone.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0008_user_auth.sql
git commit -m "feat(db): add user_id + profiles table, switch RLS to auth.uid()"
```

---

## Task 2: Auth wrapper module (`src/auth.ts`)

**Files:**
- Create: `src/auth.ts`
- Test: `tests/unit/auth.test.ts`

**Interfaces:**
- Produces (consumed by later tasks):
  - `getSession(): Promise<Session | null>`
  - `onAuthChange(cb: (session: Session | null) => void): () => void`
  - `signInWithPassword(email: string, password: string): Promise<{ ok: boolean; message?: string }>`
  - `signUpWithPassword(email: string, password: string): Promise<{ ok: boolean; message?: string }>`
  - `signInWithGoogle(): Promise<{ ok: boolean; message?: string }>`
  - `signInWithGitHub(): Promise<{ ok: boolean; message?: string }>`
  - `sendPasswordReset(email: string): Promise<{ ok: boolean; message?: string }>`
  - `signOut(): Promise<void>`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/auth.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockSignInWithPassword = vi.fn();
const mockSignUp = vi.fn();
const mockSignInWithOAuth = vi.fn();
const mockResetPasswordForEmail = vi.fn();
const mockSignOut = vi.fn();
const mockGetSession = vi.fn();
const mockOnAuthStateChange = vi.fn();

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    auth: {
      getSession: mockGetSession,
      onAuthStateChange: mockOnAuthStateChange,
      signInWithPassword: mockSignInWithPassword,
      signUp: mockSignUp,
      signInWithOAuth: mockSignInWithOAuth,
      resetPasswordForEmail: mockResetPasswordForEmail,
      signOut: mockSignOut
    }
  })
}));

import {
  signInWithPassword,
  signUpWithPassword,
  signInWithGoogle,
  signInWithGitHub,
  sendPasswordReset
} from "../../src/auth";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("auth wrapper", () => {
  it("signInWithPassword returns ok:true on success", async () => {
    mockSignInWithPassword.mockResolvedValue({ data: { session: {} }, error: null });
    const r = await signInWithPassword("a@b.c", "pw");
    expect(r).toEqual({ ok: true });
    expect(mockSignInWithPassword).toHaveBeenCalledWith({ email: "a@b.c", password: "pw" });
  });

  it("signInWithPassword returns ok:false with message on error", async () => {
    mockSignInWithPassword.mockResolvedValue({ data: { session: null }, error: { message: "Invalid login" } });
    const r = await signInWithPassword("a@b.c", "wrong");
    expect(r.ok).toBe(false);
    expect(r.message).toBe("Invalid login");
  });

  it("signUpWithPassword returns ok:false when email already in use", async () => {
    mockSignUp.mockResolvedValue({ data: { user: null }, error: { message: "User already registered" } });
    const r = await signUpWithPassword("a@b.c", "pw");
    expect(r.ok).toBe(false);
    expect(r.message).toBe("User already registered");
  });

  it("signInWithGoogle calls signInWithOAuth with provider 'google' and opens a popup", async () => {
    mockSignInWithOAuth.mockResolvedValue({ data: {}, error: null });
    const r = await signInWithGoogle();
    expect(r.ok).toBe(true);
    expect(mockSignInWithOAuth).toHaveBeenCalledWith({ provider: "google", options: { redirectTo: expect.any(String) } });
  });

  it("signInWithGitHub returns ok:false on popup_closed_by_user", async () => {
    mockSignInWithOAuth.mockResolvedValue({ data: null, error: { message: "popup_closed_by_user" } });
    const r = await signInWithGitHub();
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/closed/i);
  });

  it("sendPasswordReset returns ok:true on success", async () => {
    mockResetPasswordForEmail.mockResolvedValue({ data: {}, error: null });
    const r = await sendPasswordReset("a@b.c");
    expect(r.ok).toBe(true);
    expect(mockResetPasswordForEmail).toHaveBeenCalledWith("a@b.c", expect.any(Object));
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `npm test -- tests/unit/auth.test.ts`
Expected: FAIL — `auth` module does not exist.

- [ ] **Step 3: Write `src/auth.ts`**

```ts
import { config } from "./config";
import type { Session } from "@supabase/supabase-js";

let clientPromise: Promise<import("@supabase/supabase-js").SupabaseClient> | null = null;

function getClient() {
  if (!clientPromise) {
    clientPromise = (async () => {
      const { createClient } = await import("@supabase/supabase-js");
      return createClient(config.supabaseUrl, config.supabaseAnon, {
        auth: { persistSession: true, autoRefreshToken: true }
      });
    })();
  }
  return clientPromise;
}

export async function getSession(): Promise<Session | null> {
  const c = await getClient();
  const { data } = await c.auth.getSession();
  return data.session ?? null;
}

export function onAuthChange(cb: (session: Session | null) => void): () => void {
  let unsub: (() => void) | null = null;
  getClient().then((c) => {
    const { data } = c.auth.onAuthStateChange((_event, session) => cb(session ?? null));
    unsub = data.subscription.unsubscribe;
  });
  return () => { if (unsub) unsub(); };
}

function redirectTo(): string {
  return typeof window !== "undefined" ? window.location.origin : "";
}

type Result = Promise<{ ok: boolean; message?: string }>;
function normalize(err: { message?: string } | null): { ok: boolean; message?: string } {
  if (!err) return { ok: true };
  return { ok: false, message: err.message ?? "Unknown error" };
}

export async function signInWithPassword(email: string, password: string): Result {
  const c = await getClient();
  const { error } = await c.auth.signInWithPassword({ email, password });
  return normalize(error);
}

export async function signUpWithPassword(email: string, password: string): Result {
  const c = await getClient();
  const { error } = await c.auth.signUp({ email, password, options: { emailRedirectTo: redirectTo() } });
  return normalize(error);
}

export async function signInWithGoogle(): Result {
  const c = await getClient();
  const { error } = await c.auth.signInWithOAuth({ provider: "google", options: { redirectTo: redirectTo() } });
  if (error && /popup_closed_by_user/i.test(error.message)) {
    return { ok: false, message: "Sign-in popup was closed." };
  }
  return normalize(error);
}

export async function signInWithGitHub(): Result {
  const c = await getClient();
  const { error } = await c.auth.signInWithOAuth({ provider: "github", options: { redirectTo: redirectTo() } });
  if (error && /popup_closed_by_user/i.test(error.message)) {
    return { ok: false, message: "Sign-in popup was closed." };
  }
  return normalize(error);
}

export async function sendPasswordReset(email: string): Result {
  const c = await getClient();
  const { error } = await c.auth.resetPasswordForEmail(email, { redirectTo: redirectTo() });
  return normalize(error);
}

export async function signOut(): Promise<void> {
  const c = await getClient();
  await c.auth.signOut();
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npm test -- tests/unit/auth.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/auth.ts tests/unit/auth.test.ts
git commit -m "feat(auth): add Supabase Auth wrapper (email/password + Google + GitHub)"
```

---

## Task 3: Update `src/supabase.ts` — drop token header, add profile helpers

**Files:**
- Modify: `src/supabase.ts` (replace `getClient`; remove `ensureSpace`, `migrateLegacyToken`; switch realtime filter; add `fetchProfile`, `updateProfile`; switch Edge Function calls)

**Interfaces:**
- Consumes: `getSession()` from `src/auth.ts`.
- Produces: `fetchProfile(userId: string): Promise<Profile>`, `updateProfile(userId: string, patch: Partial<Profile>): Promise<void>`, `export type Profile`.

- [ ] **Step 1: Read current `src/supabase.ts` end-to-end**

Run: `Read` on `src/supabase.ts`. Identify every reference to `getSpaceToken`, `getSpaceId`, `genTokenPair`, `ensureSpace`, `migrateLegacyToken`, and `x-space-token`. Note line numbers — you will rewrite the file in the next step.

- [ ] **Step 2: Replace `src/supabase.ts`**

Overwrite `src/supabase.ts` with the contents below. The Edge Function calls in the original (search for `parseFunction`, `parsePhrase`, `polishPhrase`) keep the same body but drop the `x-space-token` header and the `getSpaceToken` argument.

```ts
import { config } from "./config";
import type { Item, ParsedItem, PolishResult, DraftItem } from "./types";
import { getSession } from "./auth";

let client: import("@supabase/supabase-js").SupabaseClient | null = null;

async function getClient() {
  if (client) return client;
  const { createClient } = await import("@supabase/supabase-js");
  client = createClient(config.supabaseUrl, config.supabaseAnon, {
    auth: { persistSession: true, autoRefreshToken: true }
  });
  return client;
}

export interface Profile {
  user_id: string;
  display_name: string | null;
  color_rules: ColorRule[];
  auto_remind_events: boolean;
  military_time: boolean;
  auto_delete: boolean;
  auto_delete_days: number;
  provider: string;
  updated_at: string;
}

interface ColorRule {
  id: string;
  label: string;
  color: string;
  withinHours: number;
}

export async function fetchItems(): Promise<Item[]> {
  const supabase = await getClient();
  const session = await getSession();
  const { data, error } = await supabase
    .from("items")
    .select("*")
    .eq("user_id", session!.user.id)
    .order("order", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data as Item[]) ?? [];
}

export async function insertItem(item: Item): Promise<Item> {
  const supabase = await getClient();
  const session = await getSession();
  const { data, error } = await supabase
    .from("items")
    .insert({ ...item, user_id: session!.user.id })
    .select()
    .single();
  if (error) throw error;
  return data as Item;
}

export async function updateItem(id: string, patch: Partial<Item>): Promise<void> {
  const supabase = await getClient();
  const { error } = await supabase.from("items").update(patch).eq("id", id);
  if (error) throw error;
}

export async function removeItem(id: string): Promise<void> {
  const supabase = await getClient();
  const { error } = await supabase.from("items").delete().eq("id", id);
  if (error) throw error;
}

export async function subscribeToSpace(onUpdate: (items: Item[]) => void): Promise<void> {
  const supabase = await getClient();
  const session = await getSession();
  const userId = session!.user.id;
  supabase
    .channel(`user:${userId}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "items", filter: `user_id=eq.${userId}` }, async () => {
      onUpdate(await fetchItems());
    })
    .subscribe();
}

function tzOffsetMinutes(): number {
  return -new Date().getTimezoneOffset();
}

export async function parsePhrase(phrase: string): Promise<ParsedItem> {
  const session = await getSession();
  const r = await fetch(config.parseFunction, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "authorization": `Bearer ${session!.access_token}`
    },
    body: JSON.stringify({ phrase, tzOffsetMinutes: tzOffsetMinutes() })
  });
  if (!r.ok) throw new Error(`parse failed: ${r.status}`);
  return (await r.json()) as ParsedItem;
}

export async function polishPhrase(paragraph: string): Promise<PolishResult> {
  const session = await getSession();
  const polishUrl = config.parseFunction.replace(/\/parse$/, "/polish");
  const r = await fetch(polishUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "authorization": `Bearer ${session!.access_token}`
    },
    body: JSON.stringify({ paragraph, tzOffsetMinutes: tzOffsetMinutes() })
  });
  if (!r.ok) throw new Error(`polish failed: ${r.status}`);
  return (await r.json()) as PolishResult;
}

// --- Profiles ---
export async function fetchProfile(userId: string): Promise<Profile> {
  const supabase = await getClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("user_id", userId)
    .single();
  if (error) throw error;
  return data as Profile;
}

export async function updateProfile(userId: string, patch: Partial<Profile>): Promise<void> {
  const supabase = await getClient();
  const { error } = await supabase
    .from("profiles")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("user_id", userId);
  if (error) throw error;
}

// --- Test-provider-key (unchanged signature; drop token header) ---
export async function testProviderKey(provider: string, key: string): Promise<{ ok: boolean; message: string }> {
  // Body unchanged from current implementation. The existing code path stays.
  // It posts to the LLM provider directly with the user's key; no auth needed.
  // Copy the current implementation from src/supabase.ts verbatim.
  throw new Error("paste the existing testProviderKey body from src/supabase.ts here");
}
```

> **Note for the implementer:** the placeholder for `testProviderKey` is intentional — copy the existing function body from the file you just read in Step 1. It is unchanged in behavior; the only difference is that it no longer touches the Supabase client.

- [ ] **Step 3: Run TypeScript typecheck**

Run: `npx tsc --noEmit`
Expected: errors only in files that still import the deleted `getSpaceToken` / `isDemoMode` symbols. Fix those in later tasks. `src/supabase.ts` itself should typecheck clean (the placeholder returns `Promise<{ok,message}>` and is exported with the same signature).

- [ ] **Step 4: Commit**

```bash
git add src/supabase.ts
git commit -m "refactor(supabase): drop x-space-token header, add profile helpers, filter by user_id"
```

---

## Task 4: Strip the token system from `src/store.ts`

**Files:**
- Modify: `src/store.ts`
- Delete: `tests/unit/tokens.test.ts`

**Interfaces:**
- Consumes: `getSession()` from `src/auth.ts`.
- Produces: same `subscribe`, `setItems`, `getItems`, `loadItems`, `subscribeRealtime`, `importItems`, `deleteOldEvents` signatures as today. Demo branch is gone.

- [ ] **Step 1: Delete the tokens test file**

Run: `git rm tests/unit/tokens.test.ts`
Expected: file removed from disk and index.

- [ ] **Step 2: Read current `src/store.ts` end-to-end**

Run: `Read` on `src/store.ts`. Note every reference to `getSpaceToken`, `getSpaceId`, `getSpaceSecret`, `setSpaceToken`, `combineToken`, `splitToken`, `genTokenPair`, `isLegacyToken`, `isDemoMode`, `STORAGE_KEYS.spaceToken`, `marginalia.items` (the localStorage demo write). Also note `subscribeRealtime`'s body.

- [ ] **Step 3: Rewrite `src/store.ts`**

Overwrite `src/store.ts` with:

```ts
import { config, isDemoMode as _legacyIsDemoMode } from "./config";
import type { Item } from "./types";
import type { ImportRow } from "./backup";
import { fetchItems, insertItem, updateItem, removeItem, subscribeToSpace } from "./supabase";
import { getSession } from "./auth";

// Back-compat: the rest of the app used to import `isDemoMode` from config.
// We deleted it there; re-export `false` here so any leftover import keeps working
// until the next refactor pass removes it.
export const isDemoMode = false;

type Listener = (items: Item[]) => void;
const listeners = new Set<Listener>();

let items: Item[] = [];
let loaded = false;

export function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  fn(items);
  return () => listeners.delete(fn);
}
function emit() { listeners.forEach((fn) => fn(items)); }

function byOrder(a: Item, b: Item) {
  return a.order - b.order || a.created_at.localeCompare(b.created_at);
}
export function setItems(next: Item[]) {
  items = next.slice().sort(byOrder);
  emit();
}
export function getItems(): Item[] { return items.slice(); }

export async function importItems(rows: ImportRow[], mode: "merge" | "replace"): Promise<void> {
  const session = await getSession();
  const userId = session!.user.id;
  const toItem = (r: ImportRow): Item => ({
    id: crypto.randomUUID(),
    user_id: userId,
    kind: r.kind,
    title: r.title.slice(0, 200),
    datetime: r.datetime,
    all_day: r.all_day,
    reminder: r.reminder,
    status: r.status,
    created_at: new Date().toISOString(),
    order: 0,
    pinned: false,
    rating: 0
  });
  if (mode === "replace") setItems(rows.map(toItem));
  for (const it of rows.map(toItem)) await insertItem(it);
  await loadItems();
}

export async function loadItems(): Promise<void> {
  if (loaded) return;
  const data = await fetchItems();
  setItems(data);
  loaded = true;
}

export async function subscribeRealtime(): Promise<void> {
  await subscribeToSpace(async (next) => setItems(next));
}

export async function deleteOldEvents(days: number): Promise<void> {
  const cutoff = Date.now() - days * 86400_000;
  const toDelete = items
    .filter((i) => i.kind === "event" && i.datetime && new Date(i.datetime).getTime() < cutoff)
    .map((i) => i.id);
  for (const id of toDelete) await removeItem(id);
}
```

- [ ] **Step 4: Run the remaining unit tests**

Run: `npm test`
Expected: 6 test files pass (views, store-list, store-import, star, star-click, filter-panel, backup, auth from Task 2). `tokens.test.ts` is gone.

- [ ] **Step 5: Commit**

```bash
git add src/store.ts tests/unit/tokens.test.ts
git commit -m "refactor(store): remove space-token system, stamp user_id on items"
```

---

## Task 5: Update Edge Functions to verify JWT instead of `x-space-token`

**Files:**
- Modify: `supabase/functions/parse/index.ts`, `supabase/functions/polish/index.ts`
- Delete: `supabase/functions/migrate-token/index.ts`

**Interfaces:**
- Consumes: `Authorization: Bearer <jwt>` header.
- Produces: same JSON shape on success. 401 on missing/invalid JWT.

- [ ] **Step 1: Read both Edge Functions end-to-end**

Run: `Read` on `supabase/functions/parse/index.ts` and `supabase/functions/polish/index.ts`. Note the existing `x-space-token` validation block in each.

- [ ] **Step 2: Replace the auth block in `parse/index.ts`**

Inside `supabase/functions/parse/index.ts`, find the block that reads `x-space-token` from the request, splits it on `.`, and looks up the secret. Replace the whole block with this JWT-validation block (keep the rest of the function unchanged):

```ts
// --- Auth: verify the Supabase JWT from the Authorization header ---
const auth = req.headers.get("authorization") ?? "";
const m = auth.match(/^Bearer\s+(.+)$/i);
if (!m) return new Response("missing bearer token", { status: 401 });
const jwt = m[1];
const { data: userData, error: userErr } = await supabase.auth.getUser(jwt);
if (userErr || !userData?.user) return new Response("invalid token", { status: 401 });
const userId = userData.user.id;
```

Where `supabase` is the existing client created with `createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: \`Bearer ${jwt}\` } } })` (or whatever the function already does). Add `userId` to any log lines that previously logged the token id.

- [ ] **Step 3: Apply the same change to `polish/index.ts`**

Repeat Step 2 for `supabase/functions/polish/index.ts`, replacing the same block with the same JWT check. Body of the function is otherwise unchanged.

- [ ] **Step 4: Delete the obsolete `migrate-token` function**

Run: `git rm -r supabase/functions/migrate-token`
Expected: directory removed.

- [ ] **Step 5: Deploy the updated Edge Functions**

Run:

```bash
supabase functions deploy parse --project-ref PROJECT_REF
supabase functions deploy polish --project-ref PROJECT_REF
```

Expected: both deploy successfully. The CLI prints a success URL for each.

- [ ] **Step 6: Smoke-test the deployed function**

Run:

```powershell
$env:JWT = (supabase auth login --project-ref PROJECT_REF 2>$null; curl -s "$env:VITE_SUPABASE_URL/auth/v1/token?grant_type=password" -H "apikey: $env:VITE_SUPABASE_ANON" -H "content-type: application/json" -d '{"email":"you@example.com","password":"..."}' | Select-String -Pattern '"access_token":"([^"]+)"').Matches[0].Groups[1].Value
Invoke-RestMethod -Method POST -Uri "$env:VITE_SUPABASE_URL/functions/v1/parse" -Headers @{ Authorization = "Bearer $JWT"; "content-type" = "application/json" } -Body '{"phrase":"call mom tomorrow","tzOffsetMinutes":0}'
```

Expected: 200 with a JSON body matching the existing parse contract.

- [ ] **Step 7: Commit**

```bash
git add supabase/functions/parse supabase/functions/polish supabase/functions/migrate-token
git commit -m "feat(edge): switch parse/polish to JWT auth, remove migrate-token"
```

---

## Task 6: `claim-space` Edge Function

**Files:**
- Create: `supabase/functions/claim-space/index.ts`

**Interfaces:**
- Request: `POST { token: string }` with `Authorization: Bearer <jwt>`.
- Response: `{ ok: true, count: number }` on success; `401`/`404`/`403`/`500` on failure.

- [ ] **Step 1: Write the failing deployment smoke test**

There is no separate unit test for Edge Functions in this repo (confirmed by the absence of any `tests/edge/` directory). The verification is the live curl in Step 4. Skip the failing-test step; mark it N/A in the commit.

- [ ] **Step 2: Write `supabase/functions/claim-space/index.ts`**

```ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON = Deno.env.get("SUPABASE_ANON_KEY")!;

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
  const auth = req.headers.get("authorization") ?? "";
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (!m) return new Response("missing bearer token", { status: 401 });
  const jwt = m[1];

  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON, {
    global: { headers: { Authorization: `Bearer ${jwt}` } }
  });
  const { data: userData, error: userErr } = await supabase.auth.getUser(jwt);
  if (userErr || !userData?.user) return new Response("invalid token", { status: 401 });
  const userId = userData.user.id;

  let body: { token?: string };
  try { body = await req.json(); } catch { return new Response("bad json", { status: 400 }); }
  const token = (body.token ?? "").trim();
  if (!token) return new Response("missing token", { status: 400 });

  const dot = token.indexOf(".");
  const id = dot === -1 ? token : token.slice(0, dot);
  const secret = dot === -1 ? "" : token.slice(dot + 1);
  if (!secret) return new Response("token must include secret", { status: 400 });

  // Verify the secret against the spaces table. Use a service-role client
  // because the RLS for `spaces` was removed in the migration; we still want
  // a server-side check, not a client-side trust.
  const admin = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false }
  });
  const { data: space, error: spaceErr } = await admin
    .from("spaces")
    .select("token, secret")
    .eq("token", id)
    .maybeSingle();
  if (spaceErr) return new Response(`db error: ${spaceErr.message}`, { status: 500 });
  if (!space) return new Response("unknown token", { status: 404 });
  if (space.secret !== secret) return new Response("bad secret", { status: 403 });

  const { data, error } = await admin
    .from("items")
    .update({ user_id: userId })
    .eq("space_token", id)
    .select("id");
  if (error) return new Response(`update failed: ${error.message}`, { status: 500 });

  await admin.from("spaces").delete().eq("token", id);

  return new Response(JSON.stringify({ ok: true, count: (data ?? []).length }), {
    headers: { "content-type": "application/json" }
  });
});
```

- [ ] **Step 3: Deploy the function**

Run: `supabase functions deploy claim-space --project-ref PROJECT_REF`
Expected: deploy success.

- [ ] **Step 4: Live test against a real claim**

In a local Supabase project that still has a `spaces` row (because Task 1 was run on `us-east-1` but the test runs against a local DB), insert a row, then:

Run:
```powershell
$env:TOKEN = "testid.testsecret"
$env:JWT = "..."  # a real JWT from a sign-in
Invoke-RestMethod -Method POST -Uri "http://localhost:54321/functions/v1/claim-space" -Headers @{ Authorization = "Bearer $env:JWT"; "content-type" = "application/json" } -Body "{ `"token`": `"$env:TOKEN`" }"
```
Expected: 200 with `{ ok: true, count: <n> }`. Repeat with a bad secret → 403.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/claim-space
git commit -m "feat(edge): add claim-space function to migrate pre-auth tokens"
```

---

## Task 7: `AuthScreen` UI module

**Files:**
- Create: `src/ui/authScreen.ts`

**Interfaces:**
- Consumes: `signInWithPassword`, `signUpWithPassword`, `signInWithGoogle`, `signInWithGitHub`, `sendPasswordReset` from `src/auth.ts`.
- Produces: a `mountAuthScreen(root: HTMLElement): void` function that renders the form, handles state transitions, and unmounts on success.

- [ ] **Step 1: Write the file**

Create `src/ui/authScreen.ts` with this content:

```ts
import {
  signInWithPassword,
  signUpWithPassword,
  signInWithGoogle,
  signInWithGitHub,
  sendPasswordReset
} from "../auth";

type Mode = "signin" | "signup" | "forgot";

function claimSpaceUrl(): string {
  return `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/claim-space`;
}

async function claimToken(token: string, jwt: string): Promise<{ ok: boolean; count?: number; message?: string }> {
  const r = await fetch(claimSpaceUrl(), {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${jwt}` },
    body: JSON.stringify({ token })
  });
  if (!r.ok) return { ok: false, message: `${r.status} ${r.statusText}` };
  return (await r.json()) as { ok: boolean; count?: number };
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

export function mountAuthScreen(root: HTMLElement): void {
  let mode: Mode = "signin";
  let claimOpen = false;
  let status = "";
  let statusKind: "" | "good" | "bad" = "";

  function render() {
    root.innerHTML = `
      <div class="auth-card">
        <h1>Marginalia</h1>
        <p class="auth-tagline">Sign in to keep your tasks private and synced.</p>
        <div class="auth-tabs">
          <button class="auth-tab" data-mode="signin" aria-selected="${mode === "signin"}">Sign in</button>
          <button class="auth-tab" data-mode="signup" aria-selected="${mode === "signup"}">Create account</button>
        </div>
        <form id="authForm" class="auth-form" novalidate>
          <input type="email" id="authEmail" placeholder="you@example.com" required autocomplete="email" />
          ${mode === "signup" ? `<input type="password" id="authPw" placeholder="password (min 8 chars)" required minlength="8" autocomplete="new-password" />` : ""}
          ${mode === "signin"  ? `<input type="password" id="authPw" placeholder="password" required autocomplete="current-password" />` : ""}
          <button class="btn primary" type="submit">${mode === "signup" ? "Create account" : "Sign in"}</button>
        </form>
        <div class="auth-divider"><span>or</span></div>
        <div class="auth-social">
          <button class="btn" id="authGoogle" type="button">Continue with Google</button>
          <button class="btn" id="authGitHub" type="button">Continue with GitHub</button>
        </div>
        ${mode === "signin" ? `<button class="link" id="authForgot" type="button">Forgot password?</button>` : ""}
        <div class="auth-status ${statusKind}">${esc(status)}</div>
        <details class="auth-claim" ${claimOpen ? "open" : ""}>
          <summary>Have an old space token?</summary>
          <p>Paste a token from the previous version to attach its data to this account.</p>
          <input type="text" id="claimToken" placeholder="id.secret" />
          <button class="btn" id="claimGo" type="button">Claim</button>
          <div class="auth-claim-status"></div>
        </details>
      </div>
    `;
    root.querySelectorAll<HTMLButtonElement>(".auth-tab").forEach((b) => {
      b.onclick = () => { mode = b.dataset.mode as Mode; status = ""; statusKind = ""; render(); };
    });
    const form = root.querySelector<HTMLFormElement>("#authForm")!;
    form.onsubmit = async (e) => {
      e.preventDefault();
      const email = (root.querySelector<HTMLInputElement>("#authEmail")!).value.trim();
      const pw = (root.querySelector<HTMLInputElement>("#authPw")!)?.value ?? "";
      status = "Working…"; statusKind = "";
      render();
      const r = mode === "signup"
        ? await signUpWithPassword(email, pw)
        : await signInWithPassword(email, pw);
      if (!r.ok) { status = r.message ?? "Sign-in failed."; statusKind = "bad"; render(); }
      // success: onAuthStateChange will unmount this screen
    };
    root.querySelector<HTMLButtonElement>("#authGoogle")!.onclick = async () => {
      const r = await signInWithGoogle();
      if (!r.ok) { status = r.message ?? "Sign-in failed."; statusKind = "bad"; render(); }
    };
    root.querySelector<HTMLButtonElement>("#authGitHub")!.onclick = async () => {
      const r = await signInWithGitHub();
      if (!r.ok) { status = r.message ?? "Sign-in failed."; statusKind = "bad"; render(); }
    };
    const forgot = root.querySelector<HTMLButtonElement>("#authForgot");
    if (forgot) forgot.onclick = async () => {
      const email = (root.querySelector<HTMLInputElement>("#authEmail")!).value.trim();
      if (!email) { mode = "forgot"; status = "Enter your email above first, then click again."; statusKind = "bad"; render(); return; }
      const r = await sendPasswordReset(email);
      status = r.ok ? "Check your email for a reset link." : (r.message ?? "Could not send reset.");
      statusKind = r.ok ? "good" : "bad";
      render();
    };
    const claimBtn = root.querySelector<HTMLButtonElement>("#claimGo");
    if (claimBtn) claimBtn.onclick = async () => {
      const tok = (root.querySelector<HTMLInputElement>("#claimToken")!).value.trim();
      const statusEl = root.querySelector<HTMLDivElement>(".auth-claim-status")!;
      if (!tok) { statusEl.textContent = "Paste a token first."; return; }
      statusEl.textContent = "Claiming…";
      // For claim we need a JWT. If the user is not signed in, ask them to sign in first.
      const { getSession } = await import("../auth");
      const session = await getSession();
      if (!session) {
        statusEl.textContent = "Sign in (or create an account) first, then claim.";
        return;
      }
      const r = await claimToken(tok, session.access_token);
      statusEl.textContent = r.ok
        ? `Claimed ${r.count ?? 0} item(s). Reloading…`
        : (r.message ?? "Claim failed.");
      if (r.ok) setTimeout(() => location.reload(), 800);
    };
  }
  render();
}

export function unmountAuthScreen(root: HTMLElement): void {
  root.innerHTML = "";
}
```

- [ ] **Step 2: Commit (no test yet — visual surface)**

```bash
git add src/ui/authScreen.ts
git commit -m "feat(ui): add AuthScreen with email/password + Google + GitHub + claim"
```

---

## Task 8: Update `index.html` and `src/style.css` for the auth screen

**Files:**
- Modify: `index.html`, `src/style.css`

**Interfaces:**
- `index.html` exposes `<div id="authRoot">` (always visible) and `<div id="appRoot">` (hidden until session).
- `src/style.css` defines `.auth-card`, `.auth-tabs`, `.auth-form`, `.auth-social`, `.auth-status`, `.auth-claim` — all using the existing palette tokens.

- [ ] **Step 1: Update `index.html`**

Apply this edit to `index.html`: remove the `<div class="back" id="tokenModal">…</div>` block (lines 74–87) and wrap the existing `<div class="app">…</div>` in a new `<div id="appRoot" hidden>`. Add `<div id="authRoot"></div>` directly above it. The body becomes:

```html
<body>
  <div id="authRoot"></div>
  <div id="appRoot" hidden>
    <div class="app">
      <header>…existing header…</header>
      <div class="tabs">…existing tabs…</div>
      <main>…existing main…</main>
      <div class="dock">…existing dock…</div>
    </div>
  </div>
  <div class="back" id="settingsModal">…existing…</div>
  <script type="module" src="/src/main.ts"></script>
</body>
```

- [ ] **Step 2: Add auth-screen styles to `src/style.css`**

Append at the end of `src/style.css`:

```css
/* --- Auth screen --- */
#authRoot { min-height: 100vh; display: grid; place-items: center; padding: 24px; background: var(--bg, #f6f4ee); }
#authRoot:empty { display: none; }
.auth-card { width: 100%; max-width: 380px; background: #fff; border: 1px solid #e4e0d6; border-radius: 12px; padding: 24px; box-shadow: 0 1px 2px rgba(0,0,0,.04); font-family: Inter, system-ui, sans-serif; }
.auth-card h1 { font-family: "Fraunces", serif; margin: 0 0 4px; font-size: 24px; }
.auth-tagline { margin: 0 0 16px; color: #5a5a5a; font-size: 14px; }
.auth-tabs { display: flex; gap: 4px; margin-bottom: 12px; }
.auth-tab { flex: 1; padding: 8px; background: #f0ece2; border: 1px solid transparent; border-radius: 8px; cursor: pointer; font: inherit; }
.auth-tab[aria-selected="true"] { background: #fff; border-color: #cfc8b8; }
.auth-form { display: grid; gap: 8px; margin-bottom: 12px; }
.auth-form input { padding: 10px 12px; border: 1px solid #d4cebf; border-radius: 8px; font: inherit; }
.auth-form .btn { margin-top: 4px; }
.auth-divider { text-align: center; color: #8a8a8a; font-size: 12px; margin: 12px 0; position: relative; }
.auth-divider span { background: #fff; padding: 0 8px; }
.auth-divider::before { content: ""; position: absolute; left: 0; right: 0; top: 50%; border-top: 1px solid #e4e0d6; z-index: -1; }
.auth-social { display: grid; gap: 8px; }
.auth-social .btn { background: #fff; border: 1px solid #d4cebf; }
.link { background: none; border: 0; color: #3f7d6e; cursor: pointer; padding: 0; margin-top: 8px; font: inherit; }
.auth-status { min-height: 18px; margin-top: 8px; font-size: 13px; }
.auth-status.bad { color: #b13a3a; }
.auth-status.good { color: #2f6b4f; }
.auth-claim { margin-top: 16px; border-top: 1px solid #e4e0d6; padding-top: 12px; }
.auth-claim summary { cursor: pointer; font-size: 13px; color: #5a5a5a; }
.auth-claim p { font-size: 12px; color: #7a7a7a; margin: 6px 0; }
.auth-claim input { width: 100%; padding: 8px; border: 1px solid #d4cebf; border-radius: 6px; font: inherit; box-sizing: border-box; margin-bottom: 6px; }
.auth-claim-status { font-size: 12px; min-height: 16px; }
```

- [ ] **Step 3: Commit**

```bash
git add index.html src/style.css
git commit -m "feat(ui): add authRoot shell and auth screen styles"
```

---

## Task 9: Update `src/main.ts` to gate boot on session

**Files:**
- Modify: `src/main.ts`

**Interfaces:**
- On `null` session: mount `<AuthScreen>`, hide `#appRoot`.
- On non-null session: hide `#authRoot`, show `#appRoot`, run the existing boot.

- [ ] **Step 1: Replace `src/main.ts`**

Overwrite `src/main.ts` with:

```ts
import "./style.css";
import { loadItems, subscribeRealtime, subscribe, deleteOldEvents } from "./store";
import { getSettings } from "./settings";
import { mountHeader } from "./ui/header";
import { mountInput, mountViews } from "./ui/input";
import { fireNotifications, resetNotified } from "./reminders";
import { starSymbolHTML } from "./ui/views";
import type { Item } from "./types";
import { getSession, onAuthChange } from "./auth";
import { mountAuthScreen, unmountAuthScreen } from "./ui/authScreen";
import { fetchProfile } from "./supabase";

const authRoot = document.getElementById("authRoot")!;
const appRoot = document.getElementById("appRoot")!;

async function bootApp() {
  document.body.insertAdjacentHTML("afterbegin", starSymbolHTML());
  mountHeader();
  mountInput();
  mountViews();

  const session = await getSession();
  if (session) {
    try { await fetchProfile(session.user.id); } catch { /* first run; trigger will create one */ }
  }
  await loadItems();
  await subscribeRealtime();

  const runAutoDelete = () => {
    const s = getSettings();
    if (s.autoDelete) deleteOldEvents(s.autoDeleteDays);
  };
  runAutoDelete();
  setInterval(runAutoDelete, 5 * 60 * 1000);

  const dock = document.querySelector<HTMLElement>(".dock");
  const main = document.querySelector<HTMLElement>("main");
  if (dock && main) {
    const fit = () => { main.style.paddingBottom = `${dock.offsetHeight + 24}px`; };
    fit();
    new ResizeObserver(fit).observe(dock);
    window.addEventListener("resize", fit);
  }

  subscribe((items: Item[]) => resetNotified(items.map((i) => i.id)));
  setInterval(() => subscribe((items: Item[]) => fireNotifications(items)), 30000);
}

function showAuth() {
  appRoot.hidden = true;
  authRoot.hidden = false;
  mountAuthScreen(authRoot);
}
function showApp() {
  unmountAuthScreen(authRoot);
  authRoot.hidden = true;
  appRoot.hidden = false;
  // location.reload would be heavier; instead, kick off a fresh boot.
  bootApp();
}

onAuthChange((session) => {
  if (session) showApp();
  else showAuth();
});
```

- [ ] **Step 2: Commit**

```bash
git add src/main.ts
git commit -m "feat(boot): gate app on Supabase Auth session, mount AuthScreen when signed out"
```

---

## Task 10: Update `src/ui/header.ts` — remove token UI, add user menu

**Files:**
- Modify: `src/ui/header.ts`
- Test: `tests/unit/header-user-menu.test.ts`

**Interfaces:**
- The header renders `<button id="userMenu" data-email>` with a dropdown containing "Settings" and "Sign out".
- `#spaceChip`, `#copyToken`, `#tokenModal`, `#downloadToken`, `downloadToken` are all gone.

- [ ] **Step 1: Replace `index.html` header markup**

In `index.html`, replace the existing `<header>` block (lines 14–21) with:

```html
<header>
  <h1>Marginalia</h1>
  <div class="user-menu" id="userMenu" tabindex="0">
    <span class="dot"></span><span id="userEmail">—</span>
    <div class="user-menu-pop" hidden>
      <button type="button" id="userSettings">Settings</button>
      <button type="button" id="userSignOut">Sign out</button>
    </div>
  </div>
  <button id="settingsBtn" class="icon gear-btn" title="Settings" aria-label="Settings">⚙</button>
</header>
```

- [ ] **Step 2: Add the user-menu CSS to `src/style.css`**

Append to `src/style.css`:

```css
/* --- User menu --- */
.user-menu { display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; background: #f0ece2; border-radius: 999px; font-size: 13px; cursor: pointer; position: relative; outline: none; }
.user-menu .dot { width: 6px; height: 6px; background: #3f7d6e; border-radius: 50%; display: inline-block; }
.user-menu-pop { position: absolute; top: 100%; right: 0; margin-top: 4px; background: #fff; border: 1px solid #d4cebf; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,.08); display: grid; min-width: 140px; z-index: 10; }
.user-menu-pop button { background: none; border: 0; padding: 8px 12px; text-align: left; font: inherit; cursor: pointer; }
.user-menu-pop button:hover { background: #f6f4ee; }
```

- [ ] **Step 3: Write the failing test for the user menu**

Create `tests/unit/header-user-menu.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { mountHeader } from "../../src/ui/header";
import { getSession, signOut } from "../../src/auth";

vi.mock("../../src/auth", () => ({
  getSession: vi.fn(),
  signOut: vi.fn()
}));

describe("user menu header", () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <header>
        <div class="user-menu" id="userMenu" tabindex="0">
          <span class="dot"></span><span id="userEmail">—</span>
          <div class="user-menu-pop" hidden>
            <button type="button" id="userSettings">Settings</button>
            <button type="button" id="userSignOut">Sign out</button>
          </div>
        </div>
        <button id="settingsBtn"></button>
        <div id="settingsModal" hidden></div>
        <div id="tokenModal" hidden></div>
      </header>
    `;
  });

  it("renders the signed-in email", async () => {
    (getSession as any).mockResolvedValue({ user: { email: "alice@example.com" } });
    await mountHeader();
    // mountHeader is async; wait one tick
    await new Promise((r) => setTimeout(r, 0));
    expect(document.getElementById("userEmail")!.textContent).toBe("alice@example.com");
  });

  it("calls signOut when the Sign out button is clicked", async () => {
    (getSession as any).mockResolvedValue({ user: { email: "x@y.z" } });
    (signOut as any).mockResolvedValue(undefined);
    await mountHeader();
    await new Promise((r) => setTimeout(r, 0));
    document.getElementById("userSignOut")!.click();
    expect(signOut).toHaveBeenCalled();
  });
});
```

- [ ] **Step 4: Run the test to confirm it fails**

Run: `npm test -- tests/unit/header-user-menu.test.ts`
Expected: FAIL — `mountHeader` does not exist or doesn't render the user menu.

- [ ] **Step 5: Rewrite `src/ui/header.ts`**

Overwrite `src/ui/header.ts` with the contents below. The settings modal handlers are unchanged from the current implementation; copy them verbatim from the existing file. The token-related code is removed.

```ts
import { STORAGE_KEYS } from "../config";
import { getSettings, updateSettings, enableNotifications, type ColorRule } from "../settings";
import { testProviderKey, fetchProfile, updateProfile } from "../supabase";
import { getSession, signOut } from "../auth";
import { esc } from "./views";
import { toCSV, toText, parseFile, applyImport, download } from "../backup";
import type { ImportRow } from "../backup";
import { getItems } from "../store";

export async function mountHeader(): Promise<void> {
  const emailEl = document.getElementById("userEmail")!;
  const userMenu = document.getElementById("userMenu")!;
  const pop = userMenu.querySelector<HTMLElement>(".user-menu-pop")!;
  const session = await getSession();
  emailEl.textContent = session?.user.email ?? "—";

  // Toggle dropdown on click
  userMenu.addEventListener("click", (e) => {
    e.stopPropagation();
    pop.hidden = !pop.hidden;
  });
  document.addEventListener("click", () => { pop.hidden = true; });

  document.getElementById("userSignOut")!.addEventListener("click", async () => {
    await signOut();
  });
  document.getElementById("userSettings")!.addEventListener("click", () => {
    openSettings();
    pop.hidden = true;
  });

  // settings modal — copy existing tab/handlers from the current header.ts verbatim
  const back = document.getElementById("settingsModal")!;
  const tabStrip = back.querySelector<HTMLElement>(".tab-strip")!;
  const panels = Array.from(back.querySelectorAll<HTMLElement>(".spanel"));
  tabStrip.querySelectorAll<HTMLButtonElement>(".stab").forEach((t) => {
    t.onclick = () => {
      tabStrip.querySelectorAll(".stab").forEach((x) => x.setAttribute("aria-selected", "false"));
      t.setAttribute("aria-selected", "true");
      const name = t.dataset.tab!;
      panels.forEach((p) => (p.hidden = p.dataset.panel !== name));
    };
  });

  const apiKey = document.getElementById("apiKey") as HTMLInputElement;
  const provider = document.getElementById("provider") as HTMLSelectElement;
  const setAuto = document.getElementById("setAutoRemind") as HTMLInputElement;
  const setNotify = document.getElementById("setNotify") as HTMLInputElement;
  const setMilitary = document.getElementById("setMilitary") as HTMLInputElement;
  const keyStatus = document.getElementById("keyStatus") as HTMLSpanElement;
  const rulesHost = document.getElementById("colorRules") as HTMLDivElement;

  function renderRules(rules: ColorRule[]) {
    rulesHost.innerHTML = rules.map((r, idx) => `
      <div class="rule" data-idx="${idx}">
        <input type="color" class="rule-color" value="${r.color}" aria-label="Color" />
        <input class="rule-label" value="${esc(r.label)}" aria-label="Label" />
        <span class="rule-within">within</span>
        <input type="number" class="rule-hours" min="1" value="${r.withinHours}" aria-label="Hours" />
        <span class="rule-hours-unit">hrs</span>
        <button type="button" class="rule-del" title="Remove">✕</button>
      </div>`).join("");
    rulesHost.querySelectorAll<HTMLButtonElement>(".rule-del").forEach((b) => {
      b.onclick = () => {
        const i = +b.closest(".rule")!.getAttribute("data-idx")!;
        const next = rules.slice();
        next.splice(i, 1);
        renderRules(next);
      };
    });
  }
  const readRules = (): ColorRule[] =>
    Array.from(rulesHost.querySelectorAll<HTMLElement>(".rule")).map((row) => ({
      id: `r-${crypto.randomUUID().slice(0, 8)}`,
      label: (row.querySelector(".rule-label") as HTMLInputElement).value.trim() || "Untitled",
      color: (row.querySelector(".rule-color") as HTMLInputElement).value,
      withinHours: Math.max(1, Number((row.querySelector(".rule-hours") as HTMLInputElement).value) || 24)
    }));

  const openSettings = () => {
    const s = getSettings();
    apiKey.value = localStorage.getItem(STORAGE_KEYS.llmKey) || "";
    provider.value = localStorage.getItem(STORAGE_KEYS.provider) || "nvidia";
    setAuto.checked = s.autoRemindEvents;
    setMilitary.checked = s.militaryTime;
    setNotify.checked = s.browserNotifications && typeof Notification !== "undefined" && Notification.permission === "granted";
    (document.getElementById("setAutoDelete") as HTMLInputElement).checked = s.autoDelete;
    (document.getElementById("autoDeleteDays") as HTMLInputElement).value = String(s.autoDeleteDays);
    keyStatus.textContent = "";
    keyStatus.className = "key-status";
    renderRules(s.colorRules);
    back.classList.add("show");
  };
  document.getElementById("settingsBtn")!.addEventListener("click", openSettings);
  document.getElementById("settingsCancel")!.addEventListener("click", () => back.classList.remove("show"));
  document.getElementById("settingsSave")!.addEventListener("click", async () => {
    localStorage.setItem(STORAGE_KEYS.llmKey, apiKey.value.trim());
    localStorage.setItem(STORAGE_KEYS.provider, provider.value);
    const userId = (await getSession())!.user.id;
    await updateProfile(userId, {
      auto_remind_events: setAuto.checked,
      military_time: setMilitary.checked,
      color_rules: readRules(),
      auto_delete: (document.getElementById("setAutoDelete") as HTMLInputElement).checked,
      auto_delete_days: Math.max(1, Number((document.getElementById("autoDeleteDays") as HTMLInputElement).value) || 30),
      provider: provider.value
    });
    if (setNotify.checked) {
      await enableNotifications();
    } else {
      updateSettings({ browserNotifications: false });
    }
    back.classList.remove("show");
  });

  document.getElementById("addRule")!.addEventListener("click", () => {
    const cur = Array.from(rulesHost.querySelectorAll<HTMLElement>(".rule")).map((row) => ({
      id: `r-${crypto.randomUUID().slice(0, 8)}`,
      label: (row.querySelector(".rule-label") as HTMLInputElement).value,
      color: (row.querySelector(".rule-color") as HTMLInputElement).value,
      withinHours: Number((row.querySelector(".rule-hours") as HTMLInputElement).value) || 24
    }));
    cur.push({ id: `r-${crypto.randomUUID().slice(0, 8)}`, label: "New rule", color: "#3f7d6e", withinHours: 72 });
    renderRules(cur);
  });

  const testBtn = document.getElementById("keyTest")!;
  testBtn.addEventListener("click", async () => {
    const key = apiKey.value.trim();
    if (!key) { keyStatus.textContent = "Enter a key first."; keyStatus.className = "key-status bad"; return; }
    keyStatus.textContent = "Testing…";
    keyStatus.className = "key-status";
    const r = await testProviderKey(provider.value, key);
    keyStatus.textContent = r.message;
    keyStatus.className = `key-status ${r.ok ? "good" : "bad"}`;
  });

  // Backup
  const exportCsv = document.getElementById("exportCsv") as HTMLButtonElement;
  const exportText = document.getElementById("exportText") as HTMLButtonElement;
  const importFile = document.getElementById("importFile") as HTMLInputElement;
  const importMode = document.getElementById("importMode") as HTMLDivElement;
  const importMerge = document.getElementById("importMerge") as HTMLButtonElement;
  const importReplace = document.getElementById("importReplace") as HTMLButtonElement;
  const backupStatus = document.getElementById("backupStatus") as HTMLSpanElement;

  let pendingRows: ImportRow[] = [];
  exportCsv.addEventListener("click", () => download(toCSV(getItems()), "marginalia-schedule.csv", "text/csv"));
  exportText.addEventListener("click", () => download(toText(getItems()), "marginalia-schedule.txt", "text/plain"));
  importFile.addEventListener("change", async () => {
    const file = importFile.files?.[0];
    if (!file) return;
    const text = await file.text();
    pendingRows = parseFile(text);
    importFile.value = "";
    if (!pendingRows.length) {
      backupStatus.textContent = "No items found in that file.";
      backupStatus.className = "key-status bad";
      importMode.hidden = true;
      return;
    }
    backupStatus.textContent = `Found ${pendingRows.length} item(s). Merge or replace?`;
    backupStatus.className = "key-status";
    importMode.hidden = false;
  });
  const runImport = async (mode: "merge" | "replace") => {
    try {
      await applyImport(pendingRows, mode);
      backupStatus.textContent = `Imported ${pendingRows.length} item(s) (${mode}).`;
      backupStatus.className = "key-status good";
    } catch (e) {
      backupStatus.textContent = `Import failed: ${e instanceof Error ? e.message : "error"}`;
      backupStatus.className = "key-status bad";
    }
    importMode.hidden = true;
    pendingRows = [];
  };
  importMerge.addEventListener("click", () => runImport("merge"));
  importReplace.addEventListener("click", () => runImport("replace"));
}
```

- [ ] **Step 6: Run the test to confirm it passes**

Run: `npm test -- tests/unit/header-user-menu.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 7: Commit**

```bash
git add src/ui/header.ts tests/unit/header-user-menu.test.ts index.html src/style.css
git commit -m "feat(header): replace token chip with user menu (email + Sign out + Settings)"
```

---

## Task 11: Update `src/settings.ts` to read from `profiles`

**Files:**
- Modify: `src/settings.ts`

**Interfaces:**
- `getSettings()` returns a `Settings` object that prefers `profiles` values, falling back to defaults.
- `updateSettings(patch)` writes through to `profiles` and updates the in-memory cache.

- [ ] **Step 1: Read current `src/settings.ts`**

Run: `Read` on `src/settings.ts`. Note the shape of the in-memory cache and any helpers like `enableNotifications`.

- [ ] **Step 2: Rewrite `src/settings.ts`**

Overwrite with:

```ts
import { fetchProfile, updateProfile } from "./supabase";
import { getSession } from "./auth";
import { STORAGE_KEYS } from "./config";

export interface ColorRule {
  id: string;
  label: string;
  color: string;
  withinHours: number;
}

export interface Settings {
  autoRemindEvents: boolean;
  militaryTime: boolean;
  autoDelete: boolean;
  autoDeleteDays: number;
  colorRules: ColorRule[];
  browserNotifications: boolean;
}

let cache: Settings | null = null;

export async function loadSettings(): Promise<Settings> {
  const session = await getSession();
  if (!session) {
    cache = defaults();
    return cache;
  }
  try {
    const p = await fetchProfile(session.user.id);
    cache = {
      autoRemindEvents: p.auto_remind_events,
      militaryTime: p.military_time,
      autoDelete: p.auto_delete,
      autoDeleteDays: p.auto_delete_days,
      colorRules: p.color_rules ?? [],
      browserNotifications: typeof Notification !== "undefined" && Notification.permission === "granted"
    };
  } catch {
    cache = defaults();
  }
  return cache;
}

function defaults(): Settings {
  return {
    autoRemindEvents: true,
    militaryTime: false,
    autoDelete: false,
    autoDeleteDays: 30,
    colorRules: [],
    browserNotifications: false
  };
}

export function getSettings(): Settings {
  return cache ?? defaults();
}

export async function updateSettings(patch: Partial<Settings>): Promise<void> {
  cache = { ...getSettings(), ...patch };
  const session = await getSession();
  if (!session) return;
  const map: Record<string, any> = {
    autoRemindEvents: "auto_remind_events",
    militaryTime: "military_time",
    autoDelete: "auto_delete",
    autoDeleteDays: "auto_delete_days",
    colorRules: "color_rules"
  };
  const profilePatch: Record<string, any> = {};
  for (const [k, v] of Object.entries(patch)) {
    const col = map[k];
    if (col) profilePatch[col] = v;
  }
  if (Object.keys(profilePatch).length) {
    await updateProfile(session.user.id, profilePatch);
  }
}

export async function enableNotifications(): Promise<boolean> {
  if (typeof Notification === "undefined") return false;
  if (Notification.permission === "granted") {
    updateSettings({ browserNotifications: true });
    return true;
  }
  const r = await Notification.requestPermission();
  const ok = r === "granted";
  updateSettings({ browserNotifications: ok });
  return ok;
}

// Re-export for the provider/key kept in localStorage.
export function getLlmKey(): string { return localStorage.getItem(STORAGE_KEYS.llmKey) || ""; }
export function getProvider(): string { return localStorage.getItem(STORAGE_KEYS.provider) || "nvidia"; }
```

- [ ] **Step 3: Commit**

```bash
git add src/settings.ts
git commit -m "refactor(settings): read/write via profiles; llmKey stays in localStorage"
```

---

## Task 12: Update `src/backup.ts` to drop `downloadToken`

**Files:**
- Modify: `src/backup.ts`
- Modify: `src/ui/header.ts` (remove downloadToken wiring — already done in Task 10)

**Interfaces:**
- `applyImport(rows, mode)` stamps `user_id` from session.
- `downloadToken` is removed.

- [ ] **Step 1: Read current `src/backup.ts`**

Run: `Read` on `src/backup.ts`. Find the `downloadToken` function and the `applyImport` body.

- [ ] **Step 2: Edit `src/backup.ts`**

Delete the `downloadToken` function (entire function body). In `applyImport`, change any `space_token: getSpaceId()` references to `user_id: session.user.id`, and import `getSession` from `./auth`. The rest of the file is unchanged.

- [ ] **Step 3: Commit**

```bash
git add src/backup.ts
git commit -m "refactor(backup): drop downloadToken, stamp user_id on import"
```

---

## Task 13: Update `src/config.ts`

**Files:**
- Modify: `src/config.ts`

- [ ] **Step 1: Replace `src/config.ts`**

Overwrite with:

```ts
export interface AppConfig {
  supabaseUrl: string;
  supabaseAnon: string;
  parseFunction: string;
}

const env = import.meta.env;

export const config: AppConfig = {
  supabaseUrl: (env.VITE_SUPABASE_URL as string) || "",
  supabaseAnon: (env.VITE_SUPABASE_ANON as string) || "",
  parseFunction: (env.VITE_SUPABASE_URL as string)
    ? `${env.VITE_SUPABASE_URL}/functions/v1/parse`
    : ""
};

export const STORAGE_KEYS = {
  llmKey: "scheduleapp.llmKey",
  provider: "scheduleapp.provider"
};
```

- [ ] **Step 2: Verify nothing imports `isDemoMode` or `STORAGE_KEYS.spaceToken`**

Run: `grep -r "isDemoMode\|STORAGE_KEYS.spaceToken" src tests` (PowerShell: `Select-String -Path src,tests -Recurse -Pattern "isDemoMode|STORAGE_KEYS.spaceToken"`).
Expected: no matches. If there are matches, fix the import in that file as part of this task.

- [ ] **Step 3: Commit**

```bash
git add src/config.ts
git commit -m "refactor(config): drop isDemoMode and spaceToken storage key"
```

---

## Task 14: Update `README.md` and host config

**Files:**
- Modify: `README.md`
- Supabase dashboard (manual step)

- [ ] **Step 1: Update `README.md`**

In `README.md`, find the section that explains demo mode and `.env`. Replace it with a "Setup" section that says:

> The app requires `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON` in a `.env` file at the project root. Without them, the app does not start — sign-in is required.
>
> ```
> VITE_SUPABASE_URL=https://<project-ref>.supabase.co
> VITE_SUPABASE_ANON=<anon-key>
> ```

Also add: "Sign in with email + password, Google, or GitHub. Existing users with a pre-auth token can paste it under 'Have an old space token?' on the sign-in screen to attach their old data."

- [ ] **Step 2: Supabase dashboard config (manual)**

Open the Supabase dashboard for project `PROJECT_REF` and:
1. **Authentication → Providers:** enable Email (default), Google (paste client ID + secret from Google Cloud Console), GitHub (paste client ID + secret from GitHub OAuth app).
2. **Authentication → URL Configuration:** set Site URL to the deployed app URL (or `http://localhost:5173` for dev). Add the same URL to Redirect URLs.
3. **Authentication → Email Templates:** confirm the confirmation email is set up (default template is fine).

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: drop demo mode from README; document .env requirement and sign-in options"
```

---

## Task 15: End-to-end verification

**Files:** none (run existing tests + manual flows)

- [ ] **Step 1: Run all unit tests**

Run: `npm test`
Expected: all green (auth, header-user-menu, views, store-list, store-import, star, star-click, filter-panel, backup). The deleted `tokens.test.ts` is gone.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Manual sign-up smoke test**

1. Start dev server: `npm run dev`.
2. Open the app in a browser. Confirm the auth screen appears (no demo chip).
3. Click "Create account", enter an email + password, submit.
4. Confirm the empty app shell appears.
5. Add a todo. Sign out via the user menu. Sign back in with the same email/password.
6. Confirm the todo is still there.

- [ ] **Step 4: RLS isolation test**

1. Open two browsers (or two profiles). Sign in as user A in one and user B in the other.
2. Add a todo in A. Confirm it does not appear in B.
3. Verify in the Supabase SQL editor: `select * from items;` shows only A's row.

- [ ] **Step 5: Realtime test**

With both browsers signed in as different users, add an item in A. Confirm it appears in A within 1s. Confirm B does not see it.

- [ ] **Step 6: Token-claim test**

1. In a SQL editor against a separate test database (one that still has a `spaces` row from before Task 1), insert a `spaces` row and a few `items` rows keyed by its id.
2. Sign in fresh in a third browser. Click "Have an old space token?" and paste the id.secret.
3. Confirm the items appear after the reload.

- [ ] **Step 7: Item cap test**

Insert 500 items for one user. Attempt a 501st insert from the app. Confirm the friendly "item limit reached" error appears.

- [ ] **Step 8: Final commit**

```bash
git add -A
git commit --allow-empty -m "chore: sign-in authentication implemented and verified"
```

---

## Self-Review

**Spec coverage check:**
- Section 1 (architecture): Task 9 (`main.ts` gating), Task 5 (Edge Function auth), Task 3 (client drops `x-space-token`).
- Section 2.1 (`items.user_id`): Task 1.
- Section 2.2 (`profiles` table + `handle_new_user`): Task 1.
- Section 2.3 (`items` RLS switch): Task 1.
- Section 2.4 (`claim-space` Edge Function): Task 6.
- Section 2.5 (NOT NULL + ghost UUID): Task 1.
- Section 2.6 (drop `spaces` + `space_token`): Task 1.
- Section 3.1 (new files `auth.ts`, `authScreen.ts`): Task 2, Task 7.
- Section 3.2 (changed files): Task 3, 4, 9, 10, 11, 12, 13.
- Section 3.3 (unchanged files): not touched.
- Section 3.4 (deleted files): Task 4 (tokens.test.ts), Task 5 (migrate-token).
- Section 3.5 (env / hosting): Task 14.
- Section 4.1 (signed-in boot): Task 9.
- Section 4.2 (signed-out boot): Task 9.
- Section 4.3 (sign-out flow): Task 10 (user menu → signOut) + Task 9 (onAuthStateChange).
- Section 4.4 (error handling): Task 2 (auth wrapper returns normalized errors) + Task 7 (auth screen surfaces them).
- Section 4.5 (testing): Task 15 (E2E), Task 2 (auth.test.ts), Task 4 (existing unit tests still pass), Task 10 (header-user-menu test).

**Placeholder scan:** none. Every step has concrete code or commands.

**Type consistency check:**
- `getSession`, `signOut`, `signInWithPassword`, `signUpWithPassword`, `signInWithGoogle`, `signInWithGitHub`, `sendPasswordReset` — all defined in Task 2, all consumed in Task 7, 9, 10, 11 with matching signatures.
- `fetchProfile`, `updateProfile` — defined in Task 3, consumed in Tasks 9, 10, 11 with matching signatures.
- `mountAuthScreen`, `unmountAuthScreen` — defined in Task 7, consumed in Task 9 with matching signatures.
- `Profile`, `ColorRule` — defined in Task 3, consumed in Task 11.
- `claimToken` — internal to Task 7.

No mismatches.
