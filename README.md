# Marginalia — free voice/text schedule & todos

A completely free, browser-based (PC + mobile) planner. Speak or type a phrase
("dentist Tuesday 3pm", "call mom after lunch") and it becomes a scheduled event
or a todo. Cross-device sync via Supabase, AI parsing via NVIDIA (free, no key to
start). Sign in with email + password, Google, or GitHub — your todos follow you.

## Stack

- Vite + TypeScript, vanilla DOM (no framework)
- vite-plugin-pwa (installable, offline shell)
- Supabase (Postgres + per-user RLS) for auth, sync + realtime
- NVIDIA LLM via a Supabase Edge Function proxy (default parser)
- Gemini / Groq as user-selectable fallback keys

## Setup

The app requires `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON` in a `.env` file
at the project root. Without them, the app does not start — sign-in is required.

```
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_ANON=<anon-key>
```

Then:

```bash
npm install
npm run dev
```

Sign in with email + password, Google, or GitHub. Existing users with a
pre-auth token can paste it under "Have an old space token?" on the sign-in
screen to attach their old data.

`npm run build` embeds the env vars at build time.

## Supabase dashboard config (one-time, manual)

For most users, the easiest path is the interactive setup wizard:

```bash
bash scripts/setup-signin.sh
```

It opens each dashboard URL in the right order, tells you exactly what to
click, captures the Client IDs and Secrets, and writes your `.env`.

If you'd rather do it by hand, the steps are below.

For project `PROJECT_REF`:

1. **Authentication → Providers:** enable Email (default), Google (paste client
   ID + secret from Google Cloud Console), GitHub (paste client ID + secret
   from GitHub OAuth app).
2. **Authentication → URL Configuration:** set Site URL to the deployed app
   URL (or `http://localhost:5173` for dev). Add the same URL to Redirect URLs.
3. **Authentication → Email Templates:** confirm the confirmation email is set
   up (default template is fine).

## Deploy (Cloudflare Pages, Git-connect)

1. Push this repo to GitHub.
2. Cloudflare Pages → **Create project** → **Connect to Git** → select the repo.
3. Build settings:
   - **Framework preset:** Vite (or None)
   - **Build command:** `npm run build`
   - **Output directory:** `dist` (created by the build; not in the repo)
   - **Root directory:** `/` (repo root)
4. **Environment variables (build only)** — add as plain variables (not Secrets):
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON`
   These are embedded into the public bundle by Vite; the anon key is designed
   to be public and RLS (keyed on the signed-in user) protects your data.
5. Deploy. Deep links and tab views work via `public/_redirects` (SPA fallback).

No `wrangler.toml` is needed for Git-connect — the dashboard build settings
handle everything.

## Backend setup (one-time, already done for the live project)

- `supabase/migrations/0001_init.sql` — schema + RLS (run in the SQL editor).
- `supabase/functions/parse/index.ts` — `supabase functions deploy parse --no-verify-jwt`
  after `supabase secrets set NVIDIA_KEY=<key>`.

## Behavior

- Checkbox **completes** (greys out, stays visible) — never deletes.
- Delete (🗑) is available on todos and due items.
- Reminders are **Settings toggles**: "Remind me at each event's time" (on by default)
  and "Browser notifications" (off until you opt in).
- Sign out from the user menu in the header.
