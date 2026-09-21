import { randomUUID } from "node:crypto";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

/** The transaction handle a repository receives. */
export type Transaction = Parameters<Parameters<NodePgDatabase["transaction"]>[0]>[0];

/**
 * A transaction, and the one place that opens one.
 *
 * This used to do considerably more. Every transaction began by binding a tenant key to
 * the connection — `select set_config('app.project_id', …, true)` or its `app.org_id`
 * twin — and row-level security policies on every table matched against it. There were
 * two methods because there were two keys, and the transaction types were branded so a
 * repository could not be handed the wrong one: under RLS that mistake returned zero rows
 * rather than an error, so a job could report success having read nothing.
 *
 * All of that is gone with the policies. What is *not* gone is the scoping it was the
 * second line of: `BaseRepository` still cannot be constructed without a `TenantContext`
 * and `OrgRepository` without an `OrgContext`, and every query in this package starts from
 * `tenantScope()` or `orgScope()`. That was always the first line — the audit that
 * preceded this change found 232 of 233 statements already filtering in SQL, and fixed
 * the one that did not (`OrgProjectRepository.findById`).
 *
 * **Read that as the warning it is.** The database no longer refuses a query that forgets
 * its tenant; it answers it. The predicate is now the only thing standing between one
 * customer's rows and another's, so a new repository that reaches for `this.tx` without a
 * scope is a cross-tenant read with nothing underneath it. The bases exist to make that
 * hard to write by accident, and `tenancy.integration.test.ts` exists to catch it.
 */
export class UnitOfWork {
  constructor(private readonly db: NodePgDatabase) {}

  /**
   * Runs work inside one transaction.
   *
   * `return await` rather than a bare return: it keeps this frame in the async stack
   * trace, which is what makes a transaction failure debuggable.
   */
  async transaction<T>(work: (tx: Transaction) => Promise<T>): Promise<T> {
    return await this.db.transaction(async (tx) => await work(tx));
  }

  /**
   * Creates an organisation, generating the id its rows will be keyed on.
   *
   * Still its own method, and still for the reason it always was: **the id is generated
   * here and never accepted from a caller.** Under RLS that was a total-compromise
   * property — a caller who chose the value bound to `app.org_id` could bind somebody
   * else's and insert themselves as its owner. There is no binding now, but the argument
   * survives in a weaker form: the callback is handed the id it must use, so an
   * organisation cannot be provisioned onto an id that arrived in an HTTP field.
   */
  async provision<T>(work: (tx: Transaction, orgId: string) => Promise<T>): Promise<T> {
    const orgId = randomUUID();
    return await this.db.transaction(async (tx) => await work(tx, orgId));
  }
}
