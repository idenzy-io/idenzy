import type { Clock } from "@idenzy/core/time/clock";
import { BillingSignals } from "@idenzy/domain/ports/billing-signals";
import type { AutoTopUpRuleCache } from "./auto-top-up-rule-cache.js";
import type { DueSet } from "./due-set.js";

/** The due set of projects whose organisation's month is worth repricing. */
export const DRAWDOWN_DUE_KEY = "billing:due:drawdown";
/** The due set of organisations whose automatic top-up is worth another look. */
export const AUTO_TOP_UP_DUE_KEY = "billing:due:auto-top-up";

/**
 * Billing signals as marks in two Valkey due sets (ADR-0017).
 *
 * A mark is due at once. The consumer is what decides how soon work actually happens — it
 * spaces repricing per organisation — so a producer never has to know the cadence, and a
 * signal sent a thousand times before the next tick is still one piece of work.
 */
export class ValkeyBillingSignals extends BillingSignals {
  constructor(
    private readonly drawdownDue: DueSet,
    private readonly autoTopUpDue: DueSet,
    private readonly rules: AutoTopUpRuleCache,
    private readonly clock: Clock,
    private readonly onFailure: (signal: string, cause: unknown) => void,
  ) {
    super();
  }

  protected override async sendUsageMoved(projectId: string): Promise<void> {
    await this.drawdownDue.mark(projectId, this.clock.now());
  }

  protected override async sendWalletMoved(orgId: string): Promise<void> {
    await this.autoTopUpDue.mark(orgId, this.clock.now());
  }

  /** The cached copy goes first: a look that read it before the drop would see the old rule. */
  protected override async sendRuleChanged(orgId: string): Promise<void> {
    await this.rules.drop(orgId);
    await this.autoTopUpDue.mark(orgId, this.clock.now());
  }

  protected override failed(signal: string, cause: unknown): void {
    this.onFailure(signal, cause);
  }
}
