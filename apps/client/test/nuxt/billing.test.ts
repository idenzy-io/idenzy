import { describe, expect, it } from "vitest";
import {
  AUTO_TOPUP_ISSUE_LABELS,
  type AutoTopUp,
  alertReached,
  type Balance,
  cardExpiryWords,
  cardLabel,
  formatCents,
  type Invoice,
  isCardExpired,
  isCardExpiringSoon,
  isPastDue,
  LOW_RUNWAY_DAYS,
  MIN_TOPUP_CENTS,
  outstandingCents,
  type PaymentCard,
  RUNWAY_HORIZON_DAYS,
  runwayDays,
  runwayTone,
  runwayWords,
  TOPUP_ISSUE_LABELS,
  topUpEveryDays,
  topUpEveryWords,
  validateAutoTopUp,
  validateTopUp,
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

describe("money", () => {
  it("takes cents and writes dollars, so nothing here is a float", () => {
    expect(formatCents(12_840)).toBe("$128.40");
    expect(formatCents(0)).toBe("$0.00");
    expect(formatCents(-500)).toBe("-$5.00");
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

  it("has a sentence for each refusal", () => {
    for (const issue of ["amount_invalid", "amount_too_small"] as const) {
      expect(TOPUP_ISSUE_LABELS[issue].length).toBeGreaterThan(0);
    }
  });
});

describe("topping up automatically", () => {
  const setting = (part: Partial<AutoTopUp> = {}): AutoTopUp => ({
    enabled: true,
    thresholdCents: 5000,
    amountCents: 10_000,
    ...part,
  });

  it("says nothing about a setting that is switched off", () => {
    expect(validateAutoTopUp(setting({ enabled: false }), false)).toBeNull();
  });

  it("needs a card to charge", () => {
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
    for (const issue of ["no_card", "amount_below_threshold", "amount_too_small"] as const) {
      expect(AUTO_TOPUP_ISSUE_LABELS[issue].length).toBeGreaterThan(0);
    }
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
});

describe("the spend alert", () => {
  it("trips once the month passes the figure, and only while it is on", () => {
    expect(alertReached({ enabled: true, thresholdCents: 5000 }, 5000)).toBe(true);
    expect(alertReached({ enabled: true, thresholdCents: 5000 }, 4999)).toBe(false);
    expect(alertReached({ enabled: false, thresholdCents: 1 }, 9999)).toBe(false);
  });
});
