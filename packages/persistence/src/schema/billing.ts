import { classified, classifiedTable } from "@idenzy/compliance/classification/classified";
import {
  DataClass,
  Erasure,
  Purpose,
  Retention,
} from "@idenzy/compliance/classification/vocabulary";
import { AUTO_TOP_UP_DAILY_LIMIT } from "@idenzy/protocol/billing/price-list";
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAtColumn, orgIdColumn, updatedAtColumn } from "./shared.js";

/**
 * What the organisation has to spend, what may charge it, and what it has been billed
 * (PROJECT.md 5.1, ADR-0011).
 *
 * Everything here hangs off `org_id` and never off a project. One `billing_customer_id`
 * sits on `orgs`, so every project underneath draws on one balance and an invoice covers
 * the organisation; a wallet scoped to a project would show a third of a bill and call it
 * the bill.
 *
 * **Money is an integer number of cents.** No `numeric`, no `double precision`, no
 * currency arithmetic anywhere but on whole cents. `usage_daily.sms_cost` is the one
 * `numeric` in the schema and it is a *cost* we are quoted in fractions of a cent, not a
 * price anybody is charged. A float here rounds the wrong way once and then disagrees
 * with an issued invoice for ever.
 *
 * **The card is never ours to see.** What these tables hold is a provider token, a brand
 * and four digits, which is everything that can be displayed and everything worth
 * storing. The field that takes a number belongs to the provider's own page.
 *
 * **Financial records outlive an erasure request.** Invoices, top-ups and grants are kept
 * for six years under a legal obligation rather than a contract (`Retention.Years6`,
 * `Erasure.RetainPseudonymous`), which is the same basis `orgs.billing_customer_id`
 * already stands on. That is not a loophole: what is retained is pseudonymous, and the
 * personal column an erasure actually reaches is the billing entity's name on `orgs`.
 */

/** Preset for a row that is part of the financial record and cannot simply be erased. */
const financialRecord = {
  class: DataClass.Pseudonymous,
  purpose: Purpose.BillingAndMetering,
  retention: Retention.Years6,
  erasure: Erasure.RetainPseudonymous,
} as const;

/** Preset for billing configuration: what a customer set, not what they were charged. */
const billingConfig = {
  class: DataClass.Operational,
  purpose: Purpose.BillingAndMetering,
  retention: Retention.ProjectLifetime,
  erasure: Erasure.NotApplicable,
} as const;

/**
 * A card the organisation has put on file.
 *
 * The row is a handle and a label. `provider_method_id` is what a charge is actually made
 * against; the brand, last four and expiry exist so a person can tell one card from
 * another and so the panel can warn before a renewal fails.
 *
 * Exactly one default, or none. The partial unique index is what makes
 * `withDefaultMethod`'s "one act, never two defaults and never none" true at the storage
 * layer rather than only in the panel: a promote-then-demote pair that raced would
 * otherwise leave an automatic top-up quietly charging the wrong card.
 *
 * Removal is a delete and not a flag. There is nothing here worth keeping once a card is
 * gone — the charges it made are on `top_ups`, which holds its own copy of the four
 * digits precisely so the receipt survives the card.
 */
export const paymentMethods = classifiedTable(
  "payment_methods",
  {
    id: classified(uuid("id").primaryKey().defaultRandom(), { ...billingConfig, loggable: true }),
    orgId: orgIdColumn(),
    provider: classified(text("provider").notNull(), {
      ...billingConfig,
      loggable: true,
      note: "PaymentProvider. A column rather than an assumption that there is only ever one.",
    }),
    providerMethodId: classified(text("provider_method_id").notNull(), {
      class: DataClass.Pseudonymous,
      purpose: Purpose.BillingAndMetering,
      retention: Retention.ProjectLifetime,
      erasure: Erasure.RowDeleted,
      note: "The provider's token for the card. Not the card, and not reversible to one.",
    }),
    brand: classified(text("brand").notNull(), { ...billingConfig, loggable: true }),
    last4: classified(text("last4").notNull(), {
      ...billingConfig,
      note: "The only four digits anybody here ever sees. Not a credential, and not enough to be.",
    }),
    expiryMonth: classified(smallint("expiry_month").notNull(), billingConfig),
    expiryYear: classified(smallint("expiry_year").notNull(), billingConfig),
    isDefault: classified(boolean("is_default").notNull().default(false), {
      ...billingConfig,
      loggable: true,
    }),
    addedBy: classified(uuid("added_by"), {
      ...billingConfig,
      purpose: Purpose.AuditAndCompliance,
      note: "The org_members row that added it, for the audit trail as much as for the reader.",
    }),
    createdAt: createdAtColumn(),
  },
  (t) => [
    uniqueIndex("payment_methods_provider_method_key").on(t.provider, t.providerMethodId),
    uniqueIndex("payment_methods_org_default_key").on(t.orgId).where(sql`is_default`),
    index("payment_methods_org_idx").on(t.orgId),
    check("payment_methods_expiry_month_ck", sql`expiry_month between 1 and 12`),
  ],
);

