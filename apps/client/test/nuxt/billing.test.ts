import { describe, expect, it } from "vitest";
import {
  AUTO_TOPUP_ISSUE_LABELS,
  type AutoTopUp,
  alertReached,
  autoTopUpEffect,
  type Balance,
  CHECKOUT_STATE_LABELS,
  CHECKOUT_STATE_NOTES,
  type CheckoutState,
  CREDIT_KIND_LABELS,
  CREDIT_KIND_NOTES,
  CREDIT_KIND_TONES,
  type CreditGrant,
  cardExpiryWords,
  cardLabel,
  defaultMethodOf,
  drawOrder,
  EXPIRY_SOON_DAYS,
  expiryWords,
  formatCents,
  type Invoice,
  isCardExpired,
  isCardExpiringSoon,
  isCheckoutPending,
  isGrantExpired,
  isGrantExpiringSoon,
  isPastDue,
  LOW_RUNWAY_DAYS,
  liveGrants,
  METHOD_REMOVAL_ISSUE_LABELS,
  MIN_TOPUP_CENTS,
  methodForAuto,
  methodRemovalIssue,
  outstandingCents,
  PAYMENTS,
  type PaymentCard,
  type PaymentMethod,
  paymentRepair,
  RUNWAY_HORIZON_DAYS,
  runwayDays,
  runwayTone,
  runwayWords,
  spendableCents,
  TOPUP_ISSUE_LABELS,
  topUpEveryDays,
  topUpEveryWords,
  validateAutoTopUp,
  validateTopUp,
  validateTopUpRequest,
  walletOf,
  withDefaultMethod,
  withMethod,
  withoutMethod,
  ZERO_KEEPS_WORKING,
  ZERO_STOPS,
} from "../../app/utils/billing";

const NOW = new Date("2026-09-20T12:00:00.000Z");

function balance(part: Partial<Balance> = {}): Balance {
  return {
    cents: 10_000,
    currency: "USD",
    spentThisMonthCents: 3000,
    projectedMonthCents: 6000,
    ...part,
  };
}

function card(part: Partial<PaymentCard> = {}): PaymentCard {
  return {
    brand: "visa",
    last4: "6411",
    expiryMonth: 12,
    expiryYear: 2029,
    addedBy: "Hasan Musluoglu",
    addedAt: "2026-03-14T10:20:00.000Z",
    ...part,
  };
}

function method(id: string, part: Partial<PaymentMethod> = {}): PaymentMethod {
  return { ...card(), id, isDefault: false, ...part };
}

function grant(part: Partial<CreditGrant> = {}): CreditGrant {
  return {
    id: "cg_1",
    kind: "purchased",
    amountCents: 10_000,
    remainingCents: 10_000,
    grantedAt: "2026-09-01T00:00:00.000Z",
    expiresAt: null,
    note: "Top-up",
    ...part,
  };
}

function invoice(part: Partial<Invoice> = {}): Invoice {
  return {
    id: "in_1",
    number: "IDZ-2026-0120",
    periodStart: "2026-08-01T00:00:00.000Z",
    periodEnd: "2026-09-01T00:00:00.000Z",
    issuedAt: "2026-09-02T00:00:00.000Z",
    totalCents: 4187,
    currency: "USD",
    status: "paid",
    pdfUri: null,
    ...part,
  };
}

/** Days from `NOW`, as an instant, for an expiry that has to land either side of a rule. */
function inDays(days: number): string {
  return new Date(NOW.getTime() + days * 86_400_000).toISOString();
}

describe("money", () => {
  it("takes cents and writes dollars, so nothing here is a float", () => {
    expect(formatCents(12_840)).toBe("$128.40");
    expect(formatCents(0)).toBe("$0.00");
    expect(formatCents(-500)).toBe("-$5.00");
  });
});

/*
 * Nothing charges anything, and the screen is built against that rather than around it.
 */
