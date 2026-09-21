import { classified, controlTable } from "@idenzy/compliance/classification/classified";
import {
  DataClass,
  Erasure,
  Purpose,
  Retention,
  SubjectPopulation,
} from "@idenzy/compliance/classification/vocabulary";
import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { config } from "./presets.js";
import { createdAtColumn, orgIdColumn, orgIsolationPolicy, updatedAtColumn } from "./shared.js";

/**
 * The team of an organisation (ADR-0011, PROJECT.md 4.13.7).
 *
 * A person is invited to an *organisation* and reaches every project under it, which is
 * what `projects.org_id` already says and what the panel's members screen is built on.
 * Scoping a membership to a project would tell somebody their access ended when it had
 * ended on one application of three.
 *
 * Two invariants hold the whole surface up, and both are stated as indexes rather than
 * left to application code: one person is on the team once, and there is exactly one
 * owner, always. A transfer that promoted before it demoted would otherwise pass review,
 * pass tests, and leave two owners arguing over which may remove the other.
 *
 * `user_id` carries no foreign key, and that is deliberate twice over. The dashboard runs
 * on our own product (PROJECT.md 9.5), so a member is a `users` row of Idenzy's own
 * project; but `users` is a tenant table inside a region cell, and cells are independent
 * stacks (PROJECT.md 4.13.5). A control-plane row that referenced one could not survive
 * the cell being separate, which is the property residency claims rest on. `org_id`
 * carries none either, for the same reason `projectIdColumn` does not.
 */
export const orgMembers = controlTable(
  "org_members",
  {
    id: classified(uuid("id").primaryKey().defaultRandom(), { ...config, loggable: true }),
    orgId: orgIdColumn(),
    userId: classified(uuid("user_id").notNull(), {
      class: DataClass.Pseudonymous,
      purpose: Purpose.AccountManagement,
      retention: Retention.ProjectLifetime,
      erasure: Erasure.RetainPseudonymous,
      loggable: true,
      note: "The member's user id in Idenzy's own project. No FK: cells are independent (4.13.5).",
    }),
    role: classified(text("role").notNull(), {
      ...config,
      purpose: Purpose.AccountManagement,
      loggable: true,
      note: "MemberRole. Exactly one 'owner' per organisation, held by a partial unique index.",
    }),
    invitedBy: classified(uuid("invited_by"), {
      ...config,
      purpose: Purpose.AuditAndCompliance,
      note: "The member who invited them. Null on the founder, who was invited by nobody.",
    }),
    createdAt: createdAtColumn(),
    lastActiveAt: classified(timestamp("last_active_at", { withTimezone: true }), {
      class: DataClass.Operational,
      purpose: Purpose.SecurityAndAbusePrevention,
      retention: Retention.ProjectLifetime,
      erasure: Erasure.NotApplicable,
      note: "What makes a dormant seat visible on the members screen.",
    }),
  },
  (t) => [
    uniqueIndex("org_members_org_user_key").on(t.orgId, t.userId),
    uniqueIndex("org_members_single_owner_key").on(t.orgId).where(sql`role = 'owner'`),
    index("org_members_user_idx").on(t.userId),
    orgIsolationPolicy("org_members"),
  ],
).enableRLS();

/**
 * An invitation to join an organisation, until it is accepted, revoked or expires.
 *
 * The address is held in the clear rather than hashed, unlike an OTP or magic-link target
 * (PROJECT.md 4.13.4). Those are hashed because the system only ever needs to compare
 * one; this is displayed back on the members screen so the team can see who has been
 * asked and resend to them, and a column nobody can read cannot do that job.
 *
 * What is hashed is the token in the link. It is a bearer credential that joins somebody
 * to an organisation, so the rule every other token in this schema follows applies: store
 * what proves a match, never what grants access.
 */
