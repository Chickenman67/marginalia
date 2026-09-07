# Deterministic Date Resolution + NVIDIA Test-Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make AI-scheduled phrases deterministic where the wording is ambiguous — a bare weekday ("wednesday") lands on the nearest upcoming occurrence of that weekday (this week, else next week) as an **all-day event**, and time-of-day phrases ("by morning") become timed events — and fix the broken "Network error: Failed to fetch" when testing the NVIDIA key in Settings.

**Architecture:** Add a pure, client-side resolver module `src/dates.ts` that runs **after** the LLM in every parse path (NVIDIA proxy, direct Gemini/Groq, polish dictation) and, when the phrase contains a bare weekday/time-of-day word and no explicit date/time cue (`resolveSchedule` returns `null` for any explicit cue), overrides the parsed `kind`/`datetime`/`allDay`. The quick-add UI shows a **confirm card** (date + time + all-day, pre-filled) when the resolver matched, so the user can correct an implied time before adding. `allDay` threads through `ParsedItem`/`DraftItem`/`store.addItem` and displays as an existing "all day" badge. Edge Functions get a CORS allowlist that includes `http://localhost:*` (dev) so the browser preflight no longer throws "Failed to fetch", and `testProviderKey("nvidia")` stops posting the anon key (401) and uses the real session token; Settings no longer demands a key to test the keyless NVIDIA proxy.

**Tech Stack:** TypeScript, Vite, vitest (jsdom), Supabase Edge Functions (Deno). Free tier only.

## Global Constraints

- Free tier only. No paid APIs. (From AGENTS.md.)
- Stay on Supabase project ref `wuubxsivaoghpjfnbejz` (us-east-1). (AGENTS.md says `PROJECT_REF`; the live ref is `wuubxsivaoghpjfnbejz`.) Substitute that value for `PROJECT_REF` in commands below.
- Edge Functions deploy with `npx supabase functions deploy <name> --project-ref wuubxsivaoghpjfnbejz` (both `parse` and `polish` have `verify_jwt=false`).
- The resolver is a **safety net**: it never overrides when the phrase stated an explicit date/placement (clock time, today/tomorrow, next/last/this + weekday, month+day, "in X minutes/hours", midnight, every/weekly, "after tomorrow"). See spec `docs/superpowers/specs/2026-09-07-date-resolution-and-nvidia-test-fix-design.md`.
- `docs/superpowers/` is gitignored; force-add with `git add -f` when committing.
- Tests: `npm test` (vitest, jsdom). Typecheck: `npm run typecheck` (`tsc --noEmit`). Build: `npm run build`.

---

## File Structure

### New files
- `src/dates.ts` — pure resolver: `resolveSchedule`, `weekdayAtClock`, `guessResolve`, `applyResolve`, `parseClock`.
- `tests/unit/dates.test.ts` — resolver tests with an injected fixed `now`.
- `tests/unit/supabase-test-key.test.ts` — `testProviderKey("nvidia")` uses the session token, not the anon key.

### Changed files
- `src/types.ts` — add `allDay?: boolean` to `ParsedItem` and `DraftItem`.
- `src/store.ts` — `addItem` writes `parsed.allDay ?? false` instead of hardcoded `false`.
- `tests/unit/store-list.test.ts` — add `addItem` allDay tests.
- `src/supabase.ts` — apply resolver in `parsePhrase`/`polishPhrase`; `allDay` in `normalize`/`normalizeDraft`; stronger direct-provider `sys` strings; `testProviderKey("nvidia")` uses the session JWT.
- `src/ui/input.ts` — `guess()` uses `guessResolve`; preview shows date + "all day"; `commit()` shows the confirm card when `resolveSchedule(text)` matches; `addAll` passes `allDay`; `formatClock` import dropped (replaced by shared `previewText` helper).
- `src/ui/header.ts` — key-test gate only requires a key for non-NVIDIA providers.
- `src/style.css` — `.confirm-card` styles.
- `supabase/functions/parse/index.ts` — CORS allowlist including localhost; SYSTEM prompt updated.
- `supabase/functions/polish/index.ts` — CORS allowlist including localhost; SYSTEM prompt updated.

---

## Task 1: Thread `allDay` through types and `store.addItem`

**Files:**
- Modify: `src/types.ts`, `src/store.ts`
- Test: `tests/unit/store-list.test.ts`

**Interfaces:**
- `ParsedItem` and `DraftItem` gain `allDay?: boolean`.
- `addItem(parsed)` stores `all_day: parsed.allDay ?? false`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/unit/store-list.test.ts` a new `describe` and add `addItem` to the existing import (line 3):

```ts
import { setItems, getItems, reorder, togglePin, deleteOldEvents, addItem } from "../../src/store";
```

```ts
describe("addItem", () => {
  beforeEach(() => { localStorage.clear(); setItems([]); });

  it("persists allDay as all_day on the stored item", async () => {
    await addItem({ title: "Wed thing", kind: "event", datetime: new Date().toISOString(), allDay: true, reminder: null });
    const [item] = getItems();
    expect(item.all_day).toBe(true);
    expect(item.kind).toBe("event");
  });

  it("defaults all_day to false when no allDay flag given", async () => {
    await addItem({ title: "Plain todo", kind: "todo", datetime: null, allDay: undefined, reminder: null });
    const [item] = getItems();
    expect(item.all_day).toBe(false);
  });
});
```

- [ ] **Step 2: Run the new tests to confirm they fail**

Run: `npm test -- tests/unit/store-list.test.ts`
Expected: FAIL — `all_day` is `false` even when `allDay: true` was passed (store hardcodes it).

- [ ] **Step 3: Add `allDay` to the parser types**

In `src/types.ts`, add `allDay: boolean;` after the `datetime` field in **both** `ParsedItem` and `DraftItem`:

```ts
export interface ParsedItem {
  title: string;
  kind: ItemKind;
  datetime: string | null;
  allDay?: boolean;
  reminder: string | null;
}

export interface DraftItem {
  title: string;
  kind: ItemKind;
  datetime: string | null;
  allDay?: boolean;
  reminder: string | null;
}
```

(Same shape for both — `applyResolve` treats them as structurally interchangeable.)

- [ ] **Step 4: Use `allDay` in `store.addItem`**

In `src/store.ts`, change the `all_day` line (line 88) from `all_day: false,` to:

```ts
    all_day: parsed.allDay ?? false,
