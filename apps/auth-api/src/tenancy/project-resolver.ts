import { SecretKeyNotPermittedError, UnknownProjectError } from "@idenzy/core/errors";
import { hashToken } from "@idenzy/crypto/tokens/random";
import { ApiKeyKind } from "@idenzy/protocol/enums/tenancy";
import { Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

export interface ResolvedProject {
  readonly projectId: string;
  readonly cellId: string;
  readonly complianceTier: string;
  readonly plan: string;
  /** Null when the project was resolved by Host, which presents no key. */
  readonly keyKind: string | null;
  readonly scopes: readonly string[];
  /** Exact-match browser origins allowed to call with credentials (PROJECT.md 4.3). */
  readonly allowedOrigins: readonly string[];
  /**
   * Whether a verified auth domain exists, which is what decides if cookie mode can work:
   * a `__Host-` cookie goes only to the host that set it, so it is useless unless the auth
   * API is same-site with the customer's app.
   */
  readonly hasAuthDomain: boolean;
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

  /**
   * Resolves a key that arrived on the browser-facing header.
   *
   * The stored kind is checked as well as the presented prefix, and the two are deliberately
   * independent: the prefix is what the caller typed, the kind is what we provisioned. A row
   * whose kind is `secret` but whose value was issued with a `pk_` prefix is a provisioning
   * mistake, and it must not become a secret key that works from a browser.
   */
  async byPublishableKey(key: string): Promise<ResolvedProject> {
    const resolved = await this.byApiKey(key);
    if (resolved.keyKind !== ApiKeyKind.Publishable) {
      throw new SecretKeyNotPermittedError({
        detail: { keyPrefix: key.slice(0, 8), keyKind: resolved.keyKind },
      });
    }
    return resolved;
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
      keyKind: row.key_kind ?? null,
      scopes: row.scopes ?? [],
      allowedOrigins: row.allowed_origins ?? [],
      hasAuthDomain: row.has_auth_domain ?? false,
    };
  }
}

/** Snake-case row shape as Postgres returns it. Mapped to camelCase before it escapes. */
interface ResolvedProjectRow extends Record<string, unknown> {
  readonly project_id: string;
  readonly cell_id: string;
  readonly compliance_tier: string;
  readonly plan: string;
  /** Absent from resolve_project_by_host, which has no key to describe. */
  readonly key_kind?: string;
  readonly scopes?: string[];
  readonly allowed_origins?: string[];
  readonly has_auth_domain?: boolean;
}
