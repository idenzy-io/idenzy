import { z } from "zod";
import { ErrorCode } from "./codes.js";

const errorCodeValues = Object.values(ErrorCode) as [ErrorCode, ...ErrorCode[]];

/** The only error body any Idenzy API returns. Shape is identical across every endpoint. */
export const errorBodySchema = z.object({
  error: z.object({
    /** Stable, machine-readable. Branch on this, never on `message`. */
    code: z.enum(errorCodeValues),
    /** Safe for display but written for developers. Never contains user-supplied data. */
    message: z.string(),
    /** Field-level detail for `validation_failed`. */
    fields: z.array(z.object({ path: z.string(), code: z.string() })).optional(),
    /** Echoed back so a customer can quote it in a support request. */
    requestId: z.string(),
    /** Present on `rate_limited` and `spend_cap_reached`. */
    retryAfterSeconds: z.number().int().nonnegative().optional(),
  }),
});

export type ErrorBody = z.infer<typeof errorBodySchema>;
