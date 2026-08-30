# UI Polish — Filter Bar, Compact Todos, Star Opacity, Drag Removal

Date: 2026-08-30
Status: draft (pending user review)

## Summary

Four small UI fixes to the merged feature from `2026-08-29-filter-sort-redesign-and-todo-rating-design`:

1. The filter pill + panel must sit at the **top of each view in a dedicated bar**, not get nuked by the cards `innerHTML` replacement and not appear at the bottom of the page.
2. Todo cards become a **single-line compact layout** (check · title · badge · stars · delete) instead of the current two-line stacked layout.
3. **Empty stars always render at full opacity** (not 55%).
4. The **drag-reorder handle and behavior are removed** from cards.

Theme is unchanged: same color tokens, same fonts, same card chrome.

## Bug being fixed

The merged feature had a real bug: `mountFilterPanel()` was called with `host: vTodo` (the entire view), then `renderAll()` did `vTodo.innerHTML = todos.map(...).join("")`, which **wipes the pill and panel on the first render**. After the first `subscribe` callback fires, the panel disappears entirely from the DOM. The user reported "the filter is all the way at the bottom and expanded" — what they were seeing was the panel being re-rendered as the very last child of the view (or surviving briefly), then disappearing on the next store emit.

The fix is to give each view a dedicated **view-bar slot** that lives outside the cards container. `renderAll()` writes only to the cards container, never to the bar.

## Changes

### 1. View bar + filter slot

A new `<div class="view-bar">` is the **first child** of each view. It holds the filter pill and (when expanded) the panel. It is created by `mountFilterPanel()` and passed in as the `host` argument. The cards container is a separate element that `renderAll()` writes to.

`mountFilterPanel({ viewKey, initial, host, onChange })` no longer takes the entire view as the host — it takes the bar element. The bar is created by the caller (`mountViews()`) and inserted as the first child of each view.

**Architecture (after fix):**

```
<div id="view-todos">
  <div class="view-bar">
    <button class="filter-pill" aria-expanded="false">⇅ Filter & sort</button>
    <div class="filter-panel" hidden> ... </div>
  </div>
  <div class="view-cards">  <!-- this is what renderAll writes to -->
    <!-- card elements go here -->
  </div>
</div>
```

The `view-bar` is **not sticky/fixed**. It scrolls with the page. The user said "at the top of the view" — meaning structurally at the top, not pinned. The bar is short (collapsed = just the pill, ~40px) so it doesn't dominate the view.

### 2. Compact todo card

A new card layout for todos:

```
[ ☐ ]  Pick up groceries                    [todo]  ★★★★★  [🗑]
```

**Markup change in `cardHTML`:**

- When `i.kind === "todo"`: render the single-line layout. No `.meta` block; no `drag-h` handle. Order:
  1. `<input type="checkbox" class="check" ...>` (existing)
  2. `<div class="body"><div class="title">...</div></div>` — body is `flex: 1; min-width: 0;`; title gets `overflow: hidden; text-overflow: ellipsis; white-space: nowrap;`
  3. `<span class="badge todo">todo</span>` — moved to the right side
  4. The stars (injected inline; see Section 3)
  5. `<button class="del">🗑</button>` (existing)

- When `i.kind === "event"`: render the existing two-line layout (with time, all-day badge, pin, reminder). No change.

**CSS additions:**

```css
.card.todo { padding: 8px 14px; }
.card.todo .body { flex: 1; min-width: 0; display: flex; align-items: center; gap: 10px; }
.card.todo .title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
```

The existing `.card` padding shrinks from 13/14 to 8/14 only on `.card.todo`. Event cards keep the existing padding.

### 3. Star widget + always-visible

The `starHTML()` helper is moved **inside `cardHTML()`** (for todos only). The injected-after-render logic in `renderAll()` (lines 357-366 in `src/ui/input.ts`) is removed because the stars are now part of the card HTML from the start. The `data-pos` attribute and click-zone logic from the previous branch are preserved.

**Stars visibility:**

- `.stars .star.empty svg { opacity: 1; }` (was `0.55`). The hover rule that bumped empty stars to full opacity becomes redundant; remove it.
- Stars are always rendered, even when rating = 0. Empty stars are cream-colored (`#fff8d6`) with the dark outline (`#3a2e10`) — visible but unobtrusive.
- Stars size: keep at 22×22 — they sit on a compact card but are still the same tappable area. (20×20 is acceptable; 22×22 stays for consistency with the spec.)

**Star position on the compact todo card:**

The stars container sits between the `todo` badge and the delete button (right side of the row). `bindStarEvents` is still called once per render, but now it's called against the todo view's `view-cards` container (which is the host). The star click handler reads `data-pos` and `e.offsetX` exactly as before.

