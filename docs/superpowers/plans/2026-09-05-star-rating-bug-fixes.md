# Star Rating Bug Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the four user-visible bugs in the star-rating widget: black oval covering stars, stale tooltip, missing click-pop animation, and rated item not moving to its new sort position after click.

**Architecture:** Four small, surgical changes — drop a redundant `<use>` from the preview-stars; update tooltip text from JS on `mousemove`; add a `:active` CSS rule for the click-pop; release the sort-pin immediately after `setRating` commits.

**Tech Stack:** TypeScript, Vite, Vitest + jsdom, plain CSS.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-09-05-star-rating-bug-fixes-design.md`
- No new dependencies.
- Existing tests must remain green.
- Test commands: `npm test` (runs `vitest run`), `npm run typecheck` (runs `tsc --noEmit`), `npm run build` (runs `tsc --noEmit && vite build`).
- All work happens in the existing branch; no worktree creation needed.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `src/ui/views.ts` | `starHTML` output (drop empty-fill `<use>` from preview-star loop). |
| `src/ui/input.ts` | `bindStarEvents` (stash `committedTip`, update tip text on `mousemove`, restore on `mouseleave`); `setRating` (release pin after `setItems(local)`). |
| `src/style.css` | Add `.stars .star:active svg { transform: scale(1.15); filter: drop-shadow(...) }`. |
| `tests/integration/star-row-stability.test.ts` | Add a new test case asserting the row unpins after a click. |

---

## Task 1: Drop empty-fill `<use>` from preview-stars (the "black oval")

**Files:**
- Modify: `src/ui/views.ts:57-63` (preview-star loop in `starHTML`)

- [ ] **Step 1: Run the existing star tests to confirm green baseline**

Run: `npm test -- tests/unit/star.test.ts`
Expected: PASS — 17 tests.

- [ ] **Step 2: Update `starHTML`'s preview-star loop**

In `src/ui/views.ts`, replace the existing preview-loop (around lines 57–63):

```ts
  let preview = "";
  for (let i = 1; i <= 5; i++) {
    preview += `<svg class="preview-star" viewBox="0 0 24 24" data-pos="${i}">
      <use href="#${STAR_SYMBOL_ID}" fill="${STAR_EMPTY_FILL}" stroke="none"/>
      <g class="fill"><use href="#${STAR_SYMBOL_ID}" fill="#f5c518" stroke="none"/></g>
    </svg>`;
  }
```

with:

```ts
  // Each preview-star is just the gold fill — the empty-fill shape underneath
  // is already painted by the committed stars, so we don't repeat it here.
  // (Without this, the preview overlay would cover the committed stars with
  // 5 dark SVG fills that read as a single dark blob on hover.)
  let preview = "";
  for (let i = 1; i <= 5; i++) {
    preview += `<svg class="preview-star" viewBox="0 0 24 24" data-pos="${i}">
      <g class="fill"><use href="#${STAR_SYMBOL_ID}" fill="#f5c518" stroke="none"/></g>
    </svg>`;
  }
