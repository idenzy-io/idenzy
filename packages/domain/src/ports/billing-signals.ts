/**
 * Port for telling the billing worker that something moved, sooner than it would look on its
 * own (ADR-0017).
 *
 * **A signal is a hint and never a record.** None of these carries an amount. Losing one — a
 * cache restart, a network blip, a process killed between the write and the send — delays the
 * work until the worker's own periodic pass reaches it; it never loses money and never charges
 * any. Postgres holds everything a charge rests on, and the worker re-reads it under a lock
 * before acting, so a duplicate or a stale signal is exactly as harmless as a lost one.
 *
 * **Sending one never throws.** A signal is sent from a sign-in's metering flush, a settings
 * save and a payment webhook, and none of those may fail because a queue in front of a
 * background job was unavailable. The public methods are the invariant; subclasses implement
 * the send and are allowed to throw from it.
 */
export abstract class BillingSignals {
  /** A project's usage was written down; its organisation's month is worth repricing. */
  async usageMoved(projectId: string): Promise<void> {
    await this.swallow("usage_moved", () => this.sendUsageMoved(projectId));
  }

  /** An organisation's balance moved; the automatic top-up is worth another look. */
  async walletMoved(orgId: string): Promise<void> {
    await this.swallow("wallet_moved", () => this.sendWalletMoved(orgId));
  }

  /** An organisation's rule was edited; any cached copy is wrong, and it is worth a look too. */
  async ruleChanged(orgId: string): Promise<void> {
    await this.swallow("rule_changed", () => this.sendRuleChanged(orgId));
  }

  protected abstract sendUsageMoved(projectId: string): Promise<void>;
  protected abstract sendWalletMoved(orgId: string): Promise<void>;
  protected abstract sendRuleChanged(orgId: string): Promise<void>;

  /** Where a failed send goes. The caller carries on either way. */
  protected abstract failed(signal: string, cause: unknown): void;

  private async swallow(signal: string, send: () => Promise<void>): Promise<void> {
    try {
      await send();
    } catch (cause: unknown) {
      this.failed(signal, cause);
    }
  }
}

/** For a deployment, or a test, with nothing listening. Every signal is a no-op. */
export class NullBillingSignals extends BillingSignals {
  protected override async sendUsageMoved(): Promise<void> {}
  protected override async sendWalletMoved(): Promise<void> {}
  protected override async sendRuleChanged(): Promise<void> {}
  protected override failed(): void {}
}