/**
 * One piece of credit on the account, and what is left of it.
 *
 * Grants rather than a single balance column, because "what is my balance" and "how much
 * of it disappears next Tuesday" are the same question asked twice and one figure can
 * only answer the first. The balance is the sum of what is left across the unexpired
 * rows, which is also what makes the draw-down order expressible: promotional credit
 * first and soonest-to-expire first inside each kind, so nothing is lost while purchased
 * credit pays the bill.
 *
 * `remaining_cents` is a running figure rather than a derived one, and the check
 * constraint is what keeps it honest. A drawdown bug that overspent a grant would
 * otherwise show up as a balance nobody can reconcile against an invoice.
 */
export const creditGrants = classifiedTable(
  "credit_grants",
  {
    id: classified(uuid("id").primaryKey().defaultRandom(), { ...financialRecord, loggable: true }),
    orgId: orgIdColumn(),
    kind: classified(text("kind").notNull(), {
      ...financialRecord,
      loggable: true,
      note: "CreditKind. Purchased credit does not expire; promotional credit does.",
    }),
    amountCents: classified(bigint("amount_cents", { mode: "number" }).notNull(), {
      ...financialRecord,
      note: "What it was worth when granted. Never changes, which is what makes it auditable.",
    }),
    remainingCents: classified(bigint("remaining_cents", { mode: "number" }).notNull(), {
      ...financialRecord,
      note: "What is left. Drawn down by the metering job, never below zero or above amount.",
    }),
    currency: classified(text("currency").notNull().default("USD"), financialRecord),
    topUpId: classified(uuid("top_up_id"), {
      ...financialRecord,
      note: "The purchase that created it. Null on a grant nobody paid for.",
    }),
    note: classified(text("note").notNull().default(""), {
      ...financialRecord,
      note: "Why it exists, in the words the wallet screen shows: a top-up, a trial, a credit.",
    }),
    grantedAt: classified(
      timestamp("granted_at", { withTimezone: true }).notNull().defaultNow(),
      financialRecord,
    ),
    expiresAt: classified(timestamp("expires_at", { withTimezone: true }), {
      ...financialRecord,
      loggable: true,
      note: "Null says it does not expire, which is the truth about purchased credit.",
    }),
  },
  (t) => [
    // The wallet's every read is "what is still spendable for this organisation", so the
    // expiry is in the index rather than a filter applied after the rows come back.
    index("credit_grants_org_expiry_idx").on(t.orgId, t.expiresAt),
    check("credit_grants_amount_ck", sql`amount_cents > 0`),
    check("credit_grants_remaining_ck", sql`remaining_cents between 0 and amount_cents`),
  ],
);

/**
 * The rules the organisation has set about its own money: when to top up, and when to
 * say something.
 *
 * One row per organisation, and a missing row means both are off — which is the right
 * answer for an account nobody has configured, because the alternative is charging a card
 * nobody pointed at anything.
 *
 * The alert is an alert and never a cap, and the asymmetry with `sms_policies` is
 * deliberate. SMS has a hard spend cap because a message costs money the moment it leaves
 * and stopping is the only way to stop paying. The equivalent lever here would mean
 * refusing to authenticate somebody because an invoice is unpaid, which takes a
 * customer's own product down and takes their users with it. No amount owed is worth that.
 */
