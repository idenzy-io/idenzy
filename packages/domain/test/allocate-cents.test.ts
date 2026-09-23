import { describe, expect, it } from "vitest";
import { allocateCents } from "../src/policies/allocate-cents.js";

describe("splitting an invoice total across projects", () => {
  it("sums to the total exactly, whatever the weights", () => {
    for (const [total, weights] of [
      [100, [1, 1, 1]],
      [9_999, [3, 7, 11, 13]],
      [1, [5, 5]],
      [247_512, [60_000, 1, 240_000]],
    ] as const) {
      const parts = allocateCents(total, weights);
      expect(parts.reduce((a, b) => a + b, 0)).toBe(total);
    }
  });

  it("is proportional, and gives the lost cents to the largest remainders", () => {
    expect(allocateCents(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(allocateCents(10, [1, 3])).toEqual([3, 7]);
  });

  it("gives nothing to a project that used nothing", () => {
    expect(allocateCents(500, [0, 10])).toEqual([0, 500]);
  });

  it("spreads nothing when nobody used anything", () => {
    expect(allocateCents(500, [0, 0])).toEqual([0, 0]);
  });
});
