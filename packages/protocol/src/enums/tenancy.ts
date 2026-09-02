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
