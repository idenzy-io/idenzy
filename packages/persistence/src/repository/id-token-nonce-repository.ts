import { and, eq, gt, lt } from "drizzle-orm";
import { idTokenNonces } from "../schema/challenges.js";
import type { TenantContext } from "../tenancy/tenant-context.js";
import type { Transaction } from "../tenancy/unit-of-work.js";
import { BaseRepository } from "./base-repository.js";

/** The nonce half of a native ID-token sign-in. Single use, decided by the database. */
export class IdTokenNonceRepository extends BaseRepository<typeof idTokenNonces> {
  constructor(tx: Transaction, context: TenantContext) {
    super(tx, context, idTokenNonces);
  }

  /**
   * Stores a nonce's digest, and clears this project's rows that expired unspent.
   *
   * The clearing is what keeps the table at roughly one window of sign-ins without a sweep
   * of its own: a dismissed sign-in sheet leaves a row behind, and the next issue for the
   * same project removes it. It walks `(project_id, expires_at)`, so its cost is the rows it
   * deletes and not the size of the table.
   */
  async issue(nonceHash: string, expiresAt: Date, now: Date): Promise<void> {
    await this.tx
      .delete(idTokenNonces)
      .where(and(this.tenantScope(), lt(idTokenNonces.expiresAt, now)));
    await this.guard(() =>
      this.tx.insert(idTokenNonces).values({
        projectId: this.context.projectId,
        nonceHash,
        expiresAt,
      }),
    );
  }

  /**
   * Spends a live nonce and answers whether there was one to spend.
   *
   * The claim is the delete, so reading and consuming are one statement and two exchanges
   * racing on one nonce cannot both proceed. It happens before the token is verified, never
   * after: a nonce burnt only on success is one an attacker could keep trying tokens against.
   * An unknown, a spent and an expired nonce answer the same way.
   */
  async claim(nonceHash: string, now: Date): Promise<boolean> {
    const rows = await this.tx
      .delete(idTokenNonces)
      .where(
        and(
          this.tenantScope(),
          eq(idTokenNonces.nonceHash, nonceHash),
          gt(idTokenNonces.expiresAt, now),
        ),
      )
      .returning({ id: idTokenNonces.id });
    return rows.length > 0;
  }
}
