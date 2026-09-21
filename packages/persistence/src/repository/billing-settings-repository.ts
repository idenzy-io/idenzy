import { and, eq, sql } from "drizzle-orm";
import { billingSettings } from "../schema/billing.js";
import type { OrgContext } from "../tenancy/org-context.js";
import type { ControlTx } from "../tenancy/unit-of-work.js";
import { OrgRepository } from "./org-repository.js";

export interface AutoTopUpRow {
  readonly enabled: boolean;
  readonly thresholdCents: number;
  readonly amountCents: number;
  readonly methodId: string | null;
}

export interface SpendAlertRow {
  readonly enabled: boolean;
  readonly thresholdCents: number;
  readonly sentForMonth: string | null;
}

export interface BillingSettingsRow {
  readonly currency: string;
  readonly autoTopUp: AutoTopUpRow;
  readonly spendAlert: SpendAlertRow;
  readonly updatedBy: string | null;
  readonly updatedAt: Date;
}

/** What an organisation that has never opened the screen gets: both levers off. */
const DEFAULTS: Omit<BillingSettingsRow, "updatedAt"> = {
  currency: "USD",
  autoTopUp: { enabled: false, thresholdCents: 0, amountCents: 0, methodId: null },
  spendAlert: { enabled: false, thresholdCents: 0, sentForMonth: null },
  updatedBy: null,
};

/**
 * The rules an organisation has set about its own money (ADR-0011, PROJECT.md 5.1).
 *
 * `current` never answers null. A missing row and a row with both levers off mean the
 * same thing, and handing back the one shape spares every caller a branch whose two
 * sides would be identical — which is also the branch somebody eventually gets wrong in
 * the direction that charges a card.
 */
export class BillingSettingsRepository extends OrgRepository<typeof billingSettings> {
  constructor(tx: ControlTx, context: OrgContext) {
    super(tx, context, billingSettings);
  }

  async current(): Promise<BillingSettingsRow> {
    const rows = await this.tx.select().from(billingSettings).where(this.orgScope()).limit(1);
    const row = rows[0];
    if (row === undefined) return { ...DEFAULTS, updatedAt: new Date(0) };
    return {
      currency: row.currency,
      autoTopUp: {
        enabled: row.autoTopUpEnabled,
        thresholdCents: row.autoTopUpThresholdCents,
        amountCents: row.autoTopUpAmountCents,
        methodId: row.autoTopUpMethodId,
      },
      spendAlert: {
        enabled: row.spendAlertEnabled,
        thresholdCents: row.spendAlertThresholdCents,
        sentForMonth: row.spendAlertSentForMonth,
      },
      updatedBy: row.updatedBy,
      updatedAt: row.updatedAt,
    };
  }

  /**
   * An automatic rule that added less than it triggered on would fire again on the
   * balance it had just created. `billing_settings_auto_top_up_ck` refuses that pair, so
   * this surfaces as a constraint violation rather than as a charge loop.
   */
  async setAutoTopUp(setting: AutoTopUpRow, updatedBy: string | null): Promise<void> {
    await this.upsert(
      {
        autoTopUpEnabled: setting.enabled,
        autoTopUpThresholdCents: setting.thresholdCents,
        autoTopUpAmountCents: setting.amountCents,
        autoTopUpMethodId: setting.methodId,
      },
      updatedBy,
    );
  }

  async setSpendAlert(
    setting: Omit<SpendAlertRow, "sentForMonth">,
    updatedBy: string | null,
  ): Promise<void> {
    await this.upsert(
      {
        spendAlertEnabled: setting.enabled,
        spendAlertThresholdCents: setting.thresholdCents,
        // A new threshold has not been alerted on yet, whatever the old one had reached.
        spendAlertSentForMonth: null,
      },
      updatedBy,
    );
  }

  /**
   * Records that this month's alert has gone out, and answers whether it was this call
   * that claimed it.
   *
   * The `is distinct from` predicate is the guard: a threshold crossed once would
   * otherwise be mailed on every sweep for the rest of the month, and a customer who
   * learns to ignore the alert has the same protection as one who never enabled it.
   */
  async claimSpendAlert(month: string): Promise<boolean> {
    const rows = await this.tx
      .update(billingSettings)
      .set({ spendAlertSentForMonth: month, updatedAt: new Date() })
      .where(
        and(
          this.orgScope(),
          eq(billingSettings.spendAlertEnabled, true),
          sql`${billingSettings.spendAlertSentForMonth} is distinct from ${month}`,
        ),
      )
      .returning({ orgId: billingSettings.orgId });
    return rows.length === 1;
  }

  private async upsert(
    values: Partial<typeof billingSettings.$inferInsert>,
    updatedBy: string | null,
  ): Promise<void> {
    const now = new Date();
    await this.guard(() =>
      this.tx
        .insert(billingSettings)
        .values({ orgId: this.context.orgId, ...values, updatedBy, updatedAt: now })
        .onConflictDoUpdate({
          target: billingSettings.orgId,
          set: { ...values, updatedBy, updatedAt: now },
        }),
    );
  }
}
