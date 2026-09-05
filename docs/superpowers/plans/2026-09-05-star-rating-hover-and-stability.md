# Star Rating Hover Preview & Stable Edit — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the flat-gold hover rectangle with star-shaped fill + numeric tooltip, and stop a card from jumping in the list while its star rating is being edited.

**Architecture:** CSS-only hover preview driven by the existing `data-hover` attribute on the `.stars` row (a ghost `.preview` overlay and a `.tip` element are added to `starHTML()` markup). For stability, the `priorityComparator` learns a pinned-ratings map and `bindStarEvents` sets a `data-editing` attribute on the row during hover.

**Tech Stack:** TypeScript, Vite, Vitest + jsdom, plain CSS.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-09-05-star-rating-hover-and-stability-design.md`
- No new dependencies.
- Existing tests must remain green (especially `tests/unit/star.test.ts` and `tests/unit/star-click.test.ts`).
- Test commands: `npm test` (runs `vitest run`), `npm run typecheck` (runs `tsc --noEmit`).
- Build: `npm run build` (runs `tsc --noEmit && vite build`) — run after final task to confirm production bundle still compiles.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `src/ui/views.ts` | `starHTML` output (committed + preview + tip layers), `priorityComparator` with pinned map, `getPinnedRatings` helper. |
| `src/ui/input.ts` | Row-level `mouseenter`/`mouseleave` to set/clear `data-editing`, `setRating` writes `data-previous-rating`, `applyViewV2` calls read pinned map. |
| `src/style.css` | Drop `.stars::before` rectangle and the hover scale rule. Add `.stars .preview` overlay, `.stars .tip`, and `[data-hover="..."]` overlay/tooltip positioning rules. |
| `tests/unit/star.test.ts` | Assert new `.preview` and `.tip` markup is emitted. |
| `tests/unit/priority-comparator.test.ts` (new) | Assert pinned-ratings behavior of `priorityComparator`. |

---

## Task 1: Pin comparator + helper, TDD

**Files:**
- Modify: `src/ui/views.ts:133-135` (priority comparator signature)
- Modify: `src/ui/views.ts` (export new `getPinnedRatings` helper)
- Test: `tests/unit/priority-comparator.test.ts` (new)

**Interfaces:**
- Consumes: existing `Item` type from `../types`; `HTMLElement` host argument for `getPinnedRatings`.
- Produces: `priorityComparator(a, b, pinned?: Map<string, number>): number` (re-exported); `getPinnedRatings(host: HTMLElement): Map<string, number>` (exported).

- [ ] **Step 1: Write failing tests for `priorityComparator` pinning**

Create `tests/unit/priority-comparator.test.ts`:

```ts
// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { priorityComparator, getPinnedRatings } from "../../src/ui/views";
import type { Item } from "../../src/types";

function item(id: string, rating: number, created = "2026-01-01"): Item {
  return {
    id,
    title: id,
    rating,
    created_at: created,
    order: 0,
    status: "pending",
    kind: "todo",
    datetime: null,
    reminder: null,
    all_day: false
  } as Item;
}

describe("priorityComparator", () => {
  it("sorts higher rating first with no pins", () => {
    const a = item("a", 5);
    const b = item("b", 3);
    expect(priorityComparator(a, b)).toBeLessThan(0);
    expect(priorityComparator(b, a)).toBeGreaterThan(0);
  });

  it("uses pinned rating over actual rating for the pinned item", () => {
    const a = item("a", 5); // would normally sort first
    const b = item("b", 3);
    const pinned = new Map<string, number>([["a", 1]]);
    // With a pinned to 1, b (rating 3) should now come first
    expect(priorityComparator(a, b, pinned)).toBeGreaterThan(0);
    expect(priorityComparator(b, a, pinned)).toBeLessThan(0);
  });

  it("ignores pins for items not in the map", () => {
    const a = item("a", 4);
    const b = item("b", 2);
    const pinned = new Map<string, number>([["other", 5]]);
    expect(priorityComparator(a, b, pinned)).toBeLessThan(0);
  });

  it("treats equal pinned+actual ratings as 0", () => {
    const a = item("a", 4);
    const b = item("b", 4);
    const pinned = new Map<string, number>([["a", 4]]);
    expect(priorityComparator(a, b, pinned)).toBe(0);
  });
});

