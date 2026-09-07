# 2026-09-06 — Past-due color is separate from future rules

## Problem

The default Color Rules list includes an "Overdue" rule with `withinHours: 0`.
On Save, `readRules()` in `src/ui/header.ts` runs

```ts
withinHours: Math.max(1, Number(...) || 24)
```

The `|| 24` fallback fires whenever the value parses to `0`. So every time the
user opens Settings and clicks Save without touching the rules, the Overdue
rule's `withinHours` is silently rewritten from `0` to `24`. The user sees the
**background schedule colors change** because now Overdue and Today are both
`24`-hrs, and `colorFor` finds the first sorted rule (`24` first by tiebreak
order) and applies the Today orange to everything within 24h — including
overdue items.

The `<input type="number" min="1">` clamp on the UI also prevents the user
from manually typing `0`, so they can't fix it through the modal either.

## Files touched

- `src/settings.ts` — add `pastDueColor`; drop Overdue from defaults;
  rewrite `colorFor`.
- `src/supabase.ts` — add `past_due_color` to `Profile` interface.
- `src/ui/header.ts` — bind the Past-due picker; persist on Save.
- `index.html` — add Past-due color row above `#colorRules`.
- `supabase/migrations/0002_past_due_color.sql` — new migration adding the
  `past_due_color` column to `profiles`.

## Behavior spec

### Settings model

`Settings` gains one field:

```ts
interface Settings {
  // ...existing fields...
  pastDueColor: string;   // hex like "#b4452f"
}
```

Defaults: `pastDueColor: "#b4452f"` (matches today's Overdue rule).

`colorFor(iso)` becomes:

```
hours = (iso - now) / 3.6e6
if hours < 0  → return s.pastDueColor
else          → sort future rules asc by withinHours, first match wins,
                 else FAR_FUTURE_COLOR
```

The "for past items, find the largest window we've already crossed" branch is
removed — past items always get `pastDueColor`, full stop.

### Default rule set

```ts
export const DEFAULT_COLOR_RULES: ColorRule[] = [
  { id: "r-today",    label: "Today",     color: "#d28c2a", withinHours: 24 },
  { id: "r-thisweek", label: "This week", color: "#3f7d6e", withinHours: 168 }
];
```

The Overdue rule is gone.

### UI

`index.html` Colors tab gets a Past-due row above `#colorRules`:

```html
<div class="past-due-row">
  <label for="pastDueColor">Past due color</label>
  <input type="color" id="pastDueColor" />
</div>
```

`src/ui/header.ts` `openSettings()` populates `pastDueColor.value` from
`s.pastDueColor`. The Save handler's `snapshot` includes
`pastDueColor: pastDueColor.value`. `updateSettings()` column map gets
`pastDueColor → "past_due_color"`. The snapshot's `colorRules` field is
the result of `readRules().filter((r) => r.withinHours > 0)` so a stale
`0`-hrs Overdue rule in the saved profile gets swept away on the next
Save.

### readRules cleanup

The `withinHours` clamp is simplified. Since 0 is no longer a valid future
value (Overdue is gone), keep `Math.max(1, Number(...) || 24)` — this is
identical to today's behavior for any value > 0, and prevents the user from
ever saving a `0` future rule (which would be meaningless).

Additionally, `readRules` filters out any rule with `withinHours <= 0`
before returning. Past-due coloring lives in `pastDueColor` now; a `0`-hrs
rule in the list is meaningless and would corrupt sort order. This also
sweeps away the stale Overdue rule from any existing user profile on their
next Save.

### Migration

`supabase/migrations/0002_past_due_color.sql`:

```sql
alter table profiles add column if not exists past_due_color text;
```

Existing rows get `NULL`. `loadSettings` treats `NULL` as the default
(`#b4452f`), so existing users see the same red on their overdue items.

## Edge cases

- **Existing users with a saved `0`-hrs Overdue rule.** On next Save, that
  rule gets `withinHours` clamped to `24` by `Math.max(1, Number(...) || 24)`
  (because `0 || 24 === 24`). That silently creates a duplicate of the Today
  rule and shifts colors for users who previously had the Overdue rule
  pinned. **Mitigation:** in the Save handler's snapshot, filter out any
  rule whose `withinHours` is `<= 0` (a `0` rule has no meaning under the
  new semantics — past items go to `pastDueColor`, not a rule). This
  one-time cleanup removes the stale Overdue rule for existing users
  without disrupting fresh users (whose seeded defaults are already
  `> 0`).
- **Past-due color picker default.** `#b4452f` matches today's Overdue rule
  visually — existing users see no change in overdue-item coloring.
- **Demo mode (no Supabase).** `loadSettings` falls back to `defaults()`,
  which has `pastDueColor: "#b4452f"`. `updateSettings` skips the Supabase
  write (line 70 of settings.ts) and just updates the cache. Modal closes
  immediately. Same as logged-in mode minus the network call.
- **Empty rules list.** `colorFor` returns `FAR_FUTURE_COLOR` for any future
  item when no rule matches. Unchanged.
- **Past-due picker and rules list both default-seeded.** The
  `colorRulesSeeded` flag from the previous fix still gates the rules list
  seed. The past-due picker has its own default in `defaults()`, so it shows
  `#b4452f` on first open even before any save.

## Testing

Manual:

1. Fresh profile: open Settings → Past-due picker shows `#b4452f`. Rules list
   shows Today@24 and This week@168. No Overdue rule.
2. Save without touching anything. Reopen: identical to step 1.
3. Edit Today's hrs to `12`. Save. Reopen: value is `12`. No corruption.
4. Add a custom rule. Save. Reopen: custom rule persists.
5. Past-due item on Schedule tab → reddish accent. Item due today → orange.
   Item due this week → green. Item due in 2 weeks → FAR_FUTURE_COLOR.
6. Demo mode: same flows.

Unit tests (new, in `tests/unit/colorFor.test.ts` or similar):

- `colorFor(pastIso)` returns `s.pastDueColor` regardless of `colorRules`.
- `colorFor(nearFutureIso)` matches the smallest future rule whose
  `withinHours` contains it.
- `colorFor(farFutureIso)` returns `FAR_FUTURE_COLOR` when no rule matches.

Regression: existing 118 tests still pass.

## Out of scope

- "Overdue by N days" color tiers (past-due color is monolithic).
- Disabling past-due coloring entirely (YAGNI; if a user wants no color,
  they can pick white).
- Animating color transitions.