export const billingSettings = classifiedTable(
  "billing_settings",
  {
    orgId: orgIdColumn(),
    currency: classified(text("currency").notNull().default("USD"), {
      ...billingConfig,
      note: "Set at the provider and not from here. One currency per account.",
    }),
    autoTopUpEnabled: classified(boolean("auto_top_up_enabled").notNull().default(false), {
      ...billingConfig,
      loggable: true,
    }),
    autoTopUpThresholdCents: classified(
      bigint("auto_top_up_threshold_cents", { mode: "number" }).notNull().default(0),
      { ...billingConfig, note: "Charge when the spendable balance falls below this." },
    ),
    autoTopUpAmountCents: classified(
      bigint("auto_top_up_amount_cents", { mode: "number" }).notNull().default(0),
      { ...billingConfig, note: "How much to add. Below the threshold it would fire on itself." },
    ),
    autoTopUpMethodId: classified(uuid("auto_top_up_method_id"), {
      ...billingConfig,
      note: "Which card it charges. Null falls back to the default, and the panel says so.",
    }),
    autoTopUpDailyLimit: classified(
      smallint("auto_top_up_daily_limit").notNull().default(AUTO_TOP_UP_DAILY_LIMIT),
      {
        ...billingConfig,
        loggable: true,
        note: "Attempts allowed in any rolling day. Set by support, never over the wire.",
      },
    ),
    autoTopUpFailures: classified(smallint("auto_top_up_failures").notNull().default(0), {
      ...billingConfig,
      loggable: true,
      note: "Consecutive automatic charges that did not succeed. A success resets it.",
    }),
    autoTopUpLastAttemptAt: classified(
      timestamp("auto_top_up_last_attempt_at", { withTimezone: true }),
      {
        ...billingConfig,
        loggable: true,
        note: "When the rule last opened a charge, which is what spaces the next one out.",
      },
    ),
    autoTopUpSuspendedAt: classified(
      timestamp("auto_top_up_suspended_at", { withTimezone: true }),
      {
        ...billingConfig,
        loggable: true,
        note: "Set when charging again cannot help. Cleared only by a person saving the rule.",
      },
    ),
    autoTopUpSuspendedReason: classified(text("auto_top_up_suspended_reason"), {
      ...billingConfig,
      loggable: true,
      note: "AutoTopUpSuspension: what the person who clears it has to fix first.",
    }),
    billingMode: classified(text("billing_mode").notNull().default("prepaid"), {
      ...billingConfig,
      loggable: true,
      note: "BillingMode. Set by Idenzy staff only, with a reason in operator_actions (ADR-0019).",
    }),
    invoiceEmail: classified(text("invoice_email"), {
      class: DataClass.Pii,
      purpose: Purpose.BillingAndMetering,
      retention: Retention.ProjectLifetime,
      erasure: Erasure.NullOut,
      note: "Where an invoiced organisation's invoices are sent. Staff-set with the mode.",
    }),
    invoiceTermsDays: classified(smallint("invoice_terms_days").notNull().default(14), {
      ...billingConfig,
      loggable: true,
      note: "Net terms for an invoiced organisation. Staff-set; 14 unless agreed otherwise.",
    }),
    spendAlertEnabled: classified(boolean("spend_alert_enabled").notNull().default(false), {
      ...billingConfig,
      loggable: true,
    }),
    spendAlertThresholdCents: classified(
      bigint("spend_alert_threshold_cents", { mode: "number" }).notNull().default(0),
      { ...billingConfig, note: "An alert and never a cap. Authentication does not stop (5.1)." },
    ),
    spendAlertSentForMonth: classified(date("spend_alert_sent_for_month"), {
      ...billingConfig,
      note: "The month already alerted on, so a threshold crossed once is not mailed hourly.",
    }),
    updatedBy: classified(uuid("updated_by"), {
      ...billingConfig,
      purpose: Purpose.AuditAndCompliance,
    }),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId] }),
    // An automatic rule that added less than it triggered on would fire again on the
    // balance it just created, which is a charge loop rather than a top-up. Enforced
    // here so no caller can write the pair that does it.
    check(
      "billing_settings_auto_top_up_ck",
      sql`not auto_top_up_enabled or auto_top_up_amount_cents >= auto_top_up_threshold_cents`,
    ),
    check("billing_settings_auto_top_up_limit_ck", sql`auto_top_up_daily_limit between 1 and 10`),
    check("billing_settings_mode_ck", sql`billing_mode in ('prepaid', 'invoiced')`),
    check("billing_settings_terms_ck", sql`invoice_terms_days between 1 and 90`),
    // An invoiced organisation whose invoices have nowhere to go is one that is never billed.
    check(
      "billing_settings_invoice_email_ck",
      sql`billing_mode = 'prepaid' or invoice_email is not null`,
    ),
    check(
      "billing_settings_auto_top_up_suspension_ck",
      sql`(auto_top_up_suspended_at is null) = (auto_top_up_suspended_reason is null)`,
    ),
  ],
);

