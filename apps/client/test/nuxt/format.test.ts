import { describe, expect, it } from "vitest";
import {
  formatChange,
  formatFigure,
  NO_FIGURE,
  relativeChange,
  writeFigure,
} from "../../app/utils/format";

describe("formatFigure", () => {
  it("groups a plain number and writes only the fraction digits it has", () => {
    expect(formatFigure(12480)).toEqual({ digits: "12,480", magnitude: "", unit: "" });
    expect(formatFigure(99.512).digits).toBe("99.5");
    expect(formatFigure(4212.375, { decimals: 2 }).digits).toBe("4,212.38");
    expect(formatFigure(-87).digits).toBe("-87");
  });

  it("compacts to one decimal with a lowercase suffix", () => {
    expect(formatFigure(4212, { compact: true })).toEqual({
      digits: "4.2",
      magnitude: "k",
      unit: "",
    });
    expect(formatFigure(12345, { compact: true })).toEqual({
      digits: "12.3",
      magnitude: "k",
      unit: "",
    });
    expect(formatFigure(421000, { compact: true })).toEqual({
      digits: "421",
      magnitude: "k",
      unit: "",
    });
    expect(formatFigure(4200344, { compact: true })).toEqual({
      digits: "4.2",
      magnitude: "m",
      unit: "",
    });
    expect(formatFigure(3.4e9, { compact: true })).toEqual({
      digits: "3.4",
      magnitude: "b",
      unit: "",
    });
    expect(formatFigure(-4212, { compact: true })).toEqual({
      digits: "-4.2",
      magnitude: "k",
      unit: "",
    });
  });

  it("leaves a compact figure under a thousand alone", () => {
    expect(formatFigure(999, { compact: true })).toEqual({
      digits: "999",
      magnitude: "",
      unit: "",
    });
    expect(formatFigure(0, { compact: true })).toEqual({ digits: "0", magnitude: "", unit: "" });
  });

  it("promotes a compact figure that rounds up to the next suffix", () => {
    expect(formatFigure(999950, { compact: true })).toEqual({
      digits: "1",
      magnitude: "m",
      unit: "",
    });
  });

  it("scales bytes by 1024 and names the unit itself", () => {
    expect(formatFigure(512, { format: "bytes" })).toEqual({
      digits: "512",
      magnitude: "",
      unit: "B",
    });
    expect(formatFigure(1024, { format: "bytes" })).toEqual({
      digits: "1",
      magnitude: "",
      unit: "kB",
    });
    expect(formatFigure(79720, { format: "bytes", decimals: 2 })).toEqual({
      digits: "77.85",
      magnitude: "",
      unit: "kB",
    });
    expect(formatFigure(3 * 1024 ** 3, { format: "bytes" })).toEqual({
      digits: "3",
      magnitude: "",
      unit: "GB",
    });
    expect(formatFigure(0, { format: "bytes" })).toEqual({ digits: "0", magnitude: "", unit: "B" });
  });

  it("promotes bytes that round up to the next unit", () => {
    // 1,023.999 kB to one decimal is "1,024 kB", which is the number 1024 exists to avoid.
    expect(formatFigure(1048575, { format: "bytes" })).toEqual({
      digits: "1",
      magnitude: "",
      unit: "MB",
    });
  });

  it("writes a dash for a value that is not a number", () => {
    expect(formatFigure(Number.NaN)).toEqual(NO_FIGURE);
    expect(formatFigure(Number.POSITIVE_INFINITY, { compact: true })).toEqual(NO_FIGURE);
  });
});

describe("writeFigure", () => {
  it("joins the parts into one run, with the affixes in their places", () => {
    expect(writeFigure(4212)).toBe("4,212");
    expect(writeFigure(4212, { compact: true, prefix: "$" })).toBe("$4.2k");
    expect(writeFigure(142.4, { unit: "ms", decimals: 0 })).toBe("142 ms");
    expect(writeFigure(79720, { format: "bytes", decimals: 2, unit: "ignored" })).toBe("77.85 kB");
  });

  it("closes a percent sign up and sets every other unit off", () => {
    expect(writeFigure(42, { unit: "%" })).toBe("42%");
    expect(writeFigure(42, { unit: "users" })).toBe("42 users");
  });

  it("writes a dash alone for a value that is not a number", () => {
    expect(writeFigure(Number.NaN, { prefix: "$", unit: "ms" })).toBe("–");
  });
});

describe("relativeChange", () => {
  it("is the movement as a share of the previous figure", () => {
    expect(relativeChange(12480, 11988)).toBeCloseTo(0.041, 3);
    expect(relativeChange(87, 99)).toBeCloseTo(-0.1212, 4);
    expect(relativeChange(50, -100)).toBeCloseTo(1.5, 5);
  });

  it("has no answer against nothing", () => {
    expect(relativeChange(87, 0)).toBeNull();
    expect(relativeChange(Number.NaN, 10)).toBeNull();
  });
});

describe("formatChange", () => {
  it("always writes the sign, except on zero", () => {
    expect(formatChange(0.041)).toBe("+4.1%");
    expect(formatChange(-0.124)).toBe("-12.4%");
    expect(formatChange(0)).toBe("0%");
    expect(formatChange(12.5)).toBe("+1,250%");
  });

  it("does not sign a change that rounds to nothing", () => {
    expect(formatChange(0.0004)).toBe("0%");
  });
});