describe("getPinnedRatings", () => {
  it("returns a map populated from .stars[data-editing] rows", () => {
    document.body.innerHTML = `
      <div id="host">
        <span class="stars" data-item="a" data-editing="1" data-previous-rating="2"></span>
        <span class="stars" data-item="b" data-editing="1" data-previous-rating="4"></span>
        <span class="stars" data-item="c"></span>
      </div>
    `;
    const host = document.getElementById("host")!;
    const map = getPinnedRatings(host);
    expect(map.get("a")).toBe(2);
    expect(map.get("b")).toBe(4);
    expect(map.has("c")).toBe(false);
    expect(map.size).toBe(2);
  });

  it("returns an empty map when no row is editing", () => {
    document.body.innerHTML = `<div id="host"><span class="stars" data-item="a"></span></div>`;
    const host = document.getElementById("host")!;
    expect(getPinnedRatings(host).size).toBe(0);
  });
});
```

- [ ] **Step 2: Run new tests to confirm they fail**

Run: `npm test -- tests/unit/priority-comparator.test.ts`
Expected: FAIL — `priorityComparator` and `getPinnedRatings` are not exported.

- [ ] **Step 3: Implement the comparator change + helper in `src/ui/views.ts`**

Replace the existing `priorityComparator` and add the helper. The current code is:

```ts
function priorityComparator(a: Item, b: Item): number {
  return b.rating - a.rating; // higher first
}
```

Change it to (and add immediately below it):

```ts
export function priorityComparator(
  a: Item,
  b: Item,
  pinned: Map<string, number> = new Map()
): number {
  const ar = pinned.get(a.id) ?? a.rating;
  const br = pinned.get(b.id) ?? b.rating;
  return br - ar;
}

export function getPinnedRatings(host: HTMLElement): Map<string, number> {
  const out = new Map<string, number>();
  host.querySelectorAll<HTMLElement>(".stars[data-editing]").forEach((row) => {
    const id = row.dataset.item;
    const prev = row.dataset.previousRating;
    if (id !== undefined && prev !== undefined) {
      out.set(id, Number(prev));
    }
  });
  return out;
}
```

- [ ] **Step 4: Re-run tests to confirm they pass**

Run: `npm test -- tests/unit/priority-comparator.test.ts`
Expected: PASS (5 new assertions).

- [ ] **Step 5: Run full test suite to confirm nothing else broke**

Run: `npm test`
Expected: PASS — only the new tests are added; existing comparator callers in `applyViewV2` (`src/ui/views.ts:208-219`) use the default empty map.

- [ ] **Step 6: Commit**

```bash
git add tests/unit/priority-comparator.test.ts src/ui/views.ts
git commit -m "feat(stars): pin priority comparator via getPinnedRatings"
```

---

## Task 2: `applyViewV2` accepts a pinned map; pass it from `renderAll`

**Files:**
- Modify: `src/ui/views.ts:151-221` (`applyViewV2` signature + body)
- Modify: `src/ui/input.ts:381-388` (`renderAll` callers)
- Test: `tests/unit/views.test.ts` (extend if a sort-by-priority test exists; otherwise no new test — `applyViewV2` pinning is covered indirectly via `priorityComparator` already tested)

**Interfaces:**
- Consumes: `getPinnedRatings(host)` (from Task 1).
- Produces: `applyViewV2(items, state, pinned?: Map<string, number>)` — third arg optional, defaults to empty map.

- [ ] **Step 1: Read current `applyViewV2` to confirm the comparator wiring**

Open `src/ui/views.ts` lines 151–221. Confirm the comparator is selected from `state.sort` and that `priorityComparator` is one of the named keys.

- [ ] **Step 2: Update `applyViewV2` to accept and forward a pinned map**

In `src/ui/views.ts`, change the signature and pass `pinned` through to the priority comparator only (other comparators ignore it):

```ts
export function applyViewV2(
  items: Item[],
  state: V2State,
  pinned: Map<string, number> = new Map()
): Item[] {
  // ... existing filter logic unchanged ...

  // Sort — only priority uses pinned ratings.
  const sort = (state as any).sort as string;
  const dir = (state as any).dir as Dir;
  const baseCmp = {
    priority: (a: Item, b: Item) => priorityComparator(a, b, pinned),
    date: dateComparator,
    title: titleComparator,
    manual: manualComparator
  }[sort] || manualComparator;
  // ... rest unchanged ...
}
```

- [ ] **Step 3: Update `renderAll` callers in `src/ui/input.ts`**

Current code (around `src/ui/input.ts:381-388`):

```ts
function renderAll(items: Item[]) {
  const events = applyViewV2(items.filter((i) => i.kind === "event"), scheduleState);
  const todos = applyViewV2(items.filter((i) => i.kind === "todo"), todosState);
  const dueNotDone = items.filter((i) => i.status !== "done" && (i.reminder || i.datetime));
  const dueShown = applyViewV2(dueNotDone, dueState);
  // ...
}
```

Change to pass pinned ratings from each view's host element:

```ts
function renderAll(items: Item[]) {
  const events = applyViewV2(
    items.filter((i) => i.kind === "event"),
    scheduleState,
    getPinnedRatings(vSched)
  );
  const todos = applyViewV2(
    items.filter((i) => i.kind === "todo"),
    todosState,
    getPinnedRatings(vTodo)
  );
  const dueNotDone = items.filter((i) => i.status !== "done" && (i.reminder || i.datetime));
  const dueShown = applyViewV2(
    dueNotDone,
    dueState,
    getPinnedRatings(vDue)
  );
  // ...
}
```

Add `getPinnedRatings` to the imports from `./views` at the top of the file.

- [ ] **Step 4: Run typecheck and full test suite**

Run: `npm run typecheck`
Expected: PASS.

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ui/views.ts src/ui/input.ts
git commit -m "feat(stars): thread pinned ratings through applyViewV2"
```

