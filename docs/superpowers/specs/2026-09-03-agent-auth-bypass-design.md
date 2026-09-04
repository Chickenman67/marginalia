# Agent Auth Bypass via Playwright Storage State — Design

**Date:** 2026-09-03
**Status:** Approved (pending user review of written spec)

## Problem

The app now boots behind a Supabase Auth sign-in screen
(`src/ui/authScreen.ts:29`). When the agent drives the browser through
Playwright it gets stuck on `#authRoot` and can't reach the app shell,
because:

- Email/password signup requires either a confirmation email loop or
  pre-confirmed test users.
- OAuth (Google, GitHub) opens a popup the headless agent can't reliably
  script.
- The agent has no way to paste a confirmation-link URL from a different
  machine.

The agent needs a way to reach the authenticated app shell on
`http://localhost:5173` (the Vite dev server) so it can drive normal UX
testing (creating todos, dictation, filter panel, settings, export/import,
header dropdown, etc.) without going through the sign-in form every time.

## Goals

- Agent's Playwright browser reaches the authenticated app shell with one
  setup command.
- No changes to app source, Supabase RLS, migrations, or Edge Functions.
- Test user is **isolated** from David's real account (no accidental edits
  to real data).
- Credentials never live in plaintext on disk and never enter the repo.
- Survives access-token expiry via Supabase's automatic refresh.
- Refresh-token expiry is recoverable with a one-command script.

## Non-goals (YAGNI)

- No automated CI pipeline yet. This is for the agent's interactive
  browser sessions only. (CI auth testing is a separate problem; the
  existing `tests/unit/auth.test.ts` already mocks the Supabase client.)
- No multi-user agent support. One agent test user is enough.
- No production deployment of these scripts. They run on David's
  machine.
- No service_role key, no `?dev=1` back door, no app-code bypass.

## Approach

Seed a Playwright **storage state** file with a valid Supabase session for a
dedicated test user, then launch every agent browser with
`storageState: <path>`.

```
~/.config/opencode/
  todoapp-agent-storage.json      # Playwright storage state (sb-...-auth-token)

scripts/                          # in repo, gitignored
  agent-init.mjs                  # write creds to OS keychain (one-time)
  agent-login.mjs                 # sign in once, write storage state
  agent-refresh.mjs               # re-mint storage state when expired
```

The Supabase JS client reads its persisted session from
`localStorage["sb-<project-ref>-auth-token"]` on first load. Storage state
contains exactly that key, so `onAuthStateChange` fires with a session
before `mountAuthScreen` runs. The app shell mounts normally, RLS keys on
`auth.uid()` of the test user, realtime subscribes.

---

## Section 1 — Architecture

### 1.1 Components

**OS keychain** — holds `{ email, password }` for the test user. Service
name `todoapp-agent`. Accessed via `keytar` (cross-platform binding to
Windows DPAPI, macOS Keychain, libsecret on Linux).

**Storage state file** — `~/.config/opencode/todoapp-agent-storage.json`.
Playwright's standard storage state format: cookies + localStorage entries.
Contains `sb-PROJECT_REF-auth-token` with access_token,
refresh_token, expires_at, user object. Read-only after creation except
by the refresh script.

**Login script `scripts/agent-login.mjs`** — Node script. Reads creds from
keychain, launches headless Chromium against the dev server, drives the
existing `authScreen.ts` UI once, waits for `#appRoot` to be visible,
saves storage state.

**Refresh script `scripts/agent-refresh.mjs`** — identical to login, but
deletes the storage file first.

**Init script `scripts/agent-init.mjs`** — interactive: prompts for email
and password, writes them to keychain. Run once.

**MCP Playwright config** — `opencode.json`'s playwright server entry
gains a `storageState` field pointing at the storage file. Transparent
to every tool call.

### 1.2 What does NOT change

- `src/main.ts`, `src/auth.ts`, `src/ui/authScreen.ts` — untouched.
- `src/supabase.ts`, `src/store.ts`, all RLS, all Edge Functions — untouched.
- `package.json` dependencies — `playwright` and `keytar` are the only
  additions; `@playwright/test` is already present.
- `.env` — no new vars.
- `index.html`, `src/style.css` — untouched.
- Production build — none of these scripts ship in `dist/`.

## Section 2 — File-by-file plan

### 2.1 `scripts/agent-init.mjs` (new, in repo, gitignored)

Interactive setup. Reads email and password from stdin, writes to keychain:

