# CONTEXT.md — ScheduleApp

Glossary only. No implementation details.

## Space

An isolated data partition. Identified by a secret **space token** (random string); no user accounts. Anyone opening the app gets or creates a space. David's personal space is one such token. A space has a `last_active_at` timestamp used for idle expiry (guest spaces expire after a short window; David's space is exempt/long-lived).

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

Cross-device consistency via a dedicated free backend (Supabase), data partitioned by `space_token` (RLS keyed on token, not auth). Realtime updates without login.

## Export / Import

Per-space JSON backup: download a space's items as a file; import restores them. Also the manual cross-device fallback.
