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
 * What every repository has: a transaction, and one translation of the driver's
 * constraint violations into the error contract.
 *
 * It holds no scope of its own, which is the point. Scope arrives with `BaseRepository`
 * (a project) or `OrgRepository` (an organisation), and a repository that extends this
 * directly is one with no tenant at all — which `ProvisioningRepository` is, because it
 * creates the tenant, and which nothing else should be.
 *
 * It used to be generic over a branded transaction type so that a project repository
 * could not be handed an organisation-bound one. The brands went with the row policies
 * they protected: with no key bound to the connection there is no binding to get wrong,
 * and the context each base requires is what names the scope now.
 */
export abstract class AbstractRepository {
  protected constructor(protected readonly tx: Transaction) {}

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
