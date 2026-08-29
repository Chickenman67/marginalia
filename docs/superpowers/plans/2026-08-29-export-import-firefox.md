# Export / Import (CSV + Text), Token Download, Firefox Voice — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users download their space token as `.txt`, export their schedule/todos as readable CSV or text (and import them back, choosing Merge or Replace), and give Firefox users free in-browser voice input — plus remove the "your quiet planner" tagline.

**Architecture:** Pure formatting/parsing lives in a new `src/backup.ts` (no DOM), store gets an `importItems` that reuses existing insert/delete paths for both demo and synced modes, and `src/whisper.ts` adds an on-device Whisper fallback that `src/speech.ts` selects when the Web Speech API is absent. UI hooks live in `src/ui/header.ts` + `index.html`.

**Tech Stack:** Vite + TypeScript (vanilla DOM), `@huggingface/transformers` (WASM Whisper, free, no key), `vitest` for unit tests (jsdom env for store/localStorage tests).

## Global Constraints

- TypeScript `strict` mode is on; `noUnusedLocals`/`noUnusedParameters` are on — no unused vars.
- `verbatimModuleSyntax` is on — use `import type` for type-only imports.
- Demo mode = no `VITE_SUPABASE_URL` (localStorage); synced mode = Supabase. All data paths must work in both.
- Voice must be completely free / no API key. Firefox uses on-device Whisper.
- User chooses export format (CSV or text) and import mode (Merge or Replace).
- Build command: `npm run build` = `tsc --noEmit && vite build`. Tests: `npm run test` = `vitest run`.

---

### Task 1: Remove tagline + update voice hint

**Files:**
- Modify: `index.html:16` (remove tag), `index.html:69` (update hint)

**Interfaces:** None (static markup only).

- [ ] **Step 1: Remove the tagline span**

In `index.html`, delete the line:
```html
      <span class="tag">your quiet planner</span>
```

- [ ] **Step 2: Update the voice hint**

Replace line 69:
```html
        <div class="hint" id="hint">Press <span class="kbd">Enter</span> to add · voice works in Chrome, Edge, Safari (not Firefox)</div>
```
with:
```html
        <div class="hint" id="hint">Press <span class="kbd">Enter</span> to add · voice works in all modern browsers</div>
```

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: build succeeds with no errors (this is a static change; the removed `.tag` element is only referenced in markup, not in TS).

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "chore: remove 'your quiet planner' tagline, broaden voice hint"
```

---

### Task 2: Backup module — formats + parse (with tests)

**Files:**
- Create: `src/backup.ts`
- Create: `tests/unit/backup.test.ts`

**Interfaces:**
- Consumes: `Item` from `./types`, `formatClock` from `./settings`.
- Produces:
  - `export interface ImportRow { kind: "todo" | "event"; title: string; datetime: string | null; all_day: boolean; reminder: string | null; status: "pending" | "done"; }`
  - `export function toCSV(items: Item[]): string`
  - `export function toText(items: Item[]): string`
  - `export function downloadToken(token: string): void`
  - `export function download(content: string, filename: string, mime: string): void`
  - `export function parseFile(text: string): ImportRow[]`
  - `export function applyImport(rows: ImportRow[], mode: "merge" | "replace"): Promise<void>`

- [ ] **Step 1: Write the failing tests**

`tests/unit/backup.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { toCSV, toText, parseFile } from "../../src/backup";
import type { Item } from "../../src/types";

function mk(p: Partial<Item>): Item {
  return {
    id: "id1", space_token: "sp", kind: "event", title: "Dentist",
    datetime: "2026-08-30T15:00:00.000Z", all_day: false,
    reminder: "2026-08-30T15:00:00.000Z", status: "pending",
    created_at: "2026-08-28T10:00:00.000Z", ...p
  };
}

describe("toCSV", () => {
  it("emits a quoted header and one row per item, quoting commas", () => {
    const csv = toCSV([mk({ title: "Call, mom" })]);
    expect(csv.split("\n")[0]).toBe("kind,title,datetime,all_day,reminder,status,created_at");
    expect(csv).toContain('"Call, mom"');
  });
});

