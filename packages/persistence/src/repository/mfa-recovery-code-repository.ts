import { and, count, eq, isNull } from "drizzle-orm";
import { mfaRecoveryCodes } from "../schema/mfa.js";
import type { TenantContext } from "../tenancy/tenant-context.js";
import type { CellTx } from "../tenancy/unit-of-work.js";
import { BaseRepository } from "./base-repository.js";

/**
 * The codes that stand in for a factor the user cannot reach (PROJECT.md 4.5).
 *
 * Issued as a set and replaced as a set, because a half-regenerated sheet is worse than
 * either state: the user has a printout that partly works, and no way to tell which half.
 */
export class MfaRecoveryCodeRepository extends BaseRepository<typeof mfaRecoveryCodes> {
  constructor(tx: CellTx, context: TenantContext) {
    super(tx, context, mfaRecoveryCodes);
  }

  /** Replaces every code the user holds. Regenerating invalidates the old sheet. */
  async replaceAll(userId: string, codeHashes: readonly string[]): Promise<void> {
    await this.tx
      .delete(mfaRecoveryCodes)
      .where(and(this.tenantScope(), eq(mfaRecoveryCodes.userId, userId)));
    if (codeHashes.length === 0) return;
    await this.guard(() =>
      this.tx.insert(mfaRecoveryCodes).values(
        codeHashes.map((codeHash) => ({
          projectId: this.context.projectId,
          userId,
          codeHash,
        })),
      ),
    );
  }

  /**
   * Spends a code, if it is the user's and unspent.
   *
   * One statement, and scoped by user rather than by digest alone. A read followed by an
   * update would let two requests spend the same code, and a lookup on the digest alone
   * would accept a code belonging to another account in the same project, which is a
   * sign-in as somebody else on a value the caller legitimately holds.
   */
  async consume(userId: string, codeHash: string, at: Date): Promise<boolean> {
    const rows = await this.tx
      .update(mfaRecoveryCodes)
      .set({ usedAt: at })
      .where(
        and(
          this.tenantScope(),
          eq(mfaRecoveryCodes.userId, userId),
          eq(mfaRecoveryCodes.codeHash, codeHash),
          isNull(mfaRecoveryCodes.usedAt),
        ),
      )
      .returning({ id: mfaRecoveryCodes.id });
    return rows.length === 1;
  }

  async countUnused(userId: string): Promise<number> {
    const rows = await this.tx
      .select({ total: count() })
      .from(mfaRecoveryCodes)
      .where(
        and(
          this.tenantScope(),
          eq(mfaRecoveryCodes.userId, userId),
          isNull(mfaRecoveryCodes.usedAt),
        ),
      );
    return rows[0]?.total ?? 0;
  }
}