/**
 * One attempt to put money on the account.
 *
 * A row exists from the moment the charge is started, not from the moment it succeeds,
 * and that ordering is the whole point. A balance that grew is never proof of a payment:
 * the credit grant is written when the provider confirms, and until then this row is the
 * only thing that says anything happened.
 *
 * `provider_intent_id` is unique, which is what makes the provider's webhook safe to
 * deliver twice. It arrives at least once by design, and a second delivery that granted
 * a second lot of credit would be free money.
 *
 * The card's brand and last four are copied here rather than read through
 * `payment_method_id`, because a receipt has to keep saying which card paid after the
 * card is removed.
 */
export const topUps = classifiedTable(
  "top_ups",
  {
    id: classified(uuid("id").primaryKey().defaultRandom(), { ...financialRecord, loggable: true }),
    orgId: orgIdColumn(),
    amountCents: classified(bigint("amount_cents", { mode: "number" }).notNull(), financialRecord),
    currency: classified(text("currency").notNull().default("USD"), financialRecord),
    state: classified(text("state").notNull(), {
      ...financialRecord,
      loggable: true,
      note: "TopUpState. `requires_action` is where 3-D Secure hands the customer to their bank.",
    }),
    trigger: classified(text("trigger").notNull(), {
      ...financialRecord,
      loggable: true,
      note: "TopUpTrigger: whether a person asked or the automatic rule fired.",
    }),
    provider: classified(text("provider").notNull(), { ...financialRecord, loggable: true }),
    providerIntentId: classified(text("provider_intent_id"), {
      ...financialRecord,
      note: "Unique, which is what makes an at-least-once payment webhook safe to replay.",
    }),
    paymentMethodId: classified(uuid("payment_method_id"), {
      ...financialRecord,
      note: "Nulled when the card is removed. The brand and last four below outlive it.",
    }),
    cardBrand: classified(text("card_brand"), financialRecord),
    cardLast4: classified(text("card_last4"), financialRecord),
    failureCode: classified(text("failure_code"), {
      ...financialRecord,
      loggable: true,
      note: "The provider's decline reason, which is the only thing that tells a customer what to fix.",
    }),
    requestedBy: classified(uuid("requested_by"), {
      ...financialRecord,
      purpose: Purpose.AuditAndCompliance,
      note: "Null on an automatic top-up, which nobody asked for personally.",
    }),
    createdAt: createdAtColumn(),
    settledDebtCents: classified(
      bigint("settled_debt_cents", { mode: "number" }).notNull().default(0),
      {
        ...financialRecord,
        loggable: true,
        note: "How much of this top-up cleared outstanding debt before the rest became spendable credit (ADR-0014). Answers where the difference went when a customer asks why $1,000 added $700.",
      },
    ),
    settledAt: classified(timestamp("settled_at", { withTimezone: true }), {
      ...financialRecord,
      loggable: true,
      note: "When the provider stopped changing its mind, whichever way it went.",
    }),
  },
  (t) => [
    uniqueIndex("top_ups_provider_intent_key").on(t.provider, t.providerIntentId),
    // At most one automatic charge open per organisation, whatever the code above it
    // believes. The worker takes a row lock before opening one; this is what still holds
    // if two workers, a retry and a bug all arrive at once. A manual checkout is not in it:
    // a page somebody abandoned stays pending and must not block the rule.
    uniqueIndex("top_ups_org_automatic_open_key")
      .on(t.orgId)
      .where(sql`trigger = 'automatic' and settled_at is null`),
    index("top_ups_org_created_idx").on(t.orgId, t.createdAt),
    check("top_ups_amount_ck", sql`amount_cents > 0`),
    check("top_ups_settled_debt_ck", sql`settled_debt_cents between 0 and amount_cents`),
  ],
);

/**
 * An invoice for one closed month, covering every project the organisation holds.
 *
 * The number is what a customer quotes at us and is not the id. It is unique per
 * organisation and never reused, and an invoice raised in error is voided rather than
 * deleted, because a gap in the sequence is the thing an auditor asks about.
 *
 * The PDF lives at the provider. Rendering a second one here would be a second document
 * to keep correct in two tax jurisdictions, and the one the customer downloads has to be
 * the one the provider's records agree with.
 */