describe("toText", () => {
  it("groups events and todos and embeds ISO for round-trip", () => {
    const txt = toText([mk({}), mk({ kind: "todo", title: "Buy milk", datetime: null, reminder: null, status: "done" })]);
    expect(txt).toContain("SCHEDULE");
    expect(txt).toContain("TODOS");
    expect(txt).toContain("[ ] Dentist — 2026-08-30T15:00:00.000Z");
    expect(txt).toContain("[x] Buy milk");
  });
});

describe("parseFile", () => {
  it("round-trips CSV", () => {
    const csv = toCSV([mk({})]);
    const rows = parseFile(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0].title).toBe("Dentist");
    expect(rows[0].kind).toBe("event");
    expect(rows[0].datetime).toBe("2026-08-30T15:00:00.000Z");
  });
  it("round-trips text", () => {
    const txt = toText([mk({}), mk({ kind: "todo", title: "Buy milk", datetime: null, reminder: null, status: "done" })]);
    const rows = parseFile(txt);
    expect(rows).toHaveLength(2);
    expect(rows[0].status).toBe("pending");
    expect(rows[1].status).toBe("done");
    expect(rows[1].kind).toBe("todo");
  });
  it("skips malformed CSV rows but keeps valid ones", () => {
    const bad = "kind,title\n" + "event,Ok\n" + "event,NoHeaderRow";
    const rows = parseFile(bad);
    expect(rows).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -- tests/unit/backup.test.ts`
Expected: FAIL — `src/backup.ts` does not exist.

- [ ] **Step 3: Write the implementation**

`src/backup.ts`:
```ts
import type { Item } from "./types";
import { formatClock } from "./settings";

export interface ImportRow {
  kind: "todo" | "event";
  title: string;
  datetime: string | null;
  all_day: boolean;
  reminder: string | null;
  status: "pending" | "done";
}

export function download(content: string, filename: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function downloadToken(token: string): void {
  download(token, "marginalia-space-token.txt", "text/plain");
}

function csvCell(v: string | null): string {
  if (v === null) return "";
  if (/[",\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

export function toCSV(items: Item[]): string {
  const header = "kind,title,datetime,all_day,reminder,status,created_at";
  const lines = items.map((i) =>
    [i.kind, i.title, i.datetime, String(i.all_day), i.reminder, i.status, i.created_at]
      .map((c) => csvCell(c === null ? null : String(c)))
      .join(",")
  );
  return [header, ...lines].join("\n");
}

function pad(n: number): string { return String(n).padStart(2, "0"); }

function humanDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) +
    (iso.includes("T") && !iso.endsWith("T00:00:00.000Z") ? `, ${formatClock(iso)}` : "");
}

export function toText(items: Item[]): string {
  const stamp = new Date().toISOString().slice(0, 10);
  const events = items.filter((i) => i.kind === "event");
  const todos = items.filter((i) => i.kind === "todo");
  const line = (i: Item) => {
    const mark = i.status === "done" ? "[x]" : "[ ]";
    const when = i.datetime ? ` — ${i.datetime} (${humanDate(i.datetime)})` : "";
    return `- ${mark} ${i.title}${when}`;
  };
  const parts = [`Marginalia export — ${stamp}`, "SCHEDULE"];
  parts.push(events.length ? events.map(line).join("\n") : "  (none)");
  parts.push("TODOS");
  parts.push(todos.length ? todos.map(line).join("\n") : "  (none)");
  return parts.join("\n");
}

export function parseFile(text: string): ImportRow[] {
  const trimmed = text.trim();
  const firstLine = trimmed.split("\n")[0]?.trim() ?? "";
  const looksCsv = /^kind,title,datetime,all_day,reminder,status,created_at/i.test(firstLine);
  return looksCsv ? parseCsv(trimmed) : parseText(trimmed);
}

function parseCsv(text: string): ImportRow[] {
  const rows = text.split("\n").slice(1).map((r) => r.trim()).filter(Boolean);
  const out: ImportRow[] = [];
  for (const row of rows) {
    const cols = splitCsvRow(row);
    if (cols.length < 6) continue; // malformed — skip
    const [kind, title, datetime, all_day, reminder, status] = cols;
    if (kind !== "event" && kind !== "todo") continue;
    out.push({
      kind,
      title: title || "Untitled",
      datetime: datetime || null,
      all_day: all_day === "true",
      reminder: reminder || null,
      status: status === "done" ? "done" : "pending"
    });
  }
  return out;
}

function splitCsvRow(row: string): string[] {
  const out: string[] = [];
  let cur = "", inQ = false;
  for (let i = 0; i < row.length; i++) {
    const c = row[i];
    if (inQ) {
      if (c === '"') {
        if (row[i + 1] === '"') { cur += '"'; i++; } else inQ = false;
      } else cur += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

function parseText(text: string): ImportRow[] {
  const lines = text.split("\n");
  let section: "event" | "todo" | null = null;
  const out: ImportRow[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (/^SCHEDULE/i.test(line)) { section = "event"; continue; }
    if (/^TODOS/i.test(line)) { section = "todo"; continue; }
    if (!line.startsWith("- ")) continue;
    const body = line.slice(2).trim();
    const m = body.match(/^\[( |x)\]\s+(.*)$/);
    if (!m) continue;
    const status = m[1] === "x" ? "done" : "pending";
    let title = m[2];
    let datetime: string | null = null;
    const isoMatch = title.match(/—\s*(\S+?)\s*\(/); // " — <ISO> (human)"
    if (isoMatch) {
      datetime = isoMatch[1];
      title = title.slice(0, isoMatch.index).replace(/—\s*$/, "").trim();
    } else {
      title = title.replace(/—.*$/, "").trim();
    }
    out.push({
      kind: section ?? "todo",
      title: title || "Untitled",
      datetime,
      all_day: false,
      reminder: datetime,
      status
    });
  }
  return out;
}
```

Note: `applyImport` is implemented in Task 3 (it depends on `store.importItems`).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -- tests/unit/backup.test.ts`
Expected: PASS (3 describe blocks).

- [ ] **Step 5: Commit**

```bash
git add src/backup.ts tests/unit/backup.test.ts
git commit -m "feat: add CSV/text export formatting + import parsing"
```

---

### Task 3: Store import (merge / replace) + test

**Files:**
- Modify: `src/store.ts` (add `importItems`)
- Create: `tests/unit/store-import.test.ts`

**Interfaces:**
- Consumes from backup: `ImportRow` (added in Task 2).
- Produces: `export async function importItems(rows: ImportRow[], mode: "merge" | "replace"): Promise<void>`

- [ ] **Step 1: Write the failing test**

`tests/unit/store-import.test.ts` — uses jsdom for `localStorage`. Put this at the very top of the file:
```ts
// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { setItems, getItems, importItems } from "../../src/store";
import type { ImportRow } from "../../src/backup";

function row(title: string, kind: "todo" | "event" = "todo"): ImportRow {
  return { kind, title, datetime: null, all_day: false, reminder: null, status: "pending" };
}

describe("importItems (demo mode)", () => {
  beforeEach(() => { localStorage.clear(); setItems([]); });
  it("merge appends rows as new items", async () => {
    setItems([{ id: "a", space_token: "sp", kind: "todo", title: "Existing", datetime: null, all_day: false, reminder: null, status: "pending", created_at: new Date().toISOString() }]);
    await importItems([row("Imported")], "merge");
    const all = getItems();
    expect(all).toHaveLength(2);
    expect(all.some((i) => i.title === "Imported")).toBe(true);
  });
  it("replace clears then loads only imported rows", async () => {
    setItems([{ id: "a", space_token: "sp", kind: "todo", title: "Existing", datetime: null, all_day: false, reminder: null, status: "pending", created_at: new Date().toISOString() }]);
    await importItems([row("Only")], "replace");
    const all = getItems();
    expect(all).toHaveLength(1);
    expect(all[0].title).toBe("Only");
  });
});
```
(You must also export `getItems` from `store.ts` in this task — see Step 3.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -- tests/unit/store-import.test.ts`
Expected: FAIL — `importItems` / `getItems` not exported.

- [ ] **Step 3: Implement in store.ts**

Add a `getItems` getter and `importItems` to `src/store.ts`:
```ts
export function getItems(): Item[] {
  return items.slice();
}

export async function importItems(rows: ImportRow[], mode: "merge" | "replace"): Promise<void> {
  const toItem = (r: ImportRow): Item => ({
    id: crypto.randomUUID(),
    space_token: getSpaceId(),
    kind: r.kind,
    title: r.title.slice(0, 200),
    datetime: r.datetime,
    all_day: r.all_day,
    reminder: r.reminder,
    status: r.status,
    created_at: new Date().toISOString()
  });

  if (isDemoMode) {
    if (mode === "replace") {
      setItems(rows.map(toItem));
    } else {
      setItems([...items, ...rows.map(toItem)]);
    }
    return;
  }

  // synced mode
  if (mode === "replace") {
    for (const it of items) await removeItem(it.id);
    items = [];
  }
  for (const r of rows) {
    const saved = await insertItem(toItem(r));
    items = [...items, saved];
  }
  items.sort(byCreated);
  emit();
}
```
Add the import at the top of `store.ts`:
```ts
import type { Item, ParsedItem } from "./types";
import type { ImportRow } from "./backup";
```
(Keep the existing `import type { Item, ParsedItem }` line — merge into it: change to `import type { Item, ParsedItem, ImportRow } from "./types";` is wrong because `ImportRow` lives in `backup`. Import it separately as a type from `"./backup"`.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -- tests/unit/store-import.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/store.ts tests/unit/store-import.test.ts
git commit -m "feat: store.importItems with merge/replace, demo + synced"
```

---

### Task 4: Wire `applyImport` into backup.ts

**Files:**
- Modify: `src/backup.ts` (add `applyImport` + import `importItems`)

**Interfaces:**
- Consumes: `importItems` from `./store`.
- Produces: `export async function applyImport(rows: ImportRow[], mode: "merge" | "replace"): Promise<void>`

- [ ] **Step 1: Add the function**

In `src/backup.ts`, add the import and function:
```ts
import { importItems } from "./store";

export async function applyImport(rows: ImportRow[], mode: "merge" | "replace"): Promise<void> {
  await importItems(rows, mode);
}
```
This is a thin pass-through so callers in `header.ts` only depend on `backup.ts`.

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/backup.ts
git commit -m "feat: backup.applyImport delegates to store.importItems"
```

---

### Task 5: Whisper on-device STT (`src/whisper.ts`)

**Files:**
- Create: `src/whisper.ts`

**Interfaces:**
- Produces: `export function createWhisper(): WhisperController` where
  ```ts
  export interface WhisperController {
    supported: boolean;
    start(): Promise<void>;
    stop(): Promise<string>;
    onState: (listening: boolean) => void;
  }
  ```

- [ ] **Step 1: Implement the module**

`src/whisper.ts`:
```ts
export interface WhisperController {
  supported: boolean;
  start(): Promise<void>;
  stop(): Promise<string>;
  onState: (listening: boolean) => void;
}

type Transcriber = (audio: Float32Array) => Promise<{ text: string }>;

export function createWhisper(): WhisperController {
  const ctrl: WhisperController = {
    supported: typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia,
    start: async () => {},
    stop: async () => "",
    onState: () => {}
  };
  if (!ctrl.supported) return ctrl;

  let stream: MediaStream | null = null;
  let recorder: MediaRecorder | null = null;
  let chunks: BlobPart[] = [];
  let transcriber: Transcriber | null = null;

  ctrl.start = async () => {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    chunks = [];
    recorder = new MediaRecorder(stream);
    recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    recorder.start();
    ctrl.onState(true);
  };

  ctrl.stop = async () => {
    if (!recorder) return "";
    const done = new Promise<string>(async (resolve) => {
      recorder!.onstop = async () => {
        try {
          const blob = new Blob(chunks, { type: recorder!.mimeType || "audio/webm" });
          const buf = await blob.arrayBuffer();
          const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
          const ac = new AudioCtx();
          const audioBuf = await ac.decodeAudioData(buf);
          const samples = resampleTo16k(audioBuf);
          if (!transcriber) {
            const { pipeline } = await import("@huggingface/transformers");
            transcriber = (await pipeline(
              "automatic-speech-recognition",
              "Xenova/whisper-tiny.en",
              { device: "wasm", dtype: "q8" }
            )) as unknown as Transcriber;
          }
          const out = await transcriber(samples);
          resolve((out.text || "").trim());
        } catch (err) {
          console.error("whisper failed", err);
          resolve("");
        } finally {
          stream?.getTracks().forEach((t) => t.stop());
          ctrl.onState(false);
        }
      };
      recorder!.stop();
    });
    return done;
  };

  return ctrl;
}

function resampleTo16k(audioBuf: AudioBuffer): Float32Array {
  const targetRate = 16000;
  const offline = new OfflineAudioContext(1, Math.ceil(audioBuf.duration * targetRate), targetRate);
  const src = offline.createBufferSource();
  src.buffer = audioBuf;
  src.connect(offline.destination);
  src.start();
  const rendered = offline.startRendering() as unknown as Promise<AudioBuffer>;
  // startRendering returns a promise in modern browsers
  const resolved = rendered as unknown as AudioBuffer;
  return resolved.getChannelData(0);
}
```
Note: `OfflineAudioContext.startRendering()` returns a Promise in all modern browsers. Replace the synchronous `resampleTo16k` with an `async` version and `await` it inside `stop`. Correct implementation:

```ts
async function resampleTo16k(audioBuf: AudioBuffer): Promise<Float32Array> {
  const targetRate = 16000;
  const offline = new OfflineAudioContext(1, Math.ceil(audioBuf.duration * targetRate), targetRate);
  const src = offline.createBufferSource();
  src.buffer = audioBuf;
  src.connect(offline.destination);
  src.start();
  const rendered = await offline.startRendering();
  return rendered.getChannelData(0);
}
```
And in `stop`, change `const samples = resampleTo16k(audioBuf);` to `const samples = await resampleTo16k(audioBuf);`.

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors (the `@huggingface/transformers` types resolve once the dependency is installed in Task 8; if types are missing you may need `// @ts-expect-error` on the dynamic import line — prefer adding the dependency first in Task 8, then returning here if needed).

- [ ] **Step 3: Commit**

```bash
git add src/whisper.ts
git commit -m "feat: on-device Whisper STT controller for Firefox"
```

---

### Task 6: Engine selection in `src/speech.ts`

**Files:**
- Modify: `src/speech.ts`

**Interfaces:**
- Produces: unchanged `SpeechController` interface consumed by `src/ui/input.ts`.
- Consumes: `createWhisper` from `./whisper`.

- [ ] **Step 1: Refactor createSpeech to pick engine**

Rewrite `src/speech.ts` so it uses Web Speech API when present, else Whisper:
```ts
import { createWhisper } from "./whisper";

export interface SpeechController {
  supported: boolean;
  start(): void;
  stop(): void;
  onResult: (text: string) => void;
  onState: (listening: boolean) => void;
}

export function createSpeech(): SpeechController {
  const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
  if (SR) {
    // --- existing Web Speech API path (unchanged behavior) ---
    const ctrl: SpeechController = {
      supported: true, start: () => {}, stop: () => {}, onResult: () => {}, onState: () => {}
    };
    let acc = "";
    const rec = new SR();
    rec.interimResults = true;
    rec.continuous = true;
    rec.lang = navigator.language || "en-US";
    rec.onresult = (e: any) => {
      let chunk = "";
      for (let i = e.resultIndex; i < e.results.length; i++) chunk += e.results[i][0].transcript;
      if (e.results[e.results.length - 1].isFinal) acc += chunk + " ";
      ctrl.onResult(acc.trim());
    };
    rec.onend = () => ctrl.onState(false);
    rec.onerror = () => ctrl.onState(false);
    ctrl.start = () => { acc = ""; try { rec.start(); ctrl.onState(true); } catch {} };
    ctrl.stop = () => rec.stop();
    return ctrl;
  }

  // --- Firefox / no Web Speech API: on-device Whisper ---
  const w = createWhisper();
  const ctrl: SpeechController = {
    supported: w.supported,
    start: () => { w.start().catch(() => ctrl.onState(false)); },
    stop: () => { w.stop().then((t) => ctrl.onResult(t)).catch(() => {}); },
    onResult: () => {},
    onState: () => {}
  };
  w.onState = (l) => ctrl.onState(l);
  return ctrl;
}
```
`input.ts` already disables the mic when `!speech.supported` and shows "Voice not supported in this browser — type instead". Firefox is now `supported`, so the mic stays enabled.

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/speech.ts
git commit -m "feat: speech engine selection (Web Speech API, Whisper fallback)"
```

---

### Task 7: Backup UI — token download + export/import controls

**Files:**
- Modify: `index.html` (token modal + settings modal)
- Modify: `src/ui/header.ts` (wire controls)

**Interfaces:**
- Consumes from backup: `downloadToken`, `toCSV`, `toText`, `parseFile`, `applyImport`.
- Consumes from store: `getItems`, `getSpaceToken`.

- [ ] **Step 1: Add markup to index.html**

In the token modal (`#tokenModal`), after the `.row` with New space / Use this space, add:
```html
        <div class="row">
          <button class="btn" id="downloadToken">Download token (.txt)</button>
        </div>
```

In the settings modal (`#settingsModal`), after the color rules block (before the final `.row` of Close/Save), add:
```html
      <div class="rules-head">Backup</div>
      <div class="row">
        <button class="btn" id="exportCsv" type="button">Export CSV</button>
        <button class="btn" id="exportText" type="button">Export text</button>
      </div>
      <label class="toggle">Import a backup file</label>
      <input type="file" id="importFile" accept=".csv,.txt,text/plain" />
      <div class="row" id="importMode" hidden>
        <button class="btn" id="importMerge" type="button">Merge</button>
        <button class="btn primary" id="importReplace" type="button">Replace</button>
      </div>
      <div class="key-status" id="backupStatus"></div>
```

- [ ] **Step 2: Wire controls in header.ts**

In `mountHeader()`, after the existing token modal wiring (around the `tokenNew` handler), add:
```ts
  // token download
  document.getElementById("downloadToken")!.addEventListener("click", () => {
    downloadToken(getSpaceToken());
  });
```
Add imports at top of `header.ts`:
```ts
import { getSpaceToken, setSpaceToken, splitToken, combineToken, genTokenPair, getItems } from "../store";
import { downloadToken, toCSV, toText, parseFile, applyImport } from "../backup";
```
(extend the existing `store` import to include `getItems`.)

After the settings save handler (or near the other settings wiring), add the backup handlers:
```ts
  const exportCsv = document.getElementById("exportCsv") as HTMLButtonElement;
  const exportText = document.getElementById("exportText") as HTMLButtonElement;
  const importFile = document.getElementById("importFile") as HTMLInputElement;
  const importMode = document.getElementById("importMode") as HTMLDivElement;
  const importMerge = document.getElementById("importMerge") as HTMLButtonElement;
  const importReplace = document.getElementById("importReplace") as HTMLButtonElement;
  const backupStatus = document.getElementById("backupStatus") as HTMLSpanElement;

  let pendingRows: ImportRow[] = [];

  exportCsv.addEventListener("click", () => {
    download(toCSV(getItems()), "marginalia-schedule.csv", "text/csv");
  });
  exportText.addEventListener("click", () => {
    download(toText(getItems()), "marginalia-schedule.txt", "text/plain");
  });
  importFile.addEventListener("change", async () => {
    const file = importFile.files?.[0];
    if (!file) return;
    const text = await file.text();
    pendingRows = parseFile(text);
    importFile.value = "";
    if (!pendingRows.length) {
      backupStatus.textContent = "No items found in that file.";
      backupStatus.className = "key-status bad";
      importMode.hidden = true;
      return;
    }
    backupStatus.textContent = `Found ${pendingRows.length} item(s). Merge or replace?`;
    backupStatus.className = "key-status";
    importMode.hidden = false;
  });
  const runImport = async (mode: "merge" | "replace") => {
    try {
      await applyImport(pendingRows, mode);
      backupStatus.textContent = `Imported ${pendingRows.length} item(s) (${mode}).`;
      backupStatus.className = "key-status good";
    } catch (e) {
      backupStatus.textContent = `Import failed: ${e instanceof Error ? e.message : "error"}`;
      backupStatus.className = "key-status bad";
    }
    importMode.hidden = true;
    pendingRows = [];
  };
  importMerge.addEventListener("click", () => runImport("merge"));
  importReplace.addEventListener("click", () => runImport("replace"));
```
Add `download`, `ImportRow` to the backup import:
```ts
import { downloadToken, toCSV, toText, parseFile, applyImport, download } from "../backup";
import type { ImportRow } from "../backup";
```

- [ ] **Step 3: Typecheck + build**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add index.html src/ui/header.ts
git commit -m "feat: token download + CSV/text export and import UI"
```

---

### Task 8: Dependency + glossary + full verification

**Files:**
- Modify: `package.json` (add `@huggingface/transformers`)
- Modify: `CONTEXT.md` (Export / Import glossary line)

**Interfaces:** None.

- [ ] **Step 1: Add the dependency**

Add to `package.json` `dependencies`:
```json
"@huggingface/transformers": "^3.0.0"
```
Then install:
```bash
npm install
```

- [ ] **Step 2: Update CONTEXT.md glossary**

Replace the `## Export / Import` block (currently "Per-space JSON backup: download a space's items as a file; import restores them.") with:
```
## Export / Import

Per-space backup in readable formats. **Token**: the space token downloads as a `.txt` file (from the "Your space" modal). **Data**: the schedule and todos export as either CSV (`kind,title,datetime,all_day,reminder,status,created_at`) or a human-readable text list; the same file re-imports, with the user choosing **Merge** (append) or **Replace** (clear then load). Works in demo (localStorage) and synced (Supabase) modes.
```

- [ ] **Step 3: Full build + test**

Run: `npm run build && npm run test`
Expected: build + all tests pass.

- [ ] **Step 4: Manual browser verification**

1. `npm run dev`, open in Chrome: voice still works (Web Speech API path unchanged); settings Backup section shows Export CSV / Export text / Import; token modal has "Download token (.txt)".
2. Add a few items, Export CSV → open file, confirm columns + quoting. Export text → confirm readable grouped list with embedded ISO.
3. Export, then Import the same file with Merge → item count grows by the file's count. Re-import with Replace → item count equals the file's count.
4. Open in Firefox: mic button is enabled (not "not supported"). Click mic, grant permission, speak, click again → after the one-time model download, transcript appears in the input. If model load fails, input still works by typing.
5. Confirm "your quiet planner" is gone and the hint no longer excludes Firefox.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json CONTEXT.md
git commit -m "chore: add transformers dep, update export/import glossary"
```

---

## Self-review notes (per skill checklist)

- **Spec coverage:** tagline removal (Task 1), token `.txt` download (Tasks 7+4), CSV+text export (Task 2+7), import merge/replace (Tasks 2/3/4/7), Firefox Whisper (Tasks 5/6/8), glossary update (Task 8). All covered.
- **Type consistency:** `ImportRow`, `toCSV`, `toText`, `parseFile`, `applyImport`, `downloadToken`, `download` names match across Tasks 2–7. `store.importItems(rows, mode)` signature matches `backup.applyImport`. `SpeechController` interface unchanged for `input.ts`.
- **No placeholders:** every code step contains real implementation; manual verification steps are explicit actions, not "add tests later".
