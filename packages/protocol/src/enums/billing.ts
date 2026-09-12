/**
 * The vocabulary the billing surface is written in (PROJECT.md 5.1).
 *
 * Every amount that travels with one of these is in **cents**, as an integer. A float
 * rounds the wrong way once and then disagrees with an issued invoice for ever, and an
 * invoice is a statutory record we cannot quietly correct.
 */

/** Where credit on the account came from, which decides whether it can expire. */
export const CreditKind = {
  /** Bought with a top-up. Does not expire. */
  Purchased: "purchased",
  /** Granted by us: a trial, or a credit raised by support. Expires. */
  Promotional: "promotional",
} as const;
export type CreditKind = (typeof CreditKind)[keyof typeof CreditKind];

/**
 * How far a top-up has got with the payment provider.
 *
 * A state and not a boolean because `requires_action` is a real place a charge stops:
 * 3-D Secure hands the customer back to their bank, and a screen that modelled that as
 * "not paid yet" would tell somebody a card failed while their bank was still asking.
 */
export const TopUpState = {
  Pending: "pending",
  RequiresAction: "requires_action",
  Succeeded: "succeeded",
  Failed: "failed",
  Cancelled: "cancelled",
} as const;
export type TopUpState = (typeof TopUpState)[keyof typeof TopUpState];

/** Whether a person asked for the top-up or the automatic rule fired it. */
export const TopUpTrigger = {
  Manual: "manual",
  Automatic: "automatic",
} as const;
export type TopUpTrigger = (typeof TopUpTrigger)[keyof typeof TopUpTrigger];

/** Card networks we can name. `other` is honest about the ones we cannot. */
export const CardBrand = {
  Visa: "visa",
  Mastercard: "mastercard",
  Amex: "amex",
  Discover: "discover",
  Other: "other",
} as const;
export type CardBrand = (typeof CardBrand)[keyof typeof CardBrand];

/**
 * Where an invoice stands.
 *
 * `void` is separate from `paid` and from nothing at all: an invoice raised in error is
 * cancelled rather than deleted, because a gap in a number sequence is the thing an
 * auditor asks about.
 */
export const InvoiceStatus = {
  Open: "open",
  Paid: "paid",
  PastDue: "past_due",
  Void: "void",
} as const;
export type InvoiceStatus = (typeof InvoiceStatus)[keyof typeof InvoiceStatus];

/** The meters an invoice line can be raised against, matching the price list (5.1). */
export const BillingLineItem = {
  Mau: "mau",
  Email: "email",
  SendingDomain: "sending_domain",
  Sms: "sms",
  Whatsapp: "whatsapp",
  SsoMau: "sso_mau",
} as const;
export type BillingLineItem = (typeof BillingLineItem)[keyof typeof BillingLineItem];

/** Who took the money. One name today, and a column rather than an assumption. */
export const PaymentProvider = {
  Stripe: "stripe",
} as const;
export type PaymentProvider = (typeof PaymentProvider)[keyof typeof PaymentProvider];