```

- [ ] **Step 5: Run the tests to confirm they pass**

Run: `npm test -- tests/unit/store-list.test.ts`
Expected: PASS (store-list suite plus the 2 new addItem tests).

- [ ] **Step 6: Commit**

```bash
git add -f src/types.ts src/store.ts tests/unit/store-list.test.ts
git commit -m "feat(item): thread allDay through ParsedItem/DraftItem and store.addItem"
```

---

## Task 2: Resolver module `src/dates.ts` + unit tests

**Files:**
- Create: `src/dates.ts`
- Test: `tests/unit/dates.test.ts`

**Interfaces:**
- `resolveSchedule(phrase: string, now?: Date): ResolvedTime | null` — the safety net. Returns `null` when any explicit date/time cue is present (the LLM wins). Otherwise: bare weekday → all-day event on the nearest upcoming occurrence (today counts; this week, else next week); time-of-day word → timed event per the table (today if `now.getHours() < threshold`, else tomorrow); weekday + time-of-day → timed event at that hour on that weekday.
- `weekdayAtClock(phrase, now?)` — for bare weekday + explicit clock time ("wednesday at 3pm"): timed event on that weekday. Always explicit, never shown in the confirm card.
- `guessResolve(phrase, now?)` — `resolveSchedule(...) ?? weekdayAtClock(...)`; used by the typed fast path.
- `applyResolve(parsed: ParsedItem, phrase, now?)` — returns `{ ...parsed, kind, datetime, allDay }` when `resolveSchedule` matched; otherwise returns `parsed` unchanged.

`ResolvedTime = { kind: "event"; datetime: string; allDay: boolean }` (`datetime` is a local wall-clock instant serialized to ISO via local year/month/date/hour/minute constructors, matching `localToISO` in `input.ts`).

- [ ] **Step 1: Write the failing test**

Create `tests/unit/dates.test.ts`. The `now` fixture is Monday Sep 7 2026 14:30 local. Expected ISO strings are built with the **same local constructors** as the resolver so the tests are timezone-agnostic:

```ts
import { describe, it, expect } from "vitest";
import { resolveSchedule, weekdayAtClock, guessResolve, applyResolve } from "../../src/dates";
import type { ParsedItem } from "../../src/types";

// Mon Sep 7 2026 14:30:00 LOCAL (matches the app's "today" during the fix session).
const MONDAY = new Date(2026, 8, 7, 14, 30, 0, 0);
// Thu Sep 10 2026 14:30 local — same week, WEEKDAY ALREADY PASSED.
const THURSDAY = new Date(2026, 8, 10, 14, 30, 0, 0);

// Mirror the resolver's own local-time construction. Bear in mind Sep 7 2026 = Monday.
const at = (daysFromMon, hour, minute = 0) =>
  new Date(2026, 8, 7 + daysFromMon, hour, minute, 0, 0).toISOString();

describe("resolveSchedule", () => {
  it("bare weekday -> all-day event this week when still ahead", () => {
    const r = resolveSchedule("I have something wednesday", MONDAY);
    expect(r).not.toBeNull();
    expect(r!.datetime).toBe(at(2, 0, 0)); // Wed Sep 9, local midnight
    expect(r!.allDay).toBe(true);
  });

  it("bare weekday after it passed this week -> next week", () => {
    const r = resolveSchedule("I have something wednesday", THURSDAY);
    expect(r!.datetime).toBe(at(9, 0, 0)); // next Wed Sep 16, local midnight
    expect(r!.allDay).toBe(true);
  });

  it("same day as today counts as today", () => {
    const r = resolveSchedule("I have something monday", MONDAY);
    expect(r!.datetime).toBe(at(0, 0, 0)); // today, Mon Sep 7
  });

  it("afternoon -> timed event tomorrow at 14:00 when now is past the threshold", () => {
    const r = resolveSchedule("call dave in the afternoon", MONDAY); // 14:30 >= 12
    expect(r!.datetime).toBe(at(1, 14, 0)); // Tue Sep 8 14:00
    expect(r!.allDay).toBe(false);
  });

  it("by morning -> timed event today at 09:00 when before noon", () => {
    const r = resolveSchedule("by morning", new Date(2026, 8, 7, 8, 0, 0));
    expect(r!.datetime).toBe(at(0, 9, 0));
  });

  it("tonight -> timed event today at 20:00", () => {
    const r = resolveSchedule("tonight", MONDAY);
    expect(r!.datetime).toBe(at(0, 20, 0));
  });

  it("weekday + time-of-day -> timed event on that weekday", () => {
    const r = resolveSchedule("wednesday morning for a run", MONDAY);
    expect(r!.datetime).toBe(at(2, 9, 0));
    expect(r!.allDay).toBe(false);
  });

  it("null for explicit date/time cues (LLM wins)", () => {
    for (const p of [
      "wednesday at 3pm", "tomorrow", "next wednesday", "this friday",
      "feb 10", "on the 5th", "in 5 minutes", "midnight", "every wednesday",
      "day after tomorrow", "next week"
    ]) {
      expect(resolveSchedule(p, MONDAY), p).toBeNull();
    }
  });
});

describe("weekdayAtClock / guessResolve", () => {
  it("weekday + clock time -> timed event on that weekday (explicit, never confirmed)", () => {
    expect(resolveSchedule("wednesday at 3pm", MONDAY)).toBeNull(); // explicit
    expect(weekdayAtClock("wednesday at 3pm", MONDAY)!.datetime).toBe(at(2, 15, 0));
    expect(guessResolve("wednesday at 3pm", MONDAY)!.allDay).toBe(false);
    expect(guessResolve("wednesday 15:30", MONDAY)!.datetime).toBe(at(2, 15, 30));
  });
});

