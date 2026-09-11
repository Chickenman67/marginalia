# 2026-09-11 UI Fixes Round 3 Design

## 1. Title Display - Show More Lines + Expand Icon
- **Problem**: Titles are clamped to 2 lines, making long text unreadable. No visual indicator that you can click to expand.
- **Solution**: 
  - Increase default `-webkit-line-clamp` from `2` to `4` lines in `src/style.css` for both desktop and mobile
  - Add a subtle expand/collapse icon (▼/▲) to the right of titles that overflow
  - Keep the existing click-to-expand behavior but make it more discoverable

## 2. Scroll Snapping at Bottom
- **Problem**: When scrolling to the bottom of item lists in any tab (Schedule/Todo/Due/Deleted), the scroll "snaps" back up instead of stopping smoothly.
- **Solution**: 
  - The `overscroll-behavior-y: none` on `body` should prevent this, but it may not be applied to the scrollable container
  - Add `overscroll-behavior-y: contain` to `main` element in `src/style.css` to prevent the rubber-band effect on the main scroll container
  - Ensure all tab containers inherit this behavior

## 3. Edit Modal Time Offset Bug (CRITICAL)
- **Problem**: Times shown in edit modal are wrong by several hours because we're slicing the UTC string directly instead of converting to local time first. Example: 11:59 PM local is stored as `2026-09-12T03:59:00.000Z` (UTC), and slicing gives us `03:59` instead of `23:59`.
- **Solution**:
  - In `src/ui/input.ts` `showEditModal`, replace the direct string slicing with proper UTC-to-local conversion
  - Parse `item.datetime` as a `Date` object, extract local hours/minutes using `getHours()` and `getMinutes()`, then format them as `HH:mm`
  - This ensures the displayed time matches what the user actually saved

## 4. Past Event Date Display
- **Problem**: Past events are not showing their actual past dates.
- **Solution**:
  - Investigate where past event dates are being displayed in `src/ui/views.ts`
  - Ensure the `datetime` field is being used correctly for display, not defaulting to current date
  - May need to check the `clock()` and date formatting functions