import { AutoTopUpSuspension, TopUpState } from "@idenzy/protocol/enums/billing";

/** The rule as the organisation set it, plus what the rule itself remembers. */
export interface AutoTopUpRule {
  readonly enabled: boolean;
  readonly thresholdCents: number;
  readonly amountCents: number;
  readonly dailyLimit: number;
  /** Consecutive charges that did not succeed. */
  readonly failures: number;
  readonly lastAttemptAt: Date | null;
  readonly suspendedReason: AutoTopUpSuspension | null;
}

/** What is true of the wallet at the instant the rule is asked. */
export interface AutoTopUpPosition {
  /** Spendable credit less debt. Negative inside the tolerance. */
  readonly balanceCents: number;
  /** Automatic charges opened in the rolling window, whatever became of them. */
  readonly attemptsInWindow: number;
  /** Whether an automatic charge is already open and unsettled. */
  readonly openCharge: boolean;
  /** Whether there is any card the rule could charge. */
  readonly hasPaymentMethod: boolean;
  readonly now: Date;
}

/** Why the rule did nothing this time, for the log. None of these need a person. */
export const AutoTopUpSkip = {
  Disabled: "disabled",
  Suspended: "suspended",
  AboveThreshold: "above_threshold",
  InFlight: "in_flight",
  DailyLimit: "daily_limit",
  Spacing: "spacing",
  BackingOff: "backing_off",
} as const;
export type AutoTopUpSkip = (typeof AutoTopUpSkip)[keyof typeof AutoTopUpSkip];

export type AutoTopUpDecision =
  | { readonly kind: "charge"; readonly amountCents: number }
  | { readonly kind: "skip"; readonly reason: AutoTopUpSkip }
  | { readonly kind: "suspend"; readonly reason: AutoTopUpSuspension };

/** The window the daily limit counts over. Rolling, so midnight is not a reset. */
export const AUTO_TOP_UP_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * The least time between two automatic charges, even when both succeed.
 *
 * An organisation deep in debt can still be under its threshold after a successful top-up,
 * and without this the rule would fire its whole daily allowance inside a minute — three
 * charges on one card in sixty seconds, which is exactly the shape an issuer's fraud model
 * is built to decline.
 */
export const AUTO_TOP_UP_MIN_SPACING_MS = 15 * 60 * 1000;

/** After a failure, the wait doubles from here: one hour, then two. */
export const AUTO_TOP_UP_BACKOFF_MS = 60 * 60 * 1000;

/** Consecutive failures after which the rule stops until a person looks at it. */
export const AUTO_TOP_UP_MAX_FAILURES = 3;

/**
 * Decline codes that say this card will not work however often it is tried.
 *
 * Retrying one of these is pure cost: another decline on the issuer's record against us,
 * and no chance of the money. The card has to change, which is a person's job.
 */
const CARD_UNUSABLE = new Set([
  "expired_card",
  "card_not_supported",
  "resource_missing",
  "payment_method_unactivated",
  "payment_method_not_available",
]);

/**
 * When the automatic top-up fires, and when it must stop (ADR-0017).
 *
 * Pure, and the only place these rules live, so the worker that opens a charge and the
 * webhook that settles one cannot disagree about either. The order of the checks is the
 * order of what is cheapest to be wrong about: a disabled or suspended rule is settled
 * before anything is read about money, and the limits are checked before the balance
 * decides anything, because a balance that is below threshold is the case they exist for.
 */
export class AutoTopUpPolicy {
  decide(rule: AutoTopUpRule, position: AutoTopUpPosition): AutoTopUpDecision {
    if (!rule.enabled) return skip(AutoTopUpSkip.Disabled);
    if (rule.suspendedReason !== null) return skip(AutoTopUpSkip.Suspended);
    if (position.balanceCents >= rule.thresholdCents) return skip(AutoTopUpSkip.AboveThreshold);
    if (position.openCharge) return skip(AutoTopUpSkip.InFlight);
    if (!position.hasPaymentMethod) {
      return { kind: "suspend", reason: AutoTopUpSuspension.NoPaymentMethod };
    }
    if (position.attemptsInWindow >= rule.dailyLimit) return skip(AutoTopUpSkip.DailyLimit);

    if (rule.lastAttemptAt !== null) {
      const since = position.now.getTime() - rule.lastAttemptAt.getTime();
      if (rule.failures > 0 && since < this.backoffMs(rule.failures)) {
        return skip(AutoTopUpSkip.BackingOff);
      }
      if (since < AUTO_TOP_UP_MIN_SPACING_MS) return skip(AutoTopUpSkip.Spacing);
    }

    // A zero amount would be refused by the provider and a negative one cannot exist, but
    // the check constraint only binds an enabled rule's amount to its threshold, and a
    // threshold of zero never gets here.
    if (rule.amountCents <= 0) return skip(AutoTopUpSkip.Disabled);
    return { kind: "charge", amountCents: rule.amountCents };
  }

  /**
   * Whether a charge that did not succeed should stop the rule, and why.
   *
   * `failures` is the count including this one. A bank that wants the cardholder present
   * has nobody to ask off-session, and a card that is gone or expired will decline again;
   * neither improves with time. Anything else gets the benefit of the doubt until the
   * third in a row.
   */
  afterFailure(
    failures: number,
    state: TopUpState,
    failureCode: string | null,
  ): AutoTopUpSuspension | null {
    if (state === TopUpState.RequiresAction || failureCode === "authentication_required") {
      return AutoTopUpSuspension.AuthenticationRequired;
    }
    if (failureCode !== null && CARD_UNUSABLE.has(failureCode)) {
      return AutoTopUpSuspension.NoPaymentMethod;
    }
    if (failures >= AUTO_TOP_UP_MAX_FAILURES) return AutoTopUpSuspension.RepeatedFailure;
    return null;
  }

  /** One hour after the first failure, two after the second. */
  backoffMs(failures: number): number {
    return AUTO_TOP_UP_BACKOFF_MS * 2 ** Math.max(0, failures - 1);
  }
}

function skip(reason: AutoTopUpSkip): AutoTopUpDecision {
  return { kind: "skip", reason };
}