describe("whether a payment can happen at all", () => {
  it("says it cannot, and says why", () => {
    expect(PAYMENTS.running).toBe(false);
    expect(PAYMENTS.reason.length).toBeGreaterThan(0);
  });

  it("refuses a perfectly good request while no provider is connected", () => {
    const request = { amountCents: 5000, currency: "USD", methodId: "pm_1" };
    expect(validateTopUpRequest(request)).toBe(PAYMENTS.running ? null : "unavailable");
  });

  it("names what the reader can fix before what they cannot", () => {
    /* An amount they can correct, then a method they can add, and only then the
       integration they cannot do anything about. */
    expect(validateTopUpRequest({ amountCents: 5, currency: "USD", methodId: "pm_1" })).toBe(
      "amount_too_small",
    );
    expect(validateTopUpRequest({ amountCents: 5000, currency: "USD", methodId: null })).toBe(
      "no_method",
    );
  });

  it("has a sentence for every refusal", () => {
    for (const issue of [
      "amount_invalid",
      "amount_too_small",
      "no_method",
      "unavailable",
    ] as const) {
      expect(TOPUP_ISSUE_LABELS[issue].length).toBeGreaterThan(0);
    }
  });

  it("knows which checkout states are still in flight, so nothing is submitted twice", () => {
    expect(isCheckoutPending("processing")).toBe(true);
    expect(isCheckoutPending("requires_action")).toBe(true);
    expect(isCheckoutPending("confirmed")).toBe(false);
    expect(isCheckoutPending("failed")).toBe(false);
    expect(isCheckoutPending("cancelled")).toBe(false);
  });

  it("separates the states a charge can end in, rather than reporting one busy flag", () => {
    const states: CheckoutState[] = [
      "unavailable",
      "idle",
      "processing",
      "requires_action",
      "confirmed",
      "failed",
      "cancelled",
    ];
    for (const state of states) {
      expect(CHECKOUT_STATE_LABELS[state].length).toBeGreaterThan(0);
      expect(CHECKOUT_STATE_NOTES[state].length).toBeGreaterThan(0);
    }
    /* The two that mean nothing was taken have to say so, because that is the whole
       question a reader has after a charge that did not complete. */
    expect(CHECKOUT_STATE_NOTES.failed.toLowerCase()).toContain("unchanged");
    expect(CHECKOUT_STATE_NOTES.cancelled.toLowerCase()).toContain("unchanged");
  });
});

/*
 * The wallet: what the balance is made of, and the order it goes.
 */
