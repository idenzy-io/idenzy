import { describe, expect, it } from "vitest";
import {
  AUTH_OUTCOME_STATUSES,
  DEFAULT_SECURITY_SETTINGS,
  DEPLOYMENT_DEFENCES,
  type DetectorRule,
  detectorCoverage,
  detectorStatuses,
  enforcedResponse,
  MFA_REQUIRED_SAMPLE,
  RESPONSE_ENFORCEMENT,
  responseAvailable,
  SIGNAL_KINDS,
  SIGNAL_RESPONSES,
  unenforcedCount,
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

describe("observed, configured and enforced", () => {
  it("carries out recording and nothing else today", () => {
    expect(responseAvailable("record")).toBe(true);
    expect(responseAvailable("notify")).toBe(false);
    expect(responseAvailable("step_up")).toBe(false);
  });

  it("degrades a response the deployment cannot carry out to what it actually does", () => {
    expect(enforcedResponse("record")).toBe("record");
    expect(enforcedResponse("notify")).toBe("record");
    expect(enforcedResponse("step_up")).toBe("record");
  });

  it("sends every unavailable response somewhere the missing half is built", () => {
    for (const response of SIGNAL_RESPONSES) {
      const enforcement = RESPONSE_ENFORCEMENT[response];
      if (enforcement.state === "enforced") continue;
      expect(enforcement.fix?.to).toMatch(/^\//);
      expect(enforcement.note).toMatch(/records the signal/i);
    }
  });

  it("keeps the three states apart on every detector", () => {
    const statuses = detectorStatuses(rules());
    expect(statuses.map((status) => status.kind)).toEqual([...SIGNAL_KINDS]);
    const travel = statuses.find((status) => status.kind === "impossible_travel");
    /* The default asks for a step-up, which is not carried out, so the two disagree and
       the row has to say so. */
    expect(travel?.configured).toBe("step_up");
    expect(travel?.enforced).toBe("record");
    expect(travel?.matches).toBe(false);
  });

  it("counts only the rules that are observing and disagree", () => {
    expect(unenforcedCount(detectorStatuses(rules()))).toBe(2);
    const off = detectorStatuses(
      rules({
        impossible_travel: { enabled: false, response: "step_up" },
        breached_password: { enabled: false, response: "notify" },
      }),
    );
    expect(unenforcedCount(off)).toBe(0);
  });

  it("gives the two that are facts no configured response to disagree with", () => {
    const statuses = detectorStatuses(rules());
    for (const kind of ["token_reuse", "sms_pumping"] as const) {
      const status = statuses.find((entry) => entry.kind === kind);
      expect(status?.configured).toBeNull();
      expect(status?.matches).toBe(true);
    }
  });
});

describe("what the sample tells a developer", () => {
  it("uses the protocol's own statuses and never invents one", () => {
    expect([...AUTH_OUTCOME_STATUSES]).toEqual(["authenticated", "mfa_required"]);
    expect(AUTH_OUTCOME_STATUSES).not.toContain("challenge");
  });

  it("shows the challenge shape the union actually carries", () => {
    const names = MFA_REQUIRED_SAMPLE.map((line) => line.name);
    expect(names).toEqual(["status", "challengeId", "purpose", "factors", "expiresAt"]);
    /* There is no `reason` on the challenge: what fired is on this screen, not in the
       reply, and a client branching on one would branch on nothing. */
    expect(names).not.toContain("reason");
    expect(MFA_REQUIRED_SAMPLE[0]?.value).toBe('"mfa_required"');
  });
});

describe("the defences nobody configures", () => {
  it("does not call unprovisioned infrastructure always on", () => {
    const waf = DEPLOYMENT_DEFENCES.find((defence) => defence.id === "waf");
    expect(waf?.state).toBe("unavailable");
    expect(waf?.detail).toMatch(/not provisioned/i);
  });

  it("says which of them are actually running", () => {
    const running = DEPLOYMENT_DEFENCES.filter((defence) => defence.state === "enforced");
    expect(running.map((defence) => defence.id)).toEqual(["app_limits", "one_answer", "reuse"]);
  });
});
