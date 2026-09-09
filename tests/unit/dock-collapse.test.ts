import { describe, it, expect } from "vitest";
import { nextDockMin } from "../../src/ui/dockCollapse";

describe("nextDockMin", () => {
  it("collapses after scrolling down past 80px", () => {
    expect(nextDockMin(false, 200, 0, false)).toBe(true);
  });
  it("stays collapsed while scrolling continues down", () => {
    expect(nextDockMin(true, 300, 250, false)).toBe(true);
  });
  it("does not collapse below the 80px threshold", () => {
    expect(nextDockMin(false, 60, 0, false)).toBe(false);
  });
  it("requires more than 8px of downward movement (ignores jitter)", () => {
    expect(nextDockMin(false, 85, 80, false)).toBe(false);
  });
  it("restores when scrolling up", () => {
    expect(nextDockMin(true, 150, 300, false)).toBe(false);
  });
  it("keeps its previous state while the user is typing in the dock", () => {
    expect(nextDockMin(false, 200, 100, true)).toBe(false);
    expect(nextDockMin(true, 200, 100, true)).toBe(true);
  });
});