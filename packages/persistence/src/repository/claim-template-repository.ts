import { and, eq } from "drizzle-orm";
import { claimTemplates } from "../schema/claims.js";
import type { TenantContext } from "../tenancy/tenant-context.js";
import type { Transaction } from "../tenancy/unit-of-work.js";
import { BaseRepository } from "./base-repository.js";

export interface ClaimTemplateRow {
  readonly claims: unknown;
  readonly privateMetadataAcknowledgedAt: Date | null;
  readonly updatedAt: Date;
}

/**
 * The project's access-token claim template (PROJECT.md 4.2).
 *
 * Read on the token path, so it is deliberately one indexed row by primary key and
 * nothing else. A project that has configured none has no row, which reads as an empty
 * template rather than as an error: doing nothing is the default and must not cost a
 * sign-in.
 */
export class ClaimTemplateRepository extends BaseRepository<typeof claimTemplates> {
  constructor(tx: Transaction, context: TenantContext) {
    super(tx, context, claimTemplates);
  }

  async find(): Promise<ClaimTemplateRow | null> {
    const rows = await this.tx
      .select()
      .from(claimTemplates)
      .where(and(this.tenantScope(), eq(claimTemplates.projectId, this.context.projectId)))
      .limit(1);
    const row = rows[0];
    if (row === undefined) return null;
    return {
      claims: row.claims,
      privateMetadataAcknowledgedAt: row.privateMetadataAcknowledgedAt,
      updatedAt: row.updatedAt,
    };
  }

  /**
   * Replaces the whole set in one statement.
   *
   * Whole rather than per claim, because the budget is on the total and two concurrent
   * saves that each fitted on their own could not both be checked. The acknowledgement is
   * written with it, so the record of who agreed to publish private metadata cannot end
   * up describing a template that no longer reads from there.
   */
  async save(claims: unknown, privateMetadataAcknowledgedAt: Date | null): Promise<Date> {
    const rows = await this.guard(() =>
      this.tx
        .insert(claimTemplates)
        .values({
          projectId: this.context.projectId,
          claims,
          privateMetadataAcknowledgedAt,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: claimTemplates.projectId,
          set: { claims, privateMetadataAcknowledgedAt, updatedAt: new Date() },
        })
        .returning({ updatedAt: claimTemplates.updatedAt }),
    );
    return rows[0]?.updatedAt ?? new Date();
  }
}