describe("the wallet", () => {
  it("adds up what is spendable and splits it by kind", () => {
    const wallet = walletOf(
      [
        grant({ id: "a", kind: "purchased", remainingCents: 10_000 }),
        grant({ id: "b", kind: "promotional", remainingCents: 2500, expiresAt: inDays(30) }),
      ],
      NOW,
    );
    expect(wallet.totalCents).toBe(12_500);
    expect(wallet.purchasedCents).toBe(10_000);
    expect(wallet.promotionalCents).toBe(2500);
  });

  it("counts expired credit as nothing, whatever the column says is left on it", () => {
    const expired = grant({ kind: "promotional", remainingCents: 5000, expiresAt: inDays(-1) });
    expect(isGrantExpired(expired, NOW)).toBe(true);
    expect(spendableCents(expired, NOW)).toBe(0);
    expect(walletOf([expired], NOW).totalCents).toBe(0);
    expect(liveGrants([expired], NOW)).toEqual([]);
  });

  it("leaves a grant that has been spent to nothing off the list", () => {
    expect(liveGrants([grant({ remainingCents: 0 })], NOW)).toEqual([]);
  });

  it("never reports a negative remaining as credit", () => {
    expect(spendableCents(grant({ remainingCents: -400 }), NOW)).toBe(0);
  });

  /**
   * The rule the split exists for: promotional credit is spent before purchased, and the
   * soonest to expire before the rest. Drawn the other way round, a promotional grant
   * would expire unused while purchased credit paid the bill, and the customer would be
   * right to call that a charge they should not have had.
   */
  it("spends what would otherwise be lost first", () => {
    const order = drawOrder(
      [
        grant({ id: "purchased", kind: "purchased" }),
        grant({ id: "later", kind: "promotional", expiresAt: inDays(30) }),
        grant({ id: "sooner", kind: "promotional", expiresAt: inDays(3) }),
      ],
      NOW,
    );
    expect(order.map((entry) => entry.id)).toEqual(["sooner", "later", "purchased"]);
  });

  it("puts credit that never expires last among its own kind", () => {
    const order = drawOrder(
      [
        grant({ id: "forever", kind: "purchased", expiresAt: null }),
        grant({ id: "ends", kind: "purchased", expiresAt: inDays(10) }),
      ],
      NOW,
    );
    expect(order.map((entry) => entry.id)).toEqual(["ends", "forever"]);
  });

  it("warns about an expiry inside the fortnight and not beyond it", () => {
    const soon = grant({ kind: "promotional", expiresAt: inDays(EXPIRY_SOON_DAYS - 1) });
    const later = grant({ kind: "promotional", expiresAt: inDays(EXPIRY_SOON_DAYS + 5) });
    expect(isGrantExpiringSoon(soon, NOW)).toBe(true);
    expect(isGrantExpiringSoon(later, NOW)).toBe(false);
    expect(walletOf([soon, later], NOW).expiringSoonCents).toBe(soon.remainingCents);
  });

  it("never calls credit that has already gone expiring soon", () => {
    expect(isGrantExpiringSoon(grant({ expiresAt: inDays(-2) }), NOW)).toBe(false);
  });

  it("says nothing expires where nothing does", () => {
    expect(walletOf([grant({ expiresAt: null })], NOW).nextExpiryAt).toBeNull();
    expect(expiryWords(grant({ expiresAt: null }), NOW)).toBe("Does not expire");
  });

  it("names the next thing to expire", () => {
    const wallet = walletOf(
      [
        grant({ id: "a", kind: "promotional", expiresAt: inDays(20) }),
        grant({ id: "b", kind: "promotional", expiresAt: inDays(4) }),
      ],
      NOW,
    );
    expect(wallet.nextExpiryAt).toBe(inDays(4));
  });

  it("writes an expiry the way a reader asks for it", () => {
    expect(expiryWords(grant({ expiresAt: inDays(9) }), NOW)).toBe("Expires in 9 days");
    expect(expiryWords(grant({ expiresAt: inDays(1) }), NOW)).toBe("Expires in 1 day");
    expect(expiryWords(grant({ expiresAt: inDays(-1) }), NOW)).toBe("Expired");
  });

  it("has a label, a tone and a sentence for each kind", () => {
    for (const kind of ["purchased", "promotional"] as const) {
      expect(CREDIT_KIND_LABELS[kind].length).toBeGreaterThan(0);
      expect(CREDIT_KIND_TONES[kind].length).toBeGreaterThan(0);
      expect(CREDIT_KIND_NOTES[kind].length).toBeGreaterThan(0);
    }
    /* Promotional credit expiring is the fact this whole split exists to carry. */
    expect(CREDIT_KIND_NOTES.promotional.toLowerCase()).toContain("expire");
  });
});

describe("the runway", () => {
  it("divides what is left by what a day costs", () => {
    expect(runwayDays(balance({ cents: 6000, projectedMonthCents: 6000 }))).toBeCloseTo(30, 5);
    expect(runwayDays(balance({ cents: 3000, projectedMonthCents: 6000 }))).toBeCloseTo(15, 5);
  });

  it("has no end where nothing is being spent, rather than an invented worry", () => {
    expect(runwayDays(balance({ projectedMonthCents: 0 }))).toBe(Number.POSITIVE_INFINITY);
    expect(runwayWords(balance({ projectedMonthCents: 0 }))).toBe("Nothing is being spent");
    expect(runwayTone(balance({ projectedMonthCents: 0 }))).toBe("success");
  });

  it("warns inside a fortnight and calls a spent balance an error", () => {
    expect(runwayTone(balance({ cents: 6000, projectedMonthCents: 6000 }))).toBe("success");
    expect(runwayTone(balance({ cents: 1000, projectedMonthCents: 6000 }))).toBe("warning");
    expect(runwayDays(balance({ cents: 1000, projectedMonthCents: 6000 }))).toBeLessThan(
      LOW_RUNWAY_DAYS,
    );
    expect(runwayTone(balance({ cents: 0 }))).toBe("error");
    expect(runwayTone(balance({ cents: -400 }))).toBe("error");
  });

  it("writes what is left the way a reader asks for it", () => {
    expect(runwayWords(balance({ cents: 6000, projectedMonthCents: 6000 }))).toBe(
      "About 30 days left",
    );
    expect(runwayWords(balance({ cents: 100, projectedMonthCents: 6000 }))).toBe(
      "Under a day left",
    );
    expect(runwayWords(balance({ cents: 0 }))).toBe("The balance is spent");
  });

  it("stops counting days past a year, because nobody plans against four digits of them", () => {
    const far = balance({ cents: 128_40, projectedMonthCents: 120 });
    expect(runwayDays(far)).toBeGreaterThan(RUNWAY_HORIZON_DAYS);
    expect(runwayWords(far)).toBe("More than a year left");
    expect(runwayTone(far)).toBe("success");
  });
});