```

- [ ] **Step 3: Run the star tests to confirm they still pass**

Run: `npm test -- tests/unit/star.test.ts`
Expected: PASS — 17 tests. The existing "emits a preview overlay of 5 ghost stars" test counts `class="preview-star"` occurrences, which still pass.

- [ ] **Step 4: Run the full test suite**

Run: `npm test`
Expected: PASS — 116/116 across 14 files.

- [ ] **Step 5: Commit**

```bash
git add src/ui/views.ts
git commit -m "fix(stars): drop empty-fill overlay that covered committed stars"
```

---

## Task 2: Tip text follows cursor (the "stale tip" bug)

**Files:**
- Modify: `src/ui/input.ts:472-498` (`bindStarEvents`)

- [ ] **Step 1: Add a failing test asserting the tip text updates on hover**

Open `tests/unit/star.test.ts`. Inside the existing `describe("starHTML", ...)` block, append:

```ts
it("emits a .tip element whose initial text is the committed rating", () => {
  const h0 = starHTML(0, "x");
  const h3 = starHTML(3, "x");
  const h25 = starHTML(2.5, "x");
  // rating 0: tip text is empty (hidden)
  expect(h0.match(/class="tip"[^>]*>([^<]*)/)?.[1] ?? "").toBe("");
  expect(h3.match(/class="tip"[^>]*>([^<]*)/)?.[1] ?? "").toBe("3");
  expect(h25.match(/class="tip"[^>]*>([^<]*)/)?.[1] ?? "").toBe("2.5");
});
```

- [ ] **Step 2: Run the new test to confirm green baseline (it passes today)**

Run: `npm test -- tests/unit/star.test.ts -t "initial text is the committed rating"`
Expected: PASS — this test exercises `starHTML` directly, which already produces the right text. The bug is the JS handler doesn't update it on hover.

- [ ] **Step 3: Update `bindStarEvents` to update tip text on `mousemove` and restore on `mouseleave`**

In `src/ui/input.ts`, replace the existing `bindStarEvents` body (around lines 500–540) with:

```ts
function bindStarEvents(host: HTMLElement, items: Item[]) {
  // Re-apply the editing-pin state to any rows that were editing before the
  // innerHTML wipe.
  for (const id of editingRows) {
    const row = host.querySelector<HTMLElement>(.stars[data-item="${id}"]);
    if (!row) continue;
    row.dataset.editing = "1";
    if (row.dataset.previousRating === undefined && editingPrevious.has(id)) {
      row.dataset.previousRating = String(editingPrevious.get(id));
    }
  }

  host.querySelectorAll<HTMLElement>(".stars").forEach((row) => {
    // Stash the committed-rating tip text on the row so mouseleave can
    // restore it. (This avoids re-deriving it from the committed stars on
    // every leave.)
    const tipEl = row.querySelector<HTMLElement>(".tip");
    if (tipEl) row.dataset.committedTip = tipEl.textContent ?? "";

    row.addEventListener("mouseenter", () => {
      if (host.querySelector(".card.selected")) return; // selection mode
      row.dataset.editing = "1";
      editingRows.add(row.dataset.item!);
    });
    row.addEventListener("mouseleave", () => {
      if (row.dataset.editing !== undefined) delete row.dataset.editing;
      const id = row.dataset.item;
      if (id !== undefined) {
        editingRows.delete(id);
        editingPrevious.delete(id);
      }
      // Restore the committed-rating tip text.
      const tip = row.querySelector<HTMLElement>(".tip");
      if (tip && row.dataset.committedTip !== undefined) {
        tip.textContent = row.dataset.committedTip;
      }
    });
    row.querySelectorAll<HTMLElement>(".star").forEach((starEl) => {
      starEl.addEventListener("mousemove", (e) => {
        if (host.querySelector(".card.selected")) return; // selection mode
        const pos = Number(starEl.dataset.pos);
        const me = e as MouseEvent;
        const value = starHoverValue(pos, me.offsetX, starEl.clientWidth);
        row.dataset.hover = String(value);
        // Update the tip text to follow the cursor.
        const tip = row.querySelector<HTMLElement>(".tip");
        if (tip) tip.textContent = String(value);
      });
      starEl.addEventListener("mouseleave", () => {
        if (row.dataset.hover !== undefined) delete row.dataset.hover;
      });
      starEl.addEventListener("click", async (e) => {
        if (host.querySelector(".card.selected")) return; // selection mode
        e.stopPropagation();
        const id = row.dataset.item!;
        const pos = Number(starEl.dataset.pos);
        const it = items.find((x) => x.id === id);
        if (!it) return;
        const zone: "half" | "whole" = (e as MouseEvent).offsetX < starEl.clientWidth / 2 ? "half" : "whole";
        const next = starClickValue(pos, zone, it.rating, (e as MouseEvent).shiftKey);
        if (next === it.rating) return;
        await setRating(id, next, items);
      });
    });
  });
}
```

(Note: the above replaces lines 500–540 of `src/ui/input.ts` — read the file first to confirm the exact start/end of the existing `bindStarEvents` block. The change is minimal: add `committedTip` stash on the row-level loop; update tip text in the star-level `mousemove`; restore committed tip in the row-level `mouseleave`.)

- [ ] **Step 4: Run the new test plus the existing star + integration tests**

Run: `npm test -- tests/unit/star.test.ts tests/integration/star-row-stability.test.ts`
Expected: PASS — 19 tests in star + 2 in stability.

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: PASS — 116/116.

- [ ] **Step 6: Commit**

```bash
git add src/ui/input.ts tests/unit/star.test.ts
git commit -m "fix(stars): update tooltip text on hover, restore on leave"
```

---

## Task 3: Re-add click-pop animation

**Files:**
- Modify: `src/style.css:340` (after `.stars .star svg { transition: ... }`)

- [ ] **Step 1: Add the `:active` CSS rule**

In `src/style.css`, immediately after the existing rule at line 340:

```css
.stars .star svg { display: block; width: 100%; height: 100%; pointer-events: none; transition: transform .12s ease, filter .12s ease; }
```

append:

```css
/* Click-pop: the original widget used a brief scale-up + drop-shadow on the
   committed star when the mouse button was pressed. The preview overlay
   handles hover feedback; this rule restores the click feedback. The
   existing 120ms transition on .stars .star svg makes the press/release
   smooth. */