describe("applyResolve", () => {
  const base = (over: Partial<ParsedItem> = {}): ParsedItem => ({
    title: "thing", kind: "todo", datetime: null, reminder: null, ...over
  });

  it("overrides a todo when the phrase matched (bare weekday)", () => {
    const out = applyResolve(base(), "I have something wednesday", MONDAY);
    expect(out.kind).toBe("event");
    expect(out.allDay).toBe(true);
    expect(out.datetime).toBe(at(2, 0, 0));
  });

  it("overrides an LLM-fabricated datetime for an ambiguous phrase", () => {
    // The LLM dated "wednesday" to TODAY — the resolver must win because there
    // was no explicit cue in the phrase.
    const out = applyResolve(base({ kind: "event", datetime: at(0, 10, 0) }), "wednesday", MONDAY);
    expect(out.datetime).toBe(at(2, 0, 0));
    expect(out.allDay).toBe(true);
  });

  it("leaves the result untouched when the resolver does not match", () => {
    const in_ = base({ kind: "todo", datetime: null });
    expect(applyResolve(in_, "call mom", MONDAY)).toBe(in_);
    const exp = base({ kind: "event", datetime: at(1, 9, 0) });
    expect(applyResolve(exp, "tomorrow 9am", MONDAY)).toBe(exp); // explicit -> LLM wins
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `npm test -- tests/unit/dates.test.ts`
Expected: FAIL — module `../../src/dates` doesn't exist.

- [ ] **Step 3: Write `src/dates.ts`**

Create `src/dates.ts` with exactly this content:

```ts
import type { ParsedItem } from "./types";

// Deterministic date resolution for natural-language scheduling.
// A client-side safety net so the common cues ("wednesday", "by morning")
// land correctly regardless of LLM behaviour. All functions are pure with an
// injectable `now` for tests.

export interface ResolvedTime {
  kind: "event";
  datetime: string; // ISO serialization of a LOCAL wall-clock instant
  allDay: boolean;
}

const WEEKDAYS: Array<[RegExp, number]> = [
  [/\b(sun|sunday)\b/i, 0],
  [/\b(mon|monday)\b/i, 1],
  [/\b(tue|tues|tuesday)\b/i, 2],
  [/\b(wed|wednesday)\b/i, 3],
  [/\b(thu|thur|thurs|thursday)\b/i, 4],
  [/\b(fri|friday)\b/i, 5],
  [/\b(sat|saturday)\b/i, 6]
];

interface Tod {
  re: RegExp;
  hour: number;     // default hour of day for a timed event
  threshold: number; // today if now.getHours() < threshold, else tomorrow
}

const TODS: Tod[] = [
  { re: /\bmorning\b/i, hour: 9, threshold: 12 },
  { re: /\bafternoon\b/i, hour: 14, threshold: 12 },
  { re: /\b(lunch|noon)\b/i, hour: 12, threshold: 12 },
  { re: /\bevening\b/i, hour: 18, threshold: 18 },
  { re: /\bdinner\b/i, hour: 19, threshold: 19 },
  { re: /\btonight\b/i, hour: 20, threshold: 20 },
  { re: /\bnight\b/i, hour: 21, threshold: 21 }
];

// Phrases containing any of these carry explicit scheduling info. The resolver
// returns null and the LLM's answer is trusted unchanged.
const EXPLICIT: RegExp[] = [
  /\b\d{1,2}:\d{2}(?!\d)\b/,                          // clock time (12:30, 15:00, 12:30pm)
  /\b\d{1,2}\s*(am|pm)\b/i,                            // 3pm, 9 am
  /\b(today|tomorrow|midnight)\b/i,
  /\b(after\s+tomorrow|day\s+after)\b/i,               // the day after tomorrow
  /\b(this|next|last)\s+(sun|mon|tue|wed|thu|fri|sat)\w*\b/i, // next wednesday, this friday
  /\b(this|next|last)\s+week\b/i,
  /\b(on|by)\s+the\s+\d{1,2}(st|nd|rd|th)?\b/i,        // on the 5th
  /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|january|february|march|april|june|july|august|september|october|november|december)\s+\d{1,2}\b/i,
  /\bin\s+\d+\s*(min|minute|mins|minutes|hr|hrs|hour|hours|day|days|week|weeks)\s*\b/i,
  /\b(every|each|weekly|daily|fortnightly)\s+\w+\b|\bweekdays?\b|\bweekends?\b/i
];

const norm = (n: number) => ((n % 7) + 7) % 7;

function weekdayOf(phrase: string): number | null {
  for (const [re, dow] of WEEKDAYS) if (re.test(phrase)) return dow;
  return null;
}

function todOf(phrase: string): Tod | null {
  for (const t of TODS) if (t.re.test(phrase)) return t;
  return null;
}

// Local wall-clock time serialized to ISO (same construction as input.ts localToISO).
function atLocal(hour: number, minute: number, day: Date): string {
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour, minute, 0, 0).toISOString();
}

// Nearest upcoming weekday, counting TODAY.
function upcomingWeekday(dow: number, now: Date): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + norm(dow - now.getDay()));
}

export function resolveSchedule(phrase: string, now: Date = new Date()): ResolvedTime | null {
  if (!phrase) return null;
  if (EXPLICIT.some((re) => re.test(phrase))) return null;

  const dow = weekdayOf(phrase);
  const tod = todOf(phrase);

  if (dow !== null && tod) {
    return { kind: "event", datetime: atLocal(tod.hour, 0, upcomingWeekday(dow, now)), allDay: false };
  }
  if (dow !== null) {
    return { kind: "event", datetime: atLocal(0, 0, upcomingWeekday(dow, now)), allDay: true };
  }
  if (tod) {
    const day = now.getHours() < tod.threshold
      ? now
      : new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    return { kind: "event", datetime: atLocal(tod.hour, 0, day), allDay: false };
  }
  return null;
}

interface Clock { hour: number; minute: number }

export function parseClock(phrase: string): Clock | null {
  let m = phrase.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i);
  if (m) {
    let hour = Number(m[1]);
    const minute = m[2] ? Number(m[2]) : 0;
    const pm = /pm/i.test(m[3] ?? "");
    if (hour >= 24 || minute >= 60) return null;
    if (m[3]) {
      if (hour === 12) hour = pm ? 12 : 0;
      else if (pm) hour += 12;
    }
    if (hour >= 24) return null;
    return { hour, minute };
  }
  m = phrase.match(/\b(\d{1,2}):(\d{2})\b/);
  if (m) {
    const hour = Number(m[1]);
    const minute = Number(m[2]);
    if (hour < 24 && minute < 60) return { hour, minute };
  }
  return null;
}

// "wednesday at 3pm" / "wednesday 15:30" — typed fast path. Explicit clock
// time means this is NOT confirm-worthy (see resolveSchedule returning null).
export function weekdayAtClock(phrase: string, now: Date = new Date()): ResolvedTime | null {
  const dow = weekdayOf(phrase);
  if (dow === null) return null;
  const clock = parseClock(phrase);
  if (!clock) return null;
  return { kind: "event", datetime: atLocal(clock.hour, clock.minute, upcomingWeekday(dow, now)), allDay: false };
}

export function guessResolve(phrase: string, now: Date = new Date()): ResolvedTime | null {
  return resolveSchedule(phrase, now) ?? weekdayAtClock(phrase, now);
}

// Safety net applied AFTER the LLM. Only overrides when resolveSchedule matched,
// i.e. the phrase had no explicit date/time cue — so an LLM-fabricated datetime
// for an ambiguous phrase is corrected, but an explicitly placed item is kept.
export function applyResolve(parsed: ParsedItem, phrase: string, now: Date = new Date()): ParsedItem {
  const resolved = resolveSchedule(phrase, now);
  if (!resolved) return parsed;
  return { ...parsed, kind: resolved.kind, datetime: resolved.datetime, allDay: resolved.allDay };
}
```

- [ ] **Step 4: Run the tests to confirm they pass**

Run: `npm test -- tests/unit/dates.test.ts`
Expected: PASS (all describes).

- [ ] **Step 5: Commit**

```bash
git add -f src/dates.ts tests/unit/dates.test.ts
git commit -m "feat(dates): deterministic weekday/time-of-day resolver + tests"
```

---

## Task 3: Apply the resolver and fix the NVIDIA test in `src/supabase.ts`

**Files:**
- Modify: `src/supabase.ts`
- Test: `tests/unit/supabase-test-key.test.ts`

**Interfaces:**
- `parsePhrase` returns `applyResolve(raw, phrase)` for both proxy and direct paths.
- `polishPhrase` maps each draft through `applyResolve(it, it.title)`.
- `normalize`/`normalizeDraft` carry `allDay` from the JSON when present.
- `testProviderKey("nvidia")` posts the real session JWT (not `config.supabaseAnon`) and gives a clear demo-mode message.

- [ ] **Step 1: Read the current file**

Run: `Read` on `src/supabase.ts`. Note the exact line ranges you will touch: `parsePhrase` (91–110), `parseDirect` sys string (114), `normalize` (158–167), `normalizeDraft` (169–178), `polishPhrase` (180–198), `polishDirect` sys string (201), `testProviderKey` nvidia branch (271–284).

- [ ] **Step 2: Write the failing test for `testProviderKey("nvidia")`**

Create `tests/unit/supabase-test-key.test.ts`:

```ts
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import * as auth from "../../src/auth";

vi.mock("../../src/auth", () => ({ getSession: vi.fn() }));
vi.mock("../../src/config", () => ({
  config: {
    supabaseUrl: "https://test.supabase.co",
    supabaseAnon: "anon-key",
    parseFunction: "https://test.supabase.co/functions/v1/parse"
  },
  STORAGE_KEYS: { llmKey: "marginalia.llmKey", provider: "marginalia.provider" }
}));

import { testProviderKey } from "../../src/supabase";

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});

describe("testProviderKey nvidia", () => {
  it("posts the real session token (never the anon key) and succeeds", async () => {
    (auth.getSession as any).mockResolvedValue({ access_token: "session-jwt" });
    (globalThis.fetch as any) = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    const r = await testProviderKey("nvidia", "");
    expect(r.ok).toBe(true);
    const [url, init] = (fetch as any).mock.calls[0];
    expect(url).toBe("https://test.supabase.co/functions/v1/parse");
    expect(init.headers.Authorization).toBe("Bearer session-jwt");
    expect(init.headers.Authorization).not.toBe("Bearer anon-key");
  });

  it("returns a clear sign-in message when no session exists", async () => {
    (auth.getSession as any).mockResolvedValue(null);
    (globalThis.fetch as any) = vi.fn();
    const r = await testProviderKey("nvidia", "");
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/sign in/i);
    expect(fetch).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run the test to confirm it fails**

Run: `npm test -- tests/unit/supabase-test-key.test.ts`
Expected: FAIL — the current implementation posts `config.supabaseAnon` and never calls `getSession`.

- [ ] **Step 4: Apply the edits to `src/supabase.ts`**

**4a. Rewrite the `testProviderKey` nvidia branch** (replace lines 271–284, the `if (provider === "nvidia") { … }` block):

```ts
  if (provider === "nvidia") {
    if (!config.parseFunction) {
      return { ok: false, message: "NVIDIA proxy not configured (no Supabase link)." };
    }
    try {
      const session = await getSession();
      if (!session) return { ok: false, message: "Sign in first, then test the NVIDIA proxy." };
      const res = await fetch(config.parseFunction, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ phrase: "test", tzOffsetMinutes: tzOffsetMinutes() })
      });
      return res.ok
        ? { ok: true, message: "NVIDIA proxy works (no key needed)." }
        : { ok: false, message: `Proxy error (${res.status}).` };
    } catch (e) {
      return { ok: false, message: `Network error: ${e instanceof Error ? e.message : "unknown"}` };
    }
  }
```

**4b. Apply the resolver in `parsePhrase`** — at the end of the function (line 107 `return (await r.json()) as ParsedItem;` and line 109 `return parseDirect(...)`):

```ts
    if (!r.ok) throw new Error(`parse failed: ${r.status}`);
    return applyResolve((await r.json()) as ParsedItem, phrase);
  }
  return applyResolve(await parseDirect(phrase, provider, userKey), phrase);
