# Dictation Mode + AI Restoration + Hardened Space Tokens — Design

**Date:** 2026-08-26
**Status:** Approved (user review)

## Problem

Three issues reported by the app owner:

1. **AI not being used.** The live AI path is dead: the Supabase Edge Function
   (`supabase/functions/parse/index.ts`) calls NVIDIA model `meta/llama-3.1-8b-instruct`,
   which NVIDIA retired on 2026-08-26 (returns `410 Gone`), so the function returns `502`.
   `commit()` in `src/ui/input.ts:48` then silently falls back to the local `guess()`
   heuristic. The live preview shown while typing (`src/ui/input.ts:34`) is *always* that
   heuristic, never the AI. Net effect: the app appears rule-based.
2. **No OpenWhisper-style polish.** Each utterance becomes exactly one item via a
   single-phrase parser. There is no step that cleans up a rambling dictation and turns
   it into a tidy, organized list of multiple items.
3. **Token security.** `getSpaceToken()` (`src/store.ts:9`) generates `space-` + 12 hex
   chars from a UUID — ~48 bits with a guessable, structured prefix. That token is the
   *only* secret protecting the user's data under token-keyed RLS. A guessed token can
   read/write the space.

This design fixes all three.

## Goals

- Restore a working, free, server-held AI default (NVIDIA).
- Add a dictation mode: ramble a paragraph → AI produces a clean, organized list of
  multiple items → user reviews/edits grouped by Schedule vs Todos → adds all.
- Harden space tokens so a guessed id alone cannot access data.

## Non-goals (YAGNI)

- No user accounts / auth provider. Still token-based, no passwords.
- No change to the demo (localStorage) mode architecture beyond token generation.
- No new hosting; reuse the existing Supabase project `PROJECT_REF`.

---

## Section 1 — Restore the AI path

### Default model
- Replace `meta/llama-3.1-8b-instruct` in `supabase/functions/parse/index.ts:9` with a
  **current, free NVIDIA NIM model**. Candidate: `nvidia/llama-3.3-nemotron-super-49b-v1`
  (or a stable currently-available instruct build). The exact model will be chosen by
  querying NVIDIA's model catalog and verifying a live `200` response before deploy.
- Keep `response_format: json_object`, `temperature: 0.2`.

### Honest failure handling
- In `src/ui/input.ts`, the single-item `commit()` currently swallows AI errors and
  silently uses `guess()`. Change so that on AI failure it:
  - shows a visible inline notice ("AI unavailable — added as plain note, edit if needed"),
  - still saves the item but clearly marks it as un-parsed (title = raw phrase, kind=todo,
    no datetime), rather than pretending the heuristic is the AI result.
- `guess()` remains only as a *preview* nicety, labeled as "quick guess" so the user knows
  it is not the AI.

### Verification
- Live `curl`/`Invoke-RestMethod` against `/functions/v1/parse` must return `200` with a
  valid parsed JSON before the function is deployed.

---

## Section 2 — OpenWhisper-style dictation mode

### UX
- A "Dictate" mode toggle in the input area (separate from the single-line quick-add).
- In dictate mode:
  - Mic captures a longer utterance (allow multiple `onresult` chunks / continuous capture
    with a stop button), OR a text box accepts a pasted ramble.
  - "Process" button sends the whole paragraph to the AI.

### AI contract
- Extend the existing `parse` Edge Function (or add `/polish`) to accept a paragraph and
  return **an array** of items:
  `{ "items": [ { "title", "kind" ("todo"|"event"), "datetime"|null, "reminder"|null }, ... ] }`.
- System prompt instructs: split rambling speech into discrete tasks/events, resolve
  relative times to the user's local timezone + current year, classify each as event
  (has a time) or todo (no time), and produce a clean, polished title for each.

### Review-first result UI
- Render the returned items **grouped into two columns/sections: Schedule (events) and
  Todos (plain)**.
- Each drafted item is editable (inline text + a datetime control for events) and
  deletable. An item can be moved between Schedule ⇄ Todos (toggling `kind`).