---

## Task 3: `setRating` writes `data-previous-rating`; row enters editing on hover

**Files:**
- Modify: `src/ui/input.ts:450-498` (`setRating`, `bindStarEvents`)

**Interfaces:**
- Consumes: existing `setItems`, `updateItem`, `showNotice`.
- Produces: `data-previous-rating` written on the row before the optimistic render; row gains `data-editing="1"` on `mouseenter`, loses it on `mouseleave`.

- [ ] **Step 1: Update `setRating` to write `data-previous-rating` before the optimistic render**

Current code (`src/ui/input.ts:450-462`):

```ts
async function setRating(id: string, rating: number, items: Item[]) {
  const it = items.find((x) => x.id === id);
  if (!it) return;
  const previous = it.rating;
  const local = items.map((x) => (x.id === id ? { ...x, rating } : x));
  setItems(local);
  try {
    await updateItem(id, { rating });
  } catch (err) {
    setItems(items.map((x) => (x.id === id ? { ...x, rating: previous } : x)));
    showNotice("Couldn't save rating — try again.");
  }
}
```

Replace with:

```ts
async function setRating(id: string, rating: number, items: Item[]) {
  const it = items.find((x) => x.id === id);
  if (!it) return;
  const previous = it.rating;
  const row = document.querySelector<HTMLElement>(`.stars[data-item="${id}"]`);
  if (row) row.dataset.previousRating = String(previous);
  const local = items.map((x) => (x.id === id ? { ...x, rating } : x));
  setItems(local);
  try {
    await updateItem(id, { rating });
  } catch (err) {
    setItems(items.map((x) => (x.id === id ? { ...x, rating: previous } : x)));
    showNotice("Couldn't save rating — try again.");
  }
}
```

- [ ] **Step 2: Add row-level mouseenter/mouseleave inside `bindStarEvents`**

Current `bindStarEvents` body (`src/ui/input.ts:472-498`). Add the row-level enter/leave handler *inside* the `forEach` over `.stars` rows, before the inner loop over `.star` children:

```ts
function bindStarEvents(host: HTMLElement, items: Item[]) {
  host.querySelectorAll<HTMLElement>(".stars").forEach((row) => {
    row.addEventListener("mouseenter", () => {
      if (host.querySelector(".card.selected")) return; // selection mode
      row.dataset.editing = "1";
    });
    row.addEventListener("mouseleave", () => {
      if (row.dataset.editing !== undefined) delete row.dataset.editing;
    });
    row.querySelectorAll<HTMLElement>(".star").forEach((starEl) => {
      // existing handlers unchanged
    });
  });
}
```

- [ ] **Step 3: Run typecheck and tests**

