# Tooltip Pill Style + Remove Pins From All Tabs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the hover tooltip a light cream pill (not a black blob) and remove the pin button from every tab.

**Architecture:** CSS color flip on the tooltip pill; one signature change to `groupByDay` so the Schedule view can pass `showPin: false`; one line change in `renderAll` for the Due view's `showPin`. Tests assert pin markup is absent.

**Tech Stack:** TypeScript, Vite, Vitest + jsdom, plain CSS.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-09-05-tooltip-pill-and-pin-removal-design.md`
- No new dependencies.
- Existing tests must remain green.
- Test commands: `npm test` (runs `vitest run`), `npm run typecheck` (runs `tsc --noEmit`), `npm run build` (runs `tsc --noEmit && vite build`).
- All work happens on the existing branch.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `src/style.css` | Flip tooltip pill colors (background, color, border). |
| `src/ui/views.ts` | `groupByDay` accepts a third `cardOpts` arg and forwards to `cardHTML`. |
| `src/ui/input.ts` | `renderAll` passes `showPin: false` to `groupByDay` and the Due cards. |
| `tests/unit/views.test.ts` | Assert `groupByDay` no longer emits `pin-btn` when `showPin: false`. |

---

## Task 1: Flip tooltip pill colors (the "black blob" fix)

**Files:**
- Modify: `src/style.css:416-429` (`.stars .tip` rule)

- [ ] **Step 1: Confirm green baseline**

Run: `npm test`
Expected: PASS — 117/117 across 14 files.

- [ ] **Step 2: Update the `.stars .tip` rule**

In `src/style.css`, replace the `.stars .tip { ... }` rule (lines 416–429):

```css
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
```

with:

```css
/* Tooltip: small numeric pill above the hovered star. Light cream background
   with a thin border so it reads as a tooltip, not a black blob. The
   horizontal position rules below stay identical. */
.stars .tip {
  position: absolute;
  top: -1.4em;
  transform: translateX(-50%);
  font: 600 11px/1 "Inter", system-ui, sans-serif;
  background: var(--paper);
  color: var(--ink);
  padding: 3px 6px;
  border-radius: 4px;
  border: 1px solid var(--line);
  pointer-events: none;
  opacity: 0;
  transition: opacity .12s ease;
  white-space: nowrap;
}
```

- [ ] **Step 3: Run the full suite**

Run: `npm test`
Expected: PASS — 117/117. (CSS-only change; no test asserts CSS colors, but no test breaks either.)

- [ ] **Step 4: Commit**

```bash
git add src/style.css
git commit -m "style(stars): light cream tooltip pill instead of dark blob"
```

---

## Task 2: Hide pin button on Schedule and Due tabs

**Files:**
- Modify: `src/ui/views.ts:407-415` (`groupByDay` signature + body)
- Modify: `src/ui/input.ts:412-414` (`renderAll` callers)
- Test: `tests/unit/views.test.ts` (extend the CSS-shape describe OR a new test)

**Interfaces:**
- Consumes: `Item` type, `cardHTML` (existing signature accepts `opts`).
- Produces: `groupByDay(items, selectable, cardOpts?: { showPin?: boolean })` — third arg optional, defaults to `{}`.

- [ ] **Step 1: Add a failing test asserting `groupByDay` honors `showPin: false`**

Open `tests/unit/views.test.ts`. Add a new `describe` block (or extend an existing one) at the bottom of the file:

```ts
import { groupByDay } from "../../src/ui/views";

