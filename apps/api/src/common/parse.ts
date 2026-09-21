import { ValidationFailedError } from "@idenzy/core/errors";
import type { ZodType } from "zod";

/**
 * Parses untrusted input into a type, raising the project's error contract rather than a
 * ZodError (PROJECT.md 7.1).
 *
 * Used by the validation pipe and by anything that receives `unknown` across an
 * abstraction boundary, so a value is never typed by assertion where it could be typed
 * by validation instead.
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