export const invoices = classifiedTable(
  "invoices",
  {
    id: classified(uuid("id").primaryKey().defaultRandom(), { ...financialRecord, loggable: true }),
    orgId: orgIdColumn(),
    number: classified(text("number").notNull(), {
      ...financialRecord,
      loggable: true,
      note: "The human number. Unique per organisation and never reused, voids included.",
    }),
    periodStart: classified(date("period_start").notNull(), financialRecord),
    periodEnd: classified(date("period_end").notNull(), financialRecord),
    status: classified(text("status").notNull(), { ...financialRecord, loggable: true }),
    totalCents: classified(bigint("total_cents", { mode: "number" }).notNull(), {
      ...financialRecord,
      note: "The sum of each project's own rounded total, so this figure and the usage screen's agree.",
    }),
    currency: classified(text("currency").notNull().default("USD"), financialRecord),
    provider: classified(text("provider").notNull(), { ...financialRecord, loggable: true }),
    providerInvoiceId: classified(text("provider_invoice_id"), financialRecord),
    pdfUri: classified(text("pdf_uri"), {
      ...financialRecord,
      note: "At the provider. Null while one is still being produced, which the panel shows.",
    }),
    hostedUrl: classified(text("hosted_url"), {
      ...financialRecord,
      note: "The provider's page where the invoice is paid, by card or bank transfer.",
    }),
    issuedAt: classified(timestamp("issued_at", { withTimezone: true }).notNull(), {
      ...financialRecord,
      loggable: true,
    }),
    dueAt: classified(timestamp("due_at", { withTimezone: true }), financialRecord),
    paidAt: classified(timestamp("paid_at", { withTimezone: true }), financialRecord),
    voidedAt: classified(timestamp("voided_at", { withTimezone: true }), financialRecord),
    createdAt: createdAtColumn(),
  },
  (t) => [
    uniqueIndex("invoices_org_number_key").on(t.orgId, t.number),
    uniqueIndex("invoices_org_period_key").on(t.orgId, t.periodStart),
    uniqueIndex("invoices_provider_invoice_key").on(t.provider, t.providerInvoiceId),
    index("invoices_org_issued_idx").on(t.orgId, t.issuedAt),
  ],
);

/**
 * What an invoice is made of: one line per meter per project.
 *
 * Per project and not only per meter, because the organisation pays one bill and the
 * question it gets asked internally is which application spent it. That is also what lets
 * the usage screen and the invoice reconcile line for line rather than at the total.
 *
 * `project_id` carries no foreign key, which is the shape every org-keyed table here uses:
 * this row is scoped by its organisation and a project is scoped by itself, so a reference
 * would tie two scopes together that no single query holds at once — the same reason
 * `org_members.user_id` has none. `org_id` is repeated on the line rather than read through
 * the invoice, so scoping a line never needs a join.
 */
export const invoiceLines = classifiedTable(
  "invoice_lines",
  {
    id: classified(uuid("id").primaryKey().defaultRandom(), financialRecord),
    orgId: orgIdColumn(),
    invoiceId: classified(
      uuid("invoice_id")
        .notNull()
        .references(() => invoices.id, { onDelete: "cascade" }),
      { ...financialRecord, loggable: true },
    ),
    projectId: classified(uuid("project_id"), {
      ...financialRecord,
      loggable: true,
      note: "Which application spent it; null on an organisation-level line such as credit applied. No FK: the row is org-keyed and the project is not.",
    }),
    item: classified(text("item").notNull(), {
      ...financialRecord,
      loggable: true,
      note: "BillingLineItem, one name per meter in the price list (5.1).",
    }),
    quantity: classified(bigint("quantity", { mode: "number" }).notNull().default(0), {
      ...financialRecord,
      note: "Users, emails, segments or domains, in the unit the meter counts.",
    }),
    unitRateMillicents: classified(integer("unit_rate_millicents").notNull().default(0), {
      ...financialRecord,
      note: "Thousandths of a cent: MAU is $0.0025, which is a quarter of a cent and not an integer one.",
    }),
    totalCents: classified(bigint("total_cents", { mode: "number" }).notNull(), {
      ...financialRecord,
      note: "Rounded once, here. The invoice total is the sum of these and never a re-multiplication.",
    }),
  },
  (t) => [
    uniqueIndex("invoice_lines_invoice_project_item_key").on(t.invoiceId, t.projectId, t.item),
    index("invoice_lines_org_idx").on(t.orgId),
  ],
);

/**
 * Every payment webhook the provider has sent us, once.
 *
 * Deliberately not org-keyed, and so deliberately not under an isolation policy. A
 * webhook arrives for whichever organisation it happens to concern, and the handler that
 * receives it has none bound yet — mapping the provider's customer id to an organisation
 * is the first thing it does with this row, not something it can know before writing it.
 * `relay_offsets` carries no tenant key for the same shape of reason: a process that serves
 * every organisation at once cannot be scoped to one.
 *
 * What replaces the policy is the unique index. The provider delivers at least once by
 * design, so the insert is the idempotency check: a second delivery of an event collides
 * and is dropped, and a handler that is not idempotent cannot grant credit twice.
 *
 * `payload` is the provider's own body, kept verbatim. It is what a disputed charge is
 * reconciled against, and a re-serialised copy is not evidence of anything.
 */
