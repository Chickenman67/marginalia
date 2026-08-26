# Marginalia — free voice/text schedule & todos

A completely free, browser-based (PC + mobile) planner. Speak or type a phrase
("dentist Tuesday 3pm", "call mom after lunch") and it becomes a scheduled event
or a todo. Cross-device sync via Supabase, AI parsing via NVIDIA (free, no key to
start). No accounts — each "space" is a random token you can copy between devices.

## Stack

- Vite + TypeScript, vanilla DOM (no framework)
- vite-plugin-pwa (installable, offline shell)
- Supabase (Postgres + token-keyed RLS) for sync + realtime
- NVIDIA LLM via a Supabase Edge Function proxy (default parser)
- Gemini / Groq as user-selectable fallback keys

## Run locally

```bash
npm install
npm run dev            # demo mode (localStorage) — no backend needed
```

For synced mode, copy `.env.example` → `.env` and fill:

```
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON=...
```

`npm run build` embeds these at build time.

## Deploy (Cloudflare Worker + Assets)

`wrangler.toml` serves the built `dist/` as a Worker with static assets and
SPA fallback (`not_found_handling = "single-page-application"`).

1. Build the site: `npm run build` (reads `.env` for `VITE_SUPABASE_*`).
2. Set the build env vars locally or in the repo's Cloudflare build settings:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON`
3. Deploy: `npm run deploy:cf` (= `wrangler deploy`).
   Requires `CLOUDFLARE_API_TOKEN` (Cloudflare API token with Workers:Edit).
4. Or connect the Git repo in the Cloudflare dashboard; the Worker build uses
   `npm run build` and serves `dist/` via the `[assets]` block in `wrangler.toml`.

## Backend setup (one-time, already done for the live project)

- `supabase/migrations/0001_init.sql` — schema + RLS (run in the SQL editor).
- `supabase/functions/parse/index.ts` — `supabase functions deploy parse --no-verify-jwt`
  after `supabase secrets set NVIDIA_KEY=<key>`.

## Behavior

- Checkbox **completes** (greys out, stays visible) — never deletes.
- Delete (🗑) is available on todos and due items.
- Reminders are **Settings toggles**: "Remind me at each event's time" (on by default)
  and "Browser notifications" (off until you opt in).
- New spaces: click the space chip → "New space" or paste a token to join.
