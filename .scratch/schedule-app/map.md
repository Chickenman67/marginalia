# Map: Free voice/text schedule & todo app (ScheduleApp)

## Destination

A free, browser-based (PC + mobile) voice/text schedule & todo app that David uses daily. Smart AI parsing (NVIDIA default, optional configurable key), cross-device sync via a dedicated free backend, demo access for anyone without touching David's data, and per-space JSON export/import. The map clears every decision blocking the build; execution is handed off once the way is clear.

## Notes

- Owner: David (single owner; no accounts). Demo link open to anyone via space tokens.
- Skills every session should consult: `/grilling`, `/domain-modeling`, `/prototype`, `/research`.
- Standing preference: the agent keeps `AGENTS.md` updated with David's preferences and goals as they surface.
- Tracker: local markdown under `.scratch/schedule-app/` (see `docs/agents/issue-tracker.md`).

## Decisions so far

- [Destination + scope settled](.scratch/schedule-app/map.md) — working app (not just a spec), built in this repo.
- [Users & demo model](.scratch/schedule-app/map.md) — you-only ownership, no accounts; anyone can open the demo and create their own isolated space via a random token.
- [Sync mechanism](.scratch/schedule-app/map.md) — dedicated free backend (Supabase free tier), data partitioned by space token, no login.
- [Supabase free-tier verdict](.scratch/schedule-app/issues/01-supabase-free-tier-sync.md) — free tier is viable: 500 MB DB cap + 200 Realtime conns are the ceilings; use publishable `anon` key, RLS keyed on `space_token` (not auth.uid()), realtime Postgres Changes sync without Auth. Schema + RLS sketch in the ticket.
- [App behavior](.scratch/schedule-app/map.md) — creates timed schedule items + todos + due reminders from phrasing.
- [Voice input](.scratch/schedule-app/map.md) — Web Speech API first; offline voice (Whisper/WASM) deferred.
- [Web Speech API support](.scratch/schedule-app/issues/03-web-speech-api-support.md) — voice promised on Chrome/Edge/Samsung/Safari 14.5+; NOT Firefox; needs HTTPS + user gesture + internet; text fallback mandatory.
- [AI brain](.scratch/schedule-app/map.md) — **NVIDIA is the default parser for all users, routed through a server-side Supabase Edge Function proxy** (holds David's key, adds CORS, rate-limits). NVIDIA chosen because free + unlimited (slow). Google Gemini / Groq remain selectable fallbacks if a user pastes their own key (browser-direct, CORS-OK). See [ticket 02](.scratch/schedule-app/issues/02-free-llm-task-parsing.md) and [ticket 10](.scratch/schedule-app/issues/10-build-llm-proxy.md).
- [Guest guard rails](.scratch/schedule-app/map.md) — per-space item cap (~500) + idle expiry of guest spaces; David's space exempt.
- [Export/import](.scratch/schedule-app/map.md) — per-space JSON backup download/import; doubles as manual cross-device fallback.
- [LLM proxy](.scratch/schedule-app/issues/10-build-llm-proxy.md) — NVIDIA default is reached via a Supabase Edge Function that holds the key, enforces space-token auth + global rate limit, and forwards parse requests.
- [Tech stack & architecture](.scratch/schedule-app/issues/05-tech-stack-architecture.md) — Vite + TypeScript, vanilla DOM (no framework), vite-plugin-pwa, @supabase/supabase-js. Data flow: speech → input → NVIDIA proxy (or Gemini/Groq fallback) → store (localStorage demo-mode fallback) → Supabase + realtime. Scaffolded in repo; design = "calm editorial paper planner".
- [v1 notifications](.scratch/schedule-app/issues/06-v1-notification-strategy.md) — reminders are **Settings toggles** (auto-remind events ON by default; browser notifications OFF until opt-in). Due tab + 30s poll; real push deferred to fog.
- [Supabase schema](.scratch/schedule-app/issues/07-standup-supabase-schema.md) — schema + RLS (token-keyed) + 500-item cap drafted in `supabase/migrations/0001_init.sql`; user must create the free project + run it + set VITE_ env. App auto-uses demo (localStorage) until then.
- [Space-token UX](.scratch/schedule-app/issues/08-space-token-ux.md) — auto token on first run, copyable via header chip, "New space"/"Use this space" modal; demo strangers get isolated spaces. No accounts.
- [LLM proxy](.scratch/schedule-app/issues/10-build-llm-proxy.md) — Supabase Edge Function `supabase/functions/parse/index.ts` holds NVIDIA key, requires `x-space-token`, rate-limits, returns parsed JSON with CORS. Deploy is the user's one-time action.

## Status

**Map resolved — deployed.** All 9 tickets closed. As of 2026-08-25 the backend is live on Supabase project `PROJECT_REF`: schema + RLS applied, NVIDIA secret set, `parse` Edge Function deployed and verified returning correct-current-year JSON. App built with `VITE_SUPABASE_*` in `.env` switches to synced mode; Playwright smoke test confirmed add→NVIDIA-parse→Supabase-persist→reload round-trips with zero errors. Remaining: deploy the static `dist/` to a free host (Netlify/Vercel/Cloudflare Pages) for the public demo URL. Demo mode (localStorage) still works without env vars.

## Not yet specified

- Real web push notifications on mobile (PWA service worker) — v1 uses in-app due list.
- Offline / on-device voice transcription (Whisper WASM).
- Client-side encryption before data leaves the browser.
- CSV export in addition to JSON.
- Recurring-task rules (daily/weekly repeats).
- Conflict resolution depth for offline edits.

## Out of scope

- Native iOS/Android apps — PWA browser only.
- Paid tiers, billing, accounts/admin user-management screens.
- Full offline-first CRDT-grade sync.
