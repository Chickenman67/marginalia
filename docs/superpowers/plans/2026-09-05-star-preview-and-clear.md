# Star hover preview + clear hint implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the stretched/distorted preview stars on hover and surface a "Clear" tooltip hint when hovering the star at the current rating.

**Architecture:** Two single-line behavioural changes:
1. `.stars .preview` column track: `repeat(5, 1fr)` → `repeat(5, 20%)` so each cell matches one committed star's width exactly (18px or 20px on `.card.todo`).
2. In the existing mousemove handler in `src/ui/input.ts`, set the tip text to `"Clear"` when the hovered value equals the item's current rating.

**Tech Stack:** TypeScript, vanilla CSS, vitest. No new deps.

**Spec:** `docs/superpowers/specs/2026-09-05-star-preview-and-clear.md`

## Global Constraints

- Browser support floor: evergreen Chromium / Firefox / Safari (the app already targets these for Web Speech API).
- Mobile must work — the "click same star to clear" path already covers touch.
- No new UI chrome — all hints live inside the existing `.tip` element.
- Project style: free-tier only, no paid APIs. (Not relevant here.)

---

## File map

| File                              | Responsibility                          | Change in this plan |
| --------------------------------- | --------------------------------------- | ------------------ |
| `src/style.css`                   | Star widget CSS                         | Edit 1 line        |
| `src/ui/input.ts`                 | Star hover/click handlers               | Edit ~6 lines      |
| `tests/unit/views.test.ts`        | CSS regression tests                    | Append 1 test      |
| `tests/unit/star.test.ts`         | Star render + DOM behaviour tests       | Append 2 tests     |

No new files. No HTML / TS structural changes.

---

### Task 1: CSS regression test for preview grid column track

**Files:**
- Modify: `tests/unit/views.test.ts:238-240` (append to `describe("style.css — weekday + todo sizing", …)` block)
- Touch: `src/style.css:359-377` (no change yet, test must fail)

**Interfaces:**
- Consumes: existing `css` const (already reads `src/style.css` once at top of the describe block)
- Produces: a vitest assertion that fails today and passes after Task 2

- [ ] **Step 1: Add the failing regression test**

Open `tests/unit/views.test.ts`. Locate the existing test block:

```ts
  it(".stars .preview is the hover preview overlay", () => {
    expect(css).toMatch(/\.stars\s+\.preview\s*\{/);
  });
```

Add this test immediately after it (still inside the same `describe` block):

```ts
  it(".stars .preview uses percentage columns (20%) so cells are square, not 1fr", () => {
    // Regression: each .preview-star cell must be a square matching one
    // committed star's width. `repeat(5, 1fr)` collapses to each SVG's
    // min-content (~10px), producing 10x18 elongated "stretched" stars
    // instead of clean 18x18 squares. Fix is `repeat(5, 20%)`.
    const previewBlock = css.match(/\.stars\s+\.preview\s*\{([^}]*)\}/)?.[1] ?? "";
    expect(previewBlock, "expected a .stars .preview rule block").toBeTruthy();
    expect(previewBlock).toMatch(/grid-template-columns\s*:\s*repeat\(\s*5\s*,\s*20%\s*\)/);
    expect(previewBlock).not.toMatch(/grid-template-columns\s*:\s*repeat\(\s*5\s*,\s*1fr\s*\)/);
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run from repo root:

```bash
npx vitest run tests/unit/views.test.ts -t "uses percentage columns"
```

Expected output: **FAIL** with `expected '…' to match /grid-template-columns\s*:\s*repeat\(\s*5\s*,\s*20%\s*\)/`. (The current CSS uses `1fr`.)

- [ ] **Step 3: Commit the failing test**

```bash
git add tests/unit/views.test.ts
git -c user.email=marginalia@dev.invalid -c user.name=Chickenman67 \
  commit -m "test(stars): regression — preview grid needs 20% columns, not 1fr"
