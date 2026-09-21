import { eq, sql } from "drizzle-orm";
import { projects } from "../schema/projects.js";
import type { TenantContext } from "../tenancy/tenant-context.js";
import type { Transaction } from "../tenancy/unit-of-work.js";
import { BaseRepository } from "./base-repository.js";
import { asRecord } from "./jsonb.js";

export interface ProjectRow {
  readonly id: string;
  /**
   * The organisation that pays for it.
   *
   * Read here because a project is where a send happens and an organisation is where the
   * money is: the wallet, the credit and the debt all hang off `org_id` (ADR-0011), so
   * anything on the request path asking "may this spend" has to cross from one to the
   * other, and this is the only row that knows.
   */
  readonly orgId: string;
  readonly name: string;
  readonly plan: string;
  readonly complianceTier: string;
  readonly settings: Readonly<Record<string, unknown>>;
}

/**
 * The current project's own row.
 *
 * `tenantScope()` is not used here and cannot be: this table's tenant key is its own `id`, not
 * a `project_id` column. The filter below is written out for that reason.
 *
 * Reading a project by an id other than the caller's is not offered, and the filter below is now
 * the whole of why. It used to be the second of two — a hand-written row policy said the same
 * thing underneath — so treat the predicate as load-bearing rather than as a convenience.
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
      orgId: row.orgId,
      name: row.name,
      plan: row.plan,
      complianceTier: row.complianceTier,
      settings: asRecord(row.settings),
    };
  }

  /**
   * Replaces one section of the settings document and answers with the whole of it.
   *
   * `jsonb_strip_nulls(settings || patch)` rather than a read-modify-write: two operators
   * saving two different screens at the same moment would otherwise each write the document
   * they read, and the second would quietly erase the first's section. `||` merges at the
   * top level, which is exactly the granularity the sections have.
   *
   * The strip is what makes removing a key expressible at all: `||` with a null value
   * stores a JSON null, and a field that is present-and-null reads differently from absent
   * everywhere downstream. Stripping means absent is the only way to say "not set", so the
   * schema's defaults are the single answer to what a missing setting means.
   */
  async mergeSettings(patch: Readonly<Record<string, unknown>>): Promise<ProjectRow | null> {
    const rows = await this.tx
      .update(projects)
      .set({
        settings: sql`jsonb_strip_nulls(coalesce(${projects.settings}, '{}'::jsonb) || ${JSON.stringify(patch)}::jsonb)`,
      })
      .where(eq(projects.id, this.context.projectId))
      .returning();
    const row = rows[0];
    if (row === undefined) return null;
    return {
      id: row.id,
      orgId: row.orgId,
      name: row.name,
      plan: row.plan,
      complianceTier: row.complianceTier,
      settings: asRecord(row.settings),
    };
  }
}
