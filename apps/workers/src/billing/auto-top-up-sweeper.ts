import type { Logger } from "@idenzy/core/logging/logger";
import type { BillingWorkReader } from "@idenzy/persistence/repository/billing-work-reader";
import type { AutoTopUpRunner } from "./auto-top-up-runner.js";

export interface AutoTopUpSweeperOptions {
  readonly intervalMs?: number;
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

  constructor(
    private readonly runner: AutoTopUpRunner,
    private readonly work: BillingWorkReader,
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
    try {
      // Reconcile first: an open charge blocks its organisation's rule, so finishing it is what
      // lets the look below decide anything.
      await this.runner.reconcile();
      for (const orgId of await this.work.armedRules(this.options.rulesPerPass ?? DEFAULT_RULES)) {
        try {
          await this.runner.evaluate(orgId, false);
        } catch (cause: unknown) {
          this.logger.error("automatic top-up failed", {
            orgId,
            component: "billing",
            outcome: "deferred",
            errorName: cause instanceof Error ? cause.name : "unknown",
          });
        }
      }
    } catch (cause: unknown) {
      this.logger.error("automatic top-up sweep failed", {
        component: "billing",
        outcome: "deferred",
        errorName: cause instanceof Error ? cause.name : "unknown",
      });
    }
  }
}
