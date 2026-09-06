// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { starHTML, starSymbolHTML } from "../../src/ui/views";
import { STAR_EMPTY_FILL } from "../../src/ui/views";
// `bindStarEvents` lives in `input.ts`, but importing it eagerly triggers
// module-level side effects (date/time trigger initialisation) that need the
// full input-form DOM. The Clear-hint tests below lazy-import it inside each
// test so the side effects run with the right DOM, not at collection time.

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

  it("emits a .tip element whose initial text is the committed rating", () => {
    const h0 = starHTML(0, "x");
    const h3 = starHTML(3, "x");
    const h25 = starHTML(2.5, "x");
    // rating 0: tip text is empty (hidden)
    expect(h0.match(/class="tip"[^>]*>([^<]*)/)?.[1] ?? "").toBe("");
    expect(h3.match(/class="tip"[^>]*>([^<]*)/)?.[1] ?? "").toBe("3");
    expect(h25.match(/class="tip"[^>]*>([^<]*)/)?.[1] ?? "").toBe("2.5");
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

describe("star hover — Clear hint", () => {
  it("renders tooltip 'Clear' when hovering the star at the current rating", async () => {
    // Append (do NOT replace) the host so the input-form from beforeEach stays
    // mounted — importing input.ts at the bottom of this test re-evaluates
    // module-level side effects that need the form.
    const host = document.createElement("div");
    host.id = "host";
    host.innerHTML = starHTML(3, "item-1");
    document.body.appendChild(host);

    const items = [{
      id: "item-1", space_token: "s", user_id: "", kind: "todo" as const,
      title: "Test", datetime: null, all_day: false, reminder: null,
      status: "pending" as const, created_at: "2026-01-01T00:00:00.000Z",
      order: 0, pinned: false, rating: 3
    }];
    const { bindStarEvents } = await import("../../src/ui/input");
    bindStarEvents(host, items);

    // Dispatch a mousemove on the whole-zone of star 3 (matches rating 3).
    const star3 = host.querySelector<HTMLElement>('.star[data-pos="3"]')!;
    Object.defineProperty(star3, "clientWidth", { value: 18, configurable: true });
    star3.dispatchEvent(new MouseEvent("mousemove", {
      bubbles: true, clientX: 0, clientY: 0
    }));
    // `offsetX` is what `starHoverValue` reads; defineProperty it on the event
    // since the MouseEvent constructor doesn't take it directly. Right half of
    // the 18px-wide star → whole zone → value 3.
    Object.defineProperty(star3, "offsetX", { value: 14, configurable: true });
    star3.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: 14, clientY: 0 }));

    // Tip text should read "Clear" because value === current rating.
    const tip = host.querySelector<HTMLElement>(".tip")!;
    expect(tip.textContent).toBe("Clear");
  });

  it("renders tooltip number when hovering a different rating", async () => {
    const host = document.createElement("div");
    host.id = "host";
    host.innerHTML = starHTML(3, "item-2");
    document.body.appendChild(host);

    const items = [{
      id: "item-2", space_token: "s", user_id: "", kind: "todo" as const,
      title: "Test", datetime: null, all_day: false, reminder: null,
      status: "pending" as const, created_at: "2026-01-01T00:00:00.000Z",
      order: 0, pinned: false, rating: 3
    }];
    const { bindStarEvents } = await import("../../src/ui/input");
    bindStarEvents(host, items);

    const star4 = host.querySelector<HTMLElement>('.star[data-pos="4"]')!;
    Object.defineProperty(star4, "clientWidth", { value: 18, configurable: true });
    Object.defineProperty(star4, "offsetX", { value: 14, configurable: true });
    star4.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: 14, clientY: 0 }));

    const tip = host.querySelector<HTMLElement>(".tip")!;
    expect(tip.textContent).toBe("4");
  });
});
