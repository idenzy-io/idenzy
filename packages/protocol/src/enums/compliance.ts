/** Data-subject request kinds, per GDPR Art.15, 16, 17 and 20 (PROJECT.md 4.13.6). */
export const DsrKind = {
  Access: "access",
  Rectification: "rectification",
  Erasure: "erasure",
  Portability: "portability",
} as const;
export type DsrKind = (typeof DsrKind)[keyof typeof DsrKind];

/** Lifecycle of a data-subject request. `due_at` is set at intake and is monitored. */
/**
 * Which law's clock a data-subject request is answered on (PROJECT.md 4.13.6).
 *
 * **Per request, not per cell, and the distinction is the whole reason this is an enum.** A cell's
 * jurisdiction is about where bytes sit; this is about which law governs one person's rights, and
 * the two come apart constantly — a US cell holds EU residents whenever a customer's users are in
 * Europe. Idenzy is a processor here, so which rule applies is the controller's determination and
 * arrives with the request rather than being inferred from a column.
 *
 * The string values match `apps/client/app/utils/data-requests.ts` exactly, because the panel had
 * this shape first and is the specification.
 */
export const DsrDeadlineRule = {
  Gdpr: "gdpr",
  Ccpa: "ccpa",
} as const;
export type DsrDeadlineRule = (typeof DsrDeadlineRule)[keyof typeof DsrDeadlineRule];

export const DSR_DEADLINE_RULES: readonly DsrDeadlineRule[] = [
  DsrDeadlineRule.Gdpr,
  DsrDeadlineRule.Ccpa,
];

/**
 * What a request is answered on when nobody has said.
 *
 * GDPR, and deliberately the strictest of the two rather than the one matching the cell. A
 * processor cannot know where a data subject lives, and the two failure directions are not
 * symmetric: answering a Californian within a month is not a breach of anything, and answering a
 * European after 45 days is a breach of Art. 12(3).
 */
export const DEFAULT_DSR_DEADLINE_RULE: DsrDeadlineRule = DsrDeadlineRule.Gdpr;

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

/**
 * Who did the thing an audit entry records, as the trail stores it.
 *
 * These are the values already in `audit_events.actor_type`, written by whatever set the
 * `TenantContext`: `user` for a project's own end user, `customer_staff` for somebody on
 * the customer's team, `idenzy_staff` for one of ours under a staff access grant,
 * `api_key` for a secret key acting on its own, and `system` for a background job with
 * nobody behind it.
 *
 * The panel had a second vocabulary of its own — `end_user`, `member`, `staff` — invented
 * before anything wrote a row, and three of the five names disagreed. This is the one that
 * exists in the database, so it is the one that wins; the screen keeps its labels and they
 * are labels rather than a parallel set of ids.
 */
export const AuditActorType = {
  EndUser: "user",
  Member: "customer_staff",
  Staff: "idenzy_staff",
  ApiKey: "api_key",
  System: "system",
} as const;
export type AuditActorType = (typeof AuditActorType)[keyof typeof AuditActorType];

export const AUDIT_ACTOR_TYPES: readonly AuditActorType[] = Object.values(AuditActorType);

/**
 * The actors an organisation's audit log is actually about.
 *
 * A project's own users generate the overwhelming majority of entries and are not what
 * somebody opening this screen came to read, which is why the screen sets them aside by
 * default rather than mixing them in.
 */
export const AUDIT_TEAM_ACTORS: readonly AuditActorType[] = [
  AuditActorType.Member,
  AuditActorType.ApiKey,
  AuditActorType.Staff,
  AuditActorType.System,
];

/** How the screen groups actions. Derived from the action's prefix, never stored. */
export const AuditCategory = {
  Team: "team",
  Keys: "keys",
  Settings: "settings",
  Accounts: "accounts",
  Data: "data",
  Sessions: "sessions",
} as const;
export type AuditCategory = (typeof AuditCategory)[keyof typeof AuditCategory];

export const AUDIT_CATEGORIES: readonly AuditCategory[] = Object.values(AuditCategory);

/**
 * The prefix of an action decides its category, and this is the whole mapping.
 *
 * It lives here rather than in the panel because the server pages the trail: a screen
 * holding one page of fifty cannot filter a category client-side and have the pager mean
 * anything. The API filters on `action like 'prefix.%'`, so the menu offers exactly what
 * the API accepts — the same reason the retention vocabulary moved here.
 */
export const AUDIT_CATEGORY_PREFIXES: Readonly<Record<AuditCategory, readonly string[]>> = {
  [AuditCategory.Team]: ["member", "staff"],
  [AuditCategory.Keys]: ["key"],
  [AuditCategory.Settings]: ["project"],
  [AuditCategory.Accounts]: ["user"],
  [AuditCategory.Data]: ["data"],
  [AuditCategory.Sessions]: ["session"],
};

/** An action whose prefix names no category is a setting, which is where new ones land. */
export const AUDIT_DEFAULT_CATEGORY: AuditCategory = AuditCategory.Settings;
