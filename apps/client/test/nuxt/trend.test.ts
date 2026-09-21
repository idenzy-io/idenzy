import { describe, expect, it } from "vitest";
import { trendOf } from "../../app/utils/trend";

describe("trendOf", () => {
  it("calls a rise good news unless told down is", () => {
    expect(trendOf(12480, 11988)).toEqual({
      direction: "up",
      tone: "good",
      text: "+4.1%",
      comparable: true,
    });
    expect(trendOf(99, 87, "down")).toEqual({
      direction: "up",
      tone: "bad",
      text: "+13.8%",
      comparable: true,
    });
  });

  it("calls a fall bad news unless told down is", () => {
    expect(trendOf(87, 99)).toEqual({
      direction: "down",
      tone: "bad",
      text: "-12.1%",
      comparable: true,
    });
    expect(trendOf(87, 99, "down")).toEqual({
      direction: "down",
      tone: "good",
      text: "-12.1%",
      comparable: true,
    });
  });

  it("judges direction on the change as written, so a zero is never coloured", () => {
    expect(trendOf(10000.03, 10000)).toEqual({
      direction: "flat",
      tone: "neutral",
      text: "0%",
      comparable: true,
    });
    expect(trendOf(100, 100)).toEqual({
      direction: "flat",
      tone: "neutral",
      text: "0%",
      comparable: true,
    });
  });

  it("has no answer against nothing, and says so with a dash", () => {
    expect(trendOf(87, 0)).toEqual({
      direction: "flat",
      tone: "neutral",
      text: "–",
      comparable: false,
    });
    expect(trendOf(Number.NaN, 10).text).toBe("–");
  });

  it("marks a comparison with no baseline as one that cannot be made", () => {
    /* The dash and a written zero are different statements: one says the figure held
       still, the other that there was nothing to hold still against. */
    expect(trendOf(87, 0).comparable).toBe(false);
    expect(trendOf(0, 0).comparable).toBe(false);
    expect(trendOf(100, 100).comparable).toBe(true);
  });
});
