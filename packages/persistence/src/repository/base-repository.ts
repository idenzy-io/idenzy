import { InternalError, ResourceConflictError } from "@idenzy/core/errors/errors";
import { eq, type SQL } from "drizzle-orm";
import type { PgTableWithColumns, TableConfig } from "drizzle-orm/pg-core";
import type { TenantContext } from "../tenancy/tenant-context.js";
import type { Transaction } from "../tenancy/unit-of-work.js";

/** Postgres error codes we translate rather than leak. */
const UNIQUE_VIOLATION = "23505";
const FOREIGN_KEY_VIOLATION = "23503";

interface PostgresError {
  readonly code?: string;
  readonly constraint?: string;
}

function postgresErrorCode(error: unknown): PostgresError {
  if (typeof error === "object" && error !== null && "code" in error) {
    return error as PostgresError;
  }
  return {};
}

/**
 * Base for every tenant-scoped repository (PROJECT.md 9.4).
 *
 * It cannot be constructed without a TenantContext, which is the point: the tenant
 * filter is structural rather than something each query has to remember. RLS at the
 * database is the second, independent line, and the negative tests prove it holds when
 * this one is deliberately bypassed.
 */
export abstract class BaseRepository<TTable extends PgTableWithColumns<TableConfig>> {
  protected constructor(
    protected readonly tx: Transaction,
    protected readonly context: TenantContext,
    protected readonly table: TTable,
  ) {}

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

  /** Translates constraint violations into the error contract instead of a raw 500. */
  protected async guard<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error: unknown) {
      const { code, constraint } = postgresErrorCode(error);
      if (code === UNIQUE_VIOLATION) {
        throw new ResourceConflictError({ detail: { constraint }, cause: error });
      }
      if (code === FOREIGN_KEY_VIOLATION) {
        throw new ResourceConflictError({
          message: "A referenced record does not exist.",
          detail: { constraint },
          cause: error,
        });
      }
      throw error;
    }
  }
}
