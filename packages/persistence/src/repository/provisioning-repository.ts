import { randomUUID } from "node:crypto";
import { ResourceConflictError } from "@idenzy/core/errors";
import { MemberRole } from "@idenzy/protocol/enums/tenancy";
import { onboardingResponses, orgMembers, orgs } from "../schema/organisation.js";
import { projects } from "../schema/projects.js";
import type { Transaction } from "../tenancy/unit-of-work.js";
import { AbstractRepository } from "./abstract-repository.js";

export interface NewOrganisation {
  readonly orgName: string;
  readonly ownerUserId: string;
  readonly projectName: string;
  readonly complianceTier: string;
}

export interface OnboardingAnswers {
  readonly useCase: string | null;
  readonly heardFrom: string | null;
}

export interface ProvisionedOrganisation {
  readonly orgId: string;
  readonly memberId: string;
  readonly projectId: string;
}

/**
 * Brings an organisation into existence: the org, its first member, its first project.
 *
 * The one subclass of `AbstractRepository` that holds no scope, and the reason the base
 * exists without one. Every other repository operates inside a tenant; this one *creates*
 * the tenant, so there is nothing to be scoped to until its first statement has run.
 *
 * It is only usable inside `UnitOfWork.provision`, which binds `app.org_id` to an id it
 * generated itself. That is not a convention: outside that transaction every insert here
 * fails its WITH CHECK, so a caller who tried to use this repository anywhere else gets a
 * refusal rather than a row in somebody else's organisation.
 *
 * All three rows in one transaction because there is no useful state between them. An
 * organisation with no owner is one nobody can administer, and one with no project is a
 * dead end the panel would have to render. A customer who abandons the form leaves
 * nothing behind and can start again.
 */
export class ProvisioningRepository extends AbstractRepository {
  constructor(
    tx: Transaction,
    private readonly orgId: string,
  ) {
    super(tx);
  }

  async create(input: NewOrganisation): Promise<ProvisionedOrganisation> {
    return await this.guard(async () => {
      const [org] = await this.tx
        .insert(orgs)
        .values({ id: this.orgId, name: input.orgName })
        .returning({ id: orgs.id });
      if (org === undefined) throw new ResourceConflictError({ detail: { reason: "org" } });

      const [member] = await this.tx
        .insert(orgMembers)
        .values({
          orgId: this.orgId,
          userId: input.ownerUserId,
          // The founder was invited by nobody, which `invited_by` says by being null.
          role: MemberRole.Owner,
        })
        .returning({ id: orgMembers.id });
      if (member === undefined) throw new ResourceConflictError({ detail: { reason: "member" } });

      // The id is chosen here so the key name can be derived from it in the same
      // statement. Unlike the organisation's, it is not security-relevant: the policy on
      // `projects` checks `org_id` against the bound organisation, so the project's own
      // id decides nothing about who may write the row.
      const projectId = randomUUID();
      const [project] = await this.tx
        .insert(projects)
        .values({
          id: projectId,
          orgId: this.orgId,
          name: input.projectName,
          complianceTier: input.complianceTier,
          // Derived rather than stored arbitrarily, so it is already right when the KMS
          // issuer lands. Nothing creates the key this names yet (PROJECT.md 4.2), which
          // is why `auth-api` still refuses to boot outside development.
          kmsKeyName: `projects/${projectId}/keys/signing`,
        })
        .returning({ id: projects.id });
      if (project === undefined) throw new ResourceConflictError({ detail: { reason: "project" } });

      return { orgId: this.orgId, memberId: member.id, projectId: project.id };
    });
  }

  /** The optional half of getting started. No row at all where nothing was answered. */
  async recordAnswers(memberId: string, answers: OnboardingAnswers): Promise<void> {
    if (answers.useCase === null && answers.heardFrom === null) return;
    await this.guard(() =>
      this.tx
        .insert(onboardingResponses)
        .values({ orgId: this.orgId, submittedBy: memberId, ...answers })
        .onConflictDoNothing(),
    );
  }
}
