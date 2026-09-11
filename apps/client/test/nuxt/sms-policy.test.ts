import { describe, expect, it } from "vitest";
import {
  allCountries,
  canSendSms,
  capChange,
  capShare,
  evaluateReadiness,
  formatMoney,
  nextUtcReset,
  SMS_BLOCKERS,
  SMS_CHECK_ORDER,
  SMS_GUARD_CONSTANTS,
  SMS_POLICY_BOUNDS,
  SMS_POLICY_DEFAULTS,
  type SmsPolicy,
  smsBlockers,
  smsReadiness,
  untilReset,
} from "../../app/utils/sms-policy";

function policy(change: Partial<SmsPolicy> = {}): SmsPolicy {
  return {
    ...SMS_POLICY_DEFAULTS,
    allowedCountries: ["GB"],
    senderId: null,
    ...change,
  };
}

describe("the column defaults", () => {
  it("starts closed, which is the whole design of the allowlist", () => {
    expect(policy({ allowedCountries: [] }).allowedCountries).toEqual([]);
    expect(canSendSms(policy({ allowedCountries: [] }))).toBe(false);
    expect(canSendSms(null)).toBe(false);
  });

  it("requires attestation out of the box, so a project opts into the risk", () => {
    expect(SMS_POLICY_DEFAULTS.attestationRequired).toBe(true);
  });

  it("offers every default inside the bounds a control will accept", () => {
    expect(SMS_POLICY_DEFAULTS.dailySpendCap).toBeGreaterThanOrEqual(
      SMS_POLICY_BOUNDS.dailySpendCap.min,
    );
    expect(SMS_POLICY_DEFAULTS.perNumberDailyLimit).toBeLessThanOrEqual(
      SMS_POLICY_BOUNDS.perNumberDailyLimit.max,
    );
    expect(SMS_POLICY_DEFAULTS.perIpHourlyLimit).toBeLessThanOrEqual(
      SMS_POLICY_BOUNDS.perIpHourlyLimit.max,
    );
    expect(SMS_POLICY_DEFAULTS.maxSendsPerVerify).toBeGreaterThanOrEqual(
      SMS_POLICY_BOUNDS.maxSendsPerVerify.min,
    );
  });
});

/*
 * The verdict is the page. A project can be stopped by more than one thing at once, and
 * one of the four is the deployment's rather than the project's, so a boolean would hide
 * exactly the case the screen exists to surface.
 */
describe("evaluateReadiness", () => {
  it("stops a project with no policy row at all", () => {
    expect(evaluateReadiness(null, 0, true)).toEqual({ blockers: ["no_policy"], sendable: false });
  });

  it("reads an empty allowlist as the same no", () => {
    const { blockers, sendable } = evaluateReadiness(policy({ allowedCountries: [] }), 0, true);
    expect(blockers).toEqual(["no_countries"]);
    expect(sendable).toBe(false);
  });

  /* The case every project is in today: settings are fine and nothing can answer. */
  it("stops a correctly configured project when nothing can satisfy attestation", () => {
    const { blockers, sendable } = evaluateReadiness(policy(), 0, false);
    expect(blockers).toEqual(["attestation_unsatisfiable"]);
    expect(sendable).toBe(false);
  });

  it("lets that project through once it stops requiring what cannot be answered", () => {
    expect(evaluateReadiness(policy({ attestationRequired: false }), 0, false).sendable).toBe(true);
  });

  it("stops a project that has spent its cap, and treats reaching it as reaching it", () => {
    expect(evaluateReadiness(policy(), 2, true).blockers).toEqual(["cap_reached"]);
    expect(evaluateReadiness(policy(), 1.999999, true).sendable).toBe(true);
  });

  it("reports every reason rather than the first, since fixing one may fix nothing", () => {
    const { blockers } = evaluateReadiness(
      policy({ allowedCountries: [], dailySpendCap: 2 }),
      5,
      false,
    );
    expect(blockers).toEqual(["no_countries", "attestation_unsatisfiable", "cap_reached"]);
  });

  it("says nothing about a cap for a project that has no row to hold one", () => {
    expect(evaluateReadiness(null, 999, false).blockers).toEqual(["no_policy"]);
  });

  it("names an error code for every blocker, so a refusal in a log can be matched", () => {
    for (const blocker of Object.values(SMS_BLOCKERS)) {
      expect(blocker.errorCode.length).toBeGreaterThan(0);
      expect(blocker.detail.length).toBeGreaterThan(0);
    }
  });
});

