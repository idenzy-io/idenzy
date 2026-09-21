import {
  RETENTION_CHOICES as PROTOCOL_RETENTION_CHOICES,
  RETENTION_DEFAULTS as PROTOCOL_RETENTION_DEFAULTS,
  type RetentionAction as ProtocolRetentionAction,
  type RetentionSubject as ProtocolRetentionSubject,
  RetentionSubject as RetentionSubjectValues,
} from "@idenzy/protocol/enums/compliance";

/**
 * What a project *is*, as the `projects` row and the cell registry define it, and the very
 * short list of it a customer gets to change (PROJECT.md 4.13).
 *
 * Most of this screen is not settings, and that is the honest shape of the table rather
 * than a gap. A project is the unit of tenancy, of key custody and of residency: its cell
 * is immutable after creation because moving it is an audited migration and never an
 * `UPDATE` — enforced by a trigger since 0063, not merely intended — its tier is a contract
 * before it is a column, and its key custody is meant to sit in KMS where nothing in a dashboard
 * could reach it. Three of the five fields a customer might expect to edit are decisions taken
 * once, and a screen that offered them as controls would be offering to do something the
 * platform refuses.
 *
 * Which of those are *deployed* rather than designed is the business of the `ControlCapability`
 * declarations below, because this screen spent a while asserting several that were not.
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
 * What it is held to.
 */

export type ProjectTier = "standard" | "hipaa";

export const PROJECT_TIERS: readonly ProjectTier[] = ["standard", "hipaa"];

export const TIER_LABELS: Record<ProjectTier, string> = {
  standard: "Standard",
  hipaa: "HIPAA",
};

/**
 * The tier as one of the two this panel knows how to describe.
 *
 * Total on purpose. `projects.compliance_tier` is a text column and every label, note and
 * retention figure on the settings screen is a lookup keyed on it, so a value this build has
 * not heard of would be `undefined` inside a render rather than a row that reads oddly — the
 * same way an unknown sign-in method once emptied the users table. Standard is the safe
 * reading: it is what a project is created as, and it describes fewer promises rather than
 * more.
 */
export function projectTierOf(value: string | undefined): ProjectTier {
  return PROJECT_TIERS.includes(value as ProjectTier) ? (value as ProjectTier) : "standard";
}

/** Years of audit trail the tier buys. Nothing sweeps to it yet: AUDIT_RETENTION_ENFORCEMENT. */
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
 * What this deployment can actually do.
 *
 * The same shape `data-requests.ts` uses for the same reason. This screen used to assert ten
 * infrastructure facts in the present tense — keys in KMS, cross-cell access refused, key
 * administrators separated from key users — and five of them were not true of the code. A
 * customer reading a security reference is the last person who should be shown a design as
 * though it were a deployment, and `notes/settings.md` P1 says so directly: show actual
 * environment capability, and do not use a fixture tier as a compliance attestation.
 *
 * A `running: false` constant is not a drifting hardcode. It changes when the control is built,
 * which is a code change either way — unlike an asserted fact, which stays true-looking forever.
 */

export interface ControlCapability {
  /** Whether the control runs here, as opposed to being designed for. */
  running: boolean;
  /** What to show in its place. Short: it sits in one cell of a fact grid. */
  value: string;
  /** The sentence behind the glyph. Where it is not running, why. */
  reason: string;
}

export const KMS_SIGNING: ControlCapability = {
  running: false,
  value: "Not in KMS yet",
  reason:
    "The design is a per-project key whose private half never leaves KMS, so a copy of our database yields nothing that can mint a token. It is not what runs: KmsEs256Issuer does not exist, and the only issuer built signs with an in-process key that is regenerated on restart. Development is the only environment that boots at all.",
};

export const WRAPPED_DEK: ControlCapability = {
  running: false,
  value: "Not wrapped yet",
  reason:
    "The design is a per-project data encryption key wrapped by this cell's key ring, so a key compromise reaches one tenant rather than one region. Nothing populates it: the column exists and is empty, and field-level encryption currently runs under a key derived from the cell code in development only.",
};

export const KEY_ADMIN_SEPARATION: ControlCapability = {
  running: false,
  value: "Not yet separated",
  reason:
    "The design is that key administrators are not key users and every signing call is recorded in the cloud audit log. There is no KMS here yet, so there are no key administrators to separate and no such log.",
};

export const CROSS_CELL_REFUSAL: ControlCapability = {
  running: true,
  value: "Refused",
  reason:
    "A request resolving to a project in another cell is refused rather than proxied, so data cannot transit a jurisdiction by accident. Your keys carry the region they belong to, so one presented to the wrong endpoint is refused on the key itself before anything is looked up — and the refusal names the endpoint to use instead. A request arriving on a custom domain carries no key, so that one is checked once the project is known.",
};

export const AUDIT_RETENTION_ENFORCEMENT: ControlCapability = {
  running: false,
  value: "Not swept yet",
  reason:
    "The age is real and the tier sets it. What does not run is the pass that applies it: audit entries are kept in monthly partitions and nothing drops one, so the trail currently grows past this age rather than ageing out of it.",
};

/** The oldest one in effect here, and still the one that matters most. */
export const TENANT_ISOLATION: ControlCapability = {
  running: true,
  value: "At the database",
  reason:
    "Every tenant table is filtered by the project id at the database, and this project's own row is filtered by its id too. Reading another project's row is not an oversight waiting to be fixed: the policy returns nothing, whatever the application asks for. Asserted by tests that try it and fail.",
};

/*
 * What a project holds, as this screen reads it.
 */

export interface ProjectFacts {
  /** The public id, `prj_` and an opaque body, as every API surface names a project. */
  id: string;
  name: string;
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

/*
 * The vocabulary is the protocol's rather than this file's, because the sweeper runs on it.
 * A second copy here is how a menu comes to offer an age the API refuses, or a screen comes
 * to say ninety days about a delete running at thirty — the same reason the origins dialog
 * took `browserOriginSchema` instead of keeping its own rule.
 */
export type RetentionSubject = ProtocolRetentionSubject;

export const RETENTION_SUBJECTS: readonly RetentionSubject[] = [
  RetentionSubjectValues.Sessions,
  RetentionSubjectValues.OtpChallenges,
  RetentionSubjectValues.OauthFlows,
  RetentionSubjectValues.Users,
  RetentionSubjectValues.AuditEvents,
];

/** `retention_policies.action`. What the purge worker does when the age is reached. */
export type RetentionAction = ProtocolRetentionAction;

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
 * The ages a project may choose, per subject, and what it is swept at until it chooses.
 *
 * Re-exported from the protocol rather than declared, so the menu offers exactly what the
 * API accepts and the default shown is the one the sweeper resolves. Both lists are read by
 * the SQL that does the deleting, which is what makes them worth having once.
 */
export const RETENTION_CHOICES = PROTOCOL_RETENTION_CHOICES;

export const RETENTION_DEFAULTS = PROTOCOL_RETENTION_DEFAULTS;

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
    label: "The audit trail is deleted",
    note: "Every entry for this project, and the chain over them. Export what an auditor will ask for before this, because afterwards the only record is that a deletion happened.",
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
