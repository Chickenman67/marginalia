# Filter & Sort Redesign + Star Ratings on Todos

Date: 2026-08-29
Status: draft (pending user review)

## Summary

Replace the always-visible filter/search bar with a single `⇅ Filter & sort` pill that expands into a per-view panel. Add a 5-star rating (with half-star increments) on todo cards. Make sort/filter behavior tailored to each view, and add a reverse-direction button on sort. Remove the pin from todos (keep on events). Replace the bulk-delete toolbar button with a dropdown.

The visual theme (cream paper, Fraunces + Inter, terracotta/green accents) is preserved exactly. No existing colors or fonts change.

## Data model

### Migration `supabase/migrations/0002_rating.sql`

```sql
ALTER TABLE items ADD COLUMN rating REAL NOT NULL DEFAULT 0;
```

- One new column, `rating`, REAL, NOT NULL, DEFAULT 0.
- Backwards compatible: existing rows default to 0 (no rating).
- Idempotent: do not re-add if column exists.

### `Item` type (`src/types.ts`)

```ts
export interface Item {
  // ...existing fields...
  rating: number; // 0 = no rating; otherwise one of 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5
}
```

### CSV export/import (`src/backup.ts`)

- Add `rating` to the CSV header and to the row builder.
- On import, parse `rating` as a number; reject values outside `[0, 5]` or with non-0.5 increments (clamp to nearest valid 0.5).

## UI components

### A. Star widget (todo cards only)

- 5 stars at ~28px, gap 1px, rendered to the right of the `todo` badge on the card's meta row.
- Each star is one `<svg viewBox="0 0 24 24">` element. Internal structure for a half-star:
  1. `<use href="#starShape" fill="#fff8d6" stroke="none">` (cream base)
  2. `<rect x="0" y="0" width="12" height="24" fill="#f5c518" clip-path="polygon(...)">` (yellow paint, exactly 50% of the star's silhouette)
  3. `<use href="#starShape" fill="none" stroke="#3a2e10" stroke-width="1.4" stroke-linejoin="round">` (dark outline traces the full star)
- `#starShape` is a single `<symbol>` defined once at the top of `<body>` containing the star polygon.
- Click zones per star: left half (`x < 12`) → set half (e.g. 2.5); right half → set whole (e.g. 3).
- Click the same zone you used to set the value → clear to 0.
- Shift-click any star → clear to 0 regardless of zone.
- Hover shows a preview of the value the click would set; preview never persists.
- In selection mode, star click is a no-op (selection checkbox has priority).
- Stars only render on `kind === "todo"` cards. On event cards, no star widget is shown.

Color tokens (added to `:root` in `src/style.css`):
```css
--star-fill: #f5c518;
--star-empty: #fff8d6;
--star-stroke: #3a2e10;
```

### B. Filter pill + panel (every view)

- One pill, top-right of each view, replacing the current `.list-controls` row.
- Pill text: `⇅ Filter & sort`. Pill uses the same border-radius and border style as `.space-chip` (already in CSS).
- Click pill → expand a panel below it. Click pill again, click outside the panel, or press Esc → collapse.
- When any non-default filter or sort is active, a small dot appears on the pill (similar to the existing `.dot` in `.space-chip`).
- Panel structure (top to bottom):
  1. **Search input** (full width, 1 line): placeholder "Search titles…".
  2. **Filter chip rows** — different per view (see Section C).
  3. **Sort row** (bottom, separated by a thin top border): `<select>` of sort modes + a `↑↓` reverse-direction button.

### C. Per-view filter sets

Each view has its own filter chips. The chip row is hidden if the view would only have one option (e.g. a view with no filters beyond search).

| View     | Filter row                              | Default            |
|----------|-----------------------------------------|--------------------|
| Schedule | Time range (All / Today / This week / This month) + Status (All / Pending / Done) | Time range: All time, Status: All |
| Todos    | Priority (All / ★1+ / ★2+ / ★3+ / ★4+ / ★5 only) + Status (All / Pending / Done) | Priority: All, Status: All |
| Due      | Time range (Overdue / Due now / Due today) + Kind (Events / Todos) | Time range: Due now, Kind: All |

- **Schedule** has no time-of-day filter (an all-day event would have no time-of-day to filter on).
- **Due** has no status filter (only not-done items appear in the Due view by definition — `dueItems()` already filters them out).
- **Todos** has no "Has rating" toggle; selecting `★1+` (or higher) is the equivalent.
- **Time range semantics (Schedule):** `today` = events whose `datetime` (local) falls within the user's current calendar day, midnight to midnight. `week` = events in the current ISO week (Monday–Sunday in user's locale) containing today, inclusive. `month` = events in the current calendar month, inclusive. Events with no `datetime` are excluded from time-range filters; they only appear if `timeRange === "all"`.

