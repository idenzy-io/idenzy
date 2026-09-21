import { ValidationFailedError } from "@idenzy/core/errors";
import { OrgProjectRepository } from "@idenzy/persistence/repository/org-project-repository";
import { RetentionPolicyRepository } from "@idenzy/persistence/repository/retention-policy-repository";
import type { OrgContext } from "@idenzy/persistence/tenancy/org-context";
import { UnitOfWork } from "@idenzy/persistence/tenancy/unit-of-work";
import {
  CONFIGURABLE_RETENTION_SUBJECTS,
  RETENTION_ACTIONS,
  RETENTION_CHOICES,
  RETENTION_DEFAULTS,
  RetentionSubject,
} from "@idenzy/protocol/enums/compliance";
import type { RetentionPolicy } from "@idenzy/protocol/schemas/management";
import { Injectable } from "@nestjs/common";
import { ProjectScope } from "../tenancy/project-scope.js";

/** Years of audit trail each compliance tier buys. Partitions are dropped on this schedule. */
const TIER_AUDIT_AGE: Readonly<Record<string, string>> = { standard: "P1Y", hipaa: "P6Y" };

/**
 * What the purge worker sweeps, and when (PROJECT.md 4.13.6).
 *
 * Every subject is answered for, always, and only some of them are stored. That asymmetry is
 * the whole design: `retention_policies` holds overrides, the sweeper resolves the default in
 * SQL for a project that has none, and a read that returned only the stored rows would leave a
 * screen unable to distinguish "kept for 90 days because nobody has chosen" from "not swept at
 * all". `source` is how the answer says which it is.
 *
 * The audit subject is answered for and refused as a write. Its age is the compliance tier's
 * promise to an auditor rather than an operator's preference, and it moves by agreement — so a
 * stored override of it would be a number the partition schedule ignores, which is worse than
 * no control at all.
 */
@Injectable()
export class RetentionService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly scope: ProjectScope,
  ) {}

  /** Every subject, with the stored age where there is one and the resolved age where not. */
  async list(context: OrgContext, projectId: string): Promise<readonly RetentionPolicy[]> {
    const tenant = await this.scope.of(context, projectId);
    const stored = await this.uow.transaction((tx) =>
      new RetentionPolicyRepository(tx, tenant).list(),
    );
    const bySubject = new Map(stored.map((row) => [row.subject, row]));
    // The tier decides the audit age and nothing else here. Read through the org plane's own
    // policy, which is the same read `ProjectScope` used to prove the project is the caller's.
    const project = await this.uow.transaction((tx) =>
      new OrgProjectRepository(tx, context).findById(tenant.projectId),
    );
    const tier = project?.complianceTier ?? "standard";

    return Object.values(RetentionSubject).map((subject) => {
      if (subject === RetentionSubject.AuditEvents) {
        return {
          subject,
          maxAge: TIER_AUDIT_AGE[tier] ?? RETENTION_DEFAULTS[subject],
          action: RETENTION_ACTIONS[subject],
          source: "tier" as const,
        };
      }
      const row = bySubject.get(subject);
      return {
        subject,
        maxAge: row?.maxAge ?? RETENTION_DEFAULTS[subject],
        action: RETENTION_ACTIONS[subject],
        source: row === undefined ? ("default" as const) : ("project" as const),
      };
    });
  }

  /**
   * Stores one age.
   *
   * The subject and the age are checked against the same tables the sweeper resolves from, and
   * separately, because they are different mistakes: an unknown subject is a caller using a
   * vocabulary this build does not have, and an age outside the menu is one asking for a
   * schedule that was never offered. A closed list rather than a bound, because the value is
   * cast to an `interval` inside a SECURITY DEFINER function and a free-text duration is not
   * something to hand to one.
   */
  async set(
    context: OrgContext,
    projectId: string,
    subject: RetentionSubject,
    maxAge: string,
  ): Promise<RetentionPolicy> {
    if (!CONFIGURABLE_RETENTION_SUBJECTS.includes(subject)) {
      throw new ValidationFailedError({
        message:
          subject === RetentionSubject.AuditEvents
            ? "Audit retention follows the project's compliance tier and is not set here."
            : "That is not a subject retention can be set for.",
        fields: [{ path: "subject", code: "not_configurable" }],
      });
    }
    if (!RETENTION_CHOICES[subject].includes(maxAge)) {
      throw new ValidationFailedError({
        message: `That is not an age this subject can be kept for. Choose one of ${RETENTION_CHOICES[subject].join(", ")}.`,
        fields: [{ path: "maxAge", code: "unknown_age" }],
      });
    }

    const tenant = await this.scope.of(context, projectId);
    const action = RETENTION_ACTIONS[subject];
    const row = await this.uow.transaction((tx) =>
      new RetentionPolicyRepository(tx, tenant).set(subject, maxAge, action),
    );
    return { subject, maxAge: row.maxAge, action, source: "project" };
  }
}
