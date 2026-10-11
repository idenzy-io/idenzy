import { sql } from "drizzle-orm";
import { users } from "../schema/identity.js";
import type { TenantContext } from "../tenancy/tenant-context.js";
import type { Transaction } from "../tenancy/unit-of-work.js";
import { BaseRepository } from "./base-repository.js";

/**
 * Erases one end user inside the caller's transaction.
 *
 * The statements are `erase_user` (migration 0013) rather than a list here, because the list is
 * what `user-erasure.test.ts` holds against `classified()`, and it can only read one place.
 */
export class UserErasureRepository extends BaseRepository<typeof users> {
  constructor(tx: Transaction, context: TenantContext) {
    super(tx, context, users);
  }

  /**
   * The sessions it ended, or null when there is no live user by that id.
   *
   * `targetHashes` are the digests the OTP flows file a challenge under for the addresses the
   * account held, which is the only way `otp_challenges` can be reached.
   */
  async erase(
    userId: string,
    targetHashes: readonly string[],
    at: Date,
  ): Promise<readonly string[] | null> {
    const rows = await this.tx.execute<{ ended: string[] | null }>(
      sql`select erase_user(
            ${this.context.projectId}::uuid,
            ${userId}::uuid,
            ${sql.param([...targetHashes])}::text[],
            ${at.toISOString()}::timestamptz
          )::text[] as ended`,
    );
    return rows.rows[0]?.ended ?? null;
  }
}
