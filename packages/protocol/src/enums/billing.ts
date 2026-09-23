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

/**
 * How an organisation pays (ADR-0019).
 *
 * Prepaid is everybody's: credit bought in advance and drawn down by usage. Invoiced is for the
 * large organisations staff select: usage is billed monthly in arrears on net terms, the wallet is
 * not drawn on, and nothing stops over an unpaid invoice — a person decides.
 */
export const BillingMode = {
  Prepaid: "prepaid",
  Invoiced: "invoiced",
} as const;
export type BillingMode = (typeof BillingMode)[keyof typeof BillingMode];

/** Net terms an invoiced organisation gets unless staff set others. */
export const DEFAULT_INVOICE_TERMS_DAYS = 14;

/** Whether a person asked for the top-up or the automatic rule fired it. */
export const TopUpTrigger = {
  Manual: "manual",
  Automatic: "automatic",
} as const;
export type TopUpTrigger = (typeof TopUpTrigger)[keyof typeof TopUpTrigger];

/**
 * Why the automatic rule stopped firing on its own, pending a person.
 *
 * Every one of these is a case where charging again cannot help or would do harm. A bank
 * that wants 3-D Secure off-session has nobody to ask; three declines in a row is what card
 * testing looks like to an issuer; charging a card whose holder is disputing us is the
 * fastest way to lose the merchant account every customer pays through; and charging again
 * straight after a refund undoes it. Saving the rule again clears it, because that is a person
 * looking at it.
 */
export const AutoTopUpSuspension = {
  AuthenticationRequired: "authentication_required",
  RepeatedFailure: "repeated_failure",
  NoPaymentMethod: "no_payment_method",
  Dispute: "dispute",
  FraudReview: "fraud_review",
  /**
   * A top-up was refunded. The refund takes the credit back, which usually takes the balance
   * under the threshold — and a rule that then charged the same card again would undo the
   * refund somebody just asked for.
   */
  Refunded: "refunded",
} as const;
export type AutoTopUpSuspension = (typeof AutoTopUpSuspension)[keyof typeof AutoTopUpSuspension];

/**
 * Where a refund of a top-up has got, in the provider's vocabulary because it is the
 * provider's state. `failed` and `canceled` are final: the money came back to us.
 */
export const RefundState = {
  Pending: "pending",
  RequiresAction: "requires_action",
  Succeeded: "succeeded",
  Failed: "failed",
  Canceled: "canceled",
} as const;
export type RefundState = (typeof RefundState)[keyof typeof RefundState];

/**
 * Where a cardholder's dispute of a top-up has got. The `warning_*` states are an inquiry
 * that has not (yet) taken any money; the rest are a chargeback.
 */
export const DisputeStatus = {
  WarningNeedsResponse: "warning_needs_response",
  WarningUnderReview: "warning_under_review",
  WarningClosed: "warning_closed",
  NeedsResponse: "needs_response",
  UnderReview: "under_review",
  Won: "won",
  Lost: "lost",
  Prevented: "prevented",
} as const;
export type DisputeStatus = (typeof DisputeStatus)[keyof typeof DisputeStatus];

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
  /** Written by the invoice run and not yet issued at the provider. A person never sees one. */
  Draft: "draft",
  Open: "open",
  Paid: "paid",
  PastDue: "past_due",
  Void: "void",
  /** Given up on at the provider. Kept, because a debt written off is still a record. */
  Uncollectible: "uncollectible",
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
