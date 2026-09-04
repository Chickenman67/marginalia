# Agent Auth Bypass Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the agent's Playwright browser reach the authenticated app shell on `http://localhost:5173` without going through the sign-in form, by minting a Playwright storage state from a dedicated test user.

**Architecture:** Three Node scripts (`agent-init`, `agent-login`, `agent-refresh`) drive the existing `authScreen.ts` UI once via Playwright and persist the resulting browser storage state to a path outside the repo. The agent's Playwright MCP launches with that storage state so `onAuthStateChange` fires with a session on first paint.

**Tech Stack:** Node.js, Playwright (`@playwright/test` already present), `keytar` (OS keychain binding), Supabase Auth (already wired in app — no app changes).

## Global Constraints

- Test user is **dedicated**, isolated from David's real account.
- Credentials never live in plaintext on disk; keychain is the source of truth.
- No changes to `src/**`, `supabase/**`, `.env`, `index.html`, or `src/style.css`.
- `scripts/agent-*.mjs` are gitignored; secrets never enter the repo.
- Storage state path defaults to `~/.config/opencode/todoapp-agent-storage.json`. Override via `AGENT_STORAGE_PATH` env var.
- Dev URL defaults to `http://localhost:5173`. Override via `AGENT_DEV_URL` env var.
- `package.json` `devDependencies` add `keytar ^7.9.0`.

---

### Task 1: Install `keytar` and gitignore the agent scripts

**Files:**
- Modify: `package.json` (add `keytar` to `devDependencies`)
- Modify: `.gitignore` (add `scripts/agent-*.mjs`)
- Test: none (manual `npm install` verification)

**Interfaces:**
- Consumes: nothing (first task)
- Produces: `keytar` available via `import keytar from "keytar"` in subsequent tasks; `scripts/agent-*.mjs` files excluded from git.

- [ ] **Step 1: Add `keytar` to `package.json` devDependencies**

Open `package.json`. Find the `devDependencies` block. Add `keytar` at the end of that block (before the closing `}`), preserving the existing JSON formatting (2-space indent, no trailing comma).

```json
"keytar": "^7.9.0"
```

- [ ] **Step 2: Run `npm install`**

Run from the repo root:

```bash
npm install
```

Expected: completes without errors. `keytar` builds its native binding; if it fails on Windows because of missing build tools, see Section "Fallback when keytar won't build" at the end of this plan before continuing.

- [ ] **Step 3: Verify `keytar` loads**

Run:

```bash
node -e "import('keytar').then(k => k.findCredentials('nonexistent').then(c => console.log('ok', c.length)))"
```

Expected: prints `ok 0` (no creds stored under `nonexistent`, but the module loads).

- [ ] **Step 4: Add `scripts/agent-*.mjs` to `.gitignore`**

Open `.gitignore`. Append the following line on a new line at the end:

```
scripts/agent-*.mjs
```

- [ ] **Step 5: Verify `.gitignore` excludes the path**

Run:

```bash
git check-ignore -v scripts/agent-foo.mjs
```

Expected: prints the matching `.gitignore` line and exit code 0. If exit code 1, re-check the `.gitignore` content.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json .gitignore
git commit -m "build: add keytar devDep, ignore agent scripts"
```

---

### Task 2: Write `scripts/agent-init.mjs`

**Files:**
- Create: `scripts/agent-init.mjs`
- Test: `tests/unit/agent-auth.test.ts` (created in Task 5; this task only adds the script)

**Interfaces:**
- Consumes: stdin from the operator.
- Produces: a credential in the OS keychain under service `todoapp-agent`, account = the email entered, password = the password entered.

- [ ] **Step 1: Create the file**

Create `scripts/agent-init.mjs` with this exact content:

```js
import keytar from "keytar";
import readline from "node:readline";

const SERVICE = "todoapp-agent";

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise((res) => rl.question(q, res));

