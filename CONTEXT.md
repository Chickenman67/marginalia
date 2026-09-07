# CONTEXT.md — ScheduleApp

Glossary only. No implementation details.

## Account (user)

Every user signs in with Supabase Auth (email/password, Google, or GitHub) — no shared tokens. Data is private to that account: RLS policies scope every row to `auth.uid()`. A `profiles` row is auto-created on sign-up and holds display info plus preferences (color rules, time format, auto-delete, provider).

## Item

A single task/schedule entry created from voice or text. One table with a `kind`:

- **todo** — no time attached; binary status (pending/done); never overdue.
- **event** — has a datetime; can be a point-in-time or all-day.

Fields common to both: `title`, `status`, `created_at`, optionally `reminder`.

## ScheduleItem (event)

An `event` item. Has `datetime` (ISO 8601, local-aware). `all_day` boolean: when true, only a date is stored, no time-of-day. Past events render as "past" (greyed), not deleted.

## Reminder

A notification trigger. By default an `event` reminds at its start `datetime` (`reminder` = event time). `reminder` is nullable to mean "no reminder." v1 surfaces reminders via an in-app due/overdue list; web push is a later concern.

## Recurrence

Out of scope for v1 — every item is single-occurrence. Revisiting repeats is a future ticket.

## LLM parsing

Natural-language input ("call mom tomorrow after lunch") is converted to an Item by a free-tier LLM. **NVIDIA is the default parser**, reached through a server-side proxy that holds David's key (browser can't call NVIDIA directly — no CORS). Gemini/Groq are user-selectable fallbacks when a user supplies their own key.

## Sync

Cross-device consistency via a dedicated free backend (Supabase). Each item belongs to the signed-in user (`user_id`); RLS is keyed on `auth.uid()`, with realtime streaming that user's rows.

## Export / Import

Backup in readable formats. The schedule and todos export as either CSV (`kind,title,datetime,all_day,reminder,status,created_at`) or a human-readable text list; the same file re-imports, with the user choosing **Merge** (append) or **Replace** (clear then load). Works in demo (localStorage) and synced (Supabase) modes.