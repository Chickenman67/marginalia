# Star Rating Bug Fixes — Oval, Stale Tip, Click-Pop, Pin Release

## Problem

The star-rating widget change shipped earlier has four user-visible bugs:

1. **Black oval covers the stars on hover.** The `.preview` overlay paints 5 dark `STAR_EMPTY_FILL` ghost stars over the committed ones. Each `.preview-star` has an unconditional `<use href="#starShape" fill="#8a7d63"/>` plus a `<g class="fill">` for the gold star that is `display: none` until the hover position covers it. So on hover you see 5 dark stars covering the committed ones — visually a dark blob spanning the row.
2. **Tooltip shows committed rating, not hovered value.** `tipText` is computed once in `starHTML` from the committed rating `r`. The `mousemove` handler only updates `data-hover`; it never updates the tip text. So hovering over star 4 with a committed rating of 2 still shows "2".
3. **Click-pop animation gone.** The previous design used `.stars[data-hover] .star:hover svg { transform: scale(1.15); filter: drop-shadow(...) }` to pop the hovered star — that rule was deleted when the preview overlay was added. Now there's no visual feedback on click beyond the row staying put.
4. **Rated item doesn't move to its new sort position after click.** The pin (`data-editing="1"` + module-level `editingRows`) stays set while the cursor remains inside the row. The next render after `setRating` uses the *previous* rating for sort, so the row stays put. The user wants the pin to release as soon as the click commits, so the row moves to its new rank.

## Goals

- Hover preview shows only the gold fill up to the cursor; the underlying committed stars remain fully visible.
- Tooltip text follows the cursor in real time; on `mouseleave` it reverts to the committed rating.
- Clicking a committed star triggers a brief 120ms scale-up + drop-shadow, matching the original behaviour.
- After a click commits (success or rollback), the row unpins so it can move to its new sort position on the next render. Hovering without clicking still keeps the row pinned.

## Non-goals

- Schedule/Due tabs getting stars (user confirmed: stars stay todos-only).
- Touch device support changes.
- Animated row movements (FLIP / slide).
- A new visual redesign beyond the four bug fixes.

## Design

### 1. Black oval → drop the unconditional empty fill from preview-stars

**File:** `src/ui/views.ts`, `starHTML`.

**Change:** In the preview-loop (lines 57–63), remove the `<use href="#starShape" fill="${STAR_EMPTY_FILL}" stroke="none"/>` line. Keep only the `<g class="fill"><use ... fill="#f5c518" stroke="none"/></g>` wrapper. The preview overlay then paints *only* the gold fill on hover; nothing covers the committed stars when there's no fill.

**Why:** This is the simplest fix that achieves the "transparent un-filled preview stars" option the user chose. The committed stars already render the empty/dim state underneath, so the preview doesn't need to repeat it.

### 2. Stale tip → update tip text on `mousemove`, revert on `mouseleave`

**File:** `src/ui/input.ts`, `bindStarEvents`.

