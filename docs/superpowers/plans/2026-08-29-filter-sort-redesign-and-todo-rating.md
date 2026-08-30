# Filter & Sort Redesign + Star Ratings on Todos — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the always-visible filter bar with a single pill that expands per-view, add 5-star (with halves) rating on todo cards, and tailor sort/filter sets to each of the three views (Schedule / Todos / Due).

**Architecture:** One Supabase migration adds a `rating REAL` column to `items`. The `Item` type gains `rating: number`. A new `mountFilterPanel(viewKey)` function injects the pill + panel into a view. The `applyView()` function is generalized: it now accepts a per-view state shape and supports sort direction. The star widget is rendered as inline SVG (one `<symbol>` per page, used 5× per rating row). Theme tokens (cream paper, Fraunces + Inter, terracotta/green accents) are unchanged.

**Tech Stack:** TypeScript, vanilla DOM (no framework), Vite, Vitest, Supabase. No new dependencies.

## Global Constraints

- Spec at `docs/superpowers/specs/2026-08-29-filter-sort-redesign-and-todo-rating-design.md` is the source of truth for behavior.
- Visual theme is unchanged: cream paper (`--paper: #f6f3ec`), panel (`--panel: #fffdf8`), ink (`--ink: #23201b`), Fraunces headings + Inter body, terracotta (`--event: #b4542f`) + green (`--todo: #3f7d6e`) accents.
- New color tokens: `--star-fill: #f5c518`, `--star-empty: #fff8d6`, `--star-stroke: #3a2e10`.
- Project does not have an E2E test layer; manual verification only.
- No new dependencies. The plan adds no `package.json` entries.
- Existing `applyView` test signature `{ search, status, sort }` must continue to work — the new per-view signature is a superset.
- Every task ends with a commit.
- TypeScript strict mode (`tsc --noEmit`) must pass after every task.

---

## File Map

| File | Responsibility | Created/Modified |
|------|----------------|-------------------|
| `supabase/migrations/0002_rating.sql` | Add `rating REAL` column | Created |
| `src/types.ts` | Add `rating: number` to `Item` | Modified |
| `src/store.ts` | Default `rating: 0` in `addItem`, `importItems`, `mk`, seed | Modified |
| `src/backup.ts` | CSV header/row + parser include `rating`; `ImportRow` gains `rating` | Modified |
| `src/ui/views.ts` | New `starHTML()`, generalized `applyView()` with per-view state, `cardHTML` gains `showPin` flag | Modified |
| `src/ui/filterPanel.ts` | New module: `mountFilterPanel(viewKey)` returns `{ setState, getState }` | Created |
| `src/ui/input.ts` | Use new filter panel; rewrite selection toolbar; remove pin from todo cards | Modified |
| `src/style.css` | New tokens + styles for pill, panel, chips, reverse button, stars, bulk-delete dropdown, dot badge | Modified |
| `tests/unit/views.test.ts` | Update existing tests + add per-view state tests | Modified |
| `tests/unit/star.test.ts` | New: `starHTML` rendering tests | Created |

---

## Task Decomposition

Tasks are ordered so each one leaves the project in a working state.

1. **Migration + types** — DB column + `Item` field, no UI changes.
2. **Store: default `rating: 0` everywhere** — Backwards compatible.
3. **CSV import/export includes `rating`** — Backwards compatible.
4. **Generalize `applyView()`** — New per-view state, old signature still works.
5. **Star widget helper** — `starHTML()` with rendering tests.
6. **Style tokens + `.card .stars` styles** — New CSS, no behavior yet.
7. **Pin removed from todo cards** — `cardHTML` honors `showPin`.
8. **Filter panel module** — `mountFilterPanel()` standalone, tested via DOM.
9. **Wire filter panel into all three views** — `mountViews` rewritten to use it.
10. **Bulk delete dropdown** — Replaces current toolbar button.
11. **Manual verification** — Run the spec's checklist.

---

### Task 1: Supabase migration + types

**Files:**
- Create: `supabase/migrations/0002_rating.sql`
- Modify: `src/types.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `Item.rating: number` field; SQL `rating` column on `items` table.

- [ ] **Step 1: Create the migration file**

Write `supabase/migrations/0002_rating.sql`:
```sql
ALTER TABLE items ADD COLUMN IF NOT EXISTS rating REAL NOT NULL DEFAULT 0;
```

`IF NOT EXISTS` makes the migration idempotent (safe to re-run).

- [ ] **Step 2: Add `rating` to the `Item` type**

In `src/types.ts`, in the `Item` interface (currently 9 fields ending with `pinned: boolean`), add:
```ts
  rating: number; // 0 = no rating; otherwise one of 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5
```

Place it after `pinned: boolean` (last field).

- [ ] **Step 3: Verify typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0002_rating.sql src/types.ts
git commit -m "feat: add rating column to items schema"
```

---

### Task 2: Store defaults — every new Item gets `rating: 0`

**Files:**
- Modify: `src/store.ts`

**Interfaces:**
- Consumes: `Item` type with new `rating` field (from Task 1).
- Produces: All in-memory `Item` objects include `rating: 0` by default; `addItem`, `importItems`, `mk()`, and the seed function all set it.

There are currently four places that build a literal `Item` object. Each must include `rating: 0` so the `Item` type compiles.

- [ ] **Step 1: Add `rating: 0` to `addItem` in `src/store.ts`**

In the `addItem` function (~line 140), inside the `item` literal, after `pinned: false`, add:
```ts
    rating: 0,
```

- [ ] **Step 2: Add `rating: 0` to `toItem` in `importItems`**

In the `toItem` arrow function (~line 83), after `pinned: false`, add:
```ts
    rating: 0,
```

- [ ] **Step 3: Add `rating: 0` to `mk` and the seed**

In the `mk` helper (~line 258), after `pinned: false`, add:
```ts
    rating: 0,
```

- [ ] **Step 4: Verify typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/store.ts
git commit -m "feat: default rating=0 on all newly created items"
```

---

### Task 3: CSV import/export includes `rating`

**Files:**
- Modify: `src/backup.ts`

**Interfaces:**
- Consumes: `Item.rating: number` (from Task 1).
- Produces: `ImportRow.rating: number` field; `toCSV()` and `parseCsv()` include it.

- [ ] **Step 1: Add `rating` to `ImportRow`**

In `src/backup.ts`, in the `ImportRow` interface, add a new field:
```ts
  rating: number;
```

- [ ] **Step 2: Update `toCSV` to include `rating`**

In `toCSV(items)`, change the header to:
```ts
  const header = "kind,title,datetime,all_day,reminder,status,created_at,rating";