describe("what a zero balance does", () => {
  it("never stops a sign-in, and says which things it does stop", () => {
    expect(ZERO_KEEPS_WORKING.length).toBeGreaterThan(0);
    expect(ZERO_STOPS.length).toBeGreaterThan(0);
    for (const rule of [...ZERO_KEEPS_WORKING, ...ZERO_STOPS]) {
      expect(rule.what.length).toBeGreaterThan(0);
      expect(rule.why.length).toBeGreaterThan(0);
    }
    expect(ZERO_KEEPS_WORKING[0]?.what.toLowerCase()).toContain("sign-in");
  });
});

describe("topping up", () => {
  it("refuses an amount below the floor, where the fee is most of it", () => {
    expect(validateTopUp(MIN_TOPUP_CENTS)).toBeNull();
    expect(validateTopUp(MIN_TOPUP_CENTS - 1)).toBe("amount_too_small");
  });

  it("refuses anything that is not a whole number of cents", () => {
    expect(validateTopUp(0)).toBe("amount_invalid");
    expect(validateTopUp(-500)).toBe("amount_invalid");
    expect(validateTopUp(12.5)).toBe("amount_invalid");
    expect(validateTopUp(Number.NaN)).toBe("amount_invalid");
  });
});

describe("topping up automatically", () => {
  const setting = (part: Partial<AutoTopUp> = {}): AutoTopUp => ({
    enabled: true,
    thresholdCents: 5000,
    amountCents: 10_000,
    methodId: null,
    ...part,
  });

  it("says nothing about a setting that is switched off", () => {
    expect(validateAutoTopUp(setting({ enabled: false }), false)).toBeNull();
  });

  it("needs a method to charge", () => {
    expect(validateAutoTopUp(setting(), false)).toBe("no_card");
    expect(validateAutoTopUp(setting(), true)).toBeNull();
  });

  it("refuses a top-up smaller than the trigger, which would charge in a loop", () => {
    expect(validateAutoTopUp(setting({ amountCents: 4000 }), true)).toBe("amount_below_threshold");
    expect(validateAutoTopUp(setting({ amountCents: 5000 }), true)).toBeNull();
  });

  it("still applies the floor to the automatic amount", () => {
    expect(validateAutoTopUp(setting({ thresholdCents: 500, amountCents: 500 }), true)).toBe(
      "amount_too_small",
    );
  });

  it("has a sentence for each refusal", () => {
    for (const issue of [
      "no_card",
      "amount_below_threshold",
      "amount_too_small",
      "method_expired",
    ] as const) {
      expect(AUTO_TOPUP_ISSUE_LABELS[issue].length).toBeGreaterThan(0);
    }
  });

  /**
   * The case the note asks for by name: a threshold above the balance already held means
   * saving the rule is a charge rather than a safety net, and the dialog has to be able to
   * say so before the write.
   */
  it("knows when saving the rule would charge straight away", () => {
    const immediate = autoTopUpEffect(setting({ thresholdCents: 5000 }), 2000);
    expect(immediate.firesNow).toBe(true);
    expect(immediate.balanceAfterCents).toBe(12_000);

    const quiet = autoTopUpEffect(setting({ thresholdCents: 5000 }), 9000);
    expect(quiet.firesNow).toBe(false);
    expect(quiet.balanceAfterCents).toBe(9000);
  });

  it("fires nothing while the rule is off, whatever the balance is", () => {
    expect(autoTopUpEffect(setting({ enabled: false }), 0).firesNow).toBe(false);
  });

  it("charges the method it names, and the default only when it names none", () => {
    const methods = [method("pm_a", { isDefault: true }), method("pm_b")];
    expect(methodForAuto(setting({ methodId: "pm_b" }), methods)?.id).toBe("pm_b");
    expect(methodForAuto(setting({ methodId: null }), methods)?.id).toBe("pm_a");
    /* A rule pointing at a method that has gone charges nothing rather than falling back
       to whatever is now the default. */
    expect(methodForAuto(setting({ methodId: "pm_gone" }), methods)).toBeNull();
  });
});