const email = (await ask("Test user email: ")).trim();
if (!email) { console.error("Email is required."); process.exit(2); }
const password = await ask("Test user password: ");
if (!password) { console.error("Password is required."); process.exit(2); }
rl.close();

try {
  await keytar.setPassword(SERVICE, email, password);
  console.log(`Saved to OS keychain under service '${SERVICE}', account '${email}'.`);
} catch (e) {
  console.error(`Could not write to keychain: ${e.message}`);
  process.exit(1);
}
```

- [ ] **Step 2: Smoke-test it**

Run:

```bash
node scripts/agent-init.mjs
```

When prompted, enter a throwaway email and a throwaway password (these can be deleted from the keychain afterward). Expected: prints `Saved to OS keychain under service 'todoapp-agent', account '<email>'.` and exits 0.

If you want to clean up the throwaway creds afterward:

```bash
node -e "import('keytar').then(k => k.deletePassword('todoapp-agent', '<email>'))"
```

- [ ] **Step 3: Commit**

```bash
git add scripts/agent-init.mjs
git commit -m "feat(agent): add agent-init script for keychain credential storage"
```

---

### Task 3: Write `scripts/agent-login.mjs`

**Files:**
- Create: `scripts/agent-login.mjs`
- Test: `tests/unit/agent-auth.test.ts` (covers this in Task 5)

**Interfaces:**
- Consumes: `email` and `password` from keychain service `todoapp-agent`. Env vars `AGENT_DEV_URL` (default `http://localhost:5173`) and `AGENT_STORAGE_PATH` (default `~/.config/opencode/todoapp-agent-storage.json`).
- Produces: a Playwright storage state file at `AGENT_STORAGE_PATH`, exit 0 on success, exit 1 on auth failure, exit 2 if no creds in keychain.

- [ ] **Step 1: Create the file**

Create `scripts/agent-login.mjs` with this exact content:

```js
import { chromium } from "playwright";
import keytar from "keytar";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";

const SERVICE = "todoapp-agent";
const DEV_URL  = process.env.AGENT_DEV_URL ?? "http://localhost:5173";
const STORAGE = process.env.AGENT_STORAGE_PATH ??
  path.join(os.homedir(), ".config", "opencode", "todoapp-agent-storage.json");

const accounts = await keytar.findCredentials(SERVICE);
if (accounts.length === 0) {
  console.error(`No credentials in keychain under service '${SERVICE}'. Run 'node scripts/agent-init.mjs' first.`);
  process.exit(2);
}
const { account: email, password } = accounts[0];

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext();
const page = await ctx.newPage();

let exitCode = 0;
try {
  await page.goto(DEV_URL, { waitUntil: "domcontentloaded", timeout: 10_000 });
  await page.waitForSelector("#authEmail", { timeout: 10_000 });
  await page.fill("#authEmail", email);
  await page.fill("#authPw", password);
  await page.click('#authForm button[type="submit"]');

  await page.waitForSelector("#appRoot:not([hidden])", { timeout: 15_000 });

  await fs.mkdir(path.dirname(STORAGE), { recursive: true });
  await ctx.storageState({ path: STORAGE });
  console.log(`Wrote ${STORAGE}`);
} catch (e) {
  const banner = await page.locator(".auth-status").textContent().catch(() => "");
  console.error(`Login failed: ${e.message}${banner ? ` — ${banner}` : ""}`);
  exitCode = 1;
} finally {
  await browser.close();
}
process.exit(exitCode);
```

- [ ] **Step 2: Smoke-test against a running dev server**

Start the dev server in another terminal:

```bash
npm run dev
```

Wait for it to print the `Local:` URL. Confirm it matches `http://localhost:5173` (or set `AGENT_DEV_URL` accordingly).

Run:

```bash
node scripts/agent-login.mjs
```

Expected: prints `Wrote C:\Users\<you>\.config\opencode\todoapp-agent-storage.json` and exits 0. If exit 1, check the printed error — common causes: dev server not running, wrong password in keychain.

