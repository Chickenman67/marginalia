# Star Rating Hover Preview & Stable Edit

## Problem

The star rating widget on each todo card has two UX problems:

1. **Hover preview is a flat gold rectangle.** A `::before` overlay paints a solid coloured block from the left edge to the hovered position. It does not read as "stars".
2. **Editing a star causes the card to jump.** Clicking a star changes `rating`; `setItems()` re-renders the list; the priority comparator (`b.rating - a.rating`) puts high-rated items first; the row the user is touching moves to a different position before they can click again.

## Goals

- Hover preview shows the *star shapes* up to the cursor position (whole + half stars), plus a small numeric tooltip ("3.5") above the hovered star.
- While the cursor is inside a card's `.stars` row, that row's position in the list does not change even if its rating changes. Once the cursor leaves the row, the list re-sorts normally.
- No regression of existing behavior: shift-click still clears to 0, clicking the same value still toggles off, half-zone clicks still work, all existing unit tests still pass.

## Non-goals

- Animated row movements (FLIP / slide).
- A persistent "lock sort" setting.
- Visual redesign of the committed (non-hover) star appearance.
- Touch / mobile changes — hover only.

## Design

### 1. Hover preview — fill star shapes + numeric tooltip

**Markup change** (`src/ui/views.ts`, `starHTML`):

The `.stars` row now contains three layers, in this DOM order:

1. **Committed stars** (existing) — five `.star` spans with `full` / `half` / `empty` classes reflecting the saved rating.
2. **Preview overlay** (new) — `<span class="preview">` containing five ghost `<svg><use href="#starShape"></svg>` stars. Their fills are toggled by the same `data-hover` attribute that already gets set in `bindStarEvents`. Half-steps clip the last gold star at 50% using the same `<clipPath>` pattern the committed half-star uses.
3. **Tooltip** (new) — `<span class="tip" aria-hidden="true">` showing the numeric value (e.g. `"3.5"`), positioned above the hovered star. Hidden by default; shown when `data-hover` is set.

**CSS change** (`src/style.css`):

- **Remove** `.stars::before` and all `.stars[data-hover="..."]::before` width rules (current lines 350–371).
- **Add** `.stars .preview` — absolutely positioned over the committed stars, `pointer-events: none`, `display: grid` with five equal columns. Each child is an SVG of the star, `fill: transparent` by default. A `.stars[data-hover="X"] .preview > :nth-child(N)` selector set paints the first `N` stars gold (and clips the Nth at 50% for half-steps).
- **Add** `.stars .tip` — `position: absolute`, `top: -1.4em`, `font: 600 11px/1 Inter`, `background: var(--ink)`, `color: var(--panel)`, `padding: 3px 6px`, `border-radius: 4px`, `opacity: 0; transition: opacity .12s ease`. `.stars[data-hover] .tip { opacity: 1; }`. The horizontal position is set by the same per-hover-value CSS rule (e.g. `.stars[data-hover="3.5"] .tip { left: 65%; }` — 50% star-centre for star 4 at half fill).
- **Remove** `.stars[data-hover] .star:hover svg` rule (lines 374–377) — superseded by the preview overlay; the preview itself provides the pop, and a per-star `transform: scale(1.15)` is unnecessary when the overlay already mirrors the cursor position exactly.

**No change** to `bindStarEvents` — it already sets `row.dataset.hover` on `mousemove` and deletes it on `mouseleave`. The preview overlay reads `data-hover` via CSS only.

**Why not re-render stars in place on hover?** The `mousemove` handler fires on every cursor movement. Replacing star SVG nodes each time would defeat the existing 120ms `transition` and lose the half-star clipping, plus it's far more DOM churn than needed.

### 2. Stable rating editing — row pins during interaction

**New data attribute**: `data-editing="1"` on the `.stars` row.

**`bindStarEvents` change** (`src/ui/input.ts`):

- On `mouseenter` of the `.stars` row (delegated once per row, not per star): set `row.dataset.editing = "1"`.
- On `mouseleave` of the row: delete `row.dataset.editing`.
- The existing `mousemove` and click handlers on individual stars continue to work; the row-level enter/leave wraps them.

**New helper** (`src/ui/views.ts`):

The committed rating is already mutated optimistically in `setRating()` *before* the next render. The mechanism to keep the row pinned is to make the sort comparator treat the currently-edited row as if its rating were its *previous* value during the edit window:

