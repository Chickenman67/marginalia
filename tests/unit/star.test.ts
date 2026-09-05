// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { starHTML, starSymbolHTML } from "../../src/ui/views";
import { STAR_EMPTY_FILL } from "../../src/ui/views";

beforeEach(() => {
  document.body.innerHTML = `
    <form id="addEvent"><button id="evDate" type="button"></button><button id="evTimeTrigger" type="button"></button><input type="checkbox" id="evAllDay" /></form>
  `;
});

function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

describe("starHTML", () => {
  it("renders the symbol once when called for many cards", () => {
    const a = starHTML(3, "x");
    const b = starHTML(2.5, "y");
    expect(countOccurrences(a, "#starShape")).toBeGreaterThan(0);
    expect(countOccurrences(a, "class=\"star ")).toBe(5);
    expect(countOccurrences(b, "class=\"star ")).toBe(5);
  });

  it("rating 0 produces 5 empty stars", () => {
    const h = starHTML(0, "x");
    expect(countOccurrences(h, "star empty")).toBe(5);
    expect(countOccurrences(h, "star full")).toBe(0);
    expect(countOccurrences(h, "star half")).toBe(0);
  });

  it("rating 5 produces 5 full stars", () => {
    const h = starHTML(5, "x");
    expect(countOccurrences(h, "star full")).toBe(5);
    expect(countOccurrences(h, "star empty")).toBe(0);
  });

  it("rating 2.5 produces 2 full + 1 half + 2 empty", () => {
    const h = starHTML(2.5, "x");
    expect(countOccurrences(h, "star full")).toBe(2);
    expect(countOccurrences(h, "star half")).toBe(1);
    expect(countOccurrences(h, "star empty")).toBe(2);
  });

  it("rating 0.5 produces 1 half + 4 empty", () => {
    const h = starHTML(0.5, "x");
    expect(countOccurrences(h, "star half")).toBe(1);
    expect(countOccurrences(h, "star empty")).toBe(4);
  });

  it("rating 4.5 produces 4 full + 1 half", () => {
    const h = starHTML(4.5, "x");
    expect(countOccurrences(h, "star full")).toBe(4);
    expect(countOccurrences(h, "star half")).toBe(1);
  });

  it("rating is clamped to [0, 5]", () => {
    expect(countOccurrences(starHTML(99, "x"), "star full")).toBe(5);
    expect(countOccurrences(starHTML(-1, "x"), "star empty")).toBe(5);
  });

  it("rating is snapped to nearest 0.5", () => {
    const h = starHTML(2.3, "x");
    expect(countOccurrences(h, "star full")).toBe(2);
    expect(countOccurrences(h, "star half")).toBe(1);
  });

  it("emits a preview overlay of 5 ghost stars", () => {
    const h = starHTML(0, "x");
    expect(countOccurrences(h, "class=\"preview\"")).toBe(1);
    expect(countOccurrences(h, "class=\"preview-star\"")).toBe(5);
  });

  it("emits a numeric tooltip element", () => {
    const h = starHTML(2.5, "x");
    expect(h).toContain("class=\"tip\"");
    expect(h).toContain("2.5");
  });
});

describe("starSymbolHTML", () => {
  it("returns a <symbol> with id=starShape", () => {
    expect(starSymbolHTML()).toContain("id=\"starShape\"");
    expect(starSymbolHTML()).toContain("<symbol");
  });
});

describe("starHoverValue", () => {
  it("returns the half-step when offsetX is in the left half of the star", async () => {
    const { starHoverValue } = await import("../../src/ui/input");
    expect(starHoverValue(1, 0, 20)).toBe(0.5);
    expect(starHoverValue(3, 9, 20)).toBe(2.5);
    expect(starHoverValue(5, 1, 20)).toBe(4.5);
  });

  it("returns the full step when offsetX is in the right half of the star", async () => {
    const { starHoverValue } = await import("../../src/ui/input");
    expect(starHoverValue(1, 10, 20)).toBe(1);
    expect(starHoverValue(1, 19, 20)).toBe(1);
    expect(starHoverValue(3, 15, 20)).toBe(3);
    expect(starHoverValue(5, 20, 20)).toBe(5);
  });

  it("treats offsetX exactly at half-width as the right half (full step)", async () => {
    const { starHoverValue } = await import("../../src/ui/input");
    expect(starHoverValue(2, 10, 20)).toBe(2);
  });
});

describe("starHTML — visible empty fill", () => {
  it("renders empty stars using STAR_EMPTY_FILL (not the old near-white cream)", () => {
    const h = starHTML(0, "x");
    expect(h).toContain(`fill="${STAR_EMPTY_FILL}"`);
    expect(h).not.toContain("#fff8d6");
  });

  it("renders half stars with STAR_EMPTY_FILL as the underlying base", () => {
    const h = starHTML(2.5, "x");
    expect(h).toContain(`fill="${STAR_EMPTY_FILL}"`);
    expect(h).not.toContain("#fff8d6");
  });

  it("uses the bumped stroke-width 1.8 on empty stars", () => {
    const h = starHTML(0, "x");
    expect(h).toContain('stroke-width="1.8"');
    expect(h).not.toContain('stroke-width="1.4"');
  });
});