Run: `npm run typecheck && npm test`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/ui/input.ts
git commit -m "feat(stars): mark row editing on hover + carry previous rating"
```

---

## Task 4: Add preview overlay + tooltip markup to `starHTML`

**Files:**
- Modify: `src/ui/views.ts:19-43` (`starHTML`)
- Test: `tests/unit/star.test.ts`

**Interfaces:**
- Consumes: existing `STAR_SYMBOL_ID`, `STAR_POLYGON`, `STAR_EMPTY_FILL`, `STAR_POLYGON`.
- Produces: `.stars` HTML now contains a `.preview` overlay of 5 ghost stars and a `.tip` element. Existing committed-star markup unchanged.

- [ ] **Step 1: Extend `tests/unit/star.test.ts` with markup assertions**

Append to the `describe("starHTML", ...)` block:

```ts
it("emits a preview overlay of 5 ghost stars", () => {
  const h = starHTML(0, "x");
  expect(countOccurrences(h, "class=\"preview\"")).toBe(1);
  expect(countOccurrences(h, "class=\"preview-star\"")).toBe(5);
});

it("emits a numeric tooltip element", () => {
  const h = starHTML(2.5, "x");
  expect(h).toContain("class=\"tip\"");
  expect(h).toContain("2.5");
});
```

- [ ] **Step 2: Run tests to confirm the new assertions fail**

Run: `npm test -- tests/unit/star.test.ts`
Expected: FAIL — no `class="preview"` or `class="tip"` in current output.

- [ ] **Step 3: Update `starHTML` to emit preview + tooltip**

Replace the existing `starHTML` (`src/ui/views.ts:19-43`) with:

```ts
export function starHTML(rating: number, itemId: string): string {
  const r = Math.max(0, Math.min(5, Math.round(rating * 2) / 2));
  let stars = "";
  for (let i = 1; i <= 5; i++) {
    if (r >= i) {
      stars += `<span class="star full" data-item="${itemId}" data-value="${i}" data-pos="${i}">
        <svg viewBox="0 0 24 24"><use href="#${STAR_SYMBOL_ID}" fill="#f5c518" stroke="#3a2e10" stroke-width="1.4" stroke-linejoin="round"/></svg>
      </span>`;
    } else if (r >= i - 0.5) {
      stars += `<span class="star half" data-item="${itemId}" data-value="${i - 0.5}" data-pos="${i}">
        <svg viewBox="0 0 24 24">
          <defs><clipPath id="half-${itemId}-${i}"><rect x="0" y="0" width="12" height="24"/></clipPath></defs>
          <use href="#${STAR_SYMBOL_ID}" fill="${STAR_EMPTY_FILL}" stroke="none"/>
          <use href="#${STAR_SYMBOL_ID}" fill="#f5c518" clip-path="url(#half-${itemId}-${i})"/>
          <use href="#${STAR_SYMBOL_ID}" fill="none" stroke="#3a2e10" stroke-width="1.6" stroke-linejoin="round"/>
        </svg>
      </span>`;
    } else {
      stars += `<span class="star empty" data-item="${itemId}" data-value="${i - 1}" data-pos="${i}">
        <svg viewBox="0 0 24 24"><use href="#${STAR_SYMBOL_ID}" fill="${STAR_EMPTY_FILL}" stroke="#3a2e10" stroke-width="1.8" stroke-linejoin="round"/></svg>
      </span>`;
    }
  }

  // Preview overlay: 5 ghost stars positioned over the committed stars,
  // tinted gold by the CSS rules keyed on the row's data-hover attribute.
  let preview = "";
  for (let i = 1; i <= 5; i++) {
    preview += `<svg class="preview-star" viewBox="0 0 24 24" data-pos="${i}">
      <defs><clipPath id="prev-half-${itemId}-${i}"><rect x="0" y="0" width="12" height="24"/></clipPath></defs>
      <use href="#${STAR_SYMBOL_ID}" fill="${STAR_EMPTY_FILL}" stroke="none"/>
      <g class="fill"><use href="#${STAR_SYMBOL_ID}" fill="#f5c518" stroke="none"/></g>
    </svg>`;
  }

  const tipText = r === 0 ? "" : (r % 1 === 0 ? String(r) : r.toFixed(1));

  return `<span class="stars" role="radiogroup" aria-label="Rating" data-item="${itemId}">${stars}<span class="preview" aria-hidden="true">${preview}</span><span class="tip" aria-hidden="true">${tipText}</span></span>`;
}
```

Note: the per-half-step clipping on the preview overlay is intentionally handled via the CSS rules (Task 5) using a `clip-path` set on the `.fill` group, not via an inline `<clipPath>` per element. The inline `<clipPath>` is left on the `<defs>` for potential future use but the active half-fill is driven by CSS.

- [ ] **Step 4: Run tests to confirm new assertions pass**

Run: `npm test -- tests/unit/star.test.ts`
Expected: PASS — new assertions pass, existing committed-star assertions still pass.

- [ ] **Step 5: Commit**

```bash
git add src/ui/views.ts tests/unit/star.test.ts
git commit -m "feat(stars): emit preview overlay + numeric tooltip in starHTML"
```

---

## Task 5: CSS — preview overlay, tooltip, drop rectangle

**Files:**
- Modify: `src/style.css:338-377`

**Interfaces:**
- Consumes: `data-hover` attribute values `"0.5" | "1" | "1.5" | ... | "5"` (already set by `bindStarEvents`).

- [ ] **Step 1: Replace the star-widget CSS block**

Delete the block from `.stars::before { ... }` through `.stars[data-hover] .star:hover svg { ... }` (current lines 344–377). Replace with:

```css
/* Hover preview overlay: 5 ghost stars painted over the committed stars.
   Each preview-star's inner <g class="fill"> is shown only when the row's
   data-hover value reaches or exceeds its position. For half-step hovers
   (data-hover="X.5"), the fill group on the X+1 star is clipped to the
   left half via clip-path on .fill. CSS does the work so the JS handler
   just toggles a single attribute on the row. */