```

---

### Task 2: CSS fix — `repeat(5, 1fr)` → `repeat(5, 20%)`

**Files:**
- Modify: `src/style.css:362` (one line inside `.stars .preview { … }`)

**Interfaces:**
- Consumes: nothing (pure CSS rule change)
- Produces: each `.preview-star` cell matches a committed star's width; preview stars render as clean squares

- [ ] **Step 1: Make the edit**

Open `src/style.css`. Locate the `.stars .preview { … }` rule (around line 359). It currently reads:

```css
.stars .preview {
  position: absolute;
  inset: 0;
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  pointer-events: none;
  opacity: 0;
  transition: opacity .12s ease;
  /* Reset properties the dock's `.preview` (parse-preview text box) sets,
     otherwise they bleed into the star hover overlay and render a black
     ink-coloured pill that hides the hover preview / committed stars. */
  background: transparent;
  box-shadow: none;
  padding: 0;
  font-size: inherit;
  color: inherit;
  margin: 0;
  border-radius: 0;
  animation: none;
}
```

Change **only** the `grid-template-columns` line:

```css
  grid-template-columns: repeat(5, 20%);
```

Leave every other line untouched. The result is:

```css
.stars .preview {
  position: absolute;
  inset: 0;
  display: grid;
  grid-template-columns: repeat(5, 20%);
  pointer-events: none;
  opacity: 0;
  transition: opacity .12s ease;
  /* Reset properties the dock's `.preview` (parse-preview text box) sets,
     otherwise they bleed into the star hover overlay and render a black
     ink-coloured pill that hides the hover preview / committed stars. */
  background: transparent;
  box-shadow: none;
  padding: 0;
  font-size: inherit;
  color: inherit;
  margin: 0;
  border-radius: 0;
  animation: none;
}
```

- [ ] **Step 2: Re-run the failing test from Task 1**

```bash
npx vitest run tests/unit/views.test.ts -t "uses percentage columns"
```

Expected: **PASS**.

- [ ] **Step 3: Run the full suite to check nothing else broke**

```bash
npx vitest run
```

Expected: all 120 (or 121 after Task 3/4 are added) tests pass. Pay special attention to `tests/unit/views.test.ts`, `tests/unit/star.test.ts`, and `tests/unit/star-click.test.ts`.

- [ ] **Step 4: Live-verify in the browser**

Start the dev server:

```bash
Start-Process -NoNewWindow -FilePath "npx.cmd" -ArgumentList "vite","--port","5175","--host","127.0.0.1" -RedirectStandardOutput "$env:TEMP\\opencode\\vite.log" -RedirectStandardError "$env:TEMP\\opencode\\vite.err"
```

Open `http://127.0.0.1:5175/` in Chrome. Use `chrome-devtools_evaluate_script` to mount a `.stars` row, set `data-hover="5"`, and measure each `.preview-star`:

```js
async () => {
  const m = await import('/src/ui/views.ts?v=' + Date.now());
  if (!document.getElementById('starShape')) document.body.insertAdjacentHTML('afterbegin', m.starSymbolHTML());
  const starHTML = m.starHTML(0, 'abc');
  const wrap = document.createElement('div');
  wrap.innerHTML = `<div style="padding:80px;background:#fff;width:300px">${starHTML}</div>`;
  wrap.style.cssText = 'position:fixed;left:0;top:0;z-index:9999';
  document.body.appendChild(wrap);
  wrap.querySelector('.stars').dataset.hover = '5';
  await new Promise(r => setTimeout(r, 250));
  const ps = [...wrap.querySelectorAll('.preview-star')];
  const info = ps.map(p => {
    const r = p.getBoundingClientRect();
    return { w: +r.width.toFixed(1), h: +r.height.toFixed(1), ratio: +(r.width/r.height).toFixed(2) };
  });
  document.querySelectorAll('[style*="z-index:9999"]').forEach(el => el.remove());
  return info;
}
```

Expected: each entry is `{w: 18, h: 18, ratio: 1}`. (If you sized the test wrapper to `.card.todo`, expect `{w: 20, h: 20, ratio: 1}`.)

- [ ] **Step 5: Commit**

```bash
git add src/style.css
git -c user.email=marginalia@dev.invalid -c user.name=Chickenman67 \
  commit -m "fix(stars): preview grid uses 20% columns so cells are square"
```

---

### Task 3: JS regression test — tip shows "Clear" on same-rating hover

**Files:**
- Modify: `tests/unit/star.test.ts` (append a new `describe` block at end of file)

**Interfaces:**
- Consumes: existing helpers `starHTML` and the jsdom env (top of file uses `// @vitest-environment jsdom`)
- Produces: a vitest assertion that fails today (tip text is the rating number) and passes after Task 4

- [ ] **Step 1: Add the failing test**