describe("groupByDay", () => {
  it("does not render a pin button when showPin: false", () => {
    const items: Item[] = [
      {
        id: "x",
        title: "x",
        kind: "event",
        datetime: "2026-09-06T09:00:00",
        reminder: null,
        all_day: false,
        status: "pending",
        rating: 0,
        pinned: true,
        order: 0,
        created_at: "2026-09-05T00:00:00"
      } as Item
    ];
    const html = groupByDay(items, false, { showPin: false });
    expect(html).not.toContain("pin-btn");
  });

  it("does render a pin button when showPin is omitted (default)", () => {
    const items: Item[] = [
      {
        id: "x",
        title: "x",
        kind: "event",
        datetime: "2026-09-06T09:00:00",
        reminder: null,
        all_day: false,
        status: "pending",
        rating: 0,
        pinned: true,
        order: 0,
        created_at: "2026-09-05T00:00:00"
      } as Item
    ];
    const html = groupByDay(items, false);
    expect(html).toContain("pin-btn");
  });
});
```

(The `Item` import already exists at the top of `tests/unit/views.test.ts`. If not, add `import type { Item } from "../../src/types";` near the top.)

- [ ] **Step 2: Run the new test to confirm it fails (because `groupByDay` doesn't accept the third arg yet)**

Run: `npm test -- tests/unit/views.test.ts -t "groupByDay"`
Expected: FAIL — `groupByDay(items, false, { showPin: false })` is a TypeScript error or produces wrong output.

- [ ] **Step 3: Update `groupByDay` to accept the third arg and forward to `cardHTML`**

In `src/ui/views.ts`, replace the existing `groupByDay` (around lines 405–415):

```ts
export function groupByDay(items: Item[], selectable: boolean): string {
  const groups: Record<string, Item[]> = {};
  for (const i of items) {
    const key = dayKey(i.datetime || i.reminder || "");
    (groups[key] ||= []).push(i);
  }
  let html = "";
  Object.keys(groups).forEach((k) => {
    const ids = groups[k].map((i) => i.id).join(",");
    html += `<div class="day-label">${esc(k)}${selectable ? `<button type="button" class="day-del" data-ids="${ids}">delete all</button>` : ""}</div>` + groups[k].map((i) => cardHTML(i, { selectable })).join("");
  });
  return html;
}
```

with:

```ts
export function groupByDay(
  items: Item[],
  selectable: boolean,
  cardOpts: { showPin?: boolean } = {}
): string {
  const groups: Record<string, Item[]> = {};
  for (const i of items) {
    const key = dayKey(i.datetime || i.reminder || "");
    (groups[key] ||= []).push(i);
  }
  let html = "";
  Object.keys(groups).forEach((k) => {
    const ids = groups[k].map((i) => i.id).join(",");
    html += `<div class="day-label">${esc(k)}${selectable ? `<button type="button" class="day-del" data-ids="${ids}">delete all</button>` : ""}</div>` + groups[k].map((i) => cardHTML(i, { selectable, ...cardOpts })).join("");
  });
  return html;
}
```

- [ ] **Step 4: Update the Schedule rendering in `src/ui/input.ts` to pass `showPin: false`**

In `src/ui/input.ts`, replace the `schedCards` line (line 412):

```ts
schedCards.innerHTML = events.length ? groupByDay(events, selectable) : `<div class="empty">Nothing scheduled. Speak or type to add one.</div>`;
```

with:

```ts
schedCards.innerHTML = events.length ? groupByDay(events, selectable, { showPin: false }) : `<div class="empty">Nothing scheduled. Speak or type to add one.</div>`;
```

- [ ] **Step 5: Update the Due rendering to pass `showPin: false`**

In `src/ui/input.ts`, replace the `dueCards` line (line 414):

```ts
dueCards.innerHTML = dueShown.length ? dueShown.map((i) => cardHTML(i, { selectable, selected: selected.has(i.id), showPin: i.kind === "event" })).join("") : `<div class="empty">Nothing due right now.</div>`;
```

with:

```ts
dueCards.innerHTML = dueShown.length ? dueShown.map((i) => cardHTML(i, { selectable, selected: selected.has(i.id), showPin: false })).join("") : `<div class="empty">Nothing due right now.</div>`;
```

(Todos line at 413 already passes `showPin: false` — leave it.)

- [ ] **Step 6: Run the new tests + full suite + typecheck**

Run: `npm test`
Expected: PASS — 119/119 across 14 files (117 prior + 2 new groupByDay tests).

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add src/ui/views.ts src/ui/input.ts tests/unit/views.test.ts
git commit -m "fix(cards): hide pin button on Schedule and Due tabs"
```

---

## Task 3: Build verification

**Files:** none

- [ ] **Step 1: Run the production build**

Run: `npm run build`
Expected: exits 0.

- [ ] **Step 2: If the build fails, fix forward and re-run**

- [ ] **Step 3: Final commit (only if Step 2 produced changes)**

```bash
git add -A
git commit -m "build: verify production bundle after tooltip + pin fixes"
```

---

## Self-Review

1. **Spec coverage:**
   - Tooltip pill style → Task 1.
   - Pin removal from Schedule + Due → Task 2.
   - Existing 117 tests remain green → verified at each task's test step.
   - 2 new tests for `groupByDay` showPin contract → Task 2.

2. **Placeholder scan:** No "TBD", "TODO", "implement later". Every code block is the actual code.

3. **Type consistency:**
   - `groupByDay(items, selectable, cardOpts?: { showPin?: boolean })` declared in Task 2, called from `renderAll` in Task 2. ✅
   - `cardHTML(i, { selectable, ...cardOpts })` — spread of optional opts is safe because `cardHTML` already ignores unknown keys.
