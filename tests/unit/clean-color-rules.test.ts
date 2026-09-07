import { describe, expect, test } from "vitest";
import { cleanColorRules } from "../../src/settings";

describe("cleanColorRules", () => {
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
});