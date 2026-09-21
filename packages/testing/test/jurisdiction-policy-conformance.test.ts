import {
  EuJurisdictionPolicy,
  jurisdictionPolicyFor,
  UsJurisdictionPolicy,
} from "@idenzy/domain/policies/jurisdiction-policy";
import { Jurisdiction } from "@idenzy/protocol/enums/tenancy";
import { describe, expect, it } from "vitest";
import { JurisdictionPolicyConformanceSuite } from "../src/jurisdiction-policy-conformance.js";

const suite = new JurisdictionPolicyConformanceSuite();

describe("every jurisdiction policy satisfies the family's rules", () => {
  for (const [name, subject] of [
    ["EU", new EuJurisdictionPolicy()],
    ["US", new UsJurisdictionPolicy()],
  ] as const) {
    it(`${name} passes the conformance suite`, async () => {
      expect(await suite.run({ subject, name })).toEqual([]);
    });
  }
});

describe("choosing a policy for a cell", () => {
  it("gives each jurisdiction its own", () => {
    expect(jurisdictionPolicyFor(Jurisdiction.Eu).jurisdiction).toBe(Jurisdiction.Eu);
    expect(jurisdictionPolicyFor(Jurisdiction.Us).jurisdiction).toBe(Jurisdiction.Us);
  });

  /**
   * The residency half, and the one that would fail silently.
   *
   * An EU cell configured with `AWS_REGION=us-east-1` sends every OTP through the United States.
   * The mail arrives, nothing errors, and the recipient's address has crossed a border on every
   * sign-in — which undoes the cell that the whole of 4.13.5 exists to provide.
   */
  it("refuses an email region that would carry the address out of the jurisdiction", () => {
    const eu = jurisdictionPolicyFor(Jurisdiction.Eu);
    expect(eu.permitsEmailRegion("eu-west-1")).toBe(true);
    expect(eu.permitsEmailRegion("us-east-1")).toBe(false);

    const us = jurisdictionPolicyFor(Jurisdiction.Us);
    expect(us.permitsEmailRegion("us-east-1")).toBe(true);
    expect(us.permitsEmailRegion("eu-west-1")).toBe(false);
  });
});
