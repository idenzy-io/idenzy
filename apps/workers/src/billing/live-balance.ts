import type {
  LedgerSnapshot,
  LiveBalanceCache,
  LiveBalance as LiveFigure,
} from "@idenzy/cache/live-balance-cache";
import type { LiveUsageSketches } from "@idenzy/cache/live-usage-sketches";
import { HyperLogLog } from "@idenzy/core/metering/hyper-log-log";
import type { Clock } from "@idenzy/core/time/clock";
import { WalletLedger } from "@idenzy/persistence/billing/wallet-ledger";
import { OrgProjectRepository } from "@idenzy/persistence/repository/org-project-repository";
import { UsageDrawdownRepository } from "@idenzy/persistence/repository/usage-drawdown-repository";
import { UsageRepository } from "@idenzy/persistence/repository/usage-repository";
import { OrgContext } from "@idenzy/persistence/tenancy/org-context";
import { TenantContext } from "@idenzy/persistence/tenancy/tenant-context";
import type { UnitOfWork } from "@idenzy/persistence/tenancy/unit-of-work";
import { mauCents } from "@idenzy/protocol/billing/price-list";
import { monthEnd, openPeriods } from "./periods.js";

export interface LiveBalanceOptions {
  /** How long a ledger snapshot stands before the tick reads Postgres again. */
  readonly ledgerMaxAgeMs?: number;
  /** How long a project's Postgres half of the month is reused from memory. */
  readonly baseMaxAgeMs?: number;
  /** How many project-months of Postgres sketches are kept in memory at once. */
  readonly baseEntries?: number;
}

/** A project's month as Postgres holds it. `frozen` once the month is closed. */
interface Base {
  readonly sketch: HyperLogLog;
  readonly frozen: number | null;
  readonly readAt: number;
}

/**
 * Five minutes: the ledger's own cadence. A snapshot is also dropped the moment a ledger write
 * signals, so this only bounds a signal that was lost.
 */
const DEFAULT_LEDGER_MAX_AGE_MS = 5 * 60 * 1000;
/**
 * Five minutes. What Postgres holds of the month only adds people an instance has already published
 * live — its flush writes what its publish already did — so this only bounds the case of an
 * instance that restarted and took its live field with it.
 */
const DEFAULT_BASE_MAX_AGE_MS = 5 * 60 * 1000;
/** Ten thousand project-months: at most 160 MiB of dense sketches, far less for sparse ones. */
const DEFAULT_BASE_ENTRIES = 10_000;
const PROJECTS_MAX_AGE_MS = 5 * 60 * 1000;

/**
 * An organisation's balance as it stands this second, computed every five seconds (ADR-0017).
 *
 * ```
 * live balance = ledger balance − pending
 * pending      = Σ over open periods of max(0, price(month MAU now) − billed so far)
 * ```
 *
 * **Derived, never accumulated.** The month's MAU is the union of what Postgres holds and what
 * every API instance has published live — the same registers the ledger will price once the
 * instances flush — so pending is exactly what the next ledger pass will charge, and the live
 * balance is exactly what the ledger will then say. Nothing here charges: the ledger pass prices
 * Postgres alone, every five minutes.
 *
 * **Postgres is read on change, not per tick.** The ledger figures come from a snapshot in Valkey,
 * dropped whenever a ledger write signals and re-read at most every five minutes; each project's
 * Postgres half of the month is held in memory for as long. What a tick reads is Valkey.
 */
export class LiveBalance {
  private readonly bases = new Map<string, Base>();
  private readonly projects = new Map<string, { ids: readonly string[]; readAt: number }>();

  constructor(
    private readonly uow: UnitOfWork,
    private readonly sketches: LiveUsageSketches,
    private readonly cache: LiveBalanceCache,
    private readonly clock: Clock,
    private readonly options: LiveBalanceOptions = {},
  ) {}

