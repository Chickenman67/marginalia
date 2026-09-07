# 2026-09-06 — Sweep stale color rules + clean Colors panel

## Problem

Three related issues on the Settings → Colors tab:

1. **Today items look the same color as past-due items.** Root cause: saved
   profiles from before today's migration still contain an
   `Overdue(0, #b4452f)` rule. On the previous fix's save, `readRules()`
   clamped `0` to `24` via `Math.max(1, Number(...) || 24)`, leaving a stale
   `Overdue(24, red)` rule sitting alongside `Today(24, orange)`. `colorFor`
   sorts ascending by `withinHours` and uses JS's stable sort, so the first
   rule with matching `withinHours` (the leftover Overdue red) wins the
   tiebreak. Items in the 0-24h window render red instead of orange.

2. **The Colors panel looks unpolished.** The Past-due color row uses
   browser-default styling — narrow color swatch, label not aligned with the
   rule rows below. No matching CSS exists for `.past-due-row`.

3. **No Save/Cancel button on the Colors panel.** The Save/Cancel row only
   lives at the bottom of the General panel. The user has to scroll back to
   the General tab to save color changes.

## Files touched

- `src/settings.ts` — export a `cleanColorRules` helper; use it in
  `loadSettings`.
- `src/ui/header.ts` — use `cleanColorRules` in the Save snapshot.
- `src/style.css` — add `.past-due-row` and sticky `.modal-foot` styles.
- `index.html` — extract the Save/Cancel row into a single shared footer
  outside the panels; add `.modal-foot` wrapper.
- `tests/unit/color-rules.test.ts` — add `cleanColorRules` unit tests;
  update any fixtures that referenced the legacy Overdue rule.

## Behavior spec

### `cleanColorRules` helper

In `src/settings.ts`:

```ts
export function cleanColorRules(rules: ColorRule[]): ColorRule[] {
  // 1. Drop the legacy Overdue rule (id === "r-overdue") — past-due items are
  //    now handled by `pastDueColor`, not by a 0-hrs rule.
  // 2. Drop any rule whose window is 0 or negative.
  // 3. Deduplicate by withinHours — keep the LAST rule at each window
  //    (user-added/edited rules sit at higher array indices).
  const filtered = rules.filter((r) => r.id !== "r-overdue" && r.withinHours > 0);
  const byHours = new Map<number, ColorRule>();
  for (const r of filtered) byHours.set(r.withinHours, r);
  return [...byHours.values()];
}
```

### Use sites

- `loadSettings` (`src/settings.ts:38`): change
  ```ts
  colorRules: p.color_rules ?? [],
  ```
  to
  ```ts
  colorRules: cleanColorRules(p.color_rules ?? []),
  ```
- Save handler (`src/ui/header.ts:153`): change
  ```ts
  colorRules: readRules().filter((r) => r.withinHours > 0),
  ```
  to
  ```ts
  colorRules: cleanColorRules(readRules()),
  ```

### Modal markup

In `index.html`:

- **Remove** the `<div class="row">` containing Cancel + Save (currently
  inside the General panel at lines 115-118).
- **Add** a single shared footer at the bottom of the modal (inside
  `#settingsModal` but outside any `.spanel`):
  ```html
  <div class="modal-foot">
    <button class="btn" id="settingsCancel" type="button">Cancel</button>
    <button class="btn primary" id="settingsSave" type="button">Save</button>
  </div>
  ```

This footer is visible on every tab (General, Colors, Backup). Existing
JS handlers (`settingsCancel`, `settingsSave` clicks) are unchanged.

### Modal footer styles

In `src/style.css`, add:

```css
.modal-foot {
  display: flex;
  gap: 7px;
  justify-content: flex-end;
  padding: 14px 0 0;
  margin-top: 14px;
  border-top: 1px solid var(--line);
  position: sticky;
  bottom: 0;
  background: var(--panel);
}
.modal-foot .btn { padding: 9px 18px; }
```

