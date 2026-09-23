import { z } from "zod";
import { StaffRole } from "../enums/staff.js";

/**
 * What the operator console reads and writes (ADR-0018). Never served on a customer surface.
 */

/** The signed-in operator, as the console shows who it is acting as. */
export const operatorMeSchema = z.object({
  email: z.string(),
  role: z.enum(StaffRole),
});
export type OperatorMe = z.infer<typeof operatorMeSchema>;
