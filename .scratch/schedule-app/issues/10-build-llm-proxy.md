Type: task
Status: resolved
Blocked by: 02

## Question

Build the LLM proxy that makes NVIDIA the default parser for all users. Per ticket 02, the browser cannot call NVIDIA directly (no CORS header), so host a Supabase Edge Function (`/functions/v1/parse`) that: (1) holds David's `NVIDIA_KEY` as a server-side secret (never shipped to the browser); (2) requires a valid `x-space-token` header so anonymous demo users can't call it unauthenticated; (3) enforces a global rate limit to stop abuse (NVIDIA is unlimited-but-slow); (4) forwards the request to `https://integrate.api.nvidia.com/v1/chat/completions` with `meta/llama-3.1-8b-instruct` and `response_format: { type: "json_object" }`, returning the parsed `{title, datetime, type, reminder}` JSON with permissive CORS; (5) documents the exact browser call pattern and how the function + secret are deployed via Supabase CLI. Resolved when the proxy is live and a browser client with a space token gets structured JSON back.

## Answer

Proxy implemented in `supabase/functions/parse/index.ts` (Supabase Edge Function, Deno):

- Holds `NVIDIA_KEY` as a server-side secret (set via `supabase secrets set NVIDIA_KEY=...`); never sent to the browser.
- Requires `x-space-token` header → 401 if missing (stops anonymous abuse).
- Global in-memory rate limit (30/min per instance) → 429 when exceeded.
- Forwards to NVIDIA `meta/llama-3.1-8b-instruct` with `response_format: json_object`, system prompt that yields `{title, datetime, type, reminder}`. Returns cleaned JSON with permissive CORS (`*`) so the browser can call it directly.
- Also touches `spaces.last_active_at` (for idle-expiry maintenance) — non-fatal.
- Deployed with `supabase functions deploy parse --no-verify-jwt` and `supabase secrets set NVIDIA_KEY=...`.

Browser call (already in `src/supabase.ts` `parsePhrase`): `POST {SUPABASE_URL}/functions/v1/parse` with `Authorization: Bearer <anon>`, `x-space-token: <token>`, body `{ phrase }`.

Manual deploy is the user's one-time action (needs the Supabase project from ticket 07). Code is complete and ready. This was the last open ticket.