```

**4c. Update the direct-provider sys string in `parseDirect`** (line 114):

```ts
  const sys = "Convert a scheduling phrase into JSON {title, datetime (ISO8601 or null), type ('todo'|'event'), reminder (ISO8601 or null)}. datetime present => event. A BARE weekday name with no clock time ('wednesday') is an ALL-DAY event on the NEAREST upcoming occurrence of that weekday (today counts; this week if still ahead, otherwise next week). Time-of-day words (morning 9am, afternoon 2pm, evening 6pm, tonigh 8pm) are timed events at that hour, never todos. type 'todo' ONLY if no date or time-of-day is mentioned.";
```

(Note: the resolver will still correct the model if it disobeys — this prompt just reduces dependence on it.)

**4d. Carry `allDay` in `normalize` and `normalizeDraft`** (lines 158–178) — add the line after `datetime`:

```ts
    datetime,
    allDay: !!(j.allDay),
```

to both functions.

**4e. Apply the resolver in `polishPhrase`** — the function currently ends with `return (await r.json()) as PolishResult;` (line 195) and `return polishDirect(paragraph, provider, userKey);` (line 197). Change both return sites to map each draft through the resolver:

```ts
    if (!r.ok) throw new Error(`polish failed: ${r.status}`);
    const proxied = (await r.json()) as PolishResult;
    return { items: proxied.items.map((it) => applyResolve(it, it.title)) };
  }
  const direct = await polishDirect(paragraph, provider, userKey);
  return { items: direct.items.map((it) => applyResolve(it, it.title)) };
