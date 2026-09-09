# ToDoApp

## Agent skills

### Issue tracker

Issues are tracked as local markdown files under `.scratch/<feature>/`. See `docs/agents/issue-tracker.md`.

### Triage labels

Default five canonical triage labels: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context layout — root `CONTEXT.md` + `docs/adr/`. See `docs/agents/domain.md`.

### Agent auth bypass (Playwright storage state)

The app boots behind a Supabase Auth sign-in screen. To get past it without going through the form:

- The Playwright MCP entry in `opencode.json` is launched with `--isolated --storage-state` pointing at `C:\Users\<you>\.config\opencode\todoapp-agent-storage.json` (JSON-escaped in the config). Every browser session auto-loads the persisted Supabase session; `onAuthStateChange` fires on first paint, the auth screen never appears.
- The storage file is produced by `scripts/agent-login.mjs` (one-time, after `scripts/agent-init.mjs` writes the test user's email/password to the OS keychain under service `todoapp-agent`). When the Supabase refresh token expires (default 1 hour idle) the first request returns 401; tell the user "I'll re-login" and run `node scripts/agent-refresh.mjs` to mint a fresh storage state.
- The test user is dedicated and isolated from David's real account. Credentials live in the OS keychain (Windows DPAPI), not on disk. Spec: `docs/superpowers/specs/2026-09-03-agent-auth-bypass-design.md`. Plan: `docs/superpowers/plans/2026-09-03-agent-auth-bypass.md`.
- If the user reports "I'm stuck on the sign-in screen" in a fresh session, the storage state is likely stale — run `scripts/agent-refresh.mjs` and retry.

## David's preferences & goals

Maintained by the agent as they surface. Standing rule: keep this section updated.

### Goals
- Build a free, browser-based (PC + mobile) voice/text schedule & todo app used daily — "so I don't forget things I need to do."
- Keep AGENTS.md itself auto-updated with preferences and goals as work progresses.

### Preferences
- **Completely free**: only free tiers / no-cost hosting (Supabase free tier, free LLM tiers). No paid APIs.
- **AI parsing, not rule-based**: natural-language understanding via a free-tier LLM.
- **Input**: speak via mic (Web Speech API) or type.
- **Cross-device sync**: tasks entered on one device appear on the other.
- **Demo-friendly**: others may open the demo link and get their own isolated space; guest spaces must not bloat storage (per-space item cap + idle expiry).
- **Export/import**: per-space JSON backup download/import.
- **No re-entering keys**: any user-set API key persists in browser localStorage.
- **Architecture defaults** (from `/wayfinder` map `.scratch/schedule-app/`): default LLM = NVIDIA via server-side Supabase Edge Function proxy (holds key, adds CORS, rate-limits; free + unlimited but slow), with Google Gemini / Groq as user-selectable fallback keys. Sync = Supabase free tier, RLS keyed on space token, no accounts.

### Live deployment status (2026-09-08)
- Supabase project `PROJECT_REF` (us-east-1) is wired: schema + token-keyed RLS applied, NVIDIA secret set, `parse` + `polish` Edge Functions deployed and verified (verify_jwt false; CORS set).
- **Rate limiter caveat:** `public.check_rate_limit` EXECUTE is granted to `service_role` only — the Edge Functions must talk to it via a service-role admin client (`SUPABASE_SERVICE_ROLE_KEY`), NOT the anon-key user-JWT client (that silently 429s every authorized call). Both functions now fail loudly (500) if that key is missing. If rate limiting "breaks everything," check: (1) service-role key set in project secrets, (2) functions deployed from `main`.
- **Key-sync migration:** `supabase/migrations/20260908215934_sync_api_keys.sql` adds `llm_key`/`llm_provider` to `profiles` (plaintext — personal tool, RLS-scoped; encryption deferred). Settings reads/writes these; localStorage is the fallback when the profile fetch fails.
- Deterministic date resolution shipped 2026-09-08: bare weekday → all-day event on next occurrence (confirm card); time-of-day phrase ("by morning") → confirmable timed event; explicit cues (clock/today/tomorrow/next+weekday/month-day/"in X minutes") bypass confirm. Core in `src/dates.ts` (`resolveSchedule`/`applyResolve`), unit-tested.
- Mobile ergonomics shipped 2026-09-08: titles clamp to 2 lines ≤520px with tap-to-enter key (Enter/Space, `aria-expanded`), compact writing bar, and a `body.dock-min` scroll-collapse on coarse-pointer devices; desktop ≥521px unchanged. CSS in `src/style.css` (tail media blocks), JS in `src/ui/views.ts` + `src/ui/dockCollapse.ts`, unit-tested; verified via Playwright on a phone viewport.
- App builds with `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON` (in `.env`, gitignored) → synced mode; without them → demo (localStorage) mode.
- One-time remaining step: deploy `dist/` to a free static host (Netlify/Vercel/Cloudflare Pages) for the public demo URL.
- When running `supabase` CLI commands, the project ref is `PROJECT_REF`.
