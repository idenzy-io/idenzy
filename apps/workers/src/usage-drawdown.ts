import type { Logger } from "@idenzy/core/logging/logger";
import { HyperLogLog } from "@idenzy/core/metering/hyper-log-log";
import type { Clock } from "@idenzy/core/time/clock";
import { SpendTolerance } from "@idenzy/domain/policies/spend-tolerance";
import { type BillingSignals, NullBillingSignals } from "@idenzy/domain/ports/billing-signals";
import { WalletLedger } from "@idenzy/persistence/billing/wallet-ledger";
import { CreditGrantRepository } from "@idenzy/persistence/repository/credit-grant-repository";
import { OrgProjectRepository } from "@idenzy/persistence/repository/org-project-repository";
import type { OrgUsageActivityReader } from "@idenzy/persistence/repository/org-usage-activity-reader";
import { ProjectSpendStateRepository } from "@idenzy/persistence/repository/project-spend-state-repository";
import { UsageDrawdownRepository } from "@idenzy/persistence/repository/usage-drawdown-repository";
import { UsageRepository } from "@idenzy/persistence/repository/usage-repository";
import { OrgContext } from "@idenzy/persistence/tenancy/org-context";
import { TenantContext } from "@idenzy/persistence/tenancy/tenant-context";
import type { UnitOfWork } from "@idenzy/persistence/tenancy/unit-of-work";
import { mauCents, TOLERANCE_WINDOW_DAYS } from "@idenzy/protocol/billing/price-list";
import { BillingLineItem } from "@idenzy/protocol/enums/billing";

export interface UsageDrawdownOptions {
  readonly intervalMs?: number;
  /** Organisations per pass. A pass is a pass; the next one is minutes away. */
  readonly orgsPerPass?: number;
  /** How long a published spend decision stands before a cell ignores it and sends anyway. */
  readonly spendStateTtlMs?: number;
}

/**
 * Five minutes.
 *
 * Not less, because the meter buffers in memory and flushes on
 * `USAGE_FLUSH_INTERVAL_SECONDS` — repricing more often than the flush reads the same
 * numbers again. Not more, because the wallet a customer is looking at should not be an
 * hour behind what they have spent.
 */
const DEFAULT_INTERVAL_MS = 5 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * How long a published spend decision stands before a cell ignores it.
 *
 * Six hours against a five-minute pass: roughly seventy consecutive failures before the gate
 * opens on its own. Long enough that a restart, a deploy or a bad afternoon does not quietly
 * stop a paying customer's one-time codes; short enough that a drawdown nobody noticed had died
 * does not hold a decision from last week (ADR-0014, ADR-0016).
 */
const DEFAULT_TTL_MS = 6 * 60 * 60 * 1000;
const DEFAULT_ORGS = 200;

/** The first day of the month `at` falls in, `YYYY-MM-DD` in UTC. */
function monthStart(at: Date): string {
  return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1)).toISOString().slice(0, 10);
}

/** The last day of the month beginning at `period`. */
function monthEnd(period: string): string {
  const start = new Date(`${period}T00:00:00.000Z`);
  return new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0))
    .toISOString()
    .slice(0, 10);
}

/**
 * Takes what usage costs out of the wallet (ADR-0014).
 *
 * **It reprices the month and charges the difference.** Never the price of a delta: the
 * bands are marginal, so pricing 40,000 users on their own has to guess which band they
 * fall in and gets it wrong at every boundary. `mauCents` prices the month as it now
 * stands, the watermark says what has already been charged, and the difference is what is
 * taken. Every band boundary is settled inside a pure function and none of it is here.
 *
 * **That is also the whole of the idempotency.** MAU within a month only grows, so the
 * watermark only moves forward and the difference is never negative. A pass that runs twice
 * computes zero the second time. Two passes at once both compute the same figure, and the
 * compare-and-swap inside `advance` lets exactly one of them commit — the other finds the
 * watermark moved and leaves it, because its charge has already been made by somebody else.
 *
 * **Taking the credit, moving the debt, writing the record and advancing the watermark are
 * one transaction.** Any split is a way to charge twice or to charge and forget.
 *
 * SMS is deliberately not here. It is the one meter where money leaves before the work is
 * done, so it is reserved in the request against the spend cap, where it already is;
 * batching it would mean reconciling money that has already gone.
 */
