import { InternalError } from "@idenzy/core/errors";
import { eq, type SQL } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import type { TenantContext } from "../tenancy/tenant-context.js";
import type { CellTx } from "../tenancy/unit-of-work.js";
import { AbstractRepository } from "./abstract-repository.js";

/**
 * Base for every tenant-scoped repository (PROJECT.md 9.4).
 *
 * It cannot be constructed without a TenantContext, which is the point: the tenant
 * filter is structural rather than something each query has to remember. RLS at the
 * database is the second, independent line, and the negative tests prove it holds when
 * this one is deliberately bypassed.
 *
 * The constraint is `PgTable`, not `PgTableWithColumns`: `.enableRLS()` returns
 * `Omit<PgTableWithColumns<T>, "enableRLS">`, so every table in our schema fails the
 * narrower constraint.
 *
 * It takes a `CellTx` and not a `Transaction`, which is the third line and the newest. A tenant
 * table lives in a region cell; an organisation-bound transaction has no `app.project_id` set, so
 * handing one here would match nothing — no error, no rows, and a caller that cannot tell the
 * difference between "empty" and "wrong plane". Now it does not compile.
 */
export abstract class BaseRepository<TTable extends PgTable> extends AbstractRepository<CellTx> {
  protected constructor(
    tx: CellTx,
    protected readonly context: TenantContext,
    protected readonly table: TTable,
  ) {
    super(tx);
  }

  /** The predicate every query in a subclass starts from. */
  protected tenantScope(): SQL {
    const column = this.table["projectId" as keyof TTable];
    if (column === undefined) {
      throw new InternalError({
        detail: { table: String(this.table), reason: "table has no project_id column" },
      });
    }
    // Safe: the guard above proves the column exists, and every tenant table declares it
    // through projectIdColumn(), so its type is uniform.
    return eq(column as never, this.context.projectId);
  }
}