export const paymentProviderEvents = classifiedTable(
  "payment_provider_events",
  {
    id: classified(uuid("id").primaryKey().defaultRandom(), { ...financialRecord, loggable: true }),
    provider: classified(text("provider").notNull(), { ...financialRecord, loggable: true }),
    providerEventId: classified(text("provider_event_id").notNull(), {
      ...financialRecord,
      loggable: true,
      note: "Unique per provider. The insert is the idempotency check, not a lookup before it.",
    }),
    type: classified(text("type").notNull(), { ...financialRecord, loggable: true }),
    payload: classified(jsonb("payload").notNull(), {
      ...financialRecord,
      note: "The provider's body, verbatim. A re-serialised copy is not evidence of a charge.",
    }),
    receivedAt: classified(
      timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
      { ...financialRecord, loggable: true },
    ),
    processedAt: classified(timestamp("processed_at", { withTimezone: true }), {
      ...financialRecord,
      loggable: true,
      note: "Null means received and not yet acted on, which is what the retry sweep looks for.",
    }),
    failureReason: classified(text("failure_reason"), { ...financialRecord, loggable: true }),
  },
  (t) => [
    uniqueIndex("payment_provider_events_provider_event_key").on(t.provider, t.providerEventId),
    index("payment_provider_events_unprocessed_idx")
      .on(t.receivedAt)
      .where(sql`processed_at is null`),
  ],
);

/**
 * What a drawdown has already charged an organisation for a month (ADR-0014).
 *
 * The watermark, and the whole reason the drawdown is safe to run twice or in parallel.
 * A pass prices the month as it now stands and charges the difference from `billed_cents`,
 * then advances both columns by compare-and-swap on the `billed_mau` it read. A pass that
 * lost the race matches no row and retries against fresh numbers; a pass that runs again
 * computes a difference of zero.
 *
 * `billed_mau` only ever moves forward, because MAU within a month is a distinct count
 * over a union and a union only grows. The check constraint says so rather than trusting
 * it: a sketch that somehow went backwards would otherwise have the job trying to take
 * money back, and refusing the write is the safer failure.
 *
 * Keyed on the organisation and not the project, because the allowance and the bands are
 * the organisation's (ADR-0014). A project's own MAU is still readable from `usage_daily`;
 * it just is not what anybody is charged for.
 */
export const usageBillingState = classifiedTable(
  "usage_billing_state",
  {
    orgId: orgIdColumn(),
    period: classified(date("period").notNull(), {
      ...financialRecord,
      loggable: true,
      note: "First day of the calendar month this state covers.",
    }),
    billedMau: classified(bigint("billed_mau", { mode: "number" }).notNull().default(0), {
      ...financialRecord,
      note: "The count the last charge was priced from. Never decreases.",
    }),
    billedCents: classified(bigint("billed_cents", { mode: "number" }).notNull().default(0), {
      ...financialRecord,
      note: "What has been charged for this month so far, in cents.",
    }),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.period] }),
    check("usage_billing_state_not_negative", sql`billed_mau >= 0 and billed_cents >= 0`),
  ],
);

/**
 * What an organisation owes beyond the credit it holds (ADR-0014).
 *
 * Separate from `credit_grants` because a grant cannot go negative and should not: a grant
 * is something that was bought, and a bought thing is not worth less than nothing. What a
 * drawdown could not cover lands here instead, and a top-up settles it before becoming
 * spendable — an organisation $400 down that adds $500 has $100 to spend.
 *
 * One row per organisation, created on first need. The balance a screen shows is spendable
 * credit less this.
 */
export const orgDebts = classifiedTable(
  "org_debts",
  {
    orgId: classified(uuid("org_id").primaryKey(), {
      ...financialRecord,
      loggable: true,
      note: "The organisation. Primary key: there is one debt, not a history of them.",
    }),
    debtCents: classified(bigint("debt_cents", { mode: "number" }).notNull().default(0), {
      ...financialRecord,
      note: "Owed beyond the credit held, in cents. Never negative: credit is the other side.",
    }),
    updatedAt: updatedAtColumn(),
  },
  () => [check("org_debts_not_negative", sql`debt_cents >= 0`)],
);

