Type: grilling
Status: resolved

## Question

Decide the v1 notification/reminder strategy given real push is deferred to fog. Resolve: should v1 show an in-app "due now / overdue" list (polled on open) and/or use the one-shot browser Notification API (granted on install, fires only while tab open)? Where does the due list live in the UI? Does an item need an explicit reminder time or does every timed item auto-remind? Agree the v1 scope precisely so the build ticket is unambiguous.

## Answer

Per David: **reminders are app Settings toggles, not hardcoded.** Two toggles live in the Settings modal (`src/settings.ts` + `src/ui/header.ts`):

1. **"Remind me at each event's time"** (`autoRemindEvents`, default ON) — when on, every `event` auto-reminds at its `datetime` (reminder defaults to event time). When off, only items with an *explicit* reminder (reminder ≠ datetime) surface.
2. **"Browser notifications (while app is open)"** (`browserNotifications`, default OFF) — off until the user opts in; enabling requests `Notification.permission` and only then fires one-shot notifications for newly-due items.

**v1 surface:** the **Due tab** (already built) shows due/overdue items, recomputed live via `dueItems()` in `src/reminders.ts`. A 30s poll in `main.ts` re-evaluates due state and, if notifications are enabled + permitted, fires `Notification` for newly-due items (already-due-at-load items are seeded so they don't spam). Real web push (PWA background) stays in the map's fog.

Verified: settings toggles render and persist (`localStorage`); auto-remind OFF persists correctly; no console errors.
