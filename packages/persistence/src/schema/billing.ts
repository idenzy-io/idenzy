import { classified, controlTable } from "@idenzy/compliance/classification/classified";
import {
  DataClass,
  Erasure,
  Purpose,
  Retention,
} from "@idenzy/compliance/classification/vocabulary";
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
import { createdAtColumn, orgIdColumn, orgIsolationPolicy, updatedAtColumn } from "./shared.js";

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
export const paymentMethods = controlTable(
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
    orgIsolationPolicy("payment_methods"),
  ],
).enableRLS();

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
export const creditGrants = controlTable(
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
    orgIsolationPolicy("credit_grants"),
  ],
).enableRLS();

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
export const billingSettings = controlTable(
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
    orgIsolationPolicy("billing_settings"),
  ],
).enableRLS();

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
export const topUps = controlTable(
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
    index("top_ups_org_created_idx").on(t.orgId, t.createdAt),
    check("top_ups_amount_ck", sql`amount_cents > 0`),
    check("top_ups_settled_debt_ck", sql`settled_debt_cents between 0 and amount_cents`),
    orgIsolationPolicy("top_ups"),
  ],
).enableRLS();

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
export const invoices = controlTable(
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
    orgIsolationPolicy("invoices"),
  ],
).enableRLS();

/**
 * What an invoice is made of: one line per meter per project.
 *
 * Per project and not only per meter, because the organisation pays one bill and the
 * question it gets asked internally is which application spent it. That is also what lets
 * the usage screen and the invoice reconcile line for line rather than at the total.
 *
 * `project_id` carries no foreign key. A project lives in a region cell and this row
 * lives in the control plane, so the reference would not survive the cells being
 * independent stacks (PROJECT.md 4.13.5) — the same reason `org_members.user_id` has none.
 * `org_id` is repeated so the isolation policy applies without a join to the invoice.
 */
export const invoiceLines = controlTable(
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
    projectId: classified(uuid("project_id").notNull(), {
      ...financialRecord,
      loggable: true,
      note: "Which application spent it. No FK: the project is in a cell, this row is not.",
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
    orgIsolationPolicy("invoice_lines"),
  ],
).enableRLS();

/**
 * Every payment webhook the provider has sent us, once.
 *
 * Deliberately not org-keyed, and so deliberately not under an isolation policy. A
 * webhook arrives for whichever organisation it happens to concern, and the handler that
 * receives it has none bound yet — mapping the provider's customer id to an organisation
 * is the first thing it does with this row, not something it can know before writing it.
 * `relay_offsets` is outside RLS for the same shape of reason (migration 0023): a process
 * that serves every organisation at once cannot be scoped to one.
 *
 * What replaces the policy is the unique index. The provider delivers at least once by
 * design, so the insert is the idempotency check: a second delivery of an event collides
 * and is dropped, and a handler that is not idempotent cannot grant credit twice.
 *
 * `payload` is the provider's own body, kept verbatim. It is what a disputed charge is
 * reconciled against, and a re-serialised copy is not evidence of anything.
 */
export const paymentProviderEvents = controlTable(
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
export const usageBillingState = controlTable(
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
    orgIsolationPolicy("usage_billing_state"),
  ],
).enableRLS();

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
export const orgDebts = controlTable(
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
  () => [check("org_debts_not_negative", sql`debt_cents >= 0`), orgIsolationPolicy("org_debts")],
).enableRLS();

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
export const usageCharges = controlTable(
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
    orgIsolationPolicy("usage_charges"),
  ],
).enableRLS();