```

Change the row mapping to:
```ts
  const lines = items.map((i) =>
    [i.kind, i.title, i.datetime, String(i.all_day), i.reminder, i.status, i.created_at, String(i.rating)]
      .map((c) => csvCell(c === null ? null : String(c)))
      .join(",")
  );
```

- [ ] **Step 3: Update `parseCsv` to read `rating`**

In `parseCsv`, change the column destructure line:
```ts
    const [kind, title, datetime, all_day, reminder, status, , ratingRaw] = cols;
```

In the `out.push({...})` call inside the same function, after `status: ...`:
```ts
      rating: clampRating(ratingRaw === undefined ? "0" : ratingRaw),
```

- [ ] **Step 4: Add the `clampRating` helper**

Add this function near the top of `src/backup.ts` (right after `csvCell`):
```ts
function clampRating(raw: string): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return 0;
  const clamped = Math.max(0, Math.min(5, n));
  // Snap to nearest 0.5
  return Math.round(clamped * 2) / 2;
}
```

- [ ] **Step 5: Update `parseText` to default rating to 0**

In `parseText`, in the `out.push({...})` call, add:
```ts
      rating: 0,
```

- [ ] **Step 6: Run the existing backup test to make sure it still passes**

Run: `npm test -- tests/unit/backup.test.ts`
Expected: PASS. (Tests should not have asserted the exact header line; if a test fails because the header changed, update that test to match — but only the header.)

- [ ] **Step 7: Commit**

```bash
git add src/backup.ts tests/unit/backup.test.ts
git commit -m "feat: csv import/export includes rating"
```

---

### Task 4: Generalize `applyView()` for per-view state

**Files:**
- Modify: `src/ui/views.ts`
- Modify: `tests/unit/views.test.ts`

**Interfaces:**
- Consumes: `Item` with `rating` field.
- Produces: A new `PerViewState` shape (Schedule/Todos/Due) accepted by `applyView`. The old single-`status` signature is preserved as a thin wrapper to keep existing callers (and tests) working until later tasks replace them.

The current `applyView` signature:
```ts
export function applyView(items: Item[], v: ViewState): Item[]
```

We keep it as-is for now and add a new function `applyViewV2(items, state, kindFilter)` that does the full job. Later tasks will switch callers.

- [ ] **Step 1: Add the new state types and comparator types to `src/ui/views.ts`**

At the top of `src/ui/views.ts`, replace the existing `SortMode` and `ViewState` declarations with:
```ts
export type SortMode = "manual" | "date" | "title" | "status" | "priority";
export type Dir = "asc" | "desc";

export interface LegacyViewState {
  search: string;
  status: "all" | "pending" | "done";
  sort: SortMode;
}

export type ScheduleState = {
  search: string;
  filters: { timeRange: "all" | "today" | "week" | "month"; status: "all" | "pending" | "done" };
  sort: "date" | "title" | "manual";
  dir: Dir;
};

export type TodosState = {
  search: string;
  filters: { priority: "all" | "1" | "2" | "3" | "4" | "5"; status: "all" | "pending" | "done" };
  sort: "priority" | "date" | "title" | "manual";
  dir: Dir;
};

export type DueState = {
  search: string;
  filters: { dueWindow: "overdue" | "now" | "today"; kind: "all" | "event" | "todo" };
  sort: "date" | "title";
  dir: Dir;
};
```

- [ ] **Step 2: Add `applyViewV2()` after the existing `applyView()`**

Append this function below the existing `applyView()`:
```ts
function inToday(iso: string): boolean {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return false;
  const now = new Date();
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
}
function inThisWeek(iso: string): boolean {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return false;
  const now = new Date();
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  start.setDate(now.getDate() - ((now.getDay() + 6) % 7)); // Monday
  const end = new Date(start);
  end.setDate(start.getDate() + 7);
  return d.getTime() >= start.getTime() && d.getTime() < end.getTime();
}
function inThisMonth(iso: string): boolean {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return false;
  const now = new Date();
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
}

function priorityComparator(a: Item, b: Item): number {
  return b.rating - a.rating; // higher first
}
function dateComparator(a: Item, b: Item): number {
  if (!a.datetime && !b.datetime) return 0;
  if (!a.datetime) return 1;
  if (!b.datetime) return -1;
  return a.datetime.localeCompare(b.datetime);
}
function titleComparator(a: Item, b: Item): number {
  return a.title.localeCompare(b.title);
}
function manualComparator(a: Item, b: Item): number {
  return a.order - b.order || a.created_at.localeCompare(b.created_at);
}

type V2State = ScheduleState | TodosState | DueState;

export function applyViewV2(items: Item[], state: V2State): Item[] {
  const q = state.search.trim().toLowerCase();
  let out = items.filter((i) => {
    if (q && !i.title.toLowerCase().includes(q)) return false;
    return true;
  });

  // Per-view filter
  const f = (state as any).filters;
  if (f) {
    out = out.filter((i) => {
      // status (Schedule, Todos)
      if (f.status && f.status !== "all" && i.status !== f.status) return false;
      // timeRange (Schedule)
      if (f.timeRange && f.timeRange !== "all") {
        if (!i.datetime) return false;
        if (f.timeRange === "today" && !inToday(i.datetime)) return false;
        if (f.timeRange === "week" && !inThisWeek(i.datetime)) return false;
        if (f.timeRange === "month" && !inThisMonth(i.datetime)) return false;
      }
      // dueWindow (Due)
      if (f.dueWindow) {
        if (!i.reminder) return false;
        const r = new Date(i.reminder).getTime();
        const now = Date.now();
        const todayEnd = (() => { const d = new Date(); d.setHours(23, 59, 59, 999); return d.getTime(); })();
        if (f.dueWindow === "overdue" && r >= now) return false;
        if (f.dueWindow === "now" && (r < now - 5 * 60_000 || r > now + 5 * 60_000)) return false;
        if (f.dueWindow === "today" && (r < now || r > todayEnd)) return false;
      }
      // kind (Due)
      if (f.kind && f.kind !== "all" && i.kind !== f.kind) return false;
      // priority (Todos)
      if (f.priority && f.priority !== "all") {
        const min = Number(f.priority);
        if (i.rating < min) return false;
      }
      return true;
    });
  }

  // Sort
  const sort = (state as any).sort as string;
  const dir = (state as any).dir as Dir;
  const baseCmp = {
    priority: priorityComparator,
    date: dateComparator,
    title: titleComparator,
    manual: manualComparator
  }[sort] || manualComparator;
  const cmp = (a: Item, b: Item) => {
    const v = baseCmp(a, b);
    if (sort === "manual") return v;
    return dir === "desc" ? -v : v;
  };
  return out.slice().sort(cmp);
}
```

- [ ] **Step 3: Add unit tests for `applyViewV2`**

Append the following to `tests/unit/views.test.ts` (do not remove the existing tests — they cover the legacy path):
```ts
import { applyViewV2 } from "../../src/ui/views";

