import { describe, expect, it } from "vitest";
import { trendOf } from "../../app/utils/trend";

describe("trendOf", () => {
  it("calls a rise good news unless told down is", () => {
    expect(trendOf(12480, 11988)).toEqual({ direction: "up", tone: "good", text: "+4.1%" });
    expect(trendOf(99, 87, "down")).toEqual({ direction: "up", tone: "bad", text: "+13.8%" });
  });

  it("calls a fall bad news unless told down is", () => {
    expect(trendOf(87, 99)).toEqual({ direction: "down", tone: "bad", text: "-12.1%" });
    expect(trendOf(87, 99, "down")).toEqual({ direction: "down", tone: "good", text: "-12.1%" });
  });

  it("judges direction on the change as written, so a zero is never coloured", () => {
    expect(trendOf(10000.03, 10000)).toEqual({ direction: "flat", tone: "neutral", text: "0%" });
    expect(trendOf(100, 100)).toEqual({ direction: "flat", tone: "neutral", text: "0%" });
  });

  it("has no answer against nothing, and says so with a dash", () => {
    expect(trendOf(87, 0)).toEqual({ direction: "flat", tone: "neutral", text: "–" });
    expect(trendOf(Number.NaN, 10).text).toBe("–");
  });
});
