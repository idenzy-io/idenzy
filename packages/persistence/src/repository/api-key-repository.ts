import { ResourceConflictError } from "@idenzy/core/errors";
import type { ApiKeyKind } from "@idenzy/protocol/enums/tenancy";
import { and, desc, eq, isNull } from "drizzle-orm";
import { apiKeys } from "../schema/projects.js";
import type { TenantContext } from "../tenancy/tenant-context.js";
import type { Transaction } from "../tenancy/unit-of-work.js";
import { BaseRepository } from "./base-repository.js";

export interface ApiKeyRow {
  readonly id: string;
  readonly kind: ApiKeyKind;
  readonly prefix: string;
  readonly scopes: readonly string[];
  readonly lastUsedAt: Date | null;
  readonly revokedAt: Date | null;
  readonly createdAt: Date;
}

export interface NewApiKey {
  readonly kind: ApiKeyKind;
  /** First characters of the key, kind prefix included. Enough to name a row, not to use it. */
  readonly prefix: string;
  /** SHA-256 of the key. The key itself is never handed to this layer twice. */
  readonly hash: string;
  readonly scopes: readonly string[];
}

function toRow(row: typeof apiKeys.$inferSelect): ApiKeyRow {
  return {
    id: row.id,
    // Safe: the column is written only from ApiKeyKind.
    kind: row.kind as ApiKeyKind,
    prefix: row.prefix,
    scopes: row.scopes,
    lastUsedAt: row.lastUsedAt,
    revokedAt: row.revokedAt,
    createdAt: row.createdAt,
  };
}

/**
 * A project's API keys (PROJECT.md 4.3).
 *
 * The digest and never the key. Nothing here takes or returns a usable credential: the
 * caller generates one, hands over its hash and its first few characters, and forgets it.
 * A repository that could hand a key back would be a retrievable-key design, which is the
 * thing the unique index on `hash` and the absence of any plaintext column exist to rule
 * out — a leaked database backup would otherwise be a leaked set of live credentials.
 *
 * Revoked and never deleted. A key that signed requests is part of the record of what
 * happened, and `revoked_at` is what lets the trail still name it afterwards.
 */
export class ApiKeyRepository extends BaseRepository<typeof apiKeys> {
  constructor(tx: Transaction, context: TenantContext) {
    super(tx, context, apiKeys);
  }

  /** Every key on the project, live and revoked, newest first. */
  async list(): Promise<ApiKeyRow[]> {
    const rows = await this.tx
      .select()
      .from(apiKeys)
      .where(this.tenantScope())
      .orderBy(desc(apiKeys.createdAt));
    return rows.map(toRow);
  }

  async create(key: NewApiKey): Promise<ApiKeyRow> {
    const rows = await this.guard(() =>
      this.tx
        .insert(apiKeys)
        .values({ projectId: this.context.projectId, ...key, scopes: [...key.scopes] })
        .returning(),
    );
    const row = rows[0];
    if (row === undefined) throw new ResourceConflictError({ detail: { prefix: key.prefix } });
    return toRow(row);
  }

  /**
   * Revokes one, and answers whether this call was what revoked it.
   *
   * The `revoked_at is null` predicate is the guard: revoking twice must not move the
   * timestamp, because the first one is when the key actually stopped working and an
   * incident review reads that column to find out when.
   */
  async revoke(id: string, at: Date): Promise<ApiKeyRow | null> {
    const rows = await this.tx
      .update(apiKeys)
      .set({ revokedAt: at })
      .where(and(this.tenantScope(), eq(apiKeys.id, id), isNull(apiKeys.revokedAt)))
      .returning();
    const row = rows[0];
    return row === undefined ? null : toRow(row);
  }
}
