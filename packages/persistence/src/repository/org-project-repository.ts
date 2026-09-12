import { randomUUID } from "node:crypto";
import { ResourceConflictError } from "@idenzy/core/errors";
import { asc, eq } from "drizzle-orm";
import { projects } from "../schema/projects.js";
import type { OrgContext } from "../tenancy/org-context.js";
import type { Transaction } from "../tenancy/unit-of-work.js";
import { OrgRepository } from "./org-repository.js";

export interface OrgProjectRow {
  readonly id: string;
  readonly name: string;
  readonly cellId: string;
  readonly plan: string;
  readonly complianceTier: string;
  readonly createdAt: Date;
}

export interface NewOrgProject {
  readonly name: string;
  readonly cellId: string;
  readonly complianceTier: string;
}

/**
 * The projects an organisation holds, from the organisation's side (ADR-0011).
 *
 * Distinct from `ProjectRepository`, which answers "the project I am" for auth-api with
 * one project bound. This answers "the projects I own" for the panel with one
 * organisation bound, and the two exist separately because they read the same table
 * through different policies — `projects` carries one for each plane precisely so both
 * questions have an answer.
 *
 * `orgScope()` works here because `projects` carries `org_id`, so the predicate and the
 * policy match column for column, as they do on every other org-keyed table.
 */
export class OrgProjectRepository extends OrgRepository<typeof projects> {
  constructor(tx: Transaction, context: OrgContext) {
    super(tx, context, projects);
  }

  async list(): Promise<OrgProjectRow[]> {
    const rows = await this.tx
      .select()
      .from(projects)
      .where(this.orgScope())
      .orderBy(asc(projects.createdAt), asc(projects.id));
    return rows.map(toRow);
  }

  async findById(id: string): Promise<OrgProjectRow | null> {
    const rows = await this.tx.select().from(projects).where(eq(projects.id, id)).limit(1);
    const row = rows[0];
    // The policy already restricts this to the bound organisation, so a row that comes
    // back is one this caller may see. The `orgScope()` predicate is the first line and
    // is applied by `list`; here the id is the filter and the policy is what makes it safe.
    return row === undefined || row.orgId !== this.context.orgId ? null : toRow(row);
  }

  /**
   * Adds a project to the organisation already bound.
   *
   * The organisation is not a parameter, and that is the guard: `org_id` comes from the
   * context the request was authorised against, so there is no field a caller could set
   * to put a project somewhere else. The policy's WITH CHECK refuses it besides.
   */
  async create(project: NewOrgProject): Promise<OrgProjectRow> {
    const id = randomUUID();
    const rows = await this.guard(() =>
      this.tx
        .insert(projects)
        .values({
          id,
          orgId: this.context.orgId,
          name: project.name,
          cellId: project.cellId,
          complianceTier: project.complianceTier,
          kmsKeyName: `projects/${id}/keys/signing`,
        })
        .returning(),
    );
    const row = rows[0];
    if (row === undefined) throw new ResourceConflictError({ detail: { name: project.name } });
    return toRow(row);
  }
}

function toRow(row: typeof projects.$inferSelect): OrgProjectRow {
  return {
    id: row.id,
    name: row.name,
    cellId: row.cellId,
    plan: row.plan,
    complianceTier: row.complianceTier,
    createdAt: row.createdAt,
  };
}
