import type { Channel } from "@idenzy/protocol/enums/delivery";
import { and, eq } from "drizzle-orm";
import { suppressions } from "../schema/messaging.js";
import type { TenantContext } from "../tenancy/tenant-context.js";
import type { CellTx } from "../tenancy/unit-of-work.js";
import { BaseRepository } from "./base-repository.js";

/**
 * Addresses and numbers we must never send to again (PROJECT.md 11.1).
 *
 * The target is stored hashed, so the suppression list is not a harvestable list of
 * every address that ever bounced for a customer. Callers hash before they call, using
 * the same digest the writer used.
 *
 * Adding is idempotent: a second hard bounce for the same address is normal and must not
 * fail the webhook that reported it.
 */
export class SuppressionRepository extends BaseRepository<typeof suppressions> {
  constructor(tx: CellTx, context: TenantContext) {
    super(tx, context, suppressions);
  }

  async isSuppressed(channel: Channel, targetHash: string): Promise<boolean> {
    const rows = await this.tx
      .select({ id: suppressions.id })
      .from(suppressions)
      .where(
        and(
          this.tenantScope(),
          eq(suppressions.channel, channel),
          eq(suppressions.targetHash, targetHash),
        ),
      )
      .limit(1);
    return rows.length === 1;
  }

  async suppress(channel: Channel, targetHash: string, reason: string): Promise<void> {
    await this.guard(() =>
      this.tx
        .insert(suppressions)
        .values({ projectId: this.context.projectId, channel, targetHash, reason })
        .onConflictDoNothing(),
    );
  }

  /** Only a deliberate customer action removes one, which is why it is not a soft flag. */
  async release(channel: Channel, targetHash: string): Promise<boolean> {
    const rows = await this.tx
      .delete(suppressions)
      .where(
        and(
          this.tenantScope(),
          eq(suppressions.channel, channel),
          eq(suppressions.targetHash, targetHash),
        ),
      )
      .returning({ id: suppressions.id });
    return rows.length === 1;
  }
}
