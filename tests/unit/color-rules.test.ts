import { describe, it, expect, beforeEach, vi } from "vitest";
import { DEFAULT_COLOR_RULES, nextColorForNewRule, FAR_FUTURE_COLOR, colorFor, getSettings, updateSettings, defaults } from "../../src/settings";
import { getSession } from "../../src/auth";

vi.mock("../../src/auth", () => ({
  getSession: vi.fn()
}));

beforeEach(async () => {
  (getSession as any).mockResolvedValue(null);
  // Seed the module-level cache with the default rules so colorFor() uses them.
  await updateSettings({
    colorRules: [...DEFAULT_COLOR_RULES],
    pastDueColor: defaults().pastDueColor
  });
  // Sanity: getSettings() now returns the seeded rules.
  expect(getSettings().colorRules).toHaveLength(2);
});

describe("DEFAULT_COLOR_RULES", () => {
  it("has exactly two entries (Overdue is gone; past-due lives in pastDueColor)", () => {
    expect(DEFAULT_COLOR_RULES).toHaveLength(2);
  });

  it("contains Today and This week", () => {
    const labels = DEFAULT_COLOR_RULES.map((r) => r.label);
    expect(labels).toEqual(["Today", "This week"]);
  });

  it("uses amber and green", () => {
    const colors = DEFAULT_COLOR_RULES.map((r) => r.color.toLowerCase());
    expect(colors).toEqual(["#d28c2a", "#3f7d6e"]);
  });

  it("uses 24 and 168 hours", () => {
    const hours = DEFAULT_COLOR_RULES.map((r) => r.withinHours);
    expect(hours).toEqual([24, 168]);
  });

  it("has no Overdue rule with withinHours=0", () => {
    expect(DEFAULT_COLOR_RULES.some((r) => r.id === "r-overdue")).toBe(false);
    expect(DEFAULT_COLOR_RULES.some((r) => r.withinHours === 0)).toBe(false);
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

  // Past-date ISO. Anchors on yesterday's calendar date at the same wall-clock
  // offset, so the item is strictly before today regardless of the current
  // hour. colorFor routes yesterday-dated items to pastDueColor even when the
  // underlying clock offset is small.
  function isoYesterdayAtNowPlus(offsetHours: number): string {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    d.setHours(d.getHours(), d.getMinutes(), d.getSeconds(), d.getMilliseconds());
    return new Date(d.getTime() + offsetHours * 3.6e6).toISOString();
  }

  it("paints a 1h-future item with Today (amber)", () => {
    expect(colorFor(isoFromNow(1))?.toLowerCase()).toBe("#d28c2a");
  });

  it("paints a 25h-future item with This week (green)", () => {
    expect(colorFor(isoFromNow(25))?.toLowerCase()).toBe("#3f7d6e");
  });

  it("paints a 1h-past-dated item with pastDueColor (red)", () => {
    expect(colorFor(isoYesterdayAtNowPlus(-1))?.toLowerCase()).toBe("#b4452f");
  });

  it("paints a 12h-past-dated item with pastDueColor (red) regardless of how far past", () => {
    expect(colorFor(isoYesterdayAtNowPlus(-12))?.toLowerCase()).toBe("#b4452f");
  });

  it("uses pastDueColor for past items even when colorRules is empty", () => {
    updateSettings({ colorRules: [], pastDueColor: "#abcdef" });
    expect(colorFor(isoYesterdayAtNowPlus(-1))?.toLowerCase()).toBe("#abcdef");
  });

  it("ignores colorRules for past items — only pastDueColor applies", () => {
    updateSettings({
      colorRules: [{ id: "r-x", label: "Trap", color: "#00ff00", withinHours: 9999 }],
      pastDueColor: "#123456"
    });
    expect(colorFor(isoYesterdayAtNowPlus(-50))?.toLowerCase()).toBe("#123456");
  });
});

describe("colorFor (date-aware)", () => {
  it("yesterday's items get pastDueColor", () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(19, 0, 0, 0);
    expect(colorFor(yesterday.toISOString())?.toLowerCase()).toBe("#b4452f");
  });

  it("earlier-today items get Today color even though hours < 0", () => {
    const earlier = new Date();
    earlier.setHours(4, 14, 0, 0);
    expect(colorFor(earlier.toISOString())?.toLowerCase()).toBe("#d28c2a");
  });

  it("future-today items get Today color", () => {
    const later = new Date();
    later.setHours(23, 0, 0, 0);
    expect(colorFor(later.toISOString())?.toLowerCase()).toBe("#d28c2a");
  });

  it("null iso returns null", () => {
    expect(colorFor(null)).toBe(null);
  });
});