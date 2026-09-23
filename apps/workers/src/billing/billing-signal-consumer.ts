import type { AutoTopUpRuleCache } from "@idenzy/cache/auto-top-up-rule-cache";
import type { DueEntry, DueSet } from "@idenzy/cache/due-set";
import type { SpacingGate } from "@idenzy/cache/spacing-gate";
import type { Logger } from "@idenzy/core/logging/logger";
import type { Clock } from "@idenzy/core/time/clock";
import type { BillingWorkReader } from "@idenzy/persistence/repository/billing-work-reader";
import type { UsageDrawdown } from "../usage-drawdown.js";
import type { AutoTopUpRunner } from "./auto-top-up-runner.js";
import { inParallel } from "./in-parallel.js";
import type { LiveBalance } from "./live-balance.js";

export interface BillingSignalConsumerOptions {
  /** How often the due sets are drained. */
  readonly tickMs?: number;
  /** The least time between two repricings of one organisation's month. */
  readonly repriceSpacingMs?: number;
  /** How long to leave an organisation whose look failed before trying it again. */
  readonly retryAfterMs?: number;
  readonly batch?: number;
  /** How long a claimed entry is ours before another worker may take it. */
  readonly leaseMs?: number;
  /** Organisations worked on at once. */
  readonly parallelism?: number;
}

/**
 * Five seconds, which is what the product asked for and what a due set makes cheap: an empty
 * set is one `ZRANGEBYSCORE` answering nothing.
 */
const DEFAULT_TICK_MS = 5_000;
/**
 * Five minutes between ledger writes per organisation: at most 288 `usage_charges` rows a day,
 * where writing every tick would be up to 17,280. The balance a person sees does not wait for it —
 * the live figure is recomputed every tick — so this spacing is only how often the charge is
 * booked, never how fresh it looks.
 */
const DEFAULT_SPACING_MS = 5 * 60 * 1000;
const DEFAULT_RETRY_MS = 60_000;
const DEFAULT_BATCH = 100;
/**
 * Thirty seconds: longer than one look takes, provider call included, and short enough that a
 * worker that died holding a claim costs the organisation half a minute rather than a pass.
 */
const DEFAULT_LEASE_MS = 30_000;
const DEFAULT_PARALLELISM = 8;

/**
 * Drains the two billing due sets on a short tick (ADR-0017).
 *
 * **Projects whose usage moved** are resolved to their organisations, whose live balance is
 * recomputed on the spot, and whose ledger is repriced at most once every five minutes — whichever
 * worker gets there. A charge the repricing raises signals the organisation's wallet in turn.
 *
 * **Organisations whose wallet moved** get one look from the automatic top-up, which decides
 * under the settings row lock whether to charge. That is the "immediately after a charge" path:
 * the drawdown charges, marks the wallet, and within one tick the rule has looked.
 *
 * Nothing here is authoritative and nothing here is the only way anything happens. The drawdown
 * still runs its five-minute pass, the top-up still sweeps every armed rule on that pass, and a
 * signal that was lost — Valkey restarted, a mark failed — costs at most that delay.
 */
