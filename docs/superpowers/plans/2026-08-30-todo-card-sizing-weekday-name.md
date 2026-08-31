# Todo Card Sizing, Star Visibility, Schedule Weekday Name — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix three UI defects on the same screen: (1) compact todo cards to match event-card height, (2) make the 5-star rating widget render on every todo card, (3) show the weekday short name (e.g. `Mon`) inline on every dated schedule event card.

**Architecture:** HTML-only edits inside `src/ui/views.ts` (one new exported helper `weekdayShort`, plus small markup changes in `eventCardHTML` and CSS-only edits in `src/style.css`). No data-model changes; weekday is derived from `datetime` at render time.

**Tech Stack:** TypeScript, Vite, Vitest, jsdom. Tests live in `tests/unit/`. Test command: `npm test`. Typecheck: `npm run typecheck`. Build: `npm run build`.

## Global Constraints

- All `Item` fields used by new code must already exist on the `Item` interface in `src/types.ts:3-16` — do not add new persisted fields.
- `weekdayShort` must handle the empty/invalid-ISO case by returning `""` (same defensive style as `dayKey` in `src/ui/views.ts:209`).
- No inline `style="..."` attributes — the project enforces a strict CSP. All visual treatment must live in `src/style.css`.
- Weekday is derived at render time only; never persisted.
- Star click handler in `src/ui/input.ts:441-458` is already correct — do not modify it.
- Tests must use the existing `mkItemFull` helper style from `tests/unit/views.test.ts:36-45` for any new test cases.
- Commit messages follow the existing prefix style: `feat:`, `fix:`, `style:`, `chore:`, `docs:`, `test:`.

## File Structure

This is a small, focused change. Only two files are modified; no new files are created.

- **Modify:** `src/ui/views.ts` — add `weekdayShort` helper; update `eventCardHTML` to render weekday before time
- **Modify:** `src/style.css` — tighten `.card.todo`, add `.stars { min-width: 0 }`, smaller star size on todo cards, new `.weekday` rule
- **Modify:** `tests/unit/views.test.ts` — add weekday + star-rendering assertions

---

### Task 1: Add `weekdayShort` helper and render weekday in `eventCardHTML`

**Files:**
- Modify: `src/ui/views.ts:1` (add to imports if needed) and `src/ui/views.ts:251-278` (modify `eventCardHTML`)
- Test: `tests/unit/views.test.ts` (extend existing `cardHTML — todo matches Schedule height` describe or add new one)

**Interfaces:**
- Consumes: `Item` shape from `src/types.ts`; `formatClock` from `src/settings`
- Produces: exported `weekdayShort(iso: string): string` returning the locale `weekday: "short"` for a valid ISO string, or `""` for invalid/missing

- [ ] **Step 1: Write failing tests**

Append to `tests/unit/views.test.ts` (below the existing `cardHTML — todo matches Schedule height` block):

```ts
import { weekdayShort } from "../../src/ui/views";

describe("weekdayShort", () => {
  it("returns short weekday for a valid ISO string", () => {
    // 2026-09-07 is a Monday
    expect(weekdayShort("2026-09-07T09:00:00.000Z")).toMatch(/Mon/);
  });
  it("returns empty string for an invalid date", () => {
    expect(weekdayShort("not-a-date")).toBe("");
  });
  it("returns empty string for empty input", () => {
    expect(weekdayShort("")).toBe("");
  });
});

describe("cardHTML — schedule weekday", () => {
  const ev = (o: Partial<Item> = {}): Item => ({
    id: "e", space_token: "s", kind: "event", title: "E",
    datetime: "2026-09-07T09:00:00.000Z", all_day: false,
    reminder: null, status: "pending",
    created_at: "2026-01-01T00:00:00.000Z", order: 0, pinned: false,
    rating: 0, ...o
  });

  it("renders <span class=\"weekday\"> for dated events", () => {
    expect(cardHTML(ev())).toMatch(/<span class="weekday">Mon<\/span>/);
  });
  it("renders weekday + time token for non-all-day events", () => {
    const html = cardHTML(ev());
    expect(html).toMatch(/<span class="weekday">Mon<\/span>[\s\S]*?\d/);
  });
  it("renders weekday + 'all day' for all-day events", () => {
    const html = cardHTML(ev({ all_day: true }));
    expect(html).toMatch(/<span class="weekday">Mon<\/span>[\s\S]*?all day/);
  });
  it("omits weekday for events with no datetime (defensive)", () => {
    const html = cardHTML(ev({ datetime: null }));
    expect(html).not.toContain('<span class="weekday">');
  });
});
```

