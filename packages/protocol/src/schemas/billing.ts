import { z } from "zod";
import {
  CardBrand,
  CreditKind,
  InvoiceStatus,
  PaymentProvider,
  TopUpState,
  TopUpTrigger,
} from "../enums/billing.js";
import { isoDateTimeSchema } from "./common.js";

/**
 * The billing surface, as the wallet, methods and invoices screens read and write it
 * (PROJECT.md 5.1, ADR-0011).
 *
 * **Every amount is an integer number of cents** and is typed as one here, because this is
 * the layer where a float would get in. A float rounds the wrong way once and then
 * disagrees with an issued invoice for ever, and an invoice is a statutory record we cannot
 * quietly correct.
 *
 * Everything hangs off an organisation and never off a project: one balance, one set of
 * cards, one invoice covering everything underneath. A wallet scoped to a project would
 * show a third of a bill and call it the bill.
 */

const centsSchema = z.number().int().min(0);
const currencySchema = z.string().length(3).toUpperCase();

/**
 * A zod enum over one of the vocabularies, keeping the literal union.
 *
 * The naive spelling widens to `string`, which compiles here and then loses every caller
 * the type they actually wanted: the panel's own `CardBrand` is a union of five names, and
 * a schema answering `string` makes assigning one to the other an error at the far end of
 * the wire rather than a match.
 */
const enumOf = <T extends Record<string, string>>(values: T) =>
  z.enum(Object.values(values) as [T[keyof T], ...T[keyof T][]]);

/** One grant of credit, and what is left of it. */
export const creditGrantSchema = z.object({
  id: z.string(),
  kind: enumOf(CreditKind),
  amountCents: centsSchema,
  remainingCents: centsSchema,
  currency: currencySchema,
  grantedAt: isoDateTimeSchema,
  /** Promotional credit ends; purchased credit does not, and null says so. */
  expiresAt: isoDateTimeSchema.nullable(),
  note: z.string(),
});
export type CreditGrant = z.infer<typeof creditGrantSchema>;

/**
 * A card on file.
 *
 * Four digits, a brand and an expiry, which is everything that can be displayed and
 * everything worth storing. The number belongs to the provider's own page and never
 * reaches this system — an API that could return one would put every caller in scope for
 * PCI DSS.
 *
 * `addedBy` is a name and not an id: `payment_methods.added_by` holds an `org_members.id`,
 * and the screen wants to print who. Null where that member has since left, which is a
 * normal row rather than an error.
 */
export const paymentMethodSchema = z.object({
  id: z.string(),
  brand: enumOf(CardBrand),
  last4: z.string().length(4),
  expiryMonth: z.number().int().min(1).max(12),
  expiryYear: z.number().int().min(2000).max(2100),
  isDefault: z.boolean(),
  addedBy: z.string().nullable(),
  addedAt: isoDateTimeSchema,
});
export type PaymentMethod = z.infer<typeof paymentMethodSchema>;

/** A charge that added credit, whether a person asked for it or the rule fired. */
export const topUpSchema = z.object({
  id: z.string(),
  amountCents: centsSchema,
  currency: currencySchema,
  state: enumOf(TopUpState),
  trigger: enumOf(TopUpTrigger),
  cardBrand: enumOf(CardBrand).nullable(),
  cardLast4: z.string().length(4).nullable(),
  failureCode: z.string().nullable(),
  createdAt: isoDateTimeSchema,
  settledAt: isoDateTimeSchema.nullable(),
});
export type TopUp = z.infer<typeof topUpSchema>;

export const invoiceSchema = z.object({
  id: z.string(),
  /** What the customer quotes at us: the human number, not the id. */
  number: z.string(),
  periodStart: z.string(),
  periodEnd: z.string(),
  issuedAt: isoDateTimeSchema,
  totalCents: centsSchema,
  currency: currencySchema,
  status: enumOf(InvoiceStatus),
  /** Where the PDF is. Null while one is still being produced. */
  pdfUri: z.string().nullable(),
});
export type Invoice = z.infer<typeof invoiceSchema>;

