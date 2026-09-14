import { describe, expect, it } from "vitest";
import {
  billableMau,
  emailCents,
  FREE_MAU,
  MAU_BANDS,
  mauCents,
} from "../src/billing/price-list.js";

/**
 * What a customer is charged.
 *
 * Every number below is one somebody could be asked to pay, so the worked examples are
 * spelled out rather than computed by the same arithmetic they are checking. The
 * properties underneath them matter more: a price that is not monotonic, or one where a
 * band boundary costs a customer money for crossing it, is a bug nobody reports until an
 * invoice is disputed.
 */
describe("pricing a month's active users", () => {
  it("charges nothing inside the free allowance", () => {
    expect(mauCents(0)).toBe(0);
    expect(mauCents(1)).toBe(0);
    expect(mauCents(FREE_MAU)).toBe(0);
  });

  /**
   * The worked example, band by band. 50,000 free, then 200,000 at $0.003 and 750,000 at
   * $0.0025 — $600 plus $1,875. Not $0.0025 on everything past the allowance, which is the
   * other reading of a volume price and is $100 cheaper here.
   */
  it("prices a million marginally, at $2,475", () => {
    expect(mauCents(1_000_000)).toBe(247_500);
    expect(mauCents(250_000)).toBe(60_000);
    expect(mauCents(50_001)).toBe(0);
    expect(mauCents(60_000)).toBe(3000);
  });

  it("prices past the last band at its rate", () => {
    // 200,000 × 300 + 750,000 × 250 + 500,000 × 200 millicents = $3,475.
    expect(mauCents(1_500_000)).toBe(347_500);
    expect(mauCents(5_000_000)).toBe(1_047_500);
  });

  /**
   * The property that makes the whole drawdown safe: the price of a month can only go up
   * as the month goes on, so `priceOf(now) − billed` is never negative and a watermark can
   * only move forward (ADR-0014). A band table that broke this would have the job trying
   * to take money back.
   */
  it("never costs less for more users", () => {
    let previous = 0;
    for (const mau of [
      0, 1, 49_999, 50_000, 50_001, 249_999, 250_000, 250_001, 999_999, 1_000_000, 1_000_001,
      4_000_000,
    ]) {
      const price = mauCents(mau);
      expect(price, `${mau}`).toBeGreaterThanOrEqual(previous);
      previous = price;
    }
  });

  /**
   * Crossing a boundary must never cost more than the user before it. A rate applied to
   * the whole total rather than to the band would make the 250,001st user cost a customer
   * $125 all at once, which is the failure mode marginal banding exists to avoid.
   */
  it("charges no jump for the user that crosses a band", () => {
    for (const boundary of [50_000, 250_000, 1_000_000]) {
      const step = mauCents(boundary + 1) - mauCents(boundary);
      // One user's worth at the highest rate in the table, plus a cent for the rounding.
      expect(step, `${boundary}`).toBeLessThanOrEqual(1);
      expect(step, `${boundary}`).toBeGreaterThanOrEqual(0);
    }
  });

  /** Rounding happens once on the total, so no band can cost half a cent to cross. */
  it("answers whole cents and rounds once", () => {
    for (const mau of [50_333, 123_456, 777_777, 1_234_567]) {
      expect(Number.isInteger(mauCents(mau)), `${mau}`).toBe(true);
    }
    // 50,100 users: 100 × 300 millicents = 30,000 = exactly 30 cents.
    expect(mauCents(50_100)).toBe(30);
  });

  it("ignores a fractional or nonsense count rather than pricing it", () => {
    expect(mauCents(50_100.9)).toBe(mauCents(50_100));
    expect(mauCents(-5)).toBe(0);
    expect(mauCents(Number.NaN)).toBe(0);
  });

  /** The bands have to be ordered and closed, or the loop above prices a gap at zero. */
  it("has bands that ascend and end unbounded", () => {
    const last = MAU_BANDS.at(-1);
    expect(last?.upTo).toBeNull();
    let previous = 0;
    for (const band of MAU_BANDS.slice(0, -1)) {
      expect(band.upTo).not.toBeNull();
      expect(band.upTo ?? 0).toBeGreaterThan(previous);
      previous = band.upTo ?? 0;
    }
  });

  it("says how many users are chargeable at all", () => {
    expect(billableMau(10_000)).toBe(0);
    expect(billableMau(50_000)).toBe(0);
    expect(billableMau(60_000)).toBe(10_000);
  });
});

describe("pricing email", () => {
  it("charges per thousand on either domain, and nothing for none", () => {
    expect(emailCents(1000, false)).toBe(50);
    expect(emailCents(1000, true)).toBe(40);
    expect(emailCents(0, false)).toBe(0);
  });

  it("rounds a partial thousand rather than dropping it", () => {
    expect(emailCents(1, false)).toBe(0);
    expect(emailCents(500, false)).toBe(25);
  });
});
