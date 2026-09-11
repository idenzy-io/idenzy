import { describe, expect, it } from "vitest";
import {
  type Bill,
  billableMau,
  billFor,
  CHART_METERS,
  emailCents,
  FREE_MAU,
  type LineId,
  latest,
  MAU_DEFINITION,
  MAU_EXAMPLES,
  mauCents,
  monthBefore,
  periodAt,
  periodProgress,
  periodSpan,
  projectBill,
  projectTotals,
  quantityWords,
  sum,
  totalsOf,
  type UsagePeriod,
  usageCsv,
  usageWindow,
  usageWindows,
  windowLabel,
} from "../../app/utils/usage";

const DAY = 86_400_000;

function days(count: number, from = "2026-09-01T00:00:00.000Z"): string[] {
  return Array.from({ length: count }, (_, index) =>
    new Date(Date.parse(from) + index * DAY).toISOString(),
  );
}

function zeros(count: number): number[] {
  return Array.from({ length: count }, () => 0);
}

function period(part: Partial<UsagePeriod> = {}): UsagePeriod {
  return {
    id: "2026-09",
    start: "2026-09-01T00:00:00.000Z",
    end: "2026-10-01T00:00:00.000Z",
    closed: false,
    days: days(2),
    mau: [400, 900],
    emails: [100, 150],
    smsMessages: [10, 20],
    smsSegments: [12, 22],
    smsCostCents: [25, 46],
    customDomains: 0,
    ownDomain: false,
    byoEmail: false,
    smsVendor: null,
    ...part,
  };
}

function lineOf(bill: Bill, id: LineId) {
  return bill.lines.find((line) => line.id === id);
}

describe("the allowance", () => {
  it("charges nothing up to it and a quarter cent a user past it", () => {
    expect(billableMau(FREE_MAU)).toBe(0);
    expect(mauCents(FREE_MAU)).toBe(0);
    expect(mauCents(FREE_MAU + 1000)).toBe(250);
  });

  it("rounds a half cent up and a quarter cent down", () => {
    expect(mauCents(FREE_MAU + 2)).toBe(1);
    expect(mauCents(FREE_MAU + 1)).toBe(0);
  });
});

describe("what a channel costs", () => {
  it("prices email at the rate the sending-domains screen publishes", () => {
    expect(emailCents(10_000, false, false)).toBe(500);
    expect(emailCents(10_000, true, false)).toBe(400);
    expect(emailCents(10, false, false)).toBe(1);
  });

  it("charges nothing for mail through the customer's own provider", () => {
    expect(emailCents(10_000, false, true)).toBe(0);
  });
});

describe("the definition of an active user", () => {
  it("is one rule, per project, with the sign-up day as the only day that does not count", () => {
    expect(MAU_DEFINITION).toContain("other than the day their account was created");
    expect(MAU_DEFINITION).toContain("Counted per project");
  });

  it("explains the bill for somebody who only signs in on sign-up day", () => {
    expect(MAU_EXAMPLES[0]).toMatch(/never comes back: not counted/);
  });
});

