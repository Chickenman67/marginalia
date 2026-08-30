# Todo Card Polish — Hidden Filter Defaults, Reset Button, Visible Stars, Schedule-Height Todos

Date: 2026-08-30
Status: draft (pending user review)

## Summary

Four targeted fixes to the merged UI from `2026-08-30-ui-polish-design`:

1. **Filter panel hidden by default** — confirm current behavior is correct and document it; no code change.
2. **Reset filters button** — new button inside the filter panel, visible only when state differs from defaults; clears all chips, search, and sort.
3. **Stars visible** — change empty-star fill from near-white cream (`#fff8d6`) to soft beige (`#d8d0bf`) and bump outline stroke from 1.4 → 1.6 so they're clearly visible against card backgrounds.
4. **Todo card height = Schedule card height** — restructure todo markup so title is on line 1 and a `.meta` row (badge + stars) sits on line 2, matching Schedule's two-line layout exactly.

Theme is unchanged: same color tokens, same fonts, same card chrome.

## Changes

### 1. Filter panel hidden by default

**No code change.** The panel already starts with `hidden = true` (`src/ui/filterPanel.ts:105`) and is opened by clicking the always-visible "⇅ Filter & sort" pill at the right end of each view's top bar. Closing happens via outside-click or Escape (`src/ui/filterPanel.ts:182-189`).

This section of the spec exists to confirm that this is the intended default. If the user later asks for the pill itself to be hidden, that becomes a separate change.

### 2. Reset filters button

A new "Reset filters" button is added inside the panel. It's only visible when the current state differs from the per-view defaults.

**File: `src/ui/filterPanel.ts`**

The `DEFAULTS` object (lines 8–12) is the source of truth. The existing `isDefault()` helper (lines 82–84) already computes whether the state matches defaults. We'll reuse it.

**Markup change in `drawPanel()`** (insert a row before the closing of the panel template, after the `.sort-row`):

```ts
panel.innerHTML = `
  <div class="search">...</div>
  ${chips.map(...).join("")}
  <div class="sort-row">...</div>
  <button type="button" class="reset" hidden>Reset filters</button>
`;
```

**Click handler** (inside `drawPanel()`, alongside the other event bindings):

```ts
const resetBtn = panel.querySelector<HTMLButtonElement>(".reset")!;
resetBtn.onclick = () => {
  state = JSON.parse(JSON.stringify(DEFAULTS[viewKey]));
  drawPanel();
  emit();
};
```

**Visibility hook** — extend `refreshPill()` (lines 171–173) to also toggle the reset button:

```ts
function refreshPill() {
  const dirty = !isDefault(state, viewKey);
  pill.querySelector(".dot")!.toggleAttribute("hidden", dirty);
  const resetBtn = panel.querySelector<HTMLButtonElement>(".reset");
  if (resetBtn) resetBtn.hidden = !dirty;
}
```

**Styling** (in `src/style.css`, append to the `.filter-panel` rules around line 365):

```css
.filter-panel .reset {
  align-self: flex-start;
  appearance: none; border: 1px solid var(--line); background: var(--paper);
  color: var(--muted); padding: 6px 12px; border-radius: 999px;
  font: inherit; font-size: 12.5px; cursor: pointer;
  transition: color .15s, border-color .15s, background .15s;
}
.filter-panel .reset:hover { color: var(--ink); border-color: var(--line-strong); background: var(--panel); }
.filter-panel .reset:focus-visible { outline: 2px solid var(--ink); outline-offset: 2px; }
```

### 3. Stars visible

**Root cause:** the empty-star fill is `#fff8d6` (very light cream), applied to a card whose background is `#fffdf8` (also cream) or `--paper` (`#f6f3ec`, also cream). The brown outline (`#3a2e10`) at `stroke-width="1.4"` is the only thing distinguishing an empty star from the background, and at 22px it's too faint at normal viewing distance. When a user has no rating, all five stars look like near-invisible cream blobs.

**Fix:** change the empty-star fill to a soft beige that contrasts against both card backgrounds, and bump the outline stroke so the silhouette dominates.

**File: `src/style.css`**

```css
:root {
  --star-empty: #d8d0bf;  /* was #fff8d6 */
}
```

**File: `src/ui/views.ts`**

Add a module-level constant near `STAR_SYMBOL_ID` (line 5):

```ts
export const STAR_EMPTY_FILL = "#d8d0bf";
```

Replace the two literal `#fff8d6` strings in `starHTML()` (line 29 — `.half` base layer — and line 36 — `.empty` branch):