- `setRating()` captures `previous` (already does).
- `setRating()` writes the new rating to local state and to the server in parallel (already does).
- The sort comparator receives a `pinnedRatings: Map<id, number>` argument. When sorting, items in the map use the pinned rating for comparison. The map is populated at the start of each render with `{ [editingId]: previousRating }` where `editingId` is the row with `data-editing="1"`.
- New helper: `getPinnedRatings(host: HTMLElement): Map<string, number>` — scans `host.querySelectorAll(".stars[data-editing]")` and reads the prior rating from a `data-previous-rating` attribute written by `setRating`.

**`setRating` change** (`src/ui/input.ts`):

```ts
async function setRating(id: string, rating: number, items: Item[]) {
  const it = items.find(x => x.id === id);
  if (!it) return;
  const previous = it.rating;
  // Mark the row as editing BEFORE the next render so the comparator sees it.
  const row = document.querySelector(`.stars[data-item="${id}"]`);
  if (row) row.dataset.previousRating = String(previous);
  const local = items.map(x => x.id === id ? { ...x, rating } : x);
  setItems(local);
  try { await updateItem(id, { rating }); }
  catch (err) {
    setItems(items.map(x => x.id === id ? { ...x, rating: previous } : x));
    showNotice("Couldn't save rating — try again.");
  }
}
```

**Comparator change** (`src/ui/views.ts`, `priorityComparator`):

```ts
function priorityComparator(
  a: Item, b: Item,
  pinned: Map<string, number> = new Map()
): number {
  const ar = pinned.get(a.id) ?? a.rating;
  const br = pinned.get(b.id) ?? b.rating;
  return br - ar;
}
```

The caller (`sortItems` or wherever the comparator is invoked) reads pinned ratings from the DOM before sorting. This is acceptable because the comparator runs in the same synchronous render path that already touches the DOM.

**Why not freeze sort globally?** Only the row the user is actively editing should be pinned. Other rating changes (none here, since rating only changes via this click) are unaffected. Manual sort mode already doesn't sort by rating, so pinning is a no-op for it.

**Trade-off**: The comparator signature changes from `(a, b)` to `(a, b, pinned)`. Callers must pass the map. The default empty-map default keeps existing unit tests working without change.

### 3. Tests

**`tests/unit/star.test.ts`** — extend with:
- `starHTML()` output contains `.preview` and `.tip` spans.
- `starHTML(3, "x")` still produces 5 committed stars (existing assertions stay green).
- `starHTML(2.5, "x")` still has 2 full + 1 half + 2 empty committed stars (existing).

**`tests/unit/star-click.test.ts`** — unchanged. `starClickValue` is pure and untouched.

**New** `tests/unit/effective-rating.test.ts` (or extend an existing comparator test if one exists) — assert:
- `priorityComparator(a, b)` (no pin) sorts high-first.
- `priorityComparator(a, b, new Map([[a.id, 1]]))` with `a.rating = 5, b.rating = 4` returns negative (a goes first using pinned rating).
- `priorityComparator` is stable for items not in the pin map.

### 4. Files touched

- `src/ui/views.ts` — extend `starHTML` to emit preview + tip; update `priorityComparator` signature; re-export `priorityComparator`.
- `src/ui/input.ts` — row-level `mouseenter`/`mouseleave` to manage `data-editing`; `setRating` writes `data-previous-rating`; sort callers pass pinned map.
- `src/style.css` — remove `.stars::before` block and hover scale rule; add `.stars .preview`, `.stars .tip`, and per-`data-hover` overlay/tooltip positioning rules.
- `tests/unit/star.test.ts` — markup assertions for preview/tip.
- `tests/unit/effective-rating.test.ts` (new) — comparator pinning assertions.

### 5. Error handling

No new error paths. `setRating` already rolls back on `updateItem` failure. The preview overlay is purely visual and never blocks interaction.

## Risks

- **CSS specificity**: the new `.stars[data-hover="..."] .preview > :nth-child(N)` rules must match the existing tooltip-style specificity used for `.stars::before`. Verified by mirroring the selector shape.
- **Re-render during edit**: if `setItems` runs while the user is hovering, the row is replaced and `data-editing` may be lost. Mitigation: `setRating` writes `data-editing` before calling `setItems`, and `bindStarEvents` is re-invoked on every render — `mouseenter` will set it again on the next movement, but during the brief render window the row's `data-previous-rating` is still on the DOM because we wrote it before the optimistic render.
- **Half-step tooltip positioning**: the tooltip left-offset for `data-hover="X.5"` must land at the midpoint of the appropriate star. The mapping is identical to the existing `::before` width rules (e.g. `3.5 → 70%` puts the centre of star 4 at the right place for the half-fill). Reuse the same percentages.
