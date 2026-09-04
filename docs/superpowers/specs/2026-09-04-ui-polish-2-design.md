# UI polish pass 2 — 2026-09-04

Five small fixes bundled together because they all came out of the same screenshot review.

## 1. Hide the phantom tab scrollbar

**Where:** `src/style.css:53`

`.tabs` has `overflow-x: auto` unconditional, so even when the three tab labels comfortably fit at desktop width the browser still allocates a scrollbar gutter on the right edge. The user sees a tiny vertical scrollbar that does nothing.

**Change:** default to `overflow-x: hidden`; only allow horizontal scroll when the row genuinely overflows. We can't easily detect overflow with pure CSS, so we go with the conservative rule: hide scrollbars at all sizes via `scrollbar-width: none` and `::-webkit-scrollbar { display: none }`, matching the existing `.wheel` pattern at `src/style.css:275`. The row is a fixed three-button list — it never needs to scroll.

**Result:** no scrollbar, no visual artifact.

## 2. Bigger todo titles and stars

**Where:** `src/style.css:336-341, 413-418`

Today: todo card title is 14px, card padding is 8/12, star widget is 15×15px. The user said the rows feel cramped, especially on desktop where there's 1100px of room.

**Change:**

| Property | Before | After (desktop) | After (<520px) |
|---|---|---|---|
| `.card.todo .title` font-size | 14px | 16px | 15px |
| `.card.todo .stars .star` size | 15×15 | 20×20 | 18×18 |
| `.card.todo` padding | 8px 12px | 12px 16px | 10px 12px |
| `.card.todo` gap (between checkbox, body, stars, del) | 13px | 14px | 12px |

The star widget itself doesn't need code changes — `starHTML()` in `src/ui/views.ts:19` is purely markup, sizing is CSS. We just bump the CSS.

Why: desktop has 1100px of width to spread; mobile keeps its tighter density.

## 3. Due tab default + user-tunable thresholds

**Where:** `src/ui/input.ts:252` (default state), `src/ui/views.ts:171-179` (filter logic), `src/ui/filterPanel.ts:43-45` (filter chips), `src/settings.ts:45-54` (defaults)

**Problem:** the Due tab's default filter is `dueWindow: "now"`, which matches only items whose reminder fires within ±5 minutes. Right after opening the app, almost nothing qualifies, so the user sees the empty state and concludes the tab is broken.

**User intent:** "show me what's coming up", with a way to set how far ahead and whether to include overdue.

**Change:**

- **Default state** becomes `dueWindow: "week"` (a new option that means "now through 7 days from now, plus anything overdue").
- **Two new settings** under Settings → General:
  - `dueIncludeOverdue` (boolean, default `true`) — whether to include items past their datetime/reminder time.
  - `dueDaysAhead` (number, default `7`, range 1–365) — how many days forward the "week" window covers.
- **Filter panel** in the Due view keeps the existing chips and adds two more:
  - **Overdue** — selects the overdue-only filter.
  - **Now** — existing, ±5 minutes.
  - **Today** — existing, today only.
  - **This week** — selects the new "week" filter (uses `dueDaysAhead`).
- **`applyViewV2`** gets a new branch for `dueWindow === "week"`:
  ```
  if f.dueWindow === "week":
    - include if (r >= now && r <= now + daysAhead * 86_400_000)
    - additionally include if (overdue && r < now)
  ```
  The `dueIncludeOverdue` and `dueDaysAhead` values are read from `getSettings()` at render time, not stored in the in-memory `dueState`.
- **`defaults()` in `src/settings.ts`** adds the two new fields with sensible values.
- **`openSettings()` in `src/ui/header.ts`** populates the two new inputs.

**Schema migration:** the `profiles` table column for settings is JSONB (verified earlier — the entire `Settings` object is stored as one blob). New fields are added with defaults at read time via `defaults()`, so no DB migration is required.

## 4. Color rules: three seed defaults, no duplicates

**Where:** `src/ui/header.ts:81-151`, `src/settings.ts:45-54, 100`

**Problem:** when the user opens the Colors tab, the list is empty. They click "+ Add color rule" and it adds one row with the hard-coded `FAR_FUTURE_COLOR = "#3f7d6e"` (green). Hit it a few times, all the rows are green. Confusing.

**User intent:** ship with a sensible starter set, and when they explicitly Add a new rule, give it a color that isn't already in the list.

**Change:**

- **Seed defaults** the first time the user opens the Colors tab AND `colorRules.length === 0` AND a Supabase session is active. The three rules:

  | Label | Color | withinHours |
  |---|---|---|
  | Overdue | `#b4452f` (red) | 0 (matches "any time in the past") |
  | Today | `#d28c2a` (amber) | 24 |
  | This week | `#3f7d6e` (green) | 168 |

  Seeded via `updateSettings({ colorRules: DEFAULT_COLOR_RULES })` — a one-shot at first open, never again. If the user has already saved custom rules, those are preserved.

