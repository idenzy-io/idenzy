import { TOLERANCE_FLOOR_CENTS } from "@idenzy/protocol/billing/price-list";
import { describe, expect, it } from "vitest";
import { SpendTolerance, type WalletPosition } from "../src/policies/spend-tolerance.js";

/**
 * The arithmetic behind the spend gate (ADR-0014).
 *
 * These cases used to live in an integration test that set ledger rows in Postgres and asked
 * `WalletSolvency`. They moved here when the gate became a projection (ADR-0016): the decision is
 * pure, so testing it through a database was testing the database. What the integration test
 * keeps is the half that genuinely needs one — that a decision published by the drawdown is the
 * decision a cell reads back.
 */
const tolerance = new SpendTolerance();

function position(overrides: Partial<WalletPosition>): WalletPosition {
  return { debtCents: 0, creditCents: 0, chargedInWindowCents: 0, ...overrides };
}

describe("whether an organisation may still spend", () => {
  it("allows one that owes nothing", () => {
    expect(tolerance.decide(position({})).spendable).toBe(true);
  });

  it("allows one whose credit covers what it owes", () => {
    expect(tolerance.decide(position({ debtCents: 4000, creditCents: 10_000 })).spendable).toBe(
      true,
    );
  });

  /**
   * The design's whole point: running out is not a cliff. A new organisation with no history
   * still gets the floor, so its first overage is not also its first outage.
   */
  it("allows a small overage on the floor alone", () => {
    expect(tolerance.decide(position({ debtCents: TOLERANCE_FLOOR_CENTS - 100 })).spendable).toBe(
      true,
    );
  });

  it("refuses once the debt passes the floor and there is no history", () => {
    const decision = tolerance.decide(position({ debtCents: TOLERANCE_FLOOR_CENTS + 100 }));
    expect(decision.spendable).toBe(false);
    // The reason is what an operator reads on the wallet screen, so it must say something.
    expect(decision.reason).not.toBe("");
  });

  /**
   * Tolerance is a share of what was charged, so an organisation that uses more gets more rope —
   * and it does not move because they happened to top up on a particular day, which is the
   * failure of keying it on payments.
   */
  it("gives a heavier user more rope, in proportion to what it was charged", () => {
    const charged = { chargedInWindowCents: 500_000 };
    // 20% of $5,000 is $1,000, comfortably above the floor.
    expect(tolerance.decide(position({ ...charged, debtCents: 90_000 })).spendable).toBe(true);
    expect(tolerance.decide(position({ ...charged, debtCents: 200_000 })).spendable).toBe(false);
  });

  it("counts credit against the debt before the rope", () => {
    const debt = TOLERANCE_FLOOR_CENTS + 1000;
    expect(tolerance.decide(position({ debtCents: debt })).spendable).toBe(false);
    expect(tolerance.decide(position({ debtCents: debt, creditCents: 1500 })).spendable).toBe(true);
  });

  it("treats a negative balance as owing nothing rather than as owing backwards", () => {
    // `adjustDebt` can leave a credit balance after a top-up settles more than was owed.
    expect(tolerance.decide(position({ debtCents: -5000 })).spendable).toBe(true);
  });
});
