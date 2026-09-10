import { describe, expect, it } from "vitest";
import { areaPath, noDataPath, noDataValues, sparklinePath } from "../../app/utils/sparkline";

describe("sparklinePath", () => {
  it("draws nothing for no values and a centred point for one", () => {
    expect(sparklinePath([], 100, 40)).toBe("");
    expect(sparklinePath([5], 100, 40)).toBe("M50.00,38.00");
  });

  it("spans the width and keeps the padding clear", () => {
    const path = sparklinePath([0, 10, 5], 100, 40, 2);
    expect(path).toBe("M0.00,38.00 L50.00,2.00 L100.00,20.00");
  });

  it("draws a flat series along the base rather than dividing by zero", () => {
    expect(sparklinePath([3, 3], 100, 40, 0)).toBe("M0.00,40.00 L100.00,40.00");
  });

  it("closes a line down to the base for the fill", () => {
    expect(areaPath("M0,1 L10,2", 10, 20)).toBe("M0,1 L10,2 L10,20 L0,20 Z");
    expect(areaPath("", 10, 20)).toBe("");
  });
});

describe("noDataValues", () => {
  it("is the same wave for the same seed and a different one for another", () => {
    expect(noDataValues(1)).toEqual(noDataValues(1));
    expect(noDataValues(1)).not.toEqual(noDataValues(2));
  });

  it("stays inside the band", () => {
    for (const seed of [1, 7, 42]) {
      for (const value of noDataValues(seed)) {
        expect(value).toBeGreaterThanOrEqual(0.1);
        expect(value).toBeLessThanOrEqual(0.9);
      }
    }
  });

  it("makes a path of sixty points", () => {
    expect(noDataPath(3, 400, 48).split(" ")).toHaveLength(60);
  });
});
