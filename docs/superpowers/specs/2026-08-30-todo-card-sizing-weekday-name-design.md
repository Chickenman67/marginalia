# Todo card sizing, star rating visibility, schedule weekday name

**Date:** 2026-08-30
**Status:** Approved (verbal)

## Problem

Three independent UI defects surfaced together after the recent two-line todo card
layout (`fd6f7a0`):

1. **Todo cards look oversized.** A user-reported regression: todo cards render
   taller than schedule event cards, breaking the visual rhythm between the two
   views.

2. **5-star rating widget not visible on todos.** The star HTML is generated
   (`src/ui/views.ts:244`) but does not appear in the rendered todo card.

3. **Schedule events don't show the weekday.** Each event badge currently shows
   only the clock time (e.g. `9:00 AM`) or `all day`. The user wants the
   weekday name (e.g. `Mon`) inline next to the time so a date on a Monday is
   recognizable at a glance.

## Goals

- Bring todo cards into close visual parity with event cards while keeping
  their distinct identity (todo accent color, badge, no clock-time).
- Ensure the 5-star rating widget renders and is clickable on every todo card
  in both the Todo and Schedule views.
- Show weekday short name inline on every dated schedule event card.

## Non-goals

- No new view types, no new filters, no new persistence.
- No changes to the data model: weekday is derived from `datetime` at render
  time and never stored.
- No changes to the star-rating click handler (`bindStarEvents` in
  `src/ui/input.ts` is already correct).
- No changes to the bulk-delete or selection-mode flows.

## Design

### 1. Todo card sizing (compact, not exact match)

**Approach:** tighten the todo card so its outer dimensions match the event
card while preserving the todo accent color, badge, and star widget.

Edits in `src/style.css`:

- Remove the redundant `.card.todo .meta` override (lines 399) — let it
  inherit from `.card .meta` (line 85).
- Tighten `.card.todo`:
  - `padding: 12px 14px;` (was `13px 14px`)
  - `align-items: center;` (was `flex-start`)
- Reduce todo title size to match event title: `.card.todo .title { font-size: 15px; }`
  (was inherited `15.5px`).

Edits in `src/ui/views.ts`:

- `todoCardHTML` (line 231) already shares `.card` base styling; no HTML
  restructure needed beyond ensuring star rendering still fits.

### 2. 5-star rating visibility

**Diagnosis:** The `.stars` widget (`width: 22px; height: 22px;`) sits inside
`.card .meta` (a flex row with `gap: 6px 10px`). On todo cards the badge +
5 stars (~115px) plus other meta items push past available width on narrow
viewports and the trailing stars wrap to a second line, often getting clipped
by the flex `align-items: center` on the body. The recent `.card.todo`
override duplicates and re-declares `.card .meta` styles inconsistently,
which can collapse the gap.

Edits in `src/style.css`:

- Add `min-width: 0;` to `.stars` so flex children don't overflow their
  container.
- Tighten `.stars { gap: 0; }` (was `1px`) — saves ~5px.
- Reduce star size on todo cards only: `.card.todo .stars .star { width: 18px; height: 18px; }`
- Ensure the badge doesn't push stars off-row: `.card.todo .meta { gap: 6px 8px; }`
  (slightly tighter horizontal gap).

Edits in `src/ui/views.ts`:

- No HTML change — `todoCardHTML` already calls `starHTML(i.rating, i.id)`.
- Confirm `starHTML` output has no whitespace between `.star` spans that
  could inflate the flex container.

### 3. Schedule weekday name

**Approach:** add a short weekday token before the time in every dated event
card.

New helper in `src/ui/views.ts`:

```ts
export function weekdayShort(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { weekday: "short" });
}
```

Edits in `src/ui/views.ts` — `eventCardHTML` (line 251):

- Compute `wd` from `i.datetime`.
- Build the time slot:
  - Dated non-all-day: `<span class="weekday">${wd}</span> · ${clock(i.datetime)}`
  - Dated all-day: `<span class="weekday">${wd}</span> · all day`
  - Undated (defensive — shouldn't happen for events): no weekday shown.

New CSS in `src/style.css`:

```css
.weekday {
  font-weight: 600;
  color: var(--ink);
  letter-spacing: .02em;
  margin-right: 4px;
}
.weekday::after { content: " · "; color: var(--faint); margin: 0 2px; }
```

The middle-dot is rendered via CSS `::after` to keep the HTML tidy and to
inherit the existing muted color treatment.

## Architecture & isolation

- All HTML changes live in `src/ui/views.ts` (existing `eventCardHTML`,
  `todoCardHTML`, plus one new exported helper `weekdayShort`).
- All CSS changes live in `src/style.css` under the existing `.card`,
  `.card.todo`, `.stars`, and new `.weekday` rules.
- No new files, no new modules.
- No data-model changes; weekday is derived at render time.
- The star click handler (`bindStarEvents` in `src/ui/input.ts`) is
  untouched — it already targets `.stars .star` correctly.

## Data flow

1. Items are stored in the existing `Item[]` shape (`src/types.ts`).
2. `groupByDay` (views.ts:327) sorts items by day using `dayKey`.
3. `cardHTML` (views.ts:226) dispatches to `eventCardHTML` or
   `todoCardHTML` based on `i.kind`.
4. `eventCardHTML` now also calls `weekdayShort(i.datetime)` to render the
   `<span class="weekday">` token.
5. CSS handles all visual treatment; no inline styles are introduced (CSP
   stays clean).

## Error handling & edge cases

- **All-day events:** `Mon · all day` (badge "all day" stays; weekday + dot
  added before it).
- **Undated events:** no weekday shown (defensive guard).
- **Rating = 0 (unrated todos):** 5 empty stars still render — current
  behavior preserved.
- **Title overflow:** existing `.card.todo .title { text-overflow: ellipsis; }`
  continues to handle long titles.
- **Narrow viewports:** `.stars { min-width: 0; }` plus `flex-wrap: wrap` on
  `.meta` lets the badge and stars wrap cleanly without horizontal overflow.
- **Timezone:** weekday derives from `new Date(iso).getDay()` (local time),
  consistent with the existing `dayKey` helper.

## Testing

Existing tests live under `tests/`. Extend or add:

- `tests/views-weekday.spec.ts` (or extend existing card HTML test):
  - `eventCardHTML({ kind: "event", datetime: "2026-09-07T09:00:00" })`
    contains `<span class="weekday">`.
  - All-day event with `datetime` contains weekday + `all day` token.
  - Undated event has no weekday span.
- `tests/views-todo-card.spec.ts`:
  - `todoCardHTML(...)` contains a `.stars` element with 5 `.star`
    children.
  - The `.meta` row contains both `.badge.todo` and `.stars`.

No browser-level visual regression test is added in this scope (the existing
test suite is unit-level only).

## Roll-out

Single change set across `src/ui/views.ts` and `src/style.css` plus tests.
No DB migration, no Edge Function change, no deployment step beyond the
existing static-host redeploy (out of scope for this spec).