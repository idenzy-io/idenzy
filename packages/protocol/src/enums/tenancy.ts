/**
 * Compliance tier of a project. Drives audit retention, whether field-level
 * encryption is mandatory, and which subprocessors may touch the data
 * (PROJECT.md 4.13).
 *
 * The tier exists and is enforced by the architecture. It does not imply that
 * Idenzy holds any certification; see PROJECT.md 4.13.10.
 */
export const ComplianceTier = {
  Standard: "standard",
  Hipaa: "hipaa",
} as const;
export type ComplianceTier = (typeof ComplianceTier)[keyof typeof ComplianceTier];

/**
 * The law a region cell's data sits under (PROJECT.md 4.13.5).
 *
 * A code rather than a name, and declared here rather than left as free text in
 * `region_cells.jurisdiction`, because something now *selects behaviour* on it: a data-subject
 * request has a statutory deadline that differs by jurisdiction, and email for an EU cell has to
 * leave from an EU endpoint. A column that held "US" in one place and "United States" in another
 * — which is what it held — makes that selection a coin toss.
 *
 * The place name a customer reads is presentation and belongs in the panel, the same way a cell
 * code's label does. This is the value the code branches on.
 */
export const Jurisdiction = {
  Eu: "EU",
  Us: "US",
} as const;
export type Jurisdiction = (typeof Jurisdiction)[keyof typeof Jurisdiction];

/** API key kinds. Publishable keys are safe in a client bundle; secret keys never are. */
export const ApiKeyKind = {
  Publishable: "publishable",
  Secret: "secret",
} as const;
export type ApiKeyKind = (typeof ApiKeyKind)[keyof typeof ApiKeyKind];

/** Where a redirect target is allowed to be used. Exact-match only (PROJECT.md 4.6). */
export const RedirectUriKind = {
  Oauth: "oauth",
  MagicLink: "magic_link",
  PostSignout: "post_signout",
} as const;
export type RedirectUriKind = (typeof RedirectUriKind)[keyof typeof RedirectUriKind];

/**
 * What a person may do inside an organisation's dashboard (PROJECT.md 3.3, 4.13.7).
 *
 * A boundary in the panel and not a claim about the management API: anybody who can mint
 * a secret key has whatever that key's scopes allow, whatever their role says afterwards.
 */
export const MemberRole = {
  Owner: "owner",
  Admin: "admin",
  Developer: "developer",
  Viewer: "viewer",
} as const;
export type MemberRole = (typeof MemberRole)[keyof typeof MemberRole];

/**
 * The roles a member can be given. Ownership moves by transfer and never by assignment,
 * because a change that assigned it would leave the organisation with two owners or none.
 */
export const ASSIGNABLE_MEMBER_ROLES: readonly MemberRole[] = [
  MemberRole.Admin,
  MemberRole.Developer,
  MemberRole.Viewer,
];

/** What a custom domain is for. A project may hold one of each. */
export const ProjectDomainType = {
  /** Where the auth API answers, which is what makes cookie mode possible (4.3). */
  Auth: "auth",
  /** Where transactional email is sent from. */
  Email: "email",
} as const;
export type ProjectDomainType = (typeof ProjectDomainType)[keyof typeof ProjectDomainType];

/**
 * How far a domain has got.
 *
 * `pending` is the state a domain sits in until its records resolve, which can be minutes
 * or a working day depending on whose DNS it is — so it is a normal state and not a
 * failure. `failed` is what a check that ran and found the wrong thing produces, which is
 * a different sentence to the reader: one says wait, the other says fix something.
 */
export const ProjectDomainStatus = {
  Pending: "pending",
  Verified: "verified",
  Failed: "failed",
} as const;
export type ProjectDomainStatus = (typeof ProjectDomainStatus)[keyof typeof ProjectDomainStatus];
