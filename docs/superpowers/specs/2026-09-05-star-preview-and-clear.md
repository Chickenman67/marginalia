# Star hover preview polish + clear-rating affordance

Date: 2026-09-05
Branch: main
Status: approved

## Problem

Two related issues with the star widget on Todo cards (and on any card that
embeds `starHTML`, currently the Todo and Due tabs):

1. **Hover preview stars look stretched / distorted.** When the user hovers
   over a star row, the `.preview` overlay is supposed to paint gold-filled
   ghost stars up to the cursor position. Instead, the preview stars render
   as elongated, smeared shapes that look broken — visible especially at the
   full-width hover state on Todo cards.

2. **No way to clear a rating back to zero.** The widget supports half-step
   ratings (0, 0.5, 1, … 5) and shift-click on a star already clears the
   rating (via `starClickValue`), but shift-click is a desktop-only gesture
   and isn't discoverable. Touch users and most mouse users have no path back
   to zero without removing the item and re-adding it.

## Goals

- Hover preview must render as 5 clean, square gold stars aligned with the
  committed star row.
- Users must be able to clear an existing rating to zero with a discoverable
  gesture that works on both desktop and touch.
- Keep the existing half-step (0.5 / 1.5 / 2.5 …) click semantics unchanged.

## Design

### 1. Fix the preview-star sizing

**Root cause (confirmed by reading `src/style.css:359–380` and `src/ui/views.ts:19–71`):**

`.stars .preview` is `position: absolute; inset: 0; display: grid;
grid-template-columns: repeat(5, 1fr);`. The grid has **no row track** defined,
so the row height auto-sizes from content. The children are `<svg
class="preview-star" viewBox="0 0 24 24">` with `width: 100%; height: 100%`.
The `.stars` row is `inline-flex` with committed `.star` siblings of `18px` (or
`20px` on `.card.todo`); the `.preview` overlay is `position: absolute` so it
does not contribute to the row's intrinsic height. The grid cell therefore
auto-sizes from the SVG's intrinsic aspect — but with conflicting `100%` /
`viewBox` sizing, browsers resolve inconsistently across layout passes,
producing elongated/distorted star shapes.

**Fix:** Force the grid row to match the column aspect (1:1) so each cell is a
square, and let the SVG render inside it at its natural aspect.

```css
/* src/style.css — extend the existing .stars .preview rule */
.stars .preview {
  /* …existing rules… */
  grid-template-rows: 1fr;          /* NEW: square cells, matches column aspect */
  align-items: center;
  justify-items: center;
}
.stars .preview-star {
  /* …existing rules… */
  width: 100%;
  height: 100%;
  aspect-ratio: 1;                  /* NEW: belt-and-braces if grid row drifts */
  display: block;
}
```

If after the change the preview stars still don't render square in some
browsers, the fallback is to give `.preview` an explicit `aspect-ratio: 5 / 1`
(width 5 cells, height 1 row) so the overlay is always exactly as tall as it
is wide / 5 — matching one star's intrinsic size.

### 2. Clear-rating affordance

**Behaviour:** Clicking a star at the same position-and-zone as the user's
current rating clears the rating to `0` instead of being a no-op. This works
identically on desktop click and on touch tap (no keyboard modifier required).

- `starClickValue(pos, zone, current, shiftKey)` in `src/ui/views.ts:73` —
  extend to return `0` when `target === current`, not just on shift.
- `setRating(id, 0, items)` is already supported by the store.
- Tooltip hint: when the user hovers a star whose `value` equals the current
  rating, the `.tip` text changes from `"3"` to `"Clear"` so the action is
  discoverable on first hover. The hint lives only in the existing tooltip —
  no new UI chrome.

```ts
// src/ui/views.ts — extend starClickValue
export function starClickValue(pos, zone, current, shiftKey): number {
  if (shiftKey) return 0;
  const target = zone === "whole" ? pos : pos - 0.5;
  if (target === current) return 0;   // NEW: same position = clear
  return target;
}
```

```ts
// src/ui/input.ts — hover handler updates tip text per mousemove
starEl.addEventListener("mousemove", (e) => {
  // …existing code computing `value`…
  row.dataset.hover = String(value);
  const tip = row.querySelector<HTMLElement>(".tip");
  if (tip) {
    tip.textContent = (value === currentRating) ? "Clear" : String(value);  // CHANGED
  }
});
```

`starHTML` keeps the existing tip-text formula (committed rating only) so the
pill shows the committed value when the mouse leaves the row. The "Clear"
hint appears live, on mousemove, when the cursor enters the star at the
current rating.

### Scope of changes

| File                                       | Change                                                     |
| ------------------------------------------ | ---------------------------------------------------------- |
| `src/style.css`                            | Add `grid-template-rows: 1fr` and `aspect-ratio: 1` to the existing `.stars .preview` / `.stars .preview-star` rules |
| `src/ui/views.ts`                          | `starClickValue`: clear on same-position click; `starHTML` tip text shows `Clear` when hover equals current rating |
| `src/ui/input.ts`                          | No structural change; passes `it.rating` already           |
| `tests/unit/star-click.test.ts`            | Add `starClickValue` same-position clears rating           |
| `tests/unit/star.test.ts`                  | Add tip-text "Clear" hint regression                        |
| `tests/unit/views.test.ts`                 | Add CSS regression asserting preview grid has row track    |

### Out of scope

- Renaming `.preview` to avoid the dock-rule collision (the previous fix
  already resets background bleed).
- Re-architecting the entire star widget.
- Long-press / right-click alternative clear gestures.
- Touch-drag to set rating.
- Changing committed-star colors or sizing.

### Risk

- **Visual regression in other places using `display: grid;
  grid-template-columns: repeat(5, 1fr)`** — there are none in `src/`.
- **`grid-template-rows: 1fr` interaction with the row's `align-items: center`
  flex** — orthogonal; the `.preview` overlay is `position: absolute`, so
  flex alignment on `.stars` does not affect it.
- **Tooltip `Clear` text length** — `Clear` is 5 chars vs `5` is 1 char; the
  pill will widen, but `white-space: nowrap` is already on `.stars .tip` and
  there is plenty of headroom above the row.