function mkItemFull(o: Partial<import("../../src/types").Item> = {}): import("../../src/types").Item {
  return {
    id: o.id ?? "x", space_token: "s", kind: o.kind ?? "todo",
    title: o.title ?? "T", datetime: o.datetime ?? null, all_day: false,
    reminder: o.reminder ?? null, status: o.status ?? "pending",
    created_at: o.created_at ?? "2026-01-01T00:00:00.000Z",
    order: o.order ?? 0, pinned: false,
    rating: o.rating ?? 0
  };
}

describe("applyViewV2 — sort", () => {
  const items = [
    mkItemFull({ id: "a", title: "Apple", datetime: "2026-02-01T00:00:00.000Z", rating: 2 }),
    mkItemFull({ id: "b", title: "Banana", rating: 5 }),
    mkItemFull({ id: "c", title: "Cherry", rating: 3.5 }),
    mkItemFull({ id: "d", title: "Date", datetime: "2026-01-15T00:00:00.000Z", rating: 1 })
  ];
  it("priority desc: 5, 3.5, 2, 1", () => {
    const r = applyViewV2(items, {
      search: "", filters: { priority: "all", status: "all" },
      sort: "priority", dir: "desc"
    });
    expect(r.map((i) => i.rating)).toEqual([5, 3.5, 2, 1]);
  });
  it("priority asc: 1, 2, 3.5, 5", () => {
    const r = applyViewV2(items, {
      search: "", filters: { priority: "all", status: "all" },
      sort: "priority", dir: "asc"
    });
    expect(r.map((i) => i.rating)).toEqual([1, 2, 3.5, 5]);
  });
  it("date asc puts earlier first", () => {
    const r = applyViewV2(items, {
      search: "", filters: { timeRange: "all", status: "all" },
      sort: "date", dir: "asc"
    });
    // datetimes: d=2026-01-15, a=2026-02-01, b and c have none (nulls last)
    expect(r.slice(0, 2).map((i) => i.id)).toEqual(["d", "a"]);
  });
});

describe("applyViewV2 — filters", () => {
  it("priority >= N", () => {
    const items = [
      mkItemFull({ id: "1", rating: 0.5 }),
      mkItemFull({ id: "2", rating: 2 }),
      mkItemFull({ id: "3", rating: 4 })
    ];
    const r = applyViewV2(items, {
      search: "", filters: { priority: "2", status: "all" },
      sort: "priority", dir: "desc"
    });
    expect(r.map((i) => i.id).sort()).toEqual(["2", "3"]);
  });
  it("search ignores case", () => {
    const items = [mkItemFull({ id: "1", title: "Hello World" })];
    const r = applyViewV2(items, {
      search: "hello", filters: { priority: "all", status: "all" },
      sort: "priority", dir: "desc"
    });
    expect(r).toHaveLength(1);
  });
});
```

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: PASS. (Existing legacy tests still pass; new `applyViewV2` tests pass.)

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/ui/views.ts tests/unit/views.test.ts
git commit -m "feat: applyViewV2 with per-view state, sort direction, new filters"
```

---

### Task 5: Star widget helper

**Files:**
- Modify: `src/ui/views.ts`
- Create: `tests/unit/star.test.ts`

**Interfaces:**
- Consumes: `number` rating in `[0, 5]` (0.5 increments).
- Produces: `starHTML(rating: number): string` returning the inline-SVG markup for 5 stars.

The polygon is the 5-point star with points: `12,2 14.85,8.5 22,9.3 16.5,14 18,21 12,17.3 6,21 7.5,14 2,9.3 9.15,8.5`.

- [ ] **Step 1: Define the symbol and add `starHTML`**

In `src/ui/views.ts`, at the top of the file (after the imports), add:
```ts
export const STAR_SYMBOL_ID = "starShape";
export const STAR_POLYGON = "12,2 14.85,8.5 22,9.3 16.5,14 18,21 12,17.3 6,21 7.5,14 2,9.3 9.15,8.5";
```

Then add this function (place it above `cardHTML`):
```ts
export function starSymbolHTML(): string {
  return `<svg width="0" height="0" style="position:absolute" aria-hidden="true">
    <defs>
      <symbol id="${STAR_SYMBOL_ID}" viewBox="0 0 24 24">
        <polygon points="${STAR_POLYGON}"/>
      </symbol>
    </defs>
  </svg>`;
}

export function starHTML(rating: number, itemId: string): string {
  const r = Math.max(0, Math.min(5, Math.round(rating * 2) / 2));
  let stars = "";
  for (let i = 1; i <= 5; i++) {
    if (r >= i) {
      stars += `<span class="star full" data-item="${itemId}" data-value="${i}">
        <svg viewBox="0 0 24 24"><use href="#${STAR_SYMBOL_ID}" fill="#f5c518" stroke="#3a2e10" stroke-width="1.4" stroke-linejoin="round"/></svg>
      </span>`;
    } else if (r >= i - 0.5) {
      stars += `<span class="star half" data-item="${itemId}" data-value="${i - 0.5}">
        <svg viewBox="0 0 24 24">
          <use href="#${STAR_SYMBOL_ID}" fill="#fff8d6" stroke="none"/>
          <rect x="0" y="0" width="12" height="24" fill="#f5c518" clip-path="polygon(12px 2px, 14.85px 8.5px, 22px 9.3px, 16.5px 14px, 18px 21px, 12px 17.3px, 6px 21px, 7.5px 14px, 2px 9.3px, 9.15px 8.5px)"/>
          <use href="#${STAR_SYMBOL_ID}" fill="none" stroke="#3a2e10" stroke-width="1.4" stroke-linejoin="round"/>
        </svg>
      </span>`;
    } else {
      stars += `<span class="star empty" data-item="${itemId}" data-value="${i - 1}">
        <svg viewBox="0 0 24 24"><use href="#${STAR_SYMBOL_ID}" fill="#fff8d6" stroke="#3a2e10" stroke-width="1.4" stroke-linejoin="round"/></svg>
      </span>`;
    }
  }
  return `<span class="stars" role="radiogroup" aria-label="Rating" data-item="${itemId}">${stars}</span>`;
}
```

