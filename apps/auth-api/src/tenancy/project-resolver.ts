import { UnknownProjectError } from "@idenzy/core/errors/errors";
import { hashToken } from "@idenzy/crypto/tokens/random";
import { Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

export interface ResolvedProject {
  readonly projectId: string;
  readonly cellId: string;
  readonly complianceTier: string;
  readonly plan: string;
}

/**
 * Resolves which project a request belongs to, before any tenant scope exists.
 *
 * This has to bypass RLS by definition: the policy is keyed on app.project_id, and this
 * is the code that works out what app.project_id should be. It calls the SECURITY
 * DEFINER functions from migration 0002, which are scoped to exactly this lookup and
 * return routing and configuration only, never personal data.
 */
@Injectable()
export class ProjectResolver {
  constructor(private readonly db: NodePgDatabase) {}

  async byHost(host: string): Promise<ResolvedProject> {
    const rows = await this.db.execute<ResolvedProjectRow>(
      sql`select * from resolve_project_by_host(${host})`,
    );
    return this.first(rows.rows, { host });
  }

  /**
   * Takes the plaintext key and hashes it here, so the key itself never reaches the
   * database, its logs, or pg_stat_statements.
   */
  async byApiKey(key: string): Promise<ResolvedProject> {
    const rows = await this.db.execute<ResolvedProjectRow>(
      sql`select * from resolve_project_by_key_hash(${hashToken(key)})`,
    );
    return this.first(rows.rows, { keyPrefix: key.slice(0, 8) });
  }

  private first(
    rows: readonly ResolvedProjectRow[],
    detail: Readonly<Record<string, unknown>>,
  ): ResolvedProject {
    const row = rows[0];
    if (row === undefined) throw new UnknownProjectError({ detail });
    return {
      projectId: row.project_id,
      cellId: row.cell_id,
      complianceTier: row.compliance_tier,
      plan: row.plan,
    };
  }
}

/** Snake-case row shape as Postgres returns it. Mapped to camelCase before it escapes. */
interface ResolvedProjectRow extends Record<string, unknown> {
  readonly project_id: string;
  readonly cell_id: string;
  readonly compliance_tier: string;
  readonly plan: string;
}
