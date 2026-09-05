# Tooltip Pill Style + Remove Pins From All Tabs

## Problem

Two unrelated visual / feature cleanups from user feedback:

1. **Tooltip looks like a black blob on hover.** `.stars .tip` uses `background: var(--ink)` (dark navy/black) which stands out harshly on the cream card background and reads as a solid black shape rather than a small numeric pill.
2. **Pin buttons show on every tab.** The pin affordance is rendered on Schedule items (via `groupByDay`), on event-kind items in the Due tab, and not on Todos (where `showPin: false` is already passed). User wants pins removed from all tabs.

## Goals

- Tooltip pill becomes a light cream pill with a dark text and a thin border — reads as a tooltip, not a black blob.
- Pin button is never rendered on any card on any tab.

## Non-goals

- Removing the `pinned` field from the `Item` data model (it's still there for future use).
- Removing `togglePin` from `src/store.ts` (still a valid operation; just no UI affordance).
- Removing the `.pin-btn` CSS rule (still in the stylesheet; harmless if unused).

## Design

### 1. Tooltip pill style

**File:** `src/style.css`, the `.stars .tip { ... }` rule (lines 416–429).

**Change:** flip the colors — light background, dark text, thin border.

```css
.stars .tip {
  position: absolute;
  top: -1.4em;
  transform: translateX(-50%);
  font: 600 11px/1 "Inter", system-ui, sans-serif;
  background: var(--paper);
  color: var(--ink);
  padding: 3px 6px;
  border-radius: 4px;
  border: 1px solid var(--line);
  pointer-events: none;
  opacity: 0;
  transition: opacity .12s ease;
  white-space: nowrap;
}
```

The `var(--paper)` and `var(--line)` are already defined in the stylesheet (lines 14–20).

### 2. Hide pin button on Schedule and Due tabs

**Files:**
- `src/ui/views.ts:412` — `groupByDay` calls `cardHTML(i, { selectable })`. Add an `opts` parameter so the caller can pass `showPin: false`.
- `src/ui/input.ts:412-414` — pass `showPin: false` from `schedCards` (via `groupByDay`) and `dueCards`. Todos already passes it.

**Change in `src/ui/views.ts`:**

Current signature: `export function groupByDay(items: Item[], selectable: boolean): string`.

New signature:
```ts
export function groupByDay(
  items: Item[],
  selectable: boolean,
  cardOpts: { showPin?: boolean } = {}
): string {
  // ...existing logic, but pass `cardOpts` through to cardHTML:
  groups[k].map((i) => cardHTML(i, { selectable, ...cardOpts })).join("")
}
```

**Change in `src/ui/input.ts`:**

```ts
schedCards.innerHTML = events.length
  ? groupByDay(events, selectable, { showPin: false })
  : `<div class="empty">Nothing scheduled. Speak or type to add one.</div>`;
todoCards.innerHTML = todos.length
  ? todos.map((i) => cardHTML(i, { selectable, selected: selected.has(i.id), showPin: false })).join("")
  : `<div class="empty">No todos. Add one below.</div>`;
dueCards.innerHTML = dueShown.length
  ? dueShown.map((i) => cardHTML(i, { selectable, selected: selected.has(i.id), showPin: false })).join("")
  : `<div class="empty">Nothing due right now.</div>`;
```

`eventCardHTML` already honors `opts.showPin === false` (line 337), so no further changes needed there.

## Files touched

| File | Change |
| --- | --- |
| `src/style.css` | Flip tooltip pill colors (background, color, border). |
| `src/ui/views.ts` | `groupByDay` accepts an `opts` arg and forwards to `cardHTML`. |
| `src/ui/input.ts` | `schedCards` and `dueCards` pass `showPin: false`. |

## Tests

- Existing 117 tests must remain green.
- Optional: add a test asserting `groupByDay([eventItem], false, { showPin: false })` does not contain `pin-btn`. Cheap regression test.

## Risks

- `groupByDay` signature change: only one call site (`src/ui/input.ts:412`). Update that site.
- `cardHTML`'s `opts` already accepts arbitrary keys (`{ selectable?: boolean; selected?: boolean; showPin?: boolean }`), so spreading `...cardOpts` into it is safe — `cardHTML` ignores unknown keys.
- `eventCardHTML`'s `opts.showPin === false` check uses strict equality with `false`; passing `undefined` (the default) still renders the pin. With `groupByDay` always passing `showPin: false` from the Schedule call site, this is consistent.
