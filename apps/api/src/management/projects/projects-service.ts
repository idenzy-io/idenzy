import { ResourceConflictError, ResourceNotFoundError } from "@idenzy/core/errors";
import { PublicId } from "@idenzy/core/value-objects/public-id";
import {
  OrgProjectRepository,
  type OrgProjectRow,
} from "@idenzy/persistence/repository/org-project-repository";
import type { OrgContext } from "@idenzy/persistence/tenancy/org-context";
import { UnitOfWork } from "@idenzy/persistence/tenancy/unit-of-work";
import { ComplianceTier } from "@idenzy/protocol/enums/tenancy";
import { IdPrefix } from "@idenzy/protocol/schemas/common";
import type {
  CreateProject,
  ProjectDetail,
  ProjectSummary,
} from "@idenzy/protocol/schemas/management";
import { Injectable } from "@nestjs/common";

/**
 * The projects an organisation holds, and adding another one.
 *
 * Every call runs inside a transaction with an `OrgContext`, so the repository carries the
 * predicate itself. The organisation is never a parameter on the write: it comes from the
 * context the request was authorised against, so there is no field a caller could set to put a
 * project somewhere else (ADR-0011).
 */
@Injectable()
export class ProjectsService {
  constructor(private readonly uow: UnitOfWork) {}

  async list(context: OrgContext): Promise<ProjectSummary[]> {
    const rows = await this.uow.transaction((tx) => new OrgProjectRepository(tx, context).list());
    const orgId = PublicId.encode(IdPrefix.Org, context.orgId).value;
    return rows.map((row) => present(row, orgId));
  }

  /** One project in full, for the General settings screen. */
  async detail(context: OrgContext, publicProjectId: string): Promise<ProjectDetail> {
    const id = PublicId.parse(IdPrefix.Project, publicProjectId).uuid;
    const row = await this.uow.transaction((tx) =>
      new OrgProjectRepository(tx, context).findById(id),
    );
    if (row === null) throw new ResourceNotFoundError({ detail: { projectId: publicProjectId } });
    return {
      id: PublicId.encode(IdPrefix.Project, row.id).toString(),
      orgId: PublicId.encode(IdPrefix.Org, context.orgId).toString(),
      name: row.name,
      tier: row.complianceTier,
      plan: row.plan,
      createdAt: row.createdAt.toISOString(),
    };
  }

  async rename(context: OrgContext, publicProjectId: string, name: string): Promise<ProjectDetail> {
    const id = PublicId.parse(IdPrefix.Project, publicProjectId).uuid;
    const row = await this.uow.transaction((tx) =>
      new OrgProjectRepository(tx, context).rename(id, name),
    );
    if (row === null) throw new ResourceNotFoundError({ detail: { projectId: publicProjectId } });
    return await this.detail(context, publicProjectId);
  }

  /**
   * Deletes a project, and refuses to delete the last one.
   *
   * The refusal is here rather than only on the screen because it is a rule about the data
   * rather than about the UI: an organisation with no project has nothing for its members to
   * sign in to and no screen in the panel that means anything, so the state has no way out.
   *
   * Everything keyed on the project goes with it: users, sessions, keys and the rest by the
   * cascade added in 0060, and the audit trail through `purge_project`, which is separate
   * because the app role has no DELETE on an append-only table (PROJECT.md 4.13.3). The purge
   * leaves a `project_purges` row behind, which is the only evidence that survives it.
   */
  async remove(context: OrgContext, publicProjectId: string): Promise<void> {
    const id = PublicId.parse(IdPrefix.Project, publicProjectId).uuid;
    await this.uow.transaction(async (tx) => {
      const repository = new OrgProjectRepository(tx, context);
      const all = await repository.list();
      if (all.length <= 1) {
        throw new ResourceConflictError({
          message: "An organisation needs at least one project.",
          detail: { projectId: publicProjectId },
        });
      }
      const purge = await repository.remove(id);
      if (purge === null) {
        throw new ResourceNotFoundError({ detail: { projectId: publicProjectId } });
      }
    });
  }

  /** A second project, which is a different act from getting started and reads as one. */
  async create(context: OrgContext, input: CreateProject): Promise<ProjectSummary> {
    const row = await this.uow.transaction((tx) =>
      new OrgProjectRepository(tx, context).create({
        name: input.name,
        complianceTier: ComplianceTier.Standard,
      }),
    );
    return present(row, PublicId.encode(IdPrefix.Org, context.orgId).value);
  }
}

function present(row: OrgProjectRow, orgId: string): ProjectSummary {
  return {
    id: PublicId.encode(IdPrefix.Project, row.id).value,
    orgId,
    name: row.name,
    plan: row.plan,
    complianceTier: row.complianceTier,
    createdAt: row.createdAt.toISOString(),
  };
}