- **Add handler** (`src/ui/header.ts:142-151`) now picks the new rule's color from a rotation that **excludes colors already in the current list**:
  1. Read existing rules' colors.
  2. From the palette `[#b4452f, #d28c2a, #3f7d6e, #6c63ff, #c64a8e, #4a8ec6]`, pick the first one not already used; if all are used, fall back to the first palette entry.
  3. The new rule's `withinHours` defaults to 72 (unchanged), and the label still starts as "New rule".

- **`colorFor()`** in `src/settings.ts:115-129` is unchanged. The seed values are written through it on the very next render, so the rules take effect immediately.

**No DB migration:** `color_rules` is a JSONB column.

## 5. Settings modal dismiss on backdrop click + Escape

**Where:** `src/ui/header.ts:61-140`, `index.html:89-138`

**Problem:** the only ways to close Settings today are the "Close" button and the "Save" button. Users expect backdrop click and Escape to also work.

**Change:**

- **Backdrop click** — extend the existing keydown listener or add a new click handler on `#settingsModal` (the `.back` element). Close only when `e.target === back` (not when clicking inside the modal panel). Scoped to `#settingsModal`, not all `.back` elements, so the date/time picker popover (which also uses `.back`-like positioning but is a separate DOM tree) is unaffected.
- **Escape key** — extend the existing keydown listener in `header.ts:44-50` to also close the settings modal when `Escape` is pressed and the modal is showing. Order matters: the existing user-menu Escape handler should run first; we only close settings if no other handler caught the event. The current handler structure is a single `addEventListener` — we add a second `if` branch after the user-menu one.
- **Both behave like Close** — no save, no toast. Matches the user's "I changed my mind" expectation.

**No markup changes needed** — `#settingsModal` already exists in `index.html` as a `<div class="back" id="settingsModal">` wrapper.

## Testing plan

1. **Tabs scrollbar:** load app at 1280×900 and 390×844; assert no scrollbar visible in the `.tabs` row. Vitest visual regression or manual screenshot diff.
2. **Todo sizes:** add a few todo items with different star ratings; measure `.card.todo .title` font-size and `.card.todo .stars .star` width at desktop and mobile breakpoints via Playwright.
3. **Due tab:** new `tests/unit/due-filter.test.ts` covers the `applyViewV2` "week" branch:
   - item with reminder 3 days out appears in default config
   - item with reminder 8 days out is hidden at default `dueDaysAhead = 7`
   - item with reminder 10 days out appears when `dueDaysAhead = 14`
   - overdue item (1h in the past) appears by default
   - overdue item is hidden when `dueIncludeOverdue = false`
   - selecting "Now" or "Today" chip still works as before
4. **Color rules:** new `tests/unit/color-rules.test.ts` covers:
   - `DEFAULT_COLOR_RULES` constant has exactly three entries with the specified labels/colors/hours
   - color-rotation helper `nextColorForNewRule(existingColors)` returns the first palette color not in the list
   - when all palette colors are taken, falls back to the first palette entry
   - on a fresh session the seed runs once; reopening does not re-seed
   - existing user rules are never overwritten
5. **Settings dismiss:** open settings, click backdrop → modal closes. Open settings, press Escape → modal closes. Open settings, change a field, click backdrop → modal closes, change discarded. Open settings, change a field, press Save → change saved.

## Out of scope

- Settings page redesign.
- Color picker upgrade (still native `<input type="color">`).
- A "Reset to defaults" button for color rules.
- Bulk delete UI for color rules (existing per-row ✕ is enough).
- Drag-reorder for color rules.

## Files touched

- `src/style.css` (sections 1, 2, and 5 minor)
- `src/ui/input.ts` (section 3 — default `dueState` and any helper that reads settings)
- `src/ui/views.ts` (section 3 — new `dueWindow === "week"` branch in `applyViewV2`)
- `src/ui/filterPanel.ts` (section 3 — new chip definitions for the Due panel)
- `src/ui/header.ts` (sections 4 and 5 — seed logic, Add-handler color rotation, backdrop click + Escape)
- `src/settings.ts` (sections 3 and 4 — `defaults()` adds new fields, new `DEFAULT_COLOR_RULES` constant)
- `index.html` (section 3 — two new inputs in the General settings panel)
- `tests/unit/header-user-menu.test.ts` (section 5 — backdrop click and Escape tests)
- New `tests/unit/due-filter.test.ts` (section 3)
- New `tests/unit/color-rules.test.ts` (section 4)
