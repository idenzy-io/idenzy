import { InternalError } from "@idenzy/core/errors";
import { eq, type SQL } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import type { TenantContext } from "../tenancy/tenant-context.js";
import type { Transaction } from "../tenancy/unit-of-work.js";
import { AbstractRepository } from "./abstract-repository.js";

/**
 * Base for every tenant-scoped repository (PROJECT.md 9.4).
 *
 * It cannot be constructed without a TenantContext, which is the point: the tenant
 * filter is structural rather than something each query has to remember.
 *
 * **It is now the only line.** RLS was the second — a policy on every tenant table that
 * returned nothing whatever this class asked for — and it is gone. `tenantScope()` is
 * therefore not defence in depth any more; it is the defence. Every `select`, `update`
 * and `delete` in a subclass starts from it, and one that does not is a cross-tenant
 * read.
 *
 * The constraint is `PgTable`, not `PgTableWithColumns`, because that is what the schema
 * builders return.
 */
export abstract class BaseRepository<TTable extends PgTable> extends AbstractRepository {
  protected constructor(
    tx: Transaction,
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