`var(--panel)` is the existing modal background color (the same one the
modal's main surface uses — `src/style.css:173`). Keeps the sticky footer
flush with the panel above it.

### Past-due row styles

In `src/style.css`, add (matching the existing `.rule` row styling):

```css
.past-due-row {
  display: flex;
  align-items: center;
  gap: 7px;
  margin-bottom: 9px;
}
.past-due-row label { font-size: 13.5px; color: var(--ink); }
.past-due-row input[type="color"] {
  width: 40px; height: 40px; padding: 0;
  border: 1px solid var(--line-strong); border-radius: 8px;
  background: none; cursor: pointer; overflow: hidden; flex: none;
}
.past-due-row input[type="color"]::-webkit-color-swatch-wrapper { padding: 0; }
.past-due-row input[type="color"]::-webkit-color-swatch { border: none; border-radius: 7px; }
.past-due-row input[type="color"]::-moz-color-swatch { border: none; border-radius: 7px; }
```

## Edge cases

- **User with 0 rules.** `cleanColorRules([])` returns `[]`. Unchanged.
- **User with 1 rule, no duplicates.** Pass-through. Unchanged.
- **User with duplicate `withinHours`** (Today(24) and a custom rule both at
  24). The LAST one in array order wins (Map.set keeps the latest). User-
  added/edited rules are at higher indices → they win. Intent.
- **User with stale Overdue rule + Today rule both at `withinHours=24`.**
  After sweep: only the LAST 24-hr rule remains. The first one (Overdue red)
  is dropped. Today items render the right color.
- **Modal Cancel still closes without saving** (existing handler at
  header.ts:140).
- **Modal backdrop click still closes** (existing handler at header.ts:144).
- **Sticky footer in a long Colors panel** — `position: sticky` with
  `bottom: 0` keeps it visible while scrolling.
- **Modal-foot background color.** `--panel` is the existing modal surface
  color (defined in `src/style.css:2` and used by `.modal` at line 173).

## Testing

### Unit tests (vitest)

In `tests/unit/clean-color-rules.test.ts` (new) or extend
`color-rules.test.ts`:

```ts
import { cleanColorRules } from "../../src/settings";

test("drops the legacy Overdue rule by id", () => {
  const rules = [
    { id: "r-overdue",  label: "Overdue",   color: "#b4452f", withinHours: 0 },
    { id: "r-today",    label: "Today",     color: "#d28c2a", withinHours: 24 },
    { id: "r-thisweek", label: "This week", color: "#3f7d6e", withinHours: 168 }
  ];
  expect(cleanColorRules(rules)).toEqual([
    { id: "r-today",    label: "Today",     color: "#d28c2a", withinHours: 24 },
    { id: "r-thisweek", label: "This week", color: "#3f7d6e", withinHours: 168 }
  ]);
});

test("drops rules with withinHours <= 0", () => {
  const rules = [
    { id: "a", label: "x", color: "#000", withinHours: 0 },
    { id: "b", label: "y", color: "#111", withinHours: -5 },
    { id: "c", label: "z", color: "#222", withinHours: 24 }
  ];
  expect(cleanColorRules(rules)).toEqual([
    { id: "c", label: "z", color: "#222", withinHours: 24 }
  ]);
});

test("dedupes by withinHours, keeping the last", () => {
  const rules = [
    { id: "a", label: "first",  color: "#111", withinHours: 24 },
    { id: "b", label: "second", color: "#222", withinHours: 24 }
  ];
  expect(cleanColorRules(rules)).toEqual([
    { id: "b", label: "second", color: "#222", withinHours: 24 }
  ]);
});

test("empty input returns empty array", () => {
  expect(cleanColorRules([])).toEqual([]);
});
```

### Browser verification via Playwright MCP

The Playwright MCP is configured (see `AGENTS.md`) with a persistent storage
state so the auth screen is bypassed. Use `browser_navigate` to load the
app, then:

1. Navigate to `http://localhost:5173` (Vite dev server; start it first if
   not running with `npm run dev`).
2. Click the gear icon (`#settingsBtn`) to open Settings.
3. Click the "Colors" tab.
4. Screenshot the modal. Confirm:
   - Past-due row is visually aligned with the rule rows below.
   - Past-due picker shows a 40×40 swatch (not the narrow default).
   - Save / Cancel buttons are reachable at the bottom of the modal.
5. Switch to the Schedule tab in the app. Create or inspect a past event
   and a today event. Take a screenshot. Confirm the two items have
   different accent border colors.

If any visual check fails, fix the CSS/markup and re-test. Capture before
and after screenshots and save to `.scratch/colors-panel-after.png` and
`.scratch/schedule-colors-after.png`.

### Regression

Existing 121 tests must continue to pass. Update any fixtures referencing
the legacy Overdue rule (`{ id: "r-overdue", withinHours: 0 }`) to either
omit it or use the new format.

## Out of scope

- Sorting rules by `withinHours` ascending in the displayed list (cosmetic;
  can revisit later).
- "Restore defaults" button (YAGNI).
- Color picker presets (YAGNI).
- A separate "past-due color appears in the schedule row preview" sample
  swatch next to the picker (YAGNI).