export const orgInvitations = controlTable(
  "org_invitations",
  {
    id: classified(uuid("id").primaryKey().defaultRandom(), { ...config, loggable: true }),
    orgId: orgIdColumn(),
    email: classified(text("email").notNull(), {
      class: DataClass.Pii,
      purpose: Purpose.AccountManagement,
      retention: Retention.Days30,
      subjectField: true,
      erasure: Erasure.RowDeleted,
      note: "The invitee's address. Shown back on the members screen, so not hashed.",
    }),
    role: classified(text("role").notNull(), {
      ...config,
      purpose: Purpose.AccountManagement,
      loggable: true,
      note: "MemberRole, never 'owner': ownership moves by transfer (ASSIGNABLE_MEMBER_ROLES).",
    }),
    tokenHash: classified(text("token_hash").notNull().unique(), {
      class: DataClass.Secret,
      purpose: Purpose.AccountManagement,
      retention: Retention.Days30,
      erasure: Erasure.RowDeleted,
      note: "SHA-256 of the link's token. The token itself is shown once, in the email.",
    }),
    invitedBy: classified(uuid("invited_by").notNull(), {
      ...config,
      purpose: Purpose.AuditAndCompliance,
      note: "The org_members row that sent it. Kept when they leave, so the trail survives them.",
    }),
    createdAt: createdAtColumn(),
    expiresAt: classified(timestamp("expires_at", { withTimezone: true }).notNull(), {
      ...config,
      purpose: Purpose.SecurityAndAbusePrevention,
      loggable: true,
      note: "A week. Long enough for somebody on holiday, short enough that a link in an unread mailbox is not a way in a year later.",
    }),
    acceptedAt: classified(timestamp("accepted_at", { withTimezone: true }), {
      ...config,
      purpose: Purpose.AuditAndCompliance,
    }),
    revokedAt: classified(timestamp("revoked_at", { withTimezone: true }), {
      ...config,
      purpose: Purpose.AuditAndCompliance,
    }),
  },
  (t) => [
    // One outstanding invitation per address. Partial, because somebody invited once who
    // joined and later left has to be invitable again, and a plain unique index would
    // refuse that for ever.
    uniqueIndex("org_invitations_org_email_open_key")
      .on(t.orgId, t.email)
      .where(sql`accepted_at is null and revoked_at is null`),
    index("org_invitations_expires_idx").on(t.expiresAt),
    orgIsolationPolicy("org_invitations"),
  ],
  {
    population: SubjectPopulation.CustomerStaff,
    locatedBy: "email",
    note: "The address is held in the clear because the members screen shows who has been asked, so it is also how the invitee is found.",
  },
).enableRLS();

/**
 * Whether the organisation demands a second factor of its own team on our dashboard.
 *
 * Its own table rather than a column on `orgs`, because `orgs` is the control plane's
 * billing identity and is read by provisioning and the cell registry, while this is a
 * security setting the members screen writes. Keeping them apart also keeps the shared
 * isolation policy usable: `orgs` is keyed on its own `id` and needs a hand-written one.
 *
 * A missing row means not required, which is the same answer as `require_mfa = false` and
 * is what an organisation that has never opened the screen should get.
 */
export const orgSecuritySettings = controlTable(
  "org_security_settings",
  {
    orgId: orgIdColumn(),
    requireMfa: classified(boolean("require_mfa").notNull().default(false), {
      ...config,
      purpose: Purpose.SecurityAndAbusePrevention,
      loggable: true,
      note: "Our dashboard only. A customer's own users are governed by their project's rules.",
    }),
    updatedBy: classified(uuid("updated_by"), {
      ...config,
      purpose: Purpose.AuditAndCompliance,
      note: "The member who last changed it, for the audit trail as much as for the reader.",
    }),
    updatedAt: updatedAtColumn(),
  },
  (t) => [primaryKey({ columns: [t.orgId] }), orgIsolationPolicy("org_security_settings")],
).enableRLS();

/**
 * What the person who created the organisation told us on the way in.
 *
 * Every field is optional and the row exists only once somebody answered something. The
 * required half of getting started — the project's name and where it lives — is not here:
 * that is a `projects` row, and a copy of it in a survey table would be a second answer to
 * a question with one.
 *
 * Classified as personal data rather than as analytics, which is the point of it having a
 * table instead of a `jsonb` column on `orgs`. These are free-text answers a named person
 * gave about themselves and their work, they are attributable through `submitted_by`, and
 * "what are you building" is the field most likely to contain something its author would
 * not expect to find in an export. A blob would have been one `classified()` declaration
 * covering fields nobody enumerated, and the generators would have had nothing to list.
 *
 * `Retention.Years1` rather than the project's lifetime: this informs what we build next
 * and stops being worth keeping long before the organisation does.
 */
export const onboardingResponses = controlTable(
  "onboarding_responses",
  {
    orgId: orgIdColumn(),
    submittedBy: classified(uuid("submitted_by").notNull(), {
      class: DataClass.Pseudonymous,
      purpose: Purpose.ServiceConfiguration,
      retention: Retention.Years1,
      erasure: Erasure.RetainPseudonymous,
      note: "The org_members row that answered. Who said it is part of what makes it useful.",
    }),
    useCase: classified(text("use_case"), {
      class: DataClass.Pii,
      purpose: Purpose.ServiceConfiguration,
      retention: Retention.Years1,
      subjectField: true,
      erasure: Erasure.NullOut,
      note: "Free text: what they are building. Optional, and skipping it is a normal answer.",
    }),
    heardFrom: classified(text("heard_from"), {
      class: DataClass.Pii,
      purpose: Purpose.ServiceConfiguration,
      retention: Retention.Years1,
      subjectField: true,
      erasure: Erasure.NullOut,
      note: "Free text: how they found us. Optional.",
    }),
    submittedAt: classified(
      timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
      {
        ...config,
        purpose: Purpose.ServiceConfiguration,
        retention: Retention.Years1,
        loggable: true,
      },
    ),
  },
  (t) => [primaryKey({ columns: [t.orgId] }), orgIsolationPolicy("onboarding_responses")],
  {
    population: SubjectPopulation.CustomerStaff,
    locatedBy: "org_id",
    note: "Free text somebody on the customer's team wrote. Attributed to the organisation rather than to a person, so it is reached by org.",
  },
).enableRLS();
