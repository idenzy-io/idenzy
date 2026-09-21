/**
 * The vocabulary every column is declared in (PROJECT.md 4.13.2).
 *
 * Adding a value here is a compliance decision, not a refactor: each one changes what
 * the generated RoPA, data map, log allowlist and DSR field lists say.
 */

/** What kind of data a column holds. Drives encryption, logging and erasure. */
export const DataClass = {
  /** Identifies a natural person. GDPR personal data. */
  Pii: "pii",
  /** Health information. Only ever present on HIPAA-tier projects. */
  Phi: "phi",
  /** Credential material: hashes, secrets, tokens. Never exported, never logged. */
  Secret: "secret",
  /** Derived or hashed identifiers. Not directly identifying, still not public. */
  Pseudonymous: "pseudonymous",
  /** Not personal data. Counters, flags, timestamps, configuration. */
  Operational: "operational",
} as const;
export type DataClass = (typeof DataClass)[keyof typeof DataClass];

/** Why we hold the column. This is the GDPR Art.30 "purpose of processing". */
export const Purpose = {
  Authentication: "authentication",
  AccountManagement: "account_management",
  SecurityAndAbusePrevention: "security_and_abuse_prevention",
  MessageDelivery: "message_delivery",
  BillingAndMetering: "billing_and_metering",
  AuditAndCompliance: "audit_and_compliance",
  ServiceConfiguration: "service_configuration",
} as const;
export type Purpose = (typeof Purpose)[keyof typeof Purpose];

/** How long the column may be kept. Enforced by the retention worker, not by intent. */
export const Retention = {
  SessionLifetime: "session_lifetime",
  /**
   * Three days, which is the horizon somebody debugging a delivery works in (ADR-0012).
   *
   * Its own tier rather than rounding up to `Days30`, because these artifacts are the answer
   * to "what do you keep and for how long" and a column that is dropped after 72 hours must
   * not be described as kept for a month.
   */
  Hours72: "hours_72",
  Days30: "days_30",
  /**
   * Six months, which is how long the finest usage rollup is worth keeping.
   *
   * An hourly row is twenty-four times a daily one, so the tier is short by design rather than by
   * oversight: what a reader explores at that resolution is recent, and what a bill rests on is
   * the monthly record that outlives both.
   */
  Months6: "months_6",
  UntilAccountDeletion: "until_account_deletion",
  /** Standard audit retention. */
  Years1: "years_1",
  /** Daily usage: long enough for a year-on-year comparison, short of a financial record. */
  Years2: "years_2",
  /** HIPAA audit retention. */
  Years6: "years_6",
  /** Configuration that lives as long as the project does. */
  ProjectLifetime: "project_lifetime",
} as const;
export type Retention = (typeof Retention)[keyof typeof Retention];

/** What an erasure request does to the column (PROJECT.md 4.13.6). */
export const Erasure = {
  /** Replace with a tombstone marker, keeping the row for audit integrity. */
  Tombstone: "tombstone",
  /** Set to NULL. */
  NullOut: "null_out",
  /** Keep: it is already pseudonymous and the audit trail depends on it. */
  RetainPseudonymous: "retain_pseudonymous",
  /** Row is deleted wholesale, so no per-column action applies. */
  RowDeleted: "row_deleted",
  /** Not personal data. Nothing to erase. */
  NotApplicable: "not_applicable",
} as const;
export type Erasure = (typeof Erasure)[keyof typeof Erasure];

/** GDPR Art.6 lawful basis, derived from purpose rather than declared per column. */
export const LawfulBasis = {
  Contract: "art_6_1_b_contract",
  LegitimateInterest: "art_6_1_f_legitimate_interest",
  LegalObligation: "art_6_1_c_legal_obligation",
} as const;
export type LawfulBasis = (typeof LawfulBasis)[keyof typeof LawfulBasis];

/**
 * Purpose to lawful basis. Kept as one map so the RoPA cannot claim two different
 * bases for the same purpose in different tables.
 */
export const lawfulBasisForPurpose: Readonly<Record<Purpose, LawfulBasis>> = {
  [Purpose.Authentication]: LawfulBasis.Contract,
  [Purpose.AccountManagement]: LawfulBasis.Contract,
  [Purpose.SecurityAndAbusePrevention]: LawfulBasis.LegitimateInterest,
  [Purpose.MessageDelivery]: LawfulBasis.Contract,
  [Purpose.BillingAndMetering]: LawfulBasis.Contract,
  [Purpose.AuditAndCompliance]: LawfulBasis.LegalObligation,
  [Purpose.ServiceConfiguration]: LawfulBasis.Contract,
};

/** How a column is declared. Attached at build time, read by every generator. */
/**
 * Whose data subject a table's `subjectField` columns belong to (PROJECT.md 4.13.6).
 *
 * Two populations, and conflating them is a data breach in either direction. An end user belongs
 * to a customer's project and we are their processor; somebody on the customer's own team is our
 * own data subject. A request from one must never reach the other's rows, and until this was
 * declared nothing in the schema said which was which — `users.email` and `org_invitations.email`
 * are both PII marked `subjectField` and are not the same kind of person.
 */
export const SubjectPopulation = {
  /** A customer's end user: a `users` row inside a region cell. */
  EndUser: "end_user",
  /** Somebody on the customer's own team. Our data subject, not theirs. */
  CustomerStaff: "customer_staff",
} as const;
export type SubjectPopulation = (typeof SubjectPopulation)[keyof typeof SubjectPopulation];

/**
 * How a data-subject request reaches one person's rows in a table.
 *
 * The missing half of the classification, and the reason nothing consumed the generated field
 * lists in production. `subjectField` says *which columns* an access request returns and `erasure`
 * says what to do with them; neither says how to find the rows in the first place. A worker built
 * on that alone would hardcode a join per table — which is the hand-maintained list that
 * generating these lists exists to abolish, reintroduced one layer down.
 *
 * Declaring it is cheap now and expensive later: retrofitting means revisiting every table *and*
 * re-answering every request already served from an incomplete list.
 */
export interface TableSubject {
  readonly population: SubjectPopulation;
  /**
   * The column one subject's rows are found by, or null where they cannot be reached directly.
   *
   * Null is a real answer and has to carry a `note`. `otp_challenges` holds a hash of the address
   * rather than the address, so it is reachable only by hashing the identifier the same way — a
   * different operation, not a lookup. Stating that beats a join that silently returns nothing.
   */
  readonly locatedBy: string | null;
  /** Why the subject cannot be located, or anything a handler must know. Required when null. */
  readonly note?: string;
}

export interface ColumnClassification {
  readonly class: DataClass;
  readonly purpose: Purpose;
  readonly retention: Retention;
  /** Returned by a data-subject access or portability request. */
  readonly subjectField?: boolean;
  /** What an erasure request does. Required for pii and phi. */
  readonly erasure?: Erasure;
  /** Field-level envelope encryption, on top of encryption at rest (PROJECT.md 4.13.4). */
  readonly encrypted?: boolean;
  /** May appear in a structured log line. Everything else is dropped (PROJECT.md 4.13.8). */
  readonly loggable?: boolean;
  /** Anything a reader or an auditor would otherwise have to ask about. */
  readonly note?: string;
}
