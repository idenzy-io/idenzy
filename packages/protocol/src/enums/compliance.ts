/** Data-subject request kinds, per GDPR Art.15, 16, 17 and 20 (PROJECT.md 4.13.6). */
export const DsrKind = {
  Access: "access",
  Rectification: "rectification",
  Erasure: "erasure",
  Portability: "portability",
} as const;
export type DsrKind = (typeof DsrKind)[keyof typeof DsrKind];

/** Lifecycle of a data-subject request. `due_at` is set at intake and is monitored. */
export const DsrStatus = {
  Received: "received",
  InProgress: "in_progress",
  Completed: "completed",
  Rejected: "rejected",
} as const;
export type DsrStatus = (typeof DsrStatus)[keyof typeof DsrStatus];

/** Who performed an audited action. */
export const ActorType = {
  User: "user",
  CustomerStaff: "customer_staff",
  ApiKey: "api_key",
  IdenzyStaff: "idenzy_staff",
  System: "system",
} as const;
export type ActorType = (typeof ActorType)[keyof typeof ActorType];

/**
 * What a retention policy is about, as `retention_policies.subject` stores it.
 *
 * Five, and the fifth is not like the others: `audit_events` is fixed by the project's
 * compliance tier rather than chosen, because the age of an audit trail is what an auditor
 * is promised. It is here so a reader of this list is not left wondering where it went.
 */
export const RetentionSubject = {
  Sessions: "sessions",
  OtpChallenges: "otp_challenges",
  OauthFlows: "oauth_flows",
  Users: "users",
  AuditEvents: "audit_events",
} as const;
export type RetentionSubject = (typeof RetentionSubject)[keyof typeof RetentionSubject];

/** The subjects a project may actually set. Audit follows the tier and is not one of them. */
export const CONFIGURABLE_RETENTION_SUBJECTS: readonly RetentionSubject[] = [
  RetentionSubject.Sessions,
  RetentionSubject.OtpChallenges,
  RetentionSubject.OauthFlows,
  RetentionSubject.Users,
];

/** `retention_policies.action`. What the sweeper does when the age is reached. */
export const RetentionAction = {
  /** The row goes. */
  Purge: "purge",
  /** The row stays and its personal columns are cleared (PROJECT.md 4.13.6). */
  Tombstone: "tombstone",
  /** A month of `audit_events` is dropped whole rather than deleted row by row. */
  DropPartition: "drop_partition",
} as const;
export type RetentionAction = (typeof RetentionAction)[keyof typeof RetentionAction];

/**
 * What the sweeper does to each subject, which is a property of the data and not a choice.
 *
 * A deleted account is tombstoned rather than purged because the audit trail points at its
 * id and an erasure that broke the chain would read as tampering.
 */
export const RETENTION_ACTIONS: Readonly<Record<RetentionSubject, RetentionAction>> = {
  [RetentionSubject.Sessions]: RetentionAction.Purge,
  [RetentionSubject.OtpChallenges]: RetentionAction.Purge,
  [RetentionSubject.OauthFlows]: RetentionAction.Purge,
  [RetentionSubject.Users]: RetentionAction.Tombstone,
  [RetentionSubject.AuditEvents]: RetentionAction.DropPartition,
};

/**
 * The ages a project may choose, per subject, as ISO 8601 durations.
 *
 * Bounded on both sides and per subject rather than one list for everything: a month of
 * ended sessions is generous and a month of OAuth flows is a month of rows nothing will ever
 * read, and offering the same menu for both invites the wrong answer for one of them.
 *
 * A closed list rather than a range because this is what the sweeper runs. Postgres parses
 * each of these as an `interval` directly, so the value a customer picks is the value the
 * delete uses, with no second parser between the two.
 */
export const RETENTION_CHOICES: Readonly<Record<RetentionSubject, readonly string[]>> = {
  [RetentionSubject.Sessions]: ["P7D", "P30D", "P90D", "P180D"],
  [RetentionSubject.OtpChallenges]: ["P1D", "P7D", "P30D"],
  [RetentionSubject.OauthFlows]: ["P1D", "P7D", "P30D"],
  [RetentionSubject.Users]: ["P7D", "P30D", "P90D", "P365D"],
  [RetentionSubject.AuditEvents]: ["P1Y", "P6Y"],
};

/**
 * What a project with no stored policy is swept at.
 *
 * The sweeper resolves these itself rather than writing rows at project creation, so a
 * project that has never opened the settings screen is swept on the same schedule as one
 * that has. A default nothing applies until somebody saves it is the gap this whole family
 * exists to close.
 */
export const RETENTION_DEFAULTS: Readonly<Record<RetentionSubject, string>> = {
  [RetentionSubject.Sessions]: "P90D",
  [RetentionSubject.OtpChallenges]: "P1D",
  [RetentionSubject.OauthFlows]: "P1D",
  [RetentionSubject.Users]: "P30D",
  [RetentionSubject.AuditEvents]: "P1Y",
};
