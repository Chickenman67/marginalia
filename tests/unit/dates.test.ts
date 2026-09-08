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