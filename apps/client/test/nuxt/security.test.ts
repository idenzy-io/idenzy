import { describe, expect, it } from "vitest";
import {
  DEFAULT_SECURITY_SETTINGS,
  type DetectorRule,
  detectorCoverage,
  SIGNAL_KINDS,
  watchingCount,
} from "../../app/utils/security";

function rules(change: Partial<Record<string, DetectorRule>> = {}) {
  return { ...DEFAULT_SECURITY_SETTINGS.rules, ...change };
}

describe("detectorCoverage", () => {
  it("names every kind, not only the ones a project can change", () => {
    expect(detectorCoverage(rules()).map((entry) => entry.kind)).toEqual([...SIGNAL_KINDS]);
  });

  it("calls the two that are facts always on", () => {
    const coverage = detectorCoverage(rules());
    const always = coverage.filter((entry) => entry.state === "always").map((e) => e.kind);
    expect(always).toEqual(["token_reuse", "sms_pumping"]);
  });

  it("reports a rule that has been switched off", () => {
    const coverage = detectorCoverage(
      rules({ new_country: { enabled: false, response: "record" } }),
    );
    const off = coverage.find((entry) => entry.kind === "new_country");
    expect(off?.state).toBe("off");
  });

  it("counts what would record something today", () => {
    expect(watchingCount(detectorCoverage(rules()))).toBe(SIGNAL_KINDS.length);
    expect(
      watchingCount(
        detectorCoverage(
          rules({
            new_country: { enabled: false, response: "record" },
            breached_password: { enabled: false, response: "record" },
          }),
        ),
      ),
    ).toBe(SIGNAL_KINDS.length - 2);
  });
});