Chip styling matches the existing `.btn.ghost` chip aesthetic (rounded full, paper background, line border). Active chip is `--ink` background with `--paper` text.

### D. Per-view sort

All views have the same sort controls: a `<select>` of sort modes + a `↑↓` reverse-direction button. The button flips the current sort between ascending and descending.

| View     | Sort modes (in dropdown)                                | Default       | Direction options |
|----------|---------------------------------------------------------|---------------|--------------------|
| Schedule | By date ↑, By date ↓, By title A→Z, By title Z→A, Manual | By date       | ascending ↔ descending |
| Todos    | By priority ★5→★0, By priority ★0→★5, By date created ↑, By date created ↓, By title A→Z, By title Z→A, Manual | By priority   | reverse button toggles direction |
| Due      | By date ↑, By date ↓, By title A→Z, By title Z→A        | By date       | ascending ↔ descending |

- Direction "asc" / "desc" is stored as `dir: "asc" | "desc"`.
- "Manual" sort is unaffected by direction (it's always manual).
- "By priority" is naturally desc-first (highest stars at top); the reverse button flips it to "lowest first" for the user who wants the inverse.
- The `↑↓` button is a square 34px button with `aria-label="Reverse sort direction"`.

### E. Bulk delete dropdown

Replace the current "Delete selected" / "Cancel" toolbar with:

- "N selected" + Cancel button (unchanged).
- `Delete selected (N) ▾` button — when clicked, opens a small popover directly below the button:
  - `Delete N items` (terracotta text, primary action)
  - `Cancel` (muted text, secondary)
- No `window.confirm`. Clicking "Delete N items" deletes; clicking Cancel or outside closes the popover.
- Behavior on a single card: the existing per-card `🗑` button is unchanged (one-click delete, no dropdown).

### F. Pin removed from todos

- `cardHTML` gains a `showPin` flag (default true). The `mountViews` call passes `showPin: i.kind === "event"`.
- The 📍 pin button is no longer rendered on todo cards. The existing `bindCardEvents` handler for `.pin-btn` is unchanged but now only finds buttons inside event cards.

## State

`viewState` becomes a per-view object kept in the `mountViews` closure. The shape:

```ts
type ScheduleViewState = {
  search: string;
  filters: {
    timeRange: "all" | "today" | "week" | "month";
    status: "all" | "pending" | "done";
  };
  sort: "date" | "title" | "manual";
  dir: "asc" | "desc";
};

type TodosViewState = {
  search: string;
  filters: {
    priority: "all" | "1" | "2" | "3" | "4" | "5";
    status: "all" | "pending" | "done";
  };
  sort: "priority" | "date" | "title" | "manual";
  dir: "asc" | "desc";
};

type DueViewState = {
  search: string;
  filters: {
    dueWindow: "overdue" | "now" | "today";
    kind: "all" | "event" | "todo";
  };
  sort: "date" | "title";
  dir: "asc" | "desc";
};
```

- Three instances: `viewStateSchedule`, `viewStateTodos`, `viewStateDue` (one each).
- Defaults:
  - Schedule: `{ search: "", filters: { timeRange: "all", status: "all" }, sort: "date", dir: "asc" }`
  - Todos: `{ search: "", filters: { priority: "all", status: "all" }, sort: "priority", dir: "desc" }`
  - Due: `{ search: "", filters: { dueWindow: "now", kind: "all" }, sort: "date", dir: "asc" }`
- `applyView(items, viewState, kindFilter?)` in `src/ui/views.ts` is extended. Existing call sites pass the relevant viewState. The function:
  1. Applies the per-view filters (each filter is a single expression; no filter row in a view = the field is `undefined` and is skipped).
  2. Applies `search` (case-insensitive `title.includes`).
  3. Sorts by `sort` comparator, then flips sign if `dir === "desc"` and the sort is not "manual".

- No localStorage persistence. View state resets when the user switches tabs or reloads. (Could be added later; out of scope for this change.)

## Files touched

| File                                | Change                                                                       |
|-------------------------------------|------------------------------------------------------------------------------|
| `supabase/migrations/0002_rating.sql` | NEW. `ALTER TABLE items ADD COLUMN rating REAL NOT NULL DEFAULT 0;`        |
| `src/types.ts`                      | Add `rating: number` to `Item`.                                              |
| `src/store.ts`                      | `addItem` writes `rating: 0`. Subscribe path includes the new field.         |
| `src/backup.ts`                     | CSV export header + row gain `rating`. Import parses and validates it.       |
| `src/ui/views.ts`                   | New `starHTML()`, extended `applyView()`, `cardHTML` gains `showPin`.        |
| `src/ui/input.ts`                   | New filter pill + panel; rewritten `mountViews`; new `bindStarEvents`.      |
| `src/style.css`                     | New tokens (`--star-fill`, `--star-empty`, `--star-stroke`); styles for pill, panel, chips, reverse button, stars, bulk-delete dropdown, dot badge. |

`index.html` is not modified (controls are injected by TS).

## Error handling

- If the migration is not yet applied, items still load (the new field defaults to 0 client-side). `updateItem` for rating will fail server-side; the UI rolls back the star visually and shows a one-line notice in the dock: "Couldn't save rating — try again." The notice disappears after 4s (same pattern as the existing `showNotice`).
- The LLM parser never sets `rating`; only the manual star widget does.
- Star click is a no-op when the card is in selection mode (the selection checkbox is the only click target in that mode).

## Testing

### Unit tests (vitest, `tests/`)

For `applyView`:

- `priority` sort: items in order [0, 2, 5, 3.5, 1] sort to [5, 3.5, 2, 1, 0] desc, [0, 1, 2, 3.5, 5] asc.
- Direction flip: same comparator, `dir: "desc"` reverses `dir: "asc"` result.
- Filter by `priority: "1"` returns only items with `rating >= 1`.
- Filter by `timeRange: "today"` for Schedule returns only events whose `datetime` falls in today (local time).
- Search ignores case and matches partial substrings of `title`.

For the star helper:

- `starHTML(0)` renders 5 empty stars.
- `starHTML(2.5)` renders 2 full + 1 half + 2 empty.
- `starHTML(5)` renders 5 full.
- Click zone detection: click at `x = 5` of a 28px star → half; click at `x = 20` → whole.

### Manual verification checklist (in the spec only)

For each of 9 combinations (3 views × {date asc, date desc, manual if applicable}):

- Seed a space with 5+ items spanning today/tomorrow, 0/half/full ratings, mixed done/pending, mixed event/todo.
- Confirm the rendered order matches the comparator.

Star widget checklist:

- Click left half of star 3 when rating is 0 → rating becomes 2.5.
- Click right half of star 3 when rating is 2.5 → rating becomes 3.
- Click left half of star 3 when rating is 2.5 → rating becomes 0 (clear).
- Shift-click any star → rating becomes 0.
- All 11 distinct values (0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5) render correctly when set.

No E2E tests are added; the project does not have an E2E test layer today.

## Out of scope

- Recurring items.
- Reminders surface for todo items with no datetime.
- Web push notifications.
- Persistence of view state across reloads.
- Editing star rating from the dictate/draft flow.
- Custom star colors per priority level.