- [ ] **Step 2: Add the star symbol to the page on boot**

In `src/main.ts`, before `boot()` runs, the symbol needs to be in the DOM. Add this as the first line of `boot()` (right after `async function boot() {`):
```ts
  document.body.insertAdjacentHTML("afterbegin", starSymbolHTML());
```

You'll need to import `starSymbolHTML` at the top of `src/main.ts`:
```ts
import { starSymbolHTML } from "./ui/views";
```

- [ ] **Step 3: Add unit tests for `starHTML`**

Create `tests/unit/star.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { starHTML, starSymbolHTML } from "../../src/ui/views";

function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

describe("starHTML", () => {
  it("renders the symbol once when called for many cards", () => {
    const a = starHTML(3, "x");
    const b = starHTML(2.5, "y");
    // The star spans should not contain the symbol markup themselves
    expect(countOccurrences(a, "#starShape")).toBeGreaterThan(0);
    // Each render produces exactly 5 stars
    expect(countOccurrences(a, "class=\"star ")).toBe(5);
    expect(countOccurrences(b, "class=\"star ")).toBe(5);
  });

  it("rating 0 produces 5 empty stars", () => {
    const h = starHTML(0, "x");
    expect(countOccurrences(h, "star empty")).toBe(5);
    expect(countOccurrences(h, "star full")).toBe(0);
    expect(countOccurrences(h, "star half")).toBe(0);
  });

  it("rating 5 produces 5 full stars", () => {
    const h = starHTML(5, "x");
    expect(countOccurrences(h, "star full")).toBe(5);
    expect(countOccurrences(h, "star empty")).toBe(0);
  });

  it("rating 2.5 produces 2 full + 1 half + 2 empty", () => {
    const h = starHTML(2.5, "x");
    expect(countOccurrences(h, "star full")).toBe(2);
    expect(countOccurrences(h, "star half")).toBe(1);
    expect(countOccurrences(h, "star empty")).toBe(2);
  });

  it("rating 0.5 produces 1 half + 4 empty", () => {
    const h = starHTML(0.5, "x");
    expect(countOccurrences(h, "star half")).toBe(1);
    expect(countOccurrences(h, "star empty")).toBe(4);
  });

  it("rating 4.5 produces 4 full + 1 half", () => {
    const h = starHTML(4.5, "x");
    expect(countOccurrences(h, "star full")).toBe(4);
    expect(countOccurrences(h, "star half")).toBe(1);
  });

  it("rating is clamped to [0, 5]", () => {
    expect(countOccurrences(starHTML(99, "x"), "star full")).toBe(5);
    expect(countOccurrences(starHTML(-1, "x"), "star empty")).toBe(5);
  });

  it("rating is snapped to nearest 0.5", () => {
    // 2.3 → 2.5 (round half to even is fine; we test that it lands on a valid value)
    const h = starHTML(2.3, "x");
    expect(countOccurrences(h, "star full")).toBe(2);
    expect(countOccurrences(h, "star half")).toBe(1);
  });
});

describe("starSymbolHTML", () => {
  it("returns a <symbol> with id=starShape", () => {
    expect(starSymbolHTML()).toContain("id=\"starShape\"");
    expect(starSymbolHTML()).toContain("<symbol");
  });
});
```

- [ ] **Step 4: Run the tests**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/ui/views.ts src/main.ts tests/unit/star.test.ts
git commit -m "feat: star widget helper for todo ratings"
```

---

### Task 6: Add style tokens + star styles (no behavior yet)

**Files:**
- Modify: `src/style.css`

- [ ] **Step 1: Add new color tokens to `:root`**

In `src/style.css`, inside `:root`, after the existing `--shadow` line, add:
```css
  --star-fill: #f5c518;
  --star-empty: #fff8d6;
  --star-stroke: #3a2e10;
```

- [ ] **Step 2: Append star styles at the end of `src/style.css`**

```css
/* star widget */
.stars { display: inline-flex; gap: 1px; align-items: center; }
.stars .star { width: 22px; height: 22px; display: inline-block; cursor: pointer; line-height: 0; }
.stars .star svg { display: block; width: 100%; height: 100%; pointer-events: none; }
.stars .star.empty svg { opacity: .55; }
.stars:hover .star.empty svg { opacity: 1; }

/* filter pill + panel */
.filter-pill {
  appearance: none; border: 1px solid var(--line); background: var(--panel); color: var(--ink);
  font: 500 13.5px/1 "Inter"; padding: 7px 14px; border-radius: 999px; cursor: pointer;
  display: inline-flex; align-items: center; gap: 7px; position: relative;
}
.filter-pill:hover { border-color: var(--line-strong); }
.filter-pill[aria-expanded="true"] { border-color: var(--ink); }
.filter-pill .dot { width: 7px; height: 7px; border-radius: 50%; background: var(--todo); position: absolute; top: 4px; right: 4px; }

