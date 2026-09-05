// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { priorityComparator, getPinnedRatings } from "../../src/ui/views";
import type { Item } from "../../src/types";

function item(id: string, rating: number, created = "2026-01-01"): Item {
  return {
    id,
    title: id,
    rating,
    created_at: created,
    order: 0,
    status: "pending",
    kind: "todo",
    datetime: null,
    reminder: null,
    all_day: false
  } as Item;
}

describe("priorityComparator", () => {
  it("sorts higher rating first with no pins", () => {
    const a = item("a", 5);
    const b = item("b", 3);
    expect(priorityComparator(a, b)).toBeLessThan(0);
    expect(priorityComparator(b, a)).toBeGreaterThan(0);
  });

  it("uses pinned rating over actual rating for the pinned item", () => {
    const a = item("a", 5); // would normally sort first
    const b = item("b", 3);
    const pinned = new Map<string, number>([["a", 1]]);
    // With a pinned to 1, b (rating 3) should now come first
    expect(priorityComparator(a, b, pinned)).toBeGreaterThan(0);
    expect(priorityComparator(b, a, pinned)).toBeLessThan(0);
  });

  it("ignores pins for items not in the map", () => {
    const a = item("a", 4);
    const b = item("b", 2);
    const pinned = new Map<string, number>([["other", 5]]);
    expect(priorityComparator(a, b, pinned)).toBeLessThan(0);
  });

  it("treats equal pinned+actual ratings as 0", () => {
    const a = item("a", 4);
    const b = item("b", 4);
    const pinned = new Map<string, number>([["a", 4]]);
    expect(priorityComparator(a, b, pinned)).toBe(0);
  });
});

describe("getPinnedRatings", () => {
  it("returns a map populated from .stars[data-editing] rows", () => {
    document.body.innerHTML = `
      <div id="host">
        <span class="stars" data-item="a" data-editing="1" data-previous-rating="2"></span>
        <span class="stars" data-item="b" data-editing="1" data-previous-rating="4"></span>
        <span class="stars" data-item="c"></span>
      </div>
    `;
    const host = document.getElementById("host")!;
    const map = getPinnedRatings(host);
    expect(map.get("a")).toBe(2);
    expect(map.get("b")).toBe(4);
    expect(map.has("c")).toBe(false);
    expect(map.size).toBe(2);
  });

  it("returns an empty map when no row is editing", () => {
    document.body.innerHTML = `<div id="host"><span class="stars" data-item="a"></span></div>`;
    const host = document.getElementById("host")!;
    expect(getPinnedRatings(host).size).toBe(0);
  });
});