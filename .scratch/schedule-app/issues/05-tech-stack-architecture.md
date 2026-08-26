Type: prototype
Status: resolved

## Question

Produce a concrete tech-stack and architecture proposal for the PWA: framework choice (vanilla TS vs React/Vue/Svelte), build tooling, offline/PWA service worker, how the three subsystems wire together (Web Speech capture → LLM parse → Supabase sync → UI render), and the folder/module layout. Make a cheap runnable stub or outline the user can react to. Resolve the recommendation so later build tickets don't re-litigate stack.

## Answer

**Stack (resolved & scaffolded in this repo):**
- **Vite + TypeScript**, **vanilla DOM** (no framework) — matches the prototype's tiny footprint; deploys to any free static host (Netlify/Vercel/Cloudflare Pages/GitHub Pages). No framework runtime = keeps it free and fast.
- **vite-plugin-pwa** → installable PWA (manifest + service worker, offline shell). The map's "real push" stays fog, but the PWA install now exists.
- **@supabase/supabase-js** for sync + realtime (RLS keyed on `space_token`).
- **Design contract** = the "calm editorial paper planner" from the prototype (Fraunces + Inter, terracotta/sage accents) — carried into `src/style.css`.

**Architecture (data flow):**
`Web Speech (src/speech.ts)` → text → `src/ui/input.ts` → `parsePhrase()` in `src/supabase.ts` (NVIDIA via Edge proxy default; Gemini/Groq direct fallback) → `src/store.ts` (single observable store; demo-mode falls back to localStorage) → Supabase insert + `postgres_changes` realtime → re-render `src/ui/views.ts`.

**Layout:** `src/{config,types,store,supabase,speech}.ts`, `src/ui/{header,input,views}.ts`, `index.html`, `public/icon.svg`, `supabase/migrations/0001_init.sql` (RLS + 500-item cap trigger).

**Verification:** `npm run typecheck` clean; `npm run build` clean (PWA precache emitted); Playwright smoke test confirms seed render, complete-doesn't-delete, delete works, add-via-input parses to an event, tab switching. Demo mode runs with no env vars.

This unblocks tickets 07/08/10 (schema already drafted in the migration) and the remaining product tickets.