- [ ] **Step 2: Run the new tests to verify they fail**

Run: `npm test -- views.test.ts`
Expected: FAIL — `weekdayShort` is not exported; `eventCardHTML` does not render `<span class="weekday">`.

- [ ] **Step 3: Implement `weekdayShort` and update `eventCardHTML`**

Edit `src/ui/views.ts`. Add the helper near the other utility functions (after `dayKey`, before `clock`):

```ts
export function weekdayShort(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { weekday: "short" });
}
```

Replace `eventCardHTML` (lines 251-278) with:

```ts
function eventCardHTML(i: Item, opts: { selectable?: boolean; selected?: boolean; showPin?: boolean }): string {
  const isPast = i.kind === "event" && !!i.datetime && new Date(i.datetime) < new Date() && i.status !== "done";
  const wd = i.datetime ? weekdayShort(i.datetime) : "";
  const weekdayPart = wd ? `<span class="weekday">${wd}</span>` : "";
  const time = i.kind === "event" && i.datetime
    ? (i.all_day ? `${weekdayPart}<span class="badge allday">all day</span>` : `${weekdayPart}<span>${clock(i.datetime)}</span>`)
    : "";
  const remind = i.reminder ? `<span class="remind">🔔 ${clock(i.reminder)}</span>` : "";
  const accent = colorFor(i.datetime || i.reminder);
  const accentAttr = accent ? ` data-accent="${accent}"` : "";
  const sel = opts.selectable
    ? `<input type="checkbox" class="sel" ${opts.selected ? "checked" : ""} aria-label="Select ${esc(i.title)}" />`
    : "";
  const pin = opts.showPin === false
    ? ""
    : `<button type="button" class="pin-btn ${i.pinned ? "on" : ""}" title="${i.pinned ? "Unpin" : "Pin"}">${i.pinned ? "📌" : "📍"}</button>`;
  return `<div class="card ${i.status === "done" ? "done" : ""} ${isPast ? "past" : ""} ${opts.selected ? "selected" : ""}" data-id="${i.id}"${accentAttr}>
    ${sel}
    <input type="checkbox" class="check" ${i.status === "done" ? "checked" : ""} aria-label="Complete ${esc(i.title)}" />
    <div class="body">
      <div class="title">${esc(i.title)}</div>
      <div class="meta">
        <span class="badge ${i.kind}">${i.kind}</span>
        ${time}
        ${remind}
      </div>
    </div>
    ${pin}
    <button class="del" title="Delete" aria-label="Delete ${esc(i.title)}">🗑</button>
  </div>`;
}
```

- [ ] **Step 4: Run the new tests to verify they pass**

Run: `npm test -- views.test.ts`
Expected: PASS for both the new `weekdayShort` block and the new `cardHTML — schedule weekday` block.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: PASS — no TS errors.

- [ ] **Step 6: Commit**

```bash
git add src/ui/views.ts tests/unit/views.test.ts
git commit -m "feat: weekday short name on schedule event cards"
```

---

### Task 2: Add `.weekday` CSS rule and middle-dot separator

**Files:**
- Modify: `src/style.css` — add new `.weekday` rule (no existing rule to extend)

**Interfaces:**
- Consumes: existing CSS variables `--ink`, `--faint` from `:root` in `src/style.css:1-21`

- [ ] **Step 1: Write a unit test that pins the CSS file contains `.weekday`**

Append to `tests/unit/views.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("style.css — weekday + todo sizing", () => {
  const css = readFileSync(resolve(__dirname, "../../src/style.css"), "utf8");

  it("defines a .weekday rule", () => {
    expect(css).toMatch(/\.weekday\s*\{/);
  });
  it("renders a middle-dot via .weekday::after", () => {
    expect(css).toMatch(/\.weekday::after\s*\{[^}]*content\s*:\s*"\s*·\s*"/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- views.test.ts`
Expected: FAIL — no `.weekday` rule exists yet.

- [ ] **Step 3: Add `.weekday` CSS rule**

Append to `src/style.css` (end of file):

```css
/* weekday token on schedule event cards */
.weekday {
  font-weight: 600;
  color: var(--ink);
  letter-spacing: .02em;
  margin-right: 4px;
}
.weekday::after { content: " · "; color: var(--faint); margin: 0 2px; font-weight: 400; }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- views.test.ts`
Expected: PASS for both new assertions.

