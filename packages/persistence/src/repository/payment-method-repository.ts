import { ResourceConflictError } from "@idenzy/core/errors";
import type { CardBrand, PaymentProvider } from "@idenzy/protocol/enums/billing";
import { and, desc, eq, sql } from "drizzle-orm";
import { paymentMethods } from "../schema/billing.js";
import type { OrgContext } from "../tenancy/org-context.js";
import type { Transaction } from "../tenancy/unit-of-work.js";
import { OrgRepository } from "./org-repository.js";

export interface PaymentMethodRow {
  readonly id: string;
  readonly provider: PaymentProvider;
  readonly providerMethodId: string;
  readonly brand: CardBrand;
  readonly last4: string;
  readonly expiryMonth: number;
  readonly expiryYear: number;
  readonly isDefault: boolean;
  readonly addedBy: string | null;
  readonly createdAt: Date;
}

export interface NewPaymentMethod {
  readonly provider: PaymentProvider;
  readonly providerMethodId: string;
  readonly brand: CardBrand;
  readonly last4: string;
  readonly expiryMonth: number;
  readonly expiryYear: number;
  readonly addedBy: string | null;
}

function toRow(row: typeof paymentMethods.$inferSelect): PaymentMethodRow {
  return {
    id: row.id,
    // Safe: both columns are written only from the protocol enums above.
    provider: row.provider as PaymentProvider,
    brand: row.brand as CardBrand,
    providerMethodId: row.providerMethodId,
    last4: row.last4,
    expiryMonth: row.expiryMonth,
    expiryYear: row.expiryYear,
    isDefault: row.isDefault,
    addedBy: row.addedBy,
    createdAt: row.createdAt,
  };
}

/**
 * The cards an organisation has on file (ADR-0011, PROJECT.md 5.1).
 *
 * Every write that touches the default does it in one statement. `payment_methods_org_default_key`
 * is a partial unique index, so a clear-then-set pair would be refused halfway through by
 * whichever half ran second, and the state in between is an account with two defaults or
 * none — the second of which leaves an automatic top-up silently not firing.
 */
export class PaymentMethodRepository extends OrgRepository<typeof paymentMethods> {
  constructor(tx: Transaction, context: OrgContext) {
    super(tx, context, paymentMethods);
  }

  async list(): Promise<PaymentMethodRow[]> {
    const rows = await this.tx
      .select()
      .from(paymentMethods)
      .where(this.orgScope())
      .orderBy(desc(paymentMethods.isDefault), paymentMethods.createdAt);
    return rows.map(toRow);
  }

  /** Adds one, and makes it the default when it is the first the account has held. */
  async add(method: NewPaymentMethod): Promise<PaymentMethodRow> {
    const held = await this.tx
      .select({ id: paymentMethods.id })
      .from(paymentMethods)
      .where(this.orgScope())
      .limit(1);
    const rows = await this.guard(() =>
      this.tx
        .insert(paymentMethods)
        .values({ orgId: this.context.orgId, ...method, isDefault: held.length === 0 })
        .returning(),
    );
    const row = rows[0];
    if (row === undefined) {
      throw new ResourceConflictError({ detail: { providerMethodId: method.providerMethodId } });
    }
    return toRow(row);
  }

  /** Makes one the default and the rest not, in a single change. */
  async setDefault(id: string): Promise<boolean> {
    const rows = await this.guard(() =>
      this.tx
        .update(paymentMethods)
        .set({ isDefault: sql`${paymentMethods.id} = ${id}` })
        .where(this.orgScope())
        .returning({ id: paymentMethods.id, isDefault: paymentMethods.isDefault }),
    );
    return rows.some((row) => row.id === id && row.isDefault);
  }

  /**
   * Takes one off, and promotes another where the one removed was the default.
   *
   * The promotion is part of the removal rather than something to remember afterwards:
   * an account left holding cards and no default is one where an automatic top-up stops
   * firing without anybody switching it off.
   */
  async remove(id: string): Promise<boolean> {
    const removed = await this.tx
      .delete(paymentMethods)
      .where(and(this.orgScope(), eq(paymentMethods.id, id)))
      .returning({ isDefault: paymentMethods.isDefault });
    if (removed.length !== 1) return false;
    if (removed[0]?.isDefault !== true) return true;

    const next = await this.tx
      .select({ id: paymentMethods.id })
      .from(paymentMethods)
      .where(this.orgScope())
      .orderBy(paymentMethods.createdAt)
      .limit(1);
    const promote = next[0];
    if (promote !== undefined) await this.setDefault(promote.id);
    return true;
  }
}
