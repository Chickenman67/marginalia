# 2026-09-07 — Deterministic date resolution + NVIDIA test-key fix

## Problem

Three related user reports about the AI scheduling input:

1. **Bare weekday lands wrong or missing.** "I have something wednesday"
   should land on Wednesday of this week (or next week if this week's has
   already passed). The free NVIDIA models don't reliably follow the prompt's
   weekday rule, so the item can come back as a plain todo with no date, or on
   the wrong day.
2. **Time-of-day phrases become todos.** "Do this by morning" comes back as a
   todo with no time, even though the speaker stated a time-of-day. It should
   become a dated/timed item, never just a todo.
3. **NVIDIA proxy test shows "Network error: Failed to fetch".** Not normal —
   two bugs. The edge functions restrict CORS to `APP_ORIGIN`
   (`https://marginalia-6ek.pages.dev`), so localhost dev requests throw
   `Failed to fetch`. And the settings "Test key" button posts with the **anon
   key** as the bearer token, which the function rejects as `invalid token`
   (401) — plus the settings UI requires a key to be entered even though
   NVIDIA needs no key.

**Chosen approach:** a deterministic client-side date resolver as a safety net
over the LLM output (works for NVIDIA proxy **and** direct Gemini/Groq keys),
plus sharper prompts, plus fixing the NVIDIA test-key / CORS path.

## Files touched

- `src/dates.ts` (new) — pure `resolveSchedule(phrase, now?)` resolver.
- `src/types.ts` — add `allDay?: boolean` to `ParsedItem` and `DraftItem`.
- `src/supabase.ts` — apply resolver in `parsePhrase` (after both proxy and
  direct LLM calls) and in `normalizeDraft` (polish path); fix
  `testProviderKey("nvidia")` to use the real session token and skip the key
  requirement; strengthen the direct Gemini/Groq system prompts.
- `src/store.ts` — `addItem` persists `all_day` from `ParsedItem`.
- `src/ui/input.ts` — `guess()` uses the resolver; quick-add shows a
  confirm card when a time was implied (not explicit); wire the confirm flow.
- `supabase/functions/parse/index.ts` — CORS allowlist + stronger SYSTEM
  prompt.
- `supabase/functions/polish/index.ts` — same CORS + prompt changes.
- Tests under `tests/unit/`.

## Deterministic resolver — `src/dates.ts`

Pure function, testable with an injected `now`:

```ts
interface Resolved {
  kind: "event";
  datetime: string;   // ISO (local wall clock)
  allDay: boolean;
  implied: true;      // time was implied, not explicitly stated
}
function resolveSchedule(phrase: string, now?: Date): Resolved | null
```

Return `null` (caller trusts the LLM) when the phrase contains any **explicit**
signal:

- a clock time (`3pm`, `15:00`, `3:30`, `noon`, `midnight`)
- `today`, `tomorrow`
- `this week` / `next week` / `next friday` etc. (an explicit weekday scope)
- a month name + day number (`feb 10`, `january 5th`)
- a relative-duration cue (`in 5 minutes`, `in 2 hours`, `in 3 days`)

### Bare weekday (no time)

Word list: monday…sunday (+ `mon`…`sun`).

Resolve to the **nearest upcoming occurrence counting from today** (today
counts): `now + ((dow - todayDow + 7) % 7) days`. Result is an **all-day
event** (`allDay: true`), i.e. "I have something wednesday" → Wednesday of
this week when it's still ahead, next Wednesday when today is Thursday+.

### Time-of-day phrase

Word list: `morning`, `afternoon`, `evening`, `tonight`, `lunch`, `dinner`,
`noon`, `night`. Result is a **timed event** (`allDay: false`):

| phrase | default hour | day rule |
|---|---|---|
| morning | 09:00 | today if now < 12:00, else tomorrow |
| afternoon | 14:00 | today if now < 12:00, else tomorrow |
| evening | 18:00 | today if now < 18:00, else tomorrow |
| tonight | 20:00 | today if now < 20:00, else tomorrow |
| lunch | 12:00 | today if now < 12:00, else tomorrow |
| dinner | 19:00 | today if now < 19:00, else tomorrow |
| noon | 12:00 | today if now < 12:00, else tomorrow |
| night | 21:00 | today if now < 21:00, else tomorrow |

For a word not in the table, no match.

### Typed fast path — `guess()` in `src/ui/input.ts`

`guess()` runs the resolver first, so the live preview and the typed Enter
path agree with the LLM path. When the resolver returns `null` but the phrase
still contains a **weekday + clock time** ("wednesday at 3pm"), `guess()` does
a tiny local parse: put that clock time on the nearest upcoming occurrence of
that weekday (this week, else next week), timed event, `allDay: false`. Pure
clock-time phrases without a weekday keep today's behavior (event dated now)
as a preview placeholder. Everything else is a todo, as today.

