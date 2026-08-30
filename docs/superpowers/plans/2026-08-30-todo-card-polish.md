# Todo Card Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make empty stars visible against card backgrounds, add a Reset button inside the filter panel, and restructure todo cards to match Schedule card height.

**Architecture:** Three small, localized changes — (1) extend `starHTML()` to use a visible empty-fill color via a new module constant, (2) extend `mountFilterPanel()` to mount a Reset button into the existing panel template (same surface, gated by the existing `isDefault()` check), (3) restructure `todoCardHTML()` markup and replace the `.card.todo` CSS rules so title sits on line 1 and badge + stars live on line 2 inside a `.meta` row.

**Tech Stack:** Vanilla TypeScript, Vite, Vitest. No new dependencies.

## Global Constraints

- **No new dependencies** — all changes use existing libraries.
- **No schema changes** — purely frontend markup / CSS / DOM-event changes.
- **TypeScript strict mode** — all new code must type-check (`npm run typecheck`).
- **Tests pass** — `npm run test` must be green at every commit.
- **Vitest with jsdom** is available (already in `devDependencies`). Use it for the new filter-panel test.
- **Color tokens** — extend the `:root` block in `src/style.css` rather than hardcoding hex values where a token already exists. For SVG `fill` attributes, use the literal hex (CSS vars don't resolve inside `fill=""` consistently across browsers).
- **Commit style** — repo uses conventional commits (`feat:`, `style:`, `fix:`, `design:`, `plan:`). Group related changes; one commit per task.
- **Plan/spec path** — `docs/superpowers/specs/2026-08-30-todo-card-polish-design.md`.

---

### Task 1: Make empty stars visible (CSS token + view constant + literal replacements)

**Files:**
- Modify: `src/style.css:19` (line only — change `--star-empty` value; leave the rest of `:root` untouched)
- Modify: `src/ui/views.ts:6` (add `STAR_EMPTY_FILL` constant right after `STAR_POLYGON`)
- Modify: `src/ui/views.ts:29` (`.half` base layer — replace literal `#fff8d6`)
- Modify: `src/ui/views.ts:31` (`.half` outline — bump `stroke-width` 1.4 → 1.6)
- Modify: `src/ui/views.ts:36` (`.empty` branch — replace literal `#fff8d6` and bump `stroke-width`)

**Interfaces:**
- Consumes: nothing (this is leaf).
- Produces: exports a new `STAR_EMPTY_FILL` constant from `src/ui/views.ts` (used by tests in Task 2).

- [ ] **Step 1: Update the `--star-empty` CSS token**

Open `src/style.css`. **Change only line 19** — leave the rest of `:root` untouched:

```css
--star-empty: #d8d0bf;  /* was #fff8d6 — softer, visible against cream card bg */
```

The new value `#d8d0bf` matches `--line-strong` so the empty star reads as a soft beige silhouette.

- [ ] **Step 2: Add `STAR_EMPTY_FILL` constant in `views.ts`**

Open `src/ui/views.ts`. After line 6 (`export const STAR_POLYGON = ...;`), add a new line:

```ts
export const STAR_EMPTY_FILL = "#d8d0bf";
```

(Insert it right after `STAR_POLYGON`, before `starSymbolHTML`.)

- [ ] **Step 3: Replace literal `#fff8d6` in the `.half` base layer (line 29)**

Open `src/ui/views.ts`. In `starHTML()`, find the `.half` branch (around lines 27–33). The base layer `<use>` element uses `fill="#fff8d6"`. Change it to:

```ts
<use href="#${STAR_SYMBOL_ID}" fill="${STAR_EMPTY_FILL}" stroke="none"/>
```

- [ ] **Step 4: Bump `.half` outline stroke-width (line 31)**

In the same `.half` branch, the trailing outline `<use>` element uses `stroke-width="1.4"`. Change to:

```ts
<use href="#${STAR_SYMBOL_ID}" fill="none" stroke="#3a2e10" stroke-width="1.6" stroke-linejoin="round"/>
```

- [ ] **Step 5: Replace literal `#fff8d6` in the `.empty` branch (line 36)**

In the `.empty` branch (around lines 35–37), the `<use>` element uses `fill="#fff8d6"` and `stroke-width="1.4"`. Change to:

```ts
<use href="#${STAR_SYMBOL_ID}" fill="${STAR_EMPTY_FILL}" stroke="#3a2e10" stroke-width="1.6" stroke-linejoin="round"/>
```

The `.full` branch (line 23–25) and the gold `rect` overlay (line 30) are unchanged.

- [ ] **Step 6: Run typecheck**

Run: `npm run typecheck`
Expected: PASS (no type errors).

- [ ] **Step 7: Run existing star tests**

Run: `npm run test -- tests/unit/star.test.ts`
Expected: PASS — all existing `starHTML` tests still pass (they assert star class counts, not colors).

- [ ] **Step 8: Commit**

```bash
git add src/style.css src/ui/views.ts
git commit -m "style: visible empty-star fill (soft beige, bolder outline)"
```

---

### Task 2: Add unit test asserting the new empty-star fill

**Files:**
- Modify: `tests/unit/star.test.ts` (append a new `describe` block)

**Interfaces:**
- Consumes: `STAR_EMPTY_FILL` exported from `src/ui/views.ts` (Task 1).

- [ ] **Step 1: Append a `describe("starHTML — visible empty fill")` block**

Open `tests/unit/star.test.ts`. After the existing `describe("starSymbolHTML")` block (ends around line 64), append:

```ts
import { STAR_EMPTY_FILL } from "../../src/ui/views";

describe("starHTML — visible empty fill", () => {
  it("renders empty stars using STAR_EMPTY_FILL (not the old near-white cream)", () => {
    const h = starHTML(0, "x");
    expect(h).toContain(`fill="${STAR_EMPTY_FILL}"`);
    expect(h).not.toContain("#fff8d6");
  });

  it("renders half stars with STAR_EMPTY_FILL as the underlying base", () => {
    const h = starHTML(2.5, "x");
    expect(h).toContain(`fill="${STAR_EMPTY_FILL}"`);
    expect(h).not.toContain("#fff8d6");
  });

  it("uses the bumped stroke-width 1.6 on empty stars", () => {
    const h = starHTML(0, "x");
    expect(h).toContain('stroke-width="1.6"');
    expect(h).not.toContain('stroke-width="1.4"');
  });
});
```

The new import sits below the existing imports. Re-declaring the import is fine — vitest/vite dedupe ESM imports per spec.

- [ ] **Step 2: Run the new tests**

Run: `npm run test -- tests/unit/star.test.ts`
Expected: PASS — all 3 new assertions green.

- [ ] **Step 3: Commit**

```bash
git add tests/unit/star.test.ts
git commit -m "test: assert empty-star fill is the new visible color"
```

---

### Task 3: Add Reset button to filter panel (markup + handler + visibility hook)

**Files:**
- Modify: `src/ui/filterPanel.ts:120-164` (extend `drawPanel()`)
- Modify: `src/ui/filterPanel.ts:171-173` (extend `refreshPill()`)

**Interfaces:**
- Consumes: existing `DEFAULTS` (lines 8–12), existing `isDefault()` (lines 82–84).
- Produces: a `<button class="reset" hidden>Reset filters</button>` inside `.filter-panel`, toggled by `refreshPill()`.

- [ ] **Step 1: Add the Reset button to the panel template**

Open `src/ui/filterPanel.ts`. In `drawPanel()` (starts line 108), find the closing of the panel template string (around line 137, just after the `.sort-row` block). The current closing is:

```ts
      <div class="sort-row">
        <span class="label">Sort</span>
        <select aria-label="Sort">${sortOptionsHTML}</select>
        <button type="button" class="reverse" title="Reverse sort direction" aria-label="Reverse sort direction">↑↓</button>
      </div>
    `;
```

Change the closing to insert the Reset button after the sort-row:

```ts
      <div class="sort-row">
        <span class="label">Sort</span>
        <select aria-label="Sort">${sortOptionsHTML}</select>
        <button type="button" class="reverse" title="Reverse sort direction" aria-label="Reverse sort direction">↑↓</button>
      </div>
      <button type="button" class="reset" hidden>Reset filters</button>
    `;
```

- [ ] **Step 2: Add the click handler in `drawPanel()`**

Inside `drawPanel()`, after the existing `reverse` handler binding (around line 163, where the function ends with `};`), add:

```ts
    panel.querySelector<HTMLButtonElement>(".reset")!.onclick = () => {
      state = JSON.parse(JSON.stringify(DEFAULTS[viewKey]));
      drawPanel();
      emit();
    };
```

- [ ] **Step 3: Extend `refreshPill()` to toggle the reset button**

Find `refreshPill()` (lines 171–173):

```ts
  function refreshPill() {
    pill.querySelector(".dot")!.toggleAttribute("hidden", isDefault(state, viewKey));
  }
```

Replace with:

```ts
  function refreshPill() {
    const dirty = !isDefault(state, viewKey);
    pill.querySelector(".dot")!.toggleAttribute("hidden", dirty);
    const resetBtn = panel.querySelector<HTMLButtonElement>(".reset");
    if (resetBtn) resetBtn.hidden = !dirty;
  }
```

(The `if (resetBtn)` guard handles the brief moment before `drawPanel()` mounts the button on first call — `refreshPill()` is invoked at the bottom of `mountFilterPanel()` after `drawPanel()`, so in practice the button exists. The guard is cheap insurance.)

- [ ] **Step 4: Run typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ui/filterPanel.ts
git commit -m "feat: reset filters button inside filter panel"
```

---

### Task 4: Style the Reset button

**Files:**
- Modify: `src/style.css` (append after the `.filter-panel .sort-row .label` rule around line 365)

**Interfaces:**
- Consumes: the `<button class="reset">` element from Task 3.

- [ ] **Step 1: Append the Reset button CSS**

Open `src/style.css`. Find the `.filter-panel .sort-row .label` block (around line 365). After it, append:

```css
.filter-panel .reset {
  align-self: flex-start;
  appearance: none; border: 1px solid var(--line); background: var(--paper);
  color: var(--muted); padding: 6px 12px; border-radius: 999px;
  font: inherit; font-size: 12.5px; cursor: pointer;
  transition: color .15s, border-color .15s, background .15s;
}
.filter-panel .reset:hover { color: var(--ink); border-color: var(--line-strong); background: var(--panel); }
.filter-panel .reset:focus-visible { outline: 2px solid var(--ink); outline-offset: 2px; }
```

- [ ] **Step 2: Run typecheck + tests**

Run: `npm run typecheck && npm run test`
Expected: PASS (CSS has no type-check impact; existing tests unaffected).

- [ ] **Step 3: Commit**

```bash
git add src/style.css
git commit -m "style: reset button inside filter panel"
```

---

### Task 5: Add a JSDOM unit test for the Reset button

**Files:**
- Create: `tests/unit/filter-panel.test.ts`

**Interfaces:**
- Consumes: `mountFilterPanel()` from `src/ui/filterPanel.ts` (Tasks 3–4).

- [ ] **Step 1: Write the test file**

Create `tests/unit/filter-panel.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { JSDOM } from "jsdom";
import { mountFilterPanel, type ScheduleState, type TodosState, type DueState } from "../../src/ui/filterPanel";

type AnyState = ScheduleState | TodosState | DueState;

function mountWith(initial: AnyState, viewKey: "schedule" | "todos" | "due") {
  const dom = new JSDOM(`<!DOCTYPE html><html><body><div id="host"></div></body></html>`);
  // jsdom doesn't implement document body globally for the imported module, so swap it in.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).window = dom.window;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).document = dom.window.document;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).HTMLElement = dom.window.HTMLElement;
  const host = dom.window.document.getElementById("host")!;
  let captured: AnyState | null = null;
  const panel = mountFilterPanel({
    viewKey,
    initial,
    host: host as unknown as HTMLElement,
    onChange: (s) => { captured = JSON.parse(JSON.stringify(s)); }
  });
  return { dom, host, panel, getState: () => captured };
}

describe("filter panel — reset button", () => {
  let defaults: AnyState;
  let viewKey: "schedule" | "todos" | "due";

  beforeEach(() => {
    // Use schedule defaults for the test (most variety in default state)
    viewKey = "schedule";
    defaults = {
      search: "",
      filters: { timeRange: "all", status: "all" },
      sort: "date",
      dir: "asc"
    };
  });

  it("hides the Reset button when state matches defaults", () => {
    const { host } = mountWith(defaults, viewKey);
    const reset = host.querySelector(".reset") as HTMLButtonElement;
    expect(reset.hidden).toBe(true);
  });

  it("shows the Reset button after a chip is mutated", () => {
    const { host, panel } = mountWith(defaults, viewKey);
    panel.setState({ search: "", filters: { timeRange: "today", status: "all" }, sort: "date", dir: "asc" });
    const reset = host.querySelector(".reset") as HTMLButtonElement;
    expect(reset.hidden).toBe(false);
  });

  it("clicking Reset returns the state to defaults", () => {
    const { host, panel, getState } = mountWith(defaults, viewKey);
    panel.setState({ search: "x", filters: { timeRange: "today", status: "done" }, sort: "title", dir: "desc" });
    const reset = host.querySelector(".reset") as HTMLButtonElement;
    reset.click();
    const state = getState();
    expect(state).toEqual(defaults);
    expect((host.querySelector(".reset") as HTMLButtonElement).hidden).toBe(true);
  });

  it("clicking Reset does not close the panel", () => {
    const { host, panel } = mountWith(defaults, viewKey);
    panel.open();
    panel.setState({ search: "x", filters: { timeRange: "today", status: "all" }, sort: "date", dir: "asc" });
    const reset = host.querySelector(".reset") as HTMLButtonElement;
    reset.click();
    // panel.open() was called; reset should NOT collapse it.
    // The internal `open_` flag is checked indirectly via aria-expanded.
    const pill = host.querySelector(".filter-pill") as HTMLButtonElement;
    expect(pill.getAttribute("aria-expanded")).toBe("true");
  });
});
```

If `mountFilterPanel` is not exported from `src/ui/filterPanel.ts`, see Step 2 — it must be exported. If the test fails because `drawPanel()` uses `document.addEventListener` which is fine in jsdom, proceed. If `JSON.parse(JSON.stringify(DEFAULTS[viewKey]))` requires DEFAULTS to be exported, see Step 2 — it must be exported too.

- [ ] **Step 2: Ensure `mountFilterPanel` and `DEFAULTS` are exported (if needed)**

Open `src/ui/filterPanel.ts`. Check the existing export:

```ts
export function mountFilterPanel(opts: { ... }): { setState, open, close } {
```

Already exported — fine.

The `DEFAULTS` object (lines 8–12) is module-private. The reset handler inside `drawPanel()` uses it directly so this is fine. The test uses its own copy of the defaults — no need to export. **Skip this step if Step 1 passes.**

- [ ] **Step 3: Run the new tests**

Run: `npm run test -- tests/unit/filter-panel.test.ts`
Expected: PASS — all 4 new assertions green.

If a test fails with "HTMLElement is not defined" or similar global-not-set errors, the JSDOM bootstrap in `mountWith` is incomplete. Add additional globals as needed:

```ts
(globalThis as any).HTMLInputElement = dom.window.HTMLInputElement;
(globalThis as any).HTMLButtonElement = dom.window.HTMLButtonElement;
(globalThis as any).HTMLSelectElement = dom.window.HTMLSelectElement;
```

- [ ] **Step 4: Run the full test suite**

Run: `npm run test`
Expected: PASS — all tests green (old + new).

- [ ] **Step 5: Commit**

```bash
git add tests/unit/filter-panel.test.ts src/ui/filterPanel.ts
git commit -m "test: filter panel reset button behavior"
```

---

### Task 6: Restructure todo card markup to two-line layout

**Files:**
- Modify: `src/ui/views.ts:230-247` (replace `todoCardHTML()`)

**Interfaces:**
- Consumes: existing `Item` type, existing `starHTML()`.
- Produces: a two-line todo card markup (title on line 1, `.meta` row containing badge + stars on line 2). The card uses the same outer flex row as Schedule cards.

- [ ] **Step 1: Replace `todoCardHTML()`**

Open `src/ui/views.ts`. Find `todoCardHTML()` (lines 230–247). Replace the entire function with:

```ts
function todoCardHTML(i: Item, opts: { selectable?: boolean; selected?: boolean }): string {
  const accent = colorFor(i.datetime || i.reminder);
  const accentAttr = accent ? ` data-accent="${accent}"` : "";
  const sel = opts.selectable
    ? `<input type="checkbox" class="sel" ${opts.selected ? "checked" : ""} aria-label="Select ${esc(i.title)}" />`
    : "";
  return `<div class="card todo ${i.status === "done" ? "done" : ""} ${opts.selected ? "selected" : ""}" data-id="${i.id}"${accentAttr}>
    ${sel}
    <input type="checkbox" class="check" ${i.status === "done" ? "checked" : ""} aria-label="Complete ${esc(i.title)}" />
    <div class="body">
      <div class="title">${esc(i.title)}</div>
      <div class="meta">
        <span class="badge todo">todo</span>
        ${starHTML(i.rating, i.id)}
      </div>
    </div>
    <button class="del" title="Delete" aria-label="Delete ${esc(i.title)}">🗑</button>
  </div>`;
}
```

(Adds the `.meta` div inside `.body`, moves the badge and stars into it.)

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Run existing views tests**

Run: `npm run test -- tests/unit/views.test.ts`
Expected: at least one FAIL — the existing "compact todo" tests assert the *old* single-line structure (e.g. `expect(html).not.toContain("class=\"meta\"")`). This is expected; we'll fix them in Task 7.

- [ ] **Step 4: Commit (markup change ships even though tests fail — they're updated next)**

```bash
git add src/ui/views.ts
git commit -m "feat: todo card two-line layout (title + meta row)"
```

---

### Task 7: Update existing todo card tests for the new layout

**Files:**
- Modify: `tests/unit/views.test.ts:101-126` (replace the `describe("cardHTML — compact todo")` block)

**Interfaces:**
- Consumes: `cardHTML()` from `src/ui/views.ts` (Task 6).

- [ ] **Step 1: Replace the "compact todo" describe block**

Open `tests/unit/views.test.ts`. Find the `describe("cardHTML — compact todo")` block (lines 101–126). Replace it with:

```ts
describe("cardHTML — todo matches Schedule height", () => {
  const todo = (): Item => ({
    id: "x", space_token: "s", kind: "todo", title: "T",
    datetime: null, all_day: false, reminder: null, status: "pending",
    created_at: "2026-01-01T00:00:00.000Z", order: 0, pinned: false, rating: 0
  });

  it("does not include the drag handle", () => {
    expect(cardHTML(todo())).not.toContain("drag-h");
  });

  it("renders title inside .body on line 1", () => {
    const html = cardHTML(todo());
    expect(html).toMatch(/<div class="body">\s*<div class="title">T<\/div>/);
  });

  it("renders the badge inside .meta on line 2", () => {
    const html = cardHTML(todo());
    expect(html).toMatch(/<div class="meta">[\s\S]*<span class="badge todo">todo<\/span>[\s\S]*<\/div>/);
  });

  it("renders the stars container inside .meta", () => {
    const html = cardHTML(todo());
    expect(html.replace(/\s+/g, " ")).toContain(
      '<div class="meta"> <span class="badge todo">todo</span> <span class="stars"'
    );
  });

  it("keeps the check and delete buttons outside .body", () => {
    const html = cardHTML(todo());
    const bodyIdx = html.indexOf('<div class="body">');
    const checkIdx = html.indexOf('<input type="checkbox" class="check"');
    const delIdx = html.indexOf('<button class="del"');
    expect(checkIdx).toBeGreaterThan(-1);
    expect(checkIdx).toBeLessThan(bodyIdx);
    expect(delIdx).toBeGreaterThan(bodyIdx);
  });
});
```

(Replaces the 3 old tests with 5 new ones that assert the two-line structure. The `todo()` helper removes the duplicated item object.)

- [ ] **Step 2: Run the views tests**

Run: `npm run test -- tests/unit/views.test.ts`
Expected: PASS — all 5 new assertions green.

- [ ] **Step 3: Run the full test suite**

Run: `npm run test`
Expected: PASS — all tests green.

- [ ] **Step 4: Commit**

```bash
git add tests/unit/views.test.ts
git commit -m "test: todo card two-line structure"
```

---

### Task 8: Replace `.card.todo` CSS to match Schedule card height

**Files:**
- Modify: `src/style.css:385-390` (replace the `.card.todo` rules)

**Interfaces:**
- Consumes: the new `.meta` row inside `.body` from Task 6.

- [ ] **Step 1: Replace the `.card.todo` CSS rules**

Open `src/style.css`. Find the `.card.todo` block (lines 385–390):

```css
/* compact todo card */
.card.todo { padding: 8px 14px; align-items: center; }
.card.todo .body { display: flex; align-items: center; gap: 10px; min-width: 0; }
.card.todo .title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.card.todo .badge.todo { order: 1; }
.card.todo .stars { order: 2; flex: none; }
.card.todo .del { order: 3; margin-left: 4px; }
```

Replace with:

```css
/* todo card matches Schedule card height — title on line 1, badge+stars on line 2 */
.card.todo { padding: 13px 14px; align-items: flex-start; }
.card.todo .body { min-width: 0; }
.card.todo .title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.card.todo .meta { font-size: 13px; color: var(--muted); margin-top: 3px; display: flex; flex-wrap: wrap; gap: 6px 10px; align-items: center; }
```

- [ ] **Step 2: Run typecheck + tests**

Run: `npm run typecheck && npm run test`
Expected: PASS. (CSS has no type-check impact; tests don't assert computed styles.)

- [ ] **Step 3: Commit**

```bash
git add src/style.css
git commit -m "style: todo card matches schedule card height"
```

---

### Task 9: End-to-end manual verification

**Files:** none (verification only)

- [ ] **Step 1: Start the dev server**

Run: `npm run dev`

- [ ] **Step 2: Verify hidden filter defaults**

Open the URL Vite prints (usually `http://localhost:5173`). Switch to the **Todos** tab. The "⇅ Filter & sort" pill is visible at the right of the top bar; the panel itself is hidden. Click the pill — panel opens. Click outside the panel — panel closes. Press `Escape` — panel closes.

- [ ] **Step 3: Verify Reset button**

Click the pill to open the panel. Click the "Priority" chip → "★3+". The Reset button appears at the bottom of the panel and a small dot appears on the pill. Click Reset — chips return to "All", the Reset button hides, and the dot disappears. The panel stays open.

- [ ] **Step 4: Verify visible stars**

Switch to the Todos tab. With no rating, every todo shows five outlined soft-beige stars. Click the third star — three stars turn gold. Click the same star with Shift held — all five return to soft beige.

- [ ] **Step 5: Verify todo card height**

Each todo card is now ~60–65px tall. Title sits on the first line. The `todo` badge and the star row sit on the second line. The same vertical footprint as a Schedule card.

- [ ] **Step 6: Verify long-title truncation**

Add a todo titled `"This is a very long todo title that should definitely overflow and truncate with an ellipsis on the first line of the card"`. Confirm the title truncates with `…` on line 1, and the badge + stars wrap naturally on line 2 (no horizontal scroll).

- [ ] **Step 7: Verify Reset clears search**

Open the panel. Type "x" into the search box. The Reset button appears. Click Reset — the search box is empty, chips return to defaults, the Reset button hides, and the dot on the pill disappears.

- [ ] **Step 8: Stop the dev server**

Press `Ctrl+C` in the terminal running `npm run dev`.

- [ ] **Step 9: Commit (no code changes — verification log only)**

If you observed any visual issue during Steps 2–7, fix it and amend the prior commits. Otherwise, no commit is needed.

---

### Task 10: Build verification

**Files:** none (verification only)

- [ ] **Step 1: Run the production build**

Run: `npm run build`
Expected: PASS — TypeScript compiles and Vite emits `dist/`. The build script is `tsc --noEmit && vite build`, so any type error fails the build.

- [ ] **Step 2: Confirm no test regressions**

Run: `npm run test`
Expected: PASS — all tests green.

- [ ] **Step 3: Confirm no leftover artifacts**

Run: `git status`
Expected: clean working tree (modulo the untracked files already present from prior commits: `-w`, `.playwright-mcp/`, `.scratch/`, `.superpowers/`, `docs/research/`).

- [ ] **Step 4: Optional — push to origin**

Skip unless the user requests. (Per AGENTS.md: "Only commit, amend, push, or create PRs when explicitly requested.")

---

## Self-Review

**Spec coverage:**

| Spec section | Implemented by |
|--------------|----------------|
| 1. Filter panel hidden by default (no code change) | None needed — documented in Task 9 Step 2 manual check. |
| 2. Reset filters button — markup + handler + visibility + styles | Tasks 3, 4, 5 |
| 3. Visible stars — CSS token + view constant + literal replacements | Tasks 1, 2 |
| 4. Todo card matches Schedule height — markup + CSS + tests | Tasks 6, 7, 8 |
| Edge cases (Reset clears search, Reset keeps panel open, stars on done, long titles truncate) | Task 9 manual verification + Tests in Task 7 |
| Out of scope (pill hidden, half-star clip-path bug, etc.) | Not implemented; consistent with spec |

No spec gaps.

**Placeholder scan:**

- No "TBD", "TODO", "implement later" anywhere.
- Task 5 contains the actual test code, not "write tests for the above".
- Task 7 contains the actual test code.
- All file paths are exact (`src/style.css:18-20`, etc.).

**Type consistency:**

- `STAR_EMPTY_FILL` exported from `src/ui/views.ts` (Task 1) is imported in `tests/unit/star.test.ts` (Task 2) — names match.
- `mountFilterPanel` exported from `src/ui/filterPanel.ts` — used by `tests/unit/filter-panel.test.ts` (Task 5).
- `cardHTML` exported from `src/ui/views.ts` — used by both `tests/unit/views.test.ts` (Task 7) and unchanged callers.
- The new `.reset` class name in HTML (Task 3) matches the CSS selector (Task 4).

No type or naming drift.