**Change:** In the existing star-level `mousemove` handler (around line 510), after `row.dataset.hover = String(starHoverValue(...))`, also update the row's `.tip` text:
```ts
const tip = row.querySelector<HTMLElement>(".tip");
if (tip) tip.textContent = String(starHoverValue(pos, me.offsetX, starEl.clientWidth));
```
In the existing star-level `mouseleave` handler, revert the tip to the committed rating (read it from the row's first committed `.star.full`/`.star.half` count, or simpler: stash the committed tip text on the row via `row.dataset.committedTip` in `bindStarEvents` and read it on mouseleave).

Cleaner alternative: in `bindStarEvents`, when first attaching events to the row, set `row.dataset.committedTip = row.querySelector('.tip')?.textContent ?? ""`. The mouseleave handler restores from `dataset.committedTip`.

**Why mousemove, not CSS:** CSS pseudo-content can't read a row's `data-hover` attribute. JS update is the simplest reliable path.

### 3. Click-pop animation → re-add `:active` rule on committed stars

**File:** `src/style.css`.

**Change:** Add a new rule below the existing `.stars .star svg { transition: ... }` (line 340):
```css
.stars .star:active svg {
  transform: scale(1.15);
  filter: drop-shadow(0 1px 1px rgba(58, 46, 16, 0.35));
}
```
The existing `transition: transform .12s ease, filter .12s ease` on `.stars .star svg` (line 340) makes the scale-up and release smooth — `:active` is held only while the mouse button is down.

**Why not `:hover`:** `:hover` would conflict with the preview overlay's `data-hover` row attribute (they overlap visually). `:active` is mouse-button-down only, which is exactly the click moment.

### 4. Pin release on click commit → unpin after `setItems` writes

**File:** `src/ui/input.ts`, `setRating`.

**Change:** Immediately after `setItems(local)` (around line 482), release the pin for this item:
```ts
setItems(local);
// Pin release: the click committed, let the next render re-sort the row
// to its new position. Mouseenter will re-pin if the cursor is still inside.
editingRows.delete(id);
editingPrevious.delete(id);
const rowAfter = document.querySelector<HTMLElement>(`.stars[data-item="${id}"]`);
if (rowAfter) {
  if (rowAfter.dataset.editing !== undefined) delete rowAfter.dataset.editing;
  if (rowAfter.dataset.previousRating !== undefined) delete rowAfter.dataset.previousRating;
}
```
The existing rollback path (`setItems(items.map(...))` on `updateItem` failure) does *not* need a similar pin release — the rollback restores the previous rating and the pin already prevents the row from jumping during the failed click. On rollback, the cursor is still inside the row, so `mouseenter` keeps it pinned at the previous rating, and no movement happens.

**Why not release on rollback too:** If we release on rollback, the row would re-sort with the *new* rating (which `setItems(local)` already wrote optimistically) until the rollback `setItems` restores the previous rating. That would cause a brief flicker. Leaving the pin in place during rollback keeps the row stable.

Actually — `setItems(local)` is called *before* `updateItem`. So by the time we reach the rollback `setItems(items.map(...))`, the optimistic render has already happened. The pin is still active. On rollback, `setItems` restores `previous`, and the next render still pins at `previous` because `getPinnedRatings` reads `data-editing` (still set on the row). So the row stays put during rollback. Correct.

**Subtle UX:** if the user clicks star 5 then immediately hovers another star, the second click re-pins via `mouseenter` (which adds to `editingRows`) and re-runs the cycle. No flicker.

## Files touched

| File | Change |
| --- | --- |
| `src/ui/views.ts` | Drop unconditional empty-fill `<use>` from preview-star loop in `starHTML`. |
| `src/ui/input.ts` | `bindStarEvents`: stash `committedTip` on row; update tip text on `mousemove`; restore on `mouseleave`. `setRating`: release pin after `setItems(local)`. |
| `src/style.css` | Add `.stars .star:active svg { transform: scale(1.15); filter: drop-shadow(...) }`. |
| `tests/unit/star.test.ts` | The `emits a preview overlay of 5 ghost stars` test asserts `countOccurrences(h, "class=\"preview-star\"")` — still passes because we keep the wrapper. No change needed. |
| `tests/integration/star-row-stability.test.ts` | The current second assertion expects the pinned map to be populated *after a re-render*. With the pin-release-on-click fix, that's still true for the no-click case. But add a new test case asserting that after a simulated click, the row unpins so it can re-sort. |

## Risks

- **Tip text reversion:** if `committedTip` is captured before `bindStarEvents` runs, it reflects whatever `starHTML` produced. If the row is re-rendered (e.g. after a click that pins then unpins), the new row's tip text will be the committed rating again — same as before. No drift.
- **Pin release during multi-click rapid succession:** if the user clicks star 3 → star 5 within 50ms, both clicks fire `setRating`. The first releases the pin; the second re-pins via `mouseenter` on the new row. Behavior is correct.
- **Tip text on a row that's never been hovered:** the tip element is rendered with the committed rating text in `starHTML`; `bindStarEvents` stashes it as `committedTip`. If the user hovers, mouseleave restores from `committedTip` (same value). No-op.
- **`:active` on touch devices:** on touch, `:active` fires on tap and persists ~300ms. Acceptable for now.

## Test plan

- Update `tests/integration/star-row-stability.test.ts` to add a case: simulate a click, then verify the row's `data-editing` is gone and the pinned map is empty.
- All existing 116 tests must remain green.