describe("how often an automatic top-up would fire", () => {
  it("turns an amount into an interval at the month's rate", () => {
    expect(topUpEveryDays(10_000, 10_000)).toBeCloseTo(30, 5);
    expect(topUpEveryDays(5000, 10_000)).toBeCloseTo(15, 5);
  });

  it("has no interval where nothing is being spent", () => {
    expect(topUpEveryDays(10_000, 0)).toBe(Number.POSITIVE_INFINITY);
    expect(topUpEveryWords(10_000, 0)).toContain("would not fire");
  });

  it("says the two ends rather than a number nobody acts on", () => {
    expect(topUpEveryWords(100, 100_000)).toContain("more than once a day");
    expect(topUpEveryWords(500_000, 1000)).toContain("more than a year");
    expect(topUpEveryWords(10_000, 10_000)).toBe("About once every 30 days at this month's rate.");
  });
});

describe("the card", () => {
  it("shows a brand and four digits, which is all there is", () => {
    expect(cardLabel(card())).toBe("Visa ending 6411");
    expect(cardExpiryWords(card({ expiryMonth: 3, expiryYear: 2027 }))).toBe("03/27");
  });

  it("is expired once its month has passed", () => {
    expect(isCardExpired(card({ expiryMonth: 8, expiryYear: 2026 }), NOW)).toBe(true);
    expect(isCardExpired(card({ expiryMonth: 9, expiryYear: 2026 }), NOW)).toBe(false);
    expect(isCardExpired(card(), NOW)).toBe(false);
  });

  it("warns two months out, and never about one that has already gone", () => {
    expect(isCardExpiringSoon(card({ expiryMonth: 10, expiryYear: 2026 }), NOW)).toBe(true);
    expect(isCardExpiringSoon(card({ expiryMonth: 12, expiryYear: 2026 }), NOW)).toBe(false);
    expect(isCardExpiringSoon(card({ expiryMonth: 1, expiryYear: 2026 }), NOW)).toBe(false);
  });
});

/*
 * One default, always: it is the one an unattended charge uses.
 */
