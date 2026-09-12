import { ResourceNotFoundError } from "@idenzy/core/errors";
import { PublicId } from "@idenzy/core/value-objects/public-id";
import { OrgProjectRepository } from "@idenzy/persistence/repository/org-project-repository";
import type { OrgContext } from "@idenzy/persistence/tenancy/org-context";
import { TenantContext } from "@idenzy/persistence/tenancy/tenant-context";
import { UnitOfWork } from "@idenzy/persistence/tenancy/unit-of-work";
import { IdPrefix } from "@idenzy/protocol/schemas/common";
import { Injectable } from "@nestjs/common";

/**
 * Turns a project id from a URL into a tenant scope, and refuses to do it for a project
 * the caller's organisation does not own.
 *
 * This exists because the two planes meet here. The guard proved membership of an
 * organisation and bound `app.org_id`; `api_keys`, `users`, `sessions` and every other
 * tenant table is keyed on `app.project_id`, so something has to bind the second key — and
 * binding it from a path parameter without checking would be the whole hole. A caller
 * could name any project id and read its keys.
 *
 * The check is a read through the org plane's own policy, which is what makes it sound
 * rather than a comparison somebody could forget: `OrgProjectRepository.findById` runs
 * inside `runForOrg`, so a project belonging to another organisation is not "found and
 * rejected", it is simply not there. The database decides, not this file.
 *
 * Two transactions rather than one, and the gap between them is safe for a specific
 * reason: `projects.org_id` is immutable. A project is pinned to its organisation at
 * creation and moving one is an audited migration rather than an `UPDATE` (PROJECT.md
 * 4.13.5), so the answer cannot change between the check and the use.
 */
@Injectable()
export class ProjectScope {
  constructor(private readonly uow: UnitOfWork) {}

  /**
   * The tenant context for a project the caller may act on.
   *
   * Not found and not yours are deliberately the same answer, as they are one plane up: a
   * project somebody is not entitled to must not be distinguishable from one that does not
   * exist, or the id space becomes an oracle for what our customers have built.
   */
  async of(context: OrgContext, publicProjectId: string): Promise<TenantContext> {
    const projectId = PublicId.parse(IdPrefix.Project, publicProjectId).uuid;

    const project = await this.uow.runForOrg(context, (tx) =>
      new OrgProjectRepository(tx, context).findById(projectId),
    );
    if (project === null) {
      throw new ResourceNotFoundError({ detail: { projectId: publicProjectId } });
    }

    // The actor is the membership and not the person, which is what the audit trail wants:
    // "who did this, acting for whom" is answered by one id rather than two lookups.
    return new TenantContext(projectId, context.requestId, "customer_staff", context.actorId);
  }
}
