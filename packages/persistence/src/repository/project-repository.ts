import { eq } from "drizzle-orm";
import { projects } from "../schema/projects.js";
import type { TenantContext } from "../tenancy/tenant-context.js";
import type { Transaction } from "../tenancy/unit-of-work.js";
import { BaseRepository } from "./base-repository.js";
import { asRecord } from "./jsonb.js";

export interface ProjectRow {
  readonly id: string;
  readonly name: string;
  readonly plan: string;
  readonly complianceTier: string;
  readonly settings: Readonly<Record<string, unknown>>;
}

/**
 * The current project's own row.
 *
 * `tenantScope()` is not used here and cannot be: this table's tenant key is its own
 * `id`, not a `project_id` column, which is also why it carries a hand-written policy
 * instead of the shared one. The filter below matches that policy exactly.
 *
 * Reading a project by an id other than the caller's is not an oversight to fix later.
 * It is not possible: RLS returns nothing, whatever this class asks for.
 */
export class ProjectRepository extends BaseRepository<typeof projects> {
  constructor(tx: Transaction, context: TenantContext) {
    super(tx, context, projects);
  }

  async current(): Promise<ProjectRow | null> {
    const rows = await this.tx
      .select()
      .from(projects)
      .where(eq(projects.id, this.context.projectId))
      .limit(1);
    const row = rows[0];
    if (row === undefined) return null;
    return {
      id: row.id,
      name: row.name,
      plan: row.plan,
      complianceTier: row.complianceTier,
      settings: asRecord(row.settings),
    };
  }
}
