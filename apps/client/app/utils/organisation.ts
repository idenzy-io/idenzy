/**
 * The organisation a project belongs to, and what belongs to it rather than to the
 * project (`orgs`, PROJECT.md 12).
 *
 * Every person here is in one, and an organisation holds as many projects as it has
 * applications to sign people into. That split settles the question three page notes
 * raise as their first P1: the team and the wallet are the organisation's, the sign-in
 * rules and the meters are the project's. The schema says the same thing by putting
 * `billing_customer_id` on `orgs` and `org_id` on `projects`, so a screen that scoped
 * either to one project would be telling somebody their card was charged for one
 * application when it was charged for all of them.
 *
 * A placeholder until the management API answers, like everything else in this panel.
 */

export interface Org {
  /** `org_` and an opaque body, as every API surface names one. */
  id: string;
  name: string;
  createdAt: string;
}

/**
 * Personal or team, and it is counted rather than stored.
 *
 * A personal organisation is one member and a team is more than one, so the kind is a
 * fact about the member list and never a field somebody sets. Stored, the two could
 * disagree the moment an invitation was accepted, and the label is the half a reader
 * would believe.
 */
export type OrgKind = "personal" | "team";

export function orgKindOf(memberCount: number): OrgKind {
  return memberCount > 1 ? "team" : "personal";
}

export const ORG_KIND_LABELS: Record<OrgKind, string> = {
  personal: "Personal",
  team: "Team",
};

/**
 * What each kind is, in the words that stop it reading as a tier.
 *
 * Neither is an upgrade: seats are free and there is no per-seat line in the price list
 * (PROJECT.md 5.1), so becoming a team costs nothing and unlocks nothing. Every
 * comparable product charges per seat, which is why a reader assumes it until told.
 */
export const ORG_KIND_NOTES: Record<OrgKind, string> = {
  personal:
    "One member, which is you. It becomes a team the moment somebody else accepts an invitation, and that is not a change of plan: seats are free.",
  team: "More than one member. Seats are free, so the size of the team is not a price and never will be.",
};

/** What the organisation owns, for the rows that have to say where something lives. */
export const ORG_OWNS: readonly string[] = [
  "The team, their roles and every invitation",
  "The wallet, the payment methods and the invoices",
  "The plan, and the legal entity a charge is made out to",
];

/** What a project owns, which is everything a customer's own users ever touch. */
export const PROJECT_OWNS: readonly string[] = [
  "Sign-in methods, tokens, domains and keys",
  "Users, sessions and the audit trail",
  "What is metered, which is billed to the organisation above it",
];

/**
 * Why one organisation holds several projects.
 *
 * One per application, which is what makes a project the tenancy boundary: two products
 * under one organisation share a bill and a team and share no user, no key and no
 * session. Said on the screens that show both, because a reader who assumes otherwise
 * assumes the wrong blast radius.
 */
export const ORG_PROJECTS_NOTE =
  "One organisation, as many projects as you have applications. They share this team and this wallet and share nothing else: no user, no key and no session crosses between them.";

/**
 * What the panel does not hold about the organisation.
 *
 * The legal name on an invoice, the billing address that decides the tax and the VAT
 * registration live with the payment provider, on their origin. Naming the organisation
 * as the account being funded is honest; calling it the legal entity would not be.
 */
export const ORG_LEGAL_NOTE =
  "The legal name, the billing address and the tax registration are held by our payment provider rather than here, so this name is the account being funded and not the entity on the invoice.";
