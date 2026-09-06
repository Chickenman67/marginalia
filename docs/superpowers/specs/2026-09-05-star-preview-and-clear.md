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

**Root cause (confirmed via live DOM measurement, see commit message):**

`.stars .preview` is `position: absolute; inset: 0; display: grid;
grid-template-columns: repeat(5, 1fr);`. Each child is `<svg
class="preview-star" viewBox="0 0 24 24">` with `width: 100%; height: 100%`.
The SVG's min-content width (computed by the layout engine given the
`viewBox` + `width:100%` + parent has no explicit size) is `~10px`, so each
`1fr` column collapses to that min-content. Result: each preview-star renders
**10×18 (ratio 0.56)** — elongated, smeared star spikes.

Measured (Chromium, 18px stars): `.preview` = 90×18, columns = `10px 10px
10px 10px 10px` (50px total), each preview-star = 10×18.

**Fix:** Replace `repeat(5, 1fr)` with `repeat(5, 20%)`. With a fixed
percentage, columns distribute to 18px on the default star row (5×18=90) and
20px on a `.card.todo` row (5×20=100), matching the committed-star widths.
The SVG's `width: 100%; height: 100%` then resolves to a square cell whose
size matches a single committed star — aspect 1:1, clean star shape.

```css
/* src/style.css — one-line fix */
.stars .preview {
  /* …existing rules… */
  grid-template-columns: repeat(5, 20%);   /* CHANGED from repeat(5, 1fr) */
}
```

Verified locally: with `20%` columns the same 90×18 overlay yields 5
preview-stars at 18×18 each, square.

### 2. Clear-rating affordance

**Already implemented.** `starClickValue` in `src/ui/views.ts:73–78` already
returns `0` when `target === current` (i.e. clicking the star at your
current rating). The behaviour is identical on desktop click and touch tap,
no keyboard modifier required. Coverage: `tests/unit/star-click.test.ts`
already asserts the toggle-off behaviour.

What is **missing** is the discoverability hint:

```ts
// src/ui/input.ts — extend the existing mousemove handler
starEl.addEventListener("mousemove", (e) => {
  // …existing code that computes `value`…
  row.dataset.hover = String(value);
  const tip = row.querySelector<HTMLElement>(".tip");
  if (tip) {
    const it = items.find((x) => x.id === row.dataset.item);  // NEW
    tip.textContent = (it && value === it.rating) ? "Clear" : String(value);  // CHANGED
  }
});
```

When the cursor enters a star whose value equals the current rating, the
pill text changes from `"3"` to `"Clear"`. The hint disappears the moment
the cursor moves to a different star or leaves the row (existing
`mouseleave` handler restores the committed rating text).

`starHTML` itself is unchanged: its initial tip text is the committed rating,
which is correct for the no-hover state.

### Scope of changes

| File                                       | Change                                                     |
| ------------------------------------------ | ---------------------------------------------------------- |
| `src/style.css`                            | One-line change: `.stars .preview` column track `repeat(5, 1fr)` → `repeat(5, 20%)` |
| `src/ui/input.ts`                          | In `bindStarEvents` mousemove handler, set tip text to `"Clear"` when `value === it.rating`, else `String(value)` |
| `tests/unit/star-click.test.ts`            | No new test (toggle-off already covered)                    |
| `tests/unit/star.test.ts`                  | Regression: render a row, hover same-rating star, assert tip text = "Clear" |
| `tests/unit/views.test.ts`                 | Regression: `.stars .preview` rule uses `repeat(5, 20%)` (not `1fr`) |

### Out of scope

- Renaming `.preview` to avoid the dock-rule collision (the previous fix
  already resets background bleed).
- Re-architecting the entire star widget.
- Long-press / right-click alternative clear gestures.
- Touch-drag to set rating.
- Changing committed-star colors or sizing.

### Risk

- **`20%` columns assume the `.stars` row's content fits the overlay width
  exactly.** It does: `.stars` is `inline-flex` of 5 `.star` siblings of fixed
  width (18 or 20px) = 90 or 100px total. The `.preview` overlay is
  `inset: 0`, so it spans the same width.
- **A future change that varies `.star` widths** (e.g. a 3-star widget) would
  break the `20%` assumption. The plan adds a CSS-regression test that pins
  the column track to `repeat(5, 20%)` so the next person changing the rule
  is forced to update the test.
- **Tooltip `Clear` text length** — `Clear` is 5 chars vs `5` is 1 char; the
  pill will widen, but `white-space: nowrap` is already on `.stars .tip` and
  there is plenty of headroom above the row.