```

**4f. Update the `polishDirect` sys string** (line 201) — append before the "Cap at 100 items." sentence:

```ts
  const sys = "Organize a rambling paragraph into a JSON object {items:[{title, kind('event'|'todo'), datetime(ISO8601 or null), reminder(ISO8601 or null)}]}. If a line has a time it is an event, otherwise a todo. Resolve relative times to the user's LOCAL time and current year. RELATIVE-NOW cues like 'in the next hour' / 'in 30 minutes' mean FROM NOW (today), never tomorrow — anchor on the current time. A bare weekday with no time ('wednesday') is an ALL-DAY event on the nearest upcoming occurrence of that weekday (this week, else next week). Time-of-day words make timed events, never todos. Cap at 100 items.";
```

**4g. Add the import** at the top (after line 2):

```ts
import { applyResolve } from "./dates";
```

- [ ] **Step 5: Run the tests**

Run: `npm test -- tests/unit/supabase-test-key.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: no new errors. (`applyResolve` accepts `DraftItem` input structurally — both shapes now include `allDay?`.)

- [ ] **Step 7: Commit**

```bash
git add -f src/supabase.ts tests/unit/supabase-test-key.test.ts
git commit -m "feat(parse): apply deterministic resolver in all parse paths; fix NVIDIA test-key to use session token"
```

---

## Task 4: No key required to test the NVIDIA proxy (`src/ui/header.ts`)

**Files:**
- Modify: `src/ui/header.ts`

**Interfaces:**
- The key-test button only demands a key for providers that actually need one (gemini/groq). For `nvidia` it proceeds with an empty key (the proxy is keyed server-side).

- [ ] **Step 1: Edit the key-test handler**

In `src/ui/header.ts` the `testBtn` handler is at lines 201–210. Replace the guard (line 204) so it applies only to non-NVIDIA providers:

```ts
  const testBtn = document.getElementById("keyTest")!;
  testBtn.addEventListener("click", async () => {
    const key = apiKey.value.trim();
    if (provider.value !== "nvidia" && !key) {
      keyStatus.textContent = "Enter a key first.";
      keyStatus.className = "key-status bad";
      return;
    }
    keyStatus.textContent = "Testing…";
    keyStatus.className = "key-status";
    const r = await testProviderKey(provider.value, key);
    keyStatus.textContent = r.message;
    keyStatus.className = `key-status ${r.ok ? "good" : "bad"}`;
  });
```

(The existing handler already passes the key through to `testProviderKey`; the NVIDIA branch inside `testProviderKey` ignores it — Task 3.)

- [ ] **Step 2: Verify**

Run: `npm run typecheck` and `npm test`.
Expected: PASS, no new errors.

- [ ] **Step 3: Commit**

```bash
git add -f src/ui/header.ts
git commit -m "fix(settings): don't require a key to test the keyless NVIDIA proxy"
```

---

## Task 5: Quick-add — resolver-driven guess, all-day preview, confirm card

**Files:**
- Modify: `src/ui/input.ts`, `src/style.css`

**Interfaces:**
- `guess(text)` returns `ParsedItem` using `guessResolve` first, so previews show the correct resolved date and an "all day" label for bare weekdays, while pure time words keep today's instant behavior.
- `commit()` shows a confirm card (pre-filled date/time/all-day from the parsed item; reuses `openCalendar`/`openTimePicker`) whenever `resolveSchedule(text)` matches — i.e. the phrase had an ambiguous (implied) time. Explicit phrases add instantly, unchanged.
- `addAll()` passes `i.allDay` through.

- [ ] **Step 1: Edit imports and the top of `mountInput`**

In `src/ui/input.ts`:

- Line 7: `import { getSettings, formatClock, subscribeSettings } from "../settings";` → drop `formatClock`:
  ```ts
  import { getSettings, subscribeSettings } from "../settings";
  ```
- After line 8 add:
  ```ts
  import { resolveSchedule, guessResolve } from "../dates";
  ```

- [ ] **Step 2: Replace the `guess` function (lines 195–205)**

```ts
// Lightweight local guess so the UI is responsive before/without the LLM call.
function guess(text: string): ParsedItem {
  const lower = text.toLowerCase();
  const hasTime = /\b\d{1,2}:\d{2}\s*(am|pm)?\b|\b\d{1,2}\s*(am|pm)\b|\btomorrow\b|\btoday\b|\btonight\b|\bmonday\b|\btuesday\b|\bwednesday\b|\bthursday\b|\bfriday\b|\bsaturday\b|\bsunday\b|\bnext week\b|\bafternoon\b|\bmorning\b|\bevening\b|\blunch\b|\bdinner\b|\bnoon\b|\bbirthday\b/.test(lower);
  const kind = hasTime ? "event" : "todo";
  const resolved = guessResolve(text);
  return {
    title: text.replace(/\b(tomorrow|today|at|on|my)\b/gi, "").trim().slice(0, 60) || text,
    kind: resolved ? "event" : kind,
    datetime: resolved ? resolved.datetime : kind === "event" ? new Date().toISOString() : null,
    allDay: resolved ? resolved.allDay : false,
    reminder: null
  };
}
```

- [ ] **Step 3: Add preview helpers and update `updatePreview`**

In `mountInput`, replace `updatePreview` (lines 55–61):

```ts
  function updatePreview() {
    const text = phraseEl.value.trim();
    if (!text) { preview.classList.remove("show"); draft = null; return; }
    draft = guess(text);
    previewTextEl.textContent = previewText(draft);
    preview.classList.add("show");
  }
```

Rename the local `previewText` read at line 29 to `previewTextEl` (the span), so it no longer collides with the new module-level helper. Then add these helpers at module scope (after `clock`, which is at lines 206–210):

```ts
// Shared preview label: "📅 Buy milk · Wed, Sep 9 · all day".
function previewText(g: ParsedItem): string {
  const icon = g.kind === "event" ? "📅" : "☑";
  let tail = "";
  if (g.datetime) tail = " · " + (g.allDay ? `${dateLabel(g.datetime)} · all day` : clock(g.datetime));
  return `${icon} ${esc(g.title)}${tail}`;
}
function dateLabel(iso: string): string {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "" : d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}
function fmtAmPm(hhmm: string): string {
  const [hh, mm] = hhmm.split(":").map(Number);
  return `${String(((hh + 11) % 12) + 1).padStart(2, "0")}:${String(mm).padStart(2, "0")} ${hh >= 12 ? "PM" : "AM"}`;
}
```

