import { InternalError } from "@idenzy/core/errors";
import { eq, type SQL } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import type { OrgContext } from "../tenancy/org-context.js";
import type { Transaction } from "../tenancy/unit-of-work.js";
import { AbstractRepository } from "./abstract-repository.js";

/**
 * Base for every organisation-scoped repository (ADR-0011).
 *
 * The control-plane twin of `BaseRepository`, and it holds the same bargain: it cannot
 * be constructed without an `OrgContext`, so the `org_id` predicate is structural rather
 * than something each query has to remember, and `orgIsolationPolicy` is the second,
 * independent line underneath it.
 *
 * Keeping the two bases apart is what stops the mistake they exist to prevent. A single
 * base taking either context would have to choose a column at runtime, and the failure
 * mode of choosing wrong is a query that reads every organisation's invoices.
 */
export abstract class OrgRepository<TTable extends PgTable> extends AbstractRepository {
  protected constructor(
    tx: Transaction,
    protected readonly context: OrgContext,
    protected readonly table: TTable,
  ) {
    super(tx);
  }

  /** The predicate every query in a subclass starts from. */
  protected orgScope(): SQL {
    const column = this.table["orgId" as keyof TTable];
    if (column === undefined) {
      throw new InternalError({
        detail: { table: String(this.table), reason: "table has no org_id column" },
      });
    }
    // Safe: the guard above proves the column exists, and every control-plane table
    // declares it through orgIdColumn(), so its type is uniform.
    return eq(column as never, this.context.orgId);
  }
}