### 4. Drag-reorder removal

- `cardHTML` no longer renders the `${handle}` (`<span class="drag-h">⠿</span>`) for any kind. The first child of every card is now the check, not the handle.
- `bindCardEvents` removes the `.drag-h` query and the `dragstart` / `dragend` / `dragover` / `drop` listeners. The `reorder` call in the drop handler is removed.
- The `reorder` function in `src/store.ts` and the `order: number` field on `Item` stay in place. The "Manual" sort option in the filter panel still works — it uses `order` to sort, but the user can no longer change the order via the UI. (This is acceptable: a "Manual" sort that you can't actually edit is fine for v1; the sort is the only consumer. If we want, we can remove Manual from the panel's sort options in a follow-up, but it's not required.)
- `.drag-h` CSS rule can be removed or left in place (dead style). Cleanliness → remove it.

## Files touched

| File | Change |
|------|--------|
| `src/ui/views.ts` | `cardHTML` no longer renders the drag handle; new compact-todo branch; star widget inlined for todos. |
| `src/ui/input.ts` | `mountFilterPanel` now takes a bar element; each view gets a `<div class="view-bar">` and a `<div class="view-cards">`; `renderAll` writes to the cards container only; star-after-render injection removed. |
| `src/ui/filterPanel.ts` | No structural change; behavior is the same. The `host` is now the bar element instead of the view, so the pill+panel sit inside the bar. |
| `src/style.css` | `.view-bar` rules; `.card.todo` compact padding + flex body; remove `.drag-h` rule; remove `.stars:hover .star.empty svg` and set `.stars .star.empty svg { opacity: 1; }`. |
| `tests/unit/views.test.ts` | Add a new test asserting `cardHTML` output for a todo does not contain `drag-h`. |

`index.html` is unchanged.

## Edge cases

- **Empty view:** the bar still shows the pill (collapsed). The empty-state message (`No todos. Add one below.`) appears below the bar.
- **No items → bar still mounts:** `mountFilterPanel` is called once per view, independent of items. Even on a fresh Supabase space, every view's bar is ready.
- **Mobile / narrow viewport:** the bar is not sticky, so on long lists the bar scrolls off the top. Acceptable per user spec ("at the top of the view", not "always visible"). Long titles in compact todo cards truncate with `…`.
- **Filter panel open + add item via dock:** when `renderAll` runs after a new item is added, the view-bar is NOT touched (it's a sibling of the cards container, not a child), so the panel stays open. (This is a side-effect win of the architecture fix.)
- **Drag-reorder gone:** if a user previously reordered items, their `order` field values are preserved. The "Manual" sort still respects them. Switching to a different sort and back to Manual restores that order.

## Out of scope

- Removing the `reorder` function or the `order` field from the data model (kept for Manual sort).
- Removing the "Manual" option from the sort dropdown (still useful, even if not user-editable).
- Mobile-sticky filter bar.
- Long-press to start drag (was discussed and rejected).
- Per-space "remember last sort" persistence (rejected in the previous branch).

## Testing

### Unit tests (vitest, `tests/`)

- Append to `tests/unit/views.test.ts`:
  ```ts
  describe("cardHTML — compact todo", () => {
    it("does not include the drag handle", () => {
      const html = cardHTML(mkItemFull({ id: "x", title: "T", kind: "todo", datetime: null }));
      expect(html).not.toContain("drag-h");
    });
    it("includes the stars container for todos", () => {
      const html = cardHTML(mkItemFull({ id: "x", title: "T", kind: "todo", datetime: null }));
      expect(html).toContain("class=\"stars\"");
    });
    it("does not include a meta block for todos", () => {
      const html = cardHTML(mkItemFull({ id: "x", title: "T", kind: "todo", datetime: null }));
      expect(html).not.toContain("class=\"meta\"");
    });
  });
  ```

  (Where `mkItemFull` is the existing helper in the test file. It may need `rating: 0` added if the type now requires it.)

### Manual verification

- Open the app (`npm run dev`).
- Empty state: filter bar visible at the top of each view with just the pill.
- Add 3 todos via the dock: cards appear in a compact single-line layout; stars visible (full opacity, cream-colored) on the right.
- Click a star: rating updates; card re-renders with the new star fill.
- Click the filter pill: panel opens within the bar; chips, sort, reverse, and Select button all work.
- Click on a card: no drag handle visible. The card no longer responds to drag attempts.
- Resize the window narrow: long todo titles truncate with `…`.
- Reload: state preserved (rating values, sort state).

## Risk

Low. The architecture change (bar + cards container) is local. The compact todo card is a markup+CSS change. The star widget inlining removes one indirection but the data flow is unchanged. The drag removal is a deletion. No new dependencies. No new schema. No new tests beyond three small assertions.