/*
 * The order is the design and not a sequence, and the property worth pinning is the one
 * the guard's own comments call out: a check that writes must never run for a request
 * that is already refused.
 */
describe("SMS_CHECK_ORDER", () => {
  it("runs everything that writes after everything that does not", () => {
    const firstWrite = SMS_CHECK_ORDER.findIndex((check) => check.writes);
    const lastRead = SMS_CHECK_ORDER.map((check) => check.writes).lastIndexOf(false);
    /* The ratio check reads counters already loaded, so it is the one non-writing check
       that may sit among them; nothing that writes may precede attestation. */
    const attestation = SMS_CHECK_ORDER.findIndex((check) => check.id === "attestation");
    expect(attestation).toBeLessThan(firstWrite);
    expect(lastRead).toBeGreaterThan(-1);
  });

  it("places the number first, because it is free and settles two refusals", () => {
    expect(SMS_CHECK_ORDER[0]?.id).toBe("place");
    expect(SMS_CHECK_ORDER[0]?.writes).toBe(false);
  });

  it("checks the spend last, since it is the only one whose failure is an invoice", () => {
    expect(SMS_CHECK_ORDER[SMS_CHECK_ORDER.length - 1]?.id).toBe("spend");
  });

  it("names each check once, with a code and a reason", () => {
    const ids = SMS_CHECK_ORDER.map((check) => check.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const check of SMS_CHECK_ORDER) {
      expect(check.errorCode.length).toBeGreaterThan(0);
      expect(check.detail.length).toBeGreaterThan(0);
    }
  });

  it("marks the two checks a project decides nothing about", () => {
    const ours = SMS_CHECK_ORDER.filter((check) => !check.configurable).map((check) => check.id);
    expect(ours).toEqual(["premium", "sweep"]);
  });
});

describe("capShare", () => {
  it("reports how much of the day is gone", () => {
    expect(capShare(0, 10)).toBe(0);
    expect(capShare(5, 10)).toBe(0.5);
    expect(capShare(10, 10)).toBe(1);
  });

  it("clamps rather than reporting a bar past its own end", () => {
    expect(capShare(25, 10)).toBe(1);
    expect(capShare(-1, 10)).toBe(0);
  });

  it("treats a cap of nothing as spent, which is what a cap of nothing means", () => {
    expect(capShare(0, 0)).toBe(1);
  });
});

describe("formatMoney", () => {
  it("writes a cap and a spend the same way, to two places", () => {
    expect(formatMoney(2, "USD")).toBe("$2.00");
    expect(formatMoney(6.42, "USD")).toBe("$6.42");
  });

  it("follows the project's currency rather than assuming one", () => {
    expect(formatMoney(25, "EUR")).toContain("25.00");
    expect(formatMoney(25, "EUR")).not.toContain("$");
  });
});

