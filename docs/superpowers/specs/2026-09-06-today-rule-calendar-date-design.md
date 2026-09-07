# 2026-09-06 — Today rule is calendar-date based

## Problem

`colorFor` uses hours-only logic: items with `hours < 0` get `pastDueColor`,
items in the next 24 hours get the Today rule, items in the next 168 hours
get the This week rule. This means an item due at 04:14 PM on today's
calendar date, but where the clock has already passed 04:14 PM, renders
**red (past-due)** — even though the user mentally groups it under the
"Today" header in the Schedule view, where they expect orange.

The user's report: items in the Today group look the same color as items
past their due time. Root cause: the Today bucket is hours-relative, not
date-relative.

## Files touched

- `src/settings.ts` — update `colorFor` so today's date always wins the
  Today color, regardless of whether the specific clock time has passed.

No HTML, CSS, or migration changes needed.

## Behavior spec

`colorFor` rewritten so:

1. If the item's calendar date is **strictly before today** (yesterday or
   earlier) → return `s.pastDueColor` (red).
2. Else (today or future), fall through to the existing rule ladder:
   - Hours-based: `hours <= withinHours` for each rule in ascending
     `withinHours` order; first match wins.
   - If no rule matches → `FAR_FUTURE_COLOR`.

This means:

- Sat 07:00 PM (yesterday) → red. ✓
- Sun 04:14 PM (today, past time) → orange (Today rule at 24h, `hours <= 24`). ✓
- Sun 11:00 PM (today, future) → orange. ✓
- Mon 09:00 AM (tomorrow) → orange (Today 24h rule). ✓
- Tue 09:00 AM (2 days out) → green (ThisWeek 168h rule). ✓
- Sun next week 09:00 AM (8 days) → `FAR_FUTURE_COLOR`. ✓

## Code change

Replace `colorFor` in `src/settings.ts`:

```ts
// Returns the hex color for an item due at `iso`, or null if no rule matches.
//
// Past-date items (yesterday or earlier by calendar date) always get
// `settings.pastDueColor`. Items with today's calendar date — even if their
// specific clock time has already passed — get the Today rule, matching the
// user's mental model that "Today group = Today color." Future items fall
// through to the hours-based rule ladder; items beyond all rules return
// FAR_FUTURE_COLOR.
export function colorFor(iso: string | null): string | null {
  if (!iso) return null;
  const due = new Date(iso);
  if (isNaN(due.getTime())) return null;
  const now = new Date();
  const dueMs = due.getTime();
  const nowMs = now.getTime();
  const isSameDay =
    due.getFullYear() === now.getFullYear() &&
    due.getMonth() === now.getMonth() &&
    due.getDate() === now.getDate();
  if (!isSameDay && dueMs < nowMs) {
    return getSettings().pastDueColor;
  }
  const hours = (dueMs - nowMs) / 3.6e6;
  const s = getSettings();
  const sorted = [...s.colorRules].sort((a, b) => a.withinHours - b.withinHours);
  for (const r of sorted) {
    if (hours <= r.withinHours) return r.color;
  }
  return FAR_FUTURE_COLOR;
}
```

## Edge cases

- **Midnight boundary.** Item due Sun 11:59 PM (today, 3 hours future) →
  orange. Item due Mon 12:00 AM (tomorrow, 3 hours future) → orange via
  Today 24h rule. Both orange, distinct buckets. ✓
- **Time zones.** Uses local time for the date check and local time for the
  hours calculation. Consistent. ✓
- **Empty rules list.** Future items past 24h fall through to
  `FAR_FUTURE_COLOR`; today's items still get Today rule at default 24h. ✓
- **Item with no `datetime` or `reminder`.** `colorFor` returns `null`; no
  accent border. Unchanged.
- **Past-due color picker.** Still drives past-date items. Unchanged.
- **Today rule's `withinHours` value.** Still user-configurable. Default 24.
  Today items (by date) within 24h get orange; today items past 24h — there
  are no such items because today's items are at most ~24h ago or in the
  future, so all fall within the Today rule. ✓

## Testing

### Manual

1. Item at Sun 04:14 PM (today, past time) → orange accent.
2. Item at Sun 11:00 PM (today, future) → orange accent.
3. Item at Sat 07:00 PM (yesterday) → red accent.
4. Item at Mon 09:00 AM (tomorrow, future) → orange (Today 24h rule).
5. Item at Tue 09:00 AM (2 days out) → green (ThisWeek 168h rule).
6. Item at Sun next week 09:00 AM (8 days) → `FAR_FUTURE_COLOR`.

### Unit tests

Extend `tests/unit/color-rules.test.ts` (or create `tests/unit/color-for.test.ts`):

```ts
import { describe, expect, test } from "vitest";
import { colorFor } from "../../src/settings";

describe("colorFor (date-aware)", () => {
  test("yesterday's items get pastDueColor", () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(19, 0, 0, 0);
    // Default settings: pastDueColor = "#b4452f"
    expect(colorFor(yesterday.toISOString())).toBe("#b4452f");
  });

  test("earlier-today items get Today color even though hours < 0", () => {
    const earlier = new Date();
    earlier.setHours(4, 14, 0, 0); // 4:14 AM today
    // Now is later (e.g. 9 PM); hours is negative but it's still today.
    // Default settings: Today rule color = "#d28c2a"
    expect(colorFor(earlier.toISOString())).toBe("#d28c2a");
  });

  test("future-today items get Today color", () => {
    const later = new Date();
    later.setHours(23, 0, 0, 0); // 11 PM today
    expect(colorFor(later.toISOString())).toBe("#d28c2a");
  });

  test("null iso returns null", () => {
    expect(colorFor(null)).toBe(null);
  });
});
```

### Regression

- 125 existing tests still pass.
- The 4 `cleanColorRules` tests still pass.

## Out of scope

- Changing the user-facing labels "Today" / "This week" (cosmetic).
- Adding a "Past date" toggle for `pastDueColor` (already exists).
- A past-date-by-N-days tier (YAGNI; `pastDueColor` is monolithic).
