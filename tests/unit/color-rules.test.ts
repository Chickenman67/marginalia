import { describe, it, expect, beforeEach, vi } from "vitest";
import { DEFAULT_COLOR_RULES, nextColorForNewRule, FAR_FUTURE_COLOR, colorFor, getSettings, updateSettings } from "../../src/settings";
import { getSession } from "../../src/auth";

vi.mock("../../src/auth", () => ({
  getSession: vi.fn()
}));

beforeEach(async () => {
  (getSession as any).mockResolvedValue(null);
  // Seed the module-level cache with the default rules so colorFor() uses them.
  await updateSettings({ colorRules: [...DEFAULT_COLOR_RULES] });
  // Sanity: getSettings() now returns the seeded rules.
  expect(getSettings().colorRules).toHaveLength(3);
});

describe("DEFAULT_COLOR_RULES", () => {
  it("has exactly three entries", () => {
    expect(DEFAULT_COLOR_RULES).toHaveLength(3);
  });

  it("contains Overdue, Today, and This week", () => {
    const labels = DEFAULT_COLOR_RULES.map((r) => r.label);
    expect(labels).toEqual(["Overdue", "Today", "This week"]);
  });

  it("uses red, amber, and green", () => {
    const colors = DEFAULT_COLOR_RULES.map((r) => r.color.toLowerCase());
    expect(colors).toEqual(["#b4452f", "#d28c2a", "#3f7d6e"]);
  });

  it("uses 0, 24, and 168 hours", () => {
    const hours = DEFAULT_COLOR_RULES.map((r) => r.withinHours);
    expect(hours).toEqual([0, 24, 168]);
  });
});

describe("nextColorForNewRule", () => {
  it("returns the first palette color when nothing is taken", () => {
    expect(nextColorForNewRule([])).toBe("#b4452f");
  });

  it("skips colors already in the list", () => {
    expect(nextColorForNewRule(["#b4452f"])).toBe("#d28c2a");
    expect(nextColorForNewRule(["#b4452f", "#d28c2a"])).toBe("#3f7d6e");
    expect(nextColorForNewRule(["#b4452f", "#d28c2a", "#3f7d6e"])).toBe("#6c63ff");
  });

  it("is case-insensitive when comparing existing colors", () => {
    expect(nextColorForNewRule(["#B4452F"])).toBe("#d28c2a");
  });

  it("falls back to the first palette entry when all are used", () => {
    const all = ["#b4452f", "#d28c2a", "#3f7d6e", "#6c63ff", "#c64a8e", "#4a8ec6"];
    expect(nextColorForNewRule(all)).toBe("#b4452f");
  });
});

describe("FAR_FUTURE_COLOR", () => {
  it("is the green used for items beyond every rule", () => {
    expect(FAR_FUTURE_COLOR.toLowerCase()).toBe("#3f7d6e");
  });
});

describe("colorFor with default rules", () => {
  // The beforeEach above has already seeded the module-level cache with the
  // default rules and mocked getSession to null.

  function isoFromNow(offsetHours: number): string {
    return new Date(Date.now() + offsetHours * 3.6e6).toISOString();
  }

  it("paints a 1h-future item with Today (amber)", () => {
    expect(colorFor(isoFromNow(1))?.toLowerCase()).toBe("#d28c2a");
  });

  it("paints a 25h-future item with This week (green)", () => {
    expect(colorFor(isoFromNow(25))?.toLowerCase()).toBe("#3f7d6e");
  });

  it("paints a 1h-past item with Overdue (red) — withinHours=0 boundary rule", () => {
    expect(colorFor(isoFromNow(-1))?.toLowerCase()).toBe("#b4452f");
  });

  it("paints a 12h-past item with Overdue (red) — still within the boundary rule", () => {
    expect(colorFor(isoFromNow(-12))?.toLowerCase()).toBe("#b4452f");
  });
});