describe("allCountries", () => {
  const listed = allCountries((code) => code);

  it("offers alpha-2 codes and nothing else, since that is what the column holds", () => {
    for (const country of listed) expect(country.code).toMatch(/^[A-Z]{2}$/);
  });

  it("names each country once", () => {
    const codes = listed.map((country) => country.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("covers the markets the placeholder policy allows", () => {
    const codes = new Set(listed.map((country) => country.code));
    for (const code of ["US", "CA", "GB", "DE", "NL", "TR"]) expect(codes.has(code)).toBe(true);
  });

  it("sorts by the name a reader sees rather than by the code", () => {
    const byName = allCountries((code) => (code === "ZW" ? "Aardvark" : code));
    expect(byName[0]?.code).toBe("ZW");
  });
});

describe("SMS_GUARD_CONSTANTS", () => {
  it("keeps the ratio floor above the noise a couple of sends would make", () => {
    expect(SMS_GUARD_CONSTANTS.ratioFloor).toBeGreaterThan(2);
  });

  it("holds the two values a project cannot move", () => {
    expect(SMS_GUARD_CONSTANTS.blockBurstLimit).toBe(10);
    expect(SMS_GUARD_CONSTANTS.blockWindowSeconds).toBe(3600);
  });
});

describe("smsReadiness", () => {
  function input(change: Partial<Parameters<typeof smsReadiness>[0]> = {}) {
    return {
      methodEnabled: true,
      delivery: { ready: true, label: "Sent through our own routing" },
      policy: policy(),
      spentToday: 0,
      attestationWired: true,
      balanceCents: 10_000,
      ...change,
    };
  }

  it("answers the five things the note names, in its order", () => {
    expect(smsReadiness(input()).map((check) => check.id)).toEqual([
      "method",
      "vendor",
      "countries",
      "attestation",
      "funding",
    ]);
  });

  it("is ready only when every one of them is", () => {
    expect(smsBlockers(smsReadiness(input()))).toEqual([]);
  });

  it("refuses to read as ready while the method is off, whatever the policy says", () => {
    const blocked = smsBlockers(smsReadiness(input({ methodEnabled: false })));
    expect(blocked.map((check) => check.id)).toEqual(["method"]);
  });

  it("refuses to read as ready while no carrier can be reached", () => {
    const blocked = smsBlockers(
      smsReadiness(input({ delivery: { ready: false, label: "Nothing wired" } })),
    );
    expect(blocked.map((check) => check.id)).toEqual(["vendor"]);
  });

  it("blocks a required human check nothing can answer, which is the silent one", () => {
    const blocked = smsBlockers(smsReadiness(input({ attestationWired: false })));
    expect(blocked.map((check) => check.id)).toEqual(["attestation"]);
  });

  it("calls an unrequired human check worth a look rather than passing", () => {
    const checks = smsReadiness(
      input({ policy: policy({ attestationRequired: false }), attestationWired: false }),
    );
    expect(checks.find((check) => check.id === "attestation")?.state).toBe("warn");
  });

  it("blocks an empty allowlist and a missing policy alike", () => {
    for (const held of [null, policy({ allowedCountries: [] })]) {
      const blocked = smsBlockers(smsReadiness(input({ policy: held })));
      expect(blocked.map((check) => check.id)).toContain("countries");
    }
  });

  it("warns where the balance runs out before the cap does", () => {
    const checks = smsReadiness(
      input({ policy: policy({ dailySpendCap: 50 }), balanceCents: 900 }),
    );
    expect(checks.find((check) => check.id === "funding")?.state).toBe("warn");
  });

  it("blocks a balance of nought, which refuses before the cap is even read", () => {
    const blocked = smsBlockers(smsReadiness(input({ balanceCents: 0 })));
    expect(blocked.map((check) => check.id)).toEqual(["funding"]);
  });

  it("names the screen every check that is not settled here is settled on", () => {
    const checks = smsReadiness(input());
    const elsewhere = checks.filter((check) => check.fix !== undefined);
    expect(elsewhere.map((check) => check.fix?.to)).toEqual([
      "/methods/otp?channel=sms",
      "/sms/providers",
      "/billing",
    ]);
  });
});

describe("capChange", () => {
  it("states what is left today before and after", () => {
    const change = capChange(6.42, 25, 12);
    expect(change.remainingNow).toBeCloseTo(18.58);
    expect(change.remainingNext).toBeCloseTo(5.58);
    expect(change.stopsNow).toBe(false);
  });

  it("says a cap at or below the day's spend stops sending immediately", () => {
    expect(capChange(6.42, 25, 3).stopsNow).toBe(true);
    expect(capChange(6.42, 25, 6).stopsNow).toBe(true);
    expect(capChange(6.42, 25, 7).stopsNow).toBe(false);
  });

  it("never reports a negative allowance, which is not a thing a day can hold", () => {
    expect(capChange(30, 25, 1).remainingNow).toBe(0);
    expect(capChange(30, 25, 1).remainingNext).toBe(0);
  });

  it("knows the cap in force from a typed one", () => {
    expect(capChange(0, 25, 25).unchanged).toBe(true);
    expect(capChange(0, 25, 26).unchanged).toBe(false);
  });
});

describe("the UTC day", () => {
  it("resets at the next midnight UTC and not at a local one", () => {
    const at = nextUtcReset(new Date("2026-09-11T22:30:00.000Z"));
    expect(at.toISOString()).toBe("2026-09-12T00:00:00.000Z");
  });

  it("rolls over the month rather than landing on a day that is not one", () => {
    const at = nextUtcReset(new Date("2026-09-30T23:59:00.000Z"));
    expect(at.toISOString()).toBe("2026-10-01T00:00:00.000Z");
  });

  it("says how long is left in the words a strip has room for", () => {
    expect(untilReset(new Date("2026-09-11T23:30:00.000Z"))).toBe("in 30 minutes");
    expect(untilReset(new Date("2026-09-11T22:00:00.000Z"))).toBe("in 2 hours");
    expect(untilReset(new Date("2026-09-11T23:00:00.000Z"))).toBe("in an hour");
  });
});
