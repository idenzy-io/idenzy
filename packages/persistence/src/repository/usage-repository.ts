import { sql } from "drizzle-orm";
import { usageDaily } from "../schema/usage.js";
import type { TenantContext } from "../tenancy/tenant-context.js";
import type { Transaction } from "../tenancy/unit-of-work.js";
import { BaseRepository } from "./base-repository.js";

/** `YYYY-MM-DD` in UTC, which is what the `day` column stores. */
function utcDay(at: Date): string {
  return at.toISOString().slice(0, 10);
}

/**
 * Daily usage rollups (PROJECT.md 5.1).
 *
 * Counters are incremented with an upsert rather than read-modify-written, so two
 * concurrent sends on the same day do not lose one another. Billing that silently
 * undercounts is worse than billing that fails loudly.
 */
export class UsageRepository extends BaseRepository<typeof usageDaily> {
  constructor(tx: Transaction, context: TenantContext) {
    super(tx, context, usageDaily);
  }

  async recordEmailSent(at: Date, count = 1): Promise<void> {
    await this.guard(() =>
      this.tx
        .insert(usageDaily)
        .values({ projectId: this.context.projectId, day: utcDay(at), emailsSent: count })
        .onConflictDoUpdate({
          target: [usageDaily.projectId, usageDaily.day],
          set: { emailsSent: sql`${usageDaily.emailsSent} + ${count}` },
        }),
    );
  }
}
