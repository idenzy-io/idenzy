import { ValidationFailedError } from "@idenzy/core/errors";
import { PublicId } from "@idenzy/core/value-objects/public-id";
import {
  OrgProjectRepository,
  type OrgProjectRow,
} from "@idenzy/persistence/repository/org-project-repository";
import { RegionCellReader } from "@idenzy/persistence/repository/region-cell-reader";
import type { OrgContext } from "@idenzy/persistence/tenancy/org-context";
import { UnitOfWork } from "@idenzy/persistence/tenancy/unit-of-work";
import { ComplianceTier } from "@idenzy/protocol/enums/tenancy";
import { IdPrefix } from "@idenzy/protocol/schemas/common";
import type { CreateProject, ProjectSummary } from "@idenzy/protocol/schemas/management";
import { Injectable } from "@nestjs/common";

/**
 * The projects an organisation holds, and adding another one.
 *
 * Every call runs inside `runForOrg`, so `app.org_id` is bound and the repository carries
 * the predicate itself. The organisation is never a parameter on the write: it comes from
 * the context the request was authorised against, so there is no field a caller could set
 * to put a project somewhere else, and the policy refuses it besides (ADR-0011).
 */
@Injectable()
export class ProjectsService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly regions: RegionCellReader,
  ) {}

  async list(context: OrgContext): Promise<ProjectSummary[]> {
    const cells = await this.regions.active();
    const codes = new Map(cells.map((cell) => [cell.id, cell.code]));
    const rows = await this.uow.runForOrg(context, (tx) =>
      new OrgProjectRepository(tx, context).list(),
    );
    const orgId = PublicId.encode(IdPrefix.Org, context.orgId).value;
    return rows.map((row) => present(row, codes.get(row.cellId) ?? row.cellId, orgId));
  }

  /**
   * A second project, which is a different act from getting started and reads as one.
   *
   * The region is asked again rather than inherited from the organisation's first
   * project. Two products under one organisation can genuinely need different residency,
   * and defaulting it would pin the second somewhere nobody chose.
   */
  async create(context: OrgContext, input: CreateProject): Promise<ProjectSummary> {
    const cell = await this.regions.byCode(input.region);
    if (cell === null) {
      throw new ValidationFailedError({
        message: "That is not a region we run.",
        fields: [{ path: "region", code: "unknown_region" }],
      });
    }
    const row = await this.uow.runForOrg(context, (tx) =>
      new OrgProjectRepository(tx, context).create({
        name: input.name,
        cellId: cell.id,
        complianceTier: ComplianceTier.Standard,
      }),
    );
    return present(row, cell.code, PublicId.encode(IdPrefix.Org, context.orgId).value);
  }
}

function present(row: OrgProjectRow, region: string, orgId: string): ProjectSummary {
  return {
    id: PublicId.encode(IdPrefix.Project, row.id).value,
    orgId,
    name: row.name,
    region,
    plan: row.plan,
    complianceTier: row.complianceTier,
    createdAt: row.createdAt.toISOString(),
  };
}