Append to `tests/unit/star.test.ts`:

```ts
import { bindStarEvents } from "../../src/ui/input";

describe("star hover — Clear hint", () => {
  it("renders tooltip 'Clear' when hovering the star at the current rating", async () => {
    // Mount a single Todo card with rating 3.
    document.body.innerHTML = `
      <div id="host">
        ${starHTML(3, "item-1")}
      </div>
    `;
    const host = document.getElementById("host")!;
    const items = [{
      id: "item-1", space_token: "s", user_id: "", kind: "todo" as const,
      title: "Test", datetime: null, all_day: false, reminder: null,
      status: "pending" as const, created_at: "2026-01-01T00:00:00.000Z",
      order: 0, pinned: false, rating: 3
    }];
    bindStarEvents(host, items);

    // Dispatch a mousemove on the whole-zone of star 3 (matches rating 3).
    const star3 = host.querySelector<HTMLElement>('.star[data-pos="3"]')!;
    Object.defineProperty(star3, "clientWidth", { value: 18, configurable: true });
    star3.dispatchEvent(new MouseEvent("mousemove", {
      bubbles: true, clientX: 0, clientY: 0
    }));

    // Tip text should read "Clear" because value === current rating.
    const tip = host.querySelector<HTMLElement>(".tip")!;
    expect(tip.textContent).toBe("Clear");
  });

  it("renders tooltip number when hovering a different rating", async () => {
    document.body.innerHTML = `<div id="host">${starHTML(3, "item-2")}</div>`;
    const host = document.getElementById("host")!;
    const items = [{
      id: "item-2", space_token: "s", user_id: "", kind: "todo" as const,
      title: "Test", datetime: null, all_day: false, reminder: null,
      status: "pending" as const, created_at: "2026-01-01T00:00:00.000Z",
      order: 0, pinned: false, rating: 3
    }];
    bindStarEvents(host, items);

    const star4 = host.querySelector<HTMLElement>('.star[data-pos="4"]')!;
    Object.defineProperty(star4, "clientWidth", { value: 18, configurable: true });
    star4.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: 0, clientY: 0 }));

    const tip = host.querySelector<HTMLElement>(".tip")!;
    expect(tip.textContent).toBe("4");
  });
});
```

The `import { bindStarEvents } from "../../src/ui/input";` line goes near the top of the file (after the existing imports).

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run tests/unit/star.test.ts -t "Clear hint"
```

Expected: **FAIL** — `star.test.ts:tip-text` asserts `"4"` but currently receives `"4"` (the number) for the "different rating" case (which should already pass), and the "Clear" test fails with `expected '4' to be 'Clear'`.

- [ ] **Step 3: Commit the failing test**

```bash
git add tests/unit/star.test.ts
git -c user.email=marginalia@dev.invalid -c user.name=Chickenman67 \
  commit -m "test(stars): Clear hint on hover-equal-current rating"
```

---

### Task 4: JS fix — show "Clear" tooltip on same-rating hover

**Files:**
- Modify: `src/ui/input.ts:558-568` (inside the `mousemove` handler in `bindStarEvents`)

**Interfaces:**
- Consumes: existing closure variables `items`, `row`; the `value` already computed in the handler
- Produces: `tip.textContent` = `"Clear"` when `value === it.rating`, else `String(value)`

- [ ] **Step 1: Make the edit**

Open `src/ui/input.ts`. Locate the mousemove handler (around line 558–568):

```ts
      starEl.addEventListener("mousemove", (e) => {
        if (host.querySelector(".card.selected")) return; // selection mode
        const pos = Number(starEl.dataset.pos);
        const me = e as MouseEvent;
        const value = starHoverValue(pos, me.offsetX, starEl.clientWidth);
        row.dataset.hover = String(value);
        // Update the tip text to follow the cursor.
        const tip = row.querySelector<HTMLElement>(".tip");
        if (tip) tip.textContent = String(value);
      });
```

Replace the tip-text line with a check against the item's current rating:

```ts
      starEl.addEventListener("mousemove", (e) => {
        if (host.querySelector(".card.selected")) return; // selection mode
        const pos = Number(starEl.dataset.pos);
        const me = e as MouseEvent;
        const value = starHoverValue(pos, me.offsetX, starEl.clientWidth);
        row.dataset.hover = String(value);
        // Update the tip text to follow the cursor. When the hovered position
        // matches the current rating, show "Clear" so the toggle-off action
        // (click same star to clear) is discoverable.
        const tip = row.querySelector<HTMLElement>(".tip");
        if (tip) {
          const id = row.dataset.item;
          const it = id !== undefined ? items.find((x) => x.id === id) : undefined;
          tip.textContent = (it && value === it.rating) ? "Clear" : String(value);
        }
      });