/**
 * Every charge a drawdown raised, and how it was paid (ADR-0014).
 *
 * The record beneath the two tables above. `org_debts.debt_cents` is the fast answer and
 * this is what it can be rebuilt from, which is what a customer disputing a figure needs —
 * a materialised total that nothing can reconstruct is a number nobody can defend.
 *
 * It is also what the tolerance is computed from: a share of what was charged over the last
 * thirty days, rather than of what was paid in them, so the rope tracks how much an
 * organisation uses rather than when it happened to top up.
 *
 * Append-only, and the grant migration withholds UPDATE and DELETE for the reason
 * `payment_provider_events` withholds DELETE: a charge somebody could amend afterwards is
 * not evidence of anything.
 */
export const usageCharges = classifiedTable(
  "usage_charges",
  {
    id: classified(uuid("id").primaryKey().defaultRandom(), { ...financialRecord, loggable: true }),
    orgId: orgIdColumn(),
    period: classified(date("period").notNull(), { ...financialRecord, loggable: true }),
    item: classified(text("item").notNull(), {
      ...financialRecord,
      loggable: true,
      note: "BillingLineItem. Which meter this charge was raised against.",
    }),
    quantity: classified(bigint("quantity", { mode: "number" }).notNull(), {
      ...financialRecord,
      note: "The count the charge was priced from, at the moment it was raised.",
    }),
    chargedCents: classified(
      bigint("charged_cents", { mode: "number" }).notNull(),
      financialRecord,
    ),
    fromCreditCents: classified(
      bigint("from_credit_cents", { mode: "number" }).notNull().default(0),
      { ...financialRecord, note: "How much of it came out of grants." },
    ),
    toDebtCents: classified(bigint("to_debt_cents", { mode: "number" }).notNull().default(0), {
      ...financialRecord,
      note: "How much of it the credit could not cover. The two sum to charged_cents.",
    }),
    createdAt: createdAtColumn(),
  },
  (t) => [
    index("usage_charges_org_period_idx").on(t.orgId, t.period),
    // The tolerance reads a thirty-day window per organisation, so that is the index.
    index("usage_charges_org_recent_idx").on(t.orgId, t.createdAt),
    check(
      "usage_charges_covered",
      sql`from_credit_cents + to_debt_cents = charged_cents and charged_cents >= 0`,
    ),
  ],
);

/**
 * A refund of a top-up, and what it did to the wallet.
 *
 * Credit bought with money that has been handed back is credit nobody paid for, so a refund
 * takes it out again — from the grant that purchase created first, then from anything else
 * spendable, and whatever is already spent becomes debt. `reversed_from_credit_cents` and
 * `reversed_to_debt_cents` say which, for the same reason `usage_charges` says it: a moving
 * total cannot be asked afterwards where a figure went.
 *
 * Keyed on the provider's refund id, because every refund event (`refund.created`,
 * `refund.updated`, `refund.failed`, `charge.refund.updated`) carries the same object and any
 * of them may arrive first, twice, or out of order. `clawed_back_at` and `restored_at` are the
 * two one-way doors: taken once, given back once, and only in that order. `failed` and
 * `canceled` are final — the money came back to us — so a late `pending` for a refund already
 * known to have failed changes nothing.
 */
