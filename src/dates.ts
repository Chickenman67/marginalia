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