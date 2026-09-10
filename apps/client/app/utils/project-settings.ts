/**
 * What a project *is*, as the `projects` row and the cell registry define it, and the very
 * short list of it a customer gets to change (PROJECT.md 4.13).
 *
 * Most of this screen is not settings, and that is the honest shape of the table rather
 * than a gap. A project is the unit of tenancy, of key custody and of residency: its cell
 * is immutable after creation because moving it is an audited migration and never an
 * `UPDATE`, its tier is a contract before it is a column, and its keys live in KMS where
 * nothing in a dashboard could reach them. Three of the five fields a customer might expect
 * to edit are decisions taken once, and a screen that offered them as controls would be
 * offering to do something the platform refuses.
 *
 * What is genuinely editable is a name and a set of retention ages. The name is worth
 * saying out loud: it is a label for this dashboard and reaches no end user anywhere,
 * because we render no page they could read it on. The issuer their authenticator shows and
 * the sender their email comes from are different fields on different screens.
 *
 * Retention is the one part with teeth. `retention_policies` drives the purge worker, and
 * PROJECT.md 4.13.6 puts it plainly: retention that is not enforced by a job is not
 * retention. The audit subject is the exception, fixed by the tier, because its retention is
 * what an auditor is promised rather than what an operator prefers.
 */

/*
 * Where a project lives.
 */

export interface RegionCell {
  /** `region_cells.code`, which is what a log line and a support ticket name it by. */
  code: string;
  label: string;
  /** The law the data sits under, which is the whole reason a cell exists. */
  jurisdiction: string;
  /** The API host for projects in this cell. What a customer's SDK is pointed at. */
  endpoint: string;
  /** The KMS key ring that wraps every project DEK in this cell. */
  kmsKeyRing: string;
}

export const REGION_CELLS: readonly RegionCell[] = [
  {
    code: "eu-west-1",
    label: "Europe (Belgium)",
    jurisdiction: "European Union",
    endpoint: "https://eu.idenzy.dev",
    kmsKeyRing: "idenzy-eu-west-1",
  },
  {
    code: "us-east-1",
    label: "United States (South Carolina)",
    jurisdiction: "United States",
    endpoint: "https://us.idenzy.dev",
    kmsKeyRing: "idenzy-us-east-1",
  },
];

export function cellByCode(code: string): RegionCell | null {
  return REGION_CELLS.find((cell) => cell.code === code) ?? null;
}

/*
 * What it is held to.
 */

export type ProjectTier = "standard" | "hipaa";

export const PROJECT_TIERS: readonly ProjectTier[] = ["standard", "hipaa"];

export const TIER_LABELS: Record<ProjectTier, string> = {
  standard: "Standard",
  hipaa: "HIPAA",
};

/** Years of audit trail the tier buys. Partitions are dropped on this schedule. */
export const TIER_AUDIT_YEARS: Record<ProjectTier, number> = { standard: 1, hipaa: 6 };

export const TIER_NOTES: Record<ProjectTier, string> = {
  standard:
    "A year of audit trail, field encryption on the columns that always have it, and the standard subprocessor list.",
  hipaa:
    "Six years of audit trail, field encryption mandatory on anything marked as PHI, and a subprocessor scope narrowed to what a BAA covers.",
};

/**
 * Why the tier is not a switch.
 *
 * It is the technical half of a signed agreement: the BAA is what puts us inside a
 * customer's compliance boundary, and a dropdown that could put a project on the HIPAA
 * tier would be a dropdown that claims a contract exists. It also changes retention
 * downward-irreversibly, since partitions already dropped at one year cannot be brought
 * back for the six.
 */
export const TIER_CHANGE_NOTE =
  "The tier is set with your agreement rather than from this screen. It is what a BAA scopes, and it moves audit retention, so a control here would let a project claim a contract it does not have and drop partitions it cannot get back.";

/*
 * What a project holds, as this screen reads it.
 */

export interface ProjectFacts {
  /** The public id, `prj_` and an opaque body, as every API surface names a project. */
  id: string;
  name: string;
  /** The organisation that owns it. Members and billing belong to that, not to this. */
  orgName: string;
  cellCode: string;
  tier: ProjectTier;
  plan: string;
  createdAt: string;
}

/**
 * The project id is public and is not a secret, which surprises people who see it beside
 * the keys. It is the `aud` claim of every access token we sign, so it reaches every
 * browser the customer's application runs in, and a verifier that did not check it would
 * accept a perfectly good token minted for somebody else.
 */
