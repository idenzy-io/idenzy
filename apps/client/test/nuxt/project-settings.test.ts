import { describe, expect, it } from "vitest";
import {
  AUDIT_RETENTION_ENFORCEMENT,
  type ControlCapability,
  DELETE_EFFECTS,
  KEY_ADMIN_SEPARATION,
  KMS_SIGNING,
  TENANT_ISOLATION,
  WRAPPED_DEK,
} from "../../app/utils/project-settings";

/**
 * The settings screen's compliance reference, which had no test and needed one.
 *
 * It asserted ten infrastructure facts in the present tense and five were untrue of the code:
 * keys in KMS, key administrators separated from key users, a wrapped per-project DEK, audit
 * partitions dropped on a schedule. Nothing caught it because nothing looked, which is the same
 * reason the missing project-delete cascade survived.
 */
const CONTROLS: Record<string, ControlCapability> = {
  AUDIT_RETENTION_ENFORCEMENT,
  KMS_SIGNING,
  WRAPPED_DEK,
  KEY_ADMIN_SEPARATION,
  TENANT_ISOLATION,
};

describe("the controls this deployment declares", () => {
  /**
   * The list of what is actually running, kept here so landing a control means changing a test.
   *
   * That is the point rather than an inconvenience: each of these is copy shown to a customer as
   * a security claim, so the moment one becomes true somebody has to look at the sentence beside
   * it. A test that tracked the constants automatically would let the old wording ship.
   */
  it("says which ones are in effect, and the list is deliberately hard to change quietly", () => {
    const running = Object.entries(CONTROLS)
      .filter(([, control]) => control.running)
      .map(([name]) => name)
      .sort();
    // CROSS_CELL_REFUSAL was here until the region cells were removed, and left with them.
    // Each arrival is meant to fail this line, so that whoever lands the control also reads
    // the sentence beside it.
    expect(running).toEqual(["TENANT_ISOLATION"]);
  });

  it("gives every control a value short enough for a grid cell and a reason worth reading", () => {
    for (const [name, control] of Object.entries(CONTROLS)) {
      expect(control.value.length, name).toBeLessThanOrEqual(24);
      expect(control.reason.length, name).toBeGreaterThan(80);
    }
  });

  /**
   * A control that is not running must not read as one that is. "Refused", "In KMS", "Wrapped"
   * and "Separated" were the exact four words that made this screen wrong, so none of them may
   * come back as a value while the thing behind it does not run.
   */
  it("never states an absent control as an accomplished one", () => {
    const asserted = ["refused", "in kms", "wrapped", "separated", "enforced", "dropped"];
    for (const [name, control] of Object.entries(CONTROLS)) {
      if (control.running) continue;
      const value = control.value.toLowerCase();
      for (const claim of asserted) {
        // "Not enforced yet" contains "enforced", so the test is about the bare claim: a value
        // that asserts the control without qualifying it.
        expect(value === claim, `${name} states "${claim}" while not running`).toBe(false);
      }
      expect(value, name).toMatch(/\bnot\b/);
    }
  });
});

describe("what deleting a project promises", () => {
  /**
   * Partitions are monthly and hold every project's entries, so dropping one for a single
   * project is not merely unimplemented — it is incoherent. The copy said otherwise until the
   * purge landed.
   */
  it("does not promise dropped partitions", () => {
    for (const effect of DELETE_EFFECTS) {
      expect(`${effect.label} ${effect.note}`.toLowerCase()).not.toContain("partition");
    }
  });

  it("still warns that the audit trail goes", () => {
    const audit = DELETE_EFFECTS.find((effect) => effect.id === "audit");
    expect(audit?.label.toLowerCase()).toContain("audit");
    expect(audit?.note.toLowerCase()).toContain("export");
  });
});