export class UsageDrawdown {
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly uow: UnitOfWork,
    private readonly activity: OrgUsageActivityReader,
    private readonly clock: Clock,
    private readonly logger: Logger,
    private readonly signals: BillingSignals = new NullBillingSignals(),
    private readonly options: UsageDrawdownOptions = {},
  ) {}

  start(): void {
    const every = this.options.intervalMs ?? DEFAULT_INTERVAL_MS;
    this.timer = setInterval(() => {
      void this.runOnce();
    }, every);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }

  /** One pass. Returns how many organisations were charged something. */
  async runOnce(): Promise<number> {
    const period = monthStart(this.clock.now());
    let orgs: readonly string[];
    try {
      orgs = await this.activity.withActivity(period, this.options.orgsPerPass ?? DEFAULT_ORGS);
    } catch (cause: unknown) {
      // This runs on a timer through `void`, so a rejection here would have nobody to catch it
      // and would take the worker down. Nothing is lost by skipping a pass.
      this.logger.error("usage drawdown pass skipped", {
        component: "billing",
        outcome: "deferred",
        errorName: cause instanceof Error ? cause.name : "unknown",
      });
      return 0;
    }
    return await this.runFor(orgs);
  }

  /**
   * Reprices the named organisations now, rather than waiting for the pass (ADR-0017).
   *
   * What a usage signal calls. Safe for exactly the reason the pass is: the watermark makes a
   * second repricing of the same month charge nothing, so being asked early, late or twice
   * costs a read and never a charge.
   */
  async runFor(orgs: readonly string[]): Promise<number> {
    const now = this.clock.now();
    const period = monthStart(now);

    let charged = 0;
    for (const orgId of orgs) {
      try {
        if (await this.chargeOne(orgId, period, now)) {
          charged += 1;
          // The balance just fell, which is the moment the automatic top-up exists for.
          await this.signals.walletMoved(orgId);
        }
        // Every organisation in the pass, not only the ones that were charged something. An
        // organisation past its tolerance stops owing more the moment it stops being served,
        // so "nothing new to charge" is exactly the state a stale gate would get wrong.
        await this.publishSpendState(orgId, now);
      } catch (cause: unknown) {
        // One organisation's failure is not the pass's. The watermark did not move, so the
        // next pass computes the same difference and nothing is lost.
        this.logger.error("usage drawdown failed", {
          orgId,
          component: "billing",
          outcome: "deferred",
          errorName: cause instanceof Error ? cause.name : "unknown",
        });
      }
    }
    return charged;
  }

  private async chargeOne(orgId: string, period: string, now: Date): Promise<boolean> {
    const context = new OrgContext(orgId, "usage-drawdown", "system");
    const mau = await this.organisationMau(context, period);
    const priced = mauCents(mau);

    return await this.uow.transaction(async (tx) => {
      const drawdown = new UsageDrawdownRepository(tx, context);
      const state = await drawdown.stateFor(period);
      const owed = priced - state.billedCents;
      // Nothing new to charge. The common case by a distance: a month is repriced every
      // five minutes and only moves when somebody new signs in.
      if (owed <= 0) return false;

      // Credit first, and only what is actually there; what it cannot cover becomes debt.
      // The ledger draws each grant in one conditional statement, so a grant being spent by
      // something else cannot be over-drawn — what comes back is what was really taken.
      const debited = await new WalletLedger(tx, context).debit(owed, now);
      await drawdown.record({
        period,
        item: BillingLineItem.Mau,
        quantity: mau,
        chargedCents: owed,
        fromCreditCents: debited.fromCreditCents,
        toDebtCents: debited.toDebtCents,
      });

      // Last, and inside the same transaction. If this loses the race the whole thing
      // rolls back — including the credit that was drawn — which is what makes two passes
      // at once safe rather than merely unlikely.
      const advanced = await drawdown.advance(period, state.billedMau, mau, priced);
      if (!advanced) {
        throw new ConcurrentDrawdown(`another pass charged ${orgId} for ${period} first`);
      }
      return true;
    });
  }

  /**
   * Projects the organisation's spend decision onto each of its projects (ADR-0016).
   *
   * The decision is made here because this is where the ledger is: debt, credit and the
   * tolerance window are all org-keyed, and a send path that recomputed them would join across
   * three billing tables before every one-time code. The projection is one row per project so
   * that path reads one row under the tenant it already holds.
   *
   * That makes this an optimisation and not an isolation boundary. It used to be argued as one —
   * a project sat in a different cell to the ledger, and reaching across the plane boundary would
   * have handed every cell control-plane credentials — and there are no cells. What survives
   * untouched is the fail-open half: an absent or stale row means spendable, because a billing
   * job that stopped must not be able to stop authentication.
   */
  private async publishSpendState(orgId: string, now: Date): Promise<void> {
    const context = new OrgContext(orgId, "usage-drawdown", "system");

    const decision = await this.uow.transaction(async (tx) => {
      const drawdown = new UsageDrawdownRepository(tx, context);
      const since = new Date(now.getTime() - TOLERANCE_WINDOW_DAYS * DAY_MS);
      return new SpendTolerance().decide({
        debtCents: await drawdown.debtCents(),
        creditCents: await new CreditGrantRepository(tx, context).balanceCents(now),
        chargedInWindowCents: await drawdown.chargedSince(since),
      });
    });

    const projects = await this.uow.transaction((tx) =>
      new OrgProjectRepository(tx, context).list(),
    );
    const staleAfter = new Date(now.getTime() + (this.options.spendStateTtlMs ?? DEFAULT_TTL_MS));

    for (const project of projects) {
      const tenant = new TenantContext(project.id, "usage-drawdown", "system");
      await this.uow.transaction((tx) =>
        new ProjectSpendStateRepository(tx, tenant).publish({
          spendable: decision.spendable,
          reason: decision.reason,
          computedAt: now,
          staleAfter,
        }),
      );
    }
  }

  /**
   * A month's active users for one organisation, summed across its projects.
   *
   * The sum across projects is exact and the union within one is not optional, which is the
   * pair worth keeping straight. Users are project-scoped, so two projects' sets are
   * disjoint and nobody is counted twice by adding them. A project's own days are the
   * opposite case — the same person comes back on Tuesday — so those are unioned from the
   * sketches, which is the only honest way to count them.
   *
   * Read per project under its own tenant, exactly as the period closer does it. There is
   * no SQL that could do this: `mau_hll` is a `bytea` holding a sketch this codebase
   * serialises itself, not a Postgres `hll` type.
   */
  private async organisationMau(context: OrgContext, period: string): Promise<number> {
    const projects = await this.uow.transaction((tx) =>
      new OrgProjectRepository(tx, context).list(),
    );

    let total = 0;
    for (const project of projects) {
      const tenant = new TenantContext(project.id, "usage-drawdown", "system");
      const days = await this.uow.transaction((tx) =>
        new UsageRepository(tx, tenant).dailyBetween(period, monthEnd(period)),
      );
      const running = HyperLogLog.empty();
      let frozen: number | null = null;
      for (const day of days) {
        running.mergeFrom(day.activeUsers);
        // A closed month has no sketches left and `mauToDate` stands in for them, which is
        // the figure the period was actually billed on.
        if (day.mauToDate !== null) frozen = day.mauToDate;
      }
      total += frozen ?? running.count;
    }
    return total;
  }
}

/**
 * Another pass charged this organisation first.
 *
 * Thrown to roll the transaction back rather than returned, because by this point credit
 * has been drawn and a record written, and both have to go with it. It is not an error
 * anybody needs to act on: the other pass made exactly this charge.
 */
class ConcurrentDrawdown extends Error {
  override readonly name = "ConcurrentDrawdown";
}