- [ ] **Step 4: Rewrite `commit()` (lines 69–102) to show the confirm card**

Replace the whole `commit` function (keep `#quickAdd`/`#mic`/`#phrase` enable-disable dance), and add the `showConfirm`/`clearConfirm` helpers inside `mountInput`:

```ts
  let pending: ParsedItem | null = null;
  function clearConfirm() {
    pending = null;
    document.getElementById("confirmWrap")?.remove();
  }
  async function showConfirm(parsed: ParsedItem) {
    pending = parsed;
    document.getElementById("confirmWrap")?.remove();
    const wrapOuter = document.createElement("div");
    wrapOuter.id = "confirmWrap";
    const card = document.createElement("div");
    card.className = "confirm-card";
    wrapOuter.appendChild(card);

    const ldt = parsed.datetime ? toLocalInput(parsed.datetime) : "";
    let date = ldt ? ldt.slice(0, 10) : new Date().toISOString().slice(0, 10);
    let time = ldt ? ldt.slice(11) : "";
    if (!time) time = "09:00";
    let allDay = parsed.allDay ?? parsed.kind === "event";

    const render = () => {
      const mil = getSettings().militaryTime;
      const timeLabel = allDay ? "All day" : mil ? time : fmtAmPm(time);
      card.innerHTML = `
        <div class="confirm-title">${esc(parsed.title)}</div>
        <div class="confirm-row">
          <button type="button" class="picker-trigger" id="cfDate">${fmtDate(date)}</button>
          <button type="button" class="picker-trigger" id="cfTime" ${allDay ? "hidden" : ""}>${timeLabel}</button>
          <label class="cf-allday"><input type="checkbox" id="cfAllDay" ${allDay ? "checked" : ""} /> all day</label>
        </div>
        <div class="confirm-actions">
          <button type="button" class="btn primary" id="cfAdd">Add</button>
          <button type="button" class="btn" id="cfX">Cancel</button>
        </div>`;
      const dateBtn = card.querySelector<HTMLButtonElement>("#cfDate")!;
      dateBtn.onclick = () => openCalendar(dateBtn, date, (iso) => { date = iso; render(); });
      const timeBtn = card.querySelector<HTMLButtonElement>("#cfTime")!;
      timeBtn.onclick = () => {
        (window as any).__marginaliaMilitary = getSettings().militaryTime;
        openTimePicker(timeBtn, time, (t) => { time = t; render(); });
      };
      card.querySelector<HTMLInputElement>("#cfAllDay")!.onchange = (e) => {
        allDay = (e.target as HTMLInputElement).checked;
        render();
      };
      card.querySelector<HTMLButtonElement>("#cfAdd")!.onclick = () => {
        const iso = allDay
          ? localToISO(`${date}T00:00:00`)
          : localToISO(`${date}T${time}:00`);
        pending = { ...pending!, kind: "event", datetime: iso ?? pending!.datetime, allDay };
        void addItem(pending!).then(() => {
          clearConfirm();
          phraseEl.value = "";
          preview.classList.remove("show");
          draft = null;
          addBtn.disabled = false;
          mic.disabled = !speech.supported;
          phraseEl.disabled = false;
          addBtn.textContent = "Add";
        });
      };
      card.querySelector<HTMLButtonElement>("#cfX")!.onclick = () => {
        clearConfirm();
        updatePreview();
      };
    };
    render();
    // Place the card right below the preview bar inside the quick-add area.
    preview.insertAdjacentElement("afterend", wrapOuter);
  }

  async function commit() {
    const text = phraseEl.value.trim();
    if (!text) return;
    const addBtn = el<HTMLButtonElement>("#quickAdd");
    const mic = el<HTMLButtonElement>("#mic");
    addBtn.disabled = true;
    mic.disabled = true;
    phraseEl.disabled = true;
    addBtn.textContent = "…";
    const useLLM = fromVoice;
    fromVoice = false; // consume the flag so a second Enter doesn't re-trigger LLM
    let parsed: ParsedItem;
    if (useLLM) {
      try {
        parsed = await parsePhrase(text);
        // Guard against the LLM returning a blank or whitespace title — fall
        // back to the raw input so the user never sees an empty card.
        if (!parsed.title || !parsed.title.trim()) parsed = { ...parsed, title: text };
      } catch (err) {
        parsed = { title: text, kind: "todo", datetime: null, reminder: null };
        showNotice(`AI unavailable — added as a plain note. (${err instanceof Error ? err.message : "error"})`);
      }
    } else {
      parsed = guess(text);
    }
    // Ambiguous implied time ("wednesday", "by morning") → let the user confirm
    // the resolved date/time before adding. Explicit cues skip this.
    if (resolveSchedule(text)) {
      showConfirm(parsed);
      addBtn.disabled = false;
      mic.disabled = !speech.supported;
      phraseEl.disabled = false;
      addBtn.textContent = "Add";
      return;
    }
    await addItem(parsed);
    phraseEl.value = "";
    preview.classList.remove("show");
    draft = null;
    addBtn.disabled = false;
    mic.disabled = !speech.supported;
    phraseEl.disabled = false;
    addBtn.textContent = "Add";
  }
```

(Note: `addBtn`/`mic`/`phraseEl`/`speech`/`preview` are all in scope inside `mountInput` where `commit` and `showConfirm` are defined. `fmtDate` already exists at module scope, line 446 — the confirm card reuses it.)

- [ ] **Step 5: Update the settings-refresh preview branch (lines 376–390)**

Replace the inner `if (txt) { … }` body with the shared helper (no `formatClock`, no `[E]`/`[ ]` marks):

```ts
    if (pBox && pText && phrase && pBox.classList.contains("show")) {
      const txt = phrase.value.trim();
      if (txt) pText.textContent = previewText(guess(txt));
    }
```

- [ ] **Step 6: Pass `allDay` from the draft rows (`addAll`, line 185)**

```ts
      await addItem({ title: i.title, kind: i.kind, datetime: i.datetime, allDay: i.allDay, reminder: i.reminder });
```

- [ ] **Step 7: Append the confirm-card styles**