export const paymentRefunds = classifiedTable(
  "payment_refunds",
  {
    id: classified(uuid("id").primaryKey().defaultRandom(), { ...financialRecord, loggable: true }),
    orgId: orgIdColumn(),
    topUpId: classified(
      uuid("top_up_id")
        .notNull()
        .references(() => topUps.id, { onDelete: "restrict" }),
      { ...financialRecord, loggable: true },
    ),
    provider: classified(text("provider").notNull(), { ...financialRecord, loggable: true }),
    providerRefundId: classified(text("provider_refund_id").notNull(), {
      ...financialRecord,
      loggable: true,
      note: "Unique per provider. Every refund event carries it, in whatever order they arrive.",
    }),
    amountCents: classified(bigint("amount_cents", { mode: "number" }).notNull(), financialRecord),
    state: classified(text("state").notNull(), {
      ...financialRecord,
      loggable: true,
      note: "RefundState. `failed` and `canceled` are final and nothing moves a row out of them.",
    }),
    reversedFromCreditCents: classified(
      bigint("reversed_from_credit_cents", { mode: "number" }).notNull().default(0),
      { ...financialRecord, note: "How much of the refund came out of spendable credit." },
    ),
    reversedToDebtCents: classified(
      bigint("reversed_to_debt_cents", { mode: "number" }).notNull().default(0),
      { ...financialRecord, note: "How much had already been spent, and so became debt." },
    ),
    clawedBackAt: classified(timestamp("clawed_back_at", { withTimezone: true }), {
      ...financialRecord,
      loggable: true,
      note: "When the credit was taken back. Set once.",
    }),
    restoredAt: classified(timestamp("restored_at", { withTimezone: true }), {
      ...financialRecord,
      loggable: true,
      note: "When a refund that failed gave the credit back. Set once, and only after the above.",
    }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    uniqueIndex("payment_refunds_provider_refund_key").on(t.provider, t.providerRefundId),
    index("payment_refunds_org_created_idx").on(t.orgId, t.createdAt),
    check("payment_refunds_amount_ck", sql`amount_cents > 0`),
    check(
      "payment_refunds_reversal_ck",
      sql`reversed_from_credit_cents >= 0 and reversed_to_debt_cents >= 0
          and reversed_from_credit_cents + reversed_to_debt_cents in (0, amount_cents)`,
    ),
    check("payment_refunds_order_ck", sql`restored_at is null or clawed_back_at is not null`),
  ],
);

/**
 * A cardholder's dispute of a top-up, and what it did to the wallet.
 *
 * The provider takes the disputed amount from us when the dispute opens (`funds_withdrawn`)
 * and gives it back only if we win (`funds_reinstated`). The wallet follows the money rather
 * than the verdict: credit comes out when the funds leave and goes back when they return, so
 * a dispute still under review is never credit we are extending on money we do not hold.
 *
 * `withdrawn_at` and `reinstated_at` are the one-way doors, as on `payment_refunds`, because a
 * dispute sends up to five event types and several can describe the same movement. The
 * automatic rule is suspended the moment one exists: charging again a card whose holder is
 * disputing a charge is the pattern that ends a merchant account.
 */
export const paymentDisputes = classifiedTable(
  "payment_disputes",
  {
    id: classified(uuid("id").primaryKey().defaultRandom(), { ...financialRecord, loggable: true }),
    orgId: orgIdColumn(),
    topUpId: classified(
      uuid("top_up_id")
        .notNull()
        .references(() => topUps.id, { onDelete: "restrict" }),
      { ...financialRecord, loggable: true },
    ),
    provider: classified(text("provider").notNull(), { ...financialRecord, loggable: true }),
    providerDisputeId: classified(text("provider_dispute_id").notNull(), {
      ...financialRecord,
      loggable: true,
      note: "Unique per provider.",
    }),
    amountCents: classified(bigint("amount_cents", { mode: "number" }).notNull(), financialRecord),
    status: classified(text("status").notNull(), {
      ...financialRecord,
      loggable: true,
      note: "DisputeStatus, as the provider last reported it.",
    }),
    reason: classified(text("reason").notNull().default(""), {
      ...financialRecord,
      loggable: true,
      note: "The cardholder's stated reason, in the provider's vocabulary: fraudulent, duplicate…",
    }),
    withdrawnFromCreditCents: classified(
      bigint("withdrawn_from_credit_cents", { mode: "number" }).notNull().default(0),
      financialRecord,
    ),
    withdrawnToDebtCents: classified(
      bigint("withdrawn_to_debt_cents", { mode: "number" }).notNull().default(0),
      financialRecord,
    ),
    withdrawnAt: classified(timestamp("withdrawn_at", { withTimezone: true }), {
      ...financialRecord,
      loggable: true,
      note: "When the provider took the funds and the wallet followed. Set once.",
    }),
    reinstatedAt: classified(timestamp("reinstated_at", { withTimezone: true }), {
      ...financialRecord,
      loggable: true,
      note: "When the funds came back and so did the credit. Set once, only after the above.",
    }),
    closedAt: classified(timestamp("closed_at", { withTimezone: true }), {
      ...financialRecord,
      loggable: true,
    }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    uniqueIndex("payment_disputes_provider_dispute_key").on(t.provider, t.providerDisputeId),
    index("payment_disputes_org_created_idx").on(t.orgId, t.createdAt),
    check("payment_disputes_amount_ck", sql`amount_cents > 0`),
    check(
      "payment_disputes_withdrawal_ck",
      sql`withdrawn_from_credit_cents >= 0 and withdrawn_to_debt_cents >= 0
          and withdrawn_from_credit_cents + withdrawn_to_debt_cents in (0, amount_cents)`,
    ),
    check("payment_disputes_order_ck", sql`reinstated_at is null or withdrawn_at is not null`),
  ],
);
