import { Jurisdiction } from "@idenzy/protocol/enums/tenancy";

/**
 * What differs because of the law a cell sits under (PROJECT.md 4.13.5).
 *
 * One object rather than conditionals scattered across the services that care, for the reason
 * §7.2 gives about every other family here: a rule expressed in three places drifts in two of
 * them, and the ones that drift are the ones nobody reads again.
 *
 * **This is about where bytes sit, and nothing else.** One thing genuinely differs per cell in a
 * way the system can act on: the region transactional email may leave from, which is the one that
 * quietly undoes a cell.
 *
 * **Statutory deadlines are deliberately not here, and that was a correction.** A data-subject
 * request's clock is set by the law governing that *person*, which is the controller's
 * determination and travels with the request — see `DsrDeadline`. A cell in Iowa holds European
 * residents the moment a customer in Europe uses it, so selecting GDPR-or-CCPA from the cell's
 * jurisdiction would answer a European on a Californian clock and be late by Art. 12(3). The
 * panel had this right first (`apps/client/app/utils/data-requests.ts`: "which rule applies is
 * your privacy owner's decision").
 *
 * Also **not** here, having looked: audit retention is set by `compliance_tier` and is the same
 * number in both jurisdictions. Lawful basis is a GDPR concept the RoPA records and no code
 * branches on. Field encryption and subprocessor scope follow the tier, not the border.
 */
export abstract class JurisdictionPolicy {
  abstract readonly jurisdiction: Jurisdiction;

  /**
   * Where transactional email for this cell must leave from.
   *
   * Not a deployment detail. An EU cell sending an OTP through `us-east-1` transfers the
   * recipient's address to the United States on every single sign-in, which undoes the residency
   * the cell exists to provide — and does it invisibly, because the mail arrives. This is the
   * value a provisioning check and a conformance test compare `AWS_REGION` against.
   */
  abstract readonly emailRegion: string;

  /** Whether email leaving from `region` keeps this cell's data inside its jurisdiction. */
  permitsEmailRegion(region: string): boolean {
    return region === this.emailRegion;
  }
}

export class EuJurisdictionPolicy extends JurisdictionPolicy {
  override readonly jurisdiction = Jurisdiction.Eu;
  override readonly emailRegion = "eu-west-1";
}

export class UsJurisdictionPolicy extends JurisdictionPolicy {
  override readonly jurisdiction = Jurisdiction.Us;
  override readonly emailRegion = "us-east-1";
}

/**
 * The policy for a cell, chosen once from its jurisdiction.
 *
 * Exhaustive rather than defaulting. A jurisdiction this build does not know is a cell somebody
 * provisioned against a law nobody encoded, and answering it with the US policy would mean
 * serving an unknown jurisdiction on a 45-day clock chosen by a fallback — which is exactly the
 * shape of mistake that only surfaces at an audit.
 */
export function jurisdictionPolicyFor(jurisdiction: Jurisdiction): JurisdictionPolicy {
  switch (jurisdiction) {
    case Jurisdiction.Eu:
      return new EuJurisdictionPolicy();
    case Jurisdiction.Us:
      return new UsJurisdictionPolicy();
  }
}

/**
 * A stored `region_cells.jurisdiction` narrowed to one this build knows, or null.
 *
 * The column is text, so this is the boundary between a value somebody typed into a registry and
 * a value code branches on. Null rather than a default: see `jurisdictionPolicyFor`.
 */
export function jurisdictionFrom(value: string): Jurisdiction | null {
  return Object.values(Jurisdiction).includes(value as Jurisdiction)
    ? (value as Jurisdiction)
    : null;
}
