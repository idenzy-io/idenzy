import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { OrgContext } from "./org-context.js";
import type { TenantContext } from "./tenant-context.js";

/** The transaction handle a repository receives. */
export type Transaction = Parameters<Parameters<NodePgDatabase["transaction"]>[0]>[0];

/**
 * Runs work inside a transaction with the tenant bound to the connection (ADR-0003).
 *
 * Three details in `bindTenant` below are deliberate, and changing any of them is a
 * tenancy bug rather than a style choice:
 *
 * 1. `set_config`, not `SET LOCAL`. SET LOCAL cannot take a bind parameter, so using it
 *    would mean concatenating a tenant id into SQL text on the most security-critical
 *    statement in the system.
 * 2. The third argument `true` makes the setting transaction-local. A connection-level
 *    SET would leak tenant context into the next checkout from the pool.
 * 3. It is the first statement in the transaction, so no query can run before the RLS
 *    policy has something to match against.
 */
export class UnitOfWork {
  constructor(private readonly db: NodePgDatabase) {}

  async run<T>(context: TenantContext, work: (tx: Transaction) => Promise<T>): Promise<T> {
    // `return await` rather than a bare return: it keeps this frame in the async stack
    // trace, which is what makes a transaction failure debuggable.
    return await this.db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.project_id', ${context.projectId}, true)`);
      return work(tx);
    });
  }

  /**
   * Runs work inside a transaction bound to one organisation (ADR-0011).
   *
   * The control-plane half of `run`, and deliberately its mirror image: `app.org_id` is
   * set by the same parameterized, transaction-local, first-in-the-transaction
   * `set_config` call, for the same three reasons. The two settings are independent, so
   * a transaction holding an org key matches nothing on a project table and the reverse
   * also holds.
   */
  async runForOrg<T>(context: OrgContext, work: (tx: Transaction) => Promise<T>): Promise<T> {
    return await this.db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.org_id', ${context.orgId}, true)`);
      return work(tx);
    });
  }

  /**
   * For control-plane tables that are keyed on neither (region_cells, staff_access_grants).
   * Sets no tenant and no organisation, so every RLS-protected table returns nothing.
   */
  async runGlobal<T>(work: (tx: Transaction) => Promise<T>): Promise<T> {
    return await this.db.transaction(async (tx) => work(tx));
  }
}
