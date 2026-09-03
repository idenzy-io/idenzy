import { ValidationFailedError } from "@idenzy/core/errors/errors";
import type { PipeTransform } from "@nestjs/common";
import type { ZodType } from "zod";

/**
 * Parses a request body, query or param before it is typed (PROJECT.md 7.1, 9.3 step 6).
 *
 * The rule it enforces is that types are a consequence of validation and never a
 * substitute for it: a handler receives `T` only because a schema produced it. Unknown
 * fields are rejected by the schemas themselves, and failures come back as the same
 * error contract as everything else, with field paths a customer can build messages from.
 */
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodType<T>) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value);
    if (result.success) return result.data;
    throw new ValidationFailedError({
      fields: result.error.issues.map((issue) => ({
        path: issue.path.join("."),
        code: issue.code,
      })),
    });
  }
}
