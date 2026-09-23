import { AUTO_TOP_UP_DAILY_LIMIT } from "@idenzy/protocol/billing/price-list";
import { AutoTopUpSuspension, TopUpState } from "@idenzy/protocol/enums/billing";
import { describe, expect, it } from "vitest";
import {
  AUTO_TOP_UP_BACKOFF_MS,
  AUTO_TOP_UP_MAX_FAILURES,
  AUTO_TOP_UP_MIN_SPACING_MS,
  AutoTopUpPolicy,
  type AutoTopUpPosition,
  type AutoTopUpRule,
  AutoTopUpSkip,
} from "../src/policies/auto-top-up-policy.js";

/**
 * When the automatic top-up fires (ADR-0017).
 *
 * Every rule here exists to stop a charge, so most cases assert a charge does *not* happen.
 * The one that fires is the narrow path through all of them.
 */
const policy = new AutoTopUpPolicy();
const NOW = new Date("2026-09-23T12:00:00Z");

function rule(overrides: Partial<AutoTopUpRule> = {}): AutoTopUpRule {
  return {
    enabled: true,
    thresholdCents: 1000,
    amountCents: 5000,
    dailyLimit: AUTO_TOP_UP_DAILY_LIMIT,
    failures: 0,
    lastAttemptAt: null,
    suspendedReason: null,
    ...overrides,
  };
}

function position(overrides: Partial<AutoTopUpPosition> = {}): AutoTopUpPosition {
  return {
    balanceCents: 500,
    attemptsInWindow: 0,
    openCharge: false,
    hasPaymentMethod: true,
    now: NOW,
    ...overrides,
  };
}

function ago(ms: number): Date {
  return new Date(NOW.getTime() - ms);
}

describe("deciding whether to charge", () => {
  it("charges the configured amount when the balance is below the threshold", () => {
    expect(policy.decide(rule(), position())).toEqual({ kind: "charge", amountCents: 5000 });
  });

  it("charges when debt has taken the balance negative", () => {
    expect(policy.decide(rule(), position({ balanceCents: -20_000 })).kind).toBe("charge");
  });

  it("does nothing at or above the threshold", () => {
    expect(policy.decide(rule(), position({ balanceCents: 1000 }))).toEqual({
      kind: "skip",
      reason: AutoTopUpSkip.AboveThreshold,
    });
  });

  it("does nothing when the rule is off, whatever the balance", () => {
    expect(policy.decide(rule({ enabled: false }), position({ balanceCents: -99_999 })).kind).toBe(
      "skip",
    );
  });

  it("does nothing while suspended, whatever the balance", () => {
    expect(
      policy.decide(
        rule({ suspendedReason: AutoTopUpSuspension.Dispute }),
        position({ balanceCents: -99_999 }),
      ),
    ).toEqual({ kind: "skip", reason: AutoTopUpSkip.Suspended });
  });

  /** Never two open at once: the second would be a double charge if both succeeded. */
  it("never opens a second charge while one is still open", () => {
    expect(policy.decide(rule(), position({ openCharge: true }))).toEqual({
      kind: "skip",
      reason: AutoTopUpSkip.InFlight,
    });
  });

  it("stops at the daily limit, counting attempts rather than successes", () => {
    expect(policy.decide(rule(), position({ attemptsInWindow: AUTO_TOP_UP_DAILY_LIMIT }))).toEqual({
      kind: "skip",
      reason: AutoTopUpSkip.DailyLimit,
    });
    expect(policy.decide(rule(), position({ attemptsInWindow: 2 })).kind).toBe("charge");
  });

  it("honours a per-organisation limit set by support", () => {
    expect(policy.decide(rule({ dailyLimit: 1 }), position({ attemptsInWindow: 1 })).kind).toBe(
      "skip",
    );
  });

  it("spaces successful charges out", () => {
    const soon = rule({ lastAttemptAt: ago(AUTO_TOP_UP_MIN_SPACING_MS - 1) });
    expect(policy.decide(soon, position())).toEqual({
      kind: "skip",
      reason: AutoTopUpSkip.Spacing,
    });
    const later = rule({ lastAttemptAt: ago(AUTO_TOP_UP_MIN_SPACING_MS) });
    expect(policy.decide(later, position()).kind).toBe("charge");
  });

  it("backs off after a failure, twice as long after the second", () => {
    const once = rule({ failures: 1, lastAttemptAt: ago(AUTO_TOP_UP_BACKOFF_MS - 1) });
    expect(policy.decide(once, position())).toEqual({
      kind: "skip",
      reason: AutoTopUpSkip.BackingOff,
    });
    expect(
      policy.decide(rule({ failures: 1, lastAttemptAt: ago(AUTO_TOP_UP_BACKOFF_MS) }), position())
        .kind,
    ).toBe("charge");
    const twice = rule({ failures: 2, lastAttemptAt: ago(AUTO_TOP_UP_BACKOFF_MS * 2 - 1) });
    expect(policy.decide(twice, position()).kind).toBe("skip");
  });

  it("suspends rather than skipping when there is no card to charge", () => {
    expect(policy.decide(rule(), position({ hasPaymentMethod: false }))).toEqual({
      kind: "suspend",
      reason: AutoTopUpSuspension.NoPaymentMethod,
    });
  });

  it("does not suspend over a missing card when nothing needs charging", () => {
    expect(
      policy.decide(rule(), position({ balanceCents: 99_999, hasPaymentMethod: false })).kind,
    ).toBe("skip");
  });
});

describe("deciding whether a failure stops the rule", () => {
  it("stops at once when the bank wants the cardholder present", () => {
    expect(policy.afterFailure(1, TopUpState.RequiresAction, null)).toBe(
      AutoTopUpSuspension.AuthenticationRequired,
    );
    expect(policy.afterFailure(1, TopUpState.Failed, "authentication_required")).toBe(
      AutoTopUpSuspension.AuthenticationRequired,
    );
  });

  it("stops at once on a card that will never work", () => {
    expect(policy.afterFailure(1, TopUpState.Failed, "expired_card")).toBe(
      AutoTopUpSuspension.NoPaymentMethod,
    );
  });

  it("gives an ordinary decline the benefit of the doubt until the limit", () => {
    expect(policy.afterFailure(1, TopUpState.Failed, "card_declined")).toBeNull();
    expect(policy.afterFailure(AUTO_TOP_UP_MAX_FAILURES - 1, TopUpState.Failed, null)).toBeNull();
    expect(policy.afterFailure(AUTO_TOP_UP_MAX_FAILURES, TopUpState.Failed, null)).toBe(
      AutoTopUpSuspension.RepeatedFailure,
    );
  });
});