describe("which method is the default", () => {
  it("finds the one there is, and answers null for an account holding none", () => {
    expect(defaultMethodOf([method("a"), method("b", { isDefault: true })])?.id).toBe("b");
    expect(defaultMethodOf([method("a")])).toBeNull();
    expect(defaultMethodOf([])).toBeNull();
  });

  it("moves the default in one change, so there is never two and never none", () => {
    const next = withDefaultMethod([method("a", { isDefault: true }), method("b")], "b");
    expect(next.filter((entry) => entry.isDefault).map((entry) => entry.id)).toEqual(["b"]);
  });

  it("ignores a method that is not on the account rather than clearing the default", () => {
    const methods = [method("a", { isDefault: true }), method("b")];
    expect(withDefaultMethod(methods, "nobody")).toEqual(methods);
  });

  it("makes the first method the default, because an account of one has no other answer", () => {
    const next = withMethod([], method("a"));
    expect(next[0]?.isDefault).toBe(true);
  });

  it("moves the default when a new method arrives asking to be it", () => {
    const next = withMethod([method("a", { isDefault: true })], method("b", { isDefault: true }));
    expect(next.filter((entry) => entry.isDefault).map((entry) => entry.id)).toEqual(["b"]);
  });

  it("does not disturb the default when a second method arrives without asking", () => {
    const next = withMethod([method("a", { isDefault: true })], method("b"));
    expect(defaultMethodOf(next)?.id).toBe("a");
  });

  /* An account left holding methods and no default is one where an automatic top-up stops
     firing without anybody switching it off. */
  it("promotes another when the default is removed", () => {
    const next = withoutMethod([method("a", { isDefault: true }), method("b")], "a");
    expect(next.map((entry) => entry.id)).toEqual(["b"]);
    expect(next[0]?.isDefault).toBe(true);
  });

  it("leaves the default alone when something else is removed", () => {
    const next = withoutMethod([method("a", { isDefault: true }), method("b")], "b");
    expect(defaultMethodOf(next)?.id).toBe("a");
  });

  it("empties cleanly", () => {
    expect(withoutMethod([method("a", { isDefault: true })], "a")).toEqual([]);
  });

  it("refuses to strand an armed rule with nothing to charge", () => {
    const armed: AutoTopUp = {
      enabled: true,
      thresholdCents: 5000,
      amountCents: 10_000,
      methodId: null,
    };
    const off: AutoTopUp = { ...armed, enabled: false };
    expect(methodRemovalIssue([method("a", { isDefault: true })], "a", armed)).toBe(
      "last_method_with_auto",
    );
    expect(methodRemovalIssue([method("a", { isDefault: true })], "a", off)).toBeNull();
    /* With another method behind it there is something left to charge. */
    expect(
      methodRemovalIssue([method("a", { isDefault: true }), method("b")], "a", armed),
    ).toBeNull();
    expect(methodRemovalIssue([method("a")], "nobody", off)).toBe("not_found");
  });

  it("has a sentence for each refusal", () => {
    for (const issue of ["last_method_with_auto", "not_found"] as const) {
      expect(METHOD_REMOVAL_ISSUE_LABELS[issue].length).toBeGreaterThan(0);
    }
  });
});

describe("invoices", () => {
  it("counts what is open and past due, and nothing else", () => {
    const list = [
      invoice({ id: "a", status: "paid", totalCents: 5000 }),
      invoice({ id: "b", status: "open", totalCents: 4000 }),
      invoice({ id: "c", status: "past_due", totalCents: 3000 }),
      invoice({ id: "d", status: "void", totalCents: 9000 }),
    ];
    expect(outstandingCents(list)).toBe(7000);
    expect(outstandingCents([])).toBe(0);
  });

  it("knows a past-due one from an open one", () => {
    expect(isPastDue(invoice({ status: "past_due" }))).toBe(true);
    expect(isPastDue(invoice({ status: "open" }))).toBe(false);
  });

  /**
   * A failed payment takes the place of the runway rather than sitting beside it: an
   * estimate of how long the credit lasts, printed over an invoice nobody paid, is the
   * optimistic reading the note asks to remove.
   */
  it("names the repair where something is past due, and says nothing otherwise", () => {
    expect(paymentRepair([invoice({ status: "paid" })])).toBe("");
    expect(paymentRepair([])).toBe("");

    const one = paymentRepair([
      invoice({ number: "IDZ-202608-ACME", status: "past_due", totalCents: 4187 }),
    ]);
    expect(one).toContain("IDZ-202608-ACME");
    expect(one).toContain("$41.87");

    const two = paymentRepair([
      invoice({ id: "a", status: "past_due", totalCents: 1000 }),
      invoice({ id: "b", status: "past_due", totalCents: 2000 }),
    ]);
    expect(two).toContain("2 invoices");
    expect(two).toContain("$30.00");
  });
});

describe("the spend alert", () => {
  it("trips once the month passes the figure, and only while it is on", () => {
    expect(alertReached({ enabled: true, thresholdCents: 5000 }, 5000)).toBe(true);
    expect(alertReached({ enabled: true, thresholdCents: 5000 }, 4999)).toBe(false);
    expect(alertReached({ enabled: false, thresholdCents: 1 }, 9999)).toBe(false);
  });
});