- [ ] **Step 3: Inspect the storage file**

Run:

```bash
node -e "const j=require('./C:/Users/<you>/.config/opencode/todoapp-agent-storage.json'); console.log(JSON.stringify(j.localStorage.find(l=>l.name.includes('auth-token')), null, 2))"
```

Expected: prints a JSON object with a `name` starting with `sb-` and ending with `-auth-token`, and a `value` string that contains `access_token`, `refresh_token`, and `expires_at`.

(Replace `<you>` with the actual Windows username.)

- [ ] **Step 4: Commit**

```bash
git add scripts/agent-login.mjs
git commit -m "feat(agent): add agent-login script that mints Playwright storage state"
```

---

### Task 4: Write `scripts/agent-refresh.mjs`

**Files:**
- Create: `scripts/agent-refresh.mjs`

**Interfaces:**
- Same as `agent-login.mjs`, plus: deletes `AGENT_STORAGE_PATH` before login.

- [ ] **Step 1: Create the file**

Create `scripts/agent-refresh.mjs` with this exact content:

```js
import { chromium } from "playwright";
import keytar from "keytar";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";

const SERVICE = "todoapp-agent";
const DEV_URL  = process.env.AGENT_DEV_URL ?? "http://localhost:5173";
const STORAGE = process.env.AGENT_STORAGE_PATH ??
  path.join(os.homedir(), ".config", "opencode", "todoapp-agent-storage.json");

await fs.unlink(STORAGE).catch(() => {});

const accounts = await keytar.findCredentials(SERVICE);
if (accounts.length === 0) {
  console.error(`No credentials in keychain under service '${SERVICE}'. Run 'node scripts/agent-init.mjs' first.`);
  process.exit(2);
}
const { account: email, password } = accounts[0];

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext();
const page = await ctx.newPage();

let exitCode = 0;
try {
  await page.goto(DEV_URL, { waitUntil: "domcontentloaded", timeout: 10_000 });
  await page.waitForSelector("#authEmail", { timeout: 10_000 });
  await page.fill("#authEmail", email);
  await page.fill("#authPw", password);
  await page.click('#authForm button[type="submit"]');

  await page.waitForSelector("#appRoot:not([hidden])", { timeout: 15_000 });

  await fs.mkdir(path.dirname(STORAGE), { recursive: true });
  await ctx.storageState({ path: STORAGE });
  console.log(`Refreshed ${STORAGE}`);
} catch (e) {
  const banner = await page.locator(".auth-status").textContent().catch(() => "");
  console.error(`Refresh failed: ${e.message}${banner ? ` — ${banner}` : ""}`);
  exitCode = 1;
} finally {
  await browser.close();
}
process.exit(exitCode);
```

- [ ] **Step 2: Smoke-test it**

Confirm `scripts/agent-login.mjs` wrote a storage state (Task 3). Run:

```bash
node scripts/agent-refresh.mjs
```

Expected: prints `Refreshed C:\Users\<you>\.config\opencode\todoapp-agent-storage.json` and exits 0. Verify the file's mtime changed:

```bash
(Get-Item "$env:USERPROFILE\.config\opencode\todoapp-agent-storage.json").LastWriteTime
```

Expected: within the last few seconds.

- [ ] **Step 3: Commit**

```bash
git add scripts/agent-refresh.mjs
git commit -m "feat(agent): add agent-refresh script to re-mint storage state"
```

---

### Task 5: Add unit test `tests/unit/agent-auth.test.ts`

**Files:**
- Create: `tests/unit/agent-auth.test.ts`