- [ ] **Step 5: Commit**

```bash
git add src/style.css tests/unit/views.test.ts
git commit -m "style: weekday token on schedule event cards"
```

---

### Task 3: Compact todo card and fix star visibility

**Files:**
- Modify: `src/style.css:396-399` — tighten `.card.todo`, remove redundant `.card.todo .meta` override, shrink todo stars, add `min-width: 0` to `.stars`

**Interfaces:**
- Consumes: existing `.card`, `.card.todo`, `.card .meta`, `.stars`, `.stars .star` rules

- [ ] **Step 1: Write failing CSS assertions**

Append to `tests/unit/views.test.ts` (the same `style.css — weekday + todo sizing` describe):

```ts
  it(".card.todo uses compact padding (12px 14px)", () => {
    expect(css).toMatch(/\.card\.todo\s*\{[^}]*padding:\s*12px\s+14px/);
  });
  it(".card.todo centers children vertically", () => {
    expect(css).toMatch(/\.card\.todo\s*\{[^}]*align-items:\s*center/);
  });
  it(".stars has min-width: 0 to prevent overflow", () => {
    expect(css).toMatch(/\.stars\s*\{[^}]*min-width:\s*0/);
  });
  it(".card.todo .stars .star is 18px to fit next to badge", () => {
    expect(css).toMatch(/\.card\.todo\s+\.stars\s+\.star\s*\{[^}]*width:\s*18px[^}]*height:\s*18px/);
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- views.test.ts`
Expected: FAIL — none of these CSS invariants hold yet.

- [ ] **Step 3: Tighten CSS**

Edit `src/style.css`:

Replace the `.card.todo` block at lines 396-399:

```css
/* todo card matches Schedule card height — title on line 1, badge+stars on line 2 */
.card.todo { padding: 12px 14px; align-items: center; }
.card.todo .body { min-width: 0; }
.card.todo .title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 15px; }
.card.todo .meta { gap: 6px 8px; }
```

(Was: `padding: 13px 14px; align-items: flex-start;` plus a separate `.card.todo .meta` redeclaration. The new block drops the redundant meta override and tightens padding + alignment.)

Update the `.stars` rule (line 324):

```css
.stars { display: inline-flex; gap: 0; align-items: center; min-width: 0; }
```

(Was: `gap: 1px;` no `min-width`.)

Append after the existing `.stars .star` block:

```css
.card.todo .stars .star { width: 18px; height: 18px; }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- views.test.ts`
Expected: PASS for all four new CSS assertions and all earlier tests still green.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: PASS (no TS changes in this task, but sanity-check).

- [ ] **Step 6: Commit**

```bash
git add src/style.css tests/unit/views.test.ts
git commit -m "style: compact todo card + visible inline stars"
```

---

### Task 4: Full regression — run all tests and build

**Files:** none modified.

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: ALL PASS — the new weekday/star/todo-sizing assertions plus all pre-existing tests (`applyView`, `applyViewV2`, `cardHTML — todo matches Schedule height`, `filter-panel`, `star`, `star-click`, `store-*`, `backup`, `tokens`).

- [ ] **Step 2: Run the typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Run the production build**

Run: `npm run build`
Expected: PASS — Vite outputs `dist/` without errors.

- [ ] **Step 4: Commit (only if `dist/` changed; usually gitignored — verify)**

```bash
git status
```

If `dist/` is tracked and changed, commit it. Otherwise no commit needed.

- [ ] **Step 5: Final summary commit if any loose changes remain**

If the prior steps surfaced any small fix-ups, commit them individually with a descriptive message. Do not squash the three prior commits.

---

## Self-Review

**1. Spec coverage:**
- Todo card compact → Task 3
- Star visibility fix (CSS-only, no markup change) → Task 3
- Weekday in schedule event badge → Tasks 1 + 2
- Tests for all three → spread across Tasks 1, 2, 3
- Regression check → Task 4

**2. Placeholder scan:** No "TBD", "TODO", or "implement later" anywhere. Every test step has actual code. Every CSS change is shown verbatim.

**3. Type consistency:** `weekdayShort(iso: string): string` is defined in Task 1 and reused (no re-declaration with a different signature). `Item` shape consistent across all tasks via `src/types.ts`. `cardHTML` signature unchanged — only its internals modified in Task 1.

No fixes needed.