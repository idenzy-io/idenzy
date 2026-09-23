import { z } from "zod";
import {
  AutoTopUpSuspension,
  BillingMode,
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

/**
 * Money that may be owed as well as held.
 *
 * The wallet's balance is `spendable credit − debt` (ADR-0014), so it goes negative the
 * moment an organisation is charged past its credit and inside its tolerance. That is not a
 * failure state — it is the tolerance working — and a schema that floored it at zero would
 * make the honest figure unrepresentable and the screen's only option a comfortable lie.
 */
const signedCentsSchema = z.number().int();
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
  /** The provider's page where it is paid, by card or bank transfer. Null until issued. */
  hostedUrl: z.string().nullable(),
  /** When payment is due on the organisation's terms. Null for an invoice with no terms. */
  dueAt: isoDateTimeSchema.nullable(),
  paidAt: isoDateTimeSchema.nullable(),
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
  /** Negative on a line that takes something off, such as prepaid credit applied. */
  totalCents: signedCentsSchema,
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

/**
 * What the automatic rule has been doing, read-only.
 *
 * Separate from `autoTopUp` because that is what a person sends back when they save, and none
 * of this is theirs to set: the rule writes it, and a person clears a suspension by saving the
 * rule, not by editing these. `suspendedReason` is what the screen has to explain — it is the
 * one field here that means somebody has to act.
 */
export const autoTopUpStatusSchema = z.object({
  suspendedReason: enumOf(AutoTopUpSuspension).nullable(),
  suspendedAt: isoDateTimeSchema.nullable(),
  /** Consecutive charges that did not succeed. */
  failures: z.number().int().nonnegative(),
  /** Automatic charges attempted in the last twenty-four hours, and how many are allowed. */
  attemptsToday: z.number().int().nonnegative(),
  dailyLimit: z.number().int().positive(),
});
export type AutoTopUpStatus = z.infer<typeof autoTopUpStatusSchema>;

export const spendAlertSchema = z.object({
  enabled: z.boolean(),
  thresholdCents: centsSchema,
});
export type SpendAlert = z.infer<typeof spendAlertSchema>;

/**
 * An organisation's balance as it stands now: the ledger less usage priced live and not yet
 * booked (ADR-0017).
 *
 * `live` says which it is. True is the figure the billing worker computed within the last few
 * seconds; false is the ledger alone, which trails by up to five minutes and carries no pending
 * figure — what is shown when the live figure is missing, as it is for an organisation nobody has
 * used lately or while Valkey is unavailable. Only the total is live; the split between purchased
 * and promotional credit is the ledger's.
 */
const prepaidBalanceSchema = z.object({
  orgId: z.string(),
  mode: z.literal("prepaid"),
  /** Negative for an organisation inside its tolerance. */
  balanceCents: signedCentsSchema,
  /** Usage priced but not yet on the statement. Null when the figure is the ledger's alone. */
  pendingCents: centsSchema.nullable(),
  asOf: isoDateTimeSchema,
  live: z.boolean(),
});

/**
 * An invoiced organisation (ADR-0019) has no balance to show: it is billed monthly in arrears.
 * What it is shown instead is what it has used that no invoice covers yet, and what it owes on the
 * invoices already issued.
 */
const invoicedBalanceSchema = z.object({
  orgId: z.string(),
  mode: z.literal("invoiced"),
  /** Usage priced and not yet invoiced. Null when there is no live figure to read it from. */
  unbilledCents: centsSchema.nullable(),
  /** Open and past-due invoices, together. */
  outstandingCents: centsSchema,
  /** The past-due part of the above. Shown, and never acted on automatically. */
  overdueCents: centsSchema,
  invoiceTermsDays: z.number().int(),
  asOf: isoDateTimeSchema,
  live: z.boolean(),
});

export const orgBalanceSchema = z.discriminatedUnion("mode", [
  prepaidBalanceSchema,
  invoicedBalanceSchema,
]);
export type OrgBalance = z.infer<typeof orgBalanceSchema>;

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
  /**
   * The live balance: spendable credit less debt less usage not yet booked, so it is negative for
   * an organisation inside its tolerance. The same figure `/v1/me` answers, so the header and this
   * screen never disagree. The grants below are the ledger's and may trail it by minutes.
   */
  balanceCents: signedCentsSchema,
  /** Usage priced but not yet on the statement. Null when the balance is the ledger's alone. */
  pendingCents: centsSchema.nullable(),
  /** How the organisation pays. Invoiced organisations are billed monthly, not drawn (ADR-0019). */
  billingMode: enumOf(BillingMode),
  invoiceTermsDays: z.number().int(),
  purchasedCents: centsSchema,
  promotionalCents: centsSchema,
  /**
   * What usage has cost beyond the credit that was there to cover it.
   *
   * Sent beside the balance rather than folded into it alone, because a screen showing
   * −$42 has to be able to say whether that is one charge or a month of them, and because
   * "you owe $42" and "your balance is −$42" are the same fact worded for two different
   * readers.
   */
  debtCents: centsSchema,
  grants: z.array(creditGrantSchema),
  methods: z.array(paymentMethodSchema),
  topUps: z.array(topUpSchema),
  autoTopUp: autoTopUpSchema,
  autoTopUpStatus: autoTopUpStatusSchema,
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