**Interfaces:**
- Consumes: `keytar` (real, scoped to service `todoapp-agent-test` so tests don't touch the production keychain entry).
- Produces: passing assertions for keychain round-trip and storage-file shape. No DOM, no Playwright.

- [ ] **Step 1: Inspect the existing vitest config**

Read `vitest.config.ts`. Confirm it includes `tests/unit/**/*.test.ts`. If it uses a different pattern, follow it; otherwise default is fine.

- [ ] **Step 2: Create the test file**

Create `tests/unit/agent-auth.test.ts` with this exact content:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import keytar from "keytar";

const SERVICE = "todoapp-agent-test";
const EMAIL = "vitest-agent@example.invalid";
const PASSWORD = "vitest-password-1234";

beforeAll(async () => {
  await keytar.deletePassword(SERVICE, EMAIL).catch(() => {});
});

afterAll(async () => {
  await keytar.deletePassword(SERVICE, EMAIL).catch(() => {});
});

describe("agent auth: keychain round-trip", () => {
  it("writes and reads a credential under the test service", async () => {
    await keytar.setPassword(SERVICE, EMAIL, PASSWORD);
    const back = await keytar.getPassword(SERVICE, EMAIL);
    expect(back).toBe(PASSWORD);
  });

  it("findCredentials returns the test credential", async () => {
    const creds = await keytar.findCredentials(SERVICE);
    expect(creds.find((c) => c.account === EMAIL)?.password).toBe(PASSWORD);
  });
});

describe("agent auth: storage-state shape", () => {
  it("rejects a missing storage file", async () => {
    const bogus = path.join(os.tmpdir(), `todoapp-agent-${Date.now()}.json`);
    await expect(fs.access(bogus)).rejects.toBeDefined();
  });

  it("recognises a Playwright storage state containing sb-...-auth-token", async () => {
    const tmp = path.join(os.tmpdir(), `todoapp-agent-${Date.now()}.json`);
    const sample = {
      cookies: [],
      origins: [
        {
          origin: "http://localhost:5173",
          localStorage: [
            {
              name: "sb-PROJECT_REF-auth-token",
              value: JSON.stringify({
                access_token: "fake-access",
                refresh_token: "fake-refresh",
                expires_at: Math.floor(Date.now() / 1000) + 3600,
                token_type: "bearer",
                user: { id: "u", email: "x@y.z" }
              })
            }
          ]
        }
      ]
    };
    await fs.writeFile(tmp, JSON.stringify(sample));
    const raw = JSON.parse(await fs.readFile(tmp, "utf8"));
    const entry = raw.origins[0].localStorage[0];
    expect(entry.name.startsWith("sb-")).toBe(true);
    expect(entry.name.endsWith("-auth-token")).toBe(true);
    const parsed = JSON.parse(entry.value);
    expect(parsed.access_token).toBeTruthy();
    expect(parsed.refresh_token).toBeTruthy();
    expect(parsed.expires_at).toBeGreaterThan(0);
    await fs.unlink(tmp);
  });
});
```

- [ ] **Step 3: Run the test**

Run from repo root:

```bash
npm test -- tests/unit/agent-auth.test.ts
```

Expected: all tests pass. If `keytar` cannot access the OS keychain in the test runner (e.g. headless Linux CI), the keychain tests fail — see "Fallback when keytar won't build" below; the storage-shape test should still pass.

- [ ] **Step 4: Commit**

```bash
git add tests/unit/agent-auth.test.ts
git commit -m "test(agent): cover keychain round-trip and storage-state shape"
```

---

### Task 6: Wire the storage state into the Playwright MCP

**Files:**
- Modify: `opencode.json` (add `storageState` arg to the playwright MCP server entry)

**Interfaces:**
- Consumes: storage state file from Task 3.
- Produces: every agent Playwright session launches with that storage state, so `onAuthStateChange` fires on first paint.

- [ ] **Step 1: Read `opencode.json`**

Read `opencode.json` to find the existing playwright MCP server entry. Locate the `mcp` block and the playwright server config (likely under `mcp.playwright` or `mcp.servers.playwright`).

- [ ] **Step 2: Add the `--storage-state` flag**

Append the storage-state flag to the MCP server's args. The exact path on this machine:

```
C:\\Users\\<you>\\.config\\opencode\\todoapp-agent-storage.json
```

If the args array currently looks like:

```json
"args": ["-y", "@playwright/mcp@latest"]
```

change it to (note `--isolated` MUST come before `--storage-state` for the
flag to be honoured, and the path is per-developer):

```json
"args": ["-y", "@playwright/mcp@latest", "--isolated", "--storage-state", "{env:HOME}/.config/opencode/todoapp-agent-storage.json"]
```

On Windows the expanded path is typically
`C:\\Users\\<you>\\.config\\opencode\\todoapp-agent-storage.json`. Each
developer should substitute their own home directory.

If the playwright MCP version installed doesn't support `--storage-state` as a CLI flag (verify via `npx -y @playwright/mcp@latest --help`), fall back to launching Playwright directly in each agent invocation with `storageState` set on the context — note that fallback in the spec under "operational notes" and stop here without changing `opencode.json`.

- [ ] **Step 3: Restart opencode**

Restart opencode (or reload its MCP config) so the new arg is picked up.

- [ ] **Step 4: Verify in a fresh Playwright session**

Use the Playwright MCP to navigate to `http://localhost:5173`. Confirm `#appRoot` is visible and `#authRoot` is hidden without the agent having to fill the sign-in form.

If the auth screen appears, the storage flag isn't being honoured — check `--help` for the correct spelling, or use the direct-launch fallback.

- [ ] **Step 5: Commit**

```bash
git add opencode.json
git commit -m "chore(mcp): pass storage-state to playwright MCP for agent auth"
```

---

## Fallback when keytar won't build

If `npm install` fails because `keytar`'s native binding won't compile (Windows without Visual Studio Build Tools, Linux without `libsecret-1-dev`, macOS without Xcode CLT):

1. **Don't add keytar.** Skip Task 1's `npm install` for `keytar`.
2. Use `safeStorage` from Node's experimental `node:sea` / `electron` modules, **or**
3. **Use a chmod-600 plain JSON file** at `~/.config/opencode/todoapp-agent.json`. Replace `keytar.findCredentials` calls with `JSON.parse(fs.readFile(...))`. Set the file's permissions to `0600` on creation. This is the last-resort fallback documented in the spec.

Either fallback: update Tasks 2, 3, 4 to import credentials from a shared helper at `scripts/_agent-cred.mjs` that wraps whichever store you choose, so the test in Task 5 can mock or skip the keychain portion with `vi.mock("keytar")`. The Task 5 test file as written assumes keytar is available; if you take the fallback, change the import in the test to import from the shared helper and `vi.mock` that instead.

## Manual smoke checklist (run once after Task 6)

1. Delete the storage file: `Remove-Item "$env:USERPROFILE\.config\opencode\todoapp-agent-storage.json"`.
2. Open the dev server in a normal browser tab; confirm agent test user is signed in (header shows agent's email).
3. Use the Playwright MCP to navigate to `http://localhost:5173`. Confirm `#appRoot` is visible and `#authRoot` hidden.
4. As the test user, create a todo, sign out from the header menu, sign back in. Confirm the todo persists (sanity check that RLS works for this user).
5. Delete the storage file; navigate again with the MCP. Confirm the auth screen reappears.
6. Re-run `node scripts/agent-login.mjs`; confirm the auth screen disappears again.

## Files touched

### Add

- `scripts/agent-init.mjs` (Task 2)
- `scripts/agent-login.mjs` (Task 3)
- `scripts/agent-refresh.mjs` (Task 4)
- `tests/unit/agent-auth.test.ts` (Task 5)

### Change

- `package.json` (Task 1: add `keytar`)
- `package-lock.json` (Task 1)
- `.gitignore` (Task 1)
- `opencode.json` (Task 6)

### Untouched (explicitly)

- All `src/**` files.
- All `supabase/**` files including migrations and Edge Functions.
- `.env`, `.env.example`.
- `index.html`, `dist/`.
- `vite.config.ts`, `tsconfig.json`.
