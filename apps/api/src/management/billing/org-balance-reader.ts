import { LiveBalanceCache } from "@idenzy/cache/live-balance-cache";
import { Logger } from "@idenzy/core/logging/logger";
import { Clock } from "@idenzy/core/time/clock";
import { PublicId } from "@idenzy/core/value-objects/public-id";
import { WalletLedger } from "@idenzy/persistence/billing/wallet-ledger";
import type { OrgContext } from "@idenzy/persistence/tenancy/org-context";
import { UnitOfWork } from "@idenzy/persistence/tenancy/unit-of-work";
import type { OrgBalance } from "@idenzy/protocol/schemas/billing";
import { IdPrefix } from "@idenzy/protocol/schemas/common";
import { Injectable } from "@nestjs/common";

/**
 * An organisation's balance for a person looking at it (ADR-0017).
 *
 * Three sources, best first, and never a sketch on the request path:
 *
 * 1. the live figure the billing worker computed on its last five-second tick;
 * 2. the ledger snapshot it read, which is exact to the ledger and carries no pending figure;
 * 3. Postgres itself, which is what an organisation nobody has used lately, or a Valkey outage,
 *    falls back to.
 *
 * All three are the same quantity at different ages, so a visit always shows a real balance, and
 * the worst case is the ledger's — up to five minutes behind, which is what every balance was
 * before live figures existed.
 */
@Injectable()
export class OrgBalanceReader {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly cache: LiveBalanceCache,
    private readonly clock: Clock,
    private readonly logger: Logger,
  ) {}

  async read(context: OrgContext): Promise<OrgBalance> {
    const orgId = PublicId.encode(IdPrefix.Org, context.orgId).value;
    try {
      const live = await this.cache.live(context.orgId);
      if (live !== null) {
        return {
          orgId,
          mode: "prepaid",
          balanceCents: live.balanceCents,
          pendingCents: live.pendingCents,
          asOf: new Date(live.asOf).toISOString(),
          live: true,
        };
      }
      const ledger = await this.cache.ledger(context.orgId);
      if (ledger !== null) {
        return {
          orgId,
          mode: "prepaid",
          balanceCents: ledger.balanceCents,
          pendingCents: null,
          asOf: new Date(ledger.readAt).toISOString(),
          live: false,
        };
      }
    } catch (cause: unknown) {
      // A cache we cannot reach is a reason to ask Postgres, never a reason to show nothing.
      this.logger.warn("live balance unavailable", {
        component: "billing",
        outcome: "fallback",
        errorName: cause instanceof Error ? cause.name : "unknown",
      });
    }

    const now = this.clock.now();
    const balanceCents = await this.uow.transaction((tx) =>
      new WalletLedger(tx, context).balanceCents(now),
    );
    return {
      orgId,
      mode: "prepaid",
      balanceCents,
      pendingCents: null,
      asOf: now.toISOString(),
      live: false,
    };
  }
}