export const PROJECT_ID_NOTE =
  "Public by construction. It is the audience claim of every token we sign, so it reaches every browser your application runs in; a server SDK checks it, which is what stops one project's token being accepted by another.";

/*
 * Naming it.
 */

/* `PROJECT_NAME_` on the front because another module already owns `NAME_MAX_LENGTH`, and
   Nuxt auto-imports every module under `app/utils`: two exports of one name are one export
   and a warning, with the loser silently the wrong number. */
export const PROJECT_NAME_MIN_LENGTH = 1;
export const PROJECT_NAME_MAX_LENGTH = 64;

export type ProjectNameIssue = "name_empty" | "name_long";

export const PROJECT_NAME_ISSUE_LABELS: Record<ProjectNameIssue, string> = {
  name_empty: "A project needs a name to be told apart in the switcher.",
  name_long: `At most ${PROJECT_NAME_MAX_LENGTH} characters. It has to fit the drawer and the breadcrumb.`,
};

export function validateProjectName(value: string): ProjectNameIssue | null {
  const text = value.trim();
  if (text.length < PROJECT_NAME_MIN_LENGTH) return "name_empty";
  if (text.length > PROJECT_NAME_MAX_LENGTH) return "name_long";
  return null;
}

/**
 * Where the name does and does not appear, because the answer is "nowhere a user looks"
 * and everybody assumes otherwise.
 */
export const NAME_NOTE =
  "For this dashboard only. We render no page your users can read, so this name reaches none of them: the label on their authenticator is the issuer on the multi-factor screen, and the name on their email is the sender on the email screen.";

/*
 * What is swept away, and when.
 */

export type RetentionSubject =
  | "sessions"
  | "otp_challenges"
  | "oauth_flows"
  | "users"
  | "audit_events";

export const RETENTION_SUBJECTS: readonly RetentionSubject[] = [
  "sessions",
  "otp_challenges",
  "oauth_flows",
  "users",
  "audit_events",
];

/** `retention_policies.action`. What the purge worker does when the age is reached. */
export type RetentionAction = "purge" | "tombstone" | "drop_partition";

export const RETENTION_ACTION_LABELS: Record<RetentionAction, string> = {
  purge: "Deleted",
  tombstone: "Stripped",
  drop_partition: "Partition dropped",
};

export interface RetentionSubjectInfo {
  subject: RetentionSubject;
  label: string;
  action: RetentionAction;
  note: string;
  /** Written out in full so @nuxt/icon bundles it. */
  icon: string;
  /** Set by the compliance tier and not by the project. Only audit is. */
  fixedByTier: boolean;
}

export const RETENTION_INFO: Record<RetentionSubject, RetentionSubjectInfo> = {
  sessions: {
    subject: "sessions",
    label: "Ended sessions",
    action: "purge",
    icon: "material-symbols:devices",
    note: "A session row after it is revoked or expired. The absolute lifetime is 90 days, so anything past that stopped working long before the sweep reaches it.",
    fixedByTier: false,
  },
  otp_challenges: {
    subject: "otp_challenges",
    label: "One-time code challenges",
    action: "purge",
    icon: "material-symbols:pin-outline",
    note: 'The row that held a code\'s digest and the address it was sent to. It is spent within minutes; what a longer age buys is a support answer to "did we send it", and nothing else.',
    fixedByTier: false,
  },
  oauth_flows: {
    subject: "oauth_flows",
    label: "OAuth flows",
    action: "purge",
    icon: "material-symbols:swap-horiz",
    note: "The state, nonce and encrypted verifier of a sign-in that went via a provider. Single-use and short-lived, kept only long enough to investigate one that went wrong.",
    fixedByTier: false,
  },
  users: {
    subject: "users",
    label: "Deleted accounts",
    action: "tombstone",
    icon: "material-symbols:person-off-outline",
    note: "A soft-deleted account is stripped to a shell at this age: the classified fields go and the id stays, because the audit trail points at it and an erasure that broke the chain would read as tampering.",
    fixedByTier: false,
  },
  audit_events: {
    subject: "audit_events",
    label: "Audit trail",
    action: "drop_partition",
    icon: "material-symbols:history",
    note: "Partitioned by month and aged out a partition at a time rather than by mass delete, which is also why the runtime role needs no DELETE on the table at all.",
    fixedByTier: true,
  },
};