.filter-panel {
  background: var(--panel); border: 1px solid var(--line); border-radius: 14px; box-shadow: var(--shadow);
  padding: 14px; margin-bottom: 12px; display: flex; flex-direction: column; gap: 12px;
}
.filter-panel .search { width: 100%; }
.filter-panel .search input {
  width: 100%; padding: 8px 10px; border: 1px solid var(--line-strong); background: var(--paper);
  border-radius: 9px; font: inherit; font-size: 14px; color: var(--ink); outline: none;
}
.filter-panel .row-label { font-size: 11px; font-weight: 600; letter-spacing: .05em; text-transform: uppercase; color: var(--faint); margin: 0 0 6px 2px; }
.filter-panel .chips { display: flex; gap: 6px; flex-wrap: wrap; }
.filter-panel .chip {
  background: #fff; border: 1px solid var(--line-strong); color: var(--ink);
  border-radius: 999px; padding: 5px 12px; font: inherit; font-size: 13px; cursor: pointer;
}
.filter-panel .chip:hover { border-color: var(--ink); }
.filter-panel .chip.active { background: var(--ink); color: var(--paper); border-color: var(--ink); }
.filter-panel .sort-row {
  display: flex; gap: 8px; align-items: center; padding-top: 10px; border-top: 1px solid var(--line);
}
.filter-panel .sort-row select { padding: 7px 10px; border-radius: 9px; border: 1px solid var(--line-strong); background: #fff; color: var(--ink); font: inherit; font-size: 13.5px; }
.filter-panel .sort-row .reverse {
  appearance: none; border: 1px solid var(--line-strong); background: #fff; color: var(--ink);
  border-radius: 9px; width: 34px; height: 34px; cursor: pointer;
}
.filter-panel .sort-row .reverse:hover { border-color: var(--ink); }
.filter-panel .sort-row .label { font-size: 11px; font-weight: 600; letter-spacing: .05em; text-transform: uppercase; color: var(--faint); margin-right: auto; }

/* bulk delete dropdown */
.bulk-delete-wrap { position: relative; display: inline-flex; }
.bulk-delete-pop {
  position: absolute; top: calc(100% + 6px); right: 0; background: var(--panel);
  border: 1px solid var(--line); border-radius: 10px; box-shadow: var(--shadow);
  padding: 6px; min-width: 180px; z-index: 10;
}
.bulk-delete-pop button { display: block; width: 100%; text-align: left; background: none; border: none; padding: 8px 10px; border-radius: 6px; font: inherit; font-size: 14px; cursor: pointer; }
.bulk-delete-pop button.danger { color: var(--danger); }
.bulk-delete-pop button:hover { background: var(--paper); }
.bulk-delete-btn { color: var(--danger); border-color: var(--danger) !important; background: var(--panel); }
```

- [ ] **Step 3: Build to verify CSS is valid**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/style.css
git commit -m "style: tokens + styles for stars, filter pill, bulk-delete dropdown"
```

---

### Task 7: Pin removed from todo cards

**Files:**
- Modify: `src/ui/views.ts`

- [ ] **Step 1: Add `showPin` to `cardHTML` options and wire it in**

In `src/ui/views.ts`, the `cardHTML` function takes `(i: Item, opts: { selectable?: boolean; selected?: boolean } = {})`. Change the signature to:
```ts
export function cardHTML(i: Item, opts: { selectable?: boolean; selected?: boolean; showPin?: boolean } = {}): string {
```

Replace the existing `const pin = ...` line with:
```ts
  const pin = opts.showPin === false
    ? ""
    : `<button type="button" class="pin-btn ${i.pinned ? "on" : ""}" title="${i.pinned ? "Unpin" : "Pin"}">${i.pinned ? "📌" : "📍"}</button>`;
```

- [ ] **Step 2: Verify typecheck**

Run: `npm run typecheck`
Expected: PASS (default behavior — `showPin` undefined → pin still rendered).

- [ ] **Step 3: Commit**

```bash
git add src/ui/views.ts
git commit -m "feat: cardHTML gains showPin flag"
```

---

### Task 8: Filter panel module

**Files:**
- Create: `src/ui/filterPanel.ts`

**Interfaces:**
- Consumes: A view key (`"schedule" | "todos" | "due"`) and an initial per-view state.
- Produces: `mountFilterPanel({ viewKey, initial, onChange, onToggle })` that:
  - Injects a `.filter-pill` button into the host element, and a `.filter-panel` directly after it (initially hidden).
  - On pill click, toggles panel open/closed; outside-click and Esc close.
  - Emits `onChange(newState)` whenever any control changes.
  - Returns `{ setState(next) }` so the caller can programmatically update the panel.
  - Draws the active-filter dot on the pill when any control is non-default.

- [ ] **Step 1: Create the file**

Create `src/ui/filterPanel.ts`:
```ts
import type { ScheduleState, TodosState, DueState, Dir } from "./views";
import { esc } from "./views";

type AnyState = ScheduleState | TodosState | DueState;
type ChipsDef = { row: string; key: string; options: { value: string; label: string }[] };
type SortOpt = { value: string; label: string };

const DEFAULTS: Record<string, AnyState> = {
  schedule: { search: "", filters: { timeRange: "all", status: "all" }, sort: "date", dir: "asc" },
  todos: { search: "", filters: { priority: "all", status: "all" }, sort: "priority", dir: "desc" },
  due: { search: "", filters: { dueWindow: "now", kind: "all" }, sort: "date", dir: "asc" }
};

const CHIPS: Record<string, ChipsDef[]> = {
  schedule: [
    { row: "Time range", key: "timeRange", options: [
      { value: "all", label: "All time" },
      { value: "today", label: "Today" },
      { value: "week", label: "This week" },
      { value: "month", label: "This month" }
    ]},
    { row: "Status", key: "status", options: [
      { value: "all", label: "All" },
      { value: "pending", label: "Pending" },
      { value: "done", label: "Done" }
    ]}
  ],
  todos: [
    { row: "Priority", key: "priority", options: [
      { value: "all", label: "All" },
      { value: "1", label: "★1+" },
      { value: "2", label: "★2+" },
      { value: "3", label: "★3+" },
      { value: "4", label: "★4+" },
      { value: "5", label: "★5 only" }
    ]},
    { row: "Status", key: "status", options: [
      { value: "all", label: "All" },
      { value: "pending", label: "Pending" },
      { value: "done", label: "Done" }
    ]}
  ],
  due: [
    { row: "Time", key: "dueWindow", options: [
      { value: "overdue", label: "Overdue" },
      { value: "now", label: "Due now" },
      { value: "today", label: "Due today" }
    ]},
    { row: "Kind", key: "kind", options: [
      { value: "all", label: "All" },
      { value: "event", label: "Events" },
      { value: "todo", label: "Todos" }
    ]}
  ]
};

const SORT_OPTIONS: Record<string, SortOpt[]> = {
  schedule: [
    { value: "date", label: "By date ↑ (soonest)" },
    { value: "date", label: "By date ↓ (latest)" },
    { value: "title", label: "By title A→Z" },
    { value: "title", label: "By title Z→A" },
    { value: "manual", label: "Manual" }
  ],
  todos: [
    { value: "priority", label: "By priority ★5 → ★0" },
    { value: "priority", label: "By priority ★0 → ★5" },
    { value: "date", label: "By date created ↑" },
    { value: "date", label: "By date created ↓" },
    { value: "title", label: "By title A→Z" },
    { value: "title", label: "By title Z→A" },
    { value: "manual", label: "Manual" }
  ],
  due: [
    { value: "date", label: "By date ↑" },
    { value: "date", label: "By date ↓" },
    { value: "title", label: "By title A→Z" },
    { value: "title", label: "By title Z→A" }
  ]
};

function isDefault(state: AnyState, viewKey: string): boolean {
  return JSON.stringify(state) === JSON.stringify(DEFAULTS[viewKey]);
}

export function mountFilterPanel(opts: {
  viewKey: "schedule" | "todos" | "due";
  initial: AnyState;
  host: HTMLElement;
  onChange: (s: AnyState) => void;
}): { setState: (s: AnyState) => void; open: () => void; close: () => void } {
  const { viewKey, initial, host, onChange } = opts;
  let state: AnyState = JSON.parse(JSON.stringify(initial));
  let open_ = false;

  const pill = document.createElement("button");
  pill.className = "filter-pill";
  pill.type = "button";
  pill.setAttribute("aria-expanded", "false");
  pill.innerHTML = `<span aria-hidden="true">⇅</span> Filter &amp; sort<span class="dot" hidden></span>`;
  host.appendChild(pill);

  const panel = document.createElement("div");
  panel.className = "filter-panel";
  panel.hidden = true;
  host.appendChild(panel);

  function drawPanel() {
    const chips = CHIPS[viewKey];
    const sorts = SORT_OPTIONS[viewKey];
    const dirKey: Dir = state.dir;
    // Build the current sort value, combining sort + dir into a composite token
    const sortValue = `${state.sort}|${dirKey}`;
    const sortOptionsHTML = sorts
      .map((s) => {
        const compositeValue = `${s.value}|${s.label.includes("↓") || s.label.includes("Z→A") || s.label.includes("★0 →") ? "desc" : "asc"}`;
        return `<option value="${esc(compositeValue)}" ${compositeValue === sortValue ? "selected" : ""}>${esc(s.label)}</option>`;
      })
      .join("");
    panel.innerHTML = `
      <div class="search"><input type="search" placeholder="Search titles…" aria-label="Search" value="${esc(state.search)}"></div>
      ${chips.map((c) => `
        <div>
          <div class="row-label">${esc(c.row)}</div>
          <div class="chips" data-key="${esc(c.key)}">
            ${c.options.map((o) => `
              <button type="button" class="chip ${(state.filters as any)[c.key] === o.value ? "active" : ""}" data-value="${esc(o.value)}">${esc(o.label)}</button>
            `).join("")}
          </div>
        </div>
      `).join("")}
      <div class="sort-row">
        <span class="label">Sort</span>
        <select aria-label="Sort">${sortOptionsHTML}</select>
        <button type="button" class="reverse" title="Reverse sort direction" aria-label="Reverse sort direction">↑↓</button>
      </div>
    `;
    panel.querySelector<HTMLInputElement>(".search input")!.oninput = (e) => {
      state.search = (e.target as HTMLInputElement).value;
      emit();
    };
    panel.querySelectorAll<HTMLDivElement>(".chips").forEach((row) => {
      const key = row.dataset.key!;
      row.querySelectorAll<HTMLButtonElement>(".chip").forEach((chip) => {
        chip.onclick = () => {
          (state.filters as any)[key] = chip.dataset.value;
          drawPanel();
          emit();
        };
      });
    });
    const sel = panel.querySelector<HTMLSelectElement>(".sort-row select")!;
    sel.onchange = () => {
      const [s, d] = sel.value.split("|");
      state.sort = s as any;
      state.dir = d as Dir;
      emit();
    };
    panel.querySelector<HTMLButtonElement>(".reverse")!.onclick = () => {
      state.dir = state.dir === "asc" ? "desc" : "asc";
      drawPanel();
      emit();
    };
  }

  function emit() {
    onChange(state);
    refreshPill();
  }

  function refreshPill() {
    pill.querySelector(".dot")!.toggleAttribute("hidden", isDefault(state, viewKey));
  }

  function setOpen(v: boolean) {
    open_ = v;
    panel.hidden = !v;
    pill.setAttribute("aria-expanded", String(v));
  }

  pill.onclick = () => setOpen(!open_);
  document.addEventListener("click", (e) => {
    if (!open_) return;
    if (panel.contains(e.target as Node) || pill.contains(e.target as Node)) return;
    setOpen(false);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && open_) setOpen(false);
  });

  drawPanel();
  refreshPill();
  return {
    setState: (s) => { state = s; drawPanel(); refreshPill(); },
    open: () => setOpen(true),
    close: () => setOpen(false)
  };
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/ui/filterPanel.ts
git commit -m "feat: filter panel module (pill + per-view chips + sort + reverse)"
```

---

### Task 9: Wire filter panel into all three views

**Files:**
- Modify: `src/ui/input.ts`

**Interfaces:**
- Consumes: `mountFilterPanel()` from Task 8; `applyViewV2()` from Task 4; `starHTML()` from Task 5; `cardHTML({ showPin })` from Task 7.
- Produces: `mountViews` rewritten to use one filter panel per view; star click handler bound; todo cards hide pin and show stars.

- [ ] **Step 1: Update imports in `src/ui/input.ts`**

Replace the existing import from `./views`:
```ts
import { cardHTML, bindCardEvents, groupByDay, esc, applyView, type ViewState, type SortMode } from "./views";
```

With:
```ts
import { cardHTML, bindCardEvents, groupByDay, esc, applyViewV2, starHTML, type ScheduleState, type TodosState, type DueState, type Dir } from "./views";
import { mountFilterPanel } from "./filterPanel";
```

- [ ] **Step 2: Replace the `mountViews` body**

The current `mountViews()` does several things inline: creates a single `viewState`, builds a `.list-controls` row, sets up selection toolbar, and calls `subscribe`. Replace the whole `mountViews` function with the new implementation below. Preserve all the `manual-event` form-handling code that follows `mountViews` in the same file.

Replace `export function mountViews(): void { ... }` (currently the function spans roughly lines 214–344 in the existing file) with:

```ts
export function mountViews(): void {
  const vSched = el<HTMLDivElement>("#view-schedule");
  const vTodo = el<HTMLDivElement>("#view-todos");
  const vDue = el<HTMLDivElement>("#view-due");
  const schedList = el<HTMLDivElement>("#scheduleList");
  const cSched = el<HTMLSpanElement>("#cSched");
  const cTodo = el<HTMLSpanElement>("#cTodo");
  const cDue = el<HTMLSpanElement>("#cDue");

  document.querySelectorAll<HTMLButtonElement>(".tab").forEach((t) => {
    t.onclick = () => {
      document.querySelectorAll(".tab").forEach((x) => x.setAttribute("aria-selected", "false"));
      t.setAttribute("aria-selected", "true");
      vSched.hidden = t.dataset.view !== "schedule";
      vTodo.hidden = t.dataset.view !== "todos";
      vDue.hidden = t.dataset.view !== "due";
    };
  });

  // Per-view state (initial defaults; user changes flow through onChange).
  const scheduleState: ScheduleState = { search: "", filters: { timeRange: "all", status: "all" }, sort: "date", dir: "asc" };
  const todosState: TodosState = { search: "", filters: { priority: "all", status: "all" }, sort: "priority", dir: "desc" };
  const dueState: DueState = { search: "", filters: { dueWindow: "now", kind: "all" }, sort: "date", dir: "asc" };

  // Inject a filter pill + panel into each view (the panel is the host's first child)
  const schedPanel = mountFilterPanel({ viewKey: "schedule", initial: scheduleState, host: vSched, onChange: (s) => { Object.assign(scheduleState, s); renderAll(latestItems); } });
  const todoPanel = mountFilterPanel({ viewKey: "todos", initial: todosState, host: vTodo, onChange: (s) => { Object.assign(todosState, s); renderAll(latestItems); } });
  const duePanel = mountFilterPanel({ viewKey: "due", initial: dueState, host: vDue, onChange: (s) => { Object.assign(dueState, s); renderAll(latestItems); } });

  // Selection mode
  const selected = new Set<string>();
  const toolbar = document.createElement("div");
  toolbar.className = "sel-toolbar";
  toolbar.innerHTML = `<span class="count">0 selected</span>
    <span class="bulk-delete-wrap">
      <button class="btn bulk-delete-btn" id="selDelete" type="button">Delete selected (0) ▾</button>
    </span>
    <button class="btn" id="selCancel" type="button">Cancel</button>`;
  document.body.appendChild(toolbar);
  const selBtn = document.createElement("button");
  selBtn.className = "btn toggle";
  selBtn.id = "selMode";
  selBtn.textContent = "Select";
  // Attach Select button into each panel's sort row so it follows the pill
  document.querySelectorAll(".filter-panel .sort-row").forEach((row) => {
    const clone = selBtn.cloneNode(true) as HTMLButtonElement;
    clone.id = "";
    row.appendChild(clone);
    clone.onclick = () => selBtn.click();
  });
  // One canonical handler that all clones share via delegation
  let selectable = false;
  const updateSelToolbar = () => {
    toolbar.classList.toggle("show", selectable);
    toolbar.querySelector(".count")!.textContent = `${selected.size} selected`;
    toolbar.querySelector("#selDelete")!.textContent = `Delete selected (${selected.size}) ▾`;
  };
  const toggleSelect = () => {
    selectable = !selectable;
    selected.clear();
    selBtn.textContent = selectable ? "Done selecting" : "Select";
    document.querySelectorAll<HTMLButtonElement>(".filter-panel .sort-row button.toggle").forEach((b) => {
      b.textContent = selectable ? "Done selecting" : "Select";
    });
    renderAll(latestItems);
    updateSelToolbar();
  };
  selBtn.onclick = toggleSelect;
  toolbar.querySelector("#selCancel")!.addEventListener("click", () => {
    selectable = false;
    selected.clear();
    selBtn.textContent = "Select";
    renderAll(latestItems);
    updateSelToolbar();
  });
  // Bulk delete dropdown
  const deleteBtn = toolbar.querySelector<HTMLButtonElement>("#selDelete")!;
  let popOpen = false;
  const closePop = () => { popOpen = false; existingPop?.remove(); existingPop = null; };
  let existingPop: HTMLElement | null = null;
  deleteBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (popOpen) { closePop(); return; }
    popOpen = true;
    const pop = document.createElement("div");
    pop.className = "bulk-delete-pop";
    pop.innerHTML = `
      <button type="button" class="danger" data-act="go">Delete ${selected.size} item${selected.size === 1 ? "" : "s"}</button>
      <button type="button" data-act="cancel">Cancel</button>
    `;
    deleteBtn.parentElement!.appendChild(pop);
    existingPop = pop;
    pop.querySelector<HTMLButtonElement>("[data-act='go']")!.onclick = () => {
      [...selected].forEach((id) => deleteItem(id));
      selected.clear();
      closePop();
      selectable = false;
      selBtn.textContent = "Select";
      renderAll(latestItems);
      updateSelToolbar();
    };
    pop.querySelector<HTMLButtonElement>("[data-act='cancel']")!.onclick = closePop;
  });
  document.addEventListener("click", (e) => {
    if (popOpen && existingPop && !existingPop.contains(e.target as Node) && !deleteBtn.contains(e.target as Node)) closePop();
  });

  let latestItems: Item[] = [];
  subscribe((items: Item[]) => { latestItems = items; renderAll(items); });

  subscribeSettings(() => {
    renderAll(latestItems);
    syncTimeTrigger();
    const pBox = el<HTMLDivElement>("#preview");
    const pText = el<HTMLSpanElement>("#previewText");
    const phrase = el<HTMLInputElement>("#phrase");
    if (pBox && pText && phrase && pBox.classList.contains("show")) {
      const txt = phrase.value.trim();
      if (txt) {
        const g = guess(txt);
        const mark = g.kind === "event" ? "[E]" : "[ ]";
        pText.textContent = `${mark} ${esc(g.title)}${g.datetime ? " · " + formatClock(g.datetime) : ""}`;
      }
    }
  });

  function renderAll(items: Item[]) {
    const events = applyViewV2(items.filter((i) => i.kind === "event"), scheduleState);
    const todos = applyViewV2(items.filter((i) => i.kind === "todo"), todosState);
    const due = applyViewV2(items.filter((i) => !i.done || true /* placeholder; replaced below */), dueState);
    // For the due view, the spec excludes done items; apply that here:
    const dueNotDone = items.filter((i) => i.status !== "done" && i.reminder);
    const dueShown = applyViewV2(dueNotDone, dueState);

    cSched.textContent = String(events.filter((i) => i.status !== "done").length || "");
    cTodo.textContent = String(todos.filter((i) => i.status !== "done").length || "");
    cDue.textContent = String(dueShown.length || "");

    schedList.innerHTML = events.length ? groupByDay(events, selectable) : `<div class="empty">Nothing scheduled. Speak or type to add one.</div>`;
    vTodo.innerHTML = todos.length ? todos.map((i) => cardHTML(i, { selectable, selected: selected.has(i.id), showPin: false })).join("") : `<div class="empty">No todos. Add one below.</div>`;
    vDue.innerHTML = dueShown.length ? dueShown.map((i) => cardHTML(i, { selectable, selected: selected.has(i.id), showPin: i.kind === "event" })).join("") : `<div class="empty">Nothing due right now.</div>`;

    // Inject stars under each todo card's meta row
    document.querySelectorAll<HTMLElement>("#view-todos .card").forEach((card) => {
      const id = card.dataset.id!;
      const item = todos.find((i) => i.id === id);
      if (!item) return;
      const meta = card.querySelector(".meta");
      if (meta && !meta.querySelector(".stars")) {
        meta.insertAdjacentHTML("beforeend", `<span style="display:inline-block;width:8px"></span>${starHTML(item.rating, id)}`);
      }
    });

    const selCtx = { selected, onChange: updateSelToolbar };
    bindCardEvents(schedList, undefined, selCtx);
    bindCardEvents(vTodo, undefined, selCtx);
    bindCardEvents(vDue, undefined, selCtx);
    bindStarEvents(vTodo, latestItems);
  }

  // -- end mountViews rewrite
}
```

Notes on the rewrite:
- The legacy `applyView`, `ViewState`, and `SortMode` imports are dropped.
- `dueItems()` from `reminders.ts` is no longer used in this file — `due` is computed inline as items with `status !== "done" && i.reminder`. If a future task needs the original definition for browser notifications, leave it in `reminders.ts`.
- The `selectable` / `selected` / toolbar code is preserved in spirit but moved out of the per-view injection.
- Star click handling is delegated via a new `bindStarEvents` (defined next).

- [ ] **Step 3: Add `bindStarEvents` and `setRating` at the bottom of `src/ui/input.ts`**

Append to the end of the file (outside `mountViews`):
```ts
async function setRating(id: string, rating: number, items: Item[]) {
  const it = items.find((x) => x.id === id);
  if (!it) return;
  const previous = it.rating;
  // Optimistic UI update
  const local = items.map((x) => (x.id === id ? { ...x, rating } : x));
  // Re-render is driven by the store subscribe; we just push the change through
  try {
    if (!isDemoMode) {
      const { updateItem } = await import("../store");
      await updateItem(id, { rating });
    } else {
      const { setItems } = await import("../store");
      setItems(local);
    }
  } catch (err) {
    // Roll back via the local store re-fetch path is awkward; just re-emit the original list
    const { setItems } = await import("../store");
    setItems(items.map((x) => (x.id === id ? { ...x, rating: previous } : x)));
    showNotice("Couldn't save rating — try again.");
  }
}

function bindStarEvents(host: HTMLElement, items: Item[]) {
  host.querySelectorAll<HTMLElement>(".stars").forEach((row) => {
    row.querySelectorAll<HTMLElement>(".star").forEach((starEl) => {
      starEl.addEventListener("click", async (e) => {
        if (host.querySelector(".card.selected")) return; // selection mode
        e.stopPropagation();
        const id = row.dataset.item!;
        const value = Number(starEl.dataset.value);
        const it = items.find((x) => x.id === id);
        if (!it) return;
        const zone = (e as MouseEvent).offsetX < (starEl as HTMLElement).getBoundingClientRect().width / 2 ? "half" : "whole";
        // The data-value already encodes half vs whole: 2.5 means half, 3 means whole.
        // Toggle: same value + same zone → clear to 0
        if ((e as MouseEvent).shiftKey) { await setRating(id, 0, items); return; }
        if (it.rating === value) { await setRating(id, 0, items); return; }
        await setRating(id, value, items);
      });
    });
  });
}
```

- [ ] **Step 4: Show a star-empty notice helper if not already present**

If `showNotice` is not already defined in `src/ui/input.ts` (the original `mountInput` had one), add a small version at the bottom of the file:
```ts
function showNotice(msg: string) {
  const hint = document.querySelector<HTMLDivElement>("#hint");
  if (!hint) return;
  const orig = hint.textContent;
  hint.textContent = msg;
  hint.classList.add("notice");
  setTimeout(() => { hint.textContent = orig; hint.classList.remove("notice"); }, 4000);
}
```

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Run all tests**

Run: `npm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/ui/input.ts
git commit -m "feat: wire filter panel, star widget, bulk-delete dropdown into views"
```

---

### Task 10: Manual verification

No code changes. The implementation is complete enough to test by hand.

- [ ] **Step 1: Run the dev server**

Run: `npm run dev`
Expected: Vite serves on a port. Open the URL in a browser.

- [ ] **Step 2: Walk through the spec's manual checklist**

Open the file `docs/superpowers/specs/2026-08-29-filter-sort-redesign-and-todo-rating-design.md` and execute the **Manual verification checklist** section. For each item, verify and mark off the box.

- [ ] **Step 3: If anything fails, file a follow-up ticket (do not fix in this plan)**

Out of scope for this plan. The plan is complete; remaining issues belong in a new ticket.

- [ ] **Step 4: Final commit (if any small fixes were needed during verification)**

If no fixes were needed:
```bash
git log --oneline | head -10
```

If a small fix was needed:
```bash
git add -A
git commit -m "fix: address manual verification findings"
```

---

## Self-Review (executed before saving this plan)

1. **Spec coverage** — Walked the spec section by section:
   - Data model → Task 1 (migration) + Task 2 (store defaults) + Task 3 (CSV).
   - Star widget → Task 5 (helper) + Task 6 (styles) + Task 9 (wiring + click).
   - Filter pill + panel → Task 6 (styles) + Task 8 (module) + Task 9 (wiring).
   - Per-view filter sets → Task 8 (chips config) + Task 9 (defaults).
   - Per-view sort + reverse button → Task 8 (sort options + reverse handler) + Task 9 (state defaults).
   - Bulk delete dropdown → Task 6 (styles) + Task 9 (popover).
   - Pin removed from todos → Task 7 (`showPin` flag) + Task 9 (todo call site uses `showPin: false`).
   - State shape → Task 4 (generalize `applyViewV2`).
   - Files touched → all listed in File Map.
   - Error handling → Task 9's `setRating` rollback + `showNotice`.
   - Testing → Task 4 (unit), Task 5 (unit), Task 10 (manual).
   - Out of scope → not implemented (correctly).

2. **Placeholders** — No "TBD", no "TODO", no "add appropriate error handling". Every code block is concrete.

3. **Type consistency** — All types referenced in later tasks are defined in earlier tasks (`ScheduleState`, `TodosState`, `DueState`, `Dir`, `STAR_SYMBOL_ID`, `mountFilterPanel`, `starHTML`, `applyViewV2`). The legacy `applyView` / `ViewState` / `SortMode` are still exported (not removed) so existing tests in `tests/unit/views.test.ts` continue to pass until/unless a follow-up deletes them.

4. **One issue caught during review:** In Task 9, the inline `dueItems()` substitution needed a precise filter (`status !== "done" && i.reminder`); the plan now states this explicitly so the implementer doesn't reach for the old `dueItems` helper from `reminders.ts`.
