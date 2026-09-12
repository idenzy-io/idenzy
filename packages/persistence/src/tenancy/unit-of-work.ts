import { randomUUID } from "node:crypto";
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
   * Creates an organisation, binding the key its own rows will be checked against.
   *
   * The one transaction that brings a tenant into existence, and the only one that binds
   * a scope to something not yet in the database. `orgs` is keyed on its own `id` and
   * `org_members` and `projects` on `org_id`, so an insert passes WITH CHECK exactly when
   * the row being written matches the bound organisation — which is satisfiable before
   * the organisation exists, because the id is what binds it.
   *
   * **The id is generated here and never accepted from a caller.** That is the whole
   * safety property, and losing it is not a degradation but a total compromise: a caller
   * who could choose the value bound to `app.org_id` could bind somebody else's, insert
   * an `org_members` row naming themselves owner, and walk into an organisation that was
   * never theirs. A parameter would make that one HTTP field away, so there is no
   * parameter. The callback is handed the id it must use.
   *
   * No SECURITY DEFINER function, unlike the other places this schema reaches past a
   * policy. It does not need one: nothing here reads across tenants or writes outside the
   * organisation it just created, so the policies hold as written rather than being
   * stepped around.
   */
  async provision<T>(work: (tx: Transaction, orgId: string) => Promise<T>): Promise<T> {
    const orgId = randomUUID();
    return await this.db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.org_id', ${orgId}, true)`);
      return work(tx, orgId);
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
