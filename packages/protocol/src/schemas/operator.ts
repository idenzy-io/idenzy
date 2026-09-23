import { z } from "zod";
import { BillingMode } from "../enums/billing.js";
import { StaffRole } from "../enums/staff.js";
import { invoiceSchema, orgBalanceSchema } from "./billing.js";

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

/** One organisation's billing, as an operator reviews it before changing anything. */
export const operatorOrgBillingSchema = z.object({
  org: operatorOrgSchema,
  mode: z.enum(BillingMode),
  invoiceTermsDays: z.number().int(),
  balance: orgBalanceSchema,
  invoices: z.array(invoiceSchema),
});
export type OperatorOrgBilling = z.infer<typeof operatorOrgBillingSchema>;

/**
 * Switching how an organisation pays (ADR-0019). The reason is required and recorded beside who
 * made the change, because a change to a customer's terms that nobody can explain later is not
 * reviewable.
 */
export const setBillingModeSchema = z.object({
  mode: z.enum(BillingMode),
  invoiceTermsDays: z.number().int().min(1).max(90),
  reason: z.string().trim().min(5).max(500),
});
export type SetBillingMode = z.infer<typeof setBillingModeSchema>;