Append to the end of `src/style.css`:

```css
/* --- Confirm card (implied scheduling time — "wednesday", "by morning") --- */
#confirmWrap { margin-top: 10px; }
.confirm-card { display: grid; gap: 10px; padding: 12px 14px; border: 1px solid #d9d2c1; border-radius: 12px; background: #fff; box-shadow: 0 2px 10px rgba(60, 50, 20, .06); }
.confirm-title { font-weight: 600; font-size: 14px; color: #2c2a24; }
.confirm-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.confirm-row .picker-trigger { padding: 6px 10px; font-size: 13px; }
.confirm-row .cf-allday { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; color: #5a564c; }
.confirm-actions { display: flex; gap: 8px; }
.confirm-actions .btn { padding: 7px 14px; }
```

- [ ] **Step 8: Verify**

Run: `npm run typecheck` and `npm test`.

Expected: PASS. (No new unit test here — the confirm card is a visual/interaction surface; resolver logic it depends on is already covered in Task 2.)

- [ ] **Step 9: Commit**

```bash
git add -f src/ui/input.ts src/style.css
git commit -m "feat(input): resolver preview + confirm card for implied dates; thread allDay in draft add-all"
```

---

## Task 6: Edge Functions — CORS allowlist (localhost) + stronger prompts; deploy

**Files:**
- Modify: `supabase/functions/parse/index.ts`, `supabase/functions/polish/index.ts`

**Interfaces:**
- CORS now echoes the request `Origin` when it is the configured `APP_ORIGIN` **or** any `http://localhost:<port>`, so `npm run dev` preflights stop throwing "Failed to fetch" while the deployed origin stays locked down.
- `parse` SYSTEM: bare weekday → all-day event nearest-upcoming (this week else next); time-of-day words → timed events at the default hour; weekday+time → timed event on that weekday. Fills the gap at lines 45/47/48 that let a bare weekday on a wrong date through.
- `polish` SYSTEM: bare weekday → all-day event nearest-upcoming; time-of-day words → timed events, never todos.

- [ ] **Step 1: Add the CORS helper to `parse/index.ts`**

Insert just above `Deno.serve(async (req) => {` (line 53), and **delete the old `ALLOWED_ORIGIN`/`cors` block** (lines 54–62):

```ts
// CORS for browser-direct calls. Echo the request Origin when it is the
// configured app origin or a local dev server, so preflight from `npm run dev`
// (http://localhost:*) doesn't fail. Locked down to anything else.
function corsFor(req: Request): Record<string, string> {
  const allowed = Deno.env.get("APP_ORIGIN") || "*";
  const origin = req.headers.get("origin") ?? "";
  const isLocal = /^https?:\/\/localhost(:\d+)?$/.test(origin);
  const serve = (isLocal || allowed === "*" || origin === allowed) ? (origin || allowed) : allowed;
  return {
    "Access-Control-Allow-Origin": serve,
    "Access-Control-Allow-Headers": "content-type, authorization",
    "Access-Control-Allow-Methods": "POST, OPTIONS"
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsFor(req) });
```

Then **replace every** `{ ...cors, "content-type": "application/json" }` with `{ ...corsFor(req), "content-type": "application/json" }` — there are 6 sites: the two 400s (lines 101, 104), the 500 (line 90), the 429 (line 85), the 502 (line 158), and the error-fwd (line 165). The final success response (line 180) is `{ headers: { ...cors, "content-type": "application/json" } }` → `{ headers: { ...corsFor(req), "content-type": "application/json" } }`.

- [ ] **Step 2: Update the `parse` SYSTEM prompt**

Replace the `function SYSTEM(tzOffsetMinutes: number): string { … }` body (lines 32–51) with:

```ts
function SYSTEM(tzOffsetMinutes: number): string {
  const now = localNow(tzOffsetMinutes);
  return `Convert a scheduling phrase into JSON. Output ONLY valid JSON with these fields:
- title: short task label (string)
- datetime: the user's LOCAL wall-clock time as ISO 8601 with their LOCAL timezone offset, or null if no specific time
- type: "todo" if no time given, otherwise "event"
- reminder: ISO 8601 time to remind, or null

The user's CURRENT local time RIGHT NOW is: ${now.toString()} (ISO: ${now.toISOString()}). Their local timezone offset from UTC is ${tzOffsetMinutes >= 0 ? "+" : "-"}${Math.abs(tzOffsetMinutes)} minutes.

CRITICAL — all times you output are the user's LOCAL wall clock:
- "in the next hour", "within an hour", "in 30 minutes", "in X minutes", "in X hours", "right now", "asap" => take the current LOCAL time (${now.toTimeString().slice(0, 5)}) and ADD the duration. If the sum passes midnight, datetime is still TODAY or just past midnight — NOT tomorrow at 11am.
- Example: if it is 8:37 PM local and the user says "in the next hour", the datetime MUST be about 9:37 PM TODAY local. Never output 11:00 AM or any time on a different day for a relative-now phrase.
- "today" => current LOCAL calendar day. "tomorrow" => next LOCAL calendar day.
- A BARE weekday name with no clock time ("wednesday") is an ALL-DAY EVENT on the NEAREST upcoming occurrence of that weekday counting from TODAY local: this week if still ahead, otherwise next week. Same weekday stated today => today.
- A weekday WITH a clock time ("wednesday at 3pm") is a timed event on that same weekday.
- Time-of-day words make TIMED EVENTS, never todos: "morning" => 09:00, "afternoon" => 14:00, "lunch"/"noon" => 12:00, "evening" => 18:00, "dinner" => 19:00, "tonight" => 20:00, "night" => 21:00 — today if that hour is still ahead, else tomorrow. "tonight"/"this evening" => today, 18:00–23:00 local.
- If NO date and NO time-of-day word is mentioned at all ("call mom", "buy milk") => type "todo", datetime null.
- ALWAYS emit the user's LOCAL wall-clock hour/minute. Do NOT convert to UTC.
Do not include commentary.`;
}
```

- [ ] **Step 3: Apply the same CORS change to `polish/index.ts`**

Insert `corsFor` just above `Deno.serve` (line 34), delete the old cors block (lines 35–43), swap the OPTIONS line and every `{ ...cors, "content-type": "application/json" }` (sites at lines 66, 71, 82, 85, 104, 122) exactly as in Step 1.

- [ ] **Step 4: Update the `polish` SYSTEM prompt**