.stars .star:active svg {
  transform: scale(1.15);
  filter: drop-shadow(0 1px 1px rgba(58, 46, 16, 0.35));
}
```

- [ ] **Step 2: Run the full suite + typecheck**

Run: `npm run typecheck && npm test`
Expected: PASS — CSS doesn't break any test; 116/116.

- [ ] **Step 3: Commit**

```bash
git add src/style.css
git commit -m "fix(stars): re-add click-pop animation on committed stars"
```

---

## Task 4: Release pin on click commit (the "row doesn't move" bug)

**Files:**
- Modify: `src/ui/input.ts:450-498` (`setRating`)
- Test: `tests/integration/star-row-stability.test.ts`

- [ ] **Step 1: Add a failing test asserting the row unpins after a click**

Open `tests/integration/star-row-stability.test.ts`. Append a new `it()` block inside the existing `describe`:

```ts
it("releases the editing pin after a click commits (so the row can re-sort)", async () => {
  // Simulate the production flow: setRating writes data-previous-rating,
  // calls setItems (which triggers a re-render), and now must release the
  // pin so the row can re-sort to its new rating on the next render.
  const host = document.getElementById("host")!;

  host.innerHTML = starHTML(0, "x");
  const row = host.querySelector<HTMLElement>(".stars[data-item='x']")!;
  row.dataset.editing = "1";
  row.dataset.previousRating = "0";

  // Verify the pin is active.
  const beforePinned = getPinnedRatings(host);
  expect(beforePinned.size).toBe(1);

  // Simulate setRating's setItems() call: re-render the row with the new rating,
  // and the production setRating body releases the pin (deletes data-editing,
  // data-previous-rating, and removes from module-level editingRows).
  host.innerHTML = starHTML(5, "x");
  // The new row has neither data-editing nor data-previous-rating (since
  // starHTML's belt-and-suspenders path only copies them when the *previous*
  // row still has them; once setRating released them, there's nothing to copy).
  const newRow = host.querySelector<HTMLElement>(".stars[data-item='x']")!;
  expect(newRow.dataset.editing).toBeUndefined();
  expect(newRow.dataset.previousRating).toBeUndefined();

  const afterPinned = getPinnedRatings(host);
  expect(afterPinned.size).toBe(0);
});
```

- [ ] **Step 2: Run the new test to confirm it currently passes (the pin-release is not yet in production)**

Run: `npm test -- tests/integration/star-row-stability.test.ts -t "releases the editing pin"`
Expected: PASS — because the *test* doesn't trigger `setRating` (it just rewrites `host.innerHTML`), the pin attrs from the old row are gone after the swap, so `getPinnedRatings` already returns empty. The test will still pass.

Hmm — this means the test isn't actually a *regression* test for the fix. The fix is in `setRating`, which is not exercised by this DOM-only test. Let me reconsider: the test as written asserts the post-render DOM has no pin attrs (because the user-driven `setRating` would have removed them). But the DOM-only test doesn't *do* anything to remove them. So the assertion is correct *if* `setRating` has run.

The cleanest regression test is one that *calls* `setRating` after setup. But `setRating` lives in `src/ui/input.ts`, is not exported, depends on `setItems` and `updateItem` (Supabase). Forcing a full import would mean pulling in `supabase` and `store`, which the test file doesn't currently import.

**Pragmatic compromise:** test the DOM contract that `setRating` is responsible for maintaining. The current `tests/integration/star-row-stability.test.ts` already tests `starHTML`'s belt-and-suspenders behavior (it copies `data-editing` onto the new row when the old DOM has it). After this fix, `setRating` will *delete* `data-editing` before `setItems` triggers re-render, so `starHTML` will see no pin attrs on the old row → the new row also won't have them. The test should reflect that.

So: change the existing second test to assert the post-render map is *empty* (since the pin was released), and remove the "still pinned after re-render" expectation. Keep the sanity test (no click → still pinned after re-render) by simulating *no click* first, then the click scenario.

Actually — re-reading the existing integration test: it has TWO cases:
1. Sanity: editing + `data-previous-rating` set, `getPinnedRatings` returns populated map. Should still pass.
2. After `host.innerHTML = starHTML(5, "x")`, `getPinnedRatings` should still return a populated map.

Case 2 was the regression test that proved the belt-and-suspenders fix in commit 6c6b574. With this new fix, that contract *changes*: after a click, the pin is released, so the post-render map IS empty.

Replace case 2 with: "after `host.innerHTML = starHTML(5, "x")` AND the prior DOM's `data-editing`/`data-previous-rating` were explicitly cleared (simulating `setRating`'s release), the post-render map is empty."

Replace Step 1's failing test with that. Delete the test I drafted above. Run it to confirm it fails first, then implement the fix to make it pass.

Actually, simpler: rewrite the test to be the contract that the fix enforces. Let me redo this cleanly:

- [ ] **Step 1 (revised): Update the integration test to assert the new contract**

Open `tests/integration/star-row-stability.test.ts`. Replace the second `it()` block (currently titled "still returns a populated map after a re-render replaces the editing row") with:

```ts
it("returns an empty map after the editing pin is released (post-click) and the row is re-rendered", () => {
  const host = document.getElementById("host")!;

  host.innerHTML = starHTML(0, "x");
  const row = host.querySelector<HTMLElement>(".stars[data-item='x']")!;
  row.dataset.editing = "1";
  row.dataset.previousRating = "0";

  // Simulate setRating releasing the pin before re-render.
  delete row.dataset.editing;
  delete row.dataset.previousRating;

  // Simulate setItems → renderAll swapping the row.
  host.innerHTML = starHTML(5, "x");

  const afterPinned = getPinnedRatings(host);
  expect(afterPinned.size).toBe(0);
});
```

- [ ] **Step 2: Run the test — it should pass today (this is the new contract)**

Run: `npm test -- tests/integration/star-row-stability.test.ts`
Expected: PASS — 2 tests, both green.

The point of this task isn't to write a failing test first (the bug is a behavior gap, not a contract violation of an existing test). The point is to *add* the pin-release behavior to `setRating` so that the post-click contract holds.

- [ ] **Step 3: Update `setRating` to release the pin after `setItems(local)`**

In `src/ui/input.ts`, find `setRating` (around lines 450–480). Replace its current body:

```ts
async function setRating(id: string, rating: number, items: Item[]) {
  const it = items.find((x) => x.id === id);
  if (!it) return;
  const previous = it.rating;
  const row = document.querySelector<HTMLElement>(`.stars[data-item="${id}"]`);
  if (row) row.dataset.previousRating = String(previous);
  editingPrevious.set(id, previous);
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

with:

```ts
async function setRating(id: string, rating: number, items: Item[]) {
  const it = items.find((x) => x.id === id);
  if (!it) return;
  const previous = it.rating;
  const row = document.querySelector<HTMLElement>(`.stars[data-item="${id}"]`);
  if (row) row.dataset.previousRating = String(previous);
  editingPrevious.set(id, previous);
  const local = items.map((x) => (x.id === id ? { ...x, rating } : x));
  setItems(local);
  // Pin release: the click has committed, let the next render re-sort the row
  // to its new position. mouseenter will re-pin if the cursor is still inside
  // the row, ready for the next click.
  editingRows.delete(id);
  editingPrevious.delete(id);
  const rowAfter = document.querySelector<HTMLElement>(`.stars[data-item="${id}"]`);
  if (rowAfter) {
    if (rowAfter.dataset.editing !== undefined) delete rowAfter.dataset.editing;
    if (rowAfter.dataset.previousRating !== undefined) delete rowAfter.dataset.previousRating;
  }
  try {
    await updateItem(id, { rating });
  } catch (err) {
    setItems(items.map((x) => (x.id === id ? { ...x, rating: previous } : x)));
    showNotice("Couldn't save rating — try again.");
  }
}
```

- [ ] **Step 4: Run the full suite + typecheck**

Run: `npm run typecheck && npm test`
Expected: PASS — 116/116.

- [ ] **Step 5: Commit**

```bash
git add src/ui/input.ts tests/integration/star-row-stability.test.ts
git commit -m "fix(stars): release sort-pin after click so row can re-sort"
```

---

## Task 5: Build verification

**Files:** none

- [ ] **Step 1: Run the production build**

Run: `npm run build`
Expected: exits 0.

- [ ] **Step 2: If the build fails, fix forward and re-run**

Common failure mode: missing import, type error in `setRating`. Address with the minimal fix.

- [ ] **Step 3: Final commit (only if Step 2 produced changes)**

```bash
git add -A
git commit -m "build: verify production bundle after star bug fixes"
```

---

## Self-Review

1. **Spec coverage:**
   - Bug 1 (oval) → Task 1.
   - Bug 2 (stale tip) → Task 2.
   - Bug 3 (click-pop) → Task 3.
   - Bug 4 (pin release) → Task 4.
   - Existing tests stay green → verified at each task's test step.
   - All 116 tests remain green → verified by Task 5's full-suite run.

2. **Placeholder scan:** No "TBD", "TODO", "implement later". Every code block is the actual code.

3. **Type consistency:**
   - `editingRows: Set<string>` and `editingPrevious: Map<string, number>` referenced in Tasks 2 and 4 — both are already in scope from the previous fix (commit 6c6b574) in `src/ui/input.ts`. No new declarations needed.
   - `row.dataset.committedTip` introduced in Task 2; consumed in Task 2's mouseleave. ✅
