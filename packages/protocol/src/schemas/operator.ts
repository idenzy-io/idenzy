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

/** An organisation as the console lists it. */
export const operatorOrgSchema = z.object({
  id: z.string(),
  name: z.string(),
  createdAt: z.iso.datetime(),
});
export type OperatorOrg = z.infer<typeof operatorOrgSchema>;

export const operatorOrgListSchema = z.object({ orgs: z.array(operatorOrgSchema) });
export type OperatorOrgList = z.infer<typeof operatorOrgListSchema>;

/** A search: part of a name, or an organisation's id in either form. Empty lists the newest. */
export const operatorOrgQuerySchema = z.object({
  query: z.string().max(100).default(""),
});
