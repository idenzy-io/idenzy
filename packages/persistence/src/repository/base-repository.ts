import { InternalError, ResourceConflictError } from "@idenzy/core/errors";
import { eq, type SQL } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import type { TenantContext } from "../tenancy/tenant-context.js";
import type { Transaction } from "../tenancy/unit-of-work.js";

/** Postgres error codes we translate rather than leak. */
const UNIQUE_VIOLATION = "23505";
const FOREIGN_KEY_VIOLATION = "23503";

interface PostgresError {
  readonly code?: string;
  readonly constraint?: string;
}

/**
 * Finds the driver error inside whatever wrapped it.
 *
 * Drizzle raises a `DrizzleQueryError` carrying the pg error as `cause`, so reading
 * `code` off the caught value alone finds nothing and every constraint violation would
 * surface as a 500. The walk is bounded because a cause chain can be cyclic.
 */
function postgresErrorCode(error: unknown): PostgresError {
  let current: unknown = error;
  for (let depth = 0; depth < 5; depth += 1) {
    if (typeof current !== "object" || current === null) return {};
    if ("code" in current && typeof (current as PostgresError).code === "string") {
      return current as PostgresError;
    }
    if (!("cause" in current)) return {};
    current = (current as { cause: unknown }).cause;
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
 *
 * The constraint is `PgTable`, not `PgTableWithColumns`: `.enableRLS()` returns
 * `Omit<PgTableWithColumns<T>, "enableRLS">`, so every table in our schema fails the
 * narrower constraint.
 */
export abstract class BaseRepository<TTable extends PgTable> {
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
