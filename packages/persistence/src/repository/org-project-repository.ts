import { randomUUID } from "node:crypto";
import { ResourceConflictError } from "@idenzy/core/errors";
import { and, asc, eq, sql } from "drizzle-orm";
import { projects } from "../schema/projects.js";
import type { OrgContext } from "../tenancy/org-context.js";
import type { Transaction } from "../tenancy/unit-of-work.js";
import { OrgRepository } from "./org-repository.js";

export interface OrgProjectRow {
  readonly id: string;
  readonly name: string;
  readonly plan: string;
  readonly complianceTier: string;
  readonly createdAt: Date;
}

/** What a purge did. The count is what `project_purges` keeps as evidence. */
export interface ProjectPurge {
  readonly auditRowsDeleted: number;
}

export interface NewOrgProject {
  readonly name: string;
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

  /**
   * One project of this organisation's, or null.
   *
   * The organisation is in the predicate and not only in the id. It used to be the id
   * alone, with the row policy narrowing the read and a comparison here as a backstop —
   * which was true while the policy existed and is the single query in this package that
   * depended on it. Scoped in SQL, a project of somebody else's does not come back to be
   * rejected; it is not selected. "Not found" and "not yours" stay the same answer, which
   * is what keeps the id space from telling a caller what our customers have built.
   */
  async findById(id: string): Promise<OrgProjectRow | null> {
    const rows = await this.tx
      .select()
      .from(projects)
      .where(and(this.orgScope(), eq(projects.id, id)))
      .limit(1);
    const row = rows[0];
    return row === undefined ? null : toRow(row);
  }

  /**
   * Adds a project to the organisation already bound.
   *
   * The organisation is not a parameter, and that is the guard: `org_id` comes from the
   * context the request was authorised against, so there is no field a caller could set
   * to put a project somewhere else. The policy's WITH CHECK refuses it besides.
   */
  /** The one field a project has that a customer may change. */
  async rename(id: string, name: string): Promise<OrgProjectRow | null> {
    const rows = await this.tx
      .update(projects)
      .set({ name })
      .where(and(this.orgScope(), eq(projects.id, id)))
      .returning();
    const row = rows[0];
    return row === undefined ? null : toRow(row);
  }

  /**
   * Removes a project and everything keyed on it, and records that it happened.
   *
   * Most of the cascade is the schema's: since 0060 every tenant table's `project_id`
   * references `projects` with `ON DELETE CASCADE`, so 37 of the 38 empty themselves. For a
   * long time this method's docstring claimed that and it was false — no foreign key existed
   * anywhere, and a delete removed one row and orphaned everything pointing at it.
   *
   * `audit_events` is the thirty-eighth and cannot have a cascade: it is partitioned, and the
   * app role's missing DELETE privilege on it is the integrity control of PROJECT.md 4.13.3
   * rather than an omission. So the whole operation goes through `purge_project` (0062), a
   * SECURITY DEFINER function that removes the trail and the project together and writes a
   * `project_purges` row — the evidence GDPR Art. 28(3)(g) wants, and the only thing left once
   * everything else about the project is gone.
   *
   * Null means no such project in this organisation. The panel refuses to delete the last one
   * besides, because an organisation with no projects has nothing for its members to sign in to.
   */
  async remove(id: string): Promise<ProjectPurge | null> {
    const rows = await this.tx.execute<{ removed: number | null }>(
      sql`select purge_project(${this.context.orgId}::uuid, ${id}::uuid, ${this.purgedBy()}) as removed`,
    );
    const removed = rows.rows[0]?.removed;
    return removed === undefined || removed === null ? null : { auditRowsDeleted: Number(removed) };
  }

  /** Who the record names. The actor where there is one, the kind of caller where there is not. */
  private purgedBy(): string {
    return this.context.actorId ?? this.context.actorType;
  }

  async create(project: NewOrgProject): Promise<OrgProjectRow> {
    const id = randomUUID();
    const rows = await this.guard(() =>
      this.tx
        .insert(projects)
        .values({
          id,
          orgId: this.context.orgId,
          name: project.name,
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
    plan: row.plan,
    complianceTier: row.complianceTier,
    createdAt: row.createdAt,
  };
}