/**
 * One line of an invoice.
 *
 * It carries no id, because nothing addresses one: a line is read as part of its invoice
 * and never on its own, and an id the panel could not use for anything would be a promise
 * that it could.
 */
export const invoiceLineSchema = z.object({
  projectId: z.string().nullable(),
  item: z.string(),
  quantity: z.number().int(),
  unitRateMillicents: z.number().int(),
  totalCents: centsSchema,
});
export type InvoiceLine = z.infer<typeof invoiceLineSchema>;

/**
 * The automatic rule.
 *
 * `amountCents` cannot be below `thresholdCents`, which is a database constraint as well
 * as this refinement: a rule that adds less than it triggers on fires again immediately
 * and keeps firing, which is a customer's card charged in a loop.
 */
export const autoTopUpSchema = z
  .object({
    enabled: z.boolean(),
    thresholdCents: centsSchema,
    amountCents: centsSchema,
    /** Which card it charges. Null falls back to the default, and the screen says so. */
    methodId: z.string().nullable(),
  })
  .refine((rule) => !rule.enabled || rule.amountCents >= rule.thresholdCents, {
    message: "an automatic top-up cannot add less than it triggers on",
    path: ["amountCents"],
  });
export type AutoTopUp = z.infer<typeof autoTopUpSchema>;

export const spendAlertSchema = z.object({
  enabled: z.boolean(),
  thresholdCents: centsSchema,
});
export type SpendAlert = z.infer<typeof spendAlertSchema>;

/**
 * Everything one screen needs about the money, in one answer.
 *
 * One document rather than five routes because the wallet reads all of it at once and a
 * balance that disagreed with the grants beneath it would be the first thing anybody
 * noticed. `provider` is null where no payment provider is configured, which is a correct
 * deployment and not a degraded one — the screen says so rather than offering a control
 * that cannot work.
 */
export const walletSchema = z.object({
  currency: currencySchema,
  balanceCents: centsSchema,
  purchasedCents: centsSchema,
  promotionalCents: centsSchema,
  grants: z.array(creditGrantSchema),
  methods: z.array(paymentMethodSchema),
  topUps: z.array(topUpSchema),
  autoTopUp: autoTopUpSchema,
  spendAlert: spendAlertSchema,
  outstandingCents: centsSchema,
  /** Which provider takes the money, or null where none is configured. */
  provider: enumOf(PaymentProvider).nullable(),
});
export type Wallet = z.infer<typeof walletSchema>;

/**
 * Asking for credit.
 *
 * A floor and a ceiling on one request, both of them ours rather than the provider's: a
 * charge under a dollar costs more in provider fees than it adds, and one over fifty
 * thousand is a typo far more often than it is a customer.
 */
export const startTopUpSchema = z.object({
  amountCents: z.number().int().min(100).max(5_000_000),
});
export type StartTopUp = z.infer<typeof startTopUpSchema>;

/**
 * Where to send the browser.
 *
 * The panel never renders a card field, so what it gets back is a URL to leave for. That
 * is the provider's hosted page and is the only place a card number is ever typed.
 */
export const hostedCheckoutSchema = z.object({
  url: z.string(),
  /** Ours, so the screen can ask what became of this attempt when the browser returns. */
  reference: z.string(),
});
export type HostedCheckout = z.infer<typeof hostedCheckoutSchema>;

export const invoiceListSchema = z.object({ invoices: z.array(invoiceSchema) });
export type InvoiceList = z.infer<typeof invoiceListSchema>;

export const invoiceDetailSchema = z.object({
  invoice: invoiceSchema,
  lines: z.array(invoiceLineSchema),
});
export type InvoiceDetail = z.infer<typeof invoiceDetailSchema>;
