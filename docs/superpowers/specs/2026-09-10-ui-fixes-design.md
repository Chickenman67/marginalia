# 2026-09-10 UI Fixes Design

## 1. Time Picker Wheel Improvements
- **Problem**: Opening the wheel zeroes out the top buffer because it mounts at the 0th repeating loop index, preventing the user from scrolling up. The scroll-snap is also too aggressive ("snappy").
- **Solution**: 
  - Update `scrollForValue(v)` in `src/ui/calendar.ts` so the initial mount calculates the scroll offset at `loopCount / 2` (the middle of the looped list).
  - Subsequent programmatic clicks/scrolls calculate the nearest wrap-around instance to minimize visual jumping.
  - Remove `scroll-snap-type: y mandatory` from the `.wheel` class in `src/style.css` in favor of smooth scrolling.

## 2. Rating Stars Drag Feature
- **Problem**: Dragging over the stars continuously triggers `setRating()` which calls `setItems()` and fully replaces the DOM row before the gesture finishes, breaking the touch sequence and causing DB thrashing.
- **Solution**:
  - In `src/ui/input.ts` `bindStarEvents()`, track a `wasDragged` boolean in addition to `isDragging`.
  - During `touchmove` and `mousemove`, merely update the `row.dataset.hover` value without committing.
  - Upon `touchend` and `mouseup`, if `wasDragged` is true and a rating was selected, commit the single resulting `setRating` action. Use `e.preventDefault()` appropriately to safely suppress duplicate standard click events.

## 3. Edit Modal Datetime Shift & Event/Todo Toggle
- **Problem**: The edit modal slices the UTC string directly (`YYYY-MM-DDTHH:MM`) ignoring local timezone overrides. Switching a calendar event to a todo wipes the stored date/time values, resetting them to `09:00` today.
- **Solution**:
  - In `src/ui/input.ts`, parse `item.datetime` into a localized JS `Date` instance with proper padded format (`YYYY-MM-DD` and `HH:mm`) before setting the value of `pickedDate` and `pickedTime`.
  - In the `toggleKindBtn.onclick` handler, remove the branch that overwrites `pickedDate` and `pickedTime`. State variables will persist, and the inputs will retain the original timestamps when toggled back.

## 4. Desktop Title Clamping
- **Problem**: Desktop views allow list titles to stretch limitlessly vertically, while mobile properly clamps lines.
- **Solution**:
  - Move the `.card .title`, `.card.todo .title` and `.card.expanded .title` CSS behaviors (which assign `-webkit-line-clamp: 2` and `overflow: hidden`) out of the `@media (max-width: 520px)` block in `src/style.css` so they apply unconditionally across all viewport sizes.
