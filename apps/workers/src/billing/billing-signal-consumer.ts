import type { DueEntry, DueSet } from "@idenzy/cache/due-set";
import type { SpacingGate } from "@idenzy/cache/spacing-gate";
import type { Logger } from "@idenzy/core/logging/logger";
import type { Clock } from "@idenzy/core/time/clock";
import type { BillingWorkReader } from "@idenzy/persistence/repository/billing-work-reader";
import type { UsageDrawdown } from "../usage-drawdown.js";
import type { AutoTopUpRunner } from "./auto-top-up-runner.js";
import { inParallel } from "./in-parallel.js";

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
 * A minute: the meter's own flush interval by default. Repricing a month more often than its
 * sketches are written reads the same numbers again, and a busy organisation's month is a read
 * of up to thirty-one sketches per project.
 */
const DEFAULT_SPACING_MS = 60_000;
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
 * **Projects whose usage moved** are resolved to their organisations and repriced — at most
 * once a minute each, whichever worker gets there, because the drawdown's watermark makes an
 * extra repricing free of charge but not free of reads. A charge the repricing raises signals
 * the organisation's wallet in turn.
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
      const gate = await this.repriceGate.pass(org, spacing);
      if (!gate.passed) {
        const until = new Date(this.clock.now().getTime() + gate.waitMs);
        for (const entry of entries) await this.drawdownDue.defer(entry, until);
        return;
      }
      // `runFor` catches and logs per organisation, and leaves the watermark where it was.
      await this.drawdown.runFor([org]);
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
      if (this.topUps !== null) {
        const result = await this.topUps.evaluate(entry.member, true);
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