```ts
// line 29, the .half base layer
<use href="#${STAR_SYMBOL_ID}" fill="${STAR_EMPTY_FILL}" stroke="none"/>
```

```ts
// line 36, the .empty branch
<use href="#${STAR_SYMBOL_ID}" fill="${STAR_EMPTY_FILL}" stroke="#3a2e10" stroke-width="1.6" stroke-linejoin="round"/>
```

The `.full` branch (line 24) is unchanged — it still uses `#f5c518` (gold). The `.half` branch's clip-path rect (line 30) is unchanged — but the underlying fill it overlays is now the new soft beige. The half-star renders as gold over soft beige, which is more visible than gold over cream.

The `STAR_POLYGON` and `starSymbolHTML()` helpers are unchanged. The `data-pos`, `data-value`, and click-zone logic are unchanged. The `bindStarEvents` function is unchanged.

**Edge case — half-star clip-path bug** (separate, out of scope): the clip-path polygon in line 30 uses literal `px` units inside an SVG that scales to 22px via `viewBox="0 0 24 24"`. The polygon coordinates don't scale with the SVG, so at the rendered size the clip mask is wrong. This affects the half-star appearance only. It's been latent in the codebase and is not part of this spec; a follow-up can rewrite it as a `<clipPath>` child of the `<symbol>` so it scales correctly. Flag for a later iteration.

### 4. Todo card height = Schedule card height

**Goal:** every todo card renders as tall as a Schedule card. Title on the first line, a `.meta` row on the second line containing the `todo` badge and the 5-star widget.

**File: `src/ui/views.ts`**

Replace `todoCardHTML()` (lines 230–247) with:

```ts
function todoCardHTML(i: Item, opts: { selectable?: boolean; selected?: boolean }): string {
  const accent = colorFor(i.datetime || i.reminder);
  const accentAttr = accent ? ` data-accent="${accent}"` : "";
  const sel = opts.selectable
    ? `<input type="checkbox" class="sel" ${opts.selected ? "checked" : ""} aria-label="Select ${esc(i.title)}" />`
    : "";
  return `<div class="card todo ${i.status === "done" ? "done" : ""} ${opts.selected ? "selected" : ""}" data-id="${i.id}"${accentAttr}>
    ${sel}
    <input type="checkbox" class="check" ${i.status === "done" ? "checked" : ""} aria-label="Complete ${esc(i.title)}" />
    <div class="body">
      <div class="title">${esc(i.title)}</div>
      <div class="meta">
        <span class="badge todo">todo</span>
        ${starHTML(i.rating, i.id)}
      </div>
    </div>
    <button class="del" title="Delete" aria-label="Delete ${esc(i.title)}">🗑</button>
  </div>`;
}
```

The check and delete buttons stay in the same outer flex row as today (left and right edges). The body now contains both lines stacked. The `.stars` widget continues to be inlined into the card by `cardHTML()` — the `bindStarEvents` call in `renderAll` (`src/ui/input.ts:374`) still works because it queries `.stars` inside the cards container.

**File: `src/style.css`**

Replace the `.card.todo` rules (lines 385–390) with:

```css
/* match Schedule card height — title on line 1, badge+stars on line 2 */
.card.todo { padding: 13px 14px; align-items: flex-start; }
.card.todo .body { min-width: 0; }
.card.todo .title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.card.todo .meta { font-size: 13px; color: var(--muted); margin-top: 3px; display: flex; flex-wrap: wrap; gap: 6px 10px; align-items: center; }
```

Removed: `display: flex` and `gap: 10px` from `.card.todo .body`, the `flex: 1` on `.card.todo .title`, and the `order: 1/2/3` rules on `.badge.todo`, `.stars`, `.del`. None of those apply once badge + stars move into `.meta`.

The `.stars` widget continues to use its existing CSS (lines 324–327); it just sits inside `.meta` now. The `data-accent` left border (set by `bindCardEvents` line 286) still works — todos get their accent strip on the left edge, same as Schedule items.

## Files touched

| File | Change |
|------|--------|
| `src/ui/views.ts` | Add `STAR_EMPTY_FILL` constant; replace `todoCardHTML()` markup. |
| `src/ui/filterPanel.ts` | Add Reset button to panel template; add click handler; extend `refreshPill()` to toggle visibility. |
| `src/style.css` | Update `--star-empty` token; add `.filter-panel .reset` rules; replace `.card.todo` rules. |
| `tests/unit/views.test.ts` | Update the "compact todo" tests from `2026-08-30-ui-polish-design` to assert the new structure (title on line 1, `.meta` on line 2, badge inside `.meta`). |
| `tests/unit/filter-panel.test.ts` | (new) Add a minimal test for `isDefault` and the Reset button toggling. |