```

- [ ] **Step 2: Re-run the failing tests from Task 3**

```bash
npx vitest run tests/unit/star.test.ts -t "Clear hint"
```

Expected: **PASS** for both tests.

- [ ] **Step 3: Run the full suite**

```bash
npx vitest run
```

Expected: all tests pass. Watch `tests/unit/star.test.ts`, `tests/unit/star-click.test.ts`, `tests/integration/star-row-stability.test.ts` — the mousemove handler change touches the most fragile code path.

- [ ] **Step 4: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Live-verify in the browser**

With the dev server already running on `http://127.0.0.1:5175/`, use `chrome-devtools_evaluate_script` to inject a card with rating 3, simulate a mousemove over star 3, and read the `.tip` text:

```js
async () => {
  const m = await import('/src/ui/views.ts?v=' + Date.now());
  if (!document.getElementById('starShape')) document.body.insertAdjacentHTML('afterbegin', m.starSymbolHTML());
  // Import the bind function
  const inp = await import('/src/ui/input.ts?v=' + Date.now());
  document.body.innerHTML += `<div id="probe" style="position:fixed;top:0;left:0;z-index:9999;background:#fff;padding:20px">${m.starHTML(3, 'probe')}</div>`;
  const host = document.getElementById('probe');
  const items = [{id:'probe', space_token:'s', user_id:'', kind:'todo', title:'t', datetime:null, all_day:false, reminder:null, status:'pending', created_at:'2026-01-01T00:00:00.000Z', order:0, pinned:false, rating:3}];
  inp.bindStarEvents(host, items);
  const star3 = host.querySelector('.star[data-pos="3"]');
  Object.defineProperty(star3, 'clientWidth', { value: 18, configurable: true });
  star3.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 14, clientY: 0 }));
  const tip = host.querySelector('.tip');
  const out = tip.textContent;
  host.remove();
  return out;
}
```

Expected return value: the string `"Clear"`.

Then move to a different star and verify the number returns:

```js
async () => {
  const m = await import('/src/ui/views.ts?v=' + Date.now());
  const inp = await import('/src/ui/input.ts?v=' + Date.now());
  document.body.innerHTML += `<div id="probe2" style="position:fixed;top:0;left:0;z-index:9999;background:#fff;padding:20px">${m.starHTML(3, 'probe2')}</div>`;
  const host = document.getElementById('probe2');
  const items = [{id:'probe2', space_token:'s', user_id:'', kind:'todo', title:'t', datetime:null, all_day:false, reminder:null, status:'pending', created_at:'2026-01-01T00:00:00.000Z', order:0, pinned:false, rating:3}];
  inp.bindStarEvents(host, items);
  const star4 = host.querySelector('.star[data-pos="4"]');
  Object.defineProperty(star4, 'clientWidth', { value: 18, configurable: true });
  star4.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 14, clientY: 0 }));
  const out = host.querySelector('.tip').textContent;
  host.remove();
  return out;
}
```

Expected return value: the string `"4"`.

- [ ] **Step 6: Commit**

```bash
git add src/ui/input.ts
git -c user.email=marginalia@dev.invalid -c user.name=Chickenman67 \
  commit -m "feat(stars): show 'Clear' tooltip when hover matches current rating"
```

---

## Self-review

**Spec coverage:**
- ✅ Preview stars render as squares → Task 2 (`repeat(5, 20%)`)
- ✅ Clear-rating affordance discoverable → Task 4 ("Clear" tooltip)
- ✅ Toggle-off click path already covered (out-of-scope refactor of existing logic) → no new test needed
- ✅ Existing half-step semantics preserved → Task 4 only changes tip text, not click handling

**Placeholder scan:** No `TBD`/`TODO`/etc. Every code block shown is real code.

**Type/signature consistency:** Task 3 imports `bindStarEvents` from `src/ui/input` (the export Task 4 edits); Task 4's edit keeps the existing function signature `(host, items)` and only mutates one statement inside the handler.