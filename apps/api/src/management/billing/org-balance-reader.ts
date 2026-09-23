import { LiveBalanceCache } from "@idenzy/cache/live-balance-cache";
import { Logger } from "@idenzy/core/logging/logger";
import { Clock } from "@idenzy/core/time/clock";
import { PublicId } from "@idenzy/core/value-objects/public-id";
import { WalletLedger } from "@idenzy/persistence/billing/wallet-ledger";
import { BillingSettingsRepository } from "@idenzy/persistence/repository/billing-settings-repository";
import { InvoiceRepository } from "@idenzy/persistence/repository/invoice-repository";
import type { OrgContext } from "@idenzy/persistence/tenancy/org-context";
import { UnitOfWork } from "@idenzy/persistence/tenancy/unit-of-work";
import { BillingMode } from "@idenzy/protocol/enums/billing";
import type { OrgBalance } from "@idenzy/protocol/schemas/billing";
import { IdPrefix } from "@idenzy/protocol/schemas/common";
import { Injectable } from "@nestjs/common";

/** What Valkey held for an organisation, where it held anything. */
interface Cached {
  readonly mode: BillingMode | null;
  readonly balanceCents: number | null;
  readonly pendingCents: number | null;
  readonly asOf: number | null;
  readonly live: boolean;
}

const NOTHING: Cached = {
  mode: null,
  balanceCents: null,
  pendingCents: null,
  asOf: null,
  live: false,
};

/**
 * An organisation's balance for a person looking at it (ADR-0017, ADR-0019).
 *
 * Three sources, best first, and never a sketch on the request path: the live figure the billing
 * worker computed on its last five-second tick; the ledger snapshot it read; Postgres itself, for an
 * organisation nobody has used lately or while Valkey is unavailable. All three are the same
 * quantity at different ages, so a visit always shows a real figure, and the worst case is the
 * ledger's — up to five minutes behind.
 *
 * **An invoiced organisation is answered differently**, because it has no balance: it is shown its
 * usage not yet invoiced (the live figure's pending part) and what it owes on invoices already
 * issued. Those invoices are read from Postgres, which is one indexed read for the handful of
 * organisations billed this way.
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
    const cached = await this.cached(context.orgId);
    const now = this.clock.now();

    if (cached.mode === BillingMode.Prepaid && cached.balanceCents !== null) {
      return {
        orgId,
        mode: BillingMode.Prepaid,
        balanceCents: cached.balanceCents,
        pendingCents: cached.pendingCents,
        asOf: new Date(cached.asOf ?? now.getTime()).toISOString(),
        live: cached.live,
      };
    }

    // Either nothing cached, or an invoiced organisation whose invoices only Postgres holds.
    const stored = await this.uow.transaction(async (tx) => {
      const settings = await new BillingSettingsRepository(tx, context).current();
      if (settings.mode === BillingMode.Invoiced) {
        const invoices = new InvoiceRepository(tx, context);
        return {
          mode: BillingMode.Invoiced,
          terms: settings.invoiceTermsDays,
          outstanding: await invoices.outstandingCents(),
          overdue: await invoices.overdueCents(),
        } as const;
      }
      return {
        mode: BillingMode.Prepaid,
        balance: await new WalletLedger(tx, context).balanceCents(now),
      } as const;
    });

    if (stored.mode === BillingMode.Prepaid) {
      return {
        orgId,
        mode: BillingMode.Prepaid,
        balanceCents: stored.balance,
        pendingCents: null,
        asOf: now.toISOString(),
        live: false,
      };
    }
    const unbilled = cached.mode === BillingMode.Invoiced ? cached.pendingCents : null;
    return {
      orgId,
      mode: BillingMode.Invoiced,
      unbilledCents: unbilled,
      outstandingCents: stored.outstanding,
      overdueCents: stored.overdue,
      invoiceTermsDays: stored.terms,
      asOf: new Date(
        unbilled === null ? now.getTime() : (cached.asOf ?? now.getTime()),
      ).toISOString(),
      live: unbilled !== null,
    };
  }

  /** The live figure, else the ledger snapshot, else nothing. A cache we cannot reach is nothing. */
  private async cached(orgId: string): Promise<Cached> {
    try {
      const live = await this.cache.live(orgId);
      if (live !== null) {
        return {
          mode: live.mode,
          balanceCents: live.balanceCents,
          pendingCents: live.pendingCents,
          asOf: live.asOf,
          live: true,
        };
      }
      const ledger = await this.cache.ledger(orgId);
      if (ledger !== null) {
        return {
          mode: ledger.mode,
          balanceCents: ledger.balanceCents,
          pendingCents: null,
          asOf: ledger.readAt,
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
    return NOTHING;
  }
}
