import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { OrgContext } from "./org-context.js";
import type { TenantContext } from "./tenant-context.js";

/** The transaction handle a repository receives. */
export type Transaction = Parameters<Parameters<NodePgDatabase["transaction"]>[0]>[0];

declare const PLANE: unique symbol;

/**
 * A transaction with `app.project_id` bound: the cell plane (ADR-0003).
 *
 * The brand carries no runtime value and exists to make one mistake impossible to write. Both
 * planes are the same Postgres today and will be separate databases once the control plane moves
 * (PROJECT.md 4.13.5), and the failure mode being designed against is a repository quietly reading
 * the wrong one. Under RLS that failure is *silent* — an org-keyed transaction querying a tenant
 * table matches nothing, so the symptom is zero rows and a job reporting success, not an error.
 *
 * `BaseRepository` accepts only this, `OrgRepository` only `ControlTx`, so the mistake is a type
 * error at the constructor rather than an empty result set in production.
 */
export type CellTx = Transaction & { readonly [PLANE]: "cell" };

/** A transaction with `app.org_id` bound: the control plane (ADR-0011). Mirror of `CellTx`. */
export type ControlTx = Transaction & { readonly [PLANE]: "control" };

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

  async run<T>(context: TenantContext, work: (tx: CellTx) => Promise<T>): Promise<T> {
    // `return await` rather than a bare return: it keeps this frame in the async stack
    // trace, which is what makes a transaction failure debuggable.
    return await this.db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.project_id', ${context.projectId}, true)`);
      // Safe: the brand is a phantom type. What earns it is the `set_config` on the line above —
      // this transaction now has a project bound, which is exactly what `CellTx` asserts.
      return work(tx as CellTx);
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
  async runForOrg<T>(context: OrgContext, work: (tx: ControlTx) => Promise<T>): Promise<T> {
    return await this.db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.org_id', ${context.orgId}, true)`);
      // Earned by the `set_config` above, as in `run`.
      return work(tx as ControlTx);
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
  async provision<T>(work: (tx: ControlTx, orgId: string) => Promise<T>): Promise<T> {
    const orgId = randomUUID();
    return await this.db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.org_id', ${orgId}, true)`);
      // Control plane: it binds `app.org_id`, like `runForOrg`, and creates the organisation
      // that key names.
      return work(tx as ControlTx, orgId);
    });
  }

  /*
   * `runGlobal` was here and is gone. It set neither key, for the two tables keyed on neither —
   * and it had no callers: `RegionCellReader` takes the pool directly, which is why ADR-0011's
   * paragraph about it described behaviour the code never had. Once the planes are types, a method
   * whose type says "no plane" is precisely the hole the types exist to close, so it is not coming
   * back: a reader that needs no key takes the database handle and says so.
   */
}
