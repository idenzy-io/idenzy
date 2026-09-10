import { describe, expect, it } from "vitest";
import { CUSTOM_DOMAIN_MONTHLY } from "../../app/utils/sending-domains";
import {
  billableMau,
  billFor,
  emailCost,
  FREE_MAU,
  formatBytes,
  freeTierShare,
  GIGABYTE,
  LOGGING_PRICE_PER_GB,
  latest,
  loggingCost,
  MAU_PRICE,
  METERS,
  mauCost,
  meter,
  periodProgress,
  projectedTotal,
  seriesFor,
  sum,
  totalFor,
  type UsagePeriod,
} from "../../app/utils/usage";

const NOW = new Date("2026-09-16T00:00:00.000Z");

function period(part: Partial<UsagePeriod> = {}): UsagePeriod {
  return {
    start: "2026-09-01T00:00:00.000Z",
    end: "2026-10-01T00:00:00.000Z",
    days: ["2026-09-01T00:00:00.000Z", "2026-09-02T00:00:00.000Z"],
    mau: [400, 900],
    emails: [100, 150],
    sms: [10, 20],
    smsCost: [0.2, 0.4],
    logBytes: [0, 0],
    customDomains: 0,
    byoEmail: false,
    byoSms: false,
    ...part,
  };
}

describe("the free tier", () => {
  it("charges nothing up to the tier and only for the users past it", () => {
    expect(billableMau(FREE_MAU)).toBe(0);
    expect(mauCost(FREE_MAU)).toBe(0);
    expect(billableMau(FREE_MAU + 1000)).toBe(1000);
    expect(mauCost(FREE_MAU + 1000)).toBeCloseTo(1000 * MAU_PRICE, 10);
  });

  it("never reports a negative share or one past full", () => {
    expect(freeTierShare(0)).toBe(0);
    expect(freeTierShare(FREE_MAU / 2)).toBe(0.5);
    expect(freeTierShare(FREE_MAU * 3)).toBe(1);
  });
});

describe("what a channel costs", () => {
  it("prices email at the rate the sending-domains screen publishes", () => {
    expect(emailCost(10_000, false, false)).toBeCloseTo(5, 10);
    expect(emailCost(10_000, true, false)).toBeCloseTo(4, 10);
  });

  it("charges nothing for a channel somebody brought their own vendor for", () => {
    expect(emailCost(10_000, false, true)).toBe(0);
  });

  it("prices logging by the gigabyte ingested", () => {
    expect(loggingCost(GIGABYTE)).toBeCloseTo(LOGGING_PRICE_PER_GB, 10);
    expect(loggingCost(0)).toBe(0);
    expect(loggingCost(GIGABYTE / 2)).toBeCloseTo(LOGGING_PRICE_PER_GB / 2, 10);
  });
});

describe("the meters", () => {
  it("names each one once and says what it counts", () => {
    expect(new Set(METERS.map((entry) => entry.id)).size).toBe(METERS.length);
    for (const entry of METERS) expect(entry.note.length).toBeGreaterThan(0);
  });

  it("treats active users as a level and everything else as a running total", () => {
    expect(meter("mau").cumulative).toBe(false);
    expect(meter("email").cumulative).toBe(true);
    expect(meter("logging").cumulative).toBe(true);
  });

  it("marks logging as not yet a published price", () => {
    expect(meter("logging").provisional).toBe(true);
    expect(meter("email").provisional).toBeUndefined();
  });

  it("reads a level off the last day and a counter off the whole month", () => {
    const month = period();
    expect(totalFor(month, "mau")).toBe(900);
    expect(totalFor(month, "email")).toBe(250);
    expect(totalFor(month, "sms")).toBe(30);
    expect(seriesFor(month, "email")).toEqual([100, 150]);
  });

  it("sums and reads the last of an empty month without inventing one", () => {
    expect(sum([])).toBe(0);
    expect(latest([])).toBe(0);
  });
});

describe("the bill", () => {
  it("keeps a line that comes to nothing, because counted and free is not uncounted", () => {
    const { lines, total } = billFor(period());
    expect(lines.map((line) => line.id)).toEqual(["mau", "email", "sms", "logging"]);
    expect(lines[0]?.free).toBe(true);
    expect(total).toBeCloseTo(emailCost(250, false, false) + 0.6, 10);
  });

  it("charges for the users past the tier and says how many they are", () => {
    const { lines } = billFor(period({ mau: [FREE_MAU + 12_400] }));
    expect(lines[0]?.free).toBeUndefined();
    expect(lines[0]?.quantity).toContain("12,400");
    expect(lines[0]?.amount).toBeCloseTo(12_400 * MAU_PRICE, 10);
  });

  it("adds a line per sending domain of the customer's own", () => {
    const { lines } = billFor(period({ customDomains: 2 }));
    const domains = lines.find((line) => line.id === "domains");
    expect(domains?.amount).toBeCloseTo(2 * CUSTOM_DOMAIN_MONTHLY, 10);
  });

  it("uses the lower email rate once a domain of their own is verified", () => {
    const shared = billFor(period()).lines.find((line) => line.id === "email");
    const own = billFor(period({ customDomains: 1 })).lines.find((line) => line.id === "email");
    expect(own?.amount).toBeLessThan(shared?.amount ?? 0);
  });

  it("charges nothing for SMS on somebody's own account and says so", () => {
    const line = billFor(period({ byoSms: true })).lines.find((entry) => entry.id === "sms");
    expect(line?.amount).toBe(0);
    expect(line?.free).toBe(true);
  });

  it("carries logging as a line that is metered and not billed", () => {
    const line = billFor(period({ logBytes: [GIGABYTE, GIGABYTE] })).lines.find(
      (entry) => entry.id === "logging",
    );
    expect(line?.provisional).toBe(true);
    expect(line?.amount).toBe(0);
    expect(line?.quantity).toBe("2 GB");
  });

  it("totals exactly what the lines add up to", () => {
    const { lines, total } = billFor(period({ mau: [FREE_MAU + 1000], customDomains: 1 }));
    expect(total).toBeCloseTo(
      lines.reduce((running, line) => running + line.amount, 0),
      10,
    );
  });
});

describe("where the month lands", () => {
  it("reads the progress off the period rather than off the data", () => {
    expect(periodProgress(period(), NOW)).toBeCloseTo(0.5, 2);
    expect(periodProgress(period(), new Date("2026-08-01T00:00:00.000Z"))).toBe(0);
    expect(periodProgress(period(), new Date("2026-11-01T00:00:00.000Z"))).toBe(1);
  });

  it("projects in a straight line and never divides by nothing", () => {
    expect(projectedTotal(10, 0.5)).toBeCloseTo(20, 10);
    expect(projectedTotal(10, 1)).toBeCloseTo(10, 10);
    expect(projectedTotal(10, 0)).toBe(10);
  });
});

describe("writing a size", () => {
  it("uses the unit an operating system would", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(GIGABYTE)).toBe("1 GB");
    expect(formatBytes(1536 * 1024 * 1024)).toBe("1.5 GB");
  });
});