Replace the `function SYSTEM(tzOffsetMinutes: number): string { … }` body (lines 19–32) with:

```ts
function SYSTEM(tzOffsetMinutes: number): string {
  const now = localNow(tzOffsetMinutes);
  return `You organize a rambling speech or note into a clean list of discrete tasks and events.
Output ONLY valid JSON of the form:
{ "items": [ { "title": string, "kind": "todo"|"event", "datetime": ISO8601 with timezone and CURRENT year (${now.getFullYear()}) or null, "reminder": ISO8601 or null } ] }
The user's CURRENT local time RIGHT NOW is: ${now.toString()} (their local offset from UTC is ${tzOffsetMinutes >= 0 ? "+" : "-"}${Math.abs(tzOffsetMinutes)} minutes).
Rules:
- Split run-on sentences into separate items.
- A BARE weekday name with no clock time ("wednesday") is an ALL-DAY EVENT on the NEAREST upcoming occurrence of that weekday (today counts; this week if still ahead, otherwise next week).
- Time-of-day words ("morning" 09:00, "afternoon" 14:00, "evening" 18:00, "tonight" 20:00, "night" 21:00) make TIMED EVENTS on that day — never todos.
- Otherwise, "event" only when a specific time is implied; otherwise "todo".
- Resolve relative cues (today, tomorrow, next Tuesday) to the user's LOCAL wall-clock time and current year.
- ALWAYS emit the user's LOCAL wall-clock hour/minute. Do NOT convert to UTC.
- Each title is a short, polished, grammatical label (no leading articles like "ok" or "so").
- Do not include commentary.`;
}
```

- [ ] **Step 5: Deploy both functions**

Run:

```powershell
npx supabase functions deploy parse --project-ref wuubxsivaoghpjfnbejz
npx supabase functions deploy polish --project-ref wuubxsivaoghpjfnbejz
```

Expected: both deploy successfully (parse v49+, polish v7+).

- [ ] **Step 6: Smoke-test the deployed functions**

Run:

```powershell
$env:VITE_SUPABASE_URL = (Get-Content .env | Select-String 'VITE_SUPABASE_URL=(.+)').Matches[0].Groups[1].Value
$env:VITE_SUPABASE_ANON = (Get-Content .env | Select-String 'VITE_SUPABASE_ANON=(.+)').Matches[0].Groups[1].Value

# 1) The function is reachable and still JWT-gated (anon key => 401, not network error):
curl.exe -s -o NUL -w "%{http_code}`n" -X OPTIONS "$env:VITE_SUPABASE_URL/functions/v1/parse" -H "Origin: http://localhost:5173" -H "Access-Control-Request-Method: POST"
curl.exe -s -w "`n%{http_code}`n" -X POST "$env:VITE_SUPABASE_URL/functions/v1/parse" -H "content-type: application/json" -H "authorization: Bearer $env:VITE_SUPABASE_ANON" -d '{"phrase":"wednesday","tzOffsetMinutes":0}'
curl.exe -s -o NUL -w "%{http_code}`n" -X OPTIONS "$env:VITE_SUPABASE_URL/functions/v1/polish" -H "Origin: http://localhost:5173" -H "Access-Control-Request-Method: POST"
```

Expected:
- The OPTIONS preflight returns `200` (was 200 before too — but now with an `Access-Control-Allow-Origin: http://localhost:5173` header, which the browser required).
- The POST with the anon key returns `401 invalid token` (expected — the browser sends a real session JWT; this proves the function is reachable and not a network/CORS failure).

The end-to-end success path (real session token from the app) is covered by the manual checklist in Task 7.

- [ ] **Step 7: Commit**

```bash
git add -f supabase/functions/parse supabase/functions/polish
git commit -m "fix(edge): allow localhost CORS for parse/polish; strengthen weekday + time-of-day prompts"
```

---

## Task 7: Final verification and manual checklist

**Files:**
- None (verification pass over the whole change)

- [ ] **Step 1: Full test + typecheck + build**

Run:

```bash
npm test
npm run typecheck
npm run build
```

Expected: all green.

- [ ] **Step 2: Manual checklist against the running app**

Run `npm run dev` (or the deployed static host) with the agent's persisted Supabase session, then verify:

1. **Bare weekday (typed):** type `I have something wednesday` → preview shows "📅 I have something · Wed, Sep 9 · all day"; a confirm card appears; **Add** → an all-day card for next Wednesday (this week if Wednesday hasn't passed, else next week).
2. **Past weekday:** if today is a weekday after Wednesday, the resolved all-day card lands next week.
3. **Today matches:** typing the current weekday resolves to today.
4. **Explicit cue, no confirm:** type `3pm`, `tomorrow 9am`, `next wednesday` → adds instantly, no confirm card.
5. **Time-of-day:** type `by morning` after noon → confirm card pre-filled tomorrow 09:00 (toggling the time/date/all-day updates the value); before noon → today 09:00.
6. **Weekly cycle:** `wednesday` added once uses this-week; a *second* time before Wednesday passes uses the same day (idempotent).
7. **Todo untouched:** `call mom`, `buy milk` → instant todo, no confirm.
8. **Dictate path:** dictate "I need to buy milk tomorrow morning and call john by friday" → polish → "buy milk" = tomorrow 09:00 event; "call john" = all-day Friday event; no raw "by friday" todo.
9. **Settings → NVIDIA → Test:** with **no key** entered → "NVIDIA proxy works (no key needed)." No "Enter a key first." Also confirms no "Network error: Failed to fetch".
10. **Settings → NVIDIA, key cleared, Test:** still tests (Task 4 gate).
11. **Settings → Gemini/Groq:** Test with no key → "Enter a key first." (gate kept for keyed providers).
12. **All-day badge:** the added all-day items render with the existing "all day" badge in the schedule view.

- [ ] **Step 3: Final commit (if any stragglers)**

If the manual pass surfaced no issues, nothing further to commit beyond Tasks 1–6.

---

## Out of scope / known follow-ups

- `polish/index.ts` still uses `MODEL = "mistralai/mistral-nemotron"` (a Mistral model, not NVIDIA's — the `parse` function already migrated its list). Not fixed here; flag as a follow-up ticket.
- No data migration needed: existing rows keep their stored `all_day`; the resolver only affects new adds.
- `demo` (no Supabase) mode: the resolver still runs for typed guesses; the NVIDIA fetch path simply errors as before (no `parseFunction`), falling back to "added as a plain note".