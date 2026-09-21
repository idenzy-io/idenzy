import { strict as assert } from "node:assert";
import type { JurisdictionPolicy } from "@idenzy/domain/policies/jurisdiction-policy";
import { ConformanceSuite } from "./conformance-suite.js";

/**
 * The suite every jurisdiction policy must pass (PROJECT.md 7.4).
 *
 * Small, because a cell's jurisdiction governs exactly one thing the code can act on: where its
 * transactional email may leave from. Statutory deadlines used to be here and were moved — they
 * belong to the data subject's law rather than to the cell's, and `DsrDeadline` holds them.
 *
 * What this asserts is the property behind the residency claim: a policy that permitted any
 * region would be a control in name only.
 */
export class JurisdictionPolicyConformanceSuite extends ConformanceSuite<JurisdictionPolicy> {
  override readonly familyName = "JurisdictionPolicy";

  protected override defineCases() {
    return [
      {
        name: "names an email region, and accepts only that one",
        run: ({ subject }: { subject: JurisdictionPolicy }) => {
          assert.ok(subject.emailRegion.length > 0, "a cell must know where its mail leaves from");
          assert.ok(
            subject.permitsEmailRegion(subject.emailRegion),
            "a policy must permit its own region",
          );
          // The failure this guards is the quiet one: an EU cell sending through us-east-1
          // transfers the recipient's address on every sign-in, and the mail still arrives.
          assert.ok(
            !subject.permitsEmailRegion("ap-southeast-2"),
            "a policy that permits any region is not a residency control",
          );
        },
      },
    ];
  }
}
