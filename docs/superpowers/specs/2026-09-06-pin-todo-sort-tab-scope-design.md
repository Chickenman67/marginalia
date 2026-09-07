# 2026-09-06 — Pin priority sort for the life of the Todos tab

## Problem

The Todos view is sorted by priority (rating, descending). Today, when the user
clicks a star on a todo row, the row jumps to its new sorted position. Worse,
the jump is off-by-one — clicking a second row to change ITS rating causes the
first row to reorder again, because the per-click "pin" mechanism was released
when the first click committed.

This is disorienting. The user wants:

- Changing a todo's star rating does **not** move any row.
- Rows re-sort by priority only when the user **leaves the Todos tab** — i.e.
  switches to Schedule or Due. Returning to Todos shows the new priority order.

Triggers that count as "leaving the tab":

- Clicking another tab (Schedule / Due).
- Refreshing the page (module state is reset).
- Switching browser tab or application, then returning (the tab switch in
  `mountViews` already covers the visible-tab case; we don't need to hook
  `visibilitychange` because the user still has to click a tab to see the
  updated order).

## Files touched

- `src/ui/input.ts` — replace hover-pin with tab-snapshot pin.
- `src/ui/views.ts` — drop the DOM-derived `getPinnedRatings`; keep the
  `pinned` parameter on `priorityComparator` so callers pass a `Map`.

No changes to `store.ts`, `types.ts`, CSS, or HTML.

## Behavior spec

1. Module state in `src/ui/input.ts`:
   - `let activeTab: "schedule" | "todos" | "due" = "schedule";`
   - `let pinnedRatings: Map<string, number> = new Map();`
   - Remove `editingRows` and `editingPrevious` (lines 430-431) and their
     pruning / re-application code in `bindStarEvents` (lines 511-531).

2. `mountViews()`:
   - Remove the `editingRows.clear()` / `editingPrevious.clear()` lines at the
     top of the function (lines 232-233).
   - In the `.tab` click handler (lines 242-250), after setting `hidden`
     attributes, set `activeTab = t.dataset.view` and clear `pinnedRatings`.
     If `activeTab === "todos"`, snapshot every todo's rating into
     `pinnedRatings` keyed by id, and call `renderAll(latestItems)`.

3. `renderAll()` (lines 384-403):
   - Replace `getPinnedRatings(vTodo)` (line 393) with `pinnedRatings`.
   - Schedule and Due still call `getPinnedRatings(vSched)` / `getPinnedRatings(vDue)`
     for now — those views are sorted by date, not rating, so the maps are
     empty in practice and the calls are harmless. (Keeping them avoids
     changing the function signature on `applyViewV2`.)

4. `setRating()` (lines 474-501):
   - Remove all `data-editing` / `data-previous-rating` writes on the row
     (lines 478-479, 490-494).
   - Remove `editingRows.delete(id)` and `editingPrevious.delete(id)` (lines
     488-489).
   - Keep `setItems(local)` — the row's visible stars update.
   - Keep the error-rollback path (`setItems(items.map(...))`) unchanged.

5. `bindStarEvents()` (lines 511-591):
   - Delete the pruning loop at the top (lines 516-518).
   - Delete the re-application loop (lines 524-531).
   - Delete the `tip.dataset.committedTip` write at line 538 (no longer needed).
   - Delete the explanatory comment block at lines 424-429 (it describes the
     now-removed editingRows / editingPrevious mechanism).
   - Keep `mouseenter` / `mouseleave` for the star preview / hover styling,
     but remove the `data-editing` attribute writes (lines 542, 546) and the
     `editingRows.add/delete` calls (lines 543, 549-550).
   - Keep the click handler that calls `setRating` unchanged.

6. `src/ui/views.ts`:
   - Delete `getPinnedRatings` (lines 171-181).
   - Keep `priorityComparator(a, b, pinned)` accepting a `Map<string, number>`,
     but the only call site (`renderAll`) now passes the tab snapshot, not a
     DOM-derived map. No behavior change to the comparator itself.

## Edge cases

- **Deleting a todo while on the Todos tab.** `pinnedRatings` may contain a
  stale id. Add a prune step at the top of `renderAll`: for each id in
  `pinnedRatings`, if no item with that id exists in `latestItems`, delete it.
- **Adding a todo while on the Todos tab.** New todo isn't in the snapshot,
  gets `rating: 0` (from the store), sorts to the bottom of priority order.
  Same as today. **YAGNI**: do not add an auto-extend of the snapshot.
- **Switching directly from Schedule → Todos → Schedule within a single
  render cycle.** The pin is cleared on each tab switch, so the snapshot
  reflects whatever ratings are in the store at the moment of switching in.
- **Module state across `mountViews()` calls** (e.g., auth state change).
  `mountViews` runs from scratch; `pinnedRatings` and `activeTab` are reset
  implicitly because they're re-initialized at module top. (If they're not —
  see "Implementation note" below.)

## Implementation note

`activeTab` and `pinnedRatings` are declared as `let` at module top. They
survive `mountViews()` calls. On each `mountViews()`, reset them:

```ts
activeTab = "schedule";
pinnedRatings = new Map();
```

at the top of the function (replacing the existing
`editingRows.clear()` / `editingPrevious.clear()` lines).

## Testing

Manual (no automated browser tests in this repo today):

1. Open Todos. Confirm rows are sorted by priority (rating desc, then stable).
2. Click 5 stars on the lowest-rated todo. The row must NOT move.
3. Click 3 stars on a different todo. Neither row must move.
4. Switch to Schedule tab. Switch back to Todos. Rows are now re-sorted by
   the new ratings.
5. Refresh the page. The sort reflects the saved ratings (no behavior change).
6. Delete a todo while on Todos tab. No crash; remaining rows stay in place.

Regression — existing unit tests:

- `priorityComparator` signature is unchanged. Existing tests (if any) still pass.
- `starHoverValue` export is unchanged.

## Out of scope

- Animating the reorder when returning to the Todos tab. (Instant snap is fine.)
- Schedule / Due views. They don't sort by rating, so they continue to use
  the live store rating. No change.
- A "Resort now" button. (YAGNI.)
