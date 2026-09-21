import { ResourceConflictError } from "@idenzy/core/errors";
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
 * What every repository has regardless of which plane it reads: a transaction, and one
 * translation of the driver's constraint violations into the error contract.
 *
 * It holds no scope of its own, which is the point. Scope arrives with `BaseRepository`
 * (a project) or `OrgRepository` (an organisation), and a repository that extended this
 * directly would be one with no tenant at all — so nothing does.
 */
export abstract class AbstractRepository<TTx extends Transaction = Transaction> {
  protected constructor(protected readonly tx: TTx) {}

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
