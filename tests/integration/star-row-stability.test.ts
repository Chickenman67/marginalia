// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { getPinnedRatings, starHTML } from "../../src/ui/views";

// Regression test for the star-rating hover/stability wiring.
//
// Scenario: the user is hovering a .stars row (cursor inside it). The
// `mouseenter` handler on that row sets `data-editing="1"`. When the user
// clicks a star, `setRating` writes `data-previous-rating` on the current
// row, then calls `setItems(...)` which triggers a full re-render. The
// re-render replaces the host's innerHTML, producing brand-new .stars
// elements. The post-render DOM must NOT lose the `data-editing` or
// `data-previous-rating` markers while the cursor is still inside the
// row — otherwise the priority comparator uses the new rating and the
// row reorders under the user's cursor.
//
// This test simulates the sequence with the same primitives the
// production code uses (starHTML + DOM innerHTML swap) and asserts that
// `getPinnedRatings` returns a populated map on the post-render DOM
// whenever the prior DOM indicated the row was being edited.

describe("star row stability across re-render", () => {
  beforeEach(() => {
    document.body.innerHTML = `<div id="host"></div>`;
  });

  it("returns a populated map while the row is editing (sanity check)", () => {
    const host = document.getElementById("host")!;
    host.innerHTML = starHTML(0, "x");
    const row = host.querySelector<HTMLElement>(".stars[data-item='x']")!;
    row.dataset.editing = "1";
    row.dataset.previousRating = "0";

    const pinned = getPinnedRatings(host);
    expect(pinned.size).toBe(1);
    expect(pinned.get("x")).toBe(0);
  });

  it("still returns a populated map after a re-render replaces the editing row", () => {
    const host = document.getElementById("host")!;

    host.innerHTML = starHTML(0, "x");
    const row = host.querySelector<HTMLElement>(".stars[data-item='x']")!;
    row.dataset.editing = "1";
    row.dataset.previousRating = "0";

    const beforePinned = getPinnedRatings(host);
    expect(beforePinned.size).toBe(1);
    expect(beforePinned.get("x")).toBe(0);

    host.innerHTML = starHTML(5, "x");

    const afterPinned = getPinnedRatings(host);
    expect(afterPinned.size).toBe(1);
    expect(afterPinned.get("x")).toBe(0);
  });
});