.stars .preview {
  position: absolute;
  inset: 0;
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  pointer-events: none;
  opacity: 0;
  transition: opacity .12s ease;
}
.stars[data-hover] .preview { opacity: 1; }
.stars .preview-star { width: 100%; height: 100%; display: block; }
.stars .preview-star .fill { display: none; }

.stars[data-hover="0.5"] .preview-star[data-pos="1"] .fill,
.stars[data-hover="1"] .preview-star[data-pos="1"] .fill,
.stars[data-hover="1.5"] .preview-star[data-pos="1"] .fill,
.stars[data-hover="1.5"] .preview-star[data-pos="2"] .fill,
.stars[data-hover="2"] .preview-star[data-pos="1"] .fill,
.stars[data-hover="2"] .preview-star[data-pos="2"] .fill,
.stars[data-hover="2.5"] .preview-star[data-pos="1"] .fill,
.stars[data-hover="2.5"] .preview-star[data-pos="2"] .fill,
.stars[data-hover="2.5"] .preview-star[data-pos="3"] .fill,
.stars[data-hover="3"] .preview-star[data-pos="1"] .fill,
.stars[data-hover="3"] .preview-star[data-pos="2"] .fill,
.stars[data-hover="3"] .preview-star[data-pos="3"] .fill,
.stars[data-hover="3.5"] .preview-star[data-pos="1"] .fill,
.stars[data-hover="3.5"] .preview-star[data-pos="2"] .fill,
.stars[data-hover="3.5"] .preview-star[data-pos="3"] .fill,
.stars[data-hover="3.5"] .preview-star[data-pos="4"] .fill,
.stars[data-hover="4"] .preview-star[data-pos="1"] .fill,
.stars[data-hover="4"] .preview-star[data-pos="2"] .fill,
.stars[data-hover="4"] .preview-star[data-pos="3"] .fill,
.stars[data-hover="4"] .preview-star[data-pos="4"] .fill,
.stars[data-hover="4.5"] .preview-star[data-pos="1"] .fill,
.stars[data-hover="4.5"] .preview-star[data-pos="2"] .fill,
.stars[data-hover="4.5"] .preview-star[data-pos="3"] .fill,
.stars[data-hover="4.5"] .preview-star[data-pos="4"] .fill,
.stars[data-hover="4.5"] .preview-star[data-pos="5"] .fill,
.stars[data-hover="5"] .preview-star[data-pos="1"] .fill,
.stars[data-hover="5"] .preview-star[data-pos="2"] .fill,
.stars[data-hover="5"] .preview-star[data-pos="3"] .fill,
.stars[data-hover="5"] .preview-star[data-pos="4"] .fill,
.stars[data-hover="5"] .preview-star[data-pos="5"] .fill {
  display: block;
}