describe("the bill", () => {
  it("keeps every line, including the ones that come to nothing", () => {
    const { lines } = billFor(period());
    expect(lines.map((line) => line.id)).toEqual(["mau", "email", "sms", "logging", "security"]);
  });

  it("adds a line for the customer's own sending domains after email", () => {
    const bill = billFor(period({ customDomains: 2, ownDomain: true }));
    expect(bill.lines.map((line) => line.id)).toEqual([
      "mau",
      "email",
      "domains",
      "sms",
      "logging",
      "security",
    ]);
    expect(lineOf(bill, "domains")?.cents).toBe(1000);
  });

  it("totals the rounded lines, so the total is never a cent off their sum", () => {
    const { lines, totalCents } = billFor(
      period({ mau: [FREE_MAU + 2], emails: [10], customDomains: 1 }),
    );
    expect(totalCents).toBe(sum(lines.map((line) => line.cents ?? 0)));
    expect(totalCents).toBe(1 + 1 + 500 + 71);
  });

  it("tells four kinds of nothing apart", () => {
    const quiet = billFor(
      period({ smsMessages: zeros(2), smsSegments: zeros(2), smsCostCents: zeros(2) }),
    );
    expect(lineOf(quiet, "mau")?.state).toBe("allowance");
    expect(lineOf(quiet, "sms")?.state).toBe("no_usage");
    expect(lineOf(quiet, "logging")?.state).toBe("unmetered");
    expect(lineOf(billFor(period({ smsVendor: "twilio" })), "sms")?.state).toBe("vendor");
  });

  it("names the vendor that bills a line Idenzy charges nothing for", () => {
    const line = lineOf(billFor(period({ smsVendor: "twilio" })), "sms");
    expect(line?.cents).toBe(0);
    expect(line?.owner).toBe("Your Twilio account");
    expect(line?.note).toBe("Charged by Idenzy. Twilio bills you separately.");
  });

  it("charges what the routing table priced each segment at, and counts segments", () => {
    const line = lineOf(billFor(period()), "sms");
    expect(line?.cents).toBe(71);
    expect(line && quantityWords(line)).toBe("34 segments");
    expect(line?.detail).toBe("30 messages");
  });

  it("carries logging as unmetered rather than as a zero", () => {
    const line = lineOf(billFor(period()), "logging");
    expect(line?.cents).toBeNull();
    expect(line && quantityWords(line)).toBe("Not metered");
  });

  it("keeps the included security features visible at no charge", () => {
    const line = lineOf(billFor(period()), "security");
    expect(line?.cents).toBe(0);
    expect(line && quantityWords(line)).toBe("Included");
  });
});

describe("where the month lands", () => {
  /* Ten days of September, the tenth half over: 100 emails and 1,000 new active users a
     complete day. */
  const month = period({
    days: days(10),
    mau: [1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000, 9000, 9500],
    emails: [100, 100, 100, 100, 100, 100, 100, 100, 100, 50],
    smsMessages: zeros(10),
    smsSegments: zeros(10),
    smsCostCents: zeros(10),
    customDomains: 1,
    ownDomain: true,
  });
  const asOf = new Date("2026-09-10T12:00:00.000Z");

  it("continues each meter at its last complete week's average", () => {
    const totals = projectTotals(month, asOf);
    expect(totals.emails).toBe(950 + 100 * 20.5);
    expect(totals.mau).toBe(9500 + 1000 * 20.5);
  });

  it("projects per line, so a domain is not scaled and a counter is", () => {
    const actual = billFor(month);
    const projected = projectBill(month, asOf);
    expect(lineOf(projected, "domains")?.cents).toBe(500);
    expect(lineOf(projected, "email")?.cents).toBe(120);
    expect(lineOf(actual, "email")?.cents).toBe(38);
  });

  it("charges projected users past the allowance while the actual line is inside it", () => {
    const busy = period({ ...month, mau: month.mau.map((value) => value * 3) });
    expect(lineOf(billFor(busy), "mau")?.state).toBe("allowance");
    expect(lineOf(projectBill(busy, asOf), "mau")?.state).toBe("charged");
  });

  it("leaves a closed month where it is", () => {
    const closed = period({ closed: true });
    expect(projectTotals(closed, asOf)).toEqual(totalsOf(closed));
  });

  it("reads the progress off the period rather than off the data", () => {
    expect(periodProgress(period(), new Date("2026-09-16T00:00:00.000Z"))).toBeCloseTo(0.5, 2);
    expect(periodProgress(period(), new Date("2026-11-01T00:00:00.000Z"))).toBe(1);
  });
});