  /** Recomputes one organisation's live balance, stores it, and answers it. */
  async refresh(orgId: string): Promise<LiveFigure> {
    const now = this.clock.now();
    const periods = openPeriods(now);
    const ledger = await this.ledger(orgId, periods, now);
    const projectIds = await this.projectsOf(orgId, now);

    let pending = 0;
    for (const period of periods) {
      let mau = 0;
      for (const projectId of projectIds) mau += await this.monthCount(projectId, period, now);
      pending += Math.max(0, mauCents(mau) - (ledger.billedCents[period] ?? 0));
    }

    const live: LiveFigure = {
      balanceCents: ledger.balanceCents - pending,
      pendingCents: pending,
      asOf: now.getTime(),
    };
    await this.cache.putLive(orgId, live);
    return live;
  }

  /** Forgets what is held for an organisation's ledger, so the next refresh reads it again. */
  async ledgerMoved(orgId: string): Promise<void> {
    await this.cache.dropLedger(orgId);
  }

  private async ledger(
    orgId: string,
    periods: readonly string[],
    now: Date,
  ): Promise<LedgerSnapshot> {
    const held = await this.cache.ledger(orgId);
    const maxAge = this.options.ledgerMaxAgeMs ?? DEFAULT_LEDGER_MAX_AGE_MS;
    if (
      held !== null &&
      now.getTime() - held.readAt < maxAge &&
      periods.every((period) => period in held.billedCents)
    ) {
      return held;
    }

    const context = new OrgContext(orgId, "live-balance", "system");
    const snapshot = await this.uow.transaction(async (tx) => {
      const drawdown = new UsageDrawdownRepository(tx, context);
      const billedCents: Record<string, number> = {};
      for (const period of periods)
        billedCents[period] = (await drawdown.stateFor(period)).billedCents;
      return {
        balanceCents: await new WalletLedger(tx, context).balanceCents(now),
        billedCents,
        readAt: now.getTime(),
      };
    });
    await this.cache.putLedger(orgId, snapshot);
    return snapshot;
  }

  private async projectsOf(orgId: string, now: Date): Promise<readonly string[]> {
    const held = this.projects.get(orgId);
    if (held !== undefined && now.getTime() - held.readAt < PROJECTS_MAX_AGE_MS) return held.ids;
    const context = new OrgContext(orgId, "live-balance", "system");
    const rows = await this.uow.transaction((tx) => new OrgProjectRepository(tx, context).list());
    const ids = rows.map((project) => project.id);
    this.projects.set(orgId, { ids, readAt: now.getTime() });
    return ids;
  }

  /** A project's month: frozen once closed, otherwise Postgres unioned with every live view. */
  private async monthCount(projectId: string, period: string, now: Date): Promise<number> {
    const base = await this.base(projectId, period, now);
    if (base.frozen !== null) return base.frozen;
    const live = await this.sketches.read(projectId, period);
    return HyperLogLog.union([base.sketch, ...live]).count;
  }

  private async base(projectId: string, period: string, now: Date): Promise<Base> {
    const key = `${projectId}:${period}`;
    const held = this.bases.get(key);
    const maxAge = this.options.baseMaxAgeMs ?? DEFAULT_BASE_MAX_AGE_MS;
    if (held !== undefined && now.getTime() - held.readAt < maxAge) return held;

    const tenant = new TenantContext(projectId, "live-balance", "system");
    const days = await this.uow.transaction((tx) =>
      new UsageRepository(tx, tenant).dailyBetween(period, monthEnd(period)),
    );
    const sketch = HyperLogLog.empty();
    let frozen: number | null = null;
    for (const day of days) {
      sketch.mergeFrom(day.activeUsers);
      // A closed month has no sketches left and `mau_to_date` stands in for them — the figure the
      // period was billed on, the same one the drawdown reads.
      if (day.mauToDate !== null) frozen = day.mauToDate;
    }
    const fresh: Base = { sketch, frozen, readAt: now.getTime() };

    // Oldest out first; a Map iterates in insertion order, and re-inserting moves a key to the end.
    this.bases.delete(key);
    this.bases.set(key, fresh);
    const limit = this.options.baseEntries ?? DEFAULT_BASE_ENTRIES;
    while (this.bases.size > limit) {
      const oldest = this.bases.keys().next().value;
      if (oldest === undefined) break;
      this.bases.delete(oldest);
    }
    return fresh;
  }
}