### Override rule

The resolver runs **after** the LLM completes and, when it matches (the phrase
had a bare weekday or time-of-day word and **no** explicit date/time cue),
always applies its values. Because `resolveSchedule` returns `null` for any
explicit cue (clock time, today/tomorrow, next/last/this + weekday, month +
day, today+tomorrow variants), the LLM's `datetime` is effectively trusted
exactly when the user stated an explicit date or placement. Fabricated
datetimes for ambiguous phrases (e.g. an LLM dating "wednesday" to today) are
overridden. `implied: true` is used by the UI to decide whether to show the
confirm card.

## Confirm card (implied times only)

In the quick-add flow (`commit` + typed `guess` path), when the resolved
date/time came from `resolveSchedule` (a covered cue, not an explicit
date/time), adding shows a small confirm card instead of committing instantly:

- Title + resolved date via the existing **calendar** popover
  (`openCalendar`) and **time** picker (`openTimePicker`).
- **Add** commits with the (possibly adjusted) date/time and `allDay`.
- **Cancel** dismisses.

Explicit phrases ("wednesday at 3pm", "tomorrow 9am") add instantly with no
confirmation. The dictate/paragraph polish path already renders editable draft
rows before "Add all", so no confirm card there.

## CORS fix (parse + polish edge functions)

Replace the single `Access-Control-Allow-Origin: APP_ORIGIN` with a helper
that echoes the request `Origin` when it matches the allowlist, else serves
`APP_ORIGIN` (falling back to `*`):

- `APP_ORIGIN` (deployed site)
- any `http://localhost:<port>` (dev)

This unblocks localhost development without opening CORS broadly.

## NVIDIA test-key fix

- `testProviderKey("nvidia")` in `src/supabase.ts` uses the user's real
  session token (same as `parsePhrase`) instead of `config.supabaseAnon`.
- In demo mode (no `config.parseFunction`), return a clear message that the
  NVIDIA proxy isn't configured.
- `src/ui/header.ts` — the Test button only requires a key for non-NVIDIA
  providers; NVIDIA tests directly without entering a key.

## Prompt improvements (all four prompt sites)

`parse` SYSTEM, `polish` SYSTEM, and the two `sys` strings in `src/supabase.ts`
(direct Gemini/Groq) gain explicit rules:

- A bare weekday with no clock time is an **all-day event** on this week's
  occurrence of that weekday, or next week's if this week's is already past.
- Time-of-day words (`morning`, `afternoon`, `evening`, `tonight`) are
  **events with the default hour**, never todos.

The resolver enforces these client-side regardless of model behavior.

## Edge cases

- **Bare weekday = today.** "wednesday" said on a Wednesday resolves to today
  (nearest occurrence counting today). If the user means next week they say
  "next wednesday", which is an explicit cue and bypasses the resolver.
- **Weekday + time** ("wednesday 3pm") → explicit cue; LLM wins; no all-day;
  no confirm card.
- **"by morning"** → the cue word `morning` is present → timed event, 09:00,
  today-or-tomorrow. (Deadline semantics are out of scope; the item appears on
  the morning of the resolved day.)
- **Plural/no match** ("tuesday and thursday") → out of scope; resolver bails
  on ambiguity by trusting the LLM.
- **demo (localStorage) mode** → resolver still works (client-side); NVIDIA
  test shows "not configured".
- **Item `all_day` back-compat** — existing rows keep their stored value;
  only newly added items can get `all_day: true`.

## Testing

### Unit

- `resolveSchedule`: bare weekday in the past (today=Thu, "wednesday" → next
  Wed), future (today=Sun, "wednesday" → this Wed), same-day (today=Wed →
  today), all-day flag, time-of-day default hours + day rules, explicit cues
  return `null`, `guess()` uses the resolver.
- `all_day` threading: `addItem` persists `allDay`.

### Manual

1. Speak/type "I have something wednesday" → Wednesday all-day on schedule.
2. "Do this by morning" (after 12:00) → confirm card, tomorrow 09:00 event.
3. Type "wednesday at 3pm" → instant, no confirmation, timed event.
4. Settings → NVIDIA proxy → Test → passes with no key (from the deployed
   site and from localhost dev).

### Regression

- `npm run test` all existing tests still pass.

## Out of scope

- Deadline semantics for "by" phrases ("finish X by morning" → the morning it
  resolves to).
- Multi-item / recurring parsing ("every tuesday", "tuesday and thursday").
- Changing how existing rows render.
- A real timezone-picker (resolver uses the browser's local clock).