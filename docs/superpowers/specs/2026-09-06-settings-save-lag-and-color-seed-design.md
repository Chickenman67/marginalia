# 2026-09-06 — Settings save lag + default color-rules re-seed

## Problem

Two related bugs on the Settings page (`src/ui/header.ts`):

1. **Save is laggy.** Clicking "Save" waits for an awaited `updateSettings(...)`
   (which itself awaits a Supabase profile write) and an awaited
   `enableNotifications()` (which may show a browser permission prompt)
   before the modal closes. The user sees the UI sit for a network round-trip.

2. **Default color rules re-seed every time the modal opens with zero rules.**
   `openSettings()` checks `s.colorRules.length === 0` and silently plants the
   three defaults. A user who opens settings, deletes all the defaults, and
   saves finds them back the next time they open the modal. They can't have
   "no rules" once they've seen the defaults — escape requires adding a custom
   rule first.

## Files touched

- `src/ui/header.ts` — restructure the Save handler; gate the seed behind a
  per-session flag.

No changes to `settings.ts`, `supabase.ts`, CSS, or HTML.

## Behavior spec

### Save flow

1. The Save click handler builds a snapshot of the form values into a local
   object (same fields as today, same clamps).
2. localStorage writes for `llmKey` and `provider` happen synchronously, as
   today.
3. The modal closes (`back.classList.remove("show")`) **before any await**.
4. An async IIFE fires the rest:
   - `await updateSettings(snapshot)` — this updates the in-memory cache and
     notifies listeners synchronously (inside `updateSettings`), then awaits
     the Supabase write.
   - If `setNotify.checked` is true: `await enableNotifications()`.
   - Else: `updateSettings({ browserNotifications: false })` (fire and forget
     — there's no async work in this branch).
5. Both async calls are wrapped in `try/catch` that logs to `console.error`.
   No toast UI; failures don't crash the app, and the in-memory cache stays
   updated so the UI works for the session.

### Color-rules seed

1. Add module-level `let colorRulesSeeded = false;` at the top of `header.ts`.
2. In `openSettings()`, replace the current `if (s.colorRules.length === 0)`
   seed block with:
   ```ts
   if (s.colorRules.length === 0 && !colorRulesSeeded) {
     const seeded = DEFAULT_COLOR_RULES;
     renderRules(seeded);
     updateSettings({ colorRules: seeded });
     colorRulesSeeded = true;
   }
   ```
3. After seeding once for the session, the flag is true forever — even if
   the user later deletes every rule. Subsequent opens of the modal show
   exactly what's in the user's profile (including empty).

## Edge cases

- **Demo mode (no Supabase).** `updateSettings` returns early after the cache
  merge (settings.ts line 70). Save flow is the same minus the network call.
- **Returning user with rules already saved.** `s.colorRules.length !== 0` →
  no seed on open. (Current behavior, unchanged.)
- **First open → user deletes all defaults → cancels → reopens.** First open
  seeds; flag becomes true. Reopen sees `length === 0 && colorRulesSeeded`,
  no seed. Empty list shown. (New behavior — fixes the bug.)
- **First open → user deletes all defaults → saves → reloads.** Persisted
  state is `[]`. Reopen shows empty, no seed. (New behavior — fixes the bug.)
- **First open → user saves with defaults → adds a rule → deletes it → saves.**
  Persisted state is `[]` after second save. Reopen shows empty, no seed.
  (New behavior — fixes the bug.)
- **Supabase write fails.** Logged to `console.error`. In-memory cache
  reflects the user's intent; on reload the saved profile is used. Same as
  today's silent failure on `updateProfile` throw.
- **Notification permission denied.** `enableNotifications` returns `false`
  and sets `browserNotifications: false`. No crash, no toast.
- **Multiple rapid Save clicks.** The modal closes on the first click, so
  subsequent clicks miss the button. No duplicate writes.

## Testing

Manual:

1. Open Settings → click Save → modal closes immediately (<50ms perceived).
2. Reopen Settings → values persisted.
3. First-time open (empty profile): three defaults appear. Save with them.
   Reopen: defaults still there.
4. Open Settings. Click ✕ on each of the 3 defaults. Save. Reopen: empty
   list, no re-seed.
5. Open Settings. Add a custom rule with `+ Add color rule`. Save. Reopen:
   custom rule persisted.
6. Demo mode (no Supabase): same flows work.

Regression: existing tests pass (no API signature changes).

## Out of scope

- Toast / snackbar UI for "Settings failed to save" — log only.
- Supabase migration to add `color_rules_seeded` column — not needed;
  per-session flag is sufficient for the bug as described.
- "Restore defaults" button on the Colors tab — YAGNI.
- Display-sorting color rules by `withinHours` ascending — cosmetic, YAGNI.