describe("the month before", () => {
  it("is the same instant a calendar month earlier, clamped to the shorter month", () => {
    expect(monthBefore(new Date("2026-09-11T14:00:00.000Z")).toISOString()).toBe(
      "2026-08-11T14:00:00.000Z",
    );
    expect(monthBefore(new Date("2026-03-31T09:00:00.000Z")).toISOString()).toBe(
      "2026-02-28T09:00:00.000Z",
    );
    expect(monthBefore(new Date("2026-01-15T00:00:00.000Z")).toISOString()).toBe(
      "2025-12-15T00:00:00.000Z",
    );
  });

  it("is cut at the same point, the last day pro rata", () => {
    const august = period({
      id: "2026-08",
      start: "2026-08-01T00:00:00.000Z",
      end: "2026-09-01T00:00:00.000Z",
      closed: true,
      days: days(31, "2026-08-01T00:00:00.000Z"),
      mau: Array.from({ length: 31 }, (_, index) => (index + 1) * 100),
      emails: Array.from({ length: 31 }, () => 100),
      smsMessages: zeros(31),
      smsSegments: zeros(31),
      smsCostCents: zeros(31),
    });
    const point = periodAt(august, new Date("2026-08-11T12:00:00.000Z"));
    expect(sum(point.emails)).toBe(1050);
    expect(latest(point.mau)).toBe(1050);
  });
});

describe("the activity windows", () => {
  const anchor = new Date("2026-09-11T14:00:00.000Z");

  it("ends on the bucket the figures run into", () => {
    const week = usageWindow("7d", anchor);
    expect(week.granularity).toBe("day");
    expect(week.buckets).toHaveLength(7);
    expect(new Date(week.buckets.at(-1) ?? 0).toISOString()).toBe("2026-09-11T00:00:00.000Z");

    const day = usageWindow("1d", anchor);
    expect(day.buckets).toHaveLength(24);
    expect(new Date(day.buckets.at(-1) ?? 0).toISOString()).toBe("2026-09-11T13:00:00.000Z");
  });

  it("compares with the same dates a month before, not the window before", () => {
    const { previous } = usageWindows("7d", anchor);
    expect(new Date(previous.buckets.at(-1) ?? 0).toISOString()).toBe("2026-08-11T00:00:00.000Z");
  });

  it("names a window by its dates", () => {
    expect(windowLabel(usageWindow("7d", anchor))).toBe("Sep 5 to 11");
    expect(windowLabel(usageWindow("30d", anchor))).toBe("Aug 13 to Sep 11");
    expect(windowLabel(usageWindow("1d", anchor))).toBe("24 hours to Sep 11, 14:00");
  });

  it("draws no line for a meter that is not metered", () => {
    expect(CHART_METERS.map((entry) => entry.id)).toEqual(["mau", "emails", "sms"]);
  });
});

describe("naming a period", () => {
  it("writes the last day rather than the exclusive end", () => {
    expect(periodSpan(period())).toBe("Sep 1 to Sep 30, 2026");
  });
});

describe("the export", () => {
  function input(part: Partial<UsagePeriod> = {}) {
    const month = period(part);
    return {
      period: month,
      projectId: "prj_acme",
      projectName: "Acme, Inc.",
      actual: billFor(month),
      projected: projectBill(month, new Date("2026-09-02T12:00:00.000Z")),
      updatedAt: "2026-09-02T12:00:00.000Z",
    };
  }

  it("carries the period, the currency and whether each figure is actual or estimated", () => {
    const [header, ...rows] = usageCsv(input()).split("\n");
    expect(header).toContain("basis");
    expect(header).toContain("currency");
    expect(rows.some((row) => row.includes(",actual,"))).toBe(true);
    expect(rows.some((row) => row.includes(",estimated,"))).toBe(true);
    expect(rows.every((row) => row.startsWith("2026-09,") && row.includes(",USD,"))).toBe(true);
  });

  it("marks a closed month final and estimates nothing", () => {
    const rows = usageCsv(input({ closed: true }))
      .split("\n")
      .slice(1);
    expect(rows.every((row) => row.includes(",final,"))).toBe(true);
  });

  it("quotes a project name with a comma in it", () => {
    expect(usageCsv(input())).toContain('"Acme, Inc."');
  });

  it("totals the same cents the screen shows", () => {
    const data = input();
    const total = usageCsv(data)
      .split("\n")
      .find((row) => row.includes(",actual,Total,"));
    expect(total).toContain(`,${(data.actual.totalCents / 100).toFixed(2)},`);
  });
});