- "Add all" commits every drafted item via `addItem`; "Discard" clears the draft.
- This satisfies the review-first, grouped preference.

### Data flow
```
Mic/type (paragraph) → /polish (LLM, multiline) → grouped draft UI (edit/move/delete)
→ "Add all" → addItem per item → Supabase (hardened token)
```

---

## Section 3 — Hardened space tokens

### Token generation
- In `src/store.ts:9`, generate a **128-bit** random value with **no** `space-` prefix:
  `crypto.getRandomValues` → base64url (22 chars). Stored in localStorage as today.

### Separate id from auth secret (the real fix)
- A space is identified by an **id** (safe to appear in URLs / sync logs) and protected by
  a **secret** the browser must prove possession of. Concretely:
  - Token sent in `x-space-token` = `id.secret` (both 128-bit random, joined by `.`).
  - `spaces` table gets a `secret` column; `token` column becomes the `id` (primary key).
  - RLS policies match on `space_token = id` **and** verify the request's supplied secret
    equals `spaces.secret`. The Edge Function checks the secret server-side before any
    read/write and rejects on mismatch.
- A guessed `id` without the correct `secret` half yields no match → no data access.
  Guessing both 128-bit halves is infeasible.

### Schema migration (additive)
- New migration `supabase/migrations/0002_harden_tokens.sql`:
  - `alter table public.spaces add column secret text not null default '';`
  - Backfill existing rows: generate a random secret per existing space (Edge Function or
    one-off SQL using `gen_random_bytes`). Existing clients must re-sync (they only have
    the old `space-xxx` token) — handled by treating an unmatched old token as "new space"
    and re-provisioning with the new id.secret scheme on next load.
  - Update RLS policies to require secret match (functions compare `current_setting`
    secret against `spaces.secret` for the matching id).
- `enforce_item_cap` trigger unchanged.

### Edge Function auth
- `parse`/`polish` (and the keep-alive `spaces` update) read `x-space-token`, split into
  `id.secret`, and validate `secret` against `spaces.secret` before processing. Reject
  `401` on missing/mismatched secret.

---

## Section 4 — Default / fallback model policy

- **Default:** NVIDIA free model, server-held key (no user key required). Used when no
  user key is set.
- **Fallback / faster option:** user may supply a Gemini or Groq API key in settings
  (already supported via `STORAGE_KEYS.llmKey` / `provider`). When set, `parseDirect`
  uses that provider for faster/more reliable parsing. Unchanged behavior.
- Dictation `/polish` follows the same default/fallback routing.

---

## Testing

1. **AI live check:** `Invoke-RestMethod` to `/functions/v1/parse` returns `200` with
   valid JSON for a sample phrase, using the new NVIDIA model.
2. **Dictation split:** feed "call the dentist tomorrow at 3pm and also buy milk and send
   the invoice friday" → two grouped drafts (1 event + 2 todos), editable, movable,
   "Add all" creates 3 items.
3. **Token hardening:** a request with a guessed `id` but wrong/no `secret` is rejected
   (`401`/empty result) by RLS + Edge Function.
4. **Migration:** existing space backfill succeeds; app re-provisions token on next load
   without data loss (items keyed by space id remain).
5. **Failure honesty:** disabling the NVIDIA key causes a visible "AI unavailable" notice,
   not a silent heuristic save.

## Files touched (planned)

- `supabase/functions/parse/index.ts` — new model, secret validation, array output.
- `supabase/functions/polish/index.ts` (new) or extend `parse` — paragraph → items[].
- `supabase/migrations/0002_harden_tokens.sql` (new).
- `src/store.ts` — 128-bit token gen, id.secret split.
- `src/supabase.ts` — send `id.secret`, route polish, secret-aware client.
- `src/ui/input.ts` — dictation mode UI, grouped review, honest failure.
- `src/types.ts` — `ParsedItem[]` / draft types.
- `src/speech.ts` — continuous/longer capture for dictation.
