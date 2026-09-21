import { ResourceConflictError } from "@idenzy/core/errors";
import type {
  CardBrand,
  PaymentProvider,
  TopUpState,
  TopUpTrigger,
} from "@idenzy/protocol/enums/billing";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { topUps } from "../schema/billing.js";
import type { OrgContext } from "../tenancy/org-context.js";
import type { ControlTx } from "../tenancy/unit-of-work.js";
import { OrgRepository } from "./org-repository.js";

export interface TopUpRow {
  readonly id: string;
  readonly amountCents: number;
  readonly currency: string;
  readonly state: TopUpState;
  readonly trigger: TopUpTrigger;
  readonly provider: PaymentProvider;
  readonly providerIntentId: string | null;
  readonly paymentMethodId: string | null;
  readonly cardBrand: CardBrand | null;
  readonly cardLast4: string | null;
  readonly failureCode: string | null;
  readonly requestedBy: string | null;
  readonly createdAt: Date;
  readonly settledAt: Date | null;
}

/** What paid a charge, learned when it settled rather than when it opened. */
export interface SettledCard {
  readonly paymentMethodId: string | null;
  readonly brand: CardBrand;
  readonly last4: string;
}

export interface NewTopUp {
  readonly amountCents: number;
  readonly currency: string;
  readonly trigger: TopUpTrigger;
  readonly provider: PaymentProvider;
  /**
   * The card being charged, where one is known when the charge opens.
   *
   * Null for a hosted checkout, which is the case these three were not written for: the
   * cardholder picks the card on the provider's own page, so what it was is something the
   * completion event tells us rather than something we chose. The columns have always
   * allowed it — only this interface did not — and `settle` fills them in.
   */
  readonly paymentMethodId?: string | null | undefined;
  readonly cardBrand?: CardBrand | null | undefined;
  readonly cardLast4?: string | null | undefined;
  readonly requestedBy: string | null;
}

function toRow(row: typeof topUps.$inferSelect): TopUpRow {
  return {
    id: row.id,
    amountCents: row.amountCents,
    currency: row.currency,
    // Safe: each column is written only from the matching protocol enum.
    state: row.state as TopUpState,
    trigger: row.trigger as TopUpTrigger,
    provider: row.provider as PaymentProvider,
    cardBrand: row.cardBrand as CardBrand | null,
    providerIntentId: row.providerIntentId,
    paymentMethodId: row.paymentMethodId,
    cardLast4: row.cardLast4,
    failureCode: row.failureCode,
    requestedBy: row.requestedBy,
    createdAt: row.createdAt,
    settledAt: row.settledAt,
  };
}

/** The states a charge can still move out of, so a second submission is refused. */
const IN_FLIGHT: readonly TopUpState[] = ["pending", "requires_action"];

/**
 * Attempts to put money on the account (ADR-0011, PROJECT.md 5.1).
 *
 * A row exists from the moment a charge is started, not from the moment it succeeds, and
 * that ordering is the point of the table. Credit is granted when the provider confirms;
 * until then this is the only record that anything happened, which is what keeps a local
 * balance from ever reading as proof of a payment.
 */
export class TopUpRepository extends OrgRepository<typeof topUps> {
  constructor(tx: ControlTx, context: OrgContext) {
    super(tx, context, topUps);
  }

  async recent(limit = 50): Promise<TopUpRow[]> {
    const rows = await this.tx
      .select()
      .from(topUps)
      .where(this.orgScope())
      .orderBy(desc(topUps.createdAt))
      .limit(limit);
    return rows.map(toRow);
  }

  /** Charges still moving. A second top-up is refused while one of these stands. */
  async inFlight(): Promise<TopUpRow[]> {
    const rows = await this.tx
      .select()
      .from(topUps)
      .where(and(this.orgScope(), inArray(topUps.state, [...IN_FLIGHT])))
      .orderBy(desc(topUps.createdAt));
    return rows.map(toRow);
  }

  /**
   * Opens a charge, before the provider has been asked for anything.
   *
   * `provider_intent_id` is null here and set by `attach` once the provider answers. The
   * row has to exist first: a crash between calling the provider and recording the call
   * would otherwise leave a charge nobody can reconcile to an organisation.
   */
  async start(topUp: NewTopUp): Promise<TopUpRow> {
    const rows = await this.guard(() =>
      this.tx
        .insert(topUps)
        .values({ orgId: this.context.orgId, ...topUp, state: "pending" })
        .returning(),
    );
    const row = rows[0];
    if (row === undefined)
      throw new ResourceConflictError({ detail: { amount: topUp.amountCents } });
    return toRow(row);
  }

  /** Records the provider's handle for a charge already opened. */
  async attach(id: string, providerIntentId: string, state: TopUpState): Promise<boolean> {
    const rows = await this.guard(() =>
      this.tx
        .update(topUps)
        .set({ providerIntentId, state })
        .where(and(this.orgScope(), eq(topUps.id, id)))
        .returning({ id: topUps.id }),
    );
    return rows.length === 1;
  }

  /**
   * Settles a charge, once.
   *
   * The `settled_at is null` predicate is what makes the payment webhook safe to deliver
   * twice: the provider sends at least once by design, and a second delivery that settled
   * again would have the caller grant a second lot of credit. The unique index on the
   * intent id is the other half of that guard, one table up.
   */
  async settle(
    providerIntentId: string,
    state: TopUpState,
    failureCode: string | null,
    settledAt: Date,
    card: SettledCard | null = null,
  ): Promise<TopUpRow | null> {
    const rows = await this.tx
      .update(topUps)
      .set({
        state,
        failureCode,
        settledAt,
        // Written here rather than at `start` for a hosted checkout, where the cardholder
        // picked the card on the provider's page. The row keeps its own copy of the brand
        // and four digits on purpose: removing the card is a delete, and a receipt that
        // could not say what paid it would be a worse record than none.
        ...(card === null
          ? {}
          : {
              paymentMethodId: card.paymentMethodId,
              cardBrand: card.brand,
              cardLast4: card.last4,
            }),
      })
      .where(
        and(
          this.orgScope(),
          eq(topUps.providerIntentId, providerIntentId),
          isNull(topUps.settledAt),
        ),
      )
      .returning();
    const row = rows[0];
    return row === undefined ? null : toRow(row);
  }

  /**
   * Records how much of a settled top-up went on debt rather than into credit.
   *
   * Separate from `settle` because the figure is not known there: it depends on what the
   * organisation owed at that instant, which the caller reads inside the same transaction.
   * It is written rather than derived because `org_debts` holds one moving total and cannot
   * be asked what it was last Tuesday — so without this column "why did $1,000 add $700"
   * has no answer on the row that answers every other question about the payment.
   */
  async recordDebtSettled(id: string, cents: number): Promise<void> {
    if (cents <= 0) return;
    await this.guard(() =>
      this.tx
        .update(topUps)
        .set({ settledDebtCents: cents })
        .where(and(this.orgScope(), eq(topUps.id, id))),
    );
  }
}
