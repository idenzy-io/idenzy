/**
 * Idenzy's own operators (ADR-0018). Nothing here is ever sent to a customer.
 */

/** What a member of staff may do in the operator console, least first. */
export const StaffRole = {
  /** Read: look an organisation up, see its billing and invoices. */
  Support: "support",
  /** Support, and change how an organisation is billed. */
  Billing: "billing",
  /** Everything the console does. */
  Admin: "admin",
} as const;
export type StaffRole = (typeof StaffRole)[keyof typeof StaffRole];

/** Rank for comparison: a route requiring `billing` admits `billing` and `admin`. */
export const STAFF_RANK: Readonly<Record<StaffRole, number>> = {
  support: 1,
  billing: 2,
  admin: 3,
};

/** What an operator did, as recorded in `operator_actions`. Stable: a review queries by it. */
export const OperatorAction = {
  SetBillingMode: "billing.set_mode",
} as const;
export type OperatorAction = (typeof OperatorAction)[keyof typeof OperatorAction];
