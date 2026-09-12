import { ValidationFailedError } from "@idenzy/core/errors";
import type { ZodType } from "zod";

/**
 * Parses untrusted input into a type, raising the project's error contract rather than a
 * ZodError (PROJECT.md 7.1).
 *
 * A twin of `apps/auth-api/src/common/parse.ts`. Two copies rather than a shared package
 * because two is where the cost of a package exceeds the cost of the duplication; the
 * third consumer is `apps/admin`, and that is the point at which this moves.
 */
export function parseOrThrow<T>(schema: ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  throw new ValidationFailedError({
    fields: result.error.issues.map((issue) => ({
      path: issue.path.join("."),
      code: issue.code,
    })),
  });
}