/* Half-step clip: when the hover value is X.5, the (X+1)th fill is shown
   only on the left half. */
.stars[data-hover="0.5"] .preview-star[data-pos="1"] .fill { clip-path: inset(0 50% 0 0); }
.stars[data-hover="1.5"] .preview-star[data-pos="2"] .fill { clip-path: inset(0 50% 0 0); }
.stars[data-hover="2.5"] .preview-star[data-pos="3"] .fill { clip-path: inset(0 50% 0 0); }
.stars[data-hover="3.5"] .preview-star[data-pos="4"] .fill { clip-path: inset(0 50% 0 0); }
.stars[data-hover="4.5"] .preview-star[data-pos="5"] .fill { clip-path: inset(0 50% 0 0); }

/* Tooltip: small numeric pill above the hovered star. Horizontal position
   uses the same percentages as the old rectangle overlay so the centre of
   the pill lands over the hovered star. */
.stars .tip {
  position: absolute;
  top: -1.4em;
  transform: translateX(-50%);
  font: 600 11px/1 "Inter", system-ui, sans-serif;
  background: var(--ink);
  color: var(--panel);
  padding: 3px 6px;
  border-radius: 4px;
  pointer-events: none;
  opacity: 0;
  transition: opacity .12s ease;
  white-space: nowrap;
}
.stars[data-hover] .tip { opacity: 1; }
.stars[data-hover="0.5"] .tip { left: 10%; }
.stars[data-hover="1"] .tip   { left: 20%; }
.stars[data-hover="1.5"] .tip { left: 30%; }
.stars[data-hover="2"] .tip   { left: 40%; }
.stars[data-hover="2.5"] .tip { left: 50%; }
.stars[data-hover="3"] .tip   { left: 60%; }
.stars[data-hover="3.5"] .tip { left: 70%; }
.stars[data-hover="4"] .tip   { left: 80%; }
.stars[data-hover="4.5"] .tip { left: 90%; }
.stars[data-hover="5"] .tip   { left: 100%; }
```

- [ ] **Step 2: Run full test suite + typecheck**

Run: `npm run typecheck && npm test`
Expected: PASS — CSS doesn't break any markup test; the existing `tests/unit/star.test.ts` assertions are pure-HTML and unchanged.

- [ ] **Step 3: Commit**

```bash
git add src/style.css
git commit -m "style(stars): star-shaped hover preview + numeric tooltip"
```

---

## Task 6: Build verification

**Files:** none

- [ ] **Step 1: Run the production build**

Run: `npm run build`
Expected: exits 0. `tsc --noEmit` and `vite build` both complete.

- [ ] **Step 2: If the build fails, fix forward and re-run**

Common failure modes: type errors in the comparator signature, missing import of `getPinnedRatings` in `input.ts`. Address by reading the error, applying the minimal fix, re-running.

- [ ] **Step 3: Final commit (only if Step 2 produced changes)**

```bash
git add -A
git commit -m "build: verify production bundle after star UX changes"
```

---

## Self-Review

1. **Spec coverage:**
   - Hover preview shows star shapes up to cursor (whole + half) → Tasks 4 + 5.
   - Numeric tooltip ("3.5") above hovered star → Tasks 4 + 5.
   - Row pins during interaction → Task 3.
   - Re-sort applies after `mouseleave` (no extra logic — `data-editing` clears, next render uses live rating) → covered by Task 3.
   - Existing tests stay green → verified at each task's test step.
   - `data-previous-rating` rollback path on `updateItem` failure → existing rollback in `setRating` is unchanged; we just write `previous` to the dataset before the optimistic render, so the rollback render still sees the correct pin (the rollback path also calls `setItems` which re-renders, and the row's `data-editing` is still true while the user is still hovering, so the row stays pinned).

2. **Placeholder scan:** No "TBD", "TODO", "implement later" in the plan. Every code block is the actual code.

3. **Type consistency:**
   - `priorityComparator(a, b, pinned?: Map<string, number>)` defined in Task 1, used in Task 2. ✅
   - `applyViewV2(items, state, pinned?: Map<string, number>)` defined in Task 2, used in Task 2 and Task 3 indirectly. ✅
   - `getPinnedRatings(host)` defined in Task 1, imported and called in Task 2. ✅
   - `data-editing`, `data-previous-rating`, `data-hover` attribute names consistent across Tasks 1, 3, 5. ✅