`index.html` is unchanged.

## Edge cases

- **Reset clears search too?** Yes — the entire state object is replaced with the default. The search input is repopulated by `drawPanel()`.
- **Reset closes the panel?** No — it stays open so the user can see the chips reset. If they want to close it, they click outside or the pill again.
- **Stars visible on done todos?** Yes — `starHTML()` is unchanged for the data flow; only colors change. A done todo with rating 0 shows five soft-beige outlined stars; with rating 5 shows five gold stars. The `.card.done` opacity (.55) applies to the whole card, including stars.
- **Long todo titles** still truncate with `…` on line 1 (per `.title { text-overflow: ellipsis; white-space: nowrap; }`). The badge + stars on line 2 never overflow because they wrap to a new line if needed (`flex-wrap: wrap`).
- **Filter pill dot indicator** still works because `refreshPill()` toggles it from the same `isDefault()` check that the Reset button uses.
- **Empty state** ("No todos. Add one below.") renders below the new taller cards. Layout unchanged from there.

## Out of scope

- Hiding the pill entirely (would require a separate affordance in the tab strip).
- Per-space "remember last sort" persistence.
- The half-star `clip-path` bug (cosmetic; only affects 0.5-star ratings).
- Removing the `reorder` function or the `order` field from the data model.
- Changing star size from 22×22 to something else.

## Testing

### Unit tests (vitest, `tests/`)

**Update `tests/unit/views.test.ts`** — replace the three assertions in the "compact todo" describe block with:

```ts
describe("cardHTML — todo matches Schedule height", () => {
  it("does not include the drag handle", () => {
    const html = cardHTML(mkItemFull({ id: "x", title: "T", kind: "todo", datetime: null }));
    expect(html).not.toContain("drag-h");
  });
  it("puts the badge inside .meta on line 2", () => {
    const html = cardHTML(mkItemFull({ id: "x", title: "T", kind: "todo", datetime: null }));
    expect(html).toMatch(/<div class="body">[\s\S]*<div class="title">T<\/div>[\s\S]*<div class="meta">[\s\S]*<span class="badge todo">todo<\/span>[\s\S]*<\/div>[\s\S]*<\/div>/);
  });
  it("includes the stars container inside .meta", () => {
    const html = cardHTML(mkItemFull({ id: "x", title: "T", kind: "todo", datetime: null }));
    expect(html.replace(/\s+/g, " ")).toContain('<div class="meta"> <span class="badge todo">todo</span> <span class="stars"');
  });
});
```

**Add `tests/unit/filter-panel.test.ts`** — minimal coverage for the Reset behavior:

```ts
import { describe, it, expect } from "vitest";
import { JSDOM } from "jsdom";
// ... mount the panel into a JSDOM document with a synthetic DEFAULTS,
// trigger the click handler, assert state matches defaults.

describe("filter panel — reset", () => {
  it("shows the Reset button only when state differs from defaults", () => {
    // mount with defaults; assert button is hidden
    // mutate a chip; assert button is visible
    // click Reset; assert state matches defaults again
  });
});
```

(Filling in the JSDOM scaffolding is part of the plan, not this spec.)

### Manual verification

- Open the app (`npm run dev`).
- **Filter default:** switch to the Todos tab — the "⇅ Filter & sort" pill is visible at the right of the top bar; the panel itself is hidden. Click the pill — panel opens. Click outside — panel closes. Press Escape — panel closes.
- **Reset:** open the panel, click a non-default chip (e.g. Priority: ★3+). The "Reset filters" button appears at the bottom of the panel and the dot on the pill appears. Click Reset — chips return to "All", the Reset button hides, and the dot disappears.
- **Stars:** switch to the Todos tab. With no rating, every todo shows five outlined soft-beige stars. Click the third star — three stars turn gold. Click the same star again with Shift — all stars return to soft beige.
- **Todo height:** switch to the Todos tab. Each todo card is now ~60–65px tall, the same vertical footprint as a Schedule card. Title is on the first line; the `todo` badge and the star row are on the second line.
- **Long titles** truncate with `…` on line 1, the badge + stars wrap naturally on line 2.
- **Reset clears search:** type "x" into the search box inside the panel, click Reset — the search box is empty and the state returns to defaults.
- Reload: state preserved (rating values, sort state, current view).

## Risk

Low. The Reset button is additive and gated by the existing `isDefault()` check. The empty-star color change is a CSS variable + three literal replacements; no data flow changes. The todo card restructure is markup + CSS, with the same data and the same `bindStarEvents` plumbing. No new dependencies. No schema change.