/**
 * The ages a project may choose, per subject, as ISO 8601 durations.
 *
 * Bounded on both sides and per subject rather than one list for everything. A month of
 * ended sessions is generous and a month of OAuth flows is a month of rows nothing will
 * ever read, and offering the same menu for both would invite the wrong answer for one of
 * them.
 */
export const RETENTION_CHOICES: Record<RetentionSubject, readonly string[]> = {
  sessions: ["P7D", "P30D", "P90D", "P180D"],
  otp_challenges: ["P1D", "P7D", "P30D"],
  oauth_flows: ["P1D", "P7D", "P30D"],
  users: ["P7D", "P30D", "P90D", "P365D"],
  audit_events: ["P1Y", "P6Y"],
};

/** What a fresh project is given, which is what the purge worker runs until told otherwise. */
export const RETENTION_DEFAULTS: Record<RetentionSubject, string> = {
  sessions: "P90D",
  otp_challenges: "P1D",
  oauth_flows: "P1D",
  users: "P30D",
  audit_events: "P1Y",
};

/**
 * An ISO 8601 duration in words. Only the shapes the menus above can produce.
 *
 * Days stay days rather than becoming months, because every note on this screen is written
 * in days and a row that said "3 months" beside a sentence about ninety would read as two
 * different numbers. A year is the one exception, since nobody writes 365.
 */
export function retentionLabel(iso: string): string {
  const match = /^P(\d+)([DY])$/.exec(iso);
  if (!match) return iso;
  const count = Number(match[1]);
  if (match[2] === "Y") return count === 1 ? "1 year" : `${count} years`;
  if (count === 365) return "1 year";
  return count === 1 ? "1 day" : `${count} days`;
}

/** The audit subject follows the tier, so the menu and the row agree about which it is. */
export function auditRetentionFor(tier: ProjectTier): string {
  return tier === "hipaa" ? "P6Y" : "P1Y";
}

/*
 * Taking it away.
 */

export interface DeleteEffect {
  id: string;
  label: string;
  note: string;
  /** Written out in full so @nuxt/icon bundles it. */
  icon: string;
  tone: "error" | "warning" | "muted";
}

/**
 * What deleting a project actually does, including the two parts that do not simply
 * vanish.
 *
 * The key is the sharp one and the reason a deletion here is more final than a delete
 * usually is: the wrapped DEK is destroyed, so every column that went through
 * `FieldEncryptor` is unreadable from that moment, in a backup as much as in the database.
 * And the billing record is the honest exception, kept pseudonymously because statutory
 * financial record keeping requires six years of it and a customer who is told "everything
 * is gone" would be told something untrue.
 */
export const DELETE_EFFECTS: readonly DeleteEffect[] = [
  {
    id: "data",
    label: "Every user, session and identity goes",
    note: "Along with the keys, providers, templates, domains and every other row that carries this project's id. Nothing here is recoverable and there is no grace period.",
    icon: "material-symbols:group-off-outline",
    tone: "error",
  },
  {
    id: "keys",
    label: "The project's data key is destroyed",
    note: "Every column encrypted under it becomes unreadable at that moment, in a backup as much as in the database. That is what makes this final rather than merely thorough.",
    icon: "material-symbols:key-off-outline",
    tone: "error",
  },
  {
    id: "api",
    label: "Every key and domain stops resolving",
    note: "Anything still calling with this project's keys is refused from the next request, so a live application signs nobody in and nobody out.",
    icon: "material-symbols:cloud-off-outline",
    tone: "error",
  },
  {
    id: "audit",
    label: "The audit partitions are dropped",
    note: "The chain goes with the project. Export what an auditor will ask for before this, because afterwards there is nothing left to export.",
    icon: "material-symbols:history",
    tone: "warning",
  },
  {
    id: "billing",
    label: "The billing record is kept",
    note: "Pseudonymously, for six years, because statutory financial record keeping requires it. It names no user and holds no personal data of theirs: it is an invoice history and a customer id.",
    icon: "material-symbols:receipt-long-outline",
    tone: "muted",
  },
];

/**
 * Why the name has to be typed to confirm.
 *
 * Not theatre. The switcher makes every project look identical apart from a word in the
 * corner, and the screen somebody is on is the one they last clicked rather than the one
 * they think they are on. Typing the name is the only step that re-establishes which
 * project this is about.
 */
export const DELETE_CONFIRM_NOTE =
  "Type the project's name. Every project looks the same in this panel apart from the word in the corner, and this is the one step that says which one you mean.";
