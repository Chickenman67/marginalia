# Design: Export / Import (CSV + text), Token Download, Firefox Voice

**Date:** 2026-08-29
**Status:** Approved (design)

## Goal

Add three related capabilities to Marginalia:

1. **Token export** — download the current space token as a `.txt` file.
2. **Readable data export + import** — export the schedule/todos as either CSV or
   human-readable text (user's choice), and import that file back. Import asks the
   user to Merge or Replace.
3. **Firefox voice** — fully free, no-key, in-browser speech-to-text so Firefox users
   get voice input like Chrome/Edge/Safari.

Also remove the "your quiet planner" tagline.

## Non-goals

- No server-side speech-to-text (no API keys, no cost). Firefox uses on-device Whisper.
- No JSON backup format (superseded by CSV/text per user request).
- No realtime interim transcript in Firefox (final transcript on stop only).

## 1. Remove "your quiet planner"

- Delete `<span class="tag">your quiet planner</span>` in `index.html` (line 16).
- Update the voice hint at `index.html` (line 69) from
  "voice works in Chrome, Edge, Safari (not Firefox)" to a message that voice works
  in all modern browsers (Chrome/Edge/Safari use the built-in engine; Firefox uses an
  on-device model downloaded on first use).

## 2. Firefox voice (free, no key)

### New module `src/whisper.ts`

Wraps `@huggingface/transformers` (the `Xenova/whisper-tiny.en` model, `device: "wasm"`).
Responsibilities:

- Lazily `import("@huggingface/transformers")` the first time voice is needed on a
  browser without the Web Speech API (i.e., Firefox). Keeps the model out of the main
  bundle; the ~40MB model is fetched from the HF Hub on first use only.
- Capture mic audio with `navigator.mediaDevices.getUserMedia({ audio: true })` and
  `MediaRecorder`.
- On stop, decode the recorded blob to 16kHz mono PCM Float32 via `AudioContext`/
  `decodeAudioData`, then call the transcriber.
- Return the final transcript as a string. Surface a clear error (and fall back to
  "type instead" messaging) if the model fails to load or transcription errors.

Interface exposed to `speech.ts`:

```ts
export interface WhisperController {
  supported: boolean;
  start(): Promise<void>;   // requests mic, begins recording
  stop(): Promise<string>;  // stops, transcribes, resolves final transcript
  onState: (listening: boolean) => void;
}
```

### Refactor `src/speech.ts`

`createSpeech()` chooses the engine:

- If `window.SpeechRecognition || window.webkitSpeechRecognition` exists → use the
  existing Web Speech API path (unchanged behavior).
- Else → use `WhisperController` from `src/whisper.ts`.

`WhisperController` is async (`start(): Promise<void>`, `stop(): Promise<string>`),
but `speech.ts` adapts it to the existing synchronous `SpeechController` interface
(`supported`, `start(): void`, `stop(): void`, `onResult`, `onState`) so
`src/ui/input.ts` needs no changes: `createSpeech()` calls the Whisper `start()` and
swallows mic-permission rejections (falling back to type-only); `stop()` triggers
transcription and forwards the resolved transcript through `onResult` exactly once.
For Whisper, `onResult` therefore fires once with the final transcript after `stop()`.

`input.ts` already disables the mic button and shows "Voice not supported" when
`!speech.supported`. With Whisper, Firefox is now `supported`, so the button stays
enabled. The existing "Voice not supported in this browser — type instead" fallback
remains for any browser lacking both engines.

### Dependencies

- Add `@huggingface/transformers` to `package.json` (free, MIT). It pulls in
  `onnxruntime-web` for WASM inference. Dynamic import only.

## 3. Backup module `src/backup.ts`

Pure functions for formatting/parsing — no DOM. Exports:

- `downloadToken(token: string): void`
  Creates a `Blob` with the raw token string, triggers a `token.txt` download.
- `toCSV(items: Item[]): string`
  Header row: `kind,title,datetime,all_day,reminder,status,created_at`.
  Values are RFC-4180 quoted (embedded quotes doubled, fields containing `,` `"` `\n`
  wrapped in quotes).
- `toText(items: Item[]): string`
  Human-readable, grouped by kind:
  ```
  Marginalia export — 2026-08-29
  SCHEDULE
  - [ ] Dentist — Tue Aug 30, 3:00 PM
  TODOS
  - [x] Buy milk
  ```
  Uses `settings.formatClock` for event times; `[x]` = done, `[ ]` = pending;
  `all day` events omit the time.
- `download(content: string, filename: string, mime: string): void`
  Shared helper used by `downloadToken`, CSV, and text export.
- `parseFile(text: string): ImportRow[]`
  Auto-detects format: if the first non-empty line looks like a CSV header
  (`kind,title,...`) parse as CSV; otherwise parse the bullet text format
  (`- [ ] Title — <when>` / `- [x] Title`). Returns
  `{ kind, title, datetime, all_day, reminder, status }[]`. Malformed rows are skipped
  with a collected warning count.
- `applyImport(rows: ImportRow[], mode: "merge" | "replace"): Promise<void>`
  Delegates to `store` (see §4). `merge` appends rows as new items (fresh UUIDs,
  dedupe not needed since IDs are regenerated); `replace` clears the space then loads.

`ImportRow` is a plain shape matching `ParsedItem` plus `status`, `all_day`,
`reminder`, `created_at` (optional). Dates are preserved as ISO when present; the text
format's human date is best-effort reparsed, falling back to created_at/now.

## 4. Store changes `src/store.ts`

Add:

- `export async function importItems(rows: ImportRow[], mode: "merge" | "replace"): Promise<void>`
  - Reuses the existing `insertItem` / `removeItem` paths so it works in both demo
    (localStorage) and synced (Supabase) modes.
  - `replace`: in demo, `setItems(next)`; in synced, delete all current items then
    insert rows.
  - `merge`: insert each row as a new item (new UUID, current space token, `created_at`
    = now unless row provides one).
  - Emits via the existing subscribe/emit mechanism so the UI refreshes.

No change to the existing `addItem`/`deleteItem`/`setItems` contracts.

## 5. UI placement

### Token modal (`src/ui/header.ts`)

In the "Your space" modal (`#tokenModal`), add a button:

```html
<button class="btn" id="downloadToken">Download token (.txt)</button>
```

Wired to `downloadToken(getSpaceToken())`.

### Settings modal (`index.html` + `src/ui/header.ts`)

Add a **Backup** section to the existing Settings modal:

```html
<div class="rules-head">Backup</div>
<div class="row">
  <button class="btn" id="exportCsv">Export CSV</button>
  <button class="btn" id="exportText">Export text</button>
</div>
<label class="toggle">Import a backup file</label>
<input type="file" id="importFile" accept=".csv,.txt,text/plain" />
<div class="row" id="importMode" hidden>
  <button class="btn" id="importMerge">Merge</button>
  <button class="btn primary" id="importReplace">Replace</button>
</div>
```

Flow: picking a file reads its text, calls `parseFile`, then reveals the Merge/Replace
row. Choosing an option calls `applyImport(rows, mode)` and shows a short
success/error notice (reuse the existing `showNotice` pattern from `input.ts`, or a
simple inline message in the settings modal). Invalid/empty files show an error notice
and keep the file input usable.

## 6. Docs

Update `CONTEXT.md` glossary "Export / Import" entry from "Per-space JSON backup" to
describe the new CSV + human-readable text export/import with merge/replace import.

## Files touched

- `index.html` — remove tagline; update hint; add Backup section + token download button.
- `src/speech.ts` — engine selection (Web Speech API vs Whisper).
- `src/whisper.ts` — NEW: on-device Whisper STT.
- `src/backup.ts` — NEW: export/import formatting + parse.
- `src/store.ts` — `importItems`.
- `src/ui/header.ts` — wire token download + backup controls.
- `package.json` — add `@huggingface/transformers`.
- `CONTEXT.md` — glossary update.

## Testing / verification

- `npm run build` succeeds (typecheck + bundle).
- Demo mode: add items, export CSV and text, re-import (merge + replace), confirm
  round-trip fidelity.
- Token download produces a `.txt` with the exact token string.
- Firefox (or any Web Speech API-less browser): mic button enabled, first use
  downloads model, transcript appears on stop; failure falls back to type-only.
- Chrome/Edge/Safari: existing Web Speech API behavior unchanged.
- Hint text no longer excludes Firefox.
