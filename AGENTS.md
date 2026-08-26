# ToDoApp

## Agent skills

### Issue tracker

Issues are tracked as local markdown files under `.scratch/<feature>/`. See `docs/agents/issue-tracker.md`.

### Triage labels

Default five canonical triage labels: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context layout — root `CONTEXT.md` + `docs/adr/`. See `docs/agents/domain.md`.

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

### Live deployment status (2026-08-25)
- Supabase project `PROJECT_REF` (us-east-1) is wired: schema + token-keyed RLS applied (`supabase/migrations/0001_init.sql`), NVIDIA secret set, `parse` Edge Function deployed and verified.
- App builds with `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON` (in `.env`, gitignored) → synced mode; without them → demo (localStorage) mode.
- One-time remaining step: deploy `dist/` to a free static host (Netlify/Vercel/Cloudflare Pages) for the public demo URL.
- When running `supabase` CLI commands, the project ref is `PROJECT_REF`.