```js
import keytar from "keytar";
import readline from "node:readline";

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise((res) => rl.question(q, res));

const email = (await ask("Test user email: ")).trim();
const password = await ask("Test user password: ");
rl.close();

await keytar.setPassword("todoapp-agent", email, password);
console.log("Saved to OS keychain under service 'todoapp-agent'.");
```

### 2.2 `scripts/agent-login.mjs` (new, in repo, gitignored)

```js
import { chromium } from "playwright";
import keytar from "keytar";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";

const SERVICE = "todoapp-agent";
const STORAGE = path.join(os.homedir(), ".config", "opencode", "todoapp-agent-storage.json");
const DEV_URL  = process.env.AGENT_DEV_URL ?? "http://localhost:5173";

// 1. read creds
const accounts = await keytar.findCredentials(SERVICE);
if (accounts.length === 0) { console.error("Run `node scripts/agent-init.mjs` first."); process.exit(2); }
const { account: email, password } = accounts[0];

// 2. drive the auth form
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext();
const page = await ctx.newPage();

try {
  await page.goto(DEV_URL, { waitUntil: "domcontentloaded", timeout: 10_000 });
  await page.waitForSelector("#authEmail", { timeout: 10_000 });
  await page.fill("#authEmail", email);
  await page.fill("#authPw", password);
  await page.click("#authForm button[type=submit]");

  // success = #appRoot visible, #authRoot hidden
  await page.waitForSelector("#appRoot:not([hidden])", { timeout: 15_000 });

  // 3. persist storage state
  await fs.mkdir(path.dirname(STORAGE), { recursive: true });
  await ctx.storageState({ path: STORAGE });
  console.log(`Wrote ${STORAGE}`);
} catch (e) {
  // capture the .auth-status banner if present
  const banner = await page.locator(".auth-status").textContent().catch(() => "");
  console.error(`Login failed: ${e.message}${banner ? ` — ${banner}` : ""}`);
  process.exit(1);
} finally {
  await browser.close();
}
```

### 2.3 `scripts/agent-refresh.mjs` (new, in repo, gitignored)

Identical body to `agent-login.mjs` plus an unconditional
`fs.unlink(STORAGE).catch(() => {})` at the top.

### 2.4 `opencode.json`

Add `--isolated` (so the MCP honours `--storage-state`) and the
storage-state path to the playwright MCP server entry:

```jsonc
{
  "mcp": {
    "playwright": {
      "command": "npx",
      "args": ["-y", "@playwright/mcp@latest", "--isolated", "--storage-state", "{env:HOME}/.config/opencode/todoapp-agent-storage.json"]
    }
  }
}
```

> **Note for developers:** `{env:HOME}` resolves to your user home
> directory — substitute the equivalent path for your OS
> (e.g. `C:\\Users\\<you>\\.config\\opencode\\todoapp-agent-storage.json`
> on Windows, `/Users/<you>/.config/opencode/todoapp-agent-storage.json`
> on macOS/Linux). Each developer should edit this entry to point at
> their own home directory before relying on the agent-auth bypass.

(Exact MCP flag spelling to be confirmed against the installed MCP version;
fallback is to launch Playwright myself with `storageState` rather than
relying on the MCP flag.)

### 2.5 `.gitignore`

Append:

```
scripts/agent-*.mjs
```

Even though the scripts don't contain secrets, this prevents future
contributors from re-using them in a CI context where the assumptions
break.

### 2.6 Dependencies

Add to `package.json` `devDependencies`:

```json
"keytar": "^7.9.0"
```

`playwright` is already a devDependency.

If `keytar` fails to build on this machine (native binding), fall back to
`safeStorage` from Electron, or — last resort — a `chmod 600` plain JSON
at `~/.config/opencode/todoapp-agent.json`. Decision is recorded at setup
time.

## Section 3 — Data flow

### 3.1 One-time setup (David runs)

1. `npm i -D keytar` in the repo.
2. `node scripts/agent-init.mjs` → prompts, writes to OS keychain.
3. `node scripts/agent-login.mjs` → drives the sign-in form once, writes
   `~/.config/opencode/todoapp-agent-storage.json`.
4. Restart opencode so the MCP picks up `storageState`.

### 3.2 Every agent session

1. MCP playwright launches Chromium with `storageState` set.
2. Agent navigates to `http://localhost:5173`.
3. `main.ts:61` → `onAuthChange` fires immediately with the persisted
   session.
4. `showApp()` runs → app shell mounts.
5. All Supabase requests carry the JWT automatically. RLS keys on
   `auth.uid()` of the test user.

### 3.3 Token refresh

