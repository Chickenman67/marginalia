Type: prototype
Status: resolved

## Question

Build a rough, runnable UI mock of the voice + text input experience and the main views (input bar, schedule/timeline, todo list, due list) so David can react before the full build. Reference the architecture prototype (ticket 05). Resolve visual/interaction questions: one combined input vs separate, how parsed result is previewed before save, mobile vs desktop layout. Link the prototype as an asset.

## Answer

Built a **zero-dependency, runnable HTML mock** (no framework — lets David react before stack is locked): `prototype/ui-mock.html`. Open it directly in a browser.

What it shows:
- **Mobile-first responsive layout** (max-width 920px, sticky header, fixed bottom input dock with safe-area inset for notched phones).
- **One combined input**: mic button (Web Speech API, pulsing while listening) + text field in a single dock. A parse preview chip appears above the bar before save (`→ 📅 Dentist · Thu Aug 27 3:00 PM`).
- **Three tabs**: Schedule (events sorted by time, all-day + timed, past = greyed), Todos (pending/done with checkbox), Due (items whose reminder <= now).
- **First-run space modal** (token auto-generated or entered) + **Settings modal** for an optional fallback API key (persisted to localStorage).
- **Edge cases from ticket 04** reflected: todos never overdue; past events greyed not deleted; events default a reminder at their start time.

Decisions surfaced for ticket 05: framework-free mock was enough to react, so the real build can stay vanilla TS or adopt a framework — unresolved, take to ticket 05. The mock's module seams (parse → preview → commit → render → sync) map cleanly onto the architecture.

Asset: `prototype/ui-mock.html` (in this effort's directory).

## Revision (user feedback)

User: completing an item must NOT make it disappear, and the look felt "vibecoded." Applied the `frontend-design` skill (installed via `find-skills`, `nexu-io/open-design@frontend-design`):

- **Behavior fixes:** checkbox only *completes* (greys out, stays visible) — never deletes or removes. Schedule keeps completed/past events (greyed/dashed), it no longer drops them. **Delete control (🗑) added on every todo and due card** (and applies to events too when in the Due view); Schedule/event deletion kept conservative per map. Adding an item never removes anything else.
- **Design lift (committed to a calm editorial "paper planner" direction):** Fraunces serif display + Inter body, warm paper background, hairline borders (no gradient/glass AI-slop), terracotta (events) / sage (todos) restrained accents, day-grouped schedule with Today/Tomorrow labels, accessible focus states, visible empty states, animated preview chip, realistic space-token + settings modals.

Re-point ticket 05 to adopt this visual language as the design contract.
