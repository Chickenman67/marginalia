Type: grilling
Status: resolved

## Question

Define the domain model for the app so code and the glossary agree. Resolve the precise meaning and fields of: Space (token, owner/expiry), Task (title, status, created), ScheduleItem (start/end time, location?), Reminder (trigger time, channel), and how "timed vs todo" is decided. Also decide recurrence — is v1 strictly single-occurrence (defer repeats to fog) or do we need a basic repeat model now? Agree edge cases (overdue items, all-day vs timed, items with no time). Output a proposed `CONTEXT.md` glossary and any ADRs for hard-to-reverse choices.

## Answer

Model resolved (all decisions confirmed via grilling):

- **One `items` table** with `kind` (`todo` | `event`), not separate tables — simpler sync, maps directly to the LLM `type` field.
- **`kind` rule:** datetime present → `event`; absent → `todo`.
- **`all_day` boolean** on items: an `event` with `all_day=true` stores a date only, no time-of-day.
- **Recurrence:** single-occurrence only for v1 — no `repeat` field; recurring rules stay in the map's fog.
- **Reminders:** default `reminder` = event datetime (remind at start); nullable for "no reminder." v1 surfaces via in-app due list (ticket 06).
- **Overdue/past:** todos never overdue (pending/done only); past events render greyed, never deleted.
- **Space:** `token` + `last_active_at`; idle expiry windows (guests short, David exempt/long); no `owner` column.

Glossary written to `CONTEXT.md` (root). No ADRs needed — choices are reversible and low-cost; the only hard-to-reverse call (NVIDIA-via-proxy default, Supabase token RLS) already has its own tickets (02/10/07).

This unblocks ticket `07` (stand up Supabase schema) and `08` (space-token UX).