Access token expiry: `@supabase/supabase-js` calls `refreshSession()`
automatically using the persisted refresh token. Storage state stays
valid; agent session is uninterrupted.

Refresh token expiry (default Supabase: 1 hour after last activity):
1. A Supabase request returns 401.
2. Agent observes the "Session expired — sign in again" toast in the
   console / DOM.
3. Agent runs `node scripts/agent-refresh.mjs`.
4. New storage state written; agent retries the action.

### 3.4 Password change / test-user rotation

Run `agent-init.mjs` to update the keychain, then `agent-login.mjs` to
re-mint storage state.

### 3.5 Failure modes

- **No creds in keychain** → login script exits 2 with a clear message;
  agent tells David to run `agent-init.mjs`.
- **Wrong password** → `.auth-status.bad` banner captured; login script
  exits 1; nothing written to disk.
- **Dev server not running** → `#authEmail` selector times out at 10 s;
  login script exits 1.
- **App shell never appears after sign-in** → 15 s timeout, then exit 1
  with last DOM snapshot. Catches RLS misconfiguration, broken
  migrations, missing `profiles` row.
- **Storage file corrupt / unreadable** → MCP launches unauthenticated;
  agent sees the auth screen; can re-run `agent-login.mjs`.

## Section 4 — Testing

### 4.1 Manual smoke checklist (run after setup, documented in spec)

1. Delete `todoapp-agent-storage.json`.
2. Run `node scripts/agent-login.mjs`. Confirm exit 0 and file exists.
3. Open the dev server in a normal browser tab; confirm agent test user
   is signed in (header shows agent's email).
4. In MCP Playwright, navigate to `http://localhost:5173`. Confirm
   `#appRoot` is visible, `#authRoot` hidden, no sign-in form rendered.
5. As the test user, create a todo, sign out from the header menu, sign
   back in. Confirm the todo persists. (Sanity check that RLS is working
   for the test user.)
6. Delete the storage file; open the dev server in MCP Playwright.
   Confirm the auth screen reappears.

### 4.2 Unit tests

`tests/unit/agent-auth.test.ts` (new):

- `agent-init.mjs` then `keytar.findCredentials(...)` returns the same
  values.
- `agent-refresh.mjs` deletes a pre-existing storage file before writing
  a new one.
- The storage file Playwright writes round-trips: read it back as JSON,
  assert `localStorage` has a key starting with `sb-` and ending with
  `-auth-token` whose value parses and contains `access_token`,
  `refresh_token`, `expires_at`.

These tests use the real keychain service `todoapp-agent-test` (separate
from the production `todoapp-agent` service) so they don't touch real
creds.

### 4.3 Existing tests

`tests/unit/auth.test.ts` (the auth wrapper) — unaffected. The Supabase
client is still mocked; we never call the wrapper from these scripts.

## Files touched

### Add

- `scripts/agent-init.mjs`
- `scripts/agent-login.mjs`
- `scripts/agent-refresh.mjs`
- `tests/unit/agent-auth.test.ts`
- `docs/superpowers/specs/2026-09-03-agent-auth-bypass.md` (this file)
- `docs/superpowers/plans/2026-09-03-agent-auth-bypass.md` (next step)

### Change

- `package.json` — add `keytar` to devDependencies.
- `.gitignore` — ignore `scripts/agent-*.mjs`.
- `opencode.json` — add `storageState` to playwright MCP entry (or note
  the manual-launch fallback).

### Delete

None.

### Untouched (explicitly)

- All `src/**` files.
- All `supabase/**` files.
- All migrations.
- `.env`, `.env.example`.
- `index.html`, `dist/`.

## Operational notes

- Test user must exist in Supabase Auth already. If it doesn't, David
  signs up via the live app once (with email confirmation disabled in
  the Supabase dashboard for this user, or with the confirmation email
  accepted), then runs `agent-init.mjs`.
- Test user has no real data; whatever the agent creates is throwaway.
  If data piles up, `delete from public.items where user_id =
  '<test-user-id>';` from psql.
- Test user can be deleted from Supabase Auth dashboard when no longer
  needed.
- Storage state file lives outside the repo at
  `~/.config/opencode/todoapp-agent-storage.json`. Path is hardcoded in
  all three scripts; override with `AGENT_STORAGE_PATH` env var if
  needed.

## Out of scope

- CI authentication. CI runs unit tests with the Supabase client mocked;
  no browser sessions.
- Multi-agent / multi-user support. One test user is enough.
- Automated re-login on every agent action. Access token refresh is
  automatic; refresh-token expiry is one command.
