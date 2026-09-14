import { and, eq, isNull } from "drizzle-orm";
import { orgs } from "../schema/control-plane.js";
import type { OrgContext } from "../tenancy/org-context.js";
import type { Transaction } from "../tenancy/unit-of-work.js";
import { AbstractRepository } from "./abstract-repository.js";

export interface OrgBillingRow {
  readonly name: string;
  readonly billingCustomerId: string | null;
}

/**
 * The one column on `orgs` that belongs to the payment provider, and the name beside it.
 *
 * Not an `OrgRepository`, because `orgs` is keyed by its own `id` rather than by an
 * `org_id` column — the shared `orgScope()` would look for a column that is not there.
 * The predicate is written out instead, which is the same exception `orgIsolationPolicy`
 * makes for this table one layer down.
 *
 * `billing_customer_id` is retained through an erasure on a statutory basis, which is what
 * `Retention.Years6` on it records: a financial record has to be attributable to somebody
 * for six years, and this is the pseudonym that does it after the name has gone.
 */
export class OrgBillingCustomerRepository extends AbstractRepository {
  constructor(
    tx: Transaction,
    private readonly context: OrgContext,
  ) {
    super(tx);
  }

  async current(): Promise<OrgBillingRow | null> {
    const rows = await this.tx
      .select({ name: orgs.name, billingCustomerId: orgs.billingCustomerId })
      .from(orgs)
      .where(eq(orgs.id, this.context.orgId))
      .limit(1);
    return rows[0] ?? null;
  }

  /**
   * Records the provider's customer id, once.
   *
   * `is null` in the predicate is the whole point. Two requests arriving together would
   * both find no customer and both create one at the provider, and the loser must not
   * overwrite the winner — an organisation with two customer ids has its cards on one and
   * its charges on the other. The caller re-reads on a false answer rather than trusting
   * what it created.
   */
  async claim(billingCustomerId: string): Promise<boolean> {
    const rows = await this.tx
      .update(orgs)
      .set({ billingCustomerId })
      .where(and(eq(orgs.id, this.context.orgId), isNull(orgs.billingCustomerId)))
      .returning({ id: orgs.id });
    return rows.length === 1;
  }
}
