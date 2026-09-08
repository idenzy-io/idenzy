import { describe, expect, it } from "vitest";
import { FIT_FLOOR, fitScale } from "../../app/utils/fit";

describe("fitScale", () => {
  it("leaves a figure alone when it and the aside both fit", () => {
    expect(fitScale(81, 262, 130)).toBe(1);
    expect(fitScale(132, 262, 130)).toBe(1);
  });

  it("lets the aside wrap rather than shrinking a figure that fits on its own", () => {
    expect(fitScale(200, 262, 130)).toBe(1);
  });

  it("shrinks a figure wider than the row to the row", () => {
    expect(fitScale(404, 262, 130)).toBeCloseTo(262 / 404, 5);
    expect(fitScale(300, 262)).toBeCloseTo(262 / 300, 5);
  });

  it("stops at half size, a row measured at zero included", () => {
    expect(fitScale(1000, 100)).toBe(FIT_FLOOR);
    expect(fitScale(100, 0)).toBe(FIT_FLOOR);
  });

  it("answers full size for a figure with no width to measure", () => {
    expect(fitScale(0, 262)).toBe(1);
    expect(fitScale(Number.NaN, 262)).toBe(1);
  });
});
