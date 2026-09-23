import type { LiveBalanceCache } from "@idenzy/cache/live-balance-cache";
import type { Logger } from "@idenzy/core/logging/logger";
import type { BillingWorkReader } from "@idenzy/persistence/repository/billing-work-reader";
import type { AutoTopUpRunner } from "./auto-top-up-runner.js";

export interface AutoTopUpSweeperOptions {
  readonly intervalMs?: number;
  /** Rules per page. A pass walks every page. */
  readonly rulesPerPass?: number;
}

/** Five minutes: the drawdown's own pass, so a lost signal costs what it cost before signals. */
const DEFAULT_INTERVAL_MS = 5 * 60 * 1000;
const DEFAULT_RULES = 500;

/**
 * The automatic top-up's own pass, which is what makes every signal optional (ADR-0017).
 *
 * Two jobs. It looks at every armed rule straight from Postgres — not through the cache — so a
 * mark lost to a Valkey restart, or a cached "off" that went stale, is caught within one pass.
 * And it reconciles automatic charges whose answer was never written down, which is the only
 * thing that ever closes a charge a crash left open.
 */
export class AutoTopUpSweeper {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly runner: AutoTopUpRunner,
    private readonly work: BillingWorkReader,
    private readonly live: LiveBalanceCache,
    private readonly logger: Logger,
    private readonly options: AutoTopUpSweeperOptions = {},
  ) {}

  async start(): Promise<void> {
    await this.runOnce();
    this.timer = setInterval(() => {
      void this.runOnce();
    }, this.options.intervalMs ?? DEFAULT_INTERVAL_MS);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }

  async runOnce(): Promise<void> {
    // Not joined by the next tick when it outlasts the interval, which walking every page can.
    if (this.running) return;
    this.running = true;
    try {
      // Reconcile first: an open charge blocks its organisation's rule, so finishing it is what
      // lets the look below decide anything.
      await this.runner.reconcile();
      const page = this.options.rulesPerPass ?? DEFAULT_RULES;
      let after: string | null = null;
      // Every page: an organisation past the first page's end would otherwise never be swept,
      // and the sweep is what catches every signal that was lost.
      for (;;) {
        const orgs: readonly string[] = await this.work.armedRules(page, after);
        for (const orgId of orgs) await this.look(orgId);
        const last = orgs.at(-1);
        if (orgs.length < page || last === undefined) break;
        after = last;
      }
    } catch (cause: unknown) {
      this.logger.error("automatic top-up sweep failed", {
        component: "billing",
        outcome: "deferred",
        errorName: cause instanceof Error ? cause.name : "unknown",
      });
    } finally {
      this.running = false;
    }
  }

  /** One organisation, whose failure is not the pass's. */
  private async look(orgId: string): Promise<void> {
    try {
      // The live figure's pending usage where there is one; a missing one is none, which only
      // makes this pass as late as it was before live balances existed.
      const live = await this.live.live(orgId).catch(() => null);
      await this.runner.evaluate(orgId, false, live?.pendingCents ?? 0);
    } catch (cause: unknown) {
      this.logger.error("automatic top-up failed", {
        orgId,
        component: "billing",
        outcome: "deferred",
        errorName: cause instanceof Error ? cause.name : "unknown",
      });
    }
  }
}
