# 2026-09-10 UI Fixes Design Round 2

## 1. App-wide Mobile Rubber Banding
- **Problem**: When a user reaches the top/bottom of a page/list on mobile, dragging further triggers the browser's native "rubber band" UI overscroll bounce.
- **Solution**: 
  - Add `overscroll-behavior-y: none;` to the `body` in `src/style.css` to prevent body scrolling from hitting native UI anchors. (Already implemented proactively, but capturing in spec).

## 2. Touch Drag Stars Fix
- **Problem**: The implemented `wasDragged` tracking correctly delayed DB calls, but on mobile interfaces, `touchmove` always retains the element where the touch *started*. Sliding across multiple stars registers on the coordinate level, but fails to highlight stars dynamically because it's not looking up the actual element under the current finger bounds. 
- **Solution**:
  - In `src/ui/input.ts`'s `touchmove` logic inside `bindStarEvents`, pass either `document.elementFromPoint(touch.clientX, touch.clientY)` or `undefined` instead of nothing to `handleMove`. 
  - This overrides the hover coordinate trap and allows smooth sweeping action across rating widgets.

## 3. Date Time Fixes for Edits
- **Problem**: Opening the Edit modal for items does not fetch the item's stored `datetime` strictly enough, resulting in visual fallback to `09:00`, and `setRating` or Date toggles overwrite local inputs inadvertently depending on how it's executed. 
- **Solution**:
  - In `src/ui/input.ts` `showEditModal(item: Item)`, simplify and accurately preserve time strings. If an item switches from "Event" to "Todo", don't immediately overwrite `pickedTime` and `pickedDate` to generic strings like `09:00`; keep the logic commented out or excised. If it had a `datetime`, display that exact `datetime` hour/minute structure accurately.
  - Implement full UTC parsing so `item.datetime` generates `HH:mm` natively using padded 2-digit format overrides, accurately presenting `11:45` if the item is explicitly stored as such.