import { describe, it, expect } from "vitest";
import { starClickValue } from "../../src/ui/views";

describe("starClickValue", () => {
  it("shiftKey always clears the rating to 0 regardless of zone", () => {
    expect(starClickValue(3, "whole", 5, true)).toBe(0);
    expect(starClickValue(3, "half", 5, true)).toBe(0);
    expect(starClickValue(1, "whole", 0, true)).toBe(0);
  });

  it("clicking the same value the rating is already at clears it to 0", () => {
    // current rating 3, whole-zone click on star 3 → toggle off
    expect(starClickValue(3, "whole", 3, false)).toBe(0);
    // current rating 2.5, half-zone click on star 3 → toggle off
    expect(starClickValue(3, "half", 2.5, false)).toBe(0);
  });

  it("whole-zone click sets the integer position", () => {
    // current rating 0, click right half of star 2 → set to 2
    expect(starClickValue(2, "whole", 0, false)).toBe(2);
    // current rating 2, click right half of star 4 → set to 4 (not toggle)
    expect(starClickValue(4, "whole", 2, false)).toBe(4);
  });

  it("half-zone click sets the half-step below the position", () => {
    // current rating 0, click left half of star 3 → set to 2.5
    expect(starClickValue(3, "half", 0, false)).toBe(2.5);
    // current rating 1, click left half of star 5 → set to 4.5
    expect(starClickValue(5, "half", 1, false)).toBe(4.5);
  });

  it("clicking the half zone of the next-up star extends current rating by 0.5", () => {
    // current rating 2, click left half of star 3 → 2.5 (extension, not toggle)
    expect(starClickValue(3, "half", 2, false)).toBe(2.5);
    // current rating 4, click left half of star 5 → 4.5
    expect(starClickValue(5, "half", 4, false)).toBe(4.5);
  });

  it("clicking whole-zone on a star with no current rating sets it to the integer", () => {
    expect(starClickValue(1, "whole", 0, false)).toBe(1);
    expect(starClickValue(5, "whole", 0, false)).toBe(5);
  });
});