export class BillingSignalConsumer {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly drawdownDue: DueSet,
    private readonly autoTopUpDue: DueSet,
    private readonly repriceGate: SpacingGate,
    private readonly work: BillingWorkReader,
    private readonly drawdown: UsageDrawdown,
    private readonly live: LiveBalance,
    private readonly rules: AutoTopUpRuleCache,
    /** Null in a deployment with no payment provider, where there is nothing to charge. */
    private readonly topUps: AutoTopUpRunner | null,
    private readonly clock: Clock,
    private readonly logger: Logger,
    private readonly options: BillingSignalConsumerOptions = {},
  ) {}

  start(): void {
    this.timer = setInterval(() => {
      void this.tick();
    }, this.options.tickMs ?? DEFAULT_TICK_MS);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }

  /**
   * One drain of both sets. A tick that is still running when the next is due is skipped rather
   * than overlapped: a slow provider call must not stack ticks behind it.
   */
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.drainUsage();
      await this.drainWallets();
    } catch (cause: unknown) {
      // Valkey unreachable, most likely. The periodic passes carry on without it.
      this.logger.warn("billing signals not drained", {
        component: "billing",
        outcome: "deferred",
        errorName: cause instanceof Error ? cause.name : "unknown",
      });
    } finally {
      this.running = false;
    }
  }

  private async drainUsage(): Promise<void> {
    const now = this.clock.now();
    const due = await this.drawdownDue.claim(now, this.batch(), this.lease());
    if (due.length === 0) return;

    const orgOf = await this.work.orgsOf(due.map((entry) => entry.member));
    const byOrg = new Map<string, DueEntry[]>();
    for (const entry of due) {
      const org = orgOf.get(entry.member);
      // A project that no longer exists has nothing to reprice.
      if (org === undefined) {
        await this.drawdownDue.done(entry, now);
        continue;
      }
      byOrg.set(org, [...(byOrg.get(org) ?? []), entry]);
    }

    const spacing = this.options.repriceSpacingMs ?? DEFAULT_SPACING_MS;
    await inParallel([...byOrg], this.parallelism(), async ([org, entries]) => {
      // Every tick: the balance a person sees moves as fast as usage does, and so does the rule.
      const figure = await this.live.refresh(org);
      await this.topUpIfLow(org, figure.balanceCents, figure.pendingCents);
      // At most once per spacing: the ledger is what is written, and it is written rarely. The
      // entries are finished either way, because the live figure already reflects them and the
      // ledger pass reprices the whole month whenever it next runs.
      const gate = await this.repriceGate.pass(org, spacing);
      // `runFor` catches and logs per organisation, and leaves the watermark where it was.
      if (gate.passed) await this.drawdown.runFor([org]);
      for (const entry of entries) await this.drawdownDue.done(entry, this.clock.now());
    });
  }

  private async drainWallets(): Promise<void> {
    const due = await this.autoTopUpDue.claim(this.clock.now(), this.batch(), this.lease());
    await inParallel(due, this.parallelism(), (entry) => this.lookAt(entry));
  }

  /** One organisation's look. Its failure is deferred and never the tick's. */
  private async lookAt(entry: DueEntry): Promise<void> {
    try {
      // With nothing to charge, a mark is drained and dropped rather than left to accumulate.
      // A wallet mark means the ledger was written: the snapshot is dropped and the live figure
      // recomputed before anything decides from it.
      await this.live.ledgerMoved(entry.member);
      const figure = await this.live.refresh(entry.member);
      if (this.topUps !== null) {
        const result = await this.topUps.evaluate(entry.member, true, figure.pendingCents);
        if (result.kind !== "skipped") {
          this.logger.info("automatic top-up looked", {
            orgId: entry.member,
            component: "billing",
            outcome: result.kind,
          });
        }
      }
      await this.autoTopUpDue.done(entry, this.clock.now());
    } catch (cause: unknown) {
      this.logger.error("automatic top-up failed", {
        orgId: entry.member,
        component: "billing",
        outcome: "deferred",
        errorName: cause instanceof Error ? cause.name : "unknown",
      });
      const retry = this.options.retryAfterMs ?? DEFAULT_RETRY_MS;
      await this.autoTopUpDue
        .defer(entry, new Date(this.clock.now().getTime() + retry))
        .catch(() => undefined);
    }
  }

  /**
   * Gives the rule a look when the live balance is under its threshold.
   *
   * Decided from the cached rule so the five-second path reads no Postgres for an organisation
   * whose rule is off or whose balance is comfortably above it — which is almost all of them. A
   * missing cache entry means ask, because the look fills it; a stale one only makes the look
   * early or late, since the decision is made again under the settings row lock.
   */
  private async topUpIfLow(orgId: string, balanceCents: number, pendingCents: number) {
    if (this.topUps === null) return;
    const rule = await this.rules.get(orgId).catch(() => null);
    if (rule !== null && (!rule.armed || balanceCents >= rule.thresholdCents)) return;
    try {
      const result = await this.topUps.evaluate(orgId, true, pendingCents);
      if (result.kind !== "skipped") {
        this.logger.info("automatic top-up looked", {
          orgId,
          component: "billing",
          outcome: result.kind,
        });
      }
    } catch (cause: unknown) {
      // Not this lane's to retry: the wallet mark and the sweep both come back to it.
      this.logger.error("automatic top-up failed", {
        orgId,
        component: "billing",
        outcome: "deferred",
        errorName: cause instanceof Error ? cause.name : "unknown",
      });
    }
  }

  private batch(): number {
    return this.options.batch ?? DEFAULT_BATCH;
  }

  private lease(): number {
    return this.options.leaseMs ?? DEFAULT_LEASE_MS;
  }

  private parallelism(): number {
    return this.options.parallelism ?? DEFAULT_PARALLELISM;
  }
}
