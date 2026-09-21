import { ResourceNotFoundError } from "@idenzy/core/errors";
import { and, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { mfaFactors } from "../schema/mfa.js";
import type { TenantContext } from "../tenancy/tenant-context.js";
import type { Transaction } from "../tenancy/unit-of-work.js";
import { BaseRepository } from "./base-repository.js";

export interface NewMfaFactor {
  readonly userId: string;
  readonly type: string;
  readonly secretEncrypted: string;
  readonly label: string | null;
}

export interface MfaFactorRow {
  readonly id: string;
  readonly userId: string;
  readonly type: string;
  readonly secretEncrypted: string | null;
  readonly label: string | null;
  readonly counter: number | null;
  readonly verifiedAt: Date | null;
  readonly lastUsedAt: Date | null;
  readonly createdAt: Date;
}

/**
 * Enrolled second factors (PROJECT.md 4.5).
 *
 * Every read here is scoped by user as well as by tenant, and the second scope is not
 * redundant. RLS keeps one project out of another's rows; nothing in the database stops
 * a query in the right project from reading a stranger's factor, and a factor id is the
 * kind of value that ends up in a URL.
 */
export class MfaFactorRepository extends BaseRepository<typeof mfaFactors> {
  constructor(tx: Transaction, context: TenantContext) {
    super(tx, context, mfaFactors);
  }

  async create(input: NewMfaFactor): Promise<string> {
    const rows = await this.guard(() =>
      this.tx
        .insert(mfaFactors)
        .values({
          projectId: this.context.projectId,
          userId: input.userId,
          type: input.type,
          secretEncrypted: input.secretEncrypted,
          label: input.label,
        })
        .returning({ id: mfaFactors.id }),
    );
    const row = rows[0];
    if (row === undefined) throw new ResourceNotFoundError({ detail: { entity: "mfa_factor" } });
    return row.id;
  }

  async findForUser(userId: string, id: string): Promise<MfaFactorRow | null> {
    const rows = await this.tx
      .select()
      .from(mfaFactors)
      .where(and(this.tenantScope(), eq(mfaFactors.userId, userId), eq(mfaFactors.id, id)))
      .limit(1);
    return rows[0] === undefined ? null : present(rows[0]);
  }

  /** Everything the user has confirmed, which is everything that can satisfy a challenge. */
  async listVerified(userId: string): Promise<readonly MfaFactorRow[]> {
    const rows = await this.tx
      .select()
      .from(mfaFactors)
      .where(
        and(this.tenantScope(), eq(mfaFactors.userId, userId), isNotNull(mfaFactors.verifiedAt)),
      )
      .orderBy(mfaFactors.createdAt);
    return rows.map(present);
  }

  /**
   * Clears an enrolment that was started and never confirmed.
   *
   * Called before a new one, because the unique index covers verified rows only: without
   * this, abandoning enrolment twice would leave two unusable secrets on the account and
   * a list with two entries the user cannot explain.
   */
  async deleteUnverified(userId: string, type: string): Promise<number> {
    const rows = await this.tx
      .delete(mfaFactors)
      .where(
        and(
          this.tenantScope(),
          eq(mfaFactors.userId, userId),
          eq(mfaFactors.type, type),
          isNull(mfaFactors.verifiedAt),
        ),
      )
      .returning({ id: mfaFactors.id });
    return rows.length;
  }

  /** Confirms an enrolment. The loser of a race gets false, so it happens once. */
  async confirm(userId: string, id: string, at: Date): Promise<boolean> {
    const rows = await this.guard(() =>
      this.tx
        .update(mfaFactors)
        .set({ verifiedAt: at, lastUsedAt: at })
        .where(
          and(
            this.tenantScope(),
            eq(mfaFactors.userId, userId),
            eq(mfaFactors.id, id),
            isNull(mfaFactors.verifiedAt),
          ),
        )
        .returning({ id: mfaFactors.id }),
    );
    return rows.length === 1;
  }

  /**
   * Records a use, and advances the counter in the same statement.
   *
   * The counter is what refuses a replayed TOTP code inside its own step, and it is
   * moved with a `>` guard rather than a plain assignment: two requests in one step
   * would otherwise let the second write the value back down, which is the one ordering
   * that reopens the window.
   */
  async recordUse(id: string, at: Date, counter: number | null): Promise<void> {
    await this.tx
      .update(mfaFactors)
      .set({
        lastUsedAt: at,
        ...(counter === null
          ? {}
          : { counter: sql`greatest(coalesce(${mfaFactors.counter}, -1), ${counter})` }),
      })
      .where(and(this.tenantScope(), eq(mfaFactors.id, id)));
  }

  async remove(userId: string, id: string): Promise<boolean> {
    const rows = await this.tx
      .delete(mfaFactors)
      .where(and(this.tenantScope(), eq(mfaFactors.userId, userId), eq(mfaFactors.id, id)))
      .returning({ id: mfaFactors.id });
    return rows.length === 1;
  }
}

function present(row: typeof mfaFactors.$inferSelect): MfaFactorRow {
  return {
    id: row.id,
    userId: row.userId,
    type: row.type,
    secretEncrypted: row.secretEncrypted,
    label: row.label,
    counter: row.counter,
    verifiedAt: row.verifiedAt,
    lastUsedAt: row.lastUsedAt,
    createdAt: row.createdAt,
